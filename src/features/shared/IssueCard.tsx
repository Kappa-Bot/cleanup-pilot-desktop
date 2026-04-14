import type { ProductIssueCard } from "../../types";
import { TrustBadge } from "./TrustBadge";

interface IssueCardProps {
  issue: ProductIssueCard;
  active?: boolean;
  onSelect?: () => void;
}

export function IssueCard({ issue, active = false, onSelect }: IssueCardProps) {
  const Element = onSelect ? "button" : "article";
  return (
    <Element className={`issue-card ${active ? "is-active" : ""}`} onClick={onSelect} type={onSelect ? "button" : undefined}>
      <div className="issue-card-header">
        <TrustBadge severity={issue.severity} />
        <small>{issue.domain}</small>
      </div>
      <h3>{issue.title}</h3>
      <p className="muted">{issue.summary}</p>
      <div className="issue-card-evidence">
        {issue.evidence.slice(0, 3).map((entry) => (
          <span key={`${issue.id}:${entry}`} className="workspace-meta-pill">
            {entry}
          </span>
        ))}
      </div>
    </Element>
  );
}
