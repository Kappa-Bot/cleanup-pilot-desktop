import fs from "fs";
import os from "os";
import path from "path";
import { StartupAnalyzer } from "../electron/startupAnalyzer";

jest.mock("../electron/windowsSources/registrySource", () => ({
  listRegistryRunEntries: jest.fn(),
  getRunKeyPath: jest.fn()
}));
jest.mock("../electron/windowsSources/startupFolderSource", () => ({
  listStartupFolderEntries: jest.fn()
}));
jest.mock("../electron/windowsSources/taskSchedulerSource", () => ({
  listScheduledTasks: jest.fn()
}));
jest.mock("../electron/windowsSources/serviceSource", () => ({
  listServices: jest.fn()
}));
jest.mock("../electron/windowsSources/driverSource", () => ({
  listBootDrivers: jest.fn()
}));
jest.mock("../electron/windowsSources/eventLogSource", () => ({
  getLatestBootPerformance: jest.fn()
}));
jest.mock("../electron/installedApps", () => ({
  collectInstalledApps: jest.fn()
}));

const { listRegistryRunEntries } = jest.requireMock("../electron/windowsSources/registrySource") as {
  listRegistryRunEntries: jest.Mock;
};
const { listStartupFolderEntries } = jest.requireMock("../electron/windowsSources/startupFolderSource") as {
  listStartupFolderEntries: jest.Mock;
};
const { listScheduledTasks } = jest.requireMock("../electron/windowsSources/taskSchedulerSource") as {
  listScheduledTasks: jest.Mock;
};
const { listServices } = jest.requireMock("../electron/windowsSources/serviceSource") as {
  listServices: jest.Mock;
};
const { listBootDrivers } = jest.requireMock("../electron/windowsSources/driverSource") as {
  listBootDrivers: jest.Mock;
};
const { getLatestBootPerformance } = jest.requireMock("../electron/windowsSources/eventLogSource") as {
  getLatestBootPerformance: jest.Mock;
};
const { collectInstalledApps } = jest.requireMock("../electron/installedApps") as {
  collectInstalledApps: jest.Mock;
};

describe("StartupAnalyzer", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-pilot-startup-"));
  const missingBinary = path.join(tempRoot, "MissingDiscord.exe");
  const missingServiceBinary = path.join(tempRoot, "MissingZoomService.exe");
  const startupShortcutPath = path.join(tempRoot, "Startup", "Slack.lnk");
  const startupTargetPath = path.join(tempRoot, "Slack.exe");

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.mkdirSync(path.dirname(startupTargetPath), { recursive: true });
    fs.writeFileSync(startupTargetPath, "stub");

    listRegistryRunEntries.mockResolvedValue([
      {
        hive: "HKCU",
        name: "Discord",
        command: `\"${missingBinary}\" --minimized`,
        keyPath: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
      }
    ]);
    listStartupFolderEntries.mockResolvedValue([
      {
        scope: "current_user",
        name: "Slack.lnk",
        shortcutPath: startupShortcutPath,
        targetPath: startupTargetPath,
        command: `\"${startupTargetPath}\" --background`,
        modifiedAt: 1_710_000_000_000,
        isShortcut: true
      }
    ]);
    listScheduledTasks.mockResolvedValue([
      {
        taskName: "AppUpdater",
        taskPath: "\\Vendor\\",
        state: "ready",
        author: "Vendor Inc.",
        actions: [],
        triggers: ["Logon"]
      }
    ]);
    listServices.mockResolvedValue([
      {
        serviceName: "ZoomUpdateService",
        displayName: "Zoom Update Service",
        state: "Running",
        startMode: "Auto",
        startName: "LocalSystem",
        binaryPath: missingServiceBinary
      }
    ]);
    listBootDrivers.mockResolvedValue([]);
    getLatestBootPerformance.mockResolvedValue({ bootTimeMs: 42000 });
    collectInstalledApps.mockResolvedValue([
      { name: "Discord", installLocation: tempRoot },
      { name: "Zoom", installLocation: tempRoot }
    ]);
  });

  it("returns actionable startup entries with stable optimization targets and provenance", async () => {
    const analyzer = new StartupAnalyzer();
    const result = await analyzer.scan([]);

    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "registry_run|HKCU|Discord",
          optimizationTargetId: "registry_run|HKCU|Discord",
          originLocation: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
          originScope: "HKCU"
        }),
        expect.objectContaining({
          id: `startup_folder|${startupShortcutPath}`,
          optimizationTargetId: `startup_folder|${startupShortcutPath}`,
          targetPath: startupTargetPath,
          originLocation: path.dirname(startupShortcutPath),
          reasoning: ["Startup folder shortcut"]
        }),
        expect.objectContaining({
          id: "scheduled_task|\\Vendor\\AppUpdater",
          optimizationTargetId: "\\Vendor\\AppUpdater",
          originLocation: "\\Vendor\\AppUpdater"
        }),
        expect.objectContaining({
          id: "service|ZoomUpdateService",
          optimizationTargetId: "ZoomUpdateService",
          originScope: "LocalSystem"
        })
      ])
    );

    expect(result.suggestedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "registry_run|HKCU|Discord" }),
        expect.objectContaining({ targetId: "\\Vendor\\AppUpdater" }),
        expect.objectContaining({ targetId: "ZoomUpdateService" })
      ])
    );
  });
});
