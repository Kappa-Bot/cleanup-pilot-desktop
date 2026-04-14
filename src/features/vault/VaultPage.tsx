import type { ReactNode } from "react";
import { DecisionPanel } from "../shared/DecisionPanel";
import { MetricStrip } from "../shared/MetricStrip";
import { SmartActionBar } from "../shared/SmartActionBar";

interface VaultPageProps {
  activeView: string;
  onChangeView: (view: string) => void;
  activeQuarantineCount: number;
  totalRecords: number;
  retentionLabel: string;
  children: ReactNode;
}

const vaultViews = [
  { id: "quarantine", label: "Quarantine", hint: "Restore or purge" },
  { id: "settings", label: "Settings", hint: "Advanced only" }
];

export function VaultPage({
  activeView,
  onChangeView,
  activeQuarantineCount,
  totalRecords,
  retentionLabel,
  children
}: VaultPageProps) {
  return (
    <section className="product-page">
      <DecisionPanel
        kicker="Vault"
        title="Everything reversible lives here"
        summary="Quarantine and system-change history share the same trust model: review first, restore when needed, purge only on purpose."
        aside={
          <MetricStrip
            items={[
              { label: "Active items", value: activeQuarantineCount },
              { label: "Vault records", value: totalRecords },
              { label: "Retention", value: retentionLabel }
            ]}
          />
        }
      />
      <SmartActionBar items={vaultViews} activeId={activeView} onSelect={onChangeView} />
      <div className="product-content-stack">{children}</div>
    </section>
  );
}
