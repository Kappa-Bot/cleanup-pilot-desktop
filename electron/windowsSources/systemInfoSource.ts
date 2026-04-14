import os from "os";
import { runPowerShellJson } from "./powershell";

interface RawGpuInfo {
  Name?: string;
}

interface RawDiskInfo {
  DeviceID?: string;
  VolumeName?: string;
  Size?: string | number;
  FreeSpace?: string | number;
  DriveType?: number;
}

export interface SystemInfoSnapshot {
  cpuModel: string;
  logicalCores: number;
  totalRamBytes: number;
  gpuModels: string[];
  disks: Array<{ id: string; model?: string; totalBytes: number; freeBytes: number; type?: string }>;
}

let systemInfoCache: SystemInfoSnapshot | null = null;
let systemInfoCachedAt = 0;
let systemInfoInFlight: Promise<SystemInfoSnapshot> | null = null;
const SYSTEM_INFO_CACHE_TTL_MS = 5 * 60 * 1000;

function asNumber(value: unknown): number {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

export async function getSystemInfo(): Promise<SystemInfoSnapshot> {
  const now = Date.now();
  if (systemInfoCache && now - systemInfoCachedAt < SYSTEM_INFO_CACHE_TTL_MS) {
    return systemInfoCache;
  }
  if (systemInfoInFlight) {
    return systemInfoInFlight;
  }

  systemInfoInFlight = (async () => {
    const [gpus, disks] = await Promise.all([
      runPowerShellJson<RawGpuInfo[]>(
        "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Depth 4 -Compress",
        []
      ),
      runPowerShellJson<RawDiskInfo[]>(
        "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType = 3\" | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType | ConvertTo-Json -Depth 4 -Compress",
        []
      )
    ]);

    const next = {
      cpuModel: os.cpus()[0]?.model ?? "Unknown CPU",
      logicalCores: os.cpus().length || 1,
      totalRamBytes: os.totalmem(),
      gpuModels: gpus
        .map((item) => String(item?.Name ?? "").trim())
        .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index),
      disks: disks.map((disk) => ({
        id: String(disk.DeviceID ?? "Unknown"),
        model: String(disk.VolumeName ?? "").trim() || undefined,
        totalBytes: asNumber(disk.Size),
        freeBytes: asNumber(disk.FreeSpace),
        type: asNumber(disk.DriveType) === 3 ? "fixed" : undefined
      }))
    } satisfies SystemInfoSnapshot;
    systemInfoCache = next;
    systemInfoCachedAt = Date.now();
    return next;
  })();

  try {
    return await systemInfoInFlight;
  } finally {
    systemInfoInFlight = null;
  }
}
