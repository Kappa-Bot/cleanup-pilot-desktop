interface SmartActionItem {
  id: string;
  label: string;
  hint?: string;
}

interface SmartActionBarProps {
  items: SmartActionItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function SmartActionBar({ items, activeId, onSelect }: SmartActionBarProps) {
  return (
    <div className="smart-action-bar" role="tablist" aria-label="Section views">
      {items.map((item) => (
        <button
          key={item.id}
          className={`smart-action-pill ${item.id === activeId ? "is-active" : ""}`}
          type="button"
          onClick={() => onSelect(item.id)}
        >
          <strong>{item.label}</strong>
          {item.hint ? <small>{item.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}
