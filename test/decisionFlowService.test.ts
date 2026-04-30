import { DecisionFlowService } from "../electron/decisionFlowService";
import { ProductIssueCard, SmartCheckRun } from "../electron/types";

function buildIssue(): ProductIssueCard {
  return {
    id: "cleanup:temp",
    domain: "cleanup",
    title: "Temporary files",
    summary: "Safe temporary files can be moved to quarantine.",
    severity: "safe_win",
    bytesRecoverable: 1024,
    confidence: 0.95,
    reversible: true,
    primaryActionLabel: "Clean safely",
    evidence: ["Temporary cache files are not required by installed apps."]
  };
}

function buildRun(): SmartCheckRun {
  const issue = buildIssue();
  return {
    id: "run-1",
    startedAt: Date.now(),
    completedAt: Date.now(),
    status: "completed",
    mode: "fast",
    summary: {
      generatedAt: Date.now(),
      healthScore: 90,
      reclaimableBytes: 0,
      primaryBottleneck: "unknown",
      safetyState: "protected",
      recommendedIssue: issue,
      topIssues: [issue],
      trustSummary: "Everything remains preview-first, quarantine-first, and reversible.",
      recommendedActionSummary: "No dominant issue is ahead of the rest right now.",
      subscores: [],
      trend: {
        direction: "unknown",
        delta: 0,
        label: "Trend not available yet",
        windowLabel: "Need more history"
      }
    },
    cleaner: {
      findingsCount: 0,
      selectedCount: 0,
      selectedBytes: 0,
      groupedIssues: [issue]
    },
    optimize: {
      startupIssues: 0,
      performanceIssues: 0,
      driverIssues: 0,
      groupedIssues: []
    }
  };
}

describe("DecisionFlowService", () => {
  it("does not create a history session when the plan has no executable actions", async () => {
    const execute = jest.fn(async () => ({ selectedIssues: [], warnings: ["No executable actions."] }));
    const addHistorySession = jest.fn();
    const service = new DecisionFlowService({
      db: {
        addHistorySession,
        listHistorySessions: jest.fn(() => []),
        getHistorySession: jest.fn(() => null)
      },
      smartCheckService: {
        current: jest.fn(() => ({ run: buildRun() })),
        preview: jest.fn(async () => ({
          selectedIssues: [],
          warnings: ["No executable actions."],
          trustSummary: "No changes selected."
        })),
        execute
      },
      quarantineManager: {},
      optimizationManager: {}
    } as any);

    await expect(service.executePlan("run-1", [])).rejects.toThrow("Plan has no executable actions.");
    expect(execute).not.toHaveBeenCalled();
    expect(addHistorySession).not.toHaveBeenCalled();
  });

  it("does not create a completed history session when execution applies no actions", async () => {
    const execute = jest.fn(async () => ({
      cleanup: {
        movedCount: 0,
        failedCount: 1,
        freedBytes: 0,
        errors: ["Move failed."],
        movedIds: [],
        failedIds: ["finding-1"]
      },
      warnings: ["1 cleanup task failed during Smart Check execution."],
      selectedIssues: [buildIssue()]
    }));
    const addHistorySession = jest.fn();
    const service = new DecisionFlowService({
      db: {
        addHistorySession,
        listHistorySessions: jest.fn(() => []),
        getHistorySession: jest.fn(() => null)
      },
      smartCheckService: {
        current: jest.fn(() => ({ run: buildRun() })),
        preview: jest.fn(async () => ({
          cleanupPreview: {
            totalBytes: 1024,
            actionCount: 1,
            riskFlags: {
              highRiskCount: 0,
              mediumRiskCount: 0,
              blockedCount: 0
            }
          },
          selectedIssues: [buildIssue()],
          warnings: [],
          trustSummary: "Preview remains quarantine-first."
        })),
        execute
      },
      quarantineManager: {},
      optimizationManager: {}
    } as any);

    await expect(service.executePlan("run-1", [])).rejects.toThrow("No plan actions were applied.");
    expect(execute).toHaveBeenCalled();
    expect(addHistorySession).not.toHaveBeenCalled();
  });
});
