import { runPowerShellJson } from "./powershell";

export interface RegistryRunEntry {
  hive: "HKLM" | "HKCU";
  name: string;
  command: string;
  keyPath: string;
}

interface RawRegistryEntry {
  Hive?: string;
  Name?: string;
  Command?: string;
  KeyPath?: string;
}

const RUN_KEY_BY_HIVE: Record<RegistryRunEntry["hive"], string> = {
  HKLM: "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  HKCU: "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
};

export async function listRegistryRunEntries(): Promise<RegistryRunEntry[]> {
  const script = [
    "$results = @()",
    "$targets = @(",
    "@{ Hive = 'HKLM'; Path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' },",
    "@{ Hive = 'HKCU'; Path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' }",
    ")",
    "foreach ($target in $targets) {",
    "  if (Test-Path $target.Path) {",
    "    $props = Get-ItemProperty -Path $target.Path",
    "    foreach ($prop in $props.PSObject.Properties) {",
    "      if ($prop.Name -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$') {",
    "        $results += [pscustomobject]@{ Hive = $target.Hive; Name = $prop.Name; Command = [string]$prop.Value; KeyPath = $target.Path }",
    "      }",
    "    }",
    "  }",
    "}",
    "$results | ConvertTo-Json -Depth 5 -Compress"
  ].join("; ");

  const items = await runPowerShellJson<RawRegistryEntry[]>(script, []);
  return items
    .map((item) => ({
      hive: (String(item.Hive ?? "HKCU") === "HKLM" ? "HKLM" : "HKCU") as RegistryRunEntry["hive"],
      name: String(item.Name ?? "").trim(),
      command: String(item.Command ?? "").trim(),
      keyPath: String(item.KeyPath ?? "").trim()
    }))
    .filter((item) => item.name.length > 0 && item.command.length > 0);
}

export function getRunKeyPath(hive: RegistryRunEntry["hive"]): string {
  return RUN_KEY_BY_HIVE[hive];
}
