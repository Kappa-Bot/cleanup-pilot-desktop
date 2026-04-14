import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import {
  OptimizationActionSuggestion,
  OptimizationChangeRecord,
  OptimizationPreviewResponse,
  ScheduledTaskDiagnostic
} from "../../types";
import { useVirtualRows } from "./components/useVirtualRows";

type TaskClassFilter = "all" | ScheduledTaskDiagnostic["classification"];
type TaskStateFilter = "all" | ScheduledTaskDiagnostic["state"];
type TaskSortKey = "impact_desc" | "name_asc";
type TaskBulkMode = "recommended" | "disable";
type HistoryStatusFilter = "all" | "active" | "restored";

interface TasksViewPrefs {
  classFilter: TaskClassFilter;
  stateFilter: TaskStateFilter;
  frequentOnly: boolean;
  sortKey: TaskSortKey;
  bulkMode: TaskBulkMode;
  actionableOnly: boolean;
  showEntries?: boolean;
  showHistory?: boolean;
  showSummary?: boolean;
  showFilters?: boolean;
  compactRows?: boolean;
  batchSize?: number;
}

const PAGE_SIZE = 80;
const TASKS_PREFS_KEY = "cleanup-pilot.tasksViewPrefs.v3";

function toneClass(value: ScheduledTaskDiagnostic["classification"]): string {
  if (value === "orphan") {
    return "tone-high";
  }
  if (value === "suspicious") {
    return "tone-medium";
  }
  if (value === "inspect_only") {
    return "tone-neutral";
  }
  return "tone-low";
}

function isFrequent(triggerSummary: string[]): boolean {
  const text = triggerSummary.join(" ").toLowerCase();
  return text.includes("pt1m") || text.includes("pt5m") || text.includes("minute") || text.includes("every 1");
}

function resolveAction(
  item: ScheduledTaskDiagnostic,
  mode: TaskBulkMode
): OptimizationActionSuggestion["action"] | null {
  if (mode === "disable") {
    return "disable";
  }
  if (item.recommendedAction === "disable") {
    return "disable";
  }
  return null;
}

function buildAction(item: ScheduledTaskDiagnostic, mode: TaskBulkMode): OptimizationActionSuggestion | null {
  const action = resolveAction(item, mode);
  if (!action) {
    return null;
  }
  const blockedByClass = item.classification === "inspect_only";
  const blockedByState = item.state !== "enabled";
  const blocked = blockedByClass || blockedByState;
  return {
    id: `tasks-ui-${item.id}-${action}`,
    targetKind: "scheduled_task",
    targetId: item.taskPath,
    action,
    title: `Disable ${item.taskPath}`,
    summary: [`State ${item.state}`, ...item.reason, ...item.triggerSummary].join(". "),
    risk: item.classification === "orphan" ? "low" : "medium",
    reversible: true,
    blocked,
    blockReason: blockedByClass
      ? "Microsoft core task is inspect-only."
      : blockedByState
        ? "Task is already disabled."
        : undefined,
    estimatedBenefitScore: item.classification === "orphan" ? 82 : item.classification === "suspicious" ? 70 : 52
  };
}

function shortPath(value: string): string {
  return value.length > 92 ? `...${value.slice(-89)}` : value;
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          if (!/[",\n]/.test(text)) {
            return text;
          }
          return `"${text.replace(/"/g, "\"\"")}"`;
        })
        .join(",")
    )
    .join("\r\n");
}

export function TasksView() {
  const taskItems = useAppStore((state) => state.taskItems);
  const summary = useAppStore((state) => state.tasksSummary);
  const suggestedActions = useAppStore((state) => state.taskActions);
  const loadTasks = useAppStore((state) => state.loadTasks);
  const loading = useAppStore((state) => state.tasksLoading);
  const tasksError = useAppStore((state) => state.tasksError);
  const tasksLastLoadedAt = useAppStore((state) => state.tasksLastLoadedAt);

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
  const [classFilter, setClassFilter] = useState<TaskClassFilter>("all");
  const [stateFilter, setStateFilter] = useState<TaskStateFilter>("all");
  const [frequentOnly, setFrequentOnly] = useState(false);
  const [sortKey, setSortKey] = useState<TaskSortKey>("impact_desc");
  const [bulkMode, setBulkMode] = useState<TaskBulkMode>("recommended");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);
  const [batchSize, setBatchSize] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showEntries, setShowEntries] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [compactRows, setCompactRows] = useState(false);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TASKS_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<TasksViewPrefs>;
      if (parsed.classFilter) {
        setClassFilter(parsed.classFilter);
      }
      if (parsed.stateFilter) {
        setStateFilter(parsed.stateFilter);
      }
      if (typeof parsed.frequentOnly === "boolean") {
        setFrequentOnly(parsed.frequentOnly);
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
      const payload: TasksViewPrefs = {
        classFilter,
        stateFilter,
        frequentOnly,
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
      window.localStorage.setItem(TASKS_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write errors.
    }
  }, [actionableOnly, batchSize, bulkMode, classFilter, compactRows, frequentOnly, showEntries, showFilters, showHistory, showSummary, sortKey, stateFilter]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await window.desktopApi.listOptimizationHistory(60);
      setHistory(response.changes.filter((item) => item.sourceEngine === "tasks"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load task history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tasksLastLoadedAt === 0 && !loading && !tasksError) {
      void loadTasks();
    }
  }, [loadTasks, loading, tasksError, tasksLastLoadedAt]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const rows = taskItems.filter((item) => {
      if (classFilter !== "all" && item.classification !== classFilter) {
        return false;
      }
      if (stateFilter !== "all" && item.state !== stateFilter) {
        return false;
      }
      if (frequentOnly && !isFrequent(item.triggerSummary)) {
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
      return `${item.taskPath} ${item.reason.join(" ")} ${item.triggerSummary.join(" ")}`.toLowerCase().includes(q);
    });
    return rows.sort((left, right) => {
      if (sortKey === "impact_desc") {
        const a = buildAction(left, bulkMode);
        const b = buildAction(right, bulkMode);
        return Number(b?.estimatedBenefitScore ?? 0) - Number(a?.estimatedBenefitScore ?? 0);
      }
      return left.taskPath.localeCompare(right.taskPath);
    });
  }, [actionableOnly, bulkMode, classFilter, deferredQuery, frequentOnly, sortKey, stateFilter, taskItems]);

  const visible = useMemo(() => filtered.slice(0, renderLimit), [filtered, renderLimit]);
  const hasMore = visible.length < filtered.length;
  const taskRowHeight = compactRows ? 34 : 44;
  const {
    viewportRef: tasksViewportRef,
    onScroll: onTasksTableScroll,
    startIndex: tasksStartIndex,
    endIndex: tasksEndIndex,
    padTop: tasksPadTop,
    padBottom: tasksPadBottom
  } = useVirtualRows({
    itemCount: visible.length,
    rowHeight: taskRowHeight,
    overscan: 12,
    defaultViewportHeight: 560
  });
  const virtualVisibleTasks = useMemo(
    () => visible.slice(tasksStartIndex, tasksEndIndex),
    [tasksEndIndex, tasksStartIndex, visible]
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
  const taskHistoryRowHeight = compactRows ? 33 : 42;
  const {
    viewportRef: tasksHistoryViewportRef,
    onScroll: onTasksHistoryScroll,
    startIndex: tasksHistoryStart,
    endIndex: tasksHistoryEnd,
    padTop: tasksHistoryPadTop,
    padBottom: tasksHistoryPadBottom
  } = useVirtualRows({
    itemCount: visibleHistory.length,
    rowHeight: taskHistoryRowHeight,
    overscan: 10,
    defaultViewportHeight: 420
  });
  const virtualVisibleTaskHistory = useMemo(
    () => visibleHistory.slice(tasksHistoryStart, tasksHistoryEnd),
    [tasksHistoryEnd, tasksHistoryStart, visibleHistory]
  );
  const hasTasksScan = tasksLastLoadedAt > 0;
  const tasksFiltersActive =
    deferredQuery.trim().length > 0 || classFilter !== "all" || stateFilter !== "all" || frequentOnly || actionableOnly;
  const showTasksNoResults = hasTasksScan && !loading && !tasksError && taskItems.length === 0;
  const showTasksFilterEmpty = hasTasksScan && !loading && !tasksError && taskItems.length > 0 && visible.length === 0;

  useEffect(() => {
    setRenderLimit(batchSize);
  }, [actionableOnly, batchSize, bulkMode, classFilter, frequentOnly, query, sortKey, stateFilter]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => taskItems.some((item) => item.id === id)));
  }, [taskItems]);

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => history.some((item) => item.id === id && !item.revertedAt)));
  }, [history]);

  useEffect(() => {
    setHistoryLimit(40);
  }, [historyStatusFilter, historyQuery]);

  const previewActionsByList = useCallback(async (actions: OptimizationActionSuggestion[], label: string) => {
    const actionable = actions.filter((item) => !item.blocked);
    if (!actionable.length) {
      setStatus("No reversible task actions available for this selection.");
      return;
    }
    setPreviewingId(label);
    try {
      const response = await window.desktopApi.previewOptimizations(actionable);
      setPreview(response);
      setPreviewActions(actionable);
      setPreviewLabel(label);
      setStatus(`Prepared preview for ${actionable.length} task action(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not build task preview.");
    } finally {
      setPreviewingId("");
    }
  }, []);

  const previewSelected = useCallback(async () => {
    if (!selectedRows.length) {
      setStatus("Select at least one task first.");
      return;
    }
    const actions = selectedRows
      .map((item) => buildAction(item, bulkMode))
      .filter((item): item is OptimizationActionSuggestion => Boolean(item));
    await previewActionsByList(actions, `tasks-${bulkMode}-selected`);
  }, [bulkMode, previewActionsByList, selectedRows]);

  const applyPreview = useCallback(async () => {
    if (!previewActions.length) {
      return;
    }
    setExecuting(true);
    try {
      const result = await window.desktopApi.executeOptimizations(previewActions);
      await Promise.all([loadTasks(true), loadHistory()]);
      setPreview(null);
      setPreviewActions([]);
      setPreviewLabel("");
      setStatus(`Applied ${result.appliedCount} task change(s). ${result.failedCount ? `${result.failedCount} failed.` : ""}`.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not apply task changes.");
    } finally {
      setExecuting(false);
    }
  }, [loadHistory, loadTasks, previewActions]);

  const restore = useCallback(async (changeId: string) => {
    if (restoringHistoryIds.includes(changeId)) {
      return;
    }
    setRestoringHistoryIds((current) => [...current, changeId]);
    try {
      const result = await window.desktopApi.restoreOptimizations([changeId]);
      await Promise.all([loadTasks(true), loadHistory()]);
      setStatus(result.restoredCount ? "Task change restored." : `Restore failed (${result.failed.length}).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore task change.");
    } finally {
      setRestoringHistoryIds((current) => current.filter((id) => id !== changeId));
    }
  }, [loadHistory, loadTasks, restoringHistoryIds]);

  const restoreSelectedHistory = useCallback(async () => {
    if (!selectedHistoryIds.length) {
      setStatus("No task history rows selected.");
      return;
    }
    setRestoringHistoryIds((current) => [...new Set([...current, ...selectedHistoryIds])]);
    try {
      const result = await window.desktopApi.restoreOptimizations(selectedHistoryIds);
      await Promise.all([loadTasks(true), loadHistory()]);
      setSelectedHistoryIds([]);
      setStatus(
        result.restoredCount
          ? `Restored ${result.restoredCount} task change(s).`
          : `Task restore failed (${result.failed.length}).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore selected task changes.");
    } finally {
      setRestoringHistoryIds((current) => current.filter((id) => !selectedHistorySet.has(id)));
    }
  }, [loadHistory, loadTasks, selectedHistoryIds, selectedHistorySet]);

  return (
    <div className="grid tasks-workbench">
      <article className="card tasks-summary-card">
        <header className="panel-header compact">
          <div>
            <h3>Scheduled Tasks</h3>
            <p className="muted">{tasksLastLoadedAt ? `Last scan ${new Date(tasksLastLoadedAt).toLocaleTimeString()}` : "No scan yet"}</p>
          </div>
          <div className="row wrap">
            <button className="btn secondary" onClick={() => void loadTasks(true)} disabled={loading}>
              {loading ? "Scanning..." : "Refresh"}
            </button>
            <button
              className="btn"
              onClick={() => void previewActionsByList(suggestedActions, "tasks-suggested")}
              disabled={!suggestedActions.length || previewingId === "tasks-suggested"}
            >
              {previewingId === "tasks-suggested" ? "Preparing..." : "Preview Suggested"}
            </button>
          </div>
        </header>
        {showSummary && summary ? (
          <div className="performance-card-grid">
            <article className="mini-card"><small>Total</small><strong>{summary.total}</strong></article>
            <article className="mini-card"><small>Frequent</small><strong>{summary.frequentCount}</strong></article>
            <article className="mini-card"><small>Suspicious</small><strong>{summary.suspiciousCount}</strong></article>
            <article className="mini-card"><small>Orphan</small><strong>{summary.orphanCount}</strong></article>
            <article className="mini-card"><small>Inspect only</small><strong>{summary.inspectOnlyCount}</strong></article>
          </div>
        ) : (
          <div className="performance-empty-state performance-empty-state--compact">
            <strong>{loading ? "Scanning scheduled tasks..." : hasTasksScan ? "Task scan completed." : "Task scan is ready."}</strong>
            <p className="muted">
              {loading
                ? "Collecting scheduled tasks, trigger frequencies and reversible disable recommendations."
                : hasTasksScan
                  ? "No aggregate task summary is available for the latest scan."
                  : "Run the task scan to review frequent, suspicious or orphan scheduled tasks."}
            </p>
          </div>
        )}
        {tasksError ? <div className="callout"><strong>Task scan</strong><span>{tasksError}</span></div> : null}
        {status ? <div className="callout"><strong>Task workflow</strong><span>{status}</span></div> : null}
        {showTasksNoResults ? (
          <div className="performance-empty-state performance-empty-state--compact">
            <strong>No scheduled tasks were returned.</strong>
            <p className="muted">
              The task scan completed but produced zero diagnostics rows for this machine.
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
          {showEntries ? "Hide Task Entries" : "Show Task Entries"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowHistory((current) => !current)}>
          {showHistory ? "Hide Task History" : "Show Task History"}
        </button>
        <button className="btn secondary tiny" onClick={() => setCompactRows((current) => !current)}>
          {compactRows ? "Comfort Rows" : "Compact Rows"}
        </button>
      </div>

      {preview ? (
        <article className="card full tasks-preview-card">
          <div className="panel-header compact">
            <h3>Pending Task Changes</h3>
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
          <p className="muted">Scope {previewLabel} - Estimated startup savings {preview.estimatedStartupSavingsMs} ms</p>
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
        <article className="card full tasks-table-card">
        <div className="panel-header compact">
          <h3>Task Entries</h3>
          <span className="muted">{filtered.length}/{taskItems.length} visible</span>
        </div>
        {showFilters ? (
          <div className="tasks-filter-row sticky-action-row">
            <div className="tasks-filter-grid">
            <label>
              Search
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="task, trigger, reason..." />
            </label>
            <label>
              Classification
              <select value={classFilter} onChange={(event) => setClassFilter(event.target.value as TaskClassFilter)}>
                <option value="all">All</option>
                <option value="safe">Safe</option>
                <option value="optional">Optional</option>
                <option value="suspicious">Suspicious</option>
                <option value="orphan">Orphan</option>
                <option value="inspect_only">Inspect only</option>
              </select>
            </label>
            <label>
              State
              <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as TaskStateFilter)}>
                <option value="all">All</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>
              Sort
              <select value={sortKey} onChange={(event) => setSortKey(event.target.value as TaskSortKey)}>
                <option value="impact_desc">Impact</option>
                <option value="name_asc">Name</option>
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={frequentOnly} onChange={(event) => setFrequentOnly(event.target.checked)} />
              Frequent only
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
                  setStatus("No selected tasks to copy.");
                  return;
                }
                const text = selectedRows.map((item) => item.taskPath).join("\n");
                void navigator.clipboard.writeText(text).then(() => setStatus(`Copied ${selectedRows.length} tasks.`));
              }}
              disabled={!selectedRows.length}
            >
              Copy
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                const rows = [
                  ["taskPath", "state", "classification", "recommendedAction", "triggers"],
                  ...filtered.map((item) => [
                    item.taskPath,
                    item.state,
                    item.classification,
                    item.recommendedAction,
                    item.triggerSummary.join(" | ")
                  ])
                ];
                const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `cleanup-pilot-tasks-${Date.now()}.csv`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                setStatus(`Exported ${filtered.length} task entries.`);
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
                setFrequentOnly(false);
                setSortKey("impact_desc");
                setActionableOnly(false);
                setBatchSize(PAGE_SIZE);
                setStatus("Task filters reset.");
              }}
            >
              Reset Filters
            </button>
            <label className="startup-action-mode">
              Bulk action
              <select value={bulkMode} onChange={(event) => setBulkMode(event.target.value as TaskBulkMode)}>
                <option value="recommended">Recommended</option>
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
          <div className="table-wrap" ref={tasksViewportRef} onScroll={onTasksTableScroll} style={{ height: 560, overflowY: "auto" }}>
            <table className={compactRows ? "table table-compact" : "table"}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Task</th>
                <th>State</th>
                <th>Class</th>
                <th>Recommendation</th>
                <th>Triggers</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasksPadTop > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={7} style={{ height: tasksPadTop, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {virtualVisibleTasks.map((item) => {
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
                    <td title={item.taskPath}>{shortPath(item.taskPath)}</td>
                    <td>{item.state}</td>
                    <td>
                      <span className={`risk-pill ${toneClass(item.classification)}`}>{item.classification.replace(/_/g, " ")}</span>
                    </td>
                    <td>{item.recommendedAction}</td>
                    <td title={item.triggerSummary.join("; ")}>{shortPath(item.triggerSummary.join(" | ") || "N/A")}</td>
                    <td>
                      <div className="row wrap">
                        <button
                          className="btn secondary tiny"
                          onClick={() => {
                            setOpeningId(item.id);
                            void window.desktopApi
                              .openStartupEntryLocation({
                                source: "scheduled_task",
                                originLocation: item.taskPath
                              })
                              .then((result) => {
                                setStatus(
                                  result.opened
                                    ? `Opened Task Scheduler for ${item.taskPath}.`
                                    : `Open failed for ${item.taskPath}.`
                                );
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
              {tasksPadBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={7} style={{ height: tasksPadBottom, padding: 0, border: 0 }} />
                </tr>
              ) : null}
            </tbody>
            </table>
          </div>
        ) : showTasksNoResults ? (
          <div className="performance-empty-state">
            <strong>No tasks detected.</strong>
            <p className="muted">
              The scan completed successfully, but no scheduled-task rows were returned.
            </p>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => void loadTasks(true)} disabled={loading}>
                Refresh Tasks
              </button>
            </div>
          </div>
        ) : showTasksFilterEmpty ? (
          <div className="performance-empty-state">
            <strong>No tasks match the current filters.</strong>
            <p className="muted">Clear search or task filters to restore visible rows.</p>
            <div className="row wrap">
              <button
                className="btn secondary"
                onClick={() => {
                  setQuery("");
                  setClassFilter("all");
                  setStateFilter("all");
                  setFrequentOnly(false);
                  setSortKey("impact_desc");
                  setActionableOnly(false);
                }}
                disabled={!tasksFiltersActive}
              >
                Reset Filters
              </button>
            </div>
          </div>
        ) : tasksError ? (
          <div className="performance-empty-state">
            <strong>Task scan failed.</strong>
            <p className="muted">{tasksError}</p>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => void loadTasks(true)} disabled={loading}>
                Retry Task Scan
              </button>
            </div>
          </div>
        ) : null}
        {hasMore ? (
          <div className="footer-actions">
            <button className="btn secondary" onClick={() => setRenderLimit((current) => current + batchSize)}>
              Show More Tasks
            </button>
          </div>
        ) : null}
        </article>
      ) : null}

      {showHistory ? (
        <article className="card full tasks-history-card">
        <div className="panel-header compact">
          <h3>Recent Task Changes</h3>
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
                  setStatus("No selected task change IDs.");
                  return;
                }
                void navigator.clipboard.writeText(selectedHistoryIds.join("\n")).then(() => {
                  setStatus(`Copied ${selectedHistoryIds.length} task change ID(s).`);
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
                  setStatus("No task history rows to export.");
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
                anchor.download = `cleanup-pilot-tasks-history-${Date.now()}.csv`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                setStatus(`Exported ${filteredHistory.length} task history rows.`);
              }}
              disabled={!filteredHistory.length}
            >
              Export History CSV
            </button>
          </div>
        </div>
        <div className="tasks-filter-row">
          <div className="tasks-filter-grid">
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
          <div className="table-wrap" ref={tasksHistoryViewportRef} onScroll={onTasksHistoryScroll} style={{ height: 420, overflowY: "auto" }}>
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
                {tasksHistoryPadTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={6} style={{ height: tasksHistoryPadTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualVisibleTaskHistory.map((item) => (
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
                {tasksHistoryPadBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={6} style={{ height: tasksHistoryPadBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No task history rows match current filters.</p>
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
