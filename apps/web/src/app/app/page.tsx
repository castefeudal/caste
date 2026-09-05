"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  captured: [
    { to: "needs_review", label: "На проверку" },
    { to: "active", label: "Взять в работу" },
  ],
  needs_review: [{ to: "active", label: "Взять в работу" }],
  active: [{ to: "in_progress", label: "Начать" }],
  assigned: [{ to: "in_progress", label: "Начать" }],
  scheduled: [{ to: "in_progress", label: "Начать" }],
  in_progress: [{ to: "verification_pending", label: "На проверку" }],
  waiting: [{ to: "in_progress", label: "Продолжить" }],
  blocked: [{ to: "active", label: "Разблокировать" }],
  action_required: [{ to: "in_progress", label: "Сделать" }],
  verification_pending: [{ to: "verified", label: "Подтвердить" }],
  verified: [{ to: "resolved", label: "Закрыть" }],
};

const RISK_STYLES: Record<string, string> = {
  now: "border-red-500/60",
  soon: "border-amber-500/60",
  later: "border-stone-800",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "низкий",
  normal: "обычный",
  high: "высокий",
  critical: "критичный",
};

function riskLabel(ob: Obligation): string {
  if (ob.status === "resolved" || ob.status === "archived") return "";
  const d = new Date(ob.dueAt ?? "");
  if (!ob.dueAt || Number.isNaN(d.getTime())) return "";
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `просрочено на ${-days} дн.`;
  if (days === 0) return "срок сегодня";
  return `осталось ${days} дн.`;
}

export default function Board() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [showNewHousehold, setShowNewHousehold] = useState(false);
  const [newName, setNewName] = useState("");
  const [reviewTarget, setReviewTarget] = useState<Obligation | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(async (hh: Household) => {
    try {
      setObligations(await api.listObligations(hh.id));
      setError(null);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "401") router.replace("/login");
      else setError(msg);
    }
  }, [router]);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listHouseholds();
        setHouseholds(list);
        if (list.length > 0) {
          setHousehold(list[0]);
          await refresh(list[0]);
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "401") router.replace("/login");
        else setError(msg);
      }
    })();
  }, [refresh, router]);

  async function createHousehold() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const hh = await api.createHousehold(name);
      setHouseholds((hs) => [...hs, hh]);
      setHousehold(hh);
      setObligations([]);
      setShowNewHousehold(false);
      setNewName("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addObligation() {
    if (!household || !title.trim()) return;
    setBusy(true);
    try {
      await api.createObligation(household.id, title.trim(), priority, dueAt || undefined);
      setTitle("");
      setDueAt("");
      await refresh(household);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function extractFromText() {
    if (!household || !title.trim()) return;
    setBusy(true);
    try {
      const res = await api.extract(title.trim());
      const ex = res.extraction;
      if (ex.action === "do_not_create") {
        setError("Слишком мало уверенности — уточните формулировку");
        return;
      }
      await api.createObligation(household.id, ex.title, ex.priority ?? "normal", ex.dueAt ?? undefined);
      setTitle("");
      setError(ex.action === "needs_review" ? "Захвачено с низкой уверенностью — проверьте статус" : null);
      await refresh(household);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function move(ob: Obligation, to: string, reason?: string) {
    if (!household) return;
    setBusy(true);
    try {
      let evidenceId: string | undefined;
      if (to === "verified") {
        const ev = await api.addEvidence(ob.id, reason || "Подтверждено владельцем");
        evidenceId = ev.id;
      }
      await api.transition(ob.id, to, reason, evidenceId);
      await refresh(household);
      setReviewTarget(null);
      setReviewReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!household) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">Добро пожаловать в CASTE</h1>
        <p className="mt-4 text-stone-400">Создайте семью — и «надо» начнут превращаться в «сделано».</p>
        {households.length === 0 && !showNewHousehold && (
          <button
            onClick={() => setShowNewHousehold(true)}
            className="mt-8 rounded-lg bg-emerald-500 px-8 py-4 text-lg font-semibold text-stone-950 hover:bg-emerald-400"
          >
            Создать семью
          </button>
        )}
        {(showNewHousehold || households.length > 0) && (
          <form
            className="mx-auto mt-8 flex max-w-sm gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createHousehold();
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название семьи"
              className="flex-1 rounded-lg border border-stone-700 bg-stone-900 px-4 py-3 outline-none focus:border-emerald-500"
            />
            <button
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-6 font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? "…" : "Создать"}
            </button>
          </form>
        )}
        {households.length > 0 && (
          <div className="mt-6 space-y-2">
            {households.map((hh) => (
              <button
                key={hh.id}
                onClick={() => {
                  setHousehold(hh);
                  void refresh(hh);
                }}
                className="block w-full rounded-lg border border-stone-800 bg-stone-900 px-4 py-3 text-left hover:border-emerald-500"
              >
                {hh.name}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-4 text-red-400">{error}</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{household.name}</h1>
          {households.length > 1 && (
            <select
              value={household.id}
              onChange={(e) => {
                const hh = households.find((h) => h.id === e.target.value);
                if (hh) {
                  setHousehold(hh);
                  void refresh(hh);
                }
              }}
              className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs"
            >
              {households.map((hh) => (
                <option key={hh.id} value={hh.id}>
                  {hh.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3 text-stone-500">
          <span>{obligations.length} обязательств</span>
          <button
            onClick={() => setShowNewHousehold((v) => !v)}
            className="rounded border border-stone-700 px-2 py-1 text-xs hover:border-emerald-500"
          >
            + семья
          </button>
          <button onClick={() => void api.logout()} className="text-xs hover:text-stone-300">
            Выйти
          </button>
        </div>
      </header>

      {showNewHousehold && (
        <form
          className="mt-4 flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createHousehold();
          }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название семьи"
            className="flex-1 rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 outline-none focus:border-emerald-500"
          />
          <button disabled={busy} className="rounded-lg bg-emerald-500 px-4 font-semibold text-stone-950 disabled:opacity-50">
            Создать
          </button>
        </form>
      )}

      <form
        className="mt-6 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addObligation();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что «надо»? Например: оплатить счёт за электричество"
          className="min-w-64 flex-1 rounded-lg border border-stone-700 bg-stone-900 px-4 py-3 outline-none focus:border-emerald-500"
        />
        <input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="rounded-lg border border-stone-700 bg-stone-900 px-3 text-stone-300"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="rounded-lg border border-stone-700 bg-stone-900 px-3"
        >
          {(["low", "normal", "high", "critical"] as const).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-lg bg-emerald-500 px-6 font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          Захватить
        </button>
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void extractFromText()}
          title="Распознать срок и приоритет через AI"
          className="rounded-lg border border-stone-700 px-4 text-sm text-stone-300 hover:border-emerald-500 disabled:opacity-50"
        >
          ✨ AI
        </button>
      </form>

      {error && <p className="mt-4 text-red-400">{error}</p>}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {COLUMNS.map((col) => {
          const items = obligations.filter((o) => o.status === col.key);
          return (
            <div key={col.key} className="rounded-lg bg-stone-900/60 p-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                {col.label} <span className="text-stone-600">{items.length}</span>
              </h2>
              <div className="mt-3 space-y-2">
                {items.map((ob) => (
                  <div
                    key={ob.id}
                    className={`rounded-md border bg-stone-950 p-3 ${RISK_STYLES[ob.risk ?? "later"] ?? "border-stone-800"}`}
                  >
                    <p className="text-sm">{ob.title}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {PRIORITY_LABEL[ob.priority] ?? ob.priority}
                      {ob.dueAt ? ` · до ${new Date(ob.dueAt).toLocaleDateString("ru-RU")}` : ""}
                    </p>
                    {riskLabel(ob) && <p className="mt-0.5 text-xs text-amber-400">{riskLabel(ob)}</p>}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(NEXT_BY_STATE[ob.status] ?? []).map((a) => (
                        <button
                          key={a.to}
                          disabled={busy}
                          onClick={() => {
                            if (a.to === "verification_pending") {
                              setReviewTarget(ob);
                              setReviewReason("");
                            } else void move(ob, a.to);
                          }}
                          className="rounded bg-stone-800 px-2 py-1 text-xs text-emerald-400 hover:bg-stone-700 disabled:opacity-50"
                        >
                          {a.label}
                        </button>
                      ))}
                      {ob.status !== "resolved" && ob.status !== "archived" && (
                        <button
                          disabled={busy}
                          onClick={() => void move(ob, "dismissed")}
                          className="rounded px-2 py-1 text-xs text-stone-500 hover:text-stone-300 disabled:opacity-50"
                        >
                          Отменить
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-stone-800 bg-stone-900 p-6">
            <h3 className="text-lg font-semibold">Что сделано?</h3>
            <p className="mt-1 text-sm text-stone-400">{reviewTarget.title}</p>
            <textarea
              autoFocus
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              rows={3}
              placeholder="Какие есть доказательства? (необязательно)"
              className="mt-4 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReviewTarget(null)}
                className="rounded-lg px-4 py-2 text-sm text-stone-400 hover:text-stone-200"
              >
                Отмена
              </button>
              <button
                disabled={busy}
                onClick={() => void move(reviewTarget, "verified", reviewReason.trim() || undefined)}
                className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-stone-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
