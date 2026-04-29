import { ProgressMeter } from "./ProgressMeter";

interface EmptyStateProps {
  kicker?: string;
  title: string;
  summary: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  eta?: string;
}

export function EmptyState({ kicker, title, summary, actionLabel, onAction, loading = false, eta }: EmptyStateProps) {
  return (
    <article className="empty-state-card">
      {kicker ? <small className="section-kicker">{kicker}</small> : null}
      <h3>{title}</h3>
      <p className="muted">{summary}</p>
      {loading ? <ProgressMeter label="Working" eta={eta} indeterminate /> : null}
      {actionLabel ? (
        <button className="btn secondary" type="button" disabled={!onAction} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}
