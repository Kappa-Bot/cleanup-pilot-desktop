import type { ReactNode } from "react";

interface DecisionPanelProps {
  kicker: string;
  title: string;
  summary: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  aside?: ReactNode;
}

export function DecisionPanel({
  kicker,
  title,
  summary,
  primaryActionLabel,
  secondaryActionLabel,
  onPrimaryAction,
  onSecondaryAction,
  aside
}: DecisionPanelProps) {
  return (
    <article className="decision-panel">
      <div className="decision-panel-copy">
        <small className="section-kicker">{kicker}</small>
        <h2>{title}</h2>
        <p className="muted">{summary}</p>
        <div className="row wrap">
          {primaryActionLabel ? (
            <button className="btn" type="button" onClick={onPrimaryAction}>
              {primaryActionLabel}
            </button>
          ) : null}
          {secondaryActionLabel ? (
            <button className="btn secondary" type="button" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      </div>
      {aside ? <div className="decision-panel-aside">{aside}</div> : null}
    </article>
  );
}
