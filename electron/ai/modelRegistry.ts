export interface AiRuntimeProviderState {
  provider: "cerebras" | "heuristic";
  configured: boolean;
  model: "gpt-oss-120b";
}

export function getSystemDoctorProviderState(): AiRuntimeProviderState {
  const apiKey = process.env.CEREBRAS_API_KEY?.trim();
  return {
    provider: apiKey ? "cerebras" : "heuristic",
    configured: Boolean(apiKey),
    model: "gpt-oss-120b"
  };
}
