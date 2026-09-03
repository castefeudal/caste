import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { transition, type Actor, type ObligationState } from "@caste/core";
import { db, schema } from "../db.js";

const createBody = z.object({
  householdId: z.string().uuid(),
  title: z.string().min(1).max(280),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().nullish(),
});

const patchBody = z.object({
  actorType: z.enum(["human", "agent"]).default("human"),
  actorId: z.string().min(1),
  status: z.enum(["captured","needs_review","active","assigned","scheduled","in_progress","waiting","blocked","action_required","verification_pending","verified","resolved","dismissed","archived"]).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(280).optional(),
});

export async function obligationsRoute(app: FastifyInstance): Promise<void> {
  app.post("/", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    const [household] = await db
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(eq(schema.households.id, parsed.data.householdId));
    if (!household) return reply.code(404).send({ error: "household_not_found" });
    const [row] = await db
      .insert(schema.obligations)
      .values({
        householdId: parsed.data.householdId,
        title: parsed.data.title,
        priority: parsed.data.priority,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        assignedTo: parsed.data.assignedTo ?? null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/", async (req) => {
    const q = z.object({ householdId: z.string().uuid() }).parse(req.query);
    return db
      .select()
      .from(schema.obligations)
      .where(eq(schema.obligations.householdId, q.householdId))
      .orderBy(desc(schema.obligations.createdAt));
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return row;
  });

  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id));
    if (!current) return reply.code(404).send({ error: "not_found" });

    const actor: Actor = { type: parsed.data.actorType, id: parsed.data.actorId };
    const updates: Partial<typeof schema.obligations.$inferInsert> = { updatedAt: new Date() };

    if (parsed.data.status && parsed.data.status !== current.status) {
      try {
        const currentStatus = current.status as ObligationState;
        const next = transition(currentStatus, {
          from: currentStatus,
          to: parsed.data.status,
          actor,
          reason: parsed.data.actorType === "agent" ? "agent_action" : "manual",
        });
        updates.status = next;
      } catch (err) {
        return reply.code(409).send({ error: "invalid_transition", message: (err as Error).message });
      }
    }
    if (parsed.data.priority) updates.priority = parsed.data.priority;
    if (parsed.data.dueAt !== undefined) updates.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    if (parsed.data.assignedTo !== undefined) updates.assignedTo = parsed.data.assignedTo;
    if (parsed.data.title) updates.title = parsed.data.title;

    const [row] = await db.update(schema.obligations).set(updates).where(eq(schema.obligations.id, id)).returning();
    return row;
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const actor: Actor = { type: "human", id: "api" };
    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id));
    if (!current) return reply.code(404).send({ error: "not_found" });
    try {
      const next = transition(current.status as ObligationState, {
        from: current.status as ObligationState,
        to: "archived",
        actor,
        reason: "manual",
      });
      const [row] = await db
        .update(schema.obligations)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(schema.obligations.id, id))
        .returning();
      return row;
    } catch (err) {
      return reply.code(409).send({ error: "invalid_transition", message: (err as Error).message });
    }
  });
}
