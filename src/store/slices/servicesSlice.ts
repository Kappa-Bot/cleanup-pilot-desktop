import { StateCreator } from "zustand";
import { OptimizationActionSuggestion, ServiceAnalysisSummary, ServiceDiagnostic } from "../../types";

export interface ServicesSlice {
  serviceItems: ServiceDiagnostic[];
  servicesSummary: ServiceAnalysisSummary | null;
  serviceActions: OptimizationActionSuggestion[];
  servicesLoading: boolean;
  servicesError: string;
  servicesLastLoadedAt: number;
  loadServices: (force?: boolean) => Promise<void>;
}

const SERVICES_CACHE_TTL_MS = 60 * 1000;
let servicesLoadInFlight: Promise<void> | null = null;

export const createServicesSlice: StateCreator<ServicesSlice, [], [], ServicesSlice> = (set, get) => ({
  serviceItems: [],
  servicesSummary: null,
  serviceActions: [],
  servicesLoading: false,
  servicesError: "",
  servicesLastLoadedAt: 0,
  loadServices: async (force = false) => {
    if (servicesLoadInFlight) {
      return servicesLoadInFlight;
    }
    const current = get();
    if (
      !force &&
      current.serviceItems.length > 0 &&
      current.servicesLastLoadedAt > 0 &&
      Date.now() - current.servicesLastLoadedAt < SERVICES_CACHE_TTL_MS
    ) {
      return;
    }
    set({ servicesLoading: true, servicesError: "" });
    servicesLoadInFlight = (async () => {
      try {
        const response = await window.desktopApi.scanServices();
        set({
          serviceItems: response.services,
          servicesSummary: response.summary,
          serviceActions: response.suggestedActions,
          servicesLoading: false,
          servicesError: "",
          servicesLastLoadedAt: Date.now()
        });
      } catch (error) {
        set({
          servicesLoading: false,
          servicesError: error instanceof Error ? error.message : "Service scan failed."
        });
      } finally {
        servicesLoadInFlight = null;
      }
    })();
    return servicesLoadInFlight;
  }
});
