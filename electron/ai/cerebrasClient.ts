import axios from "axios";
import { parseJsonPayload } from "../jsonPayload";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

export async function requestCerebrasStructuredJson<T>(args: {
  model: "gpt-oss-120b";
  systemPrompt: string;
  userPayload: unknown;
  temperature?: number;
  maxCompletionTokens?: number;
}): Promise<T> {
  const apiKey = process.env.CEREBRAS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CEREBRAS_API_KEY is not configured.");
  }

  let response;
  try {
    response = await axios.post(
      CEREBRAS_API_URL,
      {
        model: args.model,
        temperature: args.temperature ?? 0.2,
        max_completion_tokens: args.maxCompletionTokens ?? 700,
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: JSON.stringify(args.userPayload) }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 60_000
      }
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) {
        throw new Error("Cerebras rejected the API key (401).");
      }
      if (status === 429) {
        throw new Error("Cerebras rate limit or quota reached (429).");
      }
      throw new Error(`Cerebras request failed${status ? ` (${status})` : ""}.`);
    }
    throw error;
  }

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Cerebras returned an empty response.");
  }
  return parseJsonPayload<T>(String(content), "Cerebras structured response");
}
