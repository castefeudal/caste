import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db.js";
import { userFromRequest } from "./auth.js";

const PLAN_PRICES: Record<string, string> = {
  family_monthly: process.env.STRIPE_PRICE_FAMILY_MONTHLY ?? "",
  family_yearly: process.env.STRIPE_PRICE_FAMILY_YEARLY ?? "",
};

/**
 * Billing: Stripe Checkout for the family plan.
 * 503 with an explicit error until STRIPE_SECRET_KEY + price IDs are set —
 * never a fake success. Webhook handler verifies signatures when configured.
 */
export async function billingRoute(app: FastifyInstance) {
  const secret = process.env.STRIPE_SECRET_KEY;

  app.get("/config", () => ({
    enabled: Boolean(secret && Object.values(PLAN_PRICES).some(Boolean)),
    plans: Object.keys(PLAN_PRICES),
  }));

  app.post("/checkout", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const parsed = z
      .object({ plan: z.enum(["family_monthly", "family_yearly"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    }
    if (!secret) {
      return reply.code(503).send({ error: "billing_not_configured" });
    }
    const priceId = PLAN_PRICES[parsed.data.plan];
    if (!priceId) return reply.code(503).send({ error: "billing_not_configured" });

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secret);

    const origin = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      success_url: `${origin}/app?billing=success`,
      cancel_url: `${origin}/app?billing=cancelled`,
      metadata: { userId: user.id, plan: parsed.data.plan },
    });

    return reply.code(303).send({ url: session.url });
  });

  app.post("/webhook", async (req, reply) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !webhookSecret) return reply.code(503).send({ error: "billing_not_configured" });

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secret);
    const sig = req.headers["stripe-signature"];
    if (typeof sig !== "string") return reply.code(400).send({ error: "missing_signature" });

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch {
      return reply.code(400).send({ error: "invalid_signature" });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: Record<string, string> };
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan ?? "family_monthly";
      if (userId) {
        await db
          .update(schema.users)
          .set({ plan, planStatus: "active" })
          .where(eq(schema.users.id, userId));
      }
    }
    return reply.code(200).send({ received: true });
  });
}
