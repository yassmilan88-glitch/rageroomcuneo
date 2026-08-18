/**
 * Gateway di pagamento dell'acconto (Stripe Checkout).
 *
 * L'acconto è di 5 € a persona: si paga online al momento della prenotazione,
 * il saldo della sessione si versa in sede.
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
  roomName: string;
  dateLabel: string;
  time: string;
  end: string;
  people: number;
  depositCents: number;
  /** true se il cliente ha scelto di pagare l'intero importo online. */
  isFullPayment: boolean;
  /** Origine del sito, per costruire gli URL di ritorno. */
  origin: string;
}

/** Crea la sessione di pagamento e restituisce id e URL a cui mandare il cliente. */
export async function createDepositCheckout(
  request: CheckoutRequest,
): Promise<{ id: string; url: string }> {
  const stripe = getStripe();
  const perPerson = Math.round(request.depositCents / request.people);
  const label = request.isFullPayment ? "Pagamento completo" : "Acconto";
  const detail = request.isFullPayment
    ? "Pagamento a persona, sessione saldata per intero."
    : "Acconto a persona, saldo in sede.";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: "it",
    customer_email: request.email,
    client_reference_id: String(request.bookingId),
    // Stripe libera la sessione insieme alla nostra prenotazione provvisoria.
    expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
    line_items: [
      {
        quantity: request.people,
        price_data: {
          currency: DEPOSIT_CURRENCY,
          unit_amount: perPerson,
          product_data: {
            name: `${label} ${request.roomName} — Rage Room Cuneo`,
            description: `${request.dateLabel}, ${request.time}–${request.end}. ${detail}`,
          },
        },
      },
    ],
    metadata: {
      bookingId: String(request.bookingId),
      room: request.roomName,
      slot: `${request.dateLabel} ${request.time}`,
      people: String(request.people),
      name: request.name,
      paymentType: request.isFullPayment ? "full" : "deposit",
    },
    success_url: `${request.origin}/?prenotazione=ok&id=${request.bookingId}&token=${request.publicToken}#prenota`,
    cancel_url: `${request.origin}/?prenotazione=annullata#prenota`,
  });

  if (!session.url) throw new Error("Stripe non ha restituito un URL di pagamento.");
  return { id: session.id, url: session.url };
}
