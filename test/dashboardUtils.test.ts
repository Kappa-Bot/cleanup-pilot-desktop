import {
  buildPerformanceIncidents,
  buildTopDegraders,
  compareSnapshots,
  filterFramesByWindow,
  processSignature,
  recommendMonitorInterval,
  summarizePinnedProcess
} from "../src/features/performance/dashboardUtils";
import { DriverPerformanceSummary, LivePerformanceFrame, ProcessSample, SystemSnapshotHistoryPoint } from "../src/types";

function createFrame(overrides: Partial<LivePerformanceFrame>): LivePerformanceFrame {
  return {
    sessionId: "session-1",
    capturedAt: 1000,
    cpuUsagePct: 25,
    ramUsedPct: 40,
    diskActivePct: 20,
    topProcesses: [],
    ...overrides
  };
}

describe("dashboardUtils", () => {
  it("filters frames by time window", () => {
    const frames = [
      createFrame({ capturedAt: 1000 }),
      createFrame({ capturedAt: 35_000 }),
      createFrame({ capturedAt: 60_000 })
    ];

    expect(filterFramesByWindow(frames, "30s")).toHaveLength(2);
    expect(filterFramesByWindow(frames, "session")).toHaveLength(3);
  });

  it("builds incidents for sustained pressure and sampling stalls", () => {
    const frames = [
      createFrame({ capturedAt: 1000, cpuUsagePct: 90 }),
      createFrame({ capturedAt: 3000, cpuUsagePct: 93 }),
      createFrame({ capturedAt: 12_500, cpuUsagePct: 20 }),
      createFrame({ capturedAt: 14_500, diskActivePct: 85 }),
      createFrame({ capturedAt: 17_500, diskActivePct: 40 })
    ];

    const incidents = buildPerformanceIncidents(frames, {
      cpuPct: 85,
      ramPct: 85,
      diskPct: 80,
      stalledMs: 7_000
    });

    expect(incidents.some((item) => item.kind === "cpu")).toBe(true);
    expect(incidents.some((item) => item.kind === "monitor_stall")).toBe(true);
    expect(incidents.some((item) => item.kind === "disk")).toBe(true);
  });

  it("recommends a slower interval when sampling falls behind", () => {
    expect(
      recommendMonitorInterval({
        sampleIntervalMs: 1000,
        averageGapMs: 2800,
        droppedFrameCount: 5,
        frameCount: 20
      })
    ).toEqual({
      intervalMs: 2000,
      rationale: "Sampling is falling behind. A slower interval will stabilize the monitor."
    });
  });

  it("compares snapshots and summarizes pinned process samples", () => {
    const previous: SystemSnapshotHistoryPoint = {
      id: "prev",
      createdAt: 1000,
      source: "manual",
      primaryBottleneck: "cpu",
      cpuAvgPct: 40,
      ramUsedPct: 50,
      diskActivePct: 25,
      startupImpactScore: 20
    };
    const current: SystemSnapshotHistoryPoint = {
      id: "curr",
      createdAt: 2000,
      source: "manual",
      primaryBottleneck: "disk_io",
      cpuAvgPct: 55,
      ramUsedPct: 54,
      diskActivePct: 60,
      startupImpactScore: 18
    };
    const process: ProcessSample = {
      pid: 55,
      processName: "node.exe",
      executablePath: "C:\\node.exe",
      cpuPct: 22,
      workingSetBytes: 512 * 1024 * 1024,
      diskWriteBytesPerSec: 8 * 1024 * 1024
    };
    const frames = [
      createFrame({ capturedAt: 1000, topProcesses: [process] }),
      createFrame({ capturedAt: 3000, topProcesses: [{ ...process, cpuPct: 35 }] })
    ];

    expect(compareSnapshots(current, previous)).toEqual({
      cpuDeltaPct: 15,
      ramDeltaPct: 4,
      diskDeltaPct: 35,
      startupDeltaPct: -2,
      bottleneckChanged: true
    });
    expect(processSignature(process)).toBe("c:\\node.exe");
    expect(summarizePinnedProcess(frames, "c:\\node.exe")).toEqual({
      signature: "c:\\node.exe",
      processName: "node.exe",
      latestCpuPct: 35,
      latestRamMb: 512,
      latestDiskMbps: 8,
      sampleCount: 2
    });
  });

  it("builds a compact degrader list", () => {
    const driverSummary: DriverPerformanceSummary = {
      latencyRisk: "high",
      suspectedDrivers: [{ name: "ndis.sys", reason: ["DPC spikes"], confidence: 0.8 }],
      activeSignals: []
    };
    const frames = [
      createFrame({
        capturedAt: 1000,
        topProcesses: [
          {
            pid: 4,
            processName: "RenderApp",
            cpuPct: 81,
            workingSetBytes: 2400 * 1024 * 1024,
            diskWriteBytesPerSec: 65 * 1024 * 1024
          }
        ]
      })
    ];

    const degraders = buildTopDegraders({
      frames,
      driverSummary,
      historyDelta: { cpuDeltaPct: 0, ramDeltaPct: 0, diskDeltaPct: 12, startupDeltaPct: 0, bottleneckChanged: false }
    });

    expect(degraders.length).toBeGreaterThan(0);
    expect(degraders.some((item) => item.route === "doctor")).toBe(true);
  });
});
