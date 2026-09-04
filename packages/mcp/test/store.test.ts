import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import * as store from "../src/store.js";

const TEST_DB = process.env.DATABASE_URL ?? "postgres://caste:caste@localhost:5432/caste_test";
const pool = new Pool({ connectionString: TEST_DB });

let householdId = "";
let agentToken = "";

async function uniqueEmail() {
  return `mcp-${randomBytes(6).toString("hex")}@test.caste`;
}

async function hashOf(token: string) {
  const { rows } = await pool.query("SELECT digest FROM (SELECT encode(sha256($1::bytea), 'hex') AS digest) t", [
    Buffer.from(token),
  ]);
  return rows[0].digest as string;
}

beforeAll(async () => {
  const email = await uniqueEmail();
  const { rows: userRows } = await pool.query<{ id: string }>(
    "INSERT INTO users (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = userRows[0].id;
  const { rows: houseRows } = await pool.query<{ id: string }>(
    "INSERT INTO households (name) VALUES ($1) RETURNING id",
    ["MCP Test Household"],
  );
  householdId = houseRows[0].id;
  await pool.query("INSERT INTO memberships (user_id, household_id, role) VALUES ($1, $2, 'owner')", [
    userId,
    householdId,
  ]);

  agentToken = `caste_${randomBytes(24).toString("hex")}`;
  await pool.query(
    "INSERT INTO agent_tokens (name, token_hash, household_id) VALUES ($1, $2, $3)",
    ["mcp-test", await hashOf(agentToken), householdId],
  );
});

describe("mcp store", () => {
  it("resolves a live agent token to its household", async () => {
    const resolved = await store.resolveHousehold(agentToken);
    expect(resolved).toBe(householdId);
  });

  it("rejects an unknown agent token", async () => {
    const resolved = await store.resolveHousehold("caste_does_not_exist");
    expect(resolved).toBeNull();
  });

  it("creates, lists, and transitions obligations", async () => {
    const created = await store.createObligation({
      householdId,
      title: "MCP smoke obligation",
      priority: "high",
      source: "agent",
      provenance: { channel: "mcp-test" },
    });
    expect(created.title).toBe("MCP smoke obligation");

    const rows = await store.listObligations(householdId);
    expect(rows.length).toBeGreaterThan(0);
    const found = rows.find((r) => r.id === created.id);
    expect(found?.status).toBe("captured");

    await store.updateStatus(created.id, "in_progress");
    const after = await store.getObligation(created.id);
    expect(after?.status).toBe("in_progress");

    await pool.query("DELETE FROM obligations WHERE id = $1", [created.id]);
  });
});
