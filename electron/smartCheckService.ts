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
  CleanupCategory,
  CleanupExecuteResponse,
  CleanupPreviewResponse,
  HomeSummarySnapshot,
  OptimizationActionSuggestion,
  OptimizationExecutionResult,
  OptimizationPreviewResponse,
  ProductIssueCard,
  ProtectedFindingRejection,
  ScanFinding,
  SmartCheckRun,
  SystemSnapshot
} from "./types";

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

interface SmartCheckInternalRun {
  publicRun: SmartCheckRun;
  findings: ScanFinding[];
  rejected: ProtectedFindingRejection[];
  snapshot?: SystemSnapshot;
  issueBindings: Map<string, RankedIssue>;
}

function emptySummary(): HomeSummarySnapshot {
  return {
    generatedAt: Date.now(),
    healthScore: 82,
    reclaimableBytes: 0,
    primaryBottleneck: "unknown",
    safetyState: "protected",
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

  async preview(runId: string, selectedIssueIds: string[]): Promise<{
    cleanupPreview?: CleanupPreviewResponse;
    optimizationPreview?: OptimizationPreviewResponse;
    warnings: string[];
  }> {
    const run = this.getRun(runId);
    const { cleanupSelection, optimizationActions } = this.resolveSelection(run, selectedIssueIds);
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

    return { cleanupPreview, optimizationPreview, warnings };
  }

  async execute(runId: string, selectedIssueIds: string[]): Promise<{
    cleanup?: CleanupExecuteResponse;
    optimizations?: OptimizationExecutionResult;
    warnings: string[];
  }> {
    const run = this.getRun(runId);
    const { cleanupSelection, optimizationActions } = this.resolveSelection(run, selectedIssueIds);
    const warnings: string[] = [];
    let cleanup: CleanupExecuteResponse | undefined;
    let optimizations: OptimizationExecutionResult | undefined;

    if (!cleanupSelection.length && !optimizationActions.length) {
      return {
        warnings: ["The selected Smart Check issues do not map to an executable cleanup or optimization action yet."]
      };
    }

    const settings = this.deps.configStore.getAll();
    if (cleanupSelection.length && settings.performanceAutoSnapshotOnCleanup) {
      await this.captureAndStoreSnapshot("pre_cleanup");
    }
    if (optimizationActions.length && settings.performanceAutoSnapshotOnOptimization) {
      await this.captureAndStoreSnapshot("pre_optimization");
    }

    if (cleanupSelection.length) {
      cleanup = await this.deps.cleanupEngine.execute(run.findings, cleanupSelection, this.deps.quarantineManager);
      if (cleanup.movedIds.length) {
        const movedSet = new Set(cleanup.movedIds);
        run.findings = run.findings.filter((item) => !movedSet.has(item.id));
      }
    }
    if (optimizationActions.length) {
      optimizations = await this.deps.optimizationManager.execute(optimizationActions);
    }

    if (cleanupSelection.length && settings.performanceAutoSnapshotOnCleanup) {
      await this.captureAndStoreSnapshot("post_cleanup");
    }
    if (optimizationActions.length && settings.performanceAutoSnapshotOnOptimization) {
      await this.captureAndStoreSnapshot("post_optimization");
    }

    if (cleanup?.failedCount) {
      warnings.push(`${cleanup.failedCount} cleanup task${cleanup.failedCount === 1 ? "" : "s"} failed during Smart Check execution.`);
    }
    if (optimizations?.failedCount) {
      warnings.push(`${optimizations.failedCount} optimization change${optimizations.failedCount === 1 ? "" : "s"} failed during Smart Check execution.`);
    }

    return { cleanup, optimizations, warnings };
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
    const scanResult = await this.deps.scanEngine.run(
      `smartcheck:${runId}`,
      {
        preset: scanPreset,
        categories,
        roots
      },
      {
        isCanceled: () => false,
        onProgress: () => undefined
      }
    );

    const processFrame = await this.deps.processProfiler.captureSample(mode === "balanced" ? 900 : 600);
    const [startup, services, tasks, snapshot, driverScan, driverPerformance] = await Promise.all([
      this.deps.startupAnalyzer.scan(processFrame.topProcesses),
      this.deps.serviceAnalyzer.scan(),
      this.deps.taskSchedulerAnalyzer.scan(),
      this.deps.systemDiagnostics.captureSnapshot({
        source: "manual",
        sampleCount: mode === "balanced" ? 2 : 1,
        sampleIntervalMs: mode === "balanced" ? 700 : 500
      }),
      this.deps.driverScanService.scan(),
      this.deps.driverScanService.scanPerformanceSummary()
    ]);
    this.deps.db.addSystemSnapshot(snapshot);

    const ranked = this.deps.issueRankingService.rankIssues({
      findings: scanResult.findings,
      rejected: scanResult.rejected,
      startupActions: startup.suggestedActions,
      startupSummary: startup.summary,
      serviceActions: services.suggestedActions,
      taskActions: tasks.suggestedActions,
      snapshot,
      driverScan,
      driverPerformance
    });

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
        summary: ranked.summary,
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
        }
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

  private async captureAndStoreSnapshot(source: SystemSnapshot["source"]): Promise<void> {
    const snapshot = await this.deps.systemDiagnostics.captureSnapshot({ source, sampleCount: 1, sampleIntervalMs: 400 });
    this.deps.db.addSystemSnapshot(snapshot);
  }
}
