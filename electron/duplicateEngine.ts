import fs from "fs/promises";
import { createReadStream } from "fs";
import type { Dirent } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import { finished } from "stream/promises";
import { canQuarantinePath } from "./safetyPolicy";
import { matchNeverCleanupPath, normalizeProtectionPreferences } from "./protectionPreferences";
import { QuarantineManager } from "./quarantineManager";
import {
  CleanupExecuteResponse,
  DuplicateGroup,
  DuplicatePreviewResponse,
  DuplicateSelection,
  ProtectionPreferences
} from "./types";
import { getDefaultRoots } from "./rulePack";

interface FileCandidate {
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

interface DuplicateEngineDependencies {
  resolveProtectionPreferences?: () => Promise<ProtectionPreferences> | ProtectionPreferences;
}

const PARTIAL_HASH_SIZE = 64 * 1024;

async function hashPartial(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stats = await handle.stat();
    const size = stats.size;
    const firstLength = Math.min(PARTIAL_HASH_SIZE, size);
    const lastLength = Math.min(PARTIAL_HASH_SIZE, size);
    const firstBuffer = Buffer.alloc(firstLength);
    const lastBuffer = Buffer.alloc(lastLength);

    await handle.read(firstBuffer, 0, firstLength, 0);
    await handle.read(lastBuffer, 0, lastLength, Math.max(0, size - lastLength));

    return createHash("sha256")
      .update(String(size))
      .update(firstBuffer)
      .update(lastBuffer)
      .digest("hex");
  } finally {
    await handle.close();
  }
}

async function hashFull(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 512 });

  stream.on("data", (chunk: Buffer) => {
    hash.update(chunk);
  });

  await finished(stream);
  return hash.digest("hex");
}

async function collectCandidates(
  roots: string[],
  minSizeBytes: number,
  protectionPreferences: ProtectionPreferences
): Promise<FileCandidate[]> {
  const pending = [...roots];
  const out: FileCandidate[] = [];

  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (matchNeverCleanupPath(target, protectionPreferences.neverCleanupPaths)) {
        continue;
      }

      try {
        const stats = await fs.stat(target);
        if (stats.isFile() && stats.size >= minSizeBytes) {
          out.push({
            path: target,
            sizeBytes: stats.size,
            modifiedAt: stats.mtimeMs
          });
        }
      } catch {
        continue;
      }
    }
  }

  return out;
}

function groupBySize(files: FileCandidate[]): Map<number, FileCandidate[]> {
  const map = new Map<number, FileCandidate[]>();
  for (const file of files) {
    const list = map.get(file.sizeBytes) ?? [];
    list.push(file);
    map.set(file.sizeBytes, list);
  }
  return map;
}

export class DuplicateEngine {
  private readonly resolveProtectionPreferences: () => Promise<ProtectionPreferences> | ProtectionPreferences;

  constructor(dependencies: DuplicateEngineDependencies = {}) {
    this.resolveProtectionPreferences =
      dependencies.resolveProtectionPreferences ?? (() => normalizeProtectionPreferences());
  }

  async scan(roots: string[], minSizeBytes = 1): Promise<DuplicateGroup[]> {
    const effectiveRoots = (roots.length ? roots : getDefaultRoots([])).filter(
      (item, index, list) => list.indexOf(item) === index
    );
    const protectionPreferences = normalizeProtectionPreferences(
      await Promise.resolve(this.resolveProtectionPreferences()).catch(() => normalizeProtectionPreferences())
    );
    const candidates = await collectCandidates(effectiveRoots, Math.max(1, minSizeBytes), protectionPreferences);
    const sizeGroups = groupBySize(candidates);
    const groups: DuplicateGroup[] = [];

    for (const [, sameSizeFiles] of sizeGroups.entries()) {
      if (sameSizeFiles.length < 2) {
        continue;
      }

      const partialMap = new Map<string, FileCandidate[]>();
      for (const file of sameSizeFiles) {
        try {
          const partialHash = await hashPartial(file.path);
          const list = partialMap.get(partialHash) ?? [];
          list.push(file);
          partialMap.set(partialHash, list);
        } catch {
          continue;
        }
      }

      for (const [, partialFiles] of partialMap.entries()) {
        if (partialFiles.length < 2) {
          continue;
        }

        const fullMap = new Map<string, FileCandidate[]>();
        for (const file of partialFiles) {
          try {
            const fullHash = await hashFull(file.path);
            const list = fullMap.get(fullHash) ?? [];
            list.push(file);
            fullMap.set(fullHash, list);
          } catch {
            continue;
          }
        }

        for (const [fullHash, fullFiles] of fullMap.entries()) {
          if (fullFiles.length < 2) {
            continue;
          }

          const sorted = [...fullFiles].sort((a, b) => b.modifiedAt - a.modifiedAt);
          const files = sorted.map((item, index) => ({
            path: item.path,
            sizeBytes: item.sizeBytes,
            modifiedAt: item.modifiedAt,
            selected: index > 0
          }));
          const bytesRecoverable = files
            .filter((item) => item.selected)
            .reduce((sum, item) => sum + item.sizeBytes, 0);

          groups.push({
            id: randomUUID(),
            hash: fullHash,
            files,
            bytesRecoverable
          });
        }
      }
    }

    return groups.sort((a, b) => b.bytesRecoverable - a.bytesRecoverable);
  }

  previewResolution(groups: DuplicateGroup[], selections: DuplicateSelection[]): DuplicatePreviewResponse {
    const groupMap = new Map(groups.map((group) => [group.id, group]));
    let toKeep = 0;
    let toQuarantine = 0;
    let bytesRecoverable = 0;

    for (const selection of selections) {
      const group = groupMap.get(selection.groupId);
      if (!group) {
        continue;
      }
      if (selection.keepPath) {
        toKeep += 1;
      }
      toQuarantine += selection.removePaths.length;

      for (const removePath of selection.removePaths) {
        const file = group.files.find((item) => item.path === removePath);
        bytesRecoverable += file?.sizeBytes ?? 0;
      }
    }

    return {
      toKeep,
      toQuarantine,
      bytesRecoverable
    };
  }

  async executeResolution(
    groups: DuplicateGroup[],
    selections: DuplicateSelection[],
    quarantineManager: QuarantineManager
  ): Promise<CleanupExecuteResponse> {
    const protectionPreferences = normalizeProtectionPreferences(
      await Promise.resolve(this.resolveProtectionPreferences()).catch(() => normalizeProtectionPreferences())
    );
    const groupMap = new Map(groups.map((group) => [group.id, group]));
    let movedCount = 0;
    let failedCount = 0;
    let freedBytes = 0;
    const errors: string[] = [];
    const movedIds: string[] = [];
    const failedIds: string[] = [];

    for (const selection of selections) {
      const group = groupMap.get(selection.groupId);
      if (!group) {
        continue;
      }

      const allowedKeep = new Set(group.files.map((item) => item.path));
      if (!allowedKeep.has(selection.keepPath)) {
        failedCount += selection.removePaths.length;
        failedIds.push(...selection.removePaths);
        errors.push(`Invalid keepPath for group ${group.id}`);
        continue;
      }

      for (const removePath of selection.removePaths) {
        if (!allowedKeep.has(removePath)) {
          failedCount += 1;
          failedIds.push(removePath);
          errors.push(`Invalid remove path for group ${group.id}: ${removePath}`);
          continue;
        }

        const allowlistPath = matchNeverCleanupPath(removePath, protectionPreferences.neverCleanupPaths);
        if (allowlistPath) {
          failedCount += 1;
          failedIds.push(removePath);
          errors.push(`${removePath}: Path is on your never-cleanup allowlist: ${allowlistPath}`);
          continue;
        }

        const guard = canQuarantinePath(removePath, "duplicate");
        if (!guard.allowed) {
          failedCount += 1;
          failedIds.push(removePath);
          errors.push(`${removePath}: ${guard.reason ?? "Blocked by safety policy"}`);
          continue;
        }

        try {
          const sourceItem = group.files.find((item) => item.path === removePath);
          await quarantineManager.quarantineFile(removePath, {
            category: "duplicates",
            source: "duplicate",
            hash: group.hash
          });
          movedCount += 1;
          movedIds.push(removePath);
          freedBytes += sourceItem?.sizeBytes ?? 0;
        } catch (error) {
          failedCount += 1;
          failedIds.push(removePath);
          const message = error instanceof Error ? error.message : "Unknown error";
          errors.push(`${removePath}: ${message}`);
        }
      }
    }

    return { movedCount, failedCount, freedBytes, errors, movedIds, failedIds };
  }
}
