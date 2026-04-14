import fs from "fs/promises";
import os from "os";
import path from "path";
import { app } from "electron";
import { randomUUID } from "crypto";
import { AppDatabase } from "./db";
import {
  OptimizationActionSuggestion,
  OptimizationChangeRecord,
  OptimizationExecutionResult,
  OptimizationPreviewResponse
} from "./types";
import { getRunKeyPath } from "./windowsSources/registrySource";
import { runPowerShell } from "./windowsSources/powershell";

interface OptimizationManagerDependencies {
  db: AppDatabase;
}

interface StartupEntryOriginalState {
  kind: "registry_run" | "startup_folder";
  hive?: "HKLM" | "HKCU";
  name?: string;
  command?: string;
  originalPath?: string;
  backupPath?: string;
  taskName?: string;
}

function toPowerShellStringLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function splitCommandLine(command: string): { executable: string; arguments?: string } {
  const normalized = command.trim();
  if (!normalized) {
    return { executable: "" };
  }

  const quoted = normalized.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted) {
    const executable = quoted[1]?.trim() ?? "";
    const argumentsText = quoted[2]?.trim();
    return {
      executable,
      arguments: argumentsText ? argumentsText : undefined
    };
  }

  const unquoted = normalized.match(/^(\S+)\s*(.*)$/);
  return {
    executable: unquoted?.[1]?.trim() ?? "",
    arguments: unquoted?.[2]?.trim() || undefined
  };
}

function splitScheduledTaskPath(taskPath: string): { taskFolder: string; taskName: string } {
  const normalized = taskPath.replace(/\//g, "\\").trim();
  const separatorIndex = normalized.lastIndexOf("\\");
  if (separatorIndex <= 0) {
    return {
      taskFolder: "\\",
      taskName: normalized.replace(/^\\+/, "")
    };
  }

  return {
    taskFolder: normalized.slice(0, separatorIndex + 1),
    taskName: normalized.slice(separatorIndex + 1)
  };
}

export class OptimizationManager {
  private db: AppDatabase;
  private readonly startupBackupRoot: string;

  constructor(deps: OptimizationManagerDependencies) {
    this.db = deps.db;
    this.startupBackupRoot = path.join(app.getPath("userData"), "startup-backups");
  }

  preview(actions: OptimizationActionSuggestion[]): OptimizationPreviewResponse {
    const blockedCount = actions.filter((item) => item.blocked).length;
    const allowed = actions.filter((item) => !item.blocked);
    return {
      actions,
      blockedCount,
      reversibleCount: allowed.length,
      estimatedStartupSavingsMs: allowed.reduce((sum, item) => sum + item.estimatedBenefitScore * 25, 0),
      estimatedBackgroundCpuSavingsPct: Math.round(allowed.reduce((sum, item) => sum + item.estimatedBenefitScore * 0.08, 0) * 10) / 10,
      estimatedBackgroundRamSavingsBytes: allowed.reduce((sum, item) => sum + item.estimatedBenefitScore * 8 * 1024 * 1024, 0),
      warnings: blockedCount ? ["Some actions are blocked and will be ignored."] : []
    };
  }

  async execute(actions: OptimizationActionSuggestion[]): Promise<OptimizationExecutionResult> {
    const changeIds: string[] = [];
    const warnings: string[] = [];
    let appliedCount = 0;
    let failedCount = 0;

    for (const action of actions.filter((item) => !item.blocked)) {
      try {
        const change = await this.applyAction(action);
        this.db.addOptimizationChange(change);
        changeIds.push(change.id);
        appliedCount += 1;
      } catch (error) {
        failedCount += 1;
        warnings.push(error instanceof Error ? error.message : "Optimization action failed.");
      }
    }

    return { appliedCount, failedCount, changeIds, warnings };
  }

  listHistory(limit = 50): OptimizationChangeRecord[] {
    return this.db.listOptimizationChanges(limit);
  }

  async restore(changeIds: string[]): Promise<{ restoredCount: number; failed: string[] }> {
    let restoredCount = 0;
    const failed: string[] = [];

    for (const changeId of changeIds) {
      const record = this.db.getOptimizationChange(changeId);
      if (!record) {
        failed.push(changeId);
        continue;
      }
      try {
        await this.restoreChange(record);
        this.db.markOptimizationChangeReverted(changeId, Date.now());
        restoredCount += 1;
      } catch {
        failed.push(changeId);
      }
    }

    return { restoredCount, failed };
  }

  private async applyAction(action: OptimizationActionSuggestion): Promise<OptimizationChangeRecord> {
    if (action.targetKind === "startup_entry") {
      return this.applyStartupAction(action);
    }
    if (action.targetKind === "service") {
      return this.applyServiceAction(action);
    }
    return this.applyTaskAction(action);
  }

  private async applyStartupAction(action: OptimizationActionSuggestion): Promise<OptimizationChangeRecord> {
    const [source, arg1, ...rest] = action.targetId.split("|");
    if (source === "registry_run") {
      const hive = arg1 as "HKLM" | "HKCU";
      const valueName = rest.join("|");
      const keyPath = getRunKeyPath(hive);
      const currentCommand = await runPowerShell(
        `Get-ItemPropertyValue -Path ${toPowerShellStringLiteral(keyPath)} -Name ${toPowerShellStringLiteral(valueName)} -ErrorAction Stop`
      );
      await runPowerShell(
        `Remove-ItemProperty -Path ${toPowerShellStringLiteral(keyPath)} -Name ${toPowerShellStringLiteral(valueName)} -ErrorAction Stop`
      );

      const originalState: StartupEntryOriginalState = {
        kind: "registry_run",
        hive,
        name: valueName,
        command: currentCommand
      };
      const appliedState: StartupEntryOriginalState = {
        ...originalState
      };

      if (action.action === "delay") {
        const taskName = `CleanupPilot-Delayed-${valueName.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
        const { executable, arguments: argumentsText } = splitCommandLine(currentCommand);
        if (!executable) {
          throw new Error(`Could not parse startup command for delayed task: ${valueName}`);
        }
        const registerTaskScript = [
          `$taskName = ${toPowerShellStringLiteral(taskName)}`,
          `$action = New-ScheduledTaskAction -Execute ${toPowerShellStringLiteral(executable)}${
            argumentsText ? ` -Argument ${toPowerShellStringLiteral(argumentsText)}` : ""
          }`,
          "$trigger = New-ScheduledTaskTrigger -AtLogOn",
          "$trigger.Delay = 'PT1M'",
          "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description 'Cleanup Pilot delayed startup entry' -Force | Out-Null"
        ].join("; ");
        await runPowerShell(registerTaskScript);
        appliedState.taskName = taskName;
      }

      return {
        id: randomUUID(),
        targetKind: action.targetKind,
        targetId: action.targetId,
        action: action.action,
        sourceEngine: "startup",
        originalStateJson: JSON.stringify(originalState),
        appliedStateJson: JSON.stringify(appliedState),
        createdAt: Date.now(),
        appliedAt: Date.now()
      };
    }

    if (source === "startup_folder") {
      const originalPath = [arg1, ...rest].join("|");
      const fileName = path.basename(originalPath);
      const backupDir = path.join(this.startupBackupRoot, os.userInfo().username);
      const backupPath = path.join(backupDir, `${Date.now()}-${fileName}`);
      await fs.mkdir(backupDir, { recursive: true });
      await fs.rename(originalPath, backupPath);
      return {
        id: randomUUID(),
        targetKind: action.targetKind,
        targetId: action.targetId,
        action: action.action,
        sourceEngine: "startup",
        originalStateJson: JSON.stringify({ kind: "startup_folder", originalPath }),
        appliedStateJson: JSON.stringify({ kind: "startup_folder", originalPath, backupPath }),
        createdAt: Date.now(),
        appliedAt: Date.now()
      };
    }

    throw new Error(`Unsupported startup action target: ${action.targetId}`);
  }

  private async applyServiceAction(action: OptimizationActionSuggestion): Promise<OptimizationChangeRecord> {
    const serviceName = action.targetId;
    const startMode = await runPowerShell(
      `(Get-CimInstance Win32_Service -Filter "Name='${serviceName.replace(/'/g, "''")}'").StartMode`
    );
    if (action.action === "disable") {
      await runPowerShell(`Set-Service -Name ${toPowerShellStringLiteral(serviceName)} -StartupType Disabled -ErrorAction Stop`);
    } else if (action.action === "set_manual_start") {
      await runPowerShell(`Set-Service -Name ${toPowerShellStringLiteral(serviceName)} -StartupType Manual -ErrorAction Stop`);
    } else if (action.action === "delay") {
      await runPowerShell(`sc.exe config "${serviceName.replace(/"/g, '""')}" start= delayed-auto`);
    }

    return {
      id: randomUUID(),
      targetKind: action.targetKind,
      targetId: action.targetId,
      action: action.action,
      sourceEngine: "services",
      originalStateJson: JSON.stringify({ startMode }),
      appliedStateJson: JSON.stringify({ serviceName, action: action.action }),
      createdAt: Date.now(),
      appliedAt: Date.now()
    };
  }

  private async applyTaskAction(action: OptimizationActionSuggestion): Promise<OptimizationChangeRecord> {
    const taskPath = action.targetId;
    const { taskFolder, taskName } = splitScheduledTaskPath(taskPath);
    const wasEnabled = await runPowerShell(
      `(Get-ScheduledTask -TaskPath ${toPowerShellStringLiteral(taskFolder)} -TaskName ${toPowerShellStringLiteral(taskName)} -ErrorAction Stop).State`
    );
    if (action.action === "disable") {
      await runPowerShell(
        `Disable-ScheduledTask -TaskPath ${toPowerShellStringLiteral(taskFolder)} -TaskName ${toPowerShellStringLiteral(taskName)} -ErrorAction Stop`
      );
    }

    return {
      id: randomUUID(),
      targetKind: action.targetKind,
      targetId: taskPath,
      action: action.action,
      sourceEngine: "tasks",
      originalStateJson: JSON.stringify({ state: wasEnabled }),
      appliedStateJson: JSON.stringify({ state: "disabled" }),
      createdAt: Date.now(),
      appliedAt: Date.now()
    };
  }

  private async restoreChange(record: OptimizationChangeRecord): Promise<void> {
    if (record.targetKind === "startup_entry") {
      const original = JSON.parse(record.originalStateJson) as StartupEntryOriginalState;
      const applied = JSON.parse(record.appliedStateJson) as StartupEntryOriginalState;
      if (original.kind === "registry_run" && original.hive && original.name && original.command) {
        const keyPath = getRunKeyPath(original.hive);
        await runPowerShell(
          `New-ItemProperty -Path ${toPowerShellStringLiteral(keyPath)} -Name ${toPowerShellStringLiteral(original.name)} -Value ${toPowerShellStringLiteral(original.command)} -PropertyType String -Force`
        );
        if (applied.taskName) {
          await runPowerShell(`schtasks.exe /Delete /TN "${applied.taskName.replace(/"/g, '""')}" /F`);
        }
        return;
      }
      if (original.kind === "startup_folder" && original.originalPath && applied.backupPath) {
        await fs.mkdir(path.dirname(original.originalPath), { recursive: true });
        await fs.rename(applied.backupPath, original.originalPath);
        return;
      }
    }

    if (record.targetKind === "service") {
      const original = JSON.parse(record.originalStateJson) as { startMode?: string };
      const startMode = String(original.startMode ?? "").toLowerCase();
      if (startMode === "auto") {
        await runPowerShell(`Set-Service -Name ${toPowerShellStringLiteral(record.targetId)} -StartupType Automatic -ErrorAction Stop`);
      } else if (startMode.includes("manual") || startMode === "demand") {
        await runPowerShell(`Set-Service -Name ${toPowerShellStringLiteral(record.targetId)} -StartupType Manual -ErrorAction Stop`);
      } else if (startMode.includes("disabled")) {
        await runPowerShell(`Set-Service -Name ${toPowerShellStringLiteral(record.targetId)} -StartupType Disabled -ErrorAction Stop`);
      } else if (startMode.includes("delayed")) {
        await runPowerShell(`sc.exe config "${record.targetId.replace(/"/g, '""')}" start= delayed-auto`);
      }
      return;
    }

    if (record.targetKind === "scheduled_task") {
      const original = JSON.parse(record.originalStateJson) as { state?: string };
      const { taskFolder, taskName } = splitScheduledTaskPath(record.targetId);
      if (String(original.state ?? "").toLowerCase().includes("disabled")) {
        await runPowerShell(
          `Disable-ScheduledTask -TaskPath ${toPowerShellStringLiteral(taskFolder)} -TaskName ${toPowerShellStringLiteral(taskName)} -ErrorAction Stop`
        );
      } else {
        await runPowerShell(
          `Enable-ScheduledTask -TaskPath ${toPowerShellStringLiteral(taskFolder)} -TaskName ${toPowerShellStringLiteral(taskName)} -ErrorAction Stop`
        );
      }
    }
  }
}
