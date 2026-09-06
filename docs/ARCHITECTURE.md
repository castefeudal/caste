# Architecture

CASTE is a monorepo of small, independently testable packages. The domain rules live
in one place (`@caste/core`); every surface (REST API, MCP, future clients) calls the
same functions, so policy cannot drift between surfaces.

```
┌────────────┐   MCP stdio   ┌─────────────┐
│ AI agents  │──────────────▶│ packages/mcp│
└────────────┘               └──────┬──────┘
                                    │ same store
┌────────────┐   REST (JSON) ┌──────▼──────┐   SQL   ┌──────────┐
│ Next.js web│──────────────▶│  apps/api   │────────▶│ Postgres │
└────────────┘               │ (Fastify)   │         └──────────┘
                             └──────┬──────┘
                                    │ imports
                             ┌──────▼───────┐
                             │ packages/core│  state machine, confidence
                             │  (domain)    │  policy, autonomy, dedupe, RBAC
                             └──────────────┘
```

## Packages

| Package | Role |
| ------- | ---- |
| `packages/core` | Pure domain, zero I/O: 14-state obligation machine (`ALLOWED` whitelist), `canTransition`/`transition`, confidence policy (`decideConfidence` — `auto_create` only at score ≥ 0.95 and risk `none|low`), autonomy levels (`maxAutonomyLevel` by risk), 72 h dedupe window, household-scoped RBAC. Fully unit-tested (10 tests). |
| `apps/api` | Fastify + drizzle + Postgres. Routes validate with zod, then delegate every status change to `transition()`. Households are the authorization boundary; obligations reference their household by FK. Principals: human session cookie or agent bearer token (`caste_…`, bound to one household) — actor identity is never taken from the request body. |
| `apps/web` | Next.js 15 (App Router). Marketing home + `/app` family board (create household, capture obligation, advance status, verify with evidence) via a typed API client. |
| `packages/ai` | Extraction providers behind one `ExtractProvider` interface: OpenAI, Anthropic, and a deterministic demo fallback (never hallucinates, degrades gracefully on provider failure). |
| `packages/mcp` | JSON-RPC MCP server over stdio. Tools: `caste_list_obligations`, `caste_capture`, `caste_advance`. Tool schemas restrict agents to legal target states; the store still runs every change through `@caste/core`. |

## Data model (Postgres)

- `households` — the hard boundary. Every query is scoped by `household_id`.
- `users`, `memberships (household_id, user_id, role)` — role per household.
- `obligations` — `household_id` FK, `status` (14 states), `priority`, `risk`,
  `due_at`, `assigned_to`, `source`, timestamps. Transitions are guarded in
  application code by `@caste/core`, never by raw status writes.
- `obligation_events` — append-only audit log: every transition with actor kind,
  actor id, reason, and optional `evidence_id`.
- `evidence` — human-confirmed proof required for `verification_pending → verified`.
- `agent_tokens` — sha256-hashed bearer tokens binding an external agent to one
  household; `last_used_at` for visibility, `revoked_at` for immediate cutoff.
- `sessions` / `login_tokens` — hashed session cookies and one-time magic links.
- `push_subscriptions`, `inbound_mailboxes`, `ingested_emails` — web-push and
  email ingestion surfaces.

## Invariants worth protecting

1. **No surface bypasses `transition()`.** A PATCH that would skip states returns
   `409 invalid_transition`; agents additionally cannot reach terminal states.
2. **`verified` = human + evidence.** `verification_pending → verified` requires an
   `evidenceId` and a human actor, in core and in every client.
3. **Confidence never auto-creates risky obligations.** `decideConfidence` sends
   anything with `risk > low` (financial, medical, legal, privacy, irreversible) to
   `needs_review` regardless of score.
4. **Agents cannot act under review or reach terminal states.** Enforced in
   `@caste/core` and mirrored by the MCP tool schemas.
5. **Unconfigured integrations fail honestly** with `503` / explicit error codes —
   never a fake success.
6. **Honest docs.** README and docs describe only what exists; aspirational features
   live under "Planned, not yet built".

## Local development

```bash
createdb caste
DATABASE_URL=postgres://caste:caste@localhost:5432/caste pnpm --filter @caste/api db:push
DATABASE_URL=postgres://caste:caste@localhost:5432/caste pnpm db:seed
pnpm demo          # api :4000, web :3000
pnpm test          # vitest across packages (uses caste_test database)
```

## Deployed and running

Auth (magic-link + Google OAuth + passwordless demo login), AI extraction
(OpenAI/Anthropic with demo fallback), email ingestion (`/api/ingest/email`),
web push, Stripe billing, Docker infra, and CI in-repo (`.github/workflows/ci.yml`,
green on GitHub Actions) are all shipped. Credential-gated features activate with
their keys and degrade honestly (`503`) without them — see README.
