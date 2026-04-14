import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { parseJsonPayload } from "./jsonPayload";
import { withTimeout } from "./asyncUtils";
import {
  InstalledAppUsage,
  StorageAreaCategory,
  StorageAreaUsage,
  StorageContainerUsage,
  StorageDriveUsage,
  StorageFileUsage,
  StorageFolderUsage,
  StorageScanResponse,
  StorageTreemapNode
} from "./types";
import { detectMachineRoots } from "./machineProfileService";
import { readPersistentJsonCache, schedulePersistentJsonCacheWrite } from "./persistentJsonCache";
import {
  getDefaultRoots,
  matchesCachePath,
  matchesCrashDumpPath,
  matchesLogsPath,
  matchesTempPath,
  matchesWslLeftoversPath
} from "./rulePack";
import { isInstallerPackagePath } from "./safetyPolicy";

const execFileAsync = promisify(execFile);
const LARGEST_FILES_LIMIT = 30;
const TOP_FOLDERS_LIMIT = 24;
const TOP_AREAS_LIMIT = 18;
const TOP_DRIVES_LIMIT = 8;
const TOP_CONTAINERS_LIMIT = 16;
const INSTALLED_APPS_TIMEOUT_MS = 3_500;
const STORAGE_SCAN_CACHE_TTL_MS = 45 * 1000;
const STORAGE_CONTAINER_INDEX_TTL_MS = 20 * 60 * 1000;
const STORAGE_CONTAINER_INDEX_FILE = "storage-container-index.json";
const STORAGE_CONTAINER_INDEX_MAX_ENTRIES = 800;
const STORAGE_AREA_INDEX_TTL_MS = 20 * 60 * 1000;
const STORAGE_AREA_INDEX_FILE = "storage-area-index.json";
const STORAGE_AREA_INDEX_MAX_ENTRIES = 240;
const DIRECTORY_SCAN_WORKERS =
  typeof os.availableParallelism === "function"
    ? Math.max(4, Math.min(16, os.availableParallelism()))
    : Math.max(4, Math.min(16, os.cpus().length));
const FILE_STAT_BATCH_SIZE = 48;
const AREA_SUMMARY_TOP_FOLDERS_LIMIT = 96;
const AREA_SUMMARY_TOP_CONTAINERS_LIMIT = 40;
const AREA_SUMMARY_LARGEST_FILES_LIMIT = 40;

interface FolderAggregate {
  sizeBytes: number;
  fileCount: number;
}

interface AreaAggregate extends FolderAggregate {
  label: string;
  category: StorageAreaCategory;
  path: string;
  cachedFromIndex?: boolean;
}

interface StorageContainerSummary {
  path: string;
  label: string;
  category: StorageContainerUsage["category"];
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  largestFiles: StorageFileUsage[];
}

interface CachedStorageScan {
  key: string;
  value: StorageScanResponse;
  cachedAt: number;
}

interface CachedStorageContainerSummary {
  mtimeMs: number;
  value: StorageContainerSummary;
  cachedAt: number;
}

interface StorageAreaSignature {
  mtimeMs: number;
  entryCount: number;
  entryDigest: string;
}

interface StorageAreaSummary {
  path: string;
  label: string;
  category: StorageAreaCategory;
  sizeBytes: number;
  fileCount: number;
  folderStats: StorageFolderUsage[];
  topContainers: StorageContainerUsage[];
  largestFiles: StorageFileUsage[];
}

interface CachedStorageAreaSummary {
  signature: StorageAreaSignature;
  value: StorageAreaSummary;
  cachedAt: number;
}

let storageScanCache: CachedStorageScan | null = null;
let storageScanInFlight:
  | {
      key: string;
      promise: Promise<StorageScanResponse>;
    }
  | null = null;
const storageContainerIndex = new Map<string, CachedStorageContainerSummary>();
let storageContainerIndexLoaded = false;
let storageContainerIndexLoadPromise: Promise<void> | null = null;
const storageAreaIndex = new Map<string, CachedStorageAreaSummary>();
let storageAreaIndexLoaded = false;
let storageAreaIndexLoadPromise: Promise<void> | null = null;

const TEMP_CONTAINER_NAMES = new Set(["temp", "tmp", "tempstate", "squirreltemp"]);
const CACHE_CONTAINER_NAMES = new Set([
  "cache",
  "code cache",
  "gpucache",
  "shadercache",
  "shader cache",
  "grshadercache",
  "dawncache",
  "webcache",
  "inetcache",
  "cachestorage",
  "cacheddata",
  "localcache",
  "blob_storage",
  "dxcache",
  "glcache",
  "nv_cache"
]);
const LOG_CONTAINER_NAMES = new Set(["logs", "logfiles", "wer", "diagnosis", "diagnostics", "squirrelsetup"]);
const WSL_CONTAINER_NAMES = new Set([
  ...TEMP_CONTAINER_NAMES,
  ...CACHE_CONTAINER_NAMES,
  ...LOG_CONTAINER_NAMES,
  "crashdumps"
]);
const INSTALLER_CONTAINER_NAMES = new Set(["package cache", "downloader"]);

function normalizeRoot(root: string): string {
  return path.normalize(root);
}

function normalizeLowerPath(inputPath: string): string {
  return normalizeRoot(inputPath).replace(/\//g, "\\").toLowerCase();
}

function normalizedDirectoryProbe(inputPath: string): string {
  const normalized = normalizeRoot(inputPath);
  return normalized.endsWith(path.sep) ? normalized : `${normalized}${path.sep}`;
}

function normalizedBaseName(inputPath: string): string {
  return path.basename(normalizeRoot(inputPath).replace(/[\\\/]+$/g, "")).toLowerCase();
}

function uniqueNormalized(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = normalizeRoot(item);
    const key = normalizeLowerPath(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function trimStorageContainerIndex(): void {
  if (storageContainerIndex.size <= STORAGE_CONTAINER_INDEX_MAX_ENTRIES) {
    return;
  }

  const sorted = [...storageContainerIndex.entries()].sort((left, right) => right[1].cachedAt - left[1].cachedAt);
  storageContainerIndex.clear();
  for (const [key, value] of sorted.slice(0, STORAGE_CONTAINER_INDEX_MAX_ENTRIES)) {
    storageContainerIndex.set(key, value);
  }
}

async function ensureStorageContainerIndexLoaded(): Promise<void> {
  if (storageContainerIndexLoaded) {
    return;
  }
  if (!storageContainerIndexLoadPromise) {
    storageContainerIndexLoadPromise = (async () => {
      const entries = await readPersistentJsonCache<CachedStorageContainerSummary>(STORAGE_CONTAINER_INDEX_FILE);
      for (const [key, value] of Object.entries(entries)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        storageContainerIndex.set(key, value);
      }
      trimStorageContainerIndex();
      storageContainerIndexLoaded = true;
    })().finally(() => {
      storageContainerIndexLoadPromise = null;
    });
  }
  await storageContainerIndexLoadPromise;
}

function persistStorageContainerIndex(): void {
  trimStorageContainerIndex();
  schedulePersistentJsonCacheWrite(
    STORAGE_CONTAINER_INDEX_FILE,
    Object.fromEntries(storageContainerIndex.entries())
  );
}

function trimStorageAreaIndex(): void {
  if (storageAreaIndex.size <= STORAGE_AREA_INDEX_MAX_ENTRIES) {
    return;
  }

  const sorted = [...storageAreaIndex.entries()].sort((left, right) => right[1].cachedAt - left[1].cachedAt);
  storageAreaIndex.clear();
  for (const [key, value] of sorted.slice(0, STORAGE_AREA_INDEX_MAX_ENTRIES)) {
    storageAreaIndex.set(key, value);
  }
}

async function ensureStorageAreaIndexLoaded(): Promise<void> {
  if (storageAreaIndexLoaded) {
    return;
  }
  if (!storageAreaIndexLoadPromise) {
    storageAreaIndexLoadPromise = (async () => {
      const entries = await readPersistentJsonCache<CachedStorageAreaSummary>(STORAGE_AREA_INDEX_FILE);
      for (const [key, value] of Object.entries(entries)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        storageAreaIndex.set(key, value);
      }
      trimStorageAreaIndex();
      storageAreaIndexLoaded = true;
    })().finally(() => {
      storageAreaIndexLoadPromise = null;
    });
  }
  await storageAreaIndexLoadPromise;
}

function persistStorageAreaIndex(): void {
  trimStorageAreaIndex();
  schedulePersistentJsonCacheWrite(
    STORAGE_AREA_INDEX_FILE,
    Object.fromEntries(storageAreaIndex.entries())
  );
}

function buildAreaSignature(
  directoryPath: string,
  stats: { mtimeMs: number },
  entries: Dirent[]
): StorageAreaSignature {
  const entryDigest = entries
    .map((entry) => `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : "x"}:${entry.name.toLowerCase()}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return {
    mtimeMs: stats.mtimeMs,
    entryCount: entries.length,
    entryDigest: `${normalizeLowerPath(directoryPath)}|${entryDigest}`
  };
}

function getCachedStorageAreaSummary(
  directoryPath: string,
  signature: StorageAreaSignature
): StorageAreaSummary | null {
  const cached = storageAreaIndex.get(normalizeLowerPath(directoryPath));
  if (!cached) {
    return null;
  }
  if (
    cached.signature.mtimeMs !== signature.mtimeMs ||
    cached.signature.entryCount !== signature.entryCount ||
    cached.signature.entryDigest !== signature.entryDigest
  ) {
    storageAreaIndex.delete(normalizeLowerPath(directoryPath));
    return null;
  }
  if (Date.now() - cached.cachedAt > STORAGE_AREA_INDEX_TTL_MS) {
    storageAreaIndex.delete(normalizeLowerPath(directoryPath));
    return null;
  }
  return {
    ...cached.value,
    folderStats: [...cached.value.folderStats],
    topContainers: [...cached.value.topContainers],
    largestFiles: [...cached.value.largestFiles]
  };
}

function setCachedStorageAreaSummary(
  directoryPath: string,
  signature: StorageAreaSignature,
  value: StorageAreaSummary
): void {
  storageAreaIndex.set(normalizeLowerPath(directoryPath), {
    signature,
    value: {
      ...value,
      folderStats: [...value.folderStats],
      topContainers: [...value.topContainers],
      largestFiles: [...value.largestFiles]
    },
    cachedAt: Date.now()
  });
  persistStorageAreaIndex();
}

function shouldSkipStorageDirectory(targetPath: string): boolean {
  const normalized = normalizeLowerPath(targetPath);
  return (
    normalized.endsWith("\\$recycle.bin") ||
    normalized.includes("\\$recycle.bin\\") ||
    normalized.endsWith("\\system volume information") ||
    normalized.includes("\\system volume information\\") ||
    normalized.endsWith("\\recovery") ||
    normalized.includes("\\recovery\\")
  );
}

function storageContainerLabel(category: StorageContainerUsage["category"]): string {
  switch (category) {
    case "temp":
      return "Temp containers";
    case "cache":
      return "Cache containers";
    case "logs":
      return "Log containers";
    case "crash_dumps":
      return "Crash dump containers";
    case "wsl_leftovers":
      return "WSL + container residue";
    case "installer_artifacts":
      return "Installer residue containers";
    default:
      return "Storage containers";
  }
}

function matchStorageContainerDirectory(
  directoryPath: string
): { label: string; category: StorageContainerUsage["category"] } | null {
  const baseName = normalizedBaseName(directoryPath);
  const probe = normalizedDirectoryProbe(directoryPath);

  if (TEMP_CONTAINER_NAMES.has(baseName) && matchesTempPath(probe)) {
    return {
      label: storageContainerLabel("temp"),
      category: "temp"
    };
  }
  if (CACHE_CONTAINER_NAMES.has(baseName) && matchesCachePath(probe)) {
    return {
      label: storageContainerLabel("cache"),
      category: "cache"
    };
  }
  if (LOG_CONTAINER_NAMES.has(baseName) && matchesLogsPath(probe)) {
    return {
      label: storageContainerLabel("logs"),
      category: "logs"
    };
  }
  if (baseName === "crashdumps" && matchesCrashDumpPath(probe)) {
    return {
      label: storageContainerLabel("crash_dumps"),
      category: "crash_dumps"
    };
  }
  if (WSL_CONTAINER_NAMES.has(baseName) && matchesWslLeftoversPath(probe)) {
    return {
      label: storageContainerLabel("wsl_leftovers"),
      category: "wsl_leftovers"
    };
  }
  if (INSTALLER_CONTAINER_NAMES.has(baseName) && isInstallerPackagePath(probe)) {
    return {
      label: storageContainerLabel("installer_artifacts"),
      category: "installer_artifacts"
    };
  }

  return null;
}

function findMatchedRoot(filePath: string, roots: string[]): string | null {
  const normalizedFile = normalizeLowerPath(filePath);
  const matches = roots
    .filter((root) => {
      const normalizedRoot = normalizeLowerPath(root);
      return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}\\`);
    })
    .sort((left, right) => right.length - left.length);
  return matches[0] ?? null;
}

function computeFolderBucket(filePath: string, roots: string[]): string {
  const matchedRoot = findMatchedRoot(filePath, roots);
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

function classifyAreaLabel(segment: string): { label: string; category: StorageAreaCategory } {
  const normalized = segment.toLowerCase();
  if (normalized === "windows") {
    return { label: "Windows system", category: "system" };
  }
  if (normalized === "program files") {
    return { label: "Installed programs", category: "programs" };
  }
  if (normalized === "program files (x86)") {
    return { label: "Installed programs (32-bit)", category: "programs" };
  }
  if (normalized === "programdata") {
    return { label: "Shared app data", category: "program_data" };
  }
  if (normalized === "users") {
    return { label: "User profiles", category: "users" };
  }
  if (
    normalized === "steamlibrary" ||
    normalized === "games" ||
    normalized === "epic games" ||
    normalized === "xboxgames" ||
    normalized === "riot games" ||
    normalized === "gog games" ||
    normalized === "ea games"
  ) {
    return { label: "Game libraries", category: "games" };
  }
  if (normalized.includes("cache")) {
    return { label: "Cache stores", category: "cache" };
  }
  if (normalized.includes("log")) {
    return { label: "Log stores", category: "logs" };
  }
  if (normalized.includes("wsl") || normalized.includes("docker")) {
    return { label: "WSL and containers", category: "wsl" };
  }
  return { label: segment || "Miscellaneous", category: "other" };
}

function computeAreaBucket(
  filePath: string,
  roots: string[]
): { key: string; label: string; category: StorageAreaCategory } {
  const matchedRoot = findMatchedRoot(filePath, roots);
  const fallbackRoot = path.parse(filePath).root || path.dirname(filePath);
  const root = matchedRoot ?? fallbackRoot;
  const relative = path.relative(root, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  if (!parts.length) {
    return {
      key: root,
      label: root,
      category: "other"
    };
  }

  const firstSegment = parts[0];
  const classification = classifyAreaLabel(firstSegment);
  return {
    key: path.join(root, firstSegment),
    label: classification.label,
    category: classification.category
  };
}

function pushTopFile(items: StorageFileUsage[], nextItem: StorageFileUsage): void {
  items.push(nextItem);
  items.sort((left, right) => left.sizeBytes - right.sizeBytes);
  if (items.length > LARGEST_FILES_LIMIT) {
    items.shift();
  }
}

function pushTopFileWithLimit(items: StorageFileUsage[], nextItem: StorageFileUsage, limit: number): void {
  items.push(nextItem);
  items.sort((left, right) => left.sizeBytes - right.sizeBytes);
  if (items.length > limit) {
    items.shift();
  }
}

function isAreaCacheEligible(parentPath: string, childPath: string, roots: string[]): boolean {
  const normalizedParent = normalizeLowerPath(parentPath);
  if (!roots.some((root) => normalizeLowerPath(root) === normalizedParent)) {
    return false;
  }
  return !matchStorageContainerDirectory(childPath);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getCachedStorageContainerSummary(
  directoryPath: string,
  mtimeMs: number
): StorageContainerSummary | null {
  const key = normalizeLowerPath(directoryPath);
  const cached = storageContainerIndex.get(key);
  if (!cached) {
    return null;
  }
  if (cached.mtimeMs !== mtimeMs) {
    storageContainerIndex.delete(key);
    return null;
  }
  if (Date.now() - cached.cachedAt > STORAGE_CONTAINER_INDEX_TTL_MS) {
    storageContainerIndex.delete(key);
    return null;
  }
  return {
    ...cached.value,
    largestFiles: [...cached.value.largestFiles]
  };
}

function setCachedStorageContainerSummary(
  directoryPath: string,
  mtimeMs: number,
  value: StorageContainerSummary
): void {
  storageContainerIndex.set(normalizeLowerPath(directoryPath), {
    mtimeMs,
    value: {
      ...value,
      largestFiles: [...value.largestFiles]
    },
    cachedAt: Date.now()
  });
  persistStorageContainerIndex();
}

async function summarizeStorageContainerDirectory(
  directoryPath: string,
  category: StorageContainerUsage["category"],
  label: string
): Promise<StorageContainerSummary> {
  const pending = [normalizeRoot(directoryPath)];
  const largestFiles: StorageFileUsage[] = [];
  let activeWorkers = 0;
  let sizeBytes = 0;
  let fileCount = 0;
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
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipStorageDirectory(target)) {
          continue;
        }
        pending.push(target);
        continue;
      }
      if (entry.isFile()) {
        fileTargets.push(target);
      }
    }

    for (const group of chunkItems(fileTargets, FILE_STAT_BATCH_SIZE)) {
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

        const { target, stats } = item.value;
        fileCount += 1;
        sizeBytes += stats.size;
        pushTopFile(largestFiles, {
          path: target,
          sizeBytes: stats.size,
          modifiedAt: stats.mtimeMs
        });
      }
    }
  };

  const workers = Array.from({ length: Math.min(DIRECTORY_SCAN_WORKERS, pending.length || 1) }, async () => {
    while (true) {
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
    path: directoryPath,
    label,
    category,
    sizeBytes,
    fileCount,
    directoryCount,
    largestFiles: [...largestFiles].sort((left, right) => right.sizeBytes - left.sizeBytes)
  };
}

async function summarizeStorageAreaDirectory(
  directoryPath: string,
  roots: string[]
): Promise<StorageAreaSummary> {
  const classification = classifyAreaLabel(path.basename(directoryPath));
  const pending = [normalizeRoot(directoryPath)];
  const folderStats = new Map<string, FolderAggregate>();
  const topContainers: StorageContainerUsage[] = [];
  const largestFiles: StorageFileUsage[] = [];
  let sizeBytes = 0;
  let fileCount = 0;
  let activeWorkers = 0;

  const mergeContainerSummary = (summary: StorageContainerSummary, cachedFromIndex: boolean): void => {
    const folderBucket = folderStats.get(summary.path) ?? { sizeBytes: 0, fileCount: 0 };
    folderBucket.sizeBytes += summary.sizeBytes;
    folderBucket.fileCount += summary.fileCount;
    folderStats.set(summary.path, folderBucket);

    sizeBytes += summary.sizeBytes;
    fileCount += summary.fileCount;
    for (const file of summary.largestFiles) {
      pushTopFileWithLimit(largestFiles, file, AREA_SUMMARY_LARGEST_FILES_LIMIT);
    }
    topContainers.push({
      path: summary.path,
      label: summary.label,
      category: summary.category,
      sizeBytes: summary.sizeBytes,
      fileCount: summary.fileCount,
      cachedFromIndex
    });
  };

  const processDirectory = async (current: string): Promise<void> => {
    const containerMatch = matchStorageContainerDirectory(current);
    if (containerMatch && normalizeLowerPath(current) !== normalizeLowerPath(directoryPath)) {
      const directoryStats = await fs.stat(current).catch(() => null);
      const cached =
        directoryStats && directoryStats.isDirectory()
          ? getCachedStorageContainerSummary(current, directoryStats.mtimeMs)
          : null;
      if (cached) {
        mergeContainerSummary(cached, true);
        return;
      }

      const summary = await summarizeStorageContainerDirectory(current, containerMatch.category, containerMatch.label);
      if (directoryStats && directoryStats.isDirectory()) {
        setCachedStorageContainerSummary(current, directoryStats.mtimeMs, summary);
      }
      mergeContainerSummary(summary, false);
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    const fileTargets: string[] = [];
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipStorageDirectory(target)) {
          continue;
        }
        pending.push(target);
        continue;
      }
      if (entry.isFile()) {
        fileTargets.push(target);
      }
    }

    for (const group of chunkItems(fileTargets, FILE_STAT_BATCH_SIZE)) {
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

        const { target, stats } = item.value;
        const folderBucketPath = computeFolderBucket(target, roots);
        const folderBucket = folderStats.get(folderBucketPath) ?? { sizeBytes: 0, fileCount: 0 };
        folderBucket.sizeBytes += stats.size;
        folderBucket.fileCount += 1;
        folderStats.set(folderBucketPath, folderBucket);

        sizeBytes += stats.size;
        fileCount += 1;
        pushTopFileWithLimit(largestFiles, {
          path: target,
          sizeBytes: stats.size,
          modifiedAt: stats.mtimeMs
        }, AREA_SUMMARY_LARGEST_FILES_LIMIT);
      }
    }
  };

  const workers = Array.from({ length: Math.min(DIRECTORY_SCAN_WORKERS, pending.length || 1) }, async () => {
    while (true) {
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
    path: directoryPath,
    label: classification.label,
    category: classification.category,
    sizeBytes,
    fileCount,
    folderStats: [...folderStats.entries()]
      .map(([entryPath, aggregate]) => ({
        path: entryPath,
        sizeBytes: aggregate.sizeBytes,
        fileCount: aggregate.fileCount
      }))
      .sort((left, right) => right.sizeBytes - left.sizeBytes)
      .slice(0, AREA_SUMMARY_TOP_FOLDERS_LIMIT),
    topContainers: [...topContainers]
      .sort((left, right) => right.sizeBytes - left.sizeBytes || right.fileCount - left.fileCount)
      .slice(0, AREA_SUMMARY_TOP_CONTAINERS_LIMIT),
    largestFiles: [...largestFiles].sort((left, right) => right.sizeBytes - left.sizeBytes)
  };
}

async function resolveEffectiveRoots(roots: string[]): Promise<string[]> {
  const normalizedInput = uniqueNormalized(roots.filter(Boolean));
  if (normalizedInput.length > 0) {
    return normalizedInput;
  }

  const machineRoots =
    process.platform === "win32" ? await detectMachineRoots().catch(() => [] as string[]) : [];
  if (machineRoots.length > 0) {
    return uniqueNormalized(machineRoots);
  }
  return uniqueNormalized(getDefaultRoots([], "deep"));
}

async function collectFilesystemUsage(roots: string[]): Promise<{
  scannedRoots: string[];
  driveStats: StorageDriveUsage[];
  areaStats: StorageAreaUsage[];
  topContainers: StorageContainerUsage[];
  folderStats: Map<string, FolderAggregate>;
  largestFiles: StorageFileUsage[];
  totalBytes: number;
  totalFiles: number;
}> {
  await ensureStorageContainerIndexLoaded();
  await ensureStorageAreaIndexLoaded();
  const effectiveRoots = await resolveEffectiveRoots(roots);
  const folderStats = new Map<string, FolderAggregate>();
  const areaStats = new Map<string, AreaAggregate>();
  const driveStats = new Map<string, FolderAggregate>();
  const topContainers: StorageContainerUsage[] = [];
  const largestFiles: StorageFileUsage[] = [];
  const pending = [...effectiveRoots.map(normalizeRoot)];
  let totalBytes = 0;
  let totalFiles = 0;
  let activeWorkers = 0;

  const mergeContainerSummary = (summary: StorageContainerSummary, cachedFromIndex: boolean): void => {
    const folderBucket = folderStats.get(summary.path) ?? { sizeBytes: 0, fileCount: 0 };
    folderBucket.sizeBytes += summary.sizeBytes;
    folderBucket.fileCount += summary.fileCount;
    folderStats.set(summary.path, folderBucket);

    const area = computeAreaBucket(summary.path, effectiveRoots);
    const areaBucket = areaStats.get(area.key) ?? {
      sizeBytes: 0,
      fileCount: 0,
      label: area.label,
      category: area.category,
      path: area.key
    };
    areaBucket.sizeBytes += summary.sizeBytes;
    areaBucket.fileCount += summary.fileCount;
    areaStats.set(area.key, areaBucket);

    const driveRoot = findMatchedRoot(summary.path, effectiveRoots) ?? path.parse(summary.path).root;
    const driveBucket = driveStats.get(driveRoot) ?? { sizeBytes: 0, fileCount: 0 };
    driveBucket.sizeBytes += summary.sizeBytes;
    driveBucket.fileCount += summary.fileCount;
    driveStats.set(driveRoot, driveBucket);

    totalBytes += summary.sizeBytes;
    totalFiles += summary.fileCount;
    for (const file of summary.largestFiles) {
      pushTopFile(largestFiles, file);
    }

    topContainers.push({
      path: summary.path,
      label: summary.label,
      category: summary.category,
      sizeBytes: summary.sizeBytes,
      fileCount: summary.fileCount,
      cachedFromIndex
    });
  };

  const mergeAreaSummary = (summary: StorageAreaSummary, cachedFromIndex: boolean): void => {
    for (const folder of summary.folderStats) {
      const folderBucket = folderStats.get(folder.path) ?? { sizeBytes: 0, fileCount: 0 };
      folderBucket.sizeBytes += folder.sizeBytes;
      folderBucket.fileCount += folder.fileCount;
      folderStats.set(folder.path, folderBucket);
    }

    const areaBucket = areaStats.get(summary.path) ?? {
      path: summary.path,
      label: summary.label,
      category: summary.category,
      sizeBytes: 0,
      fileCount: 0,
      cachedFromIndex: false
    };
    areaBucket.sizeBytes += summary.sizeBytes;
    areaBucket.fileCount += summary.fileCount;
    areaBucket.cachedFromIndex = areaBucket.cachedFromIndex || cachedFromIndex;
    areaStats.set(summary.path, areaBucket);

    const driveRoot = findMatchedRoot(summary.path, effectiveRoots) ?? path.parse(summary.path).root;
    const driveBucket = driveStats.get(driveRoot) ?? { sizeBytes: 0, fileCount: 0 };
    driveBucket.sizeBytes += summary.sizeBytes;
    driveBucket.fileCount += summary.fileCount;
    driveStats.set(driveRoot, driveBucket);

    totalBytes += summary.sizeBytes;
    totalFiles += summary.fileCount;
    for (const file of summary.largestFiles) {
      pushTopFile(largestFiles, file);
    }
    for (const container of summary.topContainers) {
      topContainers.push({
        ...container,
        cachedFromIndex: cachedFromIndex || container.cachedFromIndex
      });
    }
  };

  const processDirectory = async (current: string): Promise<void> => {
    const containerMatch = matchStorageContainerDirectory(current);
    if (containerMatch) {
      const directoryStats = await fs.stat(current).catch(() => null);
      const cached =
        directoryStats && directoryStats.isDirectory()
          ? getCachedStorageContainerSummary(current, directoryStats.mtimeMs)
          : null;
      if (cached) {
        mergeContainerSummary(cached, true);
        return;
      }

      const summary = await summarizeStorageContainerDirectory(current, containerMatch.category, containerMatch.label);
      if (directoryStats && directoryStats.isDirectory()) {
        setCachedStorageContainerSummary(current, directoryStats.mtimeMs, summary);
      }
      mergeContainerSummary(summary, false);
      return;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    const fileTargets: string[] = [];
    const currentIsScanRoot = effectiveRoots.some((root) => normalizeLowerPath(root) === normalizeLowerPath(current));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipStorageDirectory(target)) {
          continue;
        }
        if (currentIsScanRoot && isAreaCacheEligible(current, target, effectiveRoots)) {
          const targetStats = await fs.stat(target).catch(() => null);
          const targetEntries = await fs.readdir(target, { withFileTypes: true }).catch(() => null);
          if (targetStats?.isDirectory() && targetEntries) {
            const signature = buildAreaSignature(target, { mtimeMs: targetStats.mtimeMs }, targetEntries);
            const cachedArea = getCachedStorageAreaSummary(target, signature);
            if (cachedArea) {
              mergeAreaSummary(cachedArea, true);
              continue;
            }

            const summary = await summarizeStorageAreaDirectory(target, effectiveRoots);
            setCachedStorageAreaSummary(target, signature, summary);
            mergeAreaSummary(summary, false);
            continue;
          }
        }
        pending.push(target);
        continue;
      }
      if (entry.isFile()) {
        fileTargets.push(target);
      }
    }

    for (const group of chunkItems(fileTargets, FILE_STAT_BATCH_SIZE)) {
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

        const { target, stats } = item.value;
        const folderBucketPath = computeFolderBucket(target, effectiveRoots);
        const folderBucket = folderStats.get(folderBucketPath) ?? { sizeBytes: 0, fileCount: 0 };
        folderBucket.sizeBytes += stats.size;
        folderBucket.fileCount += 1;
        folderStats.set(folderBucketPath, folderBucket);

        const area = computeAreaBucket(target, effectiveRoots);
        const areaBucket = areaStats.get(area.key) ?? {
          sizeBytes: 0,
          fileCount: 0,
          label: area.label,
          category: area.category,
          path: area.key
        };
        areaBucket.sizeBytes += stats.size;
        areaBucket.fileCount += 1;
        areaStats.set(area.key, areaBucket);

        const driveRoot = findMatchedRoot(target, effectiveRoots) ?? path.parse(target).root;
        const driveBucket = driveStats.get(driveRoot) ?? { sizeBytes: 0, fileCount: 0 };
        driveBucket.sizeBytes += stats.size;
        driveBucket.fileCount += 1;
        driveStats.set(driveRoot, driveBucket);

        totalBytes += stats.size;
        totalFiles += 1;
        pushTopFile(largestFiles, {
          path: target,
          sizeBytes: stats.size,
          modifiedAt: stats.mtimeMs
        });
      }
    }
  };

  const workers = Array.from({ length: Math.min(DIRECTORY_SCAN_WORKERS, pending.length || 1) }, async () => {
    while (true) {
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

  const topAreas: StorageAreaUsage[] = [...areaStats.values()]
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, TOP_AREAS_LIMIT)
    .map((item) => ({
      path: item.path,
      label: item.label,
      category: item.category,
      sizeBytes: item.sizeBytes,
      fileCount: item.fileCount,
      cachedFromIndex: item.cachedFromIndex
    }));

  const drives: StorageDriveUsage[] = [...driveStats.entries()]
    .map(([root, aggregate]) => ({
      root,
      sizeBytes: aggregate.sizeBytes,
      fileCount: aggregate.fileCount
    }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes)
    .slice(0, TOP_DRIVES_LIMIT);

  return {
    scannedRoots: effectiveRoots,
    driveStats: drives,
    areaStats: topAreas,
    topContainers: topContainers
      .sort((left, right) => right.sizeBytes - left.sizeBytes || right.fileCount - left.fileCount)
      .slice(0, TOP_CONTAINERS_LIMIT),
    folderStats,
    largestFiles,
    totalBytes,
    totalFiles
  };
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

async function collectInstalledApps(): Promise<InstalledAppUsage[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const script = `
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$items = foreach ($p in $paths) {
  Get-ItemProperty $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, EstimatedSize
}
$items | ConvertTo-Json -Depth 4
`;

  try {
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    if (!stdout.trim()) {
      return [];
    }

    const parsed = parseJsonPayload<Array<Record<string, unknown>> | Record<string, unknown>>(
      stdout,
      "Installed app usage PowerShell output"
    );
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((item): InstalledAppUsage => {
        const sizeKb = parseNumber(item.EstimatedSize);
        return {
          name: String(item.DisplayName ?? "Unknown"),
          version: item.DisplayVersion ? String(item.DisplayVersion) : undefined,
          publisher: item.Publisher ? String(item.Publisher) : undefined,
          installLocation: item.InstallLocation ? String(item.InstallLocation) : undefined,
          sizeBytes: Math.max(0, Math.floor(sizeKb * 1024))
        };
      })
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 40);
  } catch {
    return [];
  }
}

function buildStorageTreemap(
  drives: StorageDriveUsage[],
  topAreas: StorageAreaUsage[],
  topContainers: StorageContainerUsage[],
  topFolders: StorageFolderUsage[]
): StorageTreemapNode[] {
  const folderNodes = topFolders.map<StorageTreemapNode>((item) => ({
    id: `folder:${normalizeLowerPath(item.path)}`,
    label: path.basename(item.path) || item.path,
    path: item.path,
    kind: "folder",
    category: "folder",
    sizeBytes: item.sizeBytes,
    fileCount: item.fileCount
  }));

  const containerNodes = topContainers.map<StorageTreemapNode>((item) => ({
    id: `container:${normalizeLowerPath(item.path)}`,
    label: item.label,
    path: item.path,
    kind: "container",
    category: item.category,
    sizeBytes: item.sizeBytes,
    fileCount: item.fileCount,
    cachedFromIndex: item.cachedFromIndex
  }));

  return drives.map<StorageTreemapNode>((drive) => {
    const areaChildren = topAreas
      .filter((item) => normalizeLowerPath(item.path).startsWith(normalizeLowerPath(drive.root)))
      .map<StorageTreemapNode>((area) => {
        const childNodes = [
          ...containerNodes.filter(
            (item) => normalizeLowerPath(item.path).startsWith(`${normalizeLowerPath(area.path)}\\`)
          ),
          ...folderNodes.filter((item) => {
            const normalizedFolder = normalizeLowerPath(item.path);
            return (
              normalizedFolder.startsWith(`${normalizeLowerPath(area.path)}\\`) &&
              !containerNodes.some((container) => normalizeLowerPath(container.path) === normalizedFolder)
            );
          })
        ]
          .sort((left, right) => right.sizeBytes - left.sizeBytes)
          .slice(0, 8);

        return {
          id: `area:${normalizeLowerPath(area.path)}`,
          label: area.label,
          path: area.path,
          kind: "area",
          category: area.category,
          sizeBytes: area.sizeBytes,
          fileCount: area.fileCount,
          cachedFromIndex: area.cachedFromIndex,
          children: childNodes
        };
      })
      .sort((left, right) => right.sizeBytes - left.sizeBytes);

    return {
      id: `drive:${normalizeLowerPath(drive.root)}`,
      label: drive.root,
      path: drive.root,
      kind: "drive",
      category: "other",
      sizeBytes: drive.sizeBytes,
      fileCount: drive.fileCount,
      children: areaChildren
    };
  });
}

export async function scanStorageInsights(
  roots: string[],
  includeInstalledApps: boolean
): Promise<StorageScanResponse> {
  const key = JSON.stringify({
    roots: roots.map((item) => normalizeLowerPath(item)).sort(),
    includeInstalledApps
  });
  const now = Date.now();
  if (storageScanCache && storageScanCache.key === key && now - storageScanCache.cachedAt < STORAGE_SCAN_CACHE_TTL_MS) {
    return storageScanCache.value;
  }
  if (storageScanInFlight && storageScanInFlight.key === key) {
    return storageScanInFlight.promise;
  }

  const promise = (async () => {
    const [{ scannedRoots, driveStats, areaStats, topContainers, folderStats, largestFiles, totalBytes, totalFiles }, apps] = await Promise.all([
      collectFilesystemUsage(roots),
      includeInstalledApps
        ? withTimeout(collectInstalledApps(), INSTALLED_APPS_TIMEOUT_MS, [] as InstalledAppUsage[])
        : Promise.resolve([] as InstalledAppUsage[])
    ]);
    const topFolders: StorageFolderUsage[] = [...folderStats.entries()]
      .map(([entryPath, aggregate]) => ({
        path: entryPath,
        sizeBytes: aggregate.sizeBytes,
        fileCount: aggregate.fileCount
      }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, TOP_FOLDERS_LIMIT);
    const treemap = buildStorageTreemap(driveStats, areaStats, topContainers, topFolders);

    const value = {
      scannedRoots,
      totalBytes,
      totalFiles,
      topAreas: areaStats,
      drives: driveStats,
      topContainers,
      treemap,
      topFolders,
      largestFiles: [...largestFiles].sort((a, b) => b.sizeBytes - a.sizeBytes),
      apps
    } satisfies StorageScanResponse;
    storageScanCache = {
      key,
      value,
      cachedAt: Date.now()
    };
    return value;
  })();
  storageScanInFlight = { key, promise };

  try {
    return await promise;
  } finally {
    if (storageScanInFlight?.key === key) {
      storageScanInFlight = null;
    }
  }
}
