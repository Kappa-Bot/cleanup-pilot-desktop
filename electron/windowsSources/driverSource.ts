import { runPowerShellJson } from "./powershell";

export interface BootDriverInfo {
  name: string;
  displayName?: string;
  state?: string;
  startMode?: string;
  pathName?: string;
}

interface RawBootDriverInfo {
  Name?: string;
  DisplayName?: string;
  State?: string;
  StartMode?: string;
  PathName?: string;
}

export async function listBootDrivers(): Promise<BootDriverInfo[]> {
  const rows = await runPowerShellJson<RawBootDriverInfo[]>(
    "Get-CimInstance Win32_SystemDriver | Where-Object { $_.StartMode -in @('Boot','System','Auto') } | Select-Object Name,DisplayName,State,StartMode,PathName | ConvertTo-Json -Depth 5 -Compress",
    []
  );

  return rows.map((row) => ({
    name: String(row.Name ?? "").trim(),
    displayName: String(row.DisplayName ?? row.Name ?? "").trim() || undefined,
    state: String(row.State ?? "").trim() || undefined,
    startMode: String(row.StartMode ?? "").trim() || undefined,
    pathName: String(row.PathName ?? "").trim() || undefined
  }));
}
