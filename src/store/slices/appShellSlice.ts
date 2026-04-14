import { StateCreator } from "zustand";

export type PerformanceViewKey = "dashboard" | "startup" | "processes" | "services" | "tasks" | "doctor" | "history";

export interface AppShellSlice {
  activePerformanceView: PerformanceViewKey;
  setActivePerformanceView: (view: PerformanceViewKey) => void;
}

export const createAppShellSlice: StateCreator<AppShellSlice, [], [], AppShellSlice> = (set) => ({
  activePerformanceView: "dashboard",
  setActivePerformanceView: (view) => set({ activePerformanceView: view })
});
