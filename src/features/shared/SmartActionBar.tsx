interface SmartActionItem {
  id: string;
  label: string;
  hint?: string;
}

interface SmartActionBarProps {
  items: SmartActionItem[];
  activeId: string;
  onSelect?: (id: string) => void;
}

export function SmartActionBar({ items, activeId, onSelect }: SmartActionBarProps) {
  return (
    <div className="smart-action-bar" role="list" aria-label="Progress stages">
      {items.map((item) => {
        const active = item.id === activeId;
        if (!onSelect) {
          return (
            <div key={item.id} className={`smart-action-pill ${active ? "is-active" : ""}`} role="listitem" aria-current={active ? "step" : undefined}>
              <strong>{item.label}</strong>
              {item.hint ? <small>{item.hint}</small> : null}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            className={`smart-action-pill ${active ? "is-active" : ""}`}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.label}</strong>
            {item.hint ? <small>{item.hint}</small> : null}
          </button>
        );
      })}
    </div>
  );
}
