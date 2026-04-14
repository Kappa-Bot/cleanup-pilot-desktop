import { StateCreator } from "zustand";
import { OptimizationChangeRecord, SystemSnapshotHistoryPoint } from "../../types";

export interface HistorySlice {
  historySnapshots: SystemSnapshotHistoryPoint[];
  optimizationHistory: OptimizationChangeRecord[];
  historyLoading: boolean;
  historyError: string;
  historyLastLoadedAt: number;
  loadHistory: (force?: boolean) => Promise<void>;
}

const HISTORY_CACHE_TTL_MS = 60 * 1000;
let historyLoadInFlight: Promise<void> | null = null;

export const createHistorySlice: StateCreator<HistorySlice, [], [], HistorySlice> = (set, get) => ({
  historySnapshots: [],
  optimizationHistory: [],
  historyLoading: false,
  historyError: "",
  historyLastLoadedAt: 0,
  loadHistory: async (force = false) => {
    if (historyLoadInFlight) {
      return historyLoadInFlight;
    }
    const current = get();
    if (
      !force &&
      (current.historySnapshots.length > 0 || current.optimizationHistory.length > 0) &&
      current.historyLastLoadedAt > 0 &&
      Date.now() - current.historyLastLoadedAt < HISTORY_CACHE_TTL_MS
    ) {
      return;
    }
    set({ historyLoading: true, historyError: "" });
    historyLoadInFlight = (async () => {
      try {
        const [snapshots, optimizationHistory] = await Promise.all([
          window.desktopApi.listDiagnosticsHistory(200),
          window.desktopApi.listOptimizationHistory(200)
        ]);
        set({
          historySnapshots: snapshots.snapshots,
          optimizationHistory: optimizationHistory.changes,
          historyLoading: false,
          historyError: "",
          historyLastLoadedAt: Date.now()
        });
      } catch (error) {
        set({
          historyLoading: false,
          historyError: error instanceof Error ? error.message : "Could not load history."
        });
      } finally {
        historyLoadInFlight = null;
      }
    })();
    return historyLoadInFlight;
  }
});
