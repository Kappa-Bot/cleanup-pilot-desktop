import fs from "fs/promises";
import os from "os";
import path from "path";
import { CleanupEngine } from "../electron/cleanupEngine";
import { QuarantineBatchEntry, QuarantineManager } from "../electron/quarantineManager";
import { ScanFinding } from "../electron/types";

describe("CleanupEngine", () => {
  it("computes preview totals and blocked items", async () => {
    const findings: ScanFinding[] = [
      {
        id: "a",
        path: "C:\\Windows\\temp\\x.log",
        category: "logs",
        sizeBytes: 100,
        risk: "high",
        reason: "x",
        sourceRuleId: "logs",
        selectedByDefault: false,
        modifiedAt: Date.now()
      },
      {
        id: "b",
        path: "C:\\Users\\u\\AppData\\Local\\Temp\\y.tmp",
        category: "temp",
        sizeBytes: 300,
        risk: "low",
        reason: "x",
        sourceRuleId: "temp-path",
        selectedByDefault: true,
        modifiedAt: Date.now()
      }
    ];

    const preview = await new CleanupEngine().preview(findings, ["a", "b"]);
    expect(preview.totalBytes).toBe(400);
    expect(preview.actionCount).toBe(2);
    expect(preview.riskFlags.highRiskCount).toBe(1);
    expect(preview.riskFlags.blockedCount).toBe(1);
  });

  it("blocks never-cleanup allowlist paths in preview and execution", async () => {
    const engine = new CleanupEngine({
      resolveProtectionPreferences: async () => ({
        neverCleanupPaths: ["C:\\Users\\u\\Projects\\SafeKeep"],
        neverCleanupApps: []
      })
    });
    const findings: ScanFinding[] = [
      {
        id: "safe-1",
        path: "C:\\Users\\u\\Projects\\SafeKeep\\cache.tmp",
        category: "temp",
        sizeBytes: 128,
        risk: "low",
        reason: "x",
        sourceRuleId: "temp-path",
        selectedByDefault: false,
        modifiedAt: Date.now()
      }
    ];

    const preview = await engine.preview(findings, ["safe-1"]);
    expect(preview.riskFlags.blockedCount).toBe(1);

    const manager = {
      quarantineDirectory: jest.fn(async () => []),
      quarantineFilesBatch: jest.fn(async () => ({ moved: [], failed: [] }))
    } as unknown as QuarantineManager;

    const result = await engine.execute(findings, ["safe-1"], manager, {
      runId: "run-safe",
      executionId: "exec-safe"
    });

    expect(result.movedCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  it("uses directory bulk quarantine when every file in folder is selected", async () => {
    const engine = new CleanupEngine();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-bulk-"));
    const targetDir = path.join(root, "cache-pack");
    await fs.mkdir(targetDir, { recursive: true });

    const findings: ScanFinding[] = [];
    const total = 24;
    for (let index = 0; index < total; index += 1) {
      const filePath = path.join(targetDir, `item-${index}.tmp`);
      await fs.writeFile(filePath, "x".repeat(index + 1));
      findings.push({
        id: `id-${index}`,
        path: filePath,
        category: "temp",
        sizeBytes: index + 1,
        risk: "low",
        reason: "temp",
        sourceRuleId: "temp-path",
        selectedByDefault: true,
        modifiedAt: Date.now()
      });
    }

    const quarantineDirectory = jest.fn(async () => []);
    const quarantineFilesBatch = jest.fn(async () => ({ moved: [], failed: [] }));
    const manager = {
      quarantineDirectory,
      quarantineFilesBatch
    } as unknown as QuarantineManager;

    const result = await engine.execute(
      findings,
      findings.map((item) => item.id),
      manager,
      {
        runId: "run-1",
        executionId: "exec-1"
      }
    );

    expect(quarantineDirectory).toHaveBeenCalledTimes(1);
    expect(quarantineFilesBatch).not.toHaveBeenCalled();
    expect(result.movedCount).toBe(total);
    expect(result.failedCount).toBe(0);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("uses direct directory findings as single bulk plans", async () => {
    const engine = new CleanupEngine();
    const finding: ScanFinding = {
      id: "dir-aggregate",
      path: "C:\\Users\\u\\AppData\\Local\\Temp\\cache-pack",
      category: "temp",
      sizeBytes: 4096,
      risk: "low",
      reason: "Temporary folder container",
      sourceRuleId: "temp-container",
      selectedByDefault: true,
      modifiedAt: Date.now(),
      kind: "directory",
      entryCount: 18
    };

    const quarantineDirectory = jest.fn(async () => []);
    const quarantineFilesBatch = jest.fn(async () => ({ moved: [], failed: [] }));
    const manager = {
      quarantineDirectory,
      quarantineFilesBatch
    } as unknown as QuarantineManager;

    const result = await engine.execute([finding], [finding.id], manager, {
      runId: "run-dir",
      executionId: "exec-dir"
    });

    expect(quarantineDirectory).toHaveBeenCalledTimes(1);
    expect(quarantineFilesBatch).not.toHaveBeenCalled();
    const directoryCall = quarantineDirectory.mock.calls[0] as unknown[] | undefined;
    const directoryEntries = directoryCall?.[1] as Array<{ filePath: string; entryKind?: string; sizeBytes?: number }> | undefined;
    expect(directoryEntries?.[0]).toMatchObject({
      filePath: finding.path,
      entryKind: "directory",
      sizeBytes: finding.sizeBytes
    });
    expect(result.movedCount).toBe(18);
    expect(result.failedCount).toBe(0);
  });

  it("falls back to file batching when folder has unselected files", async () => {
    const engine = new CleanupEngine();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-batch-"));
    const targetDir = path.join(root, "cache-pack");
    await fs.mkdir(targetDir, { recursive: true });

    const findings: ScanFinding[] = [];
    const total = 24;
    for (let index = 0; index < total; index += 1) {
      const filePath = path.join(targetDir, `item-${index}.tmp`);
      await fs.writeFile(filePath, "x".repeat(index + 1));
      findings.push({
        id: `id-${index}`,
        path: filePath,
        category: "temp",
        sizeBytes: index + 1,
        risk: "low",
        reason: "temp",
        sourceRuleId: "temp-path",
        selectedByDefault: true,
        modifiedAt: Date.now()
      });
    }
    await fs.writeFile(path.join(targetDir, "keep.me"), "do-not-touch");

    const quarantineDirectory = jest.fn(async () => []);
    const quarantineFilesBatch = jest.fn(
      async (
        entries: QuarantineBatchEntry[],
        options?: { onItem?: (event: { entry: QuarantineBatchEntry; success: boolean }) => void }
      ) => {
        for (const entry of entries) {
          options?.onItem?.({ entry, success: true });
        }
        return { moved: [], failed: [] };
      }
    );

    const manager = {
      quarantineDirectory,
      quarantineFilesBatch
    } as unknown as QuarantineManager;

    const result = await engine.execute(
      findings,
      findings.map((item) => item.id),
      manager,
      {
        runId: "run-2",
        executionId: "exec-2"
      }
    );

    expect(quarantineDirectory).not.toHaveBeenCalled();
    expect(quarantineFilesBatch).toHaveBeenCalledTimes(1);
    expect(result.movedCount).toBe(total);
    expect(result.failedCount).toBe(0);

    await fs.rm(root, { recursive: true, force: true });
  });

  it("uses a single elevated batch for deferred permission-denied items", async () => {
    const engine = new CleanupEngine();
    const permissionError = Object.assign(new Error("Access denied"), { code: "EACCES" });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-elevated-"));
    const bulkDir = path.join(root, "cache-pack");
    const logDir = path.join(root, "logs");
    await fs.mkdir(bulkDir, { recursive: true });
    await fs.mkdir(logDir, { recursive: true });

    const findings: ScanFinding[] = [];
    for (let index = 0; index < 24; index += 1) {
      const filePath = path.join(bulkDir, `item-${index}.tmp`);
      await fs.writeFile(filePath, "x".repeat(index + 1));
      findings.push({
        id: `dir-${index}`,
        path: filePath,
        category: "temp",
        sizeBytes: 128 + index,
        risk: "low",
        reason: "temp",
        sourceRuleId: "temp-path",
        selectedByDefault: true,
        modifiedAt: Date.now()
      });
    }

    const logPath = path.join(logDir, "run.log");
    await fs.writeFile(logPath, "log-data");
    findings.push({
      id: "file-1",
      path: logPath,
      category: "logs",
      sizeBytes: 256,
      risk: "low",
      reason: "logs",
      sourceRuleId: "logs",
      selectedByDefault: true,
      modifiedAt: Date.now()
    });

    const quarantineDirectory = jest.fn(async () => {
      throw permissionError;
    });
    const quarantineFilesBatch = jest.fn(
      async (
        entries: QuarantineBatchEntry[],
        options?: {
          onItem?: (event: { entry: QuarantineBatchEntry; success: boolean; error?: Error }) => void;
        }
      ) => {
        for (const entry of entries) {
          options?.onItem?.({
            entry,
            success: false,
            error: permissionError
          });
        }
        return { moved: [], failed: [] };
      }
    );
    const quarantineMixedBatchElevated = jest.fn(async (payload: {
      fileEntries: QuarantineBatchEntry[];
      directoryPlans: Array<{ directoryPath: string; entries: QuarantineBatchEntry[] }>;
    }) => ({
      movedFiles: payload.fileEntries.map((entry, index) => ({
        entry,
        item: {
          id: `file-item-${index}`,
          originalPath: entry.filePath,
          quarantinePath: `C:\\vault\\file-${index}`,
          sizeBytes: entry.sizeBytes ?? 0,
          category: entry.metadata.category,
          source: entry.metadata.source,
          movedAt: Date.now()
        }
      })),
      failedFiles: [],
      movedDirectories: payload.directoryPlans.map((plan, index) => ({
        plan,
        items: plan.entries.map((entry, itemIndex) => ({
          id: `dir-item-${index}-${itemIndex}`,
          originalPath: entry.filePath,
          quarantinePath: `C:\\vault\\dir-${index}-${itemIndex}`,
          sizeBytes: entry.sizeBytes ?? 0,
          category: entry.metadata.category,
          source: entry.metadata.source,
          movedAt: Date.now()
        }))
      })),
      failedDirectories: []
    }));

    const manager = {
      quarantineDirectory,
      quarantineFilesBatch,
      quarantineMixedBatchElevated
    } as unknown as QuarantineManager;

    const result = await engine.execute(
      findings,
      findings.map((item) => item.id),
      manager,
      {
        runId: "run-elevated",
        executionId: "exec-elevated"
      }
    );

    expect(quarantineDirectory).toHaveBeenCalledTimes(1);
    expect(quarantineFilesBatch).toHaveBeenCalledTimes(1);
    expect(quarantineMixedBatchElevated).toHaveBeenCalledTimes(1);
    expect(result.movedCount).toBe(25);
    expect(result.failedCount).toBe(0);

    await fs.rm(root, { recursive: true, force: true });
  });
});
