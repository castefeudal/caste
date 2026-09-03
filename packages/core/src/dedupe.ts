import type { Obligation } from "./obligation.js";

export interface DupCandidate {
  title: string;
  dueAt: string | null;
  householdId: string;
}

/** Cheap deterministic dedup: same household + normalised title + same due date. */
export function isDuplicate(existing: Obligation, candidate: DupCandidate): boolean {
  if (existing.householdId !== candidate.householdId) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm(existing.title) !== norm(candidate.title)) return false;
  if (existing.dueAt && candidate.dueAt) return existing.dueAt === candidate.dueAt;
  return true;
}
