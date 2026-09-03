import type { FastifyInstance } from "fastify";

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ ok: true, service: "caste-api", ts: new Date().toISOString() }));
}
