import fs from "fs/promises";
import os from "os";
import path from "path";
import { scanStorageInsights } from "../electron/storageInsights";

describe("storageInsights", () => {
  it("maps whole-disk style top areas and deeper folder buckets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-storage-map-"));

    const files = [
      {
        filePath: path.join(root, "Program Files", "Blackmagic Design", "DaVinci Resolve", "cache.bin"),
        size: 320
      },
      {
        filePath: path.join(root, "ProgramData", "NVIDIA Corporation", "Downloader", "setup.log"),
        size: 180
      },
      {
        filePath: path.join(root, "Users", "edfpo", "AppData", "Local", "Temp", "cache.tmp"),
        size: 96
      },
      {
        filePath: path.join(root, "Windows", "Logs", "CBS", "cbs.log"),
        size: 64
      },
      {
        filePath: path.join(root, "Users", "edfpo", "AppData", "Local", "Temp", "nested", "second.tmp"),
        size: 48
      }
    ];

    for (const item of files) {
      await fs.mkdir(path.dirname(item.filePath), { recursive: true });
      await fs.writeFile(item.filePath, "x".repeat(item.size));
    }

    const result = await scanStorageInsights([root], false);

    expect(result.totalFiles).toBe(5);
    expect(result.scannedRoots).toEqual([path.normalize(root)]);
    expect(result.topAreas?.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        path.join(root, "Program Files"),
        path.join(root, "ProgramData"),
        path.join(root, "Users"),
        path.join(root, "Windows")
      ])
    );
    expect(result.topFolders.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        path.join(root, "Program Files", "Blackmagic Design"),
        path.join(root, "ProgramData", "NVIDIA Corporation"),
        path.join(root, "Users", "edfpo", "AppData", "Local", "Temp"),
        path.join(root, "Windows", "Logs")
      ])
    );
    expect(result.topContainers?.some((item) => item.path === path.join(root, "Users", "edfpo", "AppData", "Local", "Temp"))).toBe(
      true
    );
    expect(result.treemap?.[0]?.children?.some((item) => item.path === path.join(root, "Program Files"))).toBe(true);
    expect(result.largestFiles[0]?.path).toBe(
      path.join(root, "Program Files", "Blackmagic Design", "DaVinci Resolve", "cache.bin")
    );

    const warmResult = await scanStorageInsights([root, root], false);
    expect(
      warmResult.topContainers?.some(
        (item) => item.path === path.join(root, "Users", "edfpo", "AppData", "Local", "Temp") && item.cachedFromIndex
      )
    ).toBe(true);
    expect(
      warmResult.topAreas?.some(
        (item) => item.path === path.join(root, "Program Files") && item.cachedFromIndex
      )
    ).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });
});
