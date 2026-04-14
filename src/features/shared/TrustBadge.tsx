import type { IssueSeverity } from "../../types";

interface TrustBadgeProps {
  severity: IssueSeverity;
}

const labelBySeverity: Record<IssueSeverity, string> = {
  safe_win: "Safe win",
  review: "Review",
  high_impact: "High impact",
  blocked: "Blocked"
};

export function TrustBadge({ severity }: TrustBadgeProps) {
  return <span className={`trust-badge trust-badge--${severity}`}>{labelBySeverity[severity]}</span>;
}
