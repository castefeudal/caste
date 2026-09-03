import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import * as schema from "../src/schema.js";
import { eq } from "drizzle-orm";

describe("push", () => {
  it("exposes vapid public key when configured", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/push/key" });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
    expect(res.json().publicKey).toContain("BHOb");
    await app.close();
  });

  it("stores and dedupes subscriptions per endpoint", async () => {
    const email = `push-${Date.now()}@caste.local`;
    const [u] = await db.insert(schema.users).values({ email, name: "push" }).returning();
    await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, u!.id));
    const ep = `https://fcm.googleapis.com/test/${Date.now()}`;
    await db.insert(schema.pushSubscriptions).values({ userId: u!.id, endpoint: ep, p256dh: "k", auth: "a" });
    const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, u!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpoint).toBe(ep);
  });
});
