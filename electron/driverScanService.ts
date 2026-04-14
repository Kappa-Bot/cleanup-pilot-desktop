import { execFile } from "child_process";
import { promisify } from "util";
import { parseJsonPayload } from "./jsonPayload";
import { shell } from "electron";
import { z } from "zod";
import { collectInstalledApps, InstalledAppRecord } from "./installedApps";
import { requestCerebrasStructuredJson } from "./ai/cerebrasClient";
import { getSystemDoctorProviderState } from "./ai/modelRegistry";
import {
  DriverActivitySignalEvidence,
  DriverCandidate,
  DriverInventoryItem,
  DriverOfficialLookup,
  DriverPerformanceSummary,
  DriverScanResponse,
  DriverStackActivityState,
  DriverStackFeatureSignalId,
  DriverSuppressionSuggestion,
  DriverSuppressionSuggestionId,
  DriverSuppressionPreferences
} from "./types";
import { getPerfCounterSnapshot } from "./windowsSources/perfCounterSource";
import { runPowerShellJson } from "./windowsSources/powershell";

const execFileAsync = promisify(execFile);
const WINDOWS_UPDATE_URI = "ms-settings:windowsupdate";
const WINDOWS_UPDATE_CATALOG_URL = "https://www.catalog.update.microsoft.com/Search.aspx";
const DAY_MS = 24 * 60 * 60 * 1000;
const STACK_SIGNAL_TIMEOUT_MS = 1800;
const IGNORED_DEVICE_CLASSES = new Set([
  "AUDIOENDPOINT",
  "AUDIOPROCESSINGOBJECT",
  "COMPUTER",
  "HIDCLASS",
  "KEYBOARD",
  "MONITOR",
  "PRINTQUEUE",
  "PROCESSOR",
  "SOFTWARECOMPONENT",
  "SOFTWAREDEVICE",
  "VOLUME",
  "VOLUMESNAPSHOT"
]);
const HIGH_VALUE_DEVICE_CLASSES = new Set([
  "BLUETOOTH",
  "CAMERA",
  "DISKDRIVE",
  "DISPLAY",
  "MEDIA",
  "NET",
  "SCSIADAPTER",
  "SECURITYDEVICES",
  "SYSTEM",
  "USB"
]);
const IGNORED_DEVICE_NAME_PATTERNS = [
  /^WAN Miniport/i,
  /^Generic software device$/i,
  /^Local Print Queue$/i,
  /^Microsoft GS Wavetable Synth$/i,
  /^Remote Desktop Device Redirector Bus$/i
];
const IGNORED_DEVICE_ID_PATTERNS = [/^SWD\\MSRRAS\\/i, /^ROOT\\PRINTQUEUE/i];
const SYSTEM_DEVICE_KEYWORDS = [
  "chipset",
  "gaussian mixture",
  "gpio",
  "host bridge",
  "management engine",
  "mei",
  "pci",
  "pci server",
  "pcie",
  "power engine",
  "serial io",
  "smbus",
  "special tools",
  "thermal subsystem",
  "thunderbolt",
  "virtual disk",
  "virtual machine bus",
  "virtualization infrastructure",
  "vmci",
  "watchdog"
];
const PREFERRED_VENDOR_KEYWORDS = [
  "acer",
  "amd",
  "asus",
  "broadcom",
  "dell",
  "hp",
  "intel",
  "lenovo",
  "mediatek",
  "msi",
  "nvidia",
  "qualcomm",
  "realtek"
];
const INFRASTRUCTURE_DEVICE_ID_PATTERNS = [/^PCI\\/i, /^ACPI\\/i, /^ROOT\\SYSTEM\\/i];
const VMWARE_DEVICE_ID_PATTERNS = [/^ROOT\\VMWARE/i, /^ROOT\\VMWVMCIHOSTDEV/i];
const HYPERV_DEVICE_ID_PATTERNS = [/^ROOT\\VID/i, /^ROOT\\VMBUS/i, /^ROOT\\VPCIVSP/i, /^ROOT\\STORVSP/i];
const XBOX_DEVICE_ID_PATTERNS = [/^SWD\\XVDDENUM/i];
const INFRASTRUCTURE_SUGGESTION_KEYWORDS = [
  "amd",
  "chipset",
  "gaussian mixture",
  "host bridge",
  "intel",
  "management engine",
  "pci",
  "pcie",
  "special tools",
  "thermal subsystem"
];
const VMWARE_SUGGESTION_KEYWORDS = ["vmware", "virtual ethernet", "vmci"];
const HYPERV_SUGGESTION_KEYWORDS = ["hyper-v", "virtual machine bus", "virtual disk"];
const CAMO_SUGGESTION_KEYWORDS = ["camo", "reincubate"];
const XBOX_SUGGESTION_KEYWORDS = ["xvdd", "xbox"];

const MANUFACTURER_PORTALS: Array<{ match: RegExp; url: string }> = [
  { match: /nvidia/i, url: "https://www.nvidia.com/Download/index.aspx" },
  { match: /amd/i, url: "https://www.amd.com/en/support/download/drivers.html" },
  { match: /intel/i, url: "https://www.intel.com/content/www/us/en/support/detect.html" },
  { match: /realtek/i, url: "https://www.realtek.com/Download/List?cate_id=593" },
  { match: /qualcomm/i, url: "https://www.qualcomm.com/support/software-and-updates" },
  { match: /broadcom/i, url: "https://www.broadcom.com/support/download-search" },
  { match: /killer/i, url: "https://www.intel.com/content/www/us/en/support/detect.html" },
  { match: /mediatek/i, url: "https://www.mediatek.com/products/broadband-wifi" },
  { match: /asus/i, url: "https://www.asus.com/support/download-center/" },
  { match: /msi/i, url: "https://www.msi.com/support/download" },
  { match: /lenovo/i, url: "https://pcsupport.lenovo.com/us/en/" },
  { match: /dell/i, url: "https://www.dell.com/support/home/en-us?app=drivers" },
  { match: /hp/i, url: "https://support.hp.com/us-en/drivers" },
  { match: /acer/i, url: "https://www.acer.com/us-en/support/drivers-and-manuals" }
];
const DRIVER_SUPPRESSION_SUGGESTION_IDS = new Set<DriverSuppressionSuggestionId>([
  "system-infrastructure",
  "virtualization-vmware",
  "virtualization-hyperv",
  "virtualization-camo",
  "virtualization-xbox"
]);
const driverOfficialLookupAiSchema = z.object({
  searchQuery: z.string().min(6),
  confidence: z.number().min(0).max(1),
  reasoning: z.array(z.string()).min(1).max(5)
});

interface RawDriverRow {
  DeviceName?: unknown;
  DriverProviderName?: unknown;
  Manufacturer?: unknown;
  DriverVersion?: unknown;
  DriverDate?: unknown;
  InfName?: unknown;
  DeviceClass?: unknown;
  DeviceID?: unknown;
}

interface DriverScanServiceDependencies {
  resolveSuppressionPreferences?: () => Promise<DriverSuppressionPreferences> | DriverSuppressionPreferences;
}

interface DriverStackRuntimeProcess {
  name?: string;
  executablePath?: string;
  commandLine?: string;
}

interface DriverStackRuntimeService {
  name?: string;
  displayName?: string;
  state?: string;
  startMode?: string;
  pathName?: string;
}

interface RawComputerSystemInfo {
  Manufacturer?: unknown;
  Model?: unknown;
}

interface MachineSupportIdentity {
  manufacturer?: string;
  model?: string;
}

interface DriverStackFeatureSignal {
  id: DriverStackFeatureSignalId;
  enabled: boolean;
  evidence: string;
}

interface DriverStackSignalSnapshot {
  installedApps: InstalledAppRecord[];
  processes: DriverStackRuntimeProcess[];
  services: DriverStackRuntimeService[];
  features: DriverStackFeatureSignal[];
}

interface DriverStackUsageInfo {
  activityState: DriverStackActivityState;
  activitySummary: string;
  activitySignals: DriverStackFeatureSignalId[];
  activitySignalEvidence: DriverActivitySignalEvidence[];
  recommendedToHide: boolean;
}

interface DriverSuppressionSuggestionDefinition {
  id: DriverSuppressionSuggestionId;
  title: string;
  description: string;
  group: DriverSuppressionSuggestion["group"];
  autoEligible: boolean;
  confidence: DriverSuppressionSuggestion["confidence"];
  minimumMatches: number;
  match: (candidate: DriverCandidate) => boolean;
}

function normalizeClass(value?: string): string | undefined {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || undefined;
}

function providerPortal(device: Pick<DriverInventoryItem, "provider" | "manufacturer" | "deviceName">): string {
  const text = `${device.provider} ${device.manufacturer ?? ""} ${device.deviceName}`.trim();
  const matched = MANUFACTURER_PORTALS.find((item) => item.match.test(text));
  return matched?.url ?? WINDOWS_UPDATE_URI;
}

function officialDomainForCandidate(candidate: DriverCandidate): string {
  if (candidate.recommendation === "windows_update") {
    return "catalog.update.microsoft.com";
  }

  try {
    return new URL(candidate.officialUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "support.microsoft.com";
  }
}

async function getMachineSupportIdentity(): Promise<MachineSupportIdentity> {
  const [result] = await runPowerShellJson<RawComputerSystemInfo[]>(
    "Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model | ConvertTo-Json -Depth 4 -Compress",
    []
  );
  return {
    manufacturer: String(result?.Manufacturer ?? "").trim() || undefined,
    model: String(result?.Model ?? "").trim() || undefined
  };
}

function buildHeuristicDriverLookup(candidate: DriverCandidate, machine?: MachineSupportIdentity): DriverOfficialLookup {
  const officialDomain = officialDomainForCandidate(candidate);
  const manufacturerOrProvider = candidate.manufacturer || candidate.provider;
  const infName = String(candidate.infName ?? "").trim();
  const queryParts = [
    `site:${officialDomain}`,
    machine?.manufacturer ? `"${machine.manufacturer}"` : "",
    machine?.model ? `"${machine.model}"` : "",
    `"${candidate.deviceName}"`,
    manufacturerOrProvider ? `"${manufacturerOrProvider}"` : "",
    candidate.deviceClass ? `"${candidate.deviceClass}"` : "",
    infName ? `"${infName}"` : "",
    `"driver"`
  ].filter(Boolean);
  const searchQuery = queryParts.join(" ");
  const searchUrl =
    candidate.recommendation === "windows_update"
      ? `${WINDOWS_UPDATE_CATALOG_URL}?q=${encodeURIComponent(
          [candidate.deviceName, manufacturerOrProvider, infName].filter(Boolean).join(" ")
        )}`
      : `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  return {
    provider: "heuristic",
    officialDomain,
    officialBaseUrl: candidate.officialUrl,
    searchQuery,
    searchUrl,
    confidence: candidate.recommendation === "oem_portal" ? 0.7 : 0.55,
    reasoning: [
      candidate.recommendation === "oem_portal"
        ? `Restrict lookup to the official ${officialDomain} support domain.`
        : "Use the Microsoft Update Catalog for Windows Update-driven drivers.",
      candidate.infName ? `Include INF ${candidate.infName} to narrow the match.` : "Match on device name and vendor."
    ]
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timeout);
        resolve(fallback);
      });
  });
}

export function parseDriverDate(rawValue?: string): number | undefined {
  if (!rawValue) {
    return undefined;
  }

  const value = String(rawValue).trim();
  if (!value) {
    return undefined;
  }

  const jsonDateMatch = value.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
  if (jsonDateMatch) {
    const timestamp = Number(jsonDateMatch[1]);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const cimMatch = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (cimMatch) {
    const [, year, month, day, hour, minute, second] = cimMatch;
    const timestamp = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  const fallback = new Date(value).getTime();
  return Number.isFinite(fallback) ? fallback : undefined;
}

function computeDaysOld(timestamp?: number): number | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return undefined;
  }
  return Math.max(0, Math.floor((Date.now() - timestamp) / DAY_MS));
}

function isIgnoredDevice(item: DriverInventoryItem): boolean {
  const deviceClass = normalizeClass(item.deviceClass);
  const deviceId = item.deviceId;
  if (deviceClass && IGNORED_DEVICE_CLASSES.has(deviceClass)) {
    return true;
  }
  if (IGNORED_DEVICE_NAME_PATTERNS.some((pattern) => pattern.test(item.deviceName))) {
    return true;
  }
  if (deviceId && IGNORED_DEVICE_ID_PATTERNS.some((pattern) => pattern.test(deviceId))) {
    return true;
  }
  return false;
}

function isMeaningfulDevice(item: DriverInventoryItem): boolean {
  if (isIgnoredDevice(item)) {
    return false;
  }

  const deviceClass = normalizeClass(item.deviceClass);
  const haystack = `${item.deviceName} ${item.provider} ${item.manufacturer ?? ""}`.toLowerCase();

  if (!deviceClass) {
    return PREFERRED_VENDOR_KEYWORDS.some((keyword) => haystack.includes(keyword));
  }

  if (deviceClass === "SYSTEM") {
    return SYSTEM_DEVICE_KEYWORDS.some((keyword) => haystack.includes(keyword));
  }

  if (deviceClass === "USB") {
    if (/root hub|generic usb hub/i.test(haystack)) {
      return false;
    }
    return true;
  }

  return HIGH_VALUE_DEVICE_CLASSES.has(deviceClass);
}

function candidateRecommendation(
  item: DriverInventoryItem
): {
  needsUpdate: boolean;
  reason: string;
  severity: DriverCandidate["severity"];
  recommendation: DriverCandidate["recommendation"];
  officialUrl: string;
  daysOld?: number;
  driverDate?: string;
} {
  const providerText = `${item.provider} ${item.manufacturer ?? ""}`.toLowerCase();
  const isMicrosoftProvider = providerText.includes("microsoft");
  const isMeaningful = isMeaningfulDevice(item);
  const portal = providerPortal(item);
  const hasOemPortal = portal !== WINDOWS_UPDATE_URI;
  const recommendation: DriverCandidate["recommendation"] = hasOemPortal ? "oem_portal" : "windows_update";
  const officialUrl = recommendation === "oem_portal" ? portal : WINDOWS_UPDATE_URI;

  const parsedDate = parseDriverDate(item.driverDate);
  const daysOld = computeDaysOld(parsedDate);
  const driverDate =
    parsedDate !== undefined ? new Date(parsedDate).toISOString().slice(0, 10) : undefined;

  if (!item.driverVersion || item.driverVersion === "unknown" || /^0(?:\.0)+$/.test(item.driverVersion)) {
    return {
      needsUpdate: true,
      reason: "Missing or placeholder driver version; verify with official source.",
      severity: "high",
      recommendation,
      officialUrl,
      daysOld,
      driverDate
    };
  }

  if (daysOld === undefined) {
    if (!isMeaningful) {
      return {
        needsUpdate: false,
        reason: "",
        severity: "low",
        recommendation,
        officialUrl
      };
    }
    return {
      needsUpdate: true,
      reason: "Driver date is unavailable; verify this device from the official source.",
      severity: "medium",
      recommendation,
      officialUrl,
      daysOld,
      driverDate
    };
  }

  if (isMicrosoftProvider) {
    if (!isMeaningful) {
      return {
        needsUpdate: false,
        reason: "",
        severity: "low",
        recommendation,
        officialUrl,
        daysOld,
        driverDate
      };
    }

    if (daysOld >= 1095) {
      return {
        needsUpdate: true,
        reason: `Generic Microsoft driver is older than ~3 years (${daysOld} days).`,
        severity: recommendation === "oem_portal" ? "medium" : "low",
        recommendation,
        officialUrl,
        daysOld,
        driverDate
      };
    }

    return {
      needsUpdate: false,
      reason: "",
      severity: "low",
      recommendation,
      officialUrl,
      daysOld,
      driverDate
    };
  }

  if (daysOld >= 1825) {
    return {
      needsUpdate: true,
      reason: `Driver appears very old (${daysOld} days).`,
      severity: "high",
      recommendation,
      officialUrl,
      daysOld,
      driverDate
    };
  }

  if (daysOld >= 730) {
    return {
      needsUpdate: true,
      reason: `OEM driver is older than ~2 years (${daysOld} days).`,
      severity: "medium",
      recommendation,
      officialUrl,
      daysOld,
      driverDate
    };
  }

  return {
    needsUpdate: false,
    reason: "",
    severity: "low",
    recommendation,
    officialUrl,
    daysOld,
    driverDate
  };
}

function severityRank(severity: DriverCandidate["severity"]): number {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  return 1;
}

function uniqueTrimmedStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

function toInventoryItem(row: RawDriverRow, index: number): DriverInventoryItem | null {
  if (!row.DeviceName && !row.DriverProviderName) {
    return null;
  }

  return {
    id: `${index}-${String(row.DeviceName ?? "device")}`,
    deviceName: String(row.DeviceName ?? "Unknown device"),
    provider: String(row.DriverProviderName ?? "Unknown"),
    manufacturer: row.Manufacturer ? String(row.Manufacturer) : undefined,
    driverVersion: String(row.DriverVersion ?? "unknown"),
    driverDate: row.DriverDate ? String(row.DriverDate) : undefined,
    infName: row.InfName ? String(row.InfName) : undefined,
    deviceClass: row.DeviceClass ? String(row.DeviceClass) : undefined,
    deviceId: row.DeviceID ? String(row.DeviceID) : undefined
  };
}

export function buildDriverScanResult(rows: Array<Record<string, unknown>>): DriverScanResponse {
  return buildDriverScanResultWithPreferences(rows, {
    ignoredInfNames: [],
    ignoredDeviceIds: [],
    hiddenSuggestionIds: []
  });
}

function normalizeSuppressionPreferences(
  value?: DriverSuppressionPreferences
): DriverSuppressionPreferences {
  const hiddenSuggestionIds = (value?.hiddenSuggestionIds ?? [])
    .map((item: DriverSuppressionSuggestionId | string) => String(item ?? "").trim())
    .filter((item: string): item is DriverSuppressionSuggestionId =>
      DRIVER_SUPPRESSION_SUGGESTION_IDS.has(item as DriverSuppressionSuggestionId)
    );

  return {
    ignoredInfNames: Array.from(
      new Set((value?.ignoredInfNames ?? []).map((item: string) => String(item ?? "").trim().toLowerCase()).filter(Boolean))
    ),
    ignoredDeviceIds: Array.from(
      new Set((value?.ignoredDeviceIds ?? []).map((item: string) => String(item ?? "").trim().toLowerCase()).filter(Boolean))
    ),
    hiddenSuggestionIds: Array.from(new Set<DriverSuppressionSuggestionId>(hiddenSuggestionIds))
  };
}

function isSuppressedDevice(item: DriverInventoryItem, preferences: DriverSuppressionPreferences): boolean {
  const infName = String(item.infName ?? "").trim().toLowerCase();
  const deviceId = String(item.deviceId ?? "").trim().toLowerCase();
  return (
    (infName.length > 0 && preferences.ignoredInfNames.includes(infName)) ||
    (deviceId.length > 0 && preferences.ignoredDeviceIds.includes(deviceId))
  );
}

function isInfrastructureSystemCandidate(candidate: DriverCandidate): boolean {
  if (normalizeClass(candidate.deviceClass) !== "SYSTEM") {
    return false;
  }

  const haystack =
    `${candidate.deviceName} ${candidate.provider} ${candidate.manufacturer ?? ""}`.toLowerCase();
  const deviceId = String(candidate.deviceId ?? "");

  return (
    INFRASTRUCTURE_DEVICE_ID_PATTERNS.some((pattern) => pattern.test(deviceId)) &&
    INFRASTRUCTURE_SUGGESTION_KEYWORDS.some((keyword) => haystack.includes(keyword))
  );
}

function isVmwareCandidate(candidate: DriverCandidate): boolean {
  const haystack =
    `${candidate.deviceName} ${candidate.provider} ${candidate.manufacturer ?? ""}`.toLowerCase();
  const deviceId = String(candidate.deviceId ?? "");

  return (
    VMWARE_SUGGESTION_KEYWORDS.some((keyword) => haystack.includes(keyword)) ||
    VMWARE_DEVICE_ID_PATTERNS.some((pattern) => pattern.test(deviceId))
  );
}

function isHyperVCandidate(candidate: DriverCandidate): boolean {
  const haystack =
    `${candidate.deviceName} ${candidate.provider} ${candidate.manufacturer ?? ""}`.toLowerCase();
  const deviceId = String(candidate.deviceId ?? "");

  return (
    HYPERV_SUGGESTION_KEYWORDS.some((keyword) => haystack.includes(keyword)) ||
    HYPERV_DEVICE_ID_PATTERNS.some((pattern) => pattern.test(deviceId))
  );
}

function isCamoCandidate(candidate: DriverCandidate): boolean {
  const haystack =
    `${candidate.deviceName} ${candidate.provider} ${candidate.manufacturer ?? ""}`.toLowerCase();

  return CAMO_SUGGESTION_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function isXboxVirtualCandidate(candidate: DriverCandidate): boolean {
  const haystack =
    `${candidate.deviceName} ${candidate.provider} ${candidate.manufacturer ?? ""}`.toLowerCase();
  const deviceId = String(candidate.deviceId ?? "");

  return (
    XBOX_SUGGESTION_KEYWORDS.some((keyword) => haystack.includes(keyword)) ||
    XBOX_DEVICE_ID_PATTERNS.some((pattern) => pattern.test(deviceId))
  );
}

function buildSuggestionDefinitions(): DriverSuppressionSuggestionDefinition[] {
  return [
    {
      id: "system-infrastructure",
      title: "Hide chipset and motherboard infrastructure hints",
      description:
        "These SYSTEM/PCI/ACPI devices are usually chipset or motherboard infrastructure entries that generate noisy update hints but are rarely actionable one by one.",
      group: "infrastructure",
      autoEligible: true,
      confidence: "high",
      minimumMatches: 2,
      match: (candidate) => isInfrastructureSystemCandidate(candidate)
    },
    {
      id: "virtualization-vmware",
      title: "Hide VMware virtual network and host hints",
      description:
        "These entries belong to VMware virtual adapters and host transport. Suppressing them only changes what you review inside this app.",
      group: "virtualization",
      autoEligible: false,
      confidence: "medium",
      minimumMatches: 1,
      match: (candidate) => isVmwareCandidate(candidate)
    },
    {
      id: "virtualization-hyperv",
      title: "Hide Hyper-V virtualization stack hints",
      description:
        "These entries come from the Hyper-V virtualization stack. Suppressing them hides virtual platform noise without hiding physical hardware.",
      group: "virtualization",
      autoEligible: false,
      confidence: "medium",
      minimumMatches: 1,
      match: (candidate) => isHyperVCandidate(candidate)
    },
    {
      id: "virtualization-camo",
      title: "Hide Camo virtual camera hints",
      description:
        "These entries come from Camo virtual camera drivers. Suppressing them only removes their driver-review rows from this app.",
      group: "virtualization",
      autoEligible: false,
      confidence: "medium",
      minimumMatches: 1,
      match: (candidate) => isCamoCandidate(candidate)
    },
    {
      id: "virtualization-xbox",
      title: "Hide Xbox virtual storage hints",
      description:
        "This hides Xbox virtual storage transport entries such as XVDD, which are not physical hardware driver targets.",
      group: "virtualization",
      autoEligible: false,
      confidence: "medium",
      minimumMatches: 1,
      match: (candidate) => isXboxVirtualCandidate(candidate)
    }
  ];
}

async function collectDriverStackSignalSnapshot(): Promise<DriverStackSignalSnapshot> {
  if (process.platform !== "win32") {
    return {
      installedApps: [],
      processes: [],
      services: [],
      features: []
    };
  }

  const runtimeScript = `
$virtualizationKeyExists = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Virtualization'
$lxssKeyPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss'
$lxssKeyExists = Test-Path $lxssKeyPath
$lxssDistributionCount = if ($lxssKeyExists) {
  @(Get-ChildItem $lxssKeyPath -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\\{.+\\}$' }).Count
} else {
  0
}
$result = [ordered]@{
  processes = @(Get-CimInstance Win32_Process | Select-Object Name, ExecutablePath, CommandLine)
  services = @(Get-CimInstance Win32_Service | Select-Object Name, DisplayName, State, StartMode, PathName)
  virtualizationKeyExists = $virtualizationKeyExists
  lxssKeyExists = $lxssKeyExists
  lxssDistributionCount = $lxssDistributionCount
}
$result | ConvertTo-Json -Depth 5
`;

  const [installedApps, runtimeData] = await Promise.all([
    withTimeout(collectInstalledApps(), STACK_SIGNAL_TIMEOUT_MS, [] as InstalledAppRecord[]),
    withTimeout(
      execFileAsync("powershell", ["-NoProfile", "-Command", runtimeScript], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      })
        .then(({ stdout }) => {
          if (!stdout.trim()) {
            return {
              processes: [],
              services: [],
              virtualizationKeyExists: false,
              lxssKeyExists: false,
              lxssDistributionCount: 0
            };
          }
          const parsed = parseJsonPayload<{
            processes?: DriverStackRuntimeProcess[] | DriverStackRuntimeProcess;
            services?: DriverStackRuntimeService[] | DriverStackRuntimeService;
            virtualizationKeyExists?: boolean;
            lxssKeyExists?: boolean;
            lxssDistributionCount?: number;
          }>(stdout, "Driver stack runtime PowerShell output");
          return {
            processes: Array.isArray(parsed.processes)
              ? parsed.processes
              : parsed.processes
                ? [parsed.processes]
                : [],
            services: Array.isArray(parsed.services)
              ? parsed.services
              : parsed.services
                ? [parsed.services]
                : [],
            virtualizationKeyExists: Boolean(parsed.virtualizationKeyExists),
            lxssKeyExists: Boolean(parsed.lxssKeyExists),
            lxssDistributionCount: Number(parsed.lxssDistributionCount ?? 0)
          };
        }),
      STACK_SIGNAL_TIMEOUT_MS,
      {
        processes: [] as DriverStackRuntimeProcess[],
        services: [] as DriverStackRuntimeService[],
        virtualizationKeyExists: false,
        lxssKeyExists: false,
        lxssDistributionCount: 0
      }
    )
  ]);

  const features = buildDriverFeatureSignals(
    runtimeData.services,
    runtimeData.virtualizationKeyExists,
    runtimeData.lxssKeyExists,
    runtimeData.lxssDistributionCount
  );

  return {
    installedApps,
    processes: runtimeData.processes,
    services: runtimeData.services,
    features
  };
}

function joinLowerText(values: Array<string | undefined>): string {
  return values
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function matchesAnyKeyword(texts: string[], keywords: string[]): boolean {
  return texts.some((text) => keywords.some((keyword) => text.includes(keyword)));
}

function summarizeEvidence(kind: "process" | "service" | "app", values: string[]): string {
  if (!values.length) {
    return "";
  }
  const shown = values.slice(0, 2).join(", ");
  return `${kind}: ${shown}`;
}

function buildDriverFeatureSignals(
  services: DriverStackRuntimeService[],
  virtualizationKeyExists: boolean,
  lxssKeyExists: boolean,
  lxssDistributionCount: number
): DriverStackFeatureSignal[] {
  const normalizedServices = services.map((item, index) => ({
    label: String(item.displayName ?? item.name ?? "").trim() || `service-${index}`,
    name: String(item.name ?? "").trim().toLowerCase(),
    state: String(item.state ?? "").trim().toLowerCase(),
    startMode: String(item.startMode ?? "").trim().toLowerCase()
  }));

  const serviceEvidence = (
    names: string[],
    options: { runningOnly?: boolean; includeStartMode?: boolean } = {}
  ): string[] =>
    normalizedServices
      .filter((item) => {
        if (!names.some((name) => item.name === name || item.name.startsWith(name))) {
          return false;
        }
        if (options.runningOnly) {
          return item.state === "running";
        }
        return item.state.length > 0;
      })
      .map((item) =>
        options.includeStartMode && item.startMode
          ? `${item.label} (${item.startMode})`
          : item.label
      );

  const hypervServices = serviceEvidence(["vmms", "vmcompute", "hvhost", "vmic"], { includeStartMode: true });
  const hypervRunningServices = serviceEvidence(["vmms", "vmcompute", "hvhost", "vmic"], { runningOnly: true });
  const platformServices = serviceEvidence(["vmcompute", "hns"], { includeStartMode: true });
  const platformRunningServices = serviceEvidence(["vmcompute", "hns"], { runningOnly: true });
  const wslServices = serviceEvidence(["lxssmanager"], { includeStartMode: true });
  const wslRunningServices = serviceEvidence(["lxssmanager"], { runningOnly: true });

  const featureSignals: DriverStackFeatureSignal[] = [];

  if (virtualizationKeyExists || hypervServices.length || hypervRunningServices.length) {
    featureSignals.push({
      id: "hyperv",
      enabled: true,
      evidence:
        [
          virtualizationKeyExists ? "registry: Windows virtualization platform" : "",
          hypervRunningServices.length ? summarizeEvidence("service", hypervRunningServices) : "",
          hypervServices.length ? `installed service: ${hypervServices.slice(0, 2).join(", ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ") || "Hyper-V platform signals were detected."
    });
  }

  if (virtualizationKeyExists || platformServices.length || platformRunningServices.length) {
    featureSignals.push({
      id: "virtual_machine_platform",
      enabled: true,
      evidence:
        [
          virtualizationKeyExists ? "registry: virtualization platform components" : "",
          platformRunningServices.length ? summarizeEvidence("service", platformRunningServices) : "",
          platformServices.length ? `installed service: ${platformServices.slice(0, 2).join(", ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ") || "Virtual Machine Platform signals were detected."
    });
  }

  if (lxssKeyExists || lxssDistributionCount > 0 || wslServices.length || wslRunningServices.length) {
    featureSignals.push({
      id: "wsl",
      enabled: true,
      evidence:
        [
          lxssDistributionCount > 0
            ? `registry: ${lxssDistributionCount} WSL distro${lxssDistributionCount === 1 ? "" : "s"}`
            : lxssKeyExists
              ? "registry: WSL configured"
              : "",
          wslRunningServices.length ? summarizeEvidence("service", wslRunningServices) : "",
          wslServices.length ? `installed service: ${wslServices.slice(0, 2).join(", ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ") || "WSL signals were detected."
    });
  }

  if (platformServices.length || platformRunningServices.length) {
    featureSignals.push({
      id: "containers",
      enabled: true,
      evidence:
        [
          platformRunningServices.length ? summarizeEvidence("service", platformRunningServices) : "",
          platformServices.length ? `installed service: ${platformServices.slice(0, 2).join(", ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ") || "Container platform signals were detected."
    });
  }

  return featureSignals;
}

function resolveDriverStackUsage(
  suggestionId: DriverSuppressionSuggestionId,
  snapshot?: DriverStackSignalSnapshot
): DriverStackUsageInfo {
  if (suggestionId === "system-infrastructure") {
    return {
      activityState: "active",
      activitySummary: "Core platform devices are always present. Safe to hide from review without removing hardware support.",
      activitySignals: [],
      activitySignalEvidence: [],
      recommendedToHide: true
    };
  }

  if (!snapshot) {
    return {
      activityState: "unknown",
      activitySummary: "Runtime activity could not be verified on this machine.",
      activitySignals: [],
      activitySignalEvidence: [],
      recommendedToHide: false
    };
  }

  const appTexts = snapshot.installedApps.map((item) => joinLowerText([item.name, item.installLocation]));
  const processTexts = snapshot.processes.map((item) =>
    joinLowerText([item.name, item.executablePath, item.commandLine])
  );
  const featureSignals = snapshot.features ?? [];
  const runningServiceTexts = snapshot.services
    .filter((item) => String(item.state ?? "").trim().toLowerCase() === "running")
    .map((item) => joinLowerText([item.name, item.displayName, item.pathName]));
  const installedServiceTexts = snapshot.services.map((item) =>
    joinLowerText([item.name, item.displayName, item.pathName])
  );

  const stackKeywords: Record<
    Exclude<DriverSuppressionSuggestionId, "system-infrastructure">,
    { app: string[]; process: string[]; service: string[] }
  > = {
    "virtualization-vmware": {
      app: ["vmware"],
      process: ["vmware", "vmnat", "vmnetdhcp", "vmware-authd", "vmware-usbarbitrator"],
      service: ["vmware", "vmnat", "vmnetdhcp", "vmauthd"]
    },
    "virtualization-hyperv": {
      app: ["hyper-v"],
      process: ["hyper-v", "vmcompute", "vmms"],
      service: ["hyper-v", "vmcompute", "vmms", "hns", "vmic"]
    },
    "virtualization-camo": {
      app: ["camo", "reincubate"],
      process: ["camo", "reincubate"],
      service: ["camo", "reincubate"]
    },
    "virtualization-xbox": {
      app: ["xbox", "gaming services", "gamingservices"],
      process: ["xbox", "gamingservices"],
      service: ["xbox", "gamingservices", "xbl", "xboxgipsvc", "xboxnetapisvc"]
    }
  };

  const keywords = stackKeywords[suggestionId as Exclude<DriverSuppressionSuggestionId, "system-infrastructure">];
  const stackFeatureIds: Partial<
    Record<Exclude<DriverSuppressionSuggestionId, "system-infrastructure">, DriverStackFeatureSignal["id"][]>
  > = {
    "virtualization-hyperv": ["hyperv", "virtual_machine_platform", "wsl", "containers"]
  };
  const matchedApps = snapshot.installedApps
    .map((item) => item.name)
    .filter((name, index) => appTexts[index] && matchesAnyKeyword([appTexts[index]], keywords.app));
  const matchedProcesses = snapshot.processes
    .map((item, index) => ({ label: String(item.name ?? "").trim() || `process-${index}`, text: processTexts[index] }))
    .filter((item) => matchesAnyKeyword([item.text], keywords.process))
    .map((item) => item.label);
  const matchedRunningServices = snapshot.services
    .map((item, index) => ({
      label: String(item.displayName ?? item.name ?? "").trim() || `service-${index}`,
      text: runningServiceTexts.includes(installedServiceTexts[index] ?? "") ? installedServiceTexts[index] : ""
    }))
    .filter((item) => item.text && matchesAnyKeyword([item.text], keywords.service))
    .map((item) => item.label);
  const matchedInstalledServices = snapshot.services
    .map((item, index) => ({
      label: String(item.displayName ?? item.name ?? "").trim() || `service-${index}`,
      text: installedServiceTexts[index]
    }))
    .filter((item) => matchesAnyKeyword([item.text], keywords.service))
    .map((item) => item.label);
  const matchedFeatures = featureSignals.filter((item) =>
    (stackFeatureIds[suggestionId as Exclude<DriverSuppressionSuggestionId, "system-infrastructure">] ?? []).includes(
      item.id
    )
  );

  if (matchedProcesses.length || matchedRunningServices.length) {
    return {
      activityState: "active",
      activitySummary:
        [
          summarizeEvidence("process", matchedProcesses),
          summarizeEvidence("service", matchedRunningServices),
          matchedFeatures.length ? `feature: ${matchedFeatures.slice(0, 2).map((item) => item.evidence).join(" | ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ") || "Active runtime signals were detected.",
      activitySignals: matchedFeatures.map((item) => item.id),
      activitySignalEvidence: matchedFeatures.map((item) => ({ id: item.id, evidence: item.evidence })),
      recommendedToHide: false
    };
  }

  if (matchedApps.length || matchedInstalledServices.length || matchedFeatures.length) {
    return {
      activityState: "installed",
      activitySummary:
        [
          summarizeEvidence("app", matchedApps),
          summarizeEvidence("service", matchedInstalledServices),
          matchedFeatures.length ? `feature: ${matchedFeatures.slice(0, 2).map((item) => item.evidence).join(" | ")}` : ""
        ]
          .filter(Boolean)
          .join(" | ") || "Installed components were detected on this machine.",
      activitySignals: matchedFeatures.map((item) => item.id),
      activitySignalEvidence: matchedFeatures.map((item) => ({ id: item.id, evidence: item.evidence })),
      recommendedToHide: false
    };
  }

  return {
    activityState: "inactive",
    activitySummary: "No installed-app, service, or running-process signal was detected for this stack.",
    activitySignals: [],
    activitySignalEvidence: [],
    recommendedToHide: true
  };
}

function buildSuppressionPayload(matches: DriverCandidate[]): Pick<DriverSuppressionSuggestion, "infNames" | "deviceIds"> {
  const infCounts = new Map<string, number>();
  for (const candidate of matches) {
    const infName = String(candidate.infName ?? "").trim().toLowerCase();
    if (!infName) {
      continue;
    }
    infCounts.set(infName, (infCounts.get(infName) ?? 0) + 1);
  }

  const infNames = [...infCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([infName]) => infName);
  const suppressedByInf = new Set(
    matches
      .filter((candidate) => {
        const infName = String(candidate.infName ?? "").trim().toLowerCase();
        return infName.length > 0 && infNames.includes(infName);
      })
      .map((candidate) => candidate.id)
  );
  const deviceIds = uniqueTrimmedStrings(
    matches
      .filter((candidate) => !suppressedByInf.has(candidate.id))
      .map((candidate) => candidate.deviceId)
  );

  return { infNames, deviceIds };
}

function matchesHiddenSuggestion(
  candidate: DriverCandidate,
  hiddenSuggestionIds: Set<DriverSuppressionSuggestionId>
): boolean {
  if (!hiddenSuggestionIds.size) {
    return false;
  }

  return buildSuggestionDefinitions().some(
    (definition) => hiddenSuggestionIds.has(definition.id) && definition.match(candidate)
  );
}

function buildDriverSuppressionSuggestions(
  candidates: DriverCandidate[],
  hiddenSuggestionIds: Set<DriverSuppressionSuggestionId>,
  signalSnapshot?: DriverStackSignalSnapshot
): DriverSuppressionSuggestion[] {
  return buildSuggestionDefinitions()
    .filter((definition) => !hiddenSuggestionIds.has(definition.id))
    .map((definition) => {
      const matches = candidates.filter((candidate) => definition.match(candidate));
      if (matches.length < definition.minimumMatches) {
        return null;
      }

      const payload = buildSuppressionPayload(matches);
      if (!payload.infNames.length && !payload.deviceIds.length) {
        return null;
      }
      const usage = resolveDriverStackUsage(definition.id, signalSnapshot);

      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        group: definition.group,
        autoEligible: definition.autoEligible,
        confidence: definition.confidence,
        activityState: usage.activityState,
        activitySummary: usage.activitySummary,
        activitySignals: usage.activitySignals,
        activitySignalEvidence: usage.activitySignalEvidence,
        recommendedToHide: usage.recommendedToHide,
        matchCount: matches.length,
        infNames: payload.infNames,
        deviceIds: payload.deviceIds,
        exampleDevices: uniqueTrimmedStrings(matches.map((candidate) => candidate.deviceName)).slice(0, 4)
      } satisfies DriverSuppressionSuggestion;
    })
    .filter((item): item is DriverSuppressionSuggestion => item !== null);
}

export function buildDriverScanResultWithPreferences(
  rows: Array<Record<string, unknown>>,
  preferences: DriverSuppressionPreferences,
  signalSnapshot?: DriverStackSignalSnapshot
): DriverScanResponse {
  const normalizedPreferences = normalizeSuppressionPreferences(preferences);
  const hiddenSuggestionIds = new Set<DriverSuppressionSuggestionId>(normalizedPreferences.hiddenSuggestionIds);
  const devices = rows
    .map((row, index) => toInventoryItem(row as RawDriverRow, index))
    .filter((item): item is DriverInventoryItem => item !== null);
  const meaningfulDevices = devices.filter((item) => isMeaningfulDevice(item));
  const unsuppressedDevices = meaningfulDevices.filter((item) => !isSuppressedDevice(item, normalizedPreferences));

  const candidatePool: DriverCandidate[] = unsuppressedDevices
    .map((item) => ({ item, recommendation: candidateRecommendation(item) }))
    .filter(({ recommendation }) => recommendation.needsUpdate)
    .map(({ item, recommendation }) => ({
      id: item.id,
      deviceName: item.deviceName,
      currentDriverVersion: item.driverVersion,
      provider: item.provider,
      manufacturer: item.manufacturer,
      driverDate: recommendation.driverDate,
      daysOld: recommendation.daysOld,
      deviceClass: normalizeClass(item.deviceClass),
      infName: item.infName,
      deviceId: item.deviceId,
      reason: recommendation.reason,
      severity: recommendation.severity,
      recommendation: recommendation.recommendation,
      officialUrl: recommendation.officialUrl
    }))
    .sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return (right.daysOld ?? 0) - (left.daysOld ?? 0);
    });
  const updateCandidates = candidatePool.filter(
    (candidate) => !matchesHiddenSuggestion(candidate, hiddenSuggestionIds)
  );
  const suppressionSuggestions = buildDriverSuppressionSuggestions(updateCandidates, hiddenSuggestionIds, signalSnapshot);

  return {
    source: "windows_update+oem_hints",
    devices,
    updateCandidates,
    meaningfulDeviceCount: meaningfulDevices.length,
    ignoredDeviceCount: Math.max(0, devices.length - meaningfulDevices.length),
    suppressedCount: Math.max(0, meaningfulDevices.length - unsuppressedDevices.length),
    stackSuppressedCount: Math.max(0, candidatePool.length - updateCandidates.length),
    suppressionSuggestions
  };
}

export class DriverScanService {
  private readonly resolveSuppressionPreferences: () =>
    Promise<DriverSuppressionPreferences> | DriverSuppressionPreferences;
  private scanCache:
    | {
        key: string;
        value: DriverScanResponse;
        cachedAt: number;
      }
    | null = null;
  private scanInFlight:
    | {
        key: string;
        promise: Promise<DriverScanResponse>;
      }
    | null = null;
  private performanceSummaryCache:
    | {
        value: DriverPerformanceSummary;
        cachedAt: number;
      }
    | null = null;
  private performanceSummaryInFlight: Promise<DriverPerformanceSummary> | null = null;

  constructor(dependencies: DriverScanServiceDependencies = {}) {
    this.resolveSuppressionPreferences =
      dependencies.resolveSuppressionPreferences ??
      (() => ({ ignoredInfNames: [], ignoredDeviceIds: [], hiddenSuggestionIds: [] }));
  }

  async scan(): Promise<DriverScanResponse> {
    if (process.platform !== "win32") {
      return {
        source: "windows_update+oem_hints",
        devices: [],
        updateCandidates: [],
        meaningfulDeviceCount: 0,
        ignoredDeviceCount: 0,
        suppressedCount: 0,
        stackSuppressedCount: 0,
        suppressionSuggestions: []
      };
    }

    const preferences = normalizeSuppressionPreferences(
      await Promise.resolve(this.resolveSuppressionPreferences()).catch(() => ({
        ignoredInfNames: [],
        ignoredDeviceIds: [],
        hiddenSuggestionIds: []
      }))
    );
    const cacheKey = JSON.stringify(preferences);
    const now = Date.now();
    if (this.scanCache && this.scanCache.key === cacheKey && now - this.scanCache.cachedAt < 45_000) {
      return this.scanCache.value;
    }
    if (this.scanInFlight && this.scanInFlight.key === cacheKey) {
      return this.scanInFlight.promise;
    }

    const script = `
Get-CimInstance Win32_PnPSignedDriver |
  Select-Object DeviceName, DriverProviderName, Manufacturer, DriverVersion, DriverDate, InfName, DeviceClass, DeviceID |
  ConvertTo-Json -Depth 4
`;

    const promise = (async () => {
      try {
        const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script], {
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024
        });

        if (!stdout.trim()) {
          const empty = {
            source: "windows_update+oem_hints",
            devices: [],
            updateCandidates: [],
            meaningfulDeviceCount: 0,
            ignoredDeviceCount: 0,
            suppressedCount: 0,
            stackSuppressedCount: 0,
            suppressionSuggestions: []
          } satisfies DriverScanResponse;
          this.scanCache = { key: cacheKey, value: empty, cachedAt: Date.now() };
          return empty;
        }

        const parsed = parseJsonPayload<Array<Record<string, unknown>> | Record<string, unknown>>(
          stdout,
          "Driver inventory PowerShell output"
        );
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const signalSnapshot = await collectDriverStackSignalSnapshot().catch(() => undefined);
        const result = buildDriverScanResultWithPreferences(rows, preferences, signalSnapshot);
        this.scanCache = { key: cacheKey, value: result, cachedAt: Date.now() };
        return result;
      } catch {
        return {
          source: "windows_update+oem_hints",
          devices: [],
          updateCandidates: [],
          meaningfulDeviceCount: 0,
          ignoredDeviceCount: 0,
          suppressedCount: 0,
          stackSuppressedCount: 0,
          suppressionSuggestions: []
        } satisfies DriverScanResponse;
      }
    })();
    this.scanInFlight = { key: cacheKey, promise };

    try {
      return await promise;
    } finally {
      if (this.scanInFlight?.key === cacheKey) {
        this.scanInFlight = null;
      }
    }
  }

  async scanPerformanceSummary(): Promise<DriverPerformanceSummary> {
    const now = Date.now();
    if (this.performanceSummaryCache && now - this.performanceSummaryCache.cachedAt < 12_000) {
      return this.performanceSummaryCache.value;
    }
    if (this.performanceSummaryInFlight) {
      return this.performanceSummaryInFlight;
    }

    this.performanceSummaryInFlight = (async () => {
      const [scanResult, perfCounters] = await Promise.all([
        this.scan().catch<DriverScanResponse>(() => ({
          source: "windows_update+oem_hints",
          devices: [],
          updateCandidates: [],
          meaningfulDeviceCount: 0,
          ignoredDeviceCount: 0,
          suppressedCount: 0,
          stackSuppressedCount: 0,
          suppressionSuggestions: []
        })),
        getPerfCounterSnapshot().catch(() => ({
          cpuUsagePct: 0,
          ramUsedPct: 0,
          diskActivePct: 0,
          dpcPct: 0,
          interruptPct: 0
        }))
      ]);

      const suspectedDrivers = scanResult.updateCandidates.slice(0, 6).map((candidate) => ({
        name: candidate.deviceName,
        reason: [candidate.reason, candidate.provider ? `Provider ${candidate.provider}` : "Candidate surfaced by driver scanner"],
        confidence: candidate.severity === "high" ? 0.8 : candidate.severity === "medium" ? 0.65 : 0.5
      }));
      const activeSignals = Array.from(
        new Set(
          scanResult.suppressionSuggestions
            .flatMap((item) => item.activitySignals)
            .filter((item): item is DriverStackFeatureSignalId => Boolean(item))
        )
      );

      const driverSignalStrength =
        Number(perfCounters.dpcPct ?? 0) >= 10 || Number(perfCounters.interruptPct ?? 0) >= 5 || suspectedDrivers.length >= 5
          ? "high"
          : Number(perfCounters.dpcPct ?? 0) >= 5 || Number(perfCounters.interruptPct ?? 0) >= 2 || suspectedDrivers.length >= 2
            ? "medium"
            : "low";

      const result = {
        latencyRisk: driverSignalStrength,
        dpcPct: perfCounters.dpcPct,
        interruptPct: perfCounters.interruptPct,
        suspectedDrivers,
        activeSignals
      } satisfies DriverPerformanceSummary;
      this.performanceSummaryCache = {
        value: result,
        cachedAt: Date.now()
      };
      return result;
    })();

    try {
      return await this.performanceSummaryInFlight;
    } finally {
      this.performanceSummaryInFlight = null;
    }
  }

  async lookupOfficialWithAi(
    candidate: DriverCandidate,
    options?: { open?: boolean }
  ): Promise<{ lookup: DriverOfficialLookup; opened: boolean }> {
    const machine = await withTimeout(getMachineSupportIdentity(), 1500, {});
    const heuristic = buildHeuristicDriverLookup(candidate, machine);
    let lookup = heuristic;
    const providerState = getSystemDoctorProviderState();

    if (providerState.configured) {
      try {
        const aiResult = await requestCerebrasStructuredJson<z.infer<typeof driverOfficialLookupAiSchema>>({
          model: "gpt-oss-120b",
          systemPrompt: [
            "You are a Windows driver support lookup assistant.",
            "You receive structured device metadata and one official support domain or Microsoft update path.",
            "Return only a refined search query for finding the driver on that official source.",
            "Do not invent download URLs or non-official domains.",
            "Do not output anything except strict JSON matching the schema."
          ].join(" "),
          userPayload: {
            candidate: {
              deviceName: candidate.deviceName,
              provider: candidate.provider,
              manufacturer: candidate.manufacturer,
              driverVersion: candidate.currentDriverVersion,
              deviceClass: candidate.deviceClass,
              infName: candidate.infName,
              deviceId: candidate.deviceId,
              recommendation: candidate.recommendation
            },
            machine,
            officialDomain: heuristic.officialDomain,
            officialBaseUrl: heuristic.officialBaseUrl,
            fallbackSearchQuery: heuristic.searchQuery
          },
          temperature: 0.1
        });

        const parsed = driverOfficialLookupAiSchema.parse(aiResult);
        lookup = {
          provider: "cerebras",
          model: "gpt-oss-120b",
          officialDomain: heuristic.officialDomain,
          officialBaseUrl: heuristic.officialBaseUrl,
          searchQuery: parsed.searchQuery,
          searchUrl:
            candidate.recommendation === "windows_update"
              ? `${WINDOWS_UPDATE_CATALOG_URL}?q=${encodeURIComponent(parsed.searchQuery)}`
              : `https://www.google.com/search?q=${encodeURIComponent(parsed.searchQuery)}`,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning
        };
      } catch {
        lookup = heuristic;
      }
    }

    let opened = false;
    if (options?.open) {
      try {
        await shell.openExternal(lookup.searchUrl);
        opened = true;
      } catch {
        opened = false;
      }
    }

    return { lookup, opened };
  }

  async openOfficial(candidate: DriverCandidate): Promise<{ opened: boolean }> {
    if (candidate.recommendation === "windows_update") {
      return this.openWindowsUpdate();
    }

    try {
      await shell.openExternal(candidate.officialUrl);
      return { opened: true };
    } catch {
      return this.openWindowsUpdate();
    }
  }

  async openWindowsUpdate(): Promise<{ opened: boolean }> {
    try {
      await shell.openExternal(WINDOWS_UPDATE_URI);
      return { opened: true };
    } catch {
      try {
        await execFileAsync("cmd", ["/c", "start", "", WINDOWS_UPDATE_URI], {
          windowsHide: true
        });
        return { opened: true };
      } catch {
        return { opened: false };
      }
    }
  }
}
