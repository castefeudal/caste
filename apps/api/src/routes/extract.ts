import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { extractObligation } from "@caste/ai";
import { userFromRequest } from "./auth.js";

const extractBody = z.object({ text: z.string().min(1).max(4000) });

/** Text -> structured obligation draft. Demo provider is rule-based; LLM providers are credential-gated. */
export async function extractRoute(app: FastifyInstance) {
  app.post("/", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const parsed = extractBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    }
    const extraction = await extractObligation(parsed.data.text);
    if (extraction.action === "do_not_create") {
      return reply.code(422).send({ error: "not_enough_signal", extraction });
    }
    return reply.code(200).send({ extraction, provider: "demo" });
  });
}
