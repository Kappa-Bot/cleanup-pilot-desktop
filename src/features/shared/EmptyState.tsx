interface EmptyStateProps {
  kicker?: string;
  title: string;
  summary: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ kicker, title, summary, actionLabel, onAction }: EmptyStateProps) {
  return (
    <article className="empty-state-card">
      {kicker ? <small className="section-kicker">{kicker}</small> : null}
      <h3>{title}</h3>
      <p className="muted">{summary}</p>
      {actionLabel ? (
        <button className="btn secondary" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}
