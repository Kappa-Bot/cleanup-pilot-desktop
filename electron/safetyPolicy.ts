import path from "path";
import { CleanupCategory, ProtectionKind, RiskLevel } from "./types";

const PROTECTED_ROOTS = [
  "c:\\windows\\",
  "c:\\program files\\",
  "c:\\program files (x86)\\"
];

const PROTECTED_PATH_SEGMENTS = [
  "\\appdata\\local\\programs\\",
  "\\appdata\\local\\microsoft\\windowsapps\\",
  "\\programdata\\chocolatey\\lib\\",
  "\\scoop\\apps\\"
];

const SYSTEM_EXTENSIONS = new Set([".exe", ".dll", ".sys", ".drv", ".com"]);
const INSTALLER_PACKAGE_EXTENSIONS = new Set([".msi", ".msp", ".cab", ".iso", ".appx", ".appxbundle", ".msix", ".msixbundle"]);

function normalizePath(inputPath: string): string {
  return path.normalize(inputPath).replace(/\//g, "\\").toLowerCase();
}

export function isBinaryExtension(filePath: string): boolean {
  return SYSTEM_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isDownloadsPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return normalized.includes("\\downloads\\") || normalized.endsWith("\\downloads");
}

export function isInstallerPackagePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const extension = path.extname(normalized).toLowerCase();
  if (INSTALLER_PACKAGE_EXTENSIONS.has(extension)) {
    return true;
  }
  if (!isDownloadsPath(normalized)) {
    return false;
  }
  return [".zip", ".7z", ".rar"].includes(extension);
}

export function isProtectedPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return (
    PROTECTED_ROOTS.some((root) => normalized.startsWith(root)) ||
    PROTECTED_PATH_SEGMENTS.some((segment) => normalized.includes(segment))
  );
}

export function getProtectionDetails(
  filePath: string
): { kind: ProtectionKind; reason: string } | undefined {
  const normalized = normalizePath(filePath);
  if (PROTECTED_ROOTS.some((root) => normalized.startsWith(root))) {
    return {
      kind: "protected_system_root",
      reason: "Path is under a protected system directory."
    };
  }
  if (PROTECTED_PATH_SEGMENTS.some((segment) => normalized.includes(segment))) {
    return {
      kind: "app_install_root",
      reason: "Path is under an application install directory."
    };
  }
  if (isBinaryExtension(filePath)) {
    return {
      kind: "binary_extension",
      reason: "Executable or system binary cleanup is blocked."
    };
  }
  return undefined;
}

export function getProtectionReason(filePath: string): string | undefined {
  return getProtectionDetails(filePath)?.reason;
}

export function getRiskLevel(filePath: string, category: CleanupCategory): RiskLevel {
  if (isProtectedPath(filePath) || isBinaryExtension(filePath)) {
    return "high";
  }

  if (category === "installer_artifacts" || category === "minecraft_leftovers" || category === "wsl_leftovers") {
    return "medium";
  }

  return "low";
}

export function canQuarantinePath(
  filePath: string,
  source: "scan" | "duplicate"
): { allowed: boolean; reason?: string } {
  const protectionReason = getProtectionDetails(filePath)?.reason;
  if (isProtectedPath(filePath)) {
    return {
      allowed: false,
      reason: protectionReason ?? "Path is under a protected system directory."
    };
  }

  if (isBinaryExtension(filePath) && source !== "duplicate") {
    return {
      allowed: false,
      reason: protectionReason ?? "System-critical binary extensions are blocked for standard cleanup."
    };
  }

  return { allowed: true };
}

export function requiresAdminForPath(filePath: string): boolean {
  return isProtectedPath(filePath);
}
