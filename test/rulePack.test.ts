import { getDefaultRoots, getScanRules, matchesWslLeftoversPath, shouldSelectByDefault } from "../electron/rulePack";

describe("rulePack", () => {
  it("includes requested category rules", () => {
    const rules = getScanRules(["temp", "logs"]);
    const ids = rules.map((item) => item.id);
    expect(ids).toContain("temp-path");
    expect(ids).toContain("logs");
    expect(ids).not.toContain("cache-dir");
  });

  it("matches minecraft profile leftovers", () => {
    const rules = getScanRules(["minecraft_leftovers"]);
    const matched = rules.some((rule) =>
      rule.matches("C:\\Users\\user\\AppData\\Roaming\\modrinthapp\\profiles\\my-pack\\shaderpacks\\x.zip")
    );
    expect(matched).toBe(true);
  });

  it("does not classify installed executables under local program roots as cleanup findings", () => {
    const rules = getScanRules(["temp", "cache", "logs", "installer_artifacts", "ai_model_leftovers"]);
    const davinciExecutable = "C:\\Users\\user\\AppData\\Local\\Programs\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe";
    expect(rules.some((rule) => rule.matches(davinciExecutable))).toBe(false);
  });

  it("does not treat arbitrary downloads as installer artifacts", () => {
    const rules = getScanRules(["installer_artifacts"]);
    const matched = rules.some((rule) =>
      rule.matches("C:\\Users\\user\\Downloads\\project-notes.txt")
    );
    expect(matched).toBe(false);
  });

  it("matches broader browser and web cache paths outside the basic temp folders", () => {
    const rules = getScanRules(["cache"]);
    const matched = rules.some((rule) =>
      rule.matches("C:\\Users\\user\\AppData\\Local\\Microsoft\\Windows\\INetCache\\IE\\cache-item.dat")
    );
    expect(matched).toBe(true);
  });

  it("matches WSL and Docker disposable residue but not VHDX disks", () => {
    expect(
      matchesWslLeftoversPath(
        "C:\\Users\\user\\AppData\\Local\\Docker\\wsl\\logs\\engine.log"
      )
    ).toBe(true);
    expect(
      matchesWslLeftoversPath(
        "C:\\Users\\user\\AppData\\Local\\Packages\\CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc\\LocalState\\temp\\trace.tmp"
      )
    ).toBe(true);
    expect(
      matchesWslLeftoversPath(
        "C:\\Users\\user\\AppData\\Local\\Docker\\wsl\\data\\ext4.vhdx"
      )
    ).toBe(false);
  });

  it("builds broader default roots for cache and installer coverage", () => {
    const original = {
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
      ProgramData: process.env.ProgramData,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP
    };

    process.env.USERPROFILE = "C:\\Users\\tester";
    process.env.LOCALAPPDATA = "C:\\Users\\tester\\AppData\\Local";
    process.env.APPDATA = "C:\\Users\\tester\\AppData\\Roaming";
    process.env.ProgramData = "C:\\ProgramData";
    process.env.TEMP = "C:\\Users\\tester\\AppData\\Local\\Temp";
    process.env.TMP = "C:\\Users\\tester\\AppData\\Local\\Temp";

    try {
      const standardRoots = getDefaultRoots([], "standard", ["cache", "installer_artifacts"]);
      const deepRoots = getDefaultRoots([], "deep", ["cache", "installer_artifacts"]);

      expect(standardRoots).toContain("C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\User Data");
      expect(standardRoots).toContain("C:\\Users\\tester\\AppData\\Local\\Microsoft\\Windows\\INetCache");
      expect(standardRoots).toContain("C:\\ProgramData\\Package Cache");
      expect(deepRoots).toContain("C:\\Users\\tester\\AppData\\Local");
      expect(deepRoots).toContain("C:\\Users\\tester\\AppData\\Roaming");
      expect(deepRoots).toContain("C:\\ProgramData\\NVIDIA Corporation");
    } finally {
      process.env.USERPROFILE = original.USERPROFILE;
      process.env.LOCALAPPDATA = original.LOCALAPPDATA;
      process.env.APPDATA = original.APPDATA;
      process.env.ProgramData = original.ProgramData;
      process.env.TEMP = original.TEMP;
      process.env.TMP = original.TMP;
    }
  });

  it("selects by preset and risk", () => {
    expect(shouldSelectByDefault("lite", "temp", "low")).toBe(true);
    expect(shouldSelectByDefault("lite", "installer_artifacts", "medium")).toBe(false);
    expect(shouldSelectByDefault("extreme", "cache", "high")).toBe(false);
  });
});
