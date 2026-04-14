import fs from "fs";
import path from "path";
import { collectInstalledApps } from "./installedApps";
import {
  OptimizationActionSuggestion,
  ProcessSample,
  StartupAnalysisSummary,
  StartupEntry
} from "./types";
import { listBootDrivers } from "./windowsSources/driverSource";
import { getLatestBootPerformance } from "./windowsSources/eventLogSource";
import { listRegistryRunEntries } from "./windowsSources/registrySource";
import { listServices } from "./windowsSources/serviceSource";
import { listStartupFolderEntries } from "./windowsSources/startupFolderSource";
import { listScheduledTasks } from "./windowsSources/taskSchedulerSource";

function extractCommandTarget(command?: string): string {
  if (!command) {
    return "";
  }
  return command.replace(/^"/, "").split("\" ")[0].trim();
}

function basenameForCommand(command?: string): string {
  return path.basename(extractCommandTarget(command)).toLowerCase();
}

function estimateImpact(source: StartupEntry["source"], runningProcess?: ProcessSample, orphan = false): number {
  const base =
    source === "boot_driver"
      ? 35
      : source === "service"
        ? 25
        : source === "scheduled_task"
          ? 18
          : source === "registry_run"
            ? 12
            : source === "startup_folder"
              ? 10
              : 8;
  const cpuAmplifier = Math.round(Number(runningProcess?.cpuPct ?? 0) * 0.35);
  const memoryAmplifier = Number(runningProcess?.workingSetBytes ?? 0) > 500 * 1024 * 1024 ? 8 : 0;
  const orphanPenalty = orphan ? 10 : 0;
  return Math.max(0, Math.min(100, base + cpuAmplifier + memoryAmplifier + orphanPenalty));
}

function classifyEntry(impactScore: number, orphan: boolean, inspectOnly: boolean): StartupEntry["classification"] {
  if (inspectOnly) {
    return "inspect_only";
  }
  if (orphan) {
    return "orphan";
  }
  if (impactScore >= 65) {
    return "high_impact";
  }
  return "normal";
}

export class StartupAnalyzer {
  async scan(activeProcesses: ProcessSample[] = []): Promise<{
    entries: StartupEntry[];
    summary: StartupAnalysisSummary;
    suggestedActions: OptimizationActionSuggestion[];
  }> {
    const [registryEntries, startupFolderEntries, tasks, services, bootDrivers, bootEvent, installedApps] = await Promise.all([
      listRegistryRunEntries(),
      listStartupFolderEntries(),
      listScheduledTasks(),
      listServices(),
      listBootDrivers(),
      getLatestBootPerformance(),
      collectInstalledApps()
    ]);

    const runningByName = new Map(activeProcesses.map((item) => [item.processName.toLowerCase(), item]));
    const installedNames = installedApps.map((item) => item.name.toLowerCase());
    const entries: StartupEntry[] = [];

    for (const item of registryEntries) {
      const binaryName = basenameForCommand(item.command);
      const runningProcess = runningByName.get(binaryName.replace(/\.exe$/, ""));
      const targetCommand = extractCommandTarget(item.command);
      const orphan = !fs.existsSync(targetCommand) && !item.command.toLowerCase().includes("explorer.exe");
      const impactScore = estimateImpact("registry_run", runningProcess, orphan);
      const matchedInstalledApp = installedNames.find((name) => item.name.toLowerCase().includes(name));
      entries.push({
        id: `registry_run|${item.hive}|${item.name}`,
        optimizationTargetId: `registry_run|${item.hive}|${item.name}`,
        source: "registry_run",
        name: item.name,
        command: item.command,
        targetPath: targetCommand || item.command,
        originLocation: item.keyPath,
        originScope: item.hive,
        originDetails: [
          `Registry value ${item.name}`,
          matchedInstalledApp ? `Matches installed app ${matchedInstalledApp}` : ""
        ].filter(Boolean),
        state: "enabled",
        impactScore,
        estimatedDelayMs: impactScore * 90,
        classification: classifyEntry(impactScore, orphan, false),
        reasoning: orphan ? ["Registry startup target is missing"] : ["Registry autorun entry"],
        reversible: true,
        actionSupport: ["disable", "delay", "restore", "open_location"]
      });
    }

    for (const item of startupFolderEntries) {
      const resolvedTarget = item.targetPath ?? item.shortcutPath;
      const runningProcess = runningByName.get(path.basename(resolvedTarget).toLowerCase().replace(/\.exe$/, ""));
      const orphan = item.isShortcut ? !item.targetPath || !fs.existsSync(item.targetPath) : !fs.existsSync(item.shortcutPath);
      const impactScore = estimateImpact("startup_folder", runningProcess, orphan);
      entries.push({
        id: `startup_folder|${item.shortcutPath}`,
        optimizationTargetId: `startup_folder|${item.shortcutPath}`,
        source: "startup_folder",
        name: item.name,
        command: item.command,
        targetPath: resolvedTarget,
        originLocation: path.dirname(item.shortcutPath),
        originScope: item.scope === "all_users" ? "All users startup folder" : "Current user startup folder",
        originDetails: [
          item.isShortcut ? `Shortcut ${item.shortcutPath}` : `Entry ${item.shortcutPath}`,
          item.isShortcut && item.targetPath ? `Target ${item.targetPath}` : "",
          item.isShortcut && !item.targetPath ? "Shortcut target could not be resolved" : "",
          `Modified ${new Date(item.modifiedAt).toLocaleString()}`
        ].filter(Boolean),
        state: "enabled",
        impactScore,
        estimatedDelayMs: impactScore * 75,
        classification: classifyEntry(impactScore, orphan, false),
        reasoning: orphan ? ["Startup folder target is missing"] : [item.isShortcut ? "Startup folder shortcut" : "Startup folder entry"],
        reversible: true,
        actionSupport: ["disable", "restore", "open_location"]
      });
    }

    for (const item of tasks.filter((task) => task.triggers.join(" ").toLowerCase().includes("logon") || task.triggers.join(" ").toLowerCase().includes("boot"))) {
      const taskFullPath = `${item.taskPath}${item.taskName}`;
      const impactScore = estimateImpact("scheduled_task");
      entries.push({
        id: `scheduled_task|${taskFullPath}`,
        optimizationTargetId: taskFullPath,
        source: "scheduled_task",
        name: item.taskName,
        command: item.actions[0],
        targetPath: item.actions[0],
        originLocation: taskFullPath,
        originScope: item.author,
        originDetails: [...item.triggers.slice(0, 3), ...item.actions.slice(0, 2)].filter(Boolean),
        state: item.state === "disabled" ? "disabled" : "enabled",
        impactScore,
        estimatedDelayMs: impactScore * 95,
        classification: classifyEntry(impactScore, !item.actions.length, false),
        reasoning: ["Task runs at boot or logon"],
        reversible: true,
        actionSupport: ["disable", "open_location", "restore"]
      });
    }

    for (const item of services.filter((service) => service.startMode.toLowerCase().includes("auto"))) {
      const binaryPath = item.binaryPath ?? "";
      const microsoft = item.displayName.toLowerCase().includes("microsoft") || binaryPath.toLowerCase().includes("\\windows\\system32\\");
      const orphan = binaryPath.length > 0 && !fs.existsSync(binaryPath.replace(/^"/, "").split("\" ")[0]);
      const impactScore = estimateImpact("service", undefined, orphan);
      const matchedInstalledApp = installedNames.find((name) => item.displayName.toLowerCase().includes(name));
      entries.push({
        id: `service|${item.serviceName}`,
        optimizationTargetId: item.serviceName,
        source: "service",
        name: item.displayName,
        command: binaryPath || undefined,
        targetPath: binaryPath || undefined,
        originLocation: binaryPath || item.serviceName,
        originScope: item.startName,
        originDetails: [
          `Service name ${item.serviceName}`,
          `Start mode ${item.startMode}`,
          matchedInstalledApp ? `Matches installed app ${matchedInstalledApp}` : ""
        ].filter(Boolean),
        state: item.startMode.toLowerCase().includes("disable") ? "disabled" : item.startMode.toLowerCase().includes("delayed") ? "delayed" : "enabled",
        impactScore,
        estimatedDelayMs: impactScore * 110,
        classification: microsoft ? "essential" : classifyEntry(impactScore, orphan, false),
        reasoning: microsoft ? ["Microsoft service"] : ["Service starts with Windows"],
        reversible: !microsoft,
        actionSupport: microsoft ? ["open_location"] : ["disable", "delay", "open_location", "restore"]
      });
    }

    for (const item of bootDrivers) {
      entries.push({
        id: `boot_driver|${item.name}`,
        optimizationTargetId: item.name,
        source: "boot_driver",
        name: item.displayName ?? item.name,
        command: item.pathName,
        targetPath: item.pathName,
        originLocation: item.pathName,
        originScope: item.startMode,
        originDetails: [item.state ? `State ${item.state}` : ""].filter(Boolean),
        state: "enabled",
        impactScore: estimateImpact("boot_driver"),
        estimatedDelayMs: 350,
        classification: "inspect_only",
        reasoning: ["Boot or system driver"],
        reversible: false,
        actionSupport: ["open_location"]
      });
    }

    const suggestedActions: OptimizationActionSuggestion[] = entries
      .filter((item) => item.reversible && (item.classification === "high_impact" || item.classification === "orphan"))
      .map((item) => ({
        id: `startup-${item.id}-disable`,
        targetKind: "startup_entry" as const,
        targetId: item.optimizationTargetId,
        action: item.source === "registry_run" && item.classification === "high_impact" ? "delay" : "disable",
        title: `${item.classification === "high_impact" ? "Reduce startup impact for" : "Disable"} ${item.name}`,
        summary: item.reasoning.join(". "),
        risk: item.classification === "orphan" ? "low" : "medium",
        reversible: true,
        blocked: false,
        estimatedBenefitScore: item.impactScore
      }));

    const impactScore = Math.max(0, Math.min(100, Math.round(entries.reduce((sum, item) => sum + item.impactScore, 0) / Math.max(1, entries.length))));
    const bootTimeMs = bootEvent?.bootTimeMs ?? 48_000;
    const timeline = [
      { id: "bios" as const, label: "Firmware / BIOS", durationMs: Math.round((bootTimeMs * 0.08)), estimated: !bootEvent?.bootTimeMs },
      { id: "kernel" as const, label: "Kernel", durationMs: Math.round((bootTimeMs * 0.12)), estimated: !bootEvent?.bootTimeMs },
      { id: "drivers" as const, label: "Drivers", durationMs: Math.round((bootTimeMs * 0.18)), estimated: !bootEvent?.bootTimeMs },
      { id: "services" as const, label: "Services", durationMs: Math.round((bootTimeMs * 0.22)), estimated: !bootEvent?.bootTimeMs },
      { id: "startup_apps" as const, label: "Startup Apps", durationMs: Math.round((bootTimeMs * 0.2)), estimated: !bootEvent?.bootTimeMs },
      { id: "desktop_ready" as const, label: "Desktop Ready", durationMs: Math.round((bootTimeMs * 0.2)), estimated: !bootEvent?.bootTimeMs }
    ];

    return {
      entries: entries.sort((left, right) => right.impactScore - left.impactScore),
      summary: {
        impactScore,
        estimatedBootDelayMs: entries.reduce((sum, item) => sum + item.estimatedDelayMs, 0),
        highImpactCount: entries.filter((item) => item.classification === "high_impact").length,
        redundantCount: entries.filter((item) => item.classification === "redundant").length,
        orphanCount: entries.filter((item) => item.classification === "orphan").length,
        inspectOnlyCount: entries.filter((item) => item.classification === "inspect_only").length,
        timeline
      },
      suggestedActions
    };
  }
}
