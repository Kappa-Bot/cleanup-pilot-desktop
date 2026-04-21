// Legacy shell kept for migration work. The active renderer entry is src/features/pipeline/ProductShell.tsx.
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AIAnalysisMode,
  AIActionSuggestion,
  AIAdvisorAnalysisResponse,
  AIModelsResponse,
  AIProvider,
  AIProviderPreference,
  AppConfig,
  CleanupCategory,
  CleanupExecuteResponse,
  CleanupExecutionProgressEvent,
  CleanupPreset,
  CleanupPreviewResponse,
  DriverCandidate,
  DriverOfficialLookup,
  DriverScanResponse,
  DriverStackActivityState,
  DriverStackFeatureSignalId,
  DriverSuppressionSuggestion,
  DriverSuppressionSuggestionId,
  DuplicateGroup,
  DuplicatePreviewResponse,
  DuplicateSelection,
  ProtectionKind,
  ProtectedFindingRejection,
  QuarantineItem,
  QuarantinePurgeProgressEvent,
  ScanFinding,
  ScanProgressEvent,
  ScanSummary,
  SchedulerStatus,
  StorageScanResponse,
  TopLevelSection,
  UpdateCheckResponse
} from "../../types";
import { useAppStore } from "../../store";
import { useAiCollectionsController } from "./hooks/useAiCollectionsController";
import { useSettingsController } from "./hooks/useSettingsController";
import { HomePage } from "../home/HomePage";
import { CleanerPage } from "../cleaner/CleanerPage";
import { OptimizePage } from "../optimize/OptimizePage";
import { VaultPage } from "../vault/VaultPage";
import { PerformanceTab } from "../performance/PerformanceTab";
import { AITab } from "./tabs/AITab";
import { CleanupTab } from "./tabs/CleanupTab";
import { DuplicatesTab } from "./tabs/DuplicatesTab";
import { DriversTab } from "./tabs/DriversTab";
import { OverviewTab, type StorageDiffSummary, type StorageHistorySnapshot } from "./tabs/OverviewTab";
import { QuarantineTab } from "./tabs/QuarantineTab";
import { SafetyTab } from "./tabs/SafetyTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ScanTab } from "./tabs/ScanTab";

type TabKey =
  | "overview"
  | "scan"
  | "cleanup"
  | "safety"
  | "ai"
  | "duplicates"
  | "drivers"
  | "quarantine"
  | "settings"
  | "performance";

type CleanupGroupBy = "category" | "folder" | "extension" | "risk";
type CleanupSortBy = "size_desc" | "size_asc" | "path_asc" | "risk_desc" | "modified_desc" | "source_desc";
type CleanupQuickFilter = "all" | "selected" | "ai_selected" | "recommended";
type FindingSelectionMode = "add" | "remove" | "replace";
type VisualDensity = "comfortable" | "compact" | "power";

interface CleanupBulkSubgroup {
  key: string;
  label: string;
  count: number;
  totalBytes: number;
  selectedCount: number;
  ids: string[];
}

interface CleanupCategoryCollection {
  category: CleanupCategory;
  label: string;
  count: number;
  totalBytes: number;
  selectedCount: number;
  recommendedCount: number;
  aiCount: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  ids: string[];
  saferIds: string[];
  recommendedIds: string[];
  aiIds: string[];
  locationGroups: CleanupBulkSubgroup[];
  familyGroups: CleanupBulkSubgroup[];
}

interface ScanStartOverrides {
  roots?: string[];
  categories?: CleanupCategory[];
  preset?: CleanupPreset;
  aiAction?: AIActionSuggestion | null;
  keepExistingAiFocus?: boolean;
  queuePreview?: boolean;
}

const tabs: TabKey[] = ["overview", "scan", "cleanup", "safety", "ai", "duplicates", "drivers", "performance", "quarantine", "settings"];
const sections: TopLevelSection[] = ["home", "cleaner", "optimize", "vault"];

const tabToSection: Record<TabKey, TopLevelSection> = {
  overview: "home",
  scan: "cleaner",
  cleanup: "cleaner",
  safety: "cleaner",
  ai: "cleaner",
  duplicates: "cleaner",
  drivers: "optimize",
  performance: "optimize",
  quarantine: "vault",
  settings: "vault"
};

const sectionDefaultTab: Record<TopLevelSection, TabKey> = {
  home: "overview",
  cleaner: "scan",
  optimize: "performance",
  vault: "quarantine"
};

const sectionSecondaryTabs: Record<TopLevelSection, TabKey[]> = {
  home: ["scan", "cleanup", "ai", "duplicates", "drivers", "performance", "quarantine", "settings"],
  cleaner: ["scan", "cleanup", "ai", "duplicates", "safety"],
  optimize: ["performance", "drivers"],
  vault: ["quarantine", "settings"]
};

const sectionQuickTabs: Record<TopLevelSection, TabKey[]> = {
  home: ["overview"],
  cleaner: ["scan", "cleanup", "overview", "duplicates", "ai", "safety"],
  optimize: ["performance", "drivers"],
  vault: ["quarantine", "settings"]
};

const sectionLabel: Record<TopLevelSection, string> = {
  home: "Home",
  cleaner: "Cleaner",
  optimize: "Optimize",
  vault: "Vault"
};

const sectionHeadline: Record<TopLevelSection, string> = {
  home: "PC Summary",
  cleaner: "Cleanup Workspace",
  optimize: "Performance Workspace",
  vault: "Reversible Changes"
};

const tabLabel: Record<TabKey, string> = {
  overview: "Overview",
  scan: "Scan",
  cleanup: "Cleanup Plan",
  safety: "Safety",
  ai: "AI Advisor",
  duplicates: "Duplicates",
  drivers: "Drivers",
  performance: "Performance",
  quarantine: "Quarantine",
  settings: "Settings"
};

const workspaceHeadline: Record<TabKey, string> = {
  overview: "System Overview",
  scan: "Scan Workspace",
  cleanup: "Cleanup Workspace",
  safety: "Safety Review",
  ai: "AI Advisor Studio",
  duplicates: "Duplicate Review",
  drivers: "Driver Control Center",
  performance: "Performance Workbench",
  quarantine: "Quarantine Vault",
  settings: "System Settings"
};

const tabIcon: Record<TabKey, string> = {
  overview: "OV",
  scan: "SC",
  cleanup: "CL",
  safety: "SF",
  ai: "AI",
  duplicates: "DP",
  drivers: "DR",
  performance: "PF",
  quarantine: "QV",
  settings: "ST"
};

const categoryOptions: Array<{ value: CleanupCategory; label: string }> = [
  { value: "temp", label: "Temporary files" },
  { value: "cache", label: "Cache files" },
  { value: "logs", label: "Logs" },
  { value: "crash_dumps", label: "Crash dumps" },
  { value: "wsl_leftovers", label: "WSL + container leftovers" },
  { value: "minecraft_leftovers", label: "Minecraft leftovers" },
  { value: "ai_model_leftovers", label: "AI model leftovers" },
  { value: "installer_artifacts", label: "Installer artifacts" }
];

const categoryLabelByValue: Record<CleanupCategory, string> = categoryOptions.reduce(
  (accumulator, item) => {
    accumulator[item.value] = item.label;
    return accumulator;
  },
  {
    temp: "Temporary files",
    cache: "Cache files",
    logs: "Logs",
    crash_dumps: "Crash dumps",
    wsl_leftovers: "WSL + container leftovers",
    minecraft_leftovers: "Minecraft leftovers",
    ai_model_leftovers: "AI model leftovers",
    installer_artifacts: "Installer artifacts",
    duplicates: "Duplicates"
  } as Record<CleanupCategory, string>
);

const presetLabel: Record<CleanupPreset, string> = {
  lite: "Lite",
  standard: "Standard",
  deep: "Deep",
  extreme: "Extreme"
};

const dayLabel = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FINDINGS_PAGE_SIZE = 240;
const DUP_GROUPS_PAGE_SIZE = 10;
const QUARANTINE_PAGE_SIZE = 200;
const AI_COLLECTION_STORAGE_KEY = "cleanup-pilot.aiCollection.v1";
const AI_COLLECTIONS_STORAGE_KEY = "cleanup-pilot.aiCollections.v2";
const DEFAULT_AI_COLLECTION_NAME = "My AI Collection";
const PROTECTION_PROFILES_STORAGE_KEY = "cleanup-pilot.protectionProfiles.v1";
const DEFAULT_PROTECTION_PROFILE_NAME = "Primary Machine";
const CURRENT_SETTINGS_COMPARE_ID = "__current_settings__";
const DRIVER_SIGNAL_FILTER_STORAGE_KEY = "cleanup-pilot.driverSignalFilter.v1";
const DRIVER_SIGNAL_EVIDENCE_STORAGE_KEY = "cleanup-pilot.driverSignalEvidenceOpen.v1";
const STORAGE_HISTORY_STORAGE_KEY = "cleanup-pilot.storageHistory.v1";
const VISUAL_DENSITY_STORAGE_KEY = "cleanup-pilot.visualDensity.v1";
const COMMAND_PALETTE_RECENTS_KEY = "cleanup-pilot.commandPaletteRecents.v1";
const DRIVER_STACK_OPTIONS: Array<{ id: DriverSuppressionSuggestionId; label: string }> = [
  { id: "system-infrastructure", label: "Infrastructure" },
  { id: "virtualization-vmware", label: "VMware" },
  { id: "virtualization-hyperv", label: "Hyper-V" },
  { id: "virtualization-camo", label: "Camo" },
  { id: "virtualization-xbox", label: "Xbox Virtual Storage" }
];
const DRIVER_SIGNAL_OPTIONS: DriverStackFeatureSignalId[] = [
  "hyperv",
  "virtual_machine_platform",
  "wsl",
  "containers"
];

interface NamedAiCollection {
  id: string;
  name: string;
  actions: AIActionSuggestion[];
  createdAt: number;
  updatedAt: number;
}

interface StoredAiCollectionsState {
  activeCollectionId: string;
  collections: NamedAiCollection[];
}

interface NamedProtectionProfile {
  id: string;
  name: string;
  neverCleanupPaths: string[];
  neverCleanupApps: string[];
  createdAt: number;
  updatedAt: number;
}

interface ProtectionProfileComparisonTarget {
  id: string;
  name: string;
  neverCleanupPaths: string[];
  neverCleanupApps: string[];
}

interface StoredProtectionProfilesState {
  activeProfileId: string;
  profiles: NamedProtectionProfile[];
}

interface ProtectionProfileImportShape {
  name: string;
  neverCleanupPaths: string[];
  neverCleanupApps: string[];
}

interface AllowlistImportReview {
  mode: "merge" | "replace";
  fileName: string;
  importedProfiles: string[];
  nextPaths: string[];
  nextApps: string[];
  addedPaths: string[];
  removedPaths: string[];
  addedApps: string[];
  removedApps: string[];
}

interface ProtectionDiffPatch {
  paths: string[];
  apps: string[];
  sourceLabel: string;
}

function buildStorageHistorySnapshot(response: StorageScanResponse): StorageHistorySnapshot {
  return {
    capturedAt: Date.now(),
    totalBytes: response.totalBytes ?? 0,
    totalFiles: response.totalFiles ?? 0,
    topAreas: (response.topAreas ?? []).slice(0, 16).map((item) => ({
      path: item.path,
      label: item.label,
      sizeBytes: item.sizeBytes
    }))
  };
}

function computeStorageDiff(history: StorageHistorySnapshot[]): StorageDiffSummary | null {
  if (history.length < 2) {
    return null;
  }
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const currentAreas = new Map(current.topAreas.map((item) => [item.path.toLowerCase(), item]));
  const previousAreas = new Map(previous.topAreas.map((item) => [item.path.toLowerCase(), item]));
  const areaKeys = new Set<string>([...currentAreas.keys(), ...previousAreas.keys()]);
  const deltas = [...areaKeys]
    .map((key) => {
      const currentEntry = currentAreas.get(key);
      const previousEntry = previousAreas.get(key);
      const deltaBytes = (currentEntry?.sizeBytes ?? 0) - (previousEntry?.sizeBytes ?? 0);
      return {
        path: currentEntry?.path ?? previousEntry?.path ?? key,
        label: currentEntry?.label ?? previousEntry?.label ?? key,
        deltaBytes,
        currentBytes: currentEntry?.sizeBytes ?? 0,
        previousBytes: previousEntry?.sizeBytes ?? 0
      };
    })
    .filter((item) => item.deltaBytes !== 0)
    .sort((left, right) => Math.abs(right.deltaBytes) - Math.abs(left.deltaBytes));

  return {
    previousCapturedAt: previous.capturedAt,
    currentCapturedAt: current.capturedAt,
    totalBytesDelta: current.totalBytes - previous.totalBytes,
    totalFilesDelta: current.totalFiles - previous.totalFiles,
    growingAreas: deltas.filter((item) => item.deltaBytes > 0).slice(0, 4),
    shrinkingAreas: deltas.filter((item) => item.deltaBytes < 0).slice(0, 4)
  };
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

const defaultSettings: AppConfig = {
  defaultPreset: "standard",
  defaultCategories: categoryOptions.map((item) => item.value),
  customRoots: [],
  neverCleanupPaths: [],
  neverCleanupApps: [],
  driverIgnoredInfNames: [],
  driverIgnoredDeviceIds: [],
  driverHiddenSuggestionIds: [],
  driverAutoSuppressSafeSuggestions: true,
  driverAutoSuppressionApplied: false,
  aiProvider: "auto",
  scheduleEnabled: false,
  scheduleDayOfWeek: 6,
  scheduleTime: "10:00",
  quarantineRetentionDays: 30,
  reducedMotion: false,
  highContrast: false,
  compactUi: false,
  includeInstalledApps: true,
  driverToolsEnabled: true,
  updatesFeedUrl: "",
  performanceSnapshotRetentionDays: 30,
  performanceAutoSnapshotOnLaunch: true,
  performanceAutoSnapshotOnCleanup: true,
  performanceAutoSnapshotOnOptimization: true,
  performanceLiveSampleIntervalMs: 2000,
  performancePinnedMonitoring: false
};

const defaultScanProgress: ScanProgressEvent = {
  runId: "",
  stage: "preparing",
  processedItems: 0,
  findingsCount: 0,
  percent: 0,
  etaSec: 0,
  processedDirectories: 0,
  estimatedTotalItems: 0,
  estimatedRemainingItems: 0,
  scanDensity: 0
};

const emptyScanSummary: ScanSummary = {
  runId: "",
  status: "running",
  startedAt: 0,
  processedItems: 0,
  findingsCount: 0,
  totalCandidateBytes: 0,
  protectedRejectedCount: 0,
  categories: {
    temp: { count: 0, bytes: 0 },
    cache: { count: 0, bytes: 0 },
    logs: { count: 0, bytes: 0 },
    crash_dumps: { count: 0, bytes: 0 },
    wsl_leftovers: { count: 0, bytes: 0 },
    minecraft_leftovers: { count: 0, bytes: 0 },
    ai_model_leftovers: { count: 0, bytes: 0 },
    installer_artifacts: { count: 0, bytes: 0 },
    duplicates: { count: 0, bytes: 0 }
  }
};

function createCategoryBuckets(): ScanSummary["categories"] {
  return {
    temp: { count: 0, bytes: 0 },
    cache: { count: 0, bytes: 0 },
    logs: { count: 0, bytes: 0 },
    crash_dumps: { count: 0, bytes: 0 },
    wsl_leftovers: { count: 0, bytes: 0 },
    minecraft_leftovers: { count: 0, bytes: 0 },
    ai_model_leftovers: { count: 0, bytes: 0 },
    installer_artifacts: { count: 0, bytes: 0 },
    duplicates: { count: 0, bytes: 0 }
  };
}

function summarizeFindingsForUi(findings: ScanFinding[], current: ScanSummary): ScanSummary {
  const categories = createCategoryBuckets();
  let totalCandidateBytes = 0;
  let findingsCount = 0;

  for (const finding of findings) {
    const findingCount = Math.max(1, finding.entryCount ?? 1);
    categories[finding.category].count += findingCount;
    categories[finding.category].bytes += finding.sizeBytes;
    totalCandidateBytes += finding.sizeBytes;
    findingsCount += findingCount;
  }

  return {
    ...current,
    findingsCount,
    totalCandidateBytes,
    categories
  };
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDate(value?: number): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatEta(value?: number): string {
  if (!value || value <= 0) {
    return "Estimating";
  }
  if (value < 60) {
    return `${value}s`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function aiProviderLabel(provider: AIProvider | AIProviderPreference): string {
  if (provider === "cerebras") {
    return "Cerebras";
  }
  if (provider === "local") {
    return "Local";
  }
  return "Auto";
}

function modelOptionLabel(model: AIModelsResponse["models"][number]): string {
  return `${aiProviderLabel(model.provider)} - ${model.name}`;
}

function aiActionKindLabel(kind: AIActionSuggestion["kind"]): string {
  if (kind === "quarantine_review") {
    return "Quarantine Review";
  }
  if (kind === "large_file_review") {
    return "Large File";
  }
  if (kind === "folder_review") {
    return "Folder Review";
  }
  return "Duplicate Scan";
}

function modelSelectionValue(provider: AIProvider, modelName: string): string {
  return `${provider}::${modelName}`;
}

function parseModelSelectionValue(value: string): { provider: AIProvider; model: string } | null {
  const separatorIndex = value.indexOf("::");
  if (separatorIndex <= 0) {
    return null;
  }
  const provider = value.slice(0, separatorIndex);
  const model = value.slice(separatorIndex + 2).trim();
  if ((provider !== "local" && provider !== "cerebras") || !model) {
    return null;
  }
  return {
    provider,
    model
  };
}

function parentFolderPath(value: string): string {
  const normalized = value.replace(/\//g, "\\");
  const slashIndex = normalized.lastIndexOf("\\");
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

function normalizeMatchPath(value: string): string {
  return value.replace(/\//g, "\\").toLowerCase();
}

function actionRoots(action: AIActionSuggestion): string[] {
  const roots = (action.sourcePaths.length ? action.sourcePaths : action.targetPath ? [action.targetPath] : [])
    .map((item) => (action.kind === "large_file_review" ? parentFolderPath(item) : item))
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(roots)];
}

function actionMatchesFinding(action: AIActionSuggestion, finding: ScanFinding): boolean {
  const findingPath = normalizeMatchPath(finding.path);
  const scopes = actionRoots(action);
  return scopes.some((scope) => {
    const normalizedScope = normalizeMatchPath(scope);
    return findingPath === normalizedScope || findingPath.startsWith(`${normalizedScope}\\`);
  });
}

function dedupeAiActions(actions: AIActionSuggestion[]): AIActionSuggestion[] {
  const byId = new Map<string, AIActionSuggestion>();
  for (const action of actions) {
    byId.set(action.id, action);
  }
  return [...byId.values()];
}

function confidenceScore(value: "low" | "medium" | "high"): number {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  return 1;
}

function confidenceFromAverage(value: number): "low" | "medium" | "high" {
  if (value >= 2.5) {
    return "high";
  }
  if (value >= 1.5) {
    return "medium";
  }
  return "low";
}

function impactLabel(bytes: number): "focused" | "medium" | "high" {
  if (bytes >= 1024 * 1024 * 1024) {
    return "high";
  }
  if (bytes >= 256 * 1024 * 1024) {
    return "medium";
  }
  return "focused";
}

function suggestionScore(actions: AIActionSuggestion[], estimatedBytes: number): number {
  const cleanupActions = actions.filter((item) => item.kind !== "duplicate_scan");
  const averageConfidence =
    actions.reduce((sum, action) => sum + confidenceScore(action.confidence), 0) / Math.max(actions.length, 1);
  const highestRisk = actions.reduce((highest, action) => Math.max(highest, riskScore(action.risk)), 1);
  const bytesScore = Math.min(46, Math.round(Math.log2(Math.max(estimatedBytes, 1) / (64 * 1024 * 1024) + 1) * 12));
  const confidencePoints = Math.round((averageConfidence / 3) * 24);
  const riskPoints = highestRisk === 1 ? 20 : highestRisk === 2 ? 9 : -8;
  const cleanupBonus = Math.min(10, cleanupActions.length * 2);
  return Math.max(0, Math.min(100, bytesScore + confidencePoints + riskPoints + cleanupBonus));
}

function summarizeSuggestion(actions: AIActionSuggestion[], estimatedBytes: number): Pick<SmartAiCollectionSuggestion, "score" | "impact" | "confidence" | "risk"> {
  const averageConfidence =
    actions.reduce((sum, action) => sum + confidenceScore(action.confidence), 0) / Math.max(actions.length, 1);
  const highestRisk = actions.reduce<ScanFinding["risk"]>((highest, action) => {
    return riskScore(action.risk) > riskScore(highest) ? action.risk : highest;
  }, "low");

  return {
    score: suggestionScore(actions, estimatedBytes),
    impact: impactLabel(estimatedBytes),
    confidence: confidenceFromAverage(averageConfidence),
    risk: highestRisk
  };
}

function buildCollectionFocusAction(actions: AIActionSuggestion[]): AIActionSuggestion {
  const nonDuplicateActions = actions.filter((item) => item.kind !== "duplicate_scan");
  const totalBytes = nonDuplicateActions.reduce((sum, item) => sum + item.estimatedBytes, 0);
  const sourcePaths = [...new Set(nonDuplicateActions.flatMap((item) => actionRoots(item)))];
  const highestConfidence = [...nonDuplicateActions].sort(
    (left, right) => confidenceScore(right.confidence) - confidenceScore(left.confidence)
  )[0]?.confidence ?? "medium";
  const highestRisk = [...nonDuplicateActions].sort(
    (left, right) => riskScore(right.risk) - riskScore(left.risk)
  )[0]?.risk ?? "medium";

  return {
    id: `collection:${actions.map((item) => item.id).sort().join("|")}`,
    kind: "folder_review",
    title: `AI collection (${actions.length} actions)`,
    summary: `Combined review of ${actions.length} AI actions before cleanup execution.`,
    targetPath: sourcePaths[0],
    sourcePaths,
    estimatedBytes: totalBytes,
    confidence: highestConfidence,
    risk: highestRisk,
    autoApplyScanRoot: false
  };
}

function buildSuggestionFocusAction(suggestion: SmartAiCollectionSuggestion): AIActionSuggestion {
  const focusAction = buildCollectionFocusAction(suggestion.actions);
  return {
    ...focusAction,
    id: `suggestion:${suggestion.id}:${focusAction.id}`,
    title: suggestion.name,
    summary: suggestion.description,
    estimatedBytes: suggestion.estimatedBytes,
    confidence: suggestion.confidence,
    risk: suggestion.risk
  };
}

function findingSourceRank(
  findingId: string,
  selectedFindingSet: Set<string>,
  aiSuggestedFindingSet: Set<string>,
  recommendedFindingSet: Set<string>
): number {
  if (aiSuggestedFindingSet.has(findingId)) {
    return 4;
  }
  if (recommendedFindingSet.has(findingId)) {
    return 3;
  }
  if (selectedFindingSet.has(findingId)) {
    return 2;
  }
  return 1;
}

function buildAiCollectionId(): string {
  return `ai-collection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function collectionActionSummary(actions: AIActionSuggestion[]): { cleanup: AIActionSuggestion[]; duplicates: AIActionSuggestion[] } {
  return {
    cleanup: actions.filter((item) => item.kind !== "duplicate_scan"),
    duplicates: actions.filter((item) => item.kind === "duplicate_scan")
  };
}

function normalizeCollectionName(value: string): string {
  const normalized = value.trim();
  return normalized || DEFAULT_AI_COLLECTION_NAME;
}

function createNamedAiCollection(name: string, actions: AIActionSuggestion[] = []): NamedAiCollection {
  const now = Date.now();
  return {
    id: buildAiCollectionId(),
    name: normalizeCollectionName(name),
    actions: dedupeAiActions(actions),
    createdAt: now,
    updatedAt: now
  };
}

function isStoredAiAction(value: unknown): value is AIActionSuggestion {
  const item = value as AIActionSuggestion | null;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.kind === "string" &&
      typeof item.title === "string" &&
      typeof item.summary === "string" &&
      Array.isArray(item.sourcePaths) &&
      typeof item.estimatedBytes === "number" &&
      typeof item.confidence === "string" &&
      typeof item.risk === "string" &&
      typeof item.autoApplyScanRoot === "boolean"
  );
}

function isStoredNamedAiCollection(value: unknown): value is NamedAiCollection {
  const item = value as NamedAiCollection | null;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.createdAt === "number" &&
      typeof item.updatedAt === "number" &&
      Array.isArray(item.actions) &&
      item.actions.every((action) => isStoredAiAction(action))
  );
}

function isStoredAiCollectionsState(value: unknown): value is StoredAiCollectionsState {
  const item = value as StoredAiCollectionsState | null;
  return Boolean(
    item &&
      typeof item.activeCollectionId === "string" &&
      Array.isArray(item.collections) &&
      item.collections.every((collection) => isStoredNamedAiCollection(collection))
  );
}

function migrateStoredAiCollections(rawV2: string | null, rawV1: string | null): StoredAiCollectionsState {
  if (rawV2) {
    const parsed = JSON.parse(rawV2) as unknown;
    if (isStoredAiCollectionsState(parsed)) {
      const collections = parsed.collections
        .map((collection) => ({
          ...collection,
          name: normalizeCollectionName(collection.name),
          actions: dedupeAiActions(collection.actions)
        }))
        .filter((collection) => collection.actions.length || collection.name);
      return {
        activeCollectionId:
          collections.some((collection) => collection.id === parsed.activeCollectionId) ? parsed.activeCollectionId : collections[0]?.id ?? "",
        collections
      };
    }
  }

  if (rawV1) {
    const parsed = JSON.parse(rawV1) as unknown;
    const items = Array.isArray(parsed) ? parsed.filter(isStoredAiAction) : [];
    if (items.length) {
      const collection = createNamedAiCollection(DEFAULT_AI_COLLECTION_NAME, items);
      return {
        activeCollectionId: collection.id,
        collections: [collection]
      };
    }
  }

  return {
    activeCollectionId: "",
    collections: []
  };
}

function normalizedActionText(action: AIActionSuggestion): string {
  return [action.title, action.summary, action.targetPath ?? "", ...action.sourcePaths].join(" ").toLowerCase();
}

function isSafeWinAction(action: AIActionSuggestion, highImpactFloor: number): boolean {
  if (action.kind === "duplicate_scan" || action.risk !== "low" || action.confidence === "low") {
    return false;
  }
  if (isDownloadsPath(action.targetPath ?? action.sourcePaths[0] ?? "")) {
    return false;
  }
  return action.estimatedBytes >= highImpactFloor;
}

function buildSmartAiCollectionSuggestions(actions: AIActionSuggestion[]): SmartAiCollectionSuggestion[] {
  const groups = new Map<string, SmartAiCollectionSuggestion>();
  const dedupedActions = dedupeAiActions(actions);
  const sortedByBytes = [...dedupedActions].sort((left, right) => right.estimatedBytes - left.estimatedBytes);
  const safeWinFloor = Math.max(
    128 * 1024 * 1024,
    Math.floor((sortedByBytes.find((action) => action.kind !== "duplicate_scan")?.estimatedBytes ?? 0) * 0.25)
  );
  const safeWins = sortedByBytes
    .filter((action) => isSafeWinAction(action, safeWinFloor))
    .slice(0, 6);
  const definitions: Array<{
    id: string;
    name: string;
    description: string;
    match: (action: AIActionSuggestion, haystack: string) => boolean;
  }> = [
    {
      id: "games",
      name: "Minecraft + Games",
      description: "Minecraft launchers, modpacks, shader packs, game caches, and launcher leftovers.",
      match: (_action, haystack) =>
        /minecraft|curseforge|modrinth|shader|modpack|prism launcher|lunar client|steam|epic games|riot|battle\.net|overwolf/.test(haystack)
    },
    {
      id: "ai",
      name: "AI Models + Tooling",
      description: "Local models, inference runtimes, downloads, and AI workspace leftovers.",
      match: (_action, haystack) =>
        /deepseek|ollama|openai-oss|lm studio|kobold|llama|gguf|huggingface|comfyui|stable diffusion|invokeai|webui|model cache|models\\/.test(
          haystack
        )
    },
    {
      id: "installers",
      name: "Installers + Downloads",
      description: "Large setup packages, extracted installers, and download residue for manual review.",
      match: (_action, haystack) => /\\downloads\\|installer|setup\.|\.msi|\.zip|\.7z|portable|install package/.test(haystack)
    },
    {
      id: "appdata",
      name: "AppData Review",
      description: "Unknown or stale AppData folders that need a targeted review before cleanup.",
      match: (action, haystack) => action.kind !== "large_file_review" && /appdata/.test(haystack)
    },
    {
      id: "large_files",
      name: "Large Files",
      description: "Big files and heavy folders worth reviewing first for immediate disk savings.",
      match: (action, haystack) => action.kind === "large_file_review" || /large file|largest|heavy folder|disk usage/.test(haystack)
    },
    {
      id: "duplicates",
      name: "Duplicates",
      description: "Duplicate-scan actions grouped together for fast follow-up in the Duplicates tab.",
      match: (action) => action.kind === "duplicate_scan"
    },
    {
      id: "cleanup",
      name: "Temp + Cache Cleanup",
      description: "Temp folders, caches, logs, and low-risk residue with cleanup potential.",
      match: (_action, haystack) => /temp|cache|logs?|crash dump|installer artifact|leftover/.test(haystack)
    }
  ];

  if (safeWins.length > 0) {
    const estimatedBytes = safeWins.reduce((sum, action) => sum + action.estimatedBytes, 0);
    groups.set("safe_wins", {
      id: "safe_wins",
      name: "High Impact Safe Wins",
      description: "Low-risk, high-impact cleanup candidates prioritized for immediate review.",
      actions: safeWins,
      estimatedBytes,
      accent: "priority",
      ...summarizeSuggestion(safeWins, estimatedBytes)
    });
  }

  for (const action of dedupedActions) {
    const haystack = normalizedActionText(action);
    const definition = definitions.find((item) => item.match(action, haystack));
    if (!definition) {
      continue;
    }
    const current = groups.get(definition.id);
    if (current) {
      current.actions = dedupeAiActions([...current.actions, action]);
      current.estimatedBytes += action.estimatedBytes;
      continue;
    }
    const estimatedBytes = action.estimatedBytes;
    groups.set(definition.id, {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      actions: [action],
      estimatedBytes,
      accent: "domain",
      ...summarizeSuggestion([action], estimatedBytes)
    });
  }

  const enrichedGroups = [...groups.values()].map((group) => ({
    ...group,
    ...summarizeSuggestion(group.actions, group.estimatedBytes)
  }));

  return enrichedGroups
    .filter((group) => group.actions.length > 0)
    .sort((left, right) => {
      if (left.accent !== right.accent) {
        return left.accent === "priority" ? -1 : 1;
      }
      return right.score - left.score || right.estimatedBytes - left.estimatedBytes || left.name.localeCompare(right.name);
    });
}

function uniqueCollectionName(baseName: string, collections: NamedAiCollection[]): string {
  const normalizedBase = normalizeCollectionName(baseName);
  if (!collections.some((collection) => collection.name === normalizedBase)) {
    return normalizedBase;
  }
  let counter = 2;
  while (collections.some((collection) => collection.name === `${normalizedBase} ${counter}`)) {
    counter += 1;
  }
  return `${normalizedBase} ${counter}`;
}

function shortPath(value: string): string {
  if (value.length <= 95) {
    return value;
  }
  return `${value.slice(0, 40)} ... ${value.slice(-46)}`;
}

function isDownloadsPath(value: string): boolean {
  const normalized = value.replace(/\//g, "\\").toLowerCase();
  return normalized.includes("\\downloads\\") || normalized.endsWith("\\downloads");
}

function categoryClass(category: CleanupCategory): string {
  if (category === "temp") {
    return "cat-temp";
  }
  if (category === "cache") {
    return "cat-cache";
  }
  if (category === "logs") {
    return "cat-logs";
  }
  if (category === "crash_dumps") {
    return "cat-crash";
  }
  if (category === "wsl_leftovers") {
    return "cat-wsl";
  }
  if (category === "minecraft_leftovers") {
    return "cat-minecraft";
  }
  if (category === "ai_model_leftovers") {
    return "cat-ai";
  }
  if (category === "installer_artifacts") {
    return "cat-installer";
  }
  return "cat-duplicates";
}

function extensionOfPath(filePath: string): string {
  const normalized = filePath.replace(/\//g, "\\");
  const name = normalized.split("\\").pop() ?? normalized;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return "[no_ext]";
  }
  return name.slice(dotIndex).toLowerCase();
}

function findingDisplayCount(finding: ScanFinding): number {
  return Math.max(1, finding.entryCount ?? 1);
}

function folderBucket(filePath: string): string {
  const normalized = filePath.replace(/\//g, "\\");
  const parts = normalized.split("\\").filter(Boolean);
  if (parts.length >= 5 && /^[a-zA-Z]:$/.test(parts[0])) {
    return `${parts[0]}\\${parts[1]}\\${parts[2]}\\${parts[3]}`;
  }
  if (parts.length >= 4) {
    return parts.slice(0, 4).join("\\");
  }
  const slashIndex = normalized.lastIndexOf("\\");
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

function scanLocationBucket(filePath: string): string {
  const normalized = filePath.replace(/\//g, "\\");
  const lower = normalized.toLowerCase();
  if (lower.includes("\\appdata\\local\\temp\\")) {
    return "User temp";
  }
  if (lower.includes("\\appdata\\local\\packages\\")) {
    return "Windows package caches";
  }
  if (lower.includes("\\appdata\\local\\")) {
    return "AppData Local";
  }
  if (lower.includes("\\appdata\\roaming\\")) {
    return "AppData Roaming";
  }
  if (lower.includes("\\programdata\\")) {
    return "ProgramData";
  }
  if (lower.includes("\\downloads\\")) {
    return "Downloads";
  }
  if (lower.includes("\\curseforge\\") || lower.includes("\\modrinth\\") || lower.includes("\\.minecraft\\")) {
    return "Minecraft ecosystem";
  }
  if (lower.includes("\\dockerdesktop\\") || lower.includes("\\wsl\\")) {
    return "WSL + containers";
  }
  return folderBucket(filePath);
}

function extensionLabel(extension: string): string {
  if (extension === "[no_ext]") {
    return "No extension";
  }
  return extension;
}

function fileFamilyBucket(filePath: string, category: CleanupCategory): string {
  const lower = filePath.toLowerCase();
  const extension = extensionOfPath(filePath);

  if (category === "logs") {
    if (extension === ".etl" || extension === ".evtx") {
      return "Trace logs";
    }
    if (extension === ".wer") {
      return "Error reports";
    }
    return "Log files";
  }

  if (category === "crash_dumps") {
    return extension === ".dmp" ? "Memory dumps" : "Crash data";
  }

  if (category === "cache") {
    if (lower.includes("shader")) {
      return "Shader caches";
    }
    if ([".sqlite", ".db", ".ldb", ".dat"].includes(extension)) {
      return "Cache databases";
    }
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
      return "Image caches";
    }
    return "General caches";
  }

  if (category === "installer_artifacts") {
    if ([".msi", ".msp", ".cab", ".iso", ".zip", ".7z", ".rar", ".exe"].includes(extension)) {
      return "Installers and archives";
    }
    return "Installer residue";
  }

  if (category === "minecraft_leftovers") {
    if (lower.includes("shader")) {
      return "Shaders";
    }
    if (lower.includes("resourcepack")) {
      return "Resource packs";
    }
    if (lower.includes("mod")) {
      return "Mods and modpacks";
    }
    return "Minecraft data";
  }

  if (category === "ai_model_leftovers") {
    if (lower.includes("huggingface") || lower.includes("transformers")) {
      return "Model caches";
    }
    if (lower.includes("ollama") || lower.includes("deepseek") || lower.includes("llm")) {
      return "LLM tool data";
    }
    return "AI runtime data";
  }

  if (category === "wsl_leftovers") {
    if (lower.includes("docker")) {
      return "Docker residue";
    }
    if (lower.includes("wsl")) {
      return "WSL residue";
    }
    return "Container leftovers";
  }

  if ([".tmp", ".temp", ".part", ".bak", ".old"].includes(extension)) {
    return "Temporary files";
  }

  if (extension === "[no_ext]") {
    return "No extension";
  }

  return extensionLabel(extension);
}

function riskScore(risk: ScanFinding["risk"]): number {
  if (risk === "high") {
    return 3;
  }
  if (risk === "medium") {
    return 2;
  }
  return 1;
}

function toneClass(risk: ScanFinding["risk"]): string {
  if (risk === "high") {
    return "tone-high";
  }
  if (risk === "medium") {
    return "tone-medium";
  }
  return "tone-low";
}

function driverSeverityClass(severity: DriverCandidate["severity"]): string {
  if (severity === "high") {
    return "tone-high";
  }
  if (severity === "medium") {
    return "tone-medium";
  }
  return "tone-low";
}

function driverSuppressionConfidenceClass(
  confidence: DriverSuppressionSuggestion["confidence"]
): string {
  return confidence === "high" ? "tone-low" : "tone-medium";
}

function driverSuppressionRuleSummary(suggestion: DriverSuppressionSuggestion): string {
  const parts: string[] = [];
  if (suggestion.infNames.length) {
    parts.push(`${suggestion.infNames.length} INF rule${suggestion.infNames.length === 1 ? "" : "s"}`);
  }
  if (suggestion.deviceIds.length) {
    parts.push(`${suggestion.deviceIds.length} device rule${suggestion.deviceIds.length === 1 ? "" : "s"}`);
  }
  return parts.join(" + ") || "No rules";
}

function driverSuppressionGroupLabel(group: DriverSuppressionSuggestion["group"]): string {
  return group === "infrastructure" ? "Infrastructure" : "Virtual stack";
}

function driverStackSettingLabel(id: DriverSuppressionSuggestionId): string {
  return DRIVER_STACK_OPTIONS.find((item) => item.id === id)?.label ?? id;
}

function driverActivityClass(state: DriverStackActivityState): string {
  if (state === "active") {
    return "tone-high";
  }
  if (state === "installed") {
    return "tone-medium";
  }
  return "tone-low";
}

function driverActivityLabel(state: DriverStackActivityState): string {
  if (state === "active") {
    return "Active now";
  }
  if (state === "installed") {
    return "Installed";
  }
  if (state === "inactive") {
    return "Inactive";
  }
  return "Unknown";
}

function driverFeatureSignalLabel(signal: DriverStackFeatureSignalId): string {
  if (signal === "hyperv") {
    return "Hyper-V";
  }
  if (signal === "virtual_machine_platform") {
    return "VMP";
  }
  if (signal === "wsl") {
    return "WSL";
  }
  return "Containers";
}

function driverFeatureSignalClass(signal: DriverStackFeatureSignalId): string {
  if (signal === "hyperv") {
    return "cat-logs";
  }
  if (signal === "virtual_machine_platform") {
    return "cat-cache";
  }
  if (signal === "wsl") {
    return "cat-ai";
  }
  return "cat-duplicates";
}

function isDriverSignalFilterValue(value: string): value is DriverStackFeatureSignalId {
  return DRIVER_SIGNAL_OPTIONS.includes(value as DriverStackFeatureSignalId);
}

function isDriverSuggestionId(value: string): value is DriverSuppressionSuggestionId {
  return DRIVER_STACK_OPTIONS.some((item) => item.id === value);
}

function getStoredDriverSignalFilter(): DriverStackFeatureSignalId | "all" {
  try {
    const storedValue = String(window.localStorage.getItem(DRIVER_SIGNAL_FILTER_STORAGE_KEY) ?? "").trim();
    return isDriverSignalFilterValue(storedValue) ? storedValue : "all";
  } catch {
    return "all";
  }
}

function getStoredDriverSignalEvidenceOpenIds(): DriverSuppressionSuggestionId[] {
  try {
    const parsed = JSON.parse(
      String(window.localStorage.getItem(DRIVER_SIGNAL_EVIDENCE_STORAGE_KEY) ?? "[]")
    ) as unknown;
    return Array.isArray(parsed)
      ? uniqueTrimmedStrings(parsed.map((item) => String(item ?? ""))).filter(isDriverSuggestionId)
      : [];
  } catch {
    return [];
  }
}

function appDataConfidenceClass(confidence: "low" | "medium" | "high"): string {
  if (confidence === "high") {
    return "tone-high";
  }
  if (confidence === "medium") {
    return "tone-medium";
  }
  return "tone-low";
}

function appDataDispositionClass(disposition: "cleanup_candidate" | "review_only" | "do_not_touch"): string {
  if (disposition === "cleanup_candidate") {
    return "tone-low";
  }
  if (disposition === "review_only") {
    return "tone-medium";
  }
  return "tone-high";
}

function protectionKindLabel(kind: ProtectedFindingRejection["protectionKind"]): string {
  if (kind === "protected_system_root") {
    return "System root";
  }
  if (kind === "app_install_root") {
    return "Install root";
  }
  if (kind === "user_allowlist_path") {
    return "Never-cleanup path";
  }
  if (kind === "user_allowlist_app") {
    return "Never-cleanup app";
  }
  if (kind === "installed_app_location") {
    return "Installed app location";
  }
  if (kind === "installed_app_name_match") {
    return "Installed app name";
  }
  return "Binary";
}

function escapeCsvCell(value: string): string {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function uniqueTrimmedStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

async function readTextFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}

function diffNormalizedStrings(current: string[], next: string[]): { added: string[]; removed: string[] } {
  const currentSet = new Set(current.map((value) => value.toLowerCase()));
  const nextSet = new Set(next.map((value) => value.toLowerCase()));
  return {
    added: next.filter((value) => !currentSet.has(value.toLowerCase())),
    removed: current.filter((value) => !nextSet.has(value.toLowerCase()))
  };
}

function sharedNormalizedStrings(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  return left.filter((value) => rightSet.has(value.toLowerCase()));
}

function downloadFile(contents: string, fileName: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildProtectionProfileId(): string {
  return `protection-profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProtectionProfileName(value: string): string {
  const normalized = value.trim();
  return normalized || DEFAULT_PROTECTION_PROFILE_NAME;
}

function createProtectionProfile(
  name: string,
  values: { neverCleanupPaths?: string[]; neverCleanupApps?: string[] } = {}
): NamedProtectionProfile {
  const now = Date.now();
  return {
    id: buildProtectionProfileId(),
    name: normalizeProtectionProfileName(name),
    neverCleanupPaths: uniqueTrimmedStrings(values.neverCleanupPaths ?? []),
    neverCleanupApps: uniqueTrimmedStrings(values.neverCleanupApps ?? []),
    createdAt: now,
    updatedAt: now
  };
}

function uniqueProtectionProfileName(baseName: string, profiles: NamedProtectionProfile[]): string {
  const normalizedBase = normalizeProtectionProfileName(baseName);
  const names = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  if (!names.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let counter = 2;
  while (names.has(`${normalizedBase} ${counter}`.toLowerCase())) {
    counter += 1;
  }
  return `${normalizedBase} ${counter}`;
}

function isStoredNamedProtectionProfile(value: unknown): value is NamedProtectionProfile {
  const item = value as NamedProtectionProfile | null;
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.createdAt === "number" &&
      typeof item.updatedAt === "number" &&
      Array.isArray(item.neverCleanupPaths) &&
      Array.isArray(item.neverCleanupApps)
  );
}

function isStoredProtectionProfilesState(value: unknown): value is StoredProtectionProfilesState {
  const item = value as StoredProtectionProfilesState | null;
  return Boolean(
    item &&
      typeof item.activeProfileId === "string" &&
      Array.isArray(item.profiles) &&
      item.profiles.every((profile) => isStoredNamedProtectionProfile(profile))
  );
}

function migrateStoredProtectionProfiles(raw: string | null): StoredProtectionProfilesState {
  if (!raw) {
    return {
      activeProfileId: "",
      profiles: []
    };
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isStoredProtectionProfilesState(parsed)) {
    return {
      activeProfileId: "",
      profiles: []
    };
  }

  const profiles = parsed.profiles.map((profile) => ({
    ...profile,
    name: normalizeProtectionProfileName(profile.name),
    neverCleanupPaths: uniqueTrimmedStrings(profile.neverCleanupPaths),
    neverCleanupApps: uniqueTrimmedStrings(profile.neverCleanupApps)
  }));

  return {
    activeProfileId:
      profiles.some((profile) => profile.id === parsed.activeProfileId) ? parsed.activeProfileId : profiles[0]?.id ?? "",
    profiles
  };
}

function parseProtectionProfileDocument(raw: string): ProtectionProfileImportShape[] {
  const parsed = JSON.parse(raw) as Record<string, unknown> | null;
  const normalizeShape = (value: Record<string, unknown>, fallbackName: string): ProtectionProfileImportShape => ({
    name: normalizeProtectionProfileName(typeof value.name === "string" ? value.name : fallbackName),
    neverCleanupPaths: uniqueTrimmedStrings(
      Array.isArray(value.neverCleanupPaths) ? value.neverCleanupPaths.map((item) => String(item ?? "")) : []
    ),
    neverCleanupApps: uniqueTrimmedStrings(
      Array.isArray(value.neverCleanupApps) ? value.neverCleanupApps.map((item) => String(item ?? "")) : []
    )
  });
  const hasExplicitName = (value: Record<string, unknown>): boolean => {
    return typeof value.name === "string" && value.name.trim().length > 0;
  };

  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.profiles)) {
    const profiles = parsed.profiles
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, index) => ({
        profile: normalizeShape(item, `Imported Profile ${index + 1}`),
        hasExplicitName: hasExplicitName(item)
      }))
      .filter(({ profile, hasExplicitName: itemHasExplicitName }) => (
        profile.neverCleanupPaths.length || profile.neverCleanupApps.length || itemHasExplicitName
      ))
      .map(({ profile }) => profile);

    if (profiles.length) {
      return profiles;
    }
  }

  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    const profile = normalizeShape(parsed, DEFAULT_PROTECTION_PROFILE_NAME);
    if (profile.neverCleanupPaths.length || profile.neverCleanupApps.length || hasExplicitName(parsed)) {
      return [profile];
    }
  }

  throw new Error("No protection profiles found in import");
}

function parseProtectionDiffDocument(raw: string): ProtectionDiffPatch {
  const parsed = JSON.parse(raw) as Record<string, unknown> | null;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Invalid protection diff document");
  }

  const activeOnlyPaths = Array.isArray(parsed.activeOnlyPaths)
    ? parsed.activeOnlyPaths.map((item) => String(item ?? ""))
    : [];
  const compareOnlyPaths = Array.isArray(parsed.compareOnlyPaths)
    ? parsed.compareOnlyPaths.map((item) => String(item ?? ""))
    : [];
  const activeOnlyApps = Array.isArray(parsed.activeOnlyApps)
    ? parsed.activeOnlyApps.map((item) => String(item ?? ""))
    : [];
  const compareOnlyApps = Array.isArray(parsed.compareOnlyApps)
    ? parsed.compareOnlyApps.map((item) => String(item ?? ""))
    : [];

  const paths = uniqueTrimmedStrings([...activeOnlyPaths, ...compareOnlyPaths]);
  const apps = uniqueTrimmedStrings([...activeOnlyApps, ...compareOnlyApps]);
  if (!paths.length && !apps.length) {
    throw new Error("No patchable entries found in protection diff");
  }

  const activeLabel = typeof parsed.activeProfile === "string" ? parsed.activeProfile.trim() : "";
  const compareLabel = typeof parsed.compareProfile === "string" ? parsed.compareProfile.trim() : "";

  return {
    paths,
    apps,
    sourceLabel: activeLabel && compareLabel ? `${activeLabel} vs ${compareLabel}` : "imported diff"
  };
}

function formatDays(value?: number): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  const days = Number(value);
  if (days < 30) {
    return `${days} d`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)} mo`;
  }
  return `${(days / 365).toFixed(1)} y`;
}

function driverClassLabel(value?: string): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) {
    return "Unknown";
  }

  const labels: Record<string, string> = {
    BLUETOOTH: "Bluetooth",
    CAMERA: "Camera",
    DISKDRIVE: "Disk",
    DISPLAY: "Graphics",
    MEDIA: "Audio / Media",
    NET: "Network",
    SCSIADAPTER: "Storage",
    SECURITYDEVICES: "Security",
    SYSTEM: "System",
    USB: "USB"
  };

  return labels[normalized] ?? normalized;
}

function buildDefaultSelection(groups: DuplicateGroup[]): DuplicateSelection[] {
  return groups.map((group) => {
    const sorted = [...group.files].sort((a, b) => b.modifiedAt - a.modifiedAt);
    return {
      groupId: group.id,
      keepPath: sorted[0]?.path ?? "",
      removePaths: sorted.slice(1).map((item) => item.path)
    };
  });
}

export function AppShell() {
  const [tab, setTab] = useState<TabKey>("overview");
  const currentSection = tabToSection[tab];
  const latestPerformanceSnapshot = useAppStore((state) => state.latestSnapshot);
  const driverPerformanceSummary = useAppStore((state) => state.driverPerformanceSummary);
  const activePerformanceView = useAppStore((state) => state.activePerformanceView);
  const setActivePerformanceView = useAppStore((state) => state.setActivePerformanceView);
  const [settings, setSettings] = useState<AppConfig>(defaultSettings);
  const [scheduler, setScheduler] = useState<SchedulerStatus>({
    enabled: false,
    cadence: "weekly",
    dayOfWeek: 6,
    time: "10:00"
  });
  const [status, setStatus] = useState("Ready");
  const [visualDensity, setVisualDensity] = useState<VisualDensity>(() => {
    try {
      const raw = window.localStorage.getItem(VISUAL_DENSITY_STORAGE_KEY);
      if (raw === "comfortable" || raw === "compact" || raw === "power") {
        return raw;
      }
    } catch {
      // Ignore localStorage read errors.
    }
    return "compact";
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteCursor, setCommandPaletteCursor] = useState(0);
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(COMMAND_PALETTE_RECENTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
    } catch {
      return [];
    }
  });

  const [scanPreset, setScanPreset] = useState<CleanupPreset>("standard");
  const [scanCategories, setScanCategories] = useState<CleanupCategory[]>(categoryOptions.map((item) => item.value));
  const [activeRunId, setActiveRunId] = useState("");
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent>(defaultScanProgress);

  const [findings, setFindings] = useState<ScanFinding[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary>(emptyScanSummary);
  const [protectedRejected, setProtectedRejected] = useState<ProtectedFindingRejection[]>([]);
  const [safetyQuery, setSafetyQuery] = useState("");
  const [safetyProtectionFilter, setSafetyProtectionFilter] = useState<"all" | ProtectionKind>("all");
  const [selectedFindingIds, setSelectedFindingIds] = useState<string[]>([]);
  const [findingsQuery, setFindingsQuery] = useState("");
  const [findingsRenderLimit, setFindingsRenderLimit] = useState(FINDINGS_PAGE_SIZE);
  const [isLoadingScanResults, setIsLoadingScanResults] = useState(false);

  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreviewResponse | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupExecuteResponse | null>(null);
  const [isPreviewingCleanup, setIsPreviewingCleanup] = useState(false);
  const [isExecutingCleanup, setIsExecutingCleanup] = useState(false);
  const [cleanupGroupBy, setCleanupGroupBy] = useState<CleanupGroupBy>("category");
  const [cleanupSortBy, setCleanupSortBy] = useState<CleanupSortBy>("size_desc");
  const [cleanupPreviewScope, setCleanupPreviewScope] = useState<"selected" | "all">("selected");
  const [cleanupQuickFilter, setCleanupQuickFilter] = useState<CleanupQuickFilter>("all");
  const [cleanupExecutionId, setCleanupExecutionId] = useState("");
  const [showCleanupOverlay, setShowCleanupOverlay] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState<CleanupExecutionProgressEvent | null>(null);
  const [cleanupLogs, setCleanupLogs] = useState<string[]>([]);
  const [showQuarantinePurgeOverlay, setShowQuarantinePurgeOverlay] = useState(false);
  const [quarantinePurgeProgress, setQuarantinePurgeProgress] = useState<QuarantinePurgeProgressEvent | null>(null);
  const [quarantinePurgeLogs, setQuarantinePurgeLogs] = useState<string[]>([]);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const [storageInsights, setStorageInsights] = useState<StorageScanResponse | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageHistory, setStorageHistory] = useState<StorageHistorySnapshot[]>([]);

  const [aiModels, setAiModels] = useState<AIModelsResponse | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAdvisorAnalysisResponse | null>(null);
  const [aiMaxFiles, setAiMaxFiles] = useState(20_000);
  const [aiAnalysisMode, setAiAnalysisMode] = useState<AIAnalysisMode>("fast");
  const [aiSelectedModel, setAiSelectedModel] = useState("");
  const [isLoadingAiModels, setIsLoadingAiModels] = useState(false);
  const [isAnalyzingAi, setIsAnalyzingAi] = useState(false);
  const [pendingAiAction, setPendingAiAction] = useState<AIActionSuggestion | null>(null);
  const [queuedAiPreview, setQueuedAiPreview] = useState(false);
  const [aiSuggestedFindingIds, setAiSuggestedFindingIds] = useState<string[]>([]);
  const [aiCollections, setAiCollections] = useState<NamedAiCollection[]>([]);
  const [activeAiCollectionId, setActiveAiCollectionId] = useState("");
  const [aiCollectionNameInput, setAiCollectionNameInput] = useState(DEFAULT_AI_COLLECTION_NAME);
  const [protectionProfiles, setProtectionProfiles] = useState<NamedProtectionProfile[]>([]);
  const [activeProtectionProfileId, setActiveProtectionProfileId] = useState("");
  const [compareProtectionProfileId, setCompareProtectionProfileId] = useState("");
  const [protectionProfileNameInput, setProtectionProfileNameInput] = useState(DEFAULT_PROTECTION_PROFILE_NAME);
  const [allowlistImportReview, setAllowlistImportReview] = useState<AllowlistImportReview | null>(null);
  const [selectedPromotionPaths, setSelectedPromotionPaths] = useState<string[]>([]);
  const [selectedPromotionApps, setSelectedPromotionApps] = useState<string[]>([]);

  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateSelections, setDuplicateSelections] = useState<DuplicateSelection[]>([]);
  const [duplicatePreview, setDuplicatePreview] = useState<DuplicatePreviewResponse | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<CleanupExecuteResponse | null>(null);
  const [duplicateMinSizeMb, setDuplicateMinSizeMb] = useState(1);
  const [duplicateRenderLimit, setDuplicateRenderLimit] = useState(DUP_GROUPS_PAGE_SIZE);

  const [drivers, setDrivers] = useState<DriverScanResponse | null>(null);
  const [driverQuery, setDriverQuery] = useState("");
  const [driverFilter, setDriverFilter] = useState<"all" | "windows_update" | "oem_portal">("all");
  const [driverSignalFilter, setDriverSignalFilter] = useState<DriverStackFeatureSignalId | "all">(() =>
    getStoredDriverSignalFilter()
  );
  const [openDriverSignalEvidenceIds, setOpenDriverSignalEvidenceIds] = useState<DriverSuppressionSuggestionId[]>(() =>
    getStoredDriverSignalEvidenceOpenIds()
  );
  const [isScanningDrivers, setIsScanningDrivers] = useState(false);
  const [driverOpenStates, setDriverOpenStates] = useState<Record<string, "idle" | "opening" | "opened" | "failed">>({});
  const [driverAiLookupStates, setDriverAiLookupStates] = useState<Record<string, "idle" | "loading" | "ready" | "failed">>({});
  const [driverAiLookups, setDriverAiLookups] = useState<Record<string, DriverOfficialLookup>>({});
  const [quarantineItems, setQuarantineItems] = useState<QuarantineItem[]>([]);
  const [quarantineTotalCount, setQuarantineTotalCount] = useState(0);
  const [quarantineActiveCount, setQuarantineActiveCount] = useState(0);
  const [quarantineHasMore, setQuarantineHasMore] = useState(false);
  const [isLoadingQuarantine, setIsLoadingQuarantine] = useState(false);
  const [isPurgingQuarantine, setIsPurgingQuarantine] = useState(false);
  const [updates, setUpdates] = useState<UpdateCheckResponse | null>(null);
  const autoLoadedRunRef = useRef("");
  const scanResultsSyncRef = useRef<{ runId: string; at: number }>({ runId: "", at: 0 });
  const activeRunIdRef = useRef("");
  const cleanupExecutionIdRef = useRef("");
  const quarantineNextOffsetRef = useRef(0);
  const allowlistImportInputRef = useRef<HTMLInputElement | null>(null);
  const allowlistImportModeRef = useRef<"merge" | "replace">("merge");
  const protectionProfileImportInputRef = useRef<HTMLInputElement | null>(null);
  const protectionDiffImportInputRef = useRef<HTMLInputElement | null>(null);
  const storageLoadPromiseRef = useRef<Promise<void> | null>(null);
  const storageCacheRef = useRef<{ at: number; key: string; value: StorageScanResponse | null }>({ at: 0, key: "", value: null });
  const aiModelsPromiseRef = useRef<Promise<AIModelsResponse | null> | null>(null);
  const aiModelsCacheRef = useRef<{ at: number; value: AIModelsResponse | null }>({ at: 0, value: null });
  const driversLoadPromiseRef = useRef<Promise<void> | null>(null);
  const driversCacheRef = useRef<{
    at: number;
    key: string;
    value: DriverScanResponse | null;
  }>({ at: 0, key: "", value: null });

  const findingIdSet = useMemo(() => new Set(findings.map((item) => item.id)), [findings]);
  const selectedFindingSet = useMemo(
    () => new Set(selectedFindingIds.filter((item) => findingIdSet.has(item))),
    [findingIdSet, selectedFindingIds]
  );
  const aiSuggestedFindingSet = useMemo(
    () => new Set(aiSuggestedFindingIds.filter((item) => findingIdSet.has(item))),
    [aiSuggestedFindingIds, findingIdSet]
  );
  const recommendedFindingSet = useMemo(
    () =>
      new Set(
        findings
          .filter((item) => item.selectedByDefault && !isDownloadsPath(item.path))
          .map((item) => item.id)
      ),
    [findings]
  );
  const quickActionsHint = useMemo(() => {
    if (selectedFindingSet.size > 0) {
      return `Ready: ${selectedFindingSet.size} selected findings.`;
    }
    if (activeRunId && findings.length > 0) {
      return "Step 3: Review cleanup collections, then Preview and Execute.";
    }
    if (activeRunId) {
      return "Step 2: The scan is estimating scope and loading findings automatically.";
    }
    return "Step 1: Start Scan.";
  }, [activeRunId, findings.length, selectedFindingSet.size]);
  const deferredFindingsQuery = useDeferredValue(findingsQuery.trim().toLowerCase());
  const findingSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const item of findings) {
      index.set(item.id, `${item.path} ${item.category} ${item.reason}`.toLowerCase());
    }
    return index;
  }, [findings]);

  const machineRoots = useMemo(() => settings.customRoots.filter(Boolean), [settings.customRoots]);
  const machineScopeLabel = useMemo(() => {
    if (!machineRoots.length) {
      return "Detecting fixed Windows drives";
    }
    return machineRoots.join("  •  ");
  }, [machineRoots]);

  const storageDiff = useMemo(() => computeStorageDiff(storageHistory), [storageHistory]);
  const duplicateGroupById = useMemo(() => new Map(duplicateGroups.map((group) => [group.id, group])), [duplicateGroups]);
  const workspaceModeLabel =
    visualDensity === "comfortable" ? "Comfort" : visualDensity === "compact" ? "Compact" : "Power";

  const quickFilteredFindings = useMemo(() => {
    if (cleanupQuickFilter === "selected") {
      return findings.filter((item) => selectedFindingSet.has(item.id));
    }
    if (cleanupQuickFilter === "ai_selected") {
      return findings.filter((item) => aiSuggestedFindingSet.has(item.id));
    }
    if (cleanupQuickFilter === "recommended") {
      return findings.filter((item) => recommendedFindingSet.has(item.id));
    }
    return findings;
  }, [aiSuggestedFindingSet, cleanupQuickFilter, findings, recommendedFindingSet, selectedFindingSet]);

  const filteredFindings = useMemo(() => {
    if (!deferredFindingsQuery) {
      return quickFilteredFindings;
    }

    return quickFilteredFindings.filter((item) => {
      const haystack = findingSearchIndex.get(item.id) ?? "";
      return haystack.includes(deferredFindingsQuery);
    });
  }, [deferredFindingsQuery, findingSearchIndex, quickFilteredFindings]);

  const sortedFilteredFindings = useMemo(() => {
    const sorted = [...filteredFindings];
    sorted.sort((left, right) => {
      if (cleanupSortBy === "size_asc") {
        return left.sizeBytes - right.sizeBytes;
      }
      if (cleanupSortBy === "source_desc") {
        return (
          findingSourceRank(right.id, selectedFindingSet, aiSuggestedFindingSet, recommendedFindingSet) -
            findingSourceRank(left.id, selectedFindingSet, aiSuggestedFindingSet, recommendedFindingSet) ||
          right.sizeBytes - left.sizeBytes ||
          left.path.localeCompare(right.path)
        );
      }
      if (cleanupSortBy === "path_asc") {
        return left.path.localeCompare(right.path);
      }
      if (cleanupSortBy === "risk_desc") {
        return riskScore(right.risk) - riskScore(left.risk) || right.sizeBytes - left.sizeBytes;
      }
      if (cleanupSortBy === "modified_desc") {
        return right.modifiedAt - left.modifiedAt;
      }
      return right.sizeBytes - left.sizeBytes;
    });
    return sorted;
  }, [aiSuggestedFindingSet, cleanupSortBy, filteredFindings, recommendedFindingSet, selectedFindingSet]);

  const visibleFindings = useMemo(
    () => sortedFilteredFindings.slice(0, findingsRenderLimit),
    [findingsRenderLimit, sortedFilteredFindings]
  );
  const visibleDuplicateGroups = useMemo(() => duplicateGroups.slice(0, duplicateRenderLimit), [duplicateGroups, duplicateRenderLimit]);
  const visibleQuarantineItems = useMemo(() => quarantineItems, [quarantineItems]);
  const aiCandidates = useMemo(() => aiAnalysis?.summary.appDataCandidates ?? [], [aiAnalysis?.summary.appDataCandidates]);
  const activeAiCollection = useMemo(
    () => aiCollections.find((collection) => collection.id === activeAiCollectionId) ?? aiCollections[0] ?? null,
    [activeAiCollectionId, aiCollections]
  );
  const activeProtectionProfile = useMemo(
    () => protectionProfiles.find((profile) => profile.id === activeProtectionProfileId) ?? protectionProfiles[0] ?? null,
    [activeProtectionProfileId, protectionProfiles]
  );
  const currentSettingsComparisonTarget = useMemo<ProtectionProfileComparisonTarget>(
    () => ({
      id: CURRENT_SETTINGS_COMPARE_ID,
      name: "Current Settings",
      neverCleanupPaths: settings.neverCleanupPaths,
      neverCleanupApps: settings.neverCleanupApps
    }),
    [settings.neverCleanupApps, settings.neverCleanupPaths]
  );
  const compareProtectionProfile = useMemo<ProtectionProfileComparisonTarget | null>(() => {
    if (compareProtectionProfileId === CURRENT_SETTINGS_COMPARE_ID) {
      return currentSettingsComparisonTarget;
    }

    return (
      protectionProfiles.find((profile) => profile.id === compareProtectionProfileId) ??
      currentSettingsComparisonTarget ??
      protectionProfiles.find((profile) => profile.id !== activeProtectionProfile?.id) ??
      null
    );
  }, [activeProtectionProfile?.id, compareProtectionProfileId, currentSettingsComparisonTarget, protectionProfiles]);
  const activeCollectionActions = useMemo(() => activeAiCollection?.actions ?? [], [activeAiCollection]);
  const activeCollectionActionIds = useMemo(
    () => new Set(activeCollectionActions.map((item) => item.id)),
    [activeCollectionActions]
  );
  const collectionCleanupActions = useMemo(() => collectionActionSummary(activeCollectionActions).cleanup, [activeCollectionActions]);
  const collectionDuplicateActions = useMemo(() => collectionActionSummary(activeCollectionActions).duplicates, [activeCollectionActions]);
  const aiCollectionEstimatedBytes = useMemo(
    () => activeCollectionActions.reduce((sum, item) => sum + item.estimatedBytes, 0),
    [activeCollectionActions]
  );
  const smartAiCollections = useMemo(
    () => buildSmartAiCollectionSuggestions(aiAnalysis?.actionPlan ?? []),
    [aiAnalysis?.actionPlan]
  );
  const cleanupFilterCounts = useMemo(
    () => ({
      all: findings.length,
      selected: selectedFindingSet.size,
      ai_selected: aiSuggestedFindingSet.size,
      recommended: recommendedFindingSet.size
    }),
    [aiSuggestedFindingSet.size, findings.length, recommendedFindingSet.size, selectedFindingSet.size]
  );
  const protectionProfileComparison = useMemo(() => {
    if (!activeProtectionProfile || !compareProtectionProfile || activeProtectionProfile.id === compareProtectionProfile.id) {
      return null;
    }

    return {
      activeOnlyPaths: diffNormalizedStrings(compareProtectionProfile.neverCleanupPaths, activeProtectionProfile.neverCleanupPaths).added,
      compareOnlyPaths: diffNormalizedStrings(activeProtectionProfile.neverCleanupPaths, compareProtectionProfile.neverCleanupPaths).added,
      sharedPaths: sharedNormalizedStrings(activeProtectionProfile.neverCleanupPaths, compareProtectionProfile.neverCleanupPaths),
      activeOnlyApps: diffNormalizedStrings(compareProtectionProfile.neverCleanupApps, activeProtectionProfile.neverCleanupApps).added,
      compareOnlyApps: diffNormalizedStrings(activeProtectionProfile.neverCleanupApps, compareProtectionProfile.neverCleanupApps).added,
      sharedApps: sharedNormalizedStrings(activeProtectionProfile.neverCleanupApps, compareProtectionProfile.neverCleanupApps)
    };
  }, [activeProtectionProfile, compareProtectionProfile]);
  const promoteComparisonDiff = useMemo(() => {
    if (!activeProtectionProfile || !compareProtectionProfile || !protectionProfileComparison) {
      return null;
    }

    const fromCurrentSettings = compareProtectionProfile.id === CURRENT_SETTINGS_COMPARE_ID;
    const pathsToPromote = fromCurrentSettings
      ? protectionProfileComparison.activeOnlyPaths
      : protectionProfileComparison.compareOnlyPaths;
    const appsToPromote = fromCurrentSettings
      ? protectionProfileComparison.activeOnlyApps
      : protectionProfileComparison.compareOnlyApps;

    return {
      pathsToPromote,
      appsToPromote,
      sourceName: fromCurrentSettings ? activeProtectionProfile.name : compareProtectionProfile.name,
      actionLabel: fromCurrentSettings ? "Promote Active Diff To Current" : "Promote Compare Diff To Current",
      pathsActionLabel: fromCurrentSettings ? "Promote Active Paths To Current" : "Promote Compare Paths To Current",
      appsActionLabel: fromCurrentSettings ? "Promote Active Apps To Current" : "Promote Compare Apps To Current"
    };
  }, [activeProtectionProfile, compareProtectionProfile, protectionProfileComparison]);
  const selectedPromotionPathSet = useMemo(() => new Set(selectedPromotionPaths.map((item) => item.toLowerCase())), [selectedPromotionPaths]);
  const selectedPromotionAppSet = useMemo(() => new Set(selectedPromotionApps.map((item) => item.toLowerCase())), [selectedPromotionApps]);

  const scanTopFindings = useMemo(
    () => [...findings].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, 10),
    [findings]
  );
  const protectedRejectedSearchIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const item of protectedRejected) {
      const key = `${item.path}|${item.sourceRuleId}|${item.protectionKind}`;
      index.set(
        key,
        `${item.path} ${item.sourceRuleId} ${item.reason} ${item.matchedAppName ?? ""} ${item.protectionKind}`.toLowerCase()
      );
    }
    return index;
  }, [protectedRejected]);
  const filteredProtectedRejected = useMemo(() => {
    const query = safetyQuery.trim().toLowerCase();
    return protectedRejected.filter((item) => {
      if (safetyProtectionFilter !== "all" && item.protectionKind !== safetyProtectionFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const key = `${item.path}|${item.sourceRuleId}|${item.protectionKind}`;
      const haystack = protectedRejectedSearchIndex.get(key) ?? "";
      return haystack.includes(query);
    });
  }, [protectedRejected, protectedRejectedSearchIndex, safetyProtectionFilter, safetyQuery]);
  const safetyCountsByKind = useMemo(() => {
    const counts: Record<string, number> = { all: protectedRejected.length };
    for (const item of protectedRejected) {
      counts[item.protectionKind] = (counts[item.protectionKind] ?? 0) + 1;
    }
    return counts;
  }, [protectedRejected]);

  const scanResultsByCategory = useMemo(() => {
    const aggregates = new Map<CleanupCategory, { count: number; bytes: number }>();
    for (const finding of findings) {
      const bucket = aggregates.get(finding.category) ?? { count: 0, bytes: 0 };
      bucket.count += findingDisplayCount(finding);
      bucket.bytes += finding.sizeBytes;
      aggregates.set(finding.category, bucket);
    }

    return categoryOptions
      .map((option) => {
        const aggregate = aggregates.get(option.value) ?? { count: 0, bytes: 0 };
        return {
          category: option.value,
          label: option.label,
          count: aggregate.count,
          bytes: aggregate.bytes
        };
      })
      .filter((item) => item.count > 0)
      .sort((left, right) => right.bytes - left.bytes);
  }, [findings]);
  const scanResultsByType = useMemo(() => {
    const aggregates = new Map<string, { count: number; bytes: number }>();
    for (const finding of findings) {
      const key = extensionOfPath(finding.path);
      const bucket = aggregates.get(key) ?? { count: 0, bytes: 0 };
      bucket.count += findingDisplayCount(finding);
      bucket.bytes += finding.sizeBytes;
      aggregates.set(key, bucket);
    }

    return [...aggregates.entries()]
      .map(([extension, aggregate]) => ({
        extension,
        label: extensionLabel(extension),
        count: aggregate.count,
        bytes: aggregate.bytes
      }))
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 8);
  }, [findings]);
  const scanResultsByLocation = useMemo(() => {
    const aggregates = new Map<string, { count: number; bytes: number }>();
    for (const finding of findings) {
      const key = scanLocationBucket(finding.path);
      const bucket = aggregates.get(key) ?? { count: 0, bytes: 0 };
      bucket.count += findingDisplayCount(finding);
      bucket.bytes += finding.sizeBytes;
      aggregates.set(key, bucket);
    }

    return [...aggregates.entries()]
      .map(([label, aggregate]) => ({
        label,
        count: aggregate.count,
        bytes: aggregate.bytes
      }))
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 8);
  }, [findings]);

  const cleanupPreviewSourceFindings = useMemo(() => {
    if (cleanupPreviewScope === "selected") {
      return findings.filter((item) => selectedFindingSet.has(item.id));
    }
    return findings;
  }, [cleanupPreviewScope, findings, selectedFindingSet]);

  const cleanupGroupedPreview = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        count: number;
        totalBytes: number;
        highRisk: number;
        mediumRisk: number;
        lowRisk: number;
        items: ScanFinding[];
      }
    >();

    for (const item of cleanupPreviewSourceFindings) {
      let key = "";
      let label = "";
      if (cleanupGroupBy === "folder") {
        key = folderBucket(item.path);
        label = key;
      } else if (cleanupGroupBy === "extension") {
        key = extensionOfPath(item.path);
        label = key;
      } else if (cleanupGroupBy === "risk") {
        key = item.risk;
        label = item.risk.toUpperCase();
      } else {
        key = item.category;
        label = categoryLabelByValue[item.category];
      }

      const bucket = groups.get(key) ?? {
        key,
        label,
        count: 0,
        totalBytes: 0,
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        items: []
      };

      bucket.count += findingDisplayCount(item);
      bucket.totalBytes += item.sizeBytes;
      if (item.risk === "high") {
        bucket.highRisk += 1;
      } else if (item.risk === "medium") {
        bucket.mediumRisk += 1;
      } else {
        bucket.lowRisk += 1;
      }
      bucket.items.push(item);
      bucket.items.sort((left, right) => right.sizeBytes - left.sizeBytes);
      if (bucket.items.length > 4) {
        bucket.items.pop();
      }
      groups.set(key, bucket);
    }

    return [...groups.values()].sort((left, right) => {
      if (right.totalBytes !== left.totalBytes) {
        return right.totalBytes - left.totalBytes;
      }
      return right.count - left.count;
    });
  }, [cleanupGroupBy, cleanupPreviewSourceFindings]);
  const cleanupCategoryCollections = useMemo<CleanupCategoryCollection[]>(() => {
    const groups = new Map<
      CleanupCategory,
      {
        category: CleanupCategory;
        label: string;
        count: number;
        totalBytes: number;
        selectedCount: number;
        recommendedCount: number;
        aiCount: number;
        highRisk: number;
        mediumRisk: number;
        lowRisk: number;
        ids: string[];
        saferIds: string[];
        recommendedIds: string[];
        aiIds: string[];
        locationMap: Map<string, CleanupBulkSubgroup>;
        familyMap: Map<string, CleanupBulkSubgroup>;
      }
    >();

    for (const item of filteredFindings) {
      const bucket =
        groups.get(item.category) ??
        {
          category: item.category,
          label: categoryLabelByValue[item.category],
          count: 0,
          totalBytes: 0,
          selectedCount: 0,
          recommendedCount: 0,
          aiCount: 0,
          highRisk: 0,
          mediumRisk: 0,
          lowRisk: 0,
          ids: [],
          saferIds: [],
          recommendedIds: [],
          aiIds: [],
          locationMap: new Map<string, CleanupBulkSubgroup>(),
          familyMap: new Map<string, CleanupBulkSubgroup>()
        };

      bucket.count += findingDisplayCount(item);
      bucket.totalBytes += item.sizeBytes;
      bucket.ids.push(item.id);
      if (item.risk === "high") {
        bucket.highRisk += 1;
      } else if (item.risk === "medium") {
        bucket.mediumRisk += 1;
      } else {
        bucket.lowRisk += 1;
        bucket.saferIds.push(item.id);
      }
      if (item.risk === "medium") {
        bucket.saferIds.push(item.id);
      }
      if (selectedFindingSet.has(item.id)) {
        bucket.selectedCount += findingDisplayCount(item);
      }
      if (recommendedFindingSet.has(item.id)) {
        bucket.recommendedCount += findingDisplayCount(item);
        bucket.recommendedIds.push(item.id);
      }
      if (aiSuggestedFindingSet.has(item.id)) {
        bucket.aiCount += findingDisplayCount(item);
        bucket.aiIds.push(item.id);
      }

      const locationKey = scanLocationBucket(item.path);
      const locationGroup = bucket.locationMap.get(locationKey) ?? {
        key: `${item.category}:${locationKey}`,
        label: locationKey,
        count: 0,
        totalBytes: 0,
        selectedCount: 0,
        ids: []
      };
      locationGroup.count += findingDisplayCount(item);
      locationGroup.totalBytes += item.sizeBytes;
      locationGroup.ids.push(item.id);
      if (selectedFindingSet.has(item.id)) {
        locationGroup.selectedCount += findingDisplayCount(item);
      }
      bucket.locationMap.set(locationKey, locationGroup);

      const familyKey = fileFamilyBucket(item.path, item.category);
      const familyGroup = bucket.familyMap.get(familyKey) ?? {
        key: `${item.category}:${familyKey}`,
        label: familyKey,
        count: 0,
        totalBytes: 0,
        selectedCount: 0,
        ids: []
      };
      familyGroup.count += findingDisplayCount(item);
      familyGroup.totalBytes += item.sizeBytes;
      familyGroup.ids.push(item.id);
      if (selectedFindingSet.has(item.id)) {
        familyGroup.selectedCount += findingDisplayCount(item);
      }
      bucket.familyMap.set(familyKey, familyGroup);

      groups.set(item.category, bucket);
    }

    return [...groups.values()]
      .map((bucket) => ({
        category: bucket.category,
        label: bucket.label,
        count: bucket.count,
        totalBytes: bucket.totalBytes,
        selectedCount: bucket.selectedCount,
        recommendedCount: bucket.recommendedCount,
        aiCount: bucket.aiCount,
        highRisk: bucket.highRisk,
        mediumRisk: bucket.mediumRisk,
        lowRisk: bucket.lowRisk,
        ids: bucket.ids,
        saferIds: bucket.saferIds,
        recommendedIds: bucket.recommendedIds,
        aiIds: bucket.aiIds,
        locationGroups: [...bucket.locationMap.values()]
          .sort((left, right) => right.totalBytes - left.totalBytes || right.count - left.count)
          .slice(0, 4),
        familyGroups: [...bucket.familyMap.values()]
          .sort((left, right) => right.totalBytes - left.totalBytes || right.count - left.count)
          .slice(0, 4)
      }))
      .sort((left, right) => right.totalBytes - left.totalBytes || right.count - left.count);
  }, [aiSuggestedFindingSet, filteredFindings, recommendedFindingSet, selectedFindingSet]);

  const filteredDriverCandidates = useMemo(() => {
    const candidates = drivers?.updateCandidates ?? [];
    const query = driverQuery.trim().toLowerCase();
    return candidates.filter((item) => {
      if (driverFilter !== "all" && item.recommendation !== driverFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = `${item.deviceName} ${item.provider} ${item.manufacturer ?? ""} ${item.reason} ${item.deviceClass ?? ""} ${item.infName ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [driverFilter, driverQuery, drivers?.updateCandidates]);
  const driverSeverityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const item of drivers?.updateCandidates ?? []) {
      counts[item.severity] += 1;
    }
    return counts;
  }, [drivers?.updateCandidates]);
  const driverClassCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of drivers?.updateCandidates ?? []) {
      const key = driverClassLabel(item.deviceClass);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }, [drivers?.updateCandidates]);
  const safeDriverSuppressionSuggestions = useMemo(
    () => (drivers?.suppressionSuggestions ?? []).filter((suggestion) => suggestion.autoEligible),
    [drivers?.suppressionSuggestions]
  );
  const reviewDriverSuppressionSuggestions = useMemo(
    () => (drivers?.suppressionSuggestions ?? []).filter((suggestion) => !suggestion.autoEligible),
    [drivers?.suppressionSuggestions]
  );
  const inactiveReviewDriverSuppressionSuggestions = useMemo(
    () => reviewDriverSuppressionSuggestions.filter((suggestion) => suggestion.recommendedToHide),
    [reviewDriverSuppressionSuggestions]
  );
  const driverSuppressionSignalCounts = useMemo(() => {
    const counts = new Map<DriverStackFeatureSignalId, number>();
    for (const suggestion of drivers?.suppressionSuggestions ?? []) {
      for (const signal of suggestion.activitySignals) {
        counts.set(signal, (counts.get(signal) ?? 0) + 1);
      }
    }
    return DRIVER_SIGNAL_OPTIONS
      .map((signal) => ({ signal, count: counts.get(signal) ?? 0 }))
      .filter((entry) => entry.count > 0);
  }, [drivers?.suppressionSuggestions]);
  const visibleDriverSuppressionSuggestions = useMemo(
    () =>
      (drivers?.suppressionSuggestions ?? []).filter((suggestion) =>
        driverSignalFilter === "all" ? true : suggestion.activitySignals.includes(driverSignalFilter)
      ),
    [driverSignalFilter, drivers?.suppressionSuggestions]
  );
  const visibleSafeDriverSuppressionSuggestions = useMemo(
    () => visibleDriverSuppressionSuggestions.filter((suggestion) => suggestion.autoEligible),
    [visibleDriverSuppressionSuggestions]
  );
  const visibleInactiveReviewDriverSuppressionSuggestions = useMemo(
    () => visibleDriverSuppressionSuggestions.filter((suggestion) => !suggestion.autoEligible && suggestion.recommendedToHide),
    [visibleDriverSuppressionSuggestions]
  );
  const visibleDriverSignalEvidenceSuggestionIds = useMemo(
    () =>
      visibleDriverSuppressionSuggestions
        .filter((suggestion) => suggestion.activitySignalEvidence.length > 0)
        .map((suggestion) => suggestion.id),
    [visibleDriverSuppressionSuggestions]
  );
  const visibleDriverSignalEvidenceOpenCount = useMemo(
    () => visibleDriverSignalEvidenceSuggestionIds.filter((id) => openDriverSignalEvidenceIds.includes(id)).length,
    [openDriverSignalEvidenceIds, visibleDriverSignalEvidenceSuggestionIds]
  );
  const hiddenDriverStackLabels = useMemo(
    () => settings.driverHiddenSuggestionIds.map((id) => driverStackSettingLabel(id)),
    [settings.driverHiddenSuggestionIds]
  );

  const metrics = useMemo(() => {
    const selectedBytes = findings
      .filter((item) => selectedFindingSet.has(item.id))
      .reduce((sum, item) => sum + item.sizeBytes, 0);

    return {
      findings: findings.length,
      selected: selectedFindingSet.size,
      selectedBytes,
      quarantineCount: quarantineActiveCount,
      protectedRejected: scanSummary.protectedRejectedCount
    };
  }, [findings, quarantineActiveCount, scanSummary.protectedRejectedCount, selectedFindingSet]);
  const workspaceSummary = useMemo(() => {
    const selectedBytesLabel = metrics.selected ? formatBytes(metrics.selectedBytes) : "No selection";
    if (tab === "overview") {
      const mappedBytes = storageInsights?.totalBytes ?? 0;
      const driveCount = storageInsights?.drives?.length ?? machineRoots.length;
      return {
        label: storageInsights ? "Whole-disk map ready" : "Storage map pending",
        summary: storageInsights
          ? `${formatBytes(mappedBytes)} mapped across ${driveCount || 0} fixed drive${driveCount === 1 ? "" : "s"}.`
          : "Run the full-disk map to surface system, program, cache, and user-data hotspots first.",
        pills: [
          driveCount ? `${driveCount} drive${driveCount === 1 ? "" : "s"}` : "Detecting drives",
          storageDiff ? `${storageDiff.totalBytesDelta >= 0 ? "+" : "-"}${formatBytes(Math.abs(storageDiff.totalBytesDelta))} since last refresh` : "No prior diff"
        ]
      };
    }
    if (tab === "scan") {
      return {
        label: activeRunId ? "Scan in progress" : "Whole-machine scan ready",
        summary: quickActionsHint,
        pills: [
          `${scanProgress.percent}% complete`,
          activeRunId ? `${findings.length} findings` : presetLabel[scanPreset]
        ]
      };
    }
    if (tab === "cleanup") {
      return {
        label: metrics.selected ? "Selection ready for review" : "Grouped cleanup plan",
        summary: metrics.selected
          ? `${metrics.selected} item${metrics.selected === 1 ? "" : "s"} selected across ${cleanupCategoryCollections.length} collection${cleanupCategoryCollections.length === 1 ? "" : "s"}.`
          : "Choose a collection on the left, then preview quarantine from the focused inspector.",
        pills: [
          selectedBytesLabel,
          `${cleanupCategoryCollections.length} collection${cleanupCategoryCollections.length === 1 ? "" : "s"}`
        ]
      };
    }
    if (tab === "safety") {
      return {
        label: filteredProtectedRejected.length ? "Blocked items available for review" : "Safety guardrails active",
        summary: filteredProtectedRejected.length
          ? `${filteredProtectedRejected.length} blocked item${filteredProtectedRejected.length === 1 ? "" : "s"} kept out of cleanup by protection policy.`
          : "Protected roots, binaries, and allowlists are filtering risky findings automatically.",
        pills: [
          `${metrics.protectedRejected} blocked`,
          settings.neverCleanupPaths.length || settings.neverCleanupApps.length ? "Allowlists active" : "Default protection"
        ]
      };
    }
    if (tab === "ai") {
      return {
        label: aiAnalysis ? "AI review loaded" : "AI advisory ready",
        summary: aiAnalysis
          ? `${aiAnalysis.actionPlan.length} suggested action${aiAnalysis.actionPlan.length === 1 ? "" : "s"} structured for review.`
          : "Run a fast structured pass to classify cleanup opportunities without showing raw machine noise.",
        pills: [
          aiAnalysis ? `${aiAnalysis.actionPlan.length} actions` : "No AI run yet",
          activeAiCollection ? `${activeAiCollection.actions.length} saved` : "Collection ready"
        ]
      };
    }
    if (tab === "duplicates") {
      return {
        label: duplicateGroups.length ? "Duplicate groups ready" : "Duplicate scan ready",
        summary: duplicateGroups.length
          ? `${duplicateGroups.length} duplicate group${duplicateGroups.length === 1 ? "" : "s"} found across machine roots.`
          : "Run the whole-machine pass to surface the heaviest duplicate groups first.",
        pills: [
          `${duplicateGroups.length} groups`,
          machineRoots.length ? `${machineRoots.length} root${machineRoots.length === 1 ? "" : "s"}` : "Machine scope"
        ]
      };
    }
    if (tab === "drivers") {
      const candidateCount = drivers?.updateCandidates.length ?? 0;
      return {
        label: drivers ? "Driver guidance loaded" : "Driver scan ready",
        summary: drivers
          ? `${candidateCount} official update candidate${candidateCount === 1 ? "" : "s"} after filtering inbox and low-value noise.`
          : "Surface only official Windows Update and OEM routes when a driver really needs review.",
        pills: [
          `${driverSeverityCounts.high} high priority`,
          drivers ? `${drivers.suppressedCount} suppressed` : "Official routes only"
        ]
      };
    }
    if (tab === "performance") {
      return {
        label: "Performance workbench",
        summary: "Live metrics, snapshots, startup analysis, and diagnosis stay local and open detailed controls only when needed.",
        pills: ["Live monitor", "Structured snapshots"]
      };
    }
    if (tab === "quarantine") {
      return {
        label: quarantineActiveCount ? "Quarantine inventory available" : "Quarantine vault",
        summary: quarantineActiveCount
          ? `${quarantineActiveCount} active quarantined item${quarantineActiveCount === 1 ? "" : "s"} ready for restore or purge.`
          : "All cleanup actions remain reversible here before any final purge.",
        pills: [
          `${quarantineActiveCount} active`,
          settings.quarantineRetentionDays ? `${settings.quarantineRetentionDays} day retention` : "Retention set"
        ]
      };
    }
    return {
      label: "Settings workspace",
      summary: "Keep machine-wide defaults and safety rules compact. Advanced controls stay behind the relevant detail panels.",
      pills: [
        workspaceModeLabel,
        settings.scheduleEnabled ? "Weekly schedule active" : "Manual schedule"
      ]
    };
  }, [
    activeAiCollection,
    activeRunId,
    aiAnalysis,
    cleanupCategoryCollections.length,
    drivers,
    driverSeverityCounts.high,
    duplicateGroups.length,
    filteredProtectedRejected.length,
    findings.length,
    formatBytes,
    machineRoots.length,
    metrics.protectedRejected,
    metrics.selected,
    metrics.selectedBytes,
    presetLabel,
    quarantineActiveCount,
    quickActionsHint,
    scanPreset,
    scanProgress.percent,
    settings.neverCleanupApps.length,
    settings.neverCleanupPaths.length,
    settings.quarantineRetentionDays,
    settings.scheduleEnabled,
    storageDiff,
    storageInsights,
    tab,
    workspaceModeLabel
  ]);
  const sectionSummary = useMemo(() => {
    if (currentSection === "home") {
      return {
        label: "Smart summary",
        summary: "Start with one clear recommendation, then open detail only when you need it.",
        pills: [
          metrics.findings ? `${metrics.findings} findings loaded` : "No cleanup scan loaded",
          metrics.quarantineCount ? `${metrics.quarantineCount} in vault` : "Vault empty"
        ]
      };
    }
    if (currentSection === "cleaner") {
      return {
        label: workspaceSummary.label,
        summary: "Cleanup, disk exploration, AI guidance, and blocked-item review are now one workspace.",
        pills: [
          `${metrics.selected} selected`,
          formatBytes(metrics.selectedBytes),
          `${metrics.protectedRejected} blocked`
        ]
      };
    }
    if (currentSection === "optimize") {
      return {
        label: workspaceSummary.label,
        summary: "Keep the dominant performance issue in focus and move deep diagnostics behind the relevant view.",
        pills: [
          latestPerformanceSnapshot?.bottleneck.primary
            ? latestPerformanceSnapshot.bottleneck.primary.replace(/_/g, " ")
            : "No snapshot yet",
          driverPerformanceSummary ? `Driver risk ${driverPerformanceSummary.latencyRisk}` : "Driver summary pending"
        ]
      };
    }
    return {
      label: workspaceSummary.label,
      summary: "Reversible cleanup history and advanced settings live here instead of staying in the main workflow.",
      pills: [
        `${quarantineActiveCount} active`,
        `${quarantineTotalCount} total records`
      ]
    };
  }, [
    currentSection,
    driverPerformanceSummary,
    formatBytes,
    latestPerformanceSnapshot,
    metrics.findings,
    metrics.protectedRejected,
    metrics.quarantineCount,
    metrics.selected,
    metrics.selectedBytes,
    quarantineActiveCount,
    quarantineTotalCount,
    workspaceSummary.label
  ]);

  const loadQuarantine = useCallback(
    async (options?: { append?: boolean }) => {
      const append = Boolean(options?.append);
      const nextOffset = append ? quarantineNextOffsetRef.current : 0;
      try {
        setIsLoadingQuarantine(true);
        const result = await window.desktopApi.listQuarantine(QUARANTINE_PAGE_SIZE, nextOffset);
        setQuarantineItems((current) => (append ? [...current, ...result.items] : result.items));
        setQuarantineTotalCount(result.totalCount);
        setQuarantineActiveCount(result.activeCount);
        quarantineNextOffsetRef.current = result.nextOffset;
        setQuarantineHasMore(result.hasMore);
      } finally {
        setIsLoadingQuarantine(false);
      }
    },
    []
  );

  const loadStorage = useCallback(async (options?: { force?: boolean }) => {
    const force = Boolean(options?.force);
    const storageCacheKey = JSON.stringify({
      includeInstalledApps: settings.includeInstalledApps
    });
    if (storageLoadPromiseRef.current) {
      return storageLoadPromiseRef.current;
    }
    if (
      !force &&
      storageCacheRef.current.value &&
      storageCacheRef.current.key === storageCacheKey &&
      Date.now() - storageCacheRef.current.at < 45_000
    ) {
      setStorageInsights(storageCacheRef.current.value);
      return;
    }
    setStorageLoading(true);
    storageLoadPromiseRef.current = (async () => {
      try {
        const response = await window.desktopApi.scanStorage([], settings.includeInstalledApps);
        storageCacheRef.current = {
          at: Date.now(),
          key: storageCacheKey,
          value: response
        };
        setStorageInsights(response);
        setStorageHistory((current) => [...current, buildStorageHistorySnapshot(response)].slice(-10));
      } finally {
        setStorageLoading(false);
        storageLoadPromiseRef.current = null;
      }
    })();
    return storageLoadPromiseRef.current;
  }, [settings.includeInstalledApps]);

  const loadAiModels = useCallback(async (silent = false): Promise<AIModelsResponse | null> => {
    if (aiModelsPromiseRef.current) {
      return aiModelsPromiseRef.current;
    }
    if (aiModelsCacheRef.current.value && Date.now() - aiModelsCacheRef.current.at < 60_000) {
      setAiModels(aiModelsCacheRef.current.value);
      return aiModelsCacheRef.current.value;
    }
    setIsLoadingAiModels(true);
    aiModelsPromiseRef.current = (async () => {
      try {
        const response = await window.desktopApi.listAiModels();
        aiModelsCacheRef.current = {
          at: Date.now(),
          value: response
        };
        setAiModels(response);
        setAiSelectedModel((current) => {
          if (
            current &&
            response.models.some((item) => modelSelectionValue(item.provider, item.name) === current)
          ) {
            return current;
          }
          return response.decision.recommendedModel
            ? modelSelectionValue(response.decision.provider, response.decision.recommendedModel)
            : response.models[0]
              ? modelSelectionValue(response.models[0].provider, response.models[0].name)
              : "";
        });
        if (!silent) {
          if (!response.models.length) {
            setStatus("No AI model detected. Configure Cerebras or install a local Ollama model.");
          } else {
            setStatus(
              `Detected ${response.models.length} AI model(s). Recommended: ${aiProviderLabel(response.decision.provider)} ${response.decision.recommendedModel || "none"}.`
            );
          }
        }
        return response;
      } catch (error) {
        if (!silent) {
          setStatus(error instanceof Error ? error.message : "Could not load local models");
        }
        return null;
      } finally {
        setIsLoadingAiModels(false);
        aiModelsPromiseRef.current = null;
      }
    })();
    return aiModelsPromiseRef.current;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [savedSettings, schedulerState] = await Promise.all([
          window.desktopApi.getSettings(),
          window.desktopApi.getScheduler()
        ]);
        const mergedSettings = { ...defaultSettings, ...savedSettings };
        setSettings(mergedSettings);
        setScheduler(schedulerState);
        setScanPreset(mergedSettings.defaultPreset);
        setScanCategories(mergedSettings.defaultCategories);
        try {
          const storedCollections = migrateStoredAiCollections(
            window.localStorage.getItem(AI_COLLECTIONS_STORAGE_KEY),
            window.localStorage.getItem(AI_COLLECTION_STORAGE_KEY)
          );
          setAiCollections(storedCollections.collections);
          setActiveAiCollectionId(storedCollections.activeCollectionId);
          setAiCollectionNameInput(
            storedCollections.collections.find((collection) => collection.id === storedCollections.activeCollectionId)?.name ??
              storedCollections.collections[0]?.name ??
              DEFAULT_AI_COLLECTION_NAME
          );
        } catch {
          // Ignore invalid persisted collection.
        }
        try {
          const storedProfiles = migrateStoredProtectionProfiles(
            window.localStorage.getItem(PROTECTION_PROFILES_STORAGE_KEY)
          );
          setProtectionProfiles(storedProfiles.profiles);
          setActiveProtectionProfileId(storedProfiles.activeProfileId);
          setProtectionProfileNameInput(
            storedProfiles.profiles.find((profile) => profile.id === storedProfiles.activeProfileId)?.name ??
              storedProfiles.profiles[0]?.name ??
              DEFAULT_PROTECTION_PROFILE_NAME
          );
        } catch {
          // Ignore invalid persisted protection profiles.
        }
        try {
          const raw = window.localStorage.getItem(STORAGE_HISTORY_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as StorageHistorySnapshot[];
            if (Array.isArray(parsed)) {
              setStorageHistory(
                parsed
                  .filter((item) => item && typeof item === "object" && typeof item.capturedAt === "number")
                  .slice(-10)
              );
            }
          }
        } catch {
          // Ignore invalid persisted storage history.
        }
        await loadQuarantine();
        void loadAiModels(true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Initialization failed");
      }
    })();
  }, [loadAiModels, loadQuarantine]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        AI_COLLECTIONS_STORAGE_KEY,
        JSON.stringify({
          activeCollectionId: activeAiCollection?.id ?? "",
          collections: aiCollections
        } satisfies StoredAiCollectionsState)
      );
    } catch {
      // Ignore storage errors.
    }
  }, [activeAiCollection?.id, aiCollections]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PROTECTION_PROFILES_STORAGE_KEY,
        JSON.stringify({
          activeProfileId: activeProtectionProfile?.id ?? "",
          profiles: protectionProfiles
        } satisfies StoredProtectionProfilesState)
      );
    } catch {
      // Ignore storage errors.
    }
  }, [activeProtectionProfile?.id, protectionProfiles]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_HISTORY_STORAGE_KEY,
        JSON.stringify(storageHistory.slice(-10))
      );
    } catch {
      // Ignore storage errors.
    }
  }, [storageHistory]);

  useEffect(() => {
    try {
      if (driverSignalFilter === "all") {
        window.localStorage.removeItem(DRIVER_SIGNAL_FILTER_STORAGE_KEY);
      } else {
        window.localStorage.setItem(DRIVER_SIGNAL_FILTER_STORAGE_KEY, driverSignalFilter);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [driverSignalFilter]);

  useEffect(() => {
    try {
      if (!openDriverSignalEvidenceIds.length) {
        window.localStorage.removeItem(DRIVER_SIGNAL_EVIDENCE_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          DRIVER_SIGNAL_EVIDENCE_STORAGE_KEY,
          JSON.stringify(openDriverSignalEvidenceIds)
        );
      }
    } catch {
      // Ignore storage errors.
    }
  }, [openDriverSignalEvidenceIds]);

  useEffect(() => {
    const recompute = () => {
      setShowScrollTop(window.scrollY > 360);
    };

    const onScroll = () => {
      recompute();
    };

    recompute();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [tab]);

  useEffect(() => {
    if (!aiCollections.length) {
      if (activeAiCollectionId) {
        setActiveAiCollectionId("");
      }
      return;
    }
    if (!aiCollections.some((collection) => collection.id === activeAiCollectionId)) {
      setActiveAiCollectionId(aiCollections[0].id);
    }
  }, [activeAiCollectionId, aiCollections]);

  useEffect(() => {
    setAiCollectionNameInput(activeAiCollection?.name ?? DEFAULT_AI_COLLECTION_NAME);
  }, [activeAiCollection]);

  useEffect(() => {
    if (!protectionProfiles.length) {
      if (activeProtectionProfileId) {
        setActiveProtectionProfileId("");
      }
      return;
    }
    if (!protectionProfiles.some((profile) => profile.id === activeProtectionProfileId)) {
      setActiveProtectionProfileId(protectionProfiles[0].id);
    }
  }, [activeProtectionProfileId, protectionProfiles]);

  useEffect(() => {
    setProtectionProfileNameInput(activeProtectionProfile?.name ?? DEFAULT_PROTECTION_PROFILE_NAME);
  }, [activeProtectionProfile]);

  useEffect(() => {
    if (driverSignalFilter === "all" || !drivers) {
      return;
    }
    const filterStillAvailable = driverSuppressionSignalCounts.some((entry) => entry.signal === driverSignalFilter);
    if (!filterStillAvailable) {
      setDriverSignalFilter("all");
    }
  }, [driverSignalFilter, driverSuppressionSignalCounts, drivers]);

  useEffect(() => {
    if (!activeProtectionProfile) {
      if (compareProtectionProfileId) {
        setCompareProtectionProfileId("");
      }
      return;
    }

    const activeId = activeProtectionProfile.id;
    const compareStillValid =
      compareProtectionProfileId === CURRENT_SETTINGS_COMPARE_ID ||
      (compareProtectionProfileId &&
        protectionProfiles.some((profile) => profile.id === compareProtectionProfileId && profile.id !== activeId));

    if (compareStillValid) {
      return;
    }

    const fallback = protectionProfiles.find((profile) => profile.id !== activeId);
    setCompareProtectionProfileId(fallback?.id ?? CURRENT_SETTINGS_COMPARE_ID);
  }, [activeProtectionProfile, compareProtectionProfileId, protectionProfiles]);

  useEffect(() => {
    setSelectedPromotionPaths(promoteComparisonDiff?.pathsToPromote ?? []);
    setSelectedPromotionApps(promoteComparisonDiff?.appsToPromote ?? []);
  }, [promoteComparisonDiff?.pathsToPromote, promoteComparisonDiff?.appsToPromote, promoteComparisonDiff?.sourceName]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    cleanupExecutionIdRef.current = cleanupExecutionId;
  }, [cleanupExecutionId]);

  useEffect(() => {
    const unsubscribe = window.desktopApi.onScanProgress((payload) => {
      const trackedRunId = activeRunIdRef.current;
      if (trackedRunId && payload.runId !== trackedRunId) {
        return;
      }
      if (!trackedRunId && payload.runId) {
        activeRunIdRef.current = payload.runId;
        setActiveRunId(payload.runId);
      }

      setScanProgress((current) => {
        if (
          current.percent === payload.percent &&
          current.stage === payload.stage &&
          current.findingsCount === payload.findingsCount &&
          current.processedItems === payload.processedItems &&
          current.etaSec === payload.etaSec &&
          current.processedDirectories === payload.processedDirectories &&
          current.estimatedTotalItems === payload.estimatedTotalItems &&
          current.estimatedRemainingItems === payload.estimatedRemainingItems &&
          current.scanDensity === payload.scanDensity
        ) {
          return current;
        }
        return payload;
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktopApi.onCleanupProgress((payload) => {
      const trackedExecutionId = cleanupExecutionIdRef.current;
      if (trackedExecutionId && payload.executionId !== trackedExecutionId) {
        return;
      }
      if (!trackedExecutionId && payload.executionId) {
        cleanupExecutionIdRef.current = payload.executionId;
        setCleanupExecutionId(payload.executionId);
      }

      setCleanupProgress(payload);
      if (payload.logLine) {
        const line = `[${new Date(payload.timestamp).toLocaleTimeString()}] ${payload.logLine}`;
        setCleanupLogs((current) => [...current.slice(-399), line]);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktopApi.onQuarantinePurgeProgress((payload) => {
      setQuarantinePurgeProgress(payload);
      if (payload.logLine) {
        const line = `[${new Date(payload.timestamp).toLocaleTimeString()}] ${payload.logLine}`;
        setQuarantinePurgeLogs((current) => [...current.slice(-399), line]);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (tab !== "ai" || aiModels || isLoadingAiModels) {
      return;
    }
    void loadAiModels();
  }, [aiModels, isLoadingAiModels, loadAiModels, tab]);

  const startScan = useCallback(async (overrides?: ScanStartOverrides) => {
    const effectiveCategories = overrides?.categories ?? scanCategories;
    const effectiveRoots = overrides?.roots ?? settings.customRoots;
    const effectivePreset = overrides?.preset ?? scanPreset;

    if (!effectiveCategories.length) {
      setStatus("Select at least one category before starting a scan.");
      return;
    }

    try {
      setStatus(overrides?.aiAction ? `Starting focused scan for "${overrides.aiAction.title}"...` : "Starting scan...");
      autoLoadedRunRef.current = "";
      scanResultsSyncRef.current = { runId: "", at: 0 };
      activeRunIdRef.current = "";
      setActiveRunId("");
      setScanProgress(defaultScanProgress);
      setFindings([]);
      setScanSummary(emptyScanSummary);
      setProtectedRejected([]);
      setSafetyQuery("");
      setSafetyProtectionFilter("all");
      setSelectedFindingIds([]);
      setAiSuggestedFindingIds([]);
      setFindingsQuery("");
      setFindingsRenderLimit(FINDINGS_PAGE_SIZE);
      if (!overrides?.keepExistingAiFocus) {
        setCleanupQuickFilter("all");
      }
      setIsLoadingScanResults(false);
      setCleanupPreview(null);
      setCleanupResult(null);
      if (overrides?.aiAction) {
        setPendingAiAction(overrides.aiAction);
        setQueuedAiPreview(Boolean(overrides.queuePreview));
      } else if (!overrides?.keepExistingAiFocus) {
        setPendingAiAction(null);
        setQueuedAiPreview(false);
      }

      const { runId } = await window.desktopApi.startScan(effectivePreset, effectiveCategories, effectiveRoots);
      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      setScanProgress({ ...defaultScanProgress, runId });
      setStatus(`Scan ${runId.slice(0, 8)} running`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan start failed");
    }
  }, [scanCategories, scanPreset, settings.customRoots]);

  const cancelScan = useCallback(async () => {
    if (!activeRunId) {
      return;
    }
    await window.desktopApi.cancelScan(activeRunId);
    setStatus("Scan cancellation requested");
  }, [activeRunId]);

  const clearAiFocus = useCallback(() => {
    setPendingAiAction(null);
    setQueuedAiPreview(false);
    setAiSuggestedFindingIds([]);
    if (cleanupQuickFilter === "ai_selected") {
      setCleanupQuickFilter("all");
    }
    setStatus("AI focus cleared.");
  }, [cleanupQuickFilter]);

  const runCleanupPreviewForSelection = useCallback(
    async (runId: string, selectedIds: string[], contextLabel?: string) => {
      if (!selectedIds.length) {
        setStatus("No focused findings are available for preview.");
        return;
      }

      try {
        setIsPreviewingCleanup(true);
        const preview = await window.desktopApi.previewCleanup(runId, selectedIds);
        setCleanupPreview(preview);
        setCleanupPreviewScope("selected");
        setCleanupGroupBy("category");
        setTab("cleanup");
        setStatus(
          contextLabel
            ? `AI preview ready for "${contextLabel}" (${preview.actionCount} actions).`
            : `Cleanup preview ready (${preview.actionCount} actions).`
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cleanup preview failed");
      } finally {
        setIsPreviewingCleanup(false);
      }
    },
    []
  );

  const loadScanResults = useCallback(async (runIdOverride?: string, options?: { quiet?: boolean }) => {
    const runId = runIdOverride ?? activeRunId;
    if (!runId) {
      return;
    }

    try {
      setIsLoadingScanResults(true);
      if (!options?.quiet) {
        setStatus("Syncing scan results...");
      }
      const result = await window.desktopApi.getScanResults(runId);
      const defaultSelection = result.findings
        .filter((item) => item.selectedByDefault && !isDownloadsPath(item.path))
        .map((item) => item.id);
      const fallbackSelection = defaultSelection.length
        ? defaultSelection
        : result.findings
            .filter((item) => item.risk !== "high" && !isDownloadsPath(item.path))
            .slice(0, 3000)
            .map((item) => item.id);
      const focusedSelection =
        pendingAiAction && result.status === "completed"
          ? result.findings
              .filter((item) => actionMatchesFinding(pendingAiAction, item))
              .map((item) => item.id)
          : [];
      const nextSelection = focusedSelection.length ? focusedSelection : fallbackSelection;
      setFindings(result.findings);
      setScanSummary(result.summary);
      setProtectedRejected(result.rejected);
      setAiSuggestedFindingIds(focusedSelection);
      setSelectedFindingIds(nextSelection);
      setFindingsQuery("");
      setFindingsRenderLimit(FINDINGS_PAGE_SIZE);
      setCleanupPreview(null);
      if (result.status === "running") {
        if (!options?.quiet) {
          setStatus("Scan still running");
        }
      } else if (result.status === "failed") {
        setStatus(result.error ? `Scan failed: ${result.error}` : "Scan failed");
      } else if (focusedSelection.length > 0 && pendingAiAction) {
        setCleanupGroupBy("category");
        setCleanupPreviewScope("selected");
        setCleanupQuickFilter("ai_selected");
        setTab("cleanup");
        if (queuedAiPreview) {
          await runCleanupPreviewForSelection(runId, focusedSelection, pendingAiAction.title);
          setQueuedAiPreview(false);
        } else {
          setStatus(
            `Focused cleanup ready: ${focusedSelection.length} finding(s) selected from AI action "${pendingAiAction.title}".`
          );
        }
      } else if (pendingAiAction && result.status === "completed") {
        setQueuedAiPreview(false);
        if (cleanupQuickFilter === "ai_selected") {
          setCleanupQuickFilter("all");
        }
        setStatus(
          `Focused scan completed, but no cleanup findings matched "${pendingAiAction.title}".`
        );
      } else {
        if (!options?.quiet) {
          setStatus(`Scan ${result.status}: ${result.findings.length} findings, ${nextSelection.length} selected`);
        }
      }
    } catch (error) {
      if (!options?.quiet) {
        setStatus(error instanceof Error ? error.message : "Scan result sync failed");
      }
    } finally {
      setIsLoadingScanResults(false);
    }
  }, [activeRunId, cleanupQuickFilter, pendingAiAction, queuedAiPreview, runCleanupPreviewForSelection]);

  useEffect(() => {
    if (!activeRunId || scanProgress.runId !== activeRunId) {
      return;
    }
    if (
      scanProgress.stage !== "completed" &&
      scanProgress.stage !== "canceled" &&
      scanProgress.stage !== "failed"
    ) {
      return;
    }
    if (autoLoadedRunRef.current === activeRunId) {
      return;
    }
    autoLoadedRunRef.current = activeRunId;
    void loadScanResults(activeRunId);
  }, [activeRunId, loadScanResults, scanProgress.runId, scanProgress.stage]);

  useEffect(() => {
    if (!activeRunId || findings.length > 0 || isLoadingScanResults) {
      return;
    }
    const now = Date.now();
    if (
      scanResultsSyncRef.current.runId === activeRunId &&
      now - scanResultsSyncRef.current.at < 1_500
    ) {
      return;
    }
    scanResultsSyncRef.current = { runId: activeRunId, at: now };
    void loadScanResults(activeRunId, { quiet: true });
  }, [activeRunId, findings.length, isLoadingScanResults, loadScanResults]);

  useEffect(() => {
    if (!activeRunId || scanProgress.runId !== activeRunId) {
      return;
    }
    if (scanProgress.stage === "completed" || scanProgress.stage === "failed" || scanProgress.stage === "canceled") {
      return;
    }
    if (!scanProgress.findingsCount || findings.length >= scanProgress.findingsCount || isLoadingScanResults) {
      return;
    }
    const now = Date.now();
    if (
      scanResultsSyncRef.current.runId === activeRunId &&
      now - scanResultsSyncRef.current.at < 2_500
    ) {
      return;
    }
    scanResultsSyncRef.current = { runId: activeRunId, at: now };
    void loadScanResults(activeRunId, { quiet: true });
  }, [activeRunId, findings.length, isLoadingScanResults, loadScanResults, scanProgress.findingsCount, scanProgress.runId, scanProgress.stage]);

  const toggleFinding = useCallback((findingId: string) => {
    setSelectedFindingIds((current) =>
      current.includes(findingId) ? current.filter((item) => item !== findingId) : [...current, findingId]
    );
  }, []);

  const applyFindingSelection = useCallback(
    (ids: string[], mode: FindingSelectionMode, label: string) => {
      const normalizedIds = [...new Set(ids.filter((id) => findingIdSet.has(id)))];
      if (!normalizedIds.length) {
        setStatus(`No findings matched ${label}.`);
        return;
      }

      setSelectedFindingIds((current) => {
        const next = mode === "replace" ? new Set<string>() : new Set(current.filter((id) => findingIdSet.has(id)));
        if (mode === "remove") {
          for (const id of normalizedIds) {
            next.delete(id);
          }
        } else {
          for (const id of normalizedIds) {
            next.add(id);
          }
        }
        return [...next];
      });
      setCleanupPreviewScope("selected");
      setStatus(
        mode === "remove"
          ? `Cleared ${normalizedIds.length} finding(s) from ${label}.`
          : mode === "replace"
            ? `Selected ${normalizedIds.length} finding(s) from ${label}.`
            : `Added ${normalizedIds.length} finding(s) from ${label}.`
      );
    },
    [findingIdSet]
  );

  const selectVisibleFindings = useCallback(() => {
    applyFindingSelection(visibleFindings.map((item) => item.id), "add", "visible findings");
  }, [applyFindingSelection, visibleFindings]);

  const clearSelection = useCallback(() => {
    setSelectedFindingIds([]);
  }, []);

  const selectAiSuggestedFindings = useCallback(() => {
    const suggestedIds = [...aiSuggestedFindingSet];
    if (!suggestedIds.length) {
      setStatus("No AI-selected findings are currently available.");
      return;
    }
    applyFindingSelection(suggestedIds, "replace", "AI-selected findings");
  }, [aiSuggestedFindingSet, applyFindingSelection]);

  const selectRecommendedFindings = useCallback(() => {
    const recommended = [...recommendedFindingSet];
    applyFindingSelection(recommended, "replace", "recommended findings");
  }, [applyFindingSelection, recommendedFindingSet]);

  const previewCleanup = useCallback(async () => {
    if (!activeRunId) {
      setStatus("Run a scan first.");
      return;
    }

    const selectedIds = selectedFindingIds.filter((item) => findingIdSet.has(item));
    if (!selectedIds.length) {
      setStatus("Select at least one finding before preview.");
      return;
    }
    await runCleanupPreviewForSelection(activeRunId, selectedIds);
  }, [activeRunId, findingIdSet, runCleanupPreviewForSelection, selectedFindingIds]);

  const executeCleanup = useCallback(async () => {
    if (!activeRunId) {
      setStatus("Run a scan first.");
      return;
    }

    const selectedIds = selectedFindingIds.filter((item) => findingIdSet.has(item));
    if (!selectedIds.length) {
      setStatus("Select at least one finding before cleanup.");
      return;
    }

    try {
      setIsExecutingCleanup(true);
      const executionId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      cleanupExecutionIdRef.current = executionId;
      setCleanupExecutionId(executionId);
      setCleanupLogs([]);
      setCleanupProgress({
        runId: activeRunId,
        executionId,
        stage: "preparing",
        totalTasks: selectedIds.length,
        completedTasks: 0,
        pendingTasks: selectedIds.length,
        movedCount: 0,
        failedCount: 0,
        freedBytes: 0,
        percent: 0,
        message: "Preparing cleanup tasks...",
        timestamp: Date.now()
      });
      setShowCleanupOverlay(true);
      setStatus("Executing cleanup in quarantine mode...");
      const result = await window.desktopApi.executeCleanup(activeRunId, selectedIds, executionId);
      setCleanupResult(result);
      setCleanupPreview(null);
      if (result.movedIds.length > 0) {
        const movedSet = new Set(result.movedIds);
        setFindings((current) => {
          const nextFindings = current.filter((item) => !movedSet.has(item.id));
          setScanSummary((summary) => summarizeFindingsForUi(nextFindings, summary));
          return nextFindings;
        });
        setSelectedFindingIds((current) => current.filter((item) => !movedSet.has(item)));
        setAiSuggestedFindingIds((current) => current.filter((item) => !movedSet.has(item)));
      }
      await loadQuarantine();
      if (result.failedCount > 0 && result.errors.length > 0) {
        setStatus(`Cleanup moved ${result.movedCount}, failed ${result.failedCount}. Review the grouped error summary in Cleanup.`);
      } else {
        setStatus(`Cleanup done. Moved ${result.movedCount}, failed ${result.failedCount}`);
      }
    } catch (error) {
      setCleanupProgress((current) => {
        if (!current) {
          return null;
        }
        return {
          ...current,
          stage: "failed",
          message: error instanceof Error ? error.message : "Cleanup failed",
          timestamp: Date.now()
        };
      });
      setStatus(error instanceof Error ? error.message : "Cleanup failed");
    } finally {
      setIsExecutingCleanup(false);
    }
  }, [activeRunId, findingIdSet, loadQuarantine, selectedFindingIds]);

  const runAiAnalysis = useCallback(async () => {
    try {
      setIsAnalyzingAi(true);
      const loadedModels = aiModels ?? (await loadAiModels());
      const modelFromState = parseModelSelectionValue(aiSelectedModel.trim());
      const selectedModel = modelFromState?.model || loadedModels?.decision.recommendedModel || loadedModels?.models[0]?.name || undefined;
      const selectedProvider = modelFromState?.provider || loadedModels?.decision.provider || settings.aiProvider;
      const result = await window.desktopApi.analyzeWithAi({
        roots: settings.customRoots,
        maxFiles: aiMaxFiles,
        model: selectedModel,
        provider: selectedProvider,
        mode: aiAnalysisMode
      });
      setAiAnalysis(result);
      setAiModels({
        models: result.models,
        decision: result.decision,
        providers: result.providers
      });
      if (!modelFromState && result.decision.recommendedModel) {
        setAiSelectedModel(modelSelectionValue(result.decision.provider, result.decision.recommendedModel));
      }
      if (result.modelError) {
        setStatus(`AI analysis done with heuristic fallback: ${result.modelError}`);
      } else {
        setStatus(
          `${aiAnalysisMode === "fast" ? "Fast" : "Standard"} AI analysis complete with ${aiProviderLabel(result.providerUsed ?? result.decision.provider)} (${result.summary.scannedFileCount} files, ${result.summary.appDataCandidates.length} AppData candidates).`
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI analysis failed");
    } finally {
      setIsAnalyzingAi(false);
    }
  }, [aiAnalysisMode, aiMaxFiles, aiModels, aiSelectedModel, loadAiModels, settings.aiProvider, settings.customRoots]);

  const applyAiAction = useCallback(
    (action: AIActionSuggestion, mode: "use" | "preview" = "use") => {
    if (action.kind === "duplicate_scan") {
      setTab("duplicates");
      setStatus("Opened Duplicates. The duplicate pass uses the whole machine by default.");
      return;
    }

    const matchedCurrentFindings = findings
      .filter((item) => actionMatchesFinding(action, item))
      .map((item) => item.id);
    if (matchedCurrentFindings.length > 0) {
      setPendingAiAction(action);
      setQueuedAiPreview(mode === "preview");
      setAiSuggestedFindingIds(matchedCurrentFindings);
      setSelectedFindingIds(matchedCurrentFindings);
      setCleanupQuickFilter("ai_selected");
      setCleanupGroupBy("category");
      setCleanupPreviewScope("selected");
      setTab("cleanup");
      if (mode === "preview" && activeRunId) {
        void runCleanupPreviewForSelection(activeRunId, matchedCurrentFindings, action.title);
      } else {
        setStatus(
          `Applied AI action to current findings. ${matchedCurrentFindings.length} item(s) selected in Cleanup Plan.`
        );
      }
      return;
    }

    const roots = actionRoots(action);
    if (!roots.length) {
      setStatus("AI action has no usable path.");
      return;
    }

    setScanCategories(categoryOptions.map((item) => item.value));
    setTab("scan");
    void startScan({
      roots,
      categories: categoryOptions.map((item) => item.value),
      aiAction: action,
      queuePreview: mode === "preview"
    });
  }, [activeRunId, findings, runCleanupPreviewForSelection, startScan]);

  const {
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
  } = useAiCollectionsController({
    activeRunId,
    findings,
    scanCategoryValues: categoryOptions.map((item) => item.value),
    activeAiCollection,
    aiCollectionNameInput,
    aiCollections,
    collectionDuplicateActions,
    defaultAiCollectionName: DEFAULT_AI_COLLECTION_NAME,
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
  });

  const runDuplicateScan = useCallback(async () => {
    try {
      setStatus("Scanning duplicates...");
      const result = await window.desktopApi.scanDuplicates(
        settings.customRoots,
        Math.max(1, Math.floor(duplicateMinSizeMb * 1024 * 1024))
      );
      startTransition(() => {
        setDuplicateGroups(result.groups);
        setDuplicateSelections(buildDefaultSelection(result.groups));
        setDuplicatePreview(null);
        setDuplicateResult(null);
        setDuplicateRenderLimit(DUP_GROUPS_PAGE_SIZE);
      });
      setStatus(`Duplicate scan complete (${result.groups.length} groups)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Duplicate scan failed");
    }
  }, [duplicateMinSizeMb, settings.customRoots]);

  const previewDuplicateResolution = useCallback(async () => {
    try {
      const result = await window.desktopApi.previewDuplicateResolution(duplicateSelections);
      setDuplicatePreview(result);
      setStatus(`Duplicate preview ready (${result.toQuarantine} files)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Duplicate preview failed");
    }
  }, [duplicateSelections]);

  const executeDuplicateResolution = useCallback(async () => {
    try {
      const result = await window.desktopApi.executeDuplicateResolution(duplicateSelections);
      setDuplicateResult(result);
      await loadQuarantine();
      setStatus(`Duplicate cleanup done. Moved ${result.movedCount}, failed ${result.failedCount}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Duplicate cleanup failed");
    }
  }, [duplicateSelections, loadQuarantine]);

  const updateDuplicateKeep = useCallback(
    (groupId: string, keepPath: string) => {
      setDuplicateSelections((current) =>
        current.map((item) => {
          if (item.groupId !== groupId) {
            return item;
          }

          const group = duplicateGroupById.get(groupId);
          const removePaths = (group?.files ?? []).map((entry) => entry.path).filter((entry) => entry !== keepPath);
          return { groupId, keepPath, removePaths };
        })
      );
    },
    [duplicateGroupById]
  );

  const loadDrivers = useCallback(async () => {
    if (!settings.driverToolsEnabled) {
      setStatus("Enable driver tools in Settings to run driver scan.");
      return;
    }

    const driverCacheKey = JSON.stringify({
      autoSuppress: settings.driverAutoSuppressSafeSuggestions,
      autoApplied: settings.driverAutoSuppressionApplied,
      ignoredInfNames: settings.driverIgnoredInfNames,
      ignoredDeviceIds: settings.driverIgnoredDeviceIds
    });
    if (driversLoadPromiseRef.current) {
      return driversLoadPromiseRef.current;
    }
    if (
      driversCacheRef.current.value &&
      driversCacheRef.current.key === driverCacheKey &&
      Date.now() - driversCacheRef.current.at < 30_000
    ) {
      setDrivers(driversCacheRef.current.value);
      return;
    }

    setIsScanningDrivers(true);
    setStatus("Scanning drivers...");
    driversLoadPromiseRef.current = (async () => {
      try {
        const result = await window.desktopApi.scanDrivers();
        let finalResult = result;
        let autoAppliedCount = 0;
        const safeSuggestions = result.suppressionSuggestions.filter((suggestion) => suggestion.autoEligible);

        if (settings.driverAutoSuppressSafeSuggestions && !settings.driverAutoSuppressionApplied) {
          const updated = await window.desktopApi.updateSettings({
            driverIgnoredInfNames: uniqueTrimmedStrings([
              ...settings.driverIgnoredInfNames,
              ...safeSuggestions.flatMap((suggestion) => suggestion.infNames)
            ]),
            driverIgnoredDeviceIds: uniqueTrimmedStrings([
              ...settings.driverIgnoredDeviceIds,
              ...safeSuggestions.flatMap((suggestion) => suggestion.deviceIds)
            ]),
            driverAutoSuppressionApplied: true
          });
          setSettings((current) => ({ ...current, ...updated }));
          if (safeSuggestions.length) {
            finalResult = await window.desktopApi.scanDrivers();
            autoAppliedCount = safeSuggestions.length;
          }
        }

        driversCacheRef.current = {
          at: Date.now(),
          key: driverCacheKey,
          value: finalResult
        };
        startTransition(() => {
          setDrivers(finalResult);
          setDriverOpenStates({});
          setDriverAiLookupStates({});
          setDriverAiLookups({});
        });
        const highCount = finalResult.updateCandidates.filter((item) => item.severity === "high").length;
        const suggestionCount = finalResult.suppressionSuggestions.length;
        if (autoAppliedCount > 0) {
          setStatus(
            `Drivers scanned. Auto-applied ${autoAppliedCount} high-confidence local suppression suggestion${autoAppliedCount === 1 ? "" : "s"} for this machine (${finalResult.updateCandidates.length} hints remain).`
          );
        } else if (!finalResult.updateCandidates.length && finalResult.stackSuppressedCount > 0) {
          setStatus(
            `Drivers scanned (${finalResult.meaningfulDeviceCount} meaningful devices reviewed, ${finalResult.stackSuppressedCount} candidates hidden by persistent stack preferences).`
          );
        } else if (!finalResult.updateCandidates.length && finalResult.meaningfulDeviceCount > 0) {
          setStatus(
            `Drivers scanned (${finalResult.meaningfulDeviceCount} meaningful devices reviewed, no high-confidence update hints after filtering inbox noise).`
          );
        } else {
          setStatus(
            `Drivers scanned (${finalResult.updateCandidates.length} update hints, ${highCount} high priority, ${finalResult.ignoredDeviceCount} filtered noise, ${finalResult.stackSuppressedCount} stack-hidden, ${suggestionCount} local suppression suggestion${suggestionCount === 1 ? "" : "s"}).`
          );
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Driver scan failed");
      } finally {
        setIsScanningDrivers(false);
        driversLoadPromiseRef.current = null;
      }
    })();
    return driversLoadPromiseRef.current;
  }, [
    settings.driverAutoSuppressionApplied,
    settings.driverAutoSuppressSafeSuggestions,
    settings.driverIgnoredDeviceIds,
    settings.driverIgnoredInfNames,
    settings.driverToolsEnabled
  ]);

  const enableDriverTools = useCallback(async () => {
    try {
      const updated = await window.desktopApi.updateSettings({ driverToolsEnabled: true });
      setSettings((current) => ({ ...defaultSettings, ...current, ...updated }));
      setStatus("Driver tools enabled");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not enable driver tools");
    }
  }, []);

  const openDriverLink = useCallback(async (candidateId: string) => {
    try {
      setDriverOpenStates((current) => ({ ...current, [candidateId]: "opening" }));
      const result = await window.desktopApi.openDriverOfficial(candidateId);
      setDriverOpenStates((current) => ({
        ...current,
        [candidateId]: result.opened ? "opened" : "failed"
      }));
      setStatus(result.opened ? "Opened official driver source." : "Could not open official driver source.");
    } catch (error) {
      setDriverOpenStates((current) => ({ ...current, [candidateId]: "failed" }));
      setStatus(error instanceof Error ? error.message : "Unable to open official driver source");
    }
  }, []);

  const lookupDriverOfficialWithAi = useCallback(async (candidateId: string) => {
    try {
      setDriverAiLookupStates((current) => ({ ...current, [candidateId]: "loading" }));
      const result = await window.desktopApi.lookupDriverOfficialWithAi(candidateId, true);
      setDriverAiLookups((current) => ({ ...current, [candidateId]: result.lookup }));
      setDriverAiLookupStates((current) => ({
        ...current,
        [candidateId]: result.opened ? "ready" : "failed"
      }));
      setStatus(
        result.opened
          ? `Opened AI-guided official driver search on ${result.lookup.officialDomain}.`
          : `Prepared AI-guided official search for ${result.lookup.officialDomain}, but the browser could not be opened.`
      );
    } catch (error) {
      setDriverAiLookupStates((current) => ({ ...current, [candidateId]: "failed" }));
      setStatus(error instanceof Error ? error.message : "Unable to prepare AI-guided official lookup");
    }
  }, []);

  const openWindowsUpdate = useCallback(async () => {
    try {
      const result = await window.desktopApi.openWindowsUpdate();
      setStatus(result.opened ? "Opened Windows Update." : "Could not open Windows Update.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open Windows Update");
    }
  }, []);

  const persistDriverSuppressionSettings = useCallback(
    async (
      nextInfNames: string[],
      nextDeviceIds: string[],
      successMessage: string,
      nextHiddenSuggestionIds: DriverSuppressionSuggestionId[] = settings.driverHiddenSuggestionIds
    ) => {
      const updated = await window.desktopApi.updateSettings({
        driverIgnoredInfNames: uniqueTrimmedStrings(nextInfNames),
        driverIgnoredDeviceIds: uniqueTrimmedStrings(nextDeviceIds),
        driverHiddenSuggestionIds: uniqueTrimmedStrings(nextHiddenSuggestionIds) as DriverSuppressionSuggestionId[]
      });
      setSettings((current) => ({ ...current, ...updated }));
      if (drivers) {
        const refreshed = await window.desktopApi.scanDrivers();
        setDrivers(refreshed);
        setDriverOpenStates({});
      }
      setStatus(successMessage);
    },
    [drivers, settings.driverHiddenSuggestionIds]
  );

  const suppressDriverInfName = useCallback(
    async (infName?: string) => {
      const safeInfName = String(infName ?? "").trim();
      if (!safeInfName) {
        setStatus("No INF is available for this driver candidate.");
        return;
      }
      await persistDriverSuppressionSettings(
        [...settings.driverIgnoredInfNames, safeInfName],
        settings.driverIgnoredDeviceIds,
        `Suppressed driver INF ${safeInfName} for future scans.`
      );
    },
    [persistDriverSuppressionSettings, settings.driverIgnoredDeviceIds, settings.driverIgnoredInfNames]
  );

  const suppressDriverDevice = useCallback(
    async (deviceId?: string, deviceName?: string) => {
      const safeDeviceId = String(deviceId ?? "").trim();
      if (!safeDeviceId) {
        setStatus("No stable device ID is available for this driver candidate.");
        return;
      }
      await persistDriverSuppressionSettings(
        settings.driverIgnoredInfNames,
        [...settings.driverIgnoredDeviceIds, safeDeviceId],
        `Suppressed driver device ${deviceName ?? safeDeviceId} for future scans.`
      );
    },
    [persistDriverSuppressionSettings, settings.driverIgnoredDeviceIds, settings.driverIgnoredInfNames]
  );

  const applyDriverSuppressionSuggestion = useCallback(
    async (suggestion: DriverSuppressionSuggestion) => {
      await persistDriverSuppressionSettings(
        [...settings.driverIgnoredInfNames, ...suggestion.infNames],
        [...settings.driverIgnoredDeviceIds, ...suggestion.deviceIds],
        `Applied driver suppression suggestion: ${suggestion.title}.`
      );
    },
    [persistDriverSuppressionSettings, settings.driverIgnoredDeviceIds, settings.driverIgnoredInfNames]
  );

  const applySafeDriverSuppressionSuggestions = useCallback(async () => {
    if (!visibleSafeDriverSuppressionSuggestions.length) {
      setStatus(
        driverSignalFilter === "all"
          ? "No high-confidence driver suppression suggestions are available."
          : `No high-confidence driver suppression suggestions match ${driverFeatureSignalLabel(driverSignalFilter)}.`
      );
      return;
    }

    const infNames = visibleSafeDriverSuppressionSuggestions.flatMap((suggestion) => suggestion.infNames);
    const deviceIds = visibleSafeDriverSuppressionSuggestions.flatMap((suggestion) => suggestion.deviceIds);
    await persistDriverSuppressionSettings(
      [...settings.driverIgnoredInfNames, ...infNames],
      [...settings.driverIgnoredDeviceIds, ...deviceIds],
      `Applied ${visibleSafeDriverSuppressionSuggestions.length} high-confidence driver suppression suggestion${visibleSafeDriverSuppressionSuggestions.length === 1 ? "" : "s"}${driverSignalFilter === "all" ? "" : ` for ${driverFeatureSignalLabel(driverSignalFilter)}`}.`
    );
  }, [
    persistDriverSuppressionSettings,
    driverSignalFilter,
    settings.driverIgnoredDeviceIds,
    settings.driverIgnoredInfNames,
    visibleSafeDriverSuppressionSuggestions
  ]);

  const applyReviewDriverSuppressionSuggestions = useCallback(async () => {
    if (!visibleInactiveReviewDriverSuppressionSuggestions.length) {
      setStatus(
        driverSignalFilter === "all"
          ? "No inactive virtualization or virtual-device suggestions are available for bulk suppression."
          : `No inactive virtualization or virtual-device suggestions match ${driverFeatureSignalLabel(driverSignalFilter)}.`
      );
      return;
    }

    const infNames = visibleInactiveReviewDriverSuppressionSuggestions.flatMap((suggestion) => suggestion.infNames);
    const deviceIds = visibleInactiveReviewDriverSuppressionSuggestions.flatMap((suggestion) => suggestion.deviceIds);
    await persistDriverSuppressionSettings(
      [...settings.driverIgnoredInfNames, ...infNames],
      [...settings.driverIgnoredDeviceIds, ...deviceIds],
      `Applied ${visibleInactiveReviewDriverSuppressionSuggestions.length} inactive virtualization or virtual-device suppression suggestion${visibleInactiveReviewDriverSuppressionSuggestions.length === 1 ? "" : "s"}${driverSignalFilter === "all" ? "" : ` for ${driverFeatureSignalLabel(driverSignalFilter)}`}.`
    );
  }, [
    driverSignalFilter,
    persistDriverSuppressionSettings,
    settings.driverIgnoredDeviceIds,
    settings.driverIgnoredInfNames,
    visibleInactiveReviewDriverSuppressionSuggestions
  ]);

  const hideDriverSuggestionStack = useCallback(
    async (suggestionId: DriverSuppressionSuggestionId, label?: string) => {
      await persistDriverSuppressionSettings(
        settings.driverIgnoredInfNames,
        settings.driverIgnoredDeviceIds,
        `Hidden ${label ?? driverStackSettingLabel(suggestionId)} driver stack for future scans.`,
        [...settings.driverHiddenSuggestionIds, suggestionId]
      );
    },
    [
      persistDriverSuppressionSettings,
      settings.driverHiddenSuggestionIds,
      settings.driverIgnoredDeviceIds,
      settings.driverIgnoredInfNames
    ]
  );

  const toggleDriverSignalEvidence = useCallback((suggestionId: DriverSuppressionSuggestionId, open: boolean) => {
    setOpenDriverSignalEvidenceIds((current) => {
      if (open) {
        return current.includes(suggestionId) ? current : [...current, suggestionId];
      }
      return current.filter((item) => item !== suggestionId);
    });
  }, []);

  const expandVisibleDriverSignalEvidence = useCallback(() => {
    if (!visibleDriverSignalEvidenceSuggestionIds.length) {
      return;
    }
    setOpenDriverSignalEvidenceIds((current) =>
      Array.from(new Set<DriverSuppressionSuggestionId>([...current, ...visibleDriverSignalEvidenceSuggestionIds]))
    );
  }, [visibleDriverSignalEvidenceSuggestionIds]);

  const collapseVisibleDriverSignalEvidence = useCallback(() => {
    if (!visibleDriverSignalEvidenceSuggestionIds.length) {
      return;
    }
    setOpenDriverSignalEvidenceIds((current) =>
      current.filter((item) => !visibleDriverSignalEvidenceSuggestionIds.includes(item))
    );
  }, [visibleDriverSignalEvidenceSuggestionIds]);

  const restoreOne = useCallback(
    async (itemId: string) => {
      const result = await window.desktopApi.restoreQuarantine([itemId]);
      await loadQuarantine();
      setCleanupResult(null);
      setStatus(`Restore done (${result.restoredCount} restored, ${result.failed.length} failed)`);
    },
    [loadQuarantine]
  );

  const purgeQuarantine = useCallback(async (olderThanDays: number, label: string) => {
    setShowQuarantinePurgeOverlay(true);
    setQuarantinePurgeProgress(null);
    setQuarantinePurgeLogs([]);
    setIsPurgingQuarantine(true);
    try {
      const result = await window.desktopApi.purgeQuarantine(olderThanDays);
      await loadQuarantine();
      if (result.canceled) {
        setStatus(
          `${label}: canceled after ${result.purgedGroups} vault group(s), ${result.purgedCount} item(s) purged (${formatBytes(result.freedBytes)}).`
        );
      } else {
        setStatus(
          `${label}: purged ${result.purgedCount} item(s) in ${result.purgedGroups} vault group(s) (${formatBytes(result.freedBytes)}) using ${result.storageHint.toUpperCase()} x${result.concurrency} in ${(result.durationMs / 1000).toFixed(1)}s.`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quarantine purge failed.";
      setStatus(message);
      setQuarantinePurgeLogs((current) => [...current.slice(-399), `[${new Date().toLocaleTimeString()}] [purge] ${message}`]);
      setQuarantinePurgeProgress({
        stage: "failed",
        totalGroups: 0,
        completedGroups: 0,
        totalItems: 0,
        purgedItems: 0,
        totalBytes: 0,
        purgedBytes: 0,
        percent: 100,
        storageHint: "unknown",
        concurrency: 0,
        message,
        logLine: `[purge] ${message}`,
        timestamp: Date.now()
      });
    } finally {
      setIsPurgingQuarantine(false);
    }
  }, [formatBytes, loadQuarantine]);

  const cancelQuarantinePurge = useCallback(async () => {
    if (!isPurgingQuarantine) {
      return;
    }
    const response = await window.desktopApi.cancelQuarantinePurge();
    if (response.ok) {
      setStatus("Quarantine purge cancellation requested.");
      return;
    }
    setStatus("No active quarantine purge to cancel.");
  }, [isPurgingQuarantine]);

  const {
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
  } = useSettingsController({
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
    defaultProtectionProfileName: DEFAULT_PROTECTION_PROFILE_NAME
  });

  const exportSafetyReport = useCallback(() => {
    if (!filteredProtectedRejected.length) {
      setStatus("No protected rejections to export.");
      return;
    }

    const header = ["Category", "Protection", "Matched App", "Reason", "Path"];
    const rows = filteredProtectedRejected.map((item) => [
      categoryLabelByValue[item.category],
      protectionKindLabel(item.protectionKind),
      item.matchedAppName ?? "",
      item.reason,
      item.path
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cleanup-pilot-safety-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${filteredProtectedRejected.length} protected rejections.`);
  }, [filteredProtectedRejected]);

  const scanProgressClass =
    scanProgress.stage === "completed"
      ? "is-complete"
      : scanProgress.stage === "failed"
        ? "is-danger"
        : scanProgress.stage === "canceled"
          ? "is-warning"
          : "";

  const hasMoreFindings = visibleFindings.length < sortedFilteredFindings.length;
  const hasMoreDuplicateGroups = visibleDuplicateGroups.length < duplicateGroups.length;
  const hasMoreQuarantineItems = quarantineHasMore;
  const canLoadResults = Boolean(activeRunId) && !isLoadingScanResults;
  const canPreviewFromQuick = Boolean(activeRunId) && selectedFindingSet.size > 0 && !isPreviewingCleanup;
  const canExecuteFromQuick = Boolean(activeRunId) && selectedFindingSet.size > 0 && !isExecutingCleanup;
  const canRunAiQuick = !isAnalyzingAi;
  const cleanupProgressPercent = cleanupProgress ? Math.min(100, Math.max(0, cleanupProgress.percent)) : 0;
  const cleanupCanCloseOverlay =
    !isExecutingCleanup &&
    (!!cleanupProgress && (cleanupProgress.stage === "completed" || cleanupProgress.stage === "failed"));
  const quarantinePurgeProgressPercent = quarantinePurgeProgress
    ? Math.min(100, Math.max(0, quarantinePurgeProgress.percent))
    : 0;
  const quarantinePurgeCanCloseOverlay =
    !isPurgingQuarantine &&
    (!!quarantinePurgeProgress &&
      (quarantinePurgeProgress.stage === "completed" ||
        quarantinePurgeProgress.stage === "failed" ||
        quarantinePurgeProgress.stage === "canceled"));

  useEffect(() => {
    try {
      window.localStorage.setItem(VISUAL_DENSITY_STORAGE_KEY, visualDensity);
    } catch {
      // Ignore localStorage write errors.
    }
  }, [visualDensity]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isEditable) {
        return;
      }

      if (event.ctrlKey && !event.shiftKey && !event.altKey) {
        if (event.key >= "1" && event.key <= "9") {
          const index = Number(event.key) - 1;
          const nextTab = tabs[index];
          if (nextTab) {
            event.preventDefault();
            setTab(nextTab);
            setStatus(`Switched to ${tabLabel[nextTab]}.`);
            return;
          }
        }

        if (event.key.toLowerCase() === "0") {
          event.preventDefault();
          setTab("settings");
          setStatus("Switched to Settings.");
          return;
        }

        if (event.key.toLowerCase() === "r") {
          event.preventDefault();
          if (tab === "quarantine") {
            void loadQuarantine();
            setStatus("Refreshing quarantine...");
            return;
          }
          if (tab === "drivers") {
            void loadDrivers();
            return;
          }
          if (tab === "scan" && activeRunId) {
            void loadScanResults();
            return;
          }
        }

        if (event.key.toLowerCase() === "s" && tab === "settings") {
          event.preventDefault();
          void saveSettings();
          return;
        }
      }

      if (event.key === "Escape") {
        if (showCleanupOverlay && cleanupCanCloseOverlay) {
          event.preventDefault();
          setShowCleanupOverlay(false);
          return;
        }
        if (showQuarantinePurgeOverlay && quarantinePurgeCanCloseOverlay) {
          event.preventDefault();
          setShowQuarantinePurgeOverlay(false);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeRunId,
    cleanupCanCloseOverlay,
    loadDrivers,
    loadQuarantine,
    loadScanResults,
    quarantinePurgeCanCloseOverlay,
    saveSettings,
    showCleanupOverlay,
    showQuarantinePurgeOverlay,
    tab
  ]);

  const commandPaletteCommands = useMemo(
    () => [
      ...tabs.map((entry) => ({
        id: `tab:${entry}`,
        title: `Open ${tabLabel[entry]}`,
        section: "Navigate",
        keywords: `${entry} ${tabLabel[entry]} ${workspaceHeadline[entry]}`.toLowerCase(),
        run: () => setTab(entry)
      })),
      {
        id: "action:start-scan",
        title: "Start whole-machine scan",
        section: "Actions",
        keywords: "scan start cleanup whole machine",
        run: () => void startScan()
      },
      {
        id: "action:preview-cleanup",
        title: "Preview cleanup plan",
        section: "Actions",
        keywords: "preview cleanup selected findings",
        run: () => void previewCleanup()
      },
      {
        id: "action:execute-cleanup",
        title: "Execute quarantine cleanup",
        section: "Actions",
        keywords: "execute cleanup quarantine",
        run: () => void executeCleanup()
      },
      {
        id: "action:refresh-storage",
        title: "Refresh full-disk storage map",
        section: "Actions",
        keywords: "overview storage map refresh disk",
        run: () => void loadStorage({ force: true })
      },
      {
        id: "action:run-ai",
        title: "Run AI analysis",
        section: "Actions",
        keywords: "ai advisor analysis fast pass",
        run: () => void runAiAnalysis()
      },
      {
        id: "action:run-duplicates",
        title: "Run duplicate scan",
        section: "Actions",
        keywords: "duplicate dedupe scan",
        run: () => void runDuplicateScan()
      },
      {
        id: "action:scan-drivers",
        title: "Scan drivers",
        section: "Actions",
        keywords: "drivers scan diagnostics",
        run: () => void loadDrivers()
      },
      {
        id: "action:refresh-quarantine",
        title: "Refresh quarantine",
        section: "Actions",
        keywords: "quarantine vault refresh",
        run: () => void loadQuarantine()
      }
    ],
    [executeCleanup, loadDrivers, loadQuarantine, loadStorage, previewCleanup, runAiAnalysis, runDuplicateScan, startScan]
  );
  const filteredCommandPaletteCommands = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase();
    const base = query
      ? commandPaletteCommands.filter(
          (item) => item.title.toLowerCase().includes(query) || item.keywords.includes(query)
        )
      : [
          ...recentCommandIds
            .map((id) => commandPaletteCommands.find((item) => item.id === id))
            .filter((item): item is (typeof commandPaletteCommands)[number] => Boolean(item)),
          ...commandPaletteCommands.filter((item) => !recentCommandIds.includes(item.id))
        ];
    return base.slice(0, 14);
  }, [commandPaletteCommands, commandPaletteQuery, recentCommandIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COMMAND_PALETTE_RECENTS_KEY, JSON.stringify(recentCommandIds.slice(0, 8)));
    } catch {
      // Ignore local storage write issues.
    }
  }, [recentCommandIds]);

  useEffect(() => {
    if (!commandPaletteOpen) {
      return;
    }
    setCommandPaletteCursor(0);
  }, [commandPaletteOpen, commandPaletteQuery]);

  useEffect(() => {
    const onCommandPaletteKeys = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        return;
      }
      if (!commandPaletteOpen) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandPaletteOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandPaletteCursor((current) => Math.min(filteredCommandPaletteCommands.length - 1, current + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandPaletteCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === "Enter") {
        const activeCommand = filteredCommandPaletteCommands[commandPaletteCursor];
        if (!activeCommand) {
          return;
        }
        event.preventDefault();
        activeCommand.run();
        setRecentCommandIds((current) => [activeCommand.id, ...current.filter((item) => item !== activeCommand.id)].slice(0, 8));
        setCommandPaletteOpen(false);
        setCommandPaletteQuery("");
      }
    };

    window.addEventListener("keydown", onCommandPaletteKeys);
    return () => window.removeEventListener("keydown", onCommandPaletteKeys);
  }, [commandPaletteCommands, commandPaletteCursor, commandPaletteOpen, filteredCommandPaletteCommands]);

  return (
    <div
      className={`app-shell density-${visualDensity} ${settings.highContrast ? "theme-contrast" : ""} ${settings.reducedMotion ? "reduce-motion" : ""} ${
        settings.compactUi ? "compact-ui" : ""
      }`}
    >
      <div className="app-ambient" />

      <header className="masthead masthead--slim">
        <div className="masthead-brand">
          <div className="brand-mark">CP</div>
          <div className="masthead-copy">
            <span className="eyebrow">Cleanup Pilot</span>
            <h1>Local Windows maintenance</h1>
            <p className="muted">Simple first. Reversible actions. Full-machine scope.</p>
          </div>
        </div>

        <div className="masthead-status-pill masthead-status-pill--simple">
          <small>Status</small>
          <strong>{status}</strong>
          <div className="masthead-inline-metrics">
            <span>{metrics.findings} findings</span>
            <span>{metrics.selected ? `${metrics.selected} selected` : "No selection"}</span>
            <span>{metrics.quarantineCount} in vault</span>
          </div>
        </div>
      </header>

      <section className="routebar routebar--slim">
        <nav className="routebar-scroll" aria-label="Product areas">
          {sections.map((entry) => (
            <button
              key={entry}
              className={currentSection === entry ? "route-chip active" : "route-chip"}
              onClick={() => setTab(sectionDefaultTab[entry])}
              type="button"
            >
              <span className="route-chip-glyph">{entry === "home" ? "HM" : entry === "cleaner" ? "CL" : entry === "optimize" ? "OP" : "VT"}</span>
              <span>{sectionLabel[entry]}</span>
            </button>
          ))}
        </nav>
        <div className="product-secondary-switcher" role="group" aria-label={`${sectionLabel[currentSection]} tools`}>
          {sectionSecondaryTabs[currentSection].map((entry) => (
            <button
              key={`secondary:${entry}`}
              className={tab === entry ? "routebar-secondary-link active" : "routebar-secondary-link"}
              onClick={() => setTab(entry)}
              type="button"
            >
              {tabLabel[entry]}
            </button>
          ))}
        </div>

        <div className="routebar-utility routebar-utility--stacked">
          <button className="routebar-quick-action" type="button" onClick={() => setCommandPaletteOpen(true)}>
            Commands
          </button>
          <details className="routebar-drawer">
            <summary>
              <span>{workspaceModeLabel}</span>
              <small>{settings.scheduleEnabled ? "Weekly schedule" : "Manual mode"}</small>
            </summary>
            <div className="routebar-drawer-body">
              <div className="routebar-utility-block">
                <small>Schedule</small>
                <strong>{settings.scheduleEnabled ? `${dayLabel[settings.scheduleDayOfWeek]} ${settings.scheduleTime}` : "Manual mode"}</strong>
                <span>{settings.scheduleEnabled ? `Next ${formatDate(scheduler.nextRunAt)}` : "No weekly automation configured"}</span>
              </div>
              <div className="routebar-density-switch" role="group" aria-label="Visual density">
                {(["comfortable", "compact", "power"] as VisualDensity[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={visualDensity === mode ? "density-chip active" : "density-chip"}
                    onClick={() => setVisualDensity(mode)}
                  >
                    {mode === "comfortable" ? "Comfort" : mode === "compact" ? "Compact" : "Power"}
                  </button>
                ))}
              </div>
            </div>
          </details>
        </div>
      </section>

      <main className="content-shell">
        <section className="workspace-banner workspace-banner--simple workspace-banner--slim">
          <div className="workspace-copy workspace-copy--slim">
            <span className="eyebrow">{sectionHeadline[currentSection]}</span>
            <h2>{sectionLabel[currentSection]}</h2>
            <p className="muted workspace-copy-compact">{sectionSummary.summary}</p>
          </div>
          <div className="workspace-inline-metrics">
            <span className="workspace-meta-pill workspace-meta-pill--label">{sectionSummary.label}</span>
            {sectionSummary.pills.map((pill, index) => (
              <span key={`${currentSection}:${index}:${pill}`} className="workspace-meta-pill">
                {pill}
              </span>
            ))}
          </div>
        </section>

        {currentSection === "home" && (
          <HomePage
            formatBytes={formatBytes}
            onOpenCleaner={() => setTab("scan")}
            onOpenOptimize={() => setTab("performance")}
            onOpenVault={() => setTab("quarantine")}
          />
        )}

        {currentSection === "cleaner" && (
          <CleanerPage
            activeView={tab}
            onChangeView={(view) => setTab(view as TabKey)}
            findingsCount={findings.length}
            selectedFindingCount={selectedFindingSet.size}
            selectedBytesLabel={formatBytes(metrics.selectedBytes)}
            blockedCount={scanSummary.protectedRejectedCount}
            scheduleLabel={settings.scheduleEnabled ? `Auto-clean ${dayLabel[settings.scheduleDayOfWeek]}` : "Manual only"}
          >
            {tab === "overview" && (
              <OverviewTab
                storageInsights={storageInsights}
                storageHistory={storageHistory}
                storageDiff={storageDiff}
                storageLoading={storageLoading}
                onLoadStorage={() => void loadStorage({ force: true })}
                formatBytes={formatBytes}
                shortPath={shortPath}
              />
            )}
            {tab === "scan" && (
              <ScanTab
                activeRunId={activeRunId}
                isLoadingScanResults={isLoadingScanResults}
                pendingAiAction={pendingAiAction}
                scanProgress={scanProgress}
                scanProgressClass={scanProgressClass}
                quickActionsHint={quickActionsHint}
                findings={findings}
                scanSummary={scanSummary}
                scanPreset={scanPreset}
                scanCategories={scanCategories}
                machineRoots={machineRoots}
                machineScopeLabel={machineScopeLabel}
                selectedFindingCount={selectedFindingSet.size}
                selectedBytes={metrics.selectedBytes}
                protectedRejectedCount={protectedRejected.length}
                scanResultsByCategory={scanResultsByCategory}
                scanResultsByType={scanResultsByType}
                scanResultsByLocation={scanResultsByLocation}
                scanTopFindings={scanTopFindings}
                presetLabel={presetLabel}
                categoryOptions={categoryOptions}
                onStartScan={() => void startScan()}
                onCancelScan={() => void cancelScan()}
                onClearAiFocus={() => void clearAiFocus()}
                onSetScanPreset={setScanPreset}
                onOpenCleanupPlan={() => setTab("cleanup")}
                onOpenSafety={() => setTab("safety")}
                formatBytes={formatBytes}
                shortPath={shortPath}
                categoryClass={categoryClass}
                formatEta={formatEta}
              />
            )}
            {tab === "cleanup" && (
              <CleanupTab
                findings={findings}
                visibleFindings={visibleFindings}
                sortedFilteredFindings={sortedFilteredFindings}
                selectedFindingSet={selectedFindingSet}
                aiSuggestedFindingSet={aiSuggestedFindingSet}
                recommendedFindingSet={recommendedFindingSet}
                cleanupPreview={cleanupPreview}
                cleanupResult={cleanupResult}
                cleanupPreviewSourceFindings={cleanupPreviewSourceFindings}
                cleanupGroupedPreview={cleanupGroupedPreview}
                cleanupCategoryCollections={cleanupCategoryCollections}
                cleanupFilterCounts={cleanupFilterCounts}
                cleanupQuickFilter={cleanupQuickFilter}
                cleanupGroupBy={cleanupGroupBy}
                cleanupSortBy={cleanupSortBy}
                cleanupPreviewScope={cleanupPreviewScope}
                findingsQuery={findingsQuery}
                pendingAiAction={pendingAiAction}
                selectedBytes={metrics.selectedBytes}
                hasMoreFindings={hasMoreFindings}
                isPreviewingCleanup={isPreviewingCleanup}
                isExecutingCleanup={isExecutingCleanup}
                onSelectAiSuggestedFindings={() => selectAiSuggestedFindings()}
                onSelectRecommendedFindings={selectRecommendedFindings}
                onSelectVisibleFindings={selectVisibleFindings}
                onClearSelection={clearSelection}
                onPreviewCleanup={() => void previewCleanup()}
                onExecuteCleanup={() => void executeCleanup()}
                onClearAiFocus={() => void clearAiFocus()}
                onSetFindingsQuery={setFindingsQuery}
                onSetCleanupSortBy={setCleanupSortBy}
                onSetCleanupQuickFilter={setCleanupQuickFilter}
                onSetCleanupGroupBy={setCleanupGroupBy}
                onSetCleanupPreviewScope={setCleanupPreviewScope}
                onToggleFinding={toggleFinding}
                onApplyFindingSelection={applyFindingSelection}
                onAddFindingPathToAllowlist={(value) => {
                  addFindingPathToAllowlist(value);
                }}
                onShowMoreFindings={() => setFindingsRenderLimit((current) => current + FINDINGS_PAGE_SIZE)}
                formatBytes={formatBytes}
                shortPath={shortPath}
                categoryClass={categoryClass}
                toneClass={toneClass}
                categoryLabelByValue={categoryLabelByValue}
              />
            )}
            {tab === "safety" && (
              <SafetyTab
                findingsCount={findings.length}
                protectedRejected={protectedRejected}
                filteredProtectedRejected={filteredProtectedRejected}
                scanSummary={scanSummary}
                safetyProtectionFilter={safetyProtectionFilter}
                safetyQuery={safetyQuery}
                safetyCountsByKind={safetyCountsByKind}
                onBackToScan={() => setTab("scan")}
                onOpenCleanupPlan={() => setTab("cleanup")}
                onExportSafetyReport={exportSafetyReport}
                onSetSafetyQuery={setSafetyQuery}
                onSetSafetyProtectionFilter={setSafetyProtectionFilter}
                onAddRejectedPathToAllowlist={(value) => addRejectedPathToAllowlist(value)}
                onAddRejectedAppToAllowlist={(value) => addRejectedAppToAllowlist(value)}
                categoryClass={categoryClass}
                categoryLabelByValue={categoryLabelByValue}
                protectionKindLabel={protectionKindLabel}
                shortPath={shortPath}
              />
            )}
            {tab === "ai" && (
              <AITab
                settings={settings}
                setSettings={setSettings}
                aiSelectedModel={aiSelectedModel}
                setAiSelectedModel={setAiSelectedModel}
                aiMaxFiles={aiMaxFiles}
                setAiMaxFiles={setAiMaxFiles}
                aiAnalysisMode={aiAnalysisMode}
                setAiAnalysisMode={setAiAnalysisMode}
                isLoadingAiModels={isLoadingAiModels}
                isAnalyzingAi={isAnalyzingAi}
                aiModels={aiModels}
                aiAnalysis={aiAnalysis}
                smartAiCollections={smartAiCollections}
                aiCollections={aiCollections}
                activeAiCollection={activeAiCollection}
                activeCollectionActions={activeCollectionActions}
                collectionDuplicateActions={collectionDuplicateActions}
                activeCollectionActionIds={activeCollectionActionIds}
                aiCollectionNameInput={aiCollectionNameInput}
                setAiCollectionNameInput={setAiCollectionNameInput}
                aiCollectionEstimatedBytes={aiCollectionEstimatedBytes}
                aiCandidates={aiCandidates}
                machineRoots={machineRoots}
                machineScopeLabel={machineScopeLabel}
                onLoadAiModels={() => void loadAiModels()}
                onRunAiAnalysis={() => void runAiAnalysis()}
                onSetActiveAiCollectionId={setActiveAiCollectionId}
                onCreateCollectionFromSuggestion={createCollectionFromSuggestion}
                onMergeSuggestionIntoActiveCollection={mergeSuggestionIntoActiveCollection}
                onApplyBestSafeWins={(suggestion, mode) => applyBestSafeWins(suggestion, mode)}
                onApplySmartAiCollection={(suggestion, mode) => applySmartAiCollection(suggestion, mode)}
                onApplyAiAction={(action, mode) => void applyAiAction(action, mode)}
                onCreateAiCollection={() => createAiCollection()}
                onSaveActiveAiCollectionName={() => void saveActiveAiCollectionName()}
                onDeleteActiveAiCollection={() => deleteActiveAiCollection()}
                onApplyAiCollection={(mode) => void applyAiCollection(mode)}
                onOpenAiCollectionDuplicates={() => void openAiCollectionDuplicates()}
                onClearActiveAiCollection={() => clearActiveAiCollection()}
                onToggleAiCollectionAction={toggleAiCollectionAction}
                onAddAiActionToAllowlist={addAiActionToAllowlist}
                onAddAiPathToAllowlist={addFindingPathToAllowlist}
                onAddAiAppToAllowlist={addRejectedAppToAllowlist}
                shortPath={shortPath}
                formatBytes={formatBytes}
                formatDate={(value) => formatDate(value ?? undefined)}
                modelSelectionValue={modelSelectionValue}
                modelOptionLabel={modelOptionLabel}
                collectionActionSummary={collectionActionSummary}
                appDataConfidenceClass={appDataConfidenceClass}
                appDataDispositionClass={appDataDispositionClass}
                aiProviderLabel={aiProviderLabel}
                aiActionKindLabel={aiActionKindLabel}
                toneClass={toneClass}
              />
            )}
            {tab === "duplicates" && (
              <DuplicatesTab
                duplicateGroups={duplicateGroups}
                visibleDuplicateGroups={visibleDuplicateGroups}
                duplicateSelections={duplicateSelections}
                duplicatePreview={duplicatePreview}
                duplicateResult={duplicateResult}
                duplicateMinSizeMb={duplicateMinSizeMb}
                machineRoots={machineRoots}
                machineScopeLabel={machineScopeLabel}
                hasMoreDuplicateGroups={hasMoreDuplicateGroups}
                onDuplicateMinSizeMbChange={setDuplicateMinSizeMb}
                onRunDuplicateScan={() => void runDuplicateScan()}
                onPreviewDuplicateResolution={() => void previewDuplicateResolution()}
                onExecuteDuplicateResolution={() => void executeDuplicateResolution()}
                onUpdateDuplicateKeep={updateDuplicateKeep}
                onShowMoreDuplicateGroups={() => setDuplicateRenderLimit((current) => current + DUP_GROUPS_PAGE_SIZE)}
                formatBytes={formatBytes}
                shortPath={shortPath}
              />
            )}
          </CleanerPage>
        )}

        {currentSection === "optimize" && (
          <OptimizePage
            activeView={
              tab === "drivers"
                ? "drivers"
                : activePerformanceView === "startup"
                  ? "startup"
                  : activePerformanceView === "services" || activePerformanceView === "tasks"
                    ? "background"
                    : "performance"
            }
            onChangeView={(view) => {
              if (view === "drivers") {
                setTab("drivers");
                return;
              }
              setTab("performance");
              if (view === "startup") {
                setActivePerformanceView("startup");
                return;
              }
              if (view === "background") {
                setActivePerformanceView("services");
                return;
              }
              setActivePerformanceView("dashboard");
            }}
            bottleneckLabel={
              latestPerformanceSnapshot?.bottleneck.primary
                ? latestPerformanceSnapshot.bottleneck.primary.replace(/_/g, " ")
                : "Snapshot pending"
            }
            startupImpactLabel={
              latestPerformanceSnapshot ? `${latestPerformanceSnapshot.startup.impactScore}/100` : "Snapshot pending"
            }
            driverRiskLabel={driverPerformanceSummary ? driverPerformanceSummary.latencyRisk : "Not scanned"}
            onRunOneClickFocus={() => {
              setTab("performance");
              if ((latestPerformanceSnapshot?.startup.impactScore ?? 0) >= 55) {
                setActivePerformanceView("startup");
                return;
              }
              if (latestPerformanceSnapshot?.bottleneck.primary === "drivers") {
                setTab("drivers");
                return;
              }
              setActivePerformanceView("dashboard");
            }}
          >
            {tab === "drivers" && (
              <DriversTab
                settingsDriverToolsEnabled={settings.driverToolsEnabled}
                isScanningDrivers={isScanningDrivers}
                drivers={drivers}
                driverSeverityCounts={driverSeverityCounts}
                driverClassCounts={driverClassCounts}
                visibleInactiveReviewDriverSuppressionSuggestions={visibleInactiveReviewDriverSuppressionSuggestions}
                visibleSafeDriverSuppressionSuggestions={visibleSafeDriverSuppressionSuggestions}
                visibleDriverSignalEvidenceSuggestionIds={visibleDriverSignalEvidenceSuggestionIds}
                visibleDriverSignalEvidenceOpenCount={visibleDriverSignalEvidenceOpenCount}
                visibleDriverSuppressionSuggestions={visibleDriverSuppressionSuggestions}
                driverSuppressionSignalCounts={driverSuppressionSignalCounts}
                driverSignalFilter={driverSignalFilter}
                filteredDriverCandidates={filteredDriverCandidates}
                driverQuery={driverQuery}
                driverFilter={driverFilter}
                driverOpenStates={driverOpenStates}
                driverAiLookupStates={driverAiLookupStates}
                driverAiLookups={driverAiLookups}
                hiddenDriverStackLabels={hiddenDriverStackLabels}
                settingsDriverIgnoredInfNamesLength={settings.driverIgnoredInfNames.length}
                settingsDriverIgnoredDeviceIdsLength={settings.driverIgnoredDeviceIds.length}
                settingsDriverHiddenSuggestionIdsLength={settings.driverHiddenSuggestionIds.length}
                settingsDriverAutoSuppressSafeSuggestions={settings.driverAutoSuppressSafeSuggestions}
                settingsDriverAutoSuppressionApplied={settings.driverAutoSuppressionApplied}
                openDriverSignalEvidenceIds={openDriverSignalEvidenceIds}
                onLoadDrivers={() => void loadDrivers()}
                onOpenWindowsUpdate={() => void openWindowsUpdate()}
                onEnableDriverTools={() => void enableDriverTools()}
                onApplySafeDriverSuppressionSuggestions={() => void applySafeDriverSuppressionSuggestions()}
                onApplyReviewDriverSuppressionSuggestions={() => void applyReviewDriverSuppressionSuggestions()}
                onExpandVisibleDriverSignalEvidence={expandVisibleDriverSignalEvidence}
                onCollapseVisibleDriverSignalEvidence={collapseVisibleDriverSignalEvidence}
                onSetDriverSignalFilter={setDriverSignalFilter}
                onToggleDriverSignalEvidence={toggleDriverSignalEvidence}
                onApplyDriverSuppressionSuggestion={(suggestion) => void applyDriverSuppressionSuggestion(suggestion)}
                onHideDriverSuggestionStack={(suggestionId, title) => void hideDriverSuggestionStack(suggestionId, title)}
                onSetDriverQuery={setDriverQuery}
                onSetDriverFilter={setDriverFilter}
                onOpenDriverLink={(candidateId) => void openDriverLink(candidateId)}
                onLookupDriverWithAi={(candidateId) => void lookupDriverOfficialWithAi(candidateId)}
                onSuppressDriverInfName={(infName) => void suppressDriverInfName(infName)}
                onSuppressDriverDevice={(deviceId, deviceName) => void suppressDriverDevice(deviceId, deviceName)}
                driverSuppressionConfidenceClass={driverSuppressionConfidenceClass}
                driverSuppressionGroupLabel={driverSuppressionGroupLabel}
                driverActivityClass={driverActivityClass}
                driverActivityLabel={driverActivityLabel}
                driverSuppressionRuleSummary={driverSuppressionRuleSummary}
                driverFeatureSignalClass={driverFeatureSignalClass}
                driverFeatureSignalLabel={driverFeatureSignalLabel}
                driverClassLabel={driverClassLabel}
                driverSeverityClass={driverSeverityClass}
                formatDays={formatDays}
              />
            )}
            {tab !== "drivers" && (
              <PerformanceTab
                sampleIntervalMs={settings.performanceLiveSampleIntervalMs}
                pinnedMonitoring={settings.performancePinnedMonitoring}
                onStatusChange={setStatus}
              />
            )}
          </OptimizePage>
        )}

        {currentSection === "vault" && (
          <VaultPage
            activeView={tab}
            onChangeView={(view) => setTab((view === "settings" ? "settings" : "quarantine") as TabKey)}
            activeQuarantineCount={quarantineActiveCount}
            totalRecords={quarantineTotalCount}
            retentionLabel={`${settings.quarantineRetentionDays} days`}
            latestReportLabel={
              latestPerformanceSnapshot
                ? `Latest snapshot ${latestPerformanceSnapshot.source.replace(/_/g, " ")}`
                : "No recent report"
            }
          >
            {tab === "settings" && (
              <SettingsTab
                settings={settings}
                setSettings={setSettings}
                scheduler={scheduler}
                updates={updates}
                dayLabel={dayLabel}
                presetLabel={presetLabel}
                driverStackOptions={DRIVER_STACK_OPTIONS}
                hiddenDriverStackLabels={hiddenDriverStackLabels}
                allowlistImportInputRef={allowlistImportInputRef}
                protectionProfileImportInputRef={protectionProfileImportInputRef}
                protectionDiffImportInputRef={protectionDiffImportInputRef}
                protectionProfiles={protectionProfiles}
                activeProtectionProfile={activeProtectionProfile}
                compareProtectionProfile={compareProtectionProfile}
                protectionProfileNameInput={protectionProfileNameInput}
                setProtectionProfileNameInput={setProtectionProfileNameInput}
                protectionProfileComparison={protectionProfileComparison}
                promoteComparisonDiff={promoteComparisonDiff}
                selectedPromotionPaths={selectedPromotionPaths}
                selectedPromotionApps={selectedPromotionApps}
                selectedPromotionPathSet={selectedPromotionPathSet}
                selectedPromotionAppSet={selectedPromotionAppSet}
                defaultProtectionProfileName={DEFAULT_PROTECTION_PROFILE_NAME}
                currentSettingsCompareId={CURRENT_SETTINGS_COMPARE_ID}
                onSaveSettings={() => void saveSettings()}
                onSaveScheduler={() => void saveScheduler()}
                onCheckUpdates={() => void checkUpdates()}
                onExportAllowlistProfile={exportAllowlistProfile}
                onTriggerAllowlistImport={triggerAllowlistImport}
                onImportAllowlistProfile={importAllowlistProfile}
                onSaveCurrentAsProtectionProfile={() => saveCurrentAsProtectionProfile()}
                onRenameActiveProtectionProfile={() => renameActiveProtectionProfile()}
                onUpdateActiveProtectionProfileFromSettings={() => updateActiveProtectionProfileFromSettings()}
                onApplyActiveProtectionProfileToSettings={(mode: "replace" | "merge") => applyActiveProtectionProfileToSettings(mode)}
                onPromoteComparisonDiffToCurrent={() => promoteComparisonDiffToCurrent()}
                onExportProtectionProfileDiff={exportProtectionProfileDiff}
                onExportActiveProtectionProfile={() => exportActiveProtectionProfile()}
                onExportAllProtectionProfiles={() => exportAllProtectionProfiles()}
                onTriggerProtectionProfileImport={triggerProtectionProfileImport}
                onTriggerProtectionDiffImport={triggerProtectionDiffImport}
                onImportProtectionProfiles={importProtectionProfiles}
                onImportProtectionDiffPatch={importProtectionDiffPatch}
                onDeleteActiveProtectionProfile={() => deleteActiveProtectionProfile()}
                onSetActiveProtectionProfileId={setActiveProtectionProfileId}
                onSetCompareProtectionProfileId={setCompareProtectionProfileId}
                onSelectAllPromotionEntries={selectAllPromotionEntries}
                onClearPromotionEntries={clearPromotionEntries}
                onTogglePromotionEntry={togglePromotionEntry}
              />
            )}
            {tab !== "settings" && (
              <QuarantineTab
                visibleQuarantineItems={visibleQuarantineItems}
                quarantineActiveCount={quarantineActiveCount}
                quarantineTotalCount={quarantineTotalCount}
                quarantineRetentionDays={settings.quarantineRetentionDays}
                hasMoreQuarantineItems={hasMoreQuarantineItems}
                isLoadingQuarantine={isLoadingQuarantine}
                isPurgingQuarantine={isPurgingQuarantine}
                quarantinePurgeProgress={quarantinePurgeProgress}
                onRefreshQuarantine={() => void loadQuarantine()}
                onPurgeQuarantine={() => void purgeQuarantine(settings.quarantineRetentionDays, `Purge older than ${settings.quarantineRetentionDays}d`)}
                onPurgeAllQuarantine={() => {
                  if (!window.confirm("Permanently purge all active quarantined items? This cannot be undone.")) {
                    return;
                  }
                  void purgeQuarantine(0, "Full quarantine purge");
                }}
                onCancelPurge={() => void cancelQuarantinePurge()}
                onRestoreOne={(itemId) => void restoreOne(itemId)}
                onShowMoreQuarantineItems={() => void loadQuarantine({ append: true })}
                formatBytes={formatBytes}
                formatDate={formatDate}
                shortPath={shortPath}
              />
            )}
          </VaultPage>
        )}
      </main>

      {showScrollTop && (
        <button
          className="scroll-top-btn"
          onClick={() => {
            const behavior: ScrollBehavior = settings.reducedMotion ? "auto" : "smooth";
            window.scrollTo({ top: 0, behavior });
          }}
          aria-label="Back to top"
        >
          Top
        </button>
      )}

      {commandPaletteOpen && (
        <section className="execution-overlay" role="dialog" aria-modal="true" aria-label="Command palette">
          <article className="execution-modal command-palette-modal">
            <header className="panel-header compact">
              <div>
                <small className="section-kicker">Command Palette</small>
                <h2>Jump and act faster</h2>
              </div>
              <button className="btn secondary tiny" onClick={() => setCommandPaletteOpen(false)}>
                Close
              </button>
            </header>
            <label>
              Search commands
              <input
                autoFocus
                value={commandPaletteQuery}
                onChange={(event) => setCommandPaletteQuery(event.target.value)}
                placeholder="open drivers, start scan, preview cleanup..."
              />
            </label>
            <div className="command-palette-list">
              {filteredCommandPaletteCommands.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  className={index === commandPaletteCursor ? "command-palette-item is-active" : "command-palette-item"}
                  onClick={() => {
                    command.run();
                    setRecentCommandIds((current) => [command.id, ...current.filter((item) => item !== command.id)].slice(0, 8));
                    setCommandPaletteOpen(false);
                    setCommandPaletteQuery("");
                  }}
                >
                  <strong>{command.title}</strong>
                  <span className="muted">{command.section}</span>
                </button>
              ))}
              {!filteredCommandPaletteCommands.length ? (
                <p className="muted">No commands match the current search.</p>
              ) : null}
            </div>
          </article>
        </section>
      )}

      {allowlistImportReview && (
        <section className="execution-overlay" role="dialog" aria-modal="true" aria-label="Allowlist import review">
          <article className="execution-modal">
            <header className="panel-header">
              <h2>{allowlistImportReview.mode === "replace" ? "Review Allowlist Replace" : "Review Allowlist Merge"}</h2>
              <button className="btn secondary" onClick={() => setAllowlistImportReview(null)}>
                Cancel
              </button>
            </header>

            <p className="muted">
              {allowlistImportReview.fileName} - {allowlistImportReview.importedProfiles.length} imported profile
              {allowlistImportReview.importedProfiles.length === 1 ? "" : "s"}.
            </p>

            <div className="execution-grid">
              <article className="card">
                <small>Next Paths</small>
                <strong>{allowlistImportReview.nextPaths.length}</strong>
                <p className="muted">Protected paths after import</p>
              </article>
              <article className="card">
                <small>Next Apps</small>
                <strong>{allowlistImportReview.nextApps.length}</strong>
                <p className="muted">Protected app names after import</p>
              </article>
              <article className="card">
                <small>Removals</small>
                <strong>{allowlistImportReview.removedPaths.length + allowlistImportReview.removedApps.length}</strong>
                <p className="muted">Entries removed by this import</p>
              </article>
            </div>

            <div className="grid two-col">
              <article className="card import-review-card">
                <h3>Paths To Add</h3>
                {allowlistImportReview.addedPaths.length ? (
                  <ul className="import-diff-list">
                    {allowlistImportReview.addedPaths.map((item) => (
                      <li key={`add-path-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No new protected paths.</p>
                )}
              </article>

              <article className="card import-review-card">
                <h3>Paths To Remove</h3>
                {allowlistImportReview.removedPaths.length ? (
                  <ul className="import-diff-list is-danger">
                    {allowlistImportReview.removedPaths.map((item) => (
                      <li key={`remove-path-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No protected paths will be removed.</p>
                )}
              </article>

              <article className="card import-review-card">
                <h3>Apps To Add</h3>
                {allowlistImportReview.addedApps.length ? (
                  <ul className="import-diff-list">
                    {allowlistImportReview.addedApps.map((item) => (
                      <li key={`add-app-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No new protected apps.</p>
                )}
              </article>

              <article className="card import-review-card">
                <h3>Apps To Remove</h3>
                {allowlistImportReview.removedApps.length ? (
                  <ul className="import-diff-list is-danger">
                    {allowlistImportReview.removedApps.map((item) => (
                      <li key={`remove-app-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No protected apps will be removed.</p>
                )}
              </article>
            </div>

            <div className="row wrap">
              <button className="btn" onClick={() => void applyAllowlistImportReview()}>
                {allowlistImportReview.mode === "replace" ? "Apply Replace" : "Apply Merge"}
              </button>
              <button className="btn secondary" onClick={() => setAllowlistImportReview(null)}>
                Keep Current Allowlist
              </button>
            </div>
          </article>
        </section>
      )}

      {showCleanupOverlay && (
        <section className="execution-overlay" role="dialog" aria-modal="true" aria-label="Cleanup execution progress">
          <article className="execution-modal">
            <header className="panel-header">
              <h2>Cleanup In Progress</h2>
              <button
                className="btn secondary"
                onClick={() => setShowCleanupOverlay(false)}
                disabled={!cleanupCanCloseOverlay}
              >
                Close
              </button>
            </header>

            <p className="muted">
              {cleanupProgress?.message ?? "Initializing cleanup..."}
            </p>
            <div className="scan-bar is-wide">
              <span style={{ width: `${cleanupProgressPercent}%` }} />
            </div>
            <p className="muted">
              {cleanupProgressPercent}% complete
              {cleanupProgress?.runningPath ? ` - Running: ${shortPath(cleanupProgress.runningPath)}` : ""}
            </p>

            <div className="execution-grid">
              <article className="card">
                <h3>Total</h3>
                <strong>{cleanupProgress?.totalTasks ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Completed</h3>
                <strong>{cleanupProgress?.completedTasks ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Pending</h3>
                <strong>{cleanupProgress?.pendingTasks ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Moved</h3>
                <strong>{cleanupProgress?.movedCount ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Failed</h3>
                <strong>{cleanupProgress?.failedCount ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Freed</h3>
                <strong>{formatBytes(cleanupProgress?.freedBytes ?? 0)}</strong>
              </article>
            </div>

            <article className="card">
              <h3>Live Logs</h3>
              <div className="execution-logs">
                {cleanupLogs.length ? (
                  cleanupLogs.slice(-220).map((entry, index) => (
                    <div key={`${index}-${entry}`} className="log-line">
                      {entry}
                    </div>
                  ))
                ) : (
                  <p className="muted">Waiting for first cleanup event...</p>
                )}
              </div>
            </article>
          </article>
        </section>
      )}

      {showQuarantinePurgeOverlay && (
        <section className="execution-overlay" role="dialog" aria-modal="true" aria-label="Quarantine purge progress">
          <article className="execution-modal">
            <header className="panel-header">
              <h2>Quarantine Purge</h2>
              <div className="row wrap">
                <button
                  className="btn secondary"
                  onClick={() => void cancelQuarantinePurge()}
                  disabled={!isPurgingQuarantine}
                >
                  Cancel Purge
                </button>
                <button
                  className="btn secondary"
                  onClick={() => setShowQuarantinePurgeOverlay(false)}
                  disabled={!quarantinePurgeCanCloseOverlay}
                >
                  Close
                </button>
              </div>
            </header>

            <p className="muted">{quarantinePurgeProgress?.message ?? "Preparing purge strategy..."}</p>
            <div className="scan-bar is-wide">
              <span style={{ width: `${quarantinePurgeProgressPercent}%` }} />
            </div>
            <p className="muted">
              {quarantinePurgeProgressPercent}% complete
              {quarantinePurgeProgress?.currentPath ? ` - Running: ${shortPath(quarantinePurgeProgress.currentPath)}` : ""}
            </p>

            <div className="execution-grid">
              <article className="card">
                <h3>Groups</h3>
                <strong>{quarantinePurgeProgress?.totalGroups ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Completed</h3>
                <strong>{quarantinePurgeProgress?.completedGroups ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Purged Items</h3>
                <strong>{quarantinePurgeProgress?.purgedItems ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Total Items</h3>
                <strong>{quarantinePurgeProgress?.totalItems ?? 0}</strong>
              </article>
              <article className="card">
                <h3>Freed</h3>
                <strong>{formatBytes(quarantinePurgeProgress?.purgedBytes ?? 0)}</strong>
              </article>
              <article className="card">
                <h3>Strategy</h3>
                <strong>
                  {(quarantinePurgeProgress?.storageHint ?? "unknown").toUpperCase()} x{quarantinePurgeProgress?.concurrency ?? 0}
                </strong>
              </article>
            </div>

            <article className="card">
              <h3>Live Logs</h3>
              <div className="execution-logs">
                {quarantinePurgeLogs.length ? (
                  quarantinePurgeLogs.slice(-220).map((entry, index) => (
                    <div key={`${index}-${entry}`} className="log-line">
                      {entry}
                    </div>
                  ))
                ) : (
                  <p className="muted">Waiting for first purge event...</p>
                )}
              </div>
            </article>
          </article>
        </section>
      )}
    </div>
  );
}

