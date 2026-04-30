import fs from "fs/promises";
import path from "path";
import { evaluatePathSafety } from "../electron/pathSafetyService";

describe("pathSafetyService", () => {
  it("blocks protected Windows locations and package stores", async () => {
    await expect(evaluatePathSafety("C:\\Windows\\WinSxS")).resolves.toMatchObject({
      executionAllowed: false,
      safety: "never"
    });
    await expect(evaluatePathSafety("C:\\Program Files\\WindowsApps\\Package")).resolves.toMatchObject({
      executionAllowed: false,
      safety: "never"
    });
  });

  it("blocks Docker and WSL virtual disks from cleanup execution", async () => {
    await expect(evaluatePathSafety("C:\\Users\\tester\\AppData\\Local\\Docker\\wsl\\data\\ext4.vhdx")).resolves.toMatchObject({
      executionAllowed: false,
      safety: "never"
    });
  });

  it("blocks symlink targets before cleanup", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), ".tmp-tests", "safety-symlink-"));
    const source = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    await fs.writeFile(source, "payload");

    try {
      await fs.symlink(source, link);
    } catch {
      await fs.rm(root, { recursive: true, force: true });
      return;
    }

    await expect(evaluatePathSafety(link)).resolves.toMatchObject({
      executionAllowed: false,
      safety: "never"
    });

    await fs.rm(root, { recursive: true, force: true });
  });
});
