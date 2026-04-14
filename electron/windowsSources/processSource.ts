import { runPowerShellJson } from "./powershell";

export interface RawProcessSample {
  pid: number;
  processName: string;
  executablePath?: string;
  commandLine?: string;
  workingSetBytes?: number;
  privateBytes?: number;
  userModeTime?: number;
  kernelModeTime?: number;
  readTransferCount?: number;
  writeTransferCount?: number;
  readBytesPerSec?: number;
  writeBytesPerSec?: number;
}

interface RawProcessRow {
  Id?: number;
  ProcessId?: number;
  ProcessName?: string;
  Name?: string;
  Path?: string;
  ExecutablePath?: string;
  WorkingSet64?: string | number;
  WorkingSetSize?: string | number;
  PrivateMemorySize64?: string | number;
  PrivatePageCount?: string | number;
  PrivilegedProcessorTimeTicks?: string | number;
  UserProcessorTimeTicks?: string | number;
  KernelModeTime?: string | number;
  UserModeTime?: string | number;
  ReadTransferCount?: string | number;
  WriteTransferCount?: string | number;
  ReadBytesPerSec?: string | number;
  WriteBytesPerSec?: string | number;
}

function asNumber(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

let cachedProcesses: RawProcessSample[] = [];
let cachedAt = 0;
let inFlightProcessRequest: Promise<RawProcessSample[]> | null = null;
const PROCESS_CACHE_TTL_MS = 900;

export async function listProcesses(): Promise<RawProcessSample[]> {
  const now = Date.now();
  if (cachedProcesses.length && now - cachedAt < PROCESS_CACHE_TTL_MS) {
    return cachedProcesses;
  }
  if (inFlightProcessRequest) {
    return inFlightProcessRequest;
  }

  inFlightProcessRequest = (async () => {
    const rawRows = await runPowerShellJson<RawProcessRow[] | RawProcessRow>(
      [
        "$processes = Get-Process -ErrorAction SilentlyContinue",
        "$ioByPid = @{}",
        "try {",
        "  $counterRows = Get-Counter -Counter '\\Process(*)\\ID Process','\\Process(*)\\IO Read Bytes/sec','\\Process(*)\\IO Write Bytes/sec' -ErrorAction Stop | Select-Object -ExpandProperty CounterSamples",
        "  foreach ($sample in $counterRows) {",
        "    $instanceName = ''",
        "    if ([string]$sample.Path -match '\\\\Process\\((?<instance>[^)]+)\\)\\\\') {",
        "      $instanceName = $Matches.instance",
        "    }",
        "    if ([string]::IsNullOrWhiteSpace($instanceName)) { continue }",
        "    if (-not $ioByPid.ContainsKey($instanceName)) {",
        "      $ioByPid[$instanceName] = [ordered]@{ Id = 0; Read = 0; Write = 0 }",
        "    }",
        "    if ([string]$sample.Path -like '*\\ID Process') {",
        "      $ioByPid[$instanceName].Id = [int]$sample.CookedValue",
        "    } elseif ([string]$sample.Path -like '*\\IO Read Bytes/sec') {",
        "      $ioByPid[$instanceName].Read = [double]$sample.CookedValue",
        "    } elseif ([string]$sample.Path -like '*\\IO Write Bytes/sec') {",
        "      $ioByPid[$instanceName].Write = [double]$sample.CookedValue",
        "    }",
        "  }",
        "} catch {",
        "  $ioByPid = @{}",
        "}",
        "$ioByResolvedPid = @{}",
        "foreach ($entry in $ioByPid.GetEnumerator()) {",
        "  $pid = [int]$entry.Value.Id",
        "  if ($pid -le 0) { continue }",
        "  if ($ioByResolvedPid.ContainsKey($pid)) {",
        "    $ioByResolvedPid[$pid].Read += [double]$entry.Value.Read",
        "    $ioByResolvedPid[$pid].Write += [double]$entry.Value.Write",
        "  } else {",
        "    $ioByResolvedPid[$pid] = [ordered]@{ Read = [double]$entry.Value.Read; Write = [double]$entry.Value.Write }",
        "  }",
        "}",
        "$items = foreach ($process in $processes) {",
        "  $path = $null",
        "  try { $path = $process.Path } catch { $path = $null }",
        "  $userTicks = $null",
        "  try { $userTicks = $process.UserProcessorTime.Ticks } catch { $userTicks = $null }",
        "  $kernelTicks = $null",
        "  try { $kernelTicks = $process.PrivilegedProcessorTime.Ticks } catch { $kernelTicks = $null }",
        "  $io = $ioByResolvedPid[[int]$process.Id]",
        "  [pscustomobject]@{",
        "    Id = [int]$process.Id",
        "    ProcessName = [string]$process.ProcessName",
        "    Path = $path",
        "    WorkingSet64 = [int64]$process.WorkingSet64",
        "    PrivateMemorySize64 = [int64]$process.PrivateMemorySize64",
        "    UserProcessorTimeTicks = $userTicks",
        "    PrivilegedProcessorTimeTicks = $kernelTicks",
        "    ReadBytesPerSec = if ($io) { [double]$io.Read } else { $null }",
        "    WriteBytesPerSec = if ($io) { [double]$io.Write } else { $null }",
        "  }",
        "}",
        "$items | ConvertTo-Json -Depth 5 -Compress"
      ].join("; "),
      [],
      12_000
    );
    const rows = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : [];

    const next = rows.map((row) => ({
      pid: Number(row.Id ?? row.ProcessId ?? 0),
      processName: String(row.ProcessName ?? row.Name ?? "unknown"),
      executablePath: String(row.Path ?? row.ExecutablePath ?? "").trim() || undefined,
      workingSetBytes: asNumber(row.WorkingSet64) ?? asNumber(row.WorkingSetSize),
      privateBytes: asNumber(row.PrivateMemorySize64) ?? asNumber(row.PrivatePageCount) ?? asNumber(row.WorkingSet64) ?? asNumber(row.WorkingSetSize),
      userModeTime: asNumber(row.UserProcessorTimeTicks) ?? asNumber(row.UserModeTime),
      kernelModeTime: asNumber(row.PrivilegedProcessorTimeTicks) ?? asNumber(row.KernelModeTime),
      readTransferCount: asNumber(row.ReadTransferCount),
      writeTransferCount: asNumber(row.WriteTransferCount),
      readBytesPerSec: asNumber(row.ReadBytesPerSec),
      writeBytesPerSec: asNumber(row.WriteBytesPerSec)
    }))
      .filter((item) => item.pid > 0 && item.processName.length > 0);

    cachedProcesses = next;
    cachedAt = Date.now();
    return next;
  })();

  try {
    return await inFlightProcessRequest;
  } finally {
    inFlightProcessRequest = null;
  }
}
