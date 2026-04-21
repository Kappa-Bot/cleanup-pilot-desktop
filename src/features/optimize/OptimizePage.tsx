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
  onRunOneClickFocus?: () => void;
  children: ReactNode;
}

const optimizeViews = [
  { id: "performance", label: "Performance", hint: "Primary issue first" },
  { id: "startup", label: "Startup Optimizer", hint: "Keep, disable, delay" },
  { id: "background", label: "Background Load", hint: "Services and tasks" },
  { id: "drivers", label: "Drivers", hint: "Official guidance" }
];

export function OptimizePage({
  activeView,
  onChangeView,
  bottleneckLabel,
  startupImpactLabel,
  driverRiskLabel,
  onRunOneClickFocus,
  children
}: OptimizePageProps) {
  return (
    <section className="product-page">
      <DecisionPanel
        kicker="Optimize"
        title="Focus on the main drag, not every metric at once"
        summary="One-click optimization stays preview-first. Startup, background load, and driver guidance only rise when they change the decision."
        primaryActionLabel="Open next best optimization"
        onPrimaryAction={onRunOneClickFocus}
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
