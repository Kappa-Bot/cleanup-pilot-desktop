import type {
  AppConfig,
  DecisionExecutionProgressEvent,
  DecisionIssueBucket,
  ExecutionSession,
  HomeSummarySnapshot,
  ProductIssueCard,
  SmartCheckRun,
  TopLevelSurface
} from "../../types";

export const surfaceItems: Array<{ id: TopLevelSurface; label: string; hint: string }> = [
  { id: "home", label: "Home", hint: "Decide" },
  { id: "scan", label: "Scan", hint: "Check" },
  { id: "plan", label: "Plan", hint: "Review" },
  { id: "execute", label: "Execute", hint: "Apply" },
  { id: "history", label: "History", hint: "Undo" }
];

export type VisualTheme = "graphite" | "arctic" | "sand" | "midnight" | "onyx";

export const visualThemeItems: Array<{ id: VisualTheme; label: string; summary: string }> = [
  { id: "graphite", label: "Graphite", summary: "Neutral Windows utility" },
  { id: "arctic", label: "Arctic", summary: "Cool high-clarity surface" },
  { id: "sand", label: "Sand", summary: "Warm professional surface" },
  { id: "midnight", label: "Midnight", summary: "Dark focused workspace" },
  { id: "onyx", label: "Onyx", summary: "Deep high-contrast utility" }
];

export const scanStageItems: Array<{ id: "scanning" | "findings" | "grouped"; label: string; hint: string }> = [
  { id: "scanning", label: "Scanning", hint: "Checking cleanup and startup" },
  { id: "findings", label: "Findings", hint: "Collecting safe groups" },
  { id: "grouped", label: "Grouped issues", hint: "Ready to build a plan" }
];

export const executionStageOrder: DecisionExecutionProgressEvent["stage"][] = [
  "preparing",
  "cleanup",
  "optimization",
  "reporting",
  "completed"
];

export const defaultExecutionProgress: DecisionExecutionProgressEvent = {
  executionId: "",
  stage: "preparing",
  percent: 0,
  title: "Preparing plan",
  summary: "Waiting for confirmation.",
  timestamp: Date.now()
};

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDate(value?: number): string {
  if (!value) {
    return "No session yet";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(value);
}

export function safetyCopy(snapshot: HomeSummarySnapshot | null): string {
  if (!snapshot) {
    return "Protection unavailable";
  }
  if (snapshot.safetyState === "attention_needed") {
    return "Blocked items need review";
  }
  if (snapshot.safetyState === "review_needed") {
    return "Some items need review";
  }
  return "Protection is active";
}

export function bottleneckLabel(snapshot: HomeSummarySnapshot | null): string {
  if (!snapshot || snapshot.primaryBottleneck === "unknown") {
    return "No dominant bottleneck";
  }
  return snapshot.primaryBottleneck.replace(/_/g, " ");
}

export function groupScanIssues(run: SmartCheckRun | null): DecisionIssueBucket[] {
  if (!run) {
    return [];
  }
  const allIssues = [
    ...run.cleaner.groupedIssues,
    ...run.optimize.groupedIssues,
    ...run.summary.topIssues,
    ...(run.summary.recommendedIssue ? [run.summary.recommendedIssue] : [])
  ].filter((issue, index, array) => array.findIndex((candidate) => candidate.id === issue.id) === index);

  const grouped = new Map<string, ProductIssueCard[]>();
  for (const issue of allIssues) {
    const bucketId =
      issue.severity === "blocked" || issue.domain === "safety"
        ? "blocked_for_safety"
        : issue.domain === "startup"
          ? "startup_impact"
          : issue.domain === "performance" || issue.domain === "drivers"
            ? "background_load"
            : issue.severity === "safe_win"
              ? "safe_to_clean"
              : "needs_review";
    const list = grouped.get(bucketId) ?? [];
    list.push(issue);
    grouped.set(bucketId, list);
  }

  return [
    ["safe_to_clean", "Safe to clean", "Cleanup wins that can move to quarantine safely."],
    ["needs_review", "Needs review", "Items that deserve a quick human check before planning."],
    ["startup_impact", "Startup impact", "Boot-time drag that is worth trimming."],
    ["background_load", "Background load", "Reversible background pressure worth reducing."],
    ["blocked_for_safety", "Blocked for safety", "Protected paths or binaries held back automatically."]
  ]
    .map(([id, label, summary]) => {
      const issues = grouped.get(id) ?? [];
      if (!issues.length) {
        return null;
      }
      return {
        id: id as DecisionIssueBucket["id"],
        label,
        summary,
        count: issues.length,
        issues
      } satisfies DecisionIssueBucket;
    })
    .filter((bucket): bucket is DecisionIssueBucket => Boolean(bucket));
}

export function executionStageLabel(stage: DecisionExecutionProgressEvent["stage"]): string {
  switch (stage) {
    case "cleanup":
      return "Cleanup";
    case "optimization":
      return "Optimize";
    case "reporting":
      return "Report";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return "Prepare";
  }
}

export function cloneSettings(settings: AppConfig | null): AppConfig | null {
  if (!settings) {
    return null;
  }
  return {
    ...settings,
    defaultCategories: [...settings.defaultCategories],
    customRoots: [...settings.customRoots],
    neverCleanupPaths: [...settings.neverCleanupPaths],
    neverCleanupApps: [...settings.neverCleanupApps],
    driverIgnoredInfNames: [...settings.driverIgnoredInfNames],
    driverIgnoredDeviceIds: [...settings.driverIgnoredDeviceIds],
    driverHiddenSuggestionIds: [...settings.driverHiddenSuggestionIds]
  };
}

export function latestHistoryTitle(historySessions: ExecutionSession[]): string {
  return historySessions[0]?.title ?? "No session";
}
