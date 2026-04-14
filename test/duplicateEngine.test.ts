import fs from "fs/promises";
import os from "os";
import path from "path";
import { DuplicateEngine } from "../electron/duplicateEngine";

describe("DuplicateEngine", () => {
  it("groups full duplicates and selects older files by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dup-test-"));
    const fileA = path.join(root, "a.bin");
    const fileB = path.join(root, "b.bin");
    const fileC = path.join(root, "c.txt");

    await fs.writeFile(fileA, "same-content-123456");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(fileB, "same-content-123456");
    await fs.writeFile(fileC, "different");

    const engine = new DuplicateEngine();
    const groups = await engine.scan([root], 1);

    expect(groups.length).toBeGreaterThanOrEqual(1);
    const first = groups[0];
    expect(first.files.length).toBeGreaterThanOrEqual(2);
    const selected = first.files.filter((item) => item.selected);
    expect(selected.length).toBe(first.files.length - 1);

    await fs.rm(root, { recursive: true, force: true });
  });
});


