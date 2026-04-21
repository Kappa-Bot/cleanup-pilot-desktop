import type { AppStore } from "../../store";

export type PerformanceView = AppStore["activePerformanceView"];

export interface PerformanceTabPreferences {
  autoRecoverEnabled: boolean;
  preferredSampleIntervalMs: number;
  showAdvancedControls?: boolean;
  showHeroStrip?: boolean;
  preferredView?: PerformanceView;
}

const MIN_SAMPLE_INTERVAL_MS = 500;
const MAX_SAMPLE_INTERVAL_MS = 60_000;

export const PERFORMANCE_TAB_PREFS_KEY = "cleanup-pilot.performanceTabPrefs.v2";

export function clampPerformanceSampleInterval(value: number, fallback: number): number {
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.max(MIN_SAMPLE_INTERVAL_MS, Math.min(MAX_SAMPLE_INTERVAL_MS, Math.round(resolved || fallback)));
}

export function parsePerformanceTabPrefs(raw: string | null): Partial<PerformanceTabPreferences> | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PerformanceTabPreferences>;
    const next: Partial<PerformanceTabPreferences> = {};

    if (typeof parsed.autoRecoverEnabled === "boolean") {
      next.autoRecoverEnabled = parsed.autoRecoverEnabled;
    }
    if (typeof parsed.showAdvancedControls === "boolean") {
      next.showAdvancedControls = parsed.showAdvancedControls;
    }
    if (typeof parsed.showHeroStrip === "boolean") {
      next.showHeroStrip = parsed.showHeroStrip;
    }
    if (
      typeof parsed.preferredSampleIntervalMs === "number" &&
      Number.isFinite(parsed.preferredSampleIntervalMs)
    ) {
      next.preferredSampleIntervalMs = clampPerformanceSampleInterval(parsed.preferredSampleIntervalMs, parsed.preferredSampleIntervalMs);
    }
    if (typeof parsed.preferredView === "string") {
      next.preferredView = parsed.preferredView as PerformanceView;
    }

    return next;
  } catch {
    return null;
  }
}

export function buildPerformanceTabPrefsPayload(input: PerformanceTabPreferences): string {
  return JSON.stringify({
    autoRecoverEnabled: input.autoRecoverEnabled,
    preferredSampleIntervalMs: clampPerformanceSampleInterval(input.preferredSampleIntervalMs, input.preferredSampleIntervalMs),
    showAdvancedControls: Boolean(input.showAdvancedControls),
    showHeroStrip: Boolean(input.showHeroStrip),
    preferredView: input.preferredView
  });
}
