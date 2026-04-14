let mockUserDataPath = "C:\\Temp\\cleanup-pilot-test";

jest.mock("electron", () => ({
  app: {
    getPath: () => mockUserDataPath
  }
}));

jest.mock("../electron/windowsSources/powershell", () => ({
  runPowerShell: jest.fn()
}));

import { OptimizationManager } from "../electron/optimizationManager";
import { OptimizationActionSuggestion } from "../electron/types";

const { runPowerShell } = jest.requireMock("../electron/windowsSources/powershell") as {
  runPowerShell: jest.Mock;
};

describe("OptimizationManager", () => {
  beforeEach(() => {
    runPowerShell.mockReset();
  });

  it("reads registry startup values safely and creates delayed tasks for names with spaces", async () => {
    runPowerShell
      .mockResolvedValueOnce('"C:\\Program Files\\Vendor\\app.exe" --background')
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");

    const db = {
      addOptimizationChange: jest.fn(),
      listOptimizationChanges: jest.fn(() => []),
      getOptimizationChange: jest.fn(),
      markOptimizationChangeReverted: jest.fn()
    } as any;

    const manager = new OptimizationManager({ db });
    const action: OptimizationActionSuggestion = {
      id: "startup-delay",
      targetKind: "startup_entry",
      targetId: "registry_run|HKCU|My App Launcher",
      action: "delay",
      title: "Delay My App Launcher",
      summary: "Registry autorun entry",
      risk: "low",
      reversible: true,
      blocked: false,
      estimatedBenefitScore: 40
    };

    const result = await manager.execute([action]);

    expect(result.appliedCount).toBe(1);
    expect(runPowerShell).toHaveBeenNthCalledWith(
      1,
      "Get-ItemPropertyValue -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'My App Launcher' -ErrorAction Stop"
    );
    expect(runPowerShell).toHaveBeenNthCalledWith(
      2,
      "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'My App Launcher' -ErrorAction Stop"
    );
    expect(runPowerShell.mock.calls[2][0]).toContain("Register-ScheduledTask");
    expect(runPowerShell.mock.calls[2][0]).toContain("-TaskName $taskName");
    expect(runPowerShell.mock.calls[2][0]).toContain("'C:\\Program Files\\Vendor\\app.exe'");
    expect(db.addOptimizationChange).toHaveBeenCalledTimes(1);
  });
});
