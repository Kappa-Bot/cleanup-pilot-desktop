import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HomePage } from "../src/features/home/HomePage";

describe("HomePage", () => {
  beforeEach(() => {
    (window as any).desktopApi = {
      getHomeSnapshot: jest.fn(async () => ({
        snapshot: {
          generatedAt: Date.now(),
          healthScore: 73,
          reclaimableBytes: 12 * 1024 ** 3,
          primaryBottleneck: "startup",
          safetyState: "review_needed",
          trustSummary: "Everything remains preview-first, quarantine-first, and reversible.",
          recommendedActionSummary: "Review startup drag first, then preview the safe cleanup plan.",
          subscores: [
            { key: "storage", label: "Storage", score: 62, status: "watch", summary: "Large disposable storage is available.", evidence: ["12 GB reclaimable"] },
            { key: "startup", label: "Startup", score: 48, status: "action", summary: "Startup drag is the main slowdown.", evidence: ["4 high-impact entries"] },
            { key: "background", label: "Background", score: 71, status: "watch", summary: "Background load is moderate.", evidence: ["2 reversible actions"] },
            { key: "safety", label: "Safety", score: 92, status: "healthy", summary: "Protection is working.", evidence: ["Installed apps protected"] }
          ],
          trend: { direction: "down", delta: -6, label: "Health slipped 6 points", windowLabel: "vs last snapshot" },
          latestReport: {
            kind: "smartcheck",
            generatedAt: Date.now(),
            freedBytes: 3 * 1024 ** 3,
            cleanupMovedCount: 12,
            startupChangeCount: 2,
            optimizationChangeCount: 3,
            backgroundReductionPct: 18,
            trustSummary: "Changes were applied with preview and remain reversible."
          },
          recommendedIssue: {
            id: "startup:impact",
            domain: "startup",
            title: "Trim startup impact",
            summary: "4 reversible startup changes are ready for preview.",
            severity: "high_impact",
            confidence: 0.87,
            reversible: true,
            primaryActionLabel: "Open startup review",
            secondaryActionLabel: "Preview changes",
            evidence: ["24s estimated boot drag", "4 high-impact entries"]
          },
          topIssues: [
            {
              id: "startup:impact",
              domain: "startup",
              title: "Trim startup impact",
              summary: "4 reversible startup changes are ready for preview.",
              severity: "high_impact",
              confidence: 0.87,
              reversible: true,
              primaryActionLabel: "Open startup review",
              secondaryActionLabel: "Preview changes",
              evidence: ["24s estimated boot drag", "4 high-impact entries"]
            }
          ]
        }
      })),
      getCoverageCatalog: jest.fn(async () => ({
        windowsAreas: [],
        appFamilies: [],
        totals: { windowsAreasCovered: 0, appFamiliesCovered: 0 }
      })),
      runSmartCheck: jest.fn(async () => ({ runId: "smart-1" })),
      getSmartCheckCurrent: jest.fn(async () => ({
        run: {
          id: "smart-1",
          startedAt: Date.now(),
          completedAt: Date.now(),
          status: "completed",
          mode: "fast",
          summary: {
            generatedAt: Date.now(),
            healthScore: 78,
            reclaimableBytes: 10 * 1024 ** 3,
            primaryBottleneck: "startup",
            safetyState: "protected",
            trustSummary: "Everything remains preview-first, quarantine-first, and reversible.",
            recommendedActionSummary: "Open the startup review.",
            subscores: [],
            trend: { direction: "up", delta: 3, label: "Health improved 3 points", windowLabel: "vs previous run" },
            recommendedIssue: null,
            topIssues: []
          },
          cleaner: { findingsCount: 0, selectedCount: 0, selectedBytes: 0, groupedIssues: [] },
          optimize: { startupIssues: 0, performanceIssues: 0, driverIssues: 0, groupedIssues: [] }
        }
      }))
    };
  });

  it("shows health score breakdown, trust copy and latest report", async () => {
    const onOpenCleaner = jest.fn();
    const onOpenOptimize = jest.fn();
    const onOpenVault = jest.fn();

    render(
      <HomePage
        formatBytes={(value) => `${Math.round(value / 1024 ** 3)} GB`}
        onOpenCleaner={onOpenCleaner}
        onOpenOptimize={onOpenOptimize}
        onOpenVault={onOpenVault}
      />
    );

    await waitFor(() => expect(screen.getByText("System Health 2.0")).toBeTruthy());
    expect(screen.getAllByText("Health slipped 6 points").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Everything remains preview-first, quarantine-first, and reversible.").length).toBeGreaterThan(0);
    expect(screen.getByText("Changes were applied with preview and remain reversible.")).toBeTruthy();
    expect(screen.getByText("Storage")).toBeTruthy();
    expect(screen.getByText("Startup")).toBeTruthy();
  });

  it("opens the recommended issue domain from the dominant CTA", async () => {
    const onOpenOptimize = jest.fn();

    render(
      <HomePage
        formatBytes={(value) => `${Math.round(value / 1024 ** 3)} GB`}
        onOpenCleaner={jest.fn()}
        onOpenOptimize={onOpenOptimize}
        onOpenVault={jest.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText("Open startup review")).toBeTruthy());
    fireEvent.click(screen.getByText("Open startup review"));
    expect(onOpenOptimize).toHaveBeenCalled();
  });
});
