import type { ActionPlanSummary } from "../../types";
import { DecisionPanel } from "../shared/DecisionPanel";
import { EmptyState } from "../shared/EmptyState";
import { IssueCard } from "../shared/IssueCard";
import { MetricStrip } from "../shared/MetricStrip";
import { SideInspector } from "../shared/SideInspector";
import { formatBytes } from "./pipelineShared";

interface PlanSurfaceProps {
  plan: ActionPlanSummary | null;
  status: string;
  canExecutePlan: boolean;
  busy: boolean;
  onBuildPlan: () => void;
  onReviewContinue: () => void;
}

export function PlanSurface({ plan, status, canExecutePlan, busy, onBuildPlan, onReviewContinue }: PlanSurfaceProps) {
  if (!plan) {
    return (
      <EmptyState
        kicker="Plan"
        title={busy ? "Building plan" : "No plan yet"}
        summary={status}
        actionLabel={busy ? undefined : "Build plan"}
        onAction={onBuildPlan}
        loading={busy}
      />
    );
  }

  const cleanupBuckets = plan.issueBuckets.filter((bucket) => bucket.id === "safe_to_clean" || bucket.id === "needs_review");
  const blockedBucket = plan.issueBuckets.find((bucket) => bucket.id === "blocked_for_safety");

  return (
    <div className="pipeline-surface-stack">
      <DecisionPanel
        kicker="Plan"
        title={plan.assistant.title}
        summary={canExecutePlan ? plan.assistant.summary : "No cleanup or reversible optimization action is ready to execute."}
        primaryActionLabel={canExecutePlan ? "Review and continue" : undefined}
        onPrimaryAction={canExecutePlan ? onReviewContinue : undefined}
        aside={
          <MetricStrip
            items={[
              { label: "Cleanup impact", value: formatBytes(plan.cleanupPreview?.totalBytes ?? 0), hint: `${plan.cleanupPreview?.actionCount ?? 0} grouped actions` },
              { label: "Optimize", value: plan.optimizationPreview?.reversibleCount ?? 0, hint: "Reversible changes" },
              { label: "Blocked", value: plan.blockedIssueCount, hint: "Held back automatically" }
            ]}
          />
        }
      />

      <section className="pipeline-grid">
        <div className="pipeline-card-list">
          <article className="pipeline-card">
            <header className="pipeline-card-header">
              <div>
                <small className="section-kicker">Clean</small>
                <h3>What will be cleaned</h3>
              </div>
            </header>
            <p className="muted">Cleanup stays grouped, reversible, and quarantine-first.</p>
            <div className="issue-grid issue-grid--compact">
              {cleanupBuckets.flatMap((bucket) => bucket.issues).slice(0, 3).map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </article>

          <article className="pipeline-card">
            <header className="pipeline-card-header">
              <div>
                <small className="section-kicker">Optimize</small>
                <h3>What will be optimized</h3>
              </div>
            </header>
            <p className="muted">Startup and background changes remain reversible.</p>
            <div className="pipeline-detail-list">
              {(plan.optimizationPreview?.actions ?? []).slice(0, 4).map((action) => (
                <div key={action.id} className="pipeline-action-row">
                  <strong>{action.title}</strong>
                  <span className="muted">{action.action === "delay" ? "Delay" : action.action === "disable" ? "Disable" : "Keep under review"}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="pipeline-card">
            <header className="pipeline-card-header">
              <div>
                <small className="section-kicker">Blocked</small>
                <h3>What will stay untouched</h3>
              </div>
            </header>
            <p className="muted">Protected paths remain outside the plan.</p>
            <div className="issue-grid issue-grid--compact">
              {(blockedBucket?.issues ?? []).slice(0, 2).map((issue) => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </article>
        </div>

        <SideInspector kicker="Why this is safe" title={plan.assistant.whyItMatters} summary={plan.trust.summary}>
          <div className="pipeline-detail-list">
            {plan.trust.reasons.map((reason) => (
              <span key={reason} className="workspace-meta-pill">
                {reason}
              </span>
            ))}
          </div>
        </SideInspector>
      </section>
    </div>
  );
}
