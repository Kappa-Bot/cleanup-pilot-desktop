import {
  AppConfig,
  AIAdvisorAnalysisRequest,
  AIAdvisorAnalysisResponse,
  AIModelsResponse,
  DecisionExecutionProgressEvent,
  CleanupCategory,
  CleanupExecutionProgressEvent,
  CleanupPreset,
  CleanupPreviewResponse,
  CapabilityFlags,
  CoverageCatalogResponse,
  DecisionExecuteResponse,
  DecisionPlanResponse,
  DiskIoInsight,
  DuplicateGroup,
  DuplicatePreviewResponse,
  DuplicateSelection,
  DriverPerformanceSummary,
  DriverOfficialLookup,
  DriverScanResponse,
  HomeSummarySnapshot,
  HistorySessionListResponse,
  HistorySessionMutationResponse,
  LivePerformanceFrame,
  MemoryInsight,
  OptimizationActionSuggestion,
  OptimizationChangeRecord,
  OptimizationExecutionResult,
  OptimizationPreviewResponse,
  PerformanceSessionSummary,
  QuarantinePurgeProgressEvent,
  QuarantinePurgeResponse,
  QuarantineListResponse,
  ScanProgressEvent,
  ScanResultsResponse,
  SchedulerSettings,
  SchedulerStatus,
  SettingsPayload,
  SmartCheckExecuteResponse,
  SmartCheckPreviewResponse,
  SmartCheckRun,
  StorageScanResponse,
  SystemDoctorReport,
  SystemSnapshot,
  SystemSnapshotHistoryPoint,
  StartupLocationOpenRequest,
  StartupAnalysisSummary,
  StartupEntry,
  ServiceAnalysisSummary,
  ServiceDiagnostic,
  TaskAnalysisSummary,
  ScheduledTaskDiagnostic,
  TrustExplanationResponse,
  UpdateCheckResponse
} from "./types";

declare global {
  interface Window {
    desktopApi: {
      getSettings: () => Promise<AppConfig>;
      updateSettings: (payload: SettingsPayload) => Promise<AppConfig>;
      startScan: (
        preset: CleanupPreset,
        categories: CleanupCategory[],
        roots: string[]
      ) => Promise<{ runId: string }>;
      cancelScan: (runId: string) => Promise<{ ok: boolean }>;
      getScanResults: (runId: string) => Promise<ScanResultsResponse>;
      onScanProgress: (handler: (payload: ScanProgressEvent) => void) => () => void;
      previewCleanup: (runId: string, selection: string[]) => Promise<CleanupPreviewResponse>;
      executeCleanup: (
        runId: string,
        selection: string[],
        executionId?: string
      ) => Promise<import("./types").CleanupExecuteResponse>;
      onCleanupProgress: (handler: (payload: CleanupExecutionProgressEvent) => void) => () => void;
      listQuarantine: (limit?: number, offset?: number) => Promise<QuarantineListResponse>;
      restoreQuarantine: (
        itemIds: string[]
      ) => Promise<{ restoredCount: number; failed: string[] }>;
      purgeQuarantine: (olderThanDays?: number) => Promise<QuarantinePurgeResponse>;
      cancelQuarantinePurge: () => Promise<{ ok: boolean }>;
      onQuarantinePurgeProgress: (handler: (payload: QuarantinePurgeProgressEvent) => void) => () => void;
      scanDuplicates: (roots: string[], minSizeBytes: number) => Promise<{ groups: DuplicateGroup[] }>;
      previewDuplicateResolution: (
        groupSelections: DuplicateSelection[]
      ) => Promise<DuplicatePreviewResponse>;
      executeDuplicateResolution: (
        groupSelections: DuplicateSelection[]
      ) => Promise<import("./types").CleanupExecuteResponse>;
      scanStorage: (roots: string[], includeInstalledApps: boolean) => Promise<StorageScanResponse>;
      scanDrivers: () => Promise<DriverScanResponse>;
      openDriverOfficial: (candidateId: string) => Promise<{ opened: boolean }>;
      lookupDriverOfficialWithAi: (
        candidateId: string,
        open?: boolean
      ) => Promise<{ lookup: DriverOfficialLookup; opened: boolean }>;
      openWindowsUpdate: () => Promise<{ opened: boolean }>;
      listAiModels: () => Promise<AIModelsResponse>;
      analyzeWithAi: (request: AIAdvisorAnalysisRequest) => Promise<AIAdvisorAnalysisResponse>;
      getHomeSnapshot: () => Promise<{ snapshot: HomeSummarySnapshot }>;
      runSmartCheck: (mode?: "fast" | "balanced") => Promise<{ runId: string }>;
      getSmartCheckCurrent: (runId: string) => Promise<{ run: SmartCheckRun }>;
      previewSmartCheck: (
        runId: string,
        selectedIssueIds: string[]
      ) => Promise<SmartCheckPreviewResponse>;
      executeSmartCheck: (
        runId: string,
        selectedIssueIds: string[],
        executionId?: string
      ) => Promise<SmartCheckExecuteResponse>;
      buildDecisionPlan: (
        runId: string,
        selectedIssueIds: string[]
      ) => Promise<DecisionPlanResponse>;
      executeDecisionPlan: (
        runId: string,
        selectedIssueIds: string[],
        executionId?: string
      ) => Promise<DecisionExecuteResponse>;
      onDecisionExecutionProgress: (handler: (payload: DecisionExecutionProgressEvent) => void) => () => void;
      listHistorySessions: (limit?: number) => Promise<HistorySessionListResponse>;
      restoreHistorySession: (sessionId: string) => Promise<HistorySessionMutationResponse>;
      purgeHistorySession: (sessionId: string) => Promise<HistorySessionMutationResponse>;
      getCoverageCatalog: () => Promise<CoverageCatalogResponse>;
      explainFindingTrust: (findingId: string) => Promise<TrustExplanationResponse>;
      setScheduler: (
        settings: SchedulerSettings
      ) => Promise<{ ok: boolean; scheduler: SchedulerStatus }>;
      getScheduler: () => Promise<SchedulerStatus>;
      checkUpdates: () => Promise<UpdateCheckResponse>;
      startPerformanceMonitor: (
        sampleIntervalMs?: number
      ) => Promise<{ sessionId: string; capabilities: CapabilityFlags }>;
      getCurrentPerformanceSession: (
        sessionId: string
      ) => Promise<{ frames: LivePerformanceFrame[]; summary: PerformanceSessionSummary }>;
      stopPerformanceMonitor: (
        sessionId: string
      ) => Promise<{ ok: true; summary: PerformanceSessionSummary }>;
      onPerformanceFrame: (handler: (payload: LivePerformanceFrame) => void) => () => void;
      captureDiagnosticsSnapshot: (
        source: SystemSnapshot["source"]
      ) => Promise<{ snapshot: SystemSnapshot }>;
      listDiagnosticsHistory: (
        limit?: number,
        from?: number,
        to?: number
      ) => Promise<{ snapshots: SystemSnapshotHistoryPoint[] }>;
      scanStartup: () => Promise<{
        entries: StartupEntry[];
        summary: StartupAnalysisSummary;
        suggestedActions: OptimizationActionSuggestion[];
      }>;
      openStartupEntryLocation: (
        request: StartupLocationOpenRequest
      ) => Promise<{ opened: boolean; mode: string }>;
      scanServices: () => Promise<{
        services: ServiceDiagnostic[];
        summary: ServiceAnalysisSummary;
        suggestedActions: OptimizationActionSuggestion[];
      }>;
      scanTasks: () => Promise<{
        tasks: ScheduledTaskDiagnostic[];
        summary: TaskAnalysisSummary;
        suggestedActions: OptimizationActionSuggestion[];
      }>;
      getDiskIoSnapshot: () => Promise<{ summary: SystemSnapshot["diskIo"]; insights: DiskIoInsight[] }>;
      getMemorySnapshot: () => Promise<{ summary: SystemSnapshot["memory"]; insights: MemoryInsight[] }>;
      previewOptimizations: (
        actions: OptimizationActionSuggestion[]
      ) => Promise<OptimizationPreviewResponse>;
      executeOptimizations: (
        actions: OptimizationActionSuggestion[]
      ) => Promise<OptimizationExecutionResult>;
      listOptimizationHistory: (
        limit?: number
      ) => Promise<{ changes: OptimizationChangeRecord[] }>;
      restoreOptimizations: (
        changeIds: string[]
      ) => Promise<{ restoredCount: number; failed: string[] }>;
      runSystemDoctor: (
        snapshotId?: string,
        includeHistory?: boolean
      ) => Promise<{ report: SystemDoctorReport; snapshot: SystemSnapshot }>;
      scanDriverPerformance: () => Promise<{ summary: DriverPerformanceSummary }>;
    };
  }
}

export {};
