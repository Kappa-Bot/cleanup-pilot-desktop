import fs from "fs/promises";
import os from "os";
import path from "path";
import { QuarantineItem } from "../electron/types";

let mockUserDataPath = "";

jest.mock("electron", () => ({
  app: {
    getPath: () => mockUserDataPath
  }
}));

const { QuarantineManager } = require("../electron/quarantineManager") as typeof import("../electron/quarantineManager");

describe("QuarantineManager", () => {
  it("supports quarantining directory container entries as single restore records", async () => {
    mockUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-quarantine-dir-"));
    const addQuarantineItems = jest.fn();
    const fakeDb = {
      addQuarantineItems,
      listPurgeableQuarantineItems: jest.fn(() => []),
      markQuarantinePurgedBatch: jest.fn()
    } as any;

    const manager = new QuarantineManager(fakeDb);
    await manager.init();

    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-source-dir-"));
    const sourceDir = path.join(sourceRoot, "Temp", "cache-pack");
    await fs.mkdir(path.join(sourceDir, "nested"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "nested", "item.tmp"), "payload");

    const items = await manager.quarantineDirectory(sourceDir, [
      {
        filePath: sourceDir,
        entryKind: "directory",
        sizeBytes: 7,
        findingId: "container-1",
        metadata: {
          category: "temp",
          source: "scan"
        }
      }
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.originalPath).toBe(sourceDir);
    expect(items[0]?.quarantinePath).toContain(path.join("cleanup-quarantine", "vault"));
    expect(addQuarantineItems).toHaveBeenCalledTimes(1);
    await expect(fs.access(sourceDir)).rejects.toThrow();

    await fs.rm(mockUserDataPath, { recursive: true, force: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  it("purges grouped vault containers in parallel and marks all items in one batch", async () => {
    mockUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-purge-"));
    const markQuarantinePurgedBatch = jest.fn();
    const items: QuarantineItem[] = [
      {
        id: "group-1",
        originalPath: "C:\\temp\\alpha.tmp",
        quarantinePath: path.join(mockUserDataPath, "cleanup-quarantine", "vault", "batch-a", "alpha.tmp"),
        sizeBytes: 100,
        category: "temp",
        source: "scan",
        movedAt: Date.now()
      },
      {
        id: "group-2",
        originalPath: "C:\\temp\\beta.tmp",
        quarantinePath: path.join(mockUserDataPath, "cleanup-quarantine", "vault", "batch-a", "nested", "beta.tmp"),
        sizeBytes: 200,
        category: "temp",
        source: "scan",
        movedAt: Date.now()
      },
      {
        id: "single-1",
        originalPath: "C:\\temp\\gamma.tmp",
        quarantinePath: path.join(mockUserDataPath, "cleanup-quarantine", "vault", "single-1_gamma.tmp"),
        sizeBytes: 300,
        category: "temp",
        source: "scan",
        movedAt: Date.now()
      }
    ];

    const fakeDb = {
      listPurgeableQuarantineItems: jest.fn(() => items),
      markQuarantinePurgedBatch
    } as any;

    const manager = new QuarantineManager(fakeDb);
    await manager.init();

    await fs.mkdir(path.dirname(items[0].quarantinePath), { recursive: true });
    await fs.mkdir(path.dirname(items[1].quarantinePath), { recursive: true });
    await fs.writeFile(items[0].quarantinePath, "alpha");
    await fs.writeFile(items[1].quarantinePath, "beta");
    await fs.writeFile(items[2].quarantinePath, "gamma");

    const result = await manager.purge(0);

    expect(result.purgedCount).toBe(3);
    expect(result.freedBytes).toBe(600);
    expect(markQuarantinePurgedBatch).toHaveBeenCalledTimes(1);
    expect(markQuarantinePurgedBatch.mock.calls[0][0]).toEqual(expect.arrayContaining(["group-1", "group-2", "single-1"]));

    await expect(fs.access(path.join(mockUserDataPath, "cleanup-quarantine", "vault", "batch-a"))).rejects.toThrow();
    await expect(fs.access(items[2].quarantinePath)).rejects.toThrow();

    await fs.rm(mockUserDataPath, { recursive: true, force: true });
  });

  it("supports cancellation while purge is running", async () => {
    mockUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-purge-cancel-"));
    const markQuarantinePurgedBatch = jest.fn();
    const items: QuarantineItem[] = [
      {
        id: "cancel-1",
        originalPath: "C:\\temp\\one.tmp",
        quarantinePath: path.join(mockUserDataPath, "cleanup-quarantine", "vault", "cancel-one.tmp"),
        sizeBytes: 100,
        category: "temp",
        source: "scan",
        movedAt: Date.now()
      },
      {
        id: "cancel-2",
        originalPath: "C:\\temp\\two.tmp",
        quarantinePath: path.join(mockUserDataPath, "cleanup-quarantine", "vault", "cancel-two.tmp"),
        sizeBytes: 100,
        category: "temp",
        source: "scan",
        movedAt: Date.now()
      },
      {
        id: "cancel-3",
        originalPath: "C:\\temp\\three.tmp",
        quarantinePath: path.join(mockUserDataPath, "cleanup-quarantine", "vault", "cancel-three.tmp"),
        sizeBytes: 100,
        category: "temp",
        source: "scan",
        movedAt: Date.now()
      }
    ];

    const fakeDb = {
      listPurgeableQuarantineItems: jest.fn(() => items),
      markQuarantinePurgedBatch
    } as any;

    const manager = new QuarantineManager(fakeDb);
    await manager.init();
    (manager as any).storageProfilePromise = Promise.resolve({
      hint: "hdd",
      concurrency: 1,
      label: "test-storage"
    });

    for (const item of items) {
      await fs.writeFile(item.quarantinePath, "x");
    }

    let cancelRequested = false;
    const result = await manager.purge(0, {
      onProgress: (event) => {
        if (!cancelRequested && event.stage === "running" && event.completedGroups >= 1) {
          cancelRequested = true;
          manager.requestPurgeCancel();
        }
      }
    });

    expect(result.canceled).toBe(true);
    expect(result.purgedGroups).toBeGreaterThanOrEqual(1);
    expect(result.purgedGroups).toBeLessThan(3);
    expect(markQuarantinePurgedBatch).toHaveBeenCalledTimes(1);

    await fs.rm(mockUserDataPath, { recursive: true, force: true });
  });
});
