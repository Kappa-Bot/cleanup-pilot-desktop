import { SmartCheckService } from "../electron/smartCheckService";
import { HomeSummarySnapshot, SmartCheckRun, SystemSnapshot } from "../electron/types";

function buildSummary(): HomeSummarySnapshot {
  return {
    generatedAt: Date.now(),
    healthScore: 88,
    reclaimableBytes: 0,
    primaryBottleneck: "unknown",
    safetyState: "protected",
    recommendedIssue: null,
    topIssues: [],
    trustSummary: "Everything remains preview-first, quarantine-first, and reversible.",
    recommendedActionSummary: "No dominant issue is ahead of the rest right now.",
    subscores: [],
    trend: {
      direction: "unknown",
      delta: 0,
      label: "Trend not available yet",
      windowLabel: "Need more history"
    }
  };
}

function buildSnapshot(): SystemSnapshot {
  return {
    id: "snapshot-1",
    createdAt: Date.now(),
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
      taskDelaySupported: false,
      serviceDelayedAutoStartSupported: false
    },
    cpu: { avgUsagePct: 8, peakUsagePct: 12, topProcesses: [] },
    memory: { usedBytes: 4 * 1024 ** 3, usedPct: 25, availableBytes: 12 * 1024 ** 3, topProcesses: [] },
    diskIo: { activeTimePct: 3, topWriters: [], burstEvents: [] },
    network: { topProcesses: [] },
    gpu: { topProcesses: [] },
    startup: {
      impactScore: 0,
      estimatedBootDelayMs: 0,
      highImpactCount: 0,
      redundantCount: 0,
      orphanCount: 0,
      inspectOnlyCount: 0,
      timeline: []
    },
    services: {
      total: 0,
      essentialCount: 0,
      optionalCount: 0,
      rarelyUsedCount: 0,
      unusedCount: 0,
      orphanCount: 0,
      suggestedActionCount: 0
    },
    tasks: {
      total: 0,
      frequentCount: 0,
      optionalCount: 0,
      suspiciousCount: 0,
      orphanCount: 0,
      inspectOnlyCount: 0
    },
    drivers: {
      latencyRisk: "low",
      suspectedDrivers: [],
      activeSignals: []
    },
    bottleneck: {
      primary: "unknown",
      confidence: 0,
      evidence: []
    }
  };
}

async function waitForRun(service: SmartCheckService, runId: string): Promise<SmartCheckRun> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { run } = service.current(runId);
    if (run.status !== "running") {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return service.current(runId).run;
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const rankIssues = jest.fn(() => ({
    cleanerIssues: [],
    optimizeIssues: [],
    topIssues: [],
    summary: buildSummary()
  }));
  return {
    deps: {
      db: {
        addSystemSnapshot: jest.fn(),
        listSystemSnapshotHistory: jest.fn(() => []),
        getSystemSnapshot: jest.fn(() => null)
      },
      configStore: {
        getAll: jest.fn(() => ({ customRoots: [] }))
      },
      scanEngine: {
        run: jest.fn(async () => ({
          status: "completed",
          findings: [],
          rejected: [],
          summary: {
            runId: "scan-1",
            status: "completed",
            startedAt: Date.now(),
            finishedAt: Date.now(),
            processedItems: 0,
            findingsCount: 0,
            totalCandidateBytes: 0,
            protectedRejectedCount: 0,
            categories: {}
          }
        }))
      },
      cleanupEngine: {},
      quarantineManager: {},
      duplicateEngine: {},
      driverScanService: {
        scan: jest.fn(async () => ({
          source: "windows_update+oem_hints",
          devices: [],
          updateCandidates: [],
          meaningfulDeviceCount: 0,
          ignoredDeviceCount: 0,
          suppressedCount: 0,
          stackSuppressedCount: 0,
          suppressionSuggestions: []
        })),
        scanPerformanceSummary: jest.fn(async () => ({
          latencyRisk: "low",
          suspectedDrivers: [],
          activeSignals: []
        }))
      },
      startupAnalyzer: {
        scan: jest.fn(async () => ({
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
        }))
      },
      serviceAnalyzer: {
        scan: jest.fn(async () => ({
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
        }))
      },
      taskSchedulerAnalyzer: {
        scan: jest.fn(async () => ({
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
        }))
      },
      processProfiler: {
        captureSample: jest.fn(async () => ({
          capturedAt: Date.now(),
          counters: {},
          topProcesses: [],
          runawayProcesses: [],
          memoryHogs: [],
          diskWriters: []
        }))
      },
      systemDiagnostics: {
        captureSnapshot: jest.fn(async () => buildSnapshot())
      },
      optimizationManager: {},
      issueRankingService: { rankIssues },
      ...overrides
    } as any,
    rankIssues
  };
}

describe("SmartCheckService resilience", () => {
  it("finishes Smart Check when optional driver inventory is unavailable", async () => {
    const { deps, rankIssues } = buildDeps({
      driverScanService: {
        scan: jest.fn(async () => {
          throw new Error("driver inventory unavailable");
        }),
        scanPerformanceSummary: jest.fn(async () => ({
          latencyRisk: "low",
          suspectedDrivers: [],
          activeSignals: []
        }))
      }
    });
    const service = new SmartCheckService(deps);

    const { runId } = await service.run("fast");
    const run = await waitForRun(service, runId);

    expect(run.status).toBe("completed");
    expect(rankIssues).toHaveBeenCalledWith(expect.objectContaining({
      driverScan: expect.objectContaining({
        devices: [],
        updateCandidates: []
      })
    }));
  });

  it("finishes Smart Check with no cleanup issues when cleanup scan is unavailable", async () => {
    const { deps, rankIssues } = buildDeps({
      scanEngine: {
        run: jest.fn(async () => {
          throw new Error("scan unavailable");
        })
      }
    });
    const service = new SmartCheckService(deps);

    const { runId } = await service.run("fast");
    const run = await waitForRun(service, runId);

    expect(run.status).toBe("completed");
    expect(rankIssues).toHaveBeenCalledWith(expect.objectContaining({
      findings: [],
      rejected: []
    }));
  });
});
