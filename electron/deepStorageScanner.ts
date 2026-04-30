import fs from "fs/promises";
import path from "path";
import {
  DeepStorageCategorySummary,
  DeepStorageFinding,
  ScanFinding
} from "./types";
import {
  buildStorageRules,
  expandStorageRuleRoots,
  matchStorageRuleForPath,
  resolveStorageEnvironment,
  StorageEnvironment,
  StorageRule
} from "./storageRulesCatalog";
import { evaluatePathSafety } from "./pathSafetyService";
import {
  createDeepStorageFinding,
  isUnderOrSamePath,
  normalizeStoragePath,
  summarizeStoragePath
} from "./storageScannerUtils";
import { analyzeDeveloperCaches } from "./developerCacheAnalyzer";
import { analyzeEpicLauncher, analyzeSteamLibrary } from "./gameLauncherAnalyzer";
import { collectInstalledAppsRegistry } from "./installedAppsRegistry";
import { detectOrphanAppData } from "./orphanAppDataDetector";

export interface DeepStorageScanOptions {
  env?: StorageEnvironment;
  customRoots?: string[];
  minLargeFileBytes?: number;
  maxDepth?: number;
  topN?: number;
  isCanceled?: () => boolean;
  includeOrphans?: boolean;
}

export interface DeepStorageScanResult {
  findings: DeepStorageFinding[];
  scanFindings: ScanFinding[];
  summary: {
    bytesFound: number;
    selectedBytes: number;
    reviewBytes: number;
    advancedBytes: number;
    skippedPaths: number;
    deniedPaths: number;
    summaries: DeepStorageCategorySummary[];
  };
}

function isCanceled(options: DeepStorageScanOptions): boolean {
  return Boolean(options.isCanceled?.());
}

function uniqueFindings(findings: DeepStorageFinding[]): DeepStorageFinding[] {
  const seen = new Set<string>();
  const output: DeepStorageFinding[] = [];
  for (const finding of findings.sort((left, right) => right.sizeBytes - left.sizeBytes)) {
    const key = normalizeStoragePath(finding.path);
    if ([...seen].some((existing) => isUnderOrSamePath(key, existing) || isUnderOrSamePath(existing, key))) {
      continue;
    }
    seen.add(key);
    output.push(finding);
  }
  return output;
}

function toScanFinding(finding: DeepStorageFinding): ScanFinding {
  const blocked = finding.safety === "advanced" || finding.safety === "never" || finding.action !== "quarantine";
  return {
    id: finding.id,
    path: finding.path,
    category: finding.category,
    sizeBytes: finding.sizeBytes,
    risk: finding.safety === "safe" ? "low" : finding.safety === "rebuildable" ? "medium" : "high",
    reason: finding.explanation,
    sourceRuleId: `deep-storage:${finding.ruleId}`,
    selectedByDefault: finding.selectedByDefault && !blocked,
    modifiedAt: finding.modifiedAt,
    kind: finding.kind,
    entryCount: finding.entryCount,
    origin: "deep_storage",
    storageSafety: finding.safety,
    storageAction: finding.action,
    storageSource: finding.source,
    reviewOnly: blocked || finding.safety === "review",
    executionBlocked: blocked,
    evidence: finding.evidence
  };
}

function buildSummary(findings: DeepStorageFinding[], skippedPaths: number, deniedPaths: number): DeepStorageScanResult["summary"] {
  const summaries = new Map<string, DeepStorageCategorySummary>();
  let bytesFound = 0;
  let selectedBytes = 0;
  let reviewBytes = 0;
  let advancedBytes = 0;

  for (const finding of findings) {
    bytesFound += finding.sizeBytes;
    if (finding.selectedByDefault) {
      selectedBytes += finding.sizeBytes;
    }
    if (finding.safety === "review" || finding.action === "manualReview") {
      reviewBytes += finding.sizeBytes;
    }
    if (finding.safety === "advanced" || finding.safety === "never" || finding.action === "nativeTool" || finding.action === "reportOnly") {
      advancedBytes += finding.sizeBytes;
    }
    const key = `${finding.source}:${finding.safety}`;
    const existing = summaries.get(key) ?? {
      source: finding.source,
      safety: finding.safety,
      bytes: 0,
      count: 0
    };
    existing.bytes += finding.sizeBytes;
    existing.count += 1;
    summaries.set(key, existing);
  }

  return {
    bytesFound,
    selectedBytes,
    reviewBytes,
    advancedBytes,
    skippedPaths,
    deniedPaths,
    summaries: [...summaries.values()].sort((left, right) => right.bytes - left.bytes)
  };
}

async function scanRuleRoots(rules: StorageRule[], options: DeepStorageScanOptions): Promise<{ findings: DeepStorageFinding[]; skippedPaths: number; deniedPaths: number }> {
  const findings: DeepStorageFinding[] = [];
  let skippedPaths = 0;
  let deniedPaths = 0;
  for (const root of expandStorageRuleRoots(rules)) {
    if (isCanceled(options)) {
      break;
    }
    const ruleMatch = matchStorageRuleForPath(root, rules);
    if (!ruleMatch) {
      continue;
    }
    const summary = await summarizeStoragePath(root, {
      maxDepth: options.maxDepth ?? 5,
      isCanceled: options.isCanceled
    });
    skippedPaths += summary.skippedPaths;
    deniedPaths += summary.deniedPaths;
    if (!summary.exists || summary.sizeBytes <= 0) {
      continue;
    }
    const safety = await evaluatePathSafety(root);
    const blockedByPath = !safety.executionAllowed;
    findings.push(createDeepStorageFinding({
      path: root,
      kind: summary.kind,
      category: ruleMatch.category,
      source: ruleMatch.source,
      sizeBytes: summary.sizeBytes,
      entryCount: summary.entryCount,
      modifiedAt: summary.modifiedAt,
      safety: blockedByPath ? "never" : ruleMatch.safety,
      action: blockedByPath ? "reportOnly" : ruleMatch.action,
      selectedByDefault: ruleMatch.safety === "safe" && ruleMatch.action === "quarantine" && !blockedByPath,
      ruleId: ruleMatch.ruleId,
      explanation: blockedByPath ? safety.reason : ruleMatch.explanation,
      evidence: blockedByPath ? [safety.reason, ...ruleMatch.evidence] : ruleMatch.evidence
    }));
  }
  return { findings, skippedPaths, deniedPaths };
}

async function scanLargeFiles(options: DeepStorageScanOptions, env: Required<StorageEnvironment>): Promise<DeepStorageFinding[]> {
  const minLargeFileBytes = options.minLargeFileBytes ?? 2 * 1024 ** 3;
  const roots = [
    path.join(env.userProfile, "Downloads"),
    path.join(env.userProfile, "Desktop"),
    path.join(env.userProfile, "Documents"),
    path.join(env.userProfile, "Videos"),
    ...(options.customRoots ?? [])
  ].filter(Boolean);
  const extensions = new Set([".iso", ".zip", ".rar", ".7z", ".tar", ".gz", ".msi", ".exe", ".mp4", ".mov", ".mkv", ".bak", ".old", ".log", ".dmp", ".vhd", ".vhdx"]);
  const findings: DeepStorageFinding[] = [];
  const pending = roots.map((root) => ({ root, depth: 0 }));
  const maxDepth = Math.max(1, options.maxDepth ?? 3);

  while (pending.length && !isCanceled(options)) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    const entries = await fs.readdir(current.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(current.root, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          pending.push({ root: target, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const stat = await fs.stat(target).catch(() => null);
      if (!stat?.isFile() || stat.size < minLargeFileBytes) {
        continue;
      }
      findings.push(createDeepStorageFinding({
        path: target,
        kind: "file",
        category: path.extname(entry.name).toLowerCase() === ".dmp" ? "crash_dumps" : "installer_artifacts",
        source: "large_file",
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
        safety: "review",
        action: "manualReview",
        selectedByDefault: false,
        ruleId: "large-personal-file",
        explanation: "Large personal files are review-only and never auto-cleaned.",
        evidence: ["Manual review required", `${path.extname(entry.name).toLowerCase()} file`]
      }));
    }
  }

  return findings;
}

async function scanLauncherFindings(env: Required<StorageEnvironment>, options: DeepStorageScanOptions): Promise<DeepStorageFinding[]> {
  const findings: DeepStorageFinding[] = [];
  const steamCandidates = [
    path.join(env.programFilesX86, "Steam"),
    path.join(env.programFiles, "Steam"),
    path.join(env.localAppData, "Steam")
  ];
  for (const candidate of steamCandidates) {
    if (isCanceled(options)) {
      break;
    }
    findings.push(...await analyzeSteamLibrary(candidate));
  }
  findings.push(...await analyzeEpicLauncher({
    installRoots: [path.join(env.programFiles, "Epic Games")],
    manifestRoots: [path.join(env.programData, "Epic", "EpicGamesLauncher", "Data", "Manifests")]
  }));
  return findings;
}

export async function scanDeepStorage(options: DeepStorageScanOptions = {}): Promise<DeepStorageScanResult> {
  const env = { ...resolveStorageEnvironment(), ...options.env };
  const rules = buildStorageRules(env);
  const ruleResult = await scanRuleRoots(rules, options);
  const findings = [...ruleResult.findings];

  if (!isCanceled(options)) {
    findings.push(...await analyzeDeveloperCaches({
      env,
      minLargeFileBytes: options.minLargeFileBytes,
      isCanceled: options.isCanceled
    }));
  }
  if (!isCanceled(options)) {
    findings.push(...await scanLauncherFindings(env, options));
  }
  if (!isCanceled(options) && options.includeOrphans) {
    const installedApps = await collectInstalledAppsRegistry().catch(() => []);
    findings.push(...await detectOrphanAppData({
      roots: [env.localAppData, env.appData, env.programData].filter(Boolean),
      installedApps,
      isCanceled: options.isCanceled
    }));
  }
  if (!isCanceled(options)) {
    findings.push(...await scanLargeFiles(options, env));
  }

  const unique = uniqueFindings(findings)
    .slice(0, Math.max(1, options.topN ?? 80));
  const summary = buildSummary(unique, ruleResult.skippedPaths, ruleResult.deniedPaths);
  return {
    findings: unique,
    scanFindings: unique.map(toScanFinding),
    summary
  };
}
