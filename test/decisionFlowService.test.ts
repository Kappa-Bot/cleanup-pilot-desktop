import { DecisionFlowService } from "../electron/decisionFlowService";
import { SmartCheckRun } from "../electron/types";

function buildRun(): SmartCheckRun {
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
    },
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
});
