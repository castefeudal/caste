import { z } from "zod";
import { decideConfidence } from "@caste/core";

export const extractedObligation = z.object({
  title: z.string().min(1).max(280),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  dueAt: z.string().datetime().nullable(),
  confidence: z.number().min(0).max(1),
  action: z.enum(["auto_create", "needs_review", "do_not_create"]),
  matchedBy: z.string(),
});

export type ExtractedObligation = z.infer<typeof extractedObligation>;

export type ExtractProvider = {
  name: string;
  extract(text: string): Promise<Omit<ExtractedObligation, "confidence" | "action"> & { confidence: number }>;
};

/** Deterministic, zero-dependency provider. Always works; never hallucinates. */
export const demoProvider: ExtractProvider = {
  name: "demo",
  async extract(text) {
    const t = text.trim();
    const title = t.length > 280 ? `${t.slice(0, 277)}...` : t;

    const now = new Date();
    const dueAt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const has = (re: RegExp) => re.test(t.toLowerCase());

    let due: string | null = null;
    const inDays = t.toLowerCase().match(/через (\d+) д/i);
    if (inDays) {
      const d = new Date(now);
      d.setDate(d.getDate() + Number(inDays[1]));
      due = dueAt(d);
    } else if (has(/сегодня|today/)) {
      due = dueAt(now);
    } else if (has(/завтра|tomorrow/)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      due = dueAt(d);
    } else if (has(/на неделе|this week/)) {
      const d = new Date(now);
      d.setDate(d.getDate() + (7 - d.getDay()));
      due = dueAt(d);
    }

    const priority = has(/срочно|urgent|критичн|critical|штраф|penalt/)
      ? "critical"
      : has(/важно|important|счёт|страховк|invoice|insuranc/)
        ? "high"
        : has(/когда-нибудь|someday|не горит/)
          ? "low"
          : "normal";

    const signals = (due ? 0.35 : 0) + (priority !== "normal" ? 0.2 : 0) + (t.split(/\s+/).length >= 3 ? 0.25 : 0.1) + 0.3;
    return { title, priority, dueAt: due, matchedBy: "demo:rules", confidence: Math.min(0.98, signals) };
  },
};

export type ExtractRisk = "none" | "financial" | "medical" | "legal" | "privacy" | "social" | "irreversible";

export function scoreExtraction(e: { confidence: number }, risk: ExtractRisk = "social") {
  return decideConfidence({ score: e.confidence, risk });
}

export async function extractObligation(text: string, provider: ExtractProvider = demoProvider): Promise<ExtractedObligation> {
  const raw = await provider.extract(text);
  const decision = scoreExtraction(raw);
  return { ...raw, action: decision.action };
}
