import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, and, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db.js";
import { sendMail } from "../lib/mail.js";
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

  /**
   * Magic-link login: creates a one-time, 15-minute login token and hands it
   * to the configured mail driver. In demo mode the link is logged; when SMTP
   * credentials are set (EMAIL_URL) it is emailed. The link completes login
   * via GET /api/auth/verify?token=...
   */
  app.post("/magic-link", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.flatten() });
    }
    const email = parsed.data.email.toLowerCase();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    // Do not reveal whether the address exists: same response either way.
    if (!user) return { ok: true, delivery: process.env.EMAIL_URL ? "email" : "demo" };

    const token = randomBytes(32).toString("hex");
    await db.insert(schema.loginTokens).values({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
    });
    const link = `${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/login?token=${token}`;
    if (process.env.EMAIL_URL) {
      await sendMail({
        to: user.email,
        subject: "Вход в CASTE",
        text: `Ваша ссылка для входа (действует 15 минут):\n\n${link}`,
      });
    } else {
      // logger is disabled; console so the link lands in service logs
      console.log(JSON.stringify({ level: 30, msg: "magic link (demo mail driver)", link }));
    }
    return { ok: true, delivery: process.env.EMAIL_URL ? "email" : "demo" };
  });

  /** Completes a magic-link login: one-time token -> session cookie. */
  app.get("/verify", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: "missing_token" });
    const [row] = await db
      .select()
      .from(schema.loginTokens)
      .where(eq(schema.loginTokens.tokenHash, hashToken(token)))
      .limit(1);
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return reply.code(401).send({ error: "invalid_token" });
    }
    await db.update(schema.loginTokens).set({ usedAt: new Date() }).where(eq(schema.loginTokens.id, row.id));
    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(schema.sessions).values({
      token: hashToken(sessionToken),
      userId: row.userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    reply.setCookie("caste_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
      secure: process.env.NODE_ENV === "production",
    });
    return reply.redirect(`${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/app`);
  });

  /** Google OAuth start. 503 unless GOOGLE_CLIENT_ID/SECRET are configured. */
  app.get("/google", async (req, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
      return reply.code(503).send({ error: "google_not_configured", hint: "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" });
    }
    const state = randomBytes(16).toString("hex");
    const redirectUri = `${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    reply.setCookie("caste_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    return reply.redirect(url.toString());
  });

  /** Google OAuth callback: code -> tokens -> userinfo -> user + session. */
  app.get("/google/callback", async (req, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return reply.code(503).send({ error: "google_not_configured" });
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state || state !== req.cookies?.caste_oauth_state) {
      return reply.code(401).send({ error: "invalid_state" });
    }
    reply.clearCookie("caste_oauth_state", { path: "/" });
    const redirectUri = `${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return reply.code(401).send({ error: "token_exchange_failed" });
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) return reply.code(401).send({ error: "token_exchange_failed" });
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) return reply.code(401).send({ error: "userinfo_failed" });
    const info = (await infoRes.json()) as { email?: string; name?: string };
    if (!info.email) return reply.code(401).send({ error: "email_missing" });
    const email = info.email.toLowerCase();
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    const user = existing
      ? existing
      : (await db.insert(schema.users).values({ email, name: info.name ?? email.split("@")[0] ?? "member" }).returning())[0];
    if (!user) return reply.code(500).send({ error: "user_create_failed" });
    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(schema.sessions).values({
      token: hashToken(sessionToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    reply.setCookie("caste_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
      secure: process.env.NODE_ENV === "production",
    });
    return reply.redirect(`${process.env.PUBLIC_APP_URL ?? "http://localhost:3000"}/app`);
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
