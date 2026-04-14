import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { OptimizationChangeRecord, SystemSnapshotHistoryPoint } from "../../types";

type HistoryWindow = "7d" | "30d" | "all";
type BottleneckFilter = "all" | SystemSnapshotHistoryPoint["primaryBottleneck"];
type SnapshotSourceFilter = "all" | SystemSnapshotHistoryPoint["source"];
type OptimizationEngineFilter = "all" | OptimizationChangeRecord["sourceEngine"];
type OptimizationStatusFilter = "all" | "active" | "restored";

const HISTORY_PAGE_SIZE = 40;
const HISTORY_PREFS_KEY = "cleanup-pilot.historyViewPrefs.v1";

interface HistoryViewPrefs {
  windowKey: HistoryWindow;
  bottleneckFilter: BottleneckFilter;
  sourceFilter: SnapshotSourceFilter;
  engineFilter: OptimizationEngineFilter;
  statusFilter: OptimizationStatusFilter;
}

function toCsvCell(value: string): string {
  const needsQuotes = value.includes(",") || value.includes("\"") || value.includes("\n");
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function downloadCsv(fileName: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map((cell) => toCsvCell(cell)).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function windowCutoff(windowKey: HistoryWindow): number {
  if (windowKey === "all") {
    return 0;
  }
  const days = windowKey === "7d" ? 7 : 30;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function findLatestSnapshotBySource(
  items: SystemSnapshotHistoryPoint[],
  source: SystemSnapshotHistoryPoint["source"]
): SystemSnapshotHistoryPoint | undefined {
  return [...items]
    .filter((item) => item.source === source)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

function deltaValue(next?: number, previous?: number): number | undefined {
  if (next === undefined || previous === undefined) {
    return undefined;
  }
  return Math.round((next - previous) * 10) / 10;
}

export function HistoryView() {
  const historySnapshots = useAppStore((state) => state.historySnapshots);
  const optimizationHistory = useAppStore((state) => state.optimizationHistory);
  const loadHistory = useAppStore((state) => state.loadHistory);
  const loading = useAppStore((state) => state.historyLoading);
  const historyError = useAppStore((state) => state.historyError);
  const historyLastLoadedAt = useAppStore((state) => state.historyLastLoadedAt);

  const [windowKey, setWindowKey] = useState<HistoryWindow>("30d");
  const [bottleneckFilter, setBottleneckFilter] = useState<BottleneckFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SnapshotSourceFilter>("all");
  const [engineFilter, setEngineFilter] = useState<OptimizationEngineFilter>("all");
  const [statusFilter, setStatusFilter] = useState<OptimizationStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [snapshotLimit, setSnapshotLimit] = useState(HISTORY_PAGE_SIZE);
  const [changeLimit, setChangeLimit] = useState(HISTORY_PAGE_SIZE);
  const [status, setStatus] = useState("");
  const [restoringChangeIds, setRestoringChangeIds] = useState<string[]>([]);
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<HistoryViewPrefs>;
      if (parsed.windowKey) {
        setWindowKey(parsed.windowKey);
      }
      if (parsed.bottleneckFilter) {
        setBottleneckFilter(parsed.bottleneckFilter);
      }
      if (parsed.sourceFilter) {
        setSourceFilter(parsed.sourceFilter);
      }
      if (parsed.engineFilter) {
        setEngineFilter(parsed.engineFilter);
      }
      if (parsed.statusFilter) {
        setStatusFilter(parsed.statusFilter);
      }
    } catch {
      // Ignore invalid persisted preferences.
    }
  }, []);

  useEffect(() => {
    try {
      const payload: HistoryViewPrefs = {
        windowKey,
        bottleneckFilter,
        sourceFilter,
        engineFilter,
        statusFilter
      };
      window.localStorage.setItem(HISTORY_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore local storage write errors.
    }
  }, [bottleneckFilter, engineFilter, sourceFilter, statusFilter, windowKey]);

  useEffect(() => {
    if (!historySnapshots.length && !loading) {
      void loadHistory();
    }
  }, [historySnapshots.length, loadHistory, loading]);

  const filteredSnapshots = useMemo(() => {
    const cutoff = windowCutoff(windowKey);
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return historySnapshots
      .filter((item) => item.createdAt >= cutoff)
      .filter((item) => bottleneckFilter === "all" || item.primaryBottleneck === bottleneckFilter)
      .filter((item) => sourceFilter === "all" || item.source === sourceFilter)
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [item.id, item.source, item.primaryBottleneck].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [bottleneckFilter, deferredQuery, historySnapshots, sourceFilter, windowKey]);

  const filteredChanges = useMemo(() => {
    const cutoff = windowCutoff(windowKey);
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    return optimizationHistory
      .filter((item) => item.createdAt >= cutoff)
      .filter((item) => engineFilter === "all" || item.sourceEngine === engineFilter)
      .filter((item) =>
        statusFilter === "all" ? true : statusFilter === "active" ? !item.revertedAt : Boolean(item.revertedAt)
      )
      .filter((item) => {
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [item.targetKind, item.targetId, item.action, item.sourceEngine].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [deferredQuery, engineFilter, optimizationHistory, statusFilter, windowKey]);

  useEffect(() => {
    setSnapshotLimit(HISTORY_PAGE_SIZE);
    setChangeLimit(HISTORY_PAGE_SIZE);
  }, [windowKey, bottleneckFilter, sourceFilter, engineFilter, statusFilter, query]);

  const visibleSnapshots = useMemo(
    () => filteredSnapshots.slice(0, snapshotLimit),
    [filteredSnapshots, snapshotLimit]
  );
  const visibleChanges = useMemo(
    () => filteredChanges.slice(0, changeLimit),
    [changeLimit, filteredChanges]
  );

  const hasMoreSnapshots = visibleSnapshots.length < filteredSnapshots.length;
  const hasMoreChanges = visibleChanges.length < filteredChanges.length;
  const selectedChangeSet = useMemo(() => new Set(selectedChangeIds), [selectedChangeIds]);

  useEffect(() => {
    setSelectedChangeIds((current) =>
      current.filter((changeId) => filteredChanges.some((item) => item.id === changeId && !item.revertedAt))
    );
  }, [filteredChanges]);

  const trendSummary = useMemo(() => {
    if (!filteredSnapshots.length) {
      return null;
    }
    const cpuValues = filteredSnapshots
      .map((item) => item.cpuAvgPct)
      .filter((item): item is number => typeof item === "number");
    const ramValues = filteredSnapshots
      .map((item) => item.ramUsedPct)
      .filter((item): item is number => typeof item === "number");
    const diskValues = filteredSnapshots
      .map((item) => item.diskActivePct)
      .filter((item): item is number => typeof item === "number");
    const avg = (values: number[]) =>
      values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : undefined;
    return {
      avgCpu: avg(cpuValues),
      avgRam: avg(ramValues),
      avgDisk: avg(diskValues),
      firstCpu: cpuValues[0],
      lastCpu: cpuValues[cpuValues.length - 1],
      firstRam: ramValues[0],
      lastRam: ramValues[ramValues.length - 1],
      firstDisk: diskValues[0],
      lastDisk: diskValues[diskValues.length - 1]
    };
  }, [filteredSnapshots]);
  const optimizationBreakdown = useMemo(() => {
    const startup = filteredChanges.filter((item) => item.sourceEngine === "startup").length;
    const services = filteredChanges.filter((item) => item.sourceEngine === "services").length;
    const tasks = filteredChanges.filter((item) => item.sourceEngine === "tasks").length;
    const active = filteredChanges.filter((item) => !item.revertedAt).length;
    const restored = filteredChanges.filter((item) => Boolean(item.revertedAt)).length;
    return { startup, services, tasks, active, restored };
  }, [filteredChanges]);
  const latestCleanupDelta = useMemo(() => {
    const pre = findLatestSnapshotBySource(filteredSnapshots, "pre_cleanup");
    const post = findLatestSnapshotBySource(filteredSnapshots, "post_cleanup");
    if (!pre || !post || post.createdAt < pre.createdAt) {
      return null;
    }
    return {
      cpu: deltaValue(post.cpuAvgPct, pre.cpuAvgPct),
      ram: deltaValue(post.ramUsedPct, pre.ramUsedPct),
      disk: deltaValue(post.diskActivePct, pre.diskActivePct),
      bottleneckChanged: pre.primaryBottleneck !== post.primaryBottleneck
    };
  }, [filteredSnapshots]);
  const latestOptimizationDelta = useMemo(() => {
    const pre = findLatestSnapshotBySource(filteredSnapshots, "pre_optimization");
    const post = findLatestSnapshotBySource(filteredSnapshots, "post_optimization");
    if (!pre || !post || post.createdAt < pre.createdAt) {
      return null;
    }
    return {
      cpu: deltaValue(post.cpuAvgPct, pre.cpuAvgPct),
      ram: deltaValue(post.ramUsedPct, pre.ramUsedPct),
      disk: deltaValue(post.diskActivePct, pre.diskActivePct),
      bottleneckChanged: pre.primaryBottleneck !== post.primaryBottleneck
    };
  }, [filteredSnapshots]);

  const restoreChange = async (changeId: string) => {
    if (restoringChangeIds.includes(changeId)) {
      return;
    }
    setRestoringChangeIds((current) => [...current, changeId]);
    try {
      const response = await window.desktopApi.restoreOptimizations([changeId]);
      await loadHistory();
      setStatus(
        response.restoredCount
          ? `Restored ${response.restoredCount} optimization change.`
          : `Restore failed (${response.failed.length}).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to restore optimization change.");
    } finally {
      setRestoringChangeIds((current) => current.filter((item) => item !== changeId));
    }
  };

  const restoreSelectedChanges = async () => {
    if (!selectedChangeIds.length) {
      setStatus("No optimization changes selected.");
      return;
    }
    setRestoringChangeIds((current) => [...new Set([...current, ...selectedChangeIds])]);
    try {
      const response = await window.desktopApi.restoreOptimizations(selectedChangeIds);
      await loadHistory();
      setSelectedChangeIds([]);
      setStatus(
        response.restoredCount
          ? `Restored ${response.restoredCount} selected optimization change(s).`
          : `Selected restore failed (${response.failed.length}).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to restore selected optimization changes.");
    } finally {
      setRestoringChangeIds((current) => current.filter((item) => !selectedChangeSet.has(item)));
    }
  };

  const selectAllVisibleChanges = () => {
    const selectable = visibleChanges.filter((item) => !item.revertedAt).map((item) => item.id);
    setSelectedChangeIds(selectable);
    setStatus(`Selected ${selectable.length} visible active optimization change(s).`);
  };

  const selectAllFilteredActiveChanges = () => {
    const selectable = filteredChanges.filter((item) => !item.revertedAt).map((item) => item.id);
    setSelectedChangeIds(selectable);
    setStatus(`Selected ${selectable.length} filtered active optimization change(s).`);
  };

  const copySelectedChangeIds = async () => {
    if (!selectedChangeIds.length) {
      setStatus("No selected optimization change IDs.");
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedChangeIds.join("\n"));
      setStatus(`Copied ${selectedChangeIds.length} change ID(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy selected change IDs.");
    }
  };

  const exportSnapshots = () => {
    const rows: string[][] = [
      ["id", "createdAt", "source", "primaryBottleneck", "cpuAvgPct", "ramUsedPct", "diskActivePct", "startupImpactScore"],
      ...filteredSnapshots.map((item) => [
        item.id,
        new Date(item.createdAt).toISOString(),
        item.source,
        item.primaryBottleneck,
        item.cpuAvgPct === undefined ? "" : String(item.cpuAvgPct),
        item.ramUsedPct === undefined ? "" : String(item.ramUsedPct),
        item.diskActivePct === undefined ? "" : String(item.diskActivePct),
        item.startupImpactScore === undefined ? "" : String(item.startupImpactScore)
      ])
    ];
    downloadCsv(`cleanup-pilot-history-snapshots-${Date.now()}.csv`, rows);
  };

  const exportChanges = () => {
    const rows: string[][] = [
      ["id", "createdAt", "sourceEngine", "targetKind", "action", "targetId", "revertedAt"],
      ...filteredChanges.map((item) => [
        item.id,
        new Date(item.createdAt).toISOString(),
        item.sourceEngine,
        item.targetKind,
        item.action,
        item.targetId,
        item.revertedAt ? new Date(item.revertedAt).toISOString() : ""
      ])
    ];
    downloadCsv(`cleanup-pilot-history-optimizations-${Date.now()}.csv`, rows);
  };

  const deltaLabel = (start?: number, end?: number): string => {
    if (start === undefined || end === undefined) {
      return "N/A";
    }
    const delta = Math.round((end - start) * 10) / 10;
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta}`;
  };

  return (
    <div className="grid history-workbench">
      <article className="card">
        <div className="history-filter-row sticky-action-row">
          <div className="history-filter-grid">
            <label>
              Window
              <select value={windowKey} onChange={(event) => setWindowKey(event.target.value as HistoryWindow)}>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All</option>
              </select>
            </label>
            <label>
              Bottleneck
              <select value={bottleneckFilter} onChange={(event) => setBottleneckFilter(event.target.value as BottleneckFilter)}>
                <option value="all">All</option>
                <option value="cpu">CPU</option>
                <option value="ram">RAM</option>
                <option value="disk_io">Disk I/O</option>
                <option value="gpu">GPU</option>
                <option value="drivers">Drivers</option>
                <option value="mixed">Mixed</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>
              Snapshot source
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SnapshotSourceFilter)}>
                <option value="all">All</option>
                <option value="manual">Manual</option>
                <option value="app_start">App start</option>
                <option value="scheduled">Scheduled</option>
                <option value="pre_cleanup">Pre cleanup</option>
                <option value="post_cleanup">Post cleanup</option>
                <option value="pre_optimization">Pre optimization</option>
                <option value="post_optimization">Post optimization</option>
              </select>
            </label>
            <label>
              Optimization engine
              <select value={engineFilter} onChange={(event) => setEngineFilter(event.target.value as OptimizationEngineFilter)}>
                <option value="all">All</option>
                <option value="startup">Startup</option>
                <option value="services">Services</option>
                <option value="tasks">Tasks</option>
              </select>
            </label>
            <label>
              Change status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as OptimizationStatusFilter)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="restored">Restored</option>
              </select>
            </label>
            <label>
              Search
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="id, source, target..." />
            </label>
          </div>
          <div className="row wrap">
            <button className="btn secondary" onClick={() => void loadHistory(true)} disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button className="btn secondary" onClick={exportSnapshots} disabled={!filteredSnapshots.length}>
              Export Snapshots CSV
            </button>
            <button className="btn secondary" onClick={exportChanges} disabled={!filteredChanges.length}>
              Export Changes CSV
            </button>
            <button className="btn secondary" onClick={selectAllVisibleChanges} disabled={!visibleChanges.length}>
              Select Visible
            </button>
            <button className="btn secondary" onClick={selectAllFilteredActiveChanges} disabled={!filteredChanges.length}>
              Select Filtered Active
            </button>
            <button className="btn secondary" onClick={() => void copySelectedChangeIds()} disabled={!selectedChangeIds.length}>
              Copy Selected IDs
            </button>
            <button className="btn secondary" onClick={() => setSelectedChangeIds([])} disabled={!selectedChangeIds.length}>
              Clear Selected
            </button>
            <button className="btn" onClick={() => void restoreSelectedChanges()} disabled={!selectedChangeIds.length}>
              Restore Selected ({selectedChangeIds.length})
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setWindowKey("30d");
                setBottleneckFilter("all");
                setSourceFilter("all");
                setEngineFilter("all");
                setStatusFilter("all");
                setQuery("");
                setStatus("History filters reset.");
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
        <p className="muted">{historyLastLoadedAt ? `Last refresh ${new Date(historyLastLoadedAt).toLocaleTimeString()}` : "No history refresh yet"}</p>
        {status ? <div className="callout"><strong>History action</strong><span>{status}</span></div> : null}
        {historyError ? <div className="callout"><strong>History load</strong><span>{historyError}</span></div> : null}
      </article>

      <div className="history-summary-grid">
        <article className="mini-card"><small>Snapshots</small><strong>{filteredSnapshots.length}</strong></article>
        <article className="mini-card"><small>Optimizations</small><strong>{filteredChanges.length}</strong></article>
        <article className="mini-card">
          <small>Avg CPU</small>
          <strong>{trendSummary?.avgCpu === undefined ? "N/A" : `${Math.round(trendSummary.avgCpu)}%`}</strong>
          <span className="muted">Delta {deltaLabel(trendSummary?.firstCpu, trendSummary?.lastCpu)} pts</span>
        </article>
        <article className="mini-card">
          <small>Avg RAM</small>
          <strong>{trendSummary?.avgRam === undefined ? "N/A" : `${Math.round(trendSummary.avgRam)}%`}</strong>
          <span className="muted">Delta {deltaLabel(trendSummary?.firstRam, trendSummary?.lastRam)} pts</span>
        </article>
        <article className="mini-card">
          <small>Avg Disk</small>
          <strong>{trendSummary?.avgDisk === undefined ? "N/A" : `${Math.round(trendSummary.avgDisk)}%`}</strong>
          <span className="muted">Delta {deltaLabel(trendSummary?.firstDisk, trendSummary?.lastDisk)} pts</span>
        </article>
        <article className="mini-card"><small>Startup Ops</small><strong>{optimizationBreakdown.startup}</strong></article>
        <article className="mini-card"><small>Service Ops</small><strong>{optimizationBreakdown.services}</strong></article>
        <article className="mini-card"><small>Task Ops</small><strong>{optimizationBreakdown.tasks}</strong></article>
        <article className="mini-card"><small>Active/Restored</small><strong>{optimizationBreakdown.active}/{optimizationBreakdown.restored}</strong></article>
        <article className="mini-card">
          <small>Cleanup delta</small>
          <strong>{latestCleanupDelta ? deltaLabel(0, latestCleanupDelta.disk) : "N/A"}</strong>
          <span className="muted">
            {latestCleanupDelta
              ? `CPU ${deltaLabel(0, latestCleanupDelta.cpu)} / RAM ${deltaLabel(0, latestCleanupDelta.ram)}`
              : "Awaiting cleanup pair"}
          </span>
        </article>
        <article className="mini-card">
          <small>Optimization delta</small>
          <strong>{latestOptimizationDelta ? deltaLabel(0, latestOptimizationDelta.disk) : "N/A"}</strong>
          <span className="muted">
            {latestOptimizationDelta
              ? latestOptimizationDelta.bottleneckChanged
                ? "Bottleneck changed"
                : `CPU ${deltaLabel(0, latestOptimizationDelta.cpu)} / RAM ${deltaLabel(0, latestOptimizationDelta.ram)}`
              : "Awaiting optimization pair"}
          </span>
        </article>
      </div>

      <div className="grid two-col">
        <article className="card">
          <header className="panel-header compact">
            <h3>Snapshot History</h3>
            <span className="muted">{visibleSnapshots.length}/{filteredSnapshots.length}</span>
          </header>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Captured</th>
                  <th>Source</th>
                  <th>Bottleneck</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>Disk</th>
                </tr>
              </thead>
              <tbody>
                {visibleSnapshots.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.source}</td>
                    <td>{item.primaryBottleneck}</td>
                    <td>{item.cpuAvgPct === undefined ? "-" : `${Math.round(item.cpuAvgPct)}%`}</td>
                    <td>{item.ramUsedPct === undefined ? "-" : `${Math.round(item.ramUsedPct)}%`}</td>
                    <td>{item.diskActivePct === undefined ? "-" : `${Math.round(item.diskActivePct)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleSnapshots.length ? <p className="muted">No snapshots match current filters.</p> : null}
          {hasMoreSnapshots ? (
            <div className="footer-actions">
              <button className="btn secondary" onClick={() => setSnapshotLimit((current) => current + HISTORY_PAGE_SIZE)}>
                Show More Snapshots
              </button>
            </div>
          ) : null}
        </article>

        <article className="card">
          <header className="panel-header compact">
            <h3>Optimization History</h3>
            <span className="muted">{visibleChanges.length}/{filteredChanges.length}</span>
          </header>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Date</th>
                  <th>Engine</th>
                  <th>Target</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Restore</th>
                </tr>
              </thead>
              <tbody>
                {visibleChanges.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedChangeSet.has(item.id)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedChangeIds((current) => [...new Set([...current, item.id])]);
                              return;
                            }
                            setSelectedChangeIds((current) => current.filter((id) => id !== item.id));
                          }}
                          disabled={Boolean(item.revertedAt)}
                        />
                      </label>
                    </td>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.sourceEngine}</td>
                    <td title={item.targetId}>{item.targetKind}</td>
                    <td>{item.action}</td>
                    <td>{item.revertedAt ? "restored" : "active"}</td>
                    <td>
                      <button
                        className="btn secondary"
                        onClick={() => void restoreChange(item.id)}
                        disabled={Boolean(item.revertedAt) || restoringChangeIds.includes(item.id)}
                      >
                        {restoringChangeIds.includes(item.id) ? "Restoring..." : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleChanges.length ? <p className="muted">No optimization changes match current filters.</p> : null}
          {hasMoreChanges ? (
            <div className="footer-actions">
              <button className="btn secondary" onClick={() => setChangeLimit((current) => current + HISTORY_PAGE_SIZE)}>
                Show More Changes
              </button>
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}
