import type {
  AIActionSuggestion,
  CleanupCategory,
  CleanupPreset,
  ScanFinding,
  ScanProgressEvent,
  ScanSummary
} from "../../../types";

interface CategoryOption {
  value: CleanupCategory;
  label: string;
}

interface ScanResultsCategoryEntry {
  category: CleanupCategory;
  label: string;
  count: number;
  bytes: number;
}

interface ScanResultsTypeEntry {
  extension: string;
  label: string;
  count: number;
  bytes: number;
}

interface ScanResultsLocationEntry {
  label: string;
  count: number;
  bytes: number;
}

interface ScanTabProps {
  activeRunId: string;
  isLoadingScanResults: boolean;
  pendingAiAction: AIActionSuggestion | null;
  scanProgress: ScanProgressEvent;
  scanProgressClass: string;
  quickActionsHint: string;
  findings: ScanFinding[];
  scanSummary: ScanSummary;
  scanPreset: CleanupPreset;
  scanCategories: CleanupCategory[];
  machineRoots: string[];
  machineScopeLabel: string;
  selectedFindingCount: number;
  selectedBytes: number;
  protectedRejectedCount: number;
  scanResultsByCategory: ScanResultsCategoryEntry[];
  scanResultsByType: ScanResultsTypeEntry[];
  scanResultsByLocation: ScanResultsLocationEntry[];
  scanTopFindings: ScanFinding[];
  presetLabel: Record<CleanupPreset, string>;
  categoryOptions: CategoryOption[];
  onStartScan: () => void;
  onCancelScan: () => void;
  onClearAiFocus: () => void;
  onSetScanPreset: (preset: CleanupPreset) => void;
  onOpenCleanupPlan: () => void;
  onOpenSafety: () => void;
  formatBytes: (value: number) => string;
  formatEta: (value?: number) => string;
  shortPath: (value: string) => string;
  categoryClass: (category: CleanupCategory) => string;
}

export function ScanTab({
  activeRunId,
  isLoadingScanResults,
  pendingAiAction,
  scanProgress,
  scanProgressClass,
  quickActionsHint,
  findings,
  scanSummary,
  scanPreset,
  scanCategories,
  machineRoots,
  machineScopeLabel,
  selectedFindingCount,
  selectedBytes,
  protectedRejectedCount,
  scanResultsByCategory,
  scanResultsByType,
  scanResultsByLocation,
  scanTopFindings,
  presetLabel,
  categoryOptions,
  onStartScan,
  onCancelScan,
  onClearAiFocus,
  onSetScanPreset,
  onOpenCleanupPlan,
  onOpenSafety,
  formatBytes,
  formatEta,
  shortPath,
  categoryClass
}: ScanTabProps) {
  const selectedCategoryOptions = categoryOptions.filter((option) => scanCategories.includes(option.value));
  const scanStatusLabel =
    scanProgress.stage === "surveying"
      ? "Surveying scope"
      : scanProgress.stage === "scanning"
        ? "Scanning files"
        : scanProgress.stage === "analyzing"
          ? "Final analysis"
          : scanProgress.stage;
  const scanInsightMaxBytes = Math.max(
    1,
    scanResultsByCategory[0]?.bytes ?? 0,
    scanResultsByType[0]?.bytes ?? 0,
    scanResultsByLocation[0]?.bytes ?? 0
  );

  return (
    <section className="panel panel-fade tab-surface scan-studio">
      <header className="panel-header tab-header">
        <h2>Scan Wizard</h2>
        <div className="row wrap">
          <button className="btn" onClick={onStartScan}>Start Scan</button>
          <button className="btn secondary" onClick={onCancelScan} disabled={!activeRunId}>Cancel</button>
        </div>
      </header>

      {pendingAiAction && (
        <div className="callout">
          <strong>AI Focus: {pendingAiAction.title}</strong>
          <span>{pendingAiAction.summary}</span>
          <span>{formatBytes(pendingAiAction.estimatedBytes)} estimated impact</span>
          <button className="btn secondary" onClick={onClearAiFocus}>
            Clear AI Focus
          </button>
        </div>
      )}

      <article className="card scan-command-card scan-command-card--minimal">
        <small className="section-kicker">Scan Status</small>
        <h3>Whole-machine cleanup pass</h3>
        <p className="muted">{quickActionsHint}</p>
        <div className={`scan-bar is-wide ${scanProgressClass}`}>
          <span style={{ width: `${Math.min(100, Math.max(0, scanProgress.percent))}%` }} />
        </div>
        <div className="result-metric-grid result-metric-grid--compact scan-results-summary-grid">
          <article className="result-metric">
            <small>Stage</small>
            <strong>{scanStatusLabel}</strong>
          </article>
          <article className="result-metric">
            <small>Progress</small>
            <strong>{scanProgress.percent}%</strong>
          </article>
          <article className="result-metric">
            <small>ETA</small>
            <strong>{formatEta(scanProgress.etaSec)}</strong>
          </article>
          <article className="result-metric">
            <small>Findings</small>
            <strong>{findings.length}</strong>
          </article>
        </div>
        <div className="scan-summary-strip">
          <span className="workspace-meta-pill">{selectedFindingCount} selected</span>
          <span className="workspace-meta-pill">{formatBytes(selectedBytes)} recoverable</span>
          <span className="workspace-meta-pill">{scanSummary.protectedRejectedCount} blocked</span>
        </div>
        <details className="settings-advanced-panel scan-metrics-advanced">
          <summary>Scan telemetry and scope</summary>
          <div className="result-metric-grid result-metric-grid--compact">
            <article className="result-metric">
              <small>Files</small>
              <strong>{scanProgress.processedItems.toLocaleString()}</strong>
            </article>
            <article className="result-metric">
              <small>Folders</small>
              <strong>{(scanProgress.processedDirectories ?? 0).toLocaleString()}</strong>
            </article>
            <article className="result-metric">
              <small>Est. Total</small>
              <strong>{(scanProgress.estimatedTotalItems ?? 0).toLocaleString()}</strong>
            </article>
            <article className="result-metric">
              <small>Density</small>
              <strong>{scanProgress.scanDensity ? `${scanProgress.scanDensity}/dir` : "-"}</strong>
            </article>
          </div>
          <div className="scan-setup-grid">
            <article className="card scan-config-card scan-config-card--quiet">
              <small className="section-kicker">Coverage</small>
              <h3>Windows 11 machine coverage</h3>
              <p className="muted">
                The scan covers detected fixed drives, temp files, caches, logs, crash dumps, WSL residue, launcher leftovers, AI caches, and installer artifacts.
              </p>
              <div className="row wrap">
                {(Object.keys(presetLabel) as CleanupPreset[]).map((preset) => (
                  <button key={preset} className={scanPreset === preset ? "pill active" : "pill"} onClick={() => onSetScanPreset(preset)}>
                    {presetLabel[preset]}
                  </button>
                ))}
              </div>
              <div className="source-legend">
                {selectedCategoryOptions.map((option) => (
                  <span key={option.value} className={`category-chip ${categoryClass(option.value)}`}>
                    {option.label}
                  </span>
                ))}
              </div>
            </article>

            <article className="card scan-roots-card scan-roots-card--summary">
              <small className="section-kicker">Machine Roots</small>
              <h3>{machineRoots.length ? `${machineRoots.length} fixed drive${machineRoots.length === 1 ? "" : "s"} detected` : "Detecting fixed drives"}</h3>
              <p className="muted">
                Scope controls stay hidden. The scan uses machine roots automatically unless an internal focused action overrides them.
              </p>
              <div className="ai-machine-scope" title={machineScopeLabel}>{machineScopeLabel}</div>
              <p className="muted">
                {scanStatusLabel}. {scanProgress.processedItems.toLocaleString()} files checked, {(scanProgress.processedDirectories ?? 0).toLocaleString()} folders traversed, {(scanProgress.estimatedRemainingItems ?? 0).toLocaleString()} objects still estimated.
              </p>
            </article>
          </div>
        </details>
      </article>

      <article className="card full results-spotlight">
        <header className="panel-header">
          <h3>Results Overview</h3>
          <div className="row">
            <button className="btn secondary" onClick={onOpenCleanupPlan} disabled={!findings.length}>
              Review Cleanup Categories
            </button>
            <button className="btn secondary" onClick={onOpenSafety} disabled={!protectedRejectedCount}>
              Open Safety
            </button>
          </div>
        </header>

        {!activeRunId && <p className="muted">Start a scan first to display results here.</p>}

        {activeRunId && (
          <>
            <div className="result-metric-grid result-metric-grid--compact scan-results-summary-grid">
              <article className="result-metric">
                <small>Loaded</small>
                <strong>{findings.length}</strong>
              </article>
              <article className="result-metric">
                <small>Preselected</small>
                <strong>{selectedFindingCount}</strong>
              </article>
              <article className="result-metric">
                <small>Estimated recoverable</small>
                <strong>{formatBytes(selectedBytes)}</strong>
              </article>
              <article className="result-metric">
                <small>Protected</small>
                <strong>{scanSummary.protectedRejectedCount}</strong>
              </article>
            </div>

            {!findings.length ? (
              <div className="performance-empty-state performance-empty-state--compact">
                <strong>{isLoadingScanResults ? "Syncing findings..." : "Waiting for findings..."}</strong>
                <p className="muted">
                  Results sync automatically while the scan runs and again when the scan completes. No manual load step is required.
                </p>
              </div>
            ) : (
              <div className="scan-results-layout">
                <article className="card scan-primary-results-card">
                  <header className="panel-header compact">
                    <div>
                      <small className="section-kicker">Priority Lanes</small>
                      <h3>What cleanup found first</h3>
                    </div>
                    <span className="muted">{scanResultsByCategory.length} categories surfaced</span>
                  </header>
                  <ul className="scan-bar-list">
                    {scanResultsByCategory.slice(0, 6).map((entry) => (
                      <li key={entry.category}>
                        <div className="scan-bar-list-copy">
                          <span className={`category-chip ${categoryClass(entry.category)}`}>{entry.label}</span>
                          <small>{entry.count} items</small>
                        </div>
                        <div className="scan-bar-list-value">
                          <strong>{formatBytes(entry.bytes)}</strong>
                          <span
                            className="scan-bar-fill"
                            style={{ width: `${Math.max(10, Math.round((entry.bytes / scanInsightMaxBytes) * 100))}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="card scan-primary-results-card">
                  <header className="panel-header compact">
                    <div>
                      <small className="section-kicker">Largest Findings</small>
                      <h3>Biggest cleanup candidates</h3>
                    </div>
                    <span className="muted">{scanTopFindings.length} shown</span>
                  </header>
                  <ul className="list compact">
                    {scanTopFindings.map((item) => (
                      <li key={item.id}>
                        <div className="stack gap-xs">
                          <span title={item.path}>{shortPath(item.path)}</span>
                          {item.kind === "directory" ? <small className="muted">{item.entryCount ?? 0} contained items</small> : null}
                        </div>
                        <strong>{formatBytes(item.sizeBytes)}</strong>
                      </li>
                    ))}
                  </ul>
                </article>

                <details className="settings-advanced-panel scan-results-advanced">
                  <summary>More result detail</summary>
                  <div className="scan-insights-grid">
                    <article className="card inset">
                      <h3>By File Type</h3>
                      <ul className="scan-bar-list">
                        {scanResultsByType.map((entry) => (
                          <li key={entry.extension}>
                            <div className="scan-bar-list-copy">
                              <span>{entry.label}</span>
                              <small>{entry.count} items</small>
                            </div>
                            <div className="scan-bar-list-value">
                              <strong>{formatBytes(entry.bytes)}</strong>
                              <span
                                className="scan-bar-fill"
                                style={{ width: `${Math.max(10, Math.round((entry.bytes / scanInsightMaxBytes) * 100))}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>

                    <article className="card inset">
                      <h3>By Location</h3>
                      <ul className="scan-bar-list">
                        {scanResultsByLocation.map((entry) => (
                          <li key={entry.label}>
                            <div className="scan-bar-list-copy">
                              <span title={entry.label}>{shortPath(entry.label)}</span>
                              <small>{entry.count} items</small>
                            </div>
                            <div className="scan-bar-list-value">
                              <strong>{formatBytes(entry.bytes)}</strong>
                              <span
                                className="scan-bar-fill"
                                style={{ width: `${Math.max(10, Math.round((entry.bytes / scanInsightMaxBytes) * 100))}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  </div>
                </details>
              </div>
            )}
          </>
        )}
      </article>
    </section>
  );
}
