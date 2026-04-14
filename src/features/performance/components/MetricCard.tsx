import React from "react";

interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  accent?: "cpu" | "ram" | "disk" | "gpu" | "driver";
}

export function MetricCard({ label, value, detail, accent = "cpu" }: MetricCardProps) {
  return (
    <article className={`card performance-metric-card accent-${accent}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <p className="muted">{detail}</p> : null}
    </article>
  );
}
