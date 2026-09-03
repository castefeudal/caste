import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CASTE — Из «надо» в «сделано»",
  description: "Семейный слой, который не даёт жизни провалиться сквозь щели.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-stone-950 text-stone-100 antialiased">{children}</body>
    </html>
  );
}
