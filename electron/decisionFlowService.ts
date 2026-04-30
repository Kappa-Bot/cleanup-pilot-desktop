import { randomUUID } from "crypto";
import { AppDatabase } from "./db";
import { OptimizationManager } from "./optimizationManager";
import { QuarantineManager } from "./quarantineManager";
import { SmartCheckService } from "./smartCheckService";
import {
  ActionPlanSummary,
  AssistantRecommendation,
  DecisionExecuteResponse,
  DecisionExecutionProgressEvent,
  DecisionIssueBucket,
  DecisionIssueBucketId,
  ExecutionSession,
  HistorySessionListResponse,
  HistorySessionMutationResponse,
  ProductIssueCard,
  SmartCheckRun,
  TrustExplanation
} from "./types";

interface DecisionFlowServiceDependencies {
  db: AppDatabase;
  smartCheckService: SmartCheckService;
  quarantineManager: QuarantineManager;
  optimizationManager: OptimizationManager;
}

function uniqueIssues(issues: ProductIssueCard[]): ProductIssueCard[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.id)) {
      return false;
    }
    seen.add(issue.id);
    return true;
  });
}

function collectRunIssues(run: SmartCheckRun): ProductIssueCard[] {
  return uniqueIssues([
    ...run.cleaner.groupedIssues,
    ...run.optimize.groupedIssues,
    ...(run.summary.recommendedIssue ? [run.summary.recommendedIssue] : []),
    ...run.summary.topIssues
  ]);
}

function defaultIssueIds(run: SmartCheckRun, selectedIssueIds: string[]): string[] {
  if (selectedIssueIds.length) {
    return selectedIssueIds;
  }
  return collectRunIssues(run).map((issue) => issue.id);
}

function bucketIdForIssue(issue: ProductIssueCard): DecisionIssueBucketId {
  if (issue.id.startsWith("deep-storage:")) {
    return "large_storage";
  }
  if (issue.severity === "blocked" || issue.domain === "safety") {
    return "blocked_for_safety";
  }
  if (issue.domain === "startup") {
    return "startup_impact";
  }
  if (issue.domain === "performance" || issue.domain === "drivers") {
    return "background_load";
  }
  if (issue.severity === "safe_win") {
    return "safe_to_clean";
  }
  return "needs_review";
}

function bucketLabel(id: DecisionIssueBucketId): string {
  switch (id) {
    case "safe_to_clean":
      return "Safe to clean";
    case "startup_impact":
      return "Startup impact";
    case "large_storage":
      return "Large storage";
    case "background_load":
      return "Background load";
    case "blocked_for_safety":
      return "Blocked for safety";
    default:
      return "Needs review";
  }
}

function bucketSummary(id: DecisionIssueBucketId, count: number): string {
  switch (id) {
    case "safe_to_clean":
      return `${count} cleanup ${count === 1 ? "action is" : "actions are"} ready for quarantine-first cleanup.`;
    case "startup_impact":
      return `${count} startup ${count === 1 ? "change is" : "changes are"} worth previewing.`;
    case "large_storage":
      return `${count} large storage ${count === 1 ? "area needs" : "areas need"} review before cleanup.`;
    case "background_load":
      return `${count} background ${count === 1 ? "issue needs" : "issues need"} attention.`;
    case "blocked_for_safety":
      return `${count} ${count === 1 ? "item remains" : "items remain"} blocked by protection rules.`;
    default:
      return `${count} ${count === 1 ? "issue needs" : "issues need"} manual review before execution.`;
  }
}

function buildBuckets(issues: ProductIssueCard[]): DecisionIssueBucket[] {
  const order: DecisionIssueBucketId[] = [
    "safe_to_clean",
    "needs_review",
    "large_storage",
    "startup_impact",
    "background_load",
    "blocked_for_safety"
  ];
  const grouped = new Map<DecisionIssueBucketId, ProductIssueCard[]>();
  for (const issue of issues) {
    const bucketId = bucketIdForIssue(issue);
    const existing = grouped.get(bucketId) ?? [];
    existing.push(issue);
    grouped.set(bucketId, existing);
  }

  return order
    .map((id) => {
      const bucketIssues = grouped.get(id) ?? [];
      if (!bucketIssues.length) {
        return null;
      }
      return {
        id,
        label: bucketLabel(id),
        summary: bucketSummary(id, bucketIssues.length),
        count: bucketIssues.length,
        issues: bucketIssues
      } satisfies DecisionIssueBucket;
    })
    .filter((item): item is DecisionIssueBucket => Boolean(item));
}

function buildTrust(planWarnings: string[], selectedIssues: ProductIssueCard[], blockedIssueCount: number): TrustExplanation {
  const reasons = [
    "Every cleanup action stays preview-first and quarantine-first.",
    "Reversible optimization changes are tracked in session history."
  ];
  if (blockedIssueCount > 0) {
    reasons.unshift(`${blockedIssueCount} blocked ${blockedIssueCount === 1 ? "item is" : "items are"} excluded automatically.`);
  }
  if (planWarnings.length) {
    reasons.push(`Warnings are surfaced before execution: ${planWarnings[0]}`);
  }
  if (selectedIssues.some((issue) => issue.reversible)) {
    reasons.push("The plan only promotes reversible changes into the main action flow.");
  }
  return {
    summary: "The plan filters blocked items out, keeps cleanup in quarantine, and records reversible changes for undo.",
    reasons,
    reversible: true
  };
}

function buildAssistant(selectedIssues: ProductIssueCard[], run: SmartCheckRun): AssistantRecommendation {
  const lead = selectedIssues[0] ?? run.summary.recommendedIssue ?? run.summary.topIssues[0] ?? null;
  if (!lead) {
    return {
      title: "Run Smart Check",
      summary: "The system needs a fresh pass before suggesting the next action.",
      whyItMatters: "It keeps the recommendation based on current machine state.",
      nextActionLabel: "Run Smart Check",
      fallbackUsed: true
    };
  }

  return {
    title: lead.title,
    summary: lead.summary,
    whyItMatters: lead.evidence[0] ?? run.summary.recommendedActionSummary ?? "This is the highest-ranked reversible improvement right now.",
    nextActionLabel: lead.primaryActionLabel,
    fallbackUsed: Boolean(lead.heuristicFallbackUsed ?? true)
  };
}

function hasExecutableActions(plan: ActionPlanSummary): boolean {
  return Boolean((plan.cleanupPreview?.actionCount ?? 0) > 0 || (plan.optimizationPreview?.actions.length ?? 0) > 0);
}

function countAppliedActions(result: Awaited<ReturnType<SmartCheckService["execute"]>>): number {
  return (result.cleanup?.movedCount ?? 0) + (result.optimizations?.appliedCount ?? 0);
}

function buildSessionSummary(selectedIssues: ProductIssueCard[], reportTrust: string, cleanupMovedCount: number, optimizationChangeCount: number): string {
  if (selectedIssues.length) {
    return `${selectedIssues.length} grouped ${selectedIssues.length === 1 ? "issue was" : "issues were"} applied safely.`;
  }
  if (cleanupMovedCount || optimizationChangeCount) {
    return `${cleanupMovedCount} cleanup ${cleanupMovedCount === 1 ? "move" : "moves"} and ${optimizationChangeCount} reversible ${optimizationChangeCount === 1 ? "change" : "changes"} were applied.`;
  }
  return reportTrust;
}

export class DecisionFlowService {
  constructor(private readonly deps: DecisionFlowServiceDependencies) {}

  async buildPlan(runId: string, selectedIssueIds: string[]): Promise<ActionPlanSummary> {
    const current = this.deps.smartCheckService.current(runId).run;
    const resolvedIssueIds = defaultIssueIds(current, selectedIssueIds);
    const preview = await this.deps.smartCheckService.preview(runId, resolvedIssueIds);
    const selectedIssues = uniqueIssues(preview.selectedIssues ?? []);
    const buckets = buildBuckets(selectedIssues);
    const blockedIssueCount = buckets.find((bucket) => bucket.id === "blocked_for_safety")?.count ?? 0;

    return {
      runId,
      generatedAt: Date.now(),
      selectedIssueIds: resolvedIssueIds,
      selectedIssues,
      issueBuckets: buckets,
      cleanupPreview: preview.cleanupPreview,
      optimizationPreview: preview.optimizationPreview,
      blockedIssueCount,
      warnings: preview.warnings,
      trust: buildTrust(preview.warnings, selectedIssues, blockedIssueCount),
      assistant: buildAssistant(selectedIssues, current)
    };
  }

  async executePlan(
    runId: string,
    selectedIssueIds: string[],
    options?: { executionId?: string; onProgress?: (event: DecisionExecutionProgressEvent) => void }
  ): Promise<DecisionExecuteResponse> {
    const plan = await this.buildPlan(runId, selectedIssueIds);
    if (!hasExecutableActions(plan)) {
      throw new Error("Plan has no executable actions.");
    }
    const result = await this.deps.smartCheckService.execute(runId, plan.selectedIssueIds, options);
    if (countAppliedActions(result) === 0) {
      throw new Error("No plan actions were applied.");
    }
    const report = result.report;
    const session: ExecutionSession = {
      id: options?.executionId ?? randomUUID(),
      kind: report?.kind ?? "smartcheck",
      status: "completed",
      startedAt: Date.now(),
      completedAt: Date.now(),
      title: "Smart Check session",
      summary: buildSessionSummary(
        plan.selectedIssues,
        report?.trustSummary ?? plan.trust.summary,
        result.cleanup?.movedCount ?? 0,
        result.optimizations?.appliedCount ?? 0
      ),
      freedBytes: report?.freedBytes ?? result.cleanup?.freedBytes ?? 0,
      cleanupMovedCount: report?.cleanupMovedCount ?? result.cleanup?.movedCount ?? 0,
      optimizationChangeCount: report?.optimizationChangeCount ?? result.optimizations?.appliedCount ?? 0,
      startupChangeCount: report?.startupChangeCount ?? 0,
      backgroundReductionPct: report?.backgroundReductionPct,
      quarantineItemIds: result.cleanup?.movedIds ?? [],
      optimizationChangeIds: result.optimizations?.changeIds ?? [],
      selectedIssueIds: plan.selectedIssueIds,
      report,
      trustSummary: report?.trustSummary ?? plan.trust.summary,
      warnings: result.warnings,
      selectedIssues: plan.selectedIssues,
      reversibleActions: [
        `${result.cleanup?.movedCount ?? 0} cleanup ${result.cleanup?.movedCount === 1 ? "item remains" : "items remain"} in quarantine.`,
        `${result.optimizations?.appliedCount ?? 0} reversible ${result.optimizations?.appliedCount === 1 ? "change is" : "changes are"} recorded in history.`
      ],
      hasUndo: Boolean((result.cleanup?.movedIds?.length ?? 0) || (result.optimizations?.changeIds?.length ?? 0)),
      hasPurge: Boolean(result.cleanup?.movedIds?.length)
    };

    this.deps.db.addHistorySession(session);
    return { session };
  }

  listHistorySessions(limit = 20): HistorySessionListResponse {
    return {
      sessions: this.deps.db.listHistorySessions(limit)
    };
  }

  async restoreHistorySession(sessionId: string): Promise<HistorySessionMutationResponse> {
    const session = this.requireSession(sessionId);
    const [cleanupRestore, optimizationRestore] = await Promise.all([
      session.quarantineItemIds.length
        ? this.deps.quarantineManager.restoreItems(session.quarantineItemIds)
        : Promise.resolve({ restoredCount: 0, failed: [] as string[] }),
      session.optimizationChangeIds.length
        ? this.deps.optimizationManager.restore(session.optimizationChangeIds)
        : Promise.resolve({ restoredCount: 0, failed: [] as string[] })
    ]);

    const failed = [...cleanupRestore.failed, ...optimizationRestore.failed];
    const updated: ExecutionSession = {
      ...session,
      status: failed.length ? "partially_restored" : "restored",
      hasUndo: failed.length > 0,
      hasPurge: false,
      trustSummary: failed.length
        ? "Some session actions could not be restored completely."
        : "The session was restored through quarantine and optimization history.",
      summary: failed.length ? "Session restore completed with a few manual follow-ups." : "Session restored safely."
    };
    this.deps.db.addHistorySession(updated);
    return {
      session: updated,
      restoredCount: cleanupRestore.restoredCount + optimizationRestore.restoredCount,
      failed
    };
  }

  async purgeHistorySession(sessionId: string): Promise<HistorySessionMutationResponse> {
    const session = this.requireSession(sessionId);
    const result = session.quarantineItemIds.length
      ? await this.deps.quarantineManager.purgeItems(session.quarantineItemIds)
      : { purgedCount: 0, failed: [] as string[] };
    const updated: ExecutionSession = {
      ...session,
      status: session.hasUndo ? "completed" : result.failed.length ? "failed" : "purged",
      hasPurge: result.failed.length > 0,
      trustSummary: result.failed.length
        ? "Some quarantined items could not be purged yet."
        : "Quarantine payload for this session was purged on purpose.",
      summary: result.failed.length ? "Session purge completed with a few failures." : "Session purge completed."
    };
    this.deps.db.addHistorySession(updated);
    return {
      session: updated,
      purgedCount: result.purgedCount,
      failed: result.failed
    };
  }

  private requireSession(sessionId: string): ExecutionSession {
    const session = this.deps.db.getHistorySession(sessionId);
    if (!session) {
      throw new Error("History session not found.");
    }
    return session;
  }
}
