import { runPowerShellJson } from "./powershell";

export interface ServiceInfo {
  serviceName: string;
  displayName: string;
  state: string;
  startMode: string;
  startName?: string;
  binaryPath?: string;
}

interface RawServiceInfo {
  Name?: string;
  DisplayName?: string;
  State?: string;
  StartMode?: string;
  StartName?: string;
  PathName?: string;
}

export async function listServices(): Promise<ServiceInfo[]> {
  const rows = await runPowerShellJson<RawServiceInfo[]>(
    "Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,StartName,PathName | ConvertTo-Json -Depth 5 -Compress",
    []
  );

  return rows.map((row) => ({
    serviceName: String(row.Name ?? "").trim(),
    displayName: String(row.DisplayName ?? row.Name ?? "").trim(),
    state: String(row.State ?? "").trim(),
    startMode: String(row.StartMode ?? "").trim(),
    startName: String(row.StartName ?? "").trim() || undefined,
    binaryPath: String(row.PathName ?? "").trim() || undefined
  }));
}
