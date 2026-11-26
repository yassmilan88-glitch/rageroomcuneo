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
  VENUE_ADDRESS_NOTE,
  VENUE_AREA,
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

/* Colori del sito, ripetuti qui perché le email non leggono il CSS della pagina. */
export const C = { bg: "#0a0a0c", panel: "#131215", panel2: "#1a1a1e", line: "#2a292d", text: "#f3efe6", dim: "#9a978f", yellow: "#f4c400", pink: "#ff2e6e" };
export const FONT = "Helvetica,Arial,sans-serif";

/**
 * Apertura comune delle email ai clienti. Dichiarare lo schema scuro serve:
 * senza, l'app Mail dell'iPhone in modalità scura ricolora l'email e il testo
 * chiaro diventa quasi illeggibile; lo stile su x-apple-data-detectors evita
 * che date e orari diventino link sottolineati.
 */
export function emailDocumentStart(title: string): string {
  return `<!doctype html>
<html lang="it" style="color-scheme:dark;supported-color-schemes:dark;"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:dark;supported-color-schemes:dark;}body{margin:0;padding:0;background:${C.bg};}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;}</style></head>
<body bgcolor="${C.bg}" style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">`;
}
export const EMAIL_DOCUMENT_END = `</td></tr>
</table>
</body></html>`;

/** Prima parola del nome, con l'iniziale maiuscola. */
function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] || "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "";
}

function detailRow(label: string, value: string, last = false): string {
  return `<tr>
    <td style="padding:11px 0;border-bottom:${last ? "none" : `1px solid ${C.line}`};font-family:${FONT};font-size:13px;color:${C.dim};vertical-align:top;width:34%;">${escapeHtml(label)}</td>
    <td style="padding:11px 0;border-bottom:${last ? "none" : `1px solid ${C.line}`};font-family:${FONT};font-size:15px;color:${C.text};font-weight:bold;text-align:right;">${value}</td>
  </tr>`;
}

/** Email di conferma al cliente, con lo stile del sito: fondo nero, riga gialla, accenti rosa. */
function customerEmailHtml(booking: BookingNotification): string {
  const parts = booking.roomName.split(" · ");
  const room = parts[0] || booking.roomName;
  const pkg = parts.slice(1).join(" · ");
  const name = firstName(booking.name);

  const payment = booking.voucherCode
    ? onlinePart(booking)
      ? `Buono regalo ${escapeHtml(booking.voucherCode)} + ${formatEuro(onlinePart(booking))} online`
      : `Buono regalo ${escapeHtml(booking.voucherCode)}`
    : booking.paid
      ? `${formatEuro(booking.depositCents)} pagati online`
      : `${formatEuro(booking.depositCents)}`;

  const gopro = booking.gopromo
    ? `<tr><td style="padding:0 28px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.pink};border-radius:12px;background:#1c1219;">
          <tr><td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.text};">
            <strong style="color:${C.pink};">Sei tra i primi 50 prenotati.</strong> Il video POV della tua sessione girato con la GoPro è in omaggio.
          </td></tr>
        </table>
      </td></tr>`
    : "";

  return `${emailDocumentStart("Prenotazione confermata")}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.panel}" style="max-width:560px;background:${C.panel};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
    <tr><td style="height:8px;line-height:8px;font-size:0;background:${C.yellow};">&nbsp;</td></tr>

    <tr><td style="padding:26px 28px 0;font-family:${FONT};font-size:20px;font-weight:bold;letter-spacing:0.5px;color:${C.text};">
      RAGE<span style="color:${C.pink};">ROOM</span> CUNEO
    </td></tr>

    <tr><td style="padding:22px 28px 0;font-family:${FONT};font-size:13px;color:${C.dim};">
      All'attenzione di: ${escapeHtml(booking.name)}
    </td></tr>

    <tr><td style="padding:14px 28px 0;font-family:${FONT};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${C.yellow};">
      Prenotazione confermata · codice #${booking.id}
    </td></tr>
    <tr><td style="padding:8px 28px 0;font-family:${FONT};font-size:26px;line-height:1.15;font-weight:bold;text-transform:uppercase;color:${C.text};">
      Ci vediamo ${escapeHtml(booking.dateLabel.replace(/ \d{4}$/, ""))}<br>alle <span style="color:${C.pink};">${booking.time}</span>
    </td></tr>
    <tr><td style="padding:14px 28px 22px;font-family:${FONT};font-size:15px;line-height:1.55;color:#d8d5cc;">
      Ciao ${escapeHtml(name)}, la tua sessione è prenotata e pagata. Qui sotto trovi il riepilogo e quello che serve sapere prima di venire.
    </td></tr>

    <tr><td style="padding:0 28px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel2};border:1px solid ${C.line};border-left:3px solid ${C.pink};border-radius:0 10px 10px 0;">
        <tr><td style="padding:4px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${detailRow("Stanza", escapeHtml(room))}
            ${pkg ? detailRow("Pacchetto", escapeHtml(pkg.replace(/^Pacchetto /, ""))) : ""}
            ${detailRow("Persone", escapeHtml(peopleLabel(booking.people)))}
            ${detailRow("Giorno", escapeHtml(booking.dateLabel))}
            ${detailRow("Orario", `${booking.time}–${booking.end}`)}
            ${detailRow("Dove", escapeHtml(VENUE_AREA))}
            ${detailRow("Pagamento", `<span style="color:${C.yellow};">${payment}</span>`, true)}
          </table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 28px 22px;font-family:${FONT};font-size:14px;line-height:1.5;color:#d8d5cc;">
      📍 L'indirizzo esatto te lo mandiamo prima dell'apertura. In sede non paghi nulla.
    </td></tr>

    ${gopro}

    <tr><td style="padding:0 28px 22px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-left:3px solid ${C.yellow};border-radius:0 10px 10px 0;">
        <tr><td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:#d8d5cc;">
          <strong style="color:${C.text};text-transform:uppercase;font-size:12px;letter-spacing:1px;">Prima di venire</strong><br>
          Arriva 10 minuti prima.<br>
          Firmi la liberatoria e ti diamo casco, tuta protettiva e guanti.<br>
          Vuoi rompere un oggetto tuo? Mandaci prima una foto su WhatsApp e ti diciamo se si può.
        </td></tr>
      </table>
    </td></tr>

    <tr><td align="left" style="padding:0 28px 24px;">
      <a href="https://wa.me/${OWNER_WHATSAPP}" style="display:inline-block;background:${C.pink};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;text-decoration:none;padding:14px 26px;border-radius:999px;">Scrivici su WhatsApp</a>
    </td></tr>

    <tr><td style="padding:0 28px 24px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.dim};">
      <strong style="color:#d8d5cc;">Regole della sessione</strong><br>
      Puoi annullare fino a 24 ore prima e ti rimborsiamo tutto; dopo, o se non ti presenti, non c'è rimborso.
      Se arrivi in ritardo hai a disposizione solo i minuti che restano della tua sessione.
      Gli oggetti portati da te vanno approvati prima con una foto.
      Prima di entrare firmi una liberatoria.
      Si viene per divertirsi: chi è alterato o ha bevuto non entra.
      Se non segui le indicazioni dello staff, la sessione viene interrotta.
    </td></tr>

    <tr><td style="height:1px;line-height:1px;font-size:0;background:${C.line};">&nbsp;</td></tr>
    <tr><td style="padding:18px 28px 24px;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.dim};">
      Rage Room Cuneo · ${escapeHtml(VENUE_AREA)}<br>
      ${escapeHtml(OPENING_HOURS_LABEL)}<br>
      ${escapeHtml(HOLIDAY_HOURS_LABEL)}<br>
      <a href="https://rageroomcuneo.it" style="color:${C.yellow};text-decoration:none;">rageroomcuneo.it</a> · <a href="tel:+393509736066" style="color:${C.dim};text-decoration:none;">350 973 6066</a> · <a href="mailto:${COMPANY_EMAIL}" style="color:${C.dim};text-decoration:none;">${COMPANY_EMAIL}</a>
    </td></tr>
  </table>
${EMAIL_DOCUMENT_END}`;
}

/** Testo semplice della conferma, per i programmi di posta che non mostrano l'HTML. */
function customerEmailText(booking: BookingNotification): string {
  return [
    `All'attenzione di: ${booking.name}`,
    `Prenotazione confermata, codice #${booking.id}.`,
    `${booking.roomName}`,
    `${peopleLabel(booking.people)} · ${booking.dateLabel}, ${booking.time}–${booking.end}`,
    `Dove: ${VENUE_AREA}. ${VENUE_ADDRESS_NOTE}`,
    `Arriva 10 minuti prima. Prima di entrare firmi una liberatoria. Si viene per divertirsi: chi è alterato o ha bevuto non entra.`,
    `Puoi annullare fino a 24 ore prima e ti rimborsiamo tutto; dopo, o se non ti presenti, non c'è rimborso. Se arrivi in ritardo hai i minuti che restano della sessione.`,
    `WhatsApp: https://wa.me/${OWNER_WHATSAPP}`,
  ].join("\n");
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  replyTo?: string,
  text?: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY non configurata: email non inviata a", to);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html, text, reply_to: replyTo }),
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
/** Per l'anteprima della grafica: la stessa email che riceve il cliente. */
export function previewCustomerEmail(booking: BookingNotification): string {
  return customerEmailHtml(booking);
}

export async function notifyBooking(booking: BookingNotification): Promise<{
  ownerEmail: boolean;
  customerEmail: boolean;
  whatsapp: boolean;
}> {
  const summary = bookingSummaryText(booking);
  const subject = `Prenotazione #${booking.id} — ${booking.roomName}, ${booking.dateLabel} ${booking.time}`;

  const results = await Promise.allSettled([
    sendEmail(COMPANY_EMAIL, subject, ownerEmailHtml(booking), booking.email),
    sendEmail(
      booking.email,
      `Prenotazione confermata — ${booking.dateLabel} alle ${booking.time}`,
      customerEmailHtml(booking),
      COMPANY_EMAIL,
      customerEmailText(booking),
    ),
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
