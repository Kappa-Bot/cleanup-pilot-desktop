import { DiskIoAnalyzer } from "../electron/diskIoAnalyzer";

describe("DiskIoAnalyzer", () => {
  it("detects burst writers and links cache-heavy processes to cleanup categories", () => {
    const analyzer = new DiskIoAnalyzer();
    const result = analyzer.analyze({
      capturedAt: Date.now(),
      counters: {
        cpuUsagePct: 20,
        ramUsedPct: 55,
        diskActivePct: 91,
        diskQueueDepth: 2.1
      },
      topProcesses: [],
      runawayProcesses: [],
      memoryHogs: [],
      diskWriters: [
        {
          pid: 42,
          processName: "shadercache-worker.exe",
          diskWriteBytesPerSec: 25 * 1024 * 1024,
          diskReadBytesPerSec: 2 * 1024 * 1024
        }
      ]
    });

    expect(result.summary.topWriters).toHaveLength(1);
    expect(result.summary.burstEvents).toHaveLength(1);
    expect(result.insights[0]?.linkedCategory).toBe("cache");
  });
});
