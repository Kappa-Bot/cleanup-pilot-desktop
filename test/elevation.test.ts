import fs from "fs/promises";

const execFileMock = jest.fn(
  (
    _file: string,
    _args: string[],
    _options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    callback(null, "", "");
  }
);

jest.mock("child_process", () => ({
  execFile: execFileMock
}));

const { movePathsElevatedBatch } = require("../electron/windowsSources/elevation") as typeof import("../electron/windowsSources/elevation");

describe("elevation helpers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    execFileMock.mockClear();
  });

  it("parses elevated result payloads that include a UTF-8 BOM or noisy prefix", async () => {
    jest.spyOn(fs, "mkdtemp").mockResolvedValue("C:\\temp\\cleanup-pilot-elevate-test");
    jest.spyOn(fs, "writeFile").mockResolvedValue(undefined);
    jest
      .spyOn(fs, "readFile")
      .mockResolvedValue(
        "\uFEFFWindows PowerShell\r\n[{\r\n\"id\":\"move-1\",\"source\":\"C:\\\\src\",\"destination\":\"C:\\\\dst\",\"ok\":true,\"message\":\"moved\"}]"
      );
    jest.spyOn(fs, "rm").mockResolvedValue(undefined);

    const result = await movePathsElevatedBatch([
      {
        id: "move-1",
        source: "C:\\src",
        destination: "C:\\dst"
      }
    ]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        id: "move-1",
        source: "C:\\src",
        destination: "C:\\dst",
        ok: true,
        message: "moved"
      }
    ]);
  });
});
