import type { ReactNode } from "react";

interface SideInspectorProps {
  kicker?: string;
  title: string;
  summary?: string;
  children: ReactNode;
}

export function SideInspector({ kicker, title, summary, children }: SideInspectorProps) {
  return (
    <aside className="side-inspector">
      {kicker ? <small className="section-kicker">{kicker}</small> : null}
      <h3>{title}</h3>
      {summary ? <p className="muted">{summary}</p> : null}
      {children}
    </aside>
  );
}
