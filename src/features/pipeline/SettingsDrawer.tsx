import type { Dispatch, SetStateAction } from "react";
import type { AppConfig } from "../../types";
import type { VisualTheme } from "./pipelineShared";
import { visualThemeItems } from "./pipelineShared";

interface SettingsDrawerProps {
  draftSettings: AppConfig;
  busy: string | null;
  visualTheme: VisualTheme;
  onClose: () => void;
  onSave: () => void;
  onVisualThemeChange: (theme: VisualTheme) => void;
  setDraftSettings: Dispatch<SetStateAction<AppConfig | null>>;
}

export function SettingsDrawer({
  draftSettings,
  busy,
  visualTheme,
  onClose,
  onSave,
  onVisualThemeChange,
  setDraftSettings
}: SettingsDrawerProps) {
  return (
    <aside className="settings-drawer" aria-label="Settings drawer">
      <div className="settings-drawer-header">
        <div>
          <small className="section-kicker">Settings</small>
          <h3>Configuration</h3>
        </div>
        <button className="btn secondary" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="settings-section">
        <small className="section-kicker">Appearance</small>
        <div className="theme-choice-grid" aria-label="Visual theme">
          {visualThemeItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`theme-choice ${visualTheme === item.id ? "is-active" : ""}`}
              onClick={() => onVisualThemeChange(item.id)}
            >
              <span className={`theme-swatch theme-swatch-${item.id}`} aria-hidden="true" />
              <strong>{item.label}</strong>
              <small>{item.summary}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <small className="section-kicker">Automation</small>
        <label className="settings-field">
          <span>AI provider</span>
          <select
            value={draftSettings.aiProvider}
            onChange={(event) =>
              setDraftSettings((current) => (current ? { ...current, aiProvider: event.target.value as AppConfig["aiProvider"] } : current))
            }
          >
            <option value="auto">Auto</option>
            <option value="local">Local</option>
            <option value="cerebras">Cerebras</option>
          </select>
        </label>
        <label className="settings-field checkbox-field">
          <input
            type="checkbox"
            checked={draftSettings.scheduleEnabled}
            onChange={(event) => setDraftSettings((current) => (current ? { ...current, scheduleEnabled: event.target.checked } : current))}
          />
          <span>Enable safe auto-clean schedule</span>
        </label>
        <label className="settings-field">
          <span>Schedule time</span>
          <input
            type="time"
            value={draftSettings.scheduleTime}
            onChange={(event) => setDraftSettings((current) => (current ? { ...current, scheduleTime: event.target.value } : current))}
          />
        </label>
      </div>

      <div className="settings-section">
        <small className="section-kicker">Accessibility</small>
        <label className="settings-field checkbox-field">
          <input
            type="checkbox"
            checked={draftSettings.reducedMotion}
            onChange={(event) => setDraftSettings((current) => (current ? { ...current, reducedMotion: event.target.checked } : current))}
          />
          <span>Reduce motion</span>
        </label>
        <label className="settings-field checkbox-field">
          <input
            type="checkbox"
            checked={draftSettings.highContrast}
            onChange={(event) => setDraftSettings((current) => (current ? { ...current, highContrast: event.target.checked } : current))}
          />
          <span>High contrast</span>
        </label>
      </div>

      <div className="settings-section">
        <small className="section-kicker">Protection</small>
        <label className="settings-field">
          <span>Quarantine retention (days)</span>
          <input
            type="number"
            min={1}
            value={draftSettings.quarantineRetentionDays}
            onChange={(event) =>
              setDraftSettings((current) =>
                current ? { ...current, quarantineRetentionDays: Math.max(1, Number(event.target.value || current.quarantineRetentionDays)) } : current
              )
            }
          />
        </label>
        <label className="settings-field">
          <span>Advanced roots</span>
          <textarea
            rows={5}
            value={draftSettings.customRoots.join("\n")}
            onChange={(event) =>
              setDraftSettings((current) =>
                current
                  ? {
                      ...current,
                      customRoots: event.target.value
                        .split(/\r?\n/)
                        .map((item) => item.trim())
                        .filter(Boolean)
                    }
                  : current
              )
            }
          />
        </label>
      </div>

      <div className="pipeline-button-row">
        <button className="btn" type="button" disabled={busy === "settings"} onClick={onSave}>
          Save
        </button>
      </div>
    </aside>
  );
}
