import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "../db.js";
import { hashToken } from "./crypto.js";
import type { FastifyRequest } from "fastify";

/**
 * Principal: the server-derived identity of whoever is calling.
 * Never taken from the request body — actor identity is established by the
 * authentication context (session cookie or agent bearer token) only.
 */
export type Principal =
  | { kind: "human"; userId: string; email: string; name: string }
  | { kind: "agent"; tokenId: string; householdId: string; name: string }
  | { kind: "system"; service: string };

/** Reads the caste_session cookie → human Principal, or null. */
export async function humanFromRequest(req: FastifyRequest): Promise<Principal | null> {
  const raw = req.cookies?.caste_session;
  if (!raw) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(and(eq(schema.sessions.token, hashToken(raw)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const u = rows[0]?.user;
  if (!u) return null;
  return { kind: "human", userId: u.id, email: u.email, name: u.name };
}

/** Reads Authorization: Bearer caste_... → agent Principal bound to one household, or null. */
export async function agentFromRequest(req: FastifyRequest): Promise<Principal | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer caste_")) return null;
  const raw = auth.slice("Bearer ".length);
  const rows = await db
    .select()
    .from(schema.agentTokens)
    .where(and(eq(schema.agentTokens.tokenHash, hashToken(raw)), isNull(schema.agentTokens.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db.update(schema.agentTokens).set({ lastUsedAt: new Date() }).where(eq(schema.agentTokens.id, row.id));
  return { kind: "agent", tokenId: row.id, householdId: row.householdId, name: row.name };
}

/** Human first, then agent. Returns null when neither credential is valid. */
export async function principalFromRequest(req: FastifyRequest): Promise<Principal | null> {
  return (await humanFromRequest(req)) ?? (await agentFromRequest(req));
}

/** The households a principal may act within. Agents are hard-bound to one. */
export async function householdIdsFor(principal: Principal): Promise<string[]> {
  if (principal.kind === "agent") return [principal.householdId];
  if (principal.kind === "system") return [];
  const memberships = await db
    .select({ householdId: schema.memberships.householdId })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, principal.userId));
  return memberships.map((m) => m.householdId);
}

/** True when the principal is authorized inside the given household. */
export async function canAccessHousehold(principal: Principal, householdId: string): Promise<boolean> {
  const ids = await householdIdsFor(principal);
  return ids.includes(householdId);
}

/** Resolve the agent bearer token to a household, for MCP surfaces. */
export async function resolveAgentBearer(authHeader: string | undefined): Promise<{ tokenId: string; householdId: string; name: string } | null> {
  if (!authHeader?.startsWith("Bearer caste_")) return null;
  const raw = authHeader.slice("Bearer ".length);
  const rows = await db
    .select()
    .from(schema.agentTokens)
    .where(and(eq(schema.agentTokens.tokenHash, hashToken(raw)), isNull(schema.agentTokens.revokedAt)))
    .limit(1);
  if (!rows[0]) return null;
  await db.update(schema.agentTokens).set({ lastUsedAt: new Date() }).where(eq(schema.agentTokens.id, rows[0].id));
  return { tokenId: rows[0].id, householdId: rows[0].householdId, name: rows[0].name };
}

/** Ownership check: only the household owner may manage agent tokens / members. */
export async function isHouseholdOwner(principal: Principal, householdId: string): Promise<boolean> {
  if (principal.kind !== "human") return false;
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, principal.userId),
        eq(schema.memberships.householdId, householdId),
        eq(schema.memberships.role, "owner"),
      ),
    )
    .limit(1);
  return Boolean(membership);
}


