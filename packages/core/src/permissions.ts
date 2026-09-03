export const SCOPES = [
  "household:read",
  "obligations:read",
  "obligations:create",
  "obligations:update",
  "actions:prepare",
  "actions:execute",
  "people:read",
  "documents:read",
] as const;

export type Scope = (typeof SCOPES)[number];

export interface Principal {
  householdId: string;
  scopes: Scope[];
}

export class AccessDenied extends Error {
  constructor(message = "access denied") {
    super(message);
    this.name = "AccessDenied";
  }
}

export function requireScope(p: Principal, scope: Scope): void {
  if (!p.scopes.includes(scope)) {
    throw new AccessDenied(`missing scope: ${scope}`);
  }
}

/** Household is the hard tenancy boundary (mandate §103). */
export function requireHousehold(p: Principal, householdId: string): void {
  if (p.householdId !== householdId) {
    throw new AccessDenied("cross-household access denied");
  }
}
