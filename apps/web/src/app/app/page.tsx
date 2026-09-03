"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Household, type Obligation } from "@/lib/api";

const COLUMNS = [
  { key: "captured", label: "Захвачено" },
  { key: "needs_review", label: "На проверке" },
  { key: "active", label: "В работе" },
  { key: "in_progress", label: "Выполняется" },
  { key: "verification_pending", label: "Проверка" },
  { key: "verified", label: "Подтверждено" },
  { key: "resolved", label: "Готово" },
] as const;

const NEXT_BY_STATE: Record<string, { to: string; label: string }[]> = {
  captured: [{ to: "needs_review", label: "На проверку" }],
  needs_review: [{ to: "active", label: "Взять в работу" }],
  active: [{ to: "assigned", label: "Назначить" }, { to: "in_progress", label: "Начать" }],
  assigned: [{ to: "in_progress", label: "Начать" }],
  scheduled: [{ to: "in_progress", label: "Начать" }],
  in_progress: [{ to: "verification_pending", label: "На проверку" }],
  waiting: [{ to: "in_progress", label: "Продолжить" }],
  blocked: [{ to: "active", label: "Разблокировать" }],
  action_required: [{ to: "in_progress", label: "Сделать" }],
  verification_pending: [{ to: "verified", label: "Подтвердить" }],
  verified: [{ to: "resolved", label: "Закрыть" }],
};

export default function Board() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (hh: Household) => {
    try {
      setObligations(await api.listObligations(hh.id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("caste-household");
    if (saved) {
      try {
        const hh = JSON.parse(saved) as Household;
        setHousehold(hh);
        void refresh(hh);
      } catch {
        // corrupted storage — start over
      }
    }
  }, [refresh]);

  async function createHousehold() {
    const name = prompt("Название семьи:")?.trim();
    if (!name) return;
    const hh = await api.createHousehold(name);
    localStorage.setItem("caste-household", JSON.stringify(hh));
    setHousehold(hh);
  }

  async function addObligation() {
    if (!household || !title.trim()) return;
    try {
      await api.createObligation(household.id, title.trim(), priority);
      setTitle("");
      await refresh(household);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function move(ob: Obligation, to: string) {
    if (!household) return;
    try {
      await api.transition(ob.id, to, "human", `human:${household.id}`);
      await refresh(household);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!household) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">Добро пожаловать в CASTE</h1>
        <p className="mt-4 text-stone-400">Создайте семью — и «надо» начнут превращаться в «сделано».</p>
        <button
          onClick={() => void createHousehold()}
          className="mt-8 rounded-lg bg-emerald-500 px-8 py-4 text-lg font-semibold text-stone-950 hover:bg-emerald-400"
        >
          Создать семью
        </button>
        {error && <p className="mt-4 text-red-400">{error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{household.name}</h1>
        <span className="text-stone-500">{obligations.length} обязательств</span>
      </header>

      <div className="mt-6 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addObligation()}
          placeholder="Что «надо»? Например: оплатить счёт за электричество"
          className="flex-1 rounded-lg border border-stone-700 bg-stone-900 px-4 py-3 outline-none focus:border-emerald-500"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded-lg border border-stone-700 bg-stone-900 px-3"
        >
          {["low", "normal", "high", "critical"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          onClick={() => void addObligation()}
          className="rounded-lg bg-emerald-500 px-6 font-semibold text-stone-950 hover:bg-emerald-400"
        >
          Захватить
        </button>
      </div>

      {error && <p className="mt-4 text-red-400">{error}</p>}

      <div className="mt-8 grid grid-cols-7 gap-3">
        {COLUMNS.map((col) => {
          const items = obligations.filter((o) => o.status === col.key);
          return (
            <div key={col.key} className="rounded-lg bg-stone-900/60 p-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                {col.label} <span className="text-stone-600">{items.length}</span>
              </h2>
              <div className="mt-3 space-y-2">
                {items.map((ob) => (
                  <div key={ob.id} className="rounded-md border border-stone-800 bg-stone-950 p-3">
                    <p className="text-sm">{ob.title}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {ob.priority !== "normal" ? `${ob.priority} · ` : ""}
                      {ob.dueAt ? new Date(ob.dueAt).toLocaleDateString("ru-RU") : "без срока"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(NEXT_BY_STATE[ob.status] ?? []).map((a) => (
                        <button
                          key={a.to}
                          onClick={() => void move(ob, a.to)}
                          className="rounded bg-stone-800 px-2 py-1 text-xs text-emerald-400 hover:bg-stone-700"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
