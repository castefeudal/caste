import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const app = buildApp();

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });

const HH = "00000000-0000-4000-8000-000000000001";

describe("caste api", () => {
  it("health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it("creates, lists, transitions, rejects bad transitions", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/obligations",
      payload: { householdId: HH, title: "Pay rent" },
    });
    expect(created.statusCode).toBe(201);
    const ob = created.json();
    expect(ob.status).toBe("captured");

    const list = await app.inject({ method: "GET", url: `/api/obligations?householdId=${HH}` });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThan(0);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/obligations/${ob.id}`,
      payload: { actorType: "human", actorId: "u1", status: "needs_review" },
    });
    expect(ok.json().status).toBe("needs_review");

    const bad = await app.inject({
      method: "PATCH",
      url: `/api/obligations/${ob.id}`,
      payload: { actorType: "human", actorId: "u1", status: "archived" },
    });
    expect(bad.statusCode).toBe(409);

    const agent = await app.inject({
      method: "PATCH",
      url: `/api/obligations/${ob.id}`,
      payload: { actorType: "agent", actorId: "bot", status: "active" },
    });
    expect(agent.statusCode).toBe(409);
  });

  it("validates input", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/obligations", payload: { householdId: "nope" } });
    expect(bad.statusCode).toBe(400);
  });
});
