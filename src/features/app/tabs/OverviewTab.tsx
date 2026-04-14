import { useEffect, useMemo, useState } from "react";
import type { StorageScanResponse, StorageTreemapNode } from "../../../types";

export interface StorageHistorySnapshot {
  capturedAt: number;
  totalBytes: number;
  totalFiles: number;
  topAreas: Array<{ path: string; label: string; sizeBytes: number }>;
}

export interface StorageDiffEntry {
  path: string;
  label: string;
  deltaBytes: number;
  currentBytes: number;
  previousBytes: number;
}

export interface StorageDiffSummary {
  previousCapturedAt: number;
  currentCapturedAt: number;
  totalBytesDelta: number;
  totalFilesDelta: number;
  growingAreas: StorageDiffEntry[];
  shrinkingAreas: StorageDiffEntry[];
}

interface OverviewTabProps {
  storageInsights: StorageScanResponse | null;
  storageHistory: StorageHistorySnapshot[];
  storageDiff: StorageDiffSummary | null;
  storageLoading: boolean;
  onLoadStorage: () => void;
  formatBytes: (value: number) => string;
  shortPath: (value: string) => string;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function percentOf(part: number, whole: number): string {
  if (!whole) {
    return "0%";
  }
  return `${Math.max(0, Math.round((part / whole) * 100))}%`;
}

function formatSignedBytes(value: number, formatBytes: (value: number) => string): string {
  if (value === 0) {
    return formatBytes(0);
  }
  return `${value > 0 ? "+" : "-"}${formatBytes(Math.abs(value))}`;
}

function treemapTone(node: StorageTreemapNode): string {
  if (node.kind === "drive") {
    return "tone-neutral";
  }
  if (node.kind === "container") {
    if (node.category === "cache" || node.category === "temp") {
      return "tone-low";
    }
    if (node.category === "logs" || node.category === "installer_artifacts") {
      return "tone-medium";
    }
    return "tone-high";
  }
  if (node.kind === "area") {
    if (node.category === "users" || node.category === "program_data") {
      return "tone-medium";
    }
    if (node.category === "cache" || node.category === "logs" || node.category === "wsl") {
      return "tone-low";
    }
  }
  return "tone-neutral";
}

export function OverviewTab({
  storageInsights,
  storageHistory,
  storageDiff,
  storageLoading,
  onLoadStorage,
  formatBytes,
  shortPath
}: OverviewTabProps) {
  const scannedRoots = storageInsights?.scannedRoots ?? [];
  const topAreas = storageInsights?.topAreas ?? [];
  const drives = storageInsights?.drives ?? [];
  const treemap = storageInsights?.treemap ?? [];
  const topContainers = storageInsights?.topContainers?.slice(0, 8) ?? [];
  const totalBytes =
    storageInsights?.totalBytes ??
    storageInsights?.topFolders.reduce((sum, item) => sum + item.sizeBytes, 0) ??
    0;
  const totalFiles =
    storageInsights?.totalFiles ??
    storageInsights?.topFolders.reduce((sum, item) => sum + item.fileCount, 0) ??
    0;
  const topFolderBuckets = storageInsights?.topFolders.slice(0, 10) ?? [];
  const largestFiles = storageInsights?.largestFiles.slice(0, 10) ?? [];
  const largestApps = storageInsights?.apps.slice(0, 10) ?? [];
  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [selectedDetailId, setSelectedDetailId] = useState("");

  useEffect(() => {
    if (!treemap.length) {
      setSelectedDriveId("");
      setSelectedAreaId("");
      return;
    }
    const drive = treemap.find((item) => item.id === selectedDriveId) ?? treemap[0];
    if (drive.id !== selectedDriveId) {
      setSelectedDriveId(drive.id);
    }
    const area = drive.children?.find((item) => item.id === selectedAreaId) ?? drive.children?.[0] ?? null;
    if ((area?.id ?? "") !== selectedAreaId) {
      setSelectedAreaId(area?.id ?? "");
    }
    const detail = area?.children?.find((item) => item.id === selectedDetailId) ?? area?.children?.[0] ?? null;
    if ((detail?.id ?? "") !== selectedDetailId) {
      setSelectedDetailId(detail?.id ?? "");
    }
  }, [selectedAreaId, selectedDetailId, selectedDriveId, treemap]);

  const activeDrive = useMemo(
    () => treemap.find((item) => item.id === selectedDriveId) ?? treemap[0] ?? null,
    [selectedDriveId, treemap]
  );
  const activeArea = useMemo(
    () => activeDrive?.children?.find((item) => item.id === selectedAreaId) ?? activeDrive?.children?.[0] ?? null,
    [activeDrive, selectedAreaId]
  );
  const activeDetail = useMemo(
    () => activeArea?.children?.find((item) => item.id === selectedDetailId) ?? activeArea?.children?.[0] ?? null,
    [activeArea, selectedDetailId]
  );
  const treemapInspector = activeDetail ?? activeArea ?? activeDrive;
  const focusTreemapPath = (targetPath: string) => {
    const normalizedTarget = targetPath.toLowerCase();
    for (const drive of treemap) {
      const directArea = drive.children?.find((item) => item.path.toLowerCase() === normalizedTarget);
      if (directArea) {
        setSelectedDriveId(drive.id);
        setSelectedAreaId(directArea.id);
        setSelectedDetailId(directArea.children?.[0]?.id ?? "");
        return;
      }
      const directDetail = drive.children?.flatMap((item) => item.children ?? []).find((item) => item.path.toLowerCase() === normalizedTarget);
      if (directDetail) {
        const parentArea = drive.children?.find((item) => item.children?.some((child) => child.id === directDetail.id));
        setSelectedDriveId(drive.id);
        setSelectedAreaId(parentArea?.id ?? "");
        setSelectedDetailId(directDetail.id);
        return;
      }
      const nestedArea = drive.children?.find((item) =>
        item.children?.some((child) => child.path.toLowerCase() === normalizedTarget)
      );
      if (nestedArea) {
        setSelectedDriveId(drive.id);
        setSelectedAreaId(nestedArea.id);
        const nestedDetail = nestedArea.children?.find((child) => child.path.toLowerCase() === normalizedTarget);
        setSelectedDetailId(nestedDetail?.id ?? nestedArea.children?.[0]?.id ?? "");
        return;
      }
    }
  };

  return (
    <section className="panel panel-fade tab-surface overview-studio">
      <header className="panel-header tab-header">
        <div>
          <small className="section-kicker">Storage Map</small>
          <h2>Whole-disk pressure map</h2>
          <p className="muted">See where space is actually going first. Open deeper detail only when you need it.</p>
        </div>
        <button className="btn secondary" onClick={onLoadStorage} disabled={storageLoading}>
          {storageLoading ? "Scanning..." : "Refresh Full-Disk Map"}
        </button>
      </header>

      {storageInsights ? (
        <>
          <article className="card overview-hero-card">
            <div className="overview-summary-grid overview-summary-grid--tight">
              <div className="mini-card">
                <span>Total scanned size</span>
                <strong>{formatBytes(totalBytes)}</strong>
              </div>
              <div className="mini-card">
                <span>Indexed files</span>
                <strong>{formatCount(totalFiles)}</strong>
              </div>
              <div className="mini-card">
                <span>Roots covered</span>
                <strong>{formatCount(scannedRoots.length)}</strong>
              </div>
              <div className="mini-card">
                <span>Installed apps</span>
                <strong>{formatCount(storageInsights.apps.length)}</strong>
              </div>
            </div>
            <div className="overview-signal-strip">
              <span className="workspace-meta-pill">Summary first</span>
              <span className="workspace-meta-pill">Treemap drill-down</span>
              <span className="workspace-meta-pill">Program + system + disposable zones</span>
            </div>
            {drives.length > 0 ? (
              <div className="overview-root-strip">
                {drives.map((drive) => (
                  <div key={drive.root} className="overview-root-chip">
                    <strong>{drive.root}</strong>
                    <span>{formatBytes(drive.sizeBytes)}</span>
                    <small>{formatCount(drive.fileCount)} files</small>
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          {storageDiff ? (
            <details className="settings-advanced-panel overview-advanced-panel">
              <summary>Since previous refresh</summary>
              <article className="card overview-diff-card">
                <header className="panel-header compact">
                  <div>
                    <small className="section-kicker">Diff</small>
                    <h3>Since previous refresh</h3>
                  </div>
                  <span className="muted">
                    {new Date(storageDiff.previousCapturedAt).toLocaleString()} {"->"} {new Date(storageDiff.currentCapturedAt).toLocaleString()}
                  </span>
                </header>
                <div className="result-metric-grid result-metric-grid--compact">
                  <article className="result-metric">
                    <small>Total size delta</small>
                    <strong>{formatSignedBytes(storageDiff.totalBytesDelta, formatBytes)}</strong>
                  </article>
                  <article className="result-metric">
                    <small>File delta</small>
                    <strong>{storageDiff.totalFilesDelta > 0 ? "+" : ""}{formatCount(storageDiff.totalFilesDelta)}</strong>
                  </article>
                  <article className="result-metric">
                    <small>Snapshots</small>
                    <strong>{storageHistory.length}</strong>
                  </article>
                  <article className="result-metric">
                    <small>Growing areas</small>
                    <strong>{storageDiff.growingAreas.length}</strong>
                  </article>
                </div>
                <div className="overview-diff-grid">
                  <article className="card inset">
                    <small className="section-kicker">Growth</small>
                    <h3>Largest increases</h3>
                    {storageDiff.growingAreas.length ? (
                      <ul className="ai-compact-list">
                        {storageDiff.growingAreas.map((entry) => (
                          <li key={`grow:${entry.path}`}>
                            <span title={entry.path}>{entry.label}</span>
                            <strong>{formatSignedBytes(entry.deltaBytes, formatBytes)}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No major growth was detected between the last two refreshes.</p>
                    )}
                  </article>
                  <article className="card inset">
                    <small className="section-kicker">Recovery</small>
                    <h3>Largest decreases</h3>
                    {storageDiff.shrinkingAreas.length ? (
                      <ul className="ai-compact-list">
                        {storageDiff.shrinkingAreas.map((entry) => (
                          <li key={`shrink:${entry.path}`}>
                            <span title={entry.path}>{entry.label}</span>
                            <strong>{formatSignedBytes(entry.deltaBytes, formatBytes)}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No major reductions were detected between the last two refreshes.</p>
                    )}
                  </article>
                </div>
              </article>
            </details>
          ) : null}

          {treemap.length ? (
            <article className="card overview-treemap-card">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Treemap</small>
                  <h3>Unit to area to cleanup surface</h3>
                </div>
                <span className="muted">Click tiles to inspect and narrow the heaviest zones.</span>
              </header>

              <div className="overview-treemap-grid">
                <div className="overview-treemap-stack">
                  <div className="overview-breadcrumb-row">
                    {activeDrive ? (
                      <button type="button" className="overview-breadcrumb-pill" onClick={() => {
                        setSelectedDriveId(activeDrive.id);
                        setSelectedAreaId(activeDrive.children?.[0]?.id ?? "");
                      }}>
                        {activeDrive.label}
                      </button>
                    ) : null}
                    {activeArea ? (
                      <button type="button" className="overview-breadcrumb-pill" onClick={() => setSelectedAreaId(activeArea.id)}>
                        {activeArea.label}
                      </button>
                    ) : null}
                    {activeDetail ? <span className="overview-breadcrumb-pill is-active">{activeDetail.label}</span> : null}
                  </div>
                  <div className="storage-treemap-board">
                    {treemap.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className={node.id === activeDrive?.id ? "storage-treemap-tile is-selected" : "storage-treemap-tile"}
                        style={{ flexGrow: Math.max(1, node.sizeBytes) }}
                        onClick={() => {
                          setSelectedDriveId(node.id);
                          setSelectedAreaId(node.children?.[0]?.id ?? "");
                          setSelectedDetailId(node.children?.[0]?.children?.[0]?.id ?? "");
                        }}
                      >
                        <small>{node.label}</small>
                        <strong>{formatBytes(node.sizeBytes)}</strong>
                        <span>{percentOf(node.sizeBytes, totalBytes)} of scanned size</span>
                      </button>
                    ))}
                  </div>

                  {activeDrive?.children?.length ? (
                    <div className="storage-treemap-board storage-treemap-board--nested">
                      {activeDrive.children.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          className={node.id === activeArea?.id ? "storage-treemap-tile is-selected" : "storage-treemap-tile"}
                          style={{ flexGrow: Math.max(1, node.sizeBytes) }}
                          onClick={() => setSelectedAreaId(node.id)}
                        >
                          <small>{node.label}</small>
                          <strong>{formatBytes(node.sizeBytes)}</strong>
                          <span>{percentOf(node.sizeBytes, activeDrive.sizeBytes)} of {activeDrive.label}</span>
                          {node.cachedFromIndex ? <em>indexed</em> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {activeArea?.children?.length ? (
                    <div className="storage-treemap-board storage-treemap-board--detail">
                      {activeArea.children.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          className={`storage-treemap-tile is-static ${treemapTone(node)} ${node.id === activeDetail?.id ? "is-selected" : ""}`}
                          style={{ flexGrow: Math.max(1, node.sizeBytes) }}
                          onClick={() => setSelectedDetailId(node.id)}
                        >
                          <small>{node.label}</small>
                          <strong>{formatBytes(node.sizeBytes)}</strong>
                          <span>{percentOf(node.sizeBytes, activeArea.sizeBytes)} of {activeArea.label}</span>
                          <span title={node.path}>{shortPath(node.path)}</span>
                          {node.cachedFromIndex ? <em>indexed</em> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <article className="card inset overview-treemap-inspector">
                  <small className="section-kicker">Inspector</small>
                  <h3>{treemapInspector?.label ?? "No treemap focus"}</h3>
                  {treemapInspector ? (
                    <>
                      <div className="result-metric-grid result-metric-grid--compact">
                        <article className="result-metric">
                          <small>Size</small>
                          <strong>{formatBytes(treemapInspector.sizeBytes)}</strong>
                        </article>
                        <article className="result-metric">
                          <small>Files</small>
                          <strong>{formatCount(treemapInspector.fileCount)}</strong>
                        </article>
                        <article className="result-metric">
                          <small>Share</small>
                          <strong>{percentOf(treemapInspector.sizeBytes, totalBytes)}</strong>
                        </article>
                        <article className="result-metric">
                          <small>Children</small>
                          <strong>{treemapInspector.children?.length ?? 0}</strong>
                        </article>
                      </div>
                      <p className="muted" title={treemapInspector.path}>{shortPath(treemapInspector.path)}</p>
                      {treemapInspector.cachedFromIndex ? (
                        <p className="muted">This node came from the persistent storage index instead of a cold traversal.</p>
                      ) : null}
                      {treemapInspector.children?.length ? (
                        <ul className="ai-compact-list">
                          {treemapInspector.children.slice(0, 6).map((node) => (
                            <li key={node.id}>
                              <span title={node.path}>{node.label}</span>
                              <strong>{formatBytes(node.sizeBytes)}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">This focus node has no deeper treemap slice available in the current map.</p>
                      )}
                    </>
                  ) : (
                    <p className="muted">Refresh the full-disk map to build the treemap.</p>
                  )}
                </article>
              </div>
            </article>
          ) : null}

          <article className="card overview-priority-card">
            <header className="panel-header compact">
              <div>
                <small className="section-kicker">Priority Lanes</small>
                <h3>Where to look next</h3>
              </div>
              <span className="muted">Focus the treemap from the heaviest program, system, and disposable zones.</span>
            </header>
            <div className="overview-primary-grid">
              <article className="overview-primary-card">
                <div className="panel-header compact">
                  <div>
                    <small className="section-kicker">Hotspots</small>
                    <h3>Top Disk Areas</h3>
                  </div>
                  <span className="muted">{topAreas.length} mapped area(s)</span>
                </div>
                <ul className="list compact overview-priority-list">
                  {topAreas.slice(0, 8).map((item) => (
                    <li key={item.path}>
                      <button type="button" className="overview-priority-button" onClick={() => focusTreemapPath(item.path)}>
                        <div className="storage-line-copy">
                          <span>{item.label}</span>
                          <small title={item.path}>{shortPath(item.path)}</small>
                        </div>
                        <div className="storage-line-value">
                          <strong>{formatBytes(item.sizeBytes)}</strong>
                          <small>
                            {formatCount(item.fileCount)} files{item.cachedFromIndex ? " / indexed" : ""}
                          </small>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="overview-primary-card">
                <div className="panel-header compact">
                  <div>
                    <small className="section-kicker">Disposable</small>
                    <h3>Temp / Cache / Logs / WSL</h3>
                  </div>
                  <span className="muted">{topContainers.length} surfaced</span>
                </div>
                <ul className="list compact overview-priority-list">
                  {topContainers.length ? topContainers.map((item) => (
                    <li key={item.path}>
                      <button type="button" className="overview-priority-button" onClick={() => focusTreemapPath(item.path)}>
                        <div className="storage-line-copy">
                          <span title={item.path}>{shortPath(item.path)}</span>
                          <small>{item.label}{item.cachedFromIndex ? " / indexed" : ""}</small>
                        </div>
                        <div className="storage-line-value">
                          <strong>{formatBytes(item.sizeBytes)}</strong>
                          <small>{formatCount(item.fileCount)} files</small>
                        </div>
                      </button>
                    </li>
                  )) : (
                    <li>
                      <span className="muted">No heavy disposable containers surfaced yet.</span>
                    </li>
                  )}
                </ul>
              </article>
            </div>
          </article>

          <details className="settings-advanced-panel overview-details-panel">
            <summary>More storage detail</summary>
            <div className="overview-detail-grid">
              <article className="card inset">
                <header className="panel-header compact">
                  <h3>Largest Files</h3>
                  <span className="muted">Top {largestFiles.length}</span>
                </header>
                <ul className="list compact">
                  {largestFiles.map((item) => (
                    <li key={item.path}>
                      <div className="storage-line-copy">
                        <span title={item.path}>{shortPath(item.path)}</span>
                        <small>{new Date(item.modifiedAt).toLocaleDateString()}</small>
                      </div>
                      <strong>{formatBytes(item.sizeBytes)}</strong>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="card inset">
                <header className="panel-header compact">
                  <h3>Largest Folder Buckets</h3>
                  <span className="muted">Top {topFolderBuckets.length}</span>
                </header>
                <ul className="list compact">
                  {topFolderBuckets.map((item) => (
                    <li key={item.path}>
                      <div className="storage-line-copy">
                        <span title={item.path}>{shortPath(item.path)}</span>
                        <small>{formatCount(item.fileCount)} files</small>
                      </div>
                      <strong>{formatBytes(item.sizeBytes)}</strong>
                    </li>
                  ))}
                </ul>
              </article>

              <article className="card inset">
                <header className="panel-header compact">
                  <h3>Installed Apps By Estimated Size</h3>
                  <span className="muted">Top {largestApps.length}</span>
                </header>
                <ul className="list compact">
                  {largestApps.map((item) => (
                    <li key={`${item.name}-${item.version ?? "v"}`}>
                      <div className="storage-line-copy">
                        <span>{item.name}</span>
                        <small>{item.publisher || item.version || "Unknown publisher"}</small>
                      </div>
                      <strong>{formatBytes(item.sizeBytes)}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            {scannedRoots.length > 0 ? (
              <div className="source-legend">
                {scannedRoots.map((root) => (
                  <span key={root} className="origin-pill origin-neutral" title={root}>
                    {root}
                  </span>
                ))}
              </div>
            ) : null}
          </details>
        </>
      ) : (
        <div className="performance-empty-state decision-empty-state">
          <strong>No disk map loaded yet.</strong>
          <p className="muted">Run the full-disk map to surface the heaviest program, system, cache, and user-data zones first.</p>
        </div>
      )}
    </section>
  );
}
