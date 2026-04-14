import React, { useEffect, useMemo, useRef } from "react";
import {
  MetricFramePoint,
  buildUPlotSeriesData,
  downsampleMetricFrames,
  hasRenderableMetricFrames,
  normalizeMetricFrames,
  summarizeMetricFrames
} from "./chartUtils";

interface MetricLineChartProps {
  title: string;
  frames: MetricFramePoint[];
  color: string;
  unit?: string;
  unsupported?: boolean;
  unsupportedLabel?: string;
}

type UPlotCtor = new (
  options: unknown,
  data: [number[], Array<number | null>],
  target: HTMLElement
) => {
  destroy: () => void;
  setData: (data: [number[], Array<number | null>]) => void;
  setSize: (size: { width: number; height: number }) => void;
};

type UPlotInstance = InstanceType<UPlotCtor>;

const CHART_HEIGHT = 180;
let uPlotModulePromise: Promise<UPlotCtor> | null = null;

function loadUPlot(): Promise<UPlotCtor> {
  if (!uPlotModulePromise) {
    uPlotModulePromise = import("uplot").then((module) => module.default as unknown as UPlotCtor);
  }
  return uPlotModulePromise;
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) {
    return "N/A";
  }
  return unit === "%"
    ? `${Math.round(value)}${unit}`
    : `${value.toFixed(value >= 10 ? 0 : 1)}${unit}`;
}

function buildYRange(series: Array<number | null>, unit: string): [number, number] {
  const numeric = series.filter((value): value is number => value !== null);
  if (!numeric.length) {
    return unit === "%" ? [0, 100] : [0, 1];
  }
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  if (unit === "%") {
    return [0, Math.max(100, Math.ceil(max / 10) * 10)];
  }
  const padding = Math.max(1, (max - min) * 0.18);
  return [Math.max(0, min - padding), max + padding];
}

export function MetricLineChart({
  title,
  frames,
  color,
  unit = "%",
  unsupported = false,
  unsupportedLabel = "Unsupported on this machine."
}: MetricLineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<UPlotInstance | null>(null);
  const renderRef = useRef<(() => void | Promise<void>) | null>(null);
  const normalizedFrames = useMemo(
    () => downsampleMetricFrames(normalizeMetricFrames(frames)),
    [frames]
  );
  const chartData = useMemo(() => buildUPlotSeriesData(normalizedFrames), [normalizedFrames]);
  const summary = useMemo(() => summarizeMetricFrames(normalizedFrames), [normalizedFrames]);
  const hasRenderableData = hasRenderableMetricFrames(normalizedFrames);

  useEffect(() => {
    let disposed = false;

    const mountOrUpdateChart = async () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const width = container.clientWidth || container.parentElement?.clientWidth || 0;
      if (unsupported || !hasRenderableData || width < 40) {
        chartRef.current?.destroy();
        chartRef.current = null;
        return;
      }

      if (!chartRef.current) {
        const UPlot = await loadUPlot();
        if (disposed || !containerRef.current) {
          return;
        }
        chartRef.current = new UPlot(
          {
            width,
            height: CHART_HEIGHT,
            padding: [8, 8, 8, 8],
            legend: { show: false },
            cursor: { drag: { x: false, y: false } },
            scales: {
              x: { time: true },
              y: {
                auto: false,
                range: () => buildYRange(chartData[1], unit)
              }
            },
            axes: [
              { show: false },
              {
                size: 42,
                stroke: "rgba(70, 86, 96, 0.28)",
                grid: { stroke: "rgba(70, 86, 96, 0.12)" },
                values: (_plot: unknown, values: number[]) => values.map((value) => `${Math.round(value)}${unit}`)
              }
            ],
            series: [
              {},
              {
                stroke: color,
                width: 2,
                fill: `${color}22`
              }
            ]
          },
          chartData,
          container
        );
        return;
      }

      chartRef.current.setSize({ width, height: CHART_HEIGHT });
      chartRef.current.setData(chartData);
    };

    renderRef.current = mountOrUpdateChart;
    void mountOrUpdateChart();
    return () => {
      disposed = true;
    };
  }, [chartData, color, unit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameHandle = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frameHandle);
      frameHandle = requestAnimationFrame(() => {
        const run = renderRef.current;
        if (!run) {
          return;
        }
        void run();
      });
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(
    () => () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    },
    []
  );

  return (
    <article className="card performance-chart-card">
      <header className="panel-header compact">
        <div>
          <h3>{title}</h3>
          <span className="muted">{normalizedFrames.length} samples</span>
        </div>
        <div className="performance-chart-meta">
          <span className="muted">Last {formatValue(summary.last, unit)}</span>
          <span className="muted">Avg {formatValue(summary.avg, unit)}</span>
          <span className="muted">Peak {formatValue(summary.peak, unit)}</span>
        </div>
      </header>
      {unsupported ? (
        <div className="performance-chart-empty">
          <strong>{title}</strong>
          <p className="muted">{unsupportedLabel}</p>
        </div>
      ) : hasRenderableData ? (
        <div ref={containerRef} className="performance-chart-canvas" />
      ) : (
        <div className="performance-chart-empty">
          <strong>{title}</strong>
          <p className="muted">Collecting enough live samples to draw this metric.</p>
        </div>
      )}
    </article>
  );
}
