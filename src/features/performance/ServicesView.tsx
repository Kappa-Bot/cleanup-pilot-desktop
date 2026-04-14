import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import {
  OptimizationActionSuggestion,
  OptimizationChangeRecord,
  OptimizationPreviewResponse,
  ServiceDiagnostic
} from "../../types";
import { useVirtualRows } from "./components/useVirtualRows";

type ServiceClassFilter = "all" | ServiceDiagnostic["classification"];
type ServiceStateFilter = "all" | ServiceDiagnostic["state"];
type ServiceBulkMode = "recommended" | "manual" | "disable";
type ServiceSortKey = "impact_desc" | "name_asc";
type HistoryStatusFilter = "all" | "active" | "restored";

interface ServicesViewPrefs {
  classFilter: ServiceClassFilter;
  stateFilter: ServiceStateFilter;
  sortKey: ServiceSortKey;
  bulkMode: ServiceBulkMode;
  actionableOnly: boolean;
  showEntries?: boolean;
  showHistory?: boolean;
  showSummary?: boolean;
  showFilters?: boolean;
  compactRows?: boolean;
  batchSize?: number;
}

const PAGE_SIZE = 80;
const SERVICES_PREFS_KEY = "cleanup-pilot.servicesViewPrefs.v3";

function shortPath(value?: string): string {
  if (!value) {
    return "-";
  }
  return value.length > 88 ? `...${value.slice(-85)}` : value;
}

function toneClass(value: ServiceDiagnostic["classification"]): string {
  if (value === "orphan") {
    return "tone-high";
  }
  if (value === "optional" || value === "unused") {
    return "tone-medium";
  }
  if (value === "essential") {
    return "tone-neutral";
  }
  return "tone-low";
}

function resolveAction(
  item: ServiceDiagnostic,
  mode: ServiceBulkMode
): OptimizationActionSuggestion["action"] | null {
  if (mode === "manual") {
    return "set_manual_start";
  }
  if (mode === "disable") {
    return "disable";
  }
  if (item.recommendedAction === "manual") {
    return "set_manual_start";
  }
  if (item.recommendedAction === "disable") {
    return "disable";
  }
  return null;
}

function buildAction(item: ServiceDiagnostic, mode: ServiceBulkMode): OptimizationActionSuggestion | null {
  const action = resolveAction(item, mode);
  if (!action) {
    return null;
  }
  const blockedByClass = item.classification === "essential";
  const blockedByState = action === "disable" ? item.startMode === "disabled" : item.startMode === "manual";
  const blocked = blockedByClass || blockedByState;
  return {
    id: `service-ui-${item.id}-${action}`,
    targetKind: "service",
    targetId: item.serviceName,
    action,
    title: action === "disable" ? `Disable ${item.displayName}` : `Set manual start for ${item.displayName}`,
    summary: [`Start ${item.startMode}`, `State ${item.state}`, ...item.reason].join(". "),
    risk: item.classification === "orphan" || item.classification === "unused" ? "low" : "medium",
    reversible: true,
    blocked,
    blockReason: blockedByClass
      ? "Windows/Microsoft service is inspect-only."
      : blockedByState
        ? action === "disable"
          ? "Service already disabled."
          : "Service already manual."
        : undefined,
    estimatedBenefitScore:
      item.classification === "orphan" ? 85 : item.classification === "unused" ? 72 : item.classification === "optional" ? 56 : 35
  };
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          if (!/[",\n]/.test(text)) {
            return text;
          }
          return `"${text.replace(/"/g, "\"\"")}"`;
        })
        .join(",")
    )
    .join("\r\n");
}

export function ServicesView() {
  const serviceItems = useAppStore((state) => state.serviceItems);
  const summary = useAppStore((state) => state.servicesSummary);
  const suggestedActions = useAppStore((state) => state.serviceActions);
  const loadServices = useAppStore((state) => state.loadServices);
  const loading = useAppStore((state) => state.servicesLoading);
  const servicesError = useAppStore((state) => state.servicesError);
  const servicesLastLoadedAt = useAppStore((state) => state.servicesLastLoadedAt);

  const [preview, setPreview] = useState<OptimizationPreviewResponse | null>(null);
  const [previewActions, setPreviewActions] = useState<OptimizationActionSuggestion[]>([]);
  const [previewLabel, setPreviewLabel] = useState("");
  const [executing, setExecuting] = useState(false);
  const [previewingId, setPreviewingId] = useState("");
  const [status, setStatus] = useState("");

  const [history, setHistory] = useState<OptimizationChangeRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringHistoryIds, setRestoringHistoryIds] = useState<string[]>([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLimit, setHistoryLimit] = useState(40);

  const [openingId, setOpeningId] = useState("");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState<ServiceClassFilter>("all");
  const [stateFilter, setStateFilter] = useState<ServiceStateFilter>("all");
  const [sortKey, setSortKey] = useState<ServiceSortKey>("impact_desc");
  const [bulkMode, setBulkMode] = useState<ServiceBulkMode>("recommended");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(PAGE_SIZE);
  const [showEntries, setShowEntries] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [compactRows, setCompactRows] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SERVICES_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ServicesViewPrefs>;
      if (parsed.classFilter) {
        setClassFilter(parsed.classFilter);
      }
      if (parsed.stateFilter) {
        setStateFilter(parsed.stateFilter);
      }
      if (parsed.sortKey) {
        setSortKey(parsed.sortKey);
      }
      if (parsed.bulkMode) {
        setBulkMode(parsed.bulkMode);
      }
      if (typeof parsed.actionableOnly === "boolean") {
        setActionableOnly(parsed.actionableOnly);
      }
      if (typeof parsed.showEntries === "boolean") {
        setShowEntries(parsed.showEntries);
      }
      if (typeof parsed.showHistory === "boolean") {
        setShowHistory(parsed.showHistory);
      }
      if (typeof parsed.showSummary === "boolean") {
        setShowSummary(parsed.showSummary);
      }
      if (typeof parsed.showFilters === "boolean") {
        setShowFilters(parsed.showFilters);
      }
      if (typeof parsed.compactRows === "boolean") {
        setCompactRows(parsed.compactRows);
      }
      if (
        typeof parsed.batchSize === "number" &&
        Number.isFinite(parsed.batchSize) &&
        parsed.batchSize >= 20 &&
        parsed.batchSize <= 300
      ) {
        setBatchSize(parsed.batchSize);
      }
    } catch {
      // Ignore invalid persisted preferences.
    }
  }, []);

  useEffect(() => {
    try {
      const payload: ServicesViewPrefs = {
        classFilter,
        stateFilter,
        sortKey,
        bulkMode,
        actionableOnly,
        showEntries,
        showHistory,
        showSummary,
        showFilters,
        compactRows,
        batchSize
      };
      window.localStorage.setItem(SERVICES_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write errors.
    }
  }, [actionableOnly, batchSize, bulkMode, classFilter, compactRows, showEntries, showFilters, showHistory, showSummary, sortKey, stateFilter]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await window.desktopApi.listOptimizationHistory(60);
      setHistory(response.changes.filter((item) => item.sourceEngine === "services"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load service history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (servicesLastLoadedAt === 0 && !loading && !servicesError) {
      void loadServices();
    }
  }, [loadServices, loading, servicesError, servicesLastLoadedAt]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const rows = serviceItems.filter((item) => {
      if (classFilter !== "all" && item.classification !== classFilter) {
        return false;
      }
      if (stateFilter !== "all" && item.state !== stateFilter) {
        return false;
      }
      if (actionableOnly) {
        const action = buildAction(item, bulkMode);
        if (!action || action.blocked) {
          return false;
        }
      }
      if (!q) {
        return true;
      }
      return `${item.displayName} ${item.serviceName} ${item.binaryPath ?? ""} ${item.reason.join(" ")}`.toLowerCase().includes(q);
    });
    return rows.sort((left, right) => {
      if (sortKey === "impact_desc") {
        const a = buildAction(left, bulkMode);
        const b = buildAction(right, bulkMode);
        return Number(b?.estimatedBenefitScore ?? 0) - Number(a?.estimatedBenefitScore ?? 0);
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }, [actionableOnly, bulkMode, classFilter, deferredQuery, serviceItems, sortKey, stateFilter]);

  const visible = useMemo(() => filtered.slice(0, renderLimit), [filtered, renderLimit]);
  const hasMore = visible.length < filtered.length;
  const serviceRowHeight = compactRows ? 34 : 44;
  const {
    viewportRef: servicesViewportRef,
    onScroll: onServicesTableScroll,
    startIndex: servicesStartIndex,
    endIndex: servicesEndIndex,
    padTop: servicesPadTop,
    padBottom: servicesPadBottom
  } = useVirtualRows({
    itemCount: visible.length,
    rowHeight: serviceRowHeight,
    overscan: 12,
    defaultViewportHeight: 560
  });
  const virtualVisibleServices = useMemo(
    () => visible.slice(servicesStartIndex, servicesEndIndex),
    [servicesEndIndex, servicesStartIndex, visible]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(() => filtered.filter((item) => selectedSet.has(item.id)), [filtered, selectedSet]);
  const selectedActionable = useMemo(
    () =>
      selectedRows.filter((item) => {
        const action = buildAction(item, bulkMode);
        return Boolean(action && !action.blocked);
      }).length,
    [bulkMode, selectedRows]
  );

  const selectedHistorySet = useMemo(() => new Set(selectedHistoryIds), [selectedHistoryIds]);
  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return history.filter((item) => {
      if (historyStatusFilter === "active" && item.revertedAt) {
        return false;
      }
      if (historyStatusFilter === "restored" && !item.revertedAt) {
        return false;
      }
      if (!q) {
        return true;
      }
      return `${item.action} ${item.targetId} ${item.sourceEngine}`.toLowerCase().includes(q);
    });
  }, [history, historyQuery, historyStatusFilter]);
  const activeHistory = useMemo(() => filteredHistory.filter((item) => !item.revertedAt), [filteredHistory]);
  const visibleHistory = useMemo(() => filteredHistory.slice(0, historyLimit), [filteredHistory, historyLimit]);
  const hasMoreHistory = visibleHistory.length < filteredHistory.length;
  const serviceHistoryRowHeight = compactRows ? 33 : 42;
  const {
    viewportRef: servicesHistoryViewportRef,
    onScroll: onServicesHistoryScroll,
    startIndex: servicesHistoryStart,
    endIndex: servicesHistoryEnd,
    padTop: servicesHistoryPadTop,
    padBottom: servicesHistoryPadBottom
  } = useVirtualRows({
    itemCount: visibleHistory.length,
    rowHeight: serviceHistoryRowHeight,
    overscan: 10,
    defaultViewportHeight: 420
  });
  const virtualVisibleServiceHistory = useMemo(
    () => visibleHistory.slice(servicesHistoryStart, servicesHistoryEnd),
    [servicesHistoryEnd, servicesHistoryStart, visibleHistory]
  );
  const hasServicesScan = servicesLastLoadedAt > 0;
  const servicesFiltersActive = deferredQuery.trim().length > 0 || classFilter !== "all" || stateFilter !== "all" || actionableOnly;
  const showServicesNoResults = hasServicesScan && !loading && !servicesError && serviceItems.length === 0;
  const showServicesFilterEmpty = hasServicesScan && !loading && !servicesError && serviceItems.length > 0 && visible.length === 0;

  useEffect(() => {
    setRenderLimit(batchSize);
  }, [actionableOnly, batchSize, bulkMode, classFilter, query, sortKey, stateFilter]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => serviceItems.some((item) => item.id === id)));
  }, [serviceItems]);

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => history.some((item) => item.id === id && !item.revertedAt)));
  }, [history]);

  useEffect(() => {
    setHistoryLimit(40);
  }, [historyStatusFilter, historyQuery]);

  const previewActionsByList = useCallback(async (actions: OptimizationActionSuggestion[], label: string) => {
    const actionable = actions.filter((item) => !item.blocked);
    if (!actionable.length) {
      setStatus("No reversible service actions available for this selection.");
      return;
    }
    setPreviewingId(label);
    try {
      const response = await window.desktopApi.previewOptimizations(actionable);
      setPreview(response);
      setPreviewActions(actionable);
      setPreviewLabel(label);
      setStatus(`Prepared preview for ${actionable.length} service action(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not build service preview.");
    } finally {
      setPreviewingId("");
    }
  }, []);

  const previewSelected = useCallback(async () => {
    if (!selectedRows.length) {
      setStatus("Select at least one service first.");
      return;
    }
    const actions = selectedRows
      .map((item) => buildAction(item, bulkMode))
      .filter((item): item is OptimizationActionSuggestion => Boolean(item));
    await previewActionsByList(actions, `services-${bulkMode}-selected`);
  }, [bulkMode, previewActionsByList, selectedRows]);

  const applyPreview = useCallback(async () => {
    if (!previewActions.length) {
      return;
    }
    setExecuting(true);
    try {
      const result = await window.desktopApi.executeOptimizations(previewActions);
      await Promise.all([loadServices(true), loadHistory()]);
      setPreview(null);
      setPreviewActions([]);
      setPreviewLabel("");
      setStatus(
        `Applied ${result.appliedCount} service change(s). ${result.failedCount ? `${result.failedCount} failed.` : ""}`.trim()
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not apply service changes.");
    } finally {
      setExecuting(false);
    }
  }, [loadHistory, loadServices, previewActions]);

  const restore = useCallback(async (changeId: string) => {
    if (restoringHistoryIds.includes(changeId)) {
      return;
    }
    setRestoringHistoryIds((current) => [...current, changeId]);
    try {
      const result = await window.desktopApi.restoreOptimizations([changeId]);
      await Promise.all([loadServices(true), loadHistory()]);
      setStatus(result.restoredCount ? "Service change restored." : `Restore failed (${result.failed.length}).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore service change.");
    } finally {
      setRestoringHistoryIds((current) => current.filter((id) => id !== changeId));
    }
  }, [loadHistory, loadServices, restoringHistoryIds]);

  const restoreSelectedHistory = useCallback(async () => {
    if (!selectedHistoryIds.length) {
      setStatus("No service history rows selected.");
      return;
    }
    setRestoringHistoryIds((current) => [...new Set([...current, ...selectedHistoryIds])]);
    try {
      const result = await window.desktopApi.restoreOptimizations(selectedHistoryIds);
      await Promise.all([loadServices(true), loadHistory()]);
      setSelectedHistoryIds([]);
      setStatus(
        result.restoredCount
          ? `Restored ${result.restoredCount} service change(s).`
          : `Service restore failed (${result.failed.length}).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore selected service changes.");
    } finally {
      setRestoringHistoryIds((current) => current.filter((id) => !selectedHistorySet.has(id)));
    }
  }, [loadHistory, loadServices, selectedHistoryIds, selectedHistorySet]);

  return (
    <div className="grid services-workbench">
      <article className="card services-summary-card">
        <header className="panel-header compact">
          <div>
            <h3>Services</h3>
            <p className="muted">{servicesLastLoadedAt ? `Last scan ${new Date(servicesLastLoadedAt).toLocaleTimeString()}` : "No scan yet"}</p>
          </div>
          <div className="row wrap">
            <button className="btn secondary" onClick={() => void loadServices(true)} disabled={loading}>
              {loading ? "Scanning..." : "Refresh"}
            </button>
            <button
              className="btn"
              onClick={() => void previewActionsByList(suggestedActions, "services-suggested")}
              disabled={!suggestedActions.length || previewingId === "services-suggested"}
            >
              {previewingId === "services-suggested" ? "Preparing..." : "Preview Suggested"}
            </button>
          </div>
        </header>
        {showSummary && summary ? (
          <div className="performance-card-grid">
            <article className="mini-card"><small>Total</small><strong>{summary.total}</strong></article>
            <article className="mini-card"><small>Optional</small><strong>{summary.optionalCount}</strong></article>
            <article className="mini-card"><small>Unused</small><strong>{summary.unusedCount}</strong></article>
            <article className="mini-card"><small>Orphan</small><strong>{summary.orphanCount}</strong></article>
            <article className="mini-card"><small>Suggested</small><strong>{summary.suggestedActionCount}</strong></article>
          </div>
        ) : (
          <div className="performance-empty-state performance-empty-state--compact">
            <strong>{loading ? "Scanning services..." : hasServicesScan ? "Service scan completed." : "Service scan is ready."}</strong>
            <p className="muted">
              {loading
                ? "Collecting services, startup modes and reversible recommendations."
                : hasServicesScan
                  ? "No aggregate service summary is available for the latest scan."
                  : "Run the service scan to review third-party background services and safe start-mode changes."}
            </p>
          </div>
        )}
        {servicesError ? <div className="callout"><strong>Service scan</strong><span>{servicesError}</span></div> : null}
        {status ? <div className="callout"><strong>Service workflow</strong><span>{status}</span></div> : null}
        {showServicesNoResults ? (
          <div className="performance-empty-state performance-empty-state--compact">
            <strong>No services were returned.</strong>
            <p className="muted">
              The service scan completed but produced zero diagnostics rows for this machine.
            </p>
          </div>
        ) : null}
      </article>

      <div className="row wrap">
        <button className="btn secondary tiny" onClick={() => setShowSummary((current) => !current)}>
          {showSummary ? "Hide Summary" : "Show Summary"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowFilters((current) => !current)}>
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowEntries((current) => !current)}>
          {showEntries ? "Hide Service Entries" : "Show Service Entries"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowHistory((current) => !current)}>
          {showHistory ? "Hide Service History" : "Show Service History"}
        </button>
        <button className="btn secondary tiny" onClick={() => setCompactRows((current) => !current)}>
          {compactRows ? "Comfort Rows" : "Compact Rows"}
        </button>
      </div>

      {preview ? (
        <article className="card full services-preview-card">
          <div className="panel-header compact">
            <h3>Pending Service Changes</h3>
            <div className="row wrap">
              <button
                className="btn secondary"
                onClick={() => {
                  setPreview(null);
                  setPreviewActions([]);
                  setPreviewLabel("");
                }}
              >
                Clear Preview
              </button>
              <button className="btn" onClick={() => void applyPreview()} disabled={executing || !previewActions.length}>
                {executing ? "Applying..." : `Apply ${preview.actions.length}`}
              </button>
            </div>
          </div>
          <p className="muted">
            Scope {previewLabel} - Startup savings {preview.estimatedStartupSavingsMs} ms - CPU savings{" "}
            {preview.estimatedBackgroundCpuSavingsPct === undefined ? "-" : `${preview.estimatedBackgroundCpuSavingsPct}%`}
          </p>
          {!!preview.warnings.length ? (
            <ul className="list compact">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}

      {showEntries ? (
        <article className="card full services-table-card">
        <div className="panel-header compact">
          <h3>Service Entries</h3>
          <span className="muted">{filtered.length}/{serviceItems.length} visible</span>
        </div>
        {showFilters ? (
          <div className="services-filter-row sticky-action-row">
            <div className="services-filter-grid">
              <label>
                Search
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="service, path..." />
              </label>
              <label>
                Classification
                <select value={classFilter} onChange={(event) => setClassFilter(event.target.value as ServiceClassFilter)}>
                  <option value="all">All</option>
                  <option value="essential">Essential</option>
                  <option value="optional">Optional</option>
                  <option value="rarely_used">Rarely used</option>
                  <option value="unused">Unused</option>
                  <option value="orphan">Orphan</option>
                </select>
              </label>
              <label>
                State
                <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as ServiceStateFilter)}>
                  <option value="all">All</option>
                  <option value="running">Running</option>
                  <option value="stopped">Stopped</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>
                Sort
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as ServiceSortKey)}>
                  <option value="impact_desc">Impact</option>
                  <option value="name_asc">Name</option>
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={actionableOnly} onChange={(event) => setActionableOnly(event.target.checked)} />
                Actionable only
              </label>
              <label>
                Batch size
                <select value={batchSize} onChange={(event) => setBatchSize(Math.max(20, Number(event.target.value) || PAGE_SIZE))}>
                  <option value={40}>40</option>
                  <option value={80}>80</option>
                  <option value={120}>120</option>
                  <option value={160}>160</option>
                </select>
              </label>
            </div>
            <div className="row wrap">
            <button className="btn secondary" onClick={() => setSelectedIds(visible.map((item) => item.id))} disabled={!visible.length}>
              Select Visible
            </button>
            <button
              className="btn secondary"
              onClick={() =>
                setSelectedIds(
                  visible
                    .filter((item) => {
                      const action = buildAction(item, bulkMode);
                      return Boolean(action && !action.blocked);
                    })
                    .map((item) => item.id)
                )
              }
              disabled={!visible.length}
            >
              Select Actionable
            </button>
            <button className="btn secondary" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>
              Clear
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                if (!selectedRows.length) {
                  setStatus("No selected services to copy.");
                  return;
                }
                const text = selectedRows.map((item) => `${item.displayName}\t${item.serviceName}`).join("\n");
                void navigator.clipboard.writeText(text).then(() => setStatus(`Copied ${selectedRows.length} services.`));
              }}
              disabled={!selectedRows.length}
            >
              Copy
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                const rows = [
                  ["displayName", "serviceName", "startMode", "state", "classification", "recommendedAction", "binaryPath"],
                  ...filtered.map((item) => [
                    item.displayName,
                    item.serviceName,
                    item.startMode,
                    item.state,
                    item.classification,
                    item.recommendedAction,
                    item.binaryPath ?? ""
                  ])
                ];
                const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `cleanup-pilot-services-${Date.now()}.csv`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                setStatus(`Exported ${filtered.length} service entries.`);
              }}
              disabled={!filtered.length}
            >
              Export CSV
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setQuery("");
                setClassFilter("all");
                setStateFilter("all");
                setSortKey("impact_desc");
                setActionableOnly(false);
                setBatchSize(PAGE_SIZE);
                setStatus("Service filters reset.");
              }}
            >
              Reset Filters
            </button>
            <label className="startup-action-mode">
              Bulk action
              <select value={bulkMode} onChange={(event) => setBulkMode(event.target.value as ServiceBulkMode)}>
                <option value="recommended">Recommended</option>
                <option value="manual">Set manual</option>
                <option value="disable">Disable</option>
              </select>
            </label>
            <button className="btn" onClick={() => void previewSelected()} disabled={!selectedRows.length}>
              Preview Selected ({selectedActionable}/{selectedRows.length})
            </button>
            </div>
          </div>
        ) : null}

        {visible.length ? (
          <div className="table-wrap" ref={servicesViewportRef} onScroll={onServicesTableScroll} style={{ height: 560, overflowY: "auto" }}>
            <table className={compactRows ? "table table-compact" : "table"}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Name</th>
                <th>Start</th>
                <th>State</th>
                <th>Class</th>
                <th>Recommendation</th>
                <th>Binary</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {servicesPadTop > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={8} style={{ height: servicesPadTop, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {virtualVisibleServices.map((item) => {
                const action = buildAction(item, bulkMode);
                return (
                  <tr key={item.id}>
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(item.id)}
                          onChange={() => {
                            setSelectedIds((current) =>
                              current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
                            );
                          }}
                        />
                      </label>
                    </td>
                    <td title={item.serviceName}>{item.displayName}</td>
                    <td>{item.startMode}</td>
                    <td>{item.state}</td>
                    <td>
                      <span className={`risk-pill ${toneClass(item.classification)}`}>{item.classification.replace(/_/g, " ")}</span>
                    </td>
                    <td>{item.recommendedAction}</td>
                    <td title={item.binaryPath}>{shortPath(item.binaryPath)}</td>
                    <td>
                      <div className="row wrap">
                        <button
                          className="btn secondary tiny"
                          onClick={() => {
                            setOpeningId(item.id);
                            void window.desktopApi
                              .openStartupEntryLocation({
                                source: "service",
                                targetPath: item.binaryPath,
                                originLocation: item.binaryPath
                              })
                              .then((result) => {
                                setStatus(result.opened ? `Opened ${item.displayName}.` : `Open failed for ${item.displayName}.`);
                              })
                              .finally(() => setOpeningId(""));
                          }}
                          disabled={openingId === item.id}
                        >
                          {openingId === item.id ? "Opening..." : "Open"}
                        </button>
                        <button
                          className="btn secondary tiny"
                          onClick={() =>
                            void previewActionsByList(
                              [action].filter((v): v is OptimizationActionSuggestion => Boolean(v)),
                              `${item.id}-single`
                            )
                          }
                          disabled={!action || action.blocked || previewingId === `${item.id}-single`}
                          title={action?.blockReason}
                        >
                          Preview
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {servicesPadBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={8} style={{ height: servicesPadBottom, padding: 0, border: 0 }} />
                </tr>
              ) : null}
            </tbody>
            </table>
          </div>
        ) : showServicesNoResults ? (
          <div className="performance-empty-state">
            <strong>No services detected.</strong>
            <p className="muted">
              The scan completed successfully, but no service rows were returned.
            </p>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => void loadServices(true)} disabled={loading}>
                Refresh Services
              </button>
            </div>
          </div>
        ) : showServicesFilterEmpty ? (
          <div className="performance-empty-state">
            <strong>No services match the current filters.</strong>
            <p className="muted">Clear the search or classification filters to restore visible service rows.</p>
            <div className="row wrap">
              <button
                className="btn secondary"
                onClick={() => {
                  setQuery("");
                  setClassFilter("all");
                  setStateFilter("all");
                  setSortKey("impact_desc");
                  setActionableOnly(false);
                }}
                disabled={!servicesFiltersActive}
              >
                Reset Filters
              </button>
            </div>
          </div>
        ) : servicesError ? (
          <div className="performance-empty-state">
            <strong>Service scan failed.</strong>
            <p className="muted">{servicesError}</p>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => void loadServices(true)} disabled={loading}>
                Retry Service Scan
              </button>
            </div>
          </div>
        ) : null}
        {hasMore ? (
          <div className="footer-actions">
            <button className="btn secondary" onClick={() => setRenderLimit((current) => current + batchSize)}>
              Show More Services
            </button>
          </div>
        ) : null}
        </article>
      ) : null}

      {showHistory ? (
        <article className="card full services-history-card">
        <div className="panel-header compact">
          <h3>Recent Service Changes</h3>
          <div className="row wrap">
            <button className="btn secondary" onClick={() => void loadHistory()} disabled={historyLoading}>
              {historyLoading ? "Refreshing..." : "Refresh History"}
            </button>
            <button
              className="btn secondary"
              onClick={() => setSelectedHistoryIds(activeHistory.map((item) => item.id))}
              disabled={!activeHistory.length}
            >
              Select Active
            </button>
            <button className="btn secondary" onClick={() => setSelectedHistoryIds([])} disabled={!selectedHistoryIds.length}>
              Clear
            </button>
            <button className="btn" onClick={() => void restoreSelectedHistory()} disabled={!selectedHistoryIds.length}>
              Restore Selected ({selectedHistoryIds.length})
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                if (!selectedHistoryIds.length) {
                  setStatus("No selected service change IDs.");
                  return;
                }
                void navigator.clipboard.writeText(selectedHistoryIds.join("\n")).then(() => {
                  setStatus(`Copied ${selectedHistoryIds.length} service change ID(s).`);
                });
              }}
              disabled={!selectedHistoryIds.length}
            >
              Copy Selected IDs
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                if (!filteredHistory.length) {
                  setStatus("No service history rows to export.");
                  return;
                }
                const rows = [
                  ["id", "action", "targetId", "createdAt", "appliedAt", "revertedAt"],
                  ...filteredHistory.map((item) => [
                    item.id,
                    item.action,
                    item.targetId,
                    new Date(item.createdAt).toISOString(),
                    item.appliedAt ? new Date(item.appliedAt).toISOString() : "",
                    item.revertedAt ? new Date(item.revertedAt).toISOString() : ""
                  ])
                ];
                const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `cleanup-pilot-services-history-${Date.now()}.csv`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                setStatus(`Exported ${filteredHistory.length} service history rows.`);
              }}
              disabled={!filteredHistory.length}
            >
              Export History CSV
            </button>
          </div>
        </div>
        <div className="services-filter-row">
          <div className="services-filter-grid">
            <label>
              Status
              <select value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value as HistoryStatusFilter)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="restored">Restored</option>
              </select>
            </label>
            <label>
              Search history
              <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="target, action..." />
            </label>
          </div>
          <span className="muted">{visibleHistory.length}/{filteredHistory.length} visible</span>
        </div>
        {filteredHistory.length ? (
          <div className="table-wrap" ref={servicesHistoryViewportRef} onScroll={onServicesHistoryScroll} style={{ height: 420, overflowY: "auto" }}>
            <table className={compactRows ? "table table-compact" : "table"}>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Applied</th>
                  <th>Status</th>
                  <th>Restore</th>
                </tr>
              </thead>
              <tbody>
                {servicesHistoryPadTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={6} style={{ height: servicesHistoryPadTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualVisibleServiceHistory.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedHistorySet.has(item.id)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedHistoryIds((current) => [...new Set([...current, item.id])]);
                              return;
                            }
                            setSelectedHistoryIds((current) => current.filter((id) => id !== item.id));
                          }}
                          disabled={Boolean(item.revertedAt)}
                        />
                      </label>
                    </td>
                    <td>{item.action}</td>
                    <td title={item.targetId}>{shortPath(item.targetId)}</td>
                    <td>{item.appliedAt ? new Date(item.appliedAt).toLocaleString() : "-"}</td>
                    <td>{item.revertedAt ? "restored" : "active"}</td>
                    <td>
                      <button
                        className="btn secondary"
                        onClick={() => void restore(item.id)}
                        disabled={Boolean(item.revertedAt) || restoringHistoryIds.includes(item.id)}
                      >
                        {restoringHistoryIds.includes(item.id) ? "Restoring..." : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
                {servicesHistoryPadBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={6} style={{ height: servicesHistoryPadBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No service history rows match current filters.</p>
        )}
        {hasMoreHistory ? (
          <div className="footer-actions">
            <button className="btn secondary" onClick={() => setHistoryLimit((current) => current + 40)}>
              Show More History
            </button>
          </div>
        ) : null}
        </article>
      ) : null}
    </div>
  );
}
