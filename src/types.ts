export type CleanupPreset = "lite" | "standard" | "deep" | "extreme";
export type AIProvider = "local" | "cerebras";
export type AIProviderPreference = "auto" | AIProvider;
export type AIAnalysisMode = "standard" | "fast";

export type CleanupCategory =
  | "temp"
  | "cache"
  | "logs"
  | "crash_dumps"
  | "wsl_leftovers"
  | "minecraft_leftovers"
  | "ai_model_leftovers"
  | "installer_artifacts"
  | "duplicates";

export type RiskLevel = "low" | "medium" | "high";
export type ProtectionKind =
  | "protected_system_root"
  | "app_install_root"
  | "installed_app_location"
  | "installed_app_name_match"
  | "user_allowlist_path"
  | "user_allowlist_app"
  | "binary_extension";

export interface ProtectionPreferences {
  neverCleanupPaths: string[];
  neverCleanupApps: string[];
}

export type DriverSuppressionSuggestionId =
  | "system-infrastructure"
  | "virtualization-vmware"
  | "virtualization-hyperv"
  | "virtualization-camo"
  | "virtualization-xbox";
export type DriverStackActivityState = "active" | "installed" | "inactive" | "unknown";
export type DriverStackFeatureSignalId = "hyperv" | "virtual_machine_platform" | "wsl" | "containers";

export interface AppConfig {
  defaultPreset: CleanupPreset;
  defaultCategories: CleanupCategory[];
  customRoots: string[];
  neverCleanupPaths: string[];
  neverCleanupApps: string[];
  driverIgnoredInfNames: string[];
  driverIgnoredDeviceIds: string[];
  driverHiddenSuggestionIds: DriverSuppressionSuggestionId[];
  driverAutoSuppressSafeSuggestions: boolean;
  driverAutoSuppressionApplied: boolean;
  aiProvider: AIProviderPreference;
  scheduleEnabled: boolean;
  scheduleDayOfWeek: number;
  scheduleTime: string;
  quarantineRetentionDays: number;
  reducedMotion: boolean;
  highContrast: boolean;
  compactUi: boolean;
  includeInstalledApps: boolean;
  driverToolsEnabled: boolean;
  updatesFeedUrl: string;
  performanceSnapshotRetentionDays: number;
  performanceAutoSnapshotOnLaunch: boolean;
  performanceAutoSnapshotOnCleanup: boolean;
  performanceAutoSnapshotOnOptimization: boolean;
  performanceLiveSampleIntervalMs: number;
  performancePinnedMonitoring: boolean;
}

export interface SettingsPayload extends Partial<AppConfig> {}

export interface DriverSuppressionPreferences {
  ignoredInfNames: string[];
  ignoredDeviceIds: string[];
  hiddenSuggestionIds: DriverSuppressionSuggestionId[];
}

export interface ScanStartRequest {
  preset: CleanupPreset;
  categories: CleanupCategory[];
  roots: string[];
}

export interface ScanFinding {
  id: string;
  path: string;
  category: CleanupCategory;
  sizeBytes: number;
  risk: RiskLevel;
  reason: string;
  sourceRuleId: string;
  selectedByDefault: boolean;
  modifiedAt: number;
  kind?: "file" | "directory";
  entryCount?: number;
}

export interface ProtectedFindingRejection {
  path: string;
  category: CleanupCategory;
  sourceRuleId: string;
  protectionKind: ProtectionKind;
  reason: string;
  matchedAppName?: string;
}

export interface ScanSummary {
  runId: string;
  status: "running" | "completed" | "canceled" | "failed";
  startedAt: number;
  finishedAt?: number;
  processedItems: number;
  findingsCount: number;
  totalCandidateBytes: number;
  protectedRejectedCount: number;
  protectedRejectedTruncated?: boolean;
  categories: Record<CleanupCategory, { count: number; bytes: number }>;
}

export interface ScanProgressEvent {
  runId: string;
  stage: "preparing" | "surveying" | "scanning" | "analyzing" | "completed" | "canceled" | "failed";
  processedItems: number;
  findingsCount: number;
  percent: number;
  etaSec: number;
  processedDirectories?: number;
  estimatedTotalItems?: number;
  estimatedRemainingItems?: number;
  scanDensity?: number;
}

export interface ScanResultsResponse {
  status: ScanSummary["status"];
  findings: ScanFinding[];
  rejected: ProtectedFindingRejection[];
  summary: ScanSummary;
  error?: string;
}

export interface CleanupPreviewResponse {
  totalBytes: number;
  actionCount: number;
  riskFlags: {
    highRiskCount: number;
    mediumRiskCount: number;
    blockedCount: number;
  };
}

export interface CleanupExecuteResponse {
  movedCount: number;
  failedCount: number;
  freedBytes: number;
  errors: string[];
  movedIds: string[];
  failedIds: string[];
}

export interface CleanupExecutionProgressEvent {
  runId: string;
  executionId: string;
  stage: "preparing" | "running" | "completed" | "failed";
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  movedCount: number;
  failedCount: number;
  freedBytes: number;
  percent: number;
  runningPath?: string;
  message: string;
  logLine?: string;
  timestamp: number;
}

export interface QuarantineItem {
  id: string;
  originalPath: string;
  quarantinePath: string;
  sizeBytes: number;
  category: CleanupCategory;
  source: "scan" | "duplicate";
  movedAt: number;
  restoredAt?: number;
  purgedAt?: number;
  hash?: string;
}

export interface QuarantineListResponse {
  items: QuarantineItem[];
  totalCount: number;
  activeCount: number;
  hasMore: boolean;
  nextOffset: number;
}

export type QuarantinePurgeStorageHint = "nvme" | "ssd" | "hdd" | "unknown";

export interface QuarantinePurgeProgressEvent {
  stage: "preparing" | "running" | "completed" | "failed" | "canceled";
  totalGroups: number;
  completedGroups: number;
  totalItems: number;
  purgedItems: number;
  totalBytes: number;
  purgedBytes: number;
  percent: number;
  storageHint: QuarantinePurgeStorageHint;
  concurrency: number;
  currentPath?: string;
  message: string;
  logLine?: string;
  timestamp: number;
}

export interface QuarantinePurgeResponse {
  purgedCount: number;
  freedBytes: number;
  purgedGroups: number;
  storageHint: QuarantinePurgeStorageHint;
  concurrency: number;
  durationMs: number;
  canceled: boolean;
}

export interface DuplicateFileRecord {
  path: string;
  sizeBytes: number;
  modifiedAt: number;
  selected: boolean;
}

export interface DuplicateGroup {
  id: string;
  hash: string;
  files: DuplicateFileRecord[];
  bytesRecoverable: number;
}

export interface DuplicateSelection {
  groupId: string;
  keepPath: string;
  removePaths: string[];
}

export interface DuplicatePreviewResponse {
  toKeep: number;
  toQuarantine: number;
  bytesRecoverable: number;
}

export interface StorageFolderUsage {
  path: string;
  sizeBytes: number;
  fileCount: number;
}

export interface StorageContainerUsage extends StorageFolderUsage {
  label: string;
  category:
    | "temp"
    | "cache"
    | "logs"
    | "crash_dumps"
    | "wsl_leftovers"
    | "installer_artifacts";
  cachedFromIndex?: boolean;
}

export type StorageAreaCategory =
  | "system"
  | "programs"
  | "program_data"
  | "users"
  | "games"
  | "cache"
  | "logs"
  | "wsl"
  | "other";

export interface StorageAreaUsage {
  path: string;
  label: string;
  category: StorageAreaCategory;
  sizeBytes: number;
  fileCount: number;
  cachedFromIndex?: boolean;
}

export interface StorageDriveUsage {
  root: string;
  sizeBytes: number;
  fileCount: number;
}

export interface StorageFileUsage {
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface InstalledAppUsage {
  name: string;
  version?: string;
  publisher?: string;
  installLocation?: string;
  sizeBytes: number;
}

export interface StorageTreemapNode {
  id: string;
  label: string;
  path: string;
  kind: "drive" | "area" | "container" | "folder";
  category: StorageAreaCategory | StorageContainerUsage["category"] | "folder";
  sizeBytes: number;
  fileCount: number;
  cachedFromIndex?: boolean;
  children?: StorageTreemapNode[];
}

export interface StorageScanResponse {
  scannedRoots?: string[];
  totalBytes?: number;
  totalFiles?: number;
  topAreas?: StorageAreaUsage[];
  drives?: StorageDriveUsage[];
  topContainers?: StorageContainerUsage[];
  treemap?: StorageTreemapNode[];
  topFolders: StorageFolderUsage[];
  largestFiles: StorageFileUsage[];
  apps: InstalledAppUsage[];
}

export interface DriverInventoryItem {
  id: string;
  deviceName: string;
  provider: string;
  manufacturer?: string;
  driverVersion: string;
  driverDate?: string;
  infName?: string;
  deviceClass?: string;
  deviceId?: string;
}

export interface DriverCandidate {
  id: string;
  deviceName: string;
  currentDriverVersion: string;
  provider: string;
  manufacturer?: string;
  driverDate?: string;
  daysOld?: number;
  deviceClass?: string;
  infName?: string;
  deviceId?: string;
  reason: string;
  severity: "low" | "medium" | "high";
  recommendation: "windows_update" | "oem_portal";
  officialUrl: string;
}

export interface DriverOfficialLookup {
  provider: "heuristic" | "cerebras";
  model?: "gpt-oss-120b";
  officialDomain: string;
  officialBaseUrl: string;
  searchQuery: string;
  searchUrl: string;
  confidence: number;
  reasoning: string[];
}

export interface DriverActivitySignalEvidence {
  id: DriverStackFeatureSignalId;
  evidence: string;
}

export interface DriverSuppressionSuggestion {
  id: DriverSuppressionSuggestionId;
  title: string;
  description: string;
  group: "infrastructure" | "virtualization";
  autoEligible: boolean;
  confidence: "high" | "medium";
  activityState: DriverStackActivityState;
  activitySummary: string;
  activitySignals: DriverStackFeatureSignalId[];
  activitySignalEvidence: DriverActivitySignalEvidence[];
  recommendedToHide: boolean;
  matchCount: number;
  infNames: string[];
  deviceIds: string[];
  exampleDevices: string[];
}

export interface DriverScanResponse {
  source: "windows_update+oem_hints";
  devices: DriverInventoryItem[];
  updateCandidates: DriverCandidate[];
  meaningfulDeviceCount: number;
  ignoredDeviceCount: number;
  suppressedCount: number;
  stackSuppressedCount: number;
  suppressionSuggestions: DriverSuppressionSuggestion[];
}

export interface LocalModelInfo {
  name: string;
  provider: AIProvider;
  id?: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface LocalModelDecision {
  recommendedModel: string;
  provider: AIProvider;
  rationale: string;
  alternatives: string[];
}

export interface AIProviderInventory {
  localCount: number;
  cerebrasCount: number;
  cerebrasConfigured: boolean;
}

export interface AIModelsResponse {
  models: LocalModelInfo[];
  decision: LocalModelDecision;
  providers: AIProviderInventory;
}

export interface AIAppDataCandidate {
  path: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  lastModified: number;
  daysSinceModified: number;
  confidence: "low" | "medium" | "high";
  reason: string;
  matchedInstalledApp: boolean;
  activeProcessPath?: string;
  referenceKinds: Array<"process" | "service" | "path_env" | "install_location">;
  referenceCount: number;
  referencedAnywhere: boolean;
  installedAppName?: string;
  disposition: "cleanup_candidate" | "review_only" | "do_not_touch";
  dispositionReason?: string;
  scanTruncated?: boolean;
}

export interface AIActionSuggestion {
  id: string;
  kind: "quarantine_review" | "large_file_review" | "folder_review" | "duplicate_scan";
  title: string;
  summary: string;
  targetPath?: string;
  sourcePaths: string[];
  estimatedBytes: number;
  confidence: "low" | "medium" | "high";
  risk: RiskLevel;
  autoApplyScanRoot: boolean;
  evidence?: string[];
}

export interface AIExtensionStat {
  extension: string;
  count: number;
  sizeBytes: number;
}

export interface AIFilePatternSummary {
  scannedRoots: string[];
  scannedFileCount: number;
  scannedBytes: number;
  topFolders: StorageFolderUsage[];
  topFiles: StorageFileUsage[];
  topExtensions: AIExtensionStat[];
  appDataCandidates: AIAppDataCandidate[];
}

export interface AIAdvisorAnalysisRequest {
  roots: string[];
  maxFiles?: number;
  model?: string;
  provider?: AIProviderPreference;
  mode?: AIAnalysisMode;
}

export interface AIAdvisorAnalysisResponse {
  models: LocalModelInfo[];
  decision: LocalModelDecision;
  providers: AIProviderInventory;
  modelUsed?: string;
  providerUsed?: AIProvider;
  modelError?: string;
  summary: AIFilePatternSummary;
  actionPlan: AIActionSuggestion[];
  recommendationsMarkdown: string;
}

export interface SchedulerSettings {
  enabled: boolean;
  cadence: "weekly";
  dayOfWeek: number;
  time: string;
}

export interface SchedulerStatus extends SchedulerSettings {
  nextRunAt?: number;
}

export interface UpdateCheckResponse {
  currentVersion: string;
  latestVersion: string;
  url: string;
  hasUpdate: boolean;
}

export type BottleneckType = "cpu" | "ram" | "disk_io" | "gpu" | "drivers" | "mixed" | "unknown";

export interface CapabilityFlags {
  gpuSupported: boolean;
  perProcessGpuSupported: boolean;
  perProcessNetworkSupported: boolean;
  diagnosticsEventLogSupported: boolean;
  taskDelaySupported: boolean;
  serviceDelayedAutoStartSupported: boolean;
}

export interface IoBurstEvent {
  startedAt: number;
  durationMs: number;
  processName?: string;
  pid?: number;
  writeBytesPerSec: number;
  readBytesPerSec: number;
  suspectedPath?: string;
}

export interface ProcessSample {
  pid: number;
  processName: string;
  executablePath?: string;
  cpuPct?: number;
  workingSetBytes?: number;
  privateBytes?: number;
  diskReadBytesPerSec?: number;
  diskWriteBytesPerSec?: number;
  networkSendBytesPerSec?: number;
  networkReceiveBytesPerSec?: number;
  gpuPct?: number;
}

export interface StartupTimelinePhase {
  id: "bios" | "kernel" | "drivers" | "services" | "startup_apps" | "desktop_ready";
  label: string;
  durationMs: number;
  estimated: boolean;
}

export interface StartupEntry {
  id: string;
  optimizationTargetId: string;
  source: "registry_run" | "startup_folder" | "scheduled_task" | "service" | "shell_extension" | "boot_driver";
  name: string;
  command?: string;
  targetPath?: string;
  publisher?: string;
  originLocation?: string;
  originScope?: string;
  originDetails: string[];
  state: "enabled" | "disabled" | "delayed" | "unknown";
  impactScore: number;
  estimatedDelayMs: number;
  classification: "essential" | "high_impact" | "redundant" | "orphan" | "normal" | "inspect_only";
  reasoning: string[];
  reversible: boolean;
  actionSupport: Array<"disable" | "delay" | "open_location" | "restore">;
}

export interface StartupLocationOpenRequest {
  source: StartupEntry["source"];
  targetPath?: string;
  originLocation?: string;
}

export interface StartupAnalysisSummary {
  impactScore: number;
  estimatedBootDelayMs: number;
  highImpactCount: number;
  redundantCount: number;
  orphanCount: number;
  inspectOnlyCount: number;
  timeline: StartupTimelinePhase[];
}

export interface ServiceDiagnostic {
  id: string;
  serviceName: string;
  displayName: string;
  startMode: "auto" | "delayed" | "manual" | "disabled" | "unknown";
  state: "running" | "stopped" | "unknown";
  classification: "essential" | "optional" | "rarely_used" | "unused" | "orphan";
  publisher?: string;
  binaryPath?: string;
  recommendedAction: "leave" | "manual" | "disable" | "inspect";
  reason: string[];
}

export interface ServiceAnalysisSummary {
  total: number;
  essentialCount: number;
  optionalCount: number;
  rarelyUsedCount: number;
  unusedCount: number;
  orphanCount: number;
  suggestedActionCount: number;
}

export interface ScheduledTaskDiagnostic {
  id: string;
  taskPath: string;
  state: "enabled" | "disabled" | "unknown";
  classification: "safe" | "optional" | "suspicious" | "orphan" | "inspect_only";
  triggerSummary: string[];
  recommendedAction: "leave" | "delay" | "disable" | "inspect";
  reason: string[];
}

export interface TaskAnalysisSummary {
  total: number;
  frequentCount: number;
  optionalCount: number;
  suspiciousCount: number;
  orphanCount: number;
  inspectOnlyCount: number;
}

export interface DriverPerformanceIssue {
  name: string;
  reason: string[];
  confidence: number;
}

export interface DriverPerformanceSummary {
  latencyRisk: "low" | "medium" | "high";
  dpcPct?: number;
  interruptPct?: number;
  suspectedDrivers: DriverPerformanceIssue[];
  activeSignals: DriverStackFeatureSignalId[];
}

export interface DiskIoInsight {
  id: string;
  title: string;
  summary: string;
  severity: RiskLevel;
  processName?: string;
  path?: string;
  bytesPerSec?: number;
  linkedCategory?: CleanupCategory;
}

export interface MemoryInsight {
  id: string;
  title: string;
  summary: string;
  severity: RiskLevel;
  processName?: string;
  bytes?: number;
  confidence?: number;
}

export type OptimizationTargetKind = "startup_entry" | "service" | "scheduled_task";

export type OptimizationActionKind = "disable" | "delay" | "set_manual_start" | "restore";

export interface OptimizationActionSuggestion {
  id: string;
  targetKind: OptimizationTargetKind;
  targetId: string;
  action: OptimizationActionKind;
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  reversible: true;
  blocked: boolean;
  blockReason?: string;
  estimatedBenefitScore: number;
}

export interface OptimizationPreviewResponse {
  actions: OptimizationActionSuggestion[];
  blockedCount: number;
  reversibleCount: number;
  estimatedStartupSavingsMs: number;
  estimatedBackgroundCpuSavingsPct?: number;
  estimatedBackgroundRamSavingsBytes?: number;
  warnings: string[];
}

export interface OptimizationExecutionResult {
  appliedCount: number;
  failedCount: number;
  changeIds: string[];
  warnings: string[];
}

export interface OptimizationChangeRecord {
  id: string;
  targetKind: OptimizationTargetKind;
  targetId: string;
  action: OptimizationActionKind;
  originalStateJson: string;
  appliedStateJson: string;
  sourceEngine: "startup" | "services" | "tasks";
  createdAt: number;
  appliedAt?: number;
  revertedAt?: number;
}

export interface LivePerformanceFrame {
  sessionId: string;
  capturedAt: number;
  cpuUsagePct: number;
  ramUsedPct: number;
  diskActivePct: number;
  gpuUsagePct?: number;
  networkSendBytesPerSec?: number;
  networkReceiveBytesPerSec?: number;
  topProcesses: ProcessSample[];
}

export interface PerformanceSessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  sampleIntervalMs: number;
  frameCount: number;
  avgCpuUsagePct: number;
  avgRamUsagePct: number;
  avgDiskActivePct: number;
  peakCpuUsagePct: number;
  peakRamUsagePct: number;
  peakDiskActivePct: number;
  peakGpuUsagePct?: number;
}

export interface SystemSnapshot {
  id: string;
  createdAt: number;
  source: "manual" | "app_start" | "scheduled" | "pre_cleanup" | "post_cleanup" | "pre_optimization" | "post_optimization";
  machine: {
    cpuModel: string;
    logicalCores: number;
    totalRamBytes: number;
    gpuModels: string[];
    disks: { id: string; model?: string; totalBytes: number; freeBytes: number; type?: string }[];
  };
  capabilities: CapabilityFlags;
  cpu: { avgUsagePct: number; peakUsagePct: number; topProcesses: ProcessSample[] };
  memory: { usedBytes: number; usedPct: number; availableBytes: number; topProcesses: ProcessSample[] };
  diskIo: { activeTimePct: number; queueDepth?: number; topWriters: ProcessSample[]; burstEvents: IoBurstEvent[] };
  network: { totalSendBytesPerSec?: number; totalReceiveBytesPerSec?: number; topProcesses: ProcessSample[] };
  gpu: { totalUsagePct?: number; topProcesses: ProcessSample[] };
  startup: StartupAnalysisSummary;
  services: ServiceAnalysisSummary;
  tasks: TaskAnalysisSummary;
  drivers: DriverPerformanceSummary;
  bottleneck: { primary: BottleneckType; confidence: number; evidence: string[] };
}

export interface SystemSnapshotHistoryPoint {
  id: string;
  createdAt: number;
  source: SystemSnapshot["source"];
  primaryBottleneck: BottleneckType;
  cpuAvgPct?: number;
  ramUsedPct?: number;
  diskActivePct?: number;
  gpuPct?: number;
  startupImpactScore?: number;
}

export interface SystemDoctorDiagnosis {
  id: string;
  title: string;
  confidence: number;
  risk: "low" | "medium" | "high";
  summary: string;
  evidence: string[];
  suggestions: OptimizationActionSuggestion[];
}

export interface SystemDoctorReport {
  generatedAt: number;
  provider: "heuristic" | "cerebras";
  model?: "gpt-oss-120b";
  primaryBottleneck: BottleneckType;
  overallHealthScore: number;
  diagnoses: SystemDoctorDiagnosis[];
  safeWins: OptimizationActionSuggestion[];
}

export type TopLevelSection = "home" | "cleaner" | "optimize" | "vault";

export type IssueDomain = "cleanup" | "duplicates" | "performance" | "startup" | "drivers" | "safety";

export type IssueSeverity = "safe_win" | "review" | "high_impact" | "blocked";

export type HealthSubscoreKey = "storage" | "startup" | "background" | "safety";
export type HealthSubscoreStatus = "healthy" | "watch" | "action";
export type HealthTrendDirection = "up" | "down" | "flat" | "unknown";

export interface ProductIssueCard {
  id: string;
  domain: IssueDomain;
  title: string;
  summary: string;
  severity: IssueSeverity;
  bytesRecoverable?: number;
  estimatedSpeedBenefitScore?: number;
  confidence: number;
  reversible: boolean;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  evidence: string[];
  trustSummary?: string;
  blockedReasons?: string[];
  changeSummary?: string[];
  heuristicFallbackUsed?: boolean;
}

export interface HealthSubscore {
  key: HealthSubscoreKey;
  label: string;
  score: number;
  status: HealthSubscoreStatus;
  summary: string;
  evidence: string[];
}

export interface HealthTrendState {
  direction: HealthTrendDirection;
  delta: number;
  label: string;
  windowLabel: string;
}

export interface BeforeAfterSummary {
  kind: "smartcheck" | "cleanup" | "optimization";
  generatedAt: number;
  freedBytes: number;
  cleanupMovedCount: number;
  startupChangeCount: number;
  optimizationChangeCount: number;
  backgroundReductionPct?: number;
  trustSummary: string;
}

export interface HomeSummarySnapshot {
  generatedAt: number;
  healthScore: number;
  reclaimableBytes: number;
  primaryBottleneck: BottleneckType;
  safetyState: "protected" | "review_needed" | "attention_needed";
  trustSummary?: string;
  recommendedActionSummary?: string;
  subscores?: HealthSubscore[];
  trend?: HealthTrendState;
  latestReport?: BeforeAfterSummary;
  recommendedIssue: ProductIssueCard | null;
  topIssues: ProductIssueCard[];
}

export interface SmartCheckRun {
  id: string;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "canceled";
  mode?: "fast" | "balanced";
  summary: HomeSummarySnapshot;
  report?: BeforeAfterSummary;
  cleaner: {
    findingsCount: number;
    selectedCount: number;
    selectedBytes: number;
    groupedIssues: ProductIssueCard[];
  };
  optimize: {
    startupIssues: number;
    performanceIssues: number;
    driverIssues: number;
    groupedIssues: ProductIssueCard[];
  };
}

export interface SmartCheckPreviewResponse {
  cleanupPreview?: CleanupPreviewResponse;
  optimizationPreview?: OptimizationPreviewResponse;
  warnings: string[];
  selectedIssues?: ProductIssueCard[];
  trustSummary?: string;
}

export interface SmartCheckExecuteResponse {
  cleanup?: CleanupExecuteResponse;
  optimizations?: OptimizationExecutionResult;
  warnings: string[];
  selectedIssues?: ProductIssueCard[];
  report?: BeforeAfterSummary;
}

export interface CoverageCatalogEntry {
  id: string;
  label: string;
  covered: boolean;
}

export interface CoverageCatalogResponse {
  windowsAreas: CoverageCatalogEntry[];
  appFamilies: CoverageCatalogEntry[];
  totals: {
    windowsAreasCovered: number;
    appFamiliesCovered: number;
  };
}

export interface TrustExplanationResponse {
  summary: string;
  risk: RiskLevel;
  reasons: string[];
  blockedBy?: string[];
  changeSummary?: string[];
  heuristicFallbackUsed?: boolean;
}
