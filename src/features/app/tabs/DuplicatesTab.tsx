import type {
  CleanupExecuteResponse,
  DuplicateGroup,
  DuplicatePreviewResponse,
  DuplicateSelection
} from "../../../types";

interface DuplicatesTabProps {
  duplicateGroups: DuplicateGroup[];
  visibleDuplicateGroups: DuplicateGroup[];
  duplicateSelections: DuplicateSelection[];
  duplicatePreview: DuplicatePreviewResponse | null;
  duplicateResult: CleanupExecuteResponse | null;
  duplicateMinSizeMb: number;
  machineRoots: string[];
  machineScopeLabel: string;
  hasMoreDuplicateGroups: boolean;
  onDuplicateMinSizeMbChange: (value: number) => void;
  onRunDuplicateScan: () => void;
  onPreviewDuplicateResolution: () => void;
  onExecuteDuplicateResolution: () => void;
  onUpdateDuplicateKeep: (groupId: string, keepPath: string) => void;
  onShowMoreDuplicateGroups: () => void;
  formatBytes: (value: number) => string;
  shortPath: (value: string) => string;
}

export function DuplicatesTab({
  duplicateGroups,
  visibleDuplicateGroups,
  duplicateSelections,
  duplicatePreview,
  duplicateResult,
  duplicateMinSizeMb,
  machineRoots,
  machineScopeLabel,
  hasMoreDuplicateGroups,
  onDuplicateMinSizeMbChange,
  onRunDuplicateScan,
  onPreviewDuplicateResolution,
  onExecuteDuplicateResolution,
  onUpdateDuplicateKeep,
  onShowMoreDuplicateGroups,
  formatBytes,
  shortPath
}: DuplicatesTabProps) {
  return (
    <section className="panel panel-fade tab-surface duplicates-studio duplicates-studio--streamlined">
      <header className="panel-header tab-header">
        <h2>Duplicate Detection</h2>
        <div className="row wrap">
          <button className="btn" onClick={onRunDuplicateScan}>Run Whole-Machine Pass</button>
          <button className="btn secondary" onClick={onPreviewDuplicateResolution} disabled={!duplicateSelections.length}>Preview Resolution</button>
          <button className="btn secondary" onClick={onExecuteDuplicateResolution} disabled={!duplicateSelections.length}>Quarantine Selected</button>
        </div>
      </header>

      <article className="card duplicates-machine-card">
        <small className="section-kicker">Scope</small>
        <h3>Machine-wide duplicate pass</h3>
        <p className="muted">
          Duplicate scans now use the detected fixed Windows drives automatically. You no longer need to manage root lists here.
        </p>
        <div className="row wrap">
          <span className="risk-pill tone-low">{machineRoots.length} fixed drive{machineRoots.length === 1 ? "" : "s"}</span>
          <span className="risk-pill tone-neutral">Min size {duplicateMinSizeMb} MB</span>
        </div>
        <div className="ai-machine-scope" title={machineScopeLabel}>{machineScopeLabel}</div>
        <label>
          Minimum file size (MB)
          <input
            type="number"
            min={1}
            value={duplicateMinSizeMb}
            onChange={(event) => onDuplicateMinSizeMbChange(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
      </article>

      <div className="duplicates-summary-grid">
        <article className="stat-tile">
          <small>Groups</small>
          <strong>{duplicateGroups.length}</strong>
          <span>{visibleDuplicateGroups.length} visible in current page</span>
        </article>
        <article className="stat-tile">
          <small>Selections</small>
          <strong>{duplicateSelections.length}</strong>
          <span>keep-path decisions prepared</span>
        </article>
        <article className="stat-tile">
          <small>Preview</small>
          <strong>{duplicatePreview ? formatBytes(duplicatePreview.bytesRecoverable) : "Not built"}</strong>
          <span>{duplicatePreview ? `${duplicatePreview.toQuarantine} files to quarantine` : "Run Preview Resolution"}</span>
        </article>
        <article className="stat-tile">
          <small>Execution</small>
          <strong>{duplicateResult ? duplicateResult.movedCount : 0}</strong>
          <span>{duplicateResult ? `${formatBytes(duplicateResult.freedBytes)} freed` : "No duplicate cleanup executed yet"}</span>
        </article>
      </div>

      {!duplicateGroups.length ? (
        <article className="card ai-empty-state">
          <small className="section-kicker">No duplicate pass loaded</small>
          <h3>Scan the detected machine roots</h3>
          <p className="muted">
            Start with a whole-machine duplicate pass, then review the biggest groups and choose which copy stays.
          </p>
        </article>
      ) : (
        <div className="duplicate-groups-grid">
          {visibleDuplicateGroups.map((group) => {
            const selection = duplicateSelections.find((item) => item.groupId === group.id);
            return (
              <article key={group.id} className="card duplicate-card">
                <small className="section-kicker">Duplicate Cluster</small>
                <h3>Group {group.id.slice(0, 8)} - Recoverable {formatBytes(group.bytesRecoverable)}</h3>
                <label>
                  Keep file
                  <select value={selection?.keepPath ?? ""} onChange={(event) => onUpdateDuplicateKeep(group.id, event.target.value)}>
                    {group.files.map((file) => (
                      <option key={file.path} value={file.path}>
                        {shortPath(file.path)}
                      </option>
                    ))}
                  </select>
                </label>
                <ul className="list">
                  {group.files.map((file) => (
                    <li key={file.path}>
                      <span title={file.path}>{shortPath(file.path)}</span>
                      <strong>{formatBytes(file.sizeBytes)}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}

      {hasMoreDuplicateGroups && (
        <div className="footer-actions">
          <button className="btn secondary" onClick={onShowMoreDuplicateGroups}>Show More Duplicate Groups</button>
        </div>
      )}
    </section>
  );
}

