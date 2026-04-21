import type { ActionPlanSummary, DecisionExecutionProgressEvent, ExecutionSession } from "../../types";
import { DecisionPanel } from "../shared/DecisionPanel";
import { MetricStrip } from "../shared/MetricStrip";
import { executionStageLabel, executionStageOrder } from "./pipelineShared";

interface ExecuteSurfaceProps {
  executionProgress: DecisionExecutionProgressEvent;
  executionSession: ExecutionSession | null;
  plan: ActionPlanSummary | null;
  onApplyPlan: () => void;
  onOpenSessionReport: () => void;
}

export function ExecuteSurface({
  executionProgress,
  executionSession,
  plan,
  onApplyPlan,
  onOpenSessionReport
}: ExecuteSurfaceProps) {
  const completed = executionProgress.stage === "completed" && executionSession;

  return (
    <div className="pipeline-surface-stack">
      <DecisionPanel
        kicker="Execute"
        title={completed ? "Plan applied" : executionProgress.title}
        summary={completed ? executionSession.summary : executionProgress.summary}
        primaryActionLabel={completed ? "Open session report" : "Apply plan"}
        onPrimaryAction={completed ? onOpenSessionReport : onApplyPlan}
        aside={
          <MetricStrip
            items={[
              { label: "Progress", value: `${Math.max(0, executionProgress.percent)}%`, hint: executionStageLabel(executionProgress.stage) },
              { label: "Cleanup", value: executionSession?.cleanupMovedCount ?? plan?.cleanupPreview?.actionCount ?? 0, hint: "Grouped actions" },
              { label: "Optimize", value: executionSession?.optimizationChangeCount ?? plan?.optimizationPreview?.reversibleCount ?? 0, hint: "Reversible changes" }
            ]}
          />
        }
      />

      <article className="pipeline-card">
        <header className="pipeline-card-header">
          <div>
            <small className="section-kicker">Progress</small>
            <h3>What is happening right now</h3>
          </div>
        </header>
        <div className="execution-phase-list">
          {executionStageOrder.map((stage) => {
            const activeIndex = executionStageOrder.indexOf(executionProgress.stage === "failed" ? "reporting" : executionProgress.stage);
            const stageIndex = executionStageOrder.indexOf(stage);
            const stateClass = stageIndex < activeIndex ? "is-complete" : stageIndex === activeIndex ? "is-active" : "";
            return (
              <div key={stage} className={`execution-phase ${stateClass}`}>
                <strong>{executionStageLabel(stage)}</strong>
                <span className="muted">{stage === executionProgress.stage ? executionProgress.summary : "Waiting"}</span>
              </div>
            );
          })}
        </div>
      </article>
    </div>
  );
}
