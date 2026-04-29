interface ProgressMeterProps {
  value?: number;
  label: string;
  eta?: string;
  tone?: "active" | "complete" | "warning" | "danger";
  indeterminate?: boolean;
}

export function ProgressMeter({ value = 0, label, eta, tone = "active", indeterminate = false }: ProgressMeterProps) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div className={`progress-meter tone-${tone} ${indeterminate ? "is-indeterminate" : ""}`}>
      <div className="progress-meter-copy">
        <span>{label}</span>
        {eta ? <small>{eta}</small> : null}
      </div>
      <div className="progress-meter-track" aria-hidden="true">
        <span style={indeterminate ? undefined : { width: `${safeValue}%` }} />
      </div>
    </div>
  );
}
