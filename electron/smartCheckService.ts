import { randomUUID } from "crypto";
import { AppDatabase } from "./db";
import { ConfigStore } from "./configStore";
import { CleanupEngine } from "./cleanupEngine";
import { QuarantineManager } from "./quarantineManager";
import { ScanEngine } from "./scanEngine";
import { DuplicateEngine } from "./duplicateEngine";
import { DriverScanService } from "./driverScanService";
import { OptimizationManager } from "./optimizationManager";
import { ProcessProfiler } from "./processProfiler";
import { ServiceAnalyzer } from "./serviceAnalyzer";
import { StartupAnalyzer } from "./startupAnalyzer";
import { SystemDiagnostics } from "./systemDiagnostics";
import { TaskSchedulerAnalyzer } from "./taskSchedulerAnalyzer";
import { IssueRankingService, RankedIssue } from "./issueRankingService";
import {
  BeforeAfterSummary,
  CleanupCategory,
  CleanupExecuteResponse,
  CleanupPreviewResponse,
  DecisionExecutionProgressEvent,
  HomeSummarySnapshot,
  OptimizationActionSuggestion,
  OptimizationExecutionResult,
  OptimizationPreviewResponse,
  ProductIssueCard,
  ProtectedFindingRejection,
  ScanFinding,
  ScanResultsResponse,
  SmartCheckExecuteResponse,
  SmartCheckPreviewResponse,
  SmartCheckRun,
  SystemSnapshot
} from "./types";

const ALL_CLEANUP_CATEGORIES: CleanupCategory[] = [
  "temp",
  "cache",
  "logs",
  "crash_dumps",
  "wsl_leftovers",
  "minecraft_leftovers",
  "ai_model_leftovers",
  "installer_artifacts",
  "duplicates"
];
const FAST_CATEGORIES: CleanupCategory[] = [
  "temp",
  "cache",
  "logs",
  "crash_dumps",
  "installer_artifacts",
  "wsl_leftovers",
  "ai_model_leftovers"
];
const BALANCED_CATEGORIES: CleanupCategory[] = [
  ...FAST_CATEGORIES,
  "minecraft_leftovers"
];
const HOME_SUMMARY_TTL_MS = 90 * 1000;

interface SmartCheckServiceDependencies {
  db: AppDatabase;
  configStore: ConfigStore;
  scanEngine: ScanEngine;
  cleanupEngine: CleanupEngine;
  quarantineManager: QuarantineManager;
  duplicateEngine: DuplicateEngine;
  driverScanService: DriverScanService;
  startupAnalyzer: StartupAnalyzer;
  serviceAnalyzer: ServiceAnalyzer;
  taskSchedulerAnalyzer: TaskSchedulerAnalyzer;
  processProfiler: ProcessProfiler;
  systemDiagnostics: SystemDiagnostics;
  optimizationManager: OptimizationManager;
  issueRankingService: IssueRankingService;
}

type SmartCheckMode = "fast" | "balanced";

interface SmartCheckExecutionOptions {
  executionId?: string;
  onProgress?: (event: DecisionExecutionProgressEvent) => void;
}

interface SmartCheckInternalRun {
  publicRun: SmartCheckRun;
  findings: ScanFinding[];
  rejected: ProtectedFindingRejection[];
  snapshot?: SystemSnapshot;
  issueBindings: Map<string, RankedIssue>;
}

type ProcessProfilerFrame = Awaited<ReturnType<ProcessProfiler["captureSample"]>>;
type StartupAnalysis = Awaited<ReturnType<StartupAnalyzer["scan"]>>;
type ServiceAnalysis = Awaited<ReturnType<ServiceAnalyzer["scan"]>>;
type TaskAnalysis = Awaited<ReturnType<TaskSchedulerAnalyzer["scan"]>>;
type DriverScanResult = Awaited<ReturnType<DriverScanService["scan"]>>;
type DriverPerformanceResult = Awaited<ReturnType<DriverScanService["scanPerformanceSummary"]>>;

async function withFallback<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}

function emptyCategorySummary(): ScanResultsResponse["summary"]["categories"] {
  return Object.fromEntries(ALL_CLEANUP_CATEGORIES.map((category) => [category, { count: 0, bytes: 0 }])) as ScanResultsResponse["summary"]["categories"];
}

function emptyScanResult(runId: string): ScanResultsResponse {
  return {
    status: "completed",
    findings: [],
    rejected: [],
    summary: {
      runId,
      status: "completed",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      processedItems: 0,
      findingsCount: 0,
      totalCandidateBytes: 0,
      protectedRejectedCount: 0,
      categories: emptyCategorySummary()
    }
  };
}

function emptyProcessFrame(): ProcessProfilerFrame {
  return {
    capturedAt: Date.now(),
    counters: {} as ProcessProfilerFrame["counters"],
    topProcesses: [],
    runawayProcesses: [],
    memoryHogs: [],
    diskWriters: []
  };
}

function emptyStartupAnalysis(): StartupAnalysis {
  return {
    entries: [],
    summary: {
      impactScore: 0,
      estimatedBootDelayMs: 0,
      highImpactCount: 0,
      redundantCount: 0,
      orphanCount: 0,
      inspectOnlyCount: 0,
      timeline: []
    },
    suggestedActions: []
  };
}

function emptyServiceAnalysis(): ServiceAnalysis {
  return {
    services: [],
    summary: {
      total: 0,
      essentialCount: 0,
      optionalCount: 0,
      rarelyUsedCount: 0,
      unusedCount: 0,
      orphanCount: 0,
      suggestedActionCount: 0
    },
    suggestedActions: []
  };
}

function emptyTaskAnalysis(): TaskAnalysis {
  return {
    tasks: [],
    summary: {
      total: 0,
      frequentCount: 0,
      optionalCount: 0,
      suspiciousCount: 0,
      orphanCount: 0,
      inspectOnlyCount: 0
    },
    suggestedActions: []
  };
}

function emptyDriverScan(): DriverScanResult {
  return {
    source: "windows_update+oem_hints",
    devices: [],
    updateCandidates: [],
    meaningfulDeviceCount: 0,
    ignoredDeviceCount: 0,
    suppressedCount: 0,
    stackSuppressedCount: 0,
    suppressionSuggestions: []
  };
}

function emptyDriverPerformance(): DriverPerformanceResult {
  return {
    latencyRisk: "low",
    suspectedDrivers: [],
    activeSignals: []
  };
}

function emptySummary(): HomeSummarySnapshot {
  return {
    generatedAt: Date.now(),
    healthScore: 82,
    reclaimableBytes: 0,
    primaryBottleneck: "unknown",
    safetyState: "protected",
    trustSummary: "Everything remains preview-first, quarantine-first, and reversible.",
    recommendedActionSummary: "Run Smart Check to refresh cleanup, startup, and safety priorities.",
    subscores: [],
    trend: {
      direction: "unknown",
      delta: 0,
      label: "Trend not available yet",
      windowLabel: "Need more history"
    },
    recommendedIssue: null,
    topIssues: []
  };
}

function dedupeOptimizationActions(actions: OptimizationActionSuggestion[]): OptimizationActionSuggestion[] {
  const seen = new Set<string>();
  const output: OptimizationActionSuggestion[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) {
      continue;
    }
    seen.add(action.id);
    output.push(action);
  }
  return output;
}

function selectIssueCards(run: SmartCheckInternalRun, selectedIssueIds: string[]): ProductIssueCard[] {
  const ids = selectedIssueIds.length ? selectedIssueIds : [run.publicRun.summary.recommendedIssue?.id ?? ""];
  return ids
    .map((id) => run.issueBindings.get(id)?.card)
    .filter((item): item is ProductIssueCard => Boolean(item));
}

function buildBeforeAfterSummary(args: {
  kind: BeforeAfterSummary["kind"];
  cleanup?: CleanupExecuteResponse;
  optimizations?: OptimizationExecutionResult;
  startupChangeCount: number;
  preSnapshot?: SystemSnapshot;
  postSnapshot?: SystemSnapshot;
}): BeforeAfterSummary {
  const preCpu = args.preSnapshot?.cpu.avgUsagePct;
  const postCpu = args.postSnapshot?.cpu.avgUsagePct;
  const backgroundReductionPct =
    preCpu !== undefined && postCpu !== undefined ? Math.max(0, Math.round(preCpu - postCpu)) : undefined;

  return {
    kind: args.kind,
    generatedAt: Date.now(),
    freedBytes: args.cleanup?.freedBytes ?? 0,
    cleanupMovedCount: args.cleanup?.movedCount ?? 0,
    startupChangeCount: args.startupChangeCount,
    optimizationChangeCount: args.optimizations?.appliedCount ?? 0,
    backgroundReductionPct,
    trustSummary: "Changes were applied with preview first and remain reversible through quarantine or optimization history."
  };
}

function deriveLatestReport(snapshotHistory: Array<{ id: string; source: SystemSnapshot["source"] }>, db: AppDatabase): BeforeAfterSummary | undefined {
  for (let index = 0; index < snapshotHistory.length - 1; index += 1) {
    const current = snapshotHistory[index];
    const previous = snapshotHistory[index + 1];
    if (current.source === "post_cleanup" && previous.source === "pre_cleanup") {
      const postSnapshot = db.getSystemSnapshot(current.id) ?? undefined;
      const preSnapshot = db.getSystemSnapshot(previous.id) ?? undefined;
      return buildBeforeAfterSummary({
        kind: "cleanup",
        startupChangeCount: 0,
        preSnapshot,
        postSnapshot
      });
    }
    if (current.source === "post_optimization" && previous.source === "pre_optimization") {
      const postSnapshot = db.getSystemSnapshot(current.id) ?? undefined;
      const preSnapshot = db.getSystemSnapshot(previous.id) ?? undefined;
      return buildBeforeAfterSummary({
        kind: "optimization",
        startupChangeCount: 0,
        preSnapshot,
        postSnapshot
      });
    }
  }
  return undefined;
}

export class SmartCheckService {
  private readonly runs = new Map<string, SmartCheckInternalRun>();
  private latestCompletedRunId = "";
  private summaryCache: { at: number; value: HomeSummarySnapshot } | null = null;

  constructor(private readonly deps: SmartCheckServiceDependencies) {}

  async run(mode: SmartCheckMode = "fast"): Promise<{ runId: string }> {
    const runId = randomUUID();
    this.runs.set(runId, {
      publicRun: {
        id: runId,
        startedAt: Date.now(),
        status: "running",
        mode,
        summary: emptySummary(),
        cleaner: {
          findingsCount: 0,
          selectedCount: 0,
          selectedBytes: 0,
          groupedIssues: []
        },
        optimize: {
          startupIssues: 0,
          performanceIssues: 0,
          driverIssues: 0,
          groupedIssues: []
        }
      },
      findings: [],
      rejected: [],
      issueBindings: new Map()
    });

    void this.populateRun(runId, mode);
    return { runId };
  }

  current(runId: string): { run: SmartCheckRun } {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error("Smart Check run not found.");
    }
    return { run: run.publicRun };
  }

  async preview(runId: string, selectedIssueIds: string[]): Promise<SmartCheckPreviewResponse> {
    const run = this.getRun(runId);
    const { cleanupSelection, optimizationActions } = this.resolveSelection(run, selectedIssueIds);
    const selectedIssues = selectIssueCards(run, selectedIssueIds);
    const warnings: string[] = [];
    let cleanupPreview: CleanupPreviewResponse | undefined;
    let optimizationPreview: OptimizationPreviewResponse | undefined;

    if (cleanupSelection.length) {
      cleanupPreview = await this.deps.cleanupEngine.preview(run.findings, cleanupSelection);
    }
    if (optimizationActions.length) {
      optimizationPreview = await this.deps.optimizationManager.preview(optimizationActions);
    }
    if (!cleanupPreview && !optimizationPreview) {
      warnings.push("The selected Smart Check issues do not have a previewable cleanup or reversible optimization action yet.");
    }

    return {
      cleanupPreview,
      optimizationPreview,
      warnings,
      selectedIssues,
      trustSummary: run.publicRun.summary.trustSummary
    };
  }

  async execute(
    runId: string,
    selectedIssueIds: string[],
    options?: SmartCheckExecutionOptions
  ): Promise<SmartCheckExecuteResponse> {
    const run = this.getRun(runId);
    const { cleanupSelection, optimizationActions } = this.resolveSelection(run, selectedIssueIds);
    const selectedIssues = selectIssueCards(run, selectedIssueIds);
    const warnings: string[] = [];
    let cleanup: CleanupExecuteResponse | undefined;
    let optimizations: OptimizationExecutionResult | undefined;
    let preCleanupSnapshot: SystemSnapshot | undefined;
    let postCleanupSnapshot: SystemSnapshot | undefined;
    let preOptimizationSnapshot: SystemSnapshot | undefined;
    let postOptimizationSnapshot: SystemSnapshot | undefined;
    let snapshotWarningAdded = false;
    const executionId = options?.executionId ?? randomUUID();
    const emit = (stage: DecisionExecutionProgressEvent["stage"], percent: number, title: string, summary: string, detail?: string) => {
      options?.onProgress?.({
        executionId,
        stage,
        percent,
        title,
        summary,
        detail,
        timestamp: Date.now()
      });
    };
    const captureOptionalSnapshot = async (source: SystemSnapshot["source"]): Promise<SystemSnapshot | undefined> => {
      const snapshot = await this.captureAndStoreSnapshot(source);
      if (!snapshot && !snapshotWarningAdded) {
        warnings.push("Before/after diagnostics snapshot unavailable; execution continued without a snapshot delta.");
        snapshotWarningAdded = true;
      }
      return snapshot;
    };

    if (!cleanupSelection.length && !optimizationActions.length) {
      emit("failed", 100, "Nothing to execute", "The current Smart Check selection has no executable actions.");
      return {
        selectedIssues,
        warnings: ["The selected Smart Check issues do not map to an executable cleanup or optimization action yet."]
      };
    }

    emit("preparing", 5, "Preparing plan", "Locking the current selection and checking safety guards.");
    const settings = this.deps.configStore.getAll();
    if (cleanupSelection.length && settings.performanceAutoSnapshotOnCleanup) {
      preCleanupSnapshot = await captureOptionalSnapshot("pre_cleanup");
    }
    if (optimizationActions.length && settings.performanceAutoSnapshotOnOptimization) {
      preOptimizationSnapshot = await captureOptionalSnapshot("pre_optimization");
    }

    if (cleanupSelection.length) {
      emit("cleanup", 20, "Applying cleanup", "Moving selected cleanup targets into quarantine.");
      cleanup = await this.deps.cleanupEngine.execute(run.findings, cleanupSelection, this.deps.quarantineManager, {
        runId,
        executionId,
        requestAdminBeforeStart: true,
        onProgress: (progress) => {
          emit(
            "cleanup",
            Math.max(20, Math.min(70, 20 + Math.round(progress.percent * 0.5))),
            "Applying cleanup",
            progress.message,
            progress.runningPath
          );
        }
      });
      if (cleanup.movedIds.length) {
        const movedSet = new Set(cleanup.movedIds);
        run.findings = run.findings.filter((item) => !movedSet.has(item.id));
      }
    }
    if (optimizationActions.length) {
      emit("optimization", cleanupSelection.length ? 74 : 35, "Applying optimizations", "Applying reversible startup and background changes.");
      optimizations = await this.deps.optimizationManager.execute(optimizationActions);
    }

    if (cleanupSelection.length && settings.performanceAutoSnapshotOnCleanup) {
      postCleanupSnapshot = await captureOptionalSnapshot("post_cleanup");
    }
    if (optimizationActions.length && settings.performanceAutoSnapshotOnOptimization) {
      postOptimizationSnapshot = await captureOptionalSnapshot("post_optimization");
    }

    if (cleanup?.failedCount) {
      warnings.push(`${cleanup.failedCount} cleanup task${cleanup.failedCount === 1 ? "" : "s"} failed during Smart Check execution.`);
    }
    if (optimizations?.failedCount) {
      warnings.push(`${optimizations.failedCount} optimization change${optimizations.failedCount === 1 ? "" : "s"} failed during Smart Check execution.`);
    }

    emit("reporting", 92, "Writing session report", "Capturing the final before/after summary.");
    const report = buildBeforeAfterSummary({
      kind: cleanup && optimizations ? "smartcheck" : cleanup ? "cleanup" : "optimization",
      cleanup,
      optimizations,
      startupChangeCount: optimizationActions.filter((item) => item.targetKind === "startup_entry").length,
      preSnapshot: preOptimizationSnapshot ?? preCleanupSnapshot,
      postSnapshot: postOptimizationSnapshot ?? postCleanupSnapshot
    });

    run.publicRun.report = report;
    run.publicRun.summary = {
      ...run.publicRun.summary,
      latestReport: report
    };
    this.summaryCache = null;
    emit("completed", 100, "Plan applied", "The session report is ready.");

    return { cleanup, optimizations, warnings, selectedIssues, report };
  }

  async captureHomeSnapshot(): Promise<HomeSummarySnapshot> {
    if (this.summaryCache && Date.now() - this.summaryCache.at < HOME_SUMMARY_TTL_MS) {
      return this.summaryCache.value;
    }
    if (this.latestCompletedRunId) {
      const latest = this.runs.get(this.latestCompletedRunId);
      if (latest && Date.now() - latest.publicRun.summary.generatedAt < HOME_SUMMARY_TTL_MS) {
        this.summaryCache = { at: Date.now(), value: latest.publicRun.summary };
        return latest.publicRun.summary;
      }
    }
    const runId = randomUUID();
    const built = await this.buildRun(runId, "fast");
    this.summaryCache = { at: Date.now(), value: built.publicRun.summary };
    return built.publicRun.summary;
  }

  getLightweightHomeSnapshot(): HomeSummarySnapshot {
    if (this.summaryCache && Date.now() - this.summaryCache.at < HOME_SUMMARY_TTL_MS) {
      return this.summaryCache.value;
    }
    if (this.latestCompletedRunId) {
      const latest = this.runs.get(this.latestCompletedRunId);
      if (latest && Date.now() - latest.publicRun.summary.generatedAt < HOME_SUMMARY_TTL_MS) {
        this.summaryCache = { at: Date.now(), value: latest.publicRun.summary };
        return latest.publicRun.summary;
      }
    }

    const history = this.deps.db.listSystemSnapshotHistory({ limit: 12 });
    const latestReport = deriveLatestReport(history, this.deps.db);
    const snapshot: HomeSummarySnapshot = latestReport
      ? {
          ...emptySummary(),
          latestReport,
          recommendedActionSummary: "Run Smart Check to refresh cleanup, startup, and safety priorities with current machine data."
        }
      : emptySummary();
    this.summaryCache = { at: Date.now(), value: snapshot };
    return snapshot;
  }

  findFindingById(findingId: string): ScanFinding | ProtectedFindingRejection | null {
    for (const run of this.runs.values()) {
      const finding = run.findings.find((item) => item.id === findingId);
      if (finding) {
        return finding;
      }
      const rejection = run.rejected.find((item) => item.path === findingId);
      if (rejection) {
        return rejection;
      }
    }
    return null;
  }

  private getRun(runId: string): SmartCheckInternalRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error("Smart Check run not found.");
    }
    return run;
  }

  private async populateRun(runId: string, mode: SmartCheckMode): Promise<void> {
    try {
      const built = await this.buildRun(runId, mode);
      this.runs.set(runId, built);
      this.latestCompletedRunId = runId;
      this.summaryCache = { at: Date.now(), value: built.publicRun.summary };
    } catch (error) {
      const current = this.runs.get(runId);
      if (!current) {
        return;
      }
      current.publicRun = {
        ...current.publicRun,
        status: "failed",
        completedAt: Date.now()
      };
    }
  }

  private async buildRun(runId: string, mode: SmartCheckMode): Promise<SmartCheckInternalRun> {
    const roots = this.deps.configStore.getAll().customRoots.filter(Boolean);
    const categories = mode === "balanced" ? BALANCED_CATEGORIES : FAST_CATEGORIES;
    const scanPreset = mode === "balanced" ? "standard" : "lite";
    const scanRunId = `smartcheck:${runId}`;
    const scanResult = await withFallback(
      () => this.deps.scanEngine.run(
        scanRunId,
        {
          preset: scanPreset,
          categories,
          roots
        },
        {
          isCanceled: () => false,
          onProgress: () => undefined
        }
      ),
      emptyScanResult(scanRunId)
    );

    const processFrame = await withFallback(
      () => this.deps.processProfiler.captureSample(mode === "balanced" ? 900 : 600),
      emptyProcessFrame()
    );
    const [startup, services, tasks, snapshot, driverScan, driverPerformance] = await Promise.all([
      withFallback(() => this.deps.startupAnalyzer.scan(processFrame.topProcesses), emptyStartupAnalysis()),
      withFallback(() => this.deps.serviceAnalyzer.scan(), emptyServiceAnalysis()),
      withFallback(() => this.deps.taskSchedulerAnalyzer.scan(), emptyTaskAnalysis()),
      withFallback<SystemSnapshot | undefined>(
        () => this.deps.systemDiagnostics.captureSnapshot({
          source: "manual",
          sampleCount: mode === "balanced" ? 2 : 1,
          sampleIntervalMs: mode === "balanced" ? 700 : 500
        }),
        undefined
      ),
      withFallback(() => this.deps.driverScanService.scan(), emptyDriverScan()),
      withFallback(() => this.deps.driverScanService.scanPerformanceSummary(), emptyDriverPerformance())
    ]);
    if (snapshot) {
      this.deps.db.addSystemSnapshot(snapshot);
    }
    const history = this.deps.db.listSystemSnapshotHistory({ limit: 12 });

    const ranked = this.deps.issueRankingService.rankIssues({
      findings: scanResult.findings,
      rejected: scanResult.rejected,
      startupActions: startup.suggestedActions,
      startupSummary: startup.summary,
      serviceActions: services.suggestedActions,
      taskActions: tasks.suggestedActions,
      snapshot,
      history,
      driverScan,
      driverPerformance
    });
    const latestReport = deriveLatestReport(history, this.deps.db);

    const issueBindings = new Map<string, RankedIssue>();
    for (const issue of [...ranked.cleanerIssues, ...ranked.optimizeIssues]) {
      issueBindings.set(issue.card.id, issue);
    }

    const selectedCount = scanResult.findings
      .filter((item) => item.selectedByDefault)
      .reduce((sum, item) => sum + (item.entryCount ?? 1), 0);
    const selectedBytes = scanResult.findings
      .filter((item) => item.selectedByDefault)
      .reduce((sum, item) => sum + item.sizeBytes, 0);

    return {
      publicRun: {
        id: runId,
        startedAt: Date.now(),
        completedAt: Date.now(),
        status: "completed",
        mode,
        summary: latestReport
          ? {
              ...ranked.summary,
              latestReport
            }
          : ranked.summary,
        cleaner: {
          findingsCount: scanResult.summary.findingsCount,
          selectedCount,
          selectedBytes,
          groupedIssues: ranked.cleanerIssues.map((item) => item.card)
        },
        optimize: {
          startupIssues: ranked.optimizeIssues.filter((item) => item.card.domain === "startup").length,
          performanceIssues: ranked.optimizeIssues.filter((item) => item.card.domain === "performance").length,
          driverIssues: ranked.optimizeIssues.filter((item) => item.card.domain === "drivers").length,
          groupedIssues: ranked.optimizeIssues.map((item) => item.card)
        },
        report: latestReport
      },
      findings: scanResult.findings,
      rejected: scanResult.rejected,
      snapshot,
      issueBindings
    };
  }

  private resolveSelection(run: SmartCheckInternalRun, selectedIssueIds: string[]): {
    cleanupSelection: string[];
    optimizationActions: OptimizationActionSuggestion[];
  } {
    const selectedBindings = (selectedIssueIds.length ? selectedIssueIds : [run.publicRun.summary.recommendedIssue?.id ?? ""])
      .map((id) => run.issueBindings.get(id))
      .filter((item): item is RankedIssue => Boolean(item));
    const cleanupSelection = [...new Set(selectedBindings.flatMap((item) => item.cleanupFindingIds))];
    const optimizationActions = dedupeOptimizationActions(selectedBindings.flatMap((item) => item.optimizationActions));
    return { cleanupSelection, optimizationActions };
  }

  private async captureAndStoreSnapshot(source: SystemSnapshot["source"]): Promise<SystemSnapshot | undefined> {
    try {
      const snapshot = await this.deps.systemDiagnostics.captureSnapshot({ source, sampleCount: 1, sampleIntervalMs: 400 });
      this.deps.db.addSystemSnapshot(snapshot);
      return snapshot;
    } catch {
      return undefined;
    }
  }
}
