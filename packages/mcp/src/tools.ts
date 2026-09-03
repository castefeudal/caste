import { transition, type Actor } from "@caste/core";
import * as store from "./store.js";

const AGENT: Actor = { type: "agent", id: "mcp-agent" };

export const TOOL_DEFS = [
  {
    name: "caste_list_obligations",
    description:
      "List a household's obligations, sorted by priority then due date. Use this to see what is captured, in review, active, or stuck.",
    inputSchema: {
      type: "object",
      properties: {
        householdId: { type: "string", description: "Household UUID" },
      },
      required: ["householdId"],
    },
  },
  {
    name: "caste_capture",
    description:
      "Capture a new obligation (e.g. from a message: 'pay the electricity bill by Friday'). Created in 'captured' state.",
    inputSchema: {
      type: "object",
      properties: {
        householdId: { type: "string" },
        title: { type: "string", maxLength: 280 },
        priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
        dueAt: { type: "string", description: "ISO 8601 datetime, optional" },
      },
      required: ["householdId", "title"],
    },
  },
  {
    name: "caste_advance",
    description:
      "Move an obligation to the next allowed state (assigned/scheduled/in_progress/waiting/blocked/action_required/verification_pending/active). Policy: agents may not verify outcomes, may not act while an obligation is under needs_review, and may not archive/dismiss/resolve.",
    inputSchema: {
      type: "object",
      properties: {
        obligationId: { type: "string" },
        to: {
          type: "string",
          enum: ["needs_review", "active", "assigned", "scheduled", "in_progress", "waiting", "blocked", "action_required", "verification_pending"],
        },
        reason: {
          type: "string",
          enum: ["agent_action", "auto_progress", "deadline_passed", "response_received", "followup_sent"],
        },
      },
      required: ["obligationId", "to"],
    },
  },
] as const;

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export async function callTool(name: string, args: Record<string, JsonValue>): Promise<JsonValue> {
  switch (name) {
    case "caste_list_obligations": {
      const rows = await store.listObligations(String(args.householdId));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        dueAt: r.due_at,
      }));
    }
    case "caste_capture": {
      const householdId = String(args.householdId);
      if (!(await store.householdExists(householdId))) {
        throw new Error(`household_not_found: ${householdId}`);
      }
      const row = await store.createObligation({
        householdId,
        title: String(args.title),
        ...(args.priority ? { priority: String(args.priority) } : {}),
        dueAt: args.dueAt ? String(args.dueAt) : null,
      });
      return { id: row.id, status: row.status };
    }
    case "caste_advance": {
      const id = String(args.obligationId);
      const row = await store.getObligation(id);
      if (!row) throw new Error(`not_found: ${id}`);
      if (row.status === "needs_review") {
        throw new Error("review_gate: obligation is under human review; an agent may not act on it");
      }
      const next = transition(row.status as never, {
        from: row.status as never,
        to: String(args.to) as never,
        actor: AGENT,
        reason: (args.reason ? String(args.reason) : "agent_action") as never,
      });
      await store.updateStatus(id, next);
      return { id, from: row.status, to: next };
    }
    default:
      throw new Error(`unknown_tool: ${name}`);
  }
}
