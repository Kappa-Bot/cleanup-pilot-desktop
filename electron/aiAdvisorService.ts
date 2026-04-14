import fs from "fs/promises";
import type { Dirent } from "fs";
import os from "os";
import path from "path";
import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import { withTimeout } from "./asyncUtils";
import { parseJsonPayload } from "./jsonPayload";
import { collectInstalledApps, findMatchingInstalledAppName, InstalledAppRecord } from "./installedApps";
import { matchNeverCleanupApp, matchNeverCleanupPath, normalizeProtectionPreferences } from "./protectionPreferences";
import { getDefaultRoots } from "./rulePack";
import { isBinaryExtension, isProtectedPath } from "./safetyPolicy";
import {
  AIAnalysisMode,
  AIActionSuggestion,
  AIProvider,
  AIProviderInventory,
  AIProviderPreference,
  AIAdvisorAnalysisRequest,
  AIAdvisorAnalysisResponse,
  AIAppDataCandidate,
  AIExtensionStat,
  AIFilePatternSummary,
  AIModelsResponse,
  LocalModelDecision,
  LocalModelInfo,
  ProtectionPreferences,
  StorageFileUsage,
  StorageFolderUsage
} from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 20_000;
const MIN_MAX_FILES = 1_000;
const MAX_MAX_FILES = 250_000;
const TOP_FILES_LIMIT = 16;
const TOP_FOLDERS_LIMIT = 16;
const TOP_EXTENSIONS_LIMIT = 12;
const APPDATA_CANDIDATES_LIMIT = 18;
const YIELD_EVERY = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 30_000;
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const WINDOWS_REFERENCE_TIMEOUT_MS = 3_500;
const OLLAMA_BOOT_TIMEOUT_MS = 12_000;
const CEREBRAS_API_BASE_URL = "https://api.cerebras.ai/v1";
const CEREBRAS_PUBLIC_MODELS_URL = "https://api.cerebras.ai/public/v1/models";
const CEREBRAS_REQUEST_TIMEOUT_MS = 60_000;
const CEREBRAS_MODEL_DISCOVERY_TIMEOUT_MS = 12_000;
const MODEL_SUMMARY_ROOT_LIMIT = 6;
const MODEL_SUMMARY_FOLDER_LIMIT = 8;
const MODEL_SUMMARY_FILE_LIMIT = 6;
const MODEL_SUMMARY_EXTENSION_LIMIT = 8;
const MODEL_SUMMARY_APPDATA_LIMIT = 8;
const MODEL_SUMMARY_ACTION_LIMIT = 8;
const FAST_MAX_FILES_CAP = 6_000;
const FAST_REFERENCE_TIMEOUT_MS = 1_500;

interface AnalysisProfile {
  mode: AIAnalysisMode;
  maxFiles: number;
  topFilesLimit: number;
  topFoldersLimit: number;
  topExtensionsLimit: number;
  appDataCandidatesLimit: number;
  appDataAggregateLimit: number;
  modelSummaryRootLimit: number;
  modelSummaryFolderLimit: number;
  modelSummaryFileLimit: number;
  modelSummaryExtensionLimit: number;
  modelSummaryAppDataLimit: number;
  modelSummaryActionLimit: number;
  modelCompletionTokens: number;
  modelWordBudget: number;
}

const APPDATA_IGNORED_NAMES = new Set([
  "microsoft",
  "packages",
  "connecteddevicesplatform",
  "crashdumps",
  "temp",
  "tempstate",
  "programs",
  "assembly",
  "fontcache",
  "grouping",
  "nvidia corporation",
  "nvidia",
  "intel",
  "amd"
]);

interface OllamaTagItem {
  name?: unknown;
  model?: unknown;
  digest?: unknown;
  modified_at?: unknown;
  size?: unknown;
}

interface CerebrasModelItem {
  id?: unknown;
  created?: unknown;
  object?: unknown;
  owned_by?: unknown;
}

interface CerebrasChatMessage {
  content?: unknown;
}

interface CerebrasChatChoice {
  message?: CerebrasChatMessage;
}

interface AppDataAggregate {
  path: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  lastModified: number;
}

interface ReferenceSnapshot {
  installedApps: InstalledAppRecord[];
  processPaths: string[];
  servicePaths: string[];
  pathEntries: string[];
}

interface TraversalSummary {
  scannedFileCount: number;
  scannedBytes: number;
  topFolders: StorageFolderUsage[];
  topFiles: StorageFileUsage[];
  topExtensions: AIExtensionStat[];
  appDataAggregates: AppDataAggregate[];
}

interface ModelsCacheState {
  timestamp: number;
  models: LocalModelInfo[];
}

interface AnalysisCacheState {
  key: string;
  timestamp: number;
  response: AIAdvisorAnalysisResponse;
}

interface AIAdvisorServiceDependencies {
  resolveProtectionPreferences?: () => Promise<ProtectionPreferences> | ProtectionPreferences;
}

function normalizePath(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\");
}

function normalizeLowerPath(inputPath: string): string {
  return normalizePath(inputPath).toLowerCase();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(MIN_MAX_FILES, Math.min(MAX_MAX_FILES, Math.floor(parsed)));
}

function uniqueNonEmpty(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizePath(item).trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function pushTopFile(items: StorageFileUsage[], file: StorageFileUsage): void {
  items.push(file);
  items.sort((left, right) => left.sizeBytes - right.sizeBytes);
  if (items.length > TOP_FILES_LIMIT) {
    items.shift();
  }
}

function computeFolderBucket(filePath: string, roots: string[]): string {
  const lowerFilePath = normalizeLowerPath(filePath);
  const matchedRoot = roots
    .filter((root) => lowerFilePath.startsWith(`${normalizeLowerPath(root)}\\`) || lowerFilePath === normalizeLowerPath(root))
    .sort((left, right) => right.length - left.length)[0];

  if (!matchedRoot) {
    return path.dirname(filePath);
  }

  const relative = path.relative(matchedRoot, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length <= 1) {
    return matchedRoot;
  }
  if (parts.length === 2) {
    return path.join(matchedRoot, parts[0]);
  }
  return path.join(matchedRoot, parts[0], parts[1]);
}

function extractAppDataParent(filePath: string, appDataRoots: string[]): { path: string; name: string } | null {
  const normalizedFile = normalizeLowerPath(filePath);
  for (const root of appDataRoots) {
    const normalizedRoot = normalizeLowerPath(root);
    if (!(normalizedFile.startsWith(`${normalizedRoot}\\`) || normalizedFile === normalizedRoot)) {
      continue;
    }
    const relative = path.relative(root, filePath);
    const parts = relative.split(path.sep).filter(Boolean);
    if (!parts.length) {
      return null;
    }
    return {
      path: path.join(root, parts[0]),
      name: parts[0]
    };
  }
  return null;
}

function startsWithAnyRoot(filePath: string, roots: string[]): boolean {
  const normalizedFilePath = normalizeLowerPath(filePath);
  return roots.some((root) => {
    const normalizedRoot = normalizeLowerPath(root);
    return (
      normalizedFilePath === normalizedRoot ||
      normalizedFilePath.startsWith(`${normalizedRoot}\\`)
    );
  });
}

function riskRank(confidence: AIAppDataCandidate["confidence"]): number {
  if (confidence === "high") {
    return 3;
  }
  if (confidence === "medium") {
    return 2;
  }
  return 1;
}

function findActiveProcess(candidatePath: string, processPaths: string[]): string | undefined {
  const normalizedCandidate = normalizeLowerPath(candidatePath);
  return processPaths.find((item) => {
    const normalizedProcess = normalizeLowerPath(item);
    return (
      normalizedProcess.startsWith(`${normalizedCandidate}\\`) ||
      normalizedProcess === normalizedCandidate
    );
  });
}

function formatGiB(value: number): string {
  return `${Math.max(0, value / 1024 / 1024 / 1024).toFixed(value >= 1024 * 1024 * 1024 ? 1 : 2)} GiB`;
}

function isWithinCandidate(candidatePath: string, referencedPath: string): boolean {
  const normalizedCandidate = normalizeLowerPath(candidatePath);
  const normalizedReference = normalizeLowerPath(referencedPath);
  return (
    normalizedReference === normalizedCandidate ||
    normalizedReference.startsWith(`${normalizedCandidate}\\`)
  );
}

function uniqueReferenceKinds(
  candidatePath: string,
  snapshot: ReferenceSnapshot
): Array<"process" | "service" | "path_env" | "install_location"> {
  const kinds = new Set<"process" | "service" | "path_env" | "install_location">();
  if (snapshot.processPaths.some((item) => isWithinCandidate(candidatePath, item))) {
    kinds.add("process");
  }
  if (snapshot.servicePaths.some((item) => isWithinCandidate(candidatePath, item))) {
    kinds.add("service");
  }
  if (snapshot.pathEntries.some((item) => isWithinCandidate(candidatePath, item))) {
    kinds.add("path_env");
  }
  if (
    snapshot.installedApps.some(
      (item) => item.installLocation && isWithinCandidate(candidatePath, item.installLocation)
    )
  ) {
    kinds.add("install_location");
  }
  return [...kinds];
}

function kindLabel(kind: "process" | "service" | "path_env" | "install_location"): string {
  if (kind === "path_env") {
    return "PATH";
  }
  if (kind === "install_location") {
    return "install location";
  }
  return kind;
}

function extractExecutablePath(rawValue: string): string {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return "";
  }

  const quoted = value.match(/^"([^"]+)"/);
  if (quoted?.[1]) {
    return normalizePath(quoted[1]);
  }

  const exeMatch = value.match(/^(.+?\.exe)\b/i);
  if (exeMatch?.[1]) {
    return normalizePath(exeMatch[1]);
  }

  return normalizePath(value.split(/\s+/)[0] ?? "");
}

function isProtectedAiFile(targetPath: string): boolean {
  return isProtectedPath(targetPath) || isBinaryExtension(targetPath);
}

function buildFallbackRecommendation(
  summary: AIFilePatternSummary,
  actionPlan: AIActionSuggestion[],
  modelName: string | undefined
): string {
  const topFolders = summary.topFolders.slice(0, 5);
  const topExtensions = summary.topExtensions.slice(0, 8);
  const highConfidenceCandidates = summary.appDataCandidates.filter((item) => item.confidence === "high");
  const priorityActions = actionPlan.slice(0, 6);

  const lines: string[] = [];
  lines.push("## Suggested Actions");
  lines.push("");
  if (priorityActions.length > 0) {
    lines.push("1. Review these prioritized actions first:");
    for (const action of priorityActions) {
      lines.push(
        `- ${action.title} (${Math.round(action.estimatedBytes / 1024 / 1024)} MB, ${action.confidence} confidence): ${action.summary}`
      );
    }
  } else if (topFolders.length > 0) {
    lines.push("1. Start with the largest folder groups listed below and run preview before cleanup.");
    for (const folder of topFolders) {
      lines.push(`- ${folder.path} (${Math.round(folder.sizeBytes / 1024 / 1024)} MB)`);
    }
  } else {
    lines.push("1. No large folders were discovered in the selected scan scope.");
  }
  lines.push("2. Prioritize duplicates, cache, and temp categories before touching installer artifacts.");
  lines.push("3. Keep quarantine retention enabled so every cleanup action can be restored.");
  lines.push("");
  lines.push("## AppData Follow-up");
  lines.push("");
  if (highConfidenceCandidates.length > 0) {
    lines.push("Review these likely stale AppData folders first:");
    for (const candidate of highConfidenceCandidates.slice(0, 8)) {
      lines.push(`- ${candidate.path} (${Math.round(candidate.sizeBytes / 1024 / 1024)} MB, ${candidate.daysSinceModified} days stale)`);
    }
  } else {
    lines.push("No high-confidence stale AppData candidates were detected. Review medium-confidence candidates manually.");
  }
  lines.push("");
  lines.push("## Pattern Notes");
  lines.push("");
  if (topExtensions.length > 0) {
    lines.push(`Dominant extensions: ${topExtensions.map((item) => `${item.extension} (${item.count})`).join(", ")}.`);
  } else {
    lines.push("No extension-heavy pattern was detected in this run.");
  }
  lines.push(`Model output ${modelName ? `from \`${modelName}\`` : "was not available"}; this fallback is heuristic-only.`);
  return lines.join("\n");
}

function sanitizeModelResponse(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*thinking\.\.\..*$/gim, "")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelNameFromManifestPath(manifestPath: string, manifestRoot: string): string | null {
  const relative = path.relative(manifestRoot, manifestPath);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const libraryIndex = parts.findIndex((item) => item.toLowerCase() === "library");
  const modelParts = libraryIndex >= 0 ? parts.slice(libraryIndex + 1) : parts.slice(1);
  if (modelParts.length < 2) {
    return null;
  }
  const tag = modelParts[modelParts.length - 1];
  const modelPath = modelParts.slice(0, -1).join("/");
  if (!modelPath || !tag) {
    return null;
  }
  return `${modelPath}:${tag}`;
}

async function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function emptyProviderInventory(): AIProviderInventory {
  return {
    localCount: 0,
    cerebrasCount: 0,
    cerebrasConfigured: false
  };
}

function buildProviderInventory(models: LocalModelInfo[], cerebrasConfigured: boolean): AIProviderInventory {
  return {
    localCount: models.filter((item) => item.provider === "local").length,
    cerebrasCount: models.filter((item) => item.provider === "cerebras").length,
    cerebrasConfigured
  };
}

function readWindowsUserEnvironmentVariable(name: string): string {
  if (process.platform !== "win32") {
    return "";
  }

  try {
    const script = `[Environment]::GetEnvironmentVariable('${name.replace(/'/g, "''")}', 'User')`;
    const stdout = execFileSync("powershell", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 256 * 1024
    });
    return String(stdout ?? "").trim();
  } catch {
    return "";
  }
}

function modelPreferenceRank(provider: AIProvider, name: string): number {
  const normalized = name.toLowerCase();
  if (provider === "cerebras") {
    if (normalized.includes("gpt-oss-120b")) {
      return 100;
    }
    if (normalized.includes("zai-glm-4.7")) {
      return 96;
    }
    if (normalized.includes("llama-3.3-70b")) {
      return 94;
    }
    if (normalized.includes("qwen")) {
      return 92;
    }
    if (normalized.includes("llama3.1-8b")) {
      return 88;
    }
    if (normalized.includes("deepseek")) {
      return 90;
    }
    if (normalized.includes("llama")) {
      return 84;
    }
    return 50;
  }

  if (/gpt-oss|openai-oss/i.test(name)) {
    return 100;
  }
  if (/qwen/i.test(name)) {
    return 92;
  }
  return 50;
}

function compactPath(value: string, maxLength = 104): string {
  const normalized = normalizePath(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const head = normalized.slice(0, Math.max(24, Math.floor(maxLength * 0.42)));
  const tail = normalized.slice(-Math.max(24, Math.floor(maxLength * 0.38)));
  return `${head}...${tail}`;
}

function roundGiB(value: number): number {
  return Number((value / 1024 / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 * 1024 ? 1 : 2));
}

function classifyFolderHint(targetPath: string): string {
  const normalized = normalizeLowerPath(targetPath);
  if (normalized.includes("\\downloads\\")) {
    return "downloads";
  }
  if (normalized.includes("\\appdata\\")) {
    return "appdata";
  }
  if (normalized.includes("\\cache") || normalized.includes("\\webcache") || normalized.includes("\\inetcache")) {
    return "cache";
  }
  if (normalized.includes("\\temp") || normalized.includes("\\tmp\\")) {
    return "temp";
  }
  if (normalized.includes("\\logs") || normalized.endsWith(".log")) {
    return "logs";
  }
  if (normalized.includes("\\docker\\") || normalized.includes("\\wsl\\")) {
    return "wsl";
  }
  if (normalized.includes("\\.ollama\\") || normalized.includes("\\huggingface\\") || normalized.includes("\\deepseek\\")) {
    return "ai";
  }
  if (normalized.includes("\\curseforge\\") || normalized.includes("\\modrinth\\") || normalized.includes("\\.minecraft\\")) {
    return "games";
  }
  return "review";
}

function summarizeActionForModel(action: AIActionSuggestion): Record<string, unknown> {
  return {
    kind: action.kind,
    title: action.title,
    bytesGiB: roundGiB(action.estimatedBytes),
    risk: action.risk,
    confidence: action.confidence,
    target: compactPath(action.targetPath ?? action.sourcePaths[0] ?? "")
  };
}

function buildCompactModelSummary(
  summary: AIFilePatternSummary,
  actionPlan: AIActionSuggestion[],
  decision: LocalModelDecision,
  profile: AnalysisProfile
): Record<string, unknown> {
  return {
    mode: profile.mode === "fast" ? "fast_compact_token_budget" : "compact_token_budget",
    decision: {
      provider: decision.provider,
      recommendedModel: decision.recommendedModel,
      rationale: decision.rationale
    },
    scope: {
      roots: summary.scannedRoots.slice(0, profile.modelSummaryRootLimit).map((item) => compactPath(item, 64)),
      sampledFileCount: summary.scannedFileCount,
      sampledGiB: roundGiB(summary.scannedBytes)
    },
    folders: summary.topFolders.slice(0, profile.modelSummaryFolderLimit).map((item) => ({
      path: compactPath(item.path),
      bytesGiB: roundGiB(item.sizeBytes),
      fileCount: item.fileCount,
      hint: classifyFolderHint(item.path)
    })),
    files: summary.topFiles.slice(0, profile.modelSummaryFileLimit).map((item) => ({
      path: compactPath(item.path),
      bytesGiB: roundGiB(item.sizeBytes)
    })),
    extensions: summary.topExtensions.slice(0, profile.modelSummaryExtensionLimit).map((item) => ({
      extension: item.extension,
      count: item.count,
      bytesGiB: roundGiB(item.sizeBytes)
    })),
    appData: summary.appDataCandidates.slice(0, profile.modelSummaryAppDataLimit).map((item) => ({
      name: item.name,
      path: compactPath(item.path),
      bytesGiB: roundGiB(item.sizeBytes),
      staleDays: item.daysSinceModified,
      disposition: item.disposition,
      confidence: item.confidence,
      refs: item.referenceKinds,
      installed: Boolean(item.installedAppName)
    })),
    actions: actionPlan.slice(0, profile.modelSummaryActionLimit).map(summarizeActionForModel)
  };
}

function buildAnalysisCacheKey(args: {
  roots: string[];
  maxFiles: number;
  mode: AIAnalysisMode;
  provider: AIProviderPreference;
  requestedModel?: string;
  decision: LocalModelDecision;
  protectionPreferences: ProtectionPreferences;
}): string {
  return JSON.stringify({
    roots: uniqueNonEmpty(args.roots.map((item) => normalizePath(item))),
    mode: args.mode,
    maxFiles: args.maxFiles,
    provider: args.provider,
    requestedModel: args.requestedModel ?? "",
    decisionProvider: args.decision.provider,
    decisionModel: args.decision.recommendedModel,
    neverCleanupPaths: [...args.protectionPreferences.neverCleanupPaths].sort((left, right) =>
      left.localeCompare(right)
    ),
    neverCleanupApps: [...args.protectionPreferences.neverCleanupApps].sort((left, right) =>
      left.localeCompare(right)
    )
  });
}

function resolveAnalysisProfile(requestedMode: AIAnalysisMode | undefined, requestedMaxFiles: number): AnalysisProfile {
  if (requestedMode === "fast") {
    return {
      mode: "fast",
      maxFiles: Math.min(requestedMaxFiles, FAST_MAX_FILES_CAP),
      topFilesLimit: 10,
      topFoldersLimit: 10,
      topExtensionsLimit: 6,
      appDataCandidatesLimit: 10,
      appDataAggregateLimit: 16,
      modelSummaryRootLimit: 4,
      modelSummaryFolderLimit: 5,
      modelSummaryFileLimit: 4,
      modelSummaryExtensionLimit: 5,
      modelSummaryAppDataLimit: 5,
      modelSummaryActionLimit: 5,
      modelCompletionTokens: 180,
      modelWordBudget: 90
    };
  }

  return {
    mode: "standard",
    maxFiles: requestedMaxFiles,
    topFilesLimit: TOP_FILES_LIMIT,
    topFoldersLimit: TOP_FOLDERS_LIMIT,
    topExtensionsLimit: TOP_EXTENSIONS_LIMIT,
    appDataCandidatesLimit: APPDATA_CANDIDATES_LIMIT,
    appDataAggregateLimit: APPDATA_CANDIDATES_LIMIT * 3,
    modelSummaryRootLimit: MODEL_SUMMARY_ROOT_LIMIT,
    modelSummaryFolderLimit: MODEL_SUMMARY_FOLDER_LIMIT,
    modelSummaryFileLimit: MODEL_SUMMARY_FILE_LIMIT,
    modelSummaryExtensionLimit: MODEL_SUMMARY_EXTENSION_LIMIT,
    modelSummaryAppDataLimit: MODEL_SUMMARY_APPDATA_LIMIT,
    modelSummaryActionLimit: MODEL_SUMMARY_ACTION_LIMIT,
    modelCompletionTokens: 420,
    modelWordBudget: 140
  };
}

export class AIAdvisorService {
  private readonly ollamaBaseUrl: string;
  private readonly cerebrasApiBaseUrl: string;
  private readonly cerebrasPublicModelsUrl: string;
  private readonly cerebrasApiKey: string;
  private readonly ollamaExecutableCandidates: string[];
  private readonly resolveProtectionPreferences: () => Promise<ProtectionPreferences> | ProtectionPreferences;
  private modelsCache: ModelsCacheState | null = null;
  private analysisCache: AnalysisCacheState | null = null;
  private modelsInFlight: Promise<LocalModelInfo[]> | null = null;
  private startupWarmupPromise: Promise<void> | null = null;
  private ollamaRecoveryAttempted = false;

  constructor(dependencies: AIAdvisorServiceDependencies = {}) {
    this.ollamaBaseUrl = (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.cerebrasApiBaseUrl = (process.env.CEREBRAS_API_BASE_URL?.trim() || CEREBRAS_API_BASE_URL).replace(/\/+$/, "");
    this.cerebrasPublicModelsUrl = (process.env.CEREBRAS_PUBLIC_MODELS_URL?.trim() || CEREBRAS_PUBLIC_MODELS_URL).replace(/\/+$/, "");
    this.cerebrasApiKey = process.env.CEREBRAS_API_KEY?.trim() || readWindowsUserEnvironmentVariable("CEREBRAS_API_KEY");
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const userProfile = process.env.USERPROFILE ?? "";
    this.ollamaExecutableCandidates = uniqueNonEmpty([
      localAppData ? path.join(localAppData, "Programs", "Ollama", "ollama.exe") : "",
      userProfile ? path.join(userProfile, "AppData", "Local", "Programs", "Ollama", "ollama.exe") : "",
      "ollama"
    ]);
    this.resolveProtectionPreferences =
      dependencies.resolveProtectionPreferences ?? (() => normalizeProtectionPreferences());
  }

  warmupStartup(): void {
    if (!this.startupWarmupPromise) {
      this.startupWarmupPromise = this.fetchModels().then(() => undefined).catch(() => undefined);
    }
  }

  async listModels(): Promise<AIModelsResponse> {
    const models = await this.fetchModels().catch(() => [] as LocalModelInfo[]);
    const providers = buildProviderInventory(models, this.hasCerebrasApiKey());
    return {
      models,
      decision: this.chooseModel(models, "auto"),
      providers
    };
  }

  async analyze(request: AIAdvisorAnalysisRequest): Promise<AIAdvisorAnalysisResponse> {
    const models = await this.fetchModels().catch(() => [] as LocalModelInfo[]);
    const preferredProvider = request.provider ?? "auto";
    const providers = buildProviderInventory(models, this.hasCerebrasApiKey());
    const decision = this.chooseModel(models, preferredProvider);
    const maxFiles = parsePositiveInt(request.maxFiles, DEFAULT_MAX_FILES);
    const analysisProfile = resolveAnalysisProfile(request.mode, maxFiles);
    const appDataRoots = this.resolveAppDataRoots();
    const roots = this.resolveRoots(request.roots, appDataRoots);
    const protectionPreferences = normalizeProtectionPreferences(
      await Promise.resolve(this.resolveProtectionPreferences()).catch(() => normalizeProtectionPreferences())
    );
    const cacheKey = buildAnalysisCacheKey({
      roots,
      mode: analysisProfile.mode,
      maxFiles: analysisProfile.maxFiles,
      provider: preferredProvider,
      requestedModel: request.model?.trim(),
      decision,
      protectionPreferences
    });
    if (
      this.analysisCache &&
      this.analysisCache.key === cacheKey &&
      Date.now() - this.analysisCache.timestamp < ANALYSIS_CACHE_TTL_MS
    ) {
      return this.analysisCache.response;
    }

    const referenceTimeoutMs =
      analysisProfile.mode === "fast" ? FAST_REFERENCE_TIMEOUT_MS : WINDOWS_REFERENCE_TIMEOUT_MS;
    const traversal = await this.scanFilesystem(roots, appDataRoots, analysisProfile);
    const [installedApps, processPaths, servicePaths] = await Promise.all([
      withTimeout(collectInstalledApps(), referenceTimeoutMs, [] as InstalledAppRecord[]),
      withTimeout(this.collectProcessPaths(), referenceTimeoutMs, [] as string[]),
      withTimeout(this.collectServicePaths(), referenceTimeoutMs, [] as string[])
    ]);
    const referenceSnapshot: ReferenceSnapshot = {
      installedApps,
      processPaths,
      servicePaths,
      pathEntries: this.collectPathEnvironmentEntries()
    };
    const appDataCandidates = this.buildAppDataCandidates(
      traversal.appDataAggregates,
      referenceSnapshot,
      traversal.scannedFileCount >= analysisProfile.maxFiles,
      protectionPreferences,
      analysisProfile.appDataCandidatesLimit
    );

    const summary: AIFilePatternSummary = {
      scannedRoots: roots,
      scannedFileCount: traversal.scannedFileCount,
      scannedBytes: traversal.scannedBytes,
      topFolders: traversal.topFolders,
      topFiles: traversal.topFiles,
      topExtensions: traversal.topExtensions,
      appDataCandidates
    };
    const actionPlan = this.buildActionPlan(summary, appDataCandidates, protectionPreferences);

    const requestedModel = request.model?.trim();
    const explicitlyRequested = requestedModel
      ? models.find((item) => item.name === requestedModel && (preferredProvider === "auto" || item.provider === preferredProvider))
      : undefined;
    const decisionMatch = models.find(
      (item) => item.name === decision.recommendedModel && item.provider === decision.provider
    );
    const selectedModel = explicitlyRequested ?? decisionMatch;
    const compactModelSummary = buildCompactModelSummary(summary, actionPlan, decision, analysisProfile);

    let recommendationsMarkdown = buildFallbackRecommendation(summary, actionPlan, selectedModel?.name || undefined);
    let modelUsed: string | undefined;
    let providerUsed: AIProvider | undefined;
    let modelError: string | undefined;

    if (selectedModel) {
      try {
        const generated =
          selectedModel.provider === "cerebras"
            ? await this.generateCerebrasRecommendations(selectedModel.name, compactModelSummary, analysisProfile)
            : await this.generateLocalRecommendations(selectedModel.name, compactModelSummary, analysisProfile);
        if (generated.trim()) {
          recommendationsMarkdown = generated;
          modelUsed = selectedModel.name;
          providerUsed = selectedModel.provider;
        }
      } catch (error) {
        modelError =
          error instanceof Error
            ? error.message
            : `Failed to query ${selectedModel.provider === "cerebras" ? "Cerebras" : "local"} model`;
      }
    } else {
      modelError =
        preferredProvider === "cerebras" && !providers.cerebrasConfigured
          ? "Cerebras provider selected but CEREBRAS_API_KEY is not configured."
          : "No AI model provider is available. Install a local Ollama model or configure Cerebras.";
    }

    const response: AIAdvisorAnalysisResponse = {
      models,
      decision,
      providers,
      modelUsed,
      providerUsed,
      modelError,
      summary,
      actionPlan,
      recommendationsMarkdown
    };
    this.analysisCache = {
      key: cacheKey,
      timestamp: Date.now(),
      response
    };
    return response;
  }

  private async fetchModels(): Promise<LocalModelInfo[]> {
    const cached =
      this.modelsCache &&
      Date.now() - this.modelsCache.timestamp < MODEL_CACHE_TTL_MS
        ? this.modelsCache.models
        : null;
    if (cached) {
      return cached;
    }

    if (this.modelsInFlight) {
      return this.modelsInFlight;
    }

    this.modelsInFlight = (async () => {
      let localModels = await this.fetchModelsFromApi({ attemptRecovery: true }).catch(
        () => [] as LocalModelInfo[]
      );
      if (!localModels.length) {
        localModels = await this.fetchModelsFromManifest().catch(() => [] as LocalModelInfo[]);
      }
      const cerebrasModels = await this.fetchCerebrasModels().catch(() => [] as LocalModelInfo[]);
      const normalized = [...localModels, ...cerebrasModels].sort((left, right) => {
        if (left.provider !== right.provider) {
          return left.provider.localeCompare(right.provider);
        }
        return left.name.localeCompare(right.name);
      });
      this.modelsCache = {
        timestamp: Date.now(),
        models: normalized
      };
      return normalized;
    })();

    try {
      return await this.modelsInFlight;
    } finally {
      this.modelsInFlight = null;
    }
  }

  private hasCerebrasApiKey(): boolean {
    return this.cerebrasApiKey.length > 0;
  }

  private async fetchModelsFromApi(options: { attemptRecovery: boolean }): Promise<LocalModelInfo[]> {
    const directAttempt = await this.requestTags();
    if (directAttempt.length > 0 || !options.attemptRecovery) {
      return directAttempt;
    }

    await this.recoverOllamaService();
    return this.requestTags();
  }

  private async requestTags(): Promise<LocalModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_500);
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
        method: "GET",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Ollama tags request failed (${response.status})`);
      }
      const payload = (await response.json()) as { models?: OllamaTagItem[] };
      const rows = Array.isArray(payload.models) ? payload.models : [];
      return rows
        .map((item): LocalModelInfo | null => {
          const name = String(item.name ?? item.model ?? "").trim();
          if (!name) {
            return null;
          }
          const sizeBytes = Number(item.size);
          return {
            name,
            provider: "local",
            id: item.digest ? String(item.digest) : undefined,
            sizeBytes: Number.isFinite(sizeBytes) ? Math.max(0, Math.floor(sizeBytes)) : undefined,
            modifiedAt: item.modified_at ? String(item.modified_at) : undefined
          };
        })
        .filter((item): item is LocalModelInfo => Boolean(item));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async recoverOllamaService(): Promise<void> {
    if (this.ollamaRecoveryAttempted) {
      await this.waitForOllamaApi(2_500);
      return;
    }
    this.ollamaRecoveryAttempted = true;

    for (const executable of this.ollamaExecutableCandidates) {
      try {
        const child = spawn(executable, ["serve"], {
          detached: true,
          windowsHide: true,
          stdio: "ignore"
        });
        child.unref();
        break;
      } catch {
        continue;
      }
    }

    await this.waitForOllamaApi(OLLAMA_BOOT_TIMEOUT_MS);
  }

  private async waitForOllamaApi(timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.requestTags();
        return;
      } catch {
        await sleep(550);
      }
    }
  }

  private async fetchCerebrasModels(): Promise<LocalModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CEREBRAS_MODEL_DISCOVERY_TIMEOUT_MS);
    try {
      const response = await fetch(this.cerebrasPublicModelsUrl, {
        method: "GET",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Cerebras model list request failed (${response.status})`);
      }
      const payload = (await response.json()) as { data?: CerebrasModelItem[] };
      const rows = Array.isArray(payload.data) ? payload.data : [];
      return rows
        .map((item): LocalModelInfo | null => {
          const name = String(item.id ?? "").trim();
          if (!name) {
            return null;
          }
          return {
            name,
            provider: "cerebras",
            modifiedAt: item.created ? new Date(Number(item.created) * 1000).toISOString() : undefined
          };
        })
        .filter((item): item is LocalModelInfo => Boolean(item));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchModelsFromManifest(): Promise<LocalModelInfo[]> {
    const userProfile = process.env.USERPROFILE;
    if (!userProfile) {
      return [];
    }

    const manifestRoot = path.join(userProfile, ".ollama", "models", "manifests");
    const files: string[] = [];
    const pending = [manifestRoot];
    while (pending.length > 0) {
      const current = pending.pop() as string;
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(fullPath);
          continue;
        }
        if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    }

    const models: LocalModelInfo[] = [];
    for (const file of files) {
      const modelName = modelNameFromManifestPath(file, manifestRoot);
      if (!modelName) {
        continue;
      }
      try {
        const [raw, stats] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
        const parsed = parseJsonPayload<{ config?: { digest?: string }; layers?: Array<{ size?: number }> }>(
          raw,
          "Local model manifest"
        );
        const sizeBytes = Array.isArray(parsed.layers)
          ? parsed.layers.reduce((sum, layer) => sum + (Number.isFinite(Number(layer.size)) ? Number(layer.size) : 0), 0)
          : undefined;
        models.push({
          name: modelName,
          provider: "local",
          id: parsed.config?.digest,
          sizeBytes: sizeBytes && sizeBytes > 0 ? Math.floor(sizeBytes) : undefined,
          modifiedAt: new Date(stats.mtimeMs).toISOString()
        });
      } catch {
        continue;
      }
    }

    const unique = new Map<string, LocalModelInfo>();
    for (const model of models) {
      unique.set(model.name.toLowerCase(), model);
    }
    return [...unique.values()];
  }

  private chooseModel(models: LocalModelInfo[], preferredProvider: AIProviderPreference): LocalModelDecision {
    if (!models.length) {
      return {
        recommendedModel: "",
        provider: "local",
        rationale: "No AI models detected. Install a local Ollama model or configure Cerebras.",
        alternatives: []
      };
    }

    const totalMemoryGb = os.totalmem() / 1024 / 1024 / 1024;
    const localModels = models.filter((item) => item.provider === "local");
    const cerebrasModels = models.filter((item) => item.provider === "cerebras");
    const wantsCerebras = preferredProvider === "cerebras";
    const wantsLocal = preferredProvider === "local";
    const autoMode = preferredProvider === "auto";
    const shouldPreferCerebras =
      (autoMode && localModels.length === 0 && this.hasCerebrasApiKey() && cerebrasModels.length > 0) || wantsCerebras;

    const pickTopRanked = (items: LocalModelInfo[], provider: AIProvider): LocalModelInfo | undefined => {
      return [...items].sort((left, right) => {
        const rankDelta = modelPreferenceRank(provider, right.name) - modelPreferenceRank(provider, left.name);
        if (rankDelta !== 0) {
          return rankDelta;
        }
        const sizeDelta = (right.sizeBytes ?? 0) - (left.sizeBytes ?? 0);
        if (sizeDelta !== 0) {
          return sizeDelta;
        }
        return left.name.localeCompare(right.name);
      })[0];
    };

    if (shouldPreferCerebras && cerebrasModels.length > 0) {
      const selected = pickTopRanked(cerebrasModels, "cerebras") as LocalModelInfo;
      return {
        recommendedModel: selected.name,
        provider: "cerebras",
        rationale: this.hasCerebrasApiKey()
          ? "Selected Cerebras cloud inference for stronger model quality and low-latency analysis."
          : "Selected a Cerebras model, but requests will require a configured CEREBRAS_API_KEY.",
        alternatives: models
          .filter((item) => item.name !== selected.name || item.provider !== selected.provider)
          .map((item) => item.name)
      };
    }

    if (wantsCerebras && localModels.length > 0) {
      const fallbackLocal = pickTopRanked(localModels, "local") as LocalModelInfo;
      return {
        recommendedModel: fallbackLocal.name,
        provider: "local",
        rationale: "Cerebras was requested but is unavailable or not configured, so local inference was selected.",
        alternatives: models
          .filter((item) => item.name !== fallbackLocal.name || item.provider !== fallbackLocal.provider)
          .map((item) => item.name)
      };
    }

    const gptOssModel = localModels.find((item) => /gpt-oss|openai-oss/i.test(item.name));
    const qwenModel = localModels.find((item) => /qwen/i.test(item.name));

    if ((wantsLocal || preferredProvider === "auto") && gptOssModel && totalMemoryGb >= 28) {
      return {
        recommendedModel: gptOssModel.name,
        provider: "local",
        rationale: autoMode
          ? "Selected local GPT-OSS to keep AI analysis on-device and avoid cloud rate limits."
          : "Selected local GPT-OSS for deeper analysis quality on a machine with enough RAM.",
        alternatives: models
          .filter((item) => item.name !== gptOssModel.name || item.provider !== "local")
          .map((item) => item.name)
      };
    }

    if ((wantsLocal || preferredProvider === "auto") && qwenModel) {
      return {
        recommendedModel: qwenModel.name,
        provider: "local",
        rationale: autoMode
          ? "Selected local Qwen to keep interactive analysis responsive without cloud quota pressure."
          : "Selected local Qwen for faster interactive analysis on large scans.",
        alternatives: models
          .filter((item) => item.name !== qwenModel.name || item.provider !== "local")
          .map((item) => item.name)
      };
    }

    const fallbackProvider: AIProvider =
      localModels.length > 0 && !shouldPreferCerebras ? "local" : cerebrasModels.length > 0 ? "cerebras" : "local";
    const fallbackModel = pickTopRanked(
      fallbackProvider === "local" ? localModels : cerebrasModels,
      fallbackProvider
    );

    if (fallbackModel) {
      return {
        recommendedModel: fallbackModel.name,
        provider: fallbackProvider,
        rationale:
          fallbackProvider === "local"
            ? "Selected the best available local model for responsive analysis."
            : "Selected the best available Cerebras model for cloud analysis.",
        alternatives: models
          .filter((item) => item.name !== fallbackModel.name || item.provider !== fallbackProvider)
          .map((item) => item.name)
      };
    }

    return {
      recommendedModel: "",
      provider: "local",
      rationale: "No compatible model could be selected.",
      alternatives: []
    };
  }

  private resolveRoots(roots: string[], appDataRoots: string[]): string[] {
    const requestedRoots = uniqueNonEmpty((roots ?? []).map((item) => item.trim()));
    if (requestedRoots.length > 0) {
      return uniqueNonEmpty([...requestedRoots, ...appDataRoots]);
    }
    return uniqueNonEmpty([...getDefaultRoots([]), ...appDataRoots]);
  }

  private resolveAppDataRoots(): string[] {
    const roots = [process.env.LOCALAPPDATA, process.env.APPDATA]
      .filter((item): item is string => Boolean(item))
      .map((item) => item.trim());
    return uniqueNonEmpty(roots);
  }

  private async scanFilesystem(
    roots: string[],
    appDataRoots: string[],
    profile: AnalysisProfile
  ): Promise<TraversalSummary> {
    const validRoots: string[] = [];
    for (const root of roots) {
      try {
        const stats = await fs.stat(root);
        if (stats.isDirectory()) {
          validRoots.push(root);
        }
      } catch {
        // Ignore invalid roots.
      }
    }

    const prioritizedRoots = [...validRoots].sort((left, right) => {
      const leftScore = startsWithAnyRoot(left, appDataRoots) ? 2 : 1;
      const rightScore = startsWithAnyRoot(right, appDataRoots) ? 2 : 1;
      return leftScore - rightScore;
    });
    const pendingDirs = [...prioritizedRoots];
    const seenDirs = new Set<string>();
    const folderStats = new Map<string, { sizeBytes: number; fileCount: number }>();
    const extensionStats = new Map<string, { count: number; sizeBytes: number }>();
    const topFiles: StorageFileUsage[] = [];
    const appDataStats = new Map<string, AppDataAggregate>();
    let scannedFileCount = 0;
    let scannedBytes = 0;
    let truncated = false;

    while (pendingDirs.length > 0 && !truncated) {
      const currentDir = pendingDirs.pop() as string;
      const normalizedCurrent = normalizeLowerPath(currentDir);
      if (seenDirs.has(normalizedCurrent)) {
        continue;
      }
      seenDirs.add(normalizedCurrent);

      let entries: Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const targetPath = path.join(currentDir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          pendingDirs.push(targetPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        let stats;
        try {
          stats = await fs.stat(targetPath);
        } catch {
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }

        if (isProtectedAiFile(targetPath)) {
          continue;
        }

        scannedFileCount += 1;
        scannedBytes += stats.size;

        const extension = path.extname(targetPath).toLowerCase() || "[no_ext]";
        const extensionBucket = extensionStats.get(extension) ?? { count: 0, sizeBytes: 0 };
        extensionBucket.count += 1;
        extensionBucket.sizeBytes += stats.size;
        extensionStats.set(extension, extensionBucket);

        const folderBucketPath = computeFolderBucket(targetPath, validRoots);
        const folderBucket = folderStats.get(folderBucketPath) ?? { sizeBytes: 0, fileCount: 0 };
        folderBucket.sizeBytes += stats.size;
        folderBucket.fileCount += 1;
        folderStats.set(folderBucketPath, folderBucket);

        pushTopFile(topFiles, {
          path: targetPath,
          sizeBytes: stats.size,
          modifiedAt: stats.mtimeMs
        });

        const appDataParent = extractAppDataParent(targetPath, appDataRoots);
        if (appDataParent && !APPDATA_IGNORED_NAMES.has(appDataParent.name.toLowerCase())) {
          const aggregate = appDataStats.get(appDataParent.path) ?? {
            path: appDataParent.path,
            name: appDataParent.name,
            sizeBytes: 0,
            fileCount: 0,
            lastModified: 0
          };
          aggregate.sizeBytes += stats.size;
          aggregate.fileCount += 1;
          aggregate.lastModified = Math.max(aggregate.lastModified, stats.mtimeMs);
          appDataStats.set(appDataParent.path, aggregate);
        }

        if (scannedFileCount % YIELD_EVERY === 0) {
          await yieldToEventLoop();
        }

        if (scannedFileCount >= profile.maxFiles) {
          truncated = true;
          break;
        }
      }
    }

    const topFolders: StorageFolderUsage[] = [...folderStats.entries()]
      .map(([entryPath, aggregate]) => ({
        path: entryPath,
        sizeBytes: aggregate.sizeBytes,
        fileCount: aggregate.fileCount
      }))
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, profile.topFoldersLimit);

    const topExtensions: AIExtensionStat[] = [...extensionStats.entries()]
      .map(([extension, value]) => ({
        extension,
        count: value.count,
        sizeBytes: value.sizeBytes
      }))
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, profile.topExtensionsLimit);

    return {
      scannedFileCount,
      scannedBytes,
      topFolders,
      topFiles: [...topFiles].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, profile.topFilesLimit),
      topExtensions,
      appDataAggregates: [...appDataStats.values()]
        .sort((left, right) => right.sizeBytes - left.sizeBytes)
        .slice(0, profile.appDataAggregateLimit)
    };
  }

  private async collectProcessPaths(): Promise<string[]> {
    if (process.platform !== "win32") {
      return [];
    }
    const script = `
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath } |
  Select-Object -ExpandProperty ExecutablePath |
  ConvertTo-Json -Depth 3
`;
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
        windowsHide: true,
        maxBuffer: 6 * 1024 * 1024
      });
      if (!stdout.trim()) {
        return [];
      }
      const parsed = parseJsonPayload<unknown>(stdout, "AI advisor process path PowerShell output");
      const values = Array.isArray(parsed) ? parsed : [parsed];
      return values
        .map((item) => normalizePath(String(item ?? "").trim()))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async collectServicePaths(): Promise<string[]> {
    if (process.platform !== "win32") {
      return [];
    }
    const script = `
Get-CimInstance Win32_Service |
  Where-Object { $_.PathName } |
  Select-Object -ExpandProperty PathName |
  ConvertTo-Json -Depth 3
`;
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
        windowsHide: true,
        maxBuffer: 6 * 1024 * 1024
      });
      if (!stdout.trim()) {
        return [];
      }
      const parsed = parseJsonPayload<unknown>(stdout, "AI advisor service path PowerShell output");
      const values = Array.isArray(parsed) ? parsed : [parsed];
      return values
        .map((item) => extractExecutablePath(String(item ?? "").trim()))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private collectPathEnvironmentEntries(): string[] {
    const mergedPath = process.env.Path ?? process.env.PATH ?? "";
    return uniqueNonEmpty(
      mergedPath
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  private buildAppDataCandidates(
    aggregates: AppDataAggregate[],
    referenceSnapshot: ReferenceSnapshot,
    scanTruncated: boolean,
    protectionPreferences: ProtectionPreferences,
    limit: number
  ): AIAppDataCandidate[] {
    const now = Date.now();
    const candidates: AIAppDataCandidate[] = [];
    const installedNames = referenceSnapshot.installedApps.map((item) => item.name);
    for (const aggregate of aggregates) {
      if (aggregate.sizeBytes < 12 * 1024 * 1024) {
        continue;
      }

      const daysSinceModified = Math.max(0, Math.floor((now - aggregate.lastModified) / DAY_MS));
      const installedAppName = findMatchingInstalledAppName(aggregate.name, installedNames);
      const allowlistedPath = matchNeverCleanupPath(aggregate.path, protectionPreferences.neverCleanupPaths);
      const allowlistedApp = matchNeverCleanupApp(installedAppName, protectionPreferences.neverCleanupApps);
      const matchedInstalledApp = Boolean(installedAppName);
      const activeProcessPath = findActiveProcess(aggregate.path, referenceSnapshot.processPaths);
      const referenceKinds = uniqueReferenceKinds(aggregate.path, referenceSnapshot);
      const referencedAnywhere = referenceKinds.length > 0;
      const hasInstallReference =
        matchedInstalledApp ||
        Boolean(activeProcessPath) ||
        referenceKinds.includes("install_location") ||
        referenceKinds.includes("process");

      let confidence: AIAppDataCandidate["confidence"] = "low";
      let reason = "Needs manual review.";
      let disposition: AIAppDataCandidate["disposition"] = "review_only";
      let dispositionReason = "Folder requires manual verification before any cleanup.";
      if (allowlistedPath) {
        confidence = "low";
        reason = "Path is on the never-cleanup allowlist.";
        disposition = "do_not_touch";
        dispositionReason = `Path is on your never-cleanup allowlist: ${allowlistedPath}`;
      } else if (allowlistedApp) {
        confidence = "low";
        reason = "Installed app is on the never-cleanup allowlist.";
        disposition = "do_not_touch";
        dispositionReason = `Installed app is on your never-cleanup allowlist: ${allowlistedApp}`;
      } else if (activeProcessPath) {
        confidence = "low";
        reason = "Likely in use by an active process.";
        disposition = "do_not_touch";
        dispositionReason = "Active process currently references this folder.";
      } else if (referencedAnywhere) {
        confidence = "low";
        reason = `Referenced by ${referenceKinds.map((item) => kindLabel(item)).join(", ")}.`;
        disposition = referenceKinds.includes("install_location") ? "do_not_touch" : "review_only";
        dispositionReason = referenceKinds.includes("install_location")
          ? "Folder is tied to an installed application location."
          : "Folder still has live reference signals.";
      } else if (matchedInstalledApp) {
        if (daysSinceModified >= 365 && aggregate.sizeBytes >= 700 * 1024 * 1024) {
          confidence = "medium";
          reason = "Matches an installed app, but appears stale and large.";
        } else {
          confidence = "low";
          reason = "Folder name matches an installed app.";
        }
        disposition = "do_not_touch";
        dispositionReason = "Folder name matches an installed application.";
      } else if (daysSinceModified >= 365 && aggregate.sizeBytes >= 256 * 1024 * 1024) {
        confidence = "high";
        reason = "No installed-app match, not active, and stale for over a year.";
        disposition = "cleanup_candidate";
        dispositionReason = "No active references or install match were found.";
      } else if (daysSinceModified >= 120 && aggregate.sizeBytes >= 96 * 1024 * 1024) {
        confidence = "medium";
        reason = "No installed-app match and stale for several months.";
        disposition = "review_only";
        dispositionReason = "Looks stale, but still needs confirmation.";
      } else {
        confidence = "low";
        reason = "No direct app match found, but recency/size is not strong enough.";
        disposition = hasInstallReference ? "do_not_touch" : "review_only";
        dispositionReason = hasInstallReference
          ? "Folder still appears linked to an active or installed application."
          : "Weak cleanup signal; keep for manual review only.";
      }

      candidates.push({
        path: aggregate.path,
        name: aggregate.name,
        sizeBytes: aggregate.sizeBytes,
        fileCount: aggregate.fileCount,
        lastModified: aggregate.lastModified,
        daysSinceModified,
        confidence,
        reason,
        matchedInstalledApp,
        installedAppName,
        activeProcessPath,
        referenceKinds,
        referenceCount: referenceKinds.length,
        referencedAnywhere,
        disposition,
        dispositionReason,
        scanTruncated
      });
    }

    return candidates
      .sort((left, right) => {
        const confidenceDelta = riskRank(right.confidence) - riskRank(left.confidence);
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }
        return right.sizeBytes - left.sizeBytes;
      })
      .slice(0, limit);
  }

  private buildActionPlan(
    summary: AIFilePatternSummary,
    appDataCandidates: AIAppDataCandidate[],
    protectionPreferences: ProtectionPreferences
  ): AIActionSuggestion[] {
    const actions: AIActionSuggestion[] = [];

    for (const candidate of appDataCandidates.slice(0, 10)) {
      if (candidate.disposition === "do_not_touch") {
        continue;
      }
      const risk: AIActionSuggestion["risk"] =
        candidate.referencedAnywhere || candidate.matchedInstalledApp
          ? "medium"
          : candidate.confidence === "high"
            ? "low"
            : "medium";

      actions.push({
        id: `appdata:${normalizeLowerPath(candidate.path)}`,
        kind: "quarantine_review",
        title:
          candidate.confidence === "high"
            ? `Review stale AppData folder: ${candidate.name}`
            : `Verify AppData folder before cleanup: ${candidate.name}`,
        summary: candidate.referencedAnywhere
          ? `${candidate.reason} Avoid automatic cleanup until you confirm the references are obsolete.`
          : `${candidate.reason} This is a strong cleanup candidate if the app is no longer used.`,
        targetPath: candidate.path,
        sourcePaths: [candidate.path],
        estimatedBytes: candidate.sizeBytes,
        confidence: candidate.confidence,
        risk,
        autoApplyScanRoot: !candidate.referencedAnywhere,
        evidence: [
          `${formatGiB(candidate.sizeBytes)} / ${candidate.fileCount.toLocaleString()} files`,
          `${candidate.daysSinceModified} days stale`,
          candidate.referencedAnywhere
            ? `${candidate.referenceCount} live reference signal${candidate.referenceCount === 1 ? "" : "s"}`
            : "No live reference signals",
          candidate.matchedInstalledApp
            ? `Installed app match: ${candidate.installedAppName ?? candidate.name}`
            : "No installed-app match"
        ]
      });
    }

    for (const file of summary.topFiles.slice(0, 8)) {
      if (
        file.sizeBytes < 512 * 1024 * 1024 ||
        isProtectedAiFile(file.path) ||
        Boolean(matchNeverCleanupPath(file.path, protectionPreferences.neverCleanupPaths))
      ) {
        continue;
      }

      actions.push({
        id: `file:${normalizeLowerPath(file.path)}`,
        kind: "large_file_review",
        title: `Inspect large file: ${path.basename(file.path)}`,
        summary: "Large file detected. Confirm whether it is still needed before cleanup or archive.",
        targetPath: file.path,
        sourcePaths: [file.path],
        estimatedBytes: file.sizeBytes,
        confidence: "medium",
        risk: "medium",
        autoApplyScanRoot: true,
        evidence: [
          `${formatGiB(file.sizeBytes)} single file`,
          `Last modified ${new Date(file.modifiedAt).toLocaleDateString("en-US")}`,
          path.extname(file.path) ? `Type ${path.extname(file.path).toLowerCase()}` : "No file extension"
        ]
      });
    }

    for (const folder of summary.topFolders.slice(0, 8)) {
      const normalized = normalizeLowerPath(folder.path);
      if (
        folder.sizeBytes < 256 * 1024 * 1024 ||
        isProtectedPath(folder.path) ||
        Boolean(matchNeverCleanupPath(folder.path, protectionPreferences.neverCleanupPaths)) ||
        actions.some((item) => item.targetPath && normalizeLowerPath(item.targetPath) === normalized)
      ) {
        continue;
      }

      const isLikelyCache =
        normalized.includes("\\cache") ||
        normalized.includes("\\temp") ||
        normalized.includes("\\logs") ||
        normalized.includes("\\shader") ||
        normalized.includes("\\.ollama\\") ||
        normalized.includes("\\huggingface\\");

      actions.push({
        id: `folder:${normalized}`,
        kind: "folder_review",
        title: `Review heavy folder: ${path.basename(folder.path) || folder.path}`,
        summary: isLikelyCache
          ? "This folder looks cache-like or disposable, but still verify contents before cleanup."
          : "This folder consumes significant space and deserves manual review.",
        targetPath: folder.path,
        sourcePaths: [folder.path],
        estimatedBytes: folder.sizeBytes,
        confidence: isLikelyCache ? "medium" : "low",
        risk: isLikelyCache ? "low" : "medium",
        autoApplyScanRoot: true,
        evidence: [
          `${formatGiB(folder.sizeBytes)} / ${folder.fileCount.toLocaleString()} files`,
          isLikelyCache ? "Path looks cache-like or disposable" : "High-space folder without clear disposable signal",
          path.basename(path.dirname(folder.path)) ? `Parent ${path.basename(path.dirname(folder.path))}` : "Top-level folder"
        ]
      });
    }

    const duplicateRoots = summary.topFolders
      .filter(
        (item) =>
          item.sizeBytes >= 256 * 1024 * 1024 &&
          !isProtectedPath(item.path) &&
          !matchNeverCleanupPath(item.path, protectionPreferences.neverCleanupPaths)
      )
      .slice(0, 3)
      .map((item) => item.path);
    if (duplicateRoots.length > 0) {
      const recoverableBase = summary.topFiles.slice(0, 8).reduce((sum, item) => sum + item.sizeBytes, 0);
      actions.push({
        id: `duplicates:${duplicateRoots.map((item) => normalizeLowerPath(item)).join("|")}`,
        kind: "duplicate_scan",
        title: "Run duplicate scan on the heaviest user folders",
        summary: "The current file distribution suggests duplicate detection is worth running on these roots.",
        targetPath: duplicateRoots[0],
        sourcePaths: duplicateRoots,
        estimatedBytes: recoverableBase,
        confidence: "medium",
        risk: "low",
        autoApplyScanRoot: false,
        evidence: [
          `${duplicateRoots.length} heavy root${duplicateRoots.length === 1 ? "" : "s"} selected`,
          `${formatGiB(recoverableBase)} estimated review surface`,
          "Good candidate for duplicate verification before cleanup"
        ]
      });
    }

    return actions
      .sort((left, right) => {
        const confidenceDelta = riskRank(right.confidence) - riskRank(left.confidence);
        if (confidenceDelta !== 0) {
          return confidenceDelta;
        }
        return right.estimatedBytes - left.estimatedBytes;
      })
      .slice(0, 16);
  }

  private async generateLocalRecommendations(
    model: string,
    compactSummary: Record<string, unknown>,
    profile: AnalysisProfile
  ): Promise<string> {
    try {
      await this.requestTags();
    } catch {
      await this.recoverOllamaService();
    }

    const payload = {
      model,
      stream: false,
      options: {
        temperature: 0.15,
        num_predict: profile.modelCompletionTokens
      },
      prompt: [
        "You are a careful Windows cleanup assistant.",
        "The JSON you receive is already compressed to save tokens.",
        `Return concise markdown only, under ${profile.modelWordBudget} words total.`,
        "Use exactly these sections: Priority, Verify, Checks.",
        "Use at most 3 bullets per section and keep each bullet short.",
        "Never recommend deleting protected system paths, executables, drivers, Program Files, WindowsApps, or active app binaries.",
        "Do not repeat the JSON input.",
        "",
        "Compact machine summary JSON:",
        JSON.stringify(compactSummary)
      ].join("\n")
    };

    const controller = new AbortController();
    const timeoutMs = /gpt-oss|openai-oss|20b|70b/i.test(model) ? 300_000 : 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Ollama generate request failed (${response.status})`);
      }
      const parsed = (await response.json()) as { response?: unknown };
      const text = sanitizeModelResponse(String(parsed.response ?? ""));
      if (!text) {
        throw new Error("Local model returned an empty response.");
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async generateCerebrasRecommendations(
    model: string,
    compactSummary: Record<string, unknown>,
    profile: AnalysisProfile
  ): Promise<string> {
    if (!this.hasCerebrasApiKey()) {
      throw new Error("Cerebras API key is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CEREBRAS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.cerebrasApiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cerebrasApiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.15,
          max_completion_tokens: profile.modelCompletionTokens,
          messages: [
            {
              role: "system",
              content: [
                "You are a careful Windows cleanup assistant.",
                "The user payload is compact on purpose; do not ask for more data.",
                `Produce concise, actionable markdown under ${profile.modelWordBudget} words total.`,
                "Use exactly these sections: Priority, Verify, Checks.",
                "Use at most 3 bullets per section and keep each bullet short.",
                "Never recommend deleting protected system paths, active binaries, or unknown drivers.",
                "Treat Program Files, AppData\\\\Local\\\\Programs, WindowsApps, Chocolatey, Scoop app roots, and executable binaries as non-cleanup targets.",
                "Do not label installed application executables as temporary, cache, or disposable artifacts.",
                "Prioritize safety, quarantine-first cleanup, and explicit verification steps.",
                "Do not repeat or restate the raw JSON."
              ].join(" ")
            },
            {
              role: "user",
              content: [
                "Analyze this compact Windows disk summary.",
                "Return short markdown only.",
                "",
                "Compact machine summary JSON:",
                JSON.stringify(compactSummary)
              ].join("\n")
            }
          ]
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Cerebras rejected the API key (401). Verify CEREBRAS_API_KEY.");
        }
        if (response.status === 429) {
          throw new Error("Cerebras rate limit or quota reached (429). The app used heuristic fallback for this run.");
        }
        throw new Error(`Cerebras chat request failed (${response.status})`);
      }

      const payload = (await response.json()) as { choices?: CerebrasChatChoice[] };
      const text = sanitizeModelResponse(
        String(payload.choices?.[0]?.message?.content ?? "")
      );
      if (!text) {
        throw new Error("Cerebras returned an empty response.");
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
