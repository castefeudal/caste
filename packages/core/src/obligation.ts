import { z } from "zod";

export const OBLIGATION_STATES = [
  "captured",
  "needs_review",
  "active",
  "assigned",
  "scheduled",
  "in_progress",
  "waiting",
  "blocked",
  "action_required",
  "verification_pending",
  "verified",
  "resolved",
  "dismissed",
  "archived",
] as const;

export type ObligationState = (typeof OBLIGATION_STATES)[number];

export type Actor = { type: "human" | "agent" | "system"; id: string };

export type TransitionReason =
  | "manual"
  | "agent_action"
  | "auto_progress"
  | "deadline_passed"
  | "response_received"
  | "followup_sent"
  | "evidence_confirmed"
  | "policy";

export interface Transition {
  from: ObligationState;
  to: ObligationState;
  actor: Actor;
  reason: TransitionReason;
  evidenceId?: string;
  at?: string;
}

/** Allowed transitions. Anything not listed is rejected — no free-form status writes. */
const ALLOWED: Record<ObligationState, ObligationState[]> = {
  captured: ["needs_review", "active", "dismissed", "archived"],
  needs_review: ["active", "dismissed"],
  active: ["assigned", "scheduled", "in_progress", "waiting", "blocked", "action_required", "dismissed", "archived"],
  assigned: ["scheduled", "in_progress", "waiting", "blocked", "active", "dismissed", "archived"],
  scheduled: ["in_progress", "waiting", "blocked", "active", "dismissed", "archived"],
  in_progress: ["waiting", "blocked", "verification_pending", "active", "dismissed", "archived"],
  waiting: ["action_required", "in_progress", "verification_pending", "blocked", "active", "dismissed", "archived"],
  blocked: ["active", "in_progress", "waiting", "dismissed", "archived"],
  action_required: ["in_progress", "waiting", "verification_pending", "blocked", "active", "dismissed", "archived"],
  verification_pending: ["verified", "in_progress", "waiting", "archived"],
  verified: ["resolved", "archived"],
  resolved: ["archived"],
  dismissed: ["archived"],
  archived: [],
};

export class TransitionError extends Error {
  constructor(
    public readonly from: ObligationState,
    public readonly to: ObligationState,
    message = "transition not allowed",
  ) {
    super(`${message}: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

/** Verifying an outcome requires evidence; verified is a claim, confirmed is a fact. */
export function canTransition(
  from: ObligationState,
  to: ObligationState,
  t: Pick<Transition, "actor" | "reason" | "evidenceId">,
): TransitionError | null {
  if (!ALLOWED[from]?.includes(to)) {
    return new TransitionError(from, to);
  }
  if (to === "verified" && !t.evidenceId) {
    return new TransitionError(from, to, "verified requires evidenceId");
  }
  if (t.actor.type === "agent") {
    if (from === "needs_review") {
      return new TransitionError(from, to, "review is a human gate");
    }
    if (["verified", "resolved", "archived", "dismissed"].includes(to)) {
      return new TransitionError(from, to, "agents may not enter terminal states");
    }
  }
  return null;
}

export function transition(state: ObligationState, t: Transition): ObligationState {
  const err = canTransition(state, t.to, t);
  if (err) throw err;
  return t.to;
}

export const Priority = z.enum(["low", "normal", "high", "urgent"]);
export type Priority = z.infer<typeof Priority>;

export const Risk = z.enum(["none", "financial", "medical", "legal", "privacy", "social", "irreversible"]);
export type Risk = z.infer<typeof Risk>;

export const obligationSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  title: z.string().min(1).max(300),
  summary: z.string().max(4000).default(""),
  priority: Priority.default("normal"),
  risk: Risk.default("none"),
  state: z.enum(OBLIGATION_STATES).default("captured"),
  ownerId: z.string().uuid().nullable(),
  dueAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Obligation = z.infer<typeof obligationSchema>;

/** Max autonomy per risk class (mandate §65–67). */
export function maxAutonomyLevel(risk: Risk): 0 | 1 | 2 | 3 {
  switch (risk) {
    case "none":
    case "social":
      return 2;
    case "privacy":
      return 1;
    case "financial":
    case "legal":
    case "medical":
    case "irreversible":
      return 0;
  }
}
