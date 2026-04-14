import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { parseJsonPayload } from "./jsonPayload";

const execFileAsync = promisify(execFile);
const BINARY_EXTENSIONS = new Set([".exe", ".dll", ".sys", ".drv", ".com"]);
const APPDATA_FOLDER_IGNORE = new Set([
  "microsoft",
  "packages",
  "connecteddevicesplatform",
  "crashdumps",
  "temp",
  "tempstate",
  "programs",
  "assembly",
  "fontcache",
  "grouping",
  "nvidia corporation",
  "nvidia",
  "intel",
  "amd"
]);

export interface InstalledAppRecord {
  name: string;
  installLocation?: string;
}

export interface InstalledAppProtectionMatch {
  kind: "installed_app_location" | "installed_app_name_match";
  appName: string;
}

let installedAppsCache: InstalledAppRecord[] = [];
let installedAppsCachedAt = 0;
let installedAppsInFlight: Promise<InstalledAppRecord[]> | null = null;
const INSTALLED_APPS_CACHE_TTL_MS = 5 * 60 * 1000;

function normalizePath(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\");
}

function normalizeLowerPath(inputPath: string): string {
  return normalizePath(inputPath).toLowerCase();
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(value: string): string[] {
  const stopWords = new Set(["app", "apps", "inc", "llc", "corp", "corporation", "co", "the", "software", "launcher", "updater"]);
  return normalizeName(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function isBinaryExtension(targetPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

function extractAppDataFolderName(targetPath: string): string | undefined {
  const normalized = normalizeLowerPath(targetPath);
  const match = normalized.match(/\\appdata\\(?:local|roaming)\\([^\\]+)/);
  const folderName = match?.[1]?.trim();
  if (!folderName || APPDATA_FOLDER_IGNORE.has(folderName)) {
    return undefined;
  }
  return folderName;
}

export function findMatchingInstalledAppName(
  folderName: string,
  installedNames: string[]
): string | undefined {
  const normalizedFolder = normalizeName(folderName);
  const folderTokens = tokenize(folderName);
  if (!normalizedFolder) {
    return undefined;
  }

  for (const installedName of installedNames) {
    const normalizedInstalled = normalizeName(installedName);
    if (!normalizedInstalled) {
      continue;
    }
    if (
      (normalizedFolder.length >= 5 && normalizedInstalled.includes(normalizedFolder)) ||
      (normalizedInstalled.length >= 5 && normalizedFolder.includes(normalizedInstalled))
    ) {
      return installedName;
    }

    const installedTokens = tokenize(installedName);
    if (
      folderTokens.some((token) => installedTokens.includes(token)) &&
      folderTokens.some((token) => token.length >= 4)
    ) {
      return installedName;
    }
  }

  return undefined;
}

export function detectInstalledAppProtection(
  targetPath: string,
  installedApps: InstalledAppRecord[]
): InstalledAppProtectionMatch | null {
  const normalizedTarget = normalizeLowerPath(targetPath);
  for (const app of installedApps) {
    if (!app.installLocation) {
      continue;
    }
    const normalizedInstallLocation = normalizeLowerPath(app.installLocation);
    if (
      normalizedTarget === normalizedInstallLocation ||
      normalizedTarget.startsWith(`${normalizedInstallLocation}\\`)
    ) {
      return {
        kind: "installed_app_location",
        appName: app.name
      };
    }
  }

  if (!isBinaryExtension(targetPath)) {
    return null;
  }

  const appDataFolder = extractAppDataFolderName(targetPath);
  if (!appDataFolder) {
    return null;
  }

  const installedAppName = findMatchingInstalledAppName(
    appDataFolder,
    installedApps.map((item) => item.name)
  );
  if (!installedAppName) {
    return null;
  }

  return {
    kind: "installed_app_name_match",
    appName: installedAppName
  };
}

export async function collectInstalledApps(): Promise<InstalledAppRecord[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const now = Date.now();
  if (installedAppsCache.length && now - installedAppsCachedAt < INSTALLED_APPS_CACHE_TTL_MS) {
    return installedAppsCache;
  }
  if (installedAppsInFlight) {
    return installedAppsInFlight;
  }

  const script = `
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$items = foreach ($p in $paths) {
  Get-ItemProperty $p -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, InstallLocation
}
$items | ConvertTo-Json -Depth 3
`;

  installedAppsInFlight = (async () => {
    try {
      const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
        windowsHide: true,
        maxBuffer: 6 * 1024 * 1024
      });
      if (!stdout.trim()) {
        installedAppsCache = [];
        installedAppsCachedAt = Date.now();
        return [];
      }

      const parsed = parseJsonPayload<unknown>(stdout, "Installed apps PowerShell output");
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const next = values
        .map((item): InstalledAppRecord | null => {
          const row = item as { DisplayName?: unknown; InstallLocation?: unknown };
          const name = String(row.DisplayName ?? "").trim();
          if (!name) {
            return null;
          }
          const installLocation = String(row.InstallLocation ?? "").trim();
          return {
            name,
            installLocation: installLocation ? normalizePath(installLocation) : undefined
          };
        })
        .filter((item): item is InstalledAppRecord => item !== null);
      installedAppsCache = next;
      installedAppsCachedAt = Date.now();
      return next;
    } catch {
      return installedAppsCache;
    } finally {
      installedAppsInFlight = null;
    }
  })();

  return installedAppsInFlight;
}
