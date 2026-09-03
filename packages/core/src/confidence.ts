import type { Risk } from "./obligation.js";

export interface ExtractionConfidence {
  score: number; // 0..1
  risk: Risk;
}

export type ConfidenceDecision =
  | { action: "auto_create"; requiresApproval: false }
  | { action: "needs_review"; requiresApproval: true }
  | { action: "do_not_create"; requiresApproval: false };

/**
 * Precision > recall for high-risk auto-creation (mandate §119).
 * >= 0.95 and low risk  -> auto-create
 * 0.75..0.95            -> review queue
 * < 0.75                -> nothing surfaced
 */
export function decideConfidence({ score, risk }: ExtractionConfidence): ConfidenceDecision {
  const threshold = risk === "none" || risk === "social" ? 0.95 : 0.98;
  if (score >= threshold) return { action: "auto_create", requiresApproval: false };
  if (score >= 0.75) return { action: "needs_review", requiresApproval: true };
  return { action: "do_not_create", requiresApproval: false };
}
