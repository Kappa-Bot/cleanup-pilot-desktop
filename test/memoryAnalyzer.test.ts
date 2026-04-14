import { MemoryAnalyzer } from "../electron/memoryAnalyzer";

function frameAt(offset: number, privateBytesMb: number) {
  return {
    capturedAt: offset,
    counters: {
      cpuUsagePct: 20,
      ramUsedPct: 75,
      diskActivePct: 10
    },
    topProcesses: [],
    runawayProcesses: [],
    diskWriters: [],
    memoryHogs: [
      {
        pid: 77,
        processName: "leaky-app.exe",
        workingSetBytes: privateBytesMb * 1024 * 1024,
        privateBytes: privateBytesMb * 1024 * 1024
      }
    ]
  };
}

describe("MemoryAnalyzer", () => {
  it("flags probable leaks when memory keeps rising across the monitoring window", () => {
    const analyzer = new MemoryAnalyzer();
    const history = [
      frameAt(1_000, 600),
      frameAt(2_000, 750),
      frameAt(3_000, 900),
      frameAt(4_000, 1_050),
      frameAt(5_000, 1_200),
      frameAt(6_000, 1_350)
    ];

    const result = analyzer.analyze(history[history.length - 1], 16 * 1024 * 1024 * 1024, history);
    expect(result.insights.some((item) => item.title === "Probable memory leak")).toBe(true);
  });
});
