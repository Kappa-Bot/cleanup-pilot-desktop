import fs from "fs/promises";
import path from "path";
import os from "os";
import { ScanEngine } from "../electron/scanEngine";
import { ScanProgressEvent, ScanStartRequest } from "../electron/types";

async function createTestRoot(prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".tmp-tests");
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, prefix));
}

function createScanEngine(): ScanEngine {
  return new ScanEngine({
    resolveInstalledApps: async () => []
  });
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === "undefined") {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Condition timed out.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("ScanEngine", () => {
  jest.setTimeout(15_000);

  it("emits preparing progress before installed app inventory resolves", async () => {
    const root = await createTestRoot("cleanup-progress-");
    const tempDir = path.join(root, "Temp");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, "a.tmp"), "111111");

    let releaseInstalledApps: () => void = () => undefined;
    const installedAppsReady = new Promise<void>((resolve) => {
      releaseInstalledApps = resolve;
    });
    const progress: ScanProgressEvent[] = [];
    const request: ScanStartRequest = {
      preset: "standard",
      categories: ["temp"],
      roots: [root]
    };

    const runPromise = new ScanEngine({
      resolveInstalledApps: async () => {
        await installedAppsReady;
        return [];
      }
    }).run("run-early-progress", request, {
      isCanceled: () => false,
      onProgress: (event) => {
        progress.push(event);
      }
    });

    await waitForCondition(() => progress.length > 0, 1_500);
    expect(progress[0]?.stage).toBe("preparing");

    releaseInstalledApps();
    const result = await runPromise;
    expect(result.summary.status).toBe("completed");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("scans selected roots and returns findings", async () => {
    const root = await createTestRoot("cleanup-scan-");
    const tempDir = path.join(root, "Temp");
    const logsDir = path.join(root, "logs");
    const inetCacheDir = path.join(root, "Microsoft", "Windows", "INetCache", "IE");
    const miscDir = path.join(root, "misc");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });
    await fs.mkdir(inetCacheDir, { recursive: true });
    await fs.mkdir(miscDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, "a.tmp"), "111111");
    await fs.writeFile(path.join(logsDir, "b.log"), "222222");
    await fs.writeFile(path.join(inetCacheDir, "cache.bin"), "444444");
    await fs.writeFile(path.join(miscDir, "c.txt"), "333333");

    const request: ScanStartRequest = {
      preset: "standard",
      categories: ["temp", "logs", "cache"],
      roots: [root]
    };
    const progress: ScanProgressEvent[] = [];
    const result = await createScanEngine().run("run-1", request, {
      isCanceled: () => false,
      onProgress: (event) => {
        progress.push(event);
      }
    });

    const foundPaths = new Set(result.findings.map((item) => path.basename(item.path)));
    expect(result.summary.status).toBe("completed");
    expect(result.findings.some((item) => item.category === "temp" && (item.path.endsWith("a.tmp") || item.path.endsWith("Temp")))).toBe(true);
    expect(result.findings.some((item) => item.category === "logs" && (item.path.endsWith("b.log") || item.path.endsWith("logs")))).toBe(true);
    expect(result.findings.some((item) => item.category === "cache" && (item.path.endsWith("cache.bin") || item.path.endsWith("INetCache")))).toBe(true);
    expect(progress.some((item) => item.stage === "surveying")).toBe(true);
    expect(progress.some((item) => (item.estimatedTotalItems ?? 0) > 0)).toBe(true);
    expect(progress.some((item) => item.stage === "scanning")).toBe(true);
    expect(progress[progress.length - 1]?.stage).toBe("completed");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("collapses disposable folders into single directory findings", async () => {
    const root = await createTestRoot("cleanup-container-");
    const cacheDir = path.join(root, "browser", "Cache");
    await fs.mkdir(path.join(cacheDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(cacheDir, "data-1.bin"), "111111");
    await fs.writeFile(path.join(cacheDir, "nested", "data-2.bin"), "222222");

    const result = await createScanEngine().run(
      "run-container",
      {
        preset: "standard",
        categories: ["cache"],
        roots: [root]
      },
      {
        isCanceled: () => false,
        onProgress: () => undefined
      }
    );

    const normalizedCacheDir = path.normalize(cacheDir).toLowerCase();
    const containerFinding = result.findings.find(
      (item) => item.kind === "directory" && path.normalize(item.path).toLowerCase() === normalizedCacheDir
    );
    expect(containerFinding).toBeDefined();
    expect(containerFinding?.entryCount).toBe(2);
    expect(containerFinding?.sizeBytes).toBe(12);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("stops scan when cancellation is requested", async () => {
    const root = await createTestRoot("cleanup-cancel-");
    for (let dirIndex = 0; dirIndex < 24; dirIndex += 1) {
      const dirPath = path.join(root, `group-${dirIndex}`);
      await fs.mkdir(dirPath, { recursive: true });
      for (let fileIndex = 0; fileIndex < 80; fileIndex += 1) {
        await fs.writeFile(path.join(dirPath, `item-${fileIndex}.tmp`), String(fileIndex));
      }
    }

    const request: ScanStartRequest = {
      preset: "standard",
      categories: ["temp"],
      roots: [root]
    };

    let canceled = false;
    const result = await createScanEngine().run("run-2", request, {
      isCanceled: () => canceled,
      onProgress: (event) => {
        if (!canceled && event.stage !== "preparing") {
          canceled = true;
        }
      }
    });

    expect(result.summary.status).toBe("canceled");
    expect(result.summary.finishedAt).toBeDefined();

    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps scan progress percent monotonic across survey and scan stages", async () => {
    const root = await createTestRoot("cleanup-progress-monotonic-");
    for (let dirIndex = 0; dirIndex < 8; dirIndex += 1) {
      const dirPath = path.join(root, `group-${dirIndex}`, "Temp");
      await fs.mkdir(dirPath, { recursive: true });
      for (let fileIndex = 0; fileIndex < 18; fileIndex += 1) {
        await fs.writeFile(path.join(dirPath, `item-${fileIndex}.tmp`), "payload");
      }
    }

    const progress: ScanProgressEvent[] = [];
    await createScanEngine().run(
      "run-monotonic-progress",
      {
        preset: "standard",
        categories: ["temp"],
        roots: [root]
      },
      {
        isCanceled: () => false,
        onProgress: (event) => {
          progress.push(event);
        }
      }
    );

    const percents = progress.map((event) => event.percent);
    for (let index = 1; index < percents.length; index += 1) {
      expect(percents[index]).toBeGreaterThanOrEqual(percents[index - 1]);
    }

    await fs.rm(root, { recursive: true, force: true });
  });

  it("skips findings under local install roots even when names look disposable", async () => {
    const root = await createTestRoot("cleanup-protected-");
    const protectedLogsDir = path.join(
      root,
      "Users",
      "user",
      "AppData",
      "Local",
      "Programs",
      "Blackmagic Design",
      "DaVinci Resolve",
      "logs"
    );
    await fs.mkdir(protectedLogsDir, { recursive: true });
    await fs.writeFile(path.join(protectedLogsDir, "runtime.log"), "111111");

    const request: ScanStartRequest = {
      preset: "standard",
      categories: ["logs"],
      roots: [root]
    };

    const result = await createScanEngine().run("run-3", request, {
      isCanceled: () => false,
      onProgress: () => undefined
    });

    expect(result.findings.some((item) => item.path.endsWith("runtime.log"))).toBe(false);
    expect(result.rejected.some((item) => item.path.endsWith("runtime.log"))).toBe(true);
    expect(result.rejected[0]?.protectionKind).toBe("app_install_root");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects cleanup-like matches inside installed app locations from registry inventory", async () => {
    const root = await createTestRoot("cleanup-installed-app-");
    const appDir = path.join(root, "Apps", "SpaceTool");
    await fs.mkdir(path.join(appDir, "logs"), { recursive: true });
    await fs.writeFile(path.join(appDir, "logs", "runtime.log"), "111111");

    const request: ScanStartRequest = {
      preset: "standard",
      categories: ["logs"],
      roots: [root]
    };

    const result = await new ScanEngine({
      resolveInstalledApps: async () => [
        {
          name: "SpaceTool",
          installLocation: appDir
        }
      ]
    }).run("run-4", request, {
      isCanceled: () => false,
      onProgress: () => undefined
    });

    expect(result.findings.some((item) => item.path.endsWith("runtime.log"))).toBe(false);
    expect(
      result.rejected.some(
        (item) =>
          (item.path.endsWith("runtime.log") || item.path.endsWith("logs")) &&
          item.protectionKind === "installed_app_location" &&
          item.matchedAppName === "SpaceTool"
      )
    ).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects allowlisted paths before they become cleanup findings", async () => {
    const root = await createTestRoot("cleanup-allowlist-");
    const protectedDir = path.join(root, "KeepThis");
    const protectedFile = path.join(protectedDir, "cache.tmp");
    await fs.mkdir(protectedDir, { recursive: true });
    await fs.writeFile(protectedFile, "111111");

    const request: ScanStartRequest = {
      preset: "standard",
      categories: ["temp"],
      roots: [root]
    };

    const result = await new ScanEngine({
      resolveInstalledApps: async () => [],
      resolveProtectionPreferences: async () => ({
        neverCleanupPaths: [protectedDir],
        neverCleanupApps: []
      })
    }).run("run-5", request, {
      isCanceled: () => false,
      onProgress: () => undefined
    });

    expect(result.findings.some((item) => path.normalize(item.path) === path.normalize(protectedFile))).toBe(false);
    expect(
      result.rejected.some(
        (item) =>
          path.normalize(item.path) === path.normalize(protectedFile) &&
          item.protectionKind === "user_allowlist_path"
      )
    ).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("persists top-level survey area estimates for repeat scans", async () => {
    const root = await createTestRoot("cleanup-survey-cache-");
    const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-scan-cache-"));
    const tempDir = path.join(root, "Users", "edfpo", "AppData", "Local", "Temp");
    const localAppData = path.join(root, "Users", "edfpo", "AppData", "Local");
    const roamingAppData = path.join(root, "Users", "edfpo", "AppData", "Roaming");
    const programData = path.join(root, "ProgramData");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(roamingAppData, { recursive: true });
    await fs.mkdir(programData, { recursive: true });
    for (let index = 0; index < 12; index += 1) {
      await fs.writeFile(path.join(tempDir, `item-${index}.tmp`), "payload");
    }

    const envSnapshot = {
      CLEANUP_PILOT_CACHE_DIR: process.env.CLEANUP_PILOT_CACHE_DIR,
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
      ProgramData: process.env.ProgramData,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP
    };

    process.env.CLEANUP_PILOT_CACHE_DIR = cacheRoot;
    process.env.USERPROFILE = path.join(root, "Users", "edfpo");
    process.env.LOCALAPPDATA = localAppData;
    process.env.APPDATA = roamingAppData;
    process.env.ProgramData = programData;
    process.env.TEMP = tempDir;
    process.env.TMP = tempDir;

    try {
      await createScanEngine().run(
        "run-survey-cache",
        {
          preset: "standard",
          categories: ["temp"],
          roots: [root]
        },
        {
          isCanceled: () => false,
          onProgress: () => undefined
        }
      );

      const cachePath = path.join(cacheRoot, "scan-area-survey-index.json");
      const sandboxPrefix = root.replace(/\//g, "\\").toLowerCase();
      let matchingEntry: { value?: { sampledDirectories?: number; sampledFiles?: number } } | undefined;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const cacheRaw = await fs.readFile(cachePath, "utf8");
          const cache = JSON.parse(cacheRaw) as {
            entries?: Record<string, { value?: { sampledDirectories?: number; sampledFiles?: number } }>;
          };
          matchingEntry = Object.entries(cache.entries ?? {}).find(
            ([key, entry]) =>
              key.startsWith(sandboxPrefix) &&
              typeof entry.value?.sampledDirectories === "number" &&
              entry.value.sampledDirectories > 0
          )?.[1];
          if (matchingEntry?.value?.sampledDirectories) {
            break;
          }
        } catch {
          // Best-effort local cache write may still be in flight.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(matchingEntry?.value?.sampledDirectories).toBeGreaterThan(0);
      expect(typeof matchingEntry?.value?.sampledFiles).toBe("number");
    } finally {
      restoreEnv(envSnapshot);
    }
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("adds deep storage findings when requested without exposing report-only items as selected cleanup", async () => {
    const root = await createTestRoot("cleanup-deep-storage-");
    const userProfile = path.join(root, "Users", "edfpo");
    const localAppData = path.join(userProfile, "AppData", "Local");
    const roamingAppData = path.join(userProfile, "AppData", "Roaming");
    const programData = path.join(root, "ProgramData");
    const windowsDir = path.join(root, "Windows");
    const tempDir = path.join(localAppData, "Temp");
    const dockerDir = path.join(localAppData, "Docker", "wsl", "data");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(dockerDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, "hidden.tmp"), "payload");
    const vhdxPath = path.join(dockerDir, "ext4.vhdx");
    await fs.writeFile(vhdxPath, "");
    await fs.truncate(vhdxPath, 2 * 1024 ** 3);

    const envSnapshot = {
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
      ProgramData: process.env.ProgramData,
      windir: process.env.windir
    };
    process.env.USERPROFILE = userProfile;
    process.env.LOCALAPPDATA = localAppData;
    process.env.APPDATA = roamingAppData;
    process.env.ProgramData = programData;
    process.env.windir = windowsDir;

    try {
      const result = await createScanEngine().run(
        "run-deep-storage",
        {
          preset: "lite",
          categories: ["wsl_leftovers"],
          roots: [],
          deepStorage: true
        },
        {
          isCanceled: () => false,
          onProgress: () => undefined
        }
      );

      expect(result.summary.deepStorage?.bytesFound).toBeGreaterThan(0);
      expect(result.findings.some((item) => item.origin === "deep_storage" && item.storageSafety === "safe")).toBe(true);
      expect(result.findings.some((item) => item.origin === "deep_storage" && item.storageSafety === "never" && item.executionBlocked)).toBe(true);
    } finally {
      restoreEnv(envSnapshot);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
