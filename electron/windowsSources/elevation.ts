import fs from "fs/promises";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ElevatedMoveOperation {
  id: string;
  source: string;
  destination: string;
}

export interface ElevatedMoveResult extends ElevatedMoveOperation {
  ok: boolean;
  message?: string;
}

function psSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function extractJsonPayload(value: string): string {
  const normalized = stripUtf8Bom(value).trim();
  if (!normalized) {
    return normalized;
  }

  const firstObject = normalized.indexOf("{");
  const firstArray = normalized.indexOf("[");
  const start =
    firstObject === -1
      ? firstArray
      : firstArray === -1
        ? firstObject
        : Math.min(firstObject, firstArray);

  if (start <= 0) {
    return normalized;
  }

  const lastObject = normalized.lastIndexOf("}");
  const lastArray = normalized.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  if (end < start) {
    return normalized;
  }

  return normalized.slice(start, end + 1).trim();
}

function parseElevatedMoveResults(rawValue: string): ElevatedMoveResult[] {
  const payload = extractJsonPayload(rawValue);
  if (!payload) {
    throw new Error("Elevated move batch returned an empty result payload.");
  }

  try {
    const parsed = JSON.parse(payload) as ElevatedMoveResult | ElevatedMoveResult[];
    const results = Array.isArray(parsed) ? parsed : [parsed];
    if (!results.length) {
      throw new Error("Elevated move batch returned no operation results.");
    }
    return results;
  } catch (error) {
    const sample = payload.slice(0, 220).replace(/\s+/g, " ");
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Elevated move batch returned invalid JSON: ${reason}. Payload sample: ${sample}`);
  }
}

export function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES";
}

async function runElevatedScript(scriptPath: string, timeoutMs: number): Promise<void> {
  const escapedScript = psSingleQuote(scriptPath);

  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        [
          `$proc = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedScript}')`,
          "$proc.ExitCode"
        ].join("; ")
      ],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancelled by the user|canceled by the user|operation was canceled/i.test(message)) {
      throw new Error("Administrator approval was canceled.");
    }
    throw new Error(`Administrator elevation failed: ${message}`);
  }
}

export async function movePathsElevatedBatch(
  operations: ElevatedMoveOperation[],
  timeoutMs = 300_000
): Promise<ElevatedMoveResult[]> {
  if (process.platform !== "win32") {
    throw new Error("Administrator elevation is only supported on Windows.");
  }
  if (!operations.length) {
    return [];
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cleanup-pilot-elevate-"));
  const scriptPath = path.join(tempDir, "move-paths.ps1");
  const operationsPath = path.join(tempDir, "operations.json");
  const resultPath = path.join(tempDir, "result.json");
  const escapedResult = psSingleQuote(resultPath);
  const escapedOperations = psSingleQuote(operationsPath);

  const scriptBody = [
    "$ErrorActionPreference = 'Stop'",
    `$ops = Get-Content -LiteralPath '${escapedOperations}' -Raw | ConvertFrom-Json`,
    "$results = New-Object System.Collections.Generic.List[Object]",
    "$utf8NoBom = New-Object System.Text.UTF8Encoding($false)",
    "foreach ($op in @($ops)) {",
    "  try {",
    "    $destinationDir = Split-Path -LiteralPath $op.destination -Parent",
    "    if ($destinationDir) { New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null }",
    "    if (-not (Test-Path -LiteralPath $op.source)) {",
    "      $results.Add([pscustomobject]@{ id = $op.id; source = $op.source; destination = $op.destination; ok = $false; message = 'Source path is no longer available.' })",
    "      continue",
    "    }",
    "    Move-Item -LiteralPath $op.source -Destination $op.destination -Force",
    "    $results.Add([pscustomobject]@{ id = $op.id; source = $op.source; destination = $op.destination; ok = $true; message = 'moved' })",
    "  } catch {",
    "    $results.Add([pscustomobject]@{ id = $op.id; source = $op.source; destination = $op.destination; ok = $false; message = $_.Exception.Message })",
    "  }",
    "}",
    `$json = $results | ConvertTo-Json -Compress -Depth 4`,
    `[System.IO.File]::WriteAllText('${escapedResult}', $json, $utf8NoBom)`
  ].join("\r\n");

  try {
    await fs.writeFile(scriptPath, scriptBody, "utf8");
    await fs.writeFile(operationsPath, JSON.stringify(operations), "utf8");
    await runElevatedScript(scriptPath, timeoutMs);

    const rawResult = await fs.readFile(resultPath, "utf8").catch(() => "");
    if (!rawResult) {
      throw new Error("Elevated move batch did not produce a result file.");
    }
    return parseElevatedMoveResults(rawResult);
  } finally {
    void fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function movePathElevated(source: string, destination: string, timeoutMs = 180_000): Promise<void> {
  const [result] = await movePathsElevatedBatch(
    [{ id: "single-move", source, destination }],
    timeoutMs
  );
  if (!result?.ok) {
    throw new Error(result?.message || "Elevated move failed.");
  }

  const destinationExists = await fs
    .stat(destination)
    .then(() => true)
    .catch(() => false);
  if (!destinationExists) {
    throw new Error("Elevated move did not produce the expected destination.");
  }
}
