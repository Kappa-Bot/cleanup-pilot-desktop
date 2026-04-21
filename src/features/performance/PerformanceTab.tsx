import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../store";
import {
  PERFORMANCE_TAB_PREFS_KEY,
  buildPerformanceTabPrefsPayload,
  clampPerformanceSampleInterval,
  parsePerformanceTabPrefs
} from "./performanceTabPrefs";

const DashboardView = lazy(() => import("./DashboardView").then((module) => ({ default: module.DashboardView })));
const StartupView = lazy(() => import("./StartupView").then((module) => ({ default: module.StartupView })));
const ProcessesView = lazy(() => import("./ProcessesView").then((module) => ({ default: module.ProcessesView })));
const ServicesView = lazy(() => import("./ServicesView").then((module) => ({ default: module.ServicesView })));
const TasksView = lazy(() => import("./TasksView").then((module) => ({ default: module.TasksView })));
const DoctorView = lazy(() => import("./DoctorView").then((module) => ({ default: module.DoctorView })));
const HistoryView = lazy(() => import("./HistoryView").then((module) => ({ default: module.HistoryView })));

interface PerformanceTabProps {
  sampleIntervalMs: number;
  pinnedMonitoring: boolean;
  onStatusChange?: (message: string) => void;
}

const views: Array<{ id: ReturnType<typeof useAppStore.getState>["activePerformanceView"]; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "startup", label: "Startup" },
  { id: "processes", label: "Processes" },
  { id: "services", label: "Services" },
  { id: "tasks", label: "Tasks" },
  { id: "doctor", label: "Doctor" },
  { id: "history", label: "History" }
];

const DRIVER_SUMMARY_VIEWS = new Set<ReturnType<typeof useAppStore.getState>["activePerformanceView"]>([
  "dashboard",
  "startup",
  "doctor"
]);

export function PerformanceTab({ sampleIntervalMs, pinnedMonitoring, onStatusChange }: PerformanceTabProps) {
  const activeView = useAppStore((state) => state.activePerformanceView);
  const setView = useAppStore((state) => state.setActivePerformanceView);
  const isMonitoring = useAppStore((state) => state.isMonitoring);
  const isLoading = useAppStore((state) => state.performanceLoading);
  const performanceError = useAppStore((state) => state.performanceError);
  const monitorSampleIntervalMs = useAppStore((state) => state.monitorSampleIntervalMs);
  const monitorRestartCount = useAppStore((state) => state.monitorRestartCount);
  const monitorDroppedFrameCount = useAppStore((state) => state.monitorDroppedFrameCount);
  const monitorLastGapMs = useAppStore((state) => state.monitorLastGapMs);
  const monitorAverageGapMs = useAppStore((state) => state.monitorAverageGapMs);
  const monitorMaxGapMs = useAppStore((state) => state.monitorMaxGapMs);
  const monitorSyncCount = useAppStore((state) => state.monitorSyncCount);
  const monitorLastSyncAt = useAppStore((state) => state.monitorLastSyncAt);
  const monitorLastSyncAddedFrames = useAppStore((state) => state.monitorLastSyncAddedFrames);
  const performanceFrameCount = useAppStore((state) => state.performanceFrames.length);
  const lastPerformanceFrameAt = useAppStore((state) => state.lastPerformanceFrameAt);
  const startMonitoring = useAppStore((state) => state.startMonitoring);
  const recoverMonitoring = useAppStore((state) => state.recoverMonitoring);
  const syncMonitoringSession = useAppStore((state) => state.syncMonitoringSession);
  const stopMonitoring = useAppStore((state) => state.stopMonitoring);
  const captureSnapshot = useAppStore((state) => state.captureSnapshot);
  const loadDriverPerformance = useAppStore((state) => state.loadDriverPerformance);
  const latestSnapshot = useAppStore((state) => state.latestSnapshot);
  const driverSummary = useAppStore((state) => state.driverPerformanceSummary);
  const latestFrame = useAppStore((state) => state.latestPerformanceFrame);
  const capabilities = useAppStore((state) => state.monitorCapabilities);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [autoRecoverEnabled, setAutoRecoverEnabled] = useState(true);
  const [lastAutoRecoverAt, setLastAutoRecoverAt] = useState(0);
  const [pendingSampleIntervalMs, setPendingSampleIntervalMs] = useState(() => String(sampleIntervalMs));
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showHeroStrip, setShowHeroStrip] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible"
  );
  const bootstrapTokenRef = useRef(0);
  const persistedPrefsRef = useRef("");

  useEffect(() => {
    const rawPrefs = window.localStorage.getItem(PERFORMANCE_TAB_PREFS_KEY);
    persistedPrefsRef.current = rawPrefs ?? "";
    const prefs = parsePerformanceTabPrefs(rawPrefs);
    if (!prefs) {
      return;
    }
    if (typeof prefs.autoRecoverEnabled === "boolean") {
      setAutoRecoverEnabled(prefs.autoRecoverEnabled);
    }
    if (typeof prefs.showAdvancedControls === "boolean") {
      setShowAdvancedControls(prefs.showAdvancedControls);
    }
    if (typeof prefs.showHeroStrip === "boolean") {
      setShowHeroStrip(prefs.showHeroStrip);
    }
    if (typeof prefs.preferredSampleIntervalMs === "number") {
      setPendingSampleIntervalMs(String(prefs.preferredSampleIntervalMs));
    }
    if (prefs.preferredView && views.some((item) => item.id === prefs.preferredView)) {
      setView(prefs.preferredView);
    }
  }, [setView]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const payload = buildPerformanceTabPrefsPayload({
      autoRecoverEnabled,
      preferredSampleIntervalMs: clampPerformanceSampleInterval(Number(pendingSampleIntervalMs) || sampleIntervalMs, sampleIntervalMs),
      showAdvancedControls,
      showHeroStrip,
      preferredView: activeView
    });
    if (persistedPrefsRef.current === payload) {
      return;
    }
    persistedPrefsRef.current = payload;
    try {
      window.localStorage.setItem(PERFORMANCE_TAB_PREFS_KEY, payload);
    } catch {
      // Ignore local storage write errors.
    }
  }, [activeView, autoRecoverEnabled, pendingSampleIntervalMs, sampleIntervalMs, showAdvancedControls, showHeroStrip]);

  useEffect(() => {
    if (!isDocumentVisible) {
      bootstrapTokenRef.current += 1;
      return;
    }
    const bootstrapToken = ++bootstrapTokenRef.current;
    const bootstrapMonitoring = async () => {
      const state = useAppStore.getState();
      if (state.isMonitoring && state.monitorSessionId) {
        await syncMonitoringSession();
        return;
      }
      if (bootstrapTokenRef.current !== bootstrapToken) {
        return;
      }
      await startMonitoring(sampleIntervalMs);
      if (bootstrapTokenRef.current === bootstrapToken) {
        onStatusChange?.("Performance monitoring started.");
      }
    };
    void bootstrapMonitoring();
    return () => {
      bootstrapTokenRef.current += 1;
    };
  }, [isDocumentVisible, onStatusChange, sampleIntervalMs, startMonitoring, syncMonitoringSession]);

  useEffect(() => {
    if (!isDocumentVisible || !DRIVER_SUMMARY_VIEWS.has(activeView)) {
      return;
    }
    void loadDriverPerformance();
  }, [activeView, isDocumentVisible, loadDriverPerformance]);

  useEffect(() => {
    return () => {
      if (!pinnedMonitoring) {
        void stopMonitoring();
      }
    };
  }, [pinnedMonitoring, stopMonitoring]);

  useEffect(() => {
    if (!isMonitoring || !isDocumentVisible) {
      setNowTick(Date.now());
      return;
    }
    const tickIntervalMs = activeView === "dashboard" || activeView === "processes" ? 1_000 : 2_000;
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, tickIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeView, isDocumentVisible, isMonitoring]);

  const preferredSampleInterval = clampPerformanceSampleInterval(Number(pendingSampleIntervalMs) || sampleIntervalMs, sampleIntervalMs);
  const liveInterval = monitorSampleIntervalMs || preferredSampleInterval;
  const sinceLastFrameMs = lastPerformanceFrameAt ? Math.max(0, nowTick - lastPerformanceFrameAt) : 0;
  const staleThresholdMs = Math.max(8_000, liveInterval * 4);
  const isStaleMonitoring = isMonitoring && !isLoading && (!lastPerformanceFrameAt || sinceLastFrameMs > staleThresholdMs);
  const autoRecoverCooldownMs = Math.max(20_000, staleThresholdMs * 2);
  const monitorStateLabel = isLoading
    ? "Starting monitor"
    : isStaleMonitoring
      ? "Sampling stalled"
      : isMonitoring
        ? "Live sampling"
        : "Monitor paused";
  const effectiveGapAvg = monitorAverageGapMs;
  const effectiveGapP95 = Math.max(monitorMaxGapMs, monitorLastGapMs);
  const hasGapDrift =
    isMonitoring &&
    effectiveGapAvg > 0 &&
    effectiveGapAvg > Math.max(2_500, liveInterval * 2.5);
  const hasGapJitter =
    isMonitoring &&
    effectiveGapP95 > 0 &&
    effectiveGapP95 > Math.max(3_000, liveInterval * 3.5);
  const monitorHealth = useMemo(() => {
    if (!isMonitoring) {
      return { score: 0, label: "paused", tone: "tone-neutral" };
    }
    let score = 100;
    if (isStaleMonitoring) {
      score -= 50;
    }
    if (hasGapDrift) {
      score -= 18;
    }
    if (hasGapJitter) {
      score -= 12;
    }
    if (monitorDroppedFrameCount > 0) {
      score -= Math.min(16, monitorDroppedFrameCount);
    }
    score = Math.max(0, score);
    const label = score >= 85 ? "stable" : score >= 65 ? "degraded" : "unstable";
    const tone = score >= 85 ? "tone-low" : score >= 65 ? "tone-medium" : "tone-high";
    return { score, label, tone };
  }, [hasGapDrift, hasGapJitter, isMonitoring, isStaleMonitoring, monitorDroppedFrameCount]);
  const lastSampleLabel = lastPerformanceFrameAt
    ? `${Math.max(0, Math.round(sinceLastFrameMs / 1000))}s ago`
    : "Waiting";
  const lastSyncLabel = monitorLastSyncAt
    ? `${Math.max(0, Math.round((nowTick - monitorLastSyncAt) / 1000))}s ago`
    : "never";
  const issueCount = [isStaleMonitoring, hasGapDrift, hasGapJitter, monitorDroppedFrameCount > 0].filter(Boolean).length;
  const topIssueLabel = isStaleMonitoring
    ? "Sampling stalled"
    : hasGapDrift
      ? "Sampling delay"
      : hasGapJitter
        ? "Sampling jitter"
        : monitorDroppedFrameCount > 0
          ? "Frame disorder"
          : latestSnapshot
            ? `Primary bottleneck: ${latestSnapshot.bottleneck.primary}`
            : "Monitor stable";
  const keySignals = useMemo(
    () => [
      capabilities?.gpuSupported ? "GPU" : null,
      capabilities?.diagnosticsEventLogSupported ? "Boot log" : null,
      capabilities?.taskDelaySupported ? "Task delay" : null,
      capabilities?.serviceDelayedAutoStartSupported ? "Delayed services" : null
    ].filter((item): item is string => Boolean(item)),
    [capabilities]
  );

  useEffect(() => {
    if (!isDocumentVisible || !autoRecoverEnabled || !isStaleMonitoring || isLoading) {
      return;
    }
    if (nowTick - lastAutoRecoverAt < autoRecoverCooldownMs) {
      return;
    }
    setLastAutoRecoverAt(nowTick);
    void recoverMonitoring(preferredSampleInterval).then(() => {
      onStatusChange?.("Monitor recovered automatically after stale sampling.");
    });
  }, [
    autoRecoverCooldownMs,
    autoRecoverEnabled,
    isDocumentVisible,
    isLoading,
    isStaleMonitoring,
    lastAutoRecoverAt,
    nowTick,
    onStatusChange,
    preferredSampleInterval,
    recoverMonitoring,
    sampleIntervalMs
  ]);

  useEffect(() => {
    if (!isDocumentVisible || !isMonitoring || isLoading) {
      return;
    }
    const pollIntervalMs = Math.max(2_500, liveInterval);
    const timer = window.setInterval(() => {
      const state = useAppStore.getState();
      if (!state.isMonitoring || !state.monitorSessionId) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      const elapsed = Date.now() - (state.lastPerformanceFrameAt || 0);
      if (!state.lastPerformanceFrameAt || elapsed > Math.max(3_500, pollIntervalMs * 1.6)) {
        void state.syncMonitoringSession();
      }
    }, pollIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [isDocumentVisible, isLoading, isMonitoring, liveInterval]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (typing) {
        return;
      }

      if (event.altKey && !event.shiftKey && !event.ctrlKey) {
        const mapping: Array<ReturnType<typeof useAppStore.getState>["activePerformanceView"]> = [
          "dashboard",
          "startup",
          "processes",
          "services",
          "tasks",
          "doctor",
          "history"
        ];
        const index = Number(event.key) - 1;
        if (index >= 0 && index < mapping.length) {
          event.preventDefault();
          setView(mapping[index]);
          return;
        }
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        void (isMonitoring ? stopMonitoring() : startMonitoring(preferredSampleInterval));
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void recoverMonitoring(preferredSampleInterval);
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void captureSnapshot("manual");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureSnapshot, isMonitoring, preferredSampleInterval, recoverMonitoring, setView, startMonitoring, stopMonitoring]);

  const applySampleInterval = async (nextIntervalMs?: number) => {
    const requestedInterval = nextIntervalMs ?? (Number(pendingSampleIntervalMs) || sampleIntervalMs);
    const resolved = Math.max(
      500,
      Math.min(60_000, requestedInterval)
    );
    setPendingSampleIntervalMs(String(resolved));
    if (isMonitoring) {
      await recoverMonitoring(resolved);
      onStatusChange?.(`Monitor interval updated to ${resolved} ms.`);
      return;
    }
    onStatusChange?.(`Preferred monitor interval set to ${resolved} ms.`);
  };

  const content =
    activeView === "dashboard" ? (
      <DashboardView />
    ) : activeView === "startup" ? (
      <StartupView />
    ) : activeView === "processes" ? (
      <ProcessesView />
    ) : activeView === "services" ? (
      <ServicesView />
    ) : activeView === "tasks" ? (
      <TasksView />
    ) : activeView === "doctor" ? (
      <DoctorView />
    ) : (
      <HistoryView />
    );

  return (
    <section className="panel panel-fade tab-surface performance-workbench">
      <header className="performance-shell performance-shell--compact">
        <div className="performance-shell-copy">
          <span className="eyebrow">Performance</span>
          <h2>Live monitor and diagnosis</h2>
          <p className="muted">
            Local live metrics, structured snapshots, reversible actions only.
          </p>
        </div>
        <div className="performance-shell-actions">
          <div className="performance-topline">
            <span className={`risk-pill ${monitorHealth.tone}`}>{topIssueLabel}</span>
            <span className="muted">
              {latestSnapshot
                ? `${Math.round(latestSnapshot.bottleneck.confidence * 100)}% bottleneck confidence`
                : "Capture a snapshot for structured diagnosis"}
            </span>
          </div>
          <div className="performance-summary-strip">
            <span className="workspace-meta-pill">{monitorStateLabel}</span>
            <span className="workspace-meta-pill">Last sample {lastSampleLabel}</span>
            <span className="workspace-meta-pill">{liveInterval} ms</span>
            <span className="workspace-meta-pill">
              {latestSnapshot ? `Snapshot ${latestSnapshot.bottleneck.primary}` : "Snapshot pending"}
            </span>
            {issueCount ? <span className="workspace-meta-pill">{issueCount} issue(s)</span> : null}
          </div>
          <div className="row wrap performance-quiet-toolbar">
            <button className="btn" onClick={() => void (isMonitoring ? stopMonitoring() : startMonitoring(preferredSampleInterval))}>
              {isLoading ? "Starting..." : isMonitoring ? "Stop Monitor" : "Start Monitor"}
            </button>
            <button
              className="btn secondary"
              onClick={() => void recoverMonitoring(preferredSampleInterval)}
              disabled={isLoading}
              title="Force a monitor restart if live frames stopped updating."
            >
              Recover
            </button>
            <button className="btn secondary" onClick={() => void captureSnapshot("manual")}>
              Snapshot
            </button>
            <button className="btn secondary" onClick={() => void loadDriverPerformance(true)}>
              Driver Summary
            </button>
            <button className="btn secondary tiny" onClick={() => setShowHeroStrip((current) => !current)}>
              {showHeroStrip ? "Hide Detail Cards" : "Show Detail Cards"}
            </button>
          </div>
          <details
            className="performance-toggle-panel"
            open={showAdvancedControls}
            onToggle={(event) => setShowAdvancedControls((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>{showAdvancedControls ? "Hide advanced controls" : "Show advanced controls"}</summary>
            <div className="performance-command-deck">
              <button className="btn secondary" onClick={() => void syncMonitoringSession()}>
                Sync Session
              </button>
              <div className="performance-interval-strip">
                <button className="btn secondary" onClick={() => void applySampleInterval(1_000)} disabled={isLoading}>
                  1s
                </button>
                <button className="btn secondary" onClick={() => void applySampleInterval(2_000)} disabled={isLoading}>
                  2s
                </button>
                <button className="btn secondary" onClick={() => void applySampleInterval(5_000)} disabled={isLoading}>
                  5s
                </button>
                <label>
                  Interval ms
                  <input
                    type="number"
                    min={500}
                    max={60000}
                    step={250}
                    value={pendingSampleIntervalMs}
                    onChange={(event) => setPendingSampleIntervalMs(event.target.value)}
                  />
                </label>
                <button className="btn secondary" onClick={() => void applySampleInterval()} disabled={isLoading}>
                  Apply
                </button>
              </div>
              <div className="performance-diagnostics-grid">
                <article className="mini-card">
                  <small>Frames buffered</small>
                  <strong>{performanceFrameCount}</strong>
                  <span className="muted">Current live session</span>
                </article>
                <article className="mini-card">
                  <small>Recoveries</small>
                  <strong>{monitorRestartCount}</strong>
                  <span className="muted">Automatic + manual restarts</span>
                </article>
                <article className="mini-card">
                  <small>Out-of-order</small>
                  <strong>{monitorDroppedFrameCount}</strong>
                  <span className="muted">Late or reordered samples</span>
                </article>
                <article className="mini-card">
                  <small>Gap average</small>
                  <strong>{effectiveGapAvg ? Math.round(effectiveGapAvg) : 0} ms</strong>
                  <span className="muted">Peak {effectiveGapP95 ? Math.round(effectiveGapP95) : 0} ms</span>
                </article>
                <article className="mini-card">
                  <small>Sync status</small>
                  <strong>{monitorSyncCount}</strong>
                  <span className="muted">Last sync {lastSyncLabel}</span>
                </article>
                <article className="mini-card">
                  <small>Last sync payload</small>
                  <strong>{monitorLastSyncAddedFrames}</strong>
                  <span className="muted">New frame{monitorLastSyncAddedFrames === 1 ? "" : "s"} added</span>
                </article>
              </div>
              <div className="badge-row">
                {keySignals.length ? keySignals.map((signal) => <span key={signal} className="origin-pill origin-neutral">{signal}</span>) : <span className="muted">No advanced probes detected.</span>}
              </div>
              <label className="checkbox performance-toggle">
                <input
                  type="checkbox"
                  checked={autoRecoverEnabled}
                  onChange={(event) => setAutoRecoverEnabled(event.target.checked)}
                />
                Auto-recover stalled monitor
              </label>
              <label>
                Focus view
                <select
                  value={activeView}
                  onChange={(event) =>
                    setView(event.target.value as ReturnType<typeof useAppStore.getState>["activePerformanceView"])
                  }
                >
                  {views.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>
      </header>

      {showHeroStrip ? (
        <section className="performance-hero-strip">
          <article className="performance-glance-card">
            <small>Snapshot</small>
            <strong>{latestSnapshot ? latestSnapshot.bottleneck.primary : "Not captured yet"}</strong>
            <p className="muted">
              {latestSnapshot
                ? `Health bottleneck confidence ${Math.round(latestSnapshot.bottleneck.confidence * 100)}%`
                : "Capture a structured snapshot to enable history and AI diagnosis."}
            </p>
          </article>
          <article className="performance-glance-card">
            <small>Driver Latency</small>
            <strong>{DRIVER_SUMMARY_VIEWS.has(activeView) ? driverSummary?.latencyRisk ?? "unknown" : "on demand"}</strong>
            <p className="muted">
              {DRIVER_SUMMARY_VIEWS.has(activeView) && driverSummary
                ? `${driverSummary.suspectedDrivers.length} suspected stack candidates`
                : "Open Dashboard, Startup, or Doctor to auto-load driver diagnostics."}
            </p>
          </article>
          <article className="performance-glance-card">
            <small>Monitor Quality</small>
            <strong>{monitorHealth.label}</strong>
            <p className="muted">
              {issueCount
                ? `${issueCount} quality signal${issueCount === 1 ? "" : "s"} detected in the active session`
                : "Sampling is steady and the monitor is not reporting quality issues."}
            </p>
          </article>
        </section>
      ) : null}

      {performanceError ? (
        <div className="callout">
          <strong>Performance monitor notice</strong>
          <span>{performanceError}</span>
        </div>
      ) : null}

      {isStaleMonitoring ? (
        <div className="callout">
          <strong>Live monitor stalled</strong>
          <span>
            No new sample arrived for {Math.round(sinceLastFrameMs / 1000)}s. Use Recover Monitor to restart the
            live session safely.
          </span>
        </div>
      ) : null}

      {hasGapDrift ? (
        <div className="callout">
          <strong>Sampling delay detected</strong>
          <span>
            Average frame gap is {Math.round(effectiveGapAvg)} ms (peak {Math.round(effectiveGapP95)} ms), above the current interval baseline.
          </span>
        </div>
      ) : null}

      {hasGapJitter ? (
        <div className="callout">
          <strong>Sampling jitter detected</strong>
          <span>
            Peak observed gap is {Math.round(effectiveGapP95)} ms, which may hide short spikes.
          </span>
        </div>
      ) : null}

      {isMonitoring && monitorHealth.score < 65 ? (
        <div className="callout">
          <strong>Monitor quality degraded</strong>
          <span>
            Session health is {monitorHealth.score}%. Use Recover Monitor and raise interval to 2s or 5s for more stable sampling.
          </span>
        </div>
      ) : null}

      <nav className="subnav performance-subnav">
        {views.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? "pill active" : "pill"}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <Suspense fallback={<div className="card tab-loading-card"><strong>Loading workspace</strong><span className="muted">Preparing performance tools...</span></div>}>
        {content}
      </Suspense>
    </section>
  );
}
