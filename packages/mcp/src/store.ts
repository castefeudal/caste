import { createHash } from "node:crypto";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://caste:caste@localhost:5432/caste",
});

export async function resolveHousehold(agentToken: string): Promise<string | null> {
  const hash = createHash("sha256").update(agentToken).digest("hex");
  const { rows } = await pool.query<{ household_id: string }>(
    "SELECT household_id FROM agent_tokens WHERE token_hash = $1 AND revoked_at IS NULL",
    [hash],
  );
  return rows[0]?.household_id ?? null;
}

export interface ObligationRow {
  id: string;
  household_id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_to: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function listObligations(householdId: string): Promise<ObligationRow[]> {
  const { rows } = await pool.query<ObligationRow>(
    `SELECT * FROM obligations WHERE household_id = $1
     ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              due_at NULLS LAST, created_at`,
    [householdId],
  );
  return rows;
}

export async function getObligation(id: string): Promise<ObligationRow | null> {
  const { rows } = await pool.query<ObligationRow>(`SELECT * FROM obligations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function updateStatus(id: string, status: string): Promise<void> {
  await pool.query(`UPDATE obligations SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
}

export async function createObligation(input: {
  householdId: string;
  title: string;
  priority?: string;
  dueAt?: string | null;
}): Promise<ObligationRow> {
  const { rows } = await pool.query<ObligationRow>(
    `INSERT INTO obligations (household_id, title, priority, due_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.householdId, input.title, input.priority ?? "normal", input.dueAt ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("insert_obligation_failed");
  return row;
}

export async function householdExists(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`SELECT 1 FROM households WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
