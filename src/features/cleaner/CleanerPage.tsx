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
  scheduleLabel?: string;
  children: ReactNode;
}

const cleanerPrimaryViews = [
  { id: "scan", label: "Smart Check", hint: "Quick guided pass" },
  { id: "cleanup", label: "Review Plan", hint: "Grouped actions" },
  { id: "overview", label: "Explore Disk", hint: "Whole-disk map" }
];

const cleanerSecondaryViews = [
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
  scheduleLabel,
  children
}: CleanerPageProps) {
  const isSecondaryView = cleanerSecondaryViews.some((item) => item.id === activeView);

  return (
    <section className="product-page">
      <DecisionPanel
        kicker="Cleaner"
        title="One cleanup workspace, not a stack of separate tools"
        summary="Safe wins, review lanes, duplicates, blocked items, and disk exploration stay in one calm workflow. Advanced detail only appears when you ask for it."
        aside={
          <MetricStrip
            items={[
              { label: "Findings", value: findingsCount },
              { label: "Selected", value: selectedFindingCount },
              { label: "Recoverable", value: selectedBytesLabel },
              { label: "Blocked", value: blockedCount, hint: scheduleLabel ?? "Manual mode" }
            ]}
          />
        }
      />
      <SmartActionBar items={cleanerPrimaryViews} activeId={isSecondaryView ? "" : activeView} onSelect={onChangeView} />
      <details className="product-secondary-switcher" open={isSecondaryView}>
        <summary>{isSecondaryView ? "More review tools open" : "More review tools"}</summary>
        <div className="product-secondary-switcher-body">
          {cleanerSecondaryViews.map((item) => (
            <button
              key={item.id}
              className={activeView === item.id ? "legacy-link active" : "legacy-link"}
              type="button"
              onClick={() => onChangeView(item.id)}
            >
              <strong>{item.label}</strong>
              {item.hint ? <small>{item.hint}</small> : null}
            </button>
          ))}
        </div>
      </details>
      <div className="product-content-stack">{children}</div>
    </section>
  );
}
