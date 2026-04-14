import { useEffect, useMemo, useState } from "react";
import type {
  DriverCandidate,
  DriverOfficialLookup,
  DriverScanResponse,
  DriverStackFeatureSignalId,
  DriverSuppressionSuggestion,
  DriverSuppressionSuggestionId
} from "../../../types";

type DriverOpenState = "idle" | "opening" | "opened" | "failed";
type DriverAiLookupState = "idle" | "loading" | "ready" | "failed";

interface DriversTabProps {
  settingsDriverToolsEnabled: boolean;
  isScanningDrivers: boolean;
  drivers: DriverScanResponse | null;
  driverSeverityCounts: { high: number; medium: number; low: number };
  driverClassCounts: Array<{ label: string; count: number }>;
  visibleInactiveReviewDriverSuppressionSuggestions: DriverSuppressionSuggestion[];
  visibleSafeDriverSuppressionSuggestions: DriverSuppressionSuggestion[];
  visibleDriverSignalEvidenceSuggestionIds: DriverSuppressionSuggestionId[];
  visibleDriverSignalEvidenceOpenCount: number;
  visibleDriverSuppressionSuggestions: DriverSuppressionSuggestion[];
  driverSuppressionSignalCounts: Array<{ signal: DriverStackFeatureSignalId; count: number }>;
  driverSignalFilter: DriverStackFeatureSignalId | "all";
  filteredDriverCandidates: DriverCandidate[];
  driverQuery: string;
  driverFilter: "all" | "windows_update" | "oem_portal";
  driverOpenStates: Record<string, DriverOpenState>;
  driverAiLookupStates: Record<string, DriverAiLookupState>;
  driverAiLookups: Record<string, DriverOfficialLookup>;
  hiddenDriverStackLabels: string[];
  settingsDriverIgnoredInfNamesLength: number;
  settingsDriverIgnoredDeviceIdsLength: number;
  settingsDriverHiddenSuggestionIdsLength: number;
  settingsDriverAutoSuppressSafeSuggestions: boolean;
  settingsDriverAutoSuppressionApplied: boolean;
  openDriverSignalEvidenceIds: DriverSuppressionSuggestionId[];
  onLoadDrivers: () => void;
  onOpenWindowsUpdate: () => void;
  onEnableDriverTools: () => void;
  onApplySafeDriverSuppressionSuggestions: () => void;
  onApplyReviewDriverSuppressionSuggestions: () => void;
  onExpandVisibleDriverSignalEvidence: () => void;
  onCollapseVisibleDriverSignalEvidence: () => void;
  onSetDriverSignalFilter: (value: DriverStackFeatureSignalId | "all" | ((current: DriverStackFeatureSignalId | "all") => DriverStackFeatureSignalId | "all")) => void;
  onToggleDriverSignalEvidence: (suggestionId: DriverSuppressionSuggestionId, open: boolean) => void;
  onApplyDriverSuppressionSuggestion: (suggestion: DriverSuppressionSuggestion) => void;
  onHideDriverSuggestionStack: (suggestionId: DriverSuppressionSuggestionId, title: string) => void;
  onSetDriverQuery: (value: string) => void;
  onSetDriverFilter: (value: "all" | "windows_update" | "oem_portal") => void;
  onOpenDriverLink: (candidateId: string) => void;
  onLookupDriverWithAi: (candidateId: string) => void;
  onSuppressDriverInfName: (infName?: string) => void;
  onSuppressDriverDevice: (deviceId?: string, deviceName?: string) => void;
  driverSuppressionConfidenceClass: (confidence: DriverSuppressionSuggestion["confidence"]) => string;
  driverSuppressionGroupLabel: (group: DriverSuppressionSuggestion["group"]) => string;
  driverActivityClass: (state: DriverSuppressionSuggestion["activityState"]) => string;
  driverActivityLabel: (state: DriverSuppressionSuggestion["activityState"]) => string;
  driverSuppressionRuleSummary: (suggestion: DriverSuppressionSuggestion) => string;
  driverFeatureSignalClass: (signal: DriverStackFeatureSignalId) => string;
  driverFeatureSignalLabel: (signal: DriverStackFeatureSignalId) => string;
  driverClassLabel: (value?: string) => string;
  driverSeverityClass: (severity: DriverCandidate["severity"]) => string;
  formatDays: (value?: number) => string;
}

export function DriversTab({
  settingsDriverToolsEnabled,
  isScanningDrivers,
  drivers,
  driverSeverityCounts,
  driverClassCounts,
  visibleInactiveReviewDriverSuppressionSuggestions,
  visibleSafeDriverSuppressionSuggestions,
  visibleDriverSignalEvidenceSuggestionIds,
  visibleDriverSignalEvidenceOpenCount,
  visibleDriverSuppressionSuggestions,
  driverSuppressionSignalCounts,
  driverSignalFilter,
  filteredDriverCandidates,
  driverQuery,
  driverFilter,
  driverOpenStates,
  driverAiLookupStates,
  driverAiLookups,
  hiddenDriverStackLabels,
  settingsDriverIgnoredInfNamesLength,
  settingsDriverIgnoredDeviceIdsLength,
  settingsDriverHiddenSuggestionIdsLength,
  settingsDriverAutoSuppressSafeSuggestions,
  settingsDriverAutoSuppressionApplied,
  openDriverSignalEvidenceIds,
  onLoadDrivers,
  onOpenWindowsUpdate,
  onEnableDriverTools,
  onApplySafeDriverSuppressionSuggestions,
  onApplyReviewDriverSuppressionSuggestions,
  onExpandVisibleDriverSignalEvidence,
  onCollapseVisibleDriverSignalEvidence,
  onSetDriverSignalFilter,
  onToggleDriverSignalEvidence,
  onApplyDriverSuppressionSuggestion,
  onHideDriverSuggestionStack,
  onSetDriverQuery,
  onSetDriverFilter,
  onOpenDriverLink,
  onLookupDriverWithAi,
  onSuppressDriverInfName,
  onSuppressDriverDevice,
  driverSuppressionConfidenceClass,
  driverSuppressionGroupLabel,
  driverActivityClass,
  driverActivityLabel,
  driverSuppressionRuleSummary,
  driverFeatureSignalClass,
  driverFeatureSignalLabel,
  driverClassLabel,
  driverSeverityClass,
  formatDays
}: DriversTabProps) {
  const priorityCandidates = filteredDriverCandidates.filter((candidate) => candidate.severity === "high");
  const shortlist = (priorityCandidates.length ? priorityCandidates : filteredDriverCandidates).slice(0, 6);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  useEffect(() => {
    if (!shortlist.length) {
      if (selectedCandidateId) {
        setSelectedCandidateId("");
      }
      return;
    }
    if (!shortlist.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(shortlist[0]?.id ?? "");
    }
  }, [selectedCandidateId, shortlist]);
  const activeCandidate = useMemo(
    () => shortlist.find((candidate) => candidate.id === selectedCandidateId) ?? shortlist[0] ?? null,
    [selectedCandidateId, shortlist]
  );
  const oemPortalCount = drivers?.updateCandidates.filter((candidate) => candidate.recommendation === "oem_portal").length ?? 0;
  const windowsUpdateCount = drivers?.updateCandidates.filter((candidate) => candidate.recommendation === "windows_update").length ?? 0;
  const aiLookupReadyCount = Object.values(driverAiLookupStates).filter((value) => value === "ready").length;

  return (
    <section className="panel panel-fade tab-surface drivers-studio drivers-studio--summary">
      <header className="panel-header tab-header">
        <div>
          <small className="section-kicker">Drivers</small>
          <h2>Official update guidance</h2>
          <p className="muted">Show the candidates that matter first. Keep suppressions and provenance behind detail panels.</p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={onLoadDrivers} disabled={!settingsDriverToolsEnabled || isScanningDrivers}>
            {isScanningDrivers ? "Scanning..." : "Scan Drivers"}
          </button>
          <button className="btn secondary" onClick={onOpenWindowsUpdate}>
            Open Windows Update
          </button>
          {!settingsDriverToolsEnabled && (
            <button className="btn secondary" onClick={onEnableDriverTools}>
              Enable Driver Tools
            </button>
          )}
        </div>
      </header>

      {!settingsDriverToolsEnabled && <p className="muted">Driver tools are disabled. Enable them to use this page.</p>}
      {settingsDriverToolsEnabled && !drivers && (
        <article className="card driver-empty-card decision-empty-state">
          <small className="section-kicker">No scan loaded</small>
          <h3>Run driver analysis</h3>
          <p className="muted">
            Run a scan to get update candidates. This module only suggests official update routes and does not install drivers automatically.
          </p>
        </article>
      )}

      {drivers && (
        <>
          <article className="card driver-summary-card">
            <div className="driver-summary-strip">
              <span className="workspace-meta-pill">{drivers.updateCandidates.length} candidate{drivers.updateCandidates.length === 1 ? "" : "s"}</span>
              <span className="workspace-meta-pill">{driverSeverityCounts.high} high priority</span>
              <span className="workspace-meta-pill">{drivers.ignoredDeviceCount} filtered noise</span>
              <span className="workspace-meta-pill">{drivers.suppressedCount} suppressed</span>
            </div>
            <div className="driver-summary-copy">
              <span className="muted">{drivers.meaningfulDeviceCount} reviewed after filtering inbox noise</span>
              <span className="muted">{drivers.ignoredDeviceCount} virtual, inbox, or low-value entries ignored</span>
              <span className="muted">{drivers.suppressedCount} hidden by your local driver suppression rules</span>
            </div>
            {driverClassCounts.length ? (
              <details className="settings-advanced-panel driver-class-panel">
                <summary>Driver classes in view</summary>
                <div className="row wrap">
                  {driverClassCounts.map((entry) => (
                    <span key={entry.label} className="category-chip cat-ai">
                      {entry.label} ({entry.count})
                    </span>
                  ))}
                </div>
              </details>
            ) : null}
          </article>

          <div className="drivers-master-layout">
            <article className="card driver-priority-card driver-priority-card--queue">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Priority Queue</small>
                  <h3>Shortlist</h3>
                </div>
                <span className="muted">{shortlist.length} surfaced first</span>
              </header>
              {shortlist.length ? (
                <div className="driver-queue-list">
                  {shortlist.map((candidate) => (
                    <button
                      key={`shortlist:${candidate.id}`}
                      type="button"
                      className={candidate.id === activeCandidate?.id ? "driver-queue-item is-active" : "driver-queue-item"}
                      onClick={() => setSelectedCandidateId(candidate.id)}
                    >
                      <div className="row spread center wrap">
                        <strong>{candidate.deviceName}</strong>
                        <span className={`risk-pill ${driverSeverityClass(candidate.severity)}`}>{candidate.severity}</span>
                      </div>
                      <div className="row wrap">
                        <span className="risk-pill tone-neutral">{driverClassLabel(candidate.deviceClass)}</span>
                        <span className="risk-pill tone-neutral">{candidate.provider}</span>
                        <span className="risk-pill tone-neutral">{formatDays(candidate.daysOld)}</span>
                      </div>
                      <p className="muted">{candidate.reason}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="performance-empty-state decision-empty-state decision-empty-state--mini">
                  <strong>No shortlist candidates</strong>
                  <p className="muted">Relax the filter or run a fresh driver scan to repopulate the priority queue.</p>
                </div>
              )}
            </article>

            <article className="card driver-priority-card driver-priority-card--inspector">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Inspector</small>
                  <h3>{activeCandidate?.deviceName ?? "No driver focus"}</h3>
                </div>
                <span className="muted">{activeCandidate ? "Official paths only" : "Select a shortlist item"}</span>
              </header>
              {activeCandidate ? (
                <>
                  <div className="result-metric-grid result-metric-grid--compact">
                    <article className="result-metric">
                      <small>Severity</small>
                      <strong>{activeCandidate.severity}</strong>
                    </article>
                    <article className="result-metric">
                      <small>Class</small>
                      <strong>{driverClassLabel(activeCandidate.deviceClass)}</strong>
                    </article>
                    <article className="result-metric">
                      <small>Provider</small>
                      <strong>{activeCandidate.provider}</strong>
                    </article>
                    <article className="result-metric">
                      <small>Age</small>
                      <strong>{formatDays(activeCandidate.daysOld)}</strong>
                    </article>
                  </div>
                    <div className="driver-inspector-copy">
                      <p className="muted">{activeCandidate.reason}</p>
                      <div className="row wrap">
                        {activeCandidate.manufacturer && <span className="risk-pill tone-neutral">{activeCandidate.manufacturer}</span>}
                        {activeCandidate.infName && <span className="risk-pill tone-neutral">{`INF ${activeCandidate.infName}`}</span>}
                        <span className="risk-pill tone-neutral">{activeCandidate.recommendation === "oem_portal" ? "OEM portal" : "Windows Update"}</span>
                      </div>
                    </div>
                  <div className="row wrap">
                    <button className="btn secondary" onClick={() => onOpenDriverLink(activeCandidate.id)} disabled={driverOpenStates[activeCandidate.id] === "opening"}>
                      {driverOpenStates[activeCandidate.id] === "opening"
                        ? "Opening..."
                        : driverOpenStates[activeCandidate.id] === "opened"
                          ? "Opened"
                          : driverOpenStates[activeCandidate.id] === "failed"
                            ? "Retry Official"
                            : "Open Official"}
                    </button>
                    <button className="btn" onClick={() => onLookupDriverWithAi(activeCandidate.id)} disabled={driverAiLookupStates[activeCandidate.id] === "loading"}>
                      {driverAiLookupStates[activeCandidate.id] === "loading"
                        ? "AI Searching..."
                        : driverAiLookupStates[activeCandidate.id] === "ready"
                          ? "AI Search Ready"
                          : "AI Search Official"}
                    </button>
                    <button className="btn secondary" onClick={() => onSuppressDriverInfName(activeCandidate.infName)}>
                      Ignore INF
                    </button>
                    <button className="btn secondary" onClick={() => onSuppressDriverDevice(activeCandidate.deviceId, activeCandidate.deviceName)}>
                      Ignore Device
                    </button>
                  </div>
                  {driverAiLookups[activeCandidate.id] ? (
                    <div className="driver-ai-lookup-note">
                      <strong>{driverAiLookups[activeCandidate.id].officialDomain}</strong>
                      <span title={driverAiLookups[activeCandidate.id].searchQuery}>{driverAiLookups[activeCandidate.id].searchQuery}</span>
                      {driverAiLookups[activeCandidate.id].reasoning.length ? (
                        <ul className="driver-ai-reasoning">
                          {driverAiLookups[activeCandidate.id].reasoning.slice(0, 3).map((reason) => (
                            <li key={`${activeCandidate.id}:${reason}`}>{reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
                    <p className="muted">Use AI Search Official only when the OEM route is unclear or the model string is messy.</p>
                  )}
                </>
              ) : (
                <p className="muted">No shortlist item is available for inspection.</p>
              )}
            </article>
          </div>

          <details className="settings-advanced-panel driver-details-panel">
            <summary>Coverage snapshot</summary>
            <article className="card driver-priority-card driver-priority-card--summary">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Coverage</small>
                  <h3>Route Summary</h3>
                </div>
                <span className="muted">Official paths only</span>
              </header>
              <div className="result-metric-grid result-metric-grid--compact">
                <article className="result-metric">
                  <small>High priority</small>
                  <strong>{driverSeverityCounts.high}</strong>
                </article>
                <article className="result-metric">
                  <small>OEM portals</small>
                  <strong>{oemPortalCount}</strong>
                </article>
                <article className="result-metric">
                  <small>Windows Update</small>
                  <strong>{windowsUpdateCount}</strong>
                </article>
                <article className="result-metric">
                  <small>AI lookups ready</small>
                  <strong>{aiLookupReadyCount}</strong>
                </article>
              </div>
              <p className="muted">
                Prioritize high-severity entries first. Keep the full recommendation table behind the detail panel unless you need exhaustiveness.
              </p>
            </article>
          </details>

          <details className="settings-advanced-panel driver-details-panel" open={filteredDriverCandidates.length <= 6}>
            <summary>Full recommendations table</summary>
            <article className="card full driver-recommendation-card">
            <header className="panel-header compact">
              <div>
                <small className="section-kicker">Priority Queue</small>
                <h3>Recommendations</h3>
              </div>
              <span className="muted">Showing {filteredDriverCandidates.length} of {drivers.updateCandidates.length} candidates</span>
            </header>
            <div className="toolbar">
              <label>
                Filter
                <input value={driverQuery} onChange={(event) => onSetDriverQuery(event.target.value)} placeholder="Search by device/provider/reason" />
              </label>
              <label>
                Source
                <select value={driverFilter} onChange={(event) => onSetDriverFilter(event.target.value as "all" | "windows_update" | "oem_portal")}>
                  <option value="all">All Recommendations</option>
                  <option value="windows_update">Windows Update</option>
                  <option value="oem_portal">OEM Portal</option>
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Class</th>
                    <th>Provider</th>
                    <th>Version</th>
                    <th>INF</th>
                    <th>Age</th>
                    <th>Reason</th>
                    <th>Recommendation</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDriverCandidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td>
                        <strong>{candidate.deviceName}</strong>
                        {candidate.manufacturer && <div className="muted">{candidate.manufacturer}</div>}
                      </td>
                      <td>{driverClassLabel(candidate.deviceClass)}</td>
                      <td>{candidate.provider}</td>
                      <td>{candidate.currentDriverVersion}</td>
                      <td>{candidate.infName ?? "-"}</td>
                      <td>{formatDays(candidate.daysOld)}</td>
                      <td>{candidate.reason}</td>
                      <td>
                        <span className={`risk-pill ${driverSeverityClass(candidate.severity)}`}>
                          {candidate.recommendation === "oem_portal" ? "OEM portal" : "Windows Update"}
                        </span>
                      </td>
                      <td>
                        <div className="row wrap">
                          <button className="btn secondary" onClick={() => onOpenDriverLink(candidate.id)} disabled={driverOpenStates[candidate.id] === "opening"}>
                            {driverOpenStates[candidate.id] === "opening"
                              ? "Opening..."
                              : driverOpenStates[candidate.id] === "opened"
                                ? "Opened"
                                : driverOpenStates[candidate.id] === "failed"
                                  ? "Retry Official"
                                  : "Open Official"}
                          </button>
                          <button className="btn secondary" onClick={() => onLookupDriverWithAi(candidate.id)} disabled={driverAiLookupStates[candidate.id] === "loading"}>
                            {driverAiLookupStates[candidate.id] === "loading"
                              ? "AI Searching..."
                              : driverAiLookupStates[candidate.id] === "ready"
                                ? "AI Search Ready"
                                : "AI Search Official"}
                          </button>
                          <button className="btn secondary" onClick={() => onSuppressDriverInfName(candidate.infName)} disabled={!candidate.infName}>
                            Suppress INF
                          </button>
                          <button className="btn secondary" onClick={() => onSuppressDriverDevice(candidate.deviceId, candidate.deviceName)} disabled={!candidate.deviceId}>
                            Suppress Device
                          </button>
                        </div>
                        {driverAiLookups[candidate.id] && (
                          <div className="driver-ai-lookup-note">
                            <strong>{driverAiLookups[candidate.id].provider === "cerebras" ? "LLM official search" : "Official search hint"}</strong>
                            <span>{driverAiLookups[candidate.id].officialDomain}</span>
                            <span title={driverAiLookups[candidate.id].searchQuery}>{driverAiLookups[candidate.id].searchQuery}</span>
                            {driverAiLookups[candidate.id].reasoning.length ? (
                              <ul className="driver-ai-reasoning">
                                {driverAiLookups[candidate.id].reasoning.slice(0, 3).map((reason) => (
                                  <li key={`${candidate.id}:${reason}`}>{reason}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!filteredDriverCandidates.length && (
              <p className="muted">
                {drivers.updateCandidates.length
                  ? "No candidates match the current filter."
                  : drivers.meaningfulDeviceCount
                    ? "No high-confidence update hints were found after filtering Windows inbox, virtual, and low-value devices."
                    : "No meaningful hardware classes were detected for driver guidance."}
              </p>
            )}
            </article>
          </details>

          {drivers.suppressionSuggestions.length > 0 && (
            <details className="settings-advanced-panel driver-details-panel">
              <summary>Suppression suggestions and signal evidence</summary>
              <article className="card inset driver-suggestion-card">
                <div className="panel-header compact">
                  <div>
                    <h3>Local Suppression Suggestions</h3>
                    <p className="muted">
                      Built from this machine's current driver inventory. Virtual-stack bulk actions only apply suggestions detected as inactive on this machine.
                    </p>
                    <p className="muted">
                      {visibleInactiveReviewDriverSuppressionSuggestions.length} inactive virtual suggestion{visibleInactiveReviewDriverSuppressionSuggestions.length === 1 ? "" : "s"} available for bulk apply{driverSignalFilter === "all" ? "" : ` under ${driverFeatureSignalLabel(driverSignalFilter)}` }.
                    </p>
                    {driverSignalFilter !== "all" && (
                      <p className="muted">
                        Filtering suggestions by <strong>{driverFeatureSignalLabel(driverSignalFilter)}</strong>. Showing {visibleDriverSuppressionSuggestions.length} of {drivers.suppressionSuggestions.length}.
                      </p>
                    )}
                  </div>
                  <div className="row wrap">
                    <button className="btn secondary" onClick={onApplySafeDriverSuppressionSuggestions} disabled={!visibleSafeDriverSuppressionSuggestions.length}>
                      Apply Safe Suggestions
                    </button>
                    <button className="btn secondary" onClick={onApplyReviewDriverSuppressionSuggestions} disabled={!visibleInactiveReviewDriverSuppressionSuggestions.length}>
                      Apply Inactive Virtual Suggestions
                    </button>
                    <button
                      className="btn secondary"
                      onClick={onExpandVisibleDriverSignalEvidence}
                      disabled={!visibleDriverSignalEvidenceSuggestionIds.length || visibleDriverSignalEvidenceOpenCount === visibleDriverSignalEvidenceSuggestionIds.length}
                    >
                      Expand All Evidence
                    </button>
                    <button className="btn secondary" onClick={onCollapseVisibleDriverSignalEvidence} disabled={!visibleDriverSignalEvidenceOpenCount}>
                      Collapse All Evidence
                    </button>
                  </div>
                </div>

                {driverSuppressionSignalCounts.length > 0 && (
                  <div className="row wrap driver-signal-toolbar">
                    <button
                      type="button"
                      className={driverSignalFilter === "all" ? "category-chip cat-cache chip-button is-active" : "category-chip cat-cache chip-button"}
                      onClick={() => onSetDriverSignalFilter("all")}
                      aria-pressed={driverSignalFilter === "all"}
                    >
                      All Signals ({drivers.suppressionSuggestions.length})
                    </button>
                    {driverSuppressionSignalCounts.map((entry) => (
                      <button
                        key={entry.signal}
                        type="button"
                        className={
                          driverSignalFilter === entry.signal
                            ? `category-chip ${driverFeatureSignalClass(entry.signal)} chip-button is-active`
                            : `category-chip ${driverFeatureSignalClass(entry.signal)} chip-button`
                        }
                        onClick={() => onSetDriverSignalFilter((current) => (current === entry.signal ? "all" : entry.signal))}
                        aria-pressed={driverSignalFilter === entry.signal}
                      >
                        {driverFeatureSignalLabel(entry.signal)} ({entry.count})
                      </button>
                    ))}
                  </div>
                )}

                <div className="driver-suggestion-grid">
                  {visibleDriverSuppressionSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className="card">
                      <div className="row wrap">
                        <span className={`risk-pill ${driverSuppressionConfidenceClass(suggestion.confidence)}`}>
                          {suggestion.confidence === "high" ? "High confidence" : "Review first"}
                        </span>
                        <span className="category-chip cat-ai">{driverSuppressionGroupLabel(suggestion.group)}</span>
                        <span className={`risk-pill ${driverActivityClass(suggestion.activityState)}`}>
                          {driverActivityLabel(suggestion.activityState)}
                        </span>
                        <span className="category-chip cat-ai">{suggestion.matchCount} matches</span>
                        <span className="category-chip cat-cache">{driverSuppressionRuleSummary(suggestion)}</span>
                        {suggestion.activitySignals.map((signal) => (
                          <button
                            key={`${suggestion.id}-${signal}`}
                            type="button"
                            className={
                              driverSignalFilter === signal
                                ? `category-chip ${driverFeatureSignalClass(signal)} chip-button is-active`
                                : `category-chip ${driverFeatureSignalClass(signal)} chip-button`
                            }
                            onClick={() => onSetDriverSignalFilter((current) => (current === signal ? "all" : signal))}
                            aria-pressed={driverSignalFilter === signal}
                            title={
                              suggestion.activitySignalEvidence.find((item) => item.id === signal)?.evidence ??
                              `${driverFeatureSignalLabel(signal)} signal detected on this machine.`
                            }
                          >
                            {driverFeatureSignalLabel(signal)}
                          </button>
                        ))}
                      </div>
                      <h4>{suggestion.title}</h4>
                      <p className="muted">{suggestion.description}</p>
                      <p className="muted">{suggestion.activitySummary}</p>
                      {suggestion.activitySignalEvidence.length > 0 && (
                        <details className="signal-evidence" open={openDriverSignalEvidenceIds.includes(suggestion.id)}>
                          <summary
                            onClick={(event) => {
                              event.preventDefault();
                              onToggleDriverSignalEvidence(suggestion.id, !openDriverSignalEvidenceIds.includes(suggestion.id));
                            }}
                          >
                            Signal evidence
                          </summary>
                          <div className="signal-evidence-list">
                            {suggestion.activitySignalEvidence.map((item) => (
                              <div key={`${suggestion.id}-${item.id}-evidence`} className="signal-evidence-item">
                                <span className={`category-chip ${driverFeatureSignalClass(item.id)}`}>
                                  {driverFeatureSignalLabel(item.id)}
                                </span>
                                <span className="muted">{item.evidence}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      <p className="muted">Example devices: {suggestion.exampleDevices.join(", ")}</p>
                      <div className="row wrap">
                        <button className="btn secondary" onClick={() => onApplyDriverSuppressionSuggestion(suggestion)}>
                          Apply Suggestion
                        </button>
                        <button className="btn secondary" onClick={() => onHideDriverSuggestionStack(suggestion.id, suggestion.title)}>
                          Hide Stack Forever
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {!visibleDriverSuppressionSuggestions.length && (
                  <p className="muted">No suppression suggestions match the current signal filter.</p>
                )}
              </article>
            </details>
          )}

          <details className="settings-advanced-panel driver-details-panel">
            <summary>Provenance and local suppression state</summary>
            <article className="card inset">
              <small className="section-kicker">Scan Provenance</small>
              <h3>Scan Source</h3>
              <p className="muted">
                Source: {drivers.source}. This feature only suggests official update paths and never installs drivers silently.
              </p>
              <p className="muted">
                Local suppressions: {settingsDriverIgnoredInfNamesLength} INF rule(s), {settingsDriverIgnoredDeviceIdsLength} device rule(s).
              </p>
              <p className="muted">
                Hidden stacks: {settingsDriverHiddenSuggestionIdsLength}
                {hiddenDriverStackLabels.length ? ` (${hiddenDriverStackLabels.join(", ")})` : ""}
              </p>
              <p className="muted">
                First-scan safe auto-suppression is {settingsDriverAutoSuppressSafeSuggestions ? "enabled" : "disabled"} and has {settingsDriverAutoSuppressionApplied ? "already" : "not"} run on this machine.
              </p>
            </article>
          </details>
        </>
      )}
    </section>
  );
}
