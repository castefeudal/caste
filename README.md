# CASTE

**Shared Life OS.** From obligation to outcome. Из «надо» — в «сделано».

CASTE notices important obligations, helps the right person handle them, follows what's
waiting, and keeps important things from falling through the cracks. It is not another
task list: the core object is an **obligation** — a real commitment that travels the full
path from capture to verified outcome.

## Quick start

```bash
pnpm install
cp .env.example .env          # every variable documented; all integrations optional
pnpm docker:up                # or: start Postgres/Redis manually
pnpm db:migrate && pnpm db:seed
pnpm demo                     # API + web with a fully seeded demo household
```

Open http://localhost:3000 — sign in with any email (demo mode), or configure a real
email provider / Google OAuth in `.env` for production behaviour.

## What works without any third-party credentials

| Capability            | Demo provider              | Production adapter        |
| --------------------- | -------------------------- | ------------------------- |
| AI extraction         | `AI_PROVIDER=demo` (rule-based, deterministic) | OpenAI / Anthropic / Google via keys |
| Email capture         | Mailpit (local SMTP UI)    | any transactional provider |
| Calendar ingestion    | synthetic ICS fixtures     | Google / Microsoft OAuth  |
| Push notifications    | in-app only                | Web Push (VAPID)          |
| Payments              | none (billing disabled)    | Stripe                    |
| Agent actions         | approval-gated dry run     | real execution with audit |

The product is fully testable end-to-end in demo mode. No demo surface lies about being
connected: every integrations page shows the honest status (`demo` / `requires credentials`).

## Structure

```
apps/
  web/        Next.js 15 — Today, Inbox, Actions, People, History, Ask, Automations, Privacy
  api/        Fastify — /api/v1, agent gateway, OpenAPI, webhooks, audit
packages/
  core/       obligation domain: state machine, confidence policy, dedup, permissions
  ai/         provider router: classify/extract/vision/embed/reason/summarize/moderate
  agent-sdk/  TypeScript SDK for external agents (REST + MCP)
  mcp/        MCP server exposing caste_* tools over stdio/HTTP
examples/
  agent-client/  example agent that authenticates, reads Today, prepares safe actions
docs/         PRODUCT, ARCHITECTURE, DOMAIN_MODEL, SECURITY, PRIVACY, AI_ARCHITECTURE,
              AGENT_INTEGRATION, INTEGRATIONS, API, LOCAL_DEVELOPMENT, DEPLOYMENT,
              TESTING, OBSERVABILITY, ACCESSIBILITY
fixtures/     synthetic demo data (never real personal information)
infra/        Dockerfile, compose files
scripts/      seed.ts — idempotent demo household
```

## Agent integration

See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md). External agents never bypass
the policy engine: token → scope → risk class → approval gate → audit.

## Security

See [docs/SECURITY.md](docs/SECURITY.md). Household is a hard authorization boundary.
