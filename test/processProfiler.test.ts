import { ProcessProfiler, RawProcessProfilerSnapshot } from "../electron/processProfiler";

describe("ProcessProfiler", () => {
  it("prefers direct per-process IO rates when available", () => {
    const profiler = new ProcessProfiler();
    const previous: RawProcessProfilerSnapshot = {
      capturedAt: 1_000,
      counters: {
        cpuUsagePct: 25,
        ramUsedPct: 40,
        diskActivePct: 10
      },
      processes: [
        {
          pid: 42,
          processName: "node",
          workingSetBytes: 500 * 1024 * 1024,
          privateBytes: 420 * 1024 * 1024,
          userModeTime: 2_000_000,
          kernelModeTime: 1_000_000,
          readTransferCount: 100,
          writeTransferCount: 200
        }
      ]
    };
    const current: RawProcessProfilerSnapshot = {
      capturedAt: 3_000,
      counters: {
        cpuUsagePct: 30,
        ramUsedPct: 42,
        diskActivePct: 22
      },
      processes: [
        {
          pid: 42,
          processName: "node",
          workingSetBytes: 520 * 1024 * 1024,
          privateBytes: 440 * 1024 * 1024,
          userModeTime: 6_000_000,
          kernelModeTime: 3_000_000,
          readTransferCount: 150,
          writeTransferCount: 260,
          readBytesPerSec: 12_345,
          writeBytesPerSec: 54_321
        }
      ]
    };

    const frame = profiler.buildFrame(current, previous);
    expect(frame.topProcesses[0]).toEqual(
      expect.objectContaining({
        pid: 42,
        diskReadBytesPerSec: 12_345,
        diskWriteBytesPerSec: 54_321
      })
    );
  });
});
