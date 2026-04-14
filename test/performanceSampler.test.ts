import { PerformanceSampler } from "../electron/performanceSampler";

jest.mock("../electron/windowsSources/capabilityProbe", () => ({
  probeCapabilities: jest.fn(async () => ({
    gpuSupported: false,
    perProcessGpuSupported: false,
    perProcessNetworkSupported: false,
    diagnosticsEventLogSupported: true,
    taskDelaySupported: true,
    serviceDelayedAutoStartSupported: true
  }))
}));

describe("PerformanceSampler", () => {
  it("shares samples and respects listener intervals", async () => {
    const snapshots = [
      { capturedAt: 1_000 },
      { capturedAt: 2_200 },
      { capturedAt: 6_400 }
    ];
    let index = 0;

    const fakeProfiler = {
      captureRawSnapshot: jest.fn(async () => snapshots[index++] ?? snapshots[snapshots.length - 1]),
      buildFrame: jest.fn((current) => ({
        capturedAt: current.capturedAt,
        counters: {
          cpuUsagePct: 12,
          ramUsedPct: 46,
          diskActivePct: 17,
          gpuUsagePct: undefined,
          networkSendBytesPerSec: undefined,
          networkReceiveBytesPerSec: undefined
        },
        topProcesses: [
          {
            pid: 100,
            processName: "CleanupPilot.exe",
            cpuPct: 2
          }
        ],
        runawayProcesses: [],
        memoryHogs: [],
        diskWriters: []
      }))
    };

    const sampler = new PerformanceSampler({
      processProfiler: fakeProfiler as any
    });

    const fastFrames: number[] = [];
    const slowFrames: number[] = [];
    const unsubscribeFast = sampler.subscribe("fast", 1_000, (frame) => fastFrames.push(frame.capturedAt), false);
    const unsubscribeSlow = sampler.subscribe("slow", 5_000, (frame) => slowFrames.push(frame.capturedAt), false);

    await sampler.prime();
    expect(fastFrames).toEqual([1_000]);
    expect(slowFrames).toEqual([1_000]);

    await sampler.collectNow();
    expect(fastFrames).toEqual([1_000, 2_200]);
    expect(slowFrames).toEqual([1_000]);

    await sampler.collectNow();
    expect(fastFrames).toEqual([1_000, 2_200, 6_400]);
    expect(slowFrames).toEqual([1_000, 6_400]);

    unsubscribeFast();
    unsubscribeSlow();
  });
});
