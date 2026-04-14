import { runPowerShellJson } from "./powershell";

export interface BootPerformanceEvent {
  timestamp: number;
  bootTimeMs?: number;
  mainPathBootTimeMs?: number;
  postBootTimeMs?: number;
}

interface RawBootPerformanceEvent {
  TimeCreated?: string;
  BootTime?: string | number;
  MainPathBootTime?: string | number;
  BootPostBootTime?: string | number;
}

function asNumber(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

export async function getLatestBootPerformance(): Promise<BootPerformanceEvent | null> {
  const rows = await runPowerShellJson<RawBootPerformanceEvent[]>(
    [
      "$event = Get-WinEvent -LogName 'Microsoft-Windows-Diagnostics-Performance/Operational' -MaxEvents 30 -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 100 } | Select-Object -First 1",
      "if (-not $event) { @() | ConvertTo-Json -Compress } else {",
      "  [xml]$xml = $event.ToXml()",
      "  $map = @{}",
      "  foreach ($data in $xml.Event.EventData.Data) { $map[$data.Name] = $data.'#text' }",
      "  @([pscustomobject]@{ TimeCreated = $event.TimeCreated.ToString('o'); BootTime = $map['BootTime']; MainPathBootTime = $map['MainPathBootTime']; BootPostBootTime = $map['BootPostBootTime'] }) | ConvertTo-Json -Depth 5 -Compress",
      "}"
    ].join("; "),
    []
  );

  const item = rows[0];
  if (!item) {
    return null;
  }

  return {
    timestamp: new Date(String(item.TimeCreated ?? Date.now())).getTime(),
    bootTimeMs: asNumber(item.BootTime),
    mainPathBootTimeMs: asNumber(item.MainPathBootTime),
    postBootTimeMs: asNumber(item.BootPostBootTime)
  };
}
