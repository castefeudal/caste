# CASTE

**Shared Life OS.** From obligation to outcome. Из «надо» — в «сделано».

CASTE notices important obligations, helps the right person handle them, follows what's
waiting, and keeps important things from falling through the cracks. It is not another
task list: the core object is an **obligation** — a real commitment that travels the full
path from capture to verified outcome.

## Quick start

```bash
pnpm install
createdb caste 2>/dev/null || true          # local Postgres 15
DATABASE_URL=postgres://caste:caste@localhost:5432/caste   pnpm --filter @caste/api db:push          # drizzle schema -> database
DATABASE_URL=postgres://caste:caste@localhost:5432/caste pnpm db:seed
pnpm demo                                    # API :4000 + web :3000
```

See `.env.example` for every variable; all integrations are optional.

## What works today (verified end-to-end)

| Capability            | Status |
| --------------------- | ------ |
| Obligation state machine (13 states, guarded transitions) | ✅ `@caste/core`, 10 tests |
| Agent policy (never verifies; no action under review)     | ✅ enforced in core + API + MCP |
| REST API (households, obligations, transitions)           | ✅ Fastify + Postgres, 3 tests |
| Family board (create, capture, advance)                   | ✅ Next.js `/app` |
| Agent integration (MCP stdio server)                      | ✅ `@caste/mcp`, 3 tools |
| Demo seed (idempotent)                                    | ✅ `pnpm db:seed` |

## Status: what works today

- Passwordless auth: POST /api/auth/login -> httpOnly session cookie (30d, sha256-hashed).
  Writes require a session -> 401. Magic-link email / OAuth are planned, credential-gated.
- AI extraction (demo provider): POST /api/extract turns text into a structured
  obligation draft, scored through the confidence policy. LLM providers are
  planned; the demo provider is deterministic and never hallucinates.
- Docker: `docker compose -f infra/docker-compose.yml up --build` runs
  Postgres 15 + API + Web with schema push on boot.
- CI: workflow exists at `.github/workflows/ci.yml` but cannot be pushed with
  the current deploy token (lacks `workflow` scope). Enable locally with:
  `gh auth refresh -s workflow` and re-commit the file.

## Planned, not yet built

Email/calendar ingestion, push notifications, Stripe billing, LLM extraction
providers (OpenAI/Anthropic behind the same ExtractProvider interface).

## Structure

```
apps/
  web/        Next.js 15 — marketing home + /app family board
  api/        Fastify — /api/health, /api/households, /api/obligations (guarded transitions)
packages/
  core/       obligation domain: 13-state machine, confidence policy, dedupe, permissions
  mcp/        MCP server over stdio: caste_list_obligations / caste_capture / caste_advance
docs/         ARCHITECTURE.md, AGENT_INTEGRATION.md
scripts/      seed.ts — idempotent demo household
```

## Agent integration

See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md). Agents never bypass the
policy engine: the MCP `caste_advance` tool cannot verify, resolve, archive, dismiss,
or act while an obligation is under review — the server rejects it with 409.

## Security

Household is a hard authorization boundary. Obligation state transitions are validated
by `@caste/core` on every write path (REST and MCP); illegal jumps return 409.
