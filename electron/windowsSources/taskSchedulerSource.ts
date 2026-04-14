import { runPowerShellJson } from "./powershell";

export interface ScheduledTaskInfo {
  taskName: string;
  taskPath: string;
  state: string;
  author?: string;
  actions: string[];
  triggers: string[];
}

interface RawScheduledTaskInfo {
  TaskName?: string;
  TaskPath?: string;
  State?: string;
  Author?: string;
  Actions?: Array<{ Execute?: string }>;
  Triggers?: Array<{ TriggerType?: string; Repetition?: { Interval?: string }; Delay?: string }>;
}

export async function listScheduledTasks(): Promise<ScheduledTaskInfo[]> {
  const rows = await runPowerShellJson<RawScheduledTaskInfo[]>(
    [
      "Get-ScheduledTask | Select-Object TaskName,TaskPath,State,Author,Actions,Triggers | ConvertTo-Json -Depth 8 -Compress"
    ].join("; "),
    []
  );

  return rows.map((row) => ({
    taskName: String(row.TaskName ?? "").trim(),
    taskPath: String(row.TaskPath ?? "\\").trim(),
    state: String(row.State ?? "").trim().toLowerCase(),
    author: String(row.Author ?? "").trim() || undefined,
    actions: Array.isArray(row.Actions)
      ? row.Actions.map((item) => String(item?.Execute ?? "").trim()).filter((item) => item.length > 0)
      : [],
    triggers: Array.isArray(row.Triggers)
      ? row.Triggers.map((item) => {
          const trigger = String(item?.TriggerType ?? "unknown");
          const interval = String(item?.Repetition?.Interval ?? "").trim();
          const delay = String(item?.Delay ?? "").trim();
          return [trigger, interval && `interval=${interval}`, delay && `delay=${delay}`].filter(Boolean).join(" ");
        })
      : []
  }));
}
