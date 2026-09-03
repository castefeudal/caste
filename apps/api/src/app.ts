import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { obligationsRoute } from "./routes/obligations.js";
import { healthRoute } from "./routes/health.js";
import { householdsRoute } from "./routes/households.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.register(healthRoute, { prefix: "/api/health" });
  app.register(obligationsRoute, { prefix: "/api/obligations" });
  app.register(householdsRoute, { prefix: "/api/households" });
  return app;
}
