import {
  PERFORMANCE_TAB_PREFS_KEY,
  buildPerformanceTabPrefsPayload,
  clampPerformanceSampleInterval,
  parsePerformanceTabPrefs
} from "../src/features/performance/performanceTabPrefs";

describe("performanceTabPrefs", () => {
  it("clamps sample intervals into the supported window", () => {
    expect(clampPerformanceSampleInterval(120, 2_000)).toBe(500);
    expect(clampPerformanceSampleInterval(12_345, 2_000)).toBe(12_345);
    expect(clampPerformanceSampleInterval(120_000, 2_000)).toBe(60_000);
  });

  it("parses persisted preferences defensively", () => {
    const prefs = parsePerformanceTabPrefs(
      JSON.stringify({
        autoRecoverEnabled: false,
        preferredSampleIntervalMs: 250,
        showAdvancedControls: true,
        showHeroStrip: false,
        preferredView: "dashboard"
      })
    );

    expect(prefs).toEqual({
      autoRecoverEnabled: false,
      preferredSampleIntervalMs: 500,
      showAdvancedControls: true,
      showHeroStrip: false,
      preferredView: "dashboard"
    });
  });

  it("builds a stable persistence payload", () => {
    expect(
      buildPerformanceTabPrefsPayload({
        autoRecoverEnabled: true,
        preferredSampleIntervalMs: 2_500,
        showAdvancedControls: false,
        showHeroStrip: true,
        preferredView: "processes"
      })
    ).toBe(
      JSON.stringify({
        autoRecoverEnabled: true,
        preferredSampleIntervalMs: 2_500,
        showAdvancedControls: false,
        showHeroStrip: true,
        preferredView: "processes"
      })
    );
    expect(PERFORMANCE_TAB_PREFS_KEY).toBe("cleanup-pilot.performanceTabPrefs.v2");
  });
});
