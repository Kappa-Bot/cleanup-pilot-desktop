import path from "path";
import {
  buildStorageRules,
  expandStorageRuleRoots,
  matchStorageRuleForPath
} from "../electron/storageRulesCatalog";

const env = {
  userProfile: "C:\\Users\\tester",
  localAppData: "C:\\Users\\tester\\AppData\\Local",
  appData: "C:\\Users\\tester\\AppData\\Roaming",
  localLow: "C:\\Users\\tester\\AppData\\LocalLow",
  programData: "C:\\ProgramData",
  programFiles: "C:\\Program Files",
  programFilesX86: "C:\\Program Files (x86)",
  windowsDir: "C:\\Windows"
};

describe("storageRulesCatalog", () => {
  it("matches known hidden storage cache and temp locations with explicit safety", () => {
    const rules = buildStorageRules(env);

    expect(matchStorageRuleForPath(path.join(env.localAppData, "Temp"), rules)).toMatchObject({
      id: "appdata-local-temp",
      safety: "safe",
      action: "quarantine"
    });
    expect(matchStorageRuleForPath(path.join(env.localAppData, "NVIDIA", "DXCache"), rules)).toMatchObject({
      id: "nvidia-dx-cache",
      safety: "rebuildable",
      action: "quarantine"
    });
    expect(matchStorageRuleForPath("C:\\Windows.old", rules)).toMatchObject({
      id: "windows-old",
      safety: "advanced",
      action: "nativeTool"
    });
  });

  it("marks Docker and WSL disks as never executable report-only findings", () => {
    const rules = buildStorageRules(env);

    expect(matchStorageRuleForPath(path.join(env.localAppData, "Docker", "wsl", "data", "ext4.vhdx"), rules)).toMatchObject({
      safety: "never",
      action: "reportOnly"
    });
    expect(matchStorageRuleForPath(path.join(env.localAppData, "Packages", "CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc", "LocalState", "ext4.vhdx"), rules)).toMatchObject({
      safety: "never",
      action: "reportOnly"
    });
  });

  it("expands roots for AppData, ProgramData, Windows, games, and developer caches", () => {
    const roots = expandStorageRuleRoots(buildStorageRules(env));

    expect(roots).toEqual(expect.arrayContaining([
      path.join(env.localAppData, "Temp"),
      path.join(env.appData, "Code", "CachedData"),
      path.join(env.programData, "Microsoft", "Windows", "WER", "ReportArchive"),
      path.join(env.programData, "Battle.net"),
      path.join(env.userProfile, ".gradle", "caches")
    ]));
  });
});
