import type { TopLevelSurface } from "../../types";
import { surfaceItems } from "./pipelineShared";

interface PipelineRailProps {
  surface: TopLevelSurface;
  homeStatus: string;
  historyStatus: string;
  disabledSurfaces?: TopLevelSurface[];
  onNavigate: (surface: TopLevelSurface) => void;
}

export function PipelineRail({ surface, homeStatus, historyStatus, disabledSurfaces = [], onNavigate }: PipelineRailProps) {
  return (
    <aside className="pipeline-rail">
      <nav className="pipeline-nav" aria-label="Primary navigation">
        {surfaceItems.map((item) => {
          const disabled = item.id !== surface && disabledSurfaces.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-disabled={disabled}
              disabled={disabled}
              className={`pipeline-nav-button ${item.id === surface ? "is-active" : ""}`}
              onClick={() => {
                if (!disabled) {
                  onNavigate(item.id);
                }
              }}
            >
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </button>
          );
        })}
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
