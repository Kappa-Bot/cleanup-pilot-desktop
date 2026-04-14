import { StateCreator } from "zustand";
import { OptimizationActionSuggestion, StartupAnalysisSummary, StartupEntry } from "../../types";

export interface StartupSlice {
  startupEntries: StartupEntry[];
  startupSummary: StartupAnalysisSummary | null;
  startupActions: OptimizationActionSuggestion[];
  startupLoading: boolean;
  startupError: string;
  startupLastLoadedAt: number;
  loadStartup: (force?: boolean) => Promise<void>;
}

const STARTUP_CACHE_TTL_MS = 60 * 1000;
let startupLoadInFlight: Promise<void> | null = null;

export const createStartupSlice: StateCreator<StartupSlice, [], [], StartupSlice> = (set, get) => ({
  startupEntries: [],
  startupSummary: null,
  startupActions: [],
  startupLoading: false,
  startupError: "",
  startupLastLoadedAt: 0,
  loadStartup: async (force = false) => {
    if (startupLoadInFlight) {
      return startupLoadInFlight;
    }
    const current = get();
    if (
      !force &&
      current.startupEntries.length > 0 &&
      current.startupLastLoadedAt > 0 &&
      Date.now() - current.startupLastLoadedAt < STARTUP_CACHE_TTL_MS
    ) {
      return;
    }
    set({ startupLoading: true, startupError: "" });
    startupLoadInFlight = (async () => {
      try {
        const response = await window.desktopApi.scanStartup();
        set({
          startupEntries: response.entries,
          startupSummary: response.summary,
          startupActions: response.suggestedActions,
          startupLoading: false,
          startupError: "",
          startupLastLoadedAt: Date.now()
        });
      } catch (error) {
        set({
          startupLoading: false,
          startupError: error instanceof Error ? error.message : "Startup scan failed."
        });
      } finally {
        startupLoadInFlight = null;
      }
    })();
    return startupLoadInFlight;
  }
});
