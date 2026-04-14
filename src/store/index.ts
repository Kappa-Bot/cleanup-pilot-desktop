import { create } from "zustand";
import { AppShellSlice, createAppShellSlice } from "./slices/appShellSlice";
import { CleanupSlice, createCleanupSlice } from "./slices/cleanupSlice";
import { DoctorSlice, createDoctorSlice } from "./slices/doctorSlice";
import { DriversSlice, createDriversSlice } from "./slices/driversSlice";
import { HistorySlice, createHistorySlice } from "./slices/historySlice";
import { PerformanceSlice, createPerformanceSlice } from "./slices/performanceSlice";
import { ScanSlice, createScanSlice } from "./slices/scanSlice";
import { ServicesSlice, createServicesSlice } from "./slices/servicesSlice";
import { StartupSlice, createStartupSlice } from "./slices/startupSlice";
import { TasksSlice, createTasksSlice } from "./slices/tasksSlice";

export type AppStore = AppShellSlice &
  ScanSlice &
  CleanupSlice &
  DriversSlice &
  PerformanceSlice &
  StartupSlice &
  ServicesSlice &
  TasksSlice &
  DoctorSlice &
  HistorySlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createAppShellSlice(...args),
  ...createScanSlice(...args),
  ...createCleanupSlice(...args),
  ...createDriversSlice(...args),
  ...createPerformanceSlice(...args),
  ...createStartupSlice(...args),
  ...createServicesSlice(...args),
  ...createTasksSlice(...args),
  ...createDoctorSlice(...args),
  ...createHistorySlice(...args)
}));
