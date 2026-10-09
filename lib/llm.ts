// The one place Recap talks to an AI model. Server-only: keys never reach the browser.
// Claude first (ANTHROPIC_API_KEY), then Gemini (GEMINI_API_KEY), then the publik API
// (PUBLIK_API_KEY). With none set, callers fall back to lib/offline.ts.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-opus-5-5";
const GEMINI = { name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", keyEnv: "GEMINI_API_KEY" };
const PUBLIK = { name: "publik", baseUrl: process.env.PUBLIK_BASE_URL || "https://publikhq.com/api/v1", model: "publik-balanced", keyEnv: "PUBLIK_API_KEY" };

export type Provider = "claude" | "gemini" | "publik";

export class LLMUnavailable extends Error {}

export function activeProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.PUBLIK_API_KEY) return "publik";
  return null;
}

type JsonSchema = Record<string, unknown>;

export async function generateJson<T>(system: string, user: string, schema: JsonSchema, maxTokens = 16000): Promise<T> {
  const provider = activeProvider();
  if (provider === "claude") return askClaude<T>(system, user, schema, maxTokens);
  if (provider === "gemini") return askOpenAICompatible<T>(GEMINI, system, user, schema, maxTokens);
  if (provider === "publik") return askOpenAICompatible<T>(PUBLIK, system, user, schema, maxTokens);
  throw new LLMUnavailable("No AI key set");
}

async function askClaude<T>(system: string, user: string, schema: JsonSchema, maxTokens: number): Promise<T> {
  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      // If a safety check declines, Anthropic retries on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === "refusal") throw new LLMUnavailable("The model declined this recording");
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!text) throw new LLMUnavailable("Empty answer from Claude");
    return JSON.parse(text) as T; // structured output guarantees valid JSON
  } catch (error) {
    if (error instanceof LLMUnavailable) throw error;
    if (error instanceof Anthropic.AuthenticationError) throw new LLMUnavailable("Claude API key was rejected");
    if (error instanceof Anthropic.RateLimitError) throw new LLMUnavailable("Claude rate limit hit - try again shortly");
    if (error instanceof Anthropic.APIError) throw new LLMUnavailable(`Claude API error ${error.status}`);
    throw new LLMUnavailable("Couldn't reach the Claude API");
  }
}

async function askOpenAICompatible<T>(
  p: typeof GEMINI,
  system: string,
  user: string,
  schema: JsonSchema,
  maxTokens: number,
): Promise<T> {
  const body = JSON.stringify({
    model: p.model,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nReply with ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` },
      { role: "user", content: user },
    ],
  });
  for (const attempt of [1, 2]) {
    let res: Response;
    try {
      res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env[p.keyEnv]}` },
        body,
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      throw new LLMUnavailable(`Couldn't reach the ${p.name} API`);
    }
    // 503 is temporary on both Gemini and publik: wait and retry once.
    if (res.status === 503 && attempt === 1) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (res.status === 402) {
      const detail = await res.json().catch(() => ({}));
      console.error(`${p.name} balance empty`, detail?.error?.top_up_url ?? "");
      throw new LLMUnavailable(`${p.name} balance is empty`);
    }
    if (!res.ok) throw new LLMUnavailable(`${p.name} API error ${res.status}`);
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    try {
      return parseJsonLoose<T>(content);
    } catch {
      throw new LLMUnavailable(`${p.name} answer wasn't valid JSON`);
    }
  }
  throw new LLMUnavailable(`${p.name} is temporarily unavailable`);
}

// JSON mode sometimes wraps the object in ```json fences; strip them.
function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
