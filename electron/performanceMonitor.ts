import { randomUUID } from "crypto";
import { AppDatabase } from "./db";
import { CapabilityFlags, LivePerformanceFrame, PerformanceSessionSummary } from "./types";
import { PerformanceSampler } from "./performanceSampler";

interface MonitorSession {
  id: string;
  sampleIntervalMs: number;
  maxFrames: number;
  frames: LivePerformanceFrame[];
  startedAt: number;
  unsubscribe?: () => void;
}

interface PerformanceMonitorDependencies {
  db: AppDatabase;
  sampler?: PerformanceSampler;
}

const MONITOR_FRAME_TOP_PROCESS_LIMIT = 32;

function summarize(session: MonitorSession): PerformanceSessionSummary {
  const frames = session.frames;
  const avg = (selector: (frame: LivePerformanceFrame) => number | undefined) => {
    const values = frames.map(selector).filter((item): item is number => item !== undefined);
    return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : 0;
  };
  const peak = (selector: (frame: LivePerformanceFrame) => number | undefined) => {
    const values = frames.map(selector).filter((item): item is number => item !== undefined);
    return values.length ? Math.max(...values) : 0;
  };

  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: frames[frames.length - 1]?.capturedAt ?? Date.now(),
    sampleIntervalMs: session.sampleIntervalMs,
    frameCount: frames.length,
    avgCpuUsagePct: avg((frame) => frame.cpuUsagePct),
    avgRamUsagePct: avg((frame) => frame.ramUsedPct),
    avgDiskActivePct: avg((frame) => frame.diskActivePct),
    peakCpuUsagePct: peak((frame) => frame.cpuUsagePct),
    peakRamUsagePct: peak((frame) => frame.ramUsedPct),
    peakDiskActivePct: peak((frame) => frame.diskActivePct),
    peakGpuUsagePct: peak((frame) => frame.gpuUsagePct)
  };
}

export class PerformanceMonitor {
  private readonly db: AppDatabase;
  private readonly sampler: PerformanceSampler;
  private readonly sessions = new Map<string, MonitorSession>();

  private pushFrame(session: MonitorSession, frame: LivePerformanceFrame): void {
    session.frames.push(frame);
    if (session.frames.length > session.maxFrames) {
      session.frames.splice(0, session.frames.length - session.maxFrames);
    }
  }

  constructor(dependencies: PerformanceMonitorDependencies) {
    this.db = dependencies.db;
    this.sampler = dependencies.sampler ?? new PerformanceSampler();
  }

  async start(
    sampleIntervalMs = 2_000,
    onFrame?: (frame: LivePerformanceFrame) => void
  ): Promise<{ sessionId: string; capabilities: CapabilityFlags }> {
    if (this.sessions.size >= 3) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.startedAt - right.startedAt)[0];
      if (oldest) {
        try {
          this.stop(oldest.id);
        } catch {
          // Best-effort stale session cleanup.
        }
      }
    }

    const sessionId = randomUUID();
    const capabilities = await this.sampler.getCapabilities();
    const session: MonitorSession = {
      id: sessionId,
      sampleIntervalMs: Math.max(500, sampleIntervalMs),
      maxFrames: Math.max(32, Math.ceil((5 * 60 * 1000) / Math.max(500, sampleIntervalMs))),
      frames: [],
      startedAt: Date.now()
    };

    this.sessions.set(sessionId, session);
    session.unsubscribe = this.sampler.subscribe(
      sessionId,
      session.sampleIntervalMs,
      (frame) => {
        const liveFrame: LivePerformanceFrame = {
          sessionId,
          capturedAt: frame.capturedAt,
          cpuUsagePct: frame.cpuUsagePct,
          ramUsedPct: frame.ramUsedPct,
          diskActivePct: frame.diskActivePct,
          gpuUsagePct: frame.gpuUsagePct,
          networkSendBytesPerSec: frame.networkSendBytesPerSec,
          networkReceiveBytesPerSec: frame.networkReceiveBytesPerSec,
          topProcesses: frame.topProcesses.slice(0, MONITOR_FRAME_TOP_PROCESS_LIMIT)
        };
        this.pushFrame(session, liveFrame);
        onFrame?.(liveFrame);
      }
    );
    await this.sampler.prime();

    return { sessionId, capabilities };
  }

  current(sessionId: string): { frames: LivePerformanceFrame[]; summary: PerformanceSessionSummary } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Performance session not found.");
    }
    return {
      frames: [...session.frames],
      summary: summarize(session)
    };
  }

  stop(sessionId: string): { ok: true; summary: PerformanceSessionSummary } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Performance session not found.");
    }
    session.unsubscribe?.();
    const summary = summarize(session);
    this.db.addPerformanceSession(summary);
    this.sessions.delete(sessionId);
    return { ok: true, summary };
  }
}
