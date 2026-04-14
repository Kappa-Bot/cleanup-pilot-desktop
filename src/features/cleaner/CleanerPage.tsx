import type { ReactNode } from "react";
import { DecisionPanel } from "../shared/DecisionPanel";
import { MetricStrip } from "../shared/MetricStrip";
import { SmartActionBar } from "../shared/SmartActionBar";

interface CleanerPageProps {
  activeView: string;
  onChangeView: (view: string) => void;
  findingsCount: number;
  selectedFindingCount: number;
  selectedBytesLabel: string;
  blockedCount: number;
  children: ReactNode;
}

const cleanerViews = [
  { id: "scan", label: "Smart Check", hint: "Quick guided pass" },
  { id: "cleanup", label: "Review Plan", hint: "Grouped actions" },
  { id: "overview", label: "Explore Disk", hint: "Whole-disk map" },
  { id: "duplicates", label: "Duplicates", hint: "High-volume repeats" },
  { id: "ai", label: "AI Guidance", hint: "Contextual only" },
  { id: "safety", label: "Blocked Items", hint: "Why items were protected" }
];

export function CleanerPage({
  activeView,
  onChangeView,
  findingsCount,
  selectedFindingCount,
  selectedBytesLabel,
  blockedCount,
  children
}: CleanerPageProps) {
  return (
    <section className="product-page">
      <DecisionPanel
        kicker="Cleaner"
        title="One cleanup workspace, not four separate tools"
        summary="Collections stay first. Raw file lists, AI detail, and blocked-item diagnostics stay behind focused subviews."
        aside={
          <MetricStrip
            items={[
              { label: "Findings", value: findingsCount },
              { label: "Selected", value: selectedFindingCount },
              { label: "Recoverable", value: selectedBytesLabel },
              { label: "Blocked", value: blockedCount }
            ]}
          />
        }
      />
      <SmartActionBar items={cleanerViews} activeId={activeView} onSelect={onChangeView} />
      <div className="product-content-stack">{children}</div>
    </section>
  );
}
