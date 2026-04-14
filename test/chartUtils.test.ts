import {
  buildUPlotSeriesData,
  downsampleMetricFrames,
  hasRenderableMetricFrames,
  normalizeMetricFrames,
  summarizeMetricFrames
} from "../src/features/performance/components/chartUtils";

describe("chartUtils", () => {
  it("normalizes, sorts, and replaces duplicate timestamps", () => {
    const points = normalizeMetricFrames([
      { capturedAt: 3000, value: 33 },
      { capturedAt: 1000, value: 11 },
      { capturedAt: 2000, value: 22 },
      { capturedAt: 2000, value: 28 }
    ]);

    expect(points).toEqual([
      { capturedAt: 1000, value: 11 },
      { capturedAt: 2000, value: 28 },
      { capturedAt: 3000, value: 33 }
    ]);
  });

  it("preserves spikes while downsampling", () => {
    const points = Array.from({ length: 400 }, (_item, index) => ({
      capturedAt: 1000 + index * 1000,
      value: index === 200 ? 99 : index % 20
    }));

    const reduced = downsampleMetricFrames(points, 120);
    const peak = Math.max(...reduced.map((item) => Number(item.value ?? 0)));

    expect(reduced.length).toBeLessThanOrEqual(120);
    expect(peak).toBe(99);
  });

  it("builds uPlot data with null gaps instead of fake zeros", () => {
    const points = normalizeMetricFrames([
      { capturedAt: 1000, value: 10 },
      { capturedAt: 2000, value: undefined },
      { capturedAt: 3000, value: 30 }
    ]);

    const data = buildUPlotSeriesData(points);

    expect(data[0]).toEqual([1, 2, 3]);
    expect(data[1]).toEqual([10, null, 30]);
    expect(hasRenderableMetricFrames(points)).toBe(true);
    expect(summarizeMetricFrames(points)).toEqual({
      last: 30,
      avg: 20,
      peak: 30
    });
  });
});
