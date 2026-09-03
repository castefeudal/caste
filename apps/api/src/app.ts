import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { obligationsRoute } from "./routes/obligations.js";
import { healthRoute } from "./routes/health.js";
import { householdsRoute } from "./routes/households.js";
import { authRoutes } from "./routes/auth.js";
import { extractRoute } from "./routes/extract.js";
import { ingestRoute } from "./routes/ingest.js";
import { pushRoute } from "./routes/push.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true, credentials: true });
  app.register(cookie);
  app.register(healthRoute, { prefix: "/api/health" });
  app.register(obligationsRoute, { prefix: "/api/obligations" });
  app.register(householdsRoute, { prefix: "/api/households" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(extractRoute, { prefix: "/api/extract" });
  app.register(ingestRoute, { prefix: "/api/ingest" });
  app.register(pushRoute, { prefix: "/api/push" });
  return app;
}
