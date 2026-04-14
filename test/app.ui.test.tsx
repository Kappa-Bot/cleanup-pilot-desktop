import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../src/App";

function buildSettings(overrides: Record<string, unknown> = {}) {
  return {
    defaultPreset: "standard",
    defaultCategories: ["temp", "cache", "logs"],
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
    driverToolsEnabled: false,
    updatesFeedUrl: "",
    performanceSnapshotRetentionDays: 30,
    performanceAutoSnapshotOnLaunch: true,
    performanceAutoSnapshotOnCleanup: true,
    performanceAutoSnapshotOnOptimization: true,
    performanceLiveSampleIntervalMs: 2000,
    performancePinnedMonitoring: false,
    ...overrides
  };
}

function buildScanResults(
  findings: Array<Record<string, unknown>> = [],
  overrides: Record<string, unknown> = {}
) {
  return {
    status: "completed",
    findings,
    rejected: [],
    summary: {
      runId: "run-1",
      status: "completed",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      processedItems: findings.length,
      findingsCount: findings.length,
      totalCandidateBytes: findings.reduce((sum, item) => sum + Number(item.sizeBytes ?? 0), 0),
      protectedRejectedCount: 0,
      categories: {
        temp: { count: 0, bytes: 0 },
        cache: { count: 0, bytes: 0 },
        logs: { count: 0, bytes: 0 },
        crash_dumps: { count: 0, bytes: 0 },
        wsl_leftovers: { count: 0, bytes: 0 },
        minecraft_leftovers: { count: 0, bytes: 0 },
        ai_model_leftovers: { count: 0, bytes: 0 },
        installer_artifacts: { count: 0, bytes: 0 },
        duplicates: { count: 0, bytes: 0 }
      }
    },
    ...overrides
  };
}

const desktopApiMock = {
  getSettings: jest.fn(async () => buildSettings()),
  updateSettings: jest.fn(async (payload) => buildSettings(payload)),
  getHomeSnapshot: jest.fn(async () => ({
    snapshot: {
      generatedAt: Date.now(),
      healthScore: 84,
      reclaimableBytes: 0,
      primaryBottleneck: "unknown",
      safetyState: "protected",
      recommendedIssue: null,
      topIssues: []
    }
  })),
  runSmartCheck: jest.fn(async () => ({ runId: "smart-1" })),
  getSmartCheckCurrent: jest.fn(async () => ({
    run: {
      id: "smart-1",
      startedAt: Date.now(),
      completedAt: Date.now(),
      status: "completed",
      summary: {
        generatedAt: Date.now(),
        healthScore: 82,
        reclaimableBytes: 0,
        primaryBottleneck: "unknown",
        safetyState: "protected",
        recommendedIssue: null,
        topIssues: []
      },
      cleaner: { findingsCount: 0, selectedCount: 0, selectedBytes: 0, groupedIssues: [] },
      optimize: { startupIssues: 0, performanceIssues: 0, driverIssues: 0, groupedIssues: [] }
    }
  })),
  previewSmartCheck: jest.fn(async () => ({ warnings: [] })),
  executeSmartCheck: jest.fn(async () => ({ warnings: [] })),
  getCoverageCatalog: jest.fn(async () => ({
    windowsAreas: [],
    appFamilies: [],
    totals: { windowsAreasCovered: 0, appFamiliesCovered: 0 }
  })),
  explainFindingTrust: jest.fn(async () => ({ summary: "", risk: "low", reasons: [] })),
  startScan: jest.fn(async () => ({ runId: "run-1" })),
  cancelScan: jest.fn(async () => ({ ok: true })),
  getScanResults: jest.fn(async () => buildScanResults()),
  onScanProgress: jest.fn(() => () => undefined),
  onCleanupProgress: jest.fn(() => () => undefined),
  onQuarantinePurgeProgress: jest.fn(() => () => undefined),
  previewCleanup: jest.fn(async () => ({ totalBytes: 0, actionCount: 0, riskFlags: { highRiskCount: 0, mediumRiskCount: 0, blockedCount: 0 } })),
  executeCleanup: jest.fn(async () => ({ movedCount: 0, failedCount: 0, freedBytes: 0, errors: [], movedIds: [], failedIds: [] })),
  listQuarantine: jest.fn(async () => ({ items: [], totalCount: 0, activeCount: 0, hasMore: false, nextOffset: 0 })),
  restoreQuarantine: jest.fn(async () => ({ restoredCount: 0, failed: [] })),
  purgeQuarantine: jest.fn(async () => ({ purgedCount: 0, freedBytes: 0, purgedGroups: 0, storageHint: "unknown", concurrency: 0, durationMs: 0, canceled: false })),
  cancelQuarantinePurge: jest.fn(async () => ({ ok: true })),
  scanDuplicates: jest.fn(async () => ({ groups: [] })),
  previewDuplicateResolution: jest.fn(async () => ({ toKeep: 0, toQuarantine: 0, bytesRecoverable: 0 })),
  executeDuplicateResolution: jest.fn(async () => ({ movedCount: 0, failedCount: 0, freedBytes: 0, errors: [], movedIds: [], failedIds: [] })),
  scanStorage: jest.fn(async () => ({ topFolders: [], largestFiles: [], apps: [] })),
  scanDrivers: jest.fn(async () => ({
    source: "windows_update+oem_hints",
    devices: [],
    updateCandidates: [],
    meaningfulDeviceCount: 0,
    ignoredDeviceCount: 0,
    suppressedCount: 0,
    stackSuppressedCount: 0,
    suppressionSuggestions: []
  })),
  openDriverOfficial: jest.fn(async () => ({ opened: true })),
  openWindowsUpdate: jest.fn(async () => ({ opened: true })),
  listAiModels: jest.fn(async () => ({
    models: [],
    decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
    providers: { localCount: 0, cerebrasCount: 0, cerebrasConfigured: false }
  })),
  analyzeWithAi: jest.fn(async () => ({
    models: [],
    decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
    providers: { localCount: 0, cerebrasCount: 0, cerebrasConfigured: false },
    actionPlan: [],
    summary: {
      scannedRoots: [],
      scannedFileCount: 0,
      scannedBytes: 0,
      topFolders: [],
      topFiles: [],
      topExtensions: [],
      appDataCandidates: []
    },
    recommendationsMarkdown: ""
  })),
  setScheduler: jest.fn(async () => ({ ok: true, scheduler: { enabled: false, cadence: "weekly", dayOfWeek: 6, time: "10:00" } })),
  getScheduler: jest.fn(async () => ({ enabled: false, cadence: "weekly", dayOfWeek: 6, time: "10:00" })),
  checkUpdates: jest.fn(async () => ({ currentVersion: "0.1.0", latestVersion: "0.1.0", url: "", hasUpdate: false }))
};

describe("App", () => {
  beforeEach(() => {
    (window as any).desktopApi = desktopApiMock;
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders scan wizard controls", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));

    await waitFor(() => {
      expect(screen.getByText("Scan Wizard")).toBeTruthy();
      expect(screen.getByText("Start Scan")).toBeTruthy();
    });
  });

  it("starts a scan from the scan tab", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    expect(desktopApiMock.startScan).toHaveBeenCalled();
  });

  it("uses detected machine roots for AI analysis", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(buildSettings({ customRoots: ["C:\\\\", "D:\\\\"] }));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await waitFor(() => {
      expect(desktopApiMock.analyzeWithAi).toHaveBeenCalledWith(
        expect.objectContaining({
          roots: ["C:\\\\", "D:\\\\"]
        })
      );
    });
  });

  it("uses detected machine roots for duplicate scans", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(buildSettings({ customRoots: ["C:\\\\", "D:\\\\"] }));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Duplicates"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run Whole-Machine Pass"));
    });

    await waitFor(() => {
      expect(desktopApiMock.scanDuplicates).toHaveBeenCalledWith(["C:\\\\", "D:\\\\"], 1024 * 1024);
    });
  });

  it("previews cleanup after loading scan findings", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-1",
          path: "C:\\Users\\me\\AppData\\Local\\Temp\\cache.tmp",
          category: "temp",
          sizeBytes: 1024,
          risk: "low",
          reason: "Temporary file path",
          sourceRuleId: "temp-path",
          selectedByDefault: true,
          modifiedAt: Date.now()
        }
      ]));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Cleanup Plan"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    expect(desktopApiMock.previewCleanup).toHaveBeenCalledWith("run-1", ["finding-1"]);
  });

  it("falls back to low-risk selection when no defaults are preselected", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-2",
          path: "C:\\Users\\me\\AppData\\Local\\Temp\\manual.tmp",
          category: "temp",
          sizeBytes: 2048,
          risk: "low",
          reason: "Temporary file path",
          sourceRuleId: "temp-path",
          selectedByDefault: false,
          modifiedAt: Date.now()
        }
      ]));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Cleanup Plan"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    expect(desktopApiMock.previewCleanup).toHaveBeenCalledWith("run-1", ["finding-2"]);
  });

  it("does not auto-select findings under Downloads", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-downloads",
          path: "C:\\Users\\me\\Downloads\\installer.msi",
          category: "installer_artifacts",
          sizeBytes: 50_000_000,
          risk: "low",
          reason: "Installer package residue",
          sourceRuleId: "installer-artifacts",
          selectedByDefault: false,
          modifiedAt: Date.now()
        },
        {
          id: "finding-temp",
          path: "C:\\Users\\me\\AppData\\Local\\Temp\\leftover.tmp",
          category: "temp",
          sizeBytes: 4096,
          risk: "low",
          reason: "Temporary file path",
          sourceRuleId: "temp-path",
          selectedByDefault: false,
          modifiedAt: Date.now()
        }
      ]));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Cleanup Plan"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    expect(desktopApiMock.previewCleanup).toHaveBeenCalledWith("run-1", ["finding-temp"]);
  });

  it("renders enriched driver scan details with filtered noise counts", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({ driverToolsEnabled: true, driverAutoSuppressionApplied: true })
    );
    desktopApiMock.scanDrivers.mockResolvedValueOnce({
      source: "windows_update+oem_hints",
      meaningfulDeviceCount: 5,
      ignoredDeviceCount: 11,
      suppressedCount: 2,
      stackSuppressedCount: 0,
      suppressionSuggestions: [],
      devices: [
        {
          id: "gpu-1",
          deviceName: "NVIDIA GeForce RTX 4080",
          provider: "Microsoft",
          manufacturer: "NVIDIA",
          driverVersion: "31.0.15.0000",
          driverDate: "2023-01-01",
          infName: "oem42.inf",
          deviceClass: "DISPLAY",
          deviceId: "PCI\\VEN_10DE&DEV_2704"
        }
      ],
      updateCandidates: [
        {
          id: "gpu-1",
          deviceName: "NVIDIA GeForce RTX 4080",
          currentDriverVersion: "31.0.15.0000",
          provider: "Microsoft",
          manufacturer: "NVIDIA",
          driverDate: "2023-01-01",
          daysOld: 900,
          deviceClass: "DISPLAY",
          infName: "oem42.inf",
          reason: "Generic Microsoft driver is older than ~3 years (900 days).",
          severity: "medium",
          recommendation: "oem_portal",
          officialUrl: "https://www.nvidia.com/Download/index.aspx"
        }
      ]
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    await waitFor(() => expect(screen.getByText("5 reviewed after filtering inbox noise")).toBeTruthy());
    expect(screen.getByText("11 virtual, inbox, or low-value entries ignored")).toBeTruthy();
    expect(screen.getByText("2 hidden by your local driver suppression rules")).toBeTruthy();
    expect(screen.getByText("Graphics (1)")).toBeTruthy();
    expect(screen.getByText("oem42.inf")).toBeTruthy();
  });

  it("auto-applies safe driver suppression suggestions on the first scan for this machine", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: true,
        driverAutoSuppressionApplied: false
      })
    );
    desktopApiMock.updateSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: true,
        driverAutoSuppressionApplied: true,
        driverIgnoredInfNames: [],
        driverIgnoredDeviceIds: ["ROOT\\SYSTEM\\0002", "PCI\\VEN_8086&DEV_06F9"]
      })
    );
    desktopApiMock.scanDrivers
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 3,
        ignoredDeviceCount: 12,
        suppressedCount: 0,
        stackSuppressedCount: 0,
        suppressionSuggestions: [
          {
            id: "system-infrastructure",
            title: "Hide chipset and motherboard infrastructure hints",
            description: "Noisy SYSTEM/PCI/ACPI infrastructure devices.",
            group: "infrastructure",
            autoEligible: true,
            confidence: "high",
            activityState: "active",
            activitySummary: "Core platform devices are always present.",
            activitySignals: [],
            activitySignalEvidence: [],
            recommendedToHide: true,
            matchCount: 2,
            infNames: [],
            deviceIds: ["ROOT\\SYSTEM\\0002", "PCI\\VEN_8086&DEV_06F9"],
            exampleDevices: ["AMD Special Tools Driver", "Intel(R) Thermal Subsystem - 06F9"]
          }
        ],
        devices: [],
        updateCandidates: [
          {
            id: "amd-tools",
            deviceName: "AMD Special Tools Driver",
            currentDriverVersion: "1.7.16.218",
            provider: "AMD",
            manufacturer: "AMD",
            driverDate: "2020-05-27",
            daysOld: 1200,
            deviceClass: "SYSTEM",
            infName: "oem22.inf",
            deviceId: "ROOT\\SYSTEM\\0002",
            reason: "Driver appears very old (1200 days).",
            severity: "high",
            recommendation: "oem_portal",
            officialUrl: "https://www.amd.com/en/support/download/drivers.html"
          }
        ]
      } as any)
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 3,
        ignoredDeviceCount: 12,
        suppressedCount: 2,
        stackSuppressedCount: 0,
        suppressionSuggestions: [],
        devices: [],
        updateCandidates: []
      } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    await waitFor(() =>
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith({
        driverIgnoredInfNames: [],
        driverIgnoredDeviceIds: ["ROOT\\SYSTEM\\0002", "PCI\\VEN_8086&DEV_06F9"],
        driverAutoSuppressionApplied: true
      })
    );
    expect(desktopApiMock.scanDrivers).toHaveBeenCalledTimes(2);
    expect(screen.getByText("2 hidden by your local driver suppression rules")).toBeTruthy();
  });

  it("suppresses a driver INF from the drivers table and refreshes results", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({ driverToolsEnabled: true, driverAutoSuppressionApplied: true })
    );
    desktopApiMock.updateSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressionApplied: true,
        driverIgnoredInfNames: ["oem42.inf"]
      })
    );
    desktopApiMock.scanDrivers
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 1,
        ignoredDeviceCount: 0,
        suppressedCount: 0,
        stackSuppressedCount: 0,
        suppressionSuggestions: [],
        devices: [
          {
            id: "gpu-1",
            deviceName: "NVIDIA GeForce RTX 4080",
            provider: "Microsoft",
            manufacturer: "NVIDIA",
            driverVersion: "31.0.15.0000",
            driverDate: "2023-01-01",
            infName: "oem42.inf",
            deviceClass: "DISPLAY",
            deviceId: "PCI\\VEN_10DE&DEV_2704"
          }
        ],
        updateCandidates: [
          {
            id: "gpu-1",
            deviceName: "NVIDIA GeForce RTX 4080",
            currentDriverVersion: "31.0.15.0000",
            provider: "Microsoft",
            manufacturer: "NVIDIA",
            driverDate: "2023-01-01",
            daysOld: 900,
            deviceClass: "DISPLAY",
            infName: "oem42.inf",
            deviceId: "PCI\\VEN_10DE&DEV_2704",
            reason: "Generic Microsoft driver is older than ~3 years (900 days).",
            severity: "medium",
            recommendation: "oem_portal",
            officialUrl: "https://www.nvidia.com/Download/index.aspx"
          }
        ]
      } as any)
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 1,
        ignoredDeviceCount: 0,
        suppressedCount: 1,
        stackSuppressedCount: 0,
        suppressionSuggestions: [],
        devices: [],
        updateCandidates: []
      } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Suppress INF"));
    });

    await waitFor(() =>
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith({
        driverIgnoredInfNames: ["oem42.inf"],
        driverIgnoredDeviceIds: [],
        driverHiddenSuggestionIds: []
      })
    );
    expect(desktopApiMock.scanDrivers).toHaveBeenCalledTimes(2);
  });

  it("applies safe local driver suppression suggestions from the drivers view", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: false
      })
    );
    desktopApiMock.updateSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: false,
        driverIgnoredInfNames: [],
        driverIgnoredDeviceIds: ["ROOT\\SYSTEM\\0002", "PCI\\VEN_8086&DEV_06F9"]
      })
    );
    desktopApiMock.scanDrivers
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 3,
        ignoredDeviceCount: 2,
        suppressedCount: 0,
        stackSuppressedCount: 0,
        suppressionSuggestions: [
          {
            id: "system-infrastructure",
            title: "Hide chipset and motherboard infrastructure hints",
            description: "Noisy SYSTEM/PCI/ACPI infrastructure devices.",
            group: "infrastructure",
            autoEligible: true,
            confidence: "high",
            activityState: "active",
            activitySummary: "Core platform devices are always present.",
            activitySignals: [],
            activitySignalEvidence: [],
            recommendedToHide: true,
            matchCount: 2,
            infNames: [],
            deviceIds: ["ROOT\\SYSTEM\\0002", "PCI\\VEN_8086&DEV_06F9"],
            exampleDevices: ["AMD Special Tools Driver", "Intel(R) Thermal Subsystem - 06F9"]
          }
        ],
        devices: [],
        updateCandidates: [
          {
            id: "amd-tools",
            deviceName: "AMD Special Tools Driver",
            currentDriverVersion: "1.7.16.218",
            provider: "AMD",
            manufacturer: "AMD",
            driverDate: "2020-05-27",
            daysOld: 1200,
            deviceClass: "SYSTEM",
            infName: "oem22.inf",
            deviceId: "ROOT\\SYSTEM\\0002",
            reason: "OEM driver is older than ~2 years (1200 days).",
            severity: "medium",
            recommendation: "oem_portal",
            officialUrl: "https://www.amd.com/en/support/download/drivers.html"
          }
        ]
      } as any)
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 3,
        ignoredDeviceCount: 2,
        suppressedCount: 2,
        stackSuppressedCount: 0,
        suppressionSuggestions: [],
        devices: [],
        updateCandidates: []
      } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    expect(screen.getByText("Local Suppression Suggestions")).toBeTruthy();
    expect(screen.getByText("Apply Safe Suggestions")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Apply Safe Suggestions"));
    });

    await waitFor(() =>
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith({
        driverIgnoredInfNames: [],
        driverIgnoredDeviceIds: ["ROOT\\SYSTEM\\0002", "PCI\\VEN_8086&DEV_06F9"],
        driverHiddenSuggestionIds: []
      })
    );
    expect(desktopApiMock.scanDrivers).toHaveBeenCalledTimes(2);
  });

  it("applies virtualization suppression suggestions separately from safe infrastructure ones", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.updateSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true,
        driverIgnoredInfNames: ["oem23.inf"],
        driverIgnoredDeviceIds: ["ROOT\\CAMERA\\0000"]
      })
    );
    desktopApiMock.scanDrivers
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 4,
        ignoredDeviceCount: 2,
        suppressedCount: 0,
        stackSuppressedCount: 0,
        suppressionSuggestions: [
          {
            id: "virtualization-vmware",
            title: "Hide VMware virtual network and host hints",
            description: "VMware virtual devices.",
            group: "virtualization",
            autoEligible: false,
            confidence: "medium",
            activityState: "inactive",
            activitySummary: "No installed-app, service, or running-process signal was detected for this stack.",
            activitySignals: [],
            activitySignalEvidence: [],
            recommendedToHide: true,
            matchCount: 2,
            infNames: ["oem23.inf"],
            deviceIds: ["ROOT\\VMWVMCIHOSTDEV\\0000"],
            exampleDevices: ["VMware Virtual Ethernet Adapter for VMnet8", "VMware VMCI Host Device"]
          },
          {
            id: "virtualization-camo",
            title: "Hide Camo virtual camera hints",
            description: "Camo virtual camera drivers.",
            group: "virtualization",
            autoEligible: false,
            confidence: "medium",
            activityState: "inactive",
            activitySummary: "No installed-app, service, or running-process signal was detected for this stack.",
            activitySignals: [],
            activitySignalEvidence: [],
            recommendedToHide: true,
            matchCount: 1,
            infNames: [],
            deviceIds: ["ROOT\\CAMERA\\0000"],
            exampleDevices: ["Camo"]
          }
        ],
        devices: [],
        updateCandidates: [
          {
            id: "vmware-net",
            deviceName: "VMware Virtual Ethernet Adapter for VMnet8",
            currentDriverVersion: "14.0.0.5",
            provider: "VMware, Inc.",
            manufacturer: "VMware, Inc.",
            driverDate: "2021-03-09",
            daysOld: 1600,
            deviceClass: "NET",
            infName: "oem23.inf",
            deviceId: "ROOT\\VMWARE\\0001",
            reason: "OEM driver is older than ~2 years (1600 days).",
            severity: "medium",
            recommendation: "oem_portal",
            officialUrl: "https://www.vmware.com"
          }
        ]
      } as any)
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 4,
        ignoredDeviceCount: 2,
        suppressedCount: 3,
        stackSuppressedCount: 0,
        suppressionSuggestions: [],
        devices: [],
        updateCandidates: []
      } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    expect(screen.getByText("Apply Inactive Virtual Suggestions")).toBeTruthy();
    expect(screen.getAllByText("Virtual stack").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByText("Apply Inactive Virtual Suggestions"));
    });

    await waitFor(() =>
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith({
        driverIgnoredInfNames: ["oem23.inf"],
        driverIgnoredDeviceIds: expect.arrayContaining(["ROOT\\CAMERA\\0000", "ROOT\\VMWVMCIHOSTDEV\\0000"]),
        driverHiddenSuggestionIds: []
      })
    );
    expect(desktopApiMock.scanDrivers).toHaveBeenCalledTimes(2);
  });

  it("hides a driver stack forever from the suggestions panel", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.updateSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true,
        driverHiddenSuggestionIds: ["virtualization-vmware"]
      })
    );
    desktopApiMock.scanDrivers
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 2,
        ignoredDeviceCount: 1,
        suppressedCount: 0,
        stackSuppressedCount: 0,
        suppressionSuggestions: [
          {
            id: "virtualization-vmware",
            title: "Hide VMware virtual network and host hints",
            description: "VMware virtual devices.",
            group: "virtualization",
            autoEligible: false,
            confidence: "medium",
            activityState: "installed",
            activitySummary: "service: VMware NAT Service",
            activitySignals: [],
            activitySignalEvidence: [],
            recommendedToHide: false,
            matchCount: 2,
            infNames: ["oem23.inf"],
            deviceIds: ["ROOT\\VMWVMCIHOSTDEV\\0000"],
            exampleDevices: ["VMware Virtual Ethernet Adapter for VMnet8", "VMware VMCI Host Device"]
          }
        ],
        devices: [],
        updateCandidates: []
      } as any)
      .mockResolvedValueOnce({
        source: "windows_update+oem_hints",
        meaningfulDeviceCount: 2,
        ignoredDeviceCount: 1,
        suppressedCount: 0,
        stackSuppressedCount: 2,
        suppressionSuggestions: [],
        devices: [],
        updateCandidates: []
      } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    await waitFor(() => expect(screen.getByText("Hide Stack Forever")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("Hide Stack Forever"));
    });

    await waitFor(() =>
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith({
        driverIgnoredInfNames: [],
        driverIgnoredDeviceIds: [],
        driverHiddenSuggestionIds: ["virtualization-vmware"]
      })
    );
    expect(desktopApiMock.scanDrivers).toHaveBeenCalledTimes(2);
  });

  it("renders Hyper-V platform signals as visible chips in driver suggestions", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.scanDrivers.mockResolvedValueOnce({
      source: "windows_update+oem_hints",
      meaningfulDeviceCount: 3,
      ignoredDeviceCount: 1,
      suppressedCount: 0,
      stackSuppressedCount: 0,
      suppressionSuggestions: [
        {
          id: "virtualization-hyperv",
          title: "Hide Hyper-V virtual machine bus hints",
          description: "Hyper-V virtual infrastructure devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "installed",
          activitySummary: "feature: registry: Windows virtualization platform | registry: 2 WSL distros",
          activitySignals: ["hyperv", "virtual_machine_platform", "wsl"],
          activitySignalEvidence: [
            { id: "hyperv", evidence: "registry: Windows virtualization platform" },
            { id: "virtual_machine_platform", evidence: "registry: virtualization platform components" },
            { id: "wsl", evidence: "registry: 2 WSL distros" }
          ],
          recommendedToHide: false,
          matchCount: 3,
          infNames: [],
          deviceIds: ["ROOT\\VMBUS\\0000"],
          exampleDevices: ["Microsoft Hyper-V Virtual Machine Bus Provider"]
        }
      ],
      devices: [],
      updateCandidates: []
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    expect(screen.getAllByText("Hyper-V").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VMP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WSL").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByText("Signal evidence"));
    });

    expect(screen.getByText("registry: Windows virtualization platform")).toBeTruthy();
    expect(screen.getByText("registry: virtualization platform components")).toBeTruthy();
    expect(screen.getByText("registry: 2 WSL distros")).toBeTruthy();
  });

  it("filters driver suppression suggestions by clicked signal chip", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.scanDrivers.mockResolvedValueOnce({
      source: "windows_update+oem_hints",
      meaningfulDeviceCount: 4,
      ignoredDeviceCount: 1,
      suppressedCount: 0,
      stackSuppressedCount: 0,
      suppressionSuggestions: [
        {
          id: "virtualization-hyperv",
          title: "Hide Hyper-V virtual machine bus hints",
          description: "Hyper-V virtual infrastructure devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "installed",
          activitySummary: "feature: registry: Windows virtualization platform | registry: 1 WSL distro",
          activitySignals: ["hyperv", "wsl"],
          activitySignalEvidence: [
            { id: "hyperv", evidence: "registry: Windows virtualization platform" },
            { id: "wsl", evidence: "registry: 1 WSL distro" }
          ],
          recommendedToHide: false,
          matchCount: 2,
          infNames: [],
          deviceIds: ["ROOT\\VMBUS\\0000"],
          exampleDevices: ["Microsoft Hyper-V Virtual Machine Bus Provider"]
        },
        {
          id: "virtualization-vmware",
          title: "Hide VMware virtual network and host hints",
          description: "VMware virtual devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "active",
          activitySummary: "service: VMware NAT Service",
          activitySignals: [],
          activitySignalEvidence: [],
          recommendedToHide: false,
          matchCount: 2,
          infNames: ["oem23.inf"],
          deviceIds: ["ROOT\\VMWVMCIHOSTDEV\\0000"],
          exampleDevices: ["VMware Virtual Ethernet Adapter for VMnet8"]
        }
      ],
      devices: [],
      updateCandidates: []
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    expect(screen.getByText("Hide Hyper-V virtual machine bus hints")).toBeTruthy();
    expect(screen.getByText("Hide VMware virtual network and host hints")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "WSL" }));
    });

    expect(screen.getByText("Hide Hyper-V virtual machine bus hints")).toBeTruthy();
    expect(screen.queryByText("Hide VMware virtual network and host hints")).toBeNull();
    expect(screen.getByText(/Filtering suggestions by/i)).toBeTruthy();
  });

  it("restores the persisted driver signal filter from local storage", async () => {
    window.localStorage.setItem("cleanup-pilot.driverSignalFilter.v1", "wsl");
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.scanDrivers.mockResolvedValueOnce({
      source: "windows_update+oem_hints",
      meaningfulDeviceCount: 4,
      ignoredDeviceCount: 1,
      suppressedCount: 0,
      stackSuppressedCount: 0,
      suppressionSuggestions: [
        {
          id: "virtualization-hyperv",
          title: "Hide Hyper-V virtual machine bus hints",
          description: "Hyper-V virtual infrastructure devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "installed",
          activitySummary: "feature: registry: Windows virtualization platform | registry: 1 WSL distro",
          activitySignals: ["hyperv", "wsl"],
          activitySignalEvidence: [
            { id: "hyperv", evidence: "registry: Windows virtualization platform" },
            { id: "wsl", evidence: "registry: 1 WSL distro" }
          ],
          recommendedToHide: false,
          matchCount: 2,
          infNames: [],
          deviceIds: ["ROOT\\VMBUS\\0000"],
          exampleDevices: ["Microsoft Hyper-V Virtual Machine Bus Provider"]
        },
        {
          id: "virtualization-vmware",
          title: "Hide VMware virtual network and host hints",
          description: "VMware virtual devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "active",
          activitySummary: "service: VMware NAT Service",
          activitySignals: [],
          activitySignalEvidence: [],
          recommendedToHide: false,
          matchCount: 2,
          infNames: ["oem23.inf"],
          deviceIds: ["ROOT\\VMWVMCIHOSTDEV\\0000"],
          exampleDevices: ["VMware Virtual Ethernet Adapter for VMnet8"]
        }
      ],
      devices: [],
      updateCandidates: []
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    expect(screen.getByText("Hide Hyper-V virtual machine bus hints")).toBeTruthy();
    expect(screen.queryByText("Hide VMware virtual network and host hints")).toBeNull();
    expect(screen.getByText(/Filtering suggestions by/i)).toBeTruthy();
  });

  it("persists open signal evidence panels across sessions", async () => {
    desktopApiMock.getSettings.mockResolvedValue(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.scanDrivers.mockResolvedValue({
      source: "windows_update+oem_hints",
      meaningfulDeviceCount: 3,
      ignoredDeviceCount: 1,
      suppressedCount: 0,
      stackSuppressedCount: 0,
      suppressionSuggestions: [
        {
          id: "virtualization-hyperv",
          title: "Hide Hyper-V virtual machine bus hints",
          description: "Hyper-V virtual infrastructure devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "installed",
          activitySummary: "feature: registry: Windows virtualization platform",
          activitySignals: ["hyperv"],
          activitySignalEvidence: [
            { id: "hyperv", evidence: "registry: Windows virtualization platform" }
          ],
          recommendedToHide: false,
          matchCount: 2,
          infNames: [],
          deviceIds: ["ROOT\\VMBUS\\0000"],
          exampleDevices: ["Microsoft Hyper-V Virtual Machine Bus Provider"]
        }
      ],
      devices: [],
      updateCandidates: []
    } as any);

    const firstRender = render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    const firstDetails = screen.getByText("Signal evidence").closest("details");
    expect(firstDetails).toBeTruthy();
    expect(firstDetails?.hasAttribute("open")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByText("Signal evidence"));
    });

    expect(firstDetails?.hasAttribute("open")).toBe(true);
    expect(window.localStorage.getItem("cleanup-pilot.driverSignalEvidenceOpen.v1")).toContain("virtualization-hyperv");

    firstRender.unmount();

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    const secondDetails = screen.getByText("Signal evidence").closest("details");
    expect(secondDetails?.hasAttribute("open")).toBe(true);
  });

  it("expands and collapses all visible signal evidence panels", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverAutoSuppressSafeSuggestions: false,
        driverAutoSuppressionApplied: true
      })
    );
    desktopApiMock.scanDrivers.mockResolvedValueOnce({
      source: "windows_update+oem_hints",
      meaningfulDeviceCount: 4,
      ignoredDeviceCount: 1,
      suppressedCount: 0,
      stackSuppressedCount: 0,
      suppressionSuggestions: [
        {
          id: "virtualization-hyperv",
          title: "Hide Hyper-V virtual machine bus hints",
          description: "Hyper-V virtual infrastructure devices.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "installed",
          activitySummary: "feature: registry: Windows virtualization platform",
          activitySignals: ["hyperv"],
          activitySignalEvidence: [
            { id: "hyperv", evidence: "registry: Windows virtualization platform" }
          ],
          recommendedToHide: false,
          matchCount: 2,
          infNames: [],
          deviceIds: ["ROOT\\VMBUS\\0000"],
          exampleDevices: ["Microsoft Hyper-V Virtual Machine Bus Provider"]
        },
        {
          id: "virtualization-camo",
          title: "Hide Camo virtual camera hints",
          description: "Camo virtual camera drivers.",
          group: "virtualization",
          autoEligible: false,
          confidence: "medium",
          activityState: "installed",
          activitySummary: "service: CamoService",
          activitySignals: ["containers"],
          activitySignalEvidence: [
            { id: "containers", evidence: "service: CamoService" }
          ],
          recommendedToHide: false,
          matchCount: 1,
          infNames: [],
          deviceIds: ["ROOT\\CAMERA\\0000"],
          exampleDevices: ["Camo"]
        }
      ],
      devices: [],
      updateCandidates: []
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Drivers"));
    await act(async () => {
      fireEvent.click(screen.getByText("Scan Drivers"));
    });

    const detailsBefore = screen.getAllByText("Signal evidence").map((node) => node.closest("details"));
    expect(detailsBefore.every((item) => item?.hasAttribute("open") === false)).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Expand All Evidence"));
    });

    const detailsExpanded = screen.getAllByText("Signal evidence").map((node) => node.closest("details"));
    expect(detailsExpanded.every((item) => item?.hasAttribute("open") === true)).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Collapse All Evidence"));
    });

    const detailsCollapsed = screen.getAllByText("Signal evidence").map((node) => node.closest("details"));
    expect(detailsCollapsed.every((item) => item?.hasAttribute("open") === false)).toBe(true);
  });

  it("saves persistent hidden driver stacks from Settings", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        driverToolsEnabled: true,
        driverHiddenSuggestionIds: []
      })
    );

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Hide VMware stack forever"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Settings"));
    });

    await waitFor(() =>
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          driverHiddenSuggestionIds: ["virtualization-vmware"]
        })
      )
    );
  });

  it("renders AI action plan and reference signals", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "appdata:test",
          kind: "quarantine_review",
          title: "Review stale AppData folder: Zoom",
          summary: "No installed-app match and no active references were detected.",
          targetPath: "C:\\Users\\me\\AppData\\Roaming\\Zoom",
          sourcePaths: ["C:\\Users\\me\\AppData\\Roaming\\Zoom"],
          estimatedBytes: 104857600,
          confidence: "high",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: [
          {
            path: "C:\\Users\\me\\AppData\\Roaming\\Zoom",
            name: "Zoom",
            sizeBytes: 104857600,
            fileCount: 500,
            lastModified: Date.now() - 400 * 24 * 60 * 60 * 1000,
            daysSinceModified: 400,
            confidence: "high",
            reason: "No installed-app match, not active, and stale for over a year.",
            matchedInstalledApp: false,
            activeProcessPath: undefined,
            referenceKinds: [],
            referenceCount: 0,
            referencedAnywhere: false,
            disposition: "cleanup_candidate",
            dispositionReason: "No active references or install match were found.",
            scanTruncated: false
          }
        ]
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await waitFor(() => {
      expect(screen.getByText("Action Plan")).toBeTruthy();
      expect(screen.getByText("Review stale AppData folder: Zoom")).toBeTruthy();
      expect(screen.getByText("No active reference signals found")).toBeTruthy();
      expect(screen.getByText("Use In Scan")).toBeTruthy();
    });
  });

  it("builds suggested smart collections from the AI action plan", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "suggest:minecraft",
          kind: "folder_review",
          title: "Review CurseForge modpack cache",
          summary: "Unused Minecraft modpack data.",
          targetPath: "C:\\Users\\me\\curseforge\\minecraft\\Instances",
          sourcePaths: ["C:\\Users\\me\\curseforge\\minecraft\\Instances"],
          estimatedBytes: 512000000,
          confidence: "high",
          risk: "low",
          autoApplyScanRoot: true
        },
        {
          id: "suggest:ai",
          kind: "folder_review",
          title: "Review DeepSeek model cache",
          summary: "Old local inference model files.",
          targetPath: "C:\\Users\\me\\.cache\\deepseek\\models",
          sourcePaths: ["C:\\Users\\me\\.cache\\deepseek\\models"],
          estimatedBytes: 256000000,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await waitFor(() => {
      expect(screen.getByText("Suggested Collections")).toBeTruthy();
      expect(screen.getByText("High Impact Safe Wins")).toBeTruthy();
      expect(screen.getByText("Minecraft + Games")).toBeTruthy();
      expect(screen.getByText("AI Models + Tooling")).toBeTruthy();
    });

    const safeWinsCard = screen.getByText("High Impact Safe Wins").closest("article");
    expect(safeWinsCard).toBeTruthy();
    expect((safeWinsCard as HTMLElement).textContent).toMatch(/Score \d+/);
    expect((safeWinsCard as HTMLElement).textContent).toMatch(/Impact (focused|medium|high)/);
    expect((safeWinsCard as HTMLElement).textContent).toMatch(/Confidence (low|medium|high)/);
    expect((safeWinsCard as HTMLElement).textContent).toMatch(/Risk (low|medium|high)/);
  });

  it("applies best safe wins and auto-builds preview from current findings without starting a new scan", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-safe-win",
          path: "C:\\Users\\me\\curseforge\\minecraft\\Instances\\profile-a\\logs\\latest.log",
          category: "logs",
          sizeBytes: 16384,
          risk: "low",
          reason: "Large leftover game log",
          sourceRuleId: "logs",
          selectedByDefault: false,
          modifiedAt: Date.now()
        }
      ]));

    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "safe:games",
          kind: "folder_review",
          title: "Review CurseForge modpack cache",
          summary: "Unused Minecraft modpack data.",
          targetPath: "C:\\Users\\me\\curseforge\\minecraft\\Instances",
          sourcePaths: ["C:\\Users\\me\\curseforge\\minecraft\\Instances"],
          estimatedBytes: 512000000,
          confidence: "high",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 512000000,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    const safeWinsCard = screen.getByText("High Impact Safe Wins").closest("article");
    expect(safeWinsCard).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(safeWinsCard as HTMLElement).getByText("Apply Best Safe Wins"));
    });

    expect(desktopApiMock.startScan).toHaveBeenCalledTimes(1);
    expect(desktopApiMock.previewCleanup).toHaveBeenCalledWith("run-1", ["finding-safe-win"]);
  });

  it("filters cleanup findings by AI-selected and recommended sources", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-ai-filter",
          path: "C:\\Users\\me\\curseforge\\minecraft\\Instances\\profile-a\\logs\\latest.log",
          category: "logs",
          sizeBytes: 16384,
          risk: "low",
          reason: "Large leftover game log",
          sourceRuleId: "logs",
          selectedByDefault: false,
          modifiedAt: Date.now()
        },
        {
          id: "finding-rule-filter",
          path: "C:\\Users\\me\\AppData\\Local\\Temp\\cache.tmp",
          category: "temp",
          sizeBytes: 4096,
          risk: "low",
          reason: "Temporary file path",
          sourceRuleId: "temp-path",
          selectedByDefault: true,
          modifiedAt: Date.now()
        }
      ]));

    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "safe:filter",
          kind: "folder_review",
          title: "Review CurseForge modpack cache",
          summary: "Unused Minecraft modpack data.",
          targetPath: "C:\\Users\\me\\curseforge\\minecraft\\Instances",
          sourcePaths: ["C:\\Users\\me\\curseforge\\minecraft\\Instances"],
          estimatedBytes: 512000000,
          confidence: "high",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 512000000,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    const safeWinsCard = screen.getByText("High Impact Safe Wins").closest("article");
    expect(safeWinsCard).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(safeWinsCard as HTMLElement).getByText("Apply Best Safe Wins"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Detailed file list and advanced preview"));
    });

    const findingsTable = screen.getAllByRole("table")[0];
    expect(screen.getByText("AI-selected (1)")).toBeTruthy();
    expect(screen.getByText("Recommended (1)")).toBeTruthy();
    expect(within(findingsTable).getByText(/latest\.log/)).toBeTruthy();
    expect(within(findingsTable).queryByText(/cache\.tmp/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("Recommended (1)"));
    });

    expect(within(findingsTable).getByText(/cache\.tmp/)).toBeTruthy();
    expect(within(findingsTable).queryByText(/latest\.log/)).toBeNull();
  });

  it("shows AI, Recommended, and Manual badges in cleanup rows and supports Select AI-selected", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-ai-badge",
          path: "C:\\Users\\me\\curseforge\\minecraft\\Instances\\profile-a\\logs\\latest.log",
          category: "logs",
          sizeBytes: 16384,
          risk: "low",
          reason: "Large leftover game log",
          sourceRuleId: "logs",
          selectedByDefault: false,
          modifiedAt: Date.now()
        },
        {
          id: "finding-recommended-badge",
          path: "C:\\Users\\me\\AppData\\Local\\Temp\\cache.tmp",
          category: "temp",
          sizeBytes: 4096,
          risk: "low",
          reason: "Temporary file path",
          sourceRuleId: "temp-path",
          selectedByDefault: true,
          modifiedAt: Date.now()
        },
        {
          id: "finding-manual-badge",
          path: "C:\\Users\\me\\Desktop\\old-manual.log",
          category: "logs",
          sizeBytes: 2048,
          risk: "low",
          reason: "Manual review target",
          sourceRuleId: "logs",
          selectedByDefault: false,
          modifiedAt: Date.now()
        }
      ]));

    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "safe:badge",
          kind: "folder_review",
          title: "Review CurseForge modpack cache",
          summary: "Unused Minecraft modpack data.",
          targetPath: "C:\\Users\\me\\curseforge\\minecraft\\Instances",
          sourcePaths: ["C:\\Users\\me\\curseforge\\minecraft\\Instances"],
          estimatedBytes: 512000000,
          confidence: "high",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 512000000,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    const safeWinsCard = screen.getByText("High Impact Safe Wins").closest("article");
    expect(safeWinsCard).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(safeWinsCard as HTMLElement).getByText("Apply Best Safe Wins"));
    });

    fireEvent.click(screen.getByText("All (3)"));
    await act(async () => {
      fireEvent.click(screen.getByText("Detailed file list and advanced preview"));
    });

    const findingsTable = screen.getAllByRole("table")[0];
    const aiRow = within(findingsTable).getByText(/latest\.log/).closest("tr");
    const recommendedRow = within(findingsTable).getByText(/cache\.tmp/).closest("tr");
    const manualRow = within(findingsTable).getByText(/old-manual\.log/).closest("tr");
    expect(aiRow).toBeTruthy();
    expect(recommendedRow).toBeTruthy();
    expect(manualRow).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(manualRow as HTMLElement).getByRole("checkbox"));
    });

    expect((aiRow as HTMLElement).textContent).toContain("AI");
    expect((recommendedRow as HTMLElement).textContent).toContain("Recommended");
    expect((manualRow as HTMLElement).textContent).toContain("Manual");
    const sourceLegend = screen.getByText(/Source badges:/);
    expect(sourceLegend).toBeTruthy();
    expect(sourceLegend.textContent).toContain("Recommended defaults");

    await act(async () => {
      fireEvent.click(screen.getByText("Select AI-selected"));
    });

    expect(screen.getByText("Selected 1 finding(s) from AI-selected findings.")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("Size (largest first)"), {
      target: { value: "source_desc" }
    });

    const bodyRows = within(findingsTable.querySelector("tbody") as HTMLElement).getAllByRole("row");
    expect(bodyRows[0].textContent).toContain("latest.log");
    expect(bodyRows[1].textContent).toContain("cache.tmp");
    expect(bodyRows[2].textContent).toContain("old-manual.log");
  });

  it("starts a focused scan from an AI action when no findings are loaded", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "appdata:focus",
          kind: "quarantine_review",
          title: "Verify AppData folder before cleanup: Zoom",
          summary: "Referenced by install location.",
          targetPath: "C:\\Users\\me\\AppData\\Roaming\\Zoom",
          sourcePaths: ["C:\\Users\\me\\AppData\\Roaming\\Zoom"],
          estimatedBytes: 104857600,
          confidence: "low",
          risk: "medium",
          autoApplyScanRoot: false
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Use In Scan"));
    });

    expect(desktopApiMock.startScan).toHaveBeenCalledWith(
      "standard",
      ["temp", "cache", "logs", "crash_dumps", "wsl_leftovers", "minecraft_leftovers", "ai_model_leftovers", "installer_artifacts"],
      ["C:\\Users\\me\\AppData\\Roaming\\Zoom"]
    );
  });

  it("queues cleanup preview from an AI action after focused scan results load", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "appdata:preview",
          kind: "quarantine_review",
          title: "Preview Zoom cleanup",
          summary: "Review Zoom leftovers.",
          targetPath: "C:\\Users\\me\\AppData\\Roaming\\Zoom",
          sourcePaths: ["C:\\Users\\me\\AppData\\Roaming\\Zoom"],
          estimatedBytes: 104857600,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
        {
          id: "finding-ai",
          path: "C:\\Users\\me\\AppData\\Roaming\\Zoom\\data\\cache.log",
          category: "logs",
          sizeBytes: 8192,
          risk: "low",
          reason: "Log output file",
          sourceRuleId: "logs",
          selectedByDefault: false,
          modifiedAt: Date.now()
        }
      ]));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Preview Cleanup"));
    });

    fireEvent.click(screen.getByText("Scan"));
    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    expect(desktopApiMock.previewCleanup).toHaveBeenCalledWith("run-1", ["finding-ai"]);
  });

  it("shows protected rejected items in the Safety tab", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(
      buildScanResults([], {
        rejected: [
          {
            path: "C:\\Users\\me\\AppData\\Local\\Programs\\DaVinci Resolve\\Resolve.exe",
            category: "temp",
            sourceRuleId: "temp-path",
            protectionKind: "app_install_root",
            reason: "Path is under an application install directory.",
            matchedAppName: "DaVinci Resolve"
          }
        ],
        summary: {
          runId: "run-1",
          status: "completed",
          startedAt: Date.now(),
          finishedAt: Date.now(),
          processedItems: 10,
          findingsCount: 0,
          totalCandidateBytes: 0,
          protectedRejectedCount: 1,
          categories: {
            temp: { count: 0, bytes: 0 },
            cache: { count: 0, bytes: 0 },
            logs: { count: 0, bytes: 0 },
            crash_dumps: { count: 0, bytes: 0 },
            wsl_leftovers: { count: 0, bytes: 0 },
            minecraft_leftovers: { count: 0, bytes: 0 },
            ai_model_leftovers: { count: 0, bytes: 0 },
            installer_artifacts: { count: 0, bytes: 0 },
            duplicates: { count: 0, bytes: 0 }
          }
        }
      })
    );

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    const protectedMetric = screen.getByText("Protected").closest("article");
    expect(protectedMetric).toBeTruthy();
    expect(within(protectedMetric as HTMLElement).getByText("1")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Open Safety"));
    });

    await waitFor(() => {
      expect(screen.getByText(/protected items rejected/i)).toBeTruthy();
      expect(screen.getAllByText("Install root").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/DaVinci Resolve/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Path is under an application install directory.")).toBeTruthy();
      expect(screen.getByText("Temporary files")).toBeTruthy();
    });
  });

  it("adds rejected path and app entries to the never-cleanup allowlist from Safety", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(
      buildScanResults([], {
        rejected: [
          {
            path: "C:\\Users\\me\\AppData\\Local\\Programs\\DaVinci Resolve\\Resolve.exe",
            category: "temp",
            sourceRuleId: "temp-path",
            protectionKind: "app_install_root",
            reason: "Path is under an application install directory.",
            matchedAppName: "DaVinci Resolve"
          }
        ],
        summary: {
          runId: "run-1",
          status: "completed",
          startedAt: Date.now(),
          finishedAt: Date.now(),
          processedItems: 10,
          findingsCount: 0,
          totalCandidateBytes: 0,
          protectedRejectedCount: 1,
          categories: {
            temp: { count: 0, bytes: 0 },
            cache: { count: 0, bytes: 0 },
            logs: { count: 0, bytes: 0 },
            crash_dumps: { count: 0, bytes: 0 },
            wsl_leftovers: { count: 0, bytes: 0 },
            minecraft_leftovers: { count: 0, bytes: 0 },
            ai_model_leftovers: { count: 0, bytes: 0 },
            installer_artifacts: { count: 0, bytes: 0 },
            duplicates: { count: 0, bytes: 0 }
          }
        }
      })
    );

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });

    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByText("Open Safety"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Allowlist Path"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\Users\\me\\AppData\\Local\\Programs\\DaVinci Resolve\\Resolve.exe"],
          neverCleanupApps: []
        })
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Allowlist App"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({
          neverCleanupApps: ["DaVinci Resolve"]
        })
      );
    });
  });

  it("adds cleanup findings to the never-cleanup allowlist from Cleanup Plan", async () => {
    desktopApiMock.getScanResults.mockResolvedValueOnce(buildScanResults([
      {
        id: "finding-protect",
        path: "C:\\Users\\me\\AppData\\Local\\Temp\\keep-me.tmp",
        category: "temp",
        sizeBytes: 1024,
        risk: "low",
        reason: "Temporary file path",
        sourceRuleId: "temp-path",
        selectedByDefault: false,
        modifiedAt: Date.now()
      }
    ]));

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Scan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Start Scan"));
    });
    await waitFor(() => expect(desktopApiMock.getScanResults).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Cleanup Plan"));
    await act(async () => {
      fireEvent.click(screen.getByText("Detailed file list and advanced preview"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Allowlist Path"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\Users\\me\\AppData\\Local\\Temp\\keep-me.tmp"]
        })
      );
    });
  });

  it("adds AI action targets to the never-cleanup allowlist from AI Advisor", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "protect:ai-target",
          kind: "folder_review",
          title: "Review launcher cache",
          summary: "Potential leftover launcher files.",
          targetPath: "C:\\Users\\me\\LauncherCache",
          sourcePaths: ["C:\\Users\\me\\LauncherCache"],
          estimatedBytes: 512000000,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 512000000,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Allowlist Target"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\Users\\me\\LauncherCache"]
        })
      );
    });
  });

  it("reviews allowlist replace before applying imported changes", async () => {
    desktopApiMock.getSettings.mockResolvedValueOnce(
      buildSettings({
        neverCleanupPaths: ["C:\\OldPath"],
        neverCleanupApps: ["Old App"]
      })
    );

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const file = new File(
      [
        JSON.stringify({
          version: 1,
          neverCleanupPaths: ["C:\\ImportedPath"],
          neverCleanupApps: ["Imported App"]
        })
      ],
      "allowlist.json",
      { type: "application/json" }
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Replace From File"));
    });

    const fileInput = screen.getByLabelText("Allowlist import file") as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(desktopApiMock.updateSettings).not.toHaveBeenCalled();
    let reviewDialog: HTMLElement;
    await waitFor(() => {
      reviewDialog = screen.getByRole("dialog", { name: "Allowlist import review" });
      expect(reviewDialog).toBeTruthy();
    });
    reviewDialog = screen.getByRole("dialog", { name: "Allowlist import review" });
    expect(within(reviewDialog).getByText("Review Allowlist Replace")).toBeTruthy();
    expect(within(reviewDialog).getByText("C:\\ImportedPath")).toBeTruthy();
    expect(within(reviewDialog).getByText("Old App")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Apply Replace"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\ImportedPath"],
          neverCleanupApps: ["Imported App"]
        })
      );
    });
  });

  it("saves and merges a named protection profile into current settings", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const textareas = screen.getAllByRole("textbox");
    const protectedPaths = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Blackmagic Design")
    ) as HTMLTextAreaElement;
    const protectedApps = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Adobe Premiere Pro")
    ) as HTMLTextAreaElement;

    fireEvent.change(protectedPaths, { target: { value: "C:\\ProfilePath" } });
    fireEvent.change(protectedApps, { target: { value: "Profile App" } });
    fireEvent.change(screen.getByDisplayValue("Primary Machine"), { target: { value: "Workstation" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Current As New"));
    });

    expect(screen.getByText('1 saved protection profile')).toBeTruthy();
    expect((screen.getByLabelText("Profile name") as HTMLInputElement).value).toBe("Workstation");

    fireEvent.change(protectedPaths, { target: { value: "C:\\ChangedPath" } });
    fireEvent.change(protectedApps, { target: { value: "Changed App" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Merge Active Into Current"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\ChangedPath", "C:\\ProfilePath"],
          neverCleanupApps: ["Changed App", "Profile App"]
        })
      );
    });
  });

  it("imports multiple named protection profiles", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const file = new File(
      [
        JSON.stringify({
          version: 2,
          profiles: [
            {
              name: "Gaming",
              neverCleanupPaths: ["C:\\GamesKeep"],
              neverCleanupApps: ["Steam"]
            },
            {
              name: "Work",
              neverCleanupPaths: ["C:\\WorkKeep"],
              neverCleanupApps: ["DaVinci Resolve"]
            }
          ]
        })
      ],
      "profiles.json",
      { type: "application/json" }
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Import Profiles"));
    });

    const fileInput = screen.getByLabelText("Protection profiles import file") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(
        screen.getByText((_content, element) => element?.textContent === "2 saved protection profiles")
      ).toBeTruthy();
    });
    expect((screen.getByLabelText("Active protection profile") as HTMLSelectElement).textContent).toContain("Work");
    expect((screen.getByLabelText("Compare protection profile") as HTMLSelectElement).textContent).toContain("Gaming");
  });

  it("compares the active protection profile against another profile", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const file = new File(
      [
        JSON.stringify({
          version: 2,
          profiles: [
            {
              name: "Gaming",
              neverCleanupPaths: ["C:\\GamesKeep"],
              neverCleanupApps: ["Steam"]
            },
            {
              name: "Work",
              neverCleanupPaths: ["C:\\WorkKeep"],
              neverCleanupApps: ["DaVinci Resolve"]
            }
          ]
        })
      ],
      "profiles.json",
      { type: "application/json" }
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Import Profiles"));
    });

    const fileInput = screen.getByLabelText("Protection profiles import file") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText("Only In Work")).toBeTruthy();
    });

    expect(screen.getByText("C:\\WorkKeep")).toBeTruthy();
    expect(screen.getByText("DaVinci Resolve")).toBeTruthy();
    expect(screen.getByText("Only In Gaming")).toBeTruthy();
    expect(screen.getByText("C:\\GamesKeep")).toBeTruthy();
    expect(screen.getByText("Steam")).toBeTruthy();
  });

  it("compares the active protection profile against current settings", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const textareas = screen.getAllByRole("textbox");
    const protectedPaths = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Blackmagic Design")
    ) as HTMLTextAreaElement;
    const protectedApps = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Adobe Premiere Pro")
    ) as HTMLTextAreaElement;

    fireEvent.change(protectedPaths, { target: { value: "C:\\ProfilePath" } });
    fireEvent.change(protectedApps, { target: { value: "Profile App" } });
    fireEvent.change(screen.getByDisplayValue("Primary Machine"), { target: { value: "Workstation" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Current As New"));
    });

    fireEvent.change(protectedPaths, { target: { value: "C:\\CurrentPath" } });
    fireEvent.change(protectedApps, { target: { value: "Current App" } });
    fireEvent.change(screen.getByLabelText("Compare protection profile"), {
      target: { value: "__current_settings__" }
    });

    await waitFor(() => {
      expect(screen.getByText("Only In Current Settings")).toBeTruthy();
    });

    expect(screen.getAllByText("C:\\CurrentPath").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current App").length).toBeGreaterThan(0);
    expect(screen.getByText("Only In Workstation")).toBeTruthy();
  });

  it("promotes compare diff into the current allowlist", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const textareas = screen.getAllByRole("textbox");
    const protectedPaths = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Blackmagic Design")
    ) as HTMLTextAreaElement;
    const protectedApps = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Adobe Premiere Pro")
    ) as HTMLTextAreaElement;

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep\nC:\\SharedKeep" } });
    fireEvent.change(protectedApps, { target: { value: "Base App\nShared App" } });
    fireEvent.change(screen.getByDisplayValue("Primary Machine"), { target: { value: "Workstation" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Current As New"));
    });

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep" } });
    fireEvent.change(protectedApps, { target: { value: "Base App" } });
    fireEvent.change(screen.getByLabelText("Compare protection profile"), {
      target: { value: "__current_settings__" }
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Promote Active Diff To Current"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\BaseKeep", "C:\\SharedKeep"],
          neverCleanupApps: ["Base App", "Shared App"]
        })
      );
    });
  });

  it("promotes only path diff into the current allowlist", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const textareas = screen.getAllByRole("textbox");
    const protectedPaths = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Blackmagic Design")
    ) as HTMLTextAreaElement;
    const protectedApps = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Adobe Premiere Pro")
    ) as HTMLTextAreaElement;

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep\nC:\\SharedKeep" } });
    fireEvent.change(protectedApps, { target: { value: "Base App" } });
    fireEvent.change(screen.getByDisplayValue("Primary Machine"), { target: { value: "Workstation" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Current As New"));
    });

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep" } });
    fireEvent.change(screen.getByLabelText("Compare protection profile"), {
      target: { value: "__current_settings__" }
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Promote Active Paths To Current"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\BaseKeep", "C:\\SharedKeep"],
          neverCleanupApps: ["Base App"]
        })
      );
    });
  });

  it("promotes only app diff into the current allowlist", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const textareas = screen.getAllByRole("textbox");
    const protectedPaths = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Blackmagic Design")
    ) as HTMLTextAreaElement;
    const protectedApps = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Adobe Premiere Pro")
    ) as HTMLTextAreaElement;

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep" } });
    fireEvent.change(protectedApps, { target: { value: "Base App\nShared App" } });
    fireEvent.change(screen.getByDisplayValue("Primary Machine"), { target: { value: "Workstation" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Current As New"));
    });

    fireEvent.change(protectedApps, { target: { value: "Base App" } });
    fireEvent.change(screen.getByLabelText("Compare protection profile"), {
      target: { value: "__current_settings__" }
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Promote Active Apps To Current"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\BaseKeep"],
          neverCleanupApps: ["Base App", "Shared App"]
        })
      );
    });
  });

  it("promotes only the selected diff rows into the current allowlist", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const textareas = screen.getAllByRole("textbox");
    const protectedPaths = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Blackmagic Design")
    ) as HTMLTextAreaElement;
    const protectedApps = textareas.find((item) =>
      (item as HTMLTextAreaElement).placeholder.includes("Adobe Premiere Pro")
    ) as HTMLTextAreaElement;

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep\nC:\\SharedKeep" } });
    fireEvent.change(protectedApps, { target: { value: "Base App\nShared App" } });
    fireEvent.change(screen.getByDisplayValue("Primary Machine"), { target: { value: "Workstation" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Current As New"));
    });

    fireEvent.change(protectedPaths, { target: { value: "C:\\BaseKeep" } });
    fireEvent.change(protectedApps, { target: { value: "Base App" } });
    fireEvent.change(screen.getByLabelText("Compare protection profile"), {
      target: { value: "__current_settings__" }
    });

    fireEvent.click(screen.getByLabelText("C:\\SharedKeep"));
    await act(async () => {
      fireEvent.click(screen.getByText("Promote Active Diff To Current"));
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\BaseKeep"],
          neverCleanupApps: ["Base App", "Shared App"]
        })
      );
    });
  });

  it("imports a protection diff patch into the current allowlist", async () => {
    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Settings"));

    const file = new File(
      [
        JSON.stringify({
          version: 2,
          kind: "cleanup-pilot-protection-profile-diff",
          activeProfile: "Work",
          compareProfile: "Current Settings",
          activeOnlyPaths: ["C:\\PatchedPath"],
          compareOnlyPaths: [],
          sharedPaths: [],
          activeOnlyApps: ["Patched App"],
          compareOnlyApps: [],
          sharedApps: []
        })
      ],
      "protection-diff.json",
      { type: "application/json" }
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Import Diff Patch"));
    });

    const fileInput = screen.getByLabelText("Protection diff import file") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(desktopApiMock.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverCleanupPaths: ["C:\\PatchedPath"],
          neverCleanupApps: ["Patched App"]
        })
      );
    });
  });

  it("exports the visible protection diff as json and csv", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    const createObjectURLMock = jest.fn(() => "blob:diff");
    const revokeObjectURLMock = jest.fn();
    const anchorClickMock = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURLMock
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      writable: true,
      value: anchorClickMock
    });

    try {
      render(<App />);
      await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

      fireEvent.click(screen.getByText("Settings"));

      const file = new File(
        [
          JSON.stringify({
            version: 2,
            profiles: [
              {
                name: "Gaming",
                neverCleanupPaths: ["C:\\GamesKeep"],
                neverCleanupApps: ["Steam"]
              },
              {
                name: "Work",
                neverCleanupPaths: ["C:\\WorkKeep"],
                neverCleanupApps: ["DaVinci Resolve"]
              }
            ]
          })
        ],
        "profiles.json",
        { type: "application/json" }
      );

      await act(async () => {
        fireEvent.click(screen.getByText("Import Profiles"));
      });

      const fileInput = screen.getByLabelText("Protection profiles import file") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(screen.getByText("Only In Work")).toBeTruthy();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Export Diff JSON"));
      });
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Protection diff exported as JSON/)).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByText("Export Diff CSV"));
      });
      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Protection diff exported as CSV/)).toBeTruthy();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL
      });
      Object.defineProperty(HTMLAnchorElement.prototype, "click", {
        configurable: true,
        writable: true,
        value: originalAnchorClick
      });
    }
  });

  it("renders do-not-touch AppData candidates without creating cleanup actions for them", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [],
      summary: {
        scannedRoots: [],
        scannedFileCount: 900,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: [
          {
            path: "C:\\Users\\me\\AppData\\Roaming\\DaVinci Resolve",
            name: "DaVinci Resolve",
            sizeBytes: 104857600,
            fileCount: 400,
            lastModified: Date.now() - 20 * 24 * 60 * 60 * 1000,
            daysSinceModified: 20,
            confidence: "low",
            reason: "Folder name matches an installed app.",
            matchedInstalledApp: true,
            activeProcessPath: undefined,
            referenceKinds: ["install_location"],
            referenceCount: 1,
            referencedAnywhere: true,
            installedAppName: "DaVinci Resolve",
            disposition: "do_not_touch",
            dispositionReason: "Folder is tied to an installed application location.",
            scanTruncated: false
          }
        ]
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await waitFor(() => {
      expect(screen.getByText("Likely Stale AppData Candidates")).toBeTruthy();
      expect(screen.getByText(/do not touch/i)).toBeTruthy();
      expect(screen.getByText("Folder is tied to an installed application location.")).toBeTruthy();
      expect(screen.getByText("Installed app: DaVinci Resolve")).toBeTruthy();
      expect(screen.getByText("Matched installed app")).toBeTruthy();
      expect(screen.queryByText("Review stale AppData folder: DaVinci Resolve")).toBeNull();
    });
  });

  it("stores AI actions in the active named collection and applies it to scan", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "collection:zoom",
          kind: "quarantine_review",
          title: "Review Zoom leftovers",
          summary: "Review Zoom data before cleanup.",
          targetPath: "C:\\Users\\me\\AppData\\Roaming\\Zoom",
          sourcePaths: ["C:\\Users\\me\\AppData\\Roaming\\Zoom"],
          estimatedBytes: 104857600,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add To Collection"));
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("cleanup-pilot.aiCollections.v2")).toContain("Review Zoom leftovers");
      expect(window.localStorage.getItem("cleanup-pilot.aiCollections.v2")).toContain("My AI Collection");
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Preview Collection Cleanup"));
    });

    expect(desktopApiMock.startScan).toHaveBeenCalledWith(
      "standard",
      ["temp", "cache", "logs", "crash_dumps", "wsl_leftovers", "minecraft_leftovers", "ai_model_leftovers", "installer_artifacts"],
      ["C:\\Users\\me\\AppData\\Roaming\\Zoom"]
    );
  });

  it("creates and renames a named AI collection", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "collection:games",
          kind: "folder_review",
          title: "Review game cache",
          summary: "Large game cache folder.",
          targetPath: "C:\\Users\\me\\AppData\\Local\\GameCache",
          sourcePaths: ["C:\\Users\\me\\AppData\\Local\\GameCache"],
          estimatedBytes: 52428800,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 1200,
        scannedBytes: 104857600,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("New Collection"));
    });

    fireEvent.change(screen.getByPlaceholderText("My AI Collection"), {
      target: { value: "Games" }
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Name"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add To Collection"));
    });

    await waitFor(() => {
      const stored = window.localStorage.getItem("cleanup-pilot.aiCollections.v2");
      expect(stored).toContain("\"name\":\"Games\"");
      expect(stored).toContain("Review game cache");
    });
  });

  it("creates a named collection from a suggested smart collection", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "suggest:create",
          kind: "folder_review",
          title: "Review Modrinth profiles",
          summary: "Old Minecraft profiles and assets.",
          targetPath: "C:\\Users\\me\\AppData\\Roaming\\ModrinthApp",
          sourcePaths: ["C:\\Users\\me\\AppData\\Roaming\\ModrinthApp"],
          estimatedBytes: 178257920,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 2200,
        scannedBytes: 178257920,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    const minecraftCard = screen.getByText("Minecraft + Games").closest("article");
    expect(minecraftCard).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(minecraftCard as HTMLElement).getByText("Create Suggested Collection"));
    });

    await waitFor(() => {
      const stored = window.localStorage.getItem("cleanup-pilot.aiCollections.v2");
      expect(stored).toContain("\"name\":\"Minecraft + Games\"");
      expect(stored).toContain("Review Modrinth profiles");
    });
  });

  it("merges a suggested collection into the active AI collection", async () => {
    desktopApiMock.analyzeWithAi.mockResolvedValueOnce({
      models: [],
      decision: { recommendedModel: "", provider: "local", rationale: "", alternatives: [] },
      providers: { localCount: 0, cerebrasCount: 1, cerebrasConfigured: true },
      actionPlan: [
        {
          id: "merge:existing",
          kind: "folder_review",
          title: "Review CurseForge cache",
          summary: "Old CurseForge launcher data.",
          targetPath: "C:\\Users\\me\\curseforge\\cache",
          sourcePaths: ["C:\\Users\\me\\curseforge\\cache"],
          estimatedBytes: 300000000,
          confidence: "high",
          risk: "low",
          autoApplyScanRoot: true
        },
        {
          id: "merge:new",
          kind: "folder_review",
          title: "Review DeepSeek temp models",
          summary: "Unused DeepSeek downloads.",
          targetPath: "C:\\Users\\me\\.cache\\deepseek\\downloads",
          sourcePaths: ["C:\\Users\\me\\.cache\\deepseek\\downloads"],
          estimatedBytes: 220000000,
          confidence: "medium",
          risk: "low",
          autoApplyScanRoot: true
        }
      ],
      summary: {
        scannedRoots: [],
        scannedFileCount: 2200,
        scannedBytes: 520000000,
        topFolders: [],
        topFiles: [],
        topExtensions: [],
        appDataCandidates: []
      },
      recommendationsMarkdown: "## Suggested Actions"
    } as any);

    render(<App />);
    await waitFor(() => expect(desktopApiMock.getSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText("AI Advisor"));
    await act(async () => {
      fireEvent.click(screen.getByText("Run AI Analysis"));
    });

    const gamesCard = screen.getByText("Minecraft + Games").closest("article");
    const aiCard = screen.getByText("AI Models + Tooling").closest("article");
    expect(gamesCard).toBeTruthy();
    expect(aiCard).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(gamesCard as HTMLElement).getByText("Create Suggested Collection"));
    });

    fireEvent.change(screen.getByPlaceholderText("My AI Collection"), {
      target: { value: "Work" }
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Save Name"));
    });

    await act(async () => {
      fireEvent.click(within(aiCard as HTMLElement).getByText("Merge Into Active Collection"));
    });

    await waitFor(() => {
      const stored = window.localStorage.getItem("cleanup-pilot.aiCollections.v2");
      expect(stored).toContain("\"name\":\"Work\"");
      expect(stored).toContain("Review CurseForge cache");
      expect(stored).toContain("Review DeepSeek temp models");
    });
  });

  it("loads quarantine in pages instead of hydrating the full vault at startup", async () => {
    const baseItem = {
      category: "temp",
      sizeBytes: 1024,
      source: "scan",
      movedAt: Date.now()
    };
    desktopApiMock.listQuarantine.mockImplementation(async (_limit?: number, offset?: number) => {
      if ((offset ?? 0) === 0) {
        return {
          items: [
            { ...baseItem, id: "q-1", originalPath: "C:\\temp\\one.tmp", quarantinePath: "C:\\vault\\one.tmp" },
            { ...baseItem, id: "q-2", originalPath: "C:\\temp\\two.tmp", quarantinePath: "C:\\vault\\two.tmp" }
          ],
          totalCount: 3,
          activeCount: 3,
          hasMore: true,
          nextOffset: 2
        } as any;
      }

      return {
        items: [
          { ...baseItem, id: "q-3", originalPath: "C:\\temp\\three.tmp", quarantinePath: "C:\\vault\\three.tmp" }
        ],
        totalCount: 3,
        activeCount: 3,
        hasMore: false,
        nextOffset: 3
      } as any;
    });

    render(<App />);
    await waitFor(() => expect(desktopApiMock.listQuarantine).toHaveBeenCalledWith(200, 0));

    fireEvent.click(screen.getByRole("button", { name: /Quarantine/ }));
    await waitFor(() => expect(screen.getByText("3 total records in the vault")).toBeTruthy());
    expect(screen.getByText("Loaded 2 items in the current page window.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Show More Quarantine Items"));
    });

    await waitFor(() => expect(desktopApiMock.listQuarantine).toHaveBeenCalledWith(200, 2));
    expect(screen.getByText("Loaded 3 items in the current page window.")).toBeTruthy();
  });
});
