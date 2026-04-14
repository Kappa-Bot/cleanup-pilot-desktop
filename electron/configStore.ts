import Store from "electron-store";
import { AIProviderPreference, AppConfig, CleanupCategory, SettingsPayload } from "./types";

const ALL_DEFAULT_CATEGORIES: CleanupCategory[] = [
  "temp",
  "cache",
  "logs",
  "crash_dumps",
  "wsl_leftovers",
  "minecraft_leftovers",
  "ai_model_leftovers",
  "installer_artifacts"
];

const defaults: AppConfig = {
  defaultPreset: "standard",
  defaultCategories: ALL_DEFAULT_CATEGORIES,
  customRoots: [],
  neverCleanupPaths: [],
  neverCleanupApps: [],
  driverIgnoredInfNames: [],
  driverIgnoredDeviceIds: [],
  driverHiddenSuggestionIds: [],
  driverAutoSuppressSafeSuggestions: true,
  driverAutoSuppressionApplied: false,
  aiProvider: "auto",
  scheduleEnabled: false,
  scheduleDayOfWeek: 6,
  scheduleTime: "10:00",
  quarantineRetentionDays: 30,
  reducedMotion: false,
  highContrast: false,
  compactUi: false,
  includeInstalledApps: true,
  driverToolsEnabled: true,
  updatesFeedUrl: "",
  performanceSnapshotRetentionDays: 30,
  performanceAutoSnapshotOnLaunch: true,
  performanceAutoSnapshotOnCleanup: true,
  performanceAutoSnapshotOnOptimization: true,
  performanceLiveSampleIntervalMs: 2000,
  performancePinnedMonitoring: false
};

export class ConfigStore {
  private store: Store<AppConfig>;

  constructor() {
    this.store = new Store<AppConfig>({
      name: "cleanup-pilot-config",
      defaults,
      encryptionKey: "cleanup-pilot-config-v1"
    });
  }

  getAll(): AppConfig {
    return {
      defaultPreset: this.store.get("defaultPreset"),
      defaultCategories: this.store.get("defaultCategories"),
      customRoots: this.store.get("customRoots"),
      neverCleanupPaths: this.store.get("neverCleanupPaths"),
      neverCleanupApps: this.store.get("neverCleanupApps"),
      driverIgnoredInfNames: this.store.get("driverIgnoredInfNames"),
      driverIgnoredDeviceIds: this.store.get("driverIgnoredDeviceIds"),
      driverHiddenSuggestionIds: this.store.get("driverHiddenSuggestionIds"),
      driverAutoSuppressSafeSuggestions: this.store.get("driverAutoSuppressSafeSuggestions"),
      driverAutoSuppressionApplied: this.store.get("driverAutoSuppressionApplied"),
      aiProvider: this.store.get("aiProvider"),
      scheduleEnabled: this.store.get("scheduleEnabled"),
      scheduleDayOfWeek: this.store.get("scheduleDayOfWeek"),
      scheduleTime: this.store.get("scheduleTime"),
      quarantineRetentionDays: this.store.get("quarantineRetentionDays"),
      reducedMotion: this.store.get("reducedMotion"),
      highContrast: this.store.get("highContrast"),
      compactUi: this.store.get("compactUi"),
      includeInstalledApps: this.store.get("includeInstalledApps"),
      driverToolsEnabled: this.store.get("driverToolsEnabled"),
      updatesFeedUrl: this.store.get("updatesFeedUrl"),
      performanceSnapshotRetentionDays: this.store.get("performanceSnapshotRetentionDays"),
      performanceAutoSnapshotOnLaunch: this.store.get("performanceAutoSnapshotOnLaunch"),
      performanceAutoSnapshotOnCleanup: this.store.get("performanceAutoSnapshotOnCleanup"),
      performanceAutoSnapshotOnOptimization: this.store.get("performanceAutoSnapshotOnOptimization"),
      performanceLiveSampleIntervalMs: this.store.get("performanceLiveSampleIntervalMs"),
      performancePinnedMonitoring: this.store.get("performancePinnedMonitoring")
    };
  }

  update(payload: SettingsPayload): AppConfig {
    if (payload.defaultPreset !== undefined) {
      this.store.set("defaultPreset", payload.defaultPreset);
    }

    if (payload.defaultCategories !== undefined) {
      const nextCategories = payload.defaultCategories.filter((value, index, list) => {
        return ALL_DEFAULT_CATEGORIES.includes(value) && list.indexOf(value) === index;
      });
      this.store.set("defaultCategories", nextCategories.length ? nextCategories : ALL_DEFAULT_CATEGORIES);
    }

    if (payload.customRoots !== undefined) {
      const roots = payload.customRoots
        .map((item) => item.trim())
        .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
      this.store.set("customRoots", roots);
    }

    if (payload.neverCleanupPaths !== undefined) {
      const paths = payload.neverCleanupPaths
        .map((item: string) => item.trim())
        .filter((item: string, index: number, list: string[]) => item.length > 0 && list.indexOf(item) === index);
      this.store.set("neverCleanupPaths", paths);
    }

    if (payload.neverCleanupApps !== undefined) {
      const apps = payload.neverCleanupApps
        .map((item: string) => item.trim())
        .filter((item: string, index: number, list: string[]) => item.length > 0 && list.indexOf(item) === index);
      this.store.set("neverCleanupApps", apps);
    }

    if (payload.driverIgnoredInfNames !== undefined) {
      const infNames = payload.driverIgnoredInfNames
        .map((item: string) => item.trim())
        .filter((item: string, index: number, list: string[]) => item.length > 0 && list.indexOf(item) === index);
      this.store.set("driverIgnoredInfNames", infNames);
    }

    if (payload.driverIgnoredDeviceIds !== undefined) {
      const deviceIds = payload.driverIgnoredDeviceIds
        .map((item: string) => item.trim())
        .filter((item: string, index: number, list: string[]) => item.length > 0 && list.indexOf(item) === index);
      this.store.set("driverIgnoredDeviceIds", deviceIds);
    }

    if (payload.driverHiddenSuggestionIds !== undefined) {
      const suggestionIds = payload.driverHiddenSuggestionIds
        .map((item: string) => item.trim())
        .filter((item: string, index: number, list: string[]) => item.length > 0 && list.indexOf(item) === index);
      this.store.set("driverHiddenSuggestionIds", suggestionIds);
    }

    if (payload.driverAutoSuppressSafeSuggestions !== undefined) {
      this.store.set("driverAutoSuppressSafeSuggestions", payload.driverAutoSuppressSafeSuggestions);
    }

    if (payload.driverAutoSuppressionApplied !== undefined) {
      this.store.set("driverAutoSuppressionApplied", payload.driverAutoSuppressionApplied);
    }

    if (payload.aiProvider !== undefined) {
      const nextProvider: AIProviderPreference =
        payload.aiProvider === "local" || payload.aiProvider === "cerebras" ? payload.aiProvider : "auto";
      this.store.set("aiProvider", nextProvider);
    }

    if (payload.scheduleEnabled !== undefined) {
      this.store.set("scheduleEnabled", payload.scheduleEnabled);
    }

    if (payload.scheduleDayOfWeek !== undefined) {
      this.store.set("scheduleDayOfWeek", Math.max(0, Math.min(6, payload.scheduleDayOfWeek)));
    }

    if (payload.scheduleTime !== undefined) {
      this.store.set("scheduleTime", this.normalizeTime(payload.scheduleTime));
    }

    if (payload.quarantineRetentionDays !== undefined) {
      this.store.set(
        "quarantineRetentionDays",
        Math.max(1, Math.min(365, Math.floor(payload.quarantineRetentionDays)))
      );
    }

    if (payload.reducedMotion !== undefined) {
      this.store.set("reducedMotion", payload.reducedMotion);
    }

    if (payload.highContrast !== undefined) {
      this.store.set("highContrast", payload.highContrast);
    }

    if (payload.compactUi !== undefined) {
      this.store.set("compactUi", payload.compactUi);
    }

    if (payload.includeInstalledApps !== undefined) {
      this.store.set("includeInstalledApps", payload.includeInstalledApps);
    }

    if (payload.driverToolsEnabled !== undefined) {
      this.store.set("driverToolsEnabled", payload.driverToolsEnabled);
    }

    if (payload.updatesFeedUrl !== undefined) {
      this.store.set("updatesFeedUrl", payload.updatesFeedUrl.trim());
    }

    if (payload.performanceSnapshotRetentionDays !== undefined) {
      this.store.set(
        "performanceSnapshotRetentionDays",
        Math.max(1, Math.min(365, Math.floor(payload.performanceSnapshotRetentionDays)))
      );
    }

    if (payload.performanceAutoSnapshotOnLaunch !== undefined) {
      this.store.set("performanceAutoSnapshotOnLaunch", payload.performanceAutoSnapshotOnLaunch);
    }

    if (payload.performanceAutoSnapshotOnCleanup !== undefined) {
      this.store.set("performanceAutoSnapshotOnCleanup", payload.performanceAutoSnapshotOnCleanup);
    }

    if (payload.performanceAutoSnapshotOnOptimization !== undefined) {
      this.store.set("performanceAutoSnapshotOnOptimization", payload.performanceAutoSnapshotOnOptimization);
    }

    if (payload.performanceLiveSampleIntervalMs !== undefined) {
      this.store.set(
        "performanceLiveSampleIntervalMs",
        Math.max(500, Math.min(60_000, Math.floor(payload.performanceLiveSampleIntervalMs)))
      );
    }

    if (payload.performancePinnedMonitoring !== undefined) {
      this.store.set("performancePinnedMonitoring", payload.performancePinnedMonitoring);
    }

    return this.getAll();
  }

  private normalizeTime(value: string): string {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return defaults.scheduleTime;
    }

    const hour = Math.max(0, Math.min(23, Number(match[1])));
    const minute = Math.max(0, Math.min(59, Number(match[2])));
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
}
