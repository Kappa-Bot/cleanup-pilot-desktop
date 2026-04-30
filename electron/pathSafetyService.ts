import fs from "fs/promises";
import path from "path";
import { StorageCleanupSafety } from "./types";

export interface PathSafetyDecision {
  executionAllowed: boolean;
  safety: StorageCleanupSafety;
  reason: string;
  realPath?: string;
  isReparsePoint?: boolean;
}

function normalize(value: string): string {
  return path.normalize(value).replace(/\//g, "\\").replace(/[\\]+$/g, "").toLowerCase();
}

function hasSegment(targetPath: string, segment: string): boolean {
  return normalize(targetPath).includes(segment.toLowerCase());
}

function isDriveRoot(targetPath: string): boolean {
  const parsed = path.parse(path.normalize(targetPath));
  return normalize(targetPath) === normalize(parsed.root);
}

function lexicalBlockReason(targetPath: string): string | null {
  const normalized = normalize(targetPath);
  if (isDriveRoot(targetPath)) {
    return "Drive roots are never cleanup targets.";
  }
  if (normalized.includes("\\windows\\winsxs") || normalized.endsWith("\\windows\\winsxs")) {
    return "WinSxS is a protected Windows component store.";
  }
  if (hasSegment(targetPath, "\\windowsapps")) {
    return "WindowsApps package stores are protected.";
  }
  if (hasSegment(targetPath, "\\system volume information")) {
    return "System Volume Information is protected.";
  }
  if (hasSegment(targetPath, "\\docker\\wsl\\") && (normalized.endsWith(".vhd") || normalized.endsWith(".vhdx"))) {
    return "Docker and WSL virtual disks are report-only.";
  }
  if (hasSegment(targetPath, "\\packages\\") && normalized.endsWith("\\localstate\\ext4.vhdx")) {
    return "WSL virtual disks are report-only.";
  }
  return null;
}

export async function evaluatePathSafety(targetPath: string): Promise<PathSafetyDecision> {
  const lexicalReason = lexicalBlockReason(targetPath);
  if (lexicalReason) {
    return {
      executionAllowed: false,
      safety: "never",
      reason: lexicalReason
    };
  }

  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      return {
        executionAllowed: false,
        safety: "never",
        reason: "Symbolic links and junction-like paths are not followed by cleanup.",
        isReparsePoint: true
      };
    }
  } catch {
    // Missing paths can still be reported, but execution will re-check later.
  }

  const realPath = await fs.realpath(targetPath).catch(() => undefined);
  if (realPath) {
    const realReason = lexicalBlockReason(realPath);
    if (realReason) {
      return {
        executionAllowed: false,
        safety: "never",
        reason: realReason,
        realPath
      };
    }
  }

  return {
    executionAllowed: true,
    safety: "safe",
    reason: "Path passed cleanup safety preflight.",
    realPath
  };
}
