import fs from "fs/promises";
import os from "os";
import path from "path";
import { readPersistentJsonCache, schedulePersistentJsonCacheWrite } from "../electron/persistentJsonCache";

describe("persistentJsonCache", () => {
  it("writes and reloads compact cache entries from disk", async () => {
    const cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-persist-cache-"));
    process.env.CLEANUP_PILOT_CACHE_DIR = cacheRoot;

    const initial = await readPersistentJsonCache<{ value: number }>("sample-cache.json");
    expect(initial).toEqual({});

    schedulePersistentJsonCacheWrite("sample-cache.json", {
      alpha: { value: 1 },
      beta: { value: 2 }
    });

    await new Promise((resolve) => setTimeout(resolve, 450));
    const restored = await readPersistentJsonCache<{ value: number }>("sample-cache.json");
    expect(restored).toEqual({
      alpha: { value: 1 },
      beta: { value: 2 }
    });

    delete process.env.CLEANUP_PILOT_CACHE_DIR;
    await fs.rm(cacheRoot, { recursive: true, force: true });
  });
});
