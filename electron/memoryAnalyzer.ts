import { MemoryInsight, ProcessSample, SystemSnapshot } from "./types";
import { ProcessProfilerFrame } from "./processProfiler";

function buildLeakCandidates(history: ProcessProfilerFrame[], totalRamBytes: number): MemoryInsight[] {
  const byPid = new Map<number, Array<{ capturedAt: number; sample: ProcessSample }>>();
  for (const frame of history) {
    for (const sample of frame.memoryHogs.slice(0, 12)) {
      const current = byPid.get(sample.pid) ?? [];
      current.push({ capturedAt: frame.capturedAt, sample });
      byPid.set(sample.pid, current);
    }
  }

  const insights: MemoryInsight[] = [];
  for (const [pid, points] of byPid) {
    if (points.length < 6) {
      continue;
    }
    let steadilyIncreasing = true;
    for (let index = 1; index < points.length; index += 1) {
      if (Number(points[index].sample.privateBytes ?? 0) < Number(points[index - 1].sample.privateBytes ?? 0)) {
        steadilyIncreasing = false;
        break;
      }
    }
    if (!steadilyIncreasing) {
      continue;
    }
    const first = Number(points[0].sample.privateBytes ?? 0);
    const last = Number(points[points.length - 1].sample.privateBytes ?? 0);
    const growth = last - first;
    if (growth < 500 * 1024 * 1024 && growth < totalRamBytes * 0.05) {
      continue;
    }
    insights.push({
      id: `leak-${pid}`,
      title: "Probable memory leak",
      summary: `${points[0].sample.processName} grew by ${Math.round(growth / 1024 / 1024)} MB across the active monitor window.`,
      severity: growth >= 1024 * 1024 * 1024 ? "high" : "medium",
      processName: points[0].sample.processName,
      bytes: growth,
      confidence: Math.min(0.95, 0.55 + points.length * 0.05)
    });
  }
  return insights;
}

export class MemoryAnalyzer {
  analyze(
    currentFrame: ProcessProfilerFrame,
    totalRamBytes: number,
    historyFrames: ProcessProfilerFrame[] = []
  ): { summary: SystemSnapshot["memory"]; insights: MemoryInsight[] } {
    const usedPct = currentFrame.counters.ramUsedPct;
    const usedBytes = Math.round((totalRamBytes * usedPct) / 100);
    const topProcesses = currentFrame.memoryHogs.slice(0, 8);
    const insights: MemoryInsight[] = topProcesses.slice(0, 5).map((item, index) => ({
      id: `memory-${item.pid}-${index}`,
      title: "High memory consumer",
      summary: `${item.processName} is using ${Math.round(Number(item.workingSetBytes ?? 0) / 1024 / 1024)} MB of RAM.`,
      severity: Number(item.workingSetBytes ?? 0) >= 2 * 1024 * 1024 * 1024 ? "high" : "medium",
      processName: item.processName,
      bytes: item.workingSetBytes
    }));

    return {
      summary: {
        usedBytes,
        usedPct,
        availableBytes: Math.max(0, totalRamBytes - usedBytes),
        topProcesses
      },
      insights: [...insights, ...buildLeakCandidates(historyFrames, totalRamBytes)]
    };
  }
}
