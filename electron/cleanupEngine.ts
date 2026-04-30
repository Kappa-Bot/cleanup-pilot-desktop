import fs from "fs/promises";
import path from "path";
import os from "os";
import type { Dirent } from "fs";
import { canQuarantinePath } from "./safetyPolicy";
import { matchNeverCleanupPath, normalizeProtectionPreferences } from "./protectionPreferences";
import { isPermissionError } from "./windowsSources/elevation";
import {
  QuarantineBatchEntry,
  QuarantineDirectoryPlan,
  QuarantineManager
} from "./quarantineManager";
import {
  CleanupExecutionProgressEvent,
  CleanupExecuteResponse,
  CleanupPreviewResponse,
  ProtectionPreferences,
  ScanFinding
} from "./types";

interface CleanupExecutionOptions {
  runId: string;
  executionId: string;
  onProgress?: (payload: CleanupExecutionProgressEvent) => void;
  requestAdminBeforeStart?: boolean;
}

interface CleanupEngineDependencies {
  resolveProtectionPreferences?: () => Promise<ProtectionPreferences> | ProtectionPreferences;
}

interface DirectoryPlan {
  directoryPath: string;
  findings: ScanFinding[];
}

const BULK_DIRECTORY_MIN_FILES = 8;
const BULK_DIRECTORY_MAX_CANDIDATES = 48;
const FILE_BATCH_CONCURRENCY = Math.max(4, Math.min(16, os.cpus().length));
const DIRECTORY_BULK_CONCURRENCY = Math.max(2, Math.min(6, os.cpus().length));
const DIRECTORY_ENUMERATION_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length));
const PROGRESS_EVENT_MIN_INTERVAL_MS = 80;

function normalizePathKey(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\").toLowerCase();
}

function findingTaskCount(finding: ScanFinding): number {
  return Math.max(1, finding.entryCount ?? 1);
}

function entryTaskCount(entry: QuarantineBatchEntry): number {
  return Math.max(1, entry.taskCount ?? 1);
}

function toQuarantineEntry(finding: ScanFinding): QuarantineBatchEntry {
  return {
    filePath: finding.path,
    metadata: {
      category: finding.category,
      source: "scan"
    },
    sizeBytes: finding.sizeBytes,
    findingId: finding.id,
    entryKind: finding.kind === "directory" ? "directory" : "file",
    taskCount: findingTaskCount(finding)
  };
}

function getDirectoryDepth(directoryPath: string): number {
  return path
    .normalize(directoryPath)
    .split(/[\\/]+/)
    .filter(Boolean).length;
}

function collectAncestorDirectories(filePath: string): string[] {
  const directories: string[] = [];
  let current = path.dirname(path.normalize(filePath));

  while (true) {
    directories.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return directories;
}

async function inspectDirectorySelection(
  directoryPath: string,
  expectedKeys: Set<string>,
  expectedCount: number
): Promise<{
  exact: boolean;
  hasSymlink: boolean;
  failed: boolean;
}> {
  const pending = [directoryPath];
  let activeWorkers = 0;
  let enumeratedCount = 0;
  let hasSymlink = false;
  let failed = false;
  let mismatchFound = false;

  const processDirectory = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      failed = true;
      return;
    }

    for (const entry of entries) {
      if (failed || hasSymlink || mismatchFound) {
        return;
      }

      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        hasSymlink = true;
        return;
      }

      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const normalized = normalizePathKey(target);
      if (!expectedKeys.has(normalized)) {
        mismatchFound = true;
        return;
      }

      enumeratedCount += 1;
      if (enumeratedCount > expectedCount) {
        mismatchFound = true;
        return;
      }
    }
  };

  const workers = Array.from(
    { length: DIRECTORY_ENUMERATION_CONCURRENCY },
    async () => {
      while (true) {
        if (failed || hasSymlink || mismatchFound) {
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
    }
  );

  await Promise.all(workers);
  return {
    exact: !failed && !hasSymlink && !mismatchFound && enumeratedCount === expectedCount,
    hasSymlink,
    failed
  };
}

export class CleanupEngine {
  private readonly resolveProtectionPreferences: () => Promise<ProtectionPreferences> | ProtectionPreferences;

  constructor(dependencies: CleanupEngineDependencies = {}) {
    this.resolveProtectionPreferences =
      dependencies.resolveProtectionPreferences ?? (() => normalizeProtectionPreferences());
  }

  async preview(findings: ScanFinding[], selectedIds: string[]): Promise<CleanupPreviewResponse> {
    const selectedSet = new Set(selectedIds);
    const protectionPreferences = normalizeProtectionPreferences(
      await Promise.resolve(this.resolveProtectionPreferences()).catch(() => normalizeProtectionPreferences())
    );
    let totalBytes = 0;
    let actionCount = 0;
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let blockedCount = 0;

    for (const finding of findings) {
      if (!selectedSet.has(finding.id)) {
        continue;
      }

      actionCount += findingTaskCount(finding);
      totalBytes += finding.sizeBytes;

      const guard = this.getCleanupGuard(finding, protectionPreferences);
      if (!guard.allowed) {
        blockedCount += 1;
      }
      if (finding.risk === "high") {
        highRiskCount += 1;
      }
      if (finding.risk === "medium") {
        mediumRiskCount += 1;
      }
    }

    return {
      totalBytes,
      actionCount,
      riskFlags: {
        highRiskCount,
        mediumRiskCount,
        blockedCount
      }
    };
  }

  async execute(
    findings: ScanFinding[],
    selectedIds: string[],
    quarantineManager: QuarantineManager,
    options?: CleanupExecutionOptions
  ): Promise<CleanupExecuteResponse> {
    const selectedSet = new Set(selectedIds);
    const targets = findings.filter((item) => selectedSet.has(item.id));
    const protectionPreferences = normalizeProtectionPreferences(
      await Promise.resolve(this.resolveProtectionPreferences()).catch(() => normalizeProtectionPreferences())
    );
    const totalTasks = targets.reduce((sum, item) => sum + findingTaskCount(item), 0);
    let movedCount = 0;
    let failedCount = 0;
    let freedBytes = 0;
    const errors: string[] = [];
    const movedIds: string[] = [];
    const failedIds: string[] = [];
    let completedTasks = 0;
    let lastProgressEmitAt = 0;
    let lastProgressStage: CleanupExecutionProgressEvent["stage"] | null = null;

    const emitProgress = (payload: {
      stage: CleanupExecutionProgressEvent["stage"];
      message: string;
      runningPath?: string;
      logLine?: string;
    }, force = false): void => {
      if (!options?.onProgress) {
        return;
      }

      const now = Date.now();
      const terminalStage = payload.stage === "completed" || payload.stage === "failed";
      const stageChanged = payload.stage !== lastProgressStage;
      if (!force && !terminalStage && !stageChanged && now - lastProgressEmitAt < PROGRESS_EVENT_MIN_INTERVAL_MS) {
        return;
      }
      lastProgressEmitAt = now;
      lastProgressStage = payload.stage;

      const pendingTasks = Math.max(0, totalTasks - completedTasks);
      const percent =
        totalTasks <= 0
          ? 100
          : Math.min(100, Math.floor((completedTasks / totalTasks) * 100));
      options.onProgress({
        runId: options.runId,
        executionId: options.executionId,
        stage: payload.stage,
        totalTasks,
        completedTasks,
        pendingTasks,
        movedCount,
        failedCount,
        freedBytes,
        percent,
        runningPath: payload.runningPath,
        message: payload.message,
        logLine: payload.logLine,
        timestamp: now
      });
    };

    emitProgress({
      stage: "preparing",
      message: totalTasks > 0 ? `Preparing ${totalTasks} cleanup tasks.` : "No tasks selected for cleanup.",
      logLine: totalTasks > 0 ? `Queue prepared: ${totalTasks} tasks` : "Queue empty"
    });

    const eligibleTargets: ScanFinding[] = [];
    for (const finding of targets) {
      emitProgress({
        stage: "running",
        message: `Validating ${finding.path}`,
        runningPath: finding.path
      });

      const guard = this.getCleanupGuard(finding, protectionPreferences);
      if (!guard.allowed) {
        const blockedTaskCount = findingTaskCount(finding);
        failedCount += blockedTaskCount;
        failedIds.push(finding.id);
        const errorMessage = `${finding.path}: ${guard.reason ?? "Blocked by safety policy"}`;
        errors.push(errorMessage);
        completedTasks += blockedTaskCount;
        emitProgress({
          stage: "running",
          message: `Blocked by safety policy: ${finding.path}`,
          runningPath: finding.path,
          logLine: `BLOCKED ${errorMessage}`
        });
        continue;
      }

      eligibleTargets.push(finding);
    }

    const { directoryPlans, remainingTargets } = await this.buildDirectoryPlans(eligibleTargets, protectionPreferences);

    emitProgress({
      stage: "preparing",
      message: `Execution plan ready: ${directoryPlans.length} bulk folders, ${remainingTargets.length} files.`,
      logLine: `Plan bulkFolders=${directoryPlans.length} directFiles=${remainingTargets.length}`
    });

    if (options?.requestAdminBeforeStart && process.platform === "win32" && (directoryPlans.length > 0 || remainingTargets.length > 0)) {
      emitProgress(
        {
          stage: "preparing",
          message: "Requesting administrator approval before cleanup starts.",
          logLine: `ELEVATE PREFLIGHT directories=${directoryPlans.length} files=${remainingTargets.length}`
        },
        true
      );

      const fileEntries = remainingTargets.map(toQuarantineEntry);
      const elevatedDirectoryPlans: QuarantineDirectoryPlan[] = directoryPlans.map((plan) => ({
        directoryPath: plan.directoryPath,
        entries: plan.findings.map(toQuarantineEntry)
      }));
      const findingById = new Map(eligibleTargets.map((item) => [item.id, item]));

      try {
        const elevatedResult = await quarantineManager.quarantineMixedBatchElevated({
          fileEntries,
          directoryPlans: elevatedDirectoryPlans
        });

        for (const item of elevatedResult.movedDirectories) {
          const fileCount = item.plan.entries.reduce((sum, entry) => sum + entryTaskCount(entry), 0);
          const bytes = item.items.reduce((sum, entry) => sum + entry.sizeBytes, 0);
          movedCount += fileCount;
          freedBytes += bytes;
          completedTasks += fileCount;
          movedIds.push(
            ...item.plan.entries
              .map((entry) => entry.findingId)
              .filter((entry): entry is string => Boolean(entry))
          );
          emitProgress({
            stage: "running",
            message: `Admin batch moved ${item.plan.directoryPath}`,
            runningPath: item.plan.directoryPath,
            logLine: `ELEVATE PREFLIGHT DONE ${item.plan.directoryPath} (${fileCount} files, ${bytes} bytes)`
          });
        }

        for (const item of elevatedResult.failedDirectories) {
          const fileCount = item.plan.entries.reduce((sum, entry) => sum + entryTaskCount(entry), 0);
          const message = item.error.message;
          completedTasks += fileCount;
          failedCount += fileCount;
          for (const entry of item.plan.entries) {
            if (entry.findingId) {
              failedIds.push(entry.findingId);
              const finding = findingById.get(entry.findingId);
              errors.push(`${finding?.path ?? entry.filePath}: ${message}`);
            }
          }
          emitProgress({
            stage: "running",
            message: `Admin batch failed for ${item.plan.directoryPath}`,
            runningPath: item.plan.directoryPath,
            logLine: `ELEVATE PREFLIGHT FAILED ${item.plan.directoryPath}: ${message}`
          });
        }

        for (const item of elevatedResult.movedFiles) {
          const findingId = item.entry.findingId;
          if (!findingId) {
            continue;
          }
          const finding = findingById.get(findingId);
          if (!finding) {
            continue;
          }

          const taskCount = findingTaskCount(finding);
          completedTasks += taskCount;
          movedCount += taskCount;
          freedBytes += finding.sizeBytes;
          movedIds.push(finding.id);
          emitProgress({
            stage: "running",
            message: `Admin batch moved ${finding.path}`,
            runningPath: finding.path,
            logLine: `ELEVATE PREFLIGHT DONE ${finding.path} (${finding.sizeBytes} bytes)`
          });
        }

        for (const item of elevatedResult.failedFiles) {
          const findingId = item.entry.findingId;
          if (!findingId) {
            continue;
          }
          const finding = findingById.get(findingId);
          if (!finding) {
            continue;
          }

          const taskCount = findingTaskCount(finding);
          completedTasks += taskCount;
          failedCount += taskCount;
          failedIds.push(finding.id);
          const message = item.error.message;
          errors.push(`${finding.path}: ${message}`);
          emitProgress({
            stage: "running",
            message: `Admin batch failed for ${finding.path}`,
            runningPath: finding.path,
            logLine: `ELEVATE PREFLIGHT FAILED ${finding.path}: ${message}`
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Administrator approval failed.";
        const failedTasks =
          fileEntries.reduce((sum, entry) => sum + entryTaskCount(entry), 0) +
          elevatedDirectoryPlans.reduce((sum, plan) => sum + plan.entries.reduce((inner, entry) => inner + entryTaskCount(entry), 0), 0);
        completedTasks += failedTasks;
        failedCount += failedTasks;
        failedIds.push(
          ...fileEntries.map((entry) => entry.findingId).filter((entry): entry is string => Boolean(entry)),
          ...elevatedDirectoryPlans.flatMap((plan) =>
            plan.entries.map((entry) => entry.findingId).filter((entry): entry is string => Boolean(entry))
          )
        );
        for (const entry of [...fileEntries, ...elevatedDirectoryPlans.flatMap((plan) => plan.entries)]) {
          errors.push(`${entry.filePath}: ${message}`);
        }
        emitProgress(
          {
            stage: "failed",
            message,
            logLine: `ELEVATE PREFLIGHT FAILED ${message}`
          },
          true
        );
      }

      emitProgress(
        {
          stage: errors.length > 0 ? "failed" : "completed",
          message: `Cleanup finished. Moved ${movedCount}, failed ${failedCount}.`,
          logLine: `SUMMARY moved=${movedCount} failed=${failedCount} freed=${freedBytes}`
        },
        true
      );

      return {
        movedCount,
        failedCount,
        freedBytes,
        errors,
        movedIds,
        failedIds
      };
    }

    const deferredElevatedDirectoryPlans: QuarantineDirectoryPlan[] = [];
    const deferredElevatedFileEntries: QuarantineBatchEntry[] = [];

    const processDirectoryPlan = async (plan: DirectoryPlan): Promise<void> => {
      const fileCount = plan.findings.reduce((sum, item) => sum + findingTaskCount(item), 0);
      const bytes = plan.findings.reduce((sum, item) => sum + item.sizeBytes, 0);
      emitProgress({
        stage: "running",
        message: `Bulk quarantining ${plan.directoryPath}`,
        runningPath: plan.directoryPath,
        logLine: `BULK START ${plan.directoryPath} (${fileCount} files)`
      });

      const entries = plan.findings.map(toQuarantineEntry);

      try {
        await quarantineManager.quarantineDirectory(plan.directoryPath, entries, {
          allowElevationFallback: false
        });
        movedCount += fileCount;
        movedIds.push(...plan.findings.map((item) => item.id));
        freedBytes += bytes;
        completedTasks += fileCount;
        emitProgress({
          stage: "running",
          message: `Bulk quarantined ${plan.directoryPath}`,
          runningPath: plan.directoryPath,
          logLine: `BULK DONE ${plan.directoryPath} (${fileCount} files, ${bytes} bytes)`
        });
      } catch (error) {
        if (process.platform === "win32" && isPermissionError(error)) {
          deferredElevatedDirectoryPlans.push({
            directoryPath: plan.directoryPath,
            entries
          });
          emitProgress({
            stage: "running",
            message: `Queued admin batch for ${plan.directoryPath}`,
            runningPath: plan.directoryPath,
            logLine: `ELEVATE QUEUED ${plan.directoryPath} (${fileCount} files)`
          });
          return;
        }

        const message = error instanceof Error ? error.message : "Unknown error";
        completedTasks += fileCount;
        failedCount += fileCount;
        failedIds.push(...plan.findings.map((item) => item.id));
        for (const finding of plan.findings) {
          errors.push(`${finding.path}: ${message}`);
        }
        emitProgress({
          stage: "running",
          message: `Bulk failed for ${plan.directoryPath}`,
          runningPath: plan.directoryPath,
          logLine: `BULK FAILED ${plan.directoryPath}: ${message}`
        });
      }
    };

    if (directoryPlans.length > 0) {
      let directoryCursor = 0;
      const workerCount = Math.min(DIRECTORY_BULK_CONCURRENCY, directoryPlans.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const currentIndex = directoryCursor;
            directoryCursor += 1;
            if (currentIndex >= directoryPlans.length) {
              return;
            }
            await processDirectoryPlan(directoryPlans[currentIndex]);
          }
        })
      );
    }

    if (remainingTargets.length > 0) {
      const findingById = new Map(remainingTargets.map((item) => [item.id, item]));
      const entries = remainingTargets.map(toQuarantineEntry);

      emitProgress({
        stage: "running",
        message: `Quarantining ${remainingTargets.length} files with parallel workers.`,
        logLine: `BATCH START files=${remainingTargets.length} concurrency=${FILE_BATCH_CONCURRENCY}`
      });

      try {
        await quarantineManager.quarantineFilesBatch(entries, {
          concurrency: FILE_BATCH_CONCURRENCY,
          allowElevationFallback: false,
          onItem: (event) => {
            const findingId = event.entry.findingId;
            if (!findingId) {
              return;
            }

            const finding = findingById.get(findingId);
            if (!finding) {
              return;
            }

            if (event.success) {
              const taskCount = findingTaskCount(finding);
              completedTasks += taskCount;
              movedCount += taskCount;
              movedIds.push(finding.id);
              freedBytes += finding.sizeBytes;
              emitProgress({
                stage: "running",
                message: `Quarantined ${finding.path}`,
                runningPath: finding.path,
                logLine: `DONE ${finding.path} (${finding.sizeBytes} bytes)`
              });
              return;
            }

            if (process.platform === "win32" && isPermissionError(event.error)) {
              deferredElevatedFileEntries.push(event.entry);
              emitProgress({
                stage: "running",
                message: `Queued admin batch for ${finding.path}`,
                runningPath: finding.path,
                logLine: `ELEVATE QUEUED ${finding.path}`
              });
              return;
            }

            const taskCount = findingTaskCount(finding);
            completedTasks += taskCount;
            failedCount += taskCount;
            failedIds.push(finding.id);
            const message = event.error?.message ?? "Unknown error";
            const errorMessage = `${finding.path}: ${message}`;
            errors.push(errorMessage);
            emitProgress({
              stage: "running",
              message: `Failed ${finding.path}`,
              runningPath: finding.path,
              logLine: `FAILED ${errorMessage}`
            });
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown batch error";
        errors.push(`Batch execution error: ${message}`);
        emitProgress({
          stage: "running",
          message: "Batch execution reported an unexpected error.",
          logLine: `BATCH FAILED ${message}`
        });
      }
    }

    if (deferredElevatedDirectoryPlans.length > 0 || deferredElevatedFileEntries.length > 0) {
      emitProgress({
        stage: "running",
        message: "Requesting one administrator approval for the remaining protected cleanup operations.",
        logLine: `ELEVATE START directories=${deferredElevatedDirectoryPlans.length} files=${deferredElevatedFileEntries.length}`
      });

      const findingById = new Map(findings.map((item) => [item.id, item]));
      try {
        const elevatedResult = await quarantineManager.quarantineMixedBatchElevated({
          fileEntries: deferredElevatedFileEntries,
          directoryPlans: deferredElevatedDirectoryPlans
        });

        for (const item of elevatedResult.movedDirectories) {
          const fileCount = item.plan.entries.reduce((sum, entry) => sum + entryTaskCount(entry), 0);
          const bytes = item.items.reduce((sum, entry) => sum + entry.sizeBytes, 0);
          movedCount += fileCount;
          freedBytes += bytes;
          completedTasks += fileCount;
          movedIds.push(
            ...item.plan.entries
              .map((entry) => entry.findingId)
              .filter((entry): entry is string => Boolean(entry))
          );
          emitProgress({
            stage: "running",
            message: `Admin batch moved ${item.plan.directoryPath}`,
            runningPath: item.plan.directoryPath,
            logLine: `ELEVATE DONE ${item.plan.directoryPath} (${fileCount} files, ${bytes} bytes)`
          });
        }

        for (const item of elevatedResult.failedDirectories) {
          const fileCount = item.plan.entries.reduce((sum, entry) => sum + entryTaskCount(entry), 0);
          const message = item.error.message;
          completedTasks += fileCount;
          failedCount += fileCount;
          for (const entry of item.plan.entries) {
            if (entry.findingId) {
              failedIds.push(entry.findingId);
              const finding = findingById.get(entry.findingId);
              if (finding) {
                errors.push(`${finding.path}: ${message}`);
              }
            }
          }
          emitProgress({
            stage: "running",
            message: `Admin batch failed for ${item.plan.directoryPath}`,
            runningPath: item.plan.directoryPath,
            logLine: `ELEVATE FAILED ${item.plan.directoryPath}: ${message}`
          });
        }

        for (const item of elevatedResult.movedFiles) {
          const findingId = item.entry.findingId;
          if (!findingId) {
            continue;
          }
          const finding = findingById.get(findingId);
          if (!finding) {
            continue;
          }

          const taskCount = findingTaskCount(finding);
          completedTasks += taskCount;
          movedCount += taskCount;
          freedBytes += finding.sizeBytes;
          movedIds.push(finding.id);
          emitProgress({
            stage: "running",
            message: `Admin batch moved ${finding.path}`,
            runningPath: finding.path,
            logLine: `ELEVATE DONE ${finding.path} (${finding.sizeBytes} bytes)`
          });
        }

        for (const item of elevatedResult.failedFiles) {
          const findingId = item.entry.findingId;
          if (!findingId) {
            continue;
          }
          const finding = findingById.get(findingId);
          if (!finding) {
            continue;
          }

          const taskCount = findingTaskCount(finding);
          completedTasks += taskCount;
          failedCount += taskCount;
          failedIds.push(finding.id);
          const message = item.error.message;
          errors.push(`${finding.path}: ${message}`);
          emitProgress({
            stage: "running",
            message: `Admin batch failed for ${finding.path}`,
            runningPath: finding.path,
            logLine: `ELEVATE FAILED ${finding.path}: ${message}`
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Administrator batch failed";
        const deferredTasks =
          deferredElevatedFileEntries.reduce((sum, entry) => {
            const findingId = entry.findingId;
            const finding = findingId ? findingById.get(findingId) : null;
            return sum + (finding ? findingTaskCount(finding) : entryTaskCount(entry));
          }, 0) +
          deferredElevatedDirectoryPlans.reduce(
            (sum, item) =>
              sum +
              item.entries.reduce((innerSum, entry) => {
                const findingId = entry.findingId;
                const finding = findingId ? findingById.get(findingId) : null;
                return innerSum + (finding ? findingTaskCount(finding) : entryTaskCount(entry));
              }, 0),
            0
          );
        completedTasks += deferredTasks;
        failedCount += deferredTasks;
        failedIds.push(
          ...deferredElevatedFileEntries
            .map((entry) => entry.findingId)
            .filter((entry): entry is string => Boolean(entry)),
          ...deferredElevatedDirectoryPlans.flatMap((plan) =>
            plan.entries
              .map((entry) => entry.findingId)
              .filter((entry): entry is string => Boolean(entry))
          )
        );
        for (const entry of deferredElevatedFileEntries) {
          const findingId = entry.findingId;
          const finding = findingId ? findingById.get(findingId) : null;
          errors.push(`${finding?.path ?? entry.filePath}: ${message}`);
        }
        for (const plan of deferredElevatedDirectoryPlans) {
          for (const entry of plan.entries) {
            const findingId = entry.findingId;
            const finding = findingId ? findingById.get(findingId) : null;
            errors.push(`${finding?.path ?? entry.filePath}: ${message}`);
          }
        }
        emitProgress({
          stage: "running",
          message: "Administrator batch failed.",
          logLine: `ELEVATE BATCH FAILED ${message}`
        });
      }
    }

    emitProgress({
      stage: errors.length > 0 ? "failed" : "completed",
      message: `Cleanup finished. Moved ${movedCount}, failed ${failedCount}.`,
      logLine: `SUMMARY moved=${movedCount} failed=${failedCount} freed=${freedBytes}`
    }, true);

    return {
      movedCount,
      failedCount,
      freedBytes,
      errors,
      movedIds,
      failedIds
    };
  }

  private async buildDirectoryPlans(
    findings: ScanFinding[],
    protectionPreferences: ProtectionPreferences
  ): Promise<{ directoryPlans: DirectoryPlan[]; remainingTargets: ScanFinding[] }> {
    const directDirectoryPlans: DirectoryPlan[] = [];
    const directDirectoryKeys = new Set<string>();
    const nonDirectoryFindings: ScanFinding[] = [];

    for (const finding of findings) {
      if (finding.kind === "directory") {
        const safeGuard = this.getCleanupGuard(finding, protectionPreferences);
        if (!safeGuard.allowed) {
          nonDirectoryFindings.push(finding);
          continue;
        }
        directDirectoryPlans.push({
          directoryPath: finding.path,
          findings: [finding]
        });
        directDirectoryKeys.add(normalizePathKey(finding.path));
        continue;
      }
      nonDirectoryFindings.push(finding);
    }

    if (nonDirectoryFindings.length < BULK_DIRECTORY_MIN_FILES) {
      return { directoryPlans: directDirectoryPlans, remainingTargets: nonDirectoryFindings };
    }

    const directoryMap = new Map<string, ScanFinding[]>();
    for (const finding of nonDirectoryFindings) {
      for (const directory of collectAncestorDirectories(finding.path)) {
        const list = directoryMap.get(directory);
        if (list) {
          list.push(finding);
        } else {
          directoryMap.set(directory, [finding]);
        }
      }
    }

    const candidates = Array.from(directoryMap.entries())
      .filter(([, items]) => items.length >= BULK_DIRECTORY_MIN_FILES)
      .filter(([directoryPath]) => !directDirectoryKeys.has(normalizePathKey(directoryPath)))
      .sort((a, b) => {
        const depthDelta = getDirectoryDepth(b[0]) - getDirectoryDepth(a[0]);
        if (depthDelta !== 0) {
          return depthDelta;
        }
        return b[1].length - a[1].length;
      })
      .slice(0, BULK_DIRECTORY_MAX_CANDIDATES);

    const consumedKeys = new Set<string>(
      directDirectoryPlans.flatMap((plan) => plan.findings.map((item) => normalizePathKey(item.path)))
    );
    const directoryPlans: DirectoryPlan[] = [...directDirectoryPlans];

    for (const [directoryPath, allItems] of candidates) {
      const safeGuard = this.getCleanupGuard({ path: directoryPath } as ScanFinding, protectionPreferences);
      if (!safeGuard.allowed) {
        continue;
      }

      const unclaimedItems = allItems.filter((item) => !consumedKeys.has(normalizePathKey(item.path)));
      if (unclaimedItems.length < BULK_DIRECTORY_MIN_FILES) {
        continue;
      }

      const matches = await this.isExactDirectorySelection(directoryPath, unclaimedItems);
      if (!matches) {
        continue;
      }

      directoryPlans.push({
        directoryPath,
        findings: unclaimedItems
      });
      for (const item of unclaimedItems) {
        consumedKeys.add(normalizePathKey(item.path));
      }
    }

    if (directoryPlans.length === 0) {
      return { directoryPlans: [], remainingTargets: nonDirectoryFindings };
    }

    const remainingTargets = nonDirectoryFindings.filter((item) => !consumedKeys.has(normalizePathKey(item.path)));
    return { directoryPlans, remainingTargets };
  }

  private async isExactDirectorySelection(
    directoryPath: string,
    selectedFindings: ScanFinding[]
  ): Promise<boolean> {
    const expectedKeys = new Set(selectedFindings.map((finding) => normalizePathKey(finding.path)));
    const inspection = await inspectDirectorySelection(directoryPath, expectedKeys, expectedKeys.size);
    return inspection.exact;
  }

  private getCleanupGuard(
    finding: ScanFinding,
    protectionPreferences: ProtectionPreferences
  ): { allowed: boolean; reason?: string } {
    if (finding.executionBlocked || finding.storageSafety === "advanced" || finding.storageSafety === "never") {
      return {
        allowed: false,
        reason: "This storage finding is report-only or requires a native/manual cleanup flow."
      };
    }
    if (finding.reviewOnly || (finding.storageAction && finding.storageAction !== "quarantine")) {
      return {
        allowed: false,
        reason: "This storage finding requires manual review and is not executable from one-click cleanup."
      };
    }
    const targetPath = finding.path;
    const pathMatch = matchNeverCleanupPath(targetPath, protectionPreferences.neverCleanupPaths);
    if (pathMatch) {
      return {
        allowed: false,
        reason: `Path is on your never-cleanup allowlist: ${pathMatch}`
      };
    }

    return canQuarantinePath(targetPath, "scan");
  }
}
