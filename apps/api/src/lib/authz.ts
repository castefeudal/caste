import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canAccessHousehold, principalFromRequest, type Principal } from "./principal.js";

export type { Principal };

/**
 * Authorization guards. Each returns the Principal or has already sent the
 * error response (401 unauthenticated / 404 to avoid enumeration).
 */
export async function requirePrincipal(req: FastifyRequest, reply: FastifyReply): Promise<Principal | null> {
  const p = await principalFromRequest(req);
  if (!p) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "sign in or provide an agent token" } });
    return null;
  }
  return p;
}

export async function requireHouseholdMember(
  req: FastifyRequest,
  reply: FastifyReply,
  householdId: string,
): Promise<Principal | null> {
  const p = await requirePrincipal(req, reply);
  if (!p) return null;
  if (p.kind === "agent" && p.householdId !== householdId) {
    // 404, not 403: do not reveal that another household exists.
    await reply.code(404).send({ error: { code: "NOT_FOUND", message: "household not found" } });
    return null;
  }
  if (p.kind === "human" && !(await canAccessHousehold(p, householdId))) {
    await reply.code(404).send({ error: { code: "NOT_FOUND", message: "household not found" } });
    return null;
  }
  if (p.kind === "system") {
    await reply.code(403).send({ error: { code: "FORBIDDEN", message: "system principal requires explicit grant" } });
    return null;
  }
  return p;
}

export async function requireHuman(req: FastifyRequest, reply: FastifyReply): Promise<Extract<Principal, { kind: "human" }> | null> {
  const p = await principalFromRequest(req);
  if (!p || p.kind !== "human") {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "human session required" } });
    return null;
  }
  return p;
}

export { canAccessHousehold };
