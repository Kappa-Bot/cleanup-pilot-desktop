import { StateCreator } from "zustand";
import { OptimizationActionSuggestion, ScheduledTaskDiagnostic, TaskAnalysisSummary } from "../../types";

export interface TasksSlice {
  taskItems: ScheduledTaskDiagnostic[];
  tasksSummary: TaskAnalysisSummary | null;
  taskActions: OptimizationActionSuggestion[];
  tasksLoading: boolean;
  tasksError: string;
  tasksLastLoadedAt: number;
  loadTasks: (force?: boolean) => Promise<void>;
}

const TASKS_CACHE_TTL_MS = 60 * 1000;
let tasksLoadInFlight: Promise<void> | null = null;

export const createTasksSlice: StateCreator<TasksSlice, [], [], TasksSlice> = (set, get) => ({
  taskItems: [],
  tasksSummary: null,
  taskActions: [],
  tasksLoading: false,
  tasksError: "",
  tasksLastLoadedAt: 0,
  loadTasks: async (force = false) => {
    if (tasksLoadInFlight) {
      return tasksLoadInFlight;
    }
    const current = get();
    if (
      !force &&
      current.taskItems.length > 0 &&
      current.tasksLastLoadedAt > 0 &&
      Date.now() - current.tasksLastLoadedAt < TASKS_CACHE_TTL_MS
    ) {
      return;
    }
    set({ tasksLoading: true, tasksError: "" });
    tasksLoadInFlight = (async () => {
      try {
        const response = await window.desktopApi.scanTasks();
        set({
          taskItems: response.tasks,
          tasksSummary: response.summary,
          taskActions: response.suggestedActions,
          tasksLoading: false,
          tasksError: "",
          tasksLastLoadedAt: Date.now()
        });
      } catch (error) {
        set({
          tasksLoading: false,
          tasksError: error instanceof Error ? error.message : "Task scan failed."
        });
      } finally {
        tasksLoadInFlight = null;
      }
    })();
    return tasksLoadInFlight;
  }
});
