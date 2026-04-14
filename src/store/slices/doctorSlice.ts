import { StateCreator } from "zustand";
import { OptimizationPreviewResponse, SystemDoctorReport, SystemSnapshot } from "../../types";

export interface DoctorSlice {
  doctorReport: SystemDoctorReport | null;
  doctorSnapshot: SystemSnapshot | null;
  doctorLoading: boolean;
  doctorError: string;
  doctorLastLoadedAt: number;
  optimizationPreview: OptimizationPreviewResponse | null;
  previewedActionIds: string[];
  optimizationExecuting: boolean;
  loadDoctor: (snapshotId?: string, includeHistory?: boolean) => Promise<void>;
  previewActions: (actionIds?: string[]) => Promise<void>;
  executePreviewedActions: () => Promise<void>;
}

export const createDoctorSlice: StateCreator<DoctorSlice, [], [], DoctorSlice> = (set, get) => ({
  doctorReport: null,
  doctorSnapshot: null,
  doctorLoading: false,
  doctorError: "",
  doctorLastLoadedAt: 0,
  optimizationPreview: null,
  previewedActionIds: [],
  optimizationExecuting: false,
  loadDoctor: async (snapshotId, includeHistory) => {
    set({ doctorLoading: true, doctorError: "" });
    try {
      const response = await window.desktopApi.runSystemDoctor(snapshotId, includeHistory);
      set({
        doctorReport: response.report,
        doctorSnapshot: response.snapshot,
        doctorLoading: false,
        doctorError: "",
        doctorLastLoadedAt: Date.now(),
        optimizationPreview: null,
        previewedActionIds: []
      });
    } catch (error) {
      set({
        doctorLoading: false,
        doctorError: error instanceof Error ? error.message : "Doctor analysis failed."
      });
    }
  },
  previewActions: async (actionIds) => {
    const report = get().doctorReport;
    if (!report) {
      return;
    }
    const actions = report.safeWins.filter((item) => !actionIds || actionIds.includes(item.id));
    if (!actions.length) {
      set({
        optimizationPreview: null,
        previewedActionIds: []
      });
      return;
    }
    try {
      const preview = await window.desktopApi.previewOptimizations(actions);
      set({
        optimizationPreview: preview,
        previewedActionIds: actions.map((item) => item.id),
        doctorError: ""
      });
    } catch (error) {
      set({
        doctorError: error instanceof Error ? error.message : "Doctor preview failed."
      });
    }
  },
  executePreviewedActions: async () => {
    const report = get().doctorReport;
    if (!report) {
      return;
    }
    const selectedIds = new Set(get().previewedActionIds);
    const selectedActions = report.safeWins.filter((item) => !item.blocked && selectedIds.has(item.id));
    if (!selectedActions.length) {
      return;
    }
    set({ optimizationExecuting: true });
    try {
      await window.desktopApi.executeOptimizations(selectedActions);
      set({
        optimizationPreview: null,
        previewedActionIds: [],
        doctorError: ""
      });
    } catch (error) {
      set({
        doctorError: error instanceof Error ? error.message : "Doctor optimizations failed."
      });
    } finally {
      set({ optimizationExecuting: false });
    }
  }
});
