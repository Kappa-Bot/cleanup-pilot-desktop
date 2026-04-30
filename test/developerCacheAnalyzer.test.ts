import fs from "fs/promises";
import path from "path";
import { analyzeDeveloperCaches } from "../electron/developerCacheAnalyzer";

async function tempRoot(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp-tests");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

describe("developerCacheAnalyzer", () => {
  it("finds rebuildable package caches and keeps Docker/WSL disks report-only", async () => {
    const root = await tempRoot("dev-cache-");
    const userProfile = path.join(root, "Users", "tester");
    const localAppData = path.join(userProfile, "AppData", "Local");
    await fs.mkdir(path.join(userProfile, ".npm", "_cacache"), { recursive: true });
    await fs.mkdir(path.join(localAppData, "Docker", "wsl", "data"), { recursive: true });
    await fs.writeFile(path.join(userProfile, ".npm", "_cacache", "blob"), "123456");
    await fs.writeFile(path.join(localAppData, "Docker", "wsl", "data", "ext4.vhdx"), "123456");

    const findings = await analyzeDeveloperCaches({
      env: {
        userProfile,
        localAppData,
        appData: path.join(userProfile, "AppData", "Roaming")
      },
      minLargeFileBytes: 4
    });

    expect(findings.some((item) => item.path.endsWith(path.join(".npm", "_cacache")) && item.safety === "rebuildable")).toBe(true);
    expect(findings.some((item) => item.path.endsWith("ext4.vhdx") && item.safety === "never" && item.action === "reportOnly")).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });
});
