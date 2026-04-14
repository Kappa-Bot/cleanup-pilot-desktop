import { CoverageCatalogResponse } from "./types";

const windowsAreas = [
  { id: "user-temp", label: "User temp and caches", covered: true },
  { id: "system-temp", label: "System temp and dumps", covered: true },
  { id: "program-data", label: "ProgramData residue", covered: true },
  { id: "appdata-local", label: "AppData Local and LocalLow", covered: true },
  { id: "appdata-roaming", label: "AppData Roaming residue", covered: true },
  { id: "browser-caches", label: "Browser caches and service workers", covered: true },
  { id: "shader-caches", label: "GPU shader caches", covered: true },
  { id: "wsl-docker", label: "WSL and container residue", covered: true },
  { id: "installer-cache", label: "Installer artifacts and package cache", covered: true },
  { id: "launcher-residue", label: "Launcher and game residue", covered: true }
] as const;

const appFamilies = [
  { id: "windows-core", label: "Windows 11 cleanup areas", covered: true },
  { id: "browsers", label: "Browsers and embedded Chromium apps", covered: true },
  { id: "communication", label: "Discord, Teams, chat tools", covered: true },
  { id: "gaming", label: "Steam, Epic, Battle.net, Minecraft launchers", covered: true },
  { id: "ai-tools", label: "Local AI runtimes and model caches", covered: true },
  { id: "dev-toolchains", label: "npm, pnpm, yarn, pip, gradle, nuget", covered: true },
  { id: "cloud-sync", label: "OneDrive and sync residue", covered: true },
  { id: "containers", label: "Docker and WSL support files", covered: true },
  { id: "creative", label: "Creative app residue", covered: false },
  { id: "privacy", label: "Privacy and browser history cleaning", covered: false },
  { id: "software-updater", label: "Software updater catalog", covered: false }
] as const;

export class CoverageCatalogService {
  getCatalog(): CoverageCatalogResponse {
    return {
      windowsAreas: [...windowsAreas],
      appFamilies: [...appFamilies],
      totals: {
        windowsAreasCovered: windowsAreas.filter((item) => item.covered).length,
        appFamiliesCovered: appFamilies.filter((item) => item.covered).length
      }
    };
  }
}
