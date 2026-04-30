import { IssueRankingService } from "../electron/issueRankingService";
import { OptimizationActionSuggestion, ScanFinding, SystemSnapshot, SystemSnapshotHistoryPoint } from "../electron/types";

function buildSnapshot(overrides: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    id: "snapshot-1",
    createdAt: 2_000,
    source: "manual",
    machine: {
      cpuModel: "Test CPU",
      logicalCores: 8,
      totalRamBytes: 16 * 1024 ** 3,
      gpuModels: [],
      disks: []
    },
    capabilities: {
      gpuSupported: false,
      perProcessGpuSupported: false,
      perProcessNetworkSupported: false,
      diagnosticsEventLogSupported: false,
      taskDelaySupported: true,
      serviceDelayedAutoStartSupported: true
    },
    cpu: { avgUsagePct: 72, peakUsagePct: 95, topProcesses: [] },
    memory: { usedBytes: 12 * 1024 ** 3, usedPct: 74, availableBytes: 4 * 1024 ** 3, topProcesses: [] },
    diskIo: { activeTimePct: 67, topWriters: [], burstEvents: [] },
    network: { topProcesses: [] },
    gpu: { topProcesses: [] },
    startup: {
      impactScore: 68,
      estimatedBootDelayMs: 24_000,
      highImpactCount: 4,
      redundantCount: 2,
      orphanCount: 0,
      inspectOnlyCount: 1,
      timeline: []
    },
    services: {
      total: 10,
      essentialCount: 6,
      optionalCount: 2,
      rarelyUsedCount: 1,
      unusedCount: 1,
      orphanCount: 0,
      suggestedActionCount: 2
    },
    tasks: {
      total: 10,
      frequentCount: 2,
      optionalCount: 2,
      suspiciousCount: 0,
      orphanCount: 0,
      inspectOnlyCount: 0
    },
    drivers: {
      latencyRisk: "medium",
      suspectedDrivers: [],
      activeSignals: []
    },
    bottleneck: {
      primary: "disk_io",
      confidence: 0.82,
      evidence: ["Disk active time stayed above 60% in the latest snapshot."]
    },
    ...overrides
  };
}

function buildAction(id: string, action: OptimizationActionSuggestion["action"]): OptimizationActionSuggestion {
  return {
    id,
    targetKind: "startup_entry",
    targetId: id,
    action,
    title: `Action ${id}`,
    summary: `Summary ${id}`,
    risk: "low",
    reversible: true,
    blocked: false,
    estimatedBenefitScore: 72
  };
}

describe("IssueRankingService", () => {
  it("builds health subscores, trend and trust summary for Home", () => {
    const service = new IssueRankingService();
    const history: SystemSnapshotHistoryPoint[] = [
      {
        id: "prev",
        createdAt: 1_000,
        source: "manual",
        primaryBottleneck: "cpu",
        cpuAvgPct: 55,
        ramUsedPct: 69,
        diskActivePct: 42,
        startupImpactScore: 78
      },
      {
        id: "curr",
        createdAt: 2_000,
        source: "manual",
        primaryBottleneck: "disk_io",
        cpuAvgPct: 72,
        ramUsedPct: 74,
        diskActivePct: 67,
        startupImpactScore: 68
      }
    ];

    const result = service.rankIssues({
      findings: [
        {
          id: "finding-1",
          path: "C:\\Users\\me\\AppData\\Local\\Temp\\cache.bin",
          category: "cache",
          sizeBytes: 8 * 1024 ** 3,
          risk: "low",
          reason: "Cache folder",
          sourceRuleId: "cache-folder",
          selectedByDefault: true,
          modifiedAt: 0
        }
      ],
      rejected: [
        {
          path: "C:\\Program Files\\Protected",
          category: "cache",
          sourceRuleId: "protected",
          protectionKind: "app_install_root",
          reason: "Installed app path"
        }
      ],
      startupActions: [buildAction("startup:disable", "disable")],
      startupSummary: { impactScore: 68, estimatedBootDelayMs: 24_000, highImpactCount: 4 },
      serviceActions: [buildAction("service:manual", "set_manual_start")],
      taskActions: [buildAction("task:disable", "disable")],
      snapshot: buildSnapshot(),
      history
    });

    expect(result.summary.subscores).toBeDefined();
    expect(result.summary.trend).toBeDefined();
    const subscores = result.summary.subscores ?? [];
    const trend = result.summary.trend ?? { direction: "unknown", delta: 0, label: "", windowLabel: "" };
    expect(subscores).toHaveLength(4);
    expect(subscores.map((item) => item.key)).toEqual(["storage", "startup", "background", "safety"]);
    expect(trend.direction).toBe("down");
    expect(trend.label).toMatch(/health slipped/i);
    expect(result.summary.trustSummary).toMatch(/preview-first/i);
    expect(result.summary.recommendedActionSummary).toContain(result.summary.recommendedIssue?.title ?? "");
  });

  it("keeps report-only deep storage out of executable cleanup issues", () => {
    const service = new IssueRankingService();
    const deepFinding: ScanFinding = {
      id: "deep-vhdx",
      path: "C:\\Users\\me\\AppData\\Local\\Docker\\wsl\\data\\ext4.vhdx",
      category: "wsl_leftovers",
      sizeBytes: 90 * 1024 ** 3,
      risk: "high",
      reason: "Docker VHDX is report-only.",
      sourceRuleId: "deep-storage:docker-wsl-vhdx",
      selectedByDefault: false,
      modifiedAt: 0,
      kind: "file",
      origin: "deep_storage",
      storageSafety: "never",
      storageAction: "reportOnly",
      storageSource: "developer_cache",
      reviewOnly: true,
      executionBlocked: true,
      evidence: ["Report-only VHDX"]
    };

    const result = service.rankIssues({
      findings: [deepFinding],
      rejected: [],
      startupActions: []
    });

    const largeIssue = result.cleanerIssues.find((issue) => issue.card.id === "deep-storage:large-storage");
    expect(largeIssue?.card.title).toBe("Review hidden storage");
    expect(largeIssue?.cleanupFindingIds).toEqual([]);
    expect(result.cleanerIssues.some((issue) => issue.card.id === "cleanup:wsl_leftovers")).toBe(false);
    expect(result.summary.recommendedIssue?.id).toBe("deep-storage:large-storage");
  });
});
