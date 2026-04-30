import fs from "fs/promises";
import path from "path";
import { scanDeepStorage } from "../electron/deepStorageScanner";

async function tempRoot(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp-tests");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

describe("deepStorageScanner", () => {
  it("summarizes hidden storage and blocks report-only findings from default execution", async () => {
    const root = await tempRoot("deep-storage-");
    const userProfile = path.join(root, "Users", "tester");
    const localAppData = path.join(userProfile, "AppData", "Local");
    const appData = path.join(userProfile, "AppData", "Roaming");
    const programData = path.join(root, "ProgramData");
    const windowsDir = path.join(root, "Windows");
    await fs.mkdir(path.join(localAppData, "Temp"), { recursive: true });
    await fs.mkdir(path.join(localAppData, "Docker", "wsl", "data"), { recursive: true });
    await fs.writeFile(path.join(localAppData, "Temp", "old.tmp"), "123456");
    await fs.writeFile(path.join(localAppData, "Docker", "wsl", "data", "ext4.vhdx"), "123456");

    const result = await scanDeepStorage({
      env: {
        userProfile,
        localAppData,
        appData,
        localLow: path.join(userProfile, "AppData", "LocalLow"),
        programData,
        programFiles: path.join(root, "Program Files"),
        programFilesX86: path.join(root, "Program Files (x86)"),
        windowsDir
      },
      isCanceled: () => false,
      minLargeFileBytes: 4
    });

    expect(result.findings.some((item) => item.ruleId === "appdata-local-temp" && item.selectedByDefault)).toBe(true);
    expect(result.findings.some((item) => item.path.endsWith("ext4.vhdx") && item.safety === "never" && !item.selectedByDefault)).toBe(true);
    expect(result.summary.bytesFound).toBeGreaterThan(0);
    expect(result.summary.advancedBytes).toBeGreaterThan(0);

    await fs.rm(root, { recursive: true, force: true });
  });
});
