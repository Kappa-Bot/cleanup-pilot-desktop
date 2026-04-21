import path from "path";
import { app, BrowserWindow } from "electron";
import { AppDatabase } from "./db";
import { ConfigStore } from "./configStore";
import { registerIpcHandlers } from "./ipc";
import { ScanEngine } from "./scanEngine";
import { CleanupEngine } from "./cleanupEngine";
import { QuarantineManager } from "./quarantineManager";
import { DuplicateEngine } from "./duplicateEngine";
import { DriverScanService } from "./driverScanService";
import { SchedulerService } from "./schedulerService";
import { AIAdvisorService } from "./aiAdvisorService";
import { applyMachineDefaults } from "./machineProfileService";
import { normalizeProtectionPreferences } from "./protectionPreferences";
import { DriverSuppressionPreferences } from "./types";
import { ProcessProfiler } from "./processProfiler";
import { StartupAnalyzer } from "./startupAnalyzer";
import { ServiceAnalyzer } from "./serviceAnalyzer";
import { TaskSchedulerAnalyzer } from "./taskSchedulerAnalyzer";
import { DiskIoAnalyzer } from "./diskIoAnalyzer";
import { MemoryAnalyzer } from "./memoryAnalyzer";
import { SystemDiagnostics } from "./systemDiagnostics";
import { PerformanceMonitor } from "./performanceMonitor";
import { PerformanceSampler } from "./performanceSampler";
import { OptimizationManager } from "./optimizationManager";
import { SystemDoctor } from "./systemDoctor";
import { IssueRankingService } from "./issueRankingService";
import { SmartCheckService } from "./smartCheckService";
import { HomeSummaryService } from "./homeSummaryService";
import { CoverageCatalogService } from "./coverageCatalogService";
import { TrustExplainerService } from "./trustExplainerService";
import { DecisionFlowService } from "./decisionFlowService";

const isDev = !app.isPackaged;
const trustedDevOrigin = "http://localhost:5173";

function isTrustedNavigationUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (isDev) {
      return parsed.origin === trustedDevOrigin;
    }
    return parsed.protocol === "file:";
  } catch {
    return false;
  }
}

function installWindowGuards(window: BrowserWindow): void {
  const { webContents } = window;

  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedNavigationUrl(targetUrl)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event, targetUrl) => {
    if (!isTrustedNavigationUrl(targetUrl)) {
      event.preventDefault();
    }
  });
  webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: isDev,
      allowRunningInsecureContent: false
    }
  });

  installWindowGuards(window);

  if (isDev) {
    await window.loadURL("http://localhost:5173");
  } else {
    await window.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

async function bootstrap(): Promise<void> {
  const configStore = new ConfigStore();
  const aiAdvisorService = new AIAdvisorService();
  const tuningResult = await applyMachineDefaults(configStore).catch(() => ({ applied: false, roots: [] as string[] }));
  if (tuningResult.applied) {
    console.log(`Machine defaults applied with ${tuningResult.roots.length} roots.`);
  }
  aiAdvisorService.warmupStartup();

  const db = new AppDatabase();
  await db.init();

  const quarantineManager = new QuarantineManager(db);
  await quarantineManager.init();
  const processProfiler = new ProcessProfiler();
  const startupAnalyzer = new StartupAnalyzer();
  const serviceAnalyzer = new ServiceAnalyzer();
  const taskSchedulerAnalyzer = new TaskSchedulerAnalyzer();
  const diskIoAnalyzer = new DiskIoAnalyzer();
  const memoryAnalyzer = new MemoryAnalyzer();
  const resolveDriverSuppressionPreferences = (): DriverSuppressionPreferences => ({
    ignoredInfNames: configStore.getAll().driverIgnoredInfNames,
    ignoredDeviceIds: configStore.getAll().driverIgnoredDeviceIds,
    hiddenSuggestionIds: configStore.getAll().driverHiddenSuggestionIds
  });
  const driverScanService = new DriverScanService({
    resolveSuppressionPreferences: resolveDriverSuppressionPreferences
  });
  const systemDiagnostics = new SystemDiagnostics({
    processProfiler,
    startupAnalyzer,
    serviceAnalyzer,
    taskSchedulerAnalyzer,
    diskIoAnalyzer,
    memoryAnalyzer,
    driverScanService
  });
  const performanceSampler = new PerformanceSampler({
    processProfiler
  });
  const performanceMonitor = new PerformanceMonitor({
    db,
    sampler: performanceSampler
  });
  const optimizationManager = new OptimizationManager({ db });
  const systemDoctor = new SystemDoctor({
    db,
    diagnostics: systemDiagnostics,
    startupAnalyzer,
    serviceAnalyzer,
    taskSchedulerAnalyzer
  });
  const sharedProtectionResolvers = {
    resolveProtectionPreferences: () => normalizeProtectionPreferences(configStore.getAll())
  };
  const scanEngine = new ScanEngine(sharedProtectionResolvers);
  const cleanupEngine = new CleanupEngine(sharedProtectionResolvers);
  const duplicateEngine = new DuplicateEngine(sharedProtectionResolvers);
  const issueRankingService = new IssueRankingService();
  const smartCheckService = new SmartCheckService({
    db,
    configStore,
    scanEngine,
    cleanupEngine,
    quarantineManager,
    duplicateEngine,
    driverScanService,
    startupAnalyzer,
    serviceAnalyzer,
    taskSchedulerAnalyzer,
    processProfiler,
    systemDiagnostics,
    optimizationManager,
    issueRankingService
  });
  const homeSummaryService = new HomeSummaryService(smartCheckService);
  const coverageCatalogService = new CoverageCatalogService();
  const trustExplainerService = new TrustExplainerService();
  const decisionFlowService = new DecisionFlowService({
    db,
    smartCheckService,
    quarantineManager,
    optimizationManager
  });

  registerIpcHandlers({
    db,
    configStore,
    scanEngine,
    cleanupEngine,
    quarantineManager,
    duplicateEngine,
    driverScanService,
    schedulerService: new SchedulerService(db),
    aiAdvisorService: new AIAdvisorService({
      resolveProtectionPreferences: () => normalizeProtectionPreferences(configStore.getAll())
    }),
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
    trustExplainerService,
    decisionFlowService
  });

  if (configStore.getAll().performanceAutoSnapshotOnLaunch) {
    void systemDiagnostics
      .captureSnapshot({ source: "app_start", sampleCount: 2, sampleIntervalMs: 1_000 })
      .then((snapshot) => {
        db.addSystemSnapshot(snapshot);
      })
      .catch(() => undefined);
  }

  await createMainWindow();
}

app.whenReady().then(() => {
  void bootstrap().catch((error) => {
    // Surface startup issues clearly instead of unhandled promise warnings.
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error("Bootstrap failed:", message);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
