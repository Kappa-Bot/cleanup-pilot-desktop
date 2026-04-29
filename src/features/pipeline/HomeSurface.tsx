import type { ExecutionSession, HomeSummarySnapshot } from "../../types";
import { DecisionPanel } from "../shared/DecisionPanel";
import { EmptyState } from "../shared/EmptyState";
import { MetricStrip } from "../shared/MetricStrip";
import { SideInspector } from "../shared/SideInspector";
import { bottleneckLabel, formatBytes, formatDate, safetyCopy } from "./pipelineShared";

interface HomeSurfaceProps {
  snapshot: HomeSummarySnapshot | null;
  homeStatus: string;
  loading: boolean;
  historySessions: ExecutionSession[];
  onReload: () => void;
  onRunSmartCheck: () => void;
  onOpenHistory: () => void;
}

export function HomeSurface({ snapshot, homeStatus, loading, historySessions, onReload, onRunSmartCheck, onOpenHistory }: HomeSurfaceProps) {
  if (!snapshot) {
    return (
      <EmptyState
        kicker="Home"
        title={loading ? "Reading system state" : "System state unavailable"}
        summary={homeStatus}
        actionLabel={loading ? undefined : "Retry"}
        onAction={onReload}
        loading={loading}
        eta="Usually under 1 sec"
      />
    );
  }

  const homeSubscores = (snapshot.subscores ?? []).slice(0, 3);

  return (
    <div className="pipeline-surface-stack">
      <DecisionPanel
        kicker="Home"
        title={snapshot.healthScore >= 80 ? "System looks stable" : `${snapshot.topIssues.length || 1} issues need attention`}
        summary={snapshot.recommendedActionSummary ?? "Run Smart Check to refresh the next safe move."}
        primaryActionLabel="Run Smart Check"
        secondaryActionLabel={historySessions.length ? "Review last session" : undefined}
        onPrimaryAction={onRunSmartCheck}
        onSecondaryAction={historySessions.length ? onOpenHistory : undefined}
        aside={
          <MetricStrip
            items={[
              { label: "Health", value: snapshot.healthScore, hint: snapshot.trend?.label ?? "No trend yet" },
              { label: "Recoverable", value: formatBytes(snapshot.reclaimableBytes), hint: "Safe cleanup grouped" },
              { label: "Main issue", value: bottleneckLabel(snapshot), hint: safetyCopy(snapshot) }
            ]}
          />
        }
      />

      <section className="pipeline-grid pipeline-grid--home">
        <article className="pipeline-card">
          <header className="pipeline-card-header">
            <div>
              <small className="section-kicker">Health</small>
              <h3>Important signals only</h3>
            </div>
            <span className="muted">{snapshot.trend?.windowLabel ?? "No trend yet"}</span>
          </header>
          <div className="pipeline-score-grid">
            {homeSubscores.map((item) => (
              <article key={item.key} className={`pipeline-score-card tone-${item.status}`}>
                <div className="pipeline-score-head">
                  <strong>{item.score}</strong>
                  <small>{item.label}</small>
                </div>
                <p className="muted">{item.summary}</p>
              </article>
            ))}
          </div>
        </article>

        <SideInspector
          kicker="Why this now"
          title={snapshot.recommendedIssue?.title ?? "Run Smart Check"}
          summary={snapshot.trustSummary ?? "Everything stays preview-first, quarantine-first, and reversible."}
        >
          <div className="pipeline-detail-list">
            {(snapshot.recommendedIssue?.evidence ?? [homeStatus]).slice(0, 3).map((entry) => (
              <span key={entry} className="workspace-meta-pill">
                {entry}
              </span>
            ))}
            {snapshot.latestReport ? (
              <div className="pipeline-report-line muted">
                Last session: {formatBytes(snapshot.latestReport.freedBytes)} recovered on {formatDate(snapshot.latestReport.generatedAt)}
              </div>
            ) : null}
          </div>
        </SideInspector>
      </section>
    </div>
  );
}
