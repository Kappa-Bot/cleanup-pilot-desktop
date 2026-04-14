export interface MetricFramePoint {
  capturedAt: number;
  value: number | undefined;
}

export interface NormalizedMetricPoint {
  capturedAt: number;
  value: number | null;
}

export interface MetricSummary {
  last: number | null;
  avg: number | null;
  peak: number | null;
}

function isFiniteTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function toMetricValue(value: number | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return Number.isFinite(value) ? value : null;
}

export function normalizeMetricFrames(frames: MetricFramePoint[]): NormalizedMetricPoint[] {
  if (!frames.length) {
    return [];
  }

  const ordered = [...frames]
    .filter((item) => isFiniteTimestamp(item.capturedAt))
    .sort((left, right) => left.capturedAt - right.capturedAt);

  const normalized: NormalizedMetricPoint[] = [];
  for (const item of ordered) {
    const normalizedPoint: NormalizedMetricPoint = {
      capturedAt: item.capturedAt,
      value: toMetricValue(item.value)
    };
    const last = normalized[normalized.length - 1];
    if (last && last.capturedAt === normalizedPoint.capturedAt) {
      normalized[normalized.length - 1] = normalizedPoint;
      continue;
    }
    normalized.push(normalizedPoint);
  }
  return normalized;
}

function dedupeBucket(points: NormalizedMetricPoint[]): NormalizedMetricPoint[] {
  const seen = new Set<number>();
  const next: NormalizedMetricPoint[] = [];
  for (const point of points) {
    if (seen.has(point.capturedAt)) {
      continue;
    }
    seen.add(point.capturedAt);
    next.push(point);
  }
  return next.sort((left, right) => left.capturedAt - right.capturedAt);
}

export function downsampleMetricFrames(
  frames: NormalizedMetricPoint[],
  maxPoints = 240
): NormalizedMetricPoint[] {
  if (frames.length <= maxPoints) {
    return frames;
  }

  const bucketSize = Math.max(2, Math.ceil(frames.length / Math.max(8, Math.floor(maxPoints / 2))));
  const reduced: NormalizedMetricPoint[] = [];

  for (let index = 0; index < frames.length; index += bucketSize) {
    const bucket = frames.slice(index, index + bucketSize);
    if (!bucket.length) {
      continue;
    }
    const numeric = bucket.filter((item): item is NormalizedMetricPoint & { value: number } => item.value !== null);
    const candidates: NormalizedMetricPoint[] = [bucket[0]];
    if (numeric.length) {
      const minPoint = numeric.reduce((best, item) => (item.value < best.value ? item : best), numeric[0]);
      const maxPoint = numeric.reduce((best, item) => (item.value > best.value ? item : best), numeric[0]);
      candidates.push(minPoint, maxPoint);
    }
    candidates.push(bucket[bucket.length - 1]);
    reduced.push(...dedupeBucket(candidates));
  }

  if (reduced.length <= maxPoints) {
    return reduced;
  }

  const finalStep = Math.max(1, Math.ceil(reduced.length / maxPoints));
  const finalPoints = reduced.filter((_item, index) => index % finalStep === 0);
  const last = reduced[reduced.length - 1];
  if (finalPoints[finalPoints.length - 1]?.capturedAt !== last.capturedAt) {
    finalPoints.push(last);
  }
  return finalPoints;
}

export function buildUPlotSeriesData(
  frames: NormalizedMetricPoint[]
): [number[], Array<number | null>] {
  return [
    frames.map((item) => item.capturedAt / 1000),
    frames.map((item) => item.value)
  ];
}

export function summarizeMetricFrames(frames: NormalizedMetricPoint[]): MetricSummary {
  const numeric = frames
    .map((item) => item.value)
    .filter((item): item is number => item !== null);

  if (!numeric.length) {
    return {
      last: null,
      avg: null,
      peak: null
    };
  }

  return {
    last: numeric[numeric.length - 1] ?? null,
    avg: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
    peak: Math.max(...numeric)
  };
}

export function hasRenderableMetricFrames(frames: NormalizedMetricPoint[]): boolean {
  return frames.filter((item) => item.value !== null).length >= 2;
}
