import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AIActionSuggestion, CleanupCategory, ScanFinding } from "../../../types";

type CleanupQuickFilter = "all" | "selected" | "ai_selected" | "recommended";
type CleanupGroupBy = "category" | "folder" | "extension" | "risk";

interface NamedAiCollection {
  id: string;
  name: string;
  actions: AIActionSuggestion[];
  createdAt: number;
  updatedAt: number;
}

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

interface CollectionActionSummary {
  cleanup: AIActionSuggestion[];
  duplicates: AIActionSuggestion[];
}

interface UseAiCollectionsControllerArgs {
  activeRunId: string;
  findings: ScanFinding[];
  scanCategoryValues: CleanupCategory[];
  activeAiCollection: NamedAiCollection | null;
  aiCollectionNameInput: string;
  aiCollections: NamedAiCollection[];
  collectionDuplicateActions: AIActionSuggestion[];
  defaultAiCollectionName: string;
  createNamedAiCollection: (name: string, actions?: AIActionSuggestion[]) => NamedAiCollection;
  normalizeCollectionName: (value: string) => string;
  uniqueCollectionName: (name: string, collections: NamedAiCollection[]) => string;
  dedupeAiActions: (actions: AIActionSuggestion[]) => AIActionSuggestion[];
  collectionActionSummary: (actions: AIActionSuggestion[]) => CollectionActionSummary;
  buildCollectionFocusAction: (actions: AIActionSuggestion[]) => AIActionSuggestion;
  buildSuggestionFocusAction: (suggestion: SmartAiCollectionSuggestion) => AIActionSuggestion;
  actionMatchesFinding: (action: AIActionSuggestion, finding: ScanFinding) => boolean;
  actionRoots: (action: AIActionSuggestion) => string[];
  setAiCollections: Dispatch<SetStateAction<NamedAiCollection[]>>;
  setActiveAiCollectionId: Dispatch<SetStateAction<string>>;
  setAiCollectionNameInput: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<any>>;
  setPendingAiAction: Dispatch<SetStateAction<AIActionSuggestion | null>>;
  setQueuedAiPreview: Dispatch<SetStateAction<boolean>>;
  setAiSuggestedFindingIds: Dispatch<SetStateAction<string[]>>;
  setSelectedFindingIds: Dispatch<SetStateAction<string[]>>;
  setCleanupQuickFilter: Dispatch<SetStateAction<CleanupQuickFilter>>;
  setCleanupGroupBy: Dispatch<SetStateAction<CleanupGroupBy>>;
  setCleanupPreviewScope: Dispatch<SetStateAction<"selected" | "all">>;
  setScanCategories: Dispatch<SetStateAction<CleanupCategory[]>>;
  startScan: (overrides?: any) => Promise<void>;
  runCleanupPreviewForSelection: (runId: string, selectedIds: string[], contextLabel?: string) => Promise<void>;
}

export function useAiCollectionsController({
  activeRunId,
  findings,
  scanCategoryValues,
  activeAiCollection,
  aiCollectionNameInput,
  aiCollections,
  collectionDuplicateActions,
  defaultAiCollectionName,
  createNamedAiCollection,
  normalizeCollectionName,
  uniqueCollectionName,
  dedupeAiActions,
  collectionActionSummary,
  buildCollectionFocusAction,
  buildSuggestionFocusAction,
  actionMatchesFinding,
  actionRoots,
  setAiCollections,
  setActiveAiCollectionId,
  setAiCollectionNameInput,
  setStatus,
  setTab,
  setPendingAiAction,
  setQueuedAiPreview,
  setAiSuggestedFindingIds,
  setSelectedFindingIds,
  setCleanupQuickFilter,
  setCleanupGroupBy,
  setCleanupPreviewScope,
  setScanCategories,
  startScan,
  runCleanupPreviewForSelection
}: UseAiCollectionsControllerArgs) {
  const openDuplicateActions = useCallback((actions: AIActionSuggestion[], label: string) => {
    const roots = [...new Set(actions.flatMap((item) => item.sourcePaths))];
    if (!roots.length) {
      setStatus(`No duplicate-scan actions are available for "${label}".`);
      return;
    }
    setTab("duplicates");
    setStatus(`${label} is ready in Duplicates. The duplicate pass now uses the whole machine by default.`);
  }, [setStatus, setTab]);

  const applyAiActionSet = useCallback(
    (actions: AIActionSuggestion[], label: string, mode: "use" | "preview" = "use") => {
      const { cleanup, duplicates } = collectionActionSummary(actions);
      if (!cleanup.length) {
        if (duplicates.length) {
          openDuplicateActions(duplicates, label);
          return;
        }
        setStatus(`"${label}" has no actionable items.`);
        return;
      }

      const collectionFocusAction = buildCollectionFocusAction(cleanup);
      const matchedCurrentFindings = findings
        .filter((item) => cleanup.some((action) => actionMatchesFinding(action, item)))
        .map((item) => item.id);

      if (matchedCurrentFindings.length > 0) {
        setPendingAiAction(collectionFocusAction);
        setQueuedAiPreview(mode === "preview");
        setAiSuggestedFindingIds(matchedCurrentFindings);
        setSelectedFindingIds(matchedCurrentFindings);
        setCleanupQuickFilter("ai_selected");
        setCleanupGroupBy("category");
        setCleanupPreviewScope("selected");
        setTab("cleanup");
        if (mode === "preview" && activeRunId) {
          void runCleanupPreviewForSelection(activeRunId, matchedCurrentFindings, collectionFocusAction.title);
        } else {
          setStatus(`Applied "${label}" to current findings. ${matchedCurrentFindings.length} item(s) selected in Cleanup Plan.`);
        }
        return;
      }

      const roots = [...new Set(cleanup.flatMap((item) => actionRoots(item)))];
      if (!roots.length) {
        setStatus(`"${label}" has no usable scan roots.`);
        return;
      }

      setScanCategories(scanCategoryValues);
      setTab("scan");
      void startScan({
        roots,
        categories: scanCategoryValues,
        aiAction: collectionFocusAction,
        queuePreview: mode === "preview"
      });
    },
    [
      activeRunId,
      actionMatchesFinding,
      actionRoots,
      buildCollectionFocusAction,
      collectionActionSummary,
      findings,
      openDuplicateActions,
      runCleanupPreviewForSelection,
      scanCategoryValues,
      setAiSuggestedFindingIds,
      setCleanupGroupBy,
      setCleanupPreviewScope,
      setCleanupQuickFilter,
      setPendingAiAction,
      setQueuedAiPreview,
      setScanCategories,
      setSelectedFindingIds,
      setStatus,
      setTab,
      startScan
    ]
  );

  const createAiCollection = useCallback((name?: string) => {
    const collection = createNamedAiCollection(name ?? aiCollectionNameInput);
    setAiCollections((current) => [...current, collection]);
    setActiveAiCollectionId(collection.id);
    setAiCollectionNameInput(collection.name);
    setStatus(`AI collection "${collection.name}" created.`);
  }, [aiCollectionNameInput, createNamedAiCollection, setActiveAiCollectionId, setAiCollectionNameInput, setAiCollections, setStatus]);

  const saveActiveAiCollectionName = useCallback(() => {
    if (!activeAiCollection) {
      createAiCollection(aiCollectionNameInput);
      return;
    }
    const nextName = normalizeCollectionName(aiCollectionNameInput);
    if (nextName === activeAiCollection.name) {
      setStatus(`AI collection "${nextName}" is already up to date.`);
      return;
    }
    setAiCollections((current) =>
      current.map((collection) =>
        collection.id === activeAiCollection.id
          ? {
              ...collection,
              name: nextName,
              updatedAt: Date.now()
            }
          : collection
      )
    );
    setAiCollectionNameInput(nextName);
    setStatus(`AI collection renamed to "${nextName}".`);
  }, [activeAiCollection, aiCollectionNameInput, createAiCollection, normalizeCollectionName, setAiCollectionNameInput, setAiCollections, setStatus]);

  const deleteActiveAiCollection = useCallback(() => {
    if (!activeAiCollection) {
      setStatus("No AI collection selected.");
      return;
    }
    const remainingCollections = aiCollections.filter((collection) => collection.id !== activeAiCollection.id);
    setAiCollections(remainingCollections);
    setActiveAiCollectionId(remainingCollections[0]?.id ?? "");
    setAiCollectionNameInput(remainingCollections[0]?.name ?? defaultAiCollectionName);
    setStatus(`AI collection "${activeAiCollection.name}" deleted.`);
  }, [activeAiCollection, aiCollections, defaultAiCollectionName, setActiveAiCollectionId, setAiCollectionNameInput, setAiCollections, setStatus]);

  const toggleAiCollectionAction = useCallback((action: AIActionSuggestion) => {
    const targetCollection =
      activeAiCollection ??
      createNamedAiCollection(aiCollectionNameInput === defaultAiCollectionName ? defaultAiCollectionName : aiCollectionNameInput);
    const collectionAlreadyExists = aiCollections.some((collection) => collection.id === targetCollection.id);
    const actionExists = targetCollection.actions.some((item) => item.id === action.id);
    const nextActions = actionExists
      ? targetCollection.actions.filter((item) => item.id !== action.id)
      : dedupeAiActions([...targetCollection.actions, action]);
    const nextCollection: NamedAiCollection = {
      ...targetCollection,
      name: normalizeCollectionName(targetCollection.name),
      actions: nextActions,
      updatedAt: Date.now()
    };

    setAiCollections(
      collectionAlreadyExists
        ? aiCollections.map((collection) => (collection.id === nextCollection.id ? nextCollection : collection))
        : [...aiCollections, nextCollection]
    );
    if (!collectionAlreadyExists) {
      setActiveAiCollectionId(nextCollection.id);
      setAiCollectionNameInput(nextCollection.name);
    }
  }, [activeAiCollection, aiCollectionNameInput, aiCollections, createNamedAiCollection, dedupeAiActions, defaultAiCollectionName, normalizeCollectionName, setActiveAiCollectionId, setAiCollectionNameInput, setAiCollections]);

  const clearActiveAiCollection = useCallback(() => {
    if (!activeAiCollection) {
      setStatus("No AI collection selected.");
      return;
    }
    setAiCollections((current) =>
      current.map((collection) =>
        collection.id === activeAiCollection.id
          ? {
              ...collection,
              actions: [],
              updatedAt: Date.now()
            }
          : collection
      )
    );
    setStatus(`AI collection "${activeAiCollection.name}" cleared.`);
  }, [activeAiCollection, setAiCollections, setStatus]);

  const openAiCollectionDuplicates = useCallback(() => {
    if (!activeAiCollection) {
      setStatus("No AI collection selected.");
      return;
    }
    openDuplicateActions(collectionDuplicateActions, activeAiCollection.name);
  }, [activeAiCollection, collectionDuplicateActions, openDuplicateActions, setStatus]);

  const applyAiCollection = useCallback((mode: "use" | "preview" = "use") => {
    if (!activeAiCollection) {
      setStatus("No AI collection selected.");
      return;
    }
    applyAiActionSet(activeAiCollection.actions, activeAiCollection.name, mode);
  }, [activeAiCollection, applyAiActionSet, setStatus]);

  const createCollectionFromSuggestion = useCallback((suggestion: SmartAiCollectionSuggestion) => {
    const collection = createNamedAiCollection(uniqueCollectionName(suggestion.name, aiCollections), suggestion.actions);
    setAiCollections((current) => [...current, collection]);
    setActiveAiCollectionId(collection.id);
    setAiCollectionNameInput(collection.name);
    setStatus(`Suggested AI collection "${collection.name}" created.`);
  }, [aiCollections, createNamedAiCollection, setActiveAiCollectionId, setAiCollectionNameInput, setAiCollections, setStatus, uniqueCollectionName]);

  const mergeSuggestionIntoActiveCollection = useCallback((suggestion: SmartAiCollectionSuggestion) => {
    const targetCollection =
      activeAiCollection ??
      createNamedAiCollection(aiCollectionNameInput === defaultAiCollectionName ? defaultAiCollectionName : aiCollectionNameInput);
    const mergedActions = dedupeAiActions([...targetCollection.actions, ...suggestion.actions]);
    const nextCollection: NamedAiCollection = {
      ...targetCollection,
      name: normalizeCollectionName(targetCollection.name),
      actions: mergedActions,
      updatedAt: Date.now()
    };
    const collectionAlreadyExists = aiCollections.some((collection) => collection.id === targetCollection.id);
    setAiCollections(
      collectionAlreadyExists
        ? aiCollections.map((collection) => (collection.id === nextCollection.id ? nextCollection : collection))
        : [...aiCollections, nextCollection]
    );
    setActiveAiCollectionId(nextCollection.id);
    setAiCollectionNameInput(nextCollection.name);
    setStatus(
      `"${suggestion.name}" merged into "${nextCollection.name}" (${suggestion.actions.length} action${suggestion.actions.length === 1 ? "" : "s"}).`
    );
  }, [activeAiCollection, aiCollectionNameInput, aiCollections, createNamedAiCollection, dedupeAiActions, defaultAiCollectionName, normalizeCollectionName, setActiveAiCollectionId, setAiCollectionNameInput, setAiCollections, setStatus]);

  const applySmartAiCollection = useCallback((suggestion: SmartAiCollectionSuggestion, mode: "use" | "preview" = "use") => {
    applyAiActionSet(suggestion.actions, suggestion.name, mode);
  }, [applyAiActionSet]);

  const applyBestSafeWins = useCallback(async (suggestion: SmartAiCollectionSuggestion, mode: "use" | "preview" = "use") => {
    const focusAction = buildSuggestionFocusAction(suggestion);
    const matchedCurrentFindings = findings
      .filter((item) => suggestion.actions.some((action) => actionMatchesFinding(action, item)))
      .map((item) => item.id);

    if (matchedCurrentFindings.length > 0 && activeRunId && mode === "use") {
      setPendingAiAction(focusAction);
      setQueuedAiPreview(false);
      setAiSuggestedFindingIds(matchedCurrentFindings);
      setSelectedFindingIds(matchedCurrentFindings);
      setCleanupQuickFilter("ai_selected");
      setCleanupGroupBy("category");
      setCleanupPreviewScope("selected");
      await runCleanupPreviewForSelection(activeRunId, matchedCurrentFindings, suggestion.name);
      return;
    }

    applyAiActionSet(suggestion.actions, suggestion.name, mode);
  }, [activeRunId, actionMatchesFinding, applyAiActionSet, buildSuggestionFocusAction, findings, runCleanupPreviewForSelection, setAiSuggestedFindingIds, setCleanupGroupBy, setCleanupPreviewScope, setCleanupQuickFilter, setPendingAiAction, setQueuedAiPreview, setSelectedFindingIds]);

  return {
    createAiCollection,
    saveActiveAiCollectionName,
    deleteActiveAiCollection,
    toggleAiCollectionAction,
    clearActiveAiCollection,
    openAiCollectionDuplicates,
    applyAiCollection,
    createCollectionFromSuggestion,
    mergeSuggestionIntoActiveCollection,
    applySmartAiCollection,
    applyBestSafeWins
  };
}
