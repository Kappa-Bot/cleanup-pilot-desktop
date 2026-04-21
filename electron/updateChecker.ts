import axios from "axios";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { UpdateCheckResponse } from "./types";

interface UpdateFeedPayload {
  latestVersion: string;
  url: string;
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function normalizeVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((item) => Number(item))
    .map((item) => (Number.isFinite(item) ? item : 0));
}

function compareVersion(a: string, b: string): number {
  const av = normalizeVersion(a);
  const bv = normalizeVersion(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i += 1) {
    const left = av[i] ?? 0;
    const right = bv[i] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }
  return 0;
}

function createNoUpdateResponse(currentVersion: string): UpdateCheckResponse {
  return {
    currentVersion,
    latestVersion: currentVersion,
    url: "",
    hasUpdate: false
  };
}

async function checkGitHubReleases(currentVersion: string): Promise<UpdateCheckResponse | null> {
  if (!app.isPackaged) {
    return null;
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) {
      return createNoUpdateResponse(currentVersion);
    }

    const latestVersion = result.updateInfo.version ?? currentVersion;
    const url = result.updateInfo.files?.[0]?.url ?? "";
    return {
      currentVersion,
      latestVersion,
      url,
      hasUpdate: compareVersion(latestVersion, currentVersion) > 0
    };
  } catch {
    return null;
  }
}

async function checkLegacyFeed(feedUrl: string, currentVersion: string): Promise<UpdateCheckResponse | null> {
  const trimmedFeedUrl = feedUrl.trim();
  if (!trimmedFeedUrl) {
    return null;
  }

  try {
    const response = await axios.get<UpdateFeedPayload>(trimmedFeedUrl, { timeout: 6000 });
    const latestVersion = response.data.latestVersion ?? currentVersion;
    const url = response.data.url ?? "";
    return {
      currentVersion,
      latestVersion,
      url,
      hasUpdate: compareVersion(latestVersion, currentVersion) > 0
    };
  } catch {
    return null;
  }
}

export async function checkForUpdates(feedUrl: string): Promise<UpdateCheckResponse> {
  const currentVersion = app.getVersion();
  const githubResult = await checkGitHubReleases(currentVersion);
  if (githubResult) {
    return githubResult;
  }

  const legacyResult = await checkLegacyFeed(feedUrl, currentVersion);
  if (legacyResult) {
    return legacyResult;
  }

  return createNoUpdateResponse(currentVersion);
}
