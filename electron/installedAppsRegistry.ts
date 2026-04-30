import { collectInstalledApps, findMatchingInstalledAppName, InstalledAppRecord } from "./installedApps";

export type InstalledRegistryApp = InstalledAppRecord;

export async function collectInstalledAppsRegistry(): Promise<InstalledRegistryApp[]> {
  return collectInstalledApps();
}

export function matchesInstalledAppFolder(folderName: string, installedApps: InstalledRegistryApp[]): string | undefined {
  return findMatchingInstalledAppName(folderName, installedApps.map((item) => item.name));
}
