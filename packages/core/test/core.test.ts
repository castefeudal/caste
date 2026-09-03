import { describe, expect, it } from "vitest";
import {
  canTransition,
  transition,
  TransitionError,
  maxAutonomyLevel,
  decideConfidence,
  isDuplicate,
  requireScope,
  requireHousehold,
  AccessDenied,
  type Actor,
} from "../src/index.js";

const human: Actor = { type: "human", id: "u1" };

describe("obligation state machine", () => {
  it("walks the happy path", () => {
    let s = transition("captured", { from: "captured", to: "needs_review", actor: human, reason: "manual" });
    s = transition(s, { from: s, to: "active", actor: human, reason: "manual" });
    s = transition(s, { from: s, to: "assigned", actor: human, reason: "manual" });
    expect(s).toBe("assigned");
  });

  it("rejects unknown transitions", () => {
    expect(canTransition("captured", "verified", { actor: human, reason: "manual" })).toBeInstanceOf(
      TransitionError,
    );
  });

  it("requires evidence for verified", () => {
    expect(
      canTransition("verification_pending", "verified", { actor: human, reason: "evidence_confirmed" }),
    ).toBeInstanceOf(TransitionError);
    expect(
      canTransition("verification_pending", "verified", {
        actor: human,
        reason: "evidence_confirmed",
        evidenceId: "ev1",
      }),
    ).toBeNull();
  });

  it("agents may never verify outcomes", () => {
    const agent: Actor = { type: "agent", id: "bot" };
    expect(
      canTransition("verification_pending", "verified", {
        actor: agent,
        reason: "evidence_confirmed",
        evidenceId: "ev1",
      }),
    ).toBeInstanceOf(TransitionError);
  });
});

describe("confidence policy", () => {
  it("auto-creates only high-confidence low-risk", () => {
    expect(decideConfidence({ score: 0.97, risk: "none" }).action).toBe("auto_create");
    expect(decideConfidence({ score: 0.96, risk: "medical" }).action).toBe("needs_review");
    expect(decideConfidence({ score: 0.8, risk: "none" }).action).toBe("needs_review");
    expect(decideConfidence({ score: 0.5, risk: "none" }).action).toBe("do_not_create");
  });
});

describe("autonomy levels", () => {
  it("denies autonomy for high-risk classes", () => {
    expect(maxAutonomyLevel("financial")).toBe(0);
    expect(maxAutonomyLevel("medical")).toBe(0);
    expect(maxAutonomyLevel("none")).toBe(2);
  });
});

describe("dedupe", () => {
  const base = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    householdId: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
    title: "Submit school permission form",
    dueAt: "2026-09-18T15:00:00.000Z",
    summary: "",
    priority: "normal" as const,
    risk: "none" as const,
    state: "active" as const,
    ownerId: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  it("flags same title and due date in the same household", () => {
    expect(isDuplicate(base, { title: "submit school permission form", dueAt: base.dueAt, householdId: base.householdId })).toBe(true);
  });

  it("never crosses households", () => {
    expect(isDuplicate(base, { title: base.title, dueAt: base.dueAt, householdId: "other" })).toBe(false);
  });
});

describe("permissions", () => {
  const p = { householdId: "h1", scopes: ["obligations:read" as const] };
  it("enforces scopes", () => {
    expect(() => requireScope(p, "obligations:read")).not.toThrow();
    expect(() => requireScope(p, "actions:execute")).toThrow(AccessDenied);
  });
  it("enforces the household boundary", () => {
    expect(() => requireHousehold(p, "h1")).not.toThrow();
    expect(() => requireHousehold(p, "h2")).toThrow(AccessDenied);
  });
});
