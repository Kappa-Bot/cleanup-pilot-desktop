import { runPowerShellJson } from "./powershell";

export interface PerfCounterSnapshot {
  cpuUsagePct: number;
  ramUsedPct: number;
  diskActivePct: number;
  diskQueueDepth?: number;
  dpcPct?: number;
  interruptPct?: number;
  networkSendBytesPerSec?: number;
  networkReceiveBytesPerSec?: number;
  gpuUsagePct?: number;
}

interface CounterSampleRow {
  Path?: string;
  CookedValue?: number;
}

let perfCounterCache: PerfCounterSnapshot | null = null;
let perfCounterCachedAt = 0;
let perfCounterInFlight: Promise<PerfCounterSnapshot> | null = null;
const PERF_COUNTER_CACHE_TTL_MS = 900;

function aggregateGpuUsage(rows: CounterSampleRow[]): number | undefined {
  const gpuRows = rows.filter((row) => String(row.Path ?? "").includes("\\GPU Engine("));
  if (!gpuRows.length) {
    return undefined;
  }
  const total = gpuRows.reduce((sum, row) => sum + Number(row.CookedValue ?? 0), 0);
  return Number.isFinite(total) ? Math.max(0, Math.min(100, total)) : undefined;
}

function aggregateNetwork(rows: CounterSampleRow[], kind: "sent" | "received"): number | undefined {
  const pattern = kind === "sent" ? "\\Bytes Sent/sec" : "\\Bytes Received/sec";
  const matched = rows.filter((row) => String(row.Path ?? "").includes(pattern));
  if (!matched.length) {
    return undefined;
  }
  const total = matched.reduce((sum, row) => sum + Number(row.CookedValue ?? 0), 0);
  return Number.isFinite(total) ? total : undefined;
}

export async function getPerfCounterSnapshot(): Promise<PerfCounterSnapshot> {
  const now = Date.now();
  if (perfCounterCache && now - perfCounterCachedAt < PERF_COUNTER_CACHE_TTL_MS) {
    return perfCounterCache;
  }
  if (perfCounterInFlight) {
    return perfCounterInFlight;
  }

  perfCounterInFlight = (async () => {
    const rawRows = await runPowerShellJson<CounterSampleRow[] | CounterSampleRow>(
      [
        "$counters = @(",
        "'\\Processor(_Total)\\% Processor Time',",
        "'\\Memory\\% Committed Bytes In Use',",
        "'\\PhysicalDisk(_Total)\\% Disk Time',",
        "'\\PhysicalDisk(_Total)\\Avg. Disk Queue Length',",
        "'\\Processor(_Total)\\% DPC Time',",
        "'\\Processor(_Total)\\% Interrupt Time',",
        "'\\Network Interface(*)\\Bytes Sent/sec',",
        "'\\Network Interface(*)\\Bytes Received/sec'",
        ")",
        "$gpuCounters = @(Get-Counter -ListSet 'GPU Engine' -ErrorAction SilentlyContinue | ForEach-Object { $_.Paths })",
        "$all = $counters + $gpuCounters",
        "Get-Counter -Counter $all -ErrorAction SilentlyContinue |",
        "Select-Object -ExpandProperty CounterSamples |",
        "Select-Object Path,CookedValue | ConvertTo-Json -Depth 4 -Compress"
      ].join("; "),
      []
    );
    const rows = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : [];

    const lookup = (needle: string): number | undefined => {
      const sample = rows.find((row) => String(row.Path ?? "").includes(needle));
      return sample ? Number(sample.CookedValue ?? 0) : undefined;
    };

    const next = {
      cpuUsagePct: lookup("\\% Processor Time") ?? 0,
      ramUsedPct: lookup("\\% Committed Bytes In Use") ?? 0,
      diskActivePct: lookup("\\% Disk Time") ?? 0,
      diskQueueDepth: lookup("\\Avg. Disk Queue Length"),
      dpcPct: lookup("\\% DPC Time"),
      interruptPct: lookup("\\% Interrupt Time"),
      networkSendBytesPerSec: aggregateNetwork(rows, "sent"),
      networkReceiveBytesPerSec: aggregateNetwork(rows, "received"),
      gpuUsagePct: aggregateGpuUsage(rows)
    } satisfies PerfCounterSnapshot;
    perfCounterCache = next;
    perfCounterCachedAt = Date.now();
    return next;
  })();

  try {
    return await perfCounterInFlight;
  } finally {
    perfCounterInFlight = null;
  }
}
