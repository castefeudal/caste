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
| Obligation state machine (14 states, guarded transitions) | ✅ `@caste/core`, 10 tests |
| Agent policy (never verifies; no action under review)     | ✅ enforced in core + API + MCP |
| REST API (households, obligations, transitions, evidence) | ✅ Fastify + Postgres, 9 tests |
| AI extraction providers (OpenAI/Anthropic + demo fallback) | ✅ `@caste/ai`, 12 tests |
| MCP store (agent-token binding, obligations)              | ✅ `@caste/mcp`, 3 tests |
| Family board (create, capture, advance, verify w/ evidence) | ✅ Next.js `/app` |
| Agent integration (MCP stdio server)                      | ✅ `@caste/mcp`, 3 tools |
| Demo seed (idempotent)                                    | ✅ `pnpm db:seed` |
| CI (typecheck + tests on main and PRs)                    | ✅ green on GitHub Actions |

## Status: what works today

- Passwordless auth: POST /api/auth/login -> httpOnly session cookie (30d, sha256-hashed).
  Writes require a session -> 401. Magic-link email / OAuth are planned, credential-gated.
- AI extraction (demo provider): POST /api/extract turns text into a structured
  obligation draft, scored through the confidence policy. LLM providers are
  planned; the demo provider is deterministic and never hallucinates.
- Docker: `docker compose -f infra/docker-compose.yml up --build` runs
  Postgres 15 + API + Web with schema push on boot.
- CI: `.github/workflows/ci.yml` runs typecheck + the full vitest suite on
  every push to `main` and every PR; it is green on GitHub Actions.

## Credential-gated features (code shipped, activates with keys)

| Feature | Code | Activates with |
|---|---|---|
| Magic-link login | `POST /api/auth/magic-link` → one-time token → session | `EMAIL_URL` (SMTP); without it the link is logged (demo driver) |
| Google OAuth | `GET /api/auth/google` → callback → session | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| LLM extraction | OpenAI + Anthropic adapters behind `ExtractProvider`, demo fallback | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| Email ingestion | `POST /api/ingest/email` — RFC822 in, review-gated obligation out | `INGEST_TOKEN` for inbound webhooks |
| Web Push | VAPID keys generated; `/api/push/*` live | already enabled in this deployment |
| Stripe billing | checkout + signature-verified webhook | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` |

Unconfigured features degrade honestly: `503` / `push_not_configured` /
`billing_not_configured` — never a fake success.

## Structure

```
apps/
  web/        Next.js 15 — marketing home + /app family board (verify w/ evidence)
  api/        Fastify — auth, households, obligations, evidence, extract, ingest,
              push, billing, agent tokens (all guarded transitions)
packages/
  core/       obligation domain: 14-state machine, confidence policy, dedupe, permissions
  ai/         extraction providers (OpenAI, Anthropic, deterministic demo fallback)
  mcp/        MCP server over stdio: caste_list_obligations / caste_capture / caste_advance
docs/         ARCHITECTURE.md, AGENT_INTEGRATION.md
infra/        docker-compose + Dockerfiles (db + api + web)
scripts/      seed.ts — idempotent demo household
```

## Agent integration

See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md). Agents never bypass the
policy engine: the MCP `caste_advance` tool cannot verify, resolve, archive, dismiss,
or act while an obligation is under review — the server rejects it with 409.

## Security

Household is a hard authorization boundary. Obligation state transitions are validated
by `@caste/core` on every write path (REST and MCP); illegal jumps return 409.
Agent tokens are shown once and stored only as sha256 hashes; revocation is immediate.
Cross-household access returns 404 (no enumeration), never 403.
