// The one place Recap talks to an AI model. Runs in the browser: the visitor brings
// their own key, it's kept in this browser's localStorage, and it is sent only to the
// provider they picked. No Recap server ever sees it (there isn't one).
import Anthropic from "@anthropic-ai/sdk";

export type ProviderId = "offline" | "claude" | "gemini" | "custom";

export type AIConfig = {
  provider: ProviderId;
  key: string;
  model: string;
  baseUrl: string; // custom provider only
};

export const PROVIDERS: Record<ProviderId, { label: string; defaultModel: string; keyHint: string; help: string }> = {
  offline: { label: "Offline", defaultModel: "", keyHint: "", help: "No key, no network. Statistical notes, quiz, and clip scoring that run entirely in this tab." },
  claude: { label: "Claude", defaultModel: "claude-opus-5-5", keyHint: "sk-ant-…", help: "Anthropic API key from console.anthropic.com." },
  gemini: { label: "Gemini", defaultModel: "gemini-2.5-flash", keyHint: "AIza…", help: "Google AI Studio key (has a free tier)." },
  custom: { label: "Custom", defaultModel: "", keyHint: "optional for local servers", help: "Any OpenAI-compatible endpoint that allows browser requests: OpenRouter, or Ollama / LM Studio on this computer." },
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const STORAGE_KEY = "recap.ai";

export const DEFAULT_CONFIG: AIConfig = { provider: "offline", key: "", model: "", baseUrl: "http://localhost:11434/v1" };

export function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AIConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private mode: settings just won't persist */
  }
}

export function isAIReady(c: AIConfig): boolean {
  if (c.provider === "offline") return false;
  if (c.provider === "custom") return Boolean(c.baseUrl && (c.model || PROVIDERS.custom.defaultModel));
  return Boolean(c.key);
}

export class LLMUnavailable extends Error {}

type JsonSchema = Record<string, unknown>;

export async function generateJson<T>(c: AIConfig, system: string, user: string, schema: JsonSchema, maxTokens = 16000): Promise<T> {
  const model = c.model || PROVIDERS[c.provider].defaultModel;
  if (c.provider === "claude") return askClaude<T>(c.key, model, system, user, schema, maxTokens);
  if (c.provider === "gemini") return askOpenAICompatible<T>("Gemini", GEMINI_BASE, c.key, model, system, user, schema, maxTokens);
  if (c.provider === "custom") return askOpenAICompatible<T>("Custom endpoint", c.baseUrl.replace(/\/$/, ""), c.key, model, system, user, schema, maxTokens);
  throw new LLMUnavailable("No AI provider selected");
}

async function askClaude<T>(key: string, model: string, system: string, user: string, schema: JsonSchema, maxTokens: number): Promise<T> {
  // dangerouslyAllowBrowser: the key belongs to the person using this tab, not to us.
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      // If a safety check declines, Anthropic retries on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === "refusal") throw new LLMUnavailable("The model declined this recording");
    if (response.stop_reason === "max_tokens") throw new LLMUnavailable("Claude's answer was cut off (too long)");
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!text) throw new LLMUnavailable("Empty answer from Claude");
    return JSON.parse(text) as T; // structured output guarantees valid JSON
  } catch (error) {
    if (error instanceof LLMUnavailable) throw error;
    if (error instanceof Anthropic.AuthenticationError) throw new LLMUnavailable("Claude rejected the API key");
    if (error instanceof Anthropic.PermissionDeniedError) throw new LLMUnavailable("This Claude key can't use that model");
    if (error instanceof Anthropic.RateLimitError) throw new LLMUnavailable("Claude rate limit hit - try again shortly");
    if (error instanceof Anthropic.APIError) throw new LLMUnavailable(`Claude API error ${error.status ?? ""}`.trim());
    throw new LLMUnavailable("Couldn't reach the Claude API");
  }
}

async function askOpenAICompatible<T>(
  name: string,
  baseUrl: string,
  key: string,
  model: string,
  system: string,
  user: string,
  schema: JsonSchema,
  maxTokens: number,
): Promise<T> {
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nReply with ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` },
      { role: "user", content: user },
    ],
  });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  for (const attempt of [1, 2]) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers, body, signal: AbortSignal.timeout(180_000) });
    } catch {
      throw new LLMUnavailable(`Couldn't reach ${name} (network error, or it blocks browser requests)`);
    }
    // 503 / 429 are usually temporary: wait and retry once.
    if ((res.status === 503 || res.status === 429) && attempt === 1) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new LLMUnavailable(`${name} rejected the API key`);
    if (res.status === 402) throw new LLMUnavailable(`${name} account balance is empty`);
    if (!res.ok) throw new LLMUnavailable(`${name} error ${res.status}`);
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    try {
      return parseJsonLoose<T>(content);
    } catch {
      throw new LLMUnavailable(`${name} answer wasn't valid JSON`);
    }
  }
  throw new LLMUnavailable(`${name} is temporarily unavailable`);
}

// JSON mode sometimes wraps the object in ```json fences; strip them.
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
