import type { QuarantineItem, QuarantinePurgeProgressEvent } from "../../../types";

interface QuarantineTabProps {
  visibleQuarantineItems: QuarantineItem[];
  quarantineActiveCount: number;
  quarantineTotalCount: number;
  quarantineRetentionDays: number;
  hasMoreQuarantineItems: boolean;
  isLoadingQuarantine: boolean;
  isPurgingQuarantine: boolean;
  quarantinePurgeProgress: QuarantinePurgeProgressEvent | null;
  onRefreshQuarantine: () => void;
  onPurgeQuarantine: () => void;
  onPurgeAllQuarantine: () => void;
  onCancelPurge: () => void;
  onRestoreOne: (itemId: string) => void;
  onShowMoreQuarantineItems: () => void;
  formatBytes: (value: number) => string;
  formatDate: (value?: number) => string;
  shortPath: (value: string) => string;
}

export function QuarantineTab({
  visibleQuarantineItems,
  quarantineActiveCount,
  quarantineTotalCount,
  quarantineRetentionDays,
  hasMoreQuarantineItems,
  isLoadingQuarantine,
  isPurgingQuarantine,
  quarantinePurgeProgress,
  onRefreshQuarantine,
  onPurgeQuarantine,
  onPurgeAllQuarantine,
  onCancelPurge,
  onRestoreOne,
  onShowMoreQuarantineItems,
  formatBytes,
  formatDate,
  shortPath
}: QuarantineTabProps) {
  return (
    <section className="panel panel-fade tab-surface quarantine-studio">
      <header className="panel-header tab-header">
        <div>
          <h2>Quarantine Vault</h2>
          <p className="muted">Review, restore, or purge quarantined items manually. Cleanup remains quarantine-first until you explicitly purge.</p>
        </div>
        <div className="row wrap">
          <button className="btn secondary" onClick={onRefreshQuarantine} disabled={isLoadingQuarantine || isPurgingQuarantine}>
            {isLoadingQuarantine ? "Refreshing..." : "Refresh"}
          </button>
          <button className="btn secondary" onClick={onPurgeQuarantine} disabled={isPurgingQuarantine || !quarantineActiveCount}>
            {isPurgingQuarantine ? "Purging..." : `Purge Older Than ${quarantineRetentionDays}d`}
          </button>
          <button className="btn danger" onClick={onPurgeAllQuarantine} disabled={isPurgingQuarantine || !quarantineActiveCount}>
            {isPurgingQuarantine ? "Purging..." : "Purge Entire Vault"}
          </button>
          <button className="btn secondary" onClick={onCancelPurge} disabled={!isPurgingQuarantine}>
            Cancel Purge
          </button>
        </div>
      </header>

      <div className="quarantine-summary-grid">
        <article className="stat-tile">
          <small>Active Items</small>
          <strong>{quarantineActiveCount}</strong>
          <span>{quarantineActiveCount} active items</span>
        </article>
        <article className="stat-tile">
          <small>Vault Records</small>
          <strong>{quarantineTotalCount}</strong>
          <span>{quarantineTotalCount} total records in the vault</span>
        </article>
        <article className="stat-tile">
          <small>Loaded Window</small>
          <strong>{visibleQuarantineItems.length}</strong>
          <span>Loaded {visibleQuarantineItems.length} items in the current page window.</span>
        </article>
        <article className="stat-tile">
          <small>Retention</small>
          <strong>{quarantineRetentionDays} d</strong>
          <span>Default purge horizon for old items</span>
        </article>
      </div>

      {quarantinePurgeProgress && (
        <div className="callout">
          <strong>{quarantinePurgeProgress.message}</strong>
          <span>{quarantinePurgeProgress.percent}%</span>
          <span>
            {quarantinePurgeProgress.completedGroups}/{quarantinePurgeProgress.totalGroups} groups
          </span>
          <span>
            {quarantinePurgeProgress.purgedItems}/{quarantinePurgeProgress.totalItems} items
          </span>
          <span>{formatBytes(quarantinePurgeProgress.purgedBytes)} purged</span>
          <span>
            {quarantinePurgeProgress.storageHint.toUpperCase()} x{quarantinePurgeProgress.concurrency}
          </span>
        </div>
      )}

      <article className="card quarantine-note-card">
        <small className="section-kicker">Recovery Model</small>
        <h3>Reversible vault</h3>
        <p className="muted">
          Use <strong>Purge Older Than {quarantineRetentionDays}d</strong> to clear only stale items, or <strong>Purge Entire Vault</strong> when you want to permanently remove all still-active quarantined content.
        </p>
      </article>

      <div className="table-wrap quarantine-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Size</th>
              <th>Moved At</th>
              <th>Original Path</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleQuarantineItems.map((item) => (
              <tr key={item.id}>
                <td>{item.category}</td>
                <td>{formatBytes(item.sizeBytes)}</td>
                <td>{formatDate(item.movedAt)}</td>
                <td title={item.originalPath}>{shortPath(item.originalPath)}</td>
                <td>{item.purgedAt ? "purged" : item.restoredAt ? "restored" : "active"}</td>
                <td>
                  <button className="btn secondary" onClick={() => onRestoreOne(item.id)} disabled={Boolean(item.purgedAt || item.restoredAt || isPurgingQuarantine)}>
                    Restore
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMoreQuarantineItems && (
        <div className="footer-actions">
          <button className="btn secondary" onClick={onShowMoreQuarantineItems} disabled={isLoadingQuarantine || isPurgingQuarantine}>
            {isLoadingQuarantine ? "Loading..." : "Show More Quarantine Items"}
          </button>
        </div>
      )}
    </section>
  );
}
