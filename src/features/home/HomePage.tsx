import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CoverageCatalogResponse,
  HealthSubscore,
  HomeSummarySnapshot,
  ProductIssueCard
} from "../../types";
import { DecisionPanel } from "../shared/DecisionPanel";
import { EmptyState } from "../shared/EmptyState";
import { IssueCard } from "../shared/IssueCard";
import { MetricStrip } from "../shared/MetricStrip";
import { SideInspector } from "../shared/SideInspector";

interface HomePageProps {
  formatBytes: (value: number) => string;
  onOpenCleaner: () => void;
  onOpenOptimize: () => void;
  onOpenVault: () => void;
}

function safetyCopy(state: HomeSummarySnapshot["safetyState"]): string {
  if (state === "attention_needed") {
    return "Blocked items need review";
  }
  if (state === "review_needed") {
    return "Some items still need review";
  }
  return "Protection is active";
}

function bottleneckLabel(value: HomeSummarySnapshot["primaryBottleneck"]): string {
  return value === "unknown" ? "No dominant bottleneck" : value.replace(/_/g, " ");
}

function subscoreToneClass(status: HealthSubscore["status"]): string {
  if (status === "action") {
    return "tone-high";
  }
  if (status === "watch") {
    return "tone-medium";
  }
  return "tone-low";
}

export function HomePage({ formatBytes, onOpenCleaner, onOpenOptimize, onOpenVault }: HomePageProps) {
  const [snapshot, setSnapshot] = useState<HomeSummarySnapshot | null>(null);
  const [catalog, setCatalog] = useState<CoverageCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Loading product summary...");
  const [activeIssueId, setActiveIssueId] = useState("");
  const pollingRef = useRef<number | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setStatus("Refreshing machine summary...");
    try {
      const [home, coverage] = await Promise.all([window.desktopApi.getHomeSnapshot(), window.desktopApi.getCoverageCatalog()]);
      setSnapshot(home.snapshot);
      setCatalog(coverage);
      setActiveIssueId(home.snapshot.recommendedIssue?.id ?? home.snapshot.topIssues[0]?.id ?? "");
      setStatus("Summary ready.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load machine summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    return () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [loadSummary]);

  const runSmartCheck = useCallback(async () => {
    setStatus("Running Smart Check...");
    const { runId } = await window.desktopApi.runSmartCheck("fast");
    if (pollingRef.current !== null) {
      window.clearInterval(pollingRef.current);
    }
    pollingRef.current = window.setInterval(async () => {
      try {
        const current = await window.desktopApi.getSmartCheckCurrent(runId);
        setSnapshot(current.run.summary);
        setActiveIssueId((value) => value || current.run.summary.recommendedIssue?.id || current.run.summary.topIssues[0]?.id || "");
        if (current.run.status === "completed" || current.run.status === "failed" || current.run.status === "canceled") {
          if (pollingRef.current !== null) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setStatus(current.run.status === "completed" ? "Smart Check complete." : `Smart Check ${current.run.status}.`);
        }
      } catch (error) {
        if (pollingRef.current !== null) {
          window.clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setStatus(error instanceof Error ? error.message : "Smart Check failed.");
      }
    }, 1200);
  }, []);

  const activeIssue = useMemo(() => {
    if (!snapshot?.topIssues.length) {
      return snapshot?.recommendedIssue ?? null;
    }
    return snapshot.topIssues.find((item) => item.id === activeIssueId) ?? snapshot.recommendedIssue ?? snapshot.topIssues[0] ?? null;
  }, [activeIssueId, snapshot]);

  const openIssueDomain = useCallback(
    (issue: ProductIssueCard | null) => {
      if (!issue) {
        onOpenCleaner();
        return;
      }
      if (issue.domain === "cleanup" || issue.domain === "duplicates" || issue.domain === "safety") {
        onOpenCleaner();
        return;
      }
      if (issue.domain === "startup" || issue.domain === "performance" || issue.domain === "drivers") {
        onOpenOptimize();
        return;
      }
      onOpenVault();
    },
    [onOpenCleaner, onOpenOptimize, onOpenVault]
  );

  if (loading && !snapshot) {
    return <EmptyState kicker="Home" title="Loading machine summary" summary={status} />;
  }

  if (!snapshot) {
    return <EmptyState kicker="Home" title="Summary unavailable" summary={status} actionLabel="Retry" onAction={() => void loadSummary()} />;
  }

  const subscores = (snapshot.subscores ?? []).slice(0, 4);
  const report = snapshot.latestReport;
  const trustSummary = snapshot.trustSummary ?? "Everything remains preview-first, quarantine-first, and reversible.";
  const trend = snapshot.trend ?? {
    direction: "unknown" as const,
    delta: 0,
    label: "Trend not available yet",
    windowLabel: "Need more history"
  };

  return (
    <section className="product-page product-page--home">
      <DecisionPanel
        kicker="Home"
        title={snapshot.healthScore >= 80 ? "Your PC is stable" : "Your PC needs attention"}
        summary={snapshot.recommendedActionSummary ?? snapshot.recommendedIssue?.summary ?? "Run Smart Check to refresh priorities."}
        primaryActionLabel="Run Smart Check"
        secondaryActionLabel={snapshot.recommendedIssue ? snapshot.recommendedIssue.primaryActionLabel : "Open Cleaner"}
        onPrimaryAction={() => void runSmartCheck()}
        onSecondaryAction={() => openIssueDomain(snapshot.recommendedIssue)}
        aside={
          <MetricStrip
            items={[
              { label: "Health score", value: snapshot.healthScore, hint: trend.label },
              { label: "Space to recover", value: formatBytes(snapshot.reclaimableBytes), hint: "Safe wins stay grouped" },
              { label: "Main issue", value: bottleneckLabel(snapshot.primaryBottleneck), hint: "Highest-ranked signal" },
              { label: "Safety", value: safetyCopy(snapshot.safetyState), hint: "Protection stays active" }
            ]}
          />
        }
      />

      <div className="product-home-grid">
        <div className="product-home-main">
          <article className="card product-lane-card product-lane-card--hero">
            <header className="panel-header compact">
              <div>
                <small className="section-kicker">System Health 2.0</small>
                <h3>{trend.label}</h3>
              </div>
              <span className="muted">{trend.windowLabel}</span>
            </header>
            <div className="health-subscore-grid">
              {subscores.map((item) => (
                <article key={item.key} className={`health-subscore-card ${subscoreToneClass(item.status)}`}>
                  <div className="health-subscore-header">
                    <small>{item.label}</small>
                    <strong>{item.score}</strong>
                  </div>
                  <p className="muted">{item.summary}</p>
                  <div className="issue-card-evidence">
                    {item.evidence.slice(0, 2).map((entry) => (
                      <span key={`${item.key}:${entry}`} className="workspace-meta-pill">
                        {entry}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="card product-lane-card">
            <header className="panel-header compact">
              <div>
                <small className="section-kicker">Recommended next action</small>
                <h3>{snapshot.recommendedIssue?.title ?? "No urgent issue"}</h3>
              </div>
              <span className="muted">{status}</span>
            </header>
            {snapshot.recommendedIssue ? (
              <>
                <IssueCard issue={snapshot.recommendedIssue} active />
                <p className="muted product-trust-copy">{trustSummary}</p>
              </>
            ) : (
              <p className="muted">No ranked issue is currently ahead of the rest.</p>
            )}
          </article>

          {report ? (
            <article className="card product-lane-card">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Before / After</small>
                  <h3>Latest maintenance report</h3>
                </div>
              </header>
              <div className="product-report-strip">
                <span className="workspace-meta-pill">{formatBytes(report.freedBytes)} recovered</span>
                <span className="workspace-meta-pill">{report.cleanupMovedCount} cleanup item{report.cleanupMovedCount === 1 ? "" : "s"}</span>
                <span className="workspace-meta-pill">{report.optimizationChangeCount} reversible change{report.optimizationChangeCount === 1 ? "" : "s"}</span>
                {report.backgroundReductionPct !== undefined ? (
                  <span className="workspace-meta-pill">{report.backgroundReductionPct}% lower background load</span>
                ) : null}
              </div>
              <p className="muted product-trust-copy">{report.trustSummary}</p>
            </article>
          ) : null}

          <article className="card product-lane-card">
            <header className="panel-header compact">
              <div>
                <small className="section-kicker">Top issues</small>
                <h3>Focus only on the next few moves</h3>
              </div>
            </header>
            <div className="issue-grid issue-grid--compact">
              {snapshot.topIssues.slice(0, 4).map((issue) => (
                <IssueCard key={issue.id} issue={issue} active={issue.id === activeIssue?.id} onSelect={() => setActiveIssueId(issue.id)} />
              ))}
            </div>
          </article>
        </div>

        <SideInspector
          kicker="Why this is safe"
          title={activeIssue?.title ?? "No issue selected"}
          summary={activeIssue?.trustSummary ?? activeIssue?.summary ?? trustSummary}
        >
          {activeIssue ? (
            <>
              <div className="issue-card-evidence issue-card-evidence--stacked">
                {activeIssue.evidence.map((entry) => (
                  <span key={`${activeIssue.id}:${entry}`} className="workspace-meta-pill">
                    {entry}
                  </span>
                ))}
              </div>
              {activeIssue.changeSummary?.length ? (
                <div className="product-inline-list">
                  {activeIssue.changeSummary.map((entry) => (
                    <span key={`${activeIssue.id}:change:${entry}`} className="workspace-meta-pill">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="row wrap">
                <button className="btn" type="button" onClick={() => openIssueDomain(activeIssue)}>
                  Review selected issue
                </button>
                <button className="btn secondary" type="button" onClick={() => void loadSummary()}>
                  Refresh Summary
                </button>
              </div>
            </>
          ) : null}
          <p className="muted product-trust-copy">{trustSummary}</p>
          {catalog ? (
            <details className="settings-advanced-panel">
              <summary>Coverage snapshot</summary>
              <p className="muted">
                {catalog.totals.windowsAreasCovered}/{catalog.windowsAreas.length} Windows areas and {catalog.totals.appFamiliesCovered}/{catalog.appFamilies.length} app families are curated today.
              </p>
            </details>
          ) : null}
        </SideInspector>
      </div>
    </section>
  );
}
