import { useEffect, useMemo, useState } from "react";
import type { CleanupCategory, ProtectedFindingRejection, ProtectionKind, ScanSummary } from "../../../types";

type SafetyFilterValue = "all" | ProtectionKind;

interface SafetyCountsByKind {
  all?: number;
  user_allowlist_path?: number;
  user_allowlist_app?: number;
  protected_system_root?: number;
  app_install_root?: number;
  installed_app_location?: number;
  installed_app_name_match?: number;
  binary_extension?: number;
}

interface SafetyTabProps {
  findingsCount: number;
  protectedRejected: ProtectedFindingRejection[];
  filteredProtectedRejected: ProtectedFindingRejection[];
  scanSummary: ScanSummary;
  safetyProtectionFilter: SafetyFilterValue;
  safetyQuery: string;
  safetyCountsByKind: SafetyCountsByKind;
  onBackToScan: () => void;
  onOpenCleanupPlan: () => void;
  onExportSafetyReport: () => void;
  onSetSafetyQuery: (value: string) => void;
  onSetSafetyProtectionFilter: (value: SafetyFilterValue) => void;
  onAddRejectedPathToAllowlist: (path: string) => void;
  onAddRejectedAppToAllowlist: (appName?: string) => void;
  categoryClass: (category: CleanupCategory) => string;
  categoryLabelByValue: Record<CleanupCategory, string>;
  protectionKindLabel: (kind: ProtectionKind) => string;
  shortPath: (value: string) => string;
}

function summarizeRootZone(value: string): string {
  const parts = value.split("\\").filter(Boolean);
  if (parts.length <= 1) {
    return value;
  }
  return `${parts[0]}\\${parts[1]}`;
}

export function SafetyTab({
  findingsCount,
  protectedRejected,
  filteredProtectedRejected,
  scanSummary,
  safetyProtectionFilter,
  safetyQuery,
  safetyCountsByKind,
  onBackToScan,
  onOpenCleanupPlan,
  onExportSafetyReport,
  onSetSafetyQuery,
  onSetSafetyProtectionFilter,
  onAddRejectedPathToAllowlist,
  onAddRejectedAppToAllowlist,
  categoryClass,
  categoryLabelByValue,
  protectionKindLabel,
  shortPath
}: SafetyTabProps) {
  const [selectedRejectedPath, setSelectedRejectedPath] = useState("");
  const topApps = [...filteredProtectedRejected.reduce((counts, item) => {
    if (!item.matchedAppName) {
      return counts;
    }
    counts.set(item.matchedAppName, (counts.get(item.matchedAppName) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

  const topZones = [...filteredProtectedRejected.reduce((counts, item) => {
    const zone = summarizeRootZone(item.path);
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);

  const protectionHighlights = Object.entries(safetyCountsByKind)
    .filter(([kind, count]) => kind !== "all" && Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 4) as Array<[ProtectionKind, number]>;
  useEffect(() => {
    if (!filteredProtectedRejected.some((item) => item.path === selectedRejectedPath)) {
      setSelectedRejectedPath(filteredProtectedRejected[0]?.path ?? "");
    }
  }, [filteredProtectedRejected, selectedRejectedPath]);
  const selectedRejected = useMemo(
    () => filteredProtectedRejected.find((item) => item.path === selectedRejectedPath) ?? filteredProtectedRejected[0] ?? null,
    [filteredProtectedRejected, selectedRejectedPath]
  );

  return (
    <section className="panel panel-fade tab-surface safety-studio">
      <header className="panel-header tab-header">
        <div>
          <small className="section-kicker">Safety</small>
          <h2>Safety Rejections</h2>
          <p className="muted">Blocked candidates stay visible here so you can understand why they were excluded without cluttering Cleanup Plan.</p>
        </div>
        <div className="row wrap">
          <button className="btn secondary" onClick={onBackToScan}>
            Back To Scan
          </button>
          <button className="btn secondary" onClick={onOpenCleanupPlan} disabled={!findingsCount}>
            Open Cleanup Plan
          </button>
          <button className="btn secondary" onClick={onExportSafetyReport} disabled={!filteredProtectedRejected.length}>
            Export CSV
          </button>
        </div>
      </header>

      <div className="callout">
        <strong>{scanSummary.protectedRejectedCount} protected items rejected</strong>
        <span>These paths matched cleanup-like patterns but were blocked before becoming findings.</span>
        {scanSummary.protectedRejectedTruncated && <span>List truncated to keep the UI responsive.</span>}
      </div>

      <div className="settings-summary-grid">
        <article className="stat-tile">
          <small>Blocked items</small>
          <strong>{scanSummary.protectedRejectedCount}</strong>
          <span>{filteredProtectedRejected.length} currently visible</span>
        </article>
        <article className="stat-tile">
          <small>Cleanup findings</small>
          <strong>{findingsCount}</strong>
          <span>Items that cleared protection checks</span>
        </article>
        <article className="stat-tile">
          <small>Top protection</small>
          <strong>{protectionHighlights[0] ? protectionKindLabel(protectionHighlights[0][0]) : "None"}</strong>
          <span>{protectionHighlights[0]?.[1] ?? 0} blocked matches</span>
        </article>
        <article className="stat-tile">
          <small>Related apps</small>
          <strong>{topApps.length}</strong>
          <span>{topApps.length ? topApps.map(([name]) => name).join(", ") : "No app match"}</span>
        </article>
      </div>

      <div className="toolbar">
        <label>
          Filter rejected
          <input
            value={safetyQuery}
            onChange={(event) => onSetSafetyQuery(event.target.value)}
            placeholder="Search path, reason, app"
          />
        </label>
        <label>
          Protection
          <select
            value={safetyProtectionFilter}
            onChange={(event) => onSetSafetyProtectionFilter(event.target.value as SafetyFilterValue)}
          >
            <option value="all">All protections</option>
            <option value="user_allowlist_path">Never-cleanup path</option>
            <option value="user_allowlist_app">Never-cleanup app</option>
            <option value="protected_system_root">System root</option>
            <option value="app_install_root">Install root</option>
            <option value="installed_app_location">Installed app location</option>
            <option value="installed_app_name_match">Installed app name</option>
            <option value="binary_extension">Binary</option>
          </select>
        </label>
        <p className="muted">Showing {filteredProtectedRejected.length} of {protectedRejected.length} blocked items</p>
      </div>

      <div className="safety-focus-grid">
        <article className="card inset">
          <small className="section-kicker">Top protections</small>
          <h3>Common block reasons</h3>
          <div className="row wrap">
            <button className={`pill ${safetyProtectionFilter === "all" ? "active" : ""}`} onClick={() => onSetSafetyProtectionFilter("all")}>
              All ({safetyCountsByKind.all ?? 0})
            </button>
            <button
              className={`pill ${safetyProtectionFilter === "user_allowlist_path" ? "active" : ""}`}
              onClick={() => onSetSafetyProtectionFilter("user_allowlist_path")}
              disabled={!safetyCountsByKind.user_allowlist_path}
            >
              Never-cleanup path ({safetyCountsByKind.user_allowlist_path ?? 0})
            </button>
            <button
              className={`pill ${safetyProtectionFilter === "user_allowlist_app" ? "active" : ""}`}
              onClick={() => onSetSafetyProtectionFilter("user_allowlist_app")}
              disabled={!safetyCountsByKind.user_allowlist_app}
            >
              Never-cleanup app ({safetyCountsByKind.user_allowlist_app ?? 0})
            </button>
            <button
              className={`pill ${safetyProtectionFilter === "installed_app_location" ? "active" : ""}`}
              onClick={() => onSetSafetyProtectionFilter("installed_app_location")}
              disabled={!safetyCountsByKind.installed_app_location}
            >
              Installed app location ({safetyCountsByKind.installed_app_location ?? 0})
            </button>
            <button
              className={`pill ${safetyProtectionFilter === "app_install_root" ? "active" : ""}`}
              onClick={() => onSetSafetyProtectionFilter("app_install_root")}
              disabled={!safetyCountsByKind.app_install_root}
            >
              Install root ({safetyCountsByKind.app_install_root ?? 0})
            </button>
          </div>
          {protectionHighlights.length ? (
            <ul className="ai-chip-list">
              {protectionHighlights.map(([kind, count]) => (
                <li key={kind} className="risk-pill tone-neutral">
                  {protectionKindLabel(kind)} / {count}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No protection distribution is available for this filter.</p>
          )}
        </article>

        <article className="card inset">
          <small className="section-kicker">Blocked hotspots</small>
          <h3>Apps and zones</h3>
          <div className="stack-sm">
            <strong>Related apps</strong>
            {topApps.length ? (
              <ul className="ai-compact-list">
                {topApps.map(([name, count]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No installed-app names were involved in the current filtered set.</p>
            )}
          </div>
          <div className="stack-sm">
            <strong>Blocked zones</strong>
            {topZones.length ? (
              <ul className="ai-compact-list">
                {topZones.map(([zone, count]) => (
                  <li key={zone}>
                    <span title={zone}>{shortPath(zone)}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No blocked zones available for the current filtered set.</p>
            )}
          </div>
        </article>

        <article className="card inset">
          <small className="section-kicker">Inspector</small>
          <h3>{selectedRejected ? protectionKindLabel(selectedRejected.protectionKind) : "No blocked item selected"}</h3>
          {selectedRejected ? (
            <>
              <p className="muted" title={selectedRejected.path}>{shortPath(selectedRejected.path)}</p>
              <span className={`category-chip ${categoryClass(selectedRejected.category)}`}>
                {`Inspector: ${categoryLabelByValue[selectedRejected.category]}`}
              </span>
              <ul className="ai-compact-list">
                <li>
                  <span>Reason</span>
                  <strong>{`Inspector: ${selectedRejected.reason}`}</strong>
                </li>
                <li>
                  <span>Related app</span>
                  <strong>{selectedRejected.matchedAppName ?? "No app match"}</strong>
                </li>
                <li>
                  <span>Protection</span>
                  <strong>{protectionKindLabel(selectedRejected.protectionKind)}</strong>
                </li>
              </ul>
              <div className="row wrap">
                <button className="btn secondary tiny" onClick={() => onAddRejectedPathToAllowlist(selectedRejected.path)}>
                  Allowlist Selected Path
                </button>
                <button
                  className="btn secondary tiny"
                  onClick={() => onAddRejectedAppToAllowlist(selectedRejected.matchedAppName)}
                  disabled={!selectedRejected.matchedAppName}
                >
                  Allowlist Selected App
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Load a scan with blocked items or relax filters to inspect a rejection here.</p>
          )}
        </article>
      </div>

      {!filteredProtectedRejected.length ? (
        <p className="muted">No protected candidates were rejected for the current loaded scan.</p>
      ) : (
        <details className="settings-advanced-panel" open={filteredProtectedRejected.length <= 24}>
          <summary>Rejected item table</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Protection</th>
                  <th>Related App</th>
                  <th>Reason</th>
                  <th>Path</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProtectedRejected.map((item) => (
                  <tr
                    key={`${item.sourceRuleId}:${item.path}`}
                    className={selectedRejected?.path === item.path ? "is-selected" : ""}
                    onClick={() => setSelectedRejectedPath(item.path)}
                  >
                    <td>
                      <span className={`category-chip ${categoryClass(item.category)}`}>{categoryLabelByValue[item.category]}</span>
                    </td>
                    <td>{protectionKindLabel(item.protectionKind)}</td>
                    <td>{item.matchedAppName ?? "-"}</td>
                    <td>{item.reason}</td>
                    <td title={item.path}>{shortPath(item.path)}</td>
                    <td>
                      <div className="row wrap">
                        <button className="btn secondary" onClick={() => onAddRejectedPathToAllowlist(item.path)}>
                          Allowlist Path
                        </button>
                        <button
                          className="btn secondary"
                          onClick={() => onAddRejectedAppToAllowlist(item.matchedAppName)}
                          disabled={!item.matchedAppName}
                        >
                          Allowlist App
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
