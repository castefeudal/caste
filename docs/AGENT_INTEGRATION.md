# Agent Integration

External agents integrate with CASTE through an MCP server (stdio) or the REST API.
Both surfaces enforce the same policy engine from `@caste/core` — an agent cannot do
anything through integration that it could not do in the product.

## Policy invariants (enforced everywhere)

1. **Agents never verify outcomes.** `verified` requires evidence and a human actor.
   A verified obligation is a confirmed fact about the world, not an agent's claim.
2. **No agent action while an obligation is under `needs_review`.** Review is a
   human gate: only a human can move an obligation out of review.
3. **Agents never archive, dismiss, or resolve.** Terminal states are human decisions.
4. Every transition carries an actor (`human` / `agent` / `system`), a reason, and a
   timestamp; illegal transitions return `409 invalid_transition`.

## MCP server (stdio)

Package: `packages/mcp` (server name: `caste-mcp`).

### Setup (agent-token binding)

An external agent is bound to exactly one household via an **agent token**:

1. As a human user, log into the web app and issue a token:
   `POST /api/agent/tokens` with `{ "name": "hermes" }` (session cookie required).
   The plaintext token `caste_...` is returned **exactly once** - only its sha256
   hash is stored server-side.
2. Give the MCP server the token via `CASTE_AGENT_TOKEN`. It resolves to the
   household on every call, so tools never need a `householdId` argument:

```json
{
  "mcpServers": {
    "caste": {
      "command": "pnpm",
      "args": ["--filter", "@caste/mcp", "start"],
      "env": {
        "DATABASE_URL": "postgresql://caste:caste@localhost:5432/caste",
        "CASTE_AGENT_TOKEN": "caste_..."
      }
    }
  }
}
```

`GET /api/agent/me` with `Authorization: Bearer caste_...` confirms the binding
(`{ householdId, tokenId }`). Revoking the token (DELETE `/api/agent/tokens/:id`)
cuts the agent off immediately. `lastUsedAt` on the token row gives the human
visibility into agent activity.

### Tools

| Tool | Input | Notes |
| ---- | ----- | ----- |
| `caste_list_obligations` | `householdId` (uuid) | Sorted by priority, then due date. |
| `caste_capture` | `householdId`, `title` (≤280), `priority?`, `dueAt?` | Created in `captured`. Rejects unknown households (`household_not_found`). |
| `caste_advance` | `obligationId`, `to`, `reason?` | `to` is restricted to agent-legal states (no `verified`, `resolved`, `archived`, `dismissed`). Policy violations return a text error, not a crash. |

### Example session

```jsonc
// request
{"jsonrpc":"2.0","id":3,"method":"tools/call",
 "params":{"name":"caste_list_obligations",
           "arguments":{"householdId":"00000000-0000-4000-8000-000000000001"}}}
// response (content[0].text is JSON)
[{"id":"53f8720f-…","title":"Продлить страховку ОСАГО","status":"needs_review",
  "priority":"critical","dueAt":"2026-09-12T12:00:00.000Z"}, …]
```

## REST API

Base: `http://localhost:4000` (Fastify, `apps/api`).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/health` | Liveness. |
| `POST` | `/api/agent/tokens` | Issue agent token `{ name }` (session). Returns plaintext `caste_...` once. |
| `GET` | `/api/agent/tokens` | List agent tokens (no secrets). |
| `GET` | `/api/agent/me` | Bearer `caste_...` -> `{ householdId, tokenId }`. |
| `DELETE` | `/api/agent/tokens/:id` | Revoke a token. |
| `POST` | `/api/households` | Create household `{ name }`. |
| `GET` | `/api/households` | List households. |
| `POST` | `/api/obligations` | `{ householdId, title, priority?, dueAt?, assignedTo? }` → `201`, status `captured`. Unknown household → `404 household_not_found`. |
| `GET` | `/api/obligations?householdId=…` | List for household. |
| `GET` | `/api/obligations/:id` | Single obligation. |
| `PATCH` | `/api/obligations/:id` | Edit fields: `{ title?, summary?, priority?, dueAt?, assignedTo? }`. |
| `POST` | `/api/obligations/:id/transitions` | State machine: `{ to, reason?, evidenceId? }`. Actor identity comes from the auth context (never the body). Illegal transition → `409`; agent attempting terminal/verified → `403`/`409`. |
| `POST` | `/api/obligations/:id/evidence` | Attach evidence `{ value, kind? }` (human session only) → `201` with the evidence row. |
| `GET` | `/api/obligations/:id/evidence` | List evidence rows for an obligation (household-scoped). |
| `DELETE` | `/api/obligations/:id` | Archive via the state machine (not a raw write). |

## State machine (reference)

```
captured → needs_review → active → assigned → scheduled → in_progress
         → waiting/blocked/action_required → verification_pending
         → verified (human + evidenceId) → resolved → archived
```

- Allowed edges are whitelisted in `packages/core/src/obligation.ts` (`ALLOWED`).
- Anything not listed is rejected — no free-form status writes.
- `archived` is reachable only from active-family states, never from `needs_review`.
