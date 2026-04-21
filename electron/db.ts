import fs from "fs";
import path from "path";
import { app } from "electron";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import { parseJsonPayload } from "./jsonPayload";
import {
  BottleneckType,
  CleanupCategory,
  ExecutionSession,
  OptimizationChangeRecord,
  PerformanceSessionSummary,
  QuarantineItem,
  SchedulerSettings,
  SystemSnapshot,
  SystemSnapshotHistoryPoint
} from "./types";

function toOptionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

function toOptionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export class AppDatabase {
  private SQL!: SqlJsStatic;
  private db!: Database;
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "cleanup-pilot.sqlite");
  }

  async init(): Promise<void> {
    this.SQL = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm")
    });

    if (fs.existsSync(this.filePath)) {
      const data = fs.readFileSync(this.filePath);
      this.db = new this.SQL.Database(data);
    } else {
      this.db = new this.SQL.Database();
    }

    this.createTables();
    this.save();
  }

  private createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS quarantine_items (
        id TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        quarantine_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        moved_at INTEGER NOT NULL,
        restored_at INTEGER,
        purged_at INTEGER,
        hash TEXT
      );

      CREATE TABLE IF NOT EXISTS scheduler_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        cadence TEXT NOT NULL DEFAULT 'weekly',
        day_of_week INTEGER NOT NULL DEFAULT 6,
        time_text TEXT NOT NULL DEFAULT '10:00',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        detail TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_snapshots (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        primary_bottleneck TEXT NOT NULL,
        cpu_avg_pct REAL,
        ram_used_pct REAL,
        disk_active_pct REAL,
        gpu_pct REAL,
        startup_impact_score REAL,
        snapshot_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS optimization_changes (
        id TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        source_engine TEXT NOT NULL,
        original_state_json TEXT NOT NULL,
        applied_state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_at INTEGER,
        reverted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS performance_sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        sample_interval_ms INTEGER NOT NULL,
        summary_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history_sessions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        summary_json TEXT NOT NULL
      );

      INSERT OR IGNORE INTO scheduler_state (id, enabled, cadence, day_of_week, time_text, updated_at)
      VALUES (1, 0, 'weekly', 6, '10:00', strftime('%s','now') * 1000);
    `);
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.filePath, Buffer.from(data));
  }

  addQuarantineItem(item: QuarantineItem): void {
    this.addQuarantineItems([item]);
  }

  addQuarantineItems(items: QuarantineItem[]): void {
    if (!items.length) {
      return;
    }

    const statement = this.db.prepare(`
      INSERT INTO quarantine_items (
        id, original_path, quarantine_path, size_bytes, category, source, moved_at, restored_at, purged_at, hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.run("BEGIN TRANSACTION");
    try {
      for (const item of items) {
        statement.run([
          item.id,
          item.originalPath,
          item.quarantinePath,
          item.sizeBytes,
          item.category,
          item.source,
          item.movedAt,
          item.restoredAt ?? null,
          item.purgedAt ?? null,
          item.hash ?? null
        ]);
      }
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      statement.free();
      throw error;
    }
    statement.free();
    this.save();
  }

  private mapQuarantineRows(rows: unknown[][]): QuarantineItem[] {
    return rows.map((row) => {
      const [
        id,
        originalPath,
        quarantinePath,
        sizeBytes,
        category,
        source,
        movedAt,
        restoredAt,
        purgedAt,
        hash
      ] = row;
      return {
        id: String(id),
        originalPath: String(originalPath),
        quarantinePath: String(quarantinePath),
        sizeBytes: Number(sizeBytes),
        category: String(category) as CleanupCategory,
        source: String(source) as "scan" | "duplicate",
        movedAt: Number(movedAt),
        restoredAt: toOptionalNumber(restoredAt),
        purgedAt: toOptionalNumber(purgedAt),
        hash: toOptionalString(hash)
      };
    });
  }

  listQuarantineItems(limit?: number, offset = 0): QuarantineItem[] {
    const boundedLimit = limit === undefined ? undefined : Math.max(1, Math.floor(limit));
    const boundedOffset = Math.max(0, Math.floor(offset));
    const result =
      boundedLimit === undefined
        ? this.db.exec(`
      SELECT id, original_path, quarantine_path, size_bytes, category, source, moved_at, restored_at, purged_at, hash
      FROM quarantine_items
      ORDER BY moved_at DESC
    `)
        : this.db.exec(
            `
      SELECT id, original_path, quarantine_path, size_bytes, category, source, moved_at, restored_at, purged_at, hash
      FROM quarantine_items
      ORDER BY moved_at DESC
      LIMIT ? OFFSET ?
    `,
            [boundedLimit, boundedOffset]
          );

    if (!result.length) {
      return [];
    }

    return this.mapQuarantineRows(result[0].values as unknown[][]);
  }

  listPurgeableQuarantineItems(threshold: number): QuarantineItem[] {
    const result = this.db.exec(
      `
      SELECT id, original_path, quarantine_path, size_bytes, category, source, moved_at, restored_at, purged_at, hash
      FROM quarantine_items
      WHERE restored_at IS NULL
        AND purged_at IS NULL
        AND moved_at <= ?
      ORDER BY moved_at ASC
    `,
      [threshold]
    );

    if (!result.length) {
      return [];
    }

    return this.mapQuarantineRows(result[0].values as unknown[][]);
  }

  countQuarantineItems(): number {
    const result = this.db.exec(`SELECT COUNT(*) FROM quarantine_items`);
    return Number(result[0]?.values?.[0]?.[0] ?? 0);
  }

  countActiveQuarantineItems(): number {
    const result = this.db.exec(`
      SELECT COUNT(*)
      FROM quarantine_items
      WHERE restored_at IS NULL
        AND purged_at IS NULL
    `);
    return Number(result[0]?.values?.[0]?.[0] ?? 0);
  }

  getQuarantineItem(id: string): QuarantineItem | null {
    const statement = this.db.prepare(`
      SELECT id, original_path, quarantine_path, size_bytes, category, source, moved_at, restored_at, purged_at, hash
      FROM quarantine_items
      WHERE id = ?
      LIMIT 1
    `);

    statement.bind([id]);
    if (!statement.step()) {
      statement.free();
      return null;
    }

    const [
      rowId,
      originalPath,
      quarantinePath,
      sizeBytes,
      category,
      source,
      movedAt,
      restoredAt,
      purgedAt,
      hash
    ] = statement.get();
    statement.free();

    return {
      id: String(rowId),
      originalPath: String(originalPath),
      quarantinePath: String(quarantinePath),
      sizeBytes: Number(sizeBytes),
      category: String(category) as CleanupCategory,
      source: String(source) as "scan" | "duplicate",
      movedAt: Number(movedAt),
      restoredAt: toOptionalNumber(restoredAt),
      purgedAt: toOptionalNumber(purgedAt),
      hash: toOptionalString(hash)
    };
  }

  markQuarantineRestored(id: string, restoredAt: number): void {
    this.db.run(
      `
      UPDATE quarantine_items
      SET restored_at = ?
      WHERE id = ?
    `,
      [restoredAt, id]
    );
    this.save();
  }

  markQuarantinePurged(id: string, purgedAt: number): void {
    this.db.run(
      `
      UPDATE quarantine_items
      SET purged_at = ?
      WHERE id = ?
    `,
      [purgedAt, id]
    );
    this.save();
  }

  markQuarantinePurgedBatch(itemIds: string[], purgedAt: number): void {
    if (!itemIds.length) {
      return;
    }

    const statement = this.db.prepare(`
      UPDATE quarantine_items
      SET purged_at = ?
      WHERE id = ?
    `);

    this.db.run("BEGIN TRANSACTION");
    try {
      for (const id of itemIds) {
        statement.run([purgedAt, id]);
      }
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      statement.free();
      throw error;
    }

    statement.free();
    this.save();
  }

  setSchedulerState(settings: SchedulerSettings): void {
    this.db.run(
      `
      UPDATE scheduler_state
      SET enabled = ?, cadence = ?, day_of_week = ?, time_text = ?, updated_at = ?
      WHERE id = 1
    `,
      [settings.enabled ? 1 : 0, settings.cadence, settings.dayOfWeek, settings.time, Date.now()]
    );
    this.save();
  }

  getSchedulerState(): SchedulerSettings {
    const result = this.db.exec(`
      SELECT enabled, cadence, day_of_week, time_text
      FROM scheduler_state
      WHERE id = 1
      LIMIT 1
    `);

    if (!result.length || !result[0].values.length) {
      return {
        enabled: false,
        cadence: "weekly",
        dayOfWeek: 6,
        time: "10:00"
      };
    }

    const [enabled, cadence, dayOfWeek, time] = result[0].values[0];
    return {
      enabled: Number(enabled) === 1,
      cadence: String(cadence) === "weekly" ? "weekly" : "weekly",
      dayOfWeek: Math.max(0, Math.min(6, Number(dayOfWeek))),
      time: String(time ?? "10:00")
    };
  }

  log(action: string, detail: string): void {
    this.db.run(
      `
      INSERT INTO audit_log (action, detail, created_at)
      VALUES (?, ?, ?)
    `,
      [action, detail, Date.now()]
    );
    this.save();
  }

  addSystemSnapshot(snapshot: SystemSnapshot): void {
    this.db.run(
      `
      INSERT OR REPLACE INTO system_snapshots (
        id, source, created_at, primary_bottleneck, cpu_avg_pct, ram_used_pct, disk_active_pct, gpu_pct, startup_impact_score, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        snapshot.id,
        snapshot.source,
        snapshot.createdAt,
        snapshot.bottleneck.primary,
        snapshot.cpu.avgUsagePct,
        snapshot.memory.usedPct,
        snapshot.diskIo.activeTimePct,
        snapshot.gpu.totalUsagePct ?? null,
        snapshot.startup.impactScore,
        JSON.stringify(snapshot)
      ]
    );
    this.save();
  }

  getSystemSnapshot(id: string): SystemSnapshot | null {
    const result = this.db.exec(
      `
      SELECT snapshot_json
      FROM system_snapshots
      WHERE id = ?
      LIMIT 1
    `,
      [id]
    );
    const raw = result[0]?.values?.[0]?.[0];
    if (!raw) {
      return null;
    }
    try {
      return parseJsonPayload<SystemSnapshot>(String(raw), "Stored system snapshot");
    } catch {
      return null;
    }
  }

  listSystemSnapshotHistory(args?: { limit?: number; from?: number; to?: number }): SystemSnapshotHistoryPoint[] {
    const clauses: string[] = [];
    const params: Array<number | string> = [];

    if (args?.from !== undefined) {
      clauses.push("created_at >= ?");
      params.push(args.from);
    }

    if (args?.to !== undefined) {
      clauses.push("created_at <= ?");
      params.push(args.to);
    }

    let query = `
      SELECT id, source, created_at, primary_bottleneck, cpu_avg_pct, ram_used_pct, disk_active_pct, gpu_pct, startup_impact_score
      FROM system_snapshots
    `;

    if (clauses.length) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }

    query += " ORDER BY created_at DESC";

    if (args?.limit !== undefined) {
      query += " LIMIT ?";
      params.push(Math.max(1, Math.floor(args.limit)));
    }

    const result = this.db.exec(query, params);
    const rows = (result[0]?.values ?? []) as unknown[][];
    return rows.map((row) => ({
      id: String(row[0]),
      source: String(row[1]) as SystemSnapshot["source"],
      createdAt: Number(row[2]),
      primaryBottleneck: String(row[3]) as BottleneckType,
      cpuAvgPct: toOptionalNumber(row[4]),
      ramUsedPct: toOptionalNumber(row[5]),
      diskActivePct: toOptionalNumber(row[6]),
      gpuPct: toOptionalNumber(row[7]),
      startupImpactScore: toOptionalNumber(row[8])
    }));
  }

  purgeSystemSnapshotsOlderThan(thresholdMs: number): number {
    this.db.run(`DELETE FROM system_snapshots WHERE created_at < ?`, [thresholdMs]);
    const changed = this.db.getRowsModified();
    this.save();
    return changed;
  }

  addOptimizationChange(change: OptimizationChangeRecord): void {
    this.db.run(
      `
      INSERT OR REPLACE INTO optimization_changes (
        id, target_kind, target_id, action, source_engine, original_state_json, applied_state_json, created_at, applied_at, reverted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        change.id,
        change.targetKind,
        change.targetId,
        change.action,
        change.sourceEngine,
        change.originalStateJson,
        change.appliedStateJson,
        change.createdAt,
        change.appliedAt ?? null,
        change.revertedAt ?? null
      ]
    );
    this.save();
  }

  listOptimizationChanges(limit = 50): OptimizationChangeRecord[] {
    const result = this.db.exec(
      `
      SELECT id, target_kind, target_id, action, source_engine, original_state_json, applied_state_json, created_at, applied_at, reverted_at
      FROM optimization_changes
      ORDER BY created_at DESC
      LIMIT ?
    `,
      [Math.max(1, Math.floor(limit))]
    );
    const rows = (result[0]?.values ?? []) as unknown[][];
    return rows.map((row) => ({
      id: String(row[0]),
      targetKind: String(row[1]) as OptimizationChangeRecord["targetKind"],
      targetId: String(row[2]),
      action: String(row[3]) as OptimizationChangeRecord["action"],
      sourceEngine: String(row[4]) as OptimizationChangeRecord["sourceEngine"],
      originalStateJson: String(row[5]),
      appliedStateJson: String(row[6]),
      createdAt: Number(row[7]),
      appliedAt: toOptionalNumber(row[8]),
      revertedAt: toOptionalNumber(row[9])
    }));
  }

  getOptimizationChange(id: string): OptimizationChangeRecord | null {
    const result = this.db.exec(
      `
      SELECT id, target_kind, target_id, action, source_engine, original_state_json, applied_state_json, created_at, applied_at, reverted_at
      FROM optimization_changes
      WHERE id = ?
      LIMIT 1
    `,
      [id]
    );
    const row = result[0]?.values?.[0] as unknown[] | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row[0]),
      targetKind: String(row[1]) as OptimizationChangeRecord["targetKind"],
      targetId: String(row[2]),
      action: String(row[3]) as OptimizationChangeRecord["action"],
      sourceEngine: String(row[4]) as OptimizationChangeRecord["sourceEngine"],
      originalStateJson: String(row[5]),
      appliedStateJson: String(row[6]),
      createdAt: Number(row[7]),
      appliedAt: toOptionalNumber(row[8]),
      revertedAt: toOptionalNumber(row[9])
    };
  }

  markOptimizationChangeReverted(id: string, revertedAt: number): void {
    this.db.run(
      `
      UPDATE optimization_changes
      SET reverted_at = ?
      WHERE id = ?
    `,
      [revertedAt, id]
    );
    this.save();
  }

  purgeOptimizationChangesOlderThan(thresholdMs: number): number {
    this.db.run(`DELETE FROM optimization_changes WHERE created_at < ?`, [thresholdMs]);
    const changed = this.db.getRowsModified();
    this.save();
    return changed;
  }

  addPerformanceSession(summary: PerformanceSessionSummary): void {
    this.db.run(
      `
      INSERT OR REPLACE INTO performance_sessions (
        id, started_at, ended_at, sample_interval_ms, summary_json
      ) VALUES (?, ?, ?, ?, ?)
    `,
      [summary.id, summary.startedAt, summary.endedAt, summary.sampleIntervalMs, JSON.stringify(summary)]
    );
    this.save();
  }

  addHistorySession(session: ExecutionSession): void {
    this.db.run(
      `
      INSERT OR REPLACE INTO history_sessions (
        id, kind, status, started_at, completed_at, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      [session.id, session.kind, session.status, session.startedAt, session.completedAt ?? null, JSON.stringify(session)]
    );
    this.save();
  }

  getHistorySession(id: string): ExecutionSession | null {
    const result = this.db.exec(
      `
      SELECT summary_json
      FROM history_sessions
      WHERE id = ?
      LIMIT 1
    `,
      [id]
    );
    const raw = result[0]?.values?.[0]?.[0];
    if (!raw) {
      return null;
    }
    try {
      return parseJsonPayload<ExecutionSession>(String(raw), "Stored history session");
    } catch {
      return null;
    }
  }

  listHistorySessions(limit = 50): ExecutionSession[] {
    const result = this.db.exec(
      `
      SELECT summary_json
      FROM history_sessions
      ORDER BY started_at DESC
      LIMIT ?
    `,
      [Math.max(1, Math.floor(limit))]
    );
    const rows = (result[0]?.values ?? []) as unknown[][];
    return rows
      .map((row) => {
        try {
          return parseJsonPayload<ExecutionSession>(String(row[0]), "Stored history session");
        } catch {
          return null;
        }
      })
      .filter((item): item is ExecutionSession => Boolean(item));
  }

  purgePerformanceSessionsOlderThan(thresholdMs: number): number {
    this.db.run(`DELETE FROM performance_sessions WHERE ended_at < ?`, [thresholdMs]);
    const changed = this.db.getRowsModified();
    this.save();
    return changed;
  }
}
