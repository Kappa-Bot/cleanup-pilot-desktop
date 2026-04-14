import fs from "fs";
import path from "path";

export interface SyntheticSystemFixture {
  profile: string;
  system: Record<string, unknown>;
}

export function loadSyntheticSystem(profile: string): SyntheticSystemFixture {
  const root = path.join(process.cwd(), "fixtures", "systems", profile, "system.json");
  const raw = fs.readFileSync(root, "utf8");
  return {
    profile,
    system: JSON.parse(raw) as Record<string, unknown>
  };
}
