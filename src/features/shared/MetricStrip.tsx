import type { ReactNode } from "react";

interface MetricItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

interface MetricStripProps {
  items: MetricItem[];
}

export function MetricStrip({ items }: MetricStripProps) {
  return (
    <div className="product-metric-strip">
      {items.map((item) => (
        <article key={item.label} className="product-metric-card">
          <small>{item.label}</small>
          <strong>{item.value}</strong>
          {item.hint ? <span>{item.hint}</span> : null}
        </article>
      ))}
    </div>
  );
}
