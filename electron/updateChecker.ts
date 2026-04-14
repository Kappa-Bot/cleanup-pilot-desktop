import axios from "axios";
import { app } from "electron";
import { UpdateCheckResponse } from "./types";

interface UpdateFeedPayload {
  latestVersion: string;
  url: string;
}

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

export async function checkForUpdates(feedUrl: string): Promise<UpdateCheckResponse> {
  const currentVersion = app.getVersion();
  if (!feedUrl.trim()) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      url: "",
      hasUpdate: false
    };
  }

  try {
    const response = await axios.get<UpdateFeedPayload>(feedUrl, { timeout: 6000 });
    const latestVersion = response.data.latestVersion ?? currentVersion;
    const url = response.data.url ?? "";
    const hasUpdate = compareVersion(latestVersion, currentVersion) > 0;
    return {
      currentVersion,
      latestVersion,
      url,
      hasUpdate
    };
  } catch {
    return {
      currentVersion,
      latestVersion: currentVersion,
      url: "",
      hasUpdate: false
    };
  }
}
