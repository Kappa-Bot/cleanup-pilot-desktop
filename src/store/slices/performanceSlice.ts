import { StateCreator } from "zustand";
import {
  CapabilityFlags,
  DriverPerformanceSummary,
  LivePerformanceFrame,
  PerformanceSessionSummary,
  SystemSnapshot
} from "../../types";

export interface PerformanceSlice {
  isMonitoring: boolean;
  performanceLoading: boolean;
  performanceError: string;
  monitorSessionId: string;
  monitorSampleIntervalMs: number;
  monitorRestartCount: number;
  monitorDroppedFrameCount: number;
  monitorLastGapMs: number;
  monitorAverageGapMs: number;
  monitorMaxGapMs: number;
  monitorGapSamples: number;
  monitorSyncCount: number;
  monitorLastSyncAt: number;
  monitorLastSyncAddedFrames: number;
  monitorCapabilities: CapabilityFlags | null;
  performanceFrames: LivePerformanceFrame[];
  latestPerformanceFrame: LivePerformanceFrame | null;
  lastPerformanceFrameAt: number;
  performanceSummary: PerformanceSessionSummary | null;
  latestSnapshot: SystemSnapshot | null;
  driverPerformanceSummary: DriverPerformanceSummary | null;
  driverPerformanceLastLoadedAt: number;
  startMonitoring: (sampleIntervalMs?: number) => Promise<void>;
  recoverMonitoring: (sampleIntervalMs?: number) => Promise<void>;
  stopMonitoring: () => Promise<void>;
  syncMonitoringSession: () => Promise<void>;
  captureSnapshot: (source: SystemSnapshot["source"]) => Promise<void>;
  loadDriverPerformance: (force?: boolean) => Promise<void>;
  resetPerformanceState: () => void;
}

let unsubscribePerformanceFrames: (() => void) | null = null;
let monitorSyncInFlight: Promise<void> | null = null;
let driverPerformanceInFlight: Promise<void> | null = null;
const FRAME_RETENTION_WINDOW_MS = 5 * 60 * 1000;
const DRIVER_PERFORMANCE_CACHE_TTL_MS = 15 * 1000;

function trimFrames(frames: LivePerformanceFrame[]): LivePerformanceFrame[] {
  if (!frames.length) {
    return frames;
  }
  const newestCapturedAt = frames[frames.length - 1]?.capturedAt ?? 0;
  const minCapturedAt = Math.max(0, newestCapturedAt - FRAME_RETENTION_WINDOW_MS);
  if (!minCapturedAt) {
    return frames;
  }
  let startIndex = 0;
  while (startIndex < frames.length && frames[startIndex].capturedAt < minCapturedAt) {
    startIndex += 1;
  }
  return startIndex <= 0 ? frames : frames.slice(startIndex);
}

function appendFrame(currentFrames: LivePerformanceFrame[], incomingFrame: LivePerformanceFrame): {
  frames: LivePerformanceFrame[];
  droppedFrame: boolean;
  replacedFrame: boolean;
} {
  if (!currentFrames.length) {
    return { frames: [incomingFrame], droppedFrame: false, replacedFrame: false };
  }

  const last = currentFrames[currentFrames.length - 1];
  if (incomingFrame.capturedAt > last.capturedAt) {
    return {
      frames: trimFrames([...currentFrames, incomingFrame]),
      droppedFrame: false,
      replacedFrame: false
    };
  }

  if (incomingFrame.capturedAt === last.capturedAt) {
    const next = [...currentFrames];
    next[next.length - 1] = incomingFrame;
    return { frames: next, droppedFrame: false, replacedFrame: true };
  }

  // Rare out-of-order sample. Insert sorted and keep one item per timestamp.
  const next = [...currentFrames];
  let insertIndex = next.findIndex((frame) => frame.capturedAt >= incomingFrame.capturedAt);
  if (insertIndex < 0) {
    insertIndex = next.length;
  }
  if (next[insertIndex]?.capturedAt === incomingFrame.capturedAt) {
    next[insertIndex] = incomingFrame;
    return { frames: trimFrames(next), droppedFrame: false, replacedFrame: true };
  }
  next.splice(insertIndex, 0, incomingFrame);
  return { frames: trimFrames(next), droppedFrame: true, replacedFrame: false };
}

export const createPerformanceSlice: StateCreator<PerformanceSlice, [], [], PerformanceSlice> = (set, get) => ({
  isMonitoring: false,
  performanceLoading: false,
  performanceError: "",
  monitorSessionId: "",
  monitorSampleIntervalMs: 0,
  monitorRestartCount: 0,
  monitorDroppedFrameCount: 0,
  monitorLastGapMs: 0,
  monitorAverageGapMs: 0,
  monitorMaxGapMs: 0,
  monitorGapSamples: 0,
  monitorSyncCount: 0,
  monitorLastSyncAt: 0,
  monitorLastSyncAddedFrames: 0,
  monitorCapabilities: null,
  performanceFrames: [],
  latestPerformanceFrame: null,
  lastPerformanceFrameAt: 0,
  performanceSummary: null,
  latestSnapshot: null,
  driverPerformanceSummary: null,
  driverPerformanceLastLoadedAt: 0,
  startMonitoring: async (sampleIntervalMs) => {
    const requestedInterval = Math.max(500, sampleIntervalMs ?? 2_000);
    const current = get();
    if (current.performanceLoading) {
      return;
    }

    if (current.isMonitoring) {
      if (current.monitorSampleIntervalMs === requestedInterval && current.monitorSessionId) {
        return;
      }

      if (current.monitorSessionId) {
        try {
          await window.desktopApi.stopPerformanceMonitor(current.monitorSessionId);
        } catch {
          // If stopping fails, we still reset local state and restart.
        }
      }

      if (unsubscribePerformanceFrames) {
        unsubscribePerformanceFrames();
        unsubscribePerformanceFrames = null;
      }
      set({
        isMonitoring: false,
        monitorSessionId: "",
        monitorSampleIntervalMs: 0,
        monitorDroppedFrameCount: 0,
        monitorLastGapMs: 0,
        monitorAverageGapMs: 0,
        monitorMaxGapMs: 0,
        monitorGapSamples: 0,
        monitorSyncCount: 0,
        monitorLastSyncAt: 0,
        monitorLastSyncAddedFrames: 0,
        latestPerformanceFrame: null,
        lastPerformanceFrameAt: 0
      });
    }

    if (unsubscribePerformanceFrames) {
      unsubscribePerformanceFrames();
      unsubscribePerformanceFrames = null;
    }
    set({
      performanceLoading: true,
      performanceError: "",
      performanceSummary: null
    });
    let activeSessionId = "";
    unsubscribePerformanceFrames = window.desktopApi.onPerformanceFrame((frame) => {
      if (!activeSessionId || frame.sessionId !== activeSessionId) {
        return;
      }
      set((state) => {
        const lastFrame = state.latestPerformanceFrame;
        const gapMs =
          lastFrame && frame.capturedAt > lastFrame.capturedAt
            ? frame.capturedAt - lastFrame.capturedAt
            : 0;
        const nextGapSamples = gapMs > 0 ? state.monitorGapSamples + 1 : state.monitorGapSamples;
        const nextAverageGapMs =
          gapMs > 0
            ? (state.monitorAverageGapMs * state.monitorGapSamples + gapMs) / nextGapSamples
            : state.monitorAverageGapMs;
        const merged = appendFrame(state.performanceFrames, frame);
        const latestMergedFrame = merged.frames[merged.frames.length - 1] ?? frame;
        return {
          performanceFrames: merged.frames,
          latestPerformanceFrame: latestMergedFrame,
          lastPerformanceFrameAt: latestMergedFrame.capturedAt,
          monitorLastGapMs: gapMs > 0 ? gapMs : state.monitorLastGapMs,
          monitorAverageGapMs: nextAverageGapMs,
          monitorMaxGapMs: gapMs > 0 ? Math.max(state.monitorMaxGapMs, gapMs) : state.monitorMaxGapMs,
          monitorGapSamples: nextGapSamples,
          monitorDroppedFrameCount: merged.droppedFrame
            ? state.monitorDroppedFrameCount + 1
            : state.monitorDroppedFrameCount
        };
      });
    });

    try {
      const response = await window.desktopApi.startPerformanceMonitor(requestedInterval);
      activeSessionId = response.sessionId;
      const currentSession = await window.desktopApi.getCurrentPerformanceSession(response.sessionId).catch(() => null);
      const latestFrame =
        currentSession?.frames && currentSession.frames.length
          ? currentSession.frames[currentSession.frames.length - 1]
          : null;
      set({
        isMonitoring: true,
        performanceLoading: false,
        monitorSessionId: response.sessionId,
        monitorSampleIntervalMs: requestedInterval,
        monitorDroppedFrameCount: 0,
        monitorLastGapMs: 0,
        monitorAverageGapMs: 0,
        monitorMaxGapMs: 0,
        monitorGapSamples: 0,
        monitorSyncCount: 0,
        monitorLastSyncAt: 0,
        monitorLastSyncAddedFrames: 0,
        monitorCapabilities: response.capabilities,
        performanceFrames: trimFrames(currentSession?.frames ?? []),
        latestPerformanceFrame: latestFrame,
        lastPerformanceFrameAt: latestFrame?.capturedAt ?? 0,
        performanceSummary: currentSession?.summary ?? null,
        performanceError: ""
      });
    } catch (error) {
      if (unsubscribePerformanceFrames) {
        unsubscribePerformanceFrames();
        unsubscribePerformanceFrames = null;
      }
      set({
        isMonitoring: false,
        performanceLoading: false,
        performanceError: error instanceof Error ? error.message : "Performance monitor could not start.",
        monitorDroppedFrameCount: 0,
        monitorLastGapMs: 0,
        monitorAverageGapMs: 0,
        monitorMaxGapMs: 0,
        monitorGapSamples: 0,
        monitorSyncCount: 0,
        monitorLastSyncAt: 0,
        monitorLastSyncAddedFrames: 0,
        latestPerformanceFrame: null,
        lastPerformanceFrameAt: 0
      });
    }
  },
  recoverMonitoring: async (sampleIntervalMs) => {
    const requestedInterval = sampleIntervalMs ?? get().monitorSampleIntervalMs ?? 2_000;
    const effectiveInterval = Math.max(500, requestedInterval);
    set((state) => ({
      monitorRestartCount: state.monitorRestartCount + 1
    }));
    await get().stopMonitoring();
    await get().startMonitoring(effectiveInterval);
  },
  syncMonitoringSession: async () => {
    const state = get();
    const sessionId = state.monitorSessionId;
    if (!sessionId || state.performanceLoading) {
      return;
    }

    if (monitorSyncInFlight) {
      await monitorSyncInFlight;
      return;
    }

    monitorSyncInFlight = (async () => {
      try {
        const currentSession = await window.desktopApi.getCurrentPerformanceSession(sessionId);
        set((current) => {
          const syncAt = Date.now();
          const nextSyncCount = current.monitorSyncCount + 1;
          const incomingFrames = current.lastPerformanceFrameAt
            ? currentSession.frames.filter((item) => item.capturedAt > current.lastPerformanceFrameAt)
            : currentSession.frames;
          if (!incomingFrames.length) {
            return {
              performanceSummary: currentSession.summary,
              performanceError: "",
              monitorSyncCount: nextSyncCount,
              monitorLastSyncAt: syncAt,
              monitorLastSyncAddedFrames: 0
            };
          }

          let frames = current.performanceFrames;
          let latestFrame = current.latestPerformanceFrame;
          let lastFrameAt = current.lastPerformanceFrameAt;
          let averageGapMs = current.monitorAverageGapMs;
          let gapSamples = current.monitorGapSamples;
          let lastGapMs = current.monitorLastGapMs;
          let maxGapMs = current.monitorMaxGapMs;
          let dropped = current.monitorDroppedFrameCount;

          for (const incoming of incomingFrames) {
            const merged = appendFrame(frames, incoming);
            frames = merged.frames;
            if (merged.droppedFrame) {
              dropped += 1;
            }
            const mergedLatest = frames[frames.length - 1] ?? incoming;
            if (latestFrame && mergedLatest.capturedAt > latestFrame.capturedAt) {
              const gapMs = mergedLatest.capturedAt - latestFrame.capturedAt;
              if (gapMs > 0) {
                const nextSamples = gapSamples + 1;
                averageGapMs = (averageGapMs * gapSamples + gapMs) / nextSamples;
                gapSamples = nextSamples;
                lastGapMs = gapMs;
                maxGapMs = Math.max(maxGapMs, gapMs);
              }
            }
            latestFrame = mergedLatest;
            lastFrameAt = mergedLatest.capturedAt;
          }

          return {
            performanceFrames: frames,
            latestPerformanceFrame: latestFrame,
            lastPerformanceFrameAt: lastFrameAt,
            monitorAverageGapMs: averageGapMs,
            monitorGapSamples: gapSamples,
            monitorLastGapMs: lastGapMs,
            monitorMaxGapMs: maxGapMs,
            monitorDroppedFrameCount: dropped,
            performanceSummary: currentSession.summary,
            performanceError: "",
            monitorSyncCount: nextSyncCount,
            monitorLastSyncAt: syncAt,
            monitorLastSyncAddedFrames: incomingFrames.length
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Performance session sync failed.";
        set((current) => {
          if (!current.monitorSessionId) {
            return {};
          }
          if (/not found/i.test(message)) {
            if (unsubscribePerformanceFrames) {
              unsubscribePerformanceFrames();
              unsubscribePerformanceFrames = null;
            }
            return {
              isMonitoring: false,
              performanceLoading: false,
              monitorSessionId: "",
              monitorSampleIntervalMs: 0,
              monitorSyncCount: 0,
              monitorLastSyncAt: 0,
              monitorLastSyncAddedFrames: 0,
              monitorMaxGapMs: 0,
              performanceError: "Performance session ended. Start monitor again.",
              latestPerformanceFrame: null,
              lastPerformanceFrameAt: 0
            };
          }
          return {
            performanceError: message
          };
        });
      } finally {
        monitorSyncInFlight = null;
      }
    })();

    await monitorSyncInFlight;
  },
  stopMonitoring: async () => {
    const sessionId = get().monitorSessionId;
    if (!sessionId) {
      if (unsubscribePerformanceFrames) {
        unsubscribePerformanceFrames();
        unsubscribePerformanceFrames = null;
      }
      set({
        isMonitoring: false,
        performanceLoading: false,
        monitorSessionId: "",
        monitorSampleIntervalMs: 0,
        monitorDroppedFrameCount: 0,
        monitorLastGapMs: 0,
        monitorAverageGapMs: 0,
        monitorMaxGapMs: 0,
        monitorGapSamples: 0,
        monitorSyncCount: 0,
        monitorLastSyncAt: 0,
        monitorLastSyncAddedFrames: 0,
        latestPerformanceFrame: null,
        lastPerformanceFrameAt: 0
      });
      return;
    }
    set({ performanceLoading: true });
    try {
      const response = await window.desktopApi.stopPerformanceMonitor(sessionId);
      set({
        isMonitoring: false,
        performanceLoading: false,
        performanceSummary: response.summary,
        monitorSessionId: "",
        monitorSampleIntervalMs: 0,
        monitorDroppedFrameCount: 0,
        monitorLastGapMs: 0,
        monitorAverageGapMs: 0,
        monitorMaxGapMs: 0,
        monitorGapSamples: 0,
        monitorSyncCount: 0,
        monitorLastSyncAt: 0,
        monitorLastSyncAddedFrames: 0,
        latestPerformanceFrame: null,
        lastPerformanceFrameAt: 0,
        performanceError: ""
      });
    } catch (error) {
      set({
        isMonitoring: false,
        performanceLoading: false,
        monitorSessionId: "",
        monitorSampleIntervalMs: 0,
        monitorDroppedFrameCount: 0,
        monitorLastGapMs: 0,
        monitorAverageGapMs: 0,
        monitorMaxGapMs: 0,
        monitorGapSamples: 0,
        monitorSyncCount: 0,
        monitorLastSyncAt: 0,
        monitorLastSyncAddedFrames: 0,
        latestPerformanceFrame: null,
        lastPerformanceFrameAt: 0,
        performanceError: error instanceof Error ? error.message : "Performance monitor stop failed."
      });
    }
    if (unsubscribePerformanceFrames) {
      unsubscribePerformanceFrames();
      unsubscribePerformanceFrames = null;
    }
  },
  captureSnapshot: async (source) => {
    try {
      const response = await window.desktopApi.captureDiagnosticsSnapshot(source);
      set({
        latestSnapshot: response.snapshot,
        performanceError: ""
      });
    } catch (error) {
      set({
        performanceError: error instanceof Error ? error.message : "Snapshot capture failed."
      });
    }
  },
  loadDriverPerformance: async (force = false) => {
    if (driverPerformanceInFlight) {
      return driverPerformanceInFlight;
    }
    const current = get();
    if (
      !force &&
      current.driverPerformanceSummary &&
      current.driverPerformanceLastLoadedAt > 0 &&
      Date.now() - current.driverPerformanceLastLoadedAt < DRIVER_PERFORMANCE_CACHE_TTL_MS
    ) {
      return;
    }
    driverPerformanceInFlight = (async () => {
      try {
        const response = await window.desktopApi.scanDriverPerformance();
        set({
          driverPerformanceSummary: response.summary,
          driverPerformanceLastLoadedAt: Date.now(),
          performanceError: ""
        });
      } catch (error) {
        set({
          performanceError: error instanceof Error ? error.message : "Driver diagnostics failed."
        });
      } finally {
        driverPerformanceInFlight = null;
      }
    })();
    return driverPerformanceInFlight;
  },
  resetPerformanceState: () =>
    set({
      performanceLoading: false,
      performanceError: "",
      performanceFrames: [],
      latestPerformanceFrame: null,
      lastPerformanceFrameAt: 0,
      performanceSummary: null,
      latestSnapshot: null,
      monitorSessionId: "",
      monitorSampleIntervalMs: 0,
      monitorRestartCount: 0,
      monitorDroppedFrameCount: 0,
      monitorLastGapMs: 0,
      monitorAverageGapMs: 0,
      monitorMaxGapMs: 0,
      monitorGapSamples: 0,
      monitorSyncCount: 0,
      monitorLastSyncAt: 0,
      monitorLastSyncAddedFrames: 0,
      driverPerformanceLastLoadedAt: 0
    })
});
