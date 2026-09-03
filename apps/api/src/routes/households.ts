import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, schema } from "../db.js";

const createBody = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().max(64).optional(),
});

export async function householdsRoute(app: FastifyInstance): Promise<void> {
  app.post("/", async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    const [row] = await db.insert(schema.households).values({ name: parsed.data.name }).returning();
    return reply.code(201).send(row);
  });

  app.get("/", async () => db.select().from(schema.households).orderBy(schema.households.createdAt));
}
