import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import {
  CleanupCategory,
  DeepStorageFinding,
  DeepStorageSource,
  StorageCleanupAction,
  StorageCleanupSafety
} from "./types";

export interface StoragePathSummary {
  exists: boolean;
  kind: "file" | "directory";
  sizeBytes: number;
  entryCount: number;
  modifiedAt: number;
  skippedPaths: number;
  deniedPaths: number;
}

export interface StorageFindingInput {
  path: string;
  kind: "file" | "directory";
  category: CleanupCategory;
  source: DeepStorageSource;
  sizeBytes: number;
  entryCount?: number;
  modifiedAt?: number;
  safety: StorageCleanupSafety;
  action: StorageCleanupAction;
  selectedByDefault?: boolean;
  ruleId: string;
  explanation: string;
  evidence?: string[];
}

function hashId(value: string): string {
  return createHash("sha1").update(value.toLowerCase()).digest("hex").slice(0, 16);
}

export function normalizeStoragePath(value: string): string {
  return path.normalize(value).replace(/\//g, "\\").replace(/[\\]+$/g, "").toLowerCase();
}

export function isUnderOrSamePath(targetPath: string, rootPath: string): boolean {
  const target = normalizeStoragePath(targetPath);
  const root = normalizeStoragePath(rootPath);
  return target === root || target.startsWith(`${root}\\`);
}

export function createDeepStorageFinding(input: StorageFindingInput): DeepStorageFinding {
  const selectedByDefault =
    input.selectedByDefault ??
    (input.safety === "safe" && input.action === "quarantine");
  return {
    id: `deep:${input.ruleId}:${hashId(input.path)}:${randomUUID().slice(0, 8)}`,
    path: path.normalize(input.path),
    kind: input.kind,
    category: input.category,
    source: input.source,
    sizeBytes: input.sizeBytes,
    entryCount: input.entryCount,
    modifiedAt: input.modifiedAt ?? Date.now(),
    safety: input.safety,
    action: input.action,
    selectedByDefault: selectedByDefault && input.safety !== "advanced" && input.safety !== "never",
    ruleId: input.ruleId,
    explanation: input.explanation,
    evidence: input.evidence ?? []
  };
}

export async function summarizeStoragePath(
  targetPath: string,
  options: {
    maxDepth?: number;
    isCanceled?: () => boolean;
  } = {}
): Promise<StoragePathSummary> {
  const maxDepth = Math.max(0, options.maxDepth ?? 5);
  const first = await fs.lstat(targetPath).catch(() => null);
  if (!first) {
    return {
      exists: false,
      kind: "file",
      sizeBytes: 0,
      entryCount: 0,
      modifiedAt: 0,
      skippedPaths: 0,
      deniedPaths: 0
    };
  }
  if (first.isSymbolicLink()) {
    return {
      exists: true,
      kind: first.isDirectory() ? "directory" : "file",
      sizeBytes: 0,
      entryCount: 0,
      modifiedAt: first.mtimeMs,
      skippedPaths: 1,
      deniedPaths: 0
    };
  }
  if (!first.isDirectory()) {
    return {
      exists: true,
      kind: "file",
      sizeBytes: first.size,
      entryCount: 1,
      modifiedAt: first.mtimeMs,
      skippedPaths: 0,
      deniedPaths: 0
    };
  }

  let sizeBytes = 0;
  let entryCount = 0;
  let modifiedAt = first.mtimeMs;
  let skippedPaths = 0;
  let deniedPaths = 0;
  const pending: Array<{ directoryPath: string; depth: number }> = [{ directoryPath: targetPath, depth: 0 }];

  while (pending.length) {
    if (options.isCanceled?.()) {
      break;
    }
    const current = pending.pop();
    if (!current) {
      break;
    }
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current.directoryPath, { withFileTypes: true });
    } catch {
      deniedPaths += 1;
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current.directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        skippedPaths += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          pending.push({ directoryPath: child, depth: current.depth + 1 });
        } else {
          skippedPaths += 1;
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = await fs.stat(child).catch(() => null);
      if (!stat?.isFile()) {
        continue;
      }
      sizeBytes += stat.size;
      entryCount += 1;
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
    }
  }

  return {
    exists: true,
    kind: "directory",
    sizeBytes,
    entryCount,
    modifiedAt,
    skippedPaths,
    deniedPaths
  };
}
