import React, { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { LivePerformanceFrame, ProcessSample, SystemSnapshotHistoryPoint } from "../../types";
import { MetricCard } from "./components/MetricCard";
import { MetricLineChart } from "./components/MetricLineChart";
import {
  AlertThresholds,
  DashboardWindowKey,
  buildPerformanceIncidents,
  buildTopDegraders,
  compareSnapshots,
  filterFramesByWindow,
  processSignature,
  recommendMonitorInterval,
  summarizePinnedProcess
} from "./dashboardUtils";

function toPct(value?: number): string {
  return value === undefined ? "N/A" : `${Math.round(value)}%`;
}

function toDelta(value?: number): string {
  if (value === undefined) {
    return "N/A";
  }
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} pts`;
}

function toMbps(value?: number): string {
  if (value === undefined) {
    return "N/A";
  }
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB/s`;
}

function stats(values: number[]): { avg?: number; min?: number; max?: number; p95?: number } {
  if (!values.length) {
    return {};
  }
  const sorted = [...values].sort((left, right) => left - right);
  const percentileIndex = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)));
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[percentileIndex]
  };
}

type ConsumerSort = "cpu" | "ram" | "disk";

interface DashboardViewPrefs {
  windowKey: DashboardWindowKey;
  consumerSort: ConsumerSort;
  consumerQuery: string;
  consumerMinImpact: string;
  runawayOnly: boolean;
  showStory: boolean;
  showCharts: boolean;
  showConsumers: boolean;
  showSignals: boolean;
  showWatchlist: boolean;
  showAlerts: boolean;
  freezeVisuals: boolean;
  alertThresholds: AlertThresholds;
}

const DASHBOARD_PREFS_KEY = "cleanup-pilot.performanceDashboardPrefs.v3";
const DASHBOARD_WATCHLIST_KEY = "cleanup-pilot.performanceWatchlist.v1";
const DASHBOARD_INCIDENT_HISTORY_KEY = "cleanup-pilot.performanceIncidentHistory.v1";
const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  cpuPct: 85,
  ramPct: 85,
  diskPct: 80,
  stalledMs: 7000
};
const WINDOW_OPTIONS: DashboardWindowKey[] = ["30s", "2m", "5m", "15m", "session"];

function mapSnapshotToHistoryPoint(snapshot: ReturnType<typeof useAppStore.getState>["latestSnapshot"]): SystemSnapshotHistoryPoint | null {
  if (!snapshot) {
    return null;
  }
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    source: snapshot.source,
    primaryBottleneck: snapshot.bottleneck.primary,
    cpuAvgPct: snapshot.cpu.avgUsagePct,
    ramUsedPct: snapshot.memory.usedPct,
    diskActivePct: snapshot.diskIo.activeTimePct,
    gpuPct: snapshot.gpu.totalUsagePct,
    startupImpactScore: snapshot.startup.impactScore
  };
}

function processKey(item: ProcessSample): string {
  return `${item.pid}-${item.processName}`;
}

export function DashboardView() {
  const frames = useAppStore((state) => state.performanceFrames);
  const latestSnapshot = useAppStore((state) => state.latestSnapshot);
  const driverSummary = useAppStore((state) => state.driverPerformanceSummary);
  const capabilities = useAppStore((state) => state.monitorCapabilities);
  const monitorAverageGapMs = useAppStore((state) => state.monitorAverageGapMs);
  const monitorDroppedFrameCount = useAppStore((state) => state.monitorDroppedFrameCount);
  const monitorSampleIntervalMs = useAppStore((state) => state.monitorSampleIntervalMs);
  const historySnapshots = useAppStore((state) => state.historySnapshots);
  const historyLoading = useAppStore((state) => state.historyLoading);
  const loadHistory = useAppStore((state) => state.loadHistory);
  const setActivePerformanceView = useAppStore((state) => state.setActivePerformanceView);

  const [windowKey, setWindowKey] = useState<DashboardWindowKey>("5m");
  const [consumerSort, setConsumerSort] = useState<ConsumerSort>("cpu");
  const [consumerQuery, setConsumerQuery] = useState("");
  const [consumerMinImpact, setConsumerMinImpact] = useState("0");
  const [consumerLimit, setConsumerLimit] = useState(6);
  const [runawayOnly, setRunawayOnly] = useState(false);
  const [showStory, setShowStory] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [showConsumers, setShowConsumers] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [showAlerts, setShowAlerts] = useState(true);
  const [freezeVisuals, setFreezeVisuals] = useState(false);
  const [frozenFrames, setFrozenFrames] = useState<LivePerformanceFrame[] | null>(null);
  const [pinnedProcessSignatures, setPinnedProcessSignatures] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_WATCHLIST_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const [alertThresholds, setAlertThresholds] = useState<AlertThresholds>(DEFAULT_ALERT_THRESHOLDS);
  const [incidentHistory, setIncidentHistory] = useState<Array<{ id: string; label: string; severity: string; endedAt: number; peakValue: number }>>(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_INCIDENT_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
    } catch {
      return [];
    }
  });
  const [status, setStatus] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DASHBOARD_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DashboardViewPrefs>;
      if (parsed.windowKey && WINDOW_OPTIONS.includes(parsed.windowKey)) {
        setWindowKey(parsed.windowKey);
      }
      if (parsed.consumerSort === "cpu" || parsed.consumerSort === "ram" || parsed.consumerSort === "disk") {
        setConsumerSort(parsed.consumerSort);
      }
      if (typeof parsed.consumerQuery === "string") {
        setConsumerQuery(parsed.consumerQuery);
      }
      if (typeof parsed.consumerMinImpact === "string") {
        setConsumerMinImpact(parsed.consumerMinImpact);
      }
      if (typeof parsed.runawayOnly === "boolean") {
        setRunawayOnly(parsed.runawayOnly);
      }
      if (typeof parsed.showStory === "boolean") {
        setShowStory(parsed.showStory);
      }
      if (typeof parsed.showCharts === "boolean") {
        setShowCharts(parsed.showCharts);
      }
      if (typeof parsed.showConsumers === "boolean") {
        setShowConsumers(parsed.showConsumers);
      }
      if (typeof parsed.showSignals === "boolean") {
        setShowSignals(parsed.showSignals);
      }
      if (typeof parsed.showWatchlist === "boolean") {
        setShowWatchlist(parsed.showWatchlist);
      }
      if (typeof parsed.showAlerts === "boolean") {
        setShowAlerts(parsed.showAlerts);
      }
      if (typeof parsed.freezeVisuals === "boolean") {
        setFreezeVisuals(parsed.freezeVisuals);
      }
      if (parsed.alertThresholds) {
        setAlertThresholds({
          cpuPct: Math.max(50, Number(parsed.alertThresholds.cpuPct) || DEFAULT_ALERT_THRESHOLDS.cpuPct),
          ramPct: Math.max(50, Number(parsed.alertThresholds.ramPct) || DEFAULT_ALERT_THRESHOLDS.ramPct),
          diskPct: Math.max(40, Number(parsed.alertThresholds.diskPct) || DEFAULT_ALERT_THRESHOLDS.diskPct),
          stalledMs: Math.max(2000, Number(parsed.alertThresholds.stalledMs) || DEFAULT_ALERT_THRESHOLDS.stalledMs)
        });
      }
    } catch {
      // Ignore invalid persisted dashboard preferences.
    }
  }, []);

  useEffect(() => {
    try {
      const payload: DashboardViewPrefs = {
        windowKey,
        consumerSort,
        consumerQuery,
        consumerMinImpact,
        runawayOnly,
        showStory,
        showCharts,
        showConsumers,
        showSignals,
        showWatchlist,
        showAlerts,
        freezeVisuals,
        alertThresholds
      };
      window.localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage write issues.
    }
  }, [
    alertThresholds,
    consumerMinImpact,
    consumerQuery,
    consumerSort,
    freezeVisuals,
    runawayOnly,
    showAlerts,
    showCharts,
    showConsumers,
    showSignals,
    showStory,
    showWatchlist,
    windowKey
  ]);

  useEffect(() => {
    if (!historySnapshots.length && !historyLoading) {
      void loadHistory();
    }
  }, [historyLoading, historySnapshots.length, loadHistory]);

  useEffect(() => {
    if (freezeVisuals) {
      setFrozenFrames((current) => current ?? frames);
      return;
    }
    setFrozenFrames(null);
  }, [frames, freezeVisuals]);

  const sourceFrames = freezeVisuals ? frozenFrames ?? frames : frames;
  const visibleFrames = useMemo(() => filterFramesByWindow(sourceFrames, windowKey), [sourceFrames, windowKey]);
  const latestFrame = visibleFrames[visibleFrames.length - 1] ?? sourceFrames[sourceFrames.length - 1];

  const chartSeries = useMemo(
    () => ({
      cpu: visibleFrames.map((item) => ({ capturedAt: item.capturedAt, value: item.cpuUsagePct })),
      ram: visibleFrames.map((item) => ({ capturedAt: item.capturedAt, value: item.ramUsedPct })),
      disk: visibleFrames.map((item) => ({ capturedAt: item.capturedAt, value: item.diskActivePct })),
      gpu: visibleFrames.map((item) => ({ capturedAt: item.capturedAt, value: item.gpuUsagePct })),
      networkSend: visibleFrames.map((item) => ({ capturedAt: item.capturedAt, value: item.networkSendBytesPerSec ? item.networkSendBytesPerSec / 1024 / 1024 : undefined })),
      networkReceive: visibleFrames.map((item) => ({ capturedAt: item.capturedAt, value: item.networkReceiveBytesPerSec ? item.networkReceiveBytesPerSec / 1024 / 1024 : undefined }))
    }),
    [visibleFrames]
  );

  const sortedConsumers = useMemo(() => {
    const list = [...(latestFrame?.topProcesses ?? [])];
    if (consumerSort === "cpu") {
      return list.sort((left, right) => Number(right.cpuPct ?? 0) - Number(left.cpuPct ?? 0));
    }
    if (consumerSort === "ram") {
      return list.sort((left, right) => Number(right.workingSetBytes ?? 0) - Number(left.workingSetBytes ?? 0));
    }
    return list.sort((left, right) => Number(right.diskWriteBytesPerSec ?? 0) - Number(left.diskWriteBytesPerSec ?? 0));
  }, [consumerSort, latestFrame]);

  const filteredConsumers = useMemo(() => {
    const query = consumerQuery.trim().toLowerCase();
    const minImpact = Math.max(0, Number(consumerMinImpact) || 0);
    const impactScore = (item: ProcessSample) =>
      Number(item.cpuPct ?? 0) * 1.5 +
      Number(item.workingSetBytes ?? 0) / 1024 / 1024 / 128 +
      (Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024) * 2;

    return sortedConsumers.filter((item) => {
      const runaway =
        Number(item.cpuPct ?? 0) >= 85 ||
        Number(item.workingSetBytes ?? 0) >= 1500 * 1024 * 1024 ||
        Number(item.diskWriteBytesPerSec ?? 0) >= 50 * 1024 * 1024;
      if (runawayOnly && !runaway) {
        return false;
      }
      if (impactScore(item) < minImpact) {
        return false;
      }
      return query ? `${item.processName} ${item.pid}`.toLowerCase().includes(query) : true;
    });
  }, [consumerMinImpact, consumerQuery, runawayOnly, sortedConsumers]);

  const topConsumers = useMemo(() => filteredConsumers.slice(0, consumerLimit), [consumerLimit, filteredConsumers]);

  const cpuWindowStats = useMemo(() => stats(visibleFrames.map((item) => item.cpuUsagePct)), [visibleFrames]);
  const ramWindowStats = useMemo(() => stats(visibleFrames.map((item) => item.ramUsedPct)), [visibleFrames]);
  const diskWindowStats = useMemo(() => stats(visibleFrames.map((item) => item.diskActivePct)), [visibleFrames]);

  const incidents = useMemo(() => buildPerformanceIncidents(visibleFrames, alertThresholds), [alertThresholds, visibleFrames]);
  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_WATCHLIST_KEY, JSON.stringify(pinnedProcessSignatures.slice(0, 5)));
    } catch {
      // Ignore local storage write issues.
    }
  }, [pinnedProcessSignatures]);
  useEffect(() => {
    if (!incidents.length) {
      return;
    }
    setIncidentHistory((current) => {
      const merged = [...incidents, ...current.map((item) => ({
        id: item.id,
        kind: "cpu",
        label: item.label,
        severity: item.severity as "low" | "medium" | "high",
        startedAt: item.endedAt,
        endedAt: item.endedAt,
        durationMs: 0,
        peakValue: item.peakValue
      }))];
      const deduped = new Map<string, { id: string; label: string; severity: string; endedAt: number; peakValue: number }>();
      for (const item of merged) {
        deduped.set(item.id, {
          id: item.id,
          label: item.label,
          severity: item.severity,
          endedAt: item.endedAt,
          peakValue: item.peakValue
        });
      }
      const next = [...deduped.values()].sort((left, right) => right.endedAt - left.endedAt).slice(0, 20);
      try {
        window.localStorage.setItem(DASHBOARD_INCIDENT_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Ignore local storage write issues.
      }
      return next;
    });
  }, [incidents]);

  const currentHistoryPoint = useMemo(() => mapSnapshotToHistoryPoint(latestSnapshot), [latestSnapshot]);
  const previousHistoryPoint = useMemo(() => {
    if (!currentHistoryPoint) {
      return historySnapshots[0] ?? null;
    }
    return (
      historySnapshots
        .filter((item) => item.createdAt < currentHistoryPoint.createdAt)
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }, [currentHistoryPoint, historySnapshots]);
  const snapshotDelta = useMemo(
    () => compareSnapshots(currentHistoryPoint ?? undefined, previousHistoryPoint ?? undefined),
    [currentHistoryPoint, previousHistoryPoint]
  );
  const intervalRecommendation = useMemo(
    () =>
      recommendMonitorInterval({
        sampleIntervalMs: Math.max(500, monitorSampleIntervalMs || 2000),
        averageGapMs: monitorAverageGapMs,
        droppedFrameCount: monitorDroppedFrameCount,
        frameCount: visibleFrames.length
      }),
    [monitorAverageGapMs, monitorDroppedFrameCount, monitorSampleIntervalMs, visibleFrames.length]
  );
  const topDegraders = useMemo(
    () => buildTopDegraders({ frames: visibleFrames, driverSummary, historyDelta: snapshotDelta }),
    [driverSummary, snapshotDelta, visibleFrames]
  );
  const pinnedProcesses = useMemo(
    () =>
      pinnedProcessSignatures
        .map((signature) => summarizePinnedProcess(visibleFrames, signature))
        .filter(
          (
            item
          ): item is {
            signature: string;
            processName: string;
            latestCpuPct: number;
            latestRamMb: number;
            latestDiskMbps: number;
            sampleCount: number;
          } => Boolean(item)
        ),
    [pinnedProcessSignatures, visibleFrames]
  );

  const barMaxCpu = useMemo(() => Math.max(1, ...topConsumers.map((item) => Number(item.cpuPct ?? 0))), [topConsumers]);
  const barMaxRamMb = useMemo(
    () => Math.max(1, ...topConsumers.map((item) => Number(item.workingSetBytes ?? 0) / 1024 / 1024)),
    [topConsumers]
  );
  const barMaxDiskMb = useMemo(
    () => Math.max(1, ...topConsumers.map((item) => Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024)),
    [topConsumers]
  );

  const bottleneckRoute = latestSnapshot?.bottleneck.primary === "cpu"
    ? "processes"
    : latestSnapshot?.bottleneck.primary === "ram"
      ? "processes"
      : latestSnapshot?.bottleneck.primary === "disk_io"
        ? "processes"
        : latestSnapshot?.bottleneck.primary === "drivers"
          ? "doctor"
          : "dashboard";

  useEffect(() => {
    setConsumerLimit(6);
  }, [consumerSort, runawayOnly]);

  const exportVisibleConsumers = () => {
    if (!topConsumers.length) {
      return;
    }
    const rows = [
      ["processName", "pid", "cpuPct", "ramMb", "diskWriteMbPerSec"],
      ...topConsumers.map((item) => [
        item.processName,
        String(item.pid),
        String(Math.round(Number(item.cpuPct ?? 0))),
        String(Math.round(Number(item.workingSetBytes ?? 0) / 1024 / 1024)),
        String((Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024).toFixed(2))
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
            return `"${text.replace(/"/g, '""')}"`;
          })
          .join(",")
      )
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-consumers-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${topConsumers.length} consumers.`);
  };

  const copyVisibleConsumers = async () => {
    if (!topConsumers.length) {
      return;
    }
    const payload = topConsumers
      .map(
        (item) =>
          `${item.processName}\tPID ${item.pid}\tCPU ${Math.round(Number(item.cpuPct ?? 0))}%\tRAM ${Math.round(
            Number(item.workingSetBytes ?? 0) / 1024 / 1024
          )} MB`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setStatus(`Copied ${topConsumers.length} consumers.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Clipboard copy failed.");
    }
  };

  const togglePinProcess = (item: ProcessSample) => {
    const signature = processSignature(item);
    setPinnedProcessSignatures((current) =>
      current.includes(signature) ? current.filter((entry) => entry !== signature) : [...current, signature].slice(-5)
    );
  };

  return (
    <div className="grid performance-grid">
      <div className="row wrap performance-dashboard-toolbar">
        <div className="row wrap">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option}
              className={windowKey === option ? "pill active" : "pill"}
              onClick={() => setWindowKey(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button className="btn secondary tiny" onClick={() => setFreezeVisuals((current) => !current)}>
          {freezeVisuals ? "Resume Live View" : "Freeze View"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowStory((current) => !current)}>
          {showStory ? "Hide Story" : "Show Story"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowSignals((current) => !current)}>
          {showSignals ? "Hide Signals" : "Show Signals"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowCharts((current) => !current)}>
          {showCharts ? "Hide Charts" : "Show Charts"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowConsumers((current) => !current)}>
          {showConsumers ? "Hide Consumers" : "Show Consumers"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowWatchlist((current) => !current)}>
          {showWatchlist ? "Hide Watchlist" : "Show Watchlist"}
        </button>
        <button className="btn secondary tiny" onClick={() => setShowAlerts((current) => !current)}>
          {showAlerts ? "Hide Alerts" : "Show Alerts"}
        </button>
      </div>

      {showStory ? (
        <section className="performance-storyboard">
          <article className="card performance-story-card">
            <span className="eyebrow">Primary Read</span>
            <h3>{latestSnapshot ? latestSnapshot.bottleneck.primary : "Live monitor waiting"}</h3>
            <p className="muted">
              {latestSnapshot
                ? `System snapshot says ${latestSnapshot.bottleneck.primary} is leading the current slowdown profile.`
                : "Start the monitor and capture a snapshot to compare live pressure against historical diagnostics."}
            </p>
            <div className="row wrap">
              {latestSnapshot ? (
                <button className="btn secondary" onClick={() => setActivePerformanceView(bottleneckRoute)}>
                  Open Focus Workspace
                </button>
              ) : null}
              {previousHistoryPoint ? (
                <span className="origin-pill origin-neutral">
                  Previous snapshot {new Date(previousHistoryPoint.createdAt).toLocaleTimeString()}
                </span>
              ) : null}
              {freezeVisuals ? <span className="origin-pill origin-neutral">View frozen</span> : null}
            </div>
          </article>
          <article className="card performance-story-card is-secondary">
            <span className="eyebrow">Sampling Guidance</span>
            <h3>{Math.round(intervalRecommendation.intervalMs / 1000)}s interval</h3>
            <p className="muted">{intervalRecommendation.rationale}</p>
          </article>
        </section>
      ) : null}

      {status ? <div className="callout"><strong>Dashboard action</strong><span>{status}</span></div> : null}

      <div className="performance-card-grid">
        <MetricCard
          label="CPU Usage"
          value={toPct(latestFrame?.cpuUsagePct)}
          detail={snapshotDelta ? `Snapshot delta ${toDelta(snapshotDelta.cpuDeltaPct)}` : "Live monitor"}
          accent="cpu"
        />
        <MetricCard
          label="RAM Usage"
          value={toPct(latestFrame?.ramUsedPct)}
          detail={snapshotDelta ? `Snapshot delta ${toDelta(snapshotDelta.ramDeltaPct)}` : "Committed usage"}
          accent="ram"
        />
        <MetricCard
          label="Disk I/O"
          value={toPct(latestFrame?.diskActivePct)}
          detail={snapshotDelta ? `Snapshot delta ${toDelta(snapshotDelta.diskDeltaPct)}` : "Total disk active time"}
          accent="disk"
        />
        <MetricCard
          label="Driver Risk"
          value={driverSummary?.latencyRisk.toUpperCase() ?? "N/A"}
          detail={driverSummary ? `${driverSummary.suspectedDrivers.length} suspected drivers` : "Run diagnostics"}
          accent="driver"
        />
      </div>

      <div className="performance-card-grid">
        <article className="mini-card">
          <small>CPU window</small>
          <strong>
            {cpuWindowStats.avg === undefined
              ? "N/A"
              : `${Math.round(cpuWindowStats.avg)} / ${Math.round(cpuWindowStats.p95 ?? 0)} / ${Math.round(cpuWindowStats.max ?? 0)}%`}
          </strong>
          <span className="muted">avg / p95 / peak</span>
        </article>
        <article className="mini-card">
          <small>RAM window</small>
          <strong>
            {ramWindowStats.avg === undefined
              ? "N/A"
              : `${Math.round(ramWindowStats.avg)} / ${Math.round(ramWindowStats.p95 ?? 0)} / ${Math.round(ramWindowStats.max ?? 0)}%`}
          </strong>
          <span className="muted">avg / p95 / peak</span>
        </article>
        <article className="mini-card">
          <small>Disk window</small>
          <strong>
            {diskWindowStats.avg === undefined
              ? "N/A"
              : `${Math.round(diskWindowStats.avg)} / ${Math.round(diskWindowStats.p95 ?? 0)} / ${Math.round(diskWindowStats.max ?? 0)}%`}
          </strong>
          <span className="muted">avg / p95 / peak</span>
        </article>
        <article className="mini-card">
          <small>Samples</small>
          <strong>{visibleFrames.length}</strong>
          <span className="muted">{windowKey === "session" ? "Entire session" : `Window ${windowKey}`}</span>
        </article>
      </div>

      {showSignals ? (
        <section className="performance-signal-grid">
          <article className="card">
            <header className="panel-header compact">
              <h3>Session Signals</h3>
              <span className="muted">{topDegraders.length} degraders</span>
            </header>
            <div className="performance-signal-stack">
              <div className="performance-delta-grid">
                <article className="mini-card">
                  <small>CPU delta</small>
                  <strong>{toDelta(snapshotDelta?.cpuDeltaPct)}</strong>
                </article>
                <article className="mini-card">
                  <small>RAM delta</small>
                  <strong>{toDelta(snapshotDelta?.ramDeltaPct)}</strong>
                </article>
                <article className="mini-card">
                  <small>Disk delta</small>
                  <strong>{toDelta(snapshotDelta?.diskDeltaPct)}</strong>
                </article>
                <article className="mini-card">
                  <small>Startup delta</small>
                  <strong>{toDelta(snapshotDelta?.startupDeltaPct)}</strong>
                </article>
              </div>
              <div className="list compact">
                {topDegraders.length ? (
                  topDegraders.map((item) => (
                    <button
                      key={item.id}
                      className="performance-degrader-item"
                      onClick={() => setActivePerformanceView(item.route)}
                    >
                      <span className={`risk-pill ${item.tone}`}>{item.title}</span>
                      <span className="muted">{item.summary}</span>
                    </button>
                  ))
                ) : (
                  <p className="muted">No single degrader is dominating the live session right now.</p>
                )}
              </div>
            </div>
          </article>

          {showAlerts ? (
            <article className="card">
              <header className="panel-header compact">
                <h3>Incident Timeline</h3>
                <span className="muted">{incidents.length} alert event(s)</span>
              </header>
              <div className="performance-alert-settings">
                <label>
                  CPU %
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={alertThresholds.cpuPct}
                    onChange={(event) =>
                      setAlertThresholds((current) => ({ ...current, cpuPct: Math.max(50, Number(event.target.value) || current.cpuPct) }))
                    }
                  />
                </label>
                <label>
                  RAM %
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={alertThresholds.ramPct}
                    onChange={(event) =>
                      setAlertThresholds((current) => ({ ...current, ramPct: Math.max(50, Number(event.target.value) || current.ramPct) }))
                    }
                  />
                </label>
                <label>
                  Disk %
                  <input
                    type="number"
                    min={40}
                    max={100}
                    value={alertThresholds.diskPct}
                    onChange={(event) =>
                      setAlertThresholds((current) => ({ ...current, diskPct: Math.max(40, Number(event.target.value) || current.diskPct) }))
                    }
                  />
                </label>
              </div>
              <div className="performance-incident-list">
                {incidents.length ? (
                  incidents.slice(0, 8).map((incident) => (
                    <article key={incident.id} className="performance-incident-item">
                      <span className={`risk-pill tone-${incident.severity}`}>{incident.label}</span>
                      <strong>
                        {incident.kind === "monitor_stall"
                          ? `${Math.round(incident.peakValue)} ms gap`
                          : `${Math.round(incident.peakValue)}% peak`}
                      </strong>
                      <span className="muted">
                        {Math.max(1, Math.round(incident.durationMs / 1000))}s around {new Date(incident.startedAt).toLocaleTimeString()}
                      </span>
                    </article>
                  ))
                ) : (
                  <p className="muted">No incidents crossed the current thresholds in this time window.</p>
                )}
              </div>
              {incidentHistory.length ? (
                <details className="settings-advanced-panel">
                  <summary>Recent incident memory</summary>
                  <ul className="ai-compact-list">
                    {incidentHistory.slice(0, 6).map((incident) => (
                      <li key={incident.id}>
                        <span>{incident.label}</span>
                        <strong>{new Date(incident.endedAt).toLocaleTimeString()}</strong>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </article>
          ) : null}
        </section>
      ) : null}

      {showCharts ? (
        <>
          <div className="grid two-col performance-chart-grid">
            <MetricLineChart title="CPU" frames={chartSeries.cpu} color="#ff8a5b" />
            <MetricLineChart title="RAM" frames={chartSeries.ram} color="#61d0ff" />
            <MetricLineChart title="Disk I/O" frames={chartSeries.disk} color="#9ef085" />
            <MetricLineChart
              title="GPU"
              frames={chartSeries.gpu}
              color="#ffd166"
              unsupported={!capabilities?.gpuSupported}
              unsupportedLabel="GPU counters are not supported on this machine."
            />
          </div>
          <div className="grid two-col performance-chart-grid">
            <MetricLineChart
              title="Network Send"
              frames={chartSeries.networkSend}
              color="#84a8ff"
              unit=" MB/s"
              unsupported={!capabilities?.perProcessNetworkSupported}
              unsupportedLabel="Per-process network counters are not available here."
            />
            <MetricLineChart
              title="Network Receive"
              frames={chartSeries.networkReceive}
              color="#a78bfa"
              unit=" MB/s"
              unsupported={!capabilities?.perProcessNetworkSupported}
              unsupportedLabel="Per-process network counters are not available here."
            />
          </div>
        </>
      ) : null}

      {showWatchlist ? (
        <article className="card full">
          <header className="panel-header compact">
            <h3>Watchlist</h3>
            <span className="muted">{pinnedProcesses.length} pinned process{pinnedProcesses.length === 1 ? "" : "es"}</span>
          </header>
          {pinnedProcesses.length ? (
            <div className="performance-watchlist-grid">
              {pinnedProcesses.map((item) => (
                <article key={item.signature} className="mini-card">
                  <small>{item.processName}</small>
                  <strong>{Math.round(item.latestCpuPct)}% CPU</strong>
                  <span className="muted">
                    {Math.round(item.latestRamMb)} MB RAM / {item.latestDiskMbps.toFixed(1)} MB/s write
                  </span>
                  <button
                    className="btn secondary tiny"
                    onClick={() => setPinnedProcessSignatures((current) => current.filter((entry) => entry !== item.signature))}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">Pin processes from the consumer list to keep them visible across live updates.</p>
          )}
        </article>
      ) : null}

      {showConsumers ? (
        <article className="card full">
          <header className="panel-header compact">
            <h3>Top Resource Consumers</h3>
            <div className="row wrap">
              <label>
                Sort
                <select value={consumerSort} onChange={(event) => setConsumerSort(event.target.value as ConsumerSort)}>
                  <option value="cpu">CPU</option>
                  <option value="ram">RAM</option>
                  <option value="disk">Disk Write</option>
                </select>
              </label>
              <label>
                Filter
                <input
                  value={consumerQuery}
                  onChange={(event) => setConsumerQuery(event.target.value)}
                  placeholder="process or pid..."
                />
              </label>
              <label>
                Min impact
                <input
                  type="number"
                  min={0}
                  value={consumerMinImpact}
                  onChange={(event) => setConsumerMinImpact(event.target.value)}
                  placeholder="0"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={runawayOnly}
                  onChange={(event) => setRunawayOnly(event.target.checked)}
                />
                Runaway only
              </label>
              <button className="btn secondary" onClick={exportVisibleConsumers} disabled={!topConsumers.length}>
                Export CSV
              </button>
              <button className="btn secondary" onClick={() => void copyVisibleConsumers()} disabled={!topConsumers.length}>
                Copy Consumers
              </button>
              <button className="btn secondary" onClick={() => setActivePerformanceView("processes")}>
                Open Processes
              </button>
            </div>
          </header>
          {topConsumers.length ? (
            <div className="list">
              {topConsumers.map((item) => {
                const signature = processSignature(item);
                const pinned = pinnedProcessSignatures.includes(signature);
                return (
                  <div key={processKey(item)} className="heatmap-row">
                    <div>
                      <strong>{item.processName}</strong>
                      <p className="muted">PID {item.pid}</p>
                      <button className="btn secondary tiny" onClick={() => togglePinProcess(item)}>
                        {pinned ? "Unpin" : "Pin"}
                      </button>
                    </div>
                    <div className="heatmap-bars">
                      <span
                        className="bar cpu"
                        style={{ width: `${Math.min(100, (Number(item.cpuPct ?? 0) / barMaxCpu) * 100)}%` }}
                      >
                        CPU {Math.round(Number(item.cpuPct ?? 0))}%
                      </span>
                      <span
                        className="bar ram"
                        style={{ width: `${Math.min(100, ((Number(item.workingSetBytes ?? 0) / 1024 / 1024) / barMaxRamMb) * 100)}%` }}
                      >
                        RAM {Math.round(Number(item.workingSetBytes ?? 0) / 1024 / 1024)} MB
                      </span>
                      <span
                        className="bar disk"
                        style={{ width: `${Math.min(100, ((Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024) / barMaxDiskMb) * 100)}%` }}
                      >
                        Disk {Math.round(Number(item.diskWriteBytesPerSec ?? 0) / 1024 / 1024)} MB/s
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">Start monitoring to see the live top process heatmap.</p>
          )}
          {consumerLimit < filteredConsumers.length ? (
            <div className="footer-actions">
              <button className="btn secondary" onClick={() => setConsumerLimit((current) => current + 6)}>
                Show More Consumers
              </button>
            </div>
          ) : null}
        </article>
      ) : null}

      <article className="card">
        <header className="panel-header compact">
          <h3>Recent Session Change</h3>
          <span className="muted">
            {previousHistoryPoint ? `Against ${new Date(previousHistoryPoint.createdAt).toLocaleString()}` : "Waiting for history"}
          </span>
        </header>
        {snapshotDelta ? (
          <div className="performance-comparison-grid">
            <article className="mini-card">
              <small>Bottleneck</small>
              <strong>{snapshotDelta.bottleneckChanged ? "Changed" : "Stable"}</strong>
              <span className="muted">{latestSnapshot?.bottleneck.primary ?? "unknown"}</span>
            </article>
            <article className="mini-card">
              <small>CPU</small>
              <strong>{toDelta(snapshotDelta.cpuDeltaPct)}</strong>
            </article>
            <article className="mini-card">
              <small>RAM</small>
              <strong>{toDelta(snapshotDelta.ramDeltaPct)}</strong>
            </article>
            <article className="mini-card">
              <small>Disk</small>
              <strong>{toDelta(snapshotDelta.diskDeltaPct)}</strong>
            </article>
          </div>
        ) : (
          <p className="muted">Capture snapshots over time to unlock before/after comparisons.</p>
        )}
        {latestFrame ? (
          <p className="muted">
            Live network {toMbps(latestFrame.networkSendBytesPerSec)} send / {toMbps(latestFrame.networkReceiveBytesPerSec)} receive.
          </p>
        ) : null}
      </article>
    </div>
  );
}
