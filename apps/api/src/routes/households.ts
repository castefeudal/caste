import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "../schema.js";
import { userFromRequest } from "./auth.js";

const createBody = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().max(64).optional(),
});

export async function householdsRoute(app: FastifyInstance): Promise<void> {
  app.post("/", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });

    const [household] = await db
      .insert(schema.households)
      .values({ name: parsed.data.name })
      .returning();
    if (!household) return reply.code(500).send({ error: "create_failed" });

    // The creator becomes the household owner — hard authorization boundary.
    await db
      .insert(schema.memberships)
      .values({ householdId: household.id, userId: user.id, role: "owner" });

    return reply.code(201).send(household);
  });

  // Households are visible only to their members.
  app.get("/", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const memberships = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, user.id));
    const ids = memberships.map((m) => m.householdId);
    if (ids.length === 0) return [];

    const rows = await db.select().from(schema.households);
    return rows.filter((h) => ids.includes(h.id));
  });
}
