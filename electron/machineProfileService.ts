import fs from "fs/promises";
import { ConfigStore } from "./configStore";
import { runPowerShellJson } from "./windowsSources/powershell";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function detectMachineRoots(): Promise<string[]> {
  if (process.platform !== "win32") {
    return [];
  }

  const rawRoots = await runPowerShellJson<Array<{ DeviceID?: unknown }> | { DeviceID?: unknown }>(
    "@(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | Select-Object DeviceID) | ConvertTo-Json -Depth 3 -Compress",
    []
  );
  const rootItems = Array.isArray(rawRoots) ? rawRoots : [rawRoots];

  const normalized = rootItems
    .map((item) => String(item?.DeviceID ?? "").trim())
    .filter(Boolean)
    .map((item) => `${item.replace(/[\\\/]+$/g, "").replace(/:$/, "")}:\\`);

  const fallbackRoot = process.env.SystemDrive ? `${process.env.SystemDrive.replace(/[\\\/]+$/g, "").replace(/:$/, "")}:\\` : "";
  const candidates = [...normalized, fallbackRoot].filter(Boolean);
  const existing: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (await pathExists(candidate)) {
      existing.push(candidate);
    }
  }
  return existing;
}

export async function applyMachineDefaults(configStore: ConfigStore): Promise<{ applied: boolean; roots: string[] }> {
  if (process.platform !== "win32") {
    return { applied: false, roots: [] };
  }

  const current = configStore.getAll();
  const roots = await detectMachineRoots();
  if (!roots.length) {
    return { applied: false, roots: current.customRoots };
  }

  const mergedRoots =
    current.customRoots.length > 0
      ? Array.from(new Set([...current.customRoots.map((item) => item.trim()).filter(Boolean), ...roots]))
      : roots;

  const currentKey = current.customRoots.map((item) => item.toLowerCase()).join("|");
  const nextKey = mergedRoots.map((item) => item.toLowerCase()).join("|");
  if (currentKey === nextKey) {
    return { applied: false, roots: current.customRoots };
  }

  configStore.update({
    customRoots: mergedRoots,
    includeInstalledApps: true,
    driverToolsEnabled: true
  });
  return { applied: true, roots: mergedRoots };
}
