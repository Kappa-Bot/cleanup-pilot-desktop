import { contextBridge, ipcRenderer } from "electron";
import {
  AIAdvisorAnalysisRequest,
  DecisionExecutionProgressEvent,
  CapabilityFlags,
  CleanupCategory,
  CleanupExecutionProgressEvent,
  CleanupPreset,
  CoverageCatalogResponse,
  DuplicateSelection,
  HomeSummarySnapshot,
  HistorySessionListResponse,
  LivePerformanceFrame,
  OptimizationActionSuggestion,
  DecisionExecuteResponse,
  DecisionPlanResponse,
  HistorySessionMutationResponse,
  SmartCheckExecuteResponse,
  SmartCheckPreviewResponse,
  SmartCheckRun,
  QuarantinePurgeProgressEvent,
  ScanProgressEvent,
  SchedulerSettings,
  SettingsPayload,
  TrustExplanationResponse,
  UpdateCheckResponse
} from "./types";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const on = <T>(channel: string, handler: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
    handler(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const updates = Object.freeze({
  check: () => invoke<UpdateCheckResponse>("updates.check")
});

const api = {
  getSettings: () => invoke("settings.get"),
  updateSettings: (payload: SettingsPayload) => invoke("settings.update", payload),

  startScan: (preset: CleanupPreset, categories: CleanupCategory[], roots: string[]) =>
    invoke("scan.start", { preset, categories, roots }),
  cancelScan: (runId: string) => invoke("scan.cancel", { runId }),
  getScanResults: (runId: string) => invoke("scan.results", { runId }),
  onScanProgress: (handler: (payload: ScanProgressEvent) => void) => on("scan.progress", handler),

  previewCleanup: (runId: string, selection: string[]) =>
    invoke("cleanup.preview", { runId, selection }),
  executeCleanup: (runId: string, selection: string[], executionId?: string) =>
    invoke("cleanup.execute", { runId, selection, mode: "quarantine", executionId }),
  onCleanupProgress: (handler: (payload: CleanupExecutionProgressEvent) => void) =>
    on("cleanup.progress", handler),

  listQuarantine: (limit?: number, offset?: number) => invoke("quarantine.list", { limit, offset }),
  restoreQuarantine: (itemIds: string[]) => invoke("quarantine.restore", { itemIds }),
  purgeQuarantine: (olderThanDays?: number) => invoke("quarantine.purge", { olderThanDays }),
  cancelQuarantinePurge: () => invoke("quarantine.purge.cancel"),
  onQuarantinePurgeProgress: (handler: (payload: QuarantinePurgeProgressEvent) => void) =>
    on("quarantine.purge.progress", handler),

  scanDuplicates: (roots: string[], minSizeBytes: number) =>
    invoke("duplicates.scan", { roots, minSizeBytes }),
  previewDuplicateResolution: (groupSelections: DuplicateSelection[]) =>
    invoke("duplicates.resolve.preview", { groupSelections }),
  executeDuplicateResolution: (groupSelections: DuplicateSelection[]) =>
    invoke("duplicates.resolve.execute", { groupSelections }),

  scanStorage: (roots: string[], includeInstalledApps: boolean) =>
    invoke("storage.scan", { roots, includeInstalledApps }),

  scanDrivers: () => invoke("drivers.scan"),
  openDriverOfficial: (candidateId: string) =>
    invoke("drivers.openOfficial", { candidateId }),
  lookupDriverOfficialWithAi: (candidateId: string, open?: boolean) =>
    invoke("drivers.lookupOfficialAi", { candidateId, open }),
  openWindowsUpdate: () => invoke("drivers.openWindowsUpdate"),

  listAiModels: () => invoke("ai.models"),
  analyzeWithAi: (request: AIAdvisorAnalysisRequest) => invoke("ai.analyze", request),
  getHomeSnapshot: () => invoke<{ snapshot: HomeSummarySnapshot }>("home.snapshot"),
  runSmartCheck: (mode?: "fast" | "balanced") =>
    invoke<{ runId: string }>("smartcheck.run", { mode }),
  getSmartCheckCurrent: (runId: string) =>
    invoke<{ run: SmartCheckRun }>("smartcheck.current", { runId }),
  previewSmartCheck: (runId: string, selectedIssueIds: string[]) =>
    invoke<SmartCheckPreviewResponse>("smartcheck.preview", { runId, selectedIssueIds }),
  executeSmartCheck: (runId: string, selectedIssueIds: string[], executionId?: string) =>
    invoke<SmartCheckExecuteResponse>("smartcheck.execute", { runId, selectedIssueIds, executionId }),
  buildDecisionPlan: (runId: string, selectedIssueIds: string[]) =>
    invoke<DecisionPlanResponse>("decision.plan", { runId, selectedIssueIds }),
  executeDecisionPlan: (runId: string, selectedIssueIds: string[], executionId?: string) =>
    invoke<DecisionExecuteResponse>("decision.execute", { runId, selectedIssueIds, executionId }),
  onDecisionExecutionProgress: (handler: (payload: DecisionExecutionProgressEvent) => void) =>
    on("decision.execute.progress", handler),
  listHistorySessions: (limit?: number) =>
    invoke<HistorySessionListResponse>("history.sessions.list", { limit }),
  restoreHistorySession: (sessionId: string) =>
    invoke<HistorySessionMutationResponse>("history.sessions.restore", { sessionId }),
  purgeHistorySession: (sessionId: string) =>
    invoke<HistorySessionMutationResponse>("history.sessions.purge", { sessionId }),
  getCoverageCatalog: () => invoke<CoverageCatalogResponse>("coverage.catalog"),
  explainFindingTrust: (findingId: string) =>
    invoke<TrustExplanationResponse>("trust.explainFinding", { findingId }),

  setScheduler: (settings: SchedulerSettings) => invoke("scheduler.set", settings),
  getScheduler: () => invoke("scheduler.get"),
  checkUpdates: () => updates.check(),
  updates,

  startPerformanceMonitor: (sampleIntervalMs?: number) =>
    invoke<{
      sessionId: string;
      capabilities: CapabilityFlags;
    }>("performance.monitor.start", { sampleIntervalMs }),
  getCurrentPerformanceSession: (sessionId: string) =>
    invoke("performance.monitor.current", { sessionId }),
  stopPerformanceMonitor: (sessionId: string) =>
    invoke("performance.monitor.stop", { sessionId }),
  onPerformanceFrame: (handler: (payload: LivePerformanceFrame) => void) =>
    on("performance.monitor.frame", handler),

  captureDiagnosticsSnapshot: (source: import("./types").SystemSnapshot["source"]) =>
    invoke("diagnostics.snapshot.capture", { source }),
  listDiagnosticsHistory: (limit?: number, from?: number, to?: number) =>
    invoke("diagnostics.snapshot.history", { limit, from, to }),
  scanStartup: () => invoke("startup.scan"),
  openStartupEntryLocation: (request: import("./types").StartupLocationOpenRequest) =>
    invoke("startup.openLocation", request),
  scanServices: () => invoke("services.scan"),
  scanTasks: () => invoke("tasks.scan"),
  getDiskIoSnapshot: () => invoke("diskio.snapshot"),
  getMemorySnapshot: () => invoke("memory.snapshot"),
  previewOptimizations: (actions: OptimizationActionSuggestion[]) =>
    invoke("optimizations.preview", { actions }),
  executeOptimizations: (actions: OptimizationActionSuggestion[]) =>
    invoke("optimizations.execute", { actions }),
  listOptimizationHistory: (limit?: number) =>
    invoke("optimizations.history.list", { limit }),
  restoreOptimizations: (changeIds: string[]) =>
    invoke("optimizations.restore", { changeIds }),
  runSystemDoctor: (snapshotId?: string, includeHistory?: boolean) =>
    invoke("doctor.diagnose", { snapshotId, includeHistory }),
  scanDriverPerformance: () => invoke("drivers.performance.scan")
} as const;

contextBridge.exposeInMainWorld("desktopApi", Object.freeze(api));
