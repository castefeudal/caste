import Link from "next/link";

const PROMISES = [
  { from: "«надо заплатить за квартиру»", to: "оплачено, чек сохранён" },
  { from: "«надо записаться к врачу»", to: "записан, напомнит за день" },
  { from: "«надо продлить страховку»", to: "продлена, документы в архиве" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-6xl font-bold tracking-tight">CASTE</h1>
      <p className="mt-6 text-2xl text-stone-300">
        Из <span className="text-stone-500 line-through">«надо»</span> — в{" "}
        <span className="font-semibold text-emerald-400">«сделано»</span>.
      </p>
      <p className="mt-4 text-stone-400">
        CASTE — не очередное место, где вы организуете жизнь. Это слой, который тихо не даёт ей
        провалиться сквозь щели: обязательства попадают в систему, система ведёт их до результата.
      </p>

      <div className="mt-12 space-y-3">
        {PROMISES.map((p) => (
          <div key={p.from} className="flex items-center gap-4 rounded-lg border border-stone-800 bg-stone-900/60 p-4">
            <span className="text-stone-500 line-through">{p.from}</span>
            <span className="text-emerald-400">→</span>
            <span>{p.to}</span>
          </div>
        ))}
      </div>

      <Link
        href="/app"
        className="mt-12 inline-block rounded-lg bg-emerald-500 px-8 py-4 text-lg font-semibold text-stone-950 hover:bg-emerald-400"
      >
        Открыть семью →
      </Link>
    </main>
  );
}
