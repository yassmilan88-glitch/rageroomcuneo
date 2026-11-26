/**
 * Notifiche di prenotazione: email all'azienda e al cliente, messaggio WhatsApp
 * automatico al titolare.
 *
 * Ogni canale è opzionale e si attiva da solo quando le relative variabili
 * d'ambiente sono configurate su Netlify. Se un canale non è configurato viene
 * registrato un avviso nei log e gli altri continuano a funzionare: una
 * notifica che fallisce non deve mai far fallire una prenotazione già pagata.
 */

import {
  HOLIDAY_HOURS_LABEL,
  OPENING_HOURS_LABEL,
  VENUE_ADDRESS,
  VENUE_MAPS_URL,
  formatEuro,
} from "./booking.js";

/** Casella dell'azienda su cui arrivano tutte le prenotazioni. */
export const COMPANY_EMAIL = process.env.BOOKING_NOTIFY_EMAIL || "rageroomcuneo@gmail.com";
/** Mittente delle email: deve appartenere a un dominio verificato su Resend. */
const FROM_EMAIL = process.env.BOOKING_FROM_EMAIL || "Rage Room Cuneo <onboarding@resend.dev>";
/** Numero WhatsApp del titolare, in formato internazionale senza "+". */
export const OWNER_WHATSAPP = process.env.OWNER_WHATSAPP_NUMBER || "393509736066";

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
  isFullPayment: boolean;
  gopromo: boolean;
  paid: boolean;
  /** Codice del buono regalo usato per pagare la sessione, se c'è. */
  voucherCode?: string;
  /** Quanto copre il buono; il resto (depositCents - voucherCents) è pagato online. */
  voucherCents?: number;
}

const peopleLabel = (people: number) => `${people} ${people === 1 ? "persona" : "persone"}`;
const voucherPart = (b: BookingNotification) => Math.min(b.voucherCents ?? b.depositCents, b.depositCents);
const onlinePart = (b: BookingNotification) => Math.max(0, b.depositCents - voucherPart(b));

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Riepilogo compatto usato per WhatsApp e come corpo testuale delle email. */
export function bookingSummaryText(booking: BookingNotification): string {
  const paymentLabel = booking.isFullPayment ? "Pagato per intero" : "Riserva";
  const paymentLine = booking.voucherCode
    ? `Pagato: buono regalo ${booking.voucherCode} (${formatEuro(voucherPart(booking))})` +
      (onlinePart(booking) ? ` + ${formatEuro(onlinePart(booking))} online` : "")
    : booking.paid
      ? `${paymentLabel} incassato: ${formatEuro(booking.depositCents)}`
      : `Riserva da incassare: ${formatEuro(booking.depositCents)}`;
  const lines = [
    `Nuova prenotazione #${booking.id}`,
    `${booking.roomName} — ${booking.dateLabel}`,
    `Orario: ${booking.time}–${booking.end} (${peopleLabel(booking.people)})`,
    `Cliente: ${booking.name}`,
    `Telefono: ${booking.phone}`,
    `Email: ${booking.email}`,
    paymentLine,
  ];
  if (booking.notes) lines.push(`Note: ${booking.notes}`);
  if (booking.gopromo) lines.push(`🎥 Rientra nei primi 50: video POV GoPro omaggio da dare.`);
  return lines.join("\n");
}

function ownerEmailHtml(booking: BookingNotification): string {
  const rows: [string, string][] = [
    ["Sessione", booking.roomName],
    ["Giorno", booking.dateLabel],
    ["Orario", `${booking.time}–${booking.end}`],
    ["Persone", peopleLabel(booking.people)],
    ["Nome", booking.name],
    ["Telefono", booking.phone],
    ["Email", booking.email],
    booking.voucherCode
      ? [
          "Buono regalo",
          `${booking.voucherCode} — ${formatEuro(voucherPart(booking))}` +
            (onlinePart(booking) ? ` + ${formatEuro(onlinePart(booking))} pagati online` : ""),
        ]
      : [
          booking.isFullPayment ? "Pagamento" : "Riserva",
          booking.paid
            ? `${formatEuro(booking.depositCents)} — pagato online${booking.isFullPayment ? " (per intero)" : ""}`
            : `${formatEuro(booking.depositCents)} — da incassare`,
        ],
  ];
  if (booking.notes) rows.push(["Note", booking.notes]);
  if (booking.gopromo) rows.push(["🎥 Promo", "Nei primi 50 — video POV GoPro omaggio"]);

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
  const paymentRow = booking.voucherCode
    ? `<tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Buono regalo</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(booking.voucherCode)}</td></tr>`
    : `<tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">${booking.isFullPayment ? "Pagamento" : "Riserva"}</td><td style="padding:6px 0;font-weight:600;">${formatEuro(booking.depositCents)} ${booking.paid ? (booking.isFullPayment ? "pagato per intero online" : "pagato online") : "da saldare"}</td></tr>`;
  const balanceText = booking.voucherCode
    ? "La sessione è pagata: non c'è nulla da pagare in sede."
    : booking.isFullPayment
      ? "Hai già saldato tutto: non c'è nulla da pagare in sede."
      : "Il saldo della sessione si paga in sede.";
  return `<div style="font-family:Helvetica,Arial,sans-serif;color:#111;">
  <h2 style="margin:0 0 4px;">Prenotazione confermata 🎉</h2>
  <p style="margin:0 0 16px;font-size:15px;">Ciao ${escapeHtml(booking.name)}, ti aspettiamo da Rage Room Cuneo.</p>
  <table style="border-collapse:collapse;font-size:15px;">
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Codice</td><td style="padding:6px 0;font-weight:600;">#${booking.id}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Sessione</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(booking.roomName)}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Giorno</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(booking.dateLabel)}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Orario</td><td style="padding:6px 0;font-weight:600;">${booking.time}–${booking.end}</td></tr>
    <tr><td style="padding:6px 14px 6px 0;color:#8a8a92;font-size:13px;">Persone</td><td style="padding:6px 0;font-weight:600;">${peopleLabel(booking.people)}</td></tr>
    ${paymentRow}
  </table>
  <p style="margin:20px 0 0;font-size:14px;">📍 <strong>${escapeHtml(VENUE_ADDRESS)}</strong> — <a href="${VENUE_MAPS_URL}">apri la mappa</a></p>
  <p style="margin:12px 0 0;font-size:14px;">Arriva 10 minuti prima: ti diamo casco, tuta e guanti.<br>
  ${balanceText}</p>
  <div style="margin:16px 0 0;font-size:12px;color:#55555c;line-height:1.55;">
    <strong>Regole della sessione</strong><br>
    Se non ti presenti, l'importo pagato non viene rimborsato.<br>
    Se arrivi in ritardo hai a disposizione solo i minuti che restano della tua sessione.<br>
    Vuoi rompere un oggetto tuo? Mandaci prima una foto su WhatsApp e ti diciamo se si può.<br>
    Prima di entrare firmi una liberatoria.<br>
    Se non segui le indicazioni dello staff, la sessione viene interrotta.
  </div>
  ${booking.gopromo ? `<p style="margin:16px 0 0;font-size:14px;background:#fff6d8;border-radius:8px;padding:10px 14px;">🎥 Sei tra i primi 50 prenotati: il video POV con la GoPro della tua sessione è in omaggio!</p>` : ""}
  <p style="margin:16px 0 0;font-size:13px;color:#8a8a92;">
    Per spostare o annullare scrivici su <a href="https://wa.me/${OWNER_WHATSAPP}">WhatsApp</a>
    o a <a href="mailto:${COMPANY_EMAIL}">${COMPANY_EMAIL}</a>.<br>${escapeHtml(OPENING_HOURS_LABEL)}<br>${escapeHtml(HOLIDAY_HOURS_LABEL)}
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

/** Messaggio WhatsApp al titolare sul primo canale configurato. */
export async function sendOwnerWhatsApp(text: string): Promise<boolean> {
  const sent =
    (await sendViaMetaCloud(text)) || (await sendViaTwilio(text)) || (await sendViaCallMeBot(text));
  if (!sent) {
    console.warn("Nessun canale WhatsApp configurato: messaggio al titolare non inviato.");
  }
  return sent;
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
    sendOwnerWhatsApp(summary),
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
