import path from "path";
import {
  CleanupCategory,
  DeepStorageSource,
  StorageCleanupAction,
  StorageCleanupSafety,
  StorageRuleMatch
} from "./types";

export interface StorageEnvironment {
  userProfile?: string;
  localAppData?: string;
  appData?: string;
  localLow?: string;
  programData?: string;
  programFiles?: string;
  programFilesX86?: string;
  windowsDir?: string;
}

export interface StorageRule {
  id: string;
  category: CleanupCategory;
  source: DeepStorageSource;
  roots: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  minAgeDays?: number;
  safety: StorageCleanupSafety;
  explanation: string;
  action: StorageCleanupAction;
}

export function resolveStorageEnvironment(): Required<StorageEnvironment> {
  const userProfile = process.env.USERPROFILE ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? (userProfile ? path.join(userProfile, "AppData", "Local") : "");
  const appData = process.env.APPDATA ?? (userProfile ? path.join(userProfile, "AppData", "Roaming") : "");
  return {
    userProfile,
    localAppData,
    appData,
    localLow: userProfile ? path.join(userProfile, "AppData", "LocalLow") : "",
    programData: process.env.ProgramData ?? "C:\\ProgramData",
    programFiles: process.env.ProgramFiles ?? "C:\\Program Files",
    programFilesX86: process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    windowsDir: process.env.windir ?? "C:\\Windows"
  };
}

function normalizePath(value: string): string {
  return path.normalize(value).replace(/\//g, "\\").replace(/[\\]+$/g, "").toLowerCase();
}

function compact(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value ? path.normalize(value) : "";
    if (!normalized) {
      continue;
    }
    const key = normalizePath(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function underRoot(targetPath: string, root: string): boolean {
  const target = normalizePath(targetPath);
  const normalizedRoot = normalizePath(root);
  return target === normalizedRoot || target.startsWith(`${normalizedRoot}\\`);
}

function patternMatches(targetPath: string, pattern: string): boolean {
  const target = normalizePath(targetPath);
  const normalized = pattern.replace(/\//g, "\\").toLowerCase();
  if (normalized.startsWith("*.")) {
    return target.endsWith(normalized.slice(1));
  }
  if (!normalized.includes("*")) {
    return target.includes(normalized.replace(/[\\]+$/g, ""));
  }
  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^\\\\]*");
  return new RegExp(escaped, "i").test(target);
}

function ruleMatches(targetPath: string, rule: StorageRule): boolean {
  if (!rule.roots.some((root) => underRoot(targetPath, root))) {
    return false;
  }
  if (rule.includePatterns?.length && !rule.includePatterns.some((pattern) => patternMatches(targetPath, pattern))) {
    return false;
  }
  if (rule.excludePatterns?.some((pattern) => patternMatches(targetPath, pattern))) {
    return false;
  }
  return true;
}

export function buildStorageRules(inputEnv: StorageEnvironment = resolveStorageEnvironment()): StorageRule[] {
  const env = { ...resolveStorageEnvironment(), ...inputEnv };
  return [
    {
      id: "docker-wsl-vhdx",
      category: "wsl_leftovers",
      source: "developer_cache",
      roots: compact([
        path.join(env.localAppData, "Docker", "wsl"),
        path.join(env.localAppData, "Packages")
      ]),
      includePatterns: ["*.vhd", "*.vhdx"],
      safety: "never",
      action: "reportOnly",
      explanation: "Docker and WSL virtual disks can contain live Linux filesystems and must not be moved by cleanup."
    },
    {
      id: "windows-apps-store",
      category: "cache",
      source: "windows",
      roots: compact([path.join(env.programFiles, "WindowsApps"), path.join(env.localAppData, "Microsoft", "WindowsApps")]),
      safety: "never",
      action: "reportOnly",
      explanation: "Windows app package stores are managed by Windows and stay untouched."
    },
    {
      id: "appdata-local-temp",
      category: "temp",
      source: "appdata",
      roots: compact([path.join(env.localAppData, "Temp")]),
      minAgeDays: 1,
      safety: "safe",
      action: "quarantine",
      explanation: "User temp files are disposable when they are old enough and not locked."
    },
    {
      id: "appdata-crash-dumps",
      category: "crash_dumps",
      source: "appdata",
      roots: compact([path.join(env.localAppData, "CrashDumps")]),
      safety: "safe",
      action: "quarantine",
      explanation: "Crash dumps can be recovered later from quarantine if needed."
    },
    {
      id: "nvidia-dx-cache",
      category: "cache",
      source: "appdata",
      roots: compact([
        path.join(env.localAppData, "NVIDIA", "DXCache"),
        path.join(env.localAppData, "NVIDIA", "GLCache"),
        path.join(env.programData, "NVIDIA Corporation", "NV_Cache")
      ]),
      safety: "rebuildable",
      action: "quarantine",
      explanation: "GPU shader caches are rebuildable and often grow silently."
    },
    {
      id: "amd-intel-shader-cache",
      category: "cache",
      source: "appdata",
      roots: compact([
        path.join(env.localAppData, "AMD", "DxCache"),
        path.join(env.localAppData, "Intel", "ShaderCache"),
        path.join(env.localAppData, "D3DSCache")
      ]),
      safety: "rebuildable",
      action: "quarantine",
      explanation: "Graphics shader caches are rebuildable after cleanup."
    },
    {
      id: "windows-web-cache",
      category: "cache",
      source: "appdata",
      roots: compact([
        path.join(env.localAppData, "Microsoft", "Windows", "INetCache"),
        path.join(env.localAppData, "Microsoft", "Windows", "WebCache"),
        path.join(env.localAppData, "Microsoft", "Windows", "Explorer")
      ]),
      safety: "rebuildable",
      action: "quarantine",
      explanation: "Windows web and Explorer caches can be rebuilt."
    },
    {
      id: "appdata-code-cache",
      category: "cache",
      source: "appdata",
      roots: compact([
        path.join(env.appData, "Code", "logs"),
        path.join(env.appData, "Code", "CachedData"),
        path.join(env.appData, "Code", "Crashpad"),
        path.join(env.appData, "Discord", "Cache"),
        path.join(env.appData, "Discord", "Code Cache"),
        path.join(env.appData, "Discord", "GPUCache"),
        path.join(env.appData, "npm-cache"),
        path.join(env.appData, "Telegram Desktop", "tdata", "temp")
      ]),
      safety: "rebuildable",
      action: "quarantine",
      explanation: "Application caches and logs are rebuildable or diagnostic-only."
    },
    {
      id: "locallow-disposable",
      category: "cache",
      source: "appdata",
      roots: compact([
        path.join(env.localLow, "Unity"),
        path.join(env.localLow, "Sun", "Java", "Deployment", "cache"),
        path.join(env.localLow, "Temp"),
        path.join(env.localLow, "CrashReports"),
        path.join(env.localLow, "Logs")
      ]),
      safety: "review",
      action: "manualReview",
      explanation: "LocalLow data varies by app, so it needs review before cleanup."
    },
    {
      id: "programdata-wer-delivery",
      category: "logs",
      source: "programdata",
      roots: compact([
        path.join(env.programData, "Microsoft", "Windows", "WER", "ReportArchive"),
        path.join(env.programData, "Microsoft", "Windows", "WER", "ReportQueue"),
        path.join(env.programData, "Microsoft", "Windows", "DeliveryOptimization", "Cache")
      ]),
      safety: "advanced",
      action: "nativeTool",
      explanation: "Windows-owned report and delivery caches should be cleaned through Windows tooling."
    },
    {
      id: "programdata-launcher-cache",
      category: "cache",
      source: "game_launcher",
      roots: compact([
        path.join(env.programData, "Epic"),
        path.join(env.programData, "Battle.net"),
        path.join(env.programData, "Blizzard Entertainment")
      ]),
      safety: "review",
      action: "manualReview",
      explanation: "Game launcher data can mix cache and install metadata; review first."
    },
    {
      id: "programdata-package-cache",
      category: "installer_artifacts",
      source: "programdata",
      roots: compact([
        path.join(env.programData, "Package Cache"),
        path.join(env.programData, "Microsoft", "VisualStudio", "Packages")
      ]),
      safety: "advanced",
      action: "nativeTool",
      explanation: "Package caches can be needed for repair/uninstall and are never selected by default."
    },
    {
      id: "windows-temp-logs",
      category: "logs",
      source: "windows",
      roots: compact([
        path.join(env.windowsDir, "Temp"),
        path.join(env.windowsDir, "Logs"),
        path.join(env.windowsDir, "Minidump"),
        path.join(env.windowsDir, "Memory.dmp"),
        path.join(env.windowsDir, "Panther")
      ]),
      safety: "advanced",
      action: "nativeTool",
      explanation: "Windows-owned cleanup targets require elevated or native cleanup paths."
    },
    {
      id: "windows-update-download",
      category: "cache",
      source: "windows",
      roots: compact([path.join(env.windowsDir, "SoftwareDistribution", "Download")]),
      safety: "advanced",
      action: "nativeTool",
      explanation: "Windows Update download cache should be cleaned through Windows-controlled flow."
    },
    {
      id: "windows-old",
      category: "installer_artifacts",
      source: "windows",
      roots: compact([path.join(path.parse(env.windowsDir).root || "C:\\", "Windows.old")]),
      safety: "advanced",
      action: "nativeTool",
      explanation: "Windows.old is large but must be removed through Windows cleanup tooling."
    },
    {
      id: "developer-node-cache",
      category: "cache",
      source: "developer_cache",
      roots: compact([
        path.join(env.localAppData, "npm-cache"),
        path.join(env.appData, "npm-cache"),
        path.join(env.localAppData, "pnpm-store"),
        path.join(env.userProfile, ".npm"),
        path.join(env.userProfile, ".pnpm-store"),
        path.join(env.localAppData, "Yarn", "Cache"),
        path.join(env.localAppData, "node-gyp")
      ]),
      safety: "rebuildable",
      action: "quarantine",
      explanation: "Package manager caches can usually be restored or rebuilt."
    },
    {
      id: "developer-python-cache",
      category: "cache",
      source: "developer_cache",
      roots: compact([
        path.join(env.localAppData, "pip", "Cache"),
        path.join(env.userProfile, ".cache", "pip"),
        path.join(env.userProfile, ".conda"),
        path.join(env.userProfile, "anaconda3", "pkgs"),
        path.join(env.userProfile, "miniconda3", "pkgs")
      ]),
      safety: "rebuildable",
      action: "quarantine",
      explanation: "Python package caches are rebuildable, while environments remain review-only elsewhere."
    },
    {
      id: "developer-dotnet-java-android",
      category: "cache",
      source: "developer_cache",
      roots: compact([
        path.join(env.userProfile, ".nuget", "packages"),
        path.join(env.localAppData, "NuGet", "Cache"),
        path.join(env.localAppData, "Microsoft", "VisualStudio"),
        path.join(env.localAppData, "Microsoft", "VSCommon"),
        path.join(env.userProfile, ".gradle", "caches"),
        path.join(env.userProfile, ".m2", "repository"),
        path.join(env.localAppData, "Android", "Sdk"),
        path.join(env.userProfile, ".android", "avd")
      ]),
      safety: "review",
      action: "manualReview",
      explanation: "Developer SDK and build caches can be huge but need review to avoid expensive rebuilds."
    }
  ];
}

export function expandStorageRuleRoots(rules: StorageRule[]): string[] {
  return compact(rules.flatMap((rule) => rule.roots));
}

export function matchStorageRuleForPath(targetPath: string, rules = buildStorageRules()): (StorageRuleMatch & { id: string; source: DeepStorageSource }) | null {
  for (const rule of rules) {
    if (!ruleMatches(targetPath, rule)) {
      continue;
    }
    return {
      id: rule.id,
      ruleId: rule.id,
      category: rule.category,
      source: rule.source,
      safety: rule.safety,
      action: rule.action,
      explanation: rule.explanation,
      evidence: [`Matched ${rule.id}`]
    };
  }
  return null;
}
