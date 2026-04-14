import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { ProcessSample } from "../../types";
import { useVirtualRows } from "./components/useVirtualRows";

type ProcessSortKey =
  | "cpu_desc"
  | "ram_desc"
  | "disk_desc"
  | "gpu_desc"
  | "impact_desc"
  | "name_asc"
  | "pid_asc";

interface ProcessesViewPrefs {
  sortKey: ProcessSortKey;
  minCpuPct: string;
  minRamMb: string;
  minDiskWriteMbps: string;
  minGpuPct: string;
  runawayOnly: boolean;
  showPathColumn: boolean;
  showInsights?: boolean;
  showFilters?: boolean;
  showTable?: boolean;
  compactRows?: boolean;
  batchSize?: number;
}

const PROCESS_PAGE_SIZE = 60;
const PROCESSES_PREFS_KEY = "cleanup-pilot.processesViewPrefs.v2";

function safePercent(value?: number): number {
  return Math.max(0, Number(value ?? 0));
}

function toMb(value?: number): number {
  return Math.max(0, Math.round(Number(value ?? 0) / 1024 / 1024));
}

function toMbps(value?: number): number {
  return Math.max(0, Number(value ?? 0) / 1024 / 1024);
}

function isRunaway(item: ProcessSample): boolean {
  return (
    safePercent(item.cpuPct) >= 85 ||
    Number(item.workingSetBytes ?? 0) >= 1_500 * 1024 * 1024 ||
    toMbps(item.diskWriteBytesPerSec) >= 50
  );
}

function processKey(item: ProcessSample): string {
  return `${item.pid}-${item.processName}`;
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

export function ProcessesView() {
  const latest = useAppStore((state) => state.latestPerformanceFrame);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProcessSortKey>("cpu_desc");
  const [minCpuPct, setMinCpuPct] = useState("0");
  const [minRamMb, setMinRamMb] = useState("0");
  const [minDiskWriteMbps, setMinDiskWriteMbps] = useState("0");
  const [minGpuPct, setMinGpuPct] = useState("0");
  const [runawayOnly, setRunawayOnly] = useState(false);
  const [showPathColumn, setShowPathColumn] = useState(false);
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [showInsights, setShowInsights] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [showTable, setShowTable] = useState(true);
  const [compactRows, setCompactRows] = useState(false);
  const [batchSize, setBatchSize] = useState(PROCESS_PAGE_SIZE);
  const [renderLimit, setRenderLimit] = useState(PROCESS_PAGE_SIZE);
  const [selectedProcessKeys, setSelectedProcessKeys] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROCESSES_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<ProcessesViewPrefs>;
      if (parsed.sortKey) {
        setSortKey(parsed.sortKey);
      }
      if (typeof parsed.minCpuPct === "string") {
        setMinCpuPct(parsed.minCpuPct);
      }
      if (typeof parsed.minRamMb === "string") {
        setMinRamMb(parsed.minRamMb);
      }
      if (typeof parsed.minDiskWriteMbps === "string") {
        setMinDiskWriteMbps(parsed.minDiskWriteMbps);
      }
      if (typeof parsed.minGpuPct === "string") {
        setMinGpuPct(parsed.minGpuPct);
      }
      if (typeof parsed.runawayOnly === "boolean") {
        setRunawayOnly(parsed.runawayOnly);
      }
      if (typeof parsed.showPathColumn === "boolean") {
        setShowPathColumn(parsed.showPathColumn);
      }
      if (typeof parsed.showInsights === "boolean") {
        setShowInsights(parsed.showInsights);
      }
      if (typeof parsed.showFilters === "boolean") {
        setShowFilters(parsed.showFilters);
      }
      if (typeof parsed.showTable === "boolean") {
        setShowTable(parsed.showTable);
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
      // Ignore invalid preferences.
    }
  }, []);

  useEffect(() => {
    try {
      const payload: ProcessesViewPrefs = {
        sortKey,
        minCpuPct,
        minRamMb,
        minDiskWriteMbps,
        minGpuPct,
        runawayOnly,
        showPathColumn,
        showInsights,
        showFilters,
        showTable,
        compactRows,
        batchSize
      };
      window.localStorage.setItem(PROCESSES_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write issues.
    }
  }, [batchSize, compactRows, minCpuPct, minDiskWriteMbps, minGpuPct, minRamMb, runawayOnly, showFilters, showInsights, showPathColumn, showTable, sortKey]);

  const topProcesses = latest?.topProcesses ?? [];
  const parsedMinCpu = Math.max(0, Number(minCpuPct) || 0);
  const parsedMinRamMb = Math.max(0, Number(minRamMb) || 0);
  const parsedMinDiskWriteMbps = Math.max(0, Number(minDiskWriteMbps) || 0);
  const parsedMinGpuPct = Math.max(0, Number(minGpuPct) || 0);
  const selectedKeySet = useMemo(() => new Set(selectedProcessKeys), [selectedProcessKeys]);

  const filteredProcesses = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const filtered = topProcesses.filter((item) => {
      if (runawayOnly && !isRunaway(item)) {
        return false;
      }
      if (safePercent(item.cpuPct) < parsedMinCpu) {
        return false;
      }
      if (toMb(item.workingSetBytes) < parsedMinRamMb) {
        return false;
      }
      if (toMbps(item.diskWriteBytesPerSec) < parsedMinDiskWriteMbps) {
        return false;
      }
      if (safePercent(item.gpuPct) < parsedMinGpuPct) {
        return false;
      }
      if (showOnlySelected && !selectedKeySet.has(processKey(item))) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = `${item.processName} ${item.pid} ${item.executablePath ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return [...filtered].sort((left, right) => {
      if (sortKey === "cpu_desc") {
        return safePercent(right.cpuPct) - safePercent(left.cpuPct);
      }
      if (sortKey === "ram_desc") {
        return Number(right.workingSetBytes ?? 0) - Number(left.workingSetBytes ?? 0);
      }
      if (sortKey === "disk_desc") {
        return Number(right.diskWriteBytesPerSec ?? 0) - Number(left.diskWriteBytesPerSec ?? 0);
      }
      if (sortKey === "gpu_desc") {
        return safePercent(right.gpuPct) - safePercent(left.gpuPct);
      }
      if (sortKey === "impact_desc") {
        const leftImpact = safePercent(left.cpuPct) * 1.5 + toMb(left.workingSetBytes) / 128 + toMbps(left.diskWriteBytesPerSec) * 2 + safePercent(left.gpuPct) * 1.2;
        const rightImpact = safePercent(right.cpuPct) * 1.5 + toMb(right.workingSetBytes) / 128 + toMbps(right.diskWriteBytesPerSec) * 2 + safePercent(right.gpuPct) * 1.2;
        return rightImpact - leftImpact;
      }
      if (sortKey === "pid_asc") {
        return left.pid - right.pid;
      }
      return left.processName.localeCompare(right.processName) || left.pid - right.pid;
    });
  }, [
    deferredQuery,
    parsedMinCpu,
    parsedMinDiskWriteMbps,
    parsedMinGpuPct,
    parsedMinRamMb,
    runawayOnly,
    selectedKeySet,
    showOnlySelected,
    sortKey,
    topProcesses
  ]);

  const visibleProcesses = useMemo(() => filteredProcesses.slice(0, renderLimit), [filteredProcesses, renderLimit]);
  const hasMore = visibleProcesses.length < filteredProcesses.length;
  const processRowHeight = compactRows ? 34 : 44;
  const {
    viewportRef: processViewportRef,
    onScroll: onProcessTableScroll,
    startIndex: processStartIndex,
    endIndex: processEndIndex,
    padTop: processPadTop,
    padBottom: processPadBottom
  } = useVirtualRows({
    itemCount: visibleProcesses.length,
    rowHeight: processRowHeight,
    overscan: 12,
    defaultViewportHeight: 560
  });
  const virtualProcesses = useMemo(
    () => visibleProcesses.slice(processStartIndex, processEndIndex),
    [processEndIndex, processStartIndex, visibleProcesses]
  );

  useEffect(() => {
    setRenderLimit(batchSize);
  }, [batchSize, query, sortKey, minCpuPct, minRamMb, minDiskWriteMbps, minGpuPct, runawayOnly, showOnlySelected]);

  useEffect(() => {
    setSelectedProcessKeys((current) =>
      current.filter((key) => topProcesses.some((item) => processKey(item) === key))
    );
  }, [topProcesses]);

  const runawayCount = useMemo(() => filteredProcesses.filter((item) => isRunaway(item)).length, [filteredProcesses]);
  const cpuTotalPct = useMemo(
    () => filteredProcesses.reduce((sum, item) => sum + safePercent(item.cpuPct), 0),
    [filteredProcesses]
  );
  const ramTotalMb = useMemo(
    () => filteredProcesses.reduce((sum, item) => sum + toMb(item.workingSetBytes), 0),
    [filteredProcesses]
  );
  const diskTotalMbps = useMemo(
    () => filteredProcesses.reduce((sum, item) => sum + toMbps(item.diskWriteBytesPerSec), 0),
    [filteredProcesses]
  );

  const copyProcessPath = async (path?: string) => {
    if (!path) {
      setStatus("No executable path available for this process.");
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setStatus("Process path copied to clipboard.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy process path.");
    }
  };

  const copySelectedProcessPaths = async () => {
    const selected = filteredProcesses.filter((item) => selectedKeySet.has(processKey(item)));
    if (!selected.length) {
      setStatus("No selected processes to copy.");
      return;
    }
    const payload = selected
      .map((item) => `${item.processName}\t${item.pid}\t${item.executablePath ?? ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setStatus(`Copied ${selected.length} selected process entries.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy selected process entries.");
    }
  };

  const exportVisibleProcesses = () => {
    if (!visibleProcesses.length) {
      setStatus("No visible processes to export.");
      return;
    }
    const rows = [
      ["processName", "pid", "cpuPct", "ramMb", "diskWriteMbPerSec", "diskReadMbPerSec", "gpuPct", "path"],
      ...visibleProcesses.map((item) => [
        item.processName,
        String(item.pid),
        String(Math.round(safePercent(item.cpuPct))),
        String(toMb(item.workingSetBytes)),
        String(toMbps(item.diskWriteBytesPerSec).toFixed(2)),
        String(toMbps(item.diskReadBytesPerSec).toFixed(2)),
        String(Math.round(safePercent(item.gpuPct))),
        item.executablePath ?? ""
      ])
    ];
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-processes-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${visibleProcesses.length} visible process entries.`);
  };

  const { topCpu, topRam, topDisk, topGpu } = useMemo(() => {
    let cpuLeader: ProcessSample | undefined;
    let ramLeader: ProcessSample | undefined;
    let diskLeader: ProcessSample | undefined;
    let gpuLeader: ProcessSample | undefined;
    for (const item of filteredProcesses) {
      if (!cpuLeader || safePercent(item.cpuPct) > safePercent(cpuLeader.cpuPct)) {
        cpuLeader = item;
      }
      if (!ramLeader || Number(item.workingSetBytes ?? 0) > Number(ramLeader.workingSetBytes ?? 0)) {
        ramLeader = item;
      }
      if (!diskLeader || Number(item.diskWriteBytesPerSec ?? 0) > Number(diskLeader.diskWriteBytesPerSec ?? 0)) {
        diskLeader = item;
      }
      if (!gpuLeader || safePercent(item.gpuPct) > safePercent(gpuLeader.gpuPct)) {
        gpuLeader = item;
      }
    }
    return {
      topCpu: cpuLeader,
      topRam: ramLeader,
      topDisk: diskLeader,
      topGpu: gpuLeader
    };
  }, [filteredProcesses]);

  const renderInsight = (label: string, process?: ProcessSample, value = "") => (
    <article className="mini-card">
      <small>{label}</small>
      <strong>{process ? process.processName : "N/A"}</strong>
      <span className="muted">{process ? value : "No process data"}</span>
    </article>
  );

  return (
    <article className="card">
      <div className="panel-header compact">
        <div>
          <h3>Live Process Profiler</h3>
          <p className="muted">
            {filteredProcesses.length}/{topProcesses.length} visible, {runawayCount} runaway, {selectedProcessKeys.length} selected
          </p>
        </div>
      </div>
      {status ? <div className="callout"><strong>Process action</strong><span>{status}</span></div> : null}

      <div className="row wrap">
        <button className="btn secondary tiny" onClick={() => setShowInsights((current) => !current)}>
          {showInsights ? "Hide Insights" : "Show Insights"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowFilters((current) => !current)}>
          {showFilters ? "Hide Filters" : "Show Filters"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowTable((current) => !current)}>
          {showTable ? "Hide Table" : "Show Table"}
        </button>
        <button className="btn secondary tiny" onClick={() => setCompactRows((current) => !current)}>
          {compactRows ? "Comfort Rows" : "Compact Rows"}
        </button>
      </div>

      {showInsights ? (
        <div className="process-insight-row">
          {renderInsight("Top CPU", topCpu, `${Math.round(safePercent(topCpu?.cpuPct))}% CPU`)}
          {renderInsight("Top RAM", topRam, `${toMb(topRam?.workingSetBytes)} MB RAM`)}
          {renderInsight("Top Disk", topDisk, `${toMbps(topDisk?.diskWriteBytesPerSec).toFixed(1)} MB/s write`)}
          {renderInsight("Top GPU", topGpu, `${Math.round(safePercent(topGpu?.gpuPct))}% GPU`)}
          <article className="mini-card">
            <small>Visible aggregate</small>
            <strong>CPU {Math.round(cpuTotalPct)}%</strong>
            <span className="muted">RAM {Math.round(ramTotalMb)} MB / Disk {diskTotalMbps.toFixed(1)} MB/s</span>
          </article>
        </div>
      ) : null}

      {showFilters ? (
        <div className="process-filter-row sticky-action-row">
        <div className="process-filter-grid">
          <label>
            Search
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="process, pid, path..." />
          </label>
          <label>
            Min CPU %
            <input type="number" min={0} max={100} value={minCpuPct} onChange={(event) => setMinCpuPct(event.target.value)} />
          </label>
          <label>
            Min RAM MB
            <input type="number" min={0} value={minRamMb} onChange={(event) => setMinRamMb(event.target.value)} />
          </label>
          <label>
            Min Disk MB/s
            <input type="number" min={0} step={0.5} value={minDiskWriteMbps} onChange={(event) => setMinDiskWriteMbps(event.target.value)} />
          </label>
          <label>
            Min GPU %
            <input type="number" min={0} max={100} value={minGpuPct} onChange={(event) => setMinGpuPct(event.target.value)} />
          </label>
          <label>
            Sort
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as ProcessSortKey)}>
              <option value="cpu_desc">CPU high to low</option>
              <option value="ram_desc">RAM high to low</option>
              <option value="disk_desc">Disk write high to low</option>
              <option value="gpu_desc">GPU high to low</option>
              <option value="impact_desc">Composite impact</option>
              <option value="name_asc">Name A to Z</option>
              <option value="pid_asc">PID</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={runawayOnly} onChange={(event) => setRunawayOnly(event.target.checked)} />
            Runaway only
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showOnlySelected} onChange={(event) => setShowOnlySelected(event.target.checked)} />
            Selected only
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showPathColumn} onChange={(event) => setShowPathColumn(event.target.checked)} />
            Show path column
          </label>
          <label>
            Batch size
            <select value={batchSize} onChange={(event) => setBatchSize(Math.max(20, Number(event.target.value) || PROCESS_PAGE_SIZE))}>
              <option value={40}>40</option>
              <option value={60}>60</option>
              <option value={100}>100</option>
              <option value={150}>150</option>
            </select>
          </label>
        </div>
        <div className="row wrap">
          <button className="btn secondary" onClick={() => {
            setMinCpuPct("0");
            setMinRamMb("0");
            setMinDiskWriteMbps("0");
            setMinGpuPct("0");
            setRunawayOnly(false);
            setShowOnlySelected(false);
            setBatchSize(PROCESS_PAGE_SIZE);
            setStatus("Process filters reset.");
          }}>
            Reset Filters
          </button>
          <button className="btn secondary" onClick={() => setSelectedProcessKeys(visibleProcesses.map((item) => processKey(item)))} disabled={!visibleProcesses.length}>
            Select Visible
          </button>
          <button className="btn secondary" onClick={() => setSelectedProcessKeys([])} disabled={!selectedProcessKeys.length}>
            Clear Selection
          </button>
          <button className="btn secondary" onClick={() => void copySelectedProcessPaths()} disabled={!selectedProcessKeys.length}>
            Copy Selected
          </button>
          <button className="btn secondary" onClick={exportVisibleProcesses} disabled={!visibleProcesses.length}>
            Export Visible CSV
          </button>
        </div>
        </div>
      ) : null}

      {showTable && visibleProcesses.length ? (
        <div className="table-wrap" ref={processViewportRef} onScroll={onProcessTableScroll} style={{ height: 560, overflowY: "auto" }}>
          <table className={compactRows ? "table table-compact" : "table"}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Process</th>
                <th>PID</th>
                <th>CPU</th>
                <th>RAM</th>
                <th>Disk Write</th>
                <th>Disk Read</th>
                <th>GPU</th>
                {showPathColumn ? <th>Path</th> : null}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {processPadTop > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={showPathColumn ? 10 : 9} style={{ height: processPadTop, padding: 0, border: 0 }} />
                </tr>
              ) : null}
              {virtualProcesses.map((item) => {
                const runaway = isRunaway(item);
                const key = processKey(item);
                return (
                  <tr key={key} className={runaway ? "row-runaway" : ""}>
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={selectedKeySet.has(key)}
                          onChange={() => {
                            setSelectedProcessKeys((current) =>
                              current.includes(key) ? current.filter((value) => value !== key) : [...current, key]
                            );
                          }}
                        />
                      </label>
                    </td>
                    <td title={item.executablePath}>{item.processName}</td>
                    <td>{item.pid}</td>
                    <td>{Math.round(safePercent(item.cpuPct))}%</td>
                    <td>{toMb(item.workingSetBytes)} MB</td>
                    <td>{toMbps(item.diskWriteBytesPerSec).toFixed(2)} MB/s</td>
                    <td>{toMbps(item.diskReadBytesPerSec).toFixed(2)} MB/s</td>
                    <td>{item.gpuPct === undefined ? "-" : `${Math.round(item.gpuPct)}%`}</td>
                    {showPathColumn ? <td title={item.executablePath}>{item.executablePath ?? "-"}</td> : null}
                    <td>
                      <div className="row wrap">
                        <button className="btn secondary tiny" onClick={() => void copyProcessPath(item.executablePath)}>
                          Copy Path
                        </button>
                        <button
                          className="btn secondary tiny"
                          onClick={() => {
                            void navigator.clipboard.writeText(String(item.pid)).then(() => {
                              setStatus(`PID ${item.pid} copied.`);
                            });
                          }}
                        >
                          Copy PID
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {processPadBottom > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={showPathColumn ? 10 : 9} style={{ height: processPadBottom, padding: 0, border: 0 }} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {showTable ? "Start performance monitoring to see live process rankings." : "Process table hidden for focus mode."}
        </p>
      )}

      {showTable && hasMore ? (
        <div className="footer-actions">
          <button className="btn secondary" onClick={() => setRenderLimit((current) => current + batchSize)}>
            Show More Processes
          </button>
        </div>
      ) : null}
    </article>
  );
}
