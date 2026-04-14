import { ProcessProfiler, RawProcessProfilerSnapshot } from "./processProfiler";
import { CapabilityFlags, LivePerformanceFrame } from "./types";
import { probeCapabilities } from "./windowsSources/capabilityProbe";

type SharedFrame = Omit<LivePerformanceFrame, "sessionId">;

interface SamplerListener {
  id: string;
  sampleIntervalMs: number;
  lastDeliveredAt: number;
  onFrame: (frame: SharedFrame) => void;
}

interface CapabilityCache {
  value: CapabilityFlags;
  cachedAt: number;
}

interface PerformanceSamplerDependencies {
  processProfiler?: ProcessProfiler;
}

const CAPABILITY_CACHE_TTL_MS = 30_000;
const TOP_PROCESS_LIMIT = 32;

export class PerformanceSampler {
  private readonly processProfiler: ProcessProfiler;
  private readonly listeners = new Map<string, SamplerListener>();
  private timer: NodeJS.Timeout | null = null;
  private sampling = false;
  private latestRaw: RawProcessProfilerSnapshot | null = null;
  private latestFrame: SharedFrame | null = null;
  private capabilityCache: CapabilityCache | null = null;

  constructor(dependencies: PerformanceSamplerDependencies = {}) {
    this.processProfiler = dependencies.processProfiler ?? new ProcessProfiler();
  }

  async getCapabilities(): Promise<CapabilityFlags> {
    if (this.capabilityCache && Date.now() - this.capabilityCache.cachedAt < CAPABILITY_CACHE_TTL_MS) {
      return this.capabilityCache.value;
    }
    const value = await probeCapabilities();
    this.capabilityCache = {
      value,
      cachedAt: Date.now()
    };
    return value;
  }

  getLatestFrame(): SharedFrame | null {
    return this.latestFrame ? { ...this.latestFrame, topProcesses: [...this.latestFrame.topProcesses] } : null;
  }

  subscribe(
    id: string,
    sampleIntervalMs: number,
    onFrame: (frame: SharedFrame) => void,
    replayLatest = true
  ): () => void {
    this.listeners.set(id, {
      id,
      sampleIntervalMs: Math.max(500, sampleIntervalMs),
      lastDeliveredAt: 0,
      onFrame
    });

    if (replayLatest && this.latestFrame) {
      const listener = this.listeners.get(id);
      if (listener) {
        listener.lastDeliveredAt = this.latestFrame.capturedAt;
        listener.onFrame(this.cloneFrame(this.latestFrame));
      }
    }

    this.ensureLoop();
    return () => {
      this.listeners.delete(id);
      if (!this.listeners.size) {
        this.stopLoop();
      }
    };
  }

  updateListenerInterval(id: string, sampleIntervalMs: number): void {
    const listener = this.listeners.get(id);
    if (!listener) {
      return;
    }
    listener.sampleIntervalMs = Math.max(500, sampleIntervalMs);
    this.ensureLoop();
  }

  async prime(): Promise<SharedFrame | null> {
    if (this.latestFrame) {
      return this.cloneFrame(this.latestFrame);
    }
    await this.collectNow();
    return this.latestFrame ? this.cloneFrame(this.latestFrame) : null;
  }

  private cloneFrame(frame: SharedFrame): SharedFrame {
    return {
      ...frame,
      topProcesses: [...frame.topProcesses]
    };
  }

  private minimumIntervalMs(): number {
    if (!this.listeners.size) {
      return 2_000;
    }
    return Math.max(
      500,
      Math.min(...[...this.listeners.values()].map((listener) => listener.sampleIntervalMs))
    );
  }

  private scheduleNextTick(): void {
    if (!this.listeners.size) {
      this.stopLoop();
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.collectNow();
    }, this.minimumIntervalMs());
  }

  private stopLoop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private ensureLoop(): void {
    if (!this.listeners.size) {
      this.stopLoop();
      return;
    }
    if (!this.timer && !this.sampling) {
      this.scheduleNextTick();
    }
  }

  private deliver(frame: SharedFrame): void {
    for (const listener of this.listeners.values()) {
      if (
        listener.lastDeliveredAt &&
        frame.capturedAt - listener.lastDeliveredAt < Math.max(500, listener.sampleIntervalMs * 0.9)
      ) {
        continue;
      }
      listener.lastDeliveredAt = frame.capturedAt;
      listener.onFrame(this.cloneFrame(frame));
    }
  }

  async collectNow(): Promise<void> {
    if (this.sampling) {
      return;
    }
    this.sampling = true;
    try {
      const current = await this.processProfiler.captureRawSnapshot();
      const frame = this.processProfiler.buildFrame(current, this.latestRaw ?? undefined);
      this.latestRaw = current;
      this.latestFrame = {
        capturedAt: frame.capturedAt,
        cpuUsagePct: frame.counters.cpuUsagePct,
        ramUsedPct: frame.counters.ramUsedPct,
        diskActivePct: frame.counters.diskActivePct,
        gpuUsagePct: frame.counters.gpuUsagePct,
        networkSendBytesPerSec: frame.counters.networkSendBytesPerSec,
        networkReceiveBytesPerSec: frame.counters.networkReceiveBytesPerSec,
        topProcesses: frame.topProcesses.slice(0, TOP_PROCESS_LIMIT)
      };
      this.deliver(this.latestFrame);
    } finally {
      this.sampling = false;
      this.scheduleNextTick();
    }
  }
}
