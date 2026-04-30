import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionPlanSummary, AppConfig, DecisionExecutionProgressEvent, ExecutionSession, HomeSummarySnapshot, SmartCheckRun, TopLevelSurface } from "../../types";
import { ExecuteSurface } from "./ExecuteSurface";
import { HistorySurface } from "./HistorySurface";
import { HomeSurface } from "./HomeSurface";
import { PipelineRail } from "./PipelineRail";
import { PlanSurface } from "./PlanSurface";
import { ScanSurface } from "./ScanSurface";
import { SettingsDrawer } from "./SettingsDrawer";
import { cloneSettings, defaultExecutionProgress, groupScanIssues, type VisualTheme } from "./pipelineShared";

function loadStoredTheme(): VisualTheme {
  const stored = window.localStorage.getItem("cleanup-pilot-theme");
  return stored === "arctic" || stored === "sand" || stored === "graphite" || stored === "midnight" || stored === "onyx"
    ? stored
    : "graphite";
}

export function ProductShell() {
  const [surface, setSurface] = useState<TopLevelSurface>("home");
  const [visualTheme, setVisualTheme] = useState<VisualTheme>(() => loadStoredTheme());
  const [draftSettings, setDraftSettings] = useState<AppConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeSnapshot, setHomeSnapshot] = useState<HomeSummarySnapshot | null>(null);
  const [homeStatus, setHomeStatus] = useState("Loading system state...");
  const [homeLoading, setHomeLoading] = useState(true);
  const [smartCheckRun, setSmartCheckRun] = useState<SmartCheckRun | null>(null);
  const [smartCheckRunId, setSmartCheckRunId] = useState("");
  const [scanStatus, setScanStatus] = useState("Run Smart Check to build the next safe plan.");
  const [scanStage, setScanStage] = useState<"scanning" | "findings" | "grouped">("scanning");
  const [scanProgress, setScanProgress] = useState(0);
  const [plan, setPlan] = useState<ActionPlanSummary | null>(null);
  const [planStatus, setPlanStatus] = useState("Build a plan to review cleanup and optimization safely.");
  const [executionProgress, setExecutionProgress] = useState<DecisionExecutionProgressEvent>(defaultExecutionProgress);
  const [executionSession, setExecutionSession] = useState<ExecutionSession | null>(null);
  const [historySessions, setHistorySessions] = useState<ExecutionSession[]>([]);
  const [historyStatus, setHistoryStatus] = useState("No sessions loaded yet.");
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);

  const loadHome = useCallback(async () => {
    setHomeLoading(true);
    setHomeStatus("Loading system state...");
    try {
      const { snapshot } = await window.desktopApi.getHomeSnapshot();
      setHomeSnapshot(snapshot);
      setHomeStatus("System state ready.");
    } catch (error) {
      setHomeStatus(error instanceof Error ? error.message : "Failed to load system state.");
    }

    try {
      const currentSettings = await window.desktopApi.getSettings();
      setDraftSettings(cloneSettings(currentSettings));
    } catch {
      setDraftSettings(null);
    } finally {
      setHomeLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryStatus("Loading session history...");
    try {
      const { sessions } = await window.desktopApi.listHistorySessions(24);
      setHistorySessions(sessions);
      setActiveHistoryId((current) => current || sessions[0]?.id || "");
      setHistoryStatus(sessions.length ? "Session history ready." : "No sessions yet.");
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : "Failed to load session history.");
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadHome(), loadHistory()]);
    return () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
      }
    };
  }, [loadHistory, loadHome]);

  useEffect(() => {
    return window.desktopApi.onDecisionExecutionProgress((payload) => {
      setExecutionProgress(payload);
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem("cleanup-pilot-theme", visualTheme);
  }, [visualTheme]);

  const activeHistorySession = useMemo(
    () => historySessions.find((item) => item.id === activeHistoryId) ?? historySessions[0] ?? null,
    [activeHistoryId, historySessions]
  );

  const scanBuckets = useMemo(() => groupScanIssues(smartCheckRun), [smartCheckRun]);
  const canBuildPlan = smartCheckRun?.status === "completed";
  const canExecutePlan = Boolean((plan?.cleanupPreview?.actionCount ?? 0) > 0 || (plan?.optimizationPreview?.actions.length ?? 0) > 0);
  const disabledSurfaces = useMemo<TopLevelSurface[]>(
    () => [
      ...(canBuildPlan ? [] : ["plan" as TopLevelSurface]),
      ...(canExecutePlan ? [] : ["execute" as TopLevelSurface])
    ],
    [canBuildPlan, canExecutePlan]
  );

  const startSmartCheck = useCallback(async () => {
    setBusy("scan");
    setSurface("scan");
    setPlan(null);
    setExecutionSession(null);
    setSmartCheckRun(null);
    setScanProgress(6);
    setScanStage("scanning");
    setScanStatus("Scanning cleanup, deep storage, startup, background load, and safety.");
    try {
      const { runId } = await window.desktopApi.runSmartCheck("fast");
      setSmartCheckRunId(runId);
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
      }
      pollingRef.current = window.setInterval(async () => {
        try {
          const { run } = await window.desktopApi.getSmartCheckCurrent(runId);
          setSmartCheckRun(run);
          setHomeSnapshot(run.summary);
          if (run.status === "running") {
            setScanStage("findings");
            setScanProgress((current) => Math.max(current, 42));
            setScanStatus("Collecting grouped findings.");
            return;
          }
          if (pollingRef.current !== null) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setScanStage("grouped");
          setScanProgress(100);
          setScanStatus(run.status === "completed" ? "Grouped issues are ready." : `Smart Check ${run.status}.`);
          setBusy(null);
        } catch (error) {
          if (pollingRef.current !== null) {
            window.clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setScanProgress(100);
          setScanStatus(error instanceof Error ? error.message : "Smart Check failed.");
          setBusy(null);
        }
      }, 500);
    } catch (error) {
      setScanProgress(100);
      setScanStatus(error instanceof Error ? error.message : "Could not start Smart Check.");
      setBusy(null);
    }
  }, []);

  const buildPlan = useCallback(async () => {
    if (!smartCheckRunId) {
      setPlanStatus("Run Smart Check first.");
      return;
    }
    setBusy("plan");
    setPlanStatus("Building the next safe plan...");
    try {
      const { plan: nextPlan } = await window.desktopApi.buildDecisionPlan(smartCheckRunId, []);
      setPlan(nextPlan);
      setSurface("plan");
      setPlanStatus("Plan ready.");
    } catch (error) {
      setPlanStatus(error instanceof Error ? error.message : "Failed to build plan.");
    } finally {
      setBusy(null);
    }
  }, [smartCheckRunId]);

  const openExecute = useCallback(() => {
    if (!canExecutePlan) {
      setPlanStatus("Plan has no executable actions.");
      setSurface("plan");
      return;
    }
    setSurface("execute");
    setExecutionProgress({
      ...defaultExecutionProgress,
      executionId: "pending",
      summary: "Plan locked. Confirm to apply it.",
      timestamp: Date.now()
    });
  }, [canExecutePlan]);

  const applyPlan = useCallback(async () => {
    if (!smartCheckRunId || !canExecutePlan) {
      setExecutionProgress({
        executionId: "blocked",
        stage: "failed",
        percent: 100,
        title: "Plan required",
        summary: "Review a plan with executable actions before applying changes.",
        timestamp: Date.now()
      });
      return;
    }
    setBusy("execute");
    const selectedIssueIds = plan?.selectedIssueIds ?? [];
    setExecutionProgress({
      executionId: "pending",
      stage: "preparing",
      percent: 5,
      title: "Preparing plan",
      summary: "Checking the selected actions one last time.",
      timestamp: Date.now()
    });
    try {
      const { session } = await window.desktopApi.executeDecisionPlan(smartCheckRunId, selectedIssueIds);
      setExecutionSession(session);
      setExecutionProgress({
        executionId: session.id,
        stage: "completed",
        percent: 100,
        title: "Plan applied",
        summary: session.summary,
        timestamp: Date.now()
      });
      await loadHistory();
    } catch (error) {
      setExecutionProgress({
        executionId: "failed",
        stage: "failed",
        percent: 100,
        title: "Execution failed",
        summary: error instanceof Error ? error.message : "The plan could not be applied.",
        timestamp: Date.now()
      });
    } finally {
      setBusy(null);
    }
  }, [canExecutePlan, loadHistory, plan?.selectedIssueIds, smartCheckRunId]);

  const openSessionReport = useCallback(async () => {
    await loadHistory();
    setActiveHistoryId(executionSession?.id ?? activeHistorySession?.id ?? "");
    setSurface("history");
  }, [activeHistorySession?.id, executionSession?.id, loadHistory]);

  const mutateSession = useCallback(async (mode: "restore" | "purge", sessionId: string) => {
    setBusy(mode);
    try {
      const response =
        mode === "restore"
          ? await window.desktopApi.restoreHistorySession(sessionId)
          : await window.desktopApi.purgeHistorySession(sessionId);
      setHistorySessions((current) => current.map((item) => (item.id === response.session.id ? response.session : item)));
      setActiveHistoryId(response.session.id);
      setHistoryStatus(
        mode === "restore"
          ? response.failed.length
            ? "Some session actions could not be restored."
            : "Session restored."
          : response.failed.length
            ? "Some session items could not be purged yet."
            : "Session purged."
      );
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : `Failed to ${mode} session.`);
    } finally {
      setBusy(null);
    }
  }, []);

  const saveSettings = useCallback(async () => {
    if (!draftSettings) {
      return;
    }
    setBusy("settings");
    try {
      const nextSettings = await window.desktopApi.updateSettings(draftSettings);
      setDraftSettings(cloneSettings(nextSettings));
      setSettingsOpen(false);
    } finally {
      setBusy(null);
    }
  }, [draftSettings]);

  return (
    <div
      className="pipeline-app-shell"
      data-theme={draftSettings?.highContrast ? "graphite" : visualTheme}
      data-reduced-motion={draftSettings?.reducedMotion ? "true" : "false"}
      data-high-contrast={draftSettings?.highContrast ? "true" : "false"}
    >
      <header className="pipeline-topbar">
        <div className="pipeline-branding">
          <strong>Cleanup Pilot</strong>
          <span className="muted">Local maintenance</span>
        </div>
        <div className="pipeline-topbar-actions">
          <button className="btn secondary" type="button" onClick={() => setSettingsOpen((open) => !open)}>
            Settings
          </button>
        </div>
      </header>

      <div className="pipeline-layout">
        <PipelineRail
          surface={surface}
          homeStatus={homeStatus}
          historyStatus={historyStatus}
          disabledSurfaces={disabledSurfaces}
          onNavigate={setSurface}
        />

        <main className="pipeline-content">
          {surface === "home" ? (
            <HomeSurface
              snapshot={homeSnapshot}
              homeStatus={homeStatus}
              loading={homeLoading}
              historySessions={historySessions}
              onReload={() => void loadHome()}
              onRunSmartCheck={() => void startSmartCheck()}
              onOpenHistory={() => setSurface("history")}
            />
          ) : null}

          {surface === "scan" ? (
            <ScanSurface
              run={smartCheckRun}
              status={scanStatus}
              scanStage={scanStage}
              progress={scanProgress}
              busy={busy}
              buckets={scanBuckets}
              onRunSmartCheck={() => void startSmartCheck()}
              onBuildPlan={() => void buildPlan()}
            />
          ) : null}

          {surface === "plan" ? (
            <PlanSurface
              plan={plan}
              status={planStatus}
              canExecutePlan={canExecutePlan}
              busy={busy === "plan"}
              onBuildPlan={() => void buildPlan()}
              onReviewContinue={openExecute}
            />
          ) : null}

          {surface === "execute" ? (
            <ExecuteSurface
              executionProgress={executionProgress}
              executionSession={executionSession}
              plan={plan}
              onApplyPlan={() => void applyPlan()}
              onOpenSessionReport={() => void openSessionReport()}
            />
          ) : null}

          {surface === "history" ? (
            <HistorySurface
              historySessions={historySessions}
              historyStatus={historyStatus}
              activeHistorySession={activeHistorySession}
              busy={busy}
              onRefresh={() => void loadHistory()}
              onSelectSession={setActiveHistoryId}
              onMutateSession={(mode, sessionId) => void mutateSession(mode, sessionId)}
            />
          ) : null}
        </main>
      </div>

      {settingsOpen && draftSettings ? (
        <SettingsDrawer
          draftSettings={draftSettings}
          busy={busy}
          visualTheme={visualTheme}
          onClose={() => setSettingsOpen(false)}
          onSave={() => void saveSettings()}
          onVisualThemeChange={setVisualTheme}
          setDraftSettings={setDraftSettings}
        />
      ) : null}
    </div>
  );
}
