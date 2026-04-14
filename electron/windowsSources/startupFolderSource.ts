import os from "os";
import path from "path";
import { runPowerShellJson } from "./powershell";

export interface StartupFolderEntry {
  scope: "current_user" | "all_users";
  name: string;
  shortcutPath: string;
  targetPath?: string;
  command: string;
  modifiedAt: number;
  isShortcut: boolean;
}

interface RawStartupFolderEntry {
  Scope?: string;
  Name?: string;
  ShortcutPath?: string;
  TargetPath?: string;
  Command?: string;
  ModifiedAt?: number;
  IsShortcut?: boolean;
}

function getStartupFolders(): Array<{ scope: StartupFolderEntry["scope"]; folder: string }> {
  return [
    {
      scope: "current_user",
      folder: path.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup"
      )
    },
    {
      scope: "all_users",
      folder: path.join(process.env.ProgramData ?? "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
    }
  ];
}

export async function listStartupFolderEntries(): Promise<StartupFolderEntry[]> {
  const folderDefinitions = getStartupFolders()
    .map((entry) => `@{ Scope = '${entry.scope}'; Folder = '${entry.folder.replace(/'/g, "''")}' }`)
    .join(", ");

  const rawItems = await runPowerShellJson<RawStartupFolderEntry[] | RawStartupFolderEntry>(
    [
      `$folders = @(${folderDefinitions})`,
      "$results = @()",
      "$shell = $null",
      "try { $shell = New-Object -ComObject WScript.Shell } catch { $shell = $null }",
      "foreach ($folder in $folders) {",
      "  if (-not (Test-Path -LiteralPath $folder.Folder)) { continue }",
      "  Get-ChildItem -LiteralPath $folder.Folder -File -ErrorAction SilentlyContinue | ForEach-Object {",
      "    $shortcutPath = $_.FullName",
      "    $targetPath = $null",
      "    $command = $shortcutPath",
      "    $isShortcut = $_.Extension -ieq '.lnk'",
      "    if ($isShortcut -and $shell -ne $null) {",
      "      try {",
      "        $shortcut = $shell.CreateShortcut($shortcutPath)",
      "        $resolvedTarget = [string]$shortcut.TargetPath",
      "        $arguments = [string]$shortcut.Arguments",
      "        if (-not [string]::IsNullOrWhiteSpace($resolvedTarget)) {",
      "          $targetPath = $resolvedTarget",
      "          $command = if ([string]::IsNullOrWhiteSpace($arguments)) {",
      "            '\"' + $resolvedTarget + '\"'",
      "          } else {",
      "            '\"' + $resolvedTarget + '\" ' + $arguments",
      "          }",
      "        }",
      "      } catch {",
      "        $targetPath = $null",
      "        $command = $shortcutPath",
      "      }",
      "    } else {",
      "      $targetPath = $shortcutPath",
      "    }",
      "    $results += [pscustomobject]@{",
      "      Scope = $folder.Scope",
      "      Name = $_.Name",
      "      ShortcutPath = $shortcutPath",
      "      TargetPath = $targetPath",
      "      Command = $command",
      "      ModifiedAt = ([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds()",
      "      IsShortcut = $isShortcut",
      "    }",
      "  }",
      "}",
      "$results | ConvertTo-Json -Depth 5 -Compress"
    ].join("; "),
    []
  );

  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return items
    .map((item) => ({
      scope: item.Scope === "all_users" ? ("all_users" as const) : ("current_user" as const),
      name: String(item.Name ?? "").trim(),
      shortcutPath: String(item.ShortcutPath ?? "").trim(),
      targetPath: String(item.TargetPath ?? "").trim() || undefined,
      command: String(item.Command ?? "").trim(),
      modifiedAt: Number(item.ModifiedAt ?? 0),
      isShortcut: Boolean(item.IsShortcut)
    }))
    .filter((item) => item.name.length > 0 && item.shortcutPath.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}
