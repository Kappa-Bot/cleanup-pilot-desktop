import { HomeSummaryService } from "../electron/homeSummaryService";
import { SmartCheckService } from "../electron/smartCheckService";
import { HomeSummarySnapshot } from "../electron/types";

function buildSnapshot(): HomeSummarySnapshot {
  return {
    generatedAt: 1_700_000_000_000,
    healthScore: 82,
    reclaimableBytes: 0,
    primaryBottleneck: "unknown",
    safetyState: "protected",
    trustSummary: "Everything remains preview-first, quarantine-first, and reversible.",
    recommendedActionSummary: "Run Smart Check to refresh cleanup, startup, and safety priorities.",
    subscores: [],
    trend: {
      direction: "unknown",
      delta: 0,
      label: "Trend not available yet",
      windowLabel: "Need more history"
    },
    recommendedIssue: null,
    topIssues: []
  };
}

describe("HomeSummaryService", () => {
  it("uses a lightweight snapshot instead of triggering a full Smart Check scan", async () => {
    const snapshot = buildSnapshot();
    const smartCheckService = {
      getLightweightHomeSnapshot: jest.fn(() => snapshot),
      captureHomeSnapshot: jest.fn(async () => {
        throw new Error("full scan should not run during home load");
      })
    } as unknown as SmartCheckService & {
      getLightweightHomeSnapshot: () => HomeSummarySnapshot;
      captureHomeSnapshot: () => Promise<HomeSummarySnapshot>;
    };

    const service = new HomeSummaryService(smartCheckService);

    await expect(service.getSnapshot()).resolves.toBe(snapshot);
    expect(smartCheckService.getLightweightHomeSnapshot).toHaveBeenCalledTimes(1);
    expect(smartCheckService.captureHomeSnapshot).not.toHaveBeenCalled();
  });
});
