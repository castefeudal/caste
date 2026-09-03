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
| `packages/core` | Pure domain, zero I/O: 13-state obligation machine (`ALLOWED` whitelist), `canTransition`/`transition`, confidence policy (`decideConfidence` — `auto_create` only at score ≥ 0.95 and risk `none|low`), autonomy levels (`maxAutonomyLevel` by risk), 72 h dedupe window, household-scoped RBAC. Fully unit-tested (10 tests). |
| `apps/api` | Fastify + drizzle + Postgres. Routes validate with zod, then delegate every status change to `transition()`. Households are the authorization boundary; obligations reference their household by FK. |
| `apps/web` | Next.js 15 (App Router). Marketing home + `/app` family board (create household, capture obligation, advance status) via a typed API client. |
| `packages/mcp` | JSON-RPC MCP server over stdio. Tools: `caste_list_obligations`, `caste_capture`, `caste_advance`. Tool schemas restrict agents to legal target states; the store still runs every change through `@caste/core`. |

## Data model (Postgres)

- `households` — the hard boundary. Every query is scoped by `household_id`.
- `users`, `memberships (household_id, user_id, role)` — role per household.
- `obligations` — `household_id` FK, `status` (13 states), `priority`, `due_at`,
  `assigned_to`, timestamps. Transitions are guarded in application code by
  `@caste/core`, never by raw status writes.

## Invariants worth protecting

1. **No surface bypasses `transition()`.** A PATCH that would skip states returns
   `409 invalid_transition`; agents additionally cannot reach terminal states.
2. **`verified` = human + evidence.** `verification_pending → verified` requires an
   `evidenceId` and a human actor, in core and in every client.
3. **Confidence never auto-creates risky obligations.** `decideConfidence` sends
   anything with `risk > low` (financial, medical, legal, privacy, irreversible) to
   `needs_review` regardless of score.
4. **Honest docs.** README and docs describe only what exists; aspirational features
   live under "Planned, not yet built".

## Local development

```bash
createdb caste
DATABASE_URL=postgres://caste:caste@localhost:5432/caste pnpm --filter @caste/api db:push
DATABASE_URL=postgres://caste:caste@localhost:5432/caste pnpm db:seed
pnpm demo          # api :4000, web :3000
pnpm test          # vitest across packages (uses caste_test database)
```

## Planned, not yet built

Auth (OAuth/email), AI extraction providers, email/calendar ingestion, push
notifications, Stripe billing, Docker infra, CI in-repo (token lacks `workflow`
scope; the workflow file is kept locally at `.github/workflows/ci.yml`).
