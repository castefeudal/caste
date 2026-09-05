/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const app = buildApp();
let authed: (opts: Record<string, unknown>) => Promise<{ statusCode: number; json: () => any; cookies: unknown[] }>;

beforeAll(async () => {
  await app.ready();
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "test@caste.local" } });
  const cookie = login.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ");
  authed = (opts) => app.inject({ ...opts, headers: { ...((opts.headers as object) ?? {}), cookie } } as never);
});
afterAll(async () => { await app.close(); });

const HH = "00000000-0000-4000-8000-000000000001";

describe("caste api", () => {
  it("health", async () => {
    const res = await authed({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it("creates, lists, transitions, rejects bad transitions", async () => {
    const hh = await authed({
      method: "POST",
      url: "/api/households",
      payload: { name: "Test Household" },
    });
    expect(hh.statusCode).toBe(201);
    const householdId = hh.json().id;

    const missing = await authed({
      method: "POST",
      url: "/api/obligations",
      payload: { householdId: "00000000-0000-4000-8000-999999999999", title: "Ghost" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");

    const created = await authed({
      method: "POST",
      url: "/api/obligations",
      payload: { householdId, title: "Pay rent" },
    });
    expect(created.statusCode).toBe(201);
    const ob = created.json();
    expect(ob.status).toBe("captured");

    const list = await authed({ method: "GET", url: `/api/obligations?householdId=${householdId}` });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThan(0);

    const ok = await authed({
      method: "POST",
      url: `/api/obligations/${ob.id}/transitions`,
      payload: { to: "needs_review", reason: "manual" },
    });
    expect(ok.json().status).toBe("needs_review");

    const bad = await authed({
      method: "POST",
      url: `/api/obligations/${ob.id}/transitions`,
      payload: { to: "archived", reason: "manual" },
    });
    expect(bad.statusCode).toBe(409);

    const active = await authed({
      method: "POST",
      url: `/api/obligations/${ob.id}/transitions`,
      payload: { to: "active", reason: "manual" },
    });
    expect(active.statusCode).toBe(200);

    // A real agent (bearer token) may not push into terminal states.
    const tok = await authed({
      method: "POST",
      url: "/api/agent/tokens",
      payload: { name: "Hermes", householdId },
    });
    expect(tok.statusCode).toBe(201);
    const bearer = tok.json().token as string;
    const asAgent = (opts: Record<string, unknown>) =>
      app.inject({ ...opts, headers: { authorization: `Bearer ${bearer}` } } as never);

    const agentTerminal = await asAgent({
      method: "POST",
      url: `/api/obligations/${ob.id}/transitions`,
      payload: { to: "archived", reason: "agent_action" },
    });
    expect(agentTerminal.statusCode).toBe(409);

    // Agent may still act within its household: capture a new obligation.
    const agentCreate = await asAgent({
      method: "POST",
      url: "/api/obligations",
      payload: { householdId, title: "Renew passport" },
    });
    expect(agentCreate.statusCode).toBe(201);
  });

  it("extracts obligation from text", async () => {
    const res = await authed({ method: "POST", url: "/api/extract", payload: { text: "Оплатить страховку до завтра" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { extraction: { priority: string; dueAt: string | null; action: string } };
    expect(body.extraction.priority).toBe("high");
    expect(body.extraction.dueAt).toBeTruthy();
    expect(["auto_create", "needs_review", "do_not_create"]).toContain(body.extraction.action);
  });

  it("extract requires session", async () => {
    const res = await app.inject({ method: "POST", url: "/api/extract", payload: { text: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("validates input", async () => {
    const bad = await authed({ method: "POST", url: "/api/obligations", payload: { householdId: "nope" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("ingest", () => {
  it("accepts a forwarded email and creates a reviewed obligation", async () => {
    const raw = [
      "From: Billing <billing@isp.example>",
      "To: family@caste.local",
      "Subject: Счёт за интернет — оплатите до 20.09.2026",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Ваш счёт на 1500 руб. Оплатите до 20.09.2026.",
      "",
    ].join("\r\n");
    const res = await authed({
      method: "POST",
      url: "/api/ingest/email",
      payload: { raw: Buffer.from(raw).toString("base64") },
    });
    expect([200, 201]).toContain(res.statusCode);
    const body = res.json();
    expect(body.provenance.source).toBe("email");
    expect(body.obligation.title).toMatch(/интернет/i);
    expect(body.obligation.status).toBe("needs_review");
  });

  it("rejects unauthenticated ingest", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ingest/email", payload: { raw: "eHg=" } });
    expect(res.statusCode).toBe(401);
  });
});
