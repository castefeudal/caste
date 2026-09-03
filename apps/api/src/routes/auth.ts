import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, and, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import * as schema from "../schema.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const loginBody = z.object({ email: z.string().email().max(200) });

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Reads the caste_session cookie and returns the user row, or null. */
export async function userFromRequest(req: {
  cookies: Record<string, string | undefined>;
}) {
  const raw = req.cookies?.caste_session;
  if (!raw) return null;
  const rows = await db
    .select({ user: schema.users, session: schema.sessions })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.token, hashToken(raw)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * Demo-mode passwordless login: an email is all it takes to get a session.
   * No password is stored; production hardening (magic links / OAuth) is a
   * planned, credential-gated step and is documented honestly in README.
   */
  app.post("/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    }
    const email = parsed.data.email.toLowerCase();

    let user: typeof schema.users.$inferSelect;
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) {
      user = existing;
    } else {
      const [created] = await db
        .insert(schema.users)
        .values({ email, name: email.split("@")[0] ?? "member" })
        .returning();
      if (!created) return reply.code(500).send({ error: "user_create_failed" });
      user = created;
    }

    const token = randomBytes(32).toString("hex");
    await db.insert(schema.sessions).values({
      token: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    reply.setCookie("caste_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
      secure: process.env.NODE_ENV === "production",
    });

    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.get("/me", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post("/logout", async (req, reply) => {
    const raw = req.cookies?.caste_session;
    if (raw) {
      await db.delete(schema.sessions).where(eq(schema.sessions.token, hashToken(raw)));
      reply.clearCookie("caste_session", { path: "/" });
    }
    return { ok: true };
  });
}
