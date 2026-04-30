import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { AppDatabase } from "./db";
import {
  ElevatedMoveOperation,
  isPermissionError,
  movePathElevated,
  movePathsElevatedBatch
} from "./windowsSources/elevation";
import {
  CleanupCategory,
  QuarantineItem,
  QuarantinePurgeProgressEvent,
  QuarantinePurgeResponse,
  QuarantinePurgeStorageHint
} from "./types";
import { runPowerShellJson } from "./windowsSources/powershell";

export interface QuarantineMetadata {
  category: CleanupCategory;
  source: "scan" | "duplicate";
  hash?: string;
}

export interface QuarantineBatchEntry {
  filePath: string;
  metadata: QuarantineMetadata;
  sizeBytes?: number;
  findingId?: string;
  entryKind?: "file" | "directory";
  taskCount?: number;
}

export interface QuarantineBatchProgress {
  entry: QuarantineBatchEntry;
  success: boolean;
  item?: QuarantineItem;
  error?: Error;
}

export interface QuarantineBatchResult {
  moved: { entry: QuarantineBatchEntry; item: QuarantineItem }[];
  failed: { entry: QuarantineBatchEntry; error: Error }[];
}

export interface QuarantineDirectoryPlan {
  directoryPath: string;
  entries: QuarantineBatchEntry[];
}

export interface QuarantineMixedBatchResult {
  movedFiles: { entry: QuarantineBatchEntry; item: QuarantineItem }[];
  failedFiles: { entry: QuarantineBatchEntry; error: Error }[];
  movedDirectories: { plan: QuarantineDirectoryPlan; items: QuarantineItem[] }[];
  failedDirectories: { plan: QuarantineDirectoryPlan; error: Error }[];
}

interface PurgeGroup {
  targetPath: string;
  items: QuarantineItem[];
}

interface PurgeStorageProfile {
  hint: QuarantinePurgeStorageHint;
  concurrency: number;
  label: string;
}

interface ActivePurgeState {
  cancelRequested: boolean;
}

interface RawDiskStorageInfo {
  BusType?: unknown;
  MediaType?: unknown;
  FriendlyName?: unknown;
}

function normalizeForCompare(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\").toLowerCase();
}

function sanitizeVaultName(value: string): string {
  return value.replace(/[<>:"|?*]/g, "_");
}

interface MovePathOptions {
  allowElevationFallback?: boolean;
}

interface PreparedQuarantineFileMove {
  entry: QuarantineBatchEntry;
  operation: ElevatedMoveOperation;
  item: QuarantineItem;
}

interface PreparedQuarantineDirectoryMove {
  plan: QuarantineDirectoryPlan;
  operation: ElevatedMoveOperation;
  items: QuarantineItem[];
}

async function movePath(source: string, destination: string, options: MovePathOptions = {}): Promise<void> {
  const allowElevationFallback = options.allowElevationFallback ?? true;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "EXDEV") {
      if (!allowElevationFallback || !isPermissionError(error) || process.platform !== "win32") {
        throw error;
      }
      await movePathElevated(source, destination);
      return;
    }

    try {
      const sourceStats = await fs.stat(source);
      if (sourceStats.isDirectory()) {
        await fs.cp(source, destination, {
          recursive: true,
          errorOnExist: false,
          force: false,
          preserveTimestamps: true
        });
        await fs.rm(source, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
        return;
      }

      await fs.copyFile(source, destination);
      await fs.unlink(source);
    } catch (copyError) {
      if (!allowElevationFallback || !isPermissionError(copyError) || process.platform !== "win32") {
        throw copyError;
      }
      await movePathElevated(source, destination);
    }
  }
}

async function pruneEmptyParents(startDirectory: string, stopAt: string): Promise<void> {
  const normalizedStop = normalizeForCompare(stopAt);
  let current = path.normalize(startDirectory);

  while (normalizeForCompare(current).startsWith(normalizedStop)) {
    if (normalizeForCompare(current) === normalizedStop) {
      return;
    }

    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) {
        return;
      }
      await fs.rmdir(current);
    } catch {
      return;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

function defaultPurgeConcurrency(): number {
  const parallelism =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : Math.max(1, os.cpus().length);
  return Math.max(4, Math.min(32, parallelism * 2));
}

export class QuarantineManager {
  private readonly rootDir: string;
  private readonly vaultDir: string;
  private storageProfilePromise: Promise<PurgeStorageProfile> | null = null;
  private activePurgeState: ActivePurgeState | null = null;

  constructor(private readonly db: AppDatabase) {
    this.rootDir = path.join(app.getPath("userData"), "cleanup-quarantine");
    this.vaultDir = path.join(this.rootDir, "vault");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.vaultDir, { recursive: true });
  }

  async quarantineFile(filePath: string, metadata: QuarantineMetadata): Promise<QuarantineItem> {
    const { item } = await this.quarantineSingle({
      filePath,
      metadata
    });
    this.db.addQuarantineItem(item);
    return item;
  }

  async quarantineFilesBatch(
    entries: QuarantineBatchEntry[],
    options?: {
      concurrency?: number;
      onItem?: (progress: QuarantineBatchProgress) => void;
      allowElevationFallback?: boolean;
    }
  ): Promise<QuarantineBatchResult> {
    if (!entries.length) {
      return { moved: [], failed: [] };
    }

    const moved: { entry: QuarantineBatchEntry; item: QuarantineItem }[] = [];
    const nativeMoved: { entry: QuarantineBatchEntry; item: QuarantineItem }[] = [];
    const failed: { entry: QuarantineBatchEntry; error: Error }[] = [];
    const deferredElevation: PreparedQuarantineFileMove[] = [];
    const requestedConcurrency = Math.max(1, Math.floor(options?.concurrency ?? 8));
    const workerCount = Math.min(requestedConcurrency, entries.length);
    const allowElevationFallback = options?.allowElevationFallback ?? true;
    let cursor = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= entries.length) {
          return;
        }

        const entry = entries[currentIndex];
        try {
          const preparedMove = await this.prepareQuarantineEntry(entry);
          const movedEntry = await this.executePreparedFileMove(preparedMove, {
            allowElevationFallback: false
          });
          nativeMoved.push(movedEntry);
          moved.push(movedEntry);
          options?.onItem?.({
            entry,
            success: true,
            item: movedEntry.item
          });
        } catch (error) {
          const normalizedError = error instanceof Error ? error : new Error("Unknown quarantine error");
          if (allowElevationFallback && process.platform === "win32" && isPermissionError(normalizedError)) {
            try {
              const preparedMove = await this.prepareQuarantineEntry(entry);
              deferredElevation.push(preparedMove);
              continue;
            } catch (prepareError) {
              const normalizedPrepareError =
                prepareError instanceof Error ? prepareError : new Error("Unknown quarantine error");
              failed.push({ entry, error: normalizedPrepareError });
              options?.onItem?.({
                entry,
                success: false,
                error: normalizedPrepareError
              });
              continue;
            }
          }
          failed.push({ entry, error: normalizedError });
          options?.onItem?.({
            entry,
            success: false,
            error: normalizedError
          });
        }
      }
    });

    await Promise.all(workers);
    if (nativeMoved.length > 0) {
      this.db.addQuarantineItems(nativeMoved.map((entry) => entry.item));
    }
    if (deferredElevation.length > 0) {
      const elevatedResult = await this.quarantineMixedBatchElevated(
        {
          fileEntries: deferredElevation.map((item) => item.entry),
          directoryPlans: []
        },
        {
          preparedFileMoves: deferredElevation
        }
      );
      moved.push(...elevatedResult.movedFiles);
      failed.push(...elevatedResult.failedFiles);
      for (const item of elevatedResult.movedFiles) {
        options?.onItem?.({
          entry: item.entry,
          success: true,
          item: item.item
        });
      }
      for (const item of elevatedResult.failedFiles) {
        options?.onItem?.({
          entry: item.entry,
          success: false,
          error: item.error
        });
      }
    }

    return { moved, failed };
  }

  async quarantineDirectory(
    directoryPath: string,
    entries: QuarantineBatchEntry[],
    options?: MovePathOptions
  ): Promise<QuarantineItem[]> {
    if (!entries.length) {
      return [];
    }

    const preparedMove = this.prepareQuarantineDirectory({ directoryPath, entries });
    await movePath(preparedMove.operation.source, preparedMove.operation.destination, options);

    const items = preparedMove.items;
    this.db.addQuarantineItems(items);
    return items;
  }

  async quarantineMixedBatchElevated(
    payload: {
      fileEntries: QuarantineBatchEntry[];
      directoryPlans: QuarantineDirectoryPlan[];
    },
    options?: {
      preparedFileMoves?: PreparedQuarantineFileMove[];
      preparedDirectoryMoves?: PreparedQuarantineDirectoryMove[];
    }
  ): Promise<QuarantineMixedBatchResult> {
    const preparedFileMoves =
      options?.preparedFileMoves ?? (await Promise.all(payload.fileEntries.map((entry) => this.prepareQuarantineEntry(entry))));
    const preparedDirectoryMoves =
      options?.preparedDirectoryMoves ?? payload.directoryPlans.map((plan) => this.prepareQuarantineDirectory(plan));

    if (!preparedFileMoves.length && !preparedDirectoryMoves.length) {
      return {
        movedFiles: [],
        failedFiles: [],
        movedDirectories: [],
        failedDirectories: []
      };
    }

    const operations = [
      ...preparedDirectoryMoves.map((item) => item.operation),
      ...preparedFileMoves.map((item) => item.operation)
    ];
    const results = await movePathsElevatedBatch(operations);
    const resultById = new Map(results.map((item) => [item.id, item]));

    const movedFiles: QuarantineMixedBatchResult["movedFiles"] = [];
    const failedFiles: QuarantineMixedBatchResult["failedFiles"] = [];
    const movedDirectories: QuarantineMixedBatchResult["movedDirectories"] = [];
    const failedDirectories: QuarantineMixedBatchResult["failedDirectories"] = [];
    const itemsToPersist: QuarantineItem[] = [];

    for (const preparedMove of preparedDirectoryMoves) {
      const result = resultById.get(preparedMove.operation.id);
      if (result?.ok) {
        movedDirectories.push({
          plan: preparedMove.plan,
          items: preparedMove.items
        });
        itemsToPersist.push(...preparedMove.items);
        continue;
      }

      failedDirectories.push({
        plan: preparedMove.plan,
        error: new Error(result?.message || "Elevated directory move failed.")
      });
    }

    for (const preparedMove of preparedFileMoves) {
      const result = resultById.get(preparedMove.operation.id);
      if (result?.ok) {
        movedFiles.push({
          entry: preparedMove.entry,
          item: preparedMove.item
        });
        itemsToPersist.push(preparedMove.item);
        continue;
      }

      failedFiles.push({
        entry: preparedMove.entry,
        error: new Error(result?.message || "Elevated file move failed.")
      });
    }

    if (itemsToPersist.length > 0) {
      this.db.addQuarantineItems(itemsToPersist);
    }

    return {
      movedFiles,
      failedFiles,
      movedDirectories,
      failedDirectories
    };
  }

  async restoreItems(itemIds: string[]): Promise<{ restoredCount: number; failed: string[] }> {
    let restoredCount = 0;
    const failed: string[] = [];

    for (const id of itemIds) {
      const item = this.db.getQuarantineItem(id);
      if (!item || item.purgedAt || item.restoredAt) {
        failed.push(id);
        continue;
      }

      try {
        const target = await this.resolveRestoreTarget(item.originalPath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await movePath(item.quarantinePath, target);
        this.db.markQuarantineRestored(item.id, Date.now());
        await pruneEmptyParents(path.dirname(item.quarantinePath), this.vaultDir);
        restoredCount += 1;
      } catch {
        failed.push(id);
      }
    }

    return { restoredCount, failed };
  }

  async purgeItems(itemIds: string[]): Promise<{ purgedCount: number; failed: string[] }> {
    const purgedAt = Date.now();
    let purgedCount = 0;
    const failed: string[] = [];
    const purgedIds: string[] = [];

    for (const id of itemIds) {
      const item = this.db.getQuarantineItem(id);
      if (!item || item.purgedAt || item.restoredAt) {
        failed.push(id);
        continue;
      }

      try {
        const targetPath = this.resolvePurgeTarget(item.quarantinePath);
        await fs.rm(targetPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
        purgedIds.push(item.id);
        purgedCount += 1;
      } catch {
        failed.push(id);
      }
    }

    if (purgedIds.length) {
      this.db.markQuarantinePurgedBatch(purgedIds, purgedAt);
    }

    return { purgedCount, failed };
  }

  async purge(
    olderThanDays: number,
    options?: {
      onProgress?: (event: QuarantinePurgeProgressEvent) => void;
    }
  ): Promise<QuarantinePurgeResponse> {
    if (this.activePurgeState) {
      throw new Error("A quarantine purge is already running.");
    }

    const purgeState: ActivePurgeState = { cancelRequested: false };
    this.activePurgeState = purgeState;
    const startedAt = Date.now();
    try {
      const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      const items = this.db.listPurgeableQuarantineItems(threshold);
      const storageProfile = await this.getStorageProfile();
      if (!items.length) {
        options?.onProgress?.({
          stage: "completed",
          totalGroups: 0,
          completedGroups: 0,
          totalItems: 0,
          purgedItems: 0,
          totalBytes: 0,
          purgedBytes: 0,
          percent: 100,
          storageHint: storageProfile.hint,
          concurrency: storageProfile.concurrency,
          message: "No purgeable quarantine items found.",
          logLine: "[purge] no eligible items in quarantine vault",
          timestamp: Date.now()
        });
        return {
          purgedCount: 0,
          freedBytes: 0,
          purgedGroups: 0,
          storageHint: storageProfile.hint,
          concurrency: storageProfile.concurrency,
          durationMs: Date.now() - startedAt,
          canceled: false
        };
      }

      const purgeGroups = this.groupPurgeTargets(items);
      const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
      const successfulGroups: PurgeGroup[] = [];
      const pruneTargets = new Set<string>();
      const workerCount = Math.min(storageProfile.concurrency, purgeGroups.length);
      let cursor = 0;
      let completedGroups = 0;
      let purgedItemsCount = 0;
      let purgedBytes = 0;

      options?.onProgress?.({
        stage: "preparing",
        totalGroups: purgeGroups.length,
        completedGroups: 0,
        totalItems: items.length,
        purgedItems: 0,
        totalBytes,
        purgedBytes: 0,
        percent: 0,
        storageHint: storageProfile.hint,
        concurrency: workerCount,
        message: `Preparing quarantine purge on ${storageProfile.label}.`,
        logLine: `[purge] strategy ${storageProfile.label}, concurrency ${workerCount}, groups ${purgeGroups.length}, items ${items.length}`,
        timestamp: Date.now()
      });

      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          if (purgeState.cancelRequested) {
            return;
          }

          const currentIndex = cursor;
          cursor += 1;
          if (currentIndex >= purgeGroups.length) {
            return;
          }

          const group = purgeGroups[currentIndex];
          try {
            await fs.rm(group.targetPath, {
              recursive: true,
              force: true,
              maxRetries: 6,
              retryDelay: 20
            });
            successfulGroups.push(group);
            purgedItemsCount += group.items.length;
            purgedBytes += group.items.reduce((sum, item) => sum + item.sizeBytes, 0);

            const normalizedTarget = normalizeForCompare(group.targetPath);
            const normalizedVault = normalizeForCompare(this.vaultDir);
            if (!normalizedTarget.startsWith(`${normalizedVault}\\`) || path.dirname(group.targetPath) !== this.vaultDir) {
              pruneTargets.add(path.dirname(group.targetPath));
            }

            completedGroups += 1;
            options?.onProgress?.({
              stage: "running",
              totalGroups: purgeGroups.length,
              completedGroups,
              totalItems: items.length,
              purgedItems: purgedItemsCount,
              totalBytes,
              purgedBytes,
              percent: Math.round((completedGroups / purgeGroups.length) * 100),
              storageHint: storageProfile.hint,
              concurrency: workerCount,
              currentPath: group.targetPath,
              message: `Purged ${completedGroups}/${purgeGroups.length} vault containers.`,
              logLine: `[purge] removed ${group.targetPath} (${group.items.length} items)`,
              timestamp: Date.now()
            });
          } catch {
            completedGroups += 1;
            options?.onProgress?.({
              stage: "running",
              totalGroups: purgeGroups.length,
              completedGroups,
              totalItems: items.length,
              purgedItems: purgedItemsCount,
              totalBytes,
              purgedBytes,
              percent: Math.round((completedGroups / purgeGroups.length) * 100),
              storageHint: storageProfile.hint,
              concurrency: workerCount,
              currentPath: group.targetPath,
              message: "Skipped one purge container after a filesystem error.",
              logLine: `[purge] failed ${group.targetPath}`,
              timestamp: Date.now()
            });
          }
        }
      });

      await Promise.all(workers);

      if (successfulGroups.length) {
        const purgedAt = Date.now();
        const purgedItems = successfulGroups.flatMap((group) => group.items);
        this.db.markQuarantinePurgedBatch(
          purgedItems.map((item) => item.id),
          purgedAt
        );

        await Promise.all(
          Array.from(pruneTargets).map((directory) => pruneEmptyParents(directory, this.vaultDir).catch(() => undefined))
        );
      }

      const result: QuarantinePurgeResponse = {
        purgedCount: successfulGroups.flatMap((group) => group.items).length,
        freedBytes: successfulGroups.flatMap((group) => group.items).reduce((sum, item) => sum + item.sizeBytes, 0),
        purgedGroups: successfulGroups.length,
        storageHint: storageProfile.hint,
        concurrency: workerCount,
        durationMs: Date.now() - startedAt,
        canceled: purgeState.cancelRequested
      };

      options?.onProgress?.({
        stage: purgeState.cancelRequested ? "canceled" : successfulGroups.length ? "completed" : "failed",
        totalGroups: purgeGroups.length,
        completedGroups,
        totalItems: items.length,
        purgedItems: result.purgedCount,
        totalBytes,
        purgedBytes: result.freedBytes,
        percent: purgeState.cancelRequested ? Math.min(99, Math.round((completedGroups / purgeGroups.length) * 100)) : 100,
        storageHint: storageProfile.hint,
        concurrency: workerCount,
        message: purgeState.cancelRequested
          ? `Purge canceled after ${result.purgedGroups} vault containers.`
          : successfulGroups.length
            ? `Purge complete: ${result.purgedCount} items removed in ${result.purgedGroups} vault containers.`
            : "Quarantine purge finished without removing any container.",
        logLine: purgeState.cancelRequested
          ? `[purge] canceled after ${result.purgedGroups} groups, ${result.purgedCount} items`
          : successfulGroups.length
            ? `[purge] complete ${result.purgedCount} items, ${result.purgedGroups} groups, ${result.durationMs} ms`
            : "[purge] no containers removed",
        timestamp: Date.now()
      });

      return result;
    } finally {
      this.activePurgeState = null;
    }
  }

  requestPurgeCancel(): boolean {
    if (!this.activePurgeState) {
      return false;
    }
    this.activePurgeState.cancelRequested = true;
    return true;
  }

  private async resolveRestoreTarget(originalPath: string): Promise<string> {
    try {
      await fs.access(originalPath);
      const parsed = path.parse(originalPath);
      const stamp = Date.now();
      return path.join(parsed.dir, `${parsed.name}.restored-${stamp}${parsed.ext}`);
    } catch {
      return originalPath;
    }
  }

  private async quarantineSingle(
    entry: QuarantineBatchEntry
  ): Promise<{ entry: QuarantineBatchEntry; item: QuarantineItem }> {
    const preparedMove = await this.prepareQuarantineEntry(entry);
    return this.executePreparedFileMove(preparedMove);
  }

  private async prepareQuarantineEntry(entry: QuarantineBatchEntry): Promise<PreparedQuarantineFileMove> {
    const id = randomUUID();
    const fileName = path.basename(entry.filePath);
    const destination = path.join(this.vaultDir, sanitizeVaultName(`${id}_${fileName}`));
    const movedAt = Date.now();
    const knownSize = entry.sizeBytes;
    const sizeBytes = knownSize ?? (await fs.stat(entry.filePath)).size;

    return {
      entry,
      operation: {
        id,
        source: entry.filePath,
        destination
      },
      item: {
        id,
        originalPath: entry.filePath,
        quarantinePath: destination,
        sizeBytes,
        category: entry.metadata.category,
        source: entry.metadata.source,
        movedAt,
        hash: entry.metadata.hash
      }
    };
  }

  private async executePreparedFileMove(
    preparedMove: PreparedQuarantineFileMove,
    options?: MovePathOptions
  ): Promise<{ entry: QuarantineBatchEntry; item: QuarantineItem }> {
    await movePath(preparedMove.operation.source, preparedMove.operation.destination, options);
    return {
      entry: preparedMove.entry,
      item: preparedMove.item
    };
  }

  private prepareQuarantineDirectory(plan: QuarantineDirectoryPlan): PreparedQuarantineDirectoryMove {
    const normalizedDirectory = normalizeForCompare(plan.directoryPath);
    const destinationDir = path.join(
      this.vaultDir,
      sanitizeVaultName(`${randomUUID()}_${path.basename(plan.directoryPath) || "directory"}`)
    );
    const movedAt = Date.now();

    const items = plan.entries.map((entry) => {
      if (entry.entryKind === "directory" || normalizeForCompare(entry.filePath) === normalizedDirectory) {
        return {
          id: randomUUID(),
          originalPath: plan.directoryPath,
          quarantinePath: destinationDir,
          sizeBytes: entry.sizeBytes ?? 0,
          category: entry.metadata.category,
          source: entry.metadata.source,
          movedAt,
          hash: entry.metadata.hash
        } satisfies QuarantineItem;
      }

      const normalizedFile = normalizeForCompare(entry.filePath);
      if (
        normalizedFile !== normalizedDirectory &&
        !normalizedFile.startsWith(`${normalizedDirectory}\\`)
      ) {
        throw new Error(`Entry path is outside directory scope: ${entry.filePath}`);
      }

      const relative = path.relative(plan.directoryPath, entry.filePath);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Unable to map quarantine path for ${entry.filePath}`);
      }

      return {
        id: randomUUID(),
        originalPath: entry.filePath,
        quarantinePath: path.join(destinationDir, relative),
        sizeBytes: entry.sizeBytes ?? 0,
        category: entry.metadata.category,
        source: entry.metadata.source,
        movedAt,
        hash: entry.metadata.hash
      } satisfies QuarantineItem;
    });

    return {
      plan,
      operation: {
        id: randomUUID(),
        source: plan.directoryPath,
        destination: destinationDir
      },
      items
    };
  }

  private groupPurgeTargets(items: QuarantineItem[]): PurgeGroup[] {
    const groups = new Map<string, PurgeGroup>();

    for (const item of items) {
      const targetPath = this.resolvePurgeTarget(item.quarantinePath);
      const key = normalizeForCompare(targetPath);
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(item);
        continue;
      }

      groups.set(key, {
        targetPath,
        items: [item]
      });
    }

    return [...groups.values()];
  }

  private resolvePurgeTarget(quarantinePath: string): string {
    const normalizedPath = path.normalize(quarantinePath);
    const relative = path.relative(this.vaultDir, normalizedPath);
    if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) {
      return normalizedPath;
    }

    const [topLevelSegment] = relative.split(/[\\/]+/).filter(Boolean);
    if (!topLevelSegment) {
      return normalizedPath;
    }

    return path.join(this.vaultDir, topLevelSegment);
  }

  private getStorageProfile(): Promise<PurgeStorageProfile> {
    if (!this.storageProfilePromise) {
      this.storageProfilePromise = this.detectStorageProfile().catch(() => ({
        hint: "unknown",
        concurrency: Math.min(defaultPurgeConcurrency(), 10),
        label: "generic storage"
      }));
    }

    return this.storageProfilePromise;
  }

  private async detectStorageProfile(): Promise<PurgeStorageProfile> {
    if (process.platform !== "win32") {
      return {
        hint: "unknown",
        concurrency: Math.min(defaultPurgeConcurrency(), 10),
        label: "generic storage"
      };
    }

    const driveRoot = path.parse(this.rootDir).root.replace(/[\\/]+$/g, "");
    const driveLetter = driveRoot.replace(":", "").trim();
    if (!driveLetter) {
      return {
        hint: "unknown",
        concurrency: Math.min(defaultPurgeConcurrency(), 10),
        label: "generic storage"
      };
    }

    const command = [
      `$partition = Get-Partition -DriveLetter '${driveLetter}' -ErrorAction SilentlyContinue`,
      "if (-not $partition) { @{} | ConvertTo-Json -Compress; exit }",
      "$disk = Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue",
      "if (-not $disk) { @{} | ConvertTo-Json -Compress; exit }",
      "$disk | Select-Object BusType, MediaType, FriendlyName | ConvertTo-Json -Depth 4 -Compress"
    ].join("; ");

    const raw = await runPowerShellJson<RawDiskStorageInfo>(command, {}, 2_000);
    const busType = String(raw.BusType ?? "").trim().toLowerCase();
    const mediaType = String(raw.MediaType ?? "").trim().toLowerCase();
    const friendlyName = String(raw.FriendlyName ?? "").trim().toLowerCase();

    if (busType.includes("nvme") || friendlyName.includes("nvme")) {
      return {
        hint: "nvme",
        concurrency: Math.min(defaultPurgeConcurrency(), 24),
        label: "NVMe storage"
      };
    }

    if (mediaType.includes("ssd")) {
      return {
        hint: "ssd",
        concurrency: Math.min(defaultPurgeConcurrency(), 16),
        label: "SSD storage"
      };
    }

    if (mediaType.includes("hdd")) {
      return {
        hint: "hdd",
        concurrency: Math.min(defaultPurgeConcurrency(), 6),
        label: "HDD storage"
      };
    }

    if (busType.includes("sata") || busType.includes("scsi")) {
      return {
        hint: "ssd",
        concurrency: Math.min(defaultPurgeConcurrency(), 16),
        label: "SSD-like storage"
      };
    }

    return {
      hint: "unknown",
      concurrency: Math.min(defaultPurgeConcurrency(), 10),
      label: "generic storage"
    };
  }
}
