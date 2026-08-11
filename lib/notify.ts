/**
 * Notifiche di prenotazione: email all'azienda e al cliente, messaggio WhatsApp
 * automatico al titolare.
 *
 * Ogni canale è opzionale e si attiva da solo quando le relative variabili
 * d'ambiente sono configurate su Netlify. Se un canale non è configurato viene
 * registrato un avviso nei log e gli altri continuano a funzionare: una
 * notifica che fallisce non deve mai far fallire una prenotazione già pagata.
 */

import { OPENING_HOURS_LABEL, formatEuro } from "./booking.js";

/** Casella dell'azienda su cui arrivano tutte le prenotazioni. */
export const COMPANY_EMAIL = process.env.BOOKING_NOTIFY_EMAIL || "rageroomcuneo@gmail.com";
/** Mittente delle email: deve appartenere a un dominio verificato su Resend. */
const FROM_EMAIL = process.env.BOOKING_FROM_EMAIL || "Rage Room Cuneo <onboarding@resend.dev>";
/** Numero WhatsApp del titolare, in formato internazionale senza "+". */
export const OWNER_WHATSAPP = process.env.OWNER_WHATSAPP_NUMBER || "393295865883";

export interface BookingNotification {
  id: number;
  name: string;
  phone: string;
  email: string;
  notes: string;
  roomName: string;
  people: number;
  dateLabel: string;
  time: string;
  end: string;
  depositCents: number;
  paid: boolean;
}

const peopleLabel = (people: number) => `${people} ${people === 1 ? "persona" : "persone"}`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Riepilogo compatto usato per WhatsApp e come corpo testuale delle email. */
export function bookingSummaryText(booking: BookingNotification): string {
  const lines = [
    `Nuova prenotazione #${booking.id}`,
    `${booking.roomName} — ${booking.dateLabel}`,
    `Orario: ${booking.time}–${booking.end} (${peopleLabel(booking.people)})`,
    `Cliente: ${booking.name}`,
    `Telefono: ${booking.phone}`,
    `Email: ${booking.email}`,
    booking.paid
      ? `Acconto incassato: ${formatEuro(booking.depositCents)}`
      : `Acconto da incassare: ${formatEuro(booking.depositCents)}`,
  ];
  if (booking.notes) lines.push(`Note: ${booking.notes}`);
  return lines.join("\n");
}

function ownerEmailHtml(booking: BookingNotification): string {
  const rows: [string, string][] = [
    ["Stanza", booking.roomName],
    ["Giorno", booking.dateLabel],
    ["Orario", `${booking.time}–${booking.end}`],
    ["Persone", peopleLabel(booking.people)],
    ["Nome", booking.name],
    ["Telefono", booking.phone],
    ["Email", booking.email],
    [
      "Acconto",
      booking.paid
        ? `${formatEuro(booking.depositCents)} — pagato online`
        : `${formatEuro(booking.depositCents)} — da incassare`,
    ],
  ];
  if (booking.notes) rows.push(["Note", booking.notes]);

  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;font-weight:600;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<div style="font-family:Helvetica,Arial,sans-serif;color:#111;">
  <h2 style="margin:0 0 4px;">Nuova prenotazione #${booking.id}</h2>
  <p style="margin:0 0 16px;color:#8a8a92;font-size:14px;">Arrivata dal sito rageroomcuneo</p>
  <table style="border-collapse:collapse;font-size:15px;">${body}</table>
  <p style="margin:20px 0 0;font-size:13px;color:#8a8a92;">
    Scrivi al cliente su WhatsApp:
    <a href="https://wa.me/${booking.phone.replace(/\D/g, "")}">${escapeHtml(booking.phone)}</a>
  </p>
</div>`;
}

function customerEmailHtml(booking: BookingNotification): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;color:#111;">
  <h2 style="margin:0 0 4px;">Prenotazione confermata 🎉</h2>
  <p style="margin:0 0 16px;font-size:15px;">Ciao ${escapeHtml(booking.name)}, ti aspettiamo da Rage Room Cuneo.</p>
  <table style="border-collapse:collapse;font-size:15px;">
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Codice</td><td style="padding:6px 0;font-weight:600;">#${booking.id}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Stanza</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(booking.roomName)}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Giorno</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(booking.dateLabel)}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Orario</td><td style="padding:6px 0;font-weight:600;">${booking.time}–${booking.end}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Persone</td><td style="padding:6px 0;font-weight:600;">${peopleLabel(booking.people)}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Acconto</td><td style="padding:6px 0;font-weight:600;">${formatEuro(booking.depositCents)} ${booking.paid ? "pagato online" : "da saldare"}</td></tr>
  </table>
  <p style="margin:20px 0 0;font-size:14px;">Arriva 10 minuti prima: ti diamo casco, tuta e guanti.<br>
  Il saldo della sessione si paga in sede.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#8a8a92;">
    Per spostare o annullare scrivici su <a href="https://wa.me/${OWNER_WHATSAPP}">WhatsApp</a>
    o a <a href="mailto:${COMPANY_EMAIL}">${COMPANY_EMAIL}</a>.<br>${escapeHtml(OPENING_HOURS_LABEL)}
  </p>
</div>`;
}

export async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY non configurata: email non inviata a", to);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, reply_to: replyTo }),
  });

  if (!res.ok) {
    throw new Error(`Resend ha risposto ${res.status}: ${await res.text()}`);
  }
  return true;
}

/** Invio WhatsApp tramite le API ufficiali Meta (WhatsApp Business Cloud). */
async function sendViaMetaCloud(text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return false;

  // Fuori dalla finestra di 24 ore Meta accetta solo messaggi da template
  // approvato: se ne è configurato uno lo usiamo passandogli il riepilogo.
  const template = process.env.WHATSAPP_TEMPLATE;
  const body = template
    ? {
        messaging_product: "whatsapp",
        to: OWNER_WHATSAPP,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "it" },
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      }
    : { messaging_product: "whatsapp", to: OWNER_WHATSAPP, type: "text", text: { body: text } };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`WhatsApp Cloud API ha risposto ${res.status}: ${await res.text()}`);
  return true;
}

/** Invio WhatsApp tramite Twilio. */
async function sendViaTwilio(text: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) return false;

  const params = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    To: `whatsapp:+${OWNER_WHATSAPP}`,
    Body: text,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!res.ok) throw new Error(`Twilio ha risposto ${res.status}: ${await res.text()}`);
  return true;
}

/** Invio WhatsApp tramite CallMeBot: la via più rapida verso un numero personale. */
async function sendViaCallMeBot(text: string): Promise<boolean> {
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) return false;

  const url =
    `https://api.callmebot.com/whatsapp.php?phone=%2B${OWNER_WHATSAPP}` +
    `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CallMeBot ha risposto ${res.status}: ${await res.text()}`);
  return true;
}

/**
 * Manda tutte le notifiche di una prenotazione confermata.
 * Non lancia mai: registra gli errori e restituisce l'esito canale per canale.
 */
export async function notifyBooking(booking: BookingNotification): Promise<{
  ownerEmail: boolean;
  customerEmail: boolean;
  whatsapp: boolean;
}> {
  const summary = bookingSummaryText(booking);
  const subject = `Prenotazione #${booking.id} — ${booking.roomName}, ${booking.dateLabel} ${booking.time}`;

  const results = await Promise.allSettled([
    sendEmail(COMPANY_EMAIL, subject, ownerEmailHtml(booking), booking.email),
    sendEmail(booking.email, `Prenotazione confermata — ${booking.dateLabel} alle ${booking.time}`, customerEmailHtml(booking)),
    (async () => {
      const sent =
        (await sendViaMetaCloud(summary)) ||
        (await sendViaTwilio(summary)) ||
        (await sendViaCallMeBot(summary));
      if (!sent) {
        console.warn("Nessun canale WhatsApp configurato: messaggio al titolare non inviato.");
      }
      return sent;
    })(),
  ]);

  const [ownerEmail, customerEmail, whatsapp] = results;
  for (const result of results) {
    if (result.status === "rejected") console.error("Notifica prenotazione fallita", result.reason);
  }

  return {
    ownerEmail: ownerEmail.status === "fulfilled" && ownerEmail.value === true,
    customerEmail: customerEmail.status === "fulfilled" && customerEmail.value === true,
    whatsapp: whatsapp.status === "fulfilled" && whatsapp.value === true,
  };
}
