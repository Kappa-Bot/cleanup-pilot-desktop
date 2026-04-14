import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AIActionSuggestion,
  AIAdvisorAnalysisResponse,
  AIAnalysisMode,
  AIModelsResponse,
  AIProvider,
  AIProviderPreference,
  AppConfig,
  ScanFinding
} from "../../../types";

interface SmartAiCollectionSuggestion {
  id: string;
  name: string;
  description: string;
  actions: AIActionSuggestion[];
  estimatedBytes: number;
  accent: "priority" | "domain";
  score: number;
  impact: "focused" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  risk: ScanFinding["risk"];
}

interface NamedAiCollection {
  id: string;
  name: string;
  actions: AIActionSuggestion[];
}

interface CollectionActionSummary {
  cleanup: AIActionSuggestion[];
  duplicates: AIActionSuggestion[];
}

interface AITabProps {
  settings: AppConfig;
  setSettings: Dispatch<SetStateAction<AppConfig>>;
  aiSelectedModel: string;
  setAiSelectedModel: Dispatch<SetStateAction<string>>;
  aiMaxFiles: number;
  setAiMaxFiles: Dispatch<SetStateAction<number>>;
  aiAnalysisMode: AIAnalysisMode;
  setAiAnalysisMode: Dispatch<SetStateAction<AIAnalysisMode>>;
  isLoadingAiModels: boolean;
  isAnalyzingAi: boolean;
  aiModels: AIModelsResponse | null;
  aiAnalysis: AIAdvisorAnalysisResponse | null;
  smartAiCollections: SmartAiCollectionSuggestion[];
  aiCollections: NamedAiCollection[];
  activeAiCollection: NamedAiCollection | null;
  activeCollectionActions: AIActionSuggestion[];
  collectionDuplicateActions: AIActionSuggestion[];
  activeCollectionActionIds: Set<string>;
  aiCollectionNameInput: string;
  setAiCollectionNameInput: Dispatch<SetStateAction<string>>;
  aiCollectionEstimatedBytes: number;
  aiCandidates: AIAdvisorAnalysisResponse["summary"]["appDataCandidates"];
  machineRoots: string[];
  machineScopeLabel: string;
  onLoadAiModels: () => void;
  onRunAiAnalysis: () => void;
  onSetActiveAiCollectionId: (value: string) => void;
  onCreateCollectionFromSuggestion: (suggestion: SmartAiCollectionSuggestion) => void;
  onMergeSuggestionIntoActiveCollection: (suggestion: SmartAiCollectionSuggestion) => void;
  onApplyBestSafeWins: (suggestion: SmartAiCollectionSuggestion, mode: "use" | "preview") => void;
  onApplySmartAiCollection: (suggestion: SmartAiCollectionSuggestion, mode: "use" | "preview") => void;
  onCreateAiCollection: () => void;
  onSaveActiveAiCollectionName: () => void;
  onDeleteActiveAiCollection: () => void;
  onApplyAiCollection: (mode: "use" | "preview") => void;
  onOpenAiCollectionDuplicates: () => void;
  onClearActiveAiCollection: () => void;
  onApplyAiAction: (action: AIActionSuggestion, mode: "use" | "preview") => void;
  onToggleAiCollectionAction: (action: AIActionSuggestion) => void;
  onAddAiActionToAllowlist: (action: AIActionSuggestion) => void;
  onAddAiPathToAllowlist: (path: string) => void;
  onAddAiAppToAllowlist: (appName?: string) => void;
  aiProviderLabel: (provider: AIProvider | AIProviderPreference) => string;
  modelSelectionValue: (provider: AIProvider, name: string) => string;
  modelOptionLabel: (model: AIModelsResponse["models"][number]) => string;
  collectionActionSummary: (actions: AIActionSuggestion[]) => CollectionActionSummary;
  appDataConfidenceClass: (value: "low" | "medium" | "high") => string;
  appDataDispositionClass: (value: AIAdvisorAnalysisResponse["summary"]["appDataCandidates"][number]["disposition"]) => string;
  aiActionKindLabel: (value: AIActionSuggestion["kind"]) => string;
  toneClass: (value: ScanFinding["risk"]) => string;
  shortPath: (value: string) => string;
  formatBytes: (value: number) => string;
  formatDate: (value?: number | null) => string;
}

interface ActionSection {
  id: string;
  title: string;
  description: string;
  actions: AIActionSuggestion[];
}

function actionPrimaryTarget(action: AIActionSuggestion): string {
  return action.targetPath ?? action.sourcePaths[0] ?? "-";
}

function actionUseLabel(action: AIActionSuggestion): string {
  return action.kind === "duplicate_scan" ? "Open Duplicates" : "Use In Scan";
}

function actionPreviewLabel(action: AIActionSuggestion): string {
  return action.kind === "duplicate_scan" ? "Queue Duplicate Pass" : "Preview Cleanup";
}

function actionEvidence(action: AIActionSuggestion): string[] {
  return (action.evidence ?? []).filter(Boolean).slice(0, 4);
}

export function AITab({
  settings,
  setSettings,
  aiSelectedModel,
  setAiSelectedModel,
  aiMaxFiles,
  setAiMaxFiles,
  aiAnalysisMode,
  setAiAnalysisMode,
  isLoadingAiModels,
  isAnalyzingAi,
  aiModels,
  aiAnalysis,
  smartAiCollections,
  aiCollections,
  activeAiCollection,
  activeCollectionActions,
  collectionDuplicateActions,
  activeCollectionActionIds,
  aiCollectionNameInput,
  setAiCollectionNameInput,
  aiCollectionEstimatedBytes,
  aiCandidates,
  machineRoots,
  machineScopeLabel,
  onLoadAiModels,
  onRunAiAnalysis,
  onSetActiveAiCollectionId,
  onCreateCollectionFromSuggestion,
  onMergeSuggestionIntoActiveCollection,
  onApplyBestSafeWins,
  onApplySmartAiCollection,
  onCreateAiCollection,
  onSaveActiveAiCollectionName,
  onDeleteActiveAiCollection,
  onApplyAiCollection,
  onOpenAiCollectionDuplicates,
  onClearActiveAiCollection,
  onApplyAiAction,
  onToggleAiCollectionAction,
  onAddAiActionToAllowlist,
  onAddAiPathToAllowlist,
  onAddAiAppToAllowlist,
  aiProviderLabel,
  modelSelectionValue,
  modelOptionLabel,
  collectionActionSummary,
  appDataConfidenceClass,
  appDataDispositionClass,
  aiActionKindLabel,
  toneClass,
  shortPath,
  formatBytes,
  formatDate
}: AITabProps) {
  const actionPlan = aiAnalysis?.actionPlan ?? [];
  const safeWinActions = actionPlan.filter(
    (action) => action.kind !== "duplicate_scan" && action.risk === "low" && action.confidence !== "low"
  );
  const duplicateActions = actionPlan.filter((action) => action.kind === "duplicate_scan");
  const reviewActions = actionPlan.filter(
    (action) => !safeWinActions.includes(action) && !duplicateActions.includes(action)
  );
  const cleanupCandidates = aiCandidates.filter((candidate) => candidate.disposition === "cleanup_candidate");
  const protectCandidates = aiCandidates.filter((candidate) => candidate.disposition === "do_not_touch");
  const reviewCandidates = aiCandidates.filter((candidate) => candidate.disposition === "review_only");
  const safeWinsSuggestion = smartAiCollections.find((item) => item.id === "safe_wins") ?? null;
  const actionSections: ActionSection[] = [
    {
      id: "safe",
      title: "Safe Wins",
      description: "Low-risk cleanup actions ready to flow into Cleanup Plan.",
      actions: safeWinActions
    },
    {
      id: "review",
      title: "Needs Review",
      description: "Higher-friction candidates that still deserve attention.",
      actions: reviewActions
    },
    {
      id: "duplicates",
      title: "Duplicate Follow-up",
      description: "Cases where a dedicated duplicate pass should pay off.",
      actions: duplicateActions
    }
  ].filter((section) => section.actions.length > 0);
  const [selectedActionId, setSelectedActionId] = useState("");
  const flatActions = useMemo(() => actionSections.flatMap((section) => section.actions), [actionSections]);
  useEffect(() => {
    if (!flatActions.length) {
      if (selectedActionId) {
        setSelectedActionId("");
      }
      return;
    }
    if (!flatActions.some((action) => action.id === selectedActionId)) {
      setSelectedActionId(flatActions[0]?.id ?? "");
    }
  }, [flatActions, selectedActionId]);
  const activeAction = useMemo(
    () => flatActions.find((action) => action.id === selectedActionId) ?? flatActions[0] ?? null,
    [flatActions, selectedActionId]
  );

  return (
    <section className="panel panel-fade tab-surface ai-studio ai-studio--summary-first">
      <header className="panel-header tab-header">
        <div>
          <small className="section-kicker">AI Advisor</small>
          <h2>Compact machine diagnosis</h2>
          <p className="muted">Use fast pass for large machines, then push the useful actions straight into Cleanup Plan.</p>
        </div>
        <div className="row wrap">
          <button className="btn secondary" onClick={() => onLoadAiModels()} disabled={isLoadingAiModels}>
            {isLoadingAiModels ? "Refreshing..." : "Refresh Models"}
          </button>
          <button className="btn" onClick={() => onRunAiAnalysis()} disabled={isAnalyzingAi}>
            {isAnalyzingAi ? "Analyzing..." : "Run AI Analysis"}
          </button>
        </div>
      </header>

      <div className="ai-hero-grid ai-hero-grid--tight">
        <article className="card ai-hero-card ai-hero-card--wide">
          <small className="section-kicker">Run Mode</small>
          <h3>Fast pass or deeper review</h3>
          <div className="row wrap">
            <button
              type="button"
              className={aiAnalysisMode === "fast" ? "pill active" : "pill"}
              onClick={() => setAiAnalysisMode("fast")}
            >
              Fast pass
            </button>
            <button
              type="button"
              className={aiAnalysisMode === "standard" ? "pill active" : "pill"}
              onClick={() => setAiAnalysisMode("standard")}
            >
              Standard pass
            </button>
          </div>
          <p className="muted">
            {aiAnalysisMode === "fast"
              ? "Fast pass caps sampled files, trims the JSON payload, and cuts model output harder to stay responsive on big disks."
              : "Standard pass keeps a broader file sample and richer structured context for deeper review."}
          </p>
          <div className="row wrap">
            <span className="risk-pill tone-low">{machineRoots.length} fixed drive{machineRoots.length === 1 ? "" : "s"}</span>
            <span className="risk-pill tone-neutral">Whole-machine scope</span>
            <span className="risk-pill tone-neutral">Compact token budget</span>
          </div>
          <div className="ai-machine-scope" title={machineScopeLabel}>{machineScopeLabel}</div>
        </article>

        <article className="card ai-hero-card">
          <small className="section-kicker">Model Strategy</small>
          <h3>Provider + model</h3>
          <label>
            Provider
            <select
              value={settings.aiProvider}
              onChange={(event) =>
                setSettings((current) => ({ ...current, aiProvider: event.target.value as AIProviderPreference }))
              }
            >
              <option value="auto">Auto</option>
              <option value="cerebras">Cerebras</option>
              <option value="local">Local</option>
            </select>
          </label>
          <label>
            Model to use
            <select value={aiSelectedModel} onChange={(event) => setAiSelectedModel(event.target.value)}>
              <option value="">
                Auto ({aiModels?.decision.recommendedModel ? `${aiProviderLabel(aiModels.decision.provider)} - ${aiModels.decision.recommendedModel}` : "none"})
              </option>
              {(aiModels?.models ?? []).map((model) => (
                <option key={modelSelectionValue(model.provider, model.name)} value={modelSelectionValue(model.provider, model.name)}>
                  {modelOptionLabel(model)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Recommended: {aiModels?.decision.recommendedModel ? `${aiProviderLabel(aiModels.decision.provider)} - ${aiModels.decision.recommendedModel}` : "No AI model detected"}
          </p>
          <p className="muted">{aiModels?.decision.rationale || "Load models to choose the best fit for this machine."}</p>
        </article>

        <article className="card ai-hero-card">
          <small className="section-kicker">Budget</small>
          <h3>Structured request budget</h3>
          <div className="stat-cluster">
            <article className="stat-tile">
              <small>Files sampled</small>
              <strong>{aiAnalysis?.summary.scannedFileCount.toLocaleString() ?? aiMaxFiles.toLocaleString()}</strong>
            </article>
            <article className="stat-tile">
              <small>Structured actions</small>
              <strong>{actionPlan.length}</strong>
            </article>
            <article className="stat-tile">
              <small>AppData signals</small>
              <strong>{aiCandidates.length}</strong>
            </article>
          </div>
          <details className="settings-advanced-panel">
            <summary>Advanced AI budget</summary>
            <label>
              Max files to inspect
              <input
                type="number"
                min={1000}
                max={250000}
                value={aiMaxFiles}
                onChange={(event) => setAiMaxFiles(Math.max(1000, Math.min(250000, Number(event.target.value) || 1000)))}
              />
            </label>
            <p className="muted">The model still receives compact summary JSON only, never the raw file list or raw logs.</p>
          </details>
        </article>
      </div>

      {aiAnalysis ? (
        <>
          <div className="callout">
            <strong>
              {aiAnalysis.modelUsed
                ? `Model used: ${aiProviderLabel(aiAnalysis.providerUsed ?? aiAnalysis.decision.provider)} - ${aiAnalysis.modelUsed}`
                : "Heuristic-only analysis"}
            </strong>
            <span>{aiAnalysis.summary.scannedFileCount.toLocaleString()} files sampled</span>
            <span>{formatBytes(aiAnalysis.summary.scannedBytes)} inspected</span>
            <span>{actionPlan.length} structured actions</span>
            {aiAnalysis.modelError && <span>Model note: {aiAnalysis.modelError}</span>}
          </div>

          <div className="ai-operational-strip">
            <article className="stat-tile">
              <small>Safe wins</small>
              <strong>{safeWinActions.length}</strong>
              <span>{formatBytes(safeWinActions.reduce((total, action) => total + action.estimatedBytes, 0))} low-risk surface</span>
            </article>
            <article className="stat-tile">
              <small>Review queue</small>
              <strong>{reviewActions.length}</strong>
              <span>{formatBytes(reviewActions.reduce((total, action) => total + action.estimatedBytes, 0))} needs confirmation</span>
            </article>
            <article className="stat-tile">
              <small>Duplicate passes</small>
              <strong>{duplicateActions.length}</strong>
              <span>{duplicateActions.reduce((total, action) => total + action.sourcePaths.length, 0)} heavy roots queued</span>
            </article>
            <article className="stat-tile">
              <small>Protected AppData</small>
              <strong>{protectCandidates.length}</strong>
              <span>{cleanupCandidates.length} cleanup candidates left after protections</span>
            </article>
          </div>

          <div className="ai-results-grid ai-results-grid--editorial">
            <article className="card full">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Operational Output</small>
                  <h3>Action Plan</h3>
                </div>
                <span className="muted">Use cleanup-first actions directly. Keep narrative notes secondary.</span>
              </header>

              {actionSections.length ? (
                <div className="ai-action-master-layout">
                  {actionSections.map((section) => (
                    <section key={section.id} className="ai-action-section ai-action-section--stacked">
                      <div className="ai-action-section-header">
                        <div>
                          <h4>{section.title}</h4>
                          <p className="muted">{section.description}</p>
                        </div>
                        <span className="risk-pill tone-neutral">{section.actions.length}</span>
                      </div>
                      <div className="ai-action-list ai-action-list--stacked">
                        {section.actions.map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            className={action.id === activeAction?.id ? "ai-action-card ai-action-card--editorial is-active" : "ai-action-card ai-action-card--editorial"}
                            onClick={() => setSelectedActionId(action.id)}
                          >
                            <div className="row spread center wrap">
                              <div className="stack gap-xs">
                                <strong>{action.title}</strong>
                                <span className="muted">{action.summary}</span>
                              </div>
                              <strong>{formatBytes(action.estimatedBytes)}</strong>
                            </div>
                            <div className="row wrap">
                              <span className="risk-pill tone-neutral">{aiActionKindLabel(action.kind)}</span>
                              <span className={`risk-pill ${appDataConfidenceClass(action.confidence)}`}>Confidence {action.confidence}</span>
                              <span className={`risk-pill ${toneClass(action.risk)}`}>Risk {action.risk}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}

                  <article className="card inset ai-action-inspector">
                    <small className="section-kicker">Inspector</small>
                    <h3>{activeAction ? "Selected action" : "No action selected"}</h3>
                    {activeAction ? (
                      <>
                        <strong>{`Focus: ${activeAction.title}`}</strong>
                        <p className="muted">{activeAction.summary}</p>
                        <div className="result-metric-grid result-metric-grid--compact">
                          <article className="result-metric">
                            <small>Impact</small>
                            <strong>{formatBytes(activeAction.estimatedBytes)}</strong>
                          </article>
                          <article className="result-metric">
                            <small>Confidence</small>
                            <strong>{activeAction.confidence}</strong>
                          </article>
                          <article className="result-metric">
                            <small>Risk</small>
                            <strong>{activeAction.risk}</strong>
                          </article>
                          <article className="result-metric">
                            <small>Targets</small>
                            <strong>{activeAction.sourcePaths.length}</strong>
                          </article>
                        </div>
                        <div className="row wrap">
                          <span className="risk-pill tone-neutral">{aiActionKindLabel(activeAction.kind)}</span>
                          <span className={`risk-pill ${appDataConfidenceClass(activeAction.confidence)}`}>Confidence {activeAction.confidence}</span>
                          <span className={`risk-pill ${toneClass(activeAction.risk)}`}>Risk {activeAction.risk}</span>
                        </div>
                        <div className="ai-action-target" title={actionPrimaryTarget(activeAction)}>
                          {shortPath(actionPrimaryTarget(activeAction))}
                        </div>
                        {actionEvidence(activeAction).length ? (
                          <ul className="ai-evidence-list">
                            {actionEvidence(activeAction).map((item) => (
                              <li key={`${activeAction.id}:${item}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">No extra evidence was attached to this structured action.</p>
                        )}
                        <div className="row wrap">
                          <button className="btn secondary" onClick={() => onApplyAiAction(activeAction, "use")}>
                            {actionUseLabel(activeAction)}
                          </button>
                          <button className="btn" onClick={() => onApplyAiAction(activeAction, activeAction.kind === "duplicate_scan" ? "use" : "preview")}>
                            {actionPreviewLabel(activeAction)}
                          </button>
                          <button className="btn secondary" onClick={() => onToggleAiCollectionAction(activeAction)}>
                            {activeCollectionActionIds.has(activeAction.id) ? "Remove From Collection" : "Add To Collection"}
                          </button>
                          <button
                            className="btn secondary"
                            onClick={() => onAddAiActionToAllowlist(activeAction)}
                            disabled={!activeAction.targetPath && !activeAction.sourcePaths[0]}
                          >
                            Allowlist Target
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="muted">Run analysis to populate the action inspector.</p>
                    )}
                  </article>
                </div>
              ) : (
                <p className="muted">No structured action was produced for this run.</p>
              )}
            </article>

            <article className="card full">
              <header className="panel-header compact">
                <div>
                  <small className="section-kicker">Bundles</small>
                  <h3>Suggested Collections</h3>
                </div>
                <span className="muted">Save them or push them straight into Cleanup Plan.</span>
              </header>
              {smartAiCollections.length ? (
                <div className="ai-collection-grid">
                  {smartAiCollections.map((suggestion) => {
                    const summary = collectionActionSummary(suggestion.actions);
                    const openInCleanup = () =>
                      suggestion.id === "safe_wins"
                        ? onApplyBestSafeWins(suggestion, "use")
                        : onApplySmartAiCollection(suggestion, "use");
                    const previewInCleanup = () =>
                      suggestion.id === "safe_wins"
                        ? onApplyBestSafeWins(suggestion, "preview")
                        : onApplySmartAiCollection(suggestion, "preview");

                    return (
                      <article key={suggestion.id} className="card inset ai-collection-card ai-collection-card--editorial">
                        <div className="row spread center wrap">
                          <strong>{suggestion.name}</strong>
                          <span className={`risk-pill ${suggestion.accent === "priority" ? "tone-medium" : "tone-low"}`}>
                            {formatBytes(suggestion.estimatedBytes)}
                          </span>
                        </div>
                        <p className="muted">{suggestion.description}</p>
                        <div className="row wrap">
                          <span className="risk-pill tone-neutral">Score {suggestion.score}</span>
                          <span className="risk-pill tone-neutral">Impact {suggestion.impact}</span>
                          <span className={`risk-pill ${appDataConfidenceClass(suggestion.confidence)}`}>Confidence {suggestion.confidence}</span>
                          <span className={`risk-pill ${toneClass(suggestion.risk)}`}>Risk {suggestion.risk}</span>
                          <span className="risk-pill tone-neutral">{summary.cleanup.length} cleanup</span>
                          <span className="risk-pill tone-neutral">{summary.duplicates.length} duplicate</span>
                        </div>
                        <div className="row wrap">
                          <button className="btn secondary" onClick={openInCleanup}>
                            {summary.cleanup.length
                              ? suggestion.id === "safe_wins"
                                ? "Apply Best Safe Wins"
                                : "Use Bundle"
                              : "Open Duplicates"}
                          </button>
                          {summary.cleanup.length > 0 && (
                            <button className="btn" onClick={previewInCleanup}>
                              {suggestion.id === "safe_wins" ? "Preview Safe Wins" : "Preview Bundle"}
                            </button>
                          )}
                          <button className="btn secondary" onClick={() => onCreateCollectionFromSuggestion(suggestion)}>
                            Create Suggested Collection
                          </button>
                          <button className="btn secondary" onClick={() => onMergeSuggestionIntoActiveCollection(suggestion)}>
                            Merge Into Active Collection
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">This run did not produce enough clustered actions to suggest a bundle.</p>
              )}
            </article>

            <article className="card ai-sidebar-card">
              <small className="section-kicker">Collections</small>
              <h3>Saved AI Collection</h3>
              <label>
                Active collection
                <select value={activeAiCollection?.id ?? ""} onChange={(event) => onSetActiveAiCollectionId(event.target.value)}>
                  <option value="">Select a collection</option>
                  {aiCollections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Collection name
                <input value={aiCollectionNameInput} onChange={(event) => setAiCollectionNameInput(event.target.value)} placeholder="My AI Collection" />
              </label>
              <p className="muted">
                {activeAiCollection
                  ? `${activeAiCollection.actions.length} stored actions - ${formatBytes(aiCollectionEstimatedBytes)} estimated impact`
                  : `${aiCollections.length} saved collection${aiCollections.length === 1 ? "" : "s"}.`}
              </p>
              <div className="row wrap">
                <button className="btn secondary" onClick={() => onCreateAiCollection()}>New Collection</button>
                <button className="btn secondary" onClick={() => onSaveActiveAiCollectionName()} disabled={!aiCollectionNameInput.trim()}>Save Name</button>
                <button className="btn secondary" onClick={() => onDeleteActiveAiCollection()} disabled={!activeAiCollection}>Delete</button>
                <button className="btn secondary" onClick={() => onApplyAiCollection("use")} disabled={!activeCollectionActions.length}>Use Collection In Scan</button>
                <button className="btn" onClick={() => onApplyAiCollection("preview")} disabled={!activeCollectionActions.length}>Preview Collection Cleanup</button>
                <button className="btn secondary" onClick={() => onOpenAiCollectionDuplicates()} disabled={!collectionDuplicateActions.length}>Open Collection Duplicates</button>
                <button className="btn secondary" onClick={() => onClearActiveAiCollection()} disabled={!activeCollectionActions.length}>Clear Collection</button>
              </div>
              {activeCollectionActions.length ? (
                <ul className="ai-compact-list">
                  {activeCollectionActions.slice(0, 8).map((action) => (
                    <li key={action.id}>
                      <span title={actionPrimaryTarget(action)}>{action.title}</span>
                      <strong>{formatBytes(action.estimatedBytes)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Add actions from the sections above to work with them as one cleanup bundle.</p>
              )}
            </article>

            <article className="card ai-sidebar-card">
              <small className="section-kicker">AppData</small>
              <h3>Likely Stale AppData Candidates</h3>
              <div className="stat-cluster">
                <article className="stat-tile">
                  <small>Cleanup candidates</small>
                  <strong>{cleanupCandidates.length}</strong>
                </article>
                <article className="stat-tile">
                  <small>Review first</small>
                  <strong>{reviewCandidates.length}</strong>
                </article>
                <article className="stat-tile">
                  <small>Protected</small>
                  <strong>{protectCandidates.length}</strong>
                </article>
                <article className="stat-tile">
                  <small>Safe wins</small>
                  <strong>{safeWinActions.length}</strong>
                </article>
              </div>
              {safeWinsSuggestion ? (
                <div className="row wrap">
                  <button className="btn secondary" onClick={() => onApplyBestSafeWins(safeWinsSuggestion, "use")}>Select Safe Wins</button>
                  <button className="btn" onClick={() => onApplyBestSafeWins(safeWinsSuggestion, "preview")}>Preview Safe Wins</button>
                </div>
              ) : null}
              <div className="ai-candidate-lane ai-candidate-lane--compact">
                {(cleanupCandidates.slice(0, 3)).map((candidate) => (
                  <article key={candidate.path} className="ai-candidate-card">
                    <div className="row spread center wrap">
                      <strong>{candidate.name}</strong>
                      <span className={`risk-pill ${appDataConfidenceClass(candidate.confidence)}`}>{candidate.confidence}</span>
                    </div>
                    <div className="ai-action-target" title={candidate.path}>{shortPath(candidate.path)}</div>
                    <div className="row wrap">
                      <span className="risk-pill tone-low">{formatBytes(candidate.sizeBytes)}</span>
                      <span className="risk-pill tone-neutral">{candidate.daysSinceModified} d stale</span>
                      <span className={`risk-pill ${appDataDispositionClass(candidate.disposition)}`}>{candidate.disposition.replace(/_/g, " ")}</span>
                    </div>
                    <p className="muted">{candidate.reason}</p>
                    <p className="muted">Last touched {formatDate(candidate.lastModified)}</p>
                    <div className="row wrap">
                      <button className="btn secondary" onClick={() => onAddAiPathToAllowlist(candidate.path)}>Protect Path</button>
                      <button className="btn secondary" onClick={() => onAddAiAppToAllowlist(candidate.installedAppName ?? candidate.name)}>Protect App</button>
                    </div>
                  </article>
                ))}
              </div>
              <details className="settings-advanced-panel">
                <summary>AppData review lanes</summary>
                <div className="ai-candidate-lanes">
                  <section className="ai-candidate-lane">
                    <div className="ai-candidate-lane-header">
                      <h4>Cleanup candidates</h4>
                      <span className="risk-pill tone-low">{cleanupCandidates.length}</span>
                    </div>
                    {cleanupCandidates.length ? cleanupCandidates.slice(0, 6).map((candidate) => (
                      <article key={candidate.path} className="ai-candidate-card">
                        <div className="row spread center wrap">
                          <strong>{candidate.name}</strong>
                          <span className={`risk-pill ${appDataConfidenceClass(candidate.confidence)}`}>{candidate.confidence}</span>
                        </div>
                        <div className="ai-action-target" title={candidate.path}>{shortPath(candidate.path)}</div>
                        <p className="muted">{candidate.reason}</p>
                        {!candidate.referencedAnywhere && <p className="muted">No active reference signals found</p>}
                      </article>
                    )) : <p className="muted">No strong AppData cleanup candidates were detected.</p>}
                  </section>
                  <section className="ai-candidate-lane">
                    <div className="ai-candidate-lane-header">
                      <h4>Review first</h4>
                      <span className="risk-pill tone-neutral">{reviewCandidates.length}</span>
                    </div>
                    {reviewCandidates.length ? reviewCandidates.slice(0, 6).map((candidate) => (
                      <article key={candidate.path} className="ai-candidate-card">
                        <div className="row spread center wrap">
                          <strong>{candidate.name}</strong>
                          <span className={`risk-pill ${appDataDispositionClass(candidate.disposition)}`}>{candidate.disposition.replace(/_/g, " ")}</span>
                        </div>
                        <div className="ai-action-target" title={candidate.path}>{shortPath(candidate.path)}</div>
                        <p className="muted">{candidate.reason}</p>
                        {candidate.dispositionReason && <p className="muted">{candidate.dispositionReason}</p>}
                      </article>
                    )) : <p className="muted">No medium-confidence review candidates were detected.</p>}
                  </section>
                  <section className="ai-candidate-lane">
                    <div className="ai-candidate-lane-header">
                      <h4>Protected</h4>
                      <span className="risk-pill tone-medium">{protectCandidates.length}</span>
                    </div>
                    {protectCandidates.length ? protectCandidates.slice(0, 6).map((candidate) => (
                      <article key={candidate.path} className="ai-candidate-card">
                        <div className="row spread center wrap">
                          <strong>{candidate.name}</strong>
                          <span className={`risk-pill ${appDataDispositionClass(candidate.disposition)}`}>{candidate.disposition.replace(/_/g, " ")}</span>
                        </div>
                        <div className="ai-action-target" title={candidate.path}>{shortPath(candidate.path)}</div>
                        <p className="muted">{candidate.dispositionReason ?? candidate.reason}</p>
                        {candidate.installedAppName && <p className="muted">Installed app: {candidate.installedAppName}</p>}
                        {candidate.matchedInstalledApp && <p className="muted">Matched installed app</p>}
                      </article>
                    )) : <p className="muted">No protected AppData signals were surfaced in this run.</p>}
                  </section>
                </div>
              </details>
              <details className="settings-advanced-panel">
                <summary>Pattern notes and model text</summary>
                <ul className="ai-compact-list">
                  {aiAnalysis.summary.topFolders.slice(0, 5).map((item) => (
                    <li key={item.path}>
                      <span title={item.path}>{shortPath(item.path)}</span>
                      <strong>{formatBytes(item.sizeBytes)}</strong>
                    </li>
                  ))}
                </ul>
                <ul className="ai-chip-list">
                  {aiAnalysis.summary.topExtensions.slice(0, 8).map((item) => (
                    <li key={item.extension} className="risk-pill tone-neutral">
                      {item.extension} / {item.count}
                    </li>
                  ))}
                </ul>
                <pre className="markdown-block">{aiAnalysis.recommendationsMarkdown}</pre>
              </details>
            </article>
          </div>
        </>
      ) : (
        <article className="card ai-empty-state decision-empty-state">
          <small className="section-kicker">No analysis loaded</small>
          <h3>Run machine analysis</h3>
          <p className="muted">
            Build structured actions, AppData signals, duplicate opportunities, and cleanup bundles for this Windows machine.
          </p>
        </article>
      )}
    </section>
  );
}
