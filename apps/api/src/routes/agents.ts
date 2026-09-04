import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db.js";
import { hashToken, userFromRequest } from "./auth.js";

const createBody = z.object({ name: z.string().min(1).max(80) });

export async function agentTokensRoute(app: FastifyInstance) {
  /** Issue a bearer token that binds an external agent to one household. */
  app.post("/tokens", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });

    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id))
      .limit(1);
    if (!membership) return reply.code(422).send({ error: "no_household", hint: "create a household first" });

    const token = `caste_${randomBytes(24).toString("hex")}`;
    const [row] = await db
      .insert(schema.agentTokens)
      .values({ name: parsed.data.name, tokenHash: hashToken(token), householdId: membership.householdId })
      .returning();

    // Plaintext shown exactly once — only the sha256 hash is stored.
    return reply.code(201).send({ id: row!.id, name: row!.name, token, householdId: row!.householdId });
  });

  app.get("/tokens", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const memberships = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
    const ids = new Set(memberships.map((m) => m.householdId));
    const rows = (await db.select().from(schema.agentTokens).orderBy(desc(schema.agentTokens.createdAt)))
      .filter((t) => ids.has(t.householdId))
      .map((t) => ({
        id: t.id,
        name: t.name,
        householdId: t.householdId,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        revoked: t.revokedAt !== null,
      }));
    return rows;
  });

  /** Agent-token self-check: resolves the bearer token to its household. */
  app.get("/me", async (req, reply) => {
    const token = await householdFromAgentToken(req.headers.authorization);
    if (!token) return reply.code(401).send({ error: "unauthorized", hint: "send Authorization: Bearer caste_..." });
    return token;
  });

  app.delete("/tokens/:id", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { id } = req.params as { id: string };
    await db
      .update(schema.agentTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.agentTokens.id, id), isNull(schema.agentTokens.revokedAt)));
    return { ok: true };
  });
}

/** Bearer token -> household, or null. Updates lastUsedAt for live tokens. */
export async function householdFromAgentToken(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer caste_")) return null;
  const raw = authHeader.slice("Bearer ".length);
  const [row] = await db
    .select()
    .from(schema.agentTokens)
    .where(and(eq(schema.agentTokens.tokenHash, hashToken(raw)), isNull(schema.agentTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  await db.update(schema.agentTokens).set({ lastUsedAt: new Date() }).where(eq(schema.agentTokens.id, row.id));
  return { householdId: row.householdId, tokenId: row.id };
}
