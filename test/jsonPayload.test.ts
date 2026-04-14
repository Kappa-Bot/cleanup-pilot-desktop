import { extractJsonPayload, parseJsonPayload, tryParseJsonPayload } from "../electron/jsonPayload";

describe("jsonPayload helpers", () => {
  it("parses JSON payloads with UTF-8 BOM and noisy prefixes", () => {
    const raw = "\uFEFFWindows PowerShell\r\n{\"ok\":true,\"value\":42}";
    expect(parseJsonPayload<{ ok: boolean; value: number }>(raw, "PowerShell output")).toEqual({
      ok: true,
      value: 42
    });
  });

  it("extracts JSON from fenced model responses", () => {
    const raw = "```json\n{\"diagnosis\":\"disk_io\",\"confidence\":0.92}\n```";
    expect(extractJsonPayload(raw)).toBe("{\"diagnosis\":\"disk_io\",\"confidence\":0.92}");
  });

  it("returns the fallback for invalid payloads in tolerant mode", () => {
    expect(tryParseJsonPayload("not-json", { ok: false }, "test payload")).toEqual({ ok: false });
  });
});
