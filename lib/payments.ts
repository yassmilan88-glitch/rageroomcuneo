/**
 * Pagamento online delle sessioni (Stripe Checkout): si paga sempre tutto
 * online al momento della prenotazione, compresi gli extra.
 *
 * Si attiva quando su Netlify sono impostate `STRIPE_SECRET_KEY` e
 * `STRIPE_WEBHOOK_SECRET`. Finché non lo sono, il sito continua a prendere
 * prenotazioni senza acconto (vedi `netlify/functions/book.mts`).
 */

import Stripe from "stripe";
import { DEPOSIT_CURRENCY, HOLD_MINUTES } from "./booking.js";

let client: Stripe | null = null;

export function isPaymentEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY non configurata.");
  if (!client) client = new Stripe(key);
  return client;
}

export interface CheckoutRequest {
  bookingId: number;
  publicToken: string;
  email: string;
  name: string;
  /** Descrizione completa: stanza, pacchetto, extra. */
  roomName: string;
  dateLabel: string;
  time: string;
  end: string;
  people: number;
  /** Importo da pagare online, in centesimi. */
  amountCents: number;
  /** Buono regalo usato per una parte del totale, se c'è. */
  voucher?: { code: string; paymentIntentId: string; cents: number };
  /** Origine del sito, per costruire gli URL di ritorno. */
  origin: string;
}

/** Crea la sessione di pagamento (sempre l'intero importo) e restituisce id e URL. */
export async function createBookingCheckout(
  request: CheckoutRequest,
): Promise<{ id: string; url: string }> {
  const stripe = getStripe();
  const peopleText = `${request.people} ${request.people === 1 ? "persona" : "persone"}`;
  const voucherText = request.voucher ? ` Buono regalo ${request.voucher.code} già scalato.` : "";

  const metadata: Record<string, string> = {
    bookingId: String(request.bookingId),
    room: request.roomName.slice(0, 200),
    slot: `${request.dateLabel} ${request.time}`,
    people: String(request.people),
    name: request.name.slice(0, 80),
    paymentType: "full",
  };
  if (request.voucher) {
    metadata.voucher_code = request.voucher.code;
    metadata.voucher_pi = request.voucher.paymentIntentId;
    metadata.voucher_cents = String(request.voucher.cents);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: "it",
    customer_email: request.email,
    client_reference_id: String(request.bookingId),
    // Stripe libera la sessione insieme alla nostra prenotazione provvisoria.
    expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: DEPOSIT_CURRENCY,
          unit_amount: request.amountCents,
          product_data: {
            name: `Rage Room Cuneo — ${request.roomName}`,
            description: `${request.dateLabel}, ${request.time}–${request.end}, ${peopleText}.${voucherText}`,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${request.origin}/?prenotazione=ok&id=${request.bookingId}&token=${request.publicToken}#prenota`,
    cancel_url: `${request.origin}/?prenotazione=annullata#prenota`,
  });

  if (!session.url) throw new Error("Stripe non ha restituito un URL di pagamento.");
  return { id: session.id, url: session.url };
}
