import { useCallback } from "react";

import type { AIActionSuggestion } from "../../../types";

interface UseSettingsControllerArgs {
  settings: any;
  defaultSettings: any;
  scheduler: any;
  activeProtectionProfile: any;
  compareProtectionProfile: any;
  protectionProfiles: any[];
  protectionProfileNameInput: string;
  protectionProfileComparison: any;
  promoteComparisonDiff: any;
  selectedPromotionPaths: string[];
  selectedPromotionApps: string[];
  allowlistImportReview: any;
  allowlistImportModeRef: React.MutableRefObject<"merge" | "replace">;
  allowlistImportInputRef: React.RefObject<HTMLInputElement>;
  protectionProfileImportInputRef: React.RefObject<HTMLInputElement>;
  protectionDiffImportInputRef: React.RefObject<HTMLInputElement>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setSettings: React.Dispatch<any>;
  setScheduler: React.Dispatch<any>;
  setUpdates: React.Dispatch<any>;
  setProtectionProfiles: React.Dispatch<any>;
  setActiveProtectionProfileId: React.Dispatch<any>;
  setProtectionProfileNameInput: React.Dispatch<any>;
  setSelectedPromotionPaths: React.Dispatch<any>;
  setSelectedPromotionApps: React.Dispatch<any>;
  setAllowlistImportReview: React.Dispatch<any>;
  uniqueTrimmedStrings: (values: string[]) => string[];
  createProtectionProfile: (name: string, value: { neverCleanupPaths: string[]; neverCleanupApps: string[] }) => any;
  uniqueProtectionProfileName: (name: string, profiles: any[]) => string;
  readTextFile: (file: File) => Promise<string>;
  parseProtectionProfileDocument: (raw: string) => Array<{ name: string; neverCleanupPaths: string[]; neverCleanupApps: string[] }>;
  parseProtectionDiffDocument: (raw: string) => { paths: string[]; apps: string[] };
  diffNormalizedStrings: (current: string[], next: string[]) => { added: string[]; removed: string[] };
  downloadFile: (content: string, fileName: string, mimeType: string) => void;
  escapeCsvCell: (value: string) => string;
  shortPath: (value: string) => string;
  defaultProtectionProfileName: string;
}

export function useSettingsController({
  settings,
  defaultSettings,
  scheduler,
  activeProtectionProfile,
  compareProtectionProfile,
  protectionProfiles,
  protectionProfileNameInput,
  protectionProfileComparison,
  promoteComparisonDiff,
  selectedPromotionPaths,
  selectedPromotionApps,
  allowlistImportReview,
  allowlistImportModeRef,
  allowlistImportInputRef,
  protectionProfileImportInputRef,
  protectionDiffImportInputRef,
  setStatus,
  setSettings,
  setScheduler,
  setUpdates,
  setProtectionProfiles,
  setActiveProtectionProfileId,
  setProtectionProfileNameInput,
  setSelectedPromotionPaths,
  setSelectedPromotionApps,
  setAllowlistImportReview,
  uniqueTrimmedStrings,
  createProtectionProfile,
  uniqueProtectionProfileName,
  readTextFile,
  parseProtectionProfileDocument,
  parseProtectionDiffDocument,
  diffNormalizedStrings,
  downloadFile,
  escapeCsvCell,
  shortPath,
  defaultProtectionProfileName
}: UseSettingsControllerArgs) {
  const saveSettings = useCallback(async () => {
    const updated = await window.desktopApi.updateSettings(settings);
    setSettings((current: any) => ({ ...defaultSettings, ...current, ...updated }));
    setStatus("Settings saved");
  }, [defaultSettings, setSettings, setStatus, settings]);

  const persistAllowlistSettings = useCallback(async (nextPaths: string[], nextApps: string[], successMessage: string) => {
    const updated = await window.desktopApi.updateSettings({
      neverCleanupPaths: uniqueTrimmedStrings(nextPaths),
      neverCleanupApps: uniqueTrimmedStrings(nextApps)
    });
    setSettings((current: any) => ({ ...current, ...updated }));
    setStatus(successMessage);
  }, [setSettings, setStatus, uniqueTrimmedStrings]);

  const addRejectedPathToAllowlist = useCallback(async (targetPath: string) => {
    await persistAllowlistSettings(
      [...settings.neverCleanupPaths, targetPath],
      settings.neverCleanupApps,
      "Added path to never-cleanup allowlist."
    );
  }, [persistAllowlistSettings, settings.neverCleanupApps, settings.neverCleanupPaths]);

  const addRejectedAppToAllowlist = useCallback(async (appName?: string) => {
    const safeName = String(appName ?? "").trim();
    if (!safeName) {
      setStatus("No matched app is available for this safety item.");
      return;
    }
    await persistAllowlistSettings(
      settings.neverCleanupPaths,
      [...settings.neverCleanupApps, safeName],
      `Added ${safeName} to never-cleanup allowlist.`
    );
  }, [persistAllowlistSettings, setStatus, settings.neverCleanupApps, settings.neverCleanupPaths]);

  const addFindingPathToAllowlist = useCallback(async (targetPath: string) => {
    await persistAllowlistSettings(
      [...settings.neverCleanupPaths, targetPath],
      settings.neverCleanupApps,
      "Added cleanup path to never-cleanup allowlist."
    );
  }, [persistAllowlistSettings, settings.neverCleanupApps, settings.neverCleanupPaths]);

  const addAiActionToAllowlist = useCallback(async (action: AIActionSuggestion) => {
    const target = action.targetPath ?? action.sourcePaths[0];
    if (!target) {
      setStatus("No target path is available for this AI action.");
      return;
    }
    await persistAllowlistSettings(
      [...settings.neverCleanupPaths, target],
      settings.neverCleanupApps,
      `Added AI target to never-cleanup allowlist: ${shortPath(target)}`
    );
  }, [persistAllowlistSettings, setStatus, settings.neverCleanupApps, settings.neverCleanupPaths, shortPath]);

  const saveScheduler = useCallback(async () => {
    const result = await window.desktopApi.setScheduler({
      enabled: settings.scheduleEnabled,
      cadence: "weekly",
      dayOfWeek: settings.scheduleDayOfWeek,
      time: settings.scheduleTime
    });
    setScheduler(result.scheduler);
    setStatus("Scheduler updated");
  }, [setScheduler, setStatus, settings.scheduleDayOfWeek, settings.scheduleEnabled, settings.scheduleTime]);

  const checkUpdates = useCallback(async () => {
    const result = await window.desktopApi.checkUpdates();
    setUpdates(result);
    setStatus(result.hasUpdate ? `Update available: ${result.latestVersion}` : "App is up to date");
  }, [setStatus, setUpdates]);

  const exportAllowlistProfile = useCallback(() => {
    const payload = {
      version: 2,
      kind: "cleanup-pilot-protection-profile",
      name: "Current Settings Allowlist",
      exportedAt: Date.now(),
      neverCleanupPaths: settings.neverCleanupPaths,
      neverCleanupApps: settings.neverCleanupApps
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-allowlist-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Never-cleanup allowlist exported.");
  }, [setStatus, settings.neverCleanupApps, settings.neverCleanupPaths]);

  const saveCurrentAsProtectionProfile = useCallback(() => {
    const nextName = uniqueProtectionProfileName(protectionProfileNameInput, protectionProfiles);
    const profile = createProtectionProfile(nextName, {
      neverCleanupPaths: settings.neverCleanupPaths,
      neverCleanupApps: settings.neverCleanupApps
    });
    setProtectionProfiles((current: any[]) => [...current, profile]);
    setActiveProtectionProfileId(profile.id);
    setProtectionProfileNameInput(profile.name);
    setStatus(`Saved current protection settings as "${profile.name}".`);
  }, [
    createProtectionProfile,
    protectionProfileNameInput,
    protectionProfiles,
    setActiveProtectionProfileId,
    setProtectionProfileNameInput,
    setProtectionProfiles,
    setStatus,
    settings.neverCleanupApps,
    settings.neverCleanupPaths,
    uniqueProtectionProfileName
  ]);

  const renameActiveProtectionProfile = useCallback(() => {
    if (!activeProtectionProfile) {
      setStatus("No protection profile selected.");
      return;
    }
    const otherProfiles = protectionProfiles.filter((profile) => profile.id !== activeProtectionProfile.id);
    const nextName = uniqueProtectionProfileName(protectionProfileNameInput, otherProfiles);
    setProtectionProfiles((current: any[]) =>
      current.map((profile) =>
        profile.id === activeProtectionProfile.id
          ? {
              ...profile,
              name: nextName,
              updatedAt: Date.now()
            }
          : profile
      )
    );
    setProtectionProfileNameInput(nextName);
    setStatus(`Protection profile renamed to "${nextName}".`);
  }, [activeProtectionProfile, protectionProfileNameInput, protectionProfiles, setProtectionProfileNameInput, setProtectionProfiles, setStatus, uniqueProtectionProfileName]);

  const updateActiveProtectionProfileFromSettings = useCallback(() => {
    if (!activeProtectionProfile) {
      setStatus("No protection profile selected.");
      return;
    }
    setProtectionProfiles((current: any[]) =>
      current.map((profile) =>
        profile.id === activeProtectionProfile.id
          ? {
              ...profile,
              neverCleanupPaths: uniqueTrimmedStrings(settings.neverCleanupPaths),
              neverCleanupApps: uniqueTrimmedStrings(settings.neverCleanupApps),
              updatedAt: Date.now()
            }
          : profile
      )
    );
    setStatus(`Protection profile "${activeProtectionProfile.name}" updated from current settings.`);
  }, [activeProtectionProfile, setProtectionProfiles, setStatus, settings.neverCleanupApps, settings.neverCleanupPaths, uniqueTrimmedStrings]);

  const applyActiveProtectionProfileToSettings = useCallback(async (mode: "replace" | "merge" = "replace") => {
    if (!activeProtectionProfile) {
      setStatus("No protection profile selected.");
      return;
    }

    const nextPaths =
      mode === "merge"
        ? uniqueTrimmedStrings([...settings.neverCleanupPaths, ...activeProtectionProfile.neverCleanupPaths])
        : activeProtectionProfile.neverCleanupPaths;
    const nextApps =
      mode === "merge"
        ? uniqueTrimmedStrings([...settings.neverCleanupApps, ...activeProtectionProfile.neverCleanupApps])
        : activeProtectionProfile.neverCleanupApps;

    await persistAllowlistSettings(
      nextPaths,
      nextApps,
      mode === "merge"
        ? `Merged protection profile "${activeProtectionProfile.name}" into current allowlist.`
        : `Applied protection profile "${activeProtectionProfile.name}".`
    );
  }, [activeProtectionProfile, persistAllowlistSettings, settings.neverCleanupApps, settings.neverCleanupPaths, uniqueTrimmedStrings]);

  const promoteComparisonDiffToCurrent = useCallback(async (scope: "all" | "paths" | "apps" = "all") => {
    if (!promoteComparisonDiff) {
      setStatus("No comparison diff is available to promote.");
      return;
    }

    const includePaths = scope === "all" || scope === "paths";
    const includeApps = scope === "all" || scope === "apps";
    const nextPaths = includePaths
      ? uniqueTrimmedStrings([...settings.neverCleanupPaths, ...selectedPromotionPaths])
      : settings.neverCleanupPaths;
    const nextApps = includeApps
      ? uniqueTrimmedStrings([...settings.neverCleanupApps, ...selectedPromotionApps])
      : settings.neverCleanupApps;
    if (
      (scope === "all" && !selectedPromotionPaths.length && !selectedPromotionApps.length) ||
      (scope === "paths" && !selectedPromotionPaths.length) ||
      (scope === "apps" && !selectedPromotionApps.length)
    ) {
      setStatus("No selected diff entries are available to promote.");
      return;
    }
    await persistAllowlistSettings(
      nextPaths,
      nextApps,
      `Promoted ${includePaths ? selectedPromotionPaths.length : 0} paths and ${includeApps ? selectedPromotionApps.length : 0} apps from "${promoteComparisonDiff.sourceName}" into current allowlist.`
    );
  }, [persistAllowlistSettings, promoteComparisonDiff, selectedPromotionApps, selectedPromotionPaths, setStatus, settings.neverCleanupApps, settings.neverCleanupPaths, uniqueTrimmedStrings]);

  const exportProtectionProfileDiff = useCallback((format: "json" | "csv") => {
    if (!activeProtectionProfile || !compareProtectionProfile || !protectionProfileComparison) {
      setStatus("No protection profile diff is available to export.");
      return;
    }

    const safeActive = activeProtectionProfile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    const safeCompare = compareProtectionProfile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();

    if (format === "json") {
      const payload = {
        version: 2,
        kind: "cleanup-pilot-protection-profile-diff",
        exportedAt: Date.now(),
        activeProfile: activeProtectionProfile.name,
        compareProfile: compareProtectionProfile.name,
        activeOnlyPaths: protectionProfileComparison.activeOnlyPaths,
        compareOnlyPaths: protectionProfileComparison.compareOnlyPaths,
        sharedPaths: protectionProfileComparison.sharedPaths,
        activeOnlyApps: protectionProfileComparison.activeOnlyApps,
        compareOnlyApps: protectionProfileComparison.compareOnlyApps,
        sharedApps: protectionProfileComparison.sharedApps
      };
      downloadFile(
        JSON.stringify(payload, null, 2),
        `cleanup-pilot-protection-diff-${safeActive}-vs-${safeCompare}.json`,
        "application/json;charset=utf-8;"
      );
      setStatus(`Protection diff exported as JSON for "${activeProtectionProfile.name}" vs "${compareProtectionProfile.name}".`);
      return;
    }

    const rows = [
      ["section", "entry_type", "value"],
      ...protectionProfileComparison.activeOnlyPaths.map((item: string) => ["active_only", "path", item]),
      ...protectionProfileComparison.compareOnlyPaths.map((item: string) => ["compare_only", "path", item]),
      ...protectionProfileComparison.sharedPaths.map((item: string) => ["shared", "path", item]),
      ...protectionProfileComparison.activeOnlyApps.map((item: string) => ["active_only", "app", item]),
      ...protectionProfileComparison.compareOnlyApps.map((item: string) => ["compare_only", "app", item]),
      ...protectionProfileComparison.sharedApps.map((item: string) => ["shared", "app", item])
    ];
    const csv = rows.map((row) => row.map((cell: string) => escapeCsvCell(cell)).join(",")).join("\r\n");
    downloadFile(
      csv,
      `cleanup-pilot-protection-diff-${safeActive}-vs-${safeCompare}.csv`,
      "text/csv;charset=utf-8;"
    );
    setStatus(`Protection diff exported as CSV for "${activeProtectionProfile.name}" vs "${compareProtectionProfile.name}".`);
  }, [activeProtectionProfile, compareProtectionProfile, downloadFile, escapeCsvCell, protectionProfileComparison, setStatus]);

  const deleteActiveProtectionProfile = useCallback(() => {
    if (!activeProtectionProfile) {
      setStatus("No protection profile selected.");
      return;
    }

    const remainingProfiles = protectionProfiles.filter((profile) => profile.id !== activeProtectionProfile.id);
    setProtectionProfiles(remainingProfiles);
    setActiveProtectionProfileId(remainingProfiles[0]?.id ?? "");
    setProtectionProfileNameInput(remainingProfiles[0]?.name ?? defaultProtectionProfileName);
    setStatus(`Protection profile "${activeProtectionProfile.name}" deleted.`);
  }, [activeProtectionProfile, defaultProtectionProfileName, protectionProfiles, setActiveProtectionProfileId, setProtectionProfileNameInput, setProtectionProfiles, setStatus]);

  const exportActiveProtectionProfile = useCallback(() => {
    if (!activeProtectionProfile) {
      setStatus("No protection profile selected.");
      return;
    }

    const payload = {
      version: 2,
      kind: "cleanup-pilot-protection-profile",
      exportedAt: Date.now(),
      name: activeProtectionProfile.name,
      neverCleanupPaths: activeProtectionProfile.neverCleanupPaths,
      neverCleanupApps: activeProtectionProfile.neverCleanupApps
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-protection-profile-${activeProtectionProfile.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported protection profile "${activeProtectionProfile.name}".`);
  }, [activeProtectionProfile, setStatus]);

  const exportAllProtectionProfiles = useCallback(() => {
    if (!protectionProfiles.length) {
      setStatus("No protection profiles to export.");
      return;
    }

    const payload = {
      version: 2,
      kind: "cleanup-pilot-protection-profiles",
      exportedAt: Date.now(),
      profiles: protectionProfiles.map((profile) => ({
        name: profile.name,
        neverCleanupPaths: profile.neverCleanupPaths,
        neverCleanupApps: profile.neverCleanupApps
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-protection-profiles-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${protectionProfiles.length} protection profiles.`);
  }, [protectionProfiles, setStatus]);

  const triggerProtectionProfileImport = useCallback(() => {
    protectionProfileImportInputRef.current?.click();
  }, [protectionProfileImportInputRef]);

  const triggerProtectionDiffImport = useCallback(() => {
    protectionDiffImportInputRef.current?.click();
  }, [protectionDiffImportInputRef]);

  const togglePromotionEntry = useCallback((kind: "path" | "app", value: string) => {
    if (kind === "path") {
      setSelectedPromotionPaths((current: string[]) => {
        const exists = current.some((item) => item.toLowerCase() === value.toLowerCase());
        return exists ? current.filter((item) => item.toLowerCase() !== value.toLowerCase()) : [...current, value];
      });
      return;
    }

    setSelectedPromotionApps((current: string[]) => {
      const exists = current.some((item) => item.toLowerCase() === value.toLowerCase());
      return exists ? current.filter((item) => item.toLowerCase() !== value.toLowerCase()) : [...current, value];
    });
  }, [setSelectedPromotionApps, setSelectedPromotionPaths]);

  const selectAllPromotionEntries = useCallback(() => {
    setSelectedPromotionPaths(promoteComparisonDiff?.pathsToPromote ?? []);
    setSelectedPromotionApps(promoteComparisonDiff?.appsToPromote ?? []);
  }, [promoteComparisonDiff, setSelectedPromotionApps, setSelectedPromotionPaths]);

  const clearPromotionEntries = useCallback(() => {
    setSelectedPromotionPaths([]);
    setSelectedPromotionApps([]);
  }, [setSelectedPromotionApps, setSelectedPromotionPaths]);

  const triggerAllowlistImport = useCallback((mode: "merge" | "replace") => {
    allowlistImportModeRef.current = mode;
    allowlistImportInputRef.current?.click();
  }, [allowlistImportInputRef, allowlistImportModeRef]);

  const applyAllowlistImportReview = useCallback(async () => {
    if (!allowlistImportReview) {
      return;
    }

    try {
      await persistAllowlistSettings(
        allowlistImportReview.nextPaths,
        allowlistImportReview.nextApps,
        allowlistImportReview.mode === "replace"
          ? `Replaced allowlist from ${allowlistImportReview.fileName}.`
          : `Merged allowlist from ${allowlistImportReview.fileName}.`
      );
      setAllowlistImportReview(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not apply allowlist import");
    }
  }, [allowlistImportReview, persistAllowlistSettings, setAllowlistImportReview, setStatus]);

  const importAllowlistProfile = useCallback(async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await readTextFile(file);
      const importedProfiles = parseProtectionProfileDocument(raw);
      const importedPaths = uniqueTrimmedStrings(importedProfiles.flatMap((profile) => profile.neverCleanupPaths));
      const importedApps = uniqueTrimmedStrings(importedProfiles.flatMap((profile) => profile.neverCleanupApps));
      const mode = allowlistImportModeRef.current;
      const nextPaths = uniqueTrimmedStrings(mode === "replace" ? importedPaths : [...settings.neverCleanupPaths, ...importedPaths]);
      const nextApps = uniqueTrimmedStrings(mode === "replace" ? importedApps : [...settings.neverCleanupApps, ...importedApps]);
      const pathDiff = diffNormalizedStrings(settings.neverCleanupPaths, nextPaths);
      const appDiff = diffNormalizedStrings(settings.neverCleanupApps, nextApps);
      setAllowlistImportReview({
        mode,
        fileName: file.name,
        importedProfiles: uniqueTrimmedStrings(importedProfiles.map((profile) => profile.name)),
        nextPaths,
        nextApps,
        addedPaths: pathDiff.added,
        removedPaths: pathDiff.removed,
        addedApps: appDiff.added,
        removedApps: appDiff.removed
      });
      setStatus(`Review import changes from ${file.name} before applying.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import allowlist profile");
    } finally {
      event.target.value = "";
    }
  }, [allowlistImportModeRef, diffNormalizedStrings, parseProtectionProfileDocument, readTextFile, setAllowlistImportReview, setStatus, settings.neverCleanupApps, settings.neverCleanupPaths, uniqueTrimmedStrings]);

  const importProtectionProfiles = useCallback(async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await readTextFile(file);
      const importedProfiles = parseProtectionProfileDocument(raw);
      const nextProfiles = [...protectionProfiles];
      const createdProfiles = importedProfiles.map((profile) => {
        const created = createProtectionProfile(uniqueProtectionProfileName(profile.name, nextProfiles), profile);
        nextProfiles.push(created);
        return created;
      });
      setProtectionProfiles(nextProfiles);
      setActiveProtectionProfileId(createdProfiles.at(-1)?.id ?? nextProfiles[0]?.id ?? "");
      setProtectionProfileNameInput(createdProfiles.at(-1)?.name ?? nextProfiles[0]?.name ?? defaultProtectionProfileName);
      setStatus(`Imported ${createdProfiles.length} protection profile${createdProfiles.length === 1 ? "" : "s"} from ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import protection profiles");
    } finally {
      event.target.value = "";
    }
  }, [createProtectionProfile, defaultProtectionProfileName, parseProtectionProfileDocument, protectionProfiles, readTextFile, setActiveProtectionProfileId, setProtectionProfileNameInput, setProtectionProfiles, setStatus, uniqueProtectionProfileName]);

  const importProtectionDiffPatch = useCallback(async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await readTextFile(file);
      const patch = parseProtectionDiffDocument(raw);
      await persistAllowlistSettings(
        uniqueTrimmedStrings([...settings.neverCleanupPaths, ...patch.paths]),
        uniqueTrimmedStrings([...settings.neverCleanupApps, ...patch.apps]),
        `Imported protection diff patch from ${file.name} (${patch.paths.length} paths, ${patch.apps.length} apps).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import protection diff patch");
    } finally {
      event.target.value = "";
    }
  }, [parseProtectionDiffDocument, persistAllowlistSettings, readTextFile, setStatus, settings.neverCleanupApps, settings.neverCleanupPaths, uniqueTrimmedStrings]);

  return {
    saveSettings,
    addRejectedPathToAllowlist,
    addRejectedAppToAllowlist,
    addFindingPathToAllowlist,
    addAiActionToAllowlist,
    saveScheduler,
    checkUpdates,
    exportAllowlistProfile,
    saveCurrentAsProtectionProfile,
    renameActiveProtectionProfile,
    updateActiveProtectionProfileFromSettings,
    applyActiveProtectionProfileToSettings,
    promoteComparisonDiffToCurrent,
    exportProtectionProfileDiff,
    deleteActiveProtectionProfile,
    exportActiveProtectionProfile,
    exportAllProtectionProfiles,
    triggerProtectionProfileImport,
    triggerProtectionDiffImport,
    togglePromotionEntry,
    selectAllPromotionEntries,
    clearPromotionEntries,
    triggerAllowlistImport,
    applyAllowlistImportReview,
    importAllowlistProfile,
    importProtectionProfiles,
    importProtectionDiffPatch
  };
}
