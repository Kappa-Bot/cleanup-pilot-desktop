import path from "path";
import { CleanupCategory, CleanupPreset } from "./types";
import { isBinaryExtension, isInstallerPackagePath, isProtectedPath } from "./safetyPolicy";

export interface ScanRule {
  id: string;
  category: CleanupCategory;
  reason: string;
  matches: (absolutePath: string) => boolean;
}

export interface MatchedCleanupRule {
  id: string;
  category: CleanupCategory;
  reason: string;
}

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

function normalizePath(value: string): string {
  return path.normalize(value).replace(/\//g, "\\").toLowerCase();
}

function normalizedBaseName(value: string): string {
  const normalized = normalizePath(value).replace(/[\\\/]+$/g, "");
  return path.basename(normalized);
}

function hasAnySegment(normalizedPath: string, segments: string[]): boolean {
  return segments.some((segment) => normalizedPath.includes(segment));
}

function matchesTempNormalizedPath(normalized: string): boolean {
  return hasAnySegment(normalized, TEMP_SEGMENTS) || normalized.endsWith(".tmp") || normalized.endsWith(".temp");
}

function matchesCacheNormalizedPath(normalized: string): boolean {
  return hasAnySegment(normalized, CACHE_SEGMENTS);
}

function matchesLogsNormalizedPath(normalized: string): boolean {
  return normalized.endsWith(".log") || normalized.endsWith(".etl") || normalized.endsWith(".wer") || hasAnySegment(normalized, LOG_SEGMENTS);
}

function matchesCrashDumpNormalizedPath(normalized: string): boolean {
  return normalized.endsWith(".dmp") || normalized.endsWith(".mdmp") || normalized.includes("\\crashdumps\\");
}

function matchesWslLeftoversNormalizedPath(normalized: string): boolean {
  if (!hasAnySegment(normalized, WSL_ROOT_SEGMENTS)) {
    return false;
  }

  if (normalized.endsWith(".vhd") || normalized.endsWith(".vhdx") || normalized.endsWith(".iso")) {
    return false;
  }

  return (
    hasAnySegment(normalized, WSL_DISPOSABLE_SEGMENTS) ||
    normalized.endsWith(".log") ||
    normalized.endsWith(".etl") ||
    normalized.endsWith(".tmp") ||
    normalized.endsWith(".temp") ||
    normalized.endsWith(".old") ||
    normalized.endsWith(".bak")
  );
}

function matchesMinecraftNormalizedPath(normalized: string): boolean {
  return hasAnySegment(normalized, MINECRAFT_SEGMENTS);
}

function matchesAiModelNormalizedPath(normalized: string): boolean {
  return hasAnySegment(normalized, AI_MODEL_SEGMENTS);
}

const TEMP_SEGMENTS = [
  "\\temp\\",
  "\\tmp\\",
  "\\tempstate\\",
  "\\squirreltemp\\",
  "\\ac\\temp\\",
  "\\temporary internet files\\"
];

const CACHE_SEGMENTS = [
  "\\cache\\",
  "\\code cache\\",
  "\\gpucache\\",
  "\\shadercache\\",
  "\\shader cache\\",
  "\\grshadercache\\",
  "\\dawncache\\",
  "\\webcache\\",
  "\\inetcache\\",
  "\\cachestorage\\",
  "\\cacheddata\\",
  "\\localcache\\",
  "\\service worker\\cache\\",
  "\\service worker\\cachestorage\\",
  "\\blob_storage\\",
  "\\indexeddb\\",
  "\\deliveryoptimization\\cache\\",
  "\\cryptneturlcache\\",
  "\\nv_cache\\",
  "\\dxcache\\",
  "\\glcache\\"
];

const LOG_SEGMENTS = [
  "\\logs\\",
  "\\logfiles\\",
  "\\wer\\",
  "\\diagnosis\\",
  "\\squirrelsetup\\"
];

const WSL_ROOT_SEGMENTS = [
  "\\appdata\\local\\docker\\wsl\\",
  "\\appdata\\local\\packages\\microsoftcorporationii.windowssubsystemforlinux_",
  "\\appdata\\local\\packages\\canonicalgrouplimited.",
  "\\appdata\\local\\packages\\thedebianproject.debiangnulinux_",
  "\\appdata\\local\\packages\\kalilinux.",
  "\\appdata\\local\\packages\\suselinux",
  "\\appdata\\local\\packages\\oracle",
  "\\appdata\\local\\packages\\pengwin",
  "\\appdata\\local\\packages\\alpinelinux"
];

const WSL_DISPOSABLE_SEGMENTS = [
  "\\cache\\",
  "\\cacheddata\\",
  "\\cachestorage\\",
  "\\temp\\",
  "\\tmp\\",
  "\\logs\\",
  "\\logfiles\\",
  "\\diagnostics\\",
  "\\crashdumps\\"
];

const MINECRAFT_SEGMENTS = [
  "\\.minecraft\\mods\\",
  "\\.minecraft\\shaderpacks\\",
  "\\.minecraft\\resourcepacks\\",
  "\\curseforge\\minecraft\\instances\\",
  "\\curseforge\\cache\\",
  "\\modrinthapp\\profiles\\",
  "\\modrinth\\profiles\\",
  "\\prismlauncher\\instances\\",
  "\\multimc\\instances\\"
];

const AI_MODEL_SEGMENTS = [
  "\\.ollama\\",
  "\\huggingface\\",
  "\\deepseek\\",
  "\\llama.cpp\\",
  "\\lm studio\\",
  "\\lm-studio\\",
  "\\models\\"
];

function canMatchCleanupRule(filePath: string): boolean {
  return !isProtectedPath(filePath) && !isBinaryExtension(filePath);
}

function uniqueNormalized(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    if (!value) {
      continue;
    }
    const normalized = path.normalize(value).trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function hasRequestedCategory(categories: CleanupCategory[] | undefined, targets: CleanupCategory[]): boolean {
  if (!categories || categories.length === 0) {
    return true;
  }
  return targets.some((target) => categories.includes(target));
}

function getFocusedRoots(categories?: CleanupCategory[]): string[] {
  const userProfile = process.env.USERPROFILE ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const roamingAppData = process.env.APPDATA ?? "";
  const programData = process.env.ProgramData ?? "";
  const localLow = userProfile ? path.join(userProfile, "AppData", "LocalLow") : "";

  const roots = [
    process.env.TEMP ?? "",
    process.env.TMP ?? "",
    localAppData ? path.join(localAppData, "Temp") : "",
    localAppData ? path.join(localAppData, "CrashDumps") : "",
    userProfile ? path.join(userProfile, "Downloads") : ""
  ];

  if (hasRequestedCategory(categories, ["temp", "cache", "logs", "crash_dumps"])) {
    roots.push(
      localAppData ? path.join(localAppData, "Microsoft", "Windows", "INetCache") : "",
      localAppData ? path.join(localAppData, "Microsoft", "Windows", "WebCache") : "",
      localAppData ? path.join(localAppData, "Google", "Chrome", "User Data") : "",
      localAppData ? path.join(localAppData, "Microsoft", "Edge", "User Data") : "",
      localAppData ? path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data") : "",
      roamingAppData ? path.join(roamingAppData, "Mozilla", "Firefox", "Profiles") : "",
      roamingAppData ? path.join(roamingAppData, "Opera Software", "Opera Stable") : "",
      roamingAppData ? path.join(roamingAppData, "Opera Software", "Opera GX Stable") : "",
      localAppData ? path.join(localAppData, "Discord") : "",
      roamingAppData ? path.join(roamingAppData, "discord") : "",
      roamingAppData ? path.join(roamingAppData, "Code", "Cache") : "",
      roamingAppData ? path.join(roamingAppData, "Code", "CachedData") : "",
      roamingAppData ? path.join(roamingAppData, "Code", "GPUCache") : "",
      localAppData ? path.join(localAppData, "Steam", "htmlcache") : "",
      localAppData ? path.join(localAppData, "EpicGamesLauncher", "Saved", "webcache") : "",
      localAppData ? path.join(localAppData, "Battle.net", "Cache") : "",
      localAppData ? path.join(localAppData, "Packages") : "",
      localAppData ? path.join(localAppData, "Packages", "MSTeams_8wekyb3d8bbwe") : "",
      localAppData ? path.join(localAppData, "Microsoft", "OneDrive", "logs") : "",
      localAppData ? path.join(localAppData, "Microsoft", "OneDrive", "setup", "logs") : "",
      localAppData ? path.join(localAppData, "Microsoft", "Teams") : "",
      roamingAppData ? path.join(roamingAppData, "Microsoft", "Teams") : "",
      programData ? path.join(programData, "Microsoft", "Windows", "DeliveryOptimization", "Cache") : "",
      programData ? path.join(programData, "Microsoft", "Windows", "WER") : "",
      programData ? path.join(programData, "Microsoft", "Diagnosis") : "",
      localAppData ? path.join(localAppData, "NVIDIA", "DXCache") : "",
      localAppData ? path.join(localAppData, "NVIDIA", "GLCache") : "",
      localAppData ? path.join(localAppData, "NVIDIA Corporation", "NV_Cache") : "",
      localAppData ? path.join(localAppData, "D3DSCache") : "",
      localAppData ? path.join(localAppData, "AMD", "DxCache") : "",
      localAppData ? path.join(localAppData, "AMD", "GLCache") : "",
      localLow ? path.join(localLow, "NVIDIA", "PerDriverVersion", "DXCache") : ""
    );
  }

  if (hasRequestedCategory(categories, ["wsl_leftovers", "temp", "cache", "logs"])) {
    roots.push(
      localAppData ? path.join(localAppData, "Docker", "wsl") : "",
      localAppData ? path.join(localAppData, "Packages", "MicrosoftCorporationII.WindowsSubsystemForLinux_8wekyb3d8bbwe") : "",
      localAppData ? path.join(localAppData, "Packages", "CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc") : "",
      localAppData ? path.join(localAppData, "Packages", "TheDebianProject.DebianGNULinux_76v4gfsz19hv4") : "",
      localAppData ? path.join(localAppData, "Packages", "KaliLinux.54290C8133FEE_ey8k8hqnwqnmg") : "",
      localAppData ? path.join(localAppData, "Packages") : ""
    );
  }

  if (hasRequestedCategory(categories, ["minecraft_leftovers"])) {
    roots.push(
      userProfile ? path.join(userProfile, "curseforge") : "",
      roamingAppData ? path.join(roamingAppData, "CurseForge") : "",
      roamingAppData ? path.join(roamingAppData, "ModrinthApp") : "",
      roamingAppData ? path.join(roamingAppData, ".minecraft") : "",
      userProfile ? path.join(userProfile, ".minecraft") : "",
      roamingAppData ? path.join(roamingAppData, "PrismLauncher") : "",
      userProfile ? path.join(userProfile, "MultiMC") : ""
    );
  }

  if (hasRequestedCategory(categories, ["ai_model_leftovers", "cache"])) {
    roots.push(
      userProfile ? path.join(userProfile, ".ollama") : "",
      localAppData ? path.join(localAppData, "Programs", "Ollama") : "",
      userProfile ? path.join(userProfile, ".cache", "huggingface") : "",
      userProfile ? path.join(userProfile, ".cache", "deepseek") : "",
      userProfile ? path.join(userProfile, ".cache", "llama.cpp") : "",
      localAppData ? path.join(localAppData, "LM Studio") : "",
      localAppData ? path.join(localAppData, "pip", "Cache") : "",
      userProfile ? path.join(userProfile, ".npm", "_cacache") : "",
      roamingAppData ? path.join(roamingAppData, "npm-cache") : "",
      localAppData ? path.join(localAppData, "Yarn", "Cache") : "",
      localAppData ? path.join(localAppData, "pnpm-store") : ""
    );
  }

  if (hasRequestedCategory(categories, ["installer_artifacts"])) {
    roots.push(
      programData ? path.join(programData, "Package Cache") : "",
      programData ? path.join(programData, "NVIDIA Corporation", "Downloader") : ""
    );
  }

  return uniqueNormalized(roots);
}

function getBroadRoots(categories?: CleanupCategory[]): string[] {
  const userProfile = process.env.USERPROFILE ?? "";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const roamingAppData = process.env.APPDATA ?? "";
  const programData = process.env.ProgramData ?? "";
  const localLow = userProfile ? path.join(userProfile, "AppData", "LocalLow") : "";

  const roots = [localAppData, roamingAppData];

  if (hasRequestedCategory(categories, ["temp", "cache", "logs", "crash_dumps"])) {
    roots.push(localLow);
  }

  if (hasRequestedCategory(categories, ["cache", "ai_model_leftovers"])) {
    roots.push(
      userProfile ? path.join(userProfile, ".cache") : "",
      userProfile ? path.join(userProfile, ".npm") : "",
      userProfile ? path.join(userProfile, ".yarn") : "",
      userProfile ? path.join(userProfile, ".nuget") : "",
      userProfile ? path.join(userProfile, ".gradle") : ""
    );
  }

  if (hasRequestedCategory(categories, ["installer_artifacts", "cache"])) {
    roots.push(
      programData ? path.join(programData, "Package Cache") : "",
      programData ? path.join(programData, "NVIDIA Corporation") : "",
      programData ? path.join(programData, "Microsoft", "Windows", "DeliveryOptimization") : ""
    );
  }

  if (hasRequestedCategory(categories, ["temp", "cache", "logs", "crash_dumps"])) {
    roots.push(
      localAppData ? path.join(localAppData, "Microsoft", "OneDrive") : "",
      localAppData ? path.join(localAppData, "Microsoft", "Teams") : "",
      roamingAppData ? path.join(roamingAppData, "Microsoft", "Teams") : "",
      programData ? path.join(programData, "Microsoft", "Windows", "WER") : "",
      programData ? path.join(programData, "Microsoft", "Diagnosis") : ""
    );
  }

  if (hasRequestedCategory(categories, ["wsl_leftovers"])) {
    roots.push(
      localAppData ? path.join(localAppData, "Docker") : "",
      localAppData ? path.join(localAppData, "Packages") : ""
    );
  }

  return uniqueNormalized(roots);
}

export function matchesTempPath(filePath: string): boolean {
  return matchesTempNormalizedPath(normalizePath(filePath));
}

export function matchesCachePath(filePath: string): boolean {
  return matchesCacheNormalizedPath(normalizePath(filePath));
}

export function matchesLogsPath(filePath: string): boolean {
  return matchesLogsNormalizedPath(normalizePath(filePath));
}

export function matchesCrashDumpPath(filePath: string): boolean {
  return matchesCrashDumpNormalizedPath(normalizePath(filePath));
}

export function matchesWslLeftoversPath(filePath: string): boolean {
  return matchesWslLeftoversNormalizedPath(normalizePath(filePath));
}

export function matchesMinecraftLeftoversPath(filePath: string): boolean {
  return matchesMinecraftNormalizedPath(normalizePath(filePath));
}

export function matchesAiModelLeftoversPath(filePath: string): boolean {
  return matchesAiModelNormalizedPath(normalizePath(filePath));
}

export function matchCleanupPath(
  filePath: string,
  categories: CleanupCategory[]
): MatchedCleanupRule | null {
  const normalized = normalizePath(filePath);

  if (categories.includes("temp") && matchesTempNormalizedPath(normalized)) {
    return {
      id: "temp-path",
      category: "temp",
      reason: "Temporary file path"
    };
  }
  if (categories.includes("cache") && matchesCacheNormalizedPath(normalized)) {
    return {
      id: "cache-dir",
      category: "cache",
      reason: "Cache directory artifact"
    };
  }
  if (categories.includes("logs") && matchesLogsNormalizedPath(normalized)) {
    return {
      id: "logs",
      category: "logs",
      reason: "Log output file"
    };
  }
  if (categories.includes("crash_dumps") && matchesCrashDumpNormalizedPath(normalized)) {
    return {
      id: "crash-dumps",
      category: "crash_dumps",
      reason: "Crash dump file"
    };
  }
  if (categories.includes("wsl_leftovers") && matchesWslLeftoversNormalizedPath(normalized)) {
    return {
      id: "wsl-leftovers",
      category: "wsl_leftovers",
      reason: "WSL or container cache/log residue"
    };
  }
  if (categories.includes("installer_artifacts") && isInstallerPackagePath(normalized)) {
    return {
      id: "installer-artifacts",
      category: "installer_artifacts",
      reason: "Installer package residue"
    };
  }
  if (categories.includes("minecraft_leftovers") && matchesMinecraftNormalizedPath(normalized)) {
    return {
      id: "minecraft-leftovers",
      category: "minecraft_leftovers",
      reason: "Minecraft launcher/mod profile artifact"
    };
  }
  if (categories.includes("ai_model_leftovers") && matchesAiModelNormalizedPath(normalized)) {
    return {
      id: "ai-model-leftovers",
      category: "ai_model_leftovers",
      reason: "Local AI model/cache artifact"
    };
  }

  return null;
}

export function matchCleanupContainerDirectory(
  directoryPath: string,
  categories: CleanupCategory[]
): MatchedCleanupRule | null {
  const normalized = normalizePath(directoryPath);
  const normalizedDirectory = normalized.endsWith("\\") ? normalized : `${normalized}\\`;
  if (isProtectedPath(normalized)) {
    return null;
  }

  const baseName = normalizedBaseName(normalized);

  if (
    categories.includes("temp") &&
    TEMP_CONTAINER_NAMES.has(baseName) &&
    matchesTempNormalizedPath(normalizedDirectory)
  ) {
    return {
      id: "temp-container",
      category: "temp",
      reason: "Temporary folder container"
    };
  }
  if (
    categories.includes("cache") &&
    CACHE_CONTAINER_NAMES.has(baseName) &&
    matchesCacheNormalizedPath(normalizedDirectory)
  ) {
    return {
      id: "cache-container",
      category: "cache",
      reason: "Cache folder container"
    };
  }
  if (
    categories.includes("logs") &&
    LOG_CONTAINER_NAMES.has(baseName) &&
    matchesLogsNormalizedPath(normalizedDirectory)
  ) {
    return {
      id: "logs-container",
      category: "logs",
      reason: "Log folder container"
    };
  }
  if (
    categories.includes("crash_dumps") &&
    baseName === "crashdumps" &&
    matchesCrashDumpNormalizedPath(normalizedDirectory)
  ) {
    return {
      id: "crash-dumps-container",
      category: "crash_dumps",
      reason: "Crash dump folder container"
    };
  }
  if (
    categories.includes("wsl_leftovers") &&
    WSL_CONTAINER_NAMES.has(baseName) &&
    matchesWslLeftoversNormalizedPath(normalizedDirectory)
  ) {
    return {
      id: "wsl-leftovers-container",
      category: "wsl_leftovers",
      reason: "WSL or container disposable folder"
    };
  }
  if (
    categories.includes("installer_artifacts") &&
    INSTALLER_CONTAINER_NAMES.has(baseName) &&
    isInstallerPackagePath(normalized)
  ) {
    return {
      id: "installer-artifacts-container",
      category: "installer_artifacts",
      reason: "Installer artifact folder container"
    };
  }

  return null;
}

export function getScanRules(categories: CleanupCategory[]): ScanRule[] {
  const requested = new Set(categories);

  const rules: ScanRule[] = [
    {
      id: "temp-path",
      category: "temp",
      reason: "Temporary file path",
      matches: (filePath) => {
        if (!canMatchCleanupRule(filePath)) {
          return false;
        }
        return matchesTempPath(filePath);
      }
    },
    {
      id: "cache-dir",
      category: "cache",
      reason: "Cache directory artifact",
      matches: (filePath) => canMatchCleanupRule(filePath) && matchesCachePath(filePath)
    },
    {
      id: "logs",
      category: "logs",
      reason: "Log output file",
      matches: (filePath) => {
        if (!canMatchCleanupRule(filePath)) {
          return false;
        }
        return matchesLogsPath(filePath);
      }
    },
    {
      id: "crash-dumps",
      category: "crash_dumps",
      reason: "Crash dump file",
      matches: (filePath) => {
        if (!canMatchCleanupRule(filePath)) {
          return false;
        }
        return matchesCrashDumpPath(filePath);
      }
    },
    {
      id: "wsl-leftovers",
      category: "wsl_leftovers",
      reason: "WSL or container cache/log residue",
      matches: (filePath) => canMatchCleanupRule(filePath) && matchesWslLeftoversPath(filePath)
    },
    {
      id: "installer-artifacts",
      category: "installer_artifacts",
      reason: "Installer package residue",
      matches: (filePath) => {
        if (isProtectedPath(filePath)) {
          return false;
        }
        return isInstallerPackagePath(filePath);
      }
    },
    {
      id: "minecraft-leftovers",
      category: "minecraft_leftovers",
      reason: "Minecraft launcher/mod profile artifact",
      matches: (filePath) => canMatchCleanupRule(filePath) && matchesMinecraftLeftoversPath(filePath)
    },
    {
      id: "ai-model-leftovers",
      category: "ai_model_leftovers",
      reason: "Local AI model/cache artifact",
      matches: (filePath) => canMatchCleanupRule(filePath) && matchesAiModelLeftoversPath(filePath)
    }
  ];

  return rules.filter((rule) => requested.has(rule.category));
}

export function getDefaultRoots(
  customRoots: string[],
  preset: CleanupPreset = "standard",
  categories?: CleanupCategory[]
): string[] {
  const focused = getFocusedRoots(categories);
  const includeBroadRoots = preset === "deep" || preset === "extreme";
  const roots = includeBroadRoots ? [...focused, ...getBroadRoots(categories), ...customRoots] : [...focused, ...customRoots];
  return uniqueNormalized(roots);
}

export function shouldSelectByDefault(
  preset: CleanupPreset,
  category: CleanupCategory,
  risk: "low" | "medium" | "high"
): boolean {
  if (risk === "high") {
    return false;
  }

  if (preset === "lite") {
    return category === "temp" || category === "logs";
  }

  if (preset === "standard") {
    return category !== "installer_artifacts";
  }

  if (preset === "deep") {
    return true;
  }

  return true;
}
