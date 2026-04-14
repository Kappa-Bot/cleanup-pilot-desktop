import { detectInstalledAppProtection, InstalledAppRecord } from "./installedApps";
import { matchNeverCleanupApp, matchNeverCleanupPath, normalizeProtectionPreferences } from "./protectionPreferences";
import { getProtectionDetails } from "./safetyPolicy";
import { ProtectionKind, ProtectionPreferences } from "./types";

export interface ProtectionDecision {
  kind: ProtectionKind;
  reason: string;
  matchedAppName?: string;
  matchedPath?: string;
}

export function resolveProtectionDecision(
  targetPath: string,
  installedApps: InstalledAppRecord[],
  preferences?: Partial<ProtectionPreferences> | null
): ProtectionDecision | null {
  const normalizedPreferences = normalizeProtectionPreferences(preferences);
  const pathMatch = matchNeverCleanupPath(targetPath, normalizedPreferences.neverCleanupPaths);
  if (pathMatch) {
    return {
      kind: "user_allowlist_path",
      reason: `Path is on your never-cleanup allowlist: ${pathMatch}`,
      matchedPath: pathMatch
    };
  }

  const installedAppProtection = detectInstalledAppProtection(targetPath, installedApps);
  const matchedAllowedApp = matchNeverCleanupApp(
    installedAppProtection?.appName,
    normalizedPreferences.neverCleanupApps
  );
  if (matchedAllowedApp) {
    return {
      kind: "user_allowlist_app",
      reason: `Installed app is on your never-cleanup allowlist: ${matchedAllowedApp}`,
      matchedAppName: installedAppProtection?.appName ?? matchedAllowedApp
    };
  }

  const protection = getProtectionDetails(targetPath);
  if (protection) {
    return {
      kind: protection.kind,
      reason: protection.reason
    };
  }

  if (installedAppProtection?.kind === "installed_app_location") {
    return {
      kind: "installed_app_location",
      reason: `Path is inside the install location for "${installedAppProtection.appName}".`,
      matchedAppName: installedAppProtection.appName
    };
  }

  if (installedAppProtection?.kind === "installed_app_name_match") {
    return {
      kind: "installed_app_name_match",
      reason: `Path looks tied to installed app "${installedAppProtection.appName}" and includes executable content.`,
      matchedAppName: installedAppProtection.appName
    };
  }

  return null;
}
