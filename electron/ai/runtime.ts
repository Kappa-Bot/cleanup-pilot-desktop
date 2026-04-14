import { z } from "zod";
import { SystemDoctorReport, SystemSnapshotHistoryPoint } from "../types";
import { requestCerebrasStructuredJson } from "./cerebrasClient";
import { getSystemDoctorProviderState } from "./modelRegistry";

const systemDoctorResponseSchema = z.object({
  generatedAt: z.number(),
  provider: z.enum(["heuristic", "cerebras"]),
  model: z.literal("gpt-oss-120b").optional(),
  primaryBottleneck: z.enum(["cpu", "ram", "disk_io", "gpu", "drivers", "mixed", "unknown"]),
  overallHealthScore: z.number(),
  diagnoses: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      confidence: z.number(),
      risk: z.enum(["low", "medium", "high"]),
      summary: z.string(),
      evidence: z.array(z.string()),
      suggestions: z.array(
        z.object({
          id: z.string(),
          targetKind: z.enum(["startup_entry", "service", "scheduled_task"]),
          targetId: z.string(),
          action: z.enum(["disable", "delay", "set_manual_start", "restore"]),
          title: z.string(),
          summary: z.string(),
          risk: z.enum(["low", "medium", "high"]),
          reversible: z.literal(true),
          blocked: z.boolean(),
          blockReason: z.string().optional(),
          estimatedBenefitScore: z.number()
        })
      )
    })
  ),
  safeWins: z.array(
    z.object({
      id: z.string(),
      targetKind: z.enum(["startup_entry", "service", "scheduled_task"]),
      targetId: z.string(),
      action: z.enum(["disable", "delay", "set_manual_start", "restore"]),
      title: z.string(),
      summary: z.string(),
      risk: z.enum(["low", "medium", "high"]),
      reversible: z.literal(true),
      blocked: z.boolean(),
      blockReason: z.string().optional(),
      estimatedBenefitScore: z.number()
    })
  )
});

export async function runSystemDoctorAi(
  payload: unknown
): Promise<SystemDoctorReport | null> {
  const providerState = getSystemDoctorProviderState();
  if (!providerState.configured) {
    return null;
  }

  const result = await requestCerebrasStructuredJson<SystemDoctorReport>({
    model: "gpt-oss-120b",
    systemPrompt: [
      "You are a Windows performance diagnosis engine.",
      "Only analyze the structured JSON payload you receive.",
      "Never invent raw logs, shell outputs, or unsupported evidence.",
      "Return strict JSON matching the requested schema.",
      "Do not suggest destructive actions. Only use reversible startup/service/task actions when appropriate."
    ].join(" "),
    userPayload: payload,
    temperature: 0.1
  });

  return systemDoctorResponseSchema.parse(result);
}

export function toDoctorHistoryPayload(history: SystemSnapshotHistoryPoint[]): Array<{
  createdAt: number;
  primaryBottleneck: string;
  cpuAvgPct?: number;
  ramUsedPct?: number;
  diskActivePct?: number;
}> {
  return history.map((item) => ({
    createdAt: item.createdAt,
    primaryBottleneck: item.primaryBottleneck,
    cpuAvgPct: item.cpuAvgPct,
    ramUsedPct: item.ramUsedPct,
    diskActivePct: item.diskActivePct
  }));
}
