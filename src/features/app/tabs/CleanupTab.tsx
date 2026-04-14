import { useEffect, useMemo, useState } from "react";
import type {
  AIActionSuggestion,
  CleanupExecuteResponse,
  CleanupPreviewResponse,
  CleanupCategory,
  ScanFinding
} from "../../../types";

type CleanupGroupBy = "category" | "folder" | "extension" | "risk";
type CleanupSortBy = "size_desc" | "size_asc" | "path_asc" | "risk_desc" | "modified_desc" | "source_desc";
type CleanupQuickFilter = "all" | "selected" | "ai_selected" | "recommended";
type FindingSelectionMode = "add" | "remove" | "replace";

interface CleanupBulkSubgroup {
  key: string;
  label: string;
  count: number;
  totalBytes: number;
  selectedCount: number;
  ids: string[];
}

interface CleanupCategoryCollection {
  category: CleanupCategory;
  label: string;
  count: number;
  totalBytes: number;
  selectedCount: number;
  recommendedCount: number;
  aiCount: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  ids: string[];
  saferIds: string[];
  recommendedIds: string[];
  aiIds: string[];
  locationGroups: CleanupBulkSubgroup[];
  familyGroups: CleanupBulkSubgroup[];
}

interface CleanupPreviewGroup {
  key: string;
  label: string;
  totalBytes: number;
  count: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  items: ScanFinding[];
}

interface CleanupFilterCounts {
  all: number;
  selected: number;
  ai_selected: number;
  recommended: number;
}

interface CleanupErrorSummary {
  label: string;
  count: number;
  examples: string[];
}

interface CleanupTabProps {
  findings: ScanFinding[];
  visibleFindings: ScanFinding[];
  sortedFilteredFindings: ScanFinding[];
  selectedFindingSet: Set<string>;
  aiSuggestedFindingSet: Set<string>;
  recommendedFindingSet: Set<string>;
  cleanupPreview: CleanupPreviewResponse | null;
  cleanupResult: CleanupExecuteResponse | null;
  cleanupPreviewSourceFindings: ScanFinding[];
  cleanupGroupedPreview: CleanupPreviewGroup[];
  cleanupCategoryCollections: CleanupCategoryCollection[];
  cleanupFilterCounts: CleanupFilterCounts;
  cleanupQuickFilter: CleanupQuickFilter;
  cleanupGroupBy: CleanupGroupBy;
  cleanupSortBy: CleanupSortBy;
  cleanupPreviewScope: "selected" | "all";
  findingsQuery: string;
  pendingAiAction: AIActionSuggestion | null;
  selectedBytes: number;
  hasMoreFindings: boolean;
  isPreviewingCleanup: boolean;
  isExecutingCleanup: boolean;
  onSelectAiSuggestedFindings: () => void;
  onSelectRecommendedFindings: () => void;
  onSelectVisibleFindings: () => void;
  onClearSelection: () => void;
  onPreviewCleanup: () => void;
  onExecuteCleanup: () => void;
  onClearAiFocus: () => void;
  onSetFindingsQuery: (value: string) => void;
  onSetCleanupSortBy: (value: CleanupSortBy) => void;
  onSetCleanupQuickFilter: (value: CleanupQuickFilter) => void;
  onSetCleanupGroupBy: (value: CleanupGroupBy) => void;
  onSetCleanupPreviewScope: (value: "selected" | "all") => void;
  onToggleFinding: (id: string) => void;
  onApplyFindingSelection: (ids: string[], mode: FindingSelectionMode, label: string) => void;
  onAddFindingPathToAllowlist: (path: string) => void;
  onShowMoreFindings: () => void;
  formatBytes: (value: number) => string;
  shortPath: (value: string) => string;
  categoryClass: (category: CleanupCategory) => string;
  toneClass: (risk: ScanFinding["risk"]) => string;
  categoryLabelByValue: Record<CleanupCategory, string>;
}

function summarizeCleanupErrors(errors: string[]): CleanupErrorSummary[] {
  const buckets = new Map<string, CleanupErrorSummary>();
  for (const error of errors) {
    const separatorIndex = error.indexOf(": ", 3);
    const label = separatorIndex >= 0 ? error.slice(separatorIndex + 2).trim() : error.trim();
    const key = label.toLowerCase();
    const bucket = buckets.get(key) ?? { label, count: 0, examples: [] };
    bucket.count += 1;
    if (bucket.examples.length < 3) {
      bucket.examples.push(error);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function CleanupTab({
  findings,
  visibleFindings,
  sortedFilteredFindings,
  selectedFindingSet,
  aiSuggestedFindingSet,
  recommendedFindingSet,
  cleanupPreview,
  cleanupResult,
  cleanupPreviewSourceFindings,
  cleanupGroupedPreview,
  cleanupCategoryCollections,
  cleanupFilterCounts,
  cleanupQuickFilter,
  cleanupGroupBy,
  cleanupSortBy,
  cleanupPreviewScope,
  findingsQuery,
  pendingAiAction,
  selectedBytes,
  hasMoreFindings,
  isPreviewingCleanup,
  isExecutingCleanup,
  onSelectAiSuggestedFindings,
  onSelectRecommendedFindings,
  onSelectVisibleFindings,
  onClearSelection,
  onPreviewCleanup,
  onExecuteCleanup,
  onClearAiFocus,
  onSetFindingsQuery,
  onSetCleanupSortBy,
  onSetCleanupQuickFilter,
  onSetCleanupGroupBy,
  onSetCleanupPreviewScope,
  onToggleFinding,
  onApplyFindingSelection,
  onAddFindingPathToAllowlist,
  onShowMoreFindings,
  formatBytes,
  shortPath,
  categoryClass,
  toneClass,
  categoryLabelByValue
}: CleanupTabProps) {
  const cleanupErrorSummary = cleanupResult ? summarizeCleanupErrors(cleanupResult.errors) : [];
  const [activeCategory, setActiveCategory] = useState<CleanupCategory | "">("");
  const [activeSubgroupKey, setActiveSubgroupKey] = useState("");
  const [activeSubgroupKind, setActiveSubgroupKind] = useState<"location" | "family" | "">("");

  useEffect(() => {
    if (!cleanupCategoryCollections.length) {
      if (activeCategory) {
        setActiveCategory("");
      }
      if (activeSubgroupKey) {
        setActiveSubgroupKey("");
        setActiveSubgroupKind("");
      }
      return;
    }

    if (!activeCategory || !cleanupCategoryCollections.some((item) => item.category === activeCategory)) {
      setActiveCategory(cleanupCategoryCollections[0].category);
      setActiveSubgroupKey("");
      setActiveSubgroupKind("");
    }
  }, [activeCategory, activeSubgroupKey, cleanupCategoryCollections]);

  const activeCollection = useMemo(
    () => cleanupCategoryCollections.find((item) => item.category === activeCategory) ?? cleanupCategoryCollections[0] ?? null,
    [activeCategory, cleanupCategoryCollections]
  );

  const activeSubgroup = useMemo(() => {
    if (!activeCollection || !activeSubgroupKey || !activeSubgroupKind) {
      return null;
    }
    const list = activeSubgroupKind === "location" ? activeCollection.locationGroups : activeCollection.familyGroups;
    return list.find((item) => item.key === activeSubgroupKey) ?? null;
  }, [activeCollection, activeSubgroupKey, activeSubgroupKind]);

  useEffect(() => {
    if (!activeCollection || !activeSubgroupKey || !activeSubgroupKind) {
      return;
    }
    const list = activeSubgroupKind === "location" ? activeCollection.locationGroups : activeCollection.familyGroups;
    if (!list.some((item) => item.key === activeSubgroupKey)) {
      setActiveSubgroupKey("");
      setActiveSubgroupKind("");
    }
  }, [activeCollection, activeSubgroupKey, activeSubgroupKind]);

  const contextualIds = activeSubgroup?.ids ?? activeCollection?.ids ?? [];
  const contextualIdSet = useMemo(() => new Set(contextualIds), [contextualIds]);
  const contextualFindings = useMemo(
    () => sortedFilteredFindings.filter((item) => contextualIdSet.has(item.id)),
    [contextualIdSet, sortedFilteredFindings]
  );
  const contextualVisibleFindings = contextualFindings.slice(0, 18);
  const contextualSelectedCount = contextualIds.filter((id) => selectedFindingSet.has(id)).length;
  const contextualAiCount = contextualIds.filter((id) => aiSuggestedFindingSet.has(id)).length;
  const contextualRecommendedCount = contextualIds.filter((id) => recommendedFindingSet.has(id)).length;
  const contextualSelectedBytes = contextualFindings.reduce(
    (sum, item) => sum + (selectedFindingSet.has(item.id) ? item.sizeBytes : 0),
    0
  );
  const contextualPreviewGroups = useMemo(() => {
    if (!contextualIdSet.size) {
      return cleanupGroupedPreview.slice(0, 6);
    }
    return cleanupGroupedPreview
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => contextualIdSet.has(item.id))
      }))
      .filter((group) => group.items.length > 0)
      .slice(0, 6);
  }, [cleanupGroupedPreview, contextualIdSet]);

  const activeLabel = activeSubgroup ? activeSubgroup.label : activeCollection?.label ?? "Cleanup focus";
  const activeBytes = activeSubgroup?.totalBytes ?? activeCollection?.totalBytes ?? 0;
  const activeCount = activeSubgroup?.count ?? activeCollection?.count ?? 0;

  return (
    <section className="panel panel-fade tab-surface cleanup-studio cleanup-studio--master">
      <header className="panel-header tab-header">
        <div>
          <small className="section-kicker">Cleanup Plan</small>
          <h2>Bulk cleanup workspace</h2>
          <p className="muted">Select at collection level first. Inspect only the slice you are working on.</p>
        </div>
        <div className="row wrap">
          <button className="btn secondary" onClick={onSelectAiSuggestedFindings} disabled={!aiSuggestedFindingSet.size}>
            Select AI-selected
          </button>
          <button className="btn secondary" onClick={onSelectRecommendedFindings} disabled={!findings.length}>Select Recommended</button>
          <button className="btn secondary" onClick={onSelectVisibleFindings} disabled={!visibleFindings.length}>Select Visible</button>
          <button className="btn secondary" onClick={onClearSelection}>Clear</button>
          <button className="btn secondary" onClick={onPreviewCleanup} disabled={!selectedFindingSet.size || isPreviewingCleanup}>
            {isPreviewingCleanup ? "Previewing..." : "Preview"}
          </button>
          <button className="btn" onClick={onExecuteCleanup} disabled={!selectedFindingSet.size || isExecutingCleanup}>
            {isExecutingCleanup ? "Running..." : "Execute Quarantine"}
          </button>
        </div>
      </header>

      {pendingAiAction && (
        <div className="callout">
          <strong>AI focus: {pendingAiAction.title}</strong>
          <span>{pendingAiAction.summary}</span>
          <span>{formatBytes(pendingAiAction.estimatedBytes)} estimated impact</span>
          <button className="btn secondary" onClick={onClearAiFocus}>
            Clear AI Focus
          </button>
        </div>
      )}

      {cleanupPreview && (
        <div className="callout">
          <strong>{cleanupPreview.actionCount} actions</strong>
          <span>{formatBytes(cleanupPreview.totalBytes)} recoverable</span>
          <span>High risk: {cleanupPreview.riskFlags.highRiskCount}</span>
          <span>Blocked: {cleanupPreview.riskFlags.blockedCount}</span>
        </div>
      )}

      {cleanupResult && (
        <div className="callout success">
          <strong>Moved {cleanupResult.movedCount}</strong>
          <span>Failed {cleanupResult.failedCount}</span>
          <span>Freed {formatBytes(cleanupResult.freedBytes)}</span>
          {cleanupErrorSummary.length > 0 && <span>{cleanupErrorSummary.length} common error pattern(s) captured</span>}
        </div>
      )}

      <article className="card cleanup-summary-card cleanup-summary-card--compact">
        <div className="result-metric-grid result-metric-grid--compact">
          <article className="result-metric">
            <small>Scope</small>
            <strong>{sortedFilteredFindings.length}</strong>
          </article>
          <article className="result-metric">
            <small>Selected</small>
            <strong>{selectedFindingSet.size}</strong>
          </article>
          <article className="result-metric">
            <small>Recoverable</small>
            <strong>{formatBytes(selectedBytes)}</strong>
          </article>
          <article className="result-metric">
            <small>Collections</small>
            <strong>{cleanupCategoryCollections.length}</strong>
          </article>
        </div>
        <div className="cleanup-summary-notes">
          <span className="workspace-meta-pill">Bulk-first selection</span>
          <span className="workspace-meta-pill">Inspector-driven review</span>
          <span className="workspace-meta-pill">Detailed list on demand</span>
        </div>
      </article>

      <p className="muted cleanup-legend-compact">
        Source badges: <span className="origin-pill origin-ai">AI</span> focus, <span className="origin-pill origin-recommended">Recommended</span> defaults, <span className="origin-pill origin-manual">Manual</span> explicit selection.
      </p>

      {!findings.length ? (
        <div className="performance-empty-state decision-empty-state">
          <strong>No cleanup findings are loaded yet.</strong>
          <p className="muted">Start a scan and let the app sync results automatically. Once findings arrive, grouped cleanup collections will appear here.</p>
        </div>
      ) : (
        <div className="cleanup-master-layout">
          <aside className="card cleanup-tree-panel">
            <div className="stack gap-sm">
              <small className="section-kicker">Collections</small>
              <div className="cleanup-tree-overview">
                <article className="mini-card">
                  <small>Active focus</small>
                  <strong>{activeCollection?.label ?? "None"}</strong>
                </article>
                <article className="mini-card">
                  <small>Visible scope</small>
                  <strong>{sortedFilteredFindings.length}</strong>
                </article>
              </div>
              <details className="settings-advanced-panel cleanup-filter-panel">
                <summary>Filters and sorting</summary>
                <label>
                  Search current scope
                  <input value={findingsQuery} onChange={(event) => onSetFindingsQuery(event.target.value)} placeholder="Filter by path/category/reason" />
                </label>
                <label>
                  Sort current scope
                  <select value={cleanupSortBy} onChange={(event) => onSetCleanupSortBy(event.target.value as CleanupSortBy)}>
                    <option value="size_desc">Size (largest first)</option>
                    <option value="size_asc">Size (smallest first)</option>
                    <option value="source_desc">Source (AI first)</option>
                    <option value="risk_desc">Risk (high first)</option>
                    <option value="modified_desc">Last modified (newest first)</option>
                    <option value="path_asc">Path (A-Z)</option>
                  </select>
                </label>
                <div className="row wrap cleanup-filter-pills">
                  <button className={`pill ${cleanupQuickFilter === "all" ? "active" : ""}`} onClick={() => onSetCleanupQuickFilter("all")}>
                    All ({cleanupFilterCounts.all})
                  </button>
                  <button className={`pill ${cleanupQuickFilter === "selected" ? "active" : ""}`} onClick={() => onSetCleanupQuickFilter("selected")}>
                    Selected ({cleanupFilterCounts.selected})
                  </button>
                  <button className={`pill ${cleanupQuickFilter === "ai_selected" ? "active" : ""}`} onClick={() => onSetCleanupQuickFilter("ai_selected")} disabled={!cleanupFilterCounts.ai_selected}>
                    AI-selected ({cleanupFilterCounts.ai_selected})
                  </button>
                  <button className={`pill ${cleanupQuickFilter === "recommended" ? "active" : ""}`} onClick={() => onSetCleanupQuickFilter("recommended")} disabled={!cleanupFilterCounts.recommended}>
                    Recommended ({cleanupFilterCounts.recommended})
                  </button>
                </div>
              </details>
            </div>

            <div className="cleanup-tree-list">
              {cleanupCategoryCollections.map((group) => {
                const isActive = activeCollection?.category === group.category;
                return (
                  <button
                    key={group.category}
                    type="button"
                    className={isActive ? "cleanup-tree-item is-active" : "cleanup-tree-item"}
                    onClick={() => {
                      setActiveCategory(group.category);
                      setActiveSubgroupKey("");
                      setActiveSubgroupKind("");
                    }}
                  >
                    <div className="row spread center wrap">
                      <span className={`category-chip ${categoryClass(group.category)}`}>{group.label}</span>
                      <strong>{formatBytes(group.totalBytes)}</strong>
                    </div>
                    <div className="cleanup-tree-meta">
                      <span>{group.count} items</span>
                      <span>{group.selectedCount} selected</span>
                    </div>
                    <div className="row wrap">
                      {group.aiCount > 0 && <span className="origin-pill origin-ai">AI {group.aiCount}</span>}
                      {group.recommendedCount > 0 && <span className="origin-pill origin-recommended">Recommended {group.recommendedCount}</span>}
                      {group.highRisk > 0 && <span className={`risk-pill ${toneClass("high")}`}>High {group.highRisk}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="cleanup-detail-panel">
            {activeCollection ? (
              <>
                <article className="card cleanup-inspector-card">
                  <header className="panel-header compact">
                    <div>
                      <small className="section-kicker">Inspector</small>
                      <h3>{activeSubgroup ? shortPath(activeLabel) : activeLabel}</h3>
                      <p className="muted">
                        {activeSubgroup
                          ? `Working inside ${activeCollection.label}. Switch location or family below to move across the collection.`
                          : `Use collection-level actions first, then narrow by location or file family.`}
                      </p>
                    </div>
                    <div className="stack gap-xs align-end">
                      <span className={`category-chip ${categoryClass(activeCollection.category)}`}>{activeCollection.label}</span>
                      <strong>{formatBytes(activeBytes)}</strong>
                    </div>
                  </header>

                  <div className="cleanup-inspector-metrics">
                    <article className="mini-card">
                      <small>Context items</small>
                      <strong>{activeCount}</strong>
                    </article>
                    <article className="mini-card">
                      <small>Selected here</small>
                      <strong>{contextualSelectedCount}</strong>
                    </article>
                    <article className="mini-card">
                      <small>Selected bytes</small>
                      <strong>{formatBytes(contextualSelectedBytes)}</strong>
                    </article>
                    <article className="mini-card">
                      <small>AI / Recommended</small>
                      <strong>{contextualAiCount} / {contextualRecommendedCount}</strong>
                    </article>
                  </div>

                  <div className="row wrap cleanup-inspector-actions">
                    <button className="btn secondary" onClick={() => onApplyFindingSelection(contextualIds, "replace", activeLabel)}>
                      Select only this
                    </button>
                    <button className="btn secondary" onClick={() => onApplyFindingSelection(contextualIds, "add", activeLabel)}>
                      Add this
                    </button>
                    <button className="btn secondary" onClick={() => onApplyFindingSelection(contextualIds, "remove", activeLabel)}>
                      Clear this
                    </button>
                    {!activeSubgroup && (
                      <>
                        <button className="btn secondary" onClick={() => onApplyFindingSelection(activeCollection.saferIds, "add", `${activeCollection.label} safer items`)}>
                          Select safer
                        </button>
                        <button className="btn secondary" onClick={() => onApplyFindingSelection(activeCollection.recommendedIds, "add", `${activeCollection.label} recommended items`)} disabled={!activeCollection.recommendedIds.length}>
                          Select recommended
                        </button>
                        <button className="btn secondary" onClick={() => onApplyFindingSelection(activeCollection.aiIds, "add", `${activeCollection.label} AI items`)} disabled={!activeCollection.aiIds.length}>
                          Select AI slice
                        </button>
                      </>
                    )}
                  </div>

                  <div className="cleanup-detail-columns">
                    <section className="cleanup-subgroup-panel">
                      <div className="panel-header compact">
                        <h4>Top Locations</h4>
                        <span className="muted">{activeCollection.locationGroups.length}</span>
                      </div>
                      <div className="cleanup-subgroup-list cleanup-subgroup-list--stacked">
                        {activeCollection.locationGroups.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className={activeSubgroupKind === "location" && activeSubgroupKey === item.key ? "cleanup-subgroup-chip is-selected" : "cleanup-subgroup-chip"}
                            onClick={() => {
                              setActiveSubgroupKey(item.key);
                              setActiveSubgroupKind("location");
                            }}
                          >
                            <span title={item.label}>{shortPath(item.label)}</span>
                            <strong>{formatBytes(item.totalBytes)}</strong>
                            <small>{item.count} items</small>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="cleanup-subgroup-panel">
                      <div className="panel-header compact">
                        <h4>File Families</h4>
                        <span className="muted">{activeCollection.familyGroups.length}</span>
                      </div>
                      <div className="cleanup-subgroup-list cleanup-subgroup-list--stacked">
                        {activeCollection.familyGroups.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className={activeSubgroupKind === "family" && activeSubgroupKey === item.key ? "cleanup-subgroup-chip is-selected" : "cleanup-subgroup-chip"}
                            onClick={() => {
                              setActiveSubgroupKey(item.key);
                              setActiveSubgroupKind("family");
                            }}
                          >
                            <span>{item.label}</span>
                            <strong>{formatBytes(item.totalBytes)}</strong>
                            <small>{item.count} items</small>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>

                  <section className="cleanup-context-panel">
                    <div className="panel-header compact">
                      <h4>Context sample</h4>
                      <span className="muted">{contextualFindings.length} matching finding(s)</span>
                    </div>
                    {contextualVisibleFindings.length ? (
                      <ul className="ai-compact-list cleanup-context-list">
                        {contextualVisibleFindings.map((item) => (
                          <li key={item.id}>
                            <div className="stack gap-xs cleanup-context-copy">
                              <span title={item.path}>{shortPath(item.path)}</span>
                              <small className="muted">
                                {item.reason}
                                {item.kind === "directory" ? ` • folder container (${item.entryCount ?? 0} items)` : ""}
                              </small>
                            </div>
                            <div className="stack gap-xs align-end">
                              <span className={`risk-pill ${toneClass(item.risk)}`}>{item.risk}</span>
                              <strong>{formatBytes(item.sizeBytes)}</strong>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No findings match the current collection focus.</p>
                    )}
                  </section>
                </article>

                <details className="settings-advanced-panel cleanup-advanced-panel">
                  <summary>Detailed file list and advanced preview</summary>
                  <div className="stack">
                    <article className="card cleanup-preview-breakdown">
                      <header className="panel-header compact">
                        <h3>Preview Breakdown</h3>
                        <div className="row wrap">
                          <label>
                            Group by
                            <select value={cleanupGroupBy} onChange={(event) => onSetCleanupGroupBy(event.target.value as CleanupGroupBy)}>
                              <option value="category">Purpose / category</option>
                              <option value="folder">Folder</option>
                              <option value="extension">Extension / type</option>
                              <option value="risk">Risk level</option>
                            </select>
                          </label>
                          <label>
                            Scope
                            <select value={cleanupPreviewScope} onChange={(event) => onSetCleanupPreviewScope(event.target.value as "selected" | "all")}>
                              <option value="selected">Selected only</option>
                              <option value="all">All findings</option>
                            </select>
                          </label>
                        </div>
                      </header>

                      {!cleanupPreviewSourceFindings.length ? (
                        <p className="muted">Select findings to generate grouped preview insights.</p>
                      ) : (
                        <div className="group-grid cleanup-preview-groups">
                          {contextualPreviewGroups.map((group) => (
                            <article key={group.key} className="group-card">
                              <header>
                                <strong title={group.label}>{shortPath(group.label)}</strong>
                                <span>{formatBytes(group.totalBytes)}</span>
                              </header>
                              <p className="muted">
                                {group.count} items / high {group.highRisk} / medium {group.mediumRisk} / low {group.lowRisk}
                              </p>
                              <ul className="list compact">
                                {group.items.slice(0, 4).map((item) => (
                                  <li key={item.id}>
                                    <span title={item.path}>
                                      {shortPath(item.path)}
                                      {item.kind === "directory" ? ` (${item.entryCount ?? 0} items)` : ""}
                                    </span>
                                    <strong>{formatBytes(item.sizeBytes)}</strong>
                                  </li>
                                ))}
                              </ul>
                            </article>
                          ))}
                        </div>
                      )}
                    </article>

                    {cleanupErrorSummary.length > 0 && (
                      <article className="card cleanup-errors-card">
                        <header className="panel-header compact">
                          <h3>Common Execution Errors</h3>
                          <span className="muted">{cleanupResult?.failedCount ?? 0} failed item(s)</span>
                        </header>
                        <div className="group-grid">
                          {cleanupErrorSummary.slice(0, 6).map((entry) => (
                            <article key={entry.label} className="group-card">
                              <header>
                                <strong>{entry.label}</strong>
                                <span>{entry.count}</span>
                              </header>
                              <ul className="list compact">
                                {entry.examples.map((sample) => (
                                  <li key={sample}>
                                    <span title={sample}>{shortPath(sample)}</span>
                                  </li>
                                ))}
                              </ul>
                            </article>
                          ))}
                        </div>
                      </article>
                    )}

                    <article className="card cleanup-filelist-card">
                      <header className="panel-header compact">
                        <h3>Detailed Findings</h3>
                        <span className="muted">{visibleFindings.length}/{sortedFilteredFindings.length} visible</span>
                      </header>
                      <div className="table-wrap cleanup-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Select</th>
                              <th>Category</th>
                              <th>Risk</th>
                              <th>Source</th>
                              <th>Size</th>
                              <th>Path</th>
                              <th>Reason</th>
                              <th>Protect</th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleFindings.map((item) => (
                              <tr key={item.id}>
                                <td><input type="checkbox" checked={selectedFindingSet.has(item.id)} onChange={() => onToggleFinding(item.id)} /></td>
                                <td><span className={`category-chip ${categoryClass(item.category)}`}>{categoryLabelByValue[item.category]}</span></td>
                                <td><span className={`risk-pill ${toneClass(item.risk)}`}>{item.risk}</span></td>
                                <td>
                                  <div className="badge-row">
                                    {aiSuggestedFindingSet.has(item.id) && <span className="origin-pill origin-ai">AI</span>}
                                    {recommendedFindingSet.has(item.id) && <span className="origin-pill origin-recommended">Recommended</span>}
                                    {selectedFindingSet.has(item.id) && !aiSuggestedFindingSet.has(item.id) && !recommendedFindingSet.has(item.id) && (
                                      <span className="origin-pill origin-manual">Manual</span>
                                    )}
                                    {!selectedFindingSet.has(item.id) && !aiSuggestedFindingSet.has(item.id) && !recommendedFindingSet.has(item.id) && (
                                      <span className="origin-pill origin-neutral">None</span>
                                    )}
                                  </div>
                                </td>
                                <td>{formatBytes(item.sizeBytes)}</td>
                                <td title={item.path}>
                                  {shortPath(item.path)}
                                  {item.kind === "directory" ? ` (${item.entryCount ?? 0} items)` : ""}
                                </td>
                                <td>{item.reason}</td>
                                <td>
                                  <button className="btn secondary" onClick={() => onAddFindingPathToAllowlist(item.path)}>
                                    Allowlist Path
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {hasMoreFindings ? (
                        <div className="footer-actions">
                          <button className="btn secondary" onClick={onShowMoreFindings}>Show More Findings</button>
                        </div>
                      ) : null}
                    </article>
                  </div>
                </details>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
