import fs from "fs";
import { OptimizationActionSuggestion, ScheduledTaskDiagnostic, TaskAnalysisSummary } from "./types";
import { listScheduledTasks } from "./windowsSources/taskSchedulerSource";

function isMicrosoftTask(taskPath: string): boolean {
  return taskPath.toLowerCase().startsWith("\\microsoft\\windows\\");
}

function detectFrequency(triggerSummary: string[]): "frequent" | "normal" {
  const haystack = triggerSummary.join(" ").toLowerCase();
  return haystack.includes("pt1m") || haystack.includes("pt5m") || haystack.includes("minute")
    ? "frequent"
    : "normal";
}

function actionExists(actions: string[]): boolean {
  return actions.some((item) => {
    const target = item.replace(/^"/, "").split("\" ")[0].trim();
    return target.length > 0 && fs.existsSync(target);
  });
}

export class TaskSchedulerAnalyzer {
  async scan(): Promise<{
    tasks: ScheduledTaskDiagnostic[];
    summary: TaskAnalysisSummary;
    suggestedActions: OptimizationActionSuggestion[];
  }> {
    const tasks = await listScheduledTasks();

    const diagnostics: ScheduledTaskDiagnostic[] = tasks.map((task) => {
      const microsoftTask = isMicrosoftTask(task.taskPath);
      const frequency = detectFrequency(task.triggers);
      const hasAction = actionExists(task.actions);

      if (microsoftTask) {
        return {
          id: `${task.taskPath}${task.taskName}`,
          taskPath: `${task.taskPath}${task.taskName}`,
          state: task.state === "ready" || task.state === "running" ? "enabled" : "disabled",
          classification: "inspect_only",
          triggerSummary: task.triggers,
          recommendedAction: "inspect",
          reason: ["Microsoft task kept inspect-only"]
        };
      }

      if (!hasAction) {
        return {
          id: `${task.taskPath}${task.taskName}`,
          taskPath: `${task.taskPath}${task.taskName}`,
          state: task.state === "ready" || task.state === "running" ? "enabled" : "disabled",
          classification: "orphan",
          triggerSummary: task.triggers,
          recommendedAction: "disable",
          reason: ["Task action target is missing"]
        };
      }

      if (frequency === "frequent") {
        return {
          id: `${task.taskPath}${task.taskName}`,
          taskPath: `${task.taskPath}${task.taskName}`,
          state: task.state === "ready" || task.state === "running" ? "enabled" : "disabled",
          classification: "suspicious",
          triggerSummary: task.triggers,
          recommendedAction: "disable",
          reason: ["Task runs with very frequent repetition"]
        };
      }

      return {
        id: `${task.taskPath}${task.taskName}`,
        taskPath: `${task.taskPath}${task.taskName}`,
        state: task.state === "ready" || task.state === "running" ? "enabled" : "disabled",
        classification: "optional",
        triggerSummary: task.triggers,
        recommendedAction: "inspect",
        reason: ["Third-party scheduled task"]
      };
    });

    const suggestedActions: OptimizationActionSuggestion[] = diagnostics
      .filter((item) => item.recommendedAction === "disable")
      .map((item) => ({
        id: `task-${item.id}-disable`,
        targetKind: "scheduled_task" as const,
        targetId: item.taskPath,
        action: "disable",
        title: `Disable ${item.taskPath}`,
        summary: item.reason.join(". "),
        risk: item.classification === "orphan" ? "low" : "medium",
        reversible: true,
        blocked: false,
        estimatedBenefitScore: item.classification === "orphan" ? 80 : 65
      }));

    return {
      tasks: diagnostics.sort((left, right) => left.taskPath.localeCompare(right.taskPath)),
      summary: {
        total: diagnostics.length,
        frequentCount: diagnostics.filter((item) => item.classification === "suspicious").length,
        optionalCount: diagnostics.filter((item) => item.classification === "optional").length,
        suspiciousCount: diagnostics.filter((item) => item.classification === "suspicious").length,
        orphanCount: diagnostics.filter((item) => item.classification === "orphan").length,
        inspectOnlyCount: diagnostics.filter((item) => item.classification === "inspect_only").length
      },
      suggestedActions
    };
  }
}
