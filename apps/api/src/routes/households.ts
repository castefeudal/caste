import type { FastifyInstance } from "fastify";
import { userFromRequest } from "./auth.js";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "../schema.js";

const createBody = z.object({
  name: z.string().min(1).max(120),
  timezone: z.string().max(64).optional(),
});

export async function householdsRoute(app: FastifyInstance): Promise<void> {
  app.post("/", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    void user;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    const [row] = await db.insert(schema.households).values({ name: parsed.data.name }).returning();
    return reply.code(201).send(row);
  });

  app.get("/", async () => db.select().from(schema.households).orderBy(schema.households.createdAt));
}
