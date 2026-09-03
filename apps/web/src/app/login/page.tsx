"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/auth/login`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email }),
        },
      );
      if (res.status === 400) {
        setError("Введите корректный email");
        return;
      }
      if (!res.ok) throw new Error("login failed");
      router.push("/app");
    } catch {
      setError("Не удалось войти. API запущен?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Вход в CASTE</h1>
          <p className="text-sm text-stone-400">
            Из «надо» — в «сделано». Пароль не нужен: укажите email.
          </p>
        </div>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-stone-700 bg-stone-900 px-4 py-3 text-sm outline-none placeholder:text-stone-500 focus:border-stone-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? "Входим…" : "Войти"}
        </button>
        <p className="text-center text-xs text-stone-500">
          <Link href="/" className="underline hover:text-stone-300">
            На главную
          </Link>
        </p>
      </form>
    </main>
  );
}
