import path from "path";
import { DeepStorageFinding } from "./types";
import { createDeepStorageFinding, summarizeStoragePath } from "./storageScannerUtils";

export interface DeveloperCacheEnvironment {
  userProfile?: string;
  localAppData?: string;
  appData?: string;
}

export async function analyzeDeveloperCaches(args: {
  env?: DeveloperCacheEnvironment;
  minLargeFileBytes?: number;
  isCanceled?: () => boolean;
} = {}): Promise<DeepStorageFinding[]> {
  const userProfile = args.env?.userProfile ?? process.env.USERPROFILE ?? "";
  const localAppData = args.env?.localAppData ?? process.env.LOCALAPPDATA ?? "";
  const appData = args.env?.appData ?? process.env.APPDATA ?? "";
  const findings: DeepStorageFinding[] = [];
  const cachePaths = [
    path.join(userProfile, ".npm", "_cacache"),
    path.join(userProfile, ".npm"),
    path.join(userProfile, ".pnpm-store"),
    path.join(localAppData, "npm-cache"),
    path.join(appData, "npm-cache"),
    path.join(localAppData, "pnpm-store"),
    path.join(localAppData, "Yarn", "Cache"),
    path.join(localAppData, "node-gyp"),
    path.join(localAppData, "pip", "Cache"),
    path.join(userProfile, ".cache", "pip"),
    path.join(userProfile, ".gradle", "caches"),
    path.join(userProfile, ".m2", "repository"),
    path.join(userProfile, ".nuget", "packages"),
    path.join(localAppData, "NuGet", "Cache")
  ].filter(Boolean);

  const seen = new Set<string>();
  for (const cachePath of cachePaths) {
    const key = path.normalize(cachePath).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const summary = await summarizeStoragePath(cachePath, { maxDepth: 5, isCanceled: args.isCanceled });
    if (!summary.exists || summary.sizeBytes <= 0) {
      continue;
    }
    findings.push(createDeepStorageFinding({
      path: cachePath,
      kind: summary.kind,
      category: "cache",
      source: "developer_cache",
      sizeBytes: summary.sizeBytes,
      entryCount: summary.entryCount,
      modifiedAt: summary.modifiedAt,
      safety: "rebuildable",
      action: "quarantine",
      selectedByDefault: false,
      ruleId: "developer-cache",
      explanation: "Developer package caches are rebuildable and often hide many GB.",
      evidence: ["Rebuildable package cache", "Review before cleanup"]
    }));
  }

  const dockerVhdCandidates = [
    path.join(localAppData, "Docker", "wsl", "data", "ext4.vhdx"),
    path.join(userProfile, "AppData", "Local", "Docker", "wsl", "data", "ext4.vhdx")
  ];
  for (const candidate of dockerVhdCandidates) {
    const summary = await summarizeStoragePath(candidate, { maxDepth: 0 });
    if (!summary.exists || summary.sizeBytes < (args.minLargeFileBytes ?? 1024 ** 3)) {
      continue;
    }
    findings.push(createDeepStorageFinding({
      path: candidate,
      kind: "file",
      category: "wsl_leftovers",
      source: "developer_cache",
      sizeBytes: summary.sizeBytes,
      modifiedAt: summary.modifiedAt,
      safety: "never",
      action: "reportOnly",
      selectedByDefault: false,
      ruleId: "docker-wsl-vhdx",
      explanation: "Docker and WSL virtual disks can contain live filesystems and must not be moved by cleanup.",
      evidence: ["Report-only VHDX", "Use Docker or WSL tooling"]
    }));
  }

  return findings;
}
