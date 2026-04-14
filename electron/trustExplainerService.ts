import { ProtectedFindingRejection, RiskLevel, ScanFinding, TrustExplanationResponse } from "./types";

function categoryLabel(category: ScanFinding["category"]): string {
  return category.replace(/_/g, " ");
}

function normalizeRisk(risk: RiskLevel): RiskLevel {
  return risk === "high" ? "high" : risk === "medium" ? "medium" : "low";
}

export class TrustExplainerService {
  explainFinding(finding: ScanFinding): TrustExplanationResponse {
    const reasons = [finding.reason, `Category: ${categoryLabel(finding.category)}`];
    if (finding.selectedByDefault) {
      reasons.push("Selected by default because the current rules classify it as a low-trust cleanup target.");
    } else {
      reasons.push("Kept for review before any action because the rules are not treating it as a low-risk default cleanup item.");
    }
    if (finding.kind === "directory") {
      reasons.push("This is grouped as a container so cleanup can stay fast without rendering every file individually.");
    }
    return {
      summary: finding.selectedByDefault
        ? "This finding is considered safe enough to surface as a default cleanup candidate, but it still goes through preview and quarantine first."
        : "This finding needs explicit review before cleanup because the confidence or risk signal is lower.",
      risk: normalizeRisk(finding.risk),
      reasons
    };
  }

  explainBlocked(rejection: ProtectedFindingRejection): TrustExplanationResponse {
    return {
      summary: "This path was blocked before preview because it matches a protection rule designed to avoid damaging Windows or installed apps.",
      risk: rejection.protectionKind === "protected_system_root" || rejection.protectionKind === "binary_extension" ? "high" : "medium",
      reasons: [rejection.reason, `Category: ${categoryLabel(rejection.category)}`],
      blockedBy: [rejection.protectionKind.replace(/_/g, " ")]
    };
  }
}
