export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Obligation = {
  id: string;
  householdId: string;
  title: string;
  status: string;
  priority: string;
  risk: "now" | "soon" | "later";
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Household = { id: string; name: string; createdAt: string };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  createHousehold: (name: string) =>
    req<Household>("/api/households", { method: "POST", body: JSON.stringify({ name }) }),
  listHouseholds: () => req<Household[]>("/api/households"),
  extract: (text: string) =>
    req<{ extraction: { title: string; priority?: string; dueAt: string | null; confidence: number; action: string } }>("/api/extract", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  listObligations: (householdId: string) =>
    req<Obligation[]>(`/api/obligations?householdId=${householdId}`),
  createObligation: (householdId: string, title: string, priority: string, dueAt?: string) =>
    req<Obligation>("/api/obligations", {
      method: "POST",
      body: JSON.stringify({ householdId, title, priority, dueAt: dueAt || undefined }),
    }),
  transition: (
    id: string,
    status: string,
    actorType: "human" | "agent" = "human",
    actorId = "human-1",
    reason?: string,
  ) =>
    req<Obligation>(`/api/obligations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ actorType, actorId, status, reason }),
    }),
  logout: async () => {
    await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
  },
};
