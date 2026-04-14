import { DriverPerformanceSummary, LivePerformanceFrame, ProcessSample, SystemSnapshotHistoryPoint } from "../../types";

export type DashboardWindowKey = "30s" | "2m" | "5m" | "15m" | "session";

export interface AlertThresholds {
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  stalledMs: number;
}

export interface PerformanceIncident {
  id: string;
  kind: "cpu" | "ram" | "disk" | "monitor_stall";
  label: string;
  severity: "low" | "medium" | "high";
  startedAt: number;
  endedAt: number;
  durationMs: number;
  peakValue: number;
}

export interface SnapshotDeltaSummary {
  cpuDeltaPct?: number;
  ramDeltaPct?: number;
  diskDeltaPct?: number;
  startupDeltaPct?: number;
  bottleneckChanged: boolean;
}

export interface MonitorIntervalRecommendation {
  intervalMs: number;
  rationale: string;
}

export interface DegraderItem {
  id: string;
  title: string;
  summary: string;
  tone: "tone-low" | "tone-medium" | "tone-high";
  route: "dashboard" | "processes" | "startup" | "doctor" | "history";
}

export function dashboardWindowMs(windowKey: DashboardWindowKey): number {
  switch (windowKey) {
    case "30s":
      return 30_000;
    case "2m":
      return 2 * 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "session":
    default:
      return 0;
  }
}

export function processSignature(process: ProcessSample): string {
  return (process.executablePath || process.processName).trim().toLowerCase();
}

export function filterFramesByWindow(
  frames: LivePerformanceFrame[],
  windowKey: DashboardWindowKey
): LivePerformanceFrame[] {
  if (!frames.length || windowKey === "session") {
    return frames;
  }
  const cutoff = frames[frames.length - 1].capturedAt - dashboardWindowMs(windowKey);
  return frames.filter((frame) => frame.capturedAt >= cutoff);
}

function metricSeverity(value: number, mediumThreshold: number, highThreshold: number): "low" | "medium" | "high" {
  if (value >= highThreshold) {
    return "high";
  }
  if (value >= mediumThreshold) {
    return "medium";
  }
  return "low";
}

function collectMetricIncidents(
  frames: LivePerformanceFrame[],
  kind: "cpu" | "ram" | "disk",
  selector: (frame: LivePerformanceFrame) => number,
  threshold: number
): PerformanceIncident[] {
  const incidents: PerformanceIncident[] = [];
  let active:
    | {
        startedAt: number;
        peakValue: number;
      }
    | undefined;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const value = selector(frame);
    if (value >= threshold) {
      if (!active) {
        active = {
          startedAt: frame.capturedAt,
          peakValue: value
        };
      } else {
        active.peakValue = Math.max(active.peakValue, value);
      }
      continue;
    }

    if (!active) {
      continue;
    }

    const endedAt = frames[Math.max(0, index - 1)].capturedAt;
    incidents.push({
      id: `${kind}-${active.startedAt}`,
      kind,
      label: `${kind.toUpperCase()} pressure`,
      severity: metricSeverity(active.peakValue, threshold, Math.max(threshold + 10, 90)),
      startedAt: active.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - active.startedAt),
      peakValue: active.peakValue
    });
    active = undefined;
  }

  if (active) {
    const endedAt = frames[frames.length - 1].capturedAt;
    incidents.push({
      id: `${kind}-${active.startedAt}`,
      kind,
      label: `${kind.toUpperCase()} pressure`,
      severity: metricSeverity(active.peakValue, threshold, Math.max(threshold + 10, 90)),
      startedAt: active.startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - active.startedAt),
      peakValue: active.peakValue
    });
  }

  return incidents;
}

function collectStallIncidents(frames: LivePerformanceFrame[], stalledMs: number): PerformanceIncident[] {
  const incidents: PerformanceIncident[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const gapMs = current.capturedAt - previous.capturedAt;
    if (gapMs < stalledMs) {
      continue;
    }
    incidents.push({
      id: `stall-${previous.capturedAt}`,
      kind: "monitor_stall",
      label: "Sampling stall",
      severity: gapMs >= stalledMs * 2 ? "high" : "medium",
      startedAt: previous.capturedAt,
      endedAt: current.capturedAt,
      durationMs: gapMs,
      peakValue: gapMs
    });
  }
  return incidents;
}

export function buildPerformanceIncidents(
  frames: LivePerformanceFrame[],
  thresholds: AlertThresholds
): PerformanceIncident[] {
  if (!frames.length) {
    return [];
  }

  const incidents = [
    ...collectMetricIncidents(frames, "cpu", (frame) => frame.cpuUsagePct, thresholds.cpuPct),
    ...collectMetricIncidents(frames, "ram", (frame) => frame.ramUsedPct, thresholds.ramPct),
    ...collectMetricIncidents(frames, "disk", (frame) => frame.diskActivePct, thresholds.diskPct),
    ...collectStallIncidents(frames, thresholds.stalledMs)
  ];

  return incidents.sort((left, right) => right.endedAt - left.endedAt);
}

export function summarizePinnedProcess(
  frames: LivePerformanceFrame[],
  signature: string
): {
  signature: string;
  processName: string;
  latestCpuPct: number;
  latestRamMb: number;
  latestDiskMbps: number;
  sampleCount: number;
} | null {
  let processName = "";
  let latestCpuPct = 0;
  let latestRamMb = 0;
  let latestDiskMbps = 0;
  let sampleCount = 0;

  for (const frame of frames) {
    const match = frame.topProcesses.find((process) => processSignature(process) === signature);
    if (!match) {
      continue;
    }
    processName = match.processName;
    latestCpuPct = Number(match.cpuPct ?? 0);
    latestRamMb = Number(match.workingSetBytes ?? 0) / 1024 / 1024;
    latestDiskMbps = Number(match.diskWriteBytesPerSec ?? 0) / 1024 / 1024;
    sampleCount += 1;
  }

  if (!sampleCount) {
    return null;
  }

  return {
    signature,
    processName,
    latestCpuPct,
    latestRamMb,
    latestDiskMbps,
    sampleCount
  };
}

export function recommendMonitorInterval(args: {
  sampleIntervalMs: number;
  averageGapMs: number;
  droppedFrameCount: number;
  frameCount: number;
}): MonitorIntervalRecommendation {
  const { sampleIntervalMs, averageGapMs, droppedFrameCount, frameCount } = args;
  if (frameCount < 6) {
    return {
      intervalMs: sampleIntervalMs,
      rationale: "Collect a few more samples before changing the interval."
    };
  }
  if (droppedFrameCount > 3 || averageGapMs > sampleIntervalMs * 2.4) {
    const next = Math.min(5_000, Math.max(2_000, Math.round(sampleIntervalMs * 1.8)));
    return {
      intervalMs: next,
      rationale: "Sampling is falling behind. A slower interval will stabilize the monitor."
    };
  }
  if (averageGapMs > 0 && averageGapMs < sampleIntervalMs * 0.8 && sampleIntervalMs > 1_000) {
    const next = Math.max(1_000, Math.round(sampleIntervalMs * 0.75));
    return {
      intervalMs: next,
      rationale: "Sampling is stable enough to tighten the interval for finer spikes."
    };
  }
  return {
    intervalMs: sampleIntervalMs,
    rationale: "Current interval is balanced for the active session."
  };
}

export function compareSnapshots(
  current?: SystemSnapshotHistoryPoint,
  previous?: SystemSnapshotHistoryPoint
): SnapshotDeltaSummary | null {
  if (!current || !previous) {
    return null;
  }
  const delta = (next?: number, prior?: number) =>
    next === undefined || prior === undefined ? undefined : Math.round((next - prior) * 10) / 10;

  return {
    cpuDeltaPct: delta(current.cpuAvgPct, previous.cpuAvgPct),
    ramDeltaPct: delta(current.ramUsedPct, previous.ramUsedPct),
    diskDeltaPct: delta(current.diskActivePct, previous.diskActivePct),
    startupDeltaPct: delta(current.startupImpactScore, previous.startupImpactScore),
    bottleneckChanged: current.primaryBottleneck !== previous.primaryBottleneck
  };
}

export function buildTopDegraders(args: {
  frames: LivePerformanceFrame[];
  driverSummary: DriverPerformanceSummary | null;
  historyDelta: SnapshotDeltaSummary | null;
}): DegraderItem[] {
  const latest = args.frames[args.frames.length - 1];
  const topCpu = [...(latest?.topProcesses ?? [])].sort((left, right) => Number(right.cpuPct ?? 0) - Number(left.cpuPct ?? 0))[0];
  const topDisk = [...(latest?.topProcesses ?? [])].sort((left, right) => Number(right.diskWriteBytesPerSec ?? 0) - Number(left.diskWriteBytesPerSec ?? 0))[0];
  const topRam = [...(latest?.topProcesses ?? [])].sort((left, right) => Number(right.workingSetBytes ?? 0) - Number(left.workingSetBytes ?? 0))[0];

  const degraders: DegraderItem[] = [];

  if (topCpu && Number(topCpu.cpuPct ?? 0) >= 35) {
    degraders.push({
      id: `cpu-${topCpu.pid}`,
      title: `${topCpu.processName} is leading CPU`,
      summary: `${Math.round(Number(topCpu.cpuPct ?? 0))}% CPU on the live frame.`,
      tone: Number(topCpu.cpuPct ?? 0) >= 80 ? "tone-high" : "tone-medium",
      route: "processes"
    });
  }

  if (topDisk && Number(topDisk.diskWriteBytesPerSec ?? 0) >= 10 * 1024 * 1024) {
    degraders.push({
      id: `disk-${topDisk.pid}`,
      title: `${topDisk.processName} is driving disk writes`,
      summary: `${(Number(topDisk.diskWriteBytesPerSec ?? 0) / 1024 / 1024).toFixed(1)} MB/s write.`,
      tone: Number(topDisk.diskWriteBytesPerSec ?? 0) >= 50 * 1024 * 1024 ? "tone-high" : "tone-medium",
      route: "processes"
    });
  }

  if (topRam && Number(topRam.workingSetBytes ?? 0) >= 1_000 * 1024 * 1024) {
    degraders.push({
      id: `ram-${topRam.pid}`,
      title: `${topRam.processName} is holding the most RAM`,
      summary: `${Math.round(Number(topRam.workingSetBytes ?? 0) / 1024 / 1024)} MB working set.`,
      tone: Number(topRam.workingSetBytes ?? 0) >= 2_000 * 1024 * 1024 ? "tone-high" : "tone-medium",
      route: "processes"
    });
  }

  if (args.driverSummary?.latencyRisk === "high" || (args.driverSummary?.suspectedDrivers.length ?? 0) > 0) {
    degraders.push({
      id: "drivers",
      title: "Driver latency risk is active",
      summary: `${args.driverSummary?.suspectedDrivers.length ?? 0} suspected drivers with ${args.driverSummary?.latencyRisk ?? "unknown"} latency risk.`,
      tone: args.driverSummary?.latencyRisk === "high" ? "tone-high" : "tone-medium",
      route: "doctor"
    });
  }

  if (args.historyDelta?.bottleneckChanged || Number(args.historyDelta?.diskDeltaPct ?? 0) >= 10) {
    degraders.push({
      id: "history-delta",
      title: "Performance changed since the previous snapshot",
      summary: args.historyDelta?.bottleneckChanged
        ? "Primary bottleneck changed since the previous stored snapshot."
        : `Disk pressure changed by ${args.historyDelta?.diskDeltaPct} pts.`,
      tone: "tone-low",
      route: "history"
    });
  }

  return degraders.slice(0, 5);
}
