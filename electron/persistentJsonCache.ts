import fs from "fs/promises";
import os from "os";
import path from "path";
import { parseJsonPayload } from "./jsonPayload";

interface CacheEnvelope<T> {
  version: 1;
  entries: Record<string, T>;
}

const CACHE_VERSION = 1;
const writeTimers = new Map<string, NodeJS.Timeout>();

function resolveCacheRoot(): string {
  if (process.env.CLEANUP_PILOT_CACHE_DIR) {
    return process.env.CLEANUP_PILOT_CACHE_DIR;
  }

  try {
    const electron = require("electron") as { app?: { getPath?: (name: string) => string } };
    const userData = electron.app?.getPath?.("userData");
    if (userData) {
      return path.join(userData, "runtime-cache");
    }
  } catch {
    // Fallback outside Electron.
  }

  return path.join(os.tmpdir(), "cleanup-pilot-desktop-cache");
}

function resolveCacheFile(fileName: string): string {
  return path.join(resolveCacheRoot(), fileName);
}

export async function readPersistentJsonCache<T>(fileName: string): Promise<Record<string, T>> {
  const targetFile = resolveCacheFile(fileName);
  try {
    const raw = await fs.readFile(targetFile, "utf8");
    const parsed = parseJsonPayload<CacheEnvelope<T>>(raw, `Persistent cache file ${fileName}`);
    if (!parsed || parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
      return {};
    }
    return parsed.entries;
  } catch {
    return {};
  }
}

async function writePersistentJsonCache<T>(fileName: string, entries: Record<string, T>): Promise<void> {
  const targetFile = resolveCacheFile(fileName);
  const targetDir = path.dirname(targetFile);
  const tempFile = `${targetFile}.tmp`;
  const payload: CacheEnvelope<T> = {
    version: CACHE_VERSION,
    entries
  };

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(payload), "utf8");
  await fs.rename(tempFile, targetFile);
}

export function schedulePersistentJsonCacheWrite<T>(
  fileName: string,
  entries: Record<string, T>,
  delayMs = 300
): void {
  const existing = writeTimers.get(fileName);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    writeTimers.delete(fileName);
    void writePersistentJsonCache(fileName, entries).catch(() => {
      // Best-effort local cache only.
    });
  }, delayMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  writeTimers.set(fileName, timer);
}
