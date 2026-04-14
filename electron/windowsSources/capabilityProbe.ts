import { CapabilityFlags } from "../types";
import { runPowerShellJson } from "./powershell";

let capabilityCache: CapabilityFlags | null = null;
let capabilityCachedAt = 0;
let capabilityInFlight: Promise<CapabilityFlags> | null = null;
const CAPABILITY_CACHE_TTL_MS = 10 * 60 * 1000;
const CAPABILITY_CACHE_ENABLED = process.env.NODE_ENV !== "test";

export async function probeCapabilities(): Promise<CapabilityFlags> {
  const now = Date.now();
  if (CAPABILITY_CACHE_ENABLED && capabilityCache && now - capabilityCachedAt < CAPABILITY_CACHE_TTL_MS) {
    return capabilityCache;
  }
  if (CAPABILITY_CACHE_ENABLED && capabilityInFlight) {
    return capabilityInFlight;
  }

  capabilityInFlight = (async () => {
    const raw = await runPowerShellJson<Partial<CapabilityFlags>>(
      [
        "$gpuSupported = $false",
        "try {",
        "  $gpuPaths = (Get-Counter -ListSet 'GPU Engine' -ErrorAction Stop | Select-Object -ExpandProperty Paths)",
        "  $gpuSupported = [bool]($gpuPaths -and $gpuPaths.Count -gt 0)",
        "} catch {",
        "  $gpuSupported = $false",
        "}",
        "$diagnosticsEventLogSupported = $false",
        "try {",
        "  Get-WinEvent -ListLog 'Microsoft-Windows-Diagnostics-Performance/Operational' -ErrorAction Stop | Out-Null",
        "  $diagnosticsEventLogSupported = $true",
        "} catch {",
        "  $diagnosticsEventLogSupported = $false",
        "}",
        "$taskDelaySupported = $false",
        "try {",
        "  $trigger = New-ScheduledTaskTrigger -AtLogOn",
        "  $taskDelaySupported = [bool]($trigger | Get-Member -Name Delay -ErrorAction SilentlyContinue)",
        "} catch {",
        "  $taskDelaySupported = $false",
        "}",
        "[pscustomobject]@{",
        "  gpuSupported = $gpuSupported",
        "  perProcessGpuSupported = $false",
        "  perProcessNetworkSupported = $false",
        "  diagnosticsEventLogSupported = $diagnosticsEventLogSupported",
        "  taskDelaySupported = $taskDelaySupported",
        "  serviceDelayedAutoStartSupported = $true",
        "} | ConvertTo-Json -Compress"
      ].join("; "),
      {},
      8_000
    );

    const next = {
      gpuSupported: Boolean(raw.gpuSupported),
      perProcessGpuSupported: Boolean(raw.perProcessGpuSupported),
      perProcessNetworkSupported: Boolean(raw.perProcessNetworkSupported),
      diagnosticsEventLogSupported: Boolean(raw.diagnosticsEventLogSupported),
      taskDelaySupported: Boolean(raw.taskDelaySupported),
      serviceDelayedAutoStartSupported:
        typeof raw.serviceDelayedAutoStartSupported === "boolean" ? raw.serviceDelayedAutoStartSupported : true
    } satisfies CapabilityFlags;
    if (CAPABILITY_CACHE_ENABLED) {
      capabilityCache = next;
      capabilityCachedAt = Date.now();
    }
    return next;
  })();

  try {
    return await capabilityInFlight;
  } finally {
    capabilityInFlight = null;
  }
}
