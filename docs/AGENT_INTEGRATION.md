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

```json
{
  "mcpServers": {
    "caste": {
      "command": "pnpm",
      "args": ["--filter", "@caste/mcp", "start"],
      "env": { "DATABASE_URL": "postgresql://caste:caste@localhost:5432/caste" }
    }
  }
}
```

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
| `POST` | `/api/households` | Create household `{ name }`. |
| `GET` | `/api/households` | List households. |
| `POST` | `/api/obligations` | `{ householdId, title, priority?, dueAt?, assignedTo? }` → `201`, status `captured`. Unknown household → `404 household_not_found`. |
| `GET` | `/api/obligations?householdId=…` | List for household. |
| `GET` | `/api/obligations/:id` | Single obligation. |
| `PATCH` | `/api/obligations/:id` | `{ actorType, actorId, status?, priority?, dueAt?, title?, assignedTo? }`. Illegal transition → `409`. |
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
