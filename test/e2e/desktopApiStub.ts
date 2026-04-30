import type { Page } from "@playwright/test";
import type {
  ActionPlanSummary,
  AppConfig,
  DecisionExecuteResponse,
  DecisionExecutionProgressEvent,
  DecisionPlanResponse,
  ExecutionSession,
  HistorySessionListResponse,
  HistorySessionMutationResponse,
  HomeSummarySnapshot,
  ProductIssueCard,
  SettingsPayload,
  SmartCheckRun
} from "../../src/types";

export async function installDesktopApiStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = Date.now();

    const settings: AppConfig = {
      defaultPreset: "standard",
      defaultCategories: ["temp", "cache", "logs"],
      customRoots: ["C:\\"],
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
      driverToolsEnabled: false,
      updatesFeedUrl: "",
      performanceSnapshotRetentionDays: 30,
      performanceAutoSnapshotOnLaunch: true,
      performanceAutoSnapshotOnCleanup: true,
      performanceAutoSnapshotOnOptimization: true,
      performanceLiveSampleIntervalMs: 2000,
      performancePinnedMonitoring: false
    };

    const sharedIssues = {
      cleanup: {
        id: "cleanup:safe-cache",
        domain: "cleanup",
        title: "Clear disposable cache",
        summary: "Safe cache cleanup is ready.",
        severity: "safe_win",
        confidence: 0.93,
        reversible: true,
        primaryActionLabel: "Include in plan",
        evidence: ["4.2 GB cache"]
      },
      storage: {
        id: "deep-storage:large-storage",
        domain: "cleanup",
        title: "Review hidden storage",
        summary: "42 GB found in large or sensitive storage areas. Review before any cleanup.",
        severity: "review",
        bytesRecoverable: 42 * 1024 ** 3,
        confidence: 0.82,
        reversible: false,
        primaryActionLabel: "Review storage",
        evidence: ["1 developer cache area", "Report-only items stay untouched"]
      },
      startup: {
        id: "startup:trim",
        domain: "startup",
        title: "Trim startup drag",
        summary: "3 startup items are ready for review.",
        severity: "high_impact",
        confidence: 0.89,
        reversible: true,
        primaryActionLabel: "Review startup plan",
        evidence: ["3 startup items", "21s estimated boot drag"]
      },
      blocked: {
        id: "safety:blocked-programfiles",
        domain: "safety",
        title: "Protected install path blocked",
        summary: "1 path was held back for safety.",
        severity: "blocked",
        confidence: 1,
        reversible: true,
        primaryActionLabel: "Keep blocked",
        evidence: ["Program Files match"]
      },
      background: {
        id: "performance:background-load",
        domain: "performance",
        title: "Reduce background load",
        summary: "A few background items can be trimmed safely.",
        severity: "review",
        confidence: 0.73,
        reversible: true,
        primaryActionLabel: "Review background load",
        evidence: ["2 reversible actions"]
      }
    } satisfies Record<string, ProductIssueCard>;

    const latestReport: NonNullable<HomeSummarySnapshot["latestReport"]> = {
      kind: "smartcheck",
      generatedAt: now - 3600_000,
      freedBytes: 3 * 1024 ** 3,
      cleanupMovedCount: 11,
      startupChangeCount: 2,
      optimizationChangeCount: 2,
      backgroundReductionPct: 14,
      trustSummary: "The previous session stayed reversible."
    };

    const homeSnapshot: HomeSummarySnapshot = {
      generatedAt: now,
      healthScore: 61,
      reclaimableBytes: 8 * 1024 ** 3,
      primaryBottleneck: "mixed",
      safetyState: "review_needed",
      trustSummary: "Everything stays preview-first, quarantine-first, and reversible.",
      recommendedActionSummary: "3 issues need attention. Build a plan before changing anything.",
      subscores: [
        {
          key: "storage",
          label: "Storage",
          score: 58,
          status: "watch",
          summary: "Disposable storage is available.",
          evidence: ["8 GB reclaimable"]
        },
        {
          key: "startup",
          label: "Startup",
          score: 44,
          status: "action",
          summary: "Startup drag is the main slowdown.",
          evidence: ["3 high-impact entries"]
        },
        {
          key: "safety",
          label: "Safety",
          score: 90,
          status: "healthy",
          summary: "Protection is active.",
          evidence: ["Installed apps protected"]
        }
      ],
      trend: {
        direction: "down",
        delta: -4,
        label: "Health slipped 4 points",
        windowLabel: "vs last session"
      },
      latestReport,
      recommendedIssue: sharedIssues.startup,
      topIssues: [sharedIssues.storage, sharedIssues.cleanup, sharedIssues.startup, sharedIssues.blocked]
    };

    const smartCheckRun: SmartCheckRun = {
      id: "smart-1",
      startedAt: now,
      completedAt: now + 4000,
      status: "completed",
      mode: "fast",
      summary: homeSnapshot,
      cleaner: {
        findingsCount: 18,
        selectedCount: 12,
        selectedBytes: 8 * 1024 ** 3,
        groupedIssues: [sharedIssues.cleanup, sharedIssues.storage, sharedIssues.blocked]
      },
      optimize: {
        startupIssues: 3,
        performanceIssues: 1,
        driverIssues: 0,
        groupedIssues: [sharedIssues.startup, sharedIssues.background]
      }
    };

    const plan: ActionPlanSummary = {
      runId: "smart-1",
      generatedAt: now + 5000,
      selectedIssueIds: [sharedIssues.cleanup.id, sharedIssues.storage.id, sharedIssues.startup.id, sharedIssues.blocked.id],
      selectedIssues: [sharedIssues.cleanup, sharedIssues.storage, sharedIssues.startup, sharedIssues.blocked],
      issueBuckets: [
        {
          id: "safe_to_clean",
          label: "Safe to clean",
          summary: "1 grouped cleanup action can move to quarantine.",
          count: 1,
          issues: [sharedIssues.cleanup]
        },
        {
          id: "large_storage",
          label: "Large storage",
          summary: "1 large storage area needs review before cleanup.",
          count: 1,
          issues: [sharedIssues.storage]
        },
        {
          id: "startup_impact",
          label: "Startup impact",
          summary: "3 startup items are worth adjusting.",
          count: 1,
          issues: [sharedIssues.startup]
        },
        {
          id: "background_load",
          label: "Background load",
          summary: "A few background items can be trimmed safely.",
          count: 1,
          issues: [sharedIssues.background]
        },
        {
          id: "blocked_for_safety",
          label: "Blocked for safety",
          summary: "1 path remains blocked.",
          count: 1,
          issues: [sharedIssues.blocked]
        }
      ],
      cleanupPreview: {
        totalBytes: 8 * 1024 ** 3,
        actionCount: 12,
        riskFlags: { highRiskCount: 0, mediumRiskCount: 1, blockedCount: 1 }
      },
      optimizationPreview: {
        actions: [
          {
            id: "startup:disable:discord",
            targetKind: "startup_entry",
            targetId: "registry_run|HKCU|Discord",
            action: "disable",
            title: "Disable Discord on startup",
            summary: "Keep it available, but not at every boot.",
            risk: "low",
            reversible: true,
            blocked: false,
            estimatedBenefitScore: 8
          }
        ],
        blockedCount: 0,
        reversibleCount: 1,
        estimatedStartupSavingsMs: 2100,
        estimatedBackgroundCpuSavingsPct: 1.1,
        estimatedBackgroundRamSavingsBytes: 134217728,
        warnings: []
      },
      blockedIssueCount: 1,
      warnings: [],
      trust: {
        summary: "The plan keeps blocked items out, previews every change, and sends cleanup to quarantine first.",
        reasons: [
          "Blocked items are excluded automatically.",
          "Cleanup uses quarantine before delete.",
          "Startup changes stay reversible."
        ],
        reversible: true
      },
      assistant: {
        title: "Fix startup drag first",
        summary: "The startup changes are the fastest win after safe cleanup.",
        whyItMatters: "It reduces boot drag without touching protected paths.",
        nextActionLabel: "Review and continue",
        fallbackUsed: true
      }
    };

    const buildHistorySession = (): ExecutionSession => ({
      id: "session-1",
      kind: "smartcheck",
      status: "completed",
      startedAt: now,
      completedAt: now + 12_000,
      title: "Smart Check session",
      summary: "Cleanup and startup changes were applied safely.",
      freedBytes: 8 * 1024 ** 3,
      cleanupMovedCount: 12,
      optimizationChangeCount: 1,
      startupChangeCount: 1,
      backgroundReductionPct: 14,
      quarantineItemIds: ["q-1", "q-2"],
      optimizationChangeIds: ["opt-1"],
      selectedIssueIds: [sharedIssues.cleanup.id, sharedIssues.storage.id, sharedIssues.startup.id],
      report: {
        kind: "smartcheck",
        generatedAt: now + 12_000,
        freedBytes: 8 * 1024 ** 3,
        cleanupMovedCount: 12,
        startupChangeCount: 1,
        optimizationChangeCount: 1,
        backgroundReductionPct: 14,
        trustSummary: "Everything stays reversible."
      },
      trustSummary: "Everything stays reversible.",
      warnings: [],
      selectedIssues: [sharedIssues.cleanup, sharedIssues.storage, sharedIssues.startup],
      reversibleActions: [
        "12 cleanup items can be restored from quarantine.",
        "1 startup change can be rolled back."
      ],
      hasUndo: true,
      hasPurge: true
    });

    let historySessions: ExecutionSession[] = [buildHistorySession()];
    const decisionExecutionListeners = new Set<(payload: DecisionExecutionProgressEvent) => void>();

    const emitDecisionProgress = (payload: DecisionExecutionProgressEvent) => {
      for (const listener of decisionExecutionListeners) {
        listener(payload);
      }
    };

    const getSession = (sessionId: string): ExecutionSession => {
      const session = historySessions.find((item) => item.id === sessionId);
      if (!session) {
        throw new Error(`History session not found: ${sessionId}`);
      }
      return session;
    };

    (window as Window & { desktopApi: any }).desktopApi = {
      getSettings: async (): Promise<AppConfig> => settings,
      updateSettings: async (payload: SettingsPayload): Promise<AppConfig> => Object.assign(settings, payload),
      getHomeSnapshot: async (): Promise<{ snapshot: HomeSummarySnapshot }> => ({ snapshot: homeSnapshot }),
      runSmartCheck: async () => ({ runId: smartCheckRun.id }),
      getSmartCheckCurrent: async (): Promise<{ run: SmartCheckRun }> => ({ run: smartCheckRun }),
      previewSmartCheck: async () => ({ warnings: [] }),
      executeSmartCheck: async () => ({ warnings: [] }),
      buildDecisionPlan: async (): Promise<DecisionPlanResponse> => ({ plan }),
      executeDecisionPlan: async (): Promise<DecisionExecuteResponse> => {
        emitDecisionProgress({
          executionId: "session-1",
          stage: "cleanup",
          percent: 35,
          title: "Applying cleanup",
          summary: "Moving safe cleanup targets to quarantine.",
          timestamp: Date.now()
        });
        emitDecisionProgress({
          executionId: "session-1",
          stage: "optimization",
          percent: 72,
          title: "Applying optimization",
          summary: "Applying reversible startup changes.",
          timestamp: Date.now()
        });
        const session = buildHistorySession();
        historySessions = [session];
        emitDecisionProgress({
          executionId: session.id,
          stage: "completed",
          percent: 100,
          title: "Plan applied",
          summary: session.summary,
          timestamp: Date.now()
        });
        return { session };
      },
      onDecisionExecutionProgress: (handler: (payload: DecisionExecutionProgressEvent) => void) => {
        decisionExecutionListeners.add(handler);
        return () => {
          decisionExecutionListeners.delete(handler);
        };
      },
      listHistorySessions: async (): Promise<HistorySessionListResponse> => ({ sessions: historySessions }),
      restoreHistorySession: async (sessionId: string): Promise<HistorySessionMutationResponse> => {
        historySessions = historySessions.map((session) =>
          session.id === sessionId ? { ...session, status: "restored", hasUndo: false } : session
        );
        return { session: getSession(sessionId), restoredCount: 3, failed: [] };
      },
      purgeHistorySession: async (sessionId: string): Promise<HistorySessionMutationResponse> => {
        historySessions = historySessions.map((session) =>
          session.id === sessionId ? { ...session, status: "purged", hasPurge: false } : session
        );
        return { session: getSession(sessionId), purgedCount: 2, failed: [] };
      }
    } as const;
  });
}
