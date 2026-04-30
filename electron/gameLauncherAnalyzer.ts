import fs from "fs/promises";
import path from "path";
import { DeepStorageFinding } from "./types";
import { createDeepStorageFinding, summarizeStoragePath } from "./storageScannerUtils";

function parseSteamInstallDir(value: string): string | null {
  const match = value.match(/"installdir"\s+"([^"]+)"/i);
  return match?.[1]?.trim() || null;
}

async function listDirectories(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => path.join(directoryPath, entry.name));
}

async function buildOrphanDirectoryFinding(directoryPath: string, ruleId: string, explanation: string): Promise<DeepStorageFinding | null> {
  const summary = await summarizeStoragePath(directoryPath, { maxDepth: 5 });
  if (!summary.exists || summary.sizeBytes <= 0) {
    return null;
  }
  return createDeepStorageFinding({
    path: directoryPath,
    kind: "directory",
    category: "installer_artifacts",
    source: "game_launcher",
    sizeBytes: summary.sizeBytes,
    entryCount: summary.entryCount,
    modifiedAt: summary.modifiedAt,
    safety: "review",
    action: "manualReview",
    selectedByDefault: false,
    ruleId,
    explanation,
    evidence: ["Game install folders are never auto-cleaned.", "Compare launcher manifests before removing."]
  });
}

export async function analyzeSteamLibrary(libraryRoot: string): Promise<DeepStorageFinding[]> {
  const steamApps = path.basename(libraryRoot).toLowerCase() === "steamapps"
    ? libraryRoot
    : path.join(libraryRoot, "steamapps");
  const common = path.join(steamApps, "common");
  const manifestEntries = await fs.readdir(steamApps, { withFileTypes: true }).catch(() => []);
  const installedDirs = new Set<string>();

  for (const entry of manifestEntries) {
    if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) {
      continue;
    }
    const raw = await fs.readFile(path.join(steamApps, entry.name), "utf8").catch(() => "");
    const installDir = parseSteamInstallDir(raw);
    if (installDir) {
      installedDirs.add(installDir.toLowerCase());
    }
  }

  const findings: DeepStorageFinding[] = [];
  for (const directoryPath of await listDirectories(common)) {
    const name = path.basename(directoryPath).toLowerCase();
    if (installedDirs.has(name)) {
      continue;
    }
    const finding = await buildOrphanDirectoryFinding(
      directoryPath,
      "steam-orphan-common-folder",
      "Steam folder is not referenced by an installed app manifest."
    );
    if (finding) {
      findings.push(finding);
    }
  }

  for (const disposable of ["downloading", "temp", "shadercache", "depotcache", "appcache", "logs"]) {
    const target = path.join(steamApps, disposable);
    const summary = await summarizeStoragePath(target, { maxDepth: 5 });
    if (summary.exists && summary.sizeBytes > 0) {
      findings.push(createDeepStorageFinding({
        path: target,
        kind: summary.kind,
        category: disposable === "logs" ? "logs" : "cache",
        source: "game_launcher",
        sizeBytes: summary.sizeBytes,
        entryCount: summary.entryCount,
        modifiedAt: summary.modifiedAt,
        safety: "rebuildable",
        action: "quarantine",
        selectedByDefault: false,
        ruleId: `steam-${disposable}`,
        explanation: "Steam launcher cache can usually be rebuilt, but game content remains untouched.",
        evidence: ["Launcher cache only", "Game install folders excluded"]
      }));
    }
  }

  return findings;
}

export async function analyzeEpicLauncher(args: { installRoots: string[]; manifestRoots: string[] }): Promise<DeepStorageFinding[]> {
  const installedLocations = new Set<string>();
  for (const manifestRoot of args.manifestRoots) {
    const entries = await fs.readdir(manifestRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const raw = await fs.readFile(path.join(manifestRoot, entry.name), "utf8").catch(() => "");
      try {
        const parsed = JSON.parse(raw) as { InstallLocation?: unknown; InstallLocationList?: unknown };
        const installLocation = String(parsed.InstallLocation ?? "").trim();
        if (installLocation) {
          installedLocations.add(path.normalize(installLocation).toLowerCase());
        }
      } catch {
        // Ignore corrupt launcher manifests.
      }
    }
  }

  const findings: DeepStorageFinding[] = [];
  for (const installRoot of args.installRoots) {
    for (const directoryPath of await listDirectories(installRoot)) {
      if (installedLocations.has(path.normalize(directoryPath).toLowerCase())) {
        continue;
      }
      const finding = await buildOrphanDirectoryFinding(
        directoryPath,
        "epic-orphan-install-folder",
        "Epic install folder is not referenced by launcher manifests."
      );
      if (finding) {
        findings.push(finding);
      }
    }
  }
  return findings;
}
