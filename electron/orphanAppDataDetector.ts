import fs from "fs/promises";
import path from "path";
import { DeepStorageFinding } from "./types";
import { InstalledRegistryApp, matchesInstalledAppFolder } from "./installedAppsRegistry";
import { createDeepStorageFinding, summarizeStoragePath } from "./storageScannerUtils";

const IGNORED_APPDATA_FOLDERS = new Set([
  "microsoft",
  "packages",
  "temp",
  "crashdumps",
  "programs",
  "nvidia",
  "nvidia corporation",
  "amd",
  "intel",
  "google",
  "mozilla"
]);

async function listChildDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path.join(root, entry.name));
}

export async function detectOrphanAppData(args: {
  roots: string[];
  installedApps: InstalledRegistryApp[];
  minBytes?: number;
  isCanceled?: () => boolean;
}): Promise<DeepStorageFinding[]> {
  const findings: DeepStorageFinding[] = [];
  const minBytes = args.minBytes ?? 64 * 1024 ** 2;

  for (const root of args.roots) {
    for (const directoryPath of await listChildDirectories(root)) {
      if (args.isCanceled?.()) {
        return findings;
      }
      const name = path.basename(directoryPath);
      if (IGNORED_APPDATA_FOLDERS.has(name.toLowerCase())) {
        continue;
      }
      if (matchesInstalledAppFolder(name, args.installedApps)) {
        continue;
      }
      const summary = await summarizeStoragePath(directoryPath, { maxDepth: 4, isCanceled: args.isCanceled });
      if (!summary.exists || summary.sizeBytes < minBytes) {
        continue;
      }
      findings.push(createDeepStorageFinding({
        path: directoryPath,
        kind: "directory",
        category: "installer_artifacts",
        source: "orphaned_app_data",
        sizeBytes: summary.sizeBytes,
        entryCount: summary.entryCount,
        modifiedAt: summary.modifiedAt,
        safety: "review",
        action: "manualReview",
        selectedByDefault: false,
        ruleId: "orphan-app-data",
        explanation: "Folder is not matched to an installed app name and may be leftover application data.",
        evidence: ["Review-only orphan candidate", "Installed app registry did not match folder name"]
      }));
    }
  }

  return findings;
}
