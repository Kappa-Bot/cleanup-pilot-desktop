import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import {
  OptimizationActionSuggestion,
  OptimizationChangeRecord,
  OptimizationPreviewResponse,
  StartupEntry
} from "../../types";
import { useVirtualRows } from "./components/useVirtualRows";

type StartupSourceFilter = "all" | StartupEntry["source"];
type StartupClassificationFilter = "all" | StartupEntry["classification"];
type StartupSortKey = "impact_desc" | "delay_desc" | "name_asc" | "state";
type StartupBulkActionMode = "disable" | "delay" | "smart";
type HistoryStatusFilter = "all" | "active" | "restored";
type StartupEntriesLayout = "cards" | "table";

const STARTUP_PAGE_SIZE = 60;
const STARTUP_PREFS_KEY = "cleanup-pilot.startupViewPrefs.v2";

const startupSourceOptions: Array<{ value: StartupSourceFilter; label: string }> = [
  { value: "all", label: "All Sources" },
  { value: "registry_run", label: "Registry Run" },
  { value: "startup_folder", label: "Startup Folder" },
  { value: "scheduled_task", label: "Scheduled Task" },
  { value: "service", label: "Service" },
  { value: "shell_extension", label: "Shell Extension" },
  { value: "boot_driver", label: "Boot Driver" }
];

const startupClassificationOptions: Array<{ value: StartupClassificationFilter; label: string }> = [
  { value: "all", label: "All Classes" },
  { value: "high_impact", label: "High Impact" },
  { value: "orphan", label: "Orphan" },
  { value: "redundant", label: "Redundant" },
  { value: "normal", label: "Normal" },
  { value: "essential", label: "Essential" },
  { value: "inspect_only", label: "Inspect Only" }
];

function sourceLabel(source: StartupEntry["source"]): string {
  if (source === "registry_run") {
    return "Registry Run";
  }
  if (source === "startup_folder") {
    return "Startup Folder";
  }
  if (source === "scheduled_task") {
    return "Scheduled Task";
  }
  if (source === "service") {
    return "Service";
  }
  if (source === "boot_driver") {
    return "Boot Driver";
  }
  return "Shell Extension";
}

function toneClass(classification: StartupEntry["classification"]): string {
  if (classification === "orphan") {
    return "tone-high";
  }
  if (classification === "high_impact") {
    return "tone-medium";
  }
  if (classification === "inspect_only" || classification === "essential") {
    return "tone-neutral";
  }
  return "tone-low";
}

function shortPath(value?: string): string {
  if (!value) {
    return "-";
  }
  return value.length > 96 ? `...${value.slice(-93)}` : value;
}

function formatDelay(delayMs: number): string {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return "0 s";
  }
  return `${(delayMs / 1000).toFixed(delayMs >= 10_000 ? 0 : 1)} s`;
}

function buildStartupAction(entry: StartupEntry, action: "disable" | "delay" | "restore"): OptimizationActionSuggestion {
  const supported = entry.actionSupport.includes(action);
  const blockedByState =
    action === "disable"
      ? entry.state === "disabled"
      : action === "delay"
        ? entry.state !== "enabled"
        : entry.state === "enabled";
  const blocked = !entry.reversible || !supported || blockedByState;
  return {
    id: `startup-ui-${entry.id}-${action}`,
    targetKind: "startup_entry",
    targetId: entry.optimizationTargetId,
    action,
    title:
      action === "delay"
        ? `Delay ${entry.name}`
        : action === "restore"
          ? `Restore ${entry.name}`
          : `Disable ${entry.name}`,
    summary: [
      `${sourceLabel(entry.source)} entry`,
      ...entry.reasoning,
      entry.originLocation ? `Origin ${entry.originLocation}` : ""
    ]
      .filter(Boolean)
      .join(". "),
    risk: entry.classification === "orphan" ? "low" : entry.classification === "high_impact" ? "medium" : "low",
    reversible: true,
    blocked,
    blockReason: blocked
      ? !entry.reversible
        ? "This startup target is inspect-only."
        : !supported
          ? `This entry does not support ${action}.`
          : action === "disable"
            ? "This entry is already disabled."
            : action === "delay"
              ? "Only enabled startup entries can be delayed."
              : "This entry is already in its current startup state."
      : undefined,
    estimatedBenefitScore: Math.max(10, entry.impactScore)
  };
}

function resolveBulkAction(entry: StartupEntry, mode: StartupBulkActionMode): "disable" | "delay" | null {
  if (mode === "disable") {
    if (!entry.reversible || !entry.actionSupport.includes("disable") || entry.state === "disabled") {
      return null;
    }
    return "disable";
  }
  if (mode === "delay") {
    if (!entry.reversible || !entry.actionSupport.includes("delay") || entry.state !== "enabled") {
      return null;
    }
    return "delay";
  }

  if (entry.reversible && entry.actionSupport.includes("delay") && entry.state === "enabled") {
    return "delay";
  }
  if (entry.reversible && entry.actionSupport.includes("disable") && entry.state !== "disabled") {
    return "disable";
  }
  return null;
}

export function StartupView() {
  const entries = useAppStore((state) => state.startupEntries);
  const summary = useAppStore((state) => state.startupSummary);
  const startupActions = useAppStore((state) => state.startupActions);
  const loadStartup = useAppStore((state) => state.loadStartup);
  const loading = useAppStore((state) => state.startupLoading);
  const startupError = useAppStore((state) => state.startupError);
  const startupLastLoadedAt = useAppStore((state) => state.startupLastLoadedAt);

  const [preview, setPreview] = useState<OptimizationPreviewResponse | null>(null);
  const [previewActions, setPreviewActions] = useState<OptimizationActionSuggestion[]>([]);
  const [previewLabel, setPreviewLabel] = useState("");
  const [executing, setExecuting] = useState(false);
  const [previewingId, setPreviewingId] = useState("");
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<OptimizationChangeRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLimit, setHistoryLimit] = useState(40);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [restoringHistoryIds, setRestoringHistoryIds] = useState<string[]>([]);
  const [openingLocationId, setOpeningLocationId] = useState("");
  const [entryQuery, setEntryQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<StartupSourceFilter>("all");
  const [classificationFilter, setClassificationFilter] = useState<StartupClassificationFilter>("all");
  const [sortKey, setSortKey] = useState<StartupSortKey>("impact_desc");
  const [bulkActionMode, setBulkActionMode] = useState<StartupBulkActionMode>("disable");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [entriesLayout, setEntriesLayout] = useState<StartupEntriesLayout>("table");
  const [compactRows, setCompactRows] = useState(false);
  const [batchSize, setBatchSize] = useState(STARTUP_PAGE_SIZE);
  const [renderLimit, setRenderLimit] = useState(STARTUP_PAGE_SIZE);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showEntries, setShowEntries] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const deferredEntryQuery = useDeferredValue(entryQuery);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STARTUP_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<{
        sourceFilter: StartupSourceFilter;
        classificationFilter: StartupClassificationFilter;
        sortKey: StartupSortKey;
        bulkActionMode: StartupBulkActionMode;
        actionableOnly: boolean;
        showFilters: boolean;
        entriesLayout: StartupEntriesLayout;
        compactRows: boolean;
        batchSize: number;
        showTimeline: boolean;
        showEntries: boolean;
        showHistory: boolean;
      }>;
      if (parsed.sourceFilter) {
        setSourceFilter(parsed.sourceFilter);
      }
      if (parsed.classificationFilter) {
        setClassificationFilter(parsed.classificationFilter);
      }
      if (parsed.sortKey) {
        setSortKey(parsed.sortKey);
      }
      if (parsed.bulkActionMode) {
        setBulkActionMode(parsed.bulkActionMode);
      }
      if (typeof parsed.actionableOnly === "boolean") {
        setActionableOnly(parsed.actionableOnly);
      }
      if (typeof parsed.showFilters === "boolean") {
        setShowFilters(parsed.showFilters);
      }
      if (parsed.entriesLayout === "cards" || parsed.entriesLayout === "table") {
        setEntriesLayout(parsed.entriesLayout);
      }
      if (typeof parsed.compactRows === "boolean") {
        setCompactRows(parsed.compactRows);
      }
      if (typeof parsed.batchSize === "number" && Number.isFinite(parsed.batchSize) && parsed.batchSize >= 20 && parsed.batchSize <= 200) {
        setBatchSize(parsed.batchSize);
      }
      if (typeof parsed.showTimeline === "boolean") {
        setShowTimeline(parsed.showTimeline);
      }
      if (typeof parsed.showEntries === "boolean") {
        setShowEntries(parsed.showEntries);
      }
      if (typeof parsed.showHistory === "boolean") {
        setShowHistory(parsed.showHistory);
      }
    } catch {
      // Ignore persisted state parsing issues.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STARTUP_PREFS_KEY,
        JSON.stringify({
          sourceFilter,
          classificationFilter,
          sortKey,
          bulkActionMode,
          actionableOnly,
          showFilters,
          entriesLayout,
          compactRows,
          batchSize,
          showTimeline,
          showEntries,
          showHistory
        })
      );
    } catch {
      // Ignore storage write issues.
    }
  }, [actionableOnly, batchSize, bulkActionMode, classificationFilter, compactRows, entriesLayout, showFilters, sortKey, sourceFilter, showTimeline, showEntries, showHistory]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await window.desktopApi.listOptimizationHistory(24);
      setHistory(response.changes.filter((item) => item.sourceEngine === "startup"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load startup history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (startupLastLoadedAt === 0 && !loading && !startupError) {
      void loadStartup();
    }
  }, [loadStartup, loading, startupError, startupLastLoadedAt]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const highImpactEntries = useMemo(
    () => entries.filter((entry) => entry.classification === "high_impact" || entry.classification === "orphan"),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const normalizedQuery = deferredEntryQuery.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (sourceFilter !== "all" && entry.source !== sourceFilter) {
        return false;
      }
      if (classificationFilter !== "all" && entry.classification !== classificationFilter) {
        return false;
      }
      if (actionableOnly) {
        const resolved = resolveBulkAction(entry, bulkActionMode);
        if (!resolved) {
          return false;
        }
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        entry.name,
        entry.targetPath ?? "",
        entry.command ?? "",
        entry.publisher ?? "",
        entry.originLocation ?? "",
        entry.reasoning.join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return [...filtered].sort((left, right) => {
      if (sortKey === "impact_desc") {
        return right.impactScore - left.impactScore || right.estimatedDelayMs - left.estimatedDelayMs;
      }
      if (sortKey === "delay_desc") {
        return right.estimatedDelayMs - left.estimatedDelayMs || right.impactScore - left.impactScore;
      }
      if (sortKey === "state") {
        return left.state.localeCompare(right.state) || right.impactScore - left.impactScore;
      }
      return left.name.localeCompare(right.name);
    });
  }, [actionableOnly, bulkActionMode, classificationFilter, deferredEntryQuery, entries, sortKey, sourceFilter]);

  const visibleEntries = useMemo(() => filteredEntries.slice(0, renderLimit), [filteredEntries, renderLimit]);
  const hasMoreEntries = visibleEntries.length < filteredEntries.length;
  const startupRowHeight = compactRows ? 34 : 44;
  const {
    viewportRef: startupEntriesViewportRef,
    onScroll: onStartupEntriesTableScroll,
    startIndex: startupEntriesStartIndex,
    endIndex: startupEntriesEndIndex,
    padTop: startupEntriesPadTop,
    padBottom: startupEntriesPadBottom
  } = useVirtualRows({
    itemCount: visibleEntries.length,
    rowHeight: startupRowHeight,
    overscan: 10,
    defaultViewportHeight: 560
  });
  const virtualVisibleEntries = useMemo(
    () => visibleEntries.slice(startupEntriesStartIndex, startupEntriesEndIndex),
    [startupEntriesEndIndex, startupEntriesStartIndex, visibleEntries]
  );
  const selectedEntrySet = useMemo(() => new Set(selectedEntryIds), [selectedEntryIds]);

  const selectedEntries = useMemo(
    () => filteredEntries.filter((entry) => selectedEntrySet.has(entry.id)),
    [filteredEntries, selectedEntrySet]
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
  const visibleHistory = useMemo(() => filteredHistory.slice(0, historyLimit), [filteredHistory, historyLimit]);
  const activeHistory = useMemo(() => filteredHistory.filter((item) => !item.revertedAt), [filteredHistory]);
  const hasMoreHistory = visibleHistory.length < filteredHistory.length;
  const startupHistoryRowHeight = compactRows ? 33 : 42;
  const {
    viewportRef: startupHistoryViewportRef,
    onScroll: onStartupHistoryScroll,
    startIndex: startupHistoryStart,
    endIndex: startupHistoryEnd,
    padTop: startupHistoryPadTop,
    padBottom: startupHistoryPadBottom
  } = useVirtualRows({
    itemCount: visibleHistory.length,
    rowHeight: startupHistoryRowHeight,
    overscan: 10,
    defaultViewportHeight: 420
  });
  const virtualVisibleHistory = useMemo(
    () => visibleHistory.slice(startupHistoryStart, startupHistoryEnd),
    [startupHistoryEnd, startupHistoryStart, visibleHistory]
  );
  const selectedActionableCount = useMemo(() => {
    return selectedEntries.filter((entry) => Boolean(resolveBulkAction(entry, bulkActionMode))).length;
  }, [bulkActionMode, selectedEntries]);

  const visibleHighImpactEntries = useMemo(
    () => visibleEntries.filter((entry) => entry.classification === "high_impact" || entry.classification === "orphan"),
    [visibleEntries]
  );
  const hasStartupScan = startupLastLoadedAt > 0;
  const startupFiltersActive =
    deferredEntryQuery.trim().length > 0 ||
    sourceFilter !== "all" ||
    classificationFilter !== "all" ||
    sortKey !== "impact_desc" ||
    actionableOnly;
  const showStartupNoResults = hasStartupScan && !loading && !startupError && entries.length === 0;
  const showStartupFilterEmpty = hasStartupScan && !loading && !startupError && entries.length > 0 && visibleEntries.length === 0;

  useEffect(() => {
    setRenderLimit(batchSize);
  }, [actionableOnly, batchSize, bulkActionMode, entryQuery, sourceFilter, classificationFilter, sortKey]);

  useEffect(() => {
    setHistoryLimit(40);
  }, [historyStatusFilter, historyQuery]);

  useEffect(() => {
    setSelectedEntryIds((current) => current.filter((entryId) => entries.some((entry) => entry.id === entryId)));
  }, [entries]);

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => history.some((item) => item.id === id && !item.revertedAt)));
  }, [history]);

  const previewSelectedActions = useCallback(
    async (actions: OptimizationActionSuggestion[], label: string) => {
      const actionable = actions.filter((item) => !item.blocked);
      if (!actionable.length) {
        setStatus("No reversible startup actions are available for this selection.");
        return;
      }
      setPreviewingId(label);
      try {
        const response = await window.desktopApi.previewOptimizations(actionable);
        setPreview(response);
        setPreviewActions(actionable);
        setPreviewLabel(label);
        setStatus(`Prepared preview for ${actionable.length} startup action${actionable.length === 1 ? "" : "s"}.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not build startup preview.");
      } finally {
        setPreviewingId("");
      }
    },
    []
  );

  const applyPreview = useCallback(async () => {
    if (!previewActions.length) {
      return;
    }
    setExecuting(true);
    try {
      const response = await window.desktopApi.executeOptimizations(previewActions);
      await Promise.all([loadStartup(true), loadHistory()]);
      setPreview(null);
      setPreviewActions([]);
      setPreviewLabel("");
      setStatus(`Applied ${response.appliedCount} startup change(s). ${response.failedCount ? `${response.failedCount} failed.` : ""}`.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not apply startup changes.");
    } finally {
      setExecuting(false);
    }
  }, [loadHistory, loadStartup, previewActions]);

  const restoreChange = useCallback(
    async (changeId: string) => {
      if (restoringHistoryIds.includes(changeId)) {
        return;
      }
      setRestoringHistoryIds((current) => [...current, changeId]);
      try {
        const response = await window.desktopApi.restoreOptimizations([changeId]);
        await Promise.all([loadStartup(true), loadHistory()]);
        setStatus(
          response.restoredCount
            ? `Restored ${response.restoredCount} startup change.`
            : `Startup restore failed for ${response.failed.length} item(s).`
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Could not restore startup change.");
      } finally {
        setRestoringHistoryIds((current) => current.filter((id) => id !== changeId));
      }
    },
    [loadHistory, loadStartup, restoringHistoryIds]
  );

  const restoreSelectedHistory = useCallback(async () => {
    if (!selectedHistoryIds.length) {
      setStatus("No startup history rows selected.");
      return;
    }
    setRestoringHistoryIds((current) => [...new Set([...current, ...selectedHistoryIds])]);
    try {
      const response = await window.desktopApi.restoreOptimizations(selectedHistoryIds);
      await Promise.all([loadStartup(true), loadHistory()]);
      setSelectedHistoryIds([]);
      setStatus(
        response.restoredCount
          ? `Restored ${response.restoredCount} startup change(s).`
          : `Startup restore failed for ${response.failed.length} item(s).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not restore selected startup changes.");
    } finally {
      setRestoringHistoryIds((current) => current.filter((id) => !selectedHistorySet.has(id)));
    }
  }, [loadHistory, loadStartup, selectedHistoryIds, selectedHistorySet]);

  const openEntryLocation = useCallback(async (entry: StartupEntry) => {
    setOpeningLocationId(entry.id);
    try {
      const result = await window.desktopApi.openStartupEntryLocation({
        source: entry.source,
        targetPath: entry.targetPath,
        originLocation: entry.originLocation
      });
      setStatus(
        result.opened
          ? `Opened ${result.mode.replace(/_/g, " ")} for ${entry.name}.`
          : `Could not resolve an openable location for ${entry.name}.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open startup location.");
    } finally {
      setOpeningLocationId("");
    }
  }, []);

  const toggleEntrySelection = useCallback((entryId: string) => {
    setSelectedEntryIds((current) => {
      if (current.includes(entryId)) {
        return current.filter((item) => item !== entryId);
      }
      return [...current, entryId];
    });
  }, []);

  const selectVisibleHighImpact = useCallback(() => {
    if (!visibleHighImpactEntries.length) {
      setStatus("No visible high-impact startup entries to select.");
      return;
    }
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      for (const entry of visibleHighImpactEntries) {
        next.add(entry.id);
      }
      return [...next];
    });
    setStatus(`Selected ${visibleHighImpactEntries.length} visible high-impact startup entries.`);
  }, [visibleHighImpactEntries]);

  const selectAllVisibleEntries = useCallback(() => {
    if (!visibleEntries.length) {
      setStatus("No visible startup entries to select.");
      return;
    }
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      for (const entry of visibleEntries) {
        next.add(entry.id);
      }
      return [...next];
    });
    setStatus(`Selected ${visibleEntries.length} visible startup entries.`);
  }, [visibleEntries]);

  const selectTopImpactVisible = useCallback((count = 10) => {
    if (!visibleEntries.length) {
      setStatus("No visible startup entries available.");
      return;
    }
    const top = [...visibleEntries]
      .sort((left, right) => right.impactScore - left.impactScore)
      .slice(0, Math.max(1, count));
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      for (const entry of top) {
        next.add(entry.id);
      }
      return [...next];
    });
    setStatus(`Selected top ${top.length} visible startup entries by impact.`);
  }, [visibleEntries]);

  const selectAllFilteredEntries = useCallback(() => {
    if (!filteredEntries.length) {
      setStatus("No filtered startup entries available.");
      return;
    }
    setSelectedEntryIds(filteredEntries.map((entry) => entry.id));
    setStatus(`Selected all ${filteredEntries.length} filtered startup entries.`);
  }, [filteredEntries]);

  const copySelectedEntryNames = useCallback(async () => {
    if (!selectedEntries.length) {
      setStatus("No selected startup entries to copy.");
      return;
    }
    const payload = selectedEntries.map((entry) => `${entry.name}\t${entry.source}\t${entry.state}`).join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setStatus(`Copied ${selectedEntries.length} selected startup entries to clipboard.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy selected startup entries.");
    }
  }, [selectedEntries]);

  const previewSelectedEntries = useCallback(async () => {
    if (!selectedEntries.length) {
      setStatus("Select at least one startup entry first.");
      return;
    }
    const actions = selectedEntries
      .map((entry) => {
        const resolved = resolveBulkAction(entry, bulkActionMode);
        if (!resolved) {
          return null;
        }
        return buildStartupAction(entry, resolved);
      })
      .filter((item): item is OptimizationActionSuggestion => Boolean(item));
    await previewSelectedActions(actions, `selected-startup-${bulkActionMode}`);
  }, [bulkActionMode, previewSelectedActions, selectedEntries]);

  const clearEntrySelection = useCallback(() => {
    setSelectedEntryIds([]);
  }, []);

  const exportFilteredEntries = useCallback(() => {
    if (!filteredEntries.length) {
      setStatus("No startup entries to export for the current filters.");
      return;
    }
    const rows = [
      ["name", "source", "state", "classification", "impactScore", "delayMs", "publisher", "origin", "target"],
      ...filteredEntries.map((entry) => [
        entry.name,
        entry.source,
        entry.state,
        entry.classification,
        String(entry.impactScore),
        String(entry.estimatedDelayMs),
        entry.publisher ?? "",
        entry.originLocation ?? "",
        entry.targetPath ?? entry.command ?? ""
      ])
    ];
    const csv = rows
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
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-startup-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${filteredEntries.length} startup entries.`);
  }, [filteredEntries]);

  return (
    <div className="grid startup-workbench">
      <article className="card startup-summary-card">
        <header className="panel-header compact">
          <div>
            <small className="section-kicker">Boot Pressure</small>
            <h3>Startup Impact</h3>
            <p className="muted">{startupLastLoadedAt ? `Last scan ${new Date(startupLastLoadedAt).toLocaleTimeString()}` : "No scan yet"}</p>
          </div>
          <div className="row wrap">
            <button className="btn secondary" onClick={() => void loadStartup(true)} disabled={loading}>
              {loading ? "Scanning..." : "Refresh"}
            </button>
            <button
              className="btn"
              onClick={() => void previewSelectedActions(startupActions, "high-impact-startup")}
              disabled={!startupActions.length || previewingId === "high-impact-startup"}
            >
              {previewingId === "high-impact-startup" ? "Preparing..." : "Preview Suggested Changes"}
            </button>
          </div>
        </header>
        {summary ? (
          <div className="performance-card-grid">
            <article className="mini-card"><small>Impact</small><strong>{summary.impactScore}</strong></article>
            <article className="mini-card"><small>Delay</small><strong>{formatDelay(summary.estimatedBootDelayMs)}</strong></article>
            <article className="mini-card"><small>High Impact</small><strong>{summary.highImpactCount}</strong></article>
            <article className="mini-card"><small>Orphan</small><strong>{summary.orphanCount}</strong></article>
          </div>
        ) : (
          <div className="performance-empty-state performance-empty-state--compact">
            <strong>{loading ? "Scanning startup mechanisms..." : hasStartupScan ? "Startup scan completed." : "Startup scan is ready."}</strong>
            <p className="muted">
              {loading
                ? "Collecting Run entries, startup-folder shortcuts, scheduled logon tasks and auto-start services."
                : hasStartupScan
                  ? "No aggregate startup summary is available for the latest scan."
                  : "Run the startup scan to profile login delay sources and reversible startup changes."}
            </p>
          </div>
        )}
        {startupError ? <div className="callout"><strong>Startup scan</strong><span>{startupError}</span></div> : null}
        {status ? <div className="callout"><strong>Startup workflow</strong><span>{status}</span></div> : null}
        {showStartupNoResults ? (
          <div className="performance-empty-state performance-empty-state--compact">
            <strong>No startup entries were detected.</strong>
            <p className="muted">
              This machine did not return actionable Run entries, startup-folder items, boot/logon tasks or third-party auto-start services.
            </p>
          </div>
        ) : null}
      </article>

      <div className="row wrap">
        <button className="btn secondary tiny" onClick={() => setShowTimeline((current) => !current)}>
          {showTimeline ? "Hide Boot Timeline" : "Show Boot Timeline"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowFilters((current) => !current)}>
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowEntries((current) => !current)}>
          {showEntries ? "Hide Startup Entries" : "Show Startup Entries"}
        </button>
        <button className="btn secondary tiny" onClick={() => setEntriesLayout((current) => (current === "cards" ? "table" : "cards"))}>
          {entriesLayout === "cards" ? "Table Layout" : "Card Layout"}
        </button>
        <button className="btn secondary tiny" onClick={() => setCompactRows((current) => !current)}>
          {compactRows ? "Comfort Rows" : "Compact Rows"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowHistory((current) => !current)}>
          {showHistory ? "Hide Startup History" : "Show Startup History"}
        </button>
      </div>

      {showTimeline ? (
        <article className="card startup-summary-card">
          <small className="section-kicker">Boot Timeline</small>
          <h3>Boot Timeline</h3>
          <div className="boot-timeline">
            {(summary?.timeline ?? []).map((phase) => (
              <div key={phase.id} className="timeline-phase startup-phase-card">
                <span>{phase.label}</span>
                <strong>{formatDelay(phase.durationMs)}</strong>
                {phase.estimated ? <small>estimated</small> : <small>measured</small>}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {preview ? (
        <article className="card full startup-preview-card">
          <div className="panel-header compact">
            <div>
              <small className="section-kicker">Preview</small>
              <h3>Pending Startup Changes</h3>
            </div>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => { setPreview(null); setPreviewActions([]); setPreviewLabel(""); }}>
                Clear Preview
              </button>
              <button className="btn" onClick={() => void applyPreview()} disabled={executing || !previewActions.length}>
                {executing ? "Applying..." : `Apply ${preview.actions.length} Change${preview.actions.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
          <p className="muted">
            Scope {previewLabel || "startup"} - Estimated startup savings {formatDelay(preview.estimatedStartupSavingsMs)} - Reversible {preview.reversibleCount}
          </p>
          {!!preview.warnings.length && (
            <ul className="list compact">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </article>
      ) : null}

      {showEntries ? (
        <article className="card full startup-entries-card">
        <div className="panel-header compact">
          <div>
            <small className="section-kicker">Entrypoints</small>
            <h3>Startup Entries</h3>
          </div>
          <span className="muted">
            {filteredEntries.length}/{entries.length} visible, {highImpactEntries.length} flagged
          </span>
        </div>
        {showFilters ? (
          <div className="startup-filter-row sticky-action-row">
            <div className="startup-filter-grid">
              <label>
                Search
                <input
                  value={entryQuery}
                  onChange={(event) => setEntryQuery(event.target.value)}
                  placeholder="name, path, publisher..."
                />
              </label>
              <label>
                Source
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as StartupSourceFilter)}>
                  {startupSourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Classification
                <select
                  value={classificationFilter}
                  onChange={(event) => setClassificationFilter(event.target.value as StartupClassificationFilter)}
                >
                  {startupClassificationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as StartupSortKey)}>
                  <option value="impact_desc">Impact high to low</option>
                  <option value="delay_desc">Delay high to low</option>
                  <option value="name_asc">Name A to Z</option>
                  <option value="state">State</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={actionableOnly}
                  onChange={(event) => setActionableOnly(event.target.checked)}
                />
                Actionable only
              </label>
              <label>
                Batch size
                <select value={batchSize} onChange={(event) => setBatchSize(Math.max(20, Number(event.target.value) || STARTUP_PAGE_SIZE))}>
                  <option value={40}>40</option>
                  <option value={60}>60</option>
                  <option value={100}>100</option>
                  <option value={150}>150</option>
                </select>
              </label>
            </div>
            <div className="row wrap">
              <button className="btn secondary" onClick={selectAllVisibleEntries} disabled={!visibleEntries.length}>
                Select Visible
              </button>
              <button className="btn secondary" onClick={selectAllFilteredEntries} disabled={!filteredEntries.length}>
                Select Filtered
              </button>
              <button className="btn secondary" onClick={() => selectTopImpactVisible(10)} disabled={!visibleEntries.length}>
                Select Top Impact
              </button>
              <button className="btn secondary" onClick={selectVisibleHighImpact} disabled={!visibleHighImpactEntries.length}>
                Select Visible High Impact
              </button>
              <button className="btn secondary" onClick={clearEntrySelection} disabled={!selectedEntryIds.length}>
                Clear Selection
              </button>
              <button className="btn secondary" onClick={exportFilteredEntries} disabled={!filteredEntries.length}>
                Export Filtered CSV
              </button>
              <button className="btn secondary" onClick={() => void copySelectedEntryNames()} disabled={!selectedEntries.length}>
                Copy Selected
              </button>
              <label className="startup-action-mode">
                Bulk action
                <select
                  value={bulkActionMode}
                  onChange={(event) => setBulkActionMode(event.target.value as StartupBulkActionMode)}
                >
                  <option value="disable">Disable</option>
                  <option value="delay">Delay</option>
                  <option value="smart">Smart (Delay First)</option>
                </select>
              </label>
              <button className="btn" onClick={() => void previewSelectedEntries()} disabled={!selectedEntries.length}>
                Preview Selected {bulkActionMode === "disable" ? "Disable" : bulkActionMode === "delay" ? "Delay" : "Smart"} ({selectedActionableCount}/{selectedEntries.length})
              </button>
            </div>
          </div>
        ) : null}
        {visibleEntries.length ? entriesLayout === "cards" ? (
          <div className="startup-entry-grid">
            {visibleEntries.map((entry) => {
              const disableAction = buildStartupAction(entry, "disable");
              const delayAction = buildStartupAction(entry, "delay");
              const canDisable = entry.actionSupport.includes("disable") && entry.reversible && entry.state !== "disabled";
              const canDelay = entry.actionSupport.includes("delay") && entry.reversible && entry.state === "enabled";
              const isSelected = selectedEntrySet.has(entry.id);
              return (
                <article key={entry.id} className="card startup-entry-card">
                  <div className="row spread wrap">
                    <div className="stack gap-sm">
                      <div className="row wrap">
                        <label className="checkbox startup-entry-toggle">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEntrySelection(entry.id)}
                          />
                          <span>Select</span>
                        </label>
                        <h4>{entry.name}</h4>
                        <span className={`risk-pill ${toneClass(entry.classification)}`}>{entry.classification.replace(/_/g, " ")}</span>
                        <span className="origin-pill origin-neutral">{sourceLabel(entry.source)}</span>
                        <span className="origin-pill origin-neutral">{entry.state}</span>
                      </div>
                      <p className="muted">{entry.reasoning.join(". ")}</p>
                    </div>
                    <div className="startup-impact-stack">
                      <strong>{entry.impactScore}</strong>
                      <small>impact score</small>
                      <span>{formatDelay(entry.estimatedDelayMs)} delay</span>
                    </div>
                  </div>

                  <div className="startup-meta-grid">
                    <div>
                      <small>Origin</small>
                      <strong title={entry.originLocation}>{shortPath(entry.originLocation)}</strong>
                      <span>{entry.originScope ?? "Unknown scope"}</span>
                    </div>
                    <div>
                      <small>Target</small>
                      <strong title={entry.targetPath}>{shortPath(entry.targetPath ?? entry.command)}</strong>
                      <span>{entry.command && entry.command !== entry.targetPath ? entry.command : "Direct target"}</span>
                    </div>
                    <div>
                      <small>Details</small>
                      <strong>{entry.originDetails[0] ?? "No extra provenance"}</strong>
                      <span>{entry.originDetails.slice(1).join(" | ") || entry.publisher || "-"}</span>
                    </div>
                  </div>

                  <div className="row wrap startup-action-row">
                    <button
                      className="btn secondary"
                      onClick={() => void openEntryLocation(entry)}
                      disabled={openingLocationId === entry.id}
                    >
                      {openingLocationId === entry.id ? "Opening..." : "Open Source"}
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => void previewSelectedActions([disableAction], `${entry.id}:disable`)}
                      disabled={!canDisable || previewingId === `${entry.id}:disable`}
                      title={disableAction.blockReason}
                    >
                      {previewingId === `${entry.id}:disable` ? "Preparing..." : "Preview Disable"}
                    </button>
                    <button
                      className="btn secondary"
                      onClick={() => void previewSelectedActions([delayAction], `${entry.id}:delay`)}
                      disabled={!canDelay || previewingId === `${entry.id}:delay`}
                      title={delayAction.blockReason}
                    >
                      {previewingId === `${entry.id}:delay` ? "Preparing..." : "Preview Delay"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap" ref={startupEntriesViewportRef} onScroll={onStartupEntriesTableScroll} style={{ height: 560, overflowY: "auto" }}>
            <table className={compactRows ? "table table-compact" : "table"}>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Name</th>
                  <th>Source</th>
                  <th>State</th>
                  <th>Class</th>
                  <th>Impact</th>
                  <th>Delay</th>
                  <th>Origin</th>
                  <th>Target</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {startupEntriesPadTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={10} style={{ height: startupEntriesPadTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualVisibleEntries.map((entry) => {
                  const disableAction = buildStartupAction(entry, "disable");
                  const delayAction = buildStartupAction(entry, "delay");
                  const canDisable = entry.actionSupport.includes("disable") && entry.reversible && entry.state !== "disabled";
                  const canDelay = entry.actionSupport.includes("delay") && entry.reversible && entry.state === "enabled";
                  return (
                    <tr key={entry.id}>
                      <td>
                        <label className="checkbox">
                          <input type="checkbox" checked={selectedEntrySet.has(entry.id)} onChange={() => toggleEntrySelection(entry.id)} />
                        </label>
                      </td>
                      <td title={entry.name}>{entry.name}</td>
                      <td>{sourceLabel(entry.source)}</td>
                      <td>{entry.state}</td>
                      <td>
                        <span className={`risk-pill ${toneClass(entry.classification)}`}>{entry.classification.replace(/_/g, " ")}</span>
                      </td>
                      <td>{entry.impactScore}</td>
                      <td>{formatDelay(entry.estimatedDelayMs)}</td>
                      <td title={entry.originLocation}>{shortPath(entry.originLocation)}</td>
                      <td title={entry.targetPath}>{shortPath(entry.targetPath ?? entry.command)}</td>
                      <td>
                        <div className="row wrap">
                          <button className="btn secondary tiny" onClick={() => void openEntryLocation(entry)} disabled={openingLocationId === entry.id}>
                            {openingLocationId === entry.id ? "Opening..." : "Open"}
                          </button>
                          <button
                            className="btn secondary tiny"
                            onClick={() => void previewSelectedActions([disableAction], `${entry.id}:disable`)}
                            disabled={!canDisable || previewingId === `${entry.id}:disable`}
                            title={disableAction.blockReason}
                          >
                            Disable
                          </button>
                          <button
                            className="btn secondary tiny"
                            onClick={() => void previewSelectedActions([delayAction], `${entry.id}:delay`)}
                            disabled={!canDelay || previewingId === `${entry.id}:delay`}
                            title={delayAction.blockReason}
                          >
                            Delay
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {startupEntriesPadBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={10} style={{ height: startupEntriesPadBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : showStartupNoResults ? (
          <div className="performance-empty-state">
            <strong>No startup items found.</strong>
            <p className="muted">
              The scan completed successfully, but no startup entries were returned for this machine.
            </p>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => void loadStartup(true)} disabled={loading}>
                Refresh Startup Scan
              </button>
            </div>
          </div>
        ) : showStartupFilterEmpty ? (
          <div className="performance-empty-state">
            <strong>No startup entries match the current filters.</strong>
            <p className="muted">
              {startupFiltersActive
                ? "Clear search, source or classification filters to bring entries back into view."
                : "There are no visible startup entries for the current layout."}
            </p>
            <div className="row wrap">
              <button
                className="btn secondary"
                onClick={() => {
                  setEntryQuery("");
                  setSourceFilter("all");
                  setClassificationFilter("all");
                  setSortKey("impact_desc");
                  setActionableOnly(false);
                }}
                disabled={!startupFiltersActive}
              >
                Reset Filters
              </button>
            </div>
          </div>
        ) : startupError ? (
          <div className="performance-empty-state">
            <strong>Startup scan failed.</strong>
            <p className="muted">{startupError}</p>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => void loadStartup(true)} disabled={loading}>
                Retry Startup Scan
              </button>
            </div>
          </div>
        ) : null}
        {hasMoreEntries ? (
          <div className="footer-actions">
            <button className="btn secondary" onClick={() => setRenderLimit((current) => current + batchSize)}>
              Show More Startup Entries
            </button>
          </div>
        ) : null}
        </article>
      ) : null}

      {showHistory ? (
        <article className="card full startup-history-card">
        <div className="panel-header compact">
          <div>
            <small className="section-kicker">Restore</small>
            <h3>Recent Startup Changes</h3>
          </div>
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
                  setStatus("No selected startup change IDs.");
                  return;
                }
                void navigator.clipboard.writeText(selectedHistoryIds.join("\n")).then(() => {
                  setStatus(`Copied ${selectedHistoryIds.length} startup change ID(s).`);
                });
              }}
              disabled={!selectedHistoryIds.length}
            >
              Copy Selected IDs
            </button>
          </div>
        </div>
        <div className="startup-filter-row">
          <div className="startup-filter-grid">
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
          <div className="table-wrap" ref={startupHistoryViewportRef} onScroll={onStartupHistoryScroll} style={{ height: 420, overflowY: "auto" }}>
            <table className={compactRows ? "table table-compact" : "table"}>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Applied</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {startupHistoryPadTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={6} style={{ height: startupHistoryPadTop, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {virtualVisibleHistory.map((item) => (
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
                        onClick={() => void restoreChange(item.id)}
                        disabled={Boolean(item.revertedAt) || restoringHistoryIds.includes(item.id)}
                      >
                        {restoringHistoryIds.includes(item.id) ? "Restoring..." : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
                {startupHistoryPadBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={6} style={{ height: startupHistoryPadBottom, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No startup history rows match current filters.</p>
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
