import type { Page } from "@playwright/test";

interface DesktopApiScenario {
  settings: Record<string, unknown>;
  scheduler: Record<string, unknown>;
  scanResults: Record<string, unknown>;
  cleanupPreview: Record<string, unknown>;
  cleanupExecution: Record<string, unknown>;
  performance: {
    sessionId: string;
    capabilities: Record<string, unknown>;
    frames: Record<string, unknown>[];
    summary: Record<string, unknown>;
    snapshot: Record<string, unknown>;
    driverSummary: Record<string, unknown>;
  };
  quarantineItems: Array<Record<string, unknown>>;
}

function buildDefaultScenario(): DesktopApiScenario {
  const now = Date.now();
  const findings = [
    {
      id: "temp-1",
      path: "C:\\Users\\me\\AppData\\Local\\Temp\\leftover.tmp",
      category: "temp",
      sizeBytes: 2_048,
      risk: "low",
      reason: "Temporary file path",
      sourceRuleId: "temp-path",
      selectedByDefault: true,
      modifiedAt: now - 60_000
    },
    {
      id: "cache-1",
      path: "C:\\Users\\me\\AppData\\Local\\Cache\\bundle.bin",
      category: "cache",
      sizeBytes: 8_192,
      risk: "medium",
      reason: "Cache residue",
      sourceRuleId: "cache-path",
      selectedByDefault: true,
      modifiedAt: now - 120_000
    },
    {
      id: "log-1",
      path: "C:\\Users\\me\\AppData\\Local\\Logs\\app.log",
      category: "logs",
      sizeBytes: 4_096,
      risk: "low",
      reason: "Log residue",
      sourceRuleId: "log-path",
      selectedByDefault: false,
      modifiedAt: now - 180_000
    }
  ];

  return {
    settings: {
      defaultPreset: "standard",
      defaultCategories: ["temp", "cache", "logs"],
      customRoots: ["C:\\\\"],
      neverCleanupPaths: [],
      neverCleanupApps: [],
      driverIgnoredInfNames: [],
      driverIgnoredDeviceIds: [],
      driverHiddenSuggestionIds: [],
      driverAutoSuppressSafeSuggestions: true,
      driverAutoSuppressionApplied: false,
      aiProvider: "auto",
      scheduleEnabled: false,
      scheduleDayOfWeek: 6,
      scheduleTime: "10:00",
      quarantineRetentionDays: 30,
      reducedMotion: false,
      highContrast: false,
      compactUi: false,
      includeInstalledApps: true,
      driverToolsEnabled: true,
      updatesFeedUrl: "",
      performanceSnapshotRetentionDays: 30,
      performanceAutoSnapshotOnLaunch: true,
      performanceAutoSnapshotOnCleanup: true,
      performanceAutoSnapshotOnOptimization: true,
      performanceLiveSampleIntervalMs: 2000,
      performancePinnedMonitoring: false
    },
    scheduler: {
      enabled: false,
      cadence: "weekly",
      dayOfWeek: 6,
      time: "10:00"
    },
    scanResults: {
      status: "completed",
      findings,
      rejected: [],
      summary: {
        runId: "run-1",
        status: "completed",
        startedAt: now - 15_000,
        finishedAt: now - 2_000,
        processedItems: findings.length,
        findingsCount: findings.length,
        totalCandidateBytes: findings.reduce((sum, item) => sum + Number(item.sizeBytes ?? 0), 0),
        protectedRejectedCount: 0,
        categories: {
          temp: { count: 1, bytes: 2048 },
          cache: { count: 1, bytes: 8192 },
          logs: { count: 1, bytes: 4096 }
        }
      }
    },
    cleanupPreview: {
      totalBytes: 10_240,
      actionCount: 2,
      riskFlags: { highRiskCount: 0, mediumRiskCount: 1, blockedCount: 0 }
    },
    cleanupExecution: {
      movedCount: 2,
      failedCount: 0,
      freedBytes: 10_240,
      errors: [],
      movedIds: ["temp-1", "cache-1"],
      failedIds: []
    },
    performance: {
      sessionId: "perf-session-1",
      capabilities: {
        gpuSupported: true,
        diagnosticsEventLogSupported: true,
        taskDelaySupported: true,
        serviceDelayedAutoStartSupported: true,
        perProcessNetworkSupported: true
      },
      frames: [
        {
          sessionId: "perf-session-1",
          capturedAt: now - 4_000,
          cpuUsagePct: 42,
          ramUsedPct: 56,
          diskActivePct: 18,
          gpuUsagePct: 9,
          networkSendBytesPerSec: 256_000,
          networkReceiveBytesPerSec: 128_000,
          topProcesses: []
        },
        {
          sessionId: "perf-session-1",
          capturedAt: now - 1_000,
          cpuUsagePct: 58,
          ramUsedPct: 62,
          diskActivePct: 44,
          gpuUsagePct: 15,
          networkSendBytesPerSec: 768_000,
          networkReceiveBytesPerSec: 256_000,
          topProcesses: [
            {
              pid: 4242,
              processName: "RendererHost.exe",
              executablePath: "C:\\Program Files\\Cleanup Pilot\\RendererHost.exe",
              cpuPct: 58,
              workingSetBytes: 820 * 1024 * 1024,
              diskWriteBytesPerSec: 18 * 1024 * 1024
            }
          ]
        }
      ],
      summary: {
        sessionId: "perf-session-1",
        sampleIntervalMs: 2000,
        startedAt: now - 5_000,
        lastSampleAt: now - 1_000,
        sampleCount: 2
      },
      snapshot: {
        id: "snapshot-1",
        createdAt: now,
        source: "manual",
        bottleneck: { primary: "disk_io", confidence: 0.91 },
        cpu: { avgUsagePct: 58 },
        memory: { usedPct: 62 },
        diskIo: { activeTimePct: 44 },
        gpu: { totalUsagePct: 15 },
        startup: { impactScore: 24 }
      },
      driverSummary: {
        latencyRisk: "high",
        suspectedDrivers: [{ name: "ndis.sys", reason: ["DPC spikes"], confidence: 0.8 }],
        activeSignals: []
      }
    },
    quarantineItems: [
      {
        id: "q-1",
        category: "temp",
        sizeBytes: 1024,
        movedAt: now - 86_400_000,
        originalPath: "C:\\temp\\one.tmp",
        quarantinePath: "C:\\vault\\one.tmp",
        source: "scan",
        active: true
      },
      {
        id: "q-2",
        category: "cache",
        sizeBytes: 2048,
        movedAt: now - 172_800_000,
        originalPath: "C:\\temp\\two.tmp",
        quarantinePath: "C:\\vault\\two.tmp",
        source: "scan",
        active: true
      },
      {
        id: "q-3",
        category: "logs",
        sizeBytes: 4096,
        movedAt: now - 259_200_000,
        originalPath: "C:\\temp\\three.tmp",
        quarantinePath: "C:\\vault\\three.tmp",
        source: "scan",
        active: true
      }
    ]
  };
}

export async function installDesktopApiStub(page: Page, overrides: Partial<DesktopApiScenario> = {}): Promise<void> {
  const baseScenario = buildDefaultScenario();
  const scenario = {
    ...baseScenario,
    ...overrides,
    performance: {
      ...baseScenario.performance,
      ...(overrides.performance ?? {})
    }
  } as DesktopApiScenario;

  await page.addInitScript(
    ({ desktopApiScenario }) => {
      const scenarioState = desktopApiScenario as DesktopApiScenario;
      const scanResults = scenarioState.scanResults;
      const performance = scenarioState.performance;
      const quarantineItems = [...scenarioState.quarantineItems];

      const listQuarantine = async (_limit = 200, offset = 0) => {
        const pageSize = Number(_limit) || 200;
        const start = Number(offset) || 0;
        const items = quarantineItems.slice(start, start + pageSize);
        const nextOffset = start + items.length;
        return {
          items,
          totalCount: quarantineItems.length,
          activeCount: quarantineItems.length,
          hasMore: nextOffset < quarantineItems.length,
          nextOffset
        };
      };

      (window as Window & { desktopApi: any }).desktopApi = {
        getSettings: async () => scenarioState.settings,
        updateSettings: async (payload: Record<string, unknown>) => ({ ...scenarioState.settings, ...payload }),
        startScan: async () => ({ runId: "run-1" }),
        cancelScan: async () => ({ ok: true }),
        getScanResults: async () => scanResults,
        onScanProgress: () => () => undefined,
        previewCleanup: async () => scenarioState.cleanupPreview,
        executeCleanup: async () => scenarioState.cleanupExecution,
        onCleanupProgress: () => () => undefined,
        listQuarantine,
        restoreQuarantine: async () => ({ restoredCount: 0, failed: [] }),
        purgeQuarantine: async () => ({
          purgedCount: 0,
          freedBytes: 0,
          purgedGroups: 0,
          storageHint: "unknown",
          concurrency: 0,
          durationMs: 0,
          canceled: false
        }),
        cancelQuarantinePurge: async () => ({ ok: true }),
        onQuarantinePurgeProgress: () => () => undefined,
        scanDuplicates: async () => ({ groups: [] }),
        previewDuplicateResolution: async () => ({ toKeep: 0, toQuarantine: 0, bytesRecoverable: 0 }),
        executeDuplicateResolution: async () => ({ movedCount: 0, failedCount: 0, freedBytes: 0, errors: [], movedIds: [], failedIds: [] }),
        scanStorage: async () => ({ topFolders: [], largestFiles: [], apps: [] }),
        scanDrivers: async () => ({
          source: "windows_update+oem_hints",
          devices: [],
          updateCandidates: [],
          meaningfulDeviceCount: 1,
          ignoredDeviceCount: 0,
          suppressedCount: 0,
          stackSuppressedCount: 0,
          suppressionSuggestions: []
        }),
        openDriverOfficial: async () => ({ opened: true }),
        lookupDriverOfficialWithAi: async () => ({ lookup: { url: "", label: "" }, opened: false }),
        openWindowsUpdate: async () => ({ opened: true }),
        listAiModels: async () => ({
          models: [],
          decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
          providers: { localCount: 0, cerebrasCount: 0, cerebrasConfigured: false }
        }),
        analyzeWithAi: async () => ({
          models: [],
          decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
          providers: { localCount: 0, cerebrasCount: 0, cerebrasConfigured: false },
          actionPlan: [],
          summary: {
            scannedRoots: [],
            scannedFileCount: 0,
            scannedBytes: 0,
            topFolders: [],
            topFiles: [],
            topExtensions: [],
            appDataCandidates: []
          },
          recommendationsMarkdown: ""
        }),
        getHomeSnapshot: async () => ({
          snapshot: {
            generatedAt: Date.now(),
            healthScore: 84,
            reclaimableBytes: 0,
            primaryBottleneck: "unknown",
            safetyState: "protected",
            recommendedIssue: null,
            topIssues: []
          }
        }),
        runSmartCheck: async () => ({ runId: "smart-1" }),
        getSmartCheckCurrent: async () => ({
          run: {
            id: "smart-1",
            startedAt: Date.now(),
            completedAt: Date.now(),
            status: "completed",
            summary: {
              generatedAt: Date.now(),
              healthScore: 82,
              reclaimableBytes: 0,
              primaryBottleneck: "unknown",
              safetyState: "protected",
              recommendedIssue: null,
              topIssues: []
            },
            cleaner: { findingsCount: 0, selectedCount: 0, selectedBytes: 0, groupedIssues: [] },
            optimize: { startupIssues: 0, performanceIssues: 0, driverIssues: 0, groupedIssues: [] }
          }
        }),
        previewSmartCheck: async () => ({ warnings: [] }),
        executeSmartCheck: async () => ({ warnings: [] }),
        getCoverageCatalog: async () => ({
          windowsAreas: [],
          appFamilies: [],
          totals: { windowsAreasCovered: 0, appFamiliesCovered: 0 }
        }),
        explainFindingTrust: async () => ({ summary: "", risk: "low", reasons: [] }),
        setScheduler: async () => ({ ok: true, scheduler: scenarioState.scheduler }),
        getScheduler: async () => scenarioState.scheduler,
        checkUpdates: async () => ({ currentVersion: "0.1.0", latestVersion: "0.1.0", url: "", hasUpdate: false }),
        startPerformanceMonitor: async () => ({
          sessionId: performance.sessionId,
          capabilities: performance.capabilities
        }),
        getCurrentPerformanceSession: async () => ({
          frames: performance.frames,
          summary: performance.summary
        }),
        stopPerformanceMonitor: async () => ({ ok: true, summary: performance.summary }),
        onPerformanceFrame: () => () => undefined,
        captureDiagnosticsSnapshot: async () => ({ snapshot: performance.snapshot }),
        listDiagnosticsHistory: async () => ({ snapshots: [] }),
        scanStartup: async () => ({ entries: [], summary: { totalEntries: 0 }, suggestedActions: [] }),
        openStartupEntryLocation: async () => ({ opened: true, mode: "default" }),
        scanServices: async () => ({ services: [], summary: { totalServices: 0 }, suggestedActions: [] }),
        scanTasks: async () => ({ tasks: [], summary: { totalTasks: 0 }, suggestedActions: [] }),
        getDiskIoSnapshot: async () => ({ summary: { activeTimePct: 44 }, insights: [] }),
        getMemorySnapshot: async () => ({ summary: { usedPct: 62 }, insights: [] }),
        previewOptimizations: async () => ({ actions: [], totalBytes: 0, riskFlags: { highRiskCount: 0, mediumRiskCount: 0, blockedCount: 0 } }),
        executeOptimizations: async () => ({ movedCount: 0, failedCount: 0, freedBytes: 0, errors: [], movedIds: [], failedIds: [] }),
        listOptimizationHistory: async () => ({ changes: [] }),
        restoreOptimizations: async () => ({ restoredCount: 0, failed: [] }),
        runSystemDoctor: async () => ({ report: { issues: [] }, snapshot: performance.snapshot }),
        scanDriverPerformance: async () => ({ summary: performance.driverSummary })
      };
    },
    {
      desktopApiScenario: scenario
    }
  );
}
