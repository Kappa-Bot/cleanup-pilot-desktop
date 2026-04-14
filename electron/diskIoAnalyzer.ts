import { CleanupCategory, DiskIoInsight, IoBurstEvent, ProcessSample, SystemSnapshot } from "./types";
import { ProcessProfilerFrame } from "./processProfiler";

const KNOWN_CACHE_PROCESS_PATTERNS: Array<{ match: RegExp; category: CleanupCategory; label: string }> = [
  { match: /shader|directx|nvidia|amd|intel/i, category: "cache", label: "shader cache activity" },
  { match: /log|launcher|updater/i, category: "logs", label: "log or updater churn" },
  { match: /minecraft|curseforge|modrinth/i, category: "minecraft_leftovers", label: "launcher/game cache churn" }
];

function toBurst(process: ProcessSample, capturedAt: number): IoBurstEvent {
  return {
    startedAt: capturedAt,
    durationMs: 2_000,
    processName: process.processName,
    pid: process.pid,
    writeBytesPerSec: Number(process.diskWriteBytesPerSec ?? 0),
    readBytesPerSec: Number(process.diskReadBytesPerSec ?? 0)
  };
}

export class DiskIoAnalyzer {
  analyze(frame: ProcessProfilerFrame): { summary: SystemSnapshot["diskIo"]; insights: DiskIoInsight[] } {
    const topWriters = frame.diskWriters.slice(0, 8);
    const bursts = topWriters
      .filter((item) => Number(item.diskWriteBytesPerSec ?? 0) >= 8 * 1024 * 1024)
      .map((item) => toBurst(item, frame.capturedAt));

    const insights: DiskIoInsight[] = topWriters.slice(0, 5).map((item, index) => {
      const matchedPattern = KNOWN_CACHE_PROCESS_PATTERNS.find((entry) => entry.match.test(item.processName));
      return {
        id: `disk-${item.pid}-${index}`,
        title: matchedPattern ? `Possible ${matchedPattern.label}` : "High disk writer detected",
        summary: `${item.processName} is writing ${Math.round(Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024)} MB/s.`,
        severity: Number(item.diskWriteBytesPerSec ?? 0) >= 25 * 1024 * 1024 ? "high" : "medium",
        processName: item.processName,
        bytesPerSec: item.diskWriteBytesPerSec,
        linkedCategory: matchedPattern?.category
      };
    });

    return {
      summary: {
        activeTimePct: frame.counters.diskActivePct,
        queueDepth: frame.counters.diskQueueDepth,
        topWriters,
        burstEvents: bursts
      },
      insights
    };
  }
}
