import type { DecisionIssueBucket, SmartCheckRun } from "../../types";
import { DecisionPanel } from "../shared/DecisionPanel";
import { EmptyState } from "../shared/EmptyState";
import { IssueCard } from "../shared/IssueCard";
import { MetricStrip } from "../shared/MetricStrip";
import { SideInspector } from "../shared/SideInspector";
import { SmartActionBar } from "../shared/SmartActionBar";
import { formatBytes, scanStageItems } from "./pipelineShared";

interface ScanSurfaceProps {
  run: SmartCheckRun | null;
  status: string;
  scanStage: "scanning" | "findings" | "grouped";
  progress: number;
  eta: string;
  busy: string | null;
  buckets: DecisionIssueBucket[];
  onRunSmartCheck: () => void;
  onBuildPlan: () => void;
}

export function ScanSurface({ run, status, scanStage, progress, eta, busy, buckets, onRunSmartCheck, onBuildPlan }: ScanSurfaceProps) {
  if (!run) {
    return (
      <EmptyState
        kicker="Scan"
        title={busy === "scan" ? "Smart Check running" : "Nothing scanned yet"}
        summary={status}
        actionLabel={busy === "scan" ? "Scanning..." : "Run Smart Check"}
        onAction={busy === "scan" ? undefined : onRunSmartCheck}
        loading={busy === "scan"}
        eta={busy === "scan" ? eta : undefined}
      />
    );
  }

  return (
    <div className="pipeline-surface-stack">
      <DecisionPanel
        kicker="Scan"
        title={run.status === "completed" ? "Grouped issues" : "Scanning the machine"}
        summary={status}
        progress={{
          value: progress,
          label: run.status === "completed" ? "Smart Check complete" : "Smart Check running",
          eta: run.status === "completed" ? "Ready for plan" : eta,
          tone: run.status === "completed" ? "complete" : run.status === "failed" ? "danger" : "active"
        }}
        primaryActionLabel={run.status === "completed" ? "Build Plan" : undefined}
        onPrimaryAction={run.status === "completed" ? onBuildPlan : undefined}
        aside={
          <MetricStrip
            items={[
              { label: "Findings", value: run.cleaner.findingsCount, hint: "Grouped, not raw files" },
              { label: "Safe selection", value: formatBytes(run.cleaner.selectedBytes), hint: `${run.cleaner.selectedCount} default targets` },
              { label: "Startup", value: run.optimize.startupIssues, hint: `${run.optimize.performanceIssues} background issues` }
            ]}
          />
        }
      />
      <SmartActionBar items={scanStageItems} activeId={scanStage} />
      <section className="pipeline-grid">
        <div className="pipeline-card-list">
          {buckets.map((bucket) => (
            <article key={bucket.id} className="pipeline-card">
              <header className="pipeline-card-header">
                <div>
                  <small className="section-kicker">{bucket.label}</small>
                  <h3>{bucket.count} grouped {bucket.count === 1 ? "issue" : "issues"}</h3>
                </div>
              </header>
              <p className="muted">{bucket.summary}</p>
              <div className="issue-grid issue-grid--compact">
                {bucket.issues.slice(0, 3).map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            </article>
          ))}
        </div>
        <SideInspector kicker="Decision" title="What happens next" summary="Build a compact plan before any change is applied.">
          <div className="pipeline-detail-list">
            <span className="workspace-meta-pill">No raw tables</span>
            <span className="workspace-meta-pill">Blocked items stay excluded</span>
            <span className="workspace-meta-pill">Startup actions remain reversible</span>
          </div>
        </SideInspector>
      </section>
    </div>
  );
}
