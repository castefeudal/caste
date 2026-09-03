import { z } from "zod";
import { demoProvider, type ExtractProvider } from "./extract.js";

/**
 * LLM-backed extraction providers. Each adapter calls a real provider API and
 * asks for strict JSON. On any failure (missing key, network, malformed
 * output) the caller should fall back to the deterministic demo provider —
 * extraction must never become a single point of failure.
 */

const llmOutput = z.object({
  title: z.string().min(1).max(280),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  dueAt: z.string().datetime().nullable().default(null),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = [
  "You extract obligations (things someone must get done) from text.",
  "Return STRICT JSON only, matching:",
  '{"title": string (<=280 chars, imperative), "priority": "low"|"normal"|"high"|"critical", "dueAt": ISO-8601 datetime or null, "confidence": number 0..1}',
  "Rules: confidence must reflect whether the text contains a clear actionable obligation",
  "with concrete details. Chit-chat or wishes score < 0.5. Missing deadline is fine — set dueAt null.",
  "Today's date is {date}.",
].join("\n");

function prompt(now: Date): string {
  return SYSTEM_PROMPT.replace("{date}", now.toISOString().slice(0, 10));
}

function requireKey(envVar: string): string {
  const key = process.env[envVar];
  if (!key) {
    throw new Error(`${envVar} not configured`);
  }
  return key;
}

async function parseResponse(res: Response, provider: string) {
  if (!res.ok) {
    throw new Error(`${provider} API error ${res.status}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; content?: { text?: string }[] };
  const raw = body.choices?.[0]?.message?.content ?? body.content?.[0]?.text;
  if (!raw) throw new Error(`${provider}: empty completion`);
  // Models sometimes wrap JSON in fences; find the outermost object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`${provider}: no JSON in completion`);
  return llmOutput.parse(JSON.parse(raw.slice(start, end + 1)));
}

/** OpenAI Chat Completions. Requires OPENAI_API_KEY. */
export const openaiProvider: ExtractProvider = {
  name: "openai",
  async extract(text) {
    const key = requireKey("OPENAI_API_KEY");
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt(new Date()) },
          { role: "user", content: text },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = await parseResponse(res, "openai");
    return { ...parsed, matchedBy: `openai:${model}` };
  },
};

/** Anthropic Messages API. Requires ANTHROPIC_API_KEY. */
export const anthropicProvider: ExtractProvider = {
  name: "anthropic",
  async extract(text) {
    const key = requireKey("ANTHROPIC_API_KEY");
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: prompt(new Date()),
        messages: [{ role: "user", content: text }],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const parsed = await parseResponse(res, "anthropic");
    return { ...parsed, matchedBy: `anthropic:${model}` };
  },
};

/**
 * Returns the best configured LLM provider, or the deterministic demo
 * provider when no keys are present. OPENAI beats ANTHROPIC by default;
 * override with AI_PROVIDER=openai|anthropic|demo.
 */
export function resolveProvider(): ExtractProvider {
  const requested = process.env.AI_PROVIDER;
  if (requested === "demo") return demoProvider;
  if (requested === "openai") return process.env.OPENAI_API_KEY ? openaiProvider : demoProvider;
  if (requested === "anthropic") return process.env.ANTHROPIC_API_KEY ? anthropicProvider : demoProvider;
  if (process.env.OPENAI_API_KEY) return openaiProvider;
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  return demoProvider;
}

/** Extract with fallback: try the configured provider, drop to demo on failure. */
export async function extractWithFallback(text: string): Promise<ExtractProvider["extract"] extends (t: string) => Promise<infer R> ? R : never> {
  const provider = resolveProvider();
  if (provider.name === "demo") return provider.extract(text);
  try {
    return await provider.extract(text);
  } catch (err) {
    console.error(JSON.stringify({ level: 40, msg: "llm provider failed, falling back to demo", provider: provider.name, error: (err as Error).message }));
    return demoProvider.extract(text);
  }
}
