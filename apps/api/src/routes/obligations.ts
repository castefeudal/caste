import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { canTransition, transition, type Actor, type ObligationState, OBLIGATION_STATES } from "@caste/core";
import { db } from "../db.js";
import * as schema from "../schema.js";
import { requireHouseholdMember, requirePrincipal } from "../lib/authz.js";
import type { Principal } from "../lib/principal.js";

const STATES = z.enum(OBLIGATION_STATES);
const PRIORITIES = z.enum(["low", "normal", "high", "critical"]);
const RISKS = z.enum(["none", "financial", "medical", "legal", "privacy", "social", "irreversible"]);

const createBody = z.object({
  householdId: z.string().uuid(),
  title: z.string().min(1).max(280),
  summary: z.string().max(4000).optional(),
  priority: PRIORITIES.default("normal"),
  risk: RISKS.default("none"),
  dueAt: z.string().datetime().optional(),
  assignedTo: z.string().uuid().nullish(),
  source: z.string().max(40).optional(),
});

const patchBody = z.object({
  title: z.string().min(1).max(280).optional(),
  summary: z.string().max(4000).nullable().optional(),
  priority: PRIORITIES.optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

const listQuery = z.object({
  householdId: z.string().uuid(),
  state: STATES.optional(),
  priority: PRIORITIES.optional(),
  risk: RISKS.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function actorOf(p: Principal): Actor {
  switch (p.kind) {
    case "human":
      return { type: "human", id: p.userId };
    case "agent":
      return { type: "agent", id: p.tokenId };
    case "system":
      return { type: "system", id: p.service };
  }
}

/** Append-only transition event. Never write status without one. */
async function recordEvent(input: {
  householdId: string;
  obligationId: string;
  fromState: string;
  toState: string;
  principal: Principal;
  reason: string;
  evidenceId?: string | null;
}): Promise<void> {
  await db.insert(schema.obligationEvents).values({
    householdId: input.householdId,
    obligationId: input.obligationId,
    fromState: input.fromState,
    toState: input.toState,
    actorKind: input.principal.kind,
    actorId:
      input.principal.kind === "human"
        ? input.principal.userId
        : input.principal.kind === "agent"
          ? input.principal.tokenId
          : input.principal.service,
    reason: input.reason,
    evidenceId: input.evidenceId ?? null,
  });
}

export async function obligationsRoute(app: FastifyInstance): Promise<void> {
  app.post("/", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_BODY", detail: parsed.error.flatten() } });
    const principal = await requireHouseholdMember(req, reply, parsed.data.householdId);
    if (!principal) return;

    const [row] = await db
      .insert(schema.obligations)
      .values({
        householdId: parsed.data.householdId,
        title: parsed.data.title,
        summary: parsed.data.summary ?? null,
        priority: parsed.data.priority,
        risk: parsed.data.risk,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        assignedTo: parsed.data.assignedTo ?? null,
        source: parsed.data.source ?? null,
        createdByKind: principal.kind,
        createdById: principal.kind === "human" ? principal.userId : principal.kind === "agent" ? principal.tokenId : principal.service,
      })
      .returning();
    if (!row) return reply.code(500).send({ error: { code: "CREATE_FAILED", message: "insert failed" } });
    await recordEvent({
      householdId: row.householdId,
      obligationId: row.id,
      fromState: row.status,
      toState: row.status,
      principal,
      reason: "manual",
    });
    return reply.code(201).send(row);
  });

  app.get("/", async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: { code: "INVALID_QUERY", detail: q.error.flatten() } });
    const principal = await requireHouseholdMember(req, reply, q.data.householdId);
    if (!principal) return;

    const conditions = [eq(schema.obligations.householdId, q.data.householdId)];
    if (q.data.state) conditions.push(eq(schema.obligations.status, q.data.state));
    if (q.data.priority) conditions.push(eq(schema.obligations.priority, q.data.priority));
    if (q.data.risk) conditions.push(eq(schema.obligations.risk, q.data.risk));

    return db
      .select()
      .from(schema.obligations)
      .where(and(...conditions))
      .orderBy(desc(schema.obligations.createdAt))
      .limit(q.data.limit)
      .offset(q.data.offset);
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    const ids = principal.kind === "agent" ? [principal.householdId] : principal.kind === "human" ? undefined : [];
    const rows = await db
      .select()
      .from(schema.obligations)
      .where(
        ids
          ? and(eq(schema.obligations.id, id), inArray(schema.obligations.householdId, ids))
          : eq(schema.obligations.id, id),
      )
      .limit(50);
    const row = rows.find((r) => r.id === id);
    if (!row) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    if (principal.kind === "human" && !(await import("../lib/principal.js").then((m) => m.canAccessHousehold(principal, row.householdId)))) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    }
    return row;
  });

  /** Resource edit — fields only. State changes must go through /transitions. */
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_BODY", detail: parsed.error.flatten() } });
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id)).limit(1);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    if (current.householdId !== (principal.kind === "agent" ? principal.householdId : current.householdId) && principal.kind === "agent") {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    }
    if (principal.kind === "human") {
      const { canAccessHousehold } = await import("../lib/principal.js");
      if (!(await canAccessHousehold(principal, current.householdId))) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
      }
    }

    const updates: Partial<typeof schema.obligations.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary;
    if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
    if (parsed.data.dueAt !== undefined) updates.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    if (parsed.data.assignedTo !== undefined) updates.assignedTo = parsed.data.assignedTo;

    const [row] = await db.update(schema.obligations).set(updates).where(eq(schema.obligations.id, id)).returning();
    return row;
  });

  /**
   * State machine endpoint. Actor identity comes from the auth context, never
   * the body. Agents cannot enter needs_review (human gate), terminal states,
   * or verified — enforced by @caste/core and re-checked here.
   */
  app.post("/:id/transitions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        to: STATES,
        reason: z.string().max(60).default("manual"),
        evidenceId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { code: "INVALID_BODY", detail: body.error.flatten() } });

    const principal = await requirePrincipal(req, reply);
    if (!principal) return;

    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id)).limit(1);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    if (principal.kind === "agent" && current.householdId !== principal.householdId) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    }
    if (principal.kind === "human") {
      const { canAccessHousehold } = await import("../lib/principal.js");
      if (!(await canAccessHousehold(principal, current.householdId))) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
      }
    }

    // verified is human-only and requires evidence owned by this household.
    if (body.data.to === "verified") {
      if (principal.kind !== "human") {
        return reply.code(403).send({
          error: { code: "HUMAN_VERIFICATION_REQUIRED", message: "only a human may confirm an outcome" },
        });
      }
      if (!body.data.evidenceId) {
        return reply.code(400).send({ error: { code: "EVIDENCE_REQUIRED", message: "verified requires evidenceId" } });
      }
      const [ev] = await db.select().from(schema.evidence).where(eq(schema.evidence.id, body.data.evidenceId)).limit(1);
      if (!ev || ev.obligationId !== current.id || ev.householdId !== current.householdId) {
        return reply.code(404).send({ error: { code: "EVIDENCE_NOT_FOUND", message: "evidence not found for this obligation" } });
      }
    }

    const actor = actorOf(principal);
    const transitionArg = {
      actor,
      reason: body.data.reason as never,
      ...(body.data.evidenceId ? { evidenceId: body.data.evidenceId } : {}),
    };
    const err = canTransition(current.status as ObligationState, body.data.to, transitionArg);
    if (err) {
      return reply.code(409).send({ error: { code: "INVALID_TRANSITION", message: err.message } });
    }

    const next = transition(current.status as ObligationState, {
      from: current.status as ObligationState,
      to: body.data.to,
      ...transitionArg,
    });

    const [row] = await db
      .update(schema.obligations)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(schema.obligations.id, id))
      .returning();
    await recordEvent({
      householdId: current.householdId,
      obligationId: id,
      fromState: current.status,
      toState: next,
      principal,
      reason: body.data.reason,
      evidenceId: body.data.evidenceId ?? null,
    });
    return row;
  });

  /** Soft-delete: archive via the state machine, never a raw DELETE. */
  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id)).limit(1);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    if (principal.kind === "agent" && current.householdId !== principal.householdId) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    }
    if (principal.kind === "human") {
      const { canAccessHousehold } = await import("../lib/principal.js");
      if (!(await canAccessHousehold(principal, current.householdId))) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
      }
    }
    try {
      const next = transition(current.status as ObligationState, {
        from: current.status as ObligationState,
        to: "archived",
        actor: actorOf(principal),
        reason: "manual",
      });
      await db
        .update(schema.obligations)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(schema.obligations.id, id));
      await recordEvent({
        householdId: current.householdId,
        obligationId: id,
        fromState: current.status,
        toState: next,
        principal,
        reason: "manual",
      });
      return { ok: true, status: next };
    } catch (err) {
      return reply.code(409).send({ error: { code: "INVALID_TRANSITION", message: (err as Error).message } });
    }
  });

  /**
   * Attach evidence to an obligation. Humans only — agents may not manufacture
   * proof of an outcome, and `verified` consumes a human-created evidence row.
   */
  app.post("/:id/evidence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        kind: z.enum(["note", "url", "receipt", "document", "photo", "external_confirmation"]).default("note"),
        value: z.string().min(1).max(4000),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { code: "INVALID_BODY", detail: body.error.flatten() } });

    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    if (principal.kind !== "human") {
      return reply.code(403).send({
        error: { code: "HUMAN_ONLY", message: "only a human may attach evidence of an outcome" },
      });
    }

    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id)).limit(1);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    const { canAccessHousehold } = await import("../lib/principal.js");
    if (!(await canAccessHousehold(principal, current.householdId))) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    }

    const [row] = await db
      .insert(schema.evidence)
      .values({
        householdId: current.householdId,
        obligationId: current.id,
        kind: body.data.kind,
        value: body.data.value,
        createdByKind: "human",
        createdById: principal.userId,
      })
      .returning();
    return reply.code(201).send(row);
  });

  /** Evidence list for an obligation (household-scoped). */
  app.get("/:id/evidence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const principal = await requirePrincipal(req, reply);
    if (!principal) return;
    const [current] = await db.select().from(schema.obligations).where(eq(schema.obligations.id, id)).limit(1);
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    const { canAccessHousehold } = await import("../lib/principal.js");
    if (!(await canAccessHousehold(principal, current.householdId))) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "obligation not found" } });
    }
    const rows = await db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.obligationId, id));
    return rows;
  });
}
