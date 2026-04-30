import fs from "fs";
import path from "path";
import { groupScanIssues, visualThemeItems } from "../src/features/pipeline/pipelineShared";
import { SmartCheckRun } from "../src/types";

const pipelineCss = fs.readFileSync(path.join(__dirname, "..", "src", "features", "pipeline", "pipeline.css"), "utf8");

describe("Pipeline visual system", () => {
  it("defines scoped readable metric and trust styles inside the pipeline shell", () => {
    expect(pipelineCss).toContain(".pipeline-app-shell .product-metric-card");
    expect(pipelineCss).toContain(".pipeline-app-shell .product-metric-card small");
    expect(pipelineCss).toContain(".pipeline-app-shell .trust-badge--safe_win");
    expect(pipelineCss).toContain(".pipeline-app-shell .trust-badge--blocked");
  });

  it("offers production dark themes with shell tokens and swatches", () => {
    const themeIds = visualThemeItems.map((item) => item.id);
    expect(themeIds).toEqual(expect.arrayContaining(["midnight", "onyx"]));
    expect(pipelineCss).toContain('.pipeline-app-shell[data-theme="midnight"]');
    expect(pipelineCss).toContain('.pipeline-app-shell[data-theme="onyx"]');
    expect(pipelineCss).toContain(".theme-swatch-midnight");
    expect(pipelineCss).toContain(".theme-swatch-onyx");
  });

  it("groups deep storage recommendations into Large storage without adding legacy tabs", () => {
    const run: SmartCheckRun = {
      id: "run-1",
      startedAt: Date.now(),
      completedAt: Date.now(),
      status: "completed",
      summary: {
        generatedAt: Date.now(),
        healthScore: 70,
        reclaimableBytes: 42 * 1024 ** 3,
        primaryBottleneck: "unknown",
        safetyState: "review_needed",
        recommendedIssue: null,
        topIssues: [],
        trustSummary: "Preview-first.",
        recommendedActionSummary: "Review hidden storage.",
        subscores: [],
        trend: { direction: "unknown", delta: 0, label: "No trend", windowLabel: "Need history" }
      },
      cleaner: {
        findingsCount: 1,
        selectedCount: 0,
        selectedBytes: 0,
        groupedIssues: [
          {
            id: "deep-storage:large-storage",
            domain: "cleanup",
            title: "Review hidden storage",
            summary: "42 GB found.",
            severity: "review",
            bytesRecoverable: 42 * 1024 ** 3,
            confidence: 0.8,
            reversible: false,
            primaryActionLabel: "Review storage",
            evidence: ["Report-only"]
          }
        ]
      },
      optimize: {
        startupIssues: 0,
        performanceIssues: 0,
        driverIssues: 0,
        groupedIssues: []
      }
    };

    expect(groupScanIssues(run).map((bucket) => bucket.label)).toEqual(["Large storage"]);
    expect(pipelineCss).not.toContain("Cleaner");
    expect(pipelineCss).not.toContain("Optimize");
    expect(pipelineCss).not.toContain("Vault");
  });
});
