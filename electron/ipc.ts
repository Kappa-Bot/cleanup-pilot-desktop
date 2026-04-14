import fs from "fs";
import path from "path";
import { ipcMain, IpcMainInvokeEvent, shell } from "electron";
import { randomUUID } from "crypto";
import { AppDatabase } from "./db";
import { ConfigStore } from "./configStore";
import { ScanEngine, createEmptyCategoryBuckets } from "./scanEngine";
import { CleanupEngine } from "./cleanupEngine";
import { QuarantineManager } from "./quarantineManager";
import { DuplicateEngine } from "./duplicateEngine";
import { scanStorageInsights } from "./storageInsights";
import { DriverScanService } from "./driverScanService";
import { SchedulerService } from "./schedulerService";
import { AIAdvisorService } from "./aiAdvisorService";
import { checkForUpdates } from "./updateChecker";
import { StartupAnalyzer } from "./startupAnalyzer";
import { ServiceAnalyzer } from "./serviceAnalyzer";
import { TaskSchedulerAnalyzer } from "./taskSchedulerAnalyzer";
import { DiskIoAnalyzer } from "./diskIoAnalyzer";
import { MemoryAnalyzer } from "./memoryAnalyzer";
import { ProcessProfiler } from "./processProfiler";
import { SystemDiagnostics } from "./systemDiagnostics";
import { PerformanceMonitor } from "./performanceMonitor";
import { OptimizationManager } from "./optimizationManager";
import { SystemDoctor } from "./systemDoctor";
import { HomeSummaryService } from "./homeSummaryService";
import { SmartCheckService } from "./smartCheckService";
import { CoverageCatalogService } from "./coverageCatalogService";
import { TrustExplainerService } from "./trustExplainerService";
import {
  AIAdvisorAnalysisRequest,
  CoverageCatalogResponse,
  DriverCandidate,
  DriverScanResponse,
  DuplicateGroup,
  DuplicateSelection,
  OptimizationActionSuggestion,
  ScanResultsResponse,
  ScanStartRequest,
  ScanSummary,
  SchedulerSettings,
  SettingsPayload
} from "./types";

async function openStartupLocation(args: {
  source: "registry_run" | "startup_folder" | "scheduled_task" | "service" | "shell_extension" | "boot_driver";
  targetPath?: string;
  originLocation?: string;
}): Promise<{ opened: boolean; mode: string }> {
  const targetPath = String(args.targetPath ?? "").trim();
  const originLocation = String(args.originLocation ?? "").trim();

  if (targetPath && fs.existsSync(targetPath)) {
    shell.showItemInFolder(targetPath);
    return { opened: true, mode: "file_target" };
  }

  if (args.source === "startup_folder" && originLocation && fs.existsSync(originLocation)) {
    const error = await shell.openPath(originLocation);
    return { opened: !error, mode: "startup_folder" };
  }

  if (args.source === "scheduled_task") {
    const error = await shell.openPath(path.join(process.env.windir ?? "C:\\Windows", "System32", "taskschd.msc"));
    return { opened: !error, mode: "task_scheduler" };
  }

  if (args.source === "service") {
    const error = await shell.openPath(path.join(process.env.windir ?? "C:\\Windows", "System32", "services.msc"));
    return { opened: !error, mode: "services" };
  }

  if (args.source === "registry_run") {
    const error = await shell.openPath(path.join(process.env.windir ?? "C:\\Windows", "regedit.exe"));
    return { opened: !error, mode: "registry" };
  }

  if (originLocation && fs.existsSync(originLocation)) {
    shell.showItemInFolder(originLocation);
    return { opened: true, mode: "origin_target" };
  }

  return { opened: false, mode: "unresolved" };
}

interface Dependencies {
  db: AppDatabase;
  configStore: ConfigStore;
  scanEngine: ScanEngine;
  cleanupEngine: CleanupEngine;
  quarantineManager: QuarantineManager;
  duplicateEngine: DuplicateEngine;
  driverScanService: DriverScanService;
  schedulerService: SchedulerService;
  aiAdvisorService: AIAdvisorService;
  startupAnalyzer: StartupAnalyzer;
  serviceAnalyzer: ServiceAnalyzer;
  taskSchedulerAnalyzer: TaskSchedulerAnalyzer;
  diskIoAnalyzer: DiskIoAnalyzer;
  memoryAnalyzer: MemoryAnalyzer;
  processProfiler: ProcessProfiler;
  systemDiagnostics: SystemDiagnostics;
  performanceMonitor: PerformanceMonitor;
  optimizationManager: OptimizationManager;
  systemDoctor: SystemDoctor;
  homeSummaryService: HomeSummaryService;
  smartCheckService: SmartCheckService;
  coverageCatalogService: CoverageCatalogService;
  trustExplainerService: TrustExplainerService;
}

interface ScanRunState {
  runId: string;
  request: ScanStartRequest;
  status: "running" | "completed" | "canceled" | "failed";
  startedAt: number;
  canceled: boolean;
  findings: ScanResultsResponse["findings"];
  rejected: ScanResultsResponse["rejected"];
  summary: ScanSummary;
  error?: string;
}

function createRunningSummary(runId: string): ScanSummary {
  return {
    runId,
    status: "running",
    startedAt: Date.now(),
    processedItems: 0,
    findingsCount: 0,
    totalCandidateBytes: 0,
    protectedRejectedCount: 0,
    categories: createEmptyCategoryBuckets()
  };
}

export function registerIpcHandlers(deps: Dependencies): void {
  const {
    db,
    configStore,
    scanEngine,
    cleanupEngine,
    quarantineManager,
    duplicateEngine,
    driverScanService,
    schedulerService,
    aiAdvisorService,
    startupAnalyzer,
    serviceAnalyzer,
    taskSchedulerAnalyzer,
    diskIoAnalyzer,
    memoryAnalyzer,
    processProfiler,
    systemDiagnostics,
    performanceMonitor,
    optimizationManager,
    systemDoctor,
    homeSummaryService,
    smartCheckService,
    coverageCatalogService,
    trustExplainerService
  } = deps;

  const scanRuns = new Map<string, ScanRunState>();
  let latestDuplicateGroups: DuplicateGroup[] = [];
  let latestDriverCandidates = new Map<string, DriverCandidate>();

  ipcMain.handle("settings.get", async () => configStore.getAll());

  ipcMain.handle("settings.update", async (_event, payload: SettingsPayload) => {
    return configStore.update(payload);
  });

  ipcMain.handle("scan.start", async (event: IpcMainInvokeEvent, request: ScanStartRequest) => {
    const runId = randomUUID();
    const runState: ScanRunState = {
      runId,
      request,
      status: "running",
      startedAt: Date.now(),
      canceled: false,
      findings: [],
      rejected: [],
      summary: createRunningSummary(runId)
    };
    scanRuns.set(runId, runState);

    void (async () => {
      try {
        const result = await scanEngine.run(runId, request, {
          isCanceled: () => runState.canceled,
          onProgress: (progress) => {
            runState.summary = {
              ...runState.summary,
              status: progress.stage === "canceled" ? "canceled" : runState.summary.status,
              processedItems: progress.processedItems,
              findingsCount: progress.findingsCount
            };
            event.sender.send("scan.progress", progress);
          }
        });

        runState.findings = result.findings;
        runState.rejected = result.rejected;
        runState.summary = result.summary;
        runState.status = result.summary.status;
        db.log("scan.completed", JSON.stringify({ runId, findings: result.findings.length }));
      } catch (error) {
        runState.status = "failed";
        runState.error = error instanceof Error ? error.message : "Scan failed";
        runState.summary = {
          ...runState.summary,
          status: "failed",
          finishedAt: Date.now()
        };
        event.sender.send("scan.progress", {
          runId,
          stage: "failed",
          processedItems: runState.summary.processedItems,
          findingsCount: runState.summary.findingsCount,
          percent: 100,
          etaSec: 0
        });
        db.log("scan.failed", JSON.stringify({ runId, error: runState.error }));
      }
    })();

    return { runId };
  });

  ipcMain.handle("scan.cancel", async (_event, args: { runId: string }) => {
    const run = scanRuns.get(args.runId);
    if (!run) {
      return { ok: false };
    }

    run.canceled = true;
    db.log("scan.cancel", JSON.stringify({ runId: args.runId }));
    return { ok: true };
  });

  ipcMain.handle("scan.results", async (_event, args: { runId: string }) => {
    const run = scanRuns.get(args.runId);
    if (!run) {
      return {
        status: "failed",
        findings: [],
        rejected: [],
        summary: createRunningSummary(args.runId),
        error: "Scan run not found."
      } satisfies ScanResultsResponse;
    }

    return {
      status: run.status,
      findings: run.findings,
      rejected: run.rejected,
      summary: run.summary,
      error: run.error
    } satisfies ScanResultsResponse;
  });

  ipcMain.handle(
    "cleanup.preview",
    async (_event, args: { runId: string; selection: string[] }) => {
      const run = scanRuns.get(args.runId);
      if (!run) {
        throw new Error("Scan run not found.");
      }

      return cleanupEngine.preview(run.findings, args.selection);
    }
  );

  ipcMain.handle(
    "cleanup.execute",
    async (
      event,
      args: { runId: string; selection: string[]; mode: "quarantine"; executionId?: string }
    ) => {
      const run = scanRuns.get(args.runId);
      if (!run) {
        throw new Error("Scan run not found.");
      }

      if (args.mode !== "quarantine") {
        throw new Error("Only quarantine mode is supported.");
      }

      if (configStore.getAll().performanceAutoSnapshotOnCleanup) {
        void systemDiagnostics
          .captureSnapshot({ source: "pre_cleanup", sampleCount: 2, sampleIntervalMs: 750 })
          .then((snapshot) => db.addSystemSnapshot(snapshot))
          .catch(() => undefined);
      }

      const executionId = args.executionId ?? randomUUID();
      const result = await cleanupEngine.execute(run.findings, args.selection, quarantineManager, {
        runId: args.runId,
        executionId,
        onProgress: (progress) => {
          event.sender.send("cleanup.progress", progress);
        }
      });
      if (result.movedIds.length > 0) {
        const movedSet = new Set(result.movedIds);
        run.findings = run.findings.filter((item) => !movedSet.has(item.id));
        const categories = createEmptyCategoryBuckets();
        let findingsCount = 0;
        for (const finding of run.findings) {
          const entryCount = finding.entryCount ?? 1;
          categories[finding.category].count += entryCount;
          categories[finding.category].bytes += finding.sizeBytes;
          findingsCount += entryCount;
        }
        run.summary = {
          ...run.summary,
          findingsCount,
          totalCandidateBytes: run.findings.reduce((sum, item) => sum + item.sizeBytes, 0),
          categories
        };
      }
      db.log(
        "cleanup.execute",
        JSON.stringify({ runId: args.runId, moved: result.movedCount, failed: result.failedCount })
      );
      if (configStore.getAll().performanceAutoSnapshotOnCleanup) {
        void systemDiagnostics
          .captureSnapshot({ source: "post_cleanup", sampleCount: 2, sampleIntervalMs: 750 })
          .then((snapshot) => db.addSystemSnapshot(snapshot))
          .catch(() => undefined);
      }
      return result;
    }
  );

  ipcMain.handle("quarantine.list", async (_event, args?: { limit?: number; offset?: number }) => {
    const limit = Math.max(1, Math.min(500, Math.floor(Number(args?.limit ?? 200))));
    const offset = Math.max(0, Math.floor(Number(args?.offset ?? 0)));
    const items = db.listQuarantineItems(limit, offset);
    const totalCount = db.countQuarantineItems();
    return {
      items,
      totalCount,
      activeCount: db.countActiveQuarantineItems(),
      hasMore: offset + items.length < totalCount,
      nextOffset: offset + items.length
    };
  });

  ipcMain.handle("quarantine.restore", async (_event, args: { itemIds: string[] }) => {
    const result = await quarantineManager.restoreItems(args.itemIds);
    db.log("quarantine.restore", JSON.stringify({ itemIds: args.itemIds, ...result }));
    return result;
  });

  ipcMain.handle("quarantine.purge", async (_event, args: { olderThanDays?: number }) => {
    const days = Math.max(0, Number(args.olderThanDays ?? configStore.getAll().quarantineRetentionDays));
    const result = await quarantineManager.purge(days, {
      onProgress: (payload) => {
        _event.sender.send("quarantine.purge.progress", payload);
      }
    });
    db.log("quarantine.purge", JSON.stringify({ days, ...result }));
    return result;
  });

  ipcMain.handle("quarantine.purge.cancel", async () => {
    const ok = quarantineManager.requestPurgeCancel();
    if (ok) {
      db.log("quarantine.purge.cancel", JSON.stringify({ ok: true }));
    }
    return { ok };
  });

  ipcMain.handle("duplicates.scan", async (_event, args: { roots: string[]; minSizeBytes?: number }) => {
    latestDuplicateGroups = await duplicateEngine.scan(args.roots, args.minSizeBytes ?? 1);
    db.log("duplicates.scan", JSON.stringify({ groups: latestDuplicateGroups.length }));
    return { groups: latestDuplicateGroups };
  });

  ipcMain.handle(
    "duplicates.resolve.preview",
    async (_event, args: { groupSelections: DuplicateSelection[] }) => {
      return duplicateEngine.previewResolution(latestDuplicateGroups, args.groupSelections);
    }
  );

  ipcMain.handle(
    "duplicates.resolve.execute",
    async (_event, args: { groupSelections: DuplicateSelection[] }) => {
      const result = await duplicateEngine.executeResolution(
        latestDuplicateGroups,
        args.groupSelections,
        quarantineManager
      );
      db.log("duplicates.resolve.execute", JSON.stringify(result));
      return result;
    }
  );

  ipcMain.handle(
    "storage.scan",
    async (_event, args: { roots: string[]; includeInstalledApps: boolean }) => {
      const result = await scanStorageInsights(args.roots, args.includeInstalledApps);
      db.log("storage.scan", JSON.stringify({ roots: args.roots.length }));
      return result;
    }
  );

  ipcMain.handle("drivers.scan", async () => {
    const result: DriverScanResponse = await driverScanService.scan();
    latestDriverCandidates = new Map(result.updateCandidates.map((item) => [item.id, item]));
    db.log("drivers.scan", JSON.stringify({ devices: result.devices.length, candidates: result.updateCandidates.length }));
    return result;
  });

  ipcMain.handle("drivers.openOfficial", async (_event, args: { candidateId: string }) => {
    const candidate = latestDriverCandidates.get(args.candidateId);
    if (!candidate) {
      throw new Error("Driver candidate not found. Run driver scan first.");
    }
    const result = await driverScanService.openOfficial(candidate);
    db.log("drivers.openOfficial", JSON.stringify({ candidateId: args.candidateId, opened: result.opened }));
    return result;
  });

  ipcMain.handle("drivers.lookupOfficialAi", async (_event, args: { candidateId: string; open?: boolean }) => {
    const candidate = latestDriverCandidates.get(args.candidateId);
    if (!candidate) {
      throw new Error("Driver candidate not found. Run driver scan first.");
    }
    const result = await driverScanService.lookupOfficialWithAi(candidate, { open: Boolean(args.open) });
    db.log(
      "drivers.lookupOfficialAi",
      JSON.stringify({
        candidateId: args.candidateId,
        provider: result.lookup.provider,
        domain: result.lookup.officialDomain,
        opened: result.opened
      })
    );
    return result;
  });

  ipcMain.handle("drivers.openWindowsUpdate", async () => {
    const result = await driverScanService.openWindowsUpdate();
    db.log("drivers.openWindowsUpdate", JSON.stringify(result));
    return result;
  });

  ipcMain.handle("ai.models", async () => {
    const result = await aiAdvisorService.listModels();
    db.log("ai.models", JSON.stringify({ count: result.models.length, recommended: result.decision.recommendedModel }));
    return result;
  });

  ipcMain.handle("ai.analyze", async (_event, request: Partial<AIAdvisorAnalysisRequest> | undefined) => {
    const safeRequest: AIAdvisorAnalysisRequest = {
      roots: Array.isArray(request?.roots) ? request.roots : [],
      maxFiles: Number.isFinite(Number(request?.maxFiles)) ? Number(request?.maxFiles) : undefined,
      model: typeof request?.model === "string" ? request.model : undefined,
      provider:
        request?.provider === "local" || request?.provider === "cerebras" || request?.provider === "auto"
          ? request.provider
          : undefined,
      mode: request?.mode === "fast" || request?.mode === "standard" ? request.mode : undefined
    };
    const result = await aiAdvisorService.analyze(safeRequest);
    db.log(
      "ai.analyze",
      JSON.stringify({
        modelUsed: result.modelUsed ?? result.decision.recommendedModel,
        providerUsed: result.providerUsed ?? result.decision.provider,
        modelError: Boolean(result.modelError),
        scannedFiles: result.summary.scannedFileCount,
        appDataCandidates: result.summary.appDataCandidates.length
      })
    );
    return result;
  });

  ipcMain.handle("home.snapshot", async () => {
    return {
      snapshot: await homeSummaryService.getSnapshot()
    };
  });

  ipcMain.handle("smartcheck.run", async (_event, args?: { mode?: "fast" | "balanced" }) => {
    return smartCheckService.run(args?.mode === "balanced" ? "balanced" : "fast");
  });

  ipcMain.handle("smartcheck.current", async (_event, args: { runId: string }) => {
    return smartCheckService.current(args.runId);
  });

  ipcMain.handle("smartcheck.preview", async (_event, args: { runId: string; selectedIssueIds: string[] }) => {
    return smartCheckService.preview(args.runId, Array.isArray(args.selectedIssueIds) ? args.selectedIssueIds : []);
  });

  ipcMain.handle("smartcheck.execute", async (_event, args: { runId: string; selectedIssueIds: string[] }) => {
    return smartCheckService.execute(args.runId, Array.isArray(args.selectedIssueIds) ? args.selectedIssueIds : []);
  });

  ipcMain.handle("coverage.catalog", async () => {
    return coverageCatalogService.getCatalog();
  });

  ipcMain.handle("trust.explainFinding", async (_event, args: { findingId: string }) => {
    const finding = [...scanRuns.values()].flatMap((run) => run.findings).find((item) => item.id === args.findingId);
    if (finding) {
      return trustExplainerService.explainFinding(finding);
    }
    const rejection = [...scanRuns.values()].flatMap((run) => run.rejected).find((item) => item.path === args.findingId);
    if (rejection) {
      return trustExplainerService.explainBlocked(rejection);
    }
    const smartCheckFinding = smartCheckService.findFindingById(args.findingId);
    if (smartCheckFinding && "id" in smartCheckFinding) {
      return trustExplainerService.explainFinding(smartCheckFinding);
    }
    if (smartCheckFinding) {
      return trustExplainerService.explainBlocked(smartCheckFinding);
    }
    throw new Error("Finding not found for trust explanation.");
  });

  ipcMain.handle("scheduler.set", async (_event, settings: SchedulerSettings) => {
    const result = schedulerService.set(settings);
    db.log("scheduler.set", JSON.stringify(result));
    return { ok: true, scheduler: result };
  });

  ipcMain.handle("scheduler.get", async () => {
    return schedulerService.get();
  });

  ipcMain.handle("updates.check", async () => {
    const settings = configStore.getAll();
    return checkForUpdates(settings.updatesFeedUrl);
  });

  ipcMain.handle("performance.monitor.start", async (event, args?: { sampleIntervalMs?: number }) => {
    return performanceMonitor.start(args?.sampleIntervalMs ?? configStore.getAll().performanceLiveSampleIntervalMs, (frame) => {
      event.sender.send("performance.monitor.frame", frame);
    });
  });

  ipcMain.handle("performance.monitor.current", async (_event, args: { sessionId: string }) => {
    return performanceMonitor.current(args.sessionId);
  });

  ipcMain.handle("performance.monitor.stop", async (_event, args: { sessionId: string }) => {
    return performanceMonitor.stop(args.sessionId);
  });

  ipcMain.handle("diagnostics.snapshot.capture", async (_event, args: { source: Parameters<SystemDiagnostics["captureSnapshot"]>[0]["source"] }) => {
    const snapshot = await systemDiagnostics.captureSnapshot({ source: args.source });
    db.addSystemSnapshot(snapshot);
    const settings = configStore.getAll();
    db.purgeSystemSnapshotsOlderThan(Date.now() - settings.performanceSnapshotRetentionDays * 24 * 60 * 60 * 1000);
    db.purgePerformanceSessionsOlderThan(Date.now() - settings.performanceSnapshotRetentionDays * 24 * 60 * 60 * 1000);
    db.purgeOptimizationChangesOlderThan(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return { snapshot };
  });

  ipcMain.handle("diagnostics.snapshot.history", async (_event, args?: { limit?: number; from?: number; to?: number }) => {
    return {
      snapshots: db.listSystemSnapshotHistory(args)
    };
  });

  ipcMain.handle("startup.scan", async () => {
    const processFrame = await processProfiler.captureSample(750);
    return startupAnalyzer.scan(processFrame.topProcesses);
  });

  ipcMain.handle("startup.openLocation", async (_event, args) => {
    return openStartupLocation(args);
  });

  ipcMain.handle("services.scan", async () => {
    return serviceAnalyzer.scan();
  });

  ipcMain.handle("tasks.scan", async () => {
    return taskSchedulerAnalyzer.scan();
  });

  ipcMain.handle("diskio.snapshot", async () => {
    const frame = await processProfiler.captureSample(750);
    return diskIoAnalyzer.analyze(frame);
  });

  ipcMain.handle("memory.snapshot", async () => {
    const frame = await processProfiler.captureSample(750);
    const snapshot = await systemDiagnostics.captureSnapshot({ source: "manual", sampleCount: 2, sampleIntervalMs: 500 });
    return memoryAnalyzer.analyze(
      {
        ...frame,
        memoryHogs: frame.memoryHogs
      },
      snapshot.machine.totalRamBytes,
      [frame]
    );
  });

  ipcMain.handle("optimizations.preview", async (_event, args: { actions: OptimizationActionSuggestion[] }) => {
    return optimizationManager.preview(args.actions);
  });

  ipcMain.handle("optimizations.execute", async (_event, args: { actions: OptimizationActionSuggestion[] }) => {
    if (configStore.getAll().performanceAutoSnapshotOnOptimization) {
      void systemDiagnostics
        .captureSnapshot({ source: "pre_optimization", sampleCount: 2, sampleIntervalMs: 750 })
        .then((snapshot) => db.addSystemSnapshot(snapshot))
        .catch(() => undefined);
    }
    const result = await optimizationManager.execute(args.actions);
    if (configStore.getAll().performanceAutoSnapshotOnOptimization) {
      void systemDiagnostics
        .captureSnapshot({ source: "post_optimization", sampleCount: 2, sampleIntervalMs: 750 })
        .then((snapshot) => db.addSystemSnapshot(snapshot))
        .catch(() => undefined);
    }
    return result;
  });

  ipcMain.handle("optimizations.history.list", async (_event, args?: { limit?: number }) => {
    return {
      changes: optimizationManager.listHistory(args?.limit)
    };
  });

  ipcMain.handle("optimizations.restore", async (_event, args: { changeIds: string[] }) => {
    return optimizationManager.restore(args.changeIds);
  });

  ipcMain.handle("doctor.diagnose", async (_event, args?: { snapshotId?: string; includeHistory?: boolean }) => {
    return systemDoctor.diagnose(args);
  });

  ipcMain.handle("drivers.performance.scan", async () => {
    return { summary: await driverScanService.scanPerformanceSummary() };
  });
}
