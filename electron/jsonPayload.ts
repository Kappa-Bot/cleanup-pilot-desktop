export function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export function extractJsonPayload(value: string): string {
  const normalized = stripUtf8Bom(String(value ?? "")).trim();
  if (!normalized) {
    return "";
  }

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || normalized;
  const firstObject = candidate.indexOf("{");
  const firstArray = candidate.indexOf("[");
  const start =
    firstObject === -1
      ? firstArray
      : firstArray === -1
        ? firstObject
        : Math.min(firstObject, firstArray);

  if (start <= 0) {
    return candidate;
  }

  const lastObject = candidate.lastIndexOf("}");
  const lastArray = candidate.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  if (end < start) {
    return candidate;
  }

  return candidate.slice(start, end + 1).trim();
}

export function parseJsonPayload<T>(value: string, label = "JSON payload"): T {
  const payload = extractJsonPayload(value);
  if (!payload) {
    throw new Error(`${label} is empty.`);
  }

  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const sample = payload.slice(0, 220).replace(/\s+/g, " ");
    throw new Error(`${label} is not valid JSON: ${reason}. Payload sample: ${sample}`);
  }
}

export function tryParseJsonPayload<T>(value: string, fallback: T, label = "JSON payload"): T {
  try {
    return parseJsonPayload<T>(value, label);
  } catch {
    return fallback;
  }
}
