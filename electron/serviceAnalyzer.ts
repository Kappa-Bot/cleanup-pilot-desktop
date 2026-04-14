import fs from "fs";
import path from "path";
import { collectInstalledApps } from "./installedApps";
import {
  OptimizationActionSuggestion,
  ServiceAnalysisSummary,
  ServiceDiagnostic
} from "./types";
import { listServices } from "./windowsSources/serviceSource";

function normalizeStartMode(value: string): ServiceDiagnostic["startMode"] {
  const next = value.toLowerCase();
  if (next === "auto") {
    return "auto";
  }
  if (next.includes("disabled")) {
    return "disabled";
  }
  if (next.includes("manual") || next === "demand") {
    return "manual";
  }
  if (next.includes("delayed")) {
    return "delayed";
  }
  return "unknown";
}

function isMicrosoftService(service: { displayName: string; binaryPath?: string; startName?: string }): boolean {
  const haystack = `${service.displayName} ${service.binaryPath ?? ""} ${service.startName ?? ""}`.toLowerCase();
  return haystack.includes("microsoft") || haystack.includes("\\windows\\system32\\");
}

function hasBinary(pathName?: string): boolean {
  if (!pathName) {
    return false;
  }
  const cleanPath = pathName.replace(/^"/, "").split("\" ")[0].split(" -")[0].trim();
  return cleanPath.length > 0 && fs.existsSync(cleanPath);
}

export class ServiceAnalyzer {
  async scan(): Promise<{
    services: ServiceDiagnostic[];
    summary: ServiceAnalysisSummary;
    suggestedActions: OptimizationActionSuggestion[];
  }> {
    const [services, installedApps] = await Promise.all([listServices(), collectInstalledApps()]);
    const installedNames = installedApps.map((item) => item.name.toLowerCase());

    const diagnostics: ServiceDiagnostic[] = services.map((service) => {
      const startMode = normalizeStartMode(service.startMode);
      const state = service.state.toLowerCase() === "running" ? "running" : service.state ? "stopped" : "unknown";
      const isMicrosoft = isMicrosoftService(service);
      const binaryExists = hasBinary(service.binaryPath);
      const matchedInstalledApp = installedNames.find((item) => service.displayName.toLowerCase().includes(item));

      if (isMicrosoft) {
        return {
          id: service.serviceName,
          serviceName: service.serviceName,
          displayName: service.displayName,
          startMode,
          state,
          classification: "essential",
          binaryPath: service.binaryPath,
          recommendedAction: "leave",
          reason: ["Windows or Microsoft-owned service"]
        };
      }

      if (!binaryExists) {
        return {
          id: service.serviceName,
          serviceName: service.serviceName,
          displayName: service.displayName,
          startMode,
          state,
          classification: "orphan",
          binaryPath: service.binaryPath,
          recommendedAction: "disable",
          reason: ["Service binary is missing"]
        };
      }

      if ((startMode === "auto" || startMode === "delayed") && state === "stopped") {
        return {
          id: service.serviceName,
          serviceName: service.serviceName,
          displayName: service.displayName,
          startMode,
          state,
          classification: "unused",
          binaryPath: service.binaryPath,
          recommendedAction: matchedInstalledApp ? "manual" : "disable",
          reason: ["Auto-start service is not running"]
        };
      }

      if (state === "running" && startMode !== "disabled") {
        return {
          id: service.serviceName,
          serviceName: service.serviceName,
          displayName: service.displayName,
          startMode,
          state,
          classification: "optional",
          binaryPath: service.binaryPath,
          recommendedAction: "manual",
          reason: ["Third-party background service"]
        };
      }

      return {
        id: service.serviceName,
        serviceName: service.serviceName,
        displayName: service.displayName,
        startMode,
        state,
        classification: "rarely_used",
        binaryPath: service.binaryPath,
        recommendedAction: "inspect",
        reason: ["Non-essential service with unclear usage"]
      };
    });

    const suggestedActions: OptimizationActionSuggestion[] = diagnostics
      .filter((item) => item.recommendedAction === "manual" || item.recommendedAction === "disable")
      .map((item) => ({
        id: `service-${item.id}-${item.recommendedAction}`,
        targetKind: "service" as const,
        targetId: item.serviceName,
        action: item.recommendedAction === "manual" ? "set_manual_start" : "disable",
        title: `${item.recommendedAction === "manual" ? "Set Manual Start" : "Disable"} ${item.displayName}`,
        summary: item.reason.join(". "),
        risk: item.classification === "orphan" ? "low" : "medium",
        reversible: true,
        blocked: false,
        estimatedBenefitScore: item.classification === "unused" ? 70 : item.classification === "orphan" ? 85 : 55
      }));

    const summary: ServiceAnalysisSummary = {
      total: diagnostics.length,
      essentialCount: diagnostics.filter((item) => item.classification === "essential").length,
      optionalCount: diagnostics.filter((item) => item.classification === "optional").length,
      rarelyUsedCount: diagnostics.filter((item) => item.classification === "rarely_used").length,
      unusedCount: diagnostics.filter((item) => item.classification === "unused").length,
      orphanCount: diagnostics.filter((item) => item.classification === "orphan").length,
      suggestedActionCount: suggestedActions.length
    };

    return {
      services: diagnostics.sort((left, right) => left.displayName.localeCompare(right.displayName)),
      summary,
      suggestedActions
    };
  }
}
