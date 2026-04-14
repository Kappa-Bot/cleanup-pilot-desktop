import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { withTimeout } from "./asyncUtils";
import { collectInstalledApps, InstalledAppRecord } from "./installedApps";
import { readPersistentJsonCache, schedulePersistentJsonCacheWrite } from "./persistentJsonCache";
import { normalizeProtectionPreferences } from "./protectionPreferences";
import { resolveProtectionDecision } from "./protectionResolver";
import {
  CleanupCategory,
  ProtectionPreferences,
  ProtectedFindingRejection,
  ScanFinding,
  ScanProgressEvent,
  ScanStartRequest,
  ScanSummary
} from "./types";
import { getRiskLevel } from "./safetyPolicy";
import {
  getDefaultRoots,
  matchCleanupContainerDirectory,
  matchCleanupPath,
  shouldSelectByDefault
} from "./rulePack";

export interface ScanExecutionResult {
  findings: ScanFinding[];
  rejected: ProtectedFindingRejection[];
  summary: ScanSummary;
}

interface ScanRuntimeOptions {
  isCanceled: () => boolean;
  onProgress: (progress: ScanProgressEvent) => void;
}

const SCAN_FILE_CHUNK = 96;
const YIELD_INTERVAL = 300;
const DIRECTORY_WORKERS = Math.max(2, Math.min(12, Math.floor(os.cpus().length / 2) || 2));
const FILE_WORKERS = Math.max(6, Math.min(48, os.cpus().length * 2));
const MAX_REJECTED_RECORDS = 400;
const INSTALLED_APPS_TIMEOUT_MS = 3_500;
const SURVEY_DIRECTORY_LIMIT = 120;
const SURVEY_FILE_LIMIT = 6_000;
const SURVEY_PROGRESS_MAX = 8;
const ANALYZE_PROGRESS_START = 97;
const MIN_ESTIMATED_FILES_PER_DIRECTORY = 8;
const MAX_ESTIMATED_FILES_PER_DIRECTORY = 180;
const RATE_EMA_ALPHA = 0.2;
const SCAN_CONTAINER_INDEX_TTL_MS = 90 * 1000;
const SCAN_CONTAINER_INDEX_FILE = "scan-container-index.json";
const SCAN_CONTAINER_INDEX_MAX_ENTRIES = 1200;
const SCAN_AREA_SURVEY_INDEX_TTL_MS = 20 * 60 * 1000;
const SCAN_AREA_SURVEY_INDEX_FILE = "scan-area-survey-index.json";
const SCAN_AREA_SURVEY_INDEX_MAX_ENTRIES = 360;

interface ScanEngineDependencies {
  resolveInstalledApps?: () => Promise<InstalledAppRecord[]>;
  resolveProtectionPreferences?: () => Promise<ProtectionPreferences> | ProtectionPreferences;
}

interface SurveyStats {
  sampledDirectories: number;
  sampledFiles: number;
  areaEstimates: Record<string, { sampledDirectories: number; sampledFiles: number }>;
}

interface CandidatePathRecord {
  targetPath: string;
  matchedRule: {
    id: string;
    category: CleanupCategory;
    reason: string;
  };
}

interface ContainerDirectoryProgress {
  childDirectoriesDiscovered: number;
  fileCount: number;
  sizeBytes: number;
  latestModifiedAt: number;
}

interface ContainerDirectorySummary {
  fileCount: number;
  sizeBytes: number;
  latestModifiedAt: number;
  directoryCount: number;
}

interface CachedContainerDirectorySummary {
  mtimeMs: number;
  value: ContainerDirectorySummary;
  cachedAt: number;
}

interface ScanAreaSurveySignature {
  mtimeMs: number;
  entryCount: number;
  entryDigest: string;
}

interface CachedScanAreaSurveyEstimate {
  signature: ScanAreaSurveySignature;
  value: {
    sampledDirectories: number;
    sampledFiles: number;
  };
  cachedAt: number;
}

const scanContainerIndex = new Map<string, CachedContainerDirectorySummary>();
let scanContainerIndexLoaded = false;
let scanContainerIndexLoadPromise: Promise<void> | null = null;
const scanAreaSurveyIndex = new Map<string, CachedScanAreaSurveyEstimate>();
let scanAreaSurveyIndexLoaded = false;
let scanAreaSurveyIndexLoadPromise: Promise<void> | null = null;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const output = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      output[index] = await mapper(items[index]);
    }
  });

  await Promise.all(workers);
  return output;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeCacheKey(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\").toLowerCase();
}

function trimScanContainerIndex(): void {
  if (scanContainerIndex.size <= SCAN_CONTAINER_INDEX_MAX_ENTRIES) {
    return;
  }

  const sorted = [...scanContainerIndex.entries()].sort((left, right) => right[1].cachedAt - left[1].cachedAt);
  scanContainerIndex.clear();
  for (const [key, value] of sorted.slice(0, SCAN_CONTAINER_INDEX_MAX_ENTRIES)) {
    scanContainerIndex.set(key, value);
  }
}

async function ensureScanContainerIndexLoaded(): Promise<void> {
  if (scanContainerIndexLoaded) {
    return;
  }
  if (!scanContainerIndexLoadPromise) {
    scanContainerIndexLoadPromise = (async () => {
      const entries = await readPersistentJsonCache<CachedContainerDirectorySummary>(SCAN_CONTAINER_INDEX_FILE);
      for (const [key, value] of Object.entries(entries)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        scanContainerIndex.set(key, value);
      }
      trimScanContainerIndex();
      scanContainerIndexLoaded = true;
    })().finally(() => {
      scanContainerIndexLoadPromise = null;
    });
  }
  await scanContainerIndexLoadPromise;
}

function persistScanContainerIndex(): void {
  trimScanContainerIndex();
  schedulePersistentJsonCacheWrite(
    SCAN_CONTAINER_INDEX_FILE,
    Object.fromEntries(scanContainerIndex.entries())
  );
}

function trimScanAreaSurveyIndex(): void {
  if (scanAreaSurveyIndex.size <= SCAN_AREA_SURVEY_INDEX_MAX_ENTRIES) {
    return;
  }

  const sorted = [...scanAreaSurveyIndex.entries()].sort((left, right) => right[1].cachedAt - left[1].cachedAt);
  scanAreaSurveyIndex.clear();
  for (const [key, value] of sorted.slice(0, SCAN_AREA_SURVEY_INDEX_MAX_ENTRIES)) {
    scanAreaSurveyIndex.set(key, value);
  }
}

async function ensureScanAreaSurveyIndexLoaded(): Promise<void> {
  if (scanAreaSurveyIndexLoaded) {
    return;
  }
  if (!scanAreaSurveyIndexLoadPromise) {
    scanAreaSurveyIndexLoadPromise = (async () => {
      const entries = await readPersistentJsonCache<CachedScanAreaSurveyEstimate>(SCAN_AREA_SURVEY_INDEX_FILE);
      for (const [key, value] of Object.entries(entries)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        scanAreaSurveyIndex.set(key, value);
      }
      trimScanAreaSurveyIndex();
      scanAreaSurveyIndexLoaded = true;
    })().finally(() => {
      scanAreaSurveyIndexLoadPromise = null;
    });
  }
  await scanAreaSurveyIndexLoadPromise;
}

function persistScanAreaSurveyIndex(): void {
  trimScanAreaSurveyIndex();
  schedulePersistentJsonCacheWrite(
    SCAN_AREA_SURVEY_INDEX_FILE,
    Object.fromEntries(scanAreaSurveyIndex.entries())
  );
}

function buildScanAreaSurveySignature(
  directoryPath: string,
  mtimeMs: number,
  entries: Dirent[]
): ScanAreaSurveySignature {
  const entryDigest = entries
    .map((entry) => `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : "x"}:${entry.name.toLowerCase()}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return {
    mtimeMs,
    entryCount: entries.length,
    entryDigest: `${normalizeCacheKey(directoryPath)}|${entryDigest}`
  };
}

function getCachedScanAreaSurveyEstimate(
  directoryPath: string,
  signature: ScanAreaSurveySignature
): { sampledDirectories: number; sampledFiles: number } | null {
  const key = normalizeCacheKey(directoryPath);
  const cached = scanAreaSurveyIndex.get(key);
  if (!cached) {
    return null;
  }
  if (
    cached.signature.mtimeMs !== signature.mtimeMs ||
    cached.signature.entryCount !== signature.entryCount ||
    cached.signature.entryDigest !== signature.entryDigest
  ) {
    scanAreaSurveyIndex.delete(key);
    return null;
  }
  if (Date.now() - cached.cachedAt > SCAN_AREA_SURVEY_INDEX_TTL_MS) {
    scanAreaSurveyIndex.delete(key);
    return null;
  }
  return { ...cached.value };
}

function setCachedScanAreaSurveyEstimate(
  directoryPath: string,
  signature: ScanAreaSurveySignature,
  value: { sampledDirectories: number; sampledFiles: number }
): void {
  scanAreaSurveyIndex.set(normalizeCacheKey(directoryPath), {
    signature,
    value: { ...value },
    cachedAt: Date.now()
  });
  persistScanAreaSurveyIndex();
}

function getCachedContainerDirectorySummary(
  directoryPath: string,
  mtimeMs: number
): ContainerDirectorySummary | null {
  const key = normalizeCacheKey(directoryPath);
  const cached = scanContainerIndex.get(key);
  if (!cached) {
    return null;
  }
  if (cached.mtimeMs !== mtimeMs) {
    scanContainerIndex.delete(key);
    return null;
  }
  if (Date.now() - cached.cachedAt > SCAN_CONTAINER_INDEX_TTL_MS) {
    scanContainerIndex.delete(key);
    return null;
  }
  return { ...cached.value };
}

function setCachedContainerDirectorySummary(
  directoryPath: string,
  mtimeMs: number,
  value: ContainerDirectorySummary
): void {
  scanContainerIndex.set(normalizeCacheKey(directoryPath), {
    mtimeMs,
    value: { ...value },
    cachedAt: Date.now()
  });
  persistScanContainerIndex();
}

async function summarizeContainerDirectory(
  directoryPath: string,
  options: {
    isCanceled: () => boolean;
    onDirectoryProcessed?: (progress: ContainerDirectoryProgress) => Promise<void> | void;
  }
): Promise<ContainerDirectorySummary> {
  const pending = [directoryPath];
  let activeWorkers = 0;
  let fileCount = 0;
  let sizeBytes = 0;
  let latestModifiedAt = 0;
  let directoryCount = 0;

  const processDirectory = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    directoryCount += 1;
    const fileTargets: string[] = [];
    let childDirectoriesDiscovered = 0;
    for (const entry of entries) {
      if (options.isCanceled()) {
        return;
      }

      const targetPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(targetPath);
        childDirectoriesDiscovered += 1;
        continue;
      }
      if (entry.isFile()) {
        fileTargets.push(targetPath);
      }
    }

    let currentDirectoryFileCount = 0;
    let currentDirectorySizeBytes = 0;
    let currentDirectoryLatestModifiedAt = 0;
    for (const group of chunkItems(fileTargets, SCAN_FILE_CHUNK)) {
      if (options.isCanceled()) {
        return;
      }

      const statsGroup = await Promise.allSettled(
        group.map(async (target) => {
          const stats = await fs.stat(target);
          return { target, stats };
        })
      );

      for (const item of statsGroup) {
        if (item.status !== "fulfilled" || !item.value.stats.isFile()) {
          continue;
        }

        currentDirectoryFileCount += 1;
        currentDirectorySizeBytes += item.value.stats.size;
        currentDirectoryLatestModifiedAt = Math.max(currentDirectoryLatestModifiedAt, item.value.stats.mtimeMs);
      }
    }

    fileCount += currentDirectoryFileCount;
    sizeBytes += currentDirectorySizeBytes;
    latestModifiedAt = Math.max(latestModifiedAt, currentDirectoryLatestModifiedAt);

    await options.onDirectoryProcessed?.({
      childDirectoriesDiscovered,
      fileCount: currentDirectoryFileCount,
      sizeBytes: currentDirectorySizeBytes,
      latestModifiedAt: currentDirectoryLatestModifiedAt
    });
  };

  const workers = Array.from({ length: Math.min(DIRECTORY_WORKERS, pending.length || 1) }, async () => {
    while (true) {
      if (options.isCanceled()) {
        return;
      }

      const current = pending.pop();
      if (!current) {
        if (activeWorkers === 0 && pending.length === 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }

      activeWorkers += 1;
      try {
        await processDirectory(current);
      } finally {
        activeWorkers -= 1;
      }
    }
  });

  await Promise.all(workers);
  return {
    fileCount,
    sizeBytes,
    latestModifiedAt,
    directoryCount
  };
}

export function createEmptyCategoryBuckets(): Record<CleanupCategory, { count: number; bytes: number }> {
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

function summarizeEtaFromRate(unitsPerSec: number, pendingUnits: number): number {
  if (unitsPerSec <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(pendingUnits / unitsPerSec));
}

function shouldSkipDirectory(targetPath: string): boolean {
  const normalized = path.normalize(targetPath).replace(/\//g, "\\").toLowerCase();
  return (
    normalized === "c:\\windows" ||
    normalized.startsWith("c:\\windows\\") ||
    normalized === "c:\\program files" ||
    normalized.startsWith("c:\\program files\\") ||
    normalized === "c:\\program files (x86)" ||
    normalized.startsWith("c:\\program files (x86)\\") ||
    normalized.includes("\\appdata\\local\\microsoft\\windowsapps\\") ||
    normalized.includes("\\programdata\\chocolatey\\lib\\") ||
    normalized.includes("\\scoop\\apps\\") ||
    normalized.endsWith("\\$recycle.bin") ||
    normalized.includes("\\$recycle.bin\\") ||
    normalized.endsWith("\\system volume information") ||
    normalized.includes("\\system volume information\\") ||
    normalized.endsWith("\\recovery") ||
    normalized.includes("\\recovery\\") ||
    normalized.endsWith("\\perflogs") ||
    normalized.includes("\\perflogs\\") ||
    normalized.endsWith("\\windows.old") ||
    normalized.includes("\\windows.old\\")
  );
}

export class ScanEngine {
  private readonly resolveInstalledApps: () => Promise<InstalledAppRecord[]>;
  private readonly resolveProtectionPreferences: () => Promise<ProtectionPreferences> | ProtectionPreferences;

  constructor(dependencies: ScanEngineDependencies = {}) {
    this.resolveInstalledApps = dependencies.resolveInstalledApps ?? collectInstalledApps;
    this.resolveProtectionPreferences =
      dependencies.resolveProtectionPreferences ?? (() => normalizeProtectionPreferences());
  }

  async run(
    runId: string,
    request: ScanStartRequest,
    options: ScanRuntimeOptions
  ): Promise<ScanExecutionResult> {
    await ensureScanContainerIndexLoaded();
    await ensureScanAreaSurveyIndexLoaded();
    const startedAt = Date.now();
    const summary: ScanSummary = {
      runId,
      status: "running",
      startedAt,
      processedItems: 0,
      findingsCount: 0,
      totalCandidateBytes: 0,
      protectedRejectedCount: 0,
      categories: createEmptyCategoryBuckets()
    };
    const findings: ScanFinding[] = [];
    const rejected: ProtectedFindingRejection[] = [];
      const roots =
        request.roots.length > 0
          ? [...new Set(request.roots.map((item) => path.normalize(item)))]
          : getDefaultRoots(request.roots, request.preset, request.categories);
    const pendingDirs: string[] = [];
    let processedDirectories = 0;
    let lastEmit = 0;
    let yieldedAtProcessed = 0;
    let surveyStats: SurveyStats = {
      sampledDirectories: 0,
      sampledFiles: 0,
      areaEstimates: {}
    };

    options.onProgress({
      runId,
      stage: "preparing",
      processedItems: 0,
      findingsCount: 0,
      percent: 0,
      etaSec: 0,
      processedDirectories: 0,
      estimatedTotalItems: 0,
      estimatedRemainingItems: 0,
      scanDensity: 0
    });

    const [installedApps, resolvedProtectionPreferences] = await Promise.all([
      withTimeout(
        Promise.resolve(this.resolveInstalledApps()),
        INSTALLED_APPS_TIMEOUT_MS,
        [] as InstalledAppRecord[]
      ),
      Promise.resolve(this.resolveProtectionPreferences()).catch(() => normalizeProtectionPreferences())
    ]);
    const protectionPreferences = normalizeProtectionPreferences(resolvedProtectionPreferences);

    for (const root of roots) {
      try {
        const stats = await fs.stat(root);
        if (stats.isDirectory()) {
          pendingDirs.push(path.normalize(root));
        }
      } catch {
        // Ignore missing/inaccessible roots.
      }
    }

    let estimatedFilesPerDirectory = MIN_ESTIMATED_FILES_PER_DIRECTORY;
    let plannedFileItems = 0;
    let plannedWorkUnits = 0;
    let completedWorkUnits = 0;
    let smoothedUnitsPerSec = 0;
    let lastRateTimestamp = Date.now();
    let lastRateCompletedUnits = 0;
    let progressPercentFloor = 0;

    const estimatedDirectoryWorkUnits = (): number => estimatedFilesPerDirectory + 1;

    const refreshRateEstimate = (): void => {
      const now = Date.now();
      const elapsedSec = (now - lastRateTimestamp) / 1000;
      if (elapsedSec < 0.35) {
        return;
      }

      const deltaUnits = completedWorkUnits - lastRateCompletedUnits;
      if (deltaUnits <= 0) {
        lastRateTimestamp = now;
        return;
      }

      const instantRate = deltaUnits / elapsedSec;
      smoothedUnitsPerSec =
        smoothedUnitsPerSec <= 0
          ? instantRate
          : smoothedUnitsPerSec * (1 - RATE_EMA_ALPHA) + instantRate * RATE_EMA_ALPHA;
      lastRateTimestamp = now;
      lastRateCompletedUnits = completedWorkUnits;
    };

    const emitProgress = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastEmit < 160) {
        return;
      }
      lastEmit = now;
      refreshRateEstimate();
      const estimatedTotalItems = Math.max(summary.processedItems, Math.round(plannedFileItems));
      const estimatedRemainingItems = Math.max(0, estimatedTotalItems - summary.processedItems);
      const remainingWorkUnits = Math.max(0, plannedWorkUnits - completedWorkUnits);
      const rawPercent =
        plannedWorkUnits <= 0
          ? SURVEY_PROGRESS_MAX
          : SURVEY_PROGRESS_MAX +
            ((completedWorkUnits / Math.max(plannedWorkUnits, 1)) * (ANALYZE_PROGRESS_START - SURVEY_PROGRESS_MAX));
      const percent = Math.max(
        progressPercentFloor,
        Math.min(ANALYZE_PROGRESS_START - 1, Math.floor(rawPercent))
      );
      progressPercentFloor = percent;
      options.onProgress({
        runId,
        stage: "scanning",
        processedItems: summary.processedItems,
        findingsCount: summary.findingsCount,
        percent,
        etaSec: summarizeEtaFromRate(smoothedUnitsPerSec, remainingWorkUnits),
        processedDirectories,
        estimatedTotalItems,
        estimatedRemainingItems,
        scanDensity:
          processedDirectories > 0
            ? Number((summary.processedItems / Math.max(1, processedDirectories)).toFixed(1))
            : Number((surveyStats.sampledFiles / Math.max(1, surveyStats.sampledDirectories)).toFixed(1))
      });
    };

    const surveyRoots = async (): Promise<SurveyStats> => {
      if (!pendingDirs.length) {
        return {
          sampledDirectories: 0,
          sampledFiles: 0,
          areaEstimates: {}
        };
      }

      const rootSet = new Set(pendingDirs.map((item) => path.normalize(item).toLowerCase()));
      const queue = pendingDirs.map((item) => ({
        directoryPath: item,
        areaKey: null as string | null
      }));
      const seen = new Set(queue.map((item) => path.normalize(item.directoryPath).toLowerCase()));
      let sampledDirectories = 0;
      let sampledFiles = 0;
      let lastSurveyEmit = 0;
      const areaSamples = new Map<
        string,
        {
          sampledDirectories: number;
          sampledFiles: number;
          signature?: ScanAreaSurveySignature;
        }
      >();

      while (
        queue.length > 0 &&
        sampledDirectories < SURVEY_DIRECTORY_LIMIT &&
        sampledFiles < SURVEY_FILE_LIMIT &&
        !options.isCanceled()
      ) {
        const current = queue.shift() as { directoryPath: string; areaKey: string | null };
        const currentDir = current.directoryPath;
        let entries: Dirent[];
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
          continue;
        }

        sampledDirectories += 1;
        if (current.areaKey) {
          const existing = areaSamples.get(current.areaKey) ?? { sampledDirectories: 0, sampledFiles: 0 };
          existing.sampledDirectories += 1;
          areaSamples.set(current.areaKey, existing);
        }
        let currentDirectoryFileCount = 0;
        for (const entry of entries) {
          const targetPath = path.join(currentDir, entry.name);
          if (entry.isSymbolicLink()) {
            continue;
          }
          if (entry.isDirectory()) {
            if (shouldSkipDirectory(targetPath)) {
              continue;
            }
            const normalizedTarget = path.normalize(targetPath).toLowerCase();
            if (!seen.has(normalizedTarget)) {
              seen.add(normalizedTarget);
              if (!current.areaKey && rootSet.has(path.normalize(currentDir).toLowerCase())) {
                const [targetStats, targetEntries] = await Promise.all([
                  fs.stat(targetPath).catch(() => null),
                  fs.readdir(targetPath, { withFileTypes: true }).catch(() => null)
                ]);
                if (targetStats?.isDirectory() && targetEntries) {
                  const signature = buildScanAreaSurveySignature(targetPath, targetStats.mtimeMs, targetEntries);
                  const cachedEstimate = getCachedScanAreaSurveyEstimate(targetPath, signature);
                  if (cachedEstimate) {
                    sampledDirectories += cachedEstimate.sampledDirectories;
                    sampledFiles += cachedEstimate.sampledFiles;
                    areaSamples.set(targetPath, {
                      sampledDirectories: cachedEstimate.sampledDirectories,
                      sampledFiles: cachedEstimate.sampledFiles,
                      signature
                    });
                    continue;
                  }
                  areaSamples.set(targetPath, areaSamples.get(targetPath) ?? {
                    sampledDirectories: 0,
                    sampledFiles: 0,
                    signature
                  });
                }
                queue.push({
                  directoryPath: targetPath,
                  areaKey: targetPath
                });
              } else {
                queue.push({
                  directoryPath: targetPath,
                  areaKey: current.areaKey
                });
              }
            }
            continue;
          }
          if (entry.isFile()) {
            sampledFiles += 1;
            currentDirectoryFileCount += 1;
          }
        }
        if (current.areaKey) {
          const existing = areaSamples.get(current.areaKey) ?? { sampledDirectories: 0, sampledFiles: 0 };
          existing.sampledFiles += currentDirectoryFileCount;
          areaSamples.set(current.areaKey, existing);
        }

        const now = Date.now();
        if (now - lastSurveyEmit >= 140) {
          lastSurveyEmit = now;
          const density = Math.max(
            MIN_ESTIMATED_FILES_PER_DIRECTORY,
            Math.min(MAX_ESTIMATED_FILES_PER_DIRECTORY, Math.round(sampledFiles / Math.max(1, sampledDirectories)))
          );
          const estimatedTotalItems = Math.max(sampledFiles, pendingDirs.length * density);
          const percent = Math.max(
            progressPercentFloor,
            Math.min(
              SURVEY_PROGRESS_MAX,
              Math.max(1, Math.round((sampledDirectories / SURVEY_DIRECTORY_LIMIT) * SURVEY_PROGRESS_MAX))
            )
          );
          progressPercentFloor = percent;
          options.onProgress({
            runId,
            stage: "surveying",
            processedItems: 0,
            findingsCount: 0,
            percent,
            etaSec: 0,
            processedDirectories: sampledDirectories,
            estimatedTotalItems,
            estimatedRemainingItems: Math.max(0, estimatedTotalItems),
            scanDensity: density
          });
        }
      }

      for (const [areaKey, sample] of areaSamples.entries()) {
        if (!sample.signature || sample.sampledDirectories <= 0) {
          continue;
        }
        setCachedScanAreaSurveyEstimate(areaKey, sample.signature, {
          sampledDirectories: sample.sampledDirectories,
          sampledFiles: sample.sampledFiles
        });
      }

      return {
        sampledDirectories,
        sampledFiles,
        areaEstimates: Object.fromEntries(
          [...areaSamples.entries()].map(([key, value]) => [
            normalizeCacheKey(key),
            {
              sampledDirectories: value.sampledDirectories,
              sampledFiles: value.sampledFiles
            }
          ])
        )
      };
    };

    surveyStats = await surveyRoots();
    estimatedFilesPerDirectory = Math.max(
      MIN_ESTIMATED_FILES_PER_DIRECTORY,
      Math.min(
        MAX_ESTIMATED_FILES_PER_DIRECTORY,
        Math.round(surveyStats.sampledFiles / Math.max(1, surveyStats.sampledDirectories))
      )
    );
    plannedFileItems = pendingDirs.length * estimatedFilesPerDirectory;
    plannedWorkUnits = pendingDirs.length * estimatedDirectoryWorkUnits();
    progressPercentFloor = Math.max(progressPercentFloor, SURVEY_PROGRESS_MAX);

    const processDirectory = async (currentDir: string): Promise<void> => {
      if (options.isCanceled()) {
        return;
      }

      const containerRule = matchCleanupContainerDirectory(currentDir, request.categories);
      if (containerRule) {
        const protectionDecision = resolveProtectionDecision(currentDir, installedApps, protectionPreferences);
        if (protectionDecision) {
          processedDirectories += 1;
          completedWorkUnits += 1;
          summary.protectedRejectedCount += 1;
          if (rejected.length < MAX_REJECTED_RECORDS) {
            rejected.push(buildRejectedFinding(currentDir, containerRule.category, containerRule.id, protectionDecision));
          } else {
            summary.protectedRejectedTruncated = true;
          }
          emitProgress();
          return;
        }

        const directoryStats = await fs.stat(currentDir).catch(() => null);
        const cachedSummary =
          directoryStats && directoryStats.isDirectory()
            ? getCachedContainerDirectorySummary(currentDir, directoryStats.mtimeMs)
            : null;

        let directoryEntryCount = 0;
        let directorySizeBytes = 0;
        let directoryLatestModifiedAt = 0;
        if (cachedSummary) {
          const nestedDirectoryCount = Math.max(0, cachedSummary.directoryCount - 1);
          processedDirectories += cachedSummary.directoryCount;
          summary.processedItems += cachedSummary.fileCount;
          directoryEntryCount = cachedSummary.fileCount;
          directorySizeBytes = cachedSummary.sizeBytes;
          directoryLatestModifiedAt = cachedSummary.latestModifiedAt;
          plannedFileItems += nestedDirectoryCount * estimatedFilesPerDirectory;
          plannedWorkUnits += nestedDirectoryCount * estimatedDirectoryWorkUnits();
          const actualWorkUnits = cachedSummary.fileCount + cachedSummary.directoryCount;
          const estimatedWorkUnitsForAllDirectories = cachedSummary.directoryCount * estimatedDirectoryWorkUnits();
          if (actualWorkUnits > estimatedWorkUnitsForAllDirectories) {
            plannedWorkUnits += actualWorkUnits - estimatedWorkUnitsForAllDirectories;
          }
          completedWorkUnits += actualWorkUnits;
          emitProgress();
        } else {
          const containerSummary = await summarizeContainerDirectory(currentDir, {
            isCanceled: options.isCanceled,
            onDirectoryProcessed: async (progress) => {
              processedDirectories += 1;
              summary.processedItems += progress.fileCount;
              directoryEntryCount += progress.fileCount;
              directorySizeBytes += progress.sizeBytes;
              directoryLatestModifiedAt = Math.max(directoryLatestModifiedAt, progress.latestModifiedAt);
              plannedFileItems += progress.childDirectoriesDiscovered * estimatedFilesPerDirectory;
              plannedWorkUnits += progress.childDirectoriesDiscovered * estimatedDirectoryWorkUnits();
              const actualDirectoryWorkUnits = progress.fileCount + 1;
              const estimatedWorkUnitsForDirectory = estimatedDirectoryWorkUnits();
              if (actualDirectoryWorkUnits > estimatedWorkUnitsForDirectory) {
                plannedWorkUnits += actualDirectoryWorkUnits - estimatedWorkUnitsForDirectory;
              }
              completedWorkUnits += actualDirectoryWorkUnits;
              emitProgress();

              if (summary.processedItems - yieldedAtProcessed >= YIELD_INTERVAL) {
                yieldedAtProcessed = summary.processedItems;
                await yieldToEventLoop();
              }
            }
          });
          if (directoryStats && directoryStats.isDirectory()) {
            setCachedContainerDirectorySummary(currentDir, directoryStats.mtimeMs, containerSummary);
          }
        }

        if (directoryEntryCount > 0) {
          const risk = getRiskLevel(currentDir, containerRule.category);
          const selectedByDefault = shouldSelectByDefault(request.preset, containerRule.category, risk);
          const finding: ScanFinding = {
            id: randomUUID(),
            path: currentDir,
            category: containerRule.category,
            sizeBytes: directorySizeBytes,
            risk,
            reason: containerRule.reason,
            sourceRuleId: containerRule.id,
            selectedByDefault,
            modifiedAt: directoryLatestModifiedAt || Date.now(),
            kind: "directory",
            entryCount: directoryEntryCount
          };
          findings.push(finding);
          summary.findingsCount += finding.entryCount ?? 1;
          summary.totalCandidateBytes += finding.sizeBytes;
          summary.categories[finding.category].count += finding.entryCount ?? 1;
          summary.categories[finding.category].bytes += finding.sizeBytes;
        }
        return;
      }

      let entries: Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      processedDirectories += 1;
      const candidatePaths: CandidatePathRecord[] = [];
      let fileCount = 0;
      const hotDirectories: string[] = [];
      const normalDirectories: string[] = [];
      const currentIsScanRoot = roots.some(
        (root) => path.normalize(root).toLowerCase() === path.normalize(currentDir).toLowerCase()
      );
      let estimatedChildDirectories = 0;
      let estimatedChildFiles = 0;
      for (const entry of entries) {
        const targetPath = path.join(currentDir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          if (shouldSkipDirectory(targetPath)) {
            continue;
          }
          if (matchCleanupContainerDirectory(targetPath, request.categories)) {
            hotDirectories.push(targetPath);
          } else {
            normalDirectories.push(targetPath);
            if (currentIsScanRoot) {
              const areaEstimate = surveyStats.areaEstimates[normalizeCacheKey(targetPath)];
              if (areaEstimate) {
                estimatedChildDirectories += areaEstimate.sampledDirectories;
                estimatedChildFiles += areaEstimate.sampledFiles;
              }
            }
          }
          continue;
        }
        if (entry.isFile()) {
          fileCount += 1;
          const matchedRule = matchCleanupPath(targetPath, request.categories);
          if (matchedRule) {
            candidatePaths.push({
              targetPath,
              matchedRule
            });
          }
        }
      }
      const childDirectories = hotDirectories.length + normalDirectories.length;
      pendingDirs.push(...normalDirectories, ...hotDirectories);
      summary.processedItems += fileCount;
      const estimatedChildrenApplied = currentIsScanRoot
        ? normalDirectories.filter((targetPath) => Boolean(surveyStats.areaEstimates[normalizeCacheKey(targetPath)])).length
        : 0;
      const remainingGenericChildren = Math.max(0, childDirectories - estimatedChildrenApplied);
      plannedFileItems += estimatedChildFiles + remainingGenericChildren * estimatedFilesPerDirectory;
      plannedWorkUnits +=
        estimatedChildFiles +
        estimatedChildDirectories +
        remainingGenericChildren * estimatedDirectoryWorkUnits();
      const actualDirectoryWorkUnits = fileCount + 1;
      const estimatedWorkUnitsForDirectory = estimatedDirectoryWorkUnits();
      if (actualDirectoryWorkUnits > estimatedWorkUnitsForDirectory) {
        plannedWorkUnits += actualDirectoryWorkUnits - estimatedWorkUnitsForDirectory;
      }

      let directoryReportedWorkUnits = 0;
      const advanceDirectoryWorkUnits = (targetUnits: number): void => {
        if (targetUnits <= directoryReportedWorkUnits) {
          return;
        }
        const delta = targetUnits - directoryReportedWorkUnits;
        directoryReportedWorkUnits = targetUnits;
        completedWorkUnits += delta;
        refreshRateEstimate();
      };

      advanceDirectoryWorkUnits(1);
      if (candidatePaths.length === 0) {
        advanceDirectoryWorkUnits(actualDirectoryWorkUnits);
        emitProgress();
      }

      let processedCandidates = 0;
      for (let index = 0; index < candidatePaths.length; index += SCAN_FILE_CHUNK) {
        if (options.isCanceled()) {
          return;
        }

        const chunkRecords = candidatePaths.slice(index, index + SCAN_FILE_CHUNK);
        const chunkFindings = await mapWithConcurrency(chunkRecords, FILE_WORKERS, async ({ targetPath, matchedRule }) => {
          const protectionDecision = resolveProtectionDecision(targetPath, installedApps, protectionPreferences);

          if (protectionDecision) {
            return {
              type: "rejected" as const,
              item: buildRejectedFinding(targetPath, matchedRule.category, matchedRule.id, protectionDecision)
            };
          }

          try {
            const stats = await fs.stat(targetPath);
            if (!stats.isFile()) {
              return null;
            }

            const category = matchedRule.category;
            const risk = getRiskLevel(targetPath, category);
            const selectedByDefault = shouldSelectByDefault(request.preset, category, risk);
            const finding: ScanFinding = {
              id: randomUUID(),
              path: targetPath,
              category,
              sizeBytes: stats.size,
              risk,
              reason: matchedRule.reason,
              sourceRuleId: matchedRule.id,
              selectedByDefault,
              modifiedAt: stats.mtimeMs
            };
            return { type: "finding" as const, item: finding };
          } catch {
            return null;
          }
        });

        for (const entry of chunkFindings) {
          if (!entry) {
            continue;
          }
          if (entry.type === "rejected") {
            summary.protectedRejectedCount += 1;
            if (rejected.length < MAX_REJECTED_RECORDS) {
              rejected.push(entry.item);
            } else {
              summary.protectedRejectedTruncated = true;
            }
            continue;
          }
          findings.push(entry.item);
          summary.findingsCount += entry.item.entryCount ?? 1;
          summary.totalCandidateBytes += entry.item.sizeBytes;
          summary.categories[entry.item.category].count += entry.item.entryCount ?? 1;
          summary.categories[entry.item.category].bytes += entry.item.sizeBytes;
        }
        processedCandidates += chunkRecords.length;
        const directoryProgressRatio = processedCandidates / Math.max(1, candidatePaths.length);
        advanceDirectoryWorkUnits(
          Math.min(
            actualDirectoryWorkUnits,
            1 + Math.round((actualDirectoryWorkUnits - 1) * directoryProgressRatio)
          )
        );
        emitProgress();

        if (summary.processedItems - yieldedAtProcessed >= YIELD_INTERVAL) {
          yieldedAtProcessed = summary.processedItems;
          await yieldToEventLoop();
        }
      }

      advanceDirectoryWorkUnits(actualDirectoryWorkUnits);
    };

    await new Promise<void>((resolve) => {
      let active = 0;
      let drained = false;

      const schedule = (): void => {
        if (drained) {
          return;
        }
        if (options.isCanceled()) {
          drained = true;
          resolve();
          return;
        }

        while (active < DIRECTORY_WORKERS && pendingDirs.length > 0) {
          const currentDir = pendingDirs.pop() as string;
          active += 1;
          void processDirectory(currentDir)
            .catch(() => {
              // Ignore per-directory failures.
            })
            .finally(() => {
              active -= 1;
              schedule();
            });
        }

        if (active === 0 && pendingDirs.length === 0) {
          drained = true;
          resolve();
        }
      };

      schedule();
    });

    if (options.isCanceled()) {
      summary.status = "canceled";
      summary.finishedAt = Date.now();
      options.onProgress({
        runId,
        stage: "canceled",
        processedItems: summary.processedItems,
        findingsCount: summary.findingsCount,
        percent: 100,
        etaSec: 0,
        processedDirectories,
        estimatedTotalItems: Math.max(summary.processedItems, Math.round(plannedFileItems)),
        estimatedRemainingItems: 0,
        scanDensity:
          processedDirectories > 0
            ? Number((summary.processedItems / Math.max(1, processedDirectories)).toFixed(1))
            : Number((surveyStats.sampledFiles / Math.max(1, surveyStats.sampledDirectories)).toFixed(1))
      });
      return { findings, rejected, summary };
    }

    summary.status = "completed";
    summary.finishedAt = Date.now();
    options.onProgress({
      runId,
      stage: "analyzing",
      processedItems: summary.processedItems,
      findingsCount: summary.findingsCount,
      percent: ANALYZE_PROGRESS_START,
      etaSec: 0,
      processedDirectories,
      estimatedTotalItems: Math.max(summary.processedItems, Math.round(plannedFileItems)),
      estimatedRemainingItems: 0,
      scanDensity:
        processedDirectories > 0
          ? Number((summary.processedItems / Math.max(1, processedDirectories)).toFixed(1))
          : Number((surveyStats.sampledFiles / Math.max(1, surveyStats.sampledDirectories)).toFixed(1))
    });
    options.onProgress({
      runId,
      stage: "completed",
      processedItems: summary.processedItems,
      findingsCount: summary.findingsCount,
      percent: 100,
      etaSec: 0,
      processedDirectories,
      estimatedTotalItems: Math.max(summary.processedItems, Math.round(plannedFileItems)),
      estimatedRemainingItems: 0,
      scanDensity:
        processedDirectories > 0
          ? Number((summary.processedItems / Math.max(1, processedDirectories)).toFixed(1))
          : Number((surveyStats.sampledFiles / Math.max(1, surveyStats.sampledDirectories)).toFixed(1))
    });

    return { findings, rejected, summary };
  }
}

function buildRejectedFinding(
  targetPath: string,
  category: CleanupCategory,
  sourceRuleId: string,
  protectionDecision: ReturnType<typeof resolveProtectionDecision>
): ProtectedFindingRejection {
  return {
    path: targetPath,
    category,
    sourceRuleId,
    protectionKind: protectionDecision?.kind ?? "binary_extension",
    reason: protectionDecision?.reason ?? "Blocked by safety policy.",
    matchedAppName: protectionDecision?.matchedAppName
  };
}
