import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { OptimizationActionSuggestion, SystemDoctorDiagnosis } from "../../types";

type DiagnosisRiskFilter = "all" | "low" | "medium" | "high";
type DiagnosisSort = "confidence_desc" | "risk_desc" | "title_asc";
type SuggestionTargetFilter = "all" | OptimizationActionSuggestion["targetKind"];
type ProviderFilter = "all" | "heuristic" | "cerebras";

interface DoctorViewPrefs {
  riskFilter: DiagnosisRiskFilter;
  query: string;
  includeHistory: boolean;
  actionableOnly: boolean;
  targetFilter: SuggestionTargetFilter;
  sortMode: DiagnosisSort;
  providerFilter: ProviderFilter;
}

const DOCTOR_PREFS_KEY = "cleanup-pilot.doctorViewPrefs.v1";

function diagnosisTargetKinds(diagnosis: SystemDoctorDiagnosis): Set<OptimizationActionSuggestion["targetKind"]> {
  const set = new Set<OptimizationActionSuggestion["targetKind"]>();
  for (const suggestion of diagnosis.suggestions) {
    set.add(suggestion.targetKind);
  }
  return set;
}

function routeDiagnosisToView(diagnosis: SystemDoctorDiagnosis): ReturnType<typeof useAppStore.getState>["activePerformanceView"] {
  const kinds = diagnosisTargetKinds(diagnosis);
  if (kinds.has("startup_entry")) {
    return "startup";
  }
  if (kinds.has("service")) {
    return "services";
  }
  if (kinds.has("scheduled_task")) {
    return "tasks";
  }
  return "dashboard";
}

export function DoctorView() {
  const report = useAppStore((state) => state.doctorReport);
  const snapshot = useAppStore((state) => state.doctorSnapshot);
  const loadDoctor = useAppStore((state) => state.loadDoctor);
  const loading = useAppStore((state) => state.doctorLoading);
  const doctorError = useAppStore((state) => state.doctorError);
  const doctorLastLoadedAt = useAppStore((state) => state.doctorLastLoadedAt);
  const previewActions = useAppStore((state) => state.previewActions);
  const preview = useAppStore((state) => state.optimizationPreview);
  const executePreviewedActions = useAppStore((state) => state.executePreviewedActions);
  const executing = useAppStore((state) => state.optimizationExecuting);
  const setActivePerformanceView = useAppStore((state) => state.setActivePerformanceView);
  const previewedActionIds = useAppStore((state) => state.previewedActionIds);

  const [riskFilter, setRiskFilter] = useState<DiagnosisRiskFilter>("all");
  const [query, setQuery] = useState("");
  const [includeHistory, setIncludeHistory] = useState(true);
  const [actionableOnly, setActionableOnly] = useState(false);
  const [targetFilter, setTargetFilter] = useState<SuggestionTargetFilter>("all");
  const [sortMode, setSortMode] = useState<DiagnosisSort>("confidence_desc");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DOCTOR_PREFS_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DoctorViewPrefs>;
      if (parsed.riskFilter) {
        setRiskFilter(parsed.riskFilter);
      }
      if (typeof parsed.query === "string") {
        setQuery(parsed.query);
      }
      if (typeof parsed.includeHistory === "boolean") {
        setIncludeHistory(parsed.includeHistory);
      }
      if (typeof parsed.actionableOnly === "boolean") {
        setActionableOnly(parsed.actionableOnly);
      }
      if (parsed.targetFilter) {
        setTargetFilter(parsed.targetFilter);
      }
      if (parsed.sortMode) {
        setSortMode(parsed.sortMode);
      }
      if (parsed.providerFilter) {
        setProviderFilter(parsed.providerFilter);
      }
    } catch {
      // Ignore invalid persisted values.
    }
  }, []);

  useEffect(() => {
    try {
      const payload: DoctorViewPrefs = {
        riskFilter,
        query,
        includeHistory,
        actionableOnly,
        targetFilter,
        sortMode,
        providerFilter
      };
      window.localStorage.setItem(DOCTOR_PREFS_KEY, JSON.stringify(payload));
    } catch {
      // Ignore local storage write errors.
    }
  }, [actionableOnly, includeHistory, providerFilter, query, riskFilter, sortMode, targetFilter]);

  useEffect(() => {
    if (!report && !loading) {
      void loadDoctor(undefined, true);
    }
  }, [loadDoctor, loading, report]);

  const filteredDiagnoses = useMemo(() => {
    if (!report) {
      return [];
    }
    if (providerFilter !== "all" && report.provider !== providerFilter) {
      return [];
    }
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    const filtered = report.diagnoses.filter((diagnosis) => {
      if (riskFilter !== "all" && diagnosis.risk !== riskFilter) {
        return false;
      }
      if (targetFilter !== "all") {
        const hasTarget = diagnosis.suggestions.some((item) => item.targetKind === targetFilter);
        if (!hasTarget) {
          return false;
        }
      }
      if (actionableOnly) {
        const hasActionableSuggestion = diagnosis.suggestions.some((item) => !item.blocked);
        if (!hasActionableSuggestion) {
          return false;
        }
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        diagnosis.title,
        diagnosis.summary,
        diagnosis.evidence.join(" "),
        diagnosis.suggestions.map((item) => item.title).join(" ")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
    return [...filtered].sort((left, right) => {
      if (sortMode === "confidence_desc") {
        return right.confidence - left.confidence;
      }
      if (sortMode === "risk_desc") {
        const riskWeight = { high: 3, medium: 2, low: 1 };
        return riskWeight[right.risk] - riskWeight[left.risk] || right.confidence - left.confidence;
      }
      return left.title.localeCompare(right.title);
    });
  }, [actionableOnly, deferredQuery, providerFilter, report, riskFilter, sortMode, targetFilter]);

  const diagnosisCounts = useMemo(() => {
    const base = { low: 0, medium: 0, high: 0 };
    for (const diagnosis of report?.diagnoses ?? []) {
      base[diagnosis.risk] += 1;
    }
    return base;
  }, [report?.diagnoses]);

  const safeWinsBlocked = useMemo(
    () => (report?.safeWins ?? []).filter((item) => item.blocked).length,
    [report?.safeWins]
  );
  const selectedSuggestionSet = useMemo(() => new Set(selectedSuggestionIds), [selectedSuggestionIds]);

  useEffect(() => {
    if (!report) {
      setSelectedSuggestionIds([]);
      return;
    }
    const defaults = report.safeWins.filter((item) => !item.blocked).map((item) => item.id);
    setSelectedSuggestionIds(defaults);
  }, [report?.generatedAt, report?.safeWins]);

  const selectedSuggestionCount = useMemo(
    () => (report?.safeWins ?? []).filter((item) => selectedSuggestionSet.has(item.id)).length,
    [report?.safeWins, selectedSuggestionSet]
  );
  const selectedSuggestionActions = useMemo(
    () => report?.safeWins.filter((item) => selectedSuggestionSet.has(item.id)) ?? [],
    [report?.safeWins, selectedSuggestionSet]
  );
  const safeWinsByTarget = useMemo(() => {
    const base = { startup: 0, services: 0, tasks: 0 };
    for (const item of report?.safeWins ?? []) {
      if (item.targetKind === "startup_entry") {
        base.startup += 1;
      } else if (item.targetKind === "service") {
        base.services += 1;
      } else if (item.targetKind === "scheduled_task") {
        base.tasks += 1;
      }
    }
    return base;
  }, [report?.safeWins]);
  const visibleSuggestionIds = useMemo(
    () =>
      Array.from(
        new Set(
          filteredDiagnoses.flatMap((diagnosis) => diagnosis.suggestions.filter((item) => !item.blocked).map((item) => item.id))
        )
      ),
    [filteredDiagnoses]
  );

  const toggleSuggestion = (actionId: string) => {
    setSelectedSuggestionIds((current) => {
      if (current.includes(actionId)) {
        return current.filter((item) => item !== actionId);
      }
      return [...current, actionId];
    });
  };

  const toggleEvidence = (diagnosisId: string) => {
    setExpandedEvidenceIds((current) => {
      if (current.includes(diagnosisId)) {
        return current.filter((item) => item !== diagnosisId);
      }
      return [...current, diagnosisId];
    });
  };

  const copyReportJson = async () => {
    if (!report) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setStatus("Doctor report copied to clipboard.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Clipboard copy failed.");
    }
  };

  const exportDiagnosesCsv = () => {
    if (!filteredDiagnoses.length) {
      setStatus("No diagnoses to export.");
      return;
    }
    const rows = [
      ["id", "title", "risk", "confidence", "suggestions", "evidenceCount"],
      ...filteredDiagnoses.map((item) => [
        item.id,
        item.title,
        item.risk,
        String(Math.round(item.confidence * 100)),
        String(item.suggestions.length),
        String(item.evidence.length)
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
    anchor.download = `cleanup-pilot-doctor-diagnoses-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${filteredDiagnoses.length} diagnoses.`);
  };

  const exportSelectedSuggestionsCsv = () => {
    if (!selectedSuggestionActions.length) {
      setStatus("No selected suggestions to export.");
      return;
    }
    const rows = [
      ["id", "title", "targetKind", "action", "risk", "blocked", "estimatedBenefitScore"],
      ...selectedSuggestionActions.map((item) => [
        item.id,
        item.title,
        item.targetKind,
        item.action,
        item.risk,
        item.blocked ? "true" : "false",
        String(item.estimatedBenefitScore)
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
    anchor.download = `cleanup-pilot-doctor-suggestions-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${selectedSuggestionActions.length} selected suggestions.`);
  };

  return (
    <div className="grid doctor-workbench">
      <article className="card">
        <header className="panel-header compact">
          <div>
            <h3>System Doctor</h3>
            <p className="muted">{doctorLastLoadedAt ? `Last run ${new Date(doctorLastLoadedAt).toLocaleTimeString()}` : "No diagnosis yet"}</p>
          </div>
          <div className="row wrap">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeHistory}
                onChange={(event) => setIncludeHistory(event.target.checked)}
              />
              Include history context
            </label>
            <button className="btn secondary" onClick={() => void loadDoctor(undefined, includeHistory)} disabled={loading}>
              {loading ? "Diagnosing..." : "Run Diagnosis"}
            </button>
            <button className="btn" onClick={() => void previewActions()} disabled={!report?.safeWins.length}>
              Preview Safe Wins
            </button>
            <button
              className="btn secondary"
              onClick={() => void previewActions(selectedSuggestionIds)}
              disabled={!selectedSuggestionIds.length}
            >
              Preview Selected ({selectedSuggestionCount})
            </button>
            <button className="btn secondary" onClick={() => void copyReportJson()} disabled={!report}>
              Copy JSON
            </button>
            <button className="btn secondary" onClick={exportDiagnosesCsv} disabled={!filteredDiagnoses.length}>
              Export Diagnoses CSV
            </button>
            <button className="btn secondary" onClick={exportSelectedSuggestionsCsv} disabled={!selectedSuggestionActions.length}>
              Export Selected Suggestions
            </button>
            <button
              className="btn secondary"
              onClick={() => setSelectedSuggestionIds(visibleSuggestionIds)}
              disabled={!visibleSuggestionIds.length}
            >
              Select Visible Suggestions
            </button>
          </div>
        </header>
        {status ? <div className="callout"><strong>Doctor status</strong><span>{status}</span></div> : null}
        {doctorError ? <div className="callout"><strong>Doctor engine</strong><span>{doctorError}</span></div> : null}

        {report ? (
          <>
            <div className="doctor-summary-grid">
              <article className="mini-card">
                <small>Provider</small>
                <strong>{report.provider}{report.model ? ` / ${report.model}` : ""}</strong>
              </article>
              <article className="mini-card">
                <small>Health Score</small>
                <strong>{report.overallHealthScore}</strong>
              </article>
              <article className="mini-card">
                <small>Primary Bottleneck</small>
                <strong>{report.primaryBottleneck}</strong>
              </article>
            </div>

            <div className="doctor-summary-grid">
              <article className="mini-card"><small>High Risk</small><strong>{diagnosisCounts.high}</strong></article>
              <article className="mini-card"><small>Medium Risk</small><strong>{diagnosisCounts.medium}</strong></article>
              <article className="mini-card"><small>Low Risk</small><strong>{diagnosisCounts.low}</strong></article>
            </div>

            <div className="doctor-summary-grid">
              <article className="mini-card"><small>Startup Suggestions</small><strong>{safeWinsByTarget.startup}</strong></article>
              <article className="mini-card"><small>Service Suggestions</small><strong>{safeWinsByTarget.services}</strong></article>
              <article className="mini-card"><small>Task Suggestions</small><strong>{safeWinsByTarget.tasks}</strong></article>
            </div>

            {snapshot ? (
              <p className="muted">
                CPU {Math.round(snapshot.cpu.avgUsagePct)}% - RAM {Math.round(snapshot.memory.usedPct)}% - Disk {Math.round(snapshot.diskIo.activeTimePct)}%
                {" "} - Safe wins {(report.safeWins.length - safeWinsBlocked)}/{report.safeWins.length}
              </p>
            ) : null}
            <div className="row wrap">
              <button
                className="btn secondary"
                onClick={() => setSelectedSuggestionIds(report.safeWins.filter((item) => !item.blocked).map((item) => item.id))}
              >
                Select All Safe Wins
              </button>
              <button
                className="btn secondary"
                onClick={() => setSelectedSuggestionIds(report.safeWins.filter((item) => !item.blocked && item.risk === "low").map((item) => item.id))}
              >
                Select Low Risk
              </button>
              <button
                className="btn secondary"
                onClick={() => setSelectedSuggestionIds(report.safeWins.filter((item) => !item.blocked && item.targetKind === "startup_entry").map((item) => item.id))}
              >
                Select Startup
              </button>
              <button
                className="btn secondary"
                onClick={() => setSelectedSuggestionIds(report.safeWins.filter((item) => !item.blocked && item.targetKind === "service").map((item) => item.id))}
              >
                Select Services
              </button>
              <button
                className="btn secondary"
                onClick={() => setSelectedSuggestionIds(report.safeWins.filter((item) => !item.blocked && item.targetKind === "scheduled_task").map((item) => item.id))}
              >
                Select Tasks
              </button>
              <button className="btn secondary" onClick={() => setSelectedSuggestionIds([])}>
                Clear Selected
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Waiting for the first diagnosis.</p>
        )}
      </article>

      <article className="card">
        <div className="doctor-filter-row sticky-action-row">
          <div className="doctor-filter-grid">
            <label>
              Search diagnoses
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="title, summary, evidence..."
              />
            </label>
            <label>
              Risk
              <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as DiagnosisRiskFilter)}>
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
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
              Target
              <select value={targetFilter} onChange={(event) => setTargetFilter(event.target.value as SuggestionTargetFilter)}>
                <option value="all">All</option>
                <option value="startup_entry">Startup</option>
                <option value="service">Service</option>
                <option value="scheduled_task">Task</option>
              </select>
            </label>
            <label>
              Sort
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as DiagnosisSort)}>
                <option value="confidence_desc">Confidence</option>
                <option value="risk_desc">Risk</option>
                <option value="title_asc">Title</option>
              </select>
            </label>
            <label>
              Provider
              <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value as ProviderFilter)}>
                <option value="all">All</option>
                <option value="heuristic">Heuristic</option>
                <option value="cerebras">Cerebras</option>
              </select>
            </label>
          </div>
          <span className="muted">{filteredDiagnoses.length}/{report?.diagnoses.length ?? 0} visible</span>
        </div>
      </article>

      {filteredDiagnoses.map((diagnosis) => (
        <article key={diagnosis.id} className="card diagnosis-card">
          <div className="row spread wrap">
            <h3>{diagnosis.title}</h3>
            <span className={`risk-pill tone-${diagnosis.risk}`}>{diagnosis.risk}</span>
          </div>
          <p>{diagnosis.summary}</p>
          <p className="muted">
            Confidence {Math.round(diagnosis.confidence * 100)}% - Risk {diagnosis.risk}
          </p>
          <ul className="list compact">
            {(expandedEvidenceIds.includes(diagnosis.id) ? diagnosis.evidence : diagnosis.evidence.slice(0, 3)).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {diagnosis.evidence.length > 3 ? (
            <button className="btn secondary tiny" onClick={() => toggleEvidence(diagnosis.id)}>
              {expandedEvidenceIds.includes(diagnosis.id) ? "Show Less Evidence" : "Show All Evidence"}
            </button>
          ) : null}
          {diagnosis.suggestions.length ? (
            <>
              <div className="badge-row">
                {diagnosis.suggestions.map((item) => (
                  <label key={item.id} className="origin-pill origin-recommended doctor-suggestion-chip">
                    <input
                      type="checkbox"
                      checked={selectedSuggestionSet.has(item.id)}
                      onChange={() => toggleSuggestion(item.id)}
                    />
                    <span>{item.title}</span>
                  </label>
                ))}
              </div>
              <div className="row wrap">
                <button
                  className="btn secondary"
                  onClick={() => void previewActions(diagnosis.suggestions.map((item) => item.id))}
                >
                  Preview This Diagnosis
                </button>
                <button
                  className="btn secondary"
                  onClick={() => setActivePerformanceView(routeDiagnosisToView(diagnosis))}
                >
                  Open Related Workspace
                </button>
              </div>
            </>
          ) : null}
        </article>
      ))}

      {preview ? (
        <article className="card full diagnosis-preview-card">
          <h3>Optimization Preview</h3>
          <p className="muted">
            {preview.actions.length} action(s), {preview.estimatedStartupSavingsMs} ms estimated startup savings
          </p>
          {!!previewedActionIds.length ? (
            <p className="muted">
              Previewed action IDs: {previewedActionIds.length}
            </p>
          ) : null}
          <button className="btn" onClick={() => void executePreviewedActions()} disabled={executing}>
            {executing ? "Applying..." : "Apply Previewed Safe Wins"}
          </button>
          {selectedSuggestionActions.length ? (
            <p className="muted">
              Selected suggestions: {selectedSuggestionActions.length} / actionable in preview {preview.actions.length}
            </p>
          ) : null}
        </article>
      ) : null}
    </div>
  );
}
