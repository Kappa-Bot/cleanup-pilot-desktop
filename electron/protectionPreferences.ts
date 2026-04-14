import path from "path";
import { ProtectionPreferences } from "./types";

function normalizePathKey(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\").toLowerCase();
}

function normalizeAppKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(items: string[], normalizer: (value: string) => string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizer(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

export function normalizeProtectionPreferences(
  input?: Partial<ProtectionPreferences> | null
): ProtectionPreferences {
  return {
    neverCleanupPaths: unique(input?.neverCleanupPaths ?? [], normalizePathKey),
    neverCleanupApps: unique(input?.neverCleanupApps ?? [], normalizeAppKey)
  };
}

export function matchNeverCleanupPath(targetPath: string, protectedPaths: string[]): string | undefined {
  const normalizedTarget = normalizePathKey(targetPath);
  for (const candidate of protectedPaths) {
    const normalizedCandidate = normalizePathKey(candidate);
    if (
      normalizedTarget === normalizedCandidate ||
      normalizedTarget.startsWith(`${normalizedCandidate}\\`)
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function matchNeverCleanupApp(appName: string | undefined, protectedApps: string[]): string | undefined {
  const normalizedApp = normalizeAppKey(appName ?? "");
  if (!normalizedApp) {
    return undefined;
  }

  return protectedApps.find((candidate) => normalizeAppKey(candidate) === normalizedApp);
}
