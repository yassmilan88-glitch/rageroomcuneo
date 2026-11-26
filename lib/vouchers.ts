/**
 * Buoni regalo di Rage Room Cuneo.
 *
 * Non c'è una tabella dedicata: il buono vive su Stripe. Il codice viene
 * generato prima del pagamento e salvato nei metadati del PaymentIntent, così
 * si ritrova con la ricerca di Stripe (dashboard o API) e lì si segna anche
 * quando viene usato per prenotare. Niente migrazioni del database.
 */

import { randomInt } from "node:crypto";
import type Stripe from "stripe";
import {
  VENUE_ADDRESS,
  VENUE_MAPS_URL,
  formatDateIt,
  formatEuro,
  getPackage,
  priceCentsFor,
  type Package,
} from "./booking.js";
import { COMPANY_EMAIL, OWNER_WHATSAPP, escapeHtml, sendEmail, sendOwnerWhatsApp } from "./notify.js";
import { getStripe } from "./payments.js";

/** Il buono vale 12 mesi dall'acquisto. */
export const VOUCHER_VALID_MONTHS = 12;

/** Lettere e numeri senza quelli che si confondono (0/O, 1/I/L). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomBlock(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Codice tipo RR-7KQ2-M9XA, facile da dettare al telefono. */
export function generateVoucherCode(): string {
  return `RR-${randomBlock(4)}-${randomBlock(4)}`;
}

/** Ripulisce il codice digitato dal cliente: maiuscole, niente spazi, trattini al posto giusto. */
export function normalizeVoucherCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("RR") ? raw.slice(2) : raw;
  if (body.length !== 8) return "";
  return `RR-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function isVoucherCodeFormat(code: string): boolean {
  return /^RR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
}

export interface Voucher {
  code: string;
  packageId: string;
  packageName: string;
  minutes: number;
  contents: string;
  people: number;
  valueCents: number;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  message: string;
  purchasedOn: string;
  expiresOn: string;
  redeemed: string;
  emailed: boolean;
  paymentIntentId: string;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function expiryFrom(purchased: Date): string {
  const expires = new Date(purchased);
  expires.setUTCMonth(expires.getUTCMonth() + VOUCHER_VALID_MONTHS);
  return isoDate(expires);
}

export function voucherFromPaymentIntent(pi: Stripe.PaymentIntent): Voucher | null {
  const meta = pi.metadata || {};
  if (meta.kind !== "voucher" || !meta.voucher_code) return null;
  const pkg = getPackage(meta.package || "");
  const purchased = new Date(pi.created * 1000);
  return {
    code: meta.voucher_code,
    packageId: pkg?.id ?? meta.package ?? "",
    packageName: pkg ? `Pacchetto ${pkg.name}` : meta.package ?? "",
    minutes: pkg?.minutes ?? 15,
    contents: pkg?.contents ?? "",
    people: Number(meta.people) || 1,
    valueCents: pi.amount_received || pi.amount,
    buyerName: meta.buyer_name || "",
    buyerEmail: meta.buyer_email || pi.receipt_email || "",
    recipientName: meta.recipient_name || "",
    message: meta.message || "",
    purchasedOn: isoDate(purchased),
    expiresOn: expiryFrom(purchased),
    redeemed: meta.voucher_redeemed || "",
    emailed: Boolean(meta.voucher_emailed),
    paymentIntentId: pi.id,
  };
}

/** Quello che il sito mostra a chi ha comprato il buono. */
export function voucherPublicView(voucher: Voucher) {
  return {
    code: voucher.code,
    packageName: voucher.packageName,
    minutes: voucher.minutes,
    contents: voucher.contents,
    people: voucher.people,
    peopleLabel: voucherPeopleLabel(voucher),
    value: formatEuro(voucher.valueCents),
    recipientName: voucher.recipientName,
    buyerName: voucher.buyerName,
    message: voucher.message,
    expiresLabel: formatDateIt(voucher.expiresOn),
  };
}

function voucherPeopleLabel(voucher: Voucher): string {
  return voucher.people === 1 ? "1 persona" : `${voucher.people} persone`;
}

/* ------------------------------------------------------------------ */
/* Acquisto                                                            */
/* ------------------------------------------------------------------ */

export interface VoucherPurchase {
  pkg: Package;
  people: number;
  buyerName: string;
  buyerEmail: string;
  recipientName: string;
  message: string;
  origin: string;
}

export function voucherPriceCents(pkg: Package, people: number): number {
  return priceCentsFor(pkg.id, people);
}

export async function createVoucherCheckout(purchase: VoucherPurchase): Promise<{ url: string; code: string }> {
  const stripe = getStripe();
  const code = generateVoucherCode();
  const amount = voucherPriceCents(purchase.pkg, purchase.people);
  const people = purchase.people;

  // Stripe accetta metadati fino a 500 caratteri per valore.
  const metadata: Record<string, string> = {
    kind: "voucher",
    voucher_code: code,
    package: purchase.pkg.id,
    people: String(people),
    buyer_name: purchase.buyerName.slice(0, 80),
    buyer_email: purchase.buyerEmail.slice(0, 200),
    recipient_name: purchase.recipientName.slice(0, 80),
    message: purchase.message.slice(0, 300),
  };

  const peopleText = people === 1 ? "1 persona" : `${people} persone`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: "it",
    customer_email: purchase.buyerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: amount,
          product_data: {
            name: `Buono regalo Pacchetto ${purchase.pkg.name} — Rage Room Cuneo`,
            description: `${purchase.pkg.minutes} minuti, ${purchase.pkg.contents}, ${peopleText}. Per ${purchase.recipientName}. Valido ${VOUCHER_VALID_MONTHS} mesi.`,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: {
      description: `Buono regalo ${code} — Pacchetto ${purchase.pkg.name}, ${peopleText}`,
      metadata,
    },
    success_url: `${purchase.origin}/?buono=ok&session={CHECKOUT_SESSION_ID}#regala`,
    cancel_url: `${purchase.origin}/?buono=annullato#regala`,
  });

  if (!session.url) throw new Error("Stripe non ha restituito un URL di pagamento.");
  return { url: session.url, code };
}

/* ------------------------------------------------------------------ */
/* Consegna del buono (email a chi lo compra + avviso al titolare)     */
/* ------------------------------------------------------------------ */

function voucherEmailHtml(voucher: Voucher): string {
  const view = voucherPublicView(voucher);
  const message = voucher.message
    ? `<p style="margin:18px 0 0;font-size:16px;font-style:italic;color:#f3efe6;">“${escapeHtml(voucher.message)}”</p>`
    : "";
  return `<div style="font-family:Helvetica,Arial,sans-serif;color:#111;max-width:560px;">
  <p style="margin:0 0 16px;font-size:15px;">Ciao ${escapeHtml(voucher.buyerName)}, grazie! Ecco il tuo buono regalo. Puoi stamparlo, inoltrare questa email o mandare il codice su WhatsApp.</p>
  <div style="background:#0a0a0c;border-radius:18px;padding:28px 26px;color:#f3efe6;border:2px solid #8b5cf6;">
    <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#f4c400;font-weight:700;">Buono regalo · Rage Room Cuneo</div>
    <div style="font-size:30px;font-weight:900;text-transform:uppercase;margin-top:10px;line-height:1.05;">Spacca. Sfogati. <span style="color:#ff2e6e;">Riparti.</span></div>
    <p style="margin:18px 0 0;font-size:15px;">Per <strong>${escapeHtml(voucher.recipientName)}</strong>${voucher.buyerName ? `, da parte di <strong>${escapeHtml(voucher.buyerName)}</strong>` : ""}</p>
    ${message}
    <p style="margin:18px 0 0;font-size:15px;">${escapeHtml(view.packageName)} · ${escapeHtml(view.peopleLabel)} · sessione da ${view.minutes} minuti<br><span style="color:#9a978f;">${escapeHtml(view.contents)}${voucher.people > 1 ? " a persona" : ""}</span></p>
    <div style="margin-top:20px;background:#f4c400;color:#111;border-radius:10px;padding:14px 16px;text-align:center;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Codice</div>
      <div style="font-size:28px;font-weight:900;letter-spacing:3px;font-family:Courier New,monospace;">${escapeHtml(voucher.code)}</div>
    </div>
    <p style="margin:16px 0 0;font-size:13px;color:#9a978f;">Valido fino al ${escapeHtml(view.expiresLabel)}.</p>
  </div>
  <p style="margin:20px 0 0;font-size:14px;"><strong>Come si usa:</strong> si prenota su <a href="https://rageroomcuneo.it/#prenota">rageroomcuneo.it</a>, si scelgono il pacchetto, la stanza, il giorno e l'orario, e si scrive il codice nel campo “Buono regalo”. Non si paga nulla online; se si sceglie un pacchetto più grande o si è in più persone, la differenza si salda in sede.</p>
  <p style="margin:12px 0 0;font-size:14px;">📍 ${escapeHtml(VENUE_ADDRESS)} — <a href="${VENUE_MAPS_URL}">mappa</a></p>
  <p style="margin:16px 0 0;font-size:13px;color:#8a8a92;">Per qualsiasi cosa scrivici su <a href="https://wa.me/${OWNER_WHATSAPP}">WhatsApp</a> o a <a href="mailto:${COMPANY_EMAIL}">${COMPANY_EMAIL}</a>.</p>
</div>`;
}

function voucherOwnerText(voucher: Voucher): string {
  const lines = [
    `🎁 Nuovo buono regalo ${voucher.code}`,
    `${voucher.packageName} · ${voucherPeopleLabel(voucher)} · ${formatEuro(voucher.valueCents)} incassati`,
    `Comprato da: ${voucher.buyerName} (${voucher.buyerEmail})`,
    `Per: ${voucher.recipientName}`,
    `Scade il ${formatDateIt(voucher.expiresOn)}`,
  ];
  if (voucher.message) lines.push(`Dedica: ${voucher.message}`);
  return lines.join("\n");
}

/**
 * Manda il buono a chi l'ha comprato e avvisa il titolare, una sola volta:
 * la consegna viene segnata nei metadati del PaymentIntent. La chiamano sia il
 * webhook di Stripe sia la pagina di ritorno, quindi deve essere idempotente.
 */
export async function deliverVoucher(session: Stripe.Checkout.Session): Promise<Voucher | null> {
  if (session.metadata?.kind !== "voucher" || session.payment_status !== "paid") return null;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) return null;

  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(piId);
  const voucher = voucherFromPaymentIntent(pi);
  if (!voucher || voucher.emailed) return voucher;

  // Prima si segna la consegna, poi si manda: meglio un'email in meno (il buono
  // resta visibile sulla pagina di ritorno e su Stripe) che due email doppie.
  await stripe.paymentIntents.update(pi.id, { metadata: { voucher_emailed: new Date().toISOString() } });

  const results = await Promise.allSettled([
    sendEmail(
      voucher.buyerEmail,
      `Il tuo buono regalo Rage Room Cuneo — ${voucher.code}`,
      voucherEmailHtml(voucher),
      COMPANY_EMAIL,
    ),
    sendEmail(
      COMPANY_EMAIL,
      `Buono regalo venduto — ${voucher.code} (${formatEuro(voucher.valueCents)})`,
      `<pre style="font-family:Helvetica,Arial,sans-serif;font-size:15px;">${escapeHtml(voucherOwnerText(voucher))}</pre>`,
      voucher.buyerEmail,
    ),
    sendOwnerWhatsApp(voucherOwnerText(voucher)),
  ]);
  for (const result of results) {
    if (result.status === "rejected") console.error("Notifica buono regalo fallita", result.reason);
  }
  return { ...voucher, emailed: true };
}

/* ------------------------------------------------------------------ */
/* Uso del buono in prenotazione                                       */
/* ------------------------------------------------------------------ */

/** Cerca un buono pagato a partire dal codice. */
export async function findVoucher(code: string): Promise<Voucher | null> {
  // Il codice è già normalizzato (solo lettere, numeri e trattini): nessun
  // rischio di iniettare altro nella query di ricerca.
  if (!isVoucherCodeFormat(code)) return null;
  const result = await getStripe().paymentIntents.search({
    query: `metadata['voucher_code']:'${code}' AND status:'succeeded'`,
    limit: 1,
  });
  const pi = result.data[0];
  return pi ? voucherFromPaymentIntent(pi) : null;
}

/** Motivo per cui il buono non si può usare per questa prenotazione, oppure null. */
export function voucherRejectionReason(voucher: Voucher, slotDate: string): string | null {
  if (voucher.redeemed) return "Questo buono è già stato usato. Per dubbi scrivici su WhatsApp.";
  if (slotDate > voucher.expiresOn) {
    return `Questo buono vale fino al ${formatDateIt(voucher.expiresOn)}: scegli una data entro la scadenza.`;
  }
  return null;
}

/**
 * Il buono vale il suo importo: copre la sessione fino a quella cifra e la
 * differenza (pacchetto più grande, persone in più) si salda in sede.
 */
export function voucherCoverage(voucher: Voucher, packageId: string, people: number) {
  const price = priceCentsFor(packageId, people);
  const covered = Math.min(voucher.valueCents, price);
  return { coveredCents: covered, extraDueCents: Math.max(0, price - covered) };
}

export async function markVoucherRedeemed(voucher: Voucher, label: string): Promise<void> {
  await getStripe().paymentIntents.update(voucher.paymentIntentId, {
    metadata: { voucher_redeemed: label.slice(0, 200) },
  });
}

/** Libera di nuovo il buono se la prenotazione non va a buon fine dopo averlo segnato. */
export async function unmarkVoucherRedeemed(voucher: Voucher): Promise<void> {
  await getStripe().paymentIntents.update(voucher.paymentIntentId, { metadata: { voucher_redeemed: "" } });
}
