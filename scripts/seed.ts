/**
 * Seed CASTE with a demo household.
 * Usage: DATABASE_URL=postgres://... bun run scripts/seed.ts  (or tsx)
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-0000000000a1";

async function main() {
  await pool.query(
    `INSERT INTO households (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [HOUSEHOLD, "Семья Ивановых"],
  );
  await pool.query(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [USER, "anna@caste.example", "Анна"],
  );
  await pool.query(
    `INSERT INTO memberships (household_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [HOUSEHOLD, USER, "owner"],
  );
  const obligations: Array<[string, string, string, string | null]> = [
    ["Оплатить счёт за электричество", "high", "active", "2026-09-05T18:00:00Z"],
    ["Продлить страховку ОСАГО", "critical", "needs_review", "2026-09-12T12:00:00Z"],
    ["Записать Машу к стоматологу", "normal", "captured", null],
    ["Заменить фильтр в аквариуме", "low", "in_progress", "2026-09-20T10:00:00Z"],
  ];
  for (const [title, priority, status, dueAt] of obligations) {
    await pool.query(
      `INSERT INTO obligations (household_id, title, priority, status, due_at)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM obligations
         WHERE household_id = $1 AND title = $2 AND status <> 'archived'
       )`,
      [HOUSEHOLD, title, priority, status, dueAt],
    );
  }
  const { rows } = await pool.query(
    `SELECT status, count(*)::int AS n FROM obligations WHERE household_id = $1 GROUP BY status`,
    [HOUSEHOLD],
  );
  console.log("Seeded household", HOUSEHOLD);
  console.table(rows);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
