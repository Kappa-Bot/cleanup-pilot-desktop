import type { ReactNode } from "react";
import { DecisionPanel } from "../shared/DecisionPanel";
import { MetricStrip } from "../shared/MetricStrip";
import { SmartActionBar } from "../shared/SmartActionBar";

interface OptimizePageProps {
  activeView: string;
  onChangeView: (view: string) => void;
  bottleneckLabel: string;
  startupImpactLabel: string;
  driverRiskLabel: string;
  children: ReactNode;
}

const optimizeViews = [
  { id: "performance", label: "Performance", hint: "Primary issue first" },
  { id: "drivers", label: "Drivers", hint: "Official guidance" }
];

export function OptimizePage({
  activeView,
  onChangeView,
  bottleneckLabel,
  startupImpactLabel,
  driverRiskLabel,
  children
}: OptimizePageProps) {
  return (
    <section className="product-page">
      <DecisionPanel
        kicker="Optimize"
        title="Focus on the main drag, not every metric at once"
        summary="Performance, startup, services, tasks, and drivers are still available, but only the dominant issue should lead the screen."
        aside={
          <MetricStrip
            items={[
              { label: "Primary bottleneck", value: bottleneckLabel },
              { label: "Startup impact", value: startupImpactLabel },
              { label: "Driver risk", value: driverRiskLabel }
            ]}
          />
        }
      />
      <SmartActionBar items={optimizeViews} activeId={activeView} onSelect={onChangeView} />
      <div className="product-content-stack">{children}</div>
    </section>
  );
}
