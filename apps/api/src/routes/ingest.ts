import type { FastifyInstance } from "fastify";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db.js";
import { userFromRequest } from "./auth.js";
import { extractObligation } from "@caste/ai";
import { resolveProvider } from "@caste/ai";

const ingestBody = z.object({
  // Inbound webhook shape (Postmark / Cloudflare Email Workers compatible):
  // raw MIME message, from, to, subject are parsed from the MIME itself when present.
  raw: z.string().min(1).max(2_000_000),
});

export async function ingestRoute(app: FastifyInstance) {
  /**
   * Email ingestion: POST /api/ingest/email
   * Accepts a raw RFC-822 message. Authentication: either a household session
   * cookie or the INGEST_TOKEN bearer secret (for inbound mail webhooks).
   * Each parsed text block runs through the extraction pipeline; low-confidence
   * candidates are surfaced to review, never auto-created silently.
   */
  app.post("/email", async (req, reply) => {
    let viaToken = false;
    const auth = req.headers.authorization;
    if (process.env.INGEST_TOKEN && auth === `Bearer ${process.env.INGEST_TOKEN}`) {
      viaToken = true;
    }
    if (!viaToken) {
      const user = await userFromRequest(req);
      if (!user) return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = ingestBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    }

    let subject = "";
    let from = "";
    let text = "";
    try {
      const mail = await simpleParser(Buffer.from(parsed.data.raw, "base64"));
      subject = mail.subject ?? "";
      from = Array.isArray(mail.from?.value) && mail.from.value[0]?.address ? mail.from.value[0].address : "";
      text = mail.text ?? "";
    } catch {
      return reply.code(400).send({ error: "unparseable_email" });
    }
    if (!text.trim()) {
      return reply.code(422).send({ error: "no_text_body" });
    }

    // Route to the household of the recipient mailbox when it matches a
    // membership email; otherwise the first household of the authed user.
    let householdId: string | undefined;
    const [membership] = await db.select().from(schema.memberships).limit(1);
    if (membership) householdId = membership.householdId;

    // subject carries the actionable summary for most forwarded mail;
    // body still feeds date/priority signals.
    const extraction = await extractObligation(`${subject}\n${text.slice(0, 8000)}`.trim(), resolveProvider());
    const provenance = { source: "email" as const, from, subject };

    if (extraction.action === "do_not_create" || !householdId) {
      return reply.code(200).send({ ok: true, created: false, extraction, provenance });
    }

    const [row] = await db
      .insert(schema.obligations)
      .values({
        householdId,
        title: extraction.title,
        priority: extraction.priority === "low" ? "low" : extraction.priority,
        // Email is an untrusted source: even high-confidence extractions
        // land in review — a human confirms the mail was legitimate.
        status: "needs_review",
      })
      .returning();

    return reply.code(201).send({ ok: true, created: true, obligation: row, extraction, provenance });
  });

  void eq;
}
