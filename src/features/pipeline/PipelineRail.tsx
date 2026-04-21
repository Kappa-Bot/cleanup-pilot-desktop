import type { TopLevelSurface } from "../../types";
import { surfaceItems } from "./pipelineShared";

interface PipelineRailProps {
  surface: TopLevelSurface;
  homeStatus: string;
  historyStatus: string;
  onNavigate: (surface: TopLevelSurface) => void;
}

export function PipelineRail({ surface, homeStatus, historyStatus, onNavigate }: PipelineRailProps) {
  return (
    <aside className="pipeline-rail">
      <nav className="pipeline-nav" aria-label="Primary navigation">
        {surfaceItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            className={`pipeline-nav-button ${item.id === surface ? "is-active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </nav>
      <div className="pipeline-rail-note">
        <small className="section-kicker">Right now</small>
        <strong>
          {surface === "home"
            ? "Decide the next move"
            : surface === "scan"
              ? "Collect grouped issues"
              : surface === "plan"
                ? "Review the safe plan"
                : surface === "execute"
                  ? "Apply grouped actions"
                  : "Undo or purge by session"}
        </strong>
        <p className="muted">{surface === "history" ? historyStatus : homeStatus}</p>
      </div>
    </aside>
  );
}
