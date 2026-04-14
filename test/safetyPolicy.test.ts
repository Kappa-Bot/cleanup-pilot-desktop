import { canQuarantinePath, getRiskLevel, isProtectedPath } from "../electron/safetyPolicy";

describe("safetyPolicy", () => {
  it("blocks protected windows paths", () => {
    expect(isProtectedPath("C:\\Windows\\System32\\file.log")).toBe(true);
    const result = canQuarantinePath("C:\\Windows\\System32\\file.log", "scan");
    expect(result.allowed).toBe(false);
  });

  it("blocks user-local install roots such as AppData Local Programs", () => {
    const executable = "C:\\Users\\user\\AppData\\Local\\Programs\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe";
    expect(isProtectedPath(executable)).toBe(true);
    const result = canQuarantinePath(executable, "scan");
    expect(result.allowed).toBe(false);
  });

  it("allows duplicate flow for .exe outside protected roots", () => {
    const result = canQuarantinePath("D:\\temp\\tool.exe", "duplicate");
    expect(result.allowed).toBe(true);
  });

  it("marks binaries as high risk", () => {
    expect(getRiskLevel("D:\\temp\\driver.sys", "temp")).toBe("high");
  });
});


