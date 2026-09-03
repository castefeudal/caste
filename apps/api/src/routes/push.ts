import type { FastifyInstance } from "fastify";
import webpush from "web-push";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db.js";
import { userFromRequest } from "./auth.js";

const vapidPublic = process.env.VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const configured = Boolean(vapidPublic && vapidPrivate);
if (configured) webpush.setVapidDetails("mailto:noreply@caste.local", vapidPublic!, vapidPrivate!);

const subBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(400),
    auth: z.string().min(1).max(400),
  }),
});

export async function pushRoute(app: FastifyInstance) {
  /** Public key for PushManager.subscribe(); 503 until VAPID keys are set. */
  app.get("/key", () => {
    if (!configured) return { enabled: false };
    return { enabled: true, publicKey: vapidPublic };
  });

  /** Save or replace the caller's push subscription. */
  app.post("/subscribe", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const parsed = subBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });

    await db
      .insert(schema.pushSubscriptions)
      .values({ userId: user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
      });
    return { ok: true };
  });

  app.post("/unsubscribe", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const parsed = subBody.pick({ endpoint: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    await db
      .delete(schema.pushSubscriptions)
      .where(and(eq(schema.pushSubscriptions.userId, user.id), eq(schema.pushSubscriptions.endpoint, parsed.data.endpoint)));
    return { ok: true };
  });

  /** Internal: fire a push to every subscription of a user. Used on review-required events. */
  app.post("/notify", async (req, reply) => {
    if (!configured) return reply.code(503).send({ error: "push_not_configured" });
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const parsed = z.object({ title: z.string().max(200), body: z.string().max(500) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });

    const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, user.id));
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: parsed.data.title, body: parsed.data.body }),
        ),
      ),
    );
    let sent = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "fulfilled") sent++;
      else if ((r.reason as { statusCode?: number })?.statusCode === 410) {
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, subs[i]!.endpoint));
      }
    }
    return { ok: true, sent, total: subs.length };
  });
}
