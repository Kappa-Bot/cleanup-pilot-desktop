import fs from "fs/promises";
import path from "path";
import { analyzeEpicLauncher, analyzeSteamLibrary } from "../electron/gameLauncherAnalyzer";

async function tempRoot(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp-tests");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

describe("gameLauncherAnalyzer", () => {
  it("detects Steam orphan install folders by comparing app manifests", async () => {
    const root = await tempRoot("steam-");
    const steamApps = path.join(root, "steamapps");
    await fs.mkdir(path.join(steamApps, "common", "InstalledGame"), { recursive: true });
    await fs.mkdir(path.join(steamApps, "common", "OrphanGame"), { recursive: true });
    await fs.writeFile(path.join(steamApps, "common", "OrphanGame", "data.bin"), "123456");
    await fs.writeFile(path.join(steamApps, "appmanifest_10.acf"), `"AppState"\n{\n  "installdir" "InstalledGame"\n}`);

    const findings = await analyzeSteamLibrary(root);

    expect(findings.some((item) => item.path.endsWith(path.join("common", "OrphanGame")) && item.safety === "review")).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("detects Epic orphan install folders by comparing manifests", async () => {
    const root = await tempRoot("epic-");
    const installs = path.join(root, "Epic Games");
    const manifests = path.join(root, "ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
    const installed = path.join(installs, "InstalledGame");
    const orphan = path.join(installs, "OrphanGame");
    await fs.mkdir(installed, { recursive: true });
    await fs.mkdir(orphan, { recursive: true });
    await fs.mkdir(manifests, { recursive: true });
    await fs.writeFile(path.join(orphan, "data.bin"), "123456");
    await fs.writeFile(path.join(manifests, "installed.item"), JSON.stringify({ InstallLocation: installed }));

    const findings = await analyzeEpicLauncher({ installRoots: [installs], manifestRoots: [manifests] });

    expect(findings.some((item) => item.path === orphan && item.safety === "review")).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });
});
