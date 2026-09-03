import { Pool } from "pg";
import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  const url = process.env.EMAIL_URL;
  if (!url) return null;
  if (!transporter) transporter = nodemailer.createTransport({ url });
  return transporter;
}

export async function sendMail({ to, subject, text }: { to: string; subject: string; text: string }) {
  const t = getTransport();
  if (!t) {
    console.info(JSON.stringify({ mail: { to, subject }, driver: "demo" }));
    return { delivered: false as const };
  }
  await t.sendMail({ from: process.env.EMAIL_FROM ?? "CASTE <noreply@caste.local>", to, subject, text });
  return { delivered: true as const };
}

export { Pool };
