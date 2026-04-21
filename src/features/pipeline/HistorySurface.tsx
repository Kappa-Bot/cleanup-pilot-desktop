import type { ExecutionSession } from "../../types";
import { DecisionPanel } from "../shared/DecisionPanel";
import { EmptyState } from "../shared/EmptyState";
import { MetricStrip } from "../shared/MetricStrip";
import { SideInspector } from "../shared/SideInspector";
import { formatBytes, formatDate, latestHistoryTitle } from "./pipelineShared";

interface HistorySurfaceProps {
  historySessions: ExecutionSession[];
  historyStatus: string;
  activeHistorySession: ExecutionSession | null;
  busy: string | null;
  onRefresh: () => void;
  onSelectSession: (sessionId: string) => void;
  onMutateSession: (mode: "restore" | "purge", sessionId: string) => void;
}

export function HistorySurface({
  historySessions,
  historyStatus,
  activeHistorySession,
  busy,
  onRefresh,
  onSelectSession,
  onMutateSession
}: HistorySurfaceProps) {
  if (!historySessions.length) {
    return <EmptyState kicker="History" title="No sessions yet" summary={historyStatus} />;
  }

  return (
    <div className="pipeline-surface-stack">
      <DecisionPanel
        kicker="History"
        title="Undo and trust live here"
        summary={historyStatus}
        secondaryActionLabel="Refresh"
        onSecondaryAction={onRefresh}
        aside={
          <MetricStrip
            items={[
              { label: "Sessions", value: historySessions.length, hint: "Grouped by run" },
              { label: "Latest", value: formatDate(historySessions[0]?.completedAt), hint: latestHistoryTitle(historySessions) },
              { label: "Reversible", value: historySessions.filter((item) => item.hasUndo).length, hint: "Undo still available" }
            ]}
          />
        }
      />

      <section className="pipeline-grid">
        <div className="pipeline-card-list">
          {historySessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`pipeline-card pipeline-card--button ${session.id === activeHistorySession?.id ? "is-active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <div className="pipeline-card-header">
                <div>
                  <small className="section-kicker">{session.title}</small>
                  <h3>{formatDate(session.completedAt)}</h3>
                </div>
                <span className="workspace-meta-pill">{session.status}</span>
              </div>
              <p className="muted">{session.summary}</p>
              <div className="pipeline-report-strip">
                <span className="workspace-meta-pill">{formatBytes(session.freedBytes)} recovered</span>
                <span className="workspace-meta-pill">{session.cleanupMovedCount} cleanup</span>
                <span className="workspace-meta-pill">{session.optimizationChangeCount} optimize</span>
              </div>
            </button>
          ))}
        </div>

        {activeHistorySession ? (
          <SideInspector kicker="Session details" title={activeHistorySession.title} summary={activeHistorySession.trustSummary}>
            <div className="pipeline-detail-list">
              {activeHistorySession.selectedIssues.slice(0, 4).map((issue) => (
                <span key={issue.id} className="workspace-meta-pill">
                  {issue.title}
                </span>
              ))}
              {activeHistorySession.reversibleActions.map((entry) => (
                <span key={entry} className="workspace-meta-pill">
                  {entry}
                </span>
              ))}
            </div>
            <div className="pipeline-button-row">
              <button
                className="btn"
                type="button"
                disabled={!activeHistorySession.hasUndo || busy === "restore"}
                onClick={() => onMutateSession("restore", activeHistorySession.id)}
              >
                Undo
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={!activeHistorySession.hasPurge || busy === "purge"}
                onClick={() => onMutateSession("purge", activeHistorySession.id)}
              >
                Purge
              </button>
            </div>
          </SideInspector>
        ) : null}
      </section>
    </div>
  );
}
