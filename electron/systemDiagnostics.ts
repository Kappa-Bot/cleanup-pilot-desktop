import { randomUUID } from "crypto";
import { DriverScanService } from "./driverScanService";
import { DiskIoAnalyzer } from "./diskIoAnalyzer";
import { MemoryAnalyzer } from "./memoryAnalyzer";
import { ProcessProfiler, ProcessProfilerFrame } from "./processProfiler";
import { ServiceAnalyzer } from "./serviceAnalyzer";
import { StartupAnalyzer } from "./startupAnalyzer";
import {
  BottleneckType,
  SystemSnapshot,
  SystemSnapshotHistoryPoint,
  DriverPerformanceSummary,
  CapabilityFlags
} from "./types";
import { TaskSchedulerAnalyzer } from "./taskSchedulerAnalyzer";
import { probeCapabilities } from "./windowsSources/capabilityProbe";
import { getSystemInfo } from "./windowsSources/systemInfoSource";

interface SystemDiagnosticsDependencies {
  processProfiler?: ProcessProfiler;
  startupAnalyzer?: StartupAnalyzer;
  serviceAnalyzer?: ServiceAnalyzer;
  taskSchedulerAnalyzer?: TaskSchedulerAnalyzer;
  diskIoAnalyzer?: DiskIoAnalyzer;
  memoryAnalyzer?: MemoryAnalyzer;
  driverScanService: DriverScanService;
}

function computeBottleneck(snapshot: Pick<SystemSnapshot, "cpu" | "memory" | "diskIo" | "gpu" | "drivers">): {
  primary: BottleneckType;
  confidence: number;
  evidence: string[];
} {
  const cpuScore = snapshot.cpu.avgUsagePct >= 85 ? snapshot.cpu.avgUsagePct : 0;
  const ramScore = snapshot.memory.usedPct >= 85 ? snapshot.memory.usedPct : 0;
  const diskScore = snapshot.diskIo.activeTimePct >= 80 ? snapshot.diskIo.activeTimePct : 0;
  const gpuScore = Number(snapshot.gpu.totalUsagePct ?? 0) >= 90 ? Number(snapshot.gpu.totalUsagePct ?? 0) : 0;
  const driverScore =
    snapshot.drivers.latencyRisk === "high"
      ? 92
      : snapshot.drivers.latencyRisk === "medium"
        ? 72
        : 0;

  const ranked = [
    { type: "cpu" as const, score: cpuScore, evidence: `CPU average ${snapshot.cpu.avgUsagePct.toFixed(1)}%` },
    { type: "ram" as const, score: ramScore, evidence: `RAM used ${snapshot.memory.usedPct.toFixed(1)}%` },
    { type: "disk_io" as const, score: diskScore, evidence: `Disk active ${snapshot.diskIo.activeTimePct.toFixed(1)}%` },
    { type: "gpu" as const, score: gpuScore, evidence: `GPU used ${(snapshot.gpu.totalUsagePct ?? 0).toFixed(1)}%` },
    {
      type: "drivers" as const,
      score: driverScore,
      evidence: `Driver latency risk ${snapshot.drivers.latencyRisk}`
    }
  ].sort((left, right) => right.score - left.score);

  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score <= 0) {
    return { primary: "unknown", confidence: 0.25, evidence: ["No subsystem crossed the current bottleneck threshold."] };
  }
  if (second && Math.abs(top.score - second.score) <= 10 && second.score >= 75) {
    return {
      primary: "mixed",
      confidence: 0.72,
      evidence: [top.evidence, second.evidence]
    };
  }
  return {
    primary: top.type,
    confidence: Math.min(0.98, 0.5 + top.score / 200),
    evidence: [top.evidence]
  };
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function latestTopProcesses(frames: ProcessProfilerFrame[]): ProcessProfilerFrame {
  return frames[frames.length - 1] ?? {
    capturedAt: Date.now(),
    counters: {
      cpuUsagePct: 0,
      ramUsedPct: 0,
      diskActivePct: 0
    },
    topProcesses: [],
    runawayProcesses: [],
    memoryHogs: [],
    diskWriters: []
  };
}

export class SystemDiagnostics {
  private readonly processProfiler: ProcessProfiler;
  private readonly startupAnalyzer: StartupAnalyzer;
  private readonly serviceAnalyzer: ServiceAnalyzer;
  private readonly taskSchedulerAnalyzer: TaskSchedulerAnalyzer;
  private readonly diskIoAnalyzer: DiskIoAnalyzer;
  private readonly memoryAnalyzer: MemoryAnalyzer;
  private readonly driverScanService: DriverScanService;

  constructor(dependencies: SystemDiagnosticsDependencies) {
    this.processProfiler = dependencies.processProfiler ?? new ProcessProfiler();
    this.startupAnalyzer = dependencies.startupAnalyzer ?? new StartupAnalyzer();
    this.serviceAnalyzer = dependencies.serviceAnalyzer ?? new ServiceAnalyzer();
    this.taskSchedulerAnalyzer = dependencies.taskSchedulerAnalyzer ?? new TaskSchedulerAnalyzer();
    this.diskIoAnalyzer = dependencies.diskIoAnalyzer ?? new DiskIoAnalyzer();
    this.memoryAnalyzer = dependencies.memoryAnalyzer ?? new MemoryAnalyzer();
    this.driverScanService = dependencies.driverScanService;
  }

  async captureSnapshot(args: {
    source: SystemSnapshot["source"];
    sampleIntervalMs?: number;
    sampleCount?: number;
  }): Promise<SystemSnapshot> {
    const defaultSampleCount = args.source === "manual" ? 2 : 3;
    const defaultIntervalMs = args.source === "manual" ? 750 : 1_000;
    const sampleIntervalMs = Math.max(500, args.sampleIntervalMs ?? defaultIntervalMs);
    const sampleCount = Math.max(2, args.sampleCount ?? defaultSampleCount);

    const [capabilities, machine, firstRaw] = await Promise.all([
      probeCapabilities(),
      getSystemInfo(),
      this.processProfiler.captureRawSnapshot()
    ]);

    const frames: ProcessProfilerFrame[] = [];
    let previous = firstRaw;
    for (let index = 0; index < sampleCount; index += 1) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
      }
      const next = await this.processProfiler.captureRawSnapshot();
      frames.push(this.processProfiler.buildFrame(next, previous));
      previous = next;
    }

    const latestFrame = latestTopProcesses(frames);
    const [startup, services, tasks, driverSummary] = await Promise.all([
      this.startupAnalyzer.scan(latestFrame.topProcesses),
      this.serviceAnalyzer.scan(),
      this.taskSchedulerAnalyzer.scan(),
      this.driverScanService.scanPerformanceSummary().catch<DriverPerformanceSummary>(() => ({
        latencyRisk: "low",
        suspectedDrivers: [],
        activeSignals: []
      }))
    ]);

    const diskIo = this.diskIoAnalyzer.analyze(latestFrame);
    const memory = this.memoryAnalyzer.analyze(latestFrame, machine.totalRamBytes, frames);

    const snapshotBase = {
      id: randomUUID(),
      createdAt: Date.now(),
      source: args.source,
      machine,
      capabilities,
      cpu: {
        avgUsagePct: average(frames.map((frame) => frame.counters.cpuUsagePct)),
        peakUsagePct: Math.max(...frames.map((frame) => frame.counters.cpuUsagePct), 0),
        topProcesses: latestFrame.topProcesses
      },
      memory: memory.summary,
      diskIo: diskIo.summary,
      network: {
        totalSendBytesPerSec: latestFrame.counters.networkSendBytesPerSec,
        totalReceiveBytesPerSec: latestFrame.counters.networkReceiveBytesPerSec,
        topProcesses: []
      },
      gpu: {
        totalUsagePct: latestFrame.counters.gpuUsagePct,
        topProcesses: []
      },
      startup: startup.summary,
      services: services.summary,
      tasks: tasks.summary,
      drivers: driverSummary
    } satisfies Omit<SystemSnapshot, "bottleneck">;

    return {
      ...snapshotBase,
      bottleneck: computeBottleneck(snapshotBase)
    };
  }

  toHistoryPoint(snapshot: SystemSnapshot): SystemSnapshotHistoryPoint {
    return {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      source: snapshot.source,
      primaryBottleneck: snapshot.bottleneck.primary,
      cpuAvgPct: snapshot.cpu.avgUsagePct,
      ramUsedPct: snapshot.memory.usedPct,
      diskActivePct: snapshot.diskIo.activeTimePct,
      gpuPct: snapshot.gpu.totalUsagePct,
      startupImpactScore: snapshot.startup.impactScore
    };
  }
}
