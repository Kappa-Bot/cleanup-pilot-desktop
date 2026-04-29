import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App";

function buildSettings(overrides: Record<string, unknown> = {}) {
  return {
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
    driverToolsEnabled: false,
    updatesFeedUrl: "",
    performanceSnapshotRetentionDays: 30,
    performanceAutoSnapshotOnLaunch: true,
    performanceAutoSnapshotOnCleanup: true,
    performanceAutoSnapshotOnOptimization: true,
    performanceLiveSampleIntervalMs: 2000,
    performancePinnedMonitoring: false,
    ...overrides
  };
}

const now = 1_700_000_000_000;

function buildHomeSnapshot() {
  return {
    generatedAt: now,
    healthScore: 61,
    reclaimableBytes: 8 * 1024 ** 3,
    primaryBottleneck: "startup",
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
    latestReport: {
      kind: "smartcheck",
      generatedAt: now - 3600_000,
      freedBytes: 3 * 1024 ** 3,
      cleanupMovedCount: 11,
      startupChangeCount: 2,
      optimizationChangeCount: 2,
      backgroundReductionPct: 14,
      trustSummary: "The previous session stayed reversible."
    },
    recommendedIssue: {
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
    topIssues: [
      {
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
      {
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
      {
        id: "safety:blocked-programfiles",
        domain: "safety",
        title: "Protected install path blocked",
        summary: "1 path was held back for safety.",
        severity: "blocked",
        confidence: 1,
        reversible: true,
        primaryActionLabel: "Keep blocked",
        evidence: ["Program Files match"]
      }
    ]
  };
}

function buildSmartCheckRun(status: "running" | "completed" = "completed") {
  return {
    id: "smart-1",
    startedAt: now,
    completedAt: status === "completed" ? now + 4000 : undefined,
    status,
    mode: "fast",
    summary: buildHomeSnapshot(),
    cleaner: {
      findingsCount: 18,
      selectedCount: 12,
      selectedBytes: 8 * 1024 ** 3,
      groupedIssues: [
        {
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
        {
          id: "safety:blocked-programfiles",
          domain: "safety",
          title: "Protected install path blocked",
          summary: "1 path was held back for safety.",
          severity: "blocked",
          confidence: 1,
          reversible: true,
          primaryActionLabel: "Keep blocked",
          evidence: ["Program Files match"]
        }
      ]
    },
    optimize: {
      startupIssues: 3,
      performanceIssues: 1,
      driverIssues: 0,
      groupedIssues: [
        {
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
        {
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
      ]
    }
  };
}

function buildPlan() {
  return {
    runId: "smart-1",
    generatedAt: now + 5000,
    selectedIssueIds: ["cleanup:safe-cache", "startup:trim", "safety:blocked-programfiles"],
    selectedIssues: buildSmartCheckRun().cleaner.groupedIssues.concat(buildSmartCheckRun().optimize.groupedIssues[0]),
    issueBuckets: [
      {
        id: "safe_to_clean",
        label: "Safe to clean",
        summary: "1 grouped cleanup action can move to quarantine.",
        count: 1,
        issues: [buildSmartCheckRun().cleaner.groupedIssues[0]]
      },
      {
        id: "startup_impact",
        label: "Startup impact",
        summary: "3 startup items are worth adjusting.",
        count: 1,
        issues: [buildSmartCheckRun().optimize.groupedIssues[0]]
      },
      {
        id: "blocked_for_safety",
        label: "Blocked for safety",
        summary: "1 path remains blocked.",
        count: 1,
        issues: [buildSmartCheckRun().cleaner.groupedIssues[1]]
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
}

function buildHistorySession() {
  return {
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
    selectedIssueIds: ["cleanup:safe-cache", "startup:trim"],
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
    selectedIssues: [
      buildSmartCheckRun().cleaner.groupedIssues[0],
      buildSmartCheckRun().optimize.groupedIssues[0]
    ],
    reversibleActions: [
      "12 cleanup items can be restored from quarantine.",
      "1 startup change can be rolled back."
    ],
    hasUndo: true,
    hasPurge: true
  };
}

const desktopApiMock = {
  getSettings: jest.fn(async () => buildSettings()),
  updateSettings: jest.fn(async (payload) => buildSettings(payload)),
  getHomeSnapshot: jest.fn(async () => ({ snapshot: buildHomeSnapshot() })),
  runSmartCheck: jest.fn(async () => ({ runId: "smart-1" })),
  getSmartCheckCurrent: jest.fn(async () => ({ run: buildSmartCheckRun() })),
  buildDecisionPlan: jest.fn(async () => ({ plan: buildPlan() })),
  executeDecisionPlan: jest.fn(async () => ({ session: buildHistorySession() })),
  listHistorySessions: jest.fn(async () => ({ sessions: [buildHistorySession()] })),
  restoreHistorySession: jest.fn(async () => ({
    session: { ...buildHistorySession(), status: "restored", hasUndo: false },
    restoredCount: 3,
    failed: []
  })),
  purgeHistorySession: jest.fn(async () => ({
    session: { ...buildHistorySession(), status: "purged", hasPurge: false },
    purgedCount: 2,
    failed: []
  })),
  onDecisionExecutionProgress: jest.fn((handler?: (payload: unknown) => void) => {
    void handler;
    return () => undefined;
  })
};

describe("App pipeline rebuild", () => {
  beforeEach(() => {
    (window as any).desktopApi = desktopApiMock;
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("shows only the five pipeline surfaces in primary navigation", async () => {
    render(<App />);

    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Execute" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    expect(screen.queryByText("Cleaner")).toBeNull();
    expect(screen.queryByText("Optimize")).toBeNull();
    expect(screen.queryByText("Vault")).toBeNull();
    expect(screen.queryByText("AI Advisor")).toBeNull();
  });

  it("keeps Home usable when settings fail to load", async () => {
    desktopApiMock.getSettings.mockRejectedValueOnce(new Error("settings unavailable"));

    render(<App />);

    await waitFor(() => expect(screen.getByText("3 issues need attention. Build a plan before changing anything.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Run Smart Check" })).toBeTruthy();
  });

  it("runs Smart Check from Home and builds a plan from Scan", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText("3 issues need attention. Build a plan before changing anything.")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run Smart Check" }));
    });

    await waitFor(() => expect(desktopApiMock.runSmartCheck).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Grouped issues" })).toBeTruthy());
    expect(screen.getByText("Safe to clean")).toBeTruthy();
    expect(screen.getByText("Startup impact")).toBeTruthy();
    expect(screen.getByText("Blocked for safety")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Build Plan" }));
    });

    await waitFor(() => expect(desktopApiMock.buildDecisionPlan).toHaveBeenCalledWith("smart-1", []));
    expect(screen.getByRole("button", { name: "Review and continue" })).toBeTruthy();
    expect(screen.getByText("Why this is safe")).toBeTruthy();
  });

  it("executes the plan and records the session in History", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Run Smart Check" })).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run Smart Check" }));
    });
    await waitFor(() => expect(screen.getByText("Build Plan")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Build Plan" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Review and continue" })).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review and continue" }));
    });
    await waitFor(() => expect(screen.getByText("Apply plan" )).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply plan" }));
    });

    await waitFor(() => expect(desktopApiMock.executeDecisionPlan).toHaveBeenCalledWith("smart-1", []));
    await waitFor(() => expect(screen.getByText("Open session report")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open session report" }));
    });

    await waitFor(() => expect(desktopApiMock.listHistorySessions).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Smart Check session" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Purge" })).toBeTruthy();
  });
});
