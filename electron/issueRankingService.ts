import {
  CleanupCategory,
  DriverPerformanceSummary,
  DriverScanResponse,
  HealthSubscore,
  HealthTrendState,
  HomeSummarySnapshot,
  OptimizationActionSuggestion,
  ProductIssueCard,
  ProtectedFindingRejection,
  ScanFinding,
  SystemSnapshot,
  SystemSnapshotHistoryPoint
} from "./types";

const CLEANUP_LABELS: Record<CleanupCategory, string> = {
  temp: "Temporary files",
  cache: "App and web caches",
  logs: "Logs",
  crash_dumps: "Crash dumps",
  wsl_leftovers: "WSL residue",
  minecraft_leftovers: "Minecraft residue",
  ai_model_leftovers: "AI tools and model residue",
  installer_artifacts: "Installer residue",
  duplicates: "Duplicates"
};

function roundConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function bytesToGb(value?: number): string {
  if (!value) {
    return "0 GB";
  }
  return `${(value / (1024 ** 3)).toFixed(value >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
}

function averageBenefit(actions: OptimizationActionSuggestion[]): number {
  if (!actions.length) {
    return 0;
  }
  return Math.round(actions.reduce((sum, item) => sum + item.estimatedBenefitScore, 0) / actions.length);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreStatus(score: number): HealthSubscore["status"] {
  if (score >= 80) {
    return "healthy";
  }
  if (score >= 60) {
    return "watch";
  }
  return "action";
}

function createTrend(current: number, previous?: number): HealthTrendState {
  if (previous === undefined || !Number.isFinite(previous)) {
    return {
      direction: "unknown",
      delta: 0,
      label: "Trend not available yet",
      windowLabel: "Need more history"
    };
  }
  const delta = Math.round(current - previous);
  if (Math.abs(delta) <= 1) {
    return {
      direction: "flat",
      delta,
      label: "Health stayed flat",
      windowLabel: "vs last snapshot"
    };
  }
  if (delta > 0) {
    return {
      direction: "up",
      delta,
      label: `Health improved ${delta} point${delta === 1 ? "" : "s"}`,
      windowLabel: "vs last snapshot"
    };
  }
  const magnitude = Math.abs(delta);
  return {
    direction: "down",
    delta,
    label: `Health slipped ${magnitude} point${magnitude === 1 ? "" : "s"}`,
    windowLabel: "vs last snapshot"
  };
}

function latestPreviousHistory(history?: SystemSnapshotHistoryPoint[]): SystemSnapshotHistoryPoint | undefined {
  if (!history || history.length < 2) {
    return undefined;
  }
  const sorted = [...history].sort((left, right) => right.createdAt - left.createdAt);
  return sorted[1];
}

export interface RankedIssue {
  card: ProductIssueCard;
  cleanupFindingIds: string[];
  optimizationActions: OptimizationActionSuggestion[];
}

export interface RankedIssueSet {
  cleanerIssues: RankedIssue[];
  optimizeIssues: RankedIssue[];
  topIssues: ProductIssueCard[];
  summary: HomeSummarySnapshot;
}

export interface RankIssuesInput {
  findings: ScanFinding[];
  rejected: ProtectedFindingRejection[];
  startupActions: OptimizationActionSuggestion[];
  startupSummary?: {
    impactScore: number;
    estimatedBootDelayMs: number;
    highImpactCount: number;
  };
  serviceActions?: OptimizationActionSuggestion[];
  taskActions?: OptimizationActionSuggestion[];
  snapshot?: SystemSnapshot;
  history?: SystemSnapshotHistoryPoint[];
  driverScan?: DriverScanResponse;
  driverPerformance?: DriverPerformanceSummary;
}

export class IssueRankingService {
  rankIssues(input: RankIssuesInput): RankedIssueSet {
    const cleanerIssues = [
      ...this.buildCleanupIssues(input.findings),
      ...this.buildSafetyIssues(input.rejected)
    ];
    const optimizeIssues = [
      ...this.buildPerformanceIssues(input.snapshot, input.serviceActions ?? [], input.taskActions ?? []),
      ...this.buildStartupIssues(input.startupActions, input.startupSummary),
      ...this.buildDriverIssues(input.driverScan, input.driverPerformance)
    ];

    const ranked = [...cleanerIssues, ...optimizeIssues].sort((left, right) => this.scoreIssue(right.card) - this.scoreIssue(left.card));
    const topIssues = ranked.slice(0, 6).map((item) => item.card);
    const reclaimableBytes = cleanerIssues.reduce((sum, item) => sum + (item.card.bytesRecoverable ?? 0), 0);
    const recommendedIssue = topIssues[0] ?? null;
    const safetyState = input.rejected.length
      ? "attention_needed"
      : cleanerIssues.some((item) => item.card.severity === "review")
        ? "review_needed"
        : "protected";
    const penalties = ranked.slice(0, 5).reduce((sum, item) => sum + this.penaltyForSeverity(item.card.severity), 0);
    const healthScore = Math.max(28, Math.min(96, 92 - penalties));
    const previousHistory = latestPreviousHistory(input.history);
    const previousHealthScore = previousHistory
      ? this.estimateHistoricalHealthScore(previousHistory, input.rejected.length > 0)
      : undefined;
    const subscores = this.buildHealthSubscores({
      reclaimableBytes,
      startupSummary: input.startupSummary,
      snapshot: input.snapshot,
      rejected: input.rejected,
      cleanerIssues
    });
    const trend = createTrend(healthScore, previousHealthScore);
    const trustSummary = input.rejected.length
      ? "Protection stayed active, blocked risky paths early, and any suggested change still requires a preview-first review."
      : "Everything remains preview-first, quarantine-first, and reversible before any system change is applied.";
    const recommendedActionSummary = recommendedIssue
      ? `${recommendedIssue.title} is the next best action because it has the highest combined impact and confidence right now.`
      : "No dominant issue is ahead of the rest right now.";

    return {
      cleanerIssues,
      optimizeIssues,
      topIssues,
      summary: {
        generatedAt: Date.now(),
        healthScore,
        reclaimableBytes,
        primaryBottleneck: input.snapshot?.bottleneck.primary ?? "unknown",
        safetyState,
        trustSummary,
        recommendedActionSummary,
        subscores,
        trend,
        recommendedIssue,
        topIssues
      }
    };
  }

  private buildHealthSubscores(args: {
    reclaimableBytes: number;
    startupSummary?: RankIssuesInput["startupSummary"];
    snapshot?: SystemSnapshot;
    rejected: ProtectedFindingRejection[];
    cleanerIssues: RankedIssue[];
  }): HealthSubscore[] {
    const storageScore = clampScore(92 - Math.min(42, Math.round(args.reclaimableBytes / (1024 ** 3)) * 4));
    const startupScore = clampScore(92 - Math.round((args.startupSummary?.impactScore ?? 12) * 0.65));
    const backgroundLoad = args.snapshot
      ? Math.max(args.snapshot.cpu.avgUsagePct, args.snapshot.memory.usedPct, args.snapshot.diskIo.activeTimePct)
      : 28;
    const backgroundScore = clampScore(94 - Math.round(backgroundLoad * 0.55));
    const safetyScore = clampScore(96 - args.rejected.length * 8 - args.cleanerIssues.filter((item) => item.card.severity === "review").length * 3);

    return [
      {
        key: "storage",
        label: "Storage",
        score: storageScore,
        status: scoreStatus(storageScore),
        summary:
          args.reclaimableBytes > 0
            ? `Large disposable storage is available for review and quarantine.`
            : "No meaningful reclaimable storage is standing out right now.",
        evidence: [
          `${bytesToGb(args.reclaimableBytes)} recoverable`,
          args.cleanerIssues.length ? `${args.cleanerIssues.length} ranked cleanup lane${args.cleanerIssues.length === 1 ? "" : "s"}` : "No cleanup pressure"
        ]
      },
      {
        key: "startup",
        label: "Startup",
        score: startupScore,
        status: scoreStatus(startupScore),
        summary:
          (args.startupSummary?.highImpactCount ?? 0) > 0
            ? "Startup drag is measurable and has reversible actions ready."
            : "Startup load looks controlled right now.",
        evidence: [
          args.startupSummary?.estimatedBootDelayMs
            ? `${Math.round(args.startupSummary.estimatedBootDelayMs / 1000)}s estimated drag`
            : "Boot delay not specified",
          `${args.startupSummary?.highImpactCount ?? 0} high-impact entries`
        ]
      },
      {
        key: "background",
        label: "Background",
        score: backgroundScore,
        status: scoreStatus(backgroundScore),
        summary: args.snapshot
          ? "Background load is based on the latest structured snapshot."
          : "Background load is not fully specified yet.",
        evidence: [
          args.snapshot ? `CPU ${Math.round(args.snapshot.cpu.avgUsagePct)}% avg` : "CPU not specified",
          args.snapshot ? `Disk ${Math.round(args.snapshot.diskIo.activeTimePct)}% active` : "Disk not specified"
        ]
      },
      {
        key: "safety",
        label: "Safety",
        score: safetyScore,
        status: scoreStatus(safetyScore),
        summary:
          args.rejected.length > 0
            ? "Protection guardrails are actively blocking risky cleanup paths."
            : "Protection guardrails are active and no blocked path needs immediate review.",
        evidence: [
          args.rejected.length ? `${args.rejected.length} blocked candidate${args.rejected.length === 1 ? "" : "s"}` : "No blocked paths in current pass",
          "Installed-app-aware protection"
        ]
      }
    ];
  }

  private estimateHistoricalHealthScore(point: SystemSnapshotHistoryPoint, hadBlockedItems: boolean): number {
    const basePenalty =
      Math.round((point.cpuAvgPct ?? 0) / 8) +
      Math.round((point.ramUsedPct ?? 0) / 10) +
      Math.round((point.diskActivePct ?? 0) / 10) +
      Math.round((point.startupImpactScore ?? 0) / 10) +
      (hadBlockedItems ? 8 : 0);
    return clampScore(92 - basePenalty);
  }

  private buildCleanupIssues(findings: ScanFinding[]): RankedIssue[] {
    const buckets = new Map<CleanupCategory, ScanFinding[]>();
    for (const finding of findings) {
      const list = buckets.get(finding.category) ?? [];
      list.push(finding);
      buckets.set(finding.category, list);
    }

    return [...buckets.entries()]
      .map(([category, items]) => {
        const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
        const selectedCount = items.filter((item) => item.selectedByDefault).reduce((sum, item) => sum + (item.entryCount ?? 1), 0);
        const riskCounts = {
          high: items.filter((item) => item.risk === "high").length,
          medium: items.filter((item) => item.risk === "medium").length
        };
        const severity = riskCounts.high
          ? "review"
          : riskCounts.medium
            ? "review"
            : "safe_win";
        const confidenceBase = category === "temp" || category === "cache" || category === "logs" || category === "crash_dumps" ? 0.92 : 0.8;
        return {
          card: {
            id: `cleanup:${category}`,
            domain: "cleanup",
            title: `Review ${CLEANUP_LABELS[category]}`,
            summary:
              severity === "safe_win"
                ? `${selectedCount || items.length} low-risk item${selectedCount === 1 ? "" : "s"} already grouped for quarantine-first cleanup.`
                : `${items.length} item${items.length === 1 ? "" : "s"} surfaced in ${CLEANUP_LABELS[category].toLowerCase()} and should be reviewed before execution.`,
            severity,
            bytesRecoverable: totalBytes,
            confidence: roundConfidence(confidenceBase - riskCounts.medium * 0.01 - riskCounts.high * 0.03),
            reversible: true,
            primaryActionLabel: "Review cleanup",
            secondaryActionLabel: "Preview plan",
            evidence: [
              `${items.length} finding${items.length === 1 ? "" : "s"}`,
              `${bytesToGb(totalBytes)} recoverable`,
              riskCounts.high ? `${riskCounts.high} higher-risk item${riskCounts.high === 1 ? "" : "s"}` : "Quarantine-first flow"
            ].filter(Boolean)
          },
          cleanupFindingIds: items.map((item) => item.id),
          optimizationActions: []
        } satisfies RankedIssue;
      })
      .sort((left, right) => (right.card.bytesRecoverable ?? 0) - (left.card.bytesRecoverable ?? 0));
  }

  private buildSafetyIssues(rejected: ProtectedFindingRejection[]): RankedIssue[] {
    if (!rejected.length) {
      return [];
    }
    const blockedBy = new Map<string, number>();
    for (const item of rejected) {
      blockedBy.set(item.protectionKind, (blockedBy.get(item.protectionKind) ?? 0) + 1);
    }
    const summaryPills = [...blockedBy.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([kind, count]) => `${count} ${kind.replace(/_/g, " ")}`);

    return [
      {
        card: {
          id: "safety:blocked",
          domain: "safety",
          title: "Protected items were kept out of cleanup",
          summary: `${rejected.length} candidate${rejected.length === 1 ? " was" : "s were"} blocked by guardrails before preview.`,
          severity: "blocked",
          confidence: 0.98,
          reversible: false,
          primaryActionLabel: "Review blocked items",
          secondaryActionLabel: "Open protection details",
          evidence: summaryPills.length ? summaryPills : ["Protection policy active"]
        },
        cleanupFindingIds: [],
        optimizationActions: []
      }
    ];
  }

  private buildStartupIssues(
    actions: OptimizationActionSuggestion[],
    summary?: { impactScore: number; estimatedBootDelayMs: number; highImpactCount: number }
  ): RankedIssue[] {
    if (!actions.length && !summary?.highImpactCount) {
      return [];
    }
    const filteredActions = actions.filter((item) => !item.blocked).slice(0, 6);
    return [
      {
        card: {
          id: "startup:impact",
          domain: "startup",
          title: "Trim startup impact",
          summary:
            filteredActions.length > 0
              ? `${filteredActions.length} reversible startup change${filteredActions.length === 1 ? " is" : "s are"} ready for preview.`
              : `Startup impact is elevated and deserves a focused review.`,
          severity: (summary?.impactScore ?? 0) >= 65 ? "high_impact" : filteredActions.length > 0 ? "review" : "safe_win",
          estimatedSpeedBenefitScore: averageBenefit(filteredActions),
          confidence: roundConfidence((summary?.impactScore ?? 50) / 100),
          reversible: true,
          primaryActionLabel: "Open startup review",
          secondaryActionLabel: filteredActions.length ? "Preview changes" : undefined,
          evidence: [
            summary?.estimatedBootDelayMs ? `${Math.round(summary.estimatedBootDelayMs / 1000)}s estimated boot drag` : "Boot impact observed",
            summary?.highImpactCount ? `${summary.highImpactCount} high-impact entries` : "Reversible actions only",
            filteredActions.length ? `${filteredActions.length} previewable actions` : "Inspect before changing"
          ].filter(Boolean)
        },
        cleanupFindingIds: [],
        optimizationActions: filteredActions
      }
    ];
  }

  private buildPerformanceIssues(
    snapshot: SystemSnapshot | undefined,
    serviceActions: OptimizationActionSuggestion[],
    taskActions: OptimizationActionSuggestion[]
  ): RankedIssue[] {
    const issues: RankedIssue[] = [];
    const perfActions = [...serviceActions, ...taskActions].filter((item) => !item.blocked).slice(0, 8);
    if (snapshot && snapshot.bottleneck.primary !== "unknown") {
      issues.push({
        card: {
          id: `performance:${snapshot.bottleneck.primary}`,
          domain: "performance",
          title: `Investigate ${snapshot.bottleneck.primary.replace(/_/g, " ")} pressure`,
          summary: `The latest system snapshot points to ${snapshot.bottleneck.primary.replace(/_/g, " ")} as the main drag on responsiveness.`,
          severity: snapshot.bottleneck.confidence >= 0.75 ? "high_impact" : "review",
          estimatedSpeedBenefitScore:
            snapshot.bottleneck.primary === "disk_io"
              ? Math.round(snapshot.diskIo.activeTimePct)
              : snapshot.bottleneck.primary === "ram"
                ? Math.round(snapshot.memory.usedPct)
                : Math.round(snapshot.cpu.avgUsagePct),
          confidence: roundConfidence(snapshot.bottleneck.confidence),
          reversible: true,
          primaryActionLabel: "Open optimize",
          secondaryActionLabel: perfActions.length ? "Preview safe wins" : undefined,
          evidence: snapshot.bottleneck.evidence.slice(0, 3)
        },
        cleanupFindingIds: [],
        optimizationActions: perfActions
      });
    }

    if (perfActions.length) {
      issues.push({
        card: {
          id: "performance:background-load",
          domain: "performance",
          title: "Reduce background load",
          summary: `${perfActions.length} reversible service or task adjustment${perfActions.length === 1 ? " is" : "s are"} ready for preview.`,
          severity: "review",
          estimatedSpeedBenefitScore: averageBenefit(perfActions),
          confidence: 0.78,
          reversible: true,
          primaryActionLabel: "Open optimize",
          secondaryActionLabel: "Preview changes",
          evidence: [
            `${serviceActions.length} service suggestion${serviceActions.length === 1 ? "" : "s"}`,
            `${taskActions.length} scheduled task suggestion${taskActions.length === 1 ? "" : "s"}`,
            "Reversible configuration changes"
          ]
        },
        cleanupFindingIds: [],
        optimizationActions: perfActions
      });
    }

    return issues;
  }

  private buildDriverIssues(driverScan?: DriverScanResponse, driverPerformance?: DriverPerformanceSummary): RankedIssue[] {
    if (!driverScan && !driverPerformance) {
      return [];
    }
    const candidateCount = driverScan?.updateCandidates.length ?? 0;
    const highCount = driverScan?.updateCandidates.filter((item) => item.severity === "high").length ?? 0;
    const latencyRisk = driverPerformance?.latencyRisk ?? "low";
    if (!candidateCount && latencyRisk === "low") {
      return [];
    }
    return [
      {
        card: {
          id: "drivers:review",
          domain: "drivers",
          title: latencyRisk !== "low" ? "Review driver latency risk" : "Review official driver guidance",
          summary:
            latencyRisk !== "low"
              ? `Driver diagnostics flagged ${latencyRisk} latency risk. Open the driver workspace for official guidance and suppression review.`
              : `${candidateCount} driver update hint${candidateCount === 1 ? " is" : "s are"} available through official routes only.`,
          severity: latencyRisk === "high" || highCount > 0 ? "high_impact" : "review",
          confidence: roundConfidence(latencyRisk === "high" ? 0.86 : highCount > 0 ? 0.8 : 0.7),
          reversible: true,
          primaryActionLabel: "Open drivers",
          secondaryActionLabel: candidateCount ? "Review official routes" : undefined,
          evidence: [
            candidateCount ? `${candidateCount} candidate${candidateCount === 1 ? "" : "s"}` : "Recommendation-only module",
            highCount ? `${highCount} high-priority hint${highCount === 1 ? "" : "s"}` : "No forced install path",
            driverPerformance?.suspectedDrivers.length ? `${driverPerformance.suspectedDrivers.length} suspected stack issue${driverPerformance.suspectedDrivers.length === 1 ? "" : "s"}` : "Suppressions stay local"
          ]
        },
        cleanupFindingIds: [],
        optimizationActions: []
      }
    ];
  }

  private scoreIssue(card: ProductIssueCard): number {
    const severityWeight =
      card.severity === "blocked"
        ? 110
        : card.severity === "high_impact"
          ? 90
          : card.severity === "review"
            ? 60
            : 40;
    const bytesWeight = Math.min(24, Math.round((card.bytesRecoverable ?? 0) / (1024 ** 3)) * 4);
    const benefitWeight = Math.min(20, Math.round((card.estimatedSpeedBenefitScore ?? 0) / 5));
    const confidenceWeight = Math.round(card.confidence * 18);
    return severityWeight + bytesWeight + benefitWeight + confidenceWeight;
  }

  private penaltyForSeverity(severity: ProductIssueCard["severity"]): number {
    if (severity === "blocked") {
      return 16;
    }
    if (severity === "high_impact") {
      return 13;
    }
    if (severity === "review") {
      return 8;
    }
    return 3;
  }
}
