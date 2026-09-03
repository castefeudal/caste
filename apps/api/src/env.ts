// Loads apps/api/.env before any module reads process.env.
// ESM import order guarantees this runs before app.js.
import { readFileSync } from "node:fs";
try {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m?.[1] && m[2] !== undefined && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
