import { execFile } from "child_process";
import { promisify } from "util";
import { parseJsonPayload } from "../jsonPayload";

const execFileAsync = promisify(execFile);

export async function runPowerShell(command: string, timeoutMs = 15_000): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    }
  );
  return String(stdout ?? "").trim();
}

export async function runPowerShellJson<T>(
  command: string,
  fallback: T,
  timeoutMs = 15_000
): Promise<T> {
  try {
    const output = await runPowerShell(command, timeoutMs);
    if (!output) {
      return fallback;
    }
    return parseJsonPayload<T>(output, "PowerShell JSON output");
  } catch {
    return fallback;
  }
}
