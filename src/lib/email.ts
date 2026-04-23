import nodemailer from "nodemailer";
import { formatPriceCents } from "./format";
import { airportLabel } from "./airports";

type DealEmailPayload = {
  to: string;
  origin: string;
  destination: string;
  priceCents?: number | null;
  discountPct?: number | null;
  source: string;
  sourceUrl?: string | null;
  headline?: string | null;
  dealUrl: string;
};

let transporterCache: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporterCache) return transporterCache;
  const { EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, EMAIL_SERVER_USER, EMAIL_SERVER_PASSWORD } = process.env;
  if (!EMAIL_SERVER_HOST) return null;
  transporterCache = nodemailer.createTransport({
    host: EMAIL_SERVER_HOST,
    port: Number(EMAIL_SERVER_PORT ?? 587),
    secure: Number(EMAIL_SERVER_PORT ?? 587) === 465,
    auth: EMAIL_SERVER_USER
      ? { user: EMAIL_SERVER_USER, pass: EMAIL_SERVER_PASSWORD }
      : undefined,
  });
  return transporterCache;
}

export async function sendDealEmail(p: DealEmailPayload) {
  const t = getTransporter();
  if (!t) {
    console.warn("[email] SMTP not configured; skipping alert email to", p.to);
    return false;
  }
  const subject = `✈ Deal: ${airportLabel(p.origin)} → ${airportLabel(p.destination)}${
    p.priceCents ? ` · ${formatPriceCents(p.priceCents)}` : ""
  }`;
  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0A0A0B;background:#FAFAF9;border-radius:12px;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#71717A;margin-bottom:8px;">Skybird alert</div>
      <h1 style="font-size:22px;margin:0 0 8px 0;">${airportLabel(p.origin)} → ${airportLabel(p.destination)}</h1>
      ${p.priceCents ? `<div style="font-size:40px;font-weight:600;font-family:ui-monospace,monospace;color:#0A0A0B;">${formatPriceCents(p.priceCents)}</div>` : ""}
      ${p.discountPct ? `<div style="display:inline-block;padding:4px 10px;border-radius:999px;background:#DCFCE7;color:#15803D;font-size:12px;font-weight:600;margin-top:6px;">−${Math.round(p.discountPct)}% vs baseline</div>` : ""}
      ${p.headline ? `<p style="color:#3F3F46;line-height:1.5;">${p.headline}</p>` : ""}
      <a href="${p.dealUrl}" style="display:inline-block;margin-top:16px;padding:10px 16px;border-radius:8px;background:#0A0A0B;color:#FAFAF9;text-decoration:none;font-weight:500;">View deal</a>
      <p style="color:#71717A;font-size:12px;margin-top:24px;">Source: ${p.source}${p.sourceUrl ? ` · <a href="${p.sourceUrl}" style="color:#71717A;">link</a>` : ""}</p>
    </div>`;
  await t.sendMail({
    from: process.env.EMAIL_FROM ?? "Skybird <alerts@skybird.app>",
    to: p.to,
    subject,
    html,
  });
  return true;
}
