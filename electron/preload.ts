import { contextBridge, ipcRenderer } from "electron";
import {
  AIAdvisorAnalysisRequest,
  CapabilityFlags,
  CleanupCategory,
  CleanupExecutionProgressEvent,
  CleanupPreset,
  CoverageCatalogResponse,
  DuplicateSelection,
  HomeSummarySnapshot,
  LivePerformanceFrame,
  OptimizationActionSuggestion,
  SmartCheckRun,
  QuarantinePurgeProgressEvent,
  ScanProgressEvent,
  SchedulerSettings,
  SettingsPayload,
  TrustExplanationResponse
} from "./types";

const api = {
  getSettings: () => ipcRenderer.invoke("settings.get"),
  updateSettings: (payload: SettingsPayload) => ipcRenderer.invoke("settings.update", payload),

  startScan: (preset: CleanupPreset, categories: CleanupCategory[], roots: string[]) =>
    ipcRenderer.invoke("scan.start", { preset, categories, roots }),
  cancelScan: (runId: string) => ipcRenderer.invoke("scan.cancel", { runId }),
  getScanResults: (runId: string) => ipcRenderer.invoke("scan.results", { runId }),
  onScanProgress: (handler: (payload: ScanProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ScanProgressEvent) => {
      handler(payload);
    };
    ipcRenderer.on("scan.progress", listener);
    return () => ipcRenderer.removeListener("scan.progress", listener);
  },

  previewCleanup: (runId: string, selection: string[]) =>
    ipcRenderer.invoke("cleanup.preview", { runId, selection }),
  executeCleanup: (runId: string, selection: string[], executionId?: string) =>
    ipcRenderer.invoke("cleanup.execute", { runId, selection, mode: "quarantine", executionId }),
  onCleanupProgress: (handler: (payload: CleanupExecutionProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CleanupExecutionProgressEvent) => {
      handler(payload);
    };
    ipcRenderer.on("cleanup.progress", listener);
    return () => ipcRenderer.removeListener("cleanup.progress", listener);
  },

  listQuarantine: (limit?: number, offset?: number) => ipcRenderer.invoke("quarantine.list", { limit, offset }),
  restoreQuarantine: (itemIds: string[]) => ipcRenderer.invoke("quarantine.restore", { itemIds }),
  purgeQuarantine: (olderThanDays?: number) => ipcRenderer.invoke("quarantine.purge", { olderThanDays }),
  cancelQuarantinePurge: () => ipcRenderer.invoke("quarantine.purge.cancel"),
  onQuarantinePurgeProgress: (handler: (payload: QuarantinePurgeProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: QuarantinePurgeProgressEvent) => {
      handler(payload);
    };
    ipcRenderer.on("quarantine.purge.progress", listener);
    return () => ipcRenderer.removeListener("quarantine.purge.progress", listener);
  },

  scanDuplicates: (roots: string[], minSizeBytes: number) =>
    ipcRenderer.invoke("duplicates.scan", { roots, minSizeBytes }),
  previewDuplicateResolution: (groupSelections: DuplicateSelection[]) =>
    ipcRenderer.invoke("duplicates.resolve.preview", { groupSelections }),
  executeDuplicateResolution: (groupSelections: DuplicateSelection[]) =>
    ipcRenderer.invoke("duplicates.resolve.execute", { groupSelections }),

  scanStorage: (roots: string[], includeInstalledApps: boolean) =>
    ipcRenderer.invoke("storage.scan", { roots, includeInstalledApps }),

  scanDrivers: () => ipcRenderer.invoke("drivers.scan"),
  openDriverOfficial: (candidateId: string) =>
    ipcRenderer.invoke("drivers.openOfficial", { candidateId }),
  lookupDriverOfficialWithAi: (candidateId: string, open?: boolean) =>
    ipcRenderer.invoke("drivers.lookupOfficialAi", { candidateId, open }),
  openWindowsUpdate: () => ipcRenderer.invoke("drivers.openWindowsUpdate"),

  listAiModels: () => ipcRenderer.invoke("ai.models"),
  analyzeWithAi: (request: AIAdvisorAnalysisRequest) => ipcRenderer.invoke("ai.analyze", request),
  getHomeSnapshot: () => ipcRenderer.invoke("home.snapshot") as Promise<{ snapshot: HomeSummarySnapshot }>,
  runSmartCheck: (mode?: "fast" | "balanced") =>
    ipcRenderer.invoke("smartcheck.run", { mode }) as Promise<{ runId: string }>,
  getSmartCheckCurrent: (runId: string) =>
    ipcRenderer.invoke("smartcheck.current", { runId }) as Promise<{ run: SmartCheckRun }>,
  previewSmartCheck: (runId: string, selectedIssueIds: string[]) =>
    ipcRenderer.invoke("smartcheck.preview", { runId, selectedIssueIds }),
  executeSmartCheck: (runId: string, selectedIssueIds: string[]) =>
    ipcRenderer.invoke("smartcheck.execute", { runId, selectedIssueIds }),
  getCoverageCatalog: () => ipcRenderer.invoke("coverage.catalog") as Promise<CoverageCatalogResponse>,
  explainFindingTrust: (findingId: string) =>
    ipcRenderer.invoke("trust.explainFinding", { findingId }) as Promise<TrustExplanationResponse>,

  setScheduler: (settings: SchedulerSettings) => ipcRenderer.invoke("scheduler.set", settings),
  getScheduler: () => ipcRenderer.invoke("scheduler.get"),
  checkUpdates: () => ipcRenderer.invoke("updates.check")
  ,

  startPerformanceMonitor: (sampleIntervalMs?: number) =>
    ipcRenderer.invoke("performance.monitor.start", { sampleIntervalMs }) as Promise<{
      sessionId: string;
      capabilities: CapabilityFlags;
    }>,
  getCurrentPerformanceSession: (sessionId: string) =>
    ipcRenderer.invoke("performance.monitor.current", { sessionId }),
  stopPerformanceMonitor: (sessionId: string) =>
    ipcRenderer.invoke("performance.monitor.stop", { sessionId }),
  onPerformanceFrame: (handler: (payload: LivePerformanceFrame) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LivePerformanceFrame) => {
      handler(payload);
    };
    ipcRenderer.on("performance.monitor.frame", listener);
    return () => ipcRenderer.removeListener("performance.monitor.frame", listener);
  },

  captureDiagnosticsSnapshot: (source: import("./types").SystemSnapshot["source"]) =>
    ipcRenderer.invoke("diagnostics.snapshot.capture", { source }),
  listDiagnosticsHistory: (limit?: number, from?: number, to?: number) =>
    ipcRenderer.invoke("diagnostics.snapshot.history", { limit, from, to }),
  scanStartup: () => ipcRenderer.invoke("startup.scan"),
  openStartupEntryLocation: (request: import("./types").StartupLocationOpenRequest) =>
    ipcRenderer.invoke("startup.openLocation", request),
  scanServices: () => ipcRenderer.invoke("services.scan"),
  scanTasks: () => ipcRenderer.invoke("tasks.scan"),
  getDiskIoSnapshot: () => ipcRenderer.invoke("diskio.snapshot"),
  getMemorySnapshot: () => ipcRenderer.invoke("memory.snapshot"),
  previewOptimizations: (actions: OptimizationActionSuggestion[]) =>
    ipcRenderer.invoke("optimizations.preview", { actions }),
  executeOptimizations: (actions: OptimizationActionSuggestion[]) =>
    ipcRenderer.invoke("optimizations.execute", { actions }),
  listOptimizationHistory: (limit?: number) =>
    ipcRenderer.invoke("optimizations.history.list", { limit }),
  restoreOptimizations: (changeIds: string[]) =>
    ipcRenderer.invoke("optimizations.restore", { changeIds }),
  runSystemDoctor: (snapshotId?: string, includeHistory?: boolean) =>
    ipcRenderer.invoke("doctor.diagnose", { snapshotId, includeHistory }),
  scanDriverPerformance: () => ipcRenderer.invoke("drivers.performance.scan")
};

contextBridge.exposeInMainWorld("desktopApi", api);
