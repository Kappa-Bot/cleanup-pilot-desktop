import os from "os";
import { ProcessSample } from "./types";
import { getPerfCounterSnapshot, PerfCounterSnapshot } from "./windowsSources/perfCounterSource";
import { listProcesses, RawProcessSample } from "./windowsSources/processSource";

const LOGICAL_CORES = Math.max(1, os.cpus().length);
const TOP_PROCESS_LIMIT = 80;
const METRIC_CANDIDATE_LIMIT = 40;

export interface RawProcessProfilerSnapshot {
  capturedAt: number;
  processes: RawProcessSample[];
  counters: PerfCounterSnapshot;
}

export interface ProcessProfilerFrame {
  capturedAt: number;
  counters: PerfCounterSnapshot;
  topProcesses: ProcessSample[];
  runawayProcesses: ProcessSample[];
  memoryHogs: ProcessSample[];
  diskWriters: ProcessSample[];
}

function sortByMetric<T extends ProcessSample>(items: T[], metric: keyof ProcessSample): T[] {
  return [...items].sort((left, right) => Number(right[metric] ?? 0) - Number(left[metric] ?? 0));
}

function computeCpuPct(
  current: RawProcessSample,
  previous: RawProcessSample | undefined,
  elapsedMs: number,
  logicalCores: number
): number | undefined {
  if (!previous || !elapsedMs) {
    return undefined;
  }
  const previousCpuTime = Number(previous.userModeTime ?? 0) + Number(previous.kernelModeTime ?? 0);
  const currentCpuTime = Number(current.userModeTime ?? 0) + Number(current.kernelModeTime ?? 0);
  const delta = Math.max(0, currentCpuTime - previousCpuTime);
  const elapsed100Ns = elapsedMs * 10_000;
  if (!elapsed100Ns) {
    return undefined;
  }
  const pct = (delta / elapsed100Ns / Math.max(1, logicalCores)) * 100;
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : undefined;
}

function computeRate(current: number | undefined, previous: number | undefined, elapsedMs: number): number | undefined {
  if (current === undefined || previous === undefined || elapsedMs <= 0) {
    return undefined;
  }
  const delta = Math.max(0, current - previous);
  return Math.round((delta / elapsedMs) * 1000);
}

function resolveIoRate(
  currentRate: number | undefined,
  currentTransferCount: number | undefined,
  previousTransferCount: number | undefined,
  elapsedMs: number
): number | undefined {
  if (currentRate !== undefined && Number.isFinite(currentRate)) {
    return Math.max(0, Math.round(currentRate));
  }
  return computeRate(currentTransferCount, previousTransferCount, elapsedMs);
}

function processImpactScore(item: ProcessSample): number {
  const cpu = Number(item.cpuPct ?? 0);
  const ramMb = Number(item.workingSetBytes ?? 0) / 1024 / 1024;
  const privateMb = Number(item.privateBytes ?? 0) / 1024 / 1024;
  const diskWriteMb = Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024;
  const diskReadMb = Number(item.diskReadBytesPerSec ?? 0) / 1024 / 1024;
  return cpu * 1.6 + ramMb / 120 + privateMb / 180 + diskWriteMb * 2.4 + diskReadMb * 1.2;
}

function selectTopProcesses(samples: ProcessSample[]): ProcessSample[] {
  const byPid = new Map<number, ProcessSample>();
  const candidates = [
    ...sortByMetric(samples, "cpuPct").slice(0, METRIC_CANDIDATE_LIMIT),
    ...sortByMetric(samples, "workingSetBytes").slice(0, METRIC_CANDIDATE_LIMIT),
    ...sortByMetric(samples, "privateBytes").slice(0, METRIC_CANDIDATE_LIMIT),
    ...sortByMetric(samples, "diskWriteBytesPerSec").slice(0, METRIC_CANDIDATE_LIMIT),
    ...sortByMetric(samples, "diskReadBytesPerSec").slice(0, METRIC_CANDIDATE_LIMIT)
  ];

  for (const item of candidates) {
    if (!byPid.has(item.pid)) {
      byPid.set(item.pid, item);
    }
  }

  return [...byPid.values()]
    .sort((left, right) => {
      const scoreDiff = processImpactScore(right) - processImpactScore(left);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      const cpuDiff = Number(right.cpuPct ?? 0) - Number(left.cpuPct ?? 0);
      if (cpuDiff !== 0) {
        return cpuDiff;
      }
      return left.pid - right.pid;
    })
    .slice(0, TOP_PROCESS_LIMIT);
}

export class ProcessProfiler {
  async captureRawSnapshot(): Promise<RawProcessProfilerSnapshot> {
    const [processes, counters] = await Promise.all([listProcesses(), getPerfCounterSnapshot()]);
    return {
      capturedAt: Date.now(),
      processes,
      counters
    };
  }

  buildFrame(
    current: RawProcessProfilerSnapshot,
    previous?: RawProcessProfilerSnapshot
  ): ProcessProfilerFrame {
    const elapsedMs = previous ? Math.max(1, current.capturedAt - previous.capturedAt) : 0;
    const logicalCores = LOGICAL_CORES;
    const previousByPid = new Map(previous?.processes.map((item) => [item.pid, item]) ?? []);
    const samples: ProcessSample[] = current.processes.map((process) => {
      const previousProcess = previousByPid.get(process.pid);
      return {
        pid: process.pid,
        processName: process.processName,
        executablePath: process.executablePath,
        cpuPct: computeCpuPct(process, previousProcess, elapsedMs, logicalCores),
        workingSetBytes: process.workingSetBytes,
        privateBytes: process.privateBytes,
        diskReadBytesPerSec: resolveIoRate(
          process.readBytesPerSec,
          process.readTransferCount,
          previousProcess?.readTransferCount,
          elapsedMs
        ),
        diskWriteBytesPerSec: resolveIoRate(
          process.writeBytesPerSec,
          process.writeTransferCount,
          previousProcess?.writeTransferCount,
          elapsedMs
        )
      };
    });

    return {
      capturedAt: current.capturedAt,
      counters: current.counters,
      topProcesses: selectTopProcesses(samples),
      runawayProcesses: samples.filter((item) => Number(item.cpuPct ?? 0) >= 75).sort((a, b) => Number(b.cpuPct ?? 0) - Number(a.cpuPct ?? 0)),
      memoryHogs: sortByMetric(samples, "workingSetBytes").slice(0, 24),
      diskWriters: sortByMetric(samples, "diskWriteBytesPerSec").slice(0, 24)
    };
  }

  async captureSample(intervalMs = 1_000): Promise<ProcessProfilerFrame> {
    const first = await this.captureRawSnapshot();
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, intervalMs)));
    const second = await this.captureRawSnapshot();
    return this.buildFrame(second, first);
  }
}
