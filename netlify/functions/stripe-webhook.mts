import type { Config } from "@netlify/functions";
import type Stripe from "stripe";
import {
  confirmAndNotify,
  findByCheckoutSession,
  releaseBooking,
} from "../../lib/bookings-store.js";
import { getStripe, isPaymentEnabled } from "../../lib/payments.js";

/**
 * Webhook di Stripe: è qui che una prenotazione diventa definitiva.
 *
 * Quando l'acconto viene incassato la prenotazione passa a `confirmed` e
 * partono email e WhatsApp; se la sessione di pagamento scade o viene
 * abbandonata la fascia torna libera.
 *
 * Va registrato su Stripe (Developers → Webhooks) verso
 * `https://<dominio>/api/stripe-webhook` per gli eventi
 * `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
 * `checkout.session.expired` e `checkout.session.async_payment_failed`.
 */
export default async (req: Request) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isPaymentEnabled() || !secret) {
    console.warn("Webhook Stripe ricevuto ma il gateway non è configurato.");
    return new Response("Gateway non configurato", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Firma mancante", { status: 400 });

  // La firma va verificata sul corpo grezzo, prima di qualsiasi parsing.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (error) {
    console.error("Firma del webhook Stripe non valida", error);
    return new Response("Firma non valida", { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        // `completed` scatta anche per i metodi di pagamento asincroni ancora
        // in sospeso: confermiamo solo quando l'incasso è effettivo.
        if (session.payment_status === "unpaid") break;

        const booking = await findByCheckoutSession(session.id);
        if (!booking) {
          console.error("Nessuna prenotazione per la sessione Stripe", session.id);
          break;
        }
        await confirmAndNotify(booking, { paid: true });
        break;
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const booking = await findByCheckoutSession(session.id);
        if (booking) await releaseBooking(booking.id);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    // Un 500 fa ritentare Stripe: le operazioni a valle sono idempotenti.
    console.error(`Errore nella gestione dell'evento ${event.type}`, error);
    return new Response("Errore interno", { status: 500 });
  }

  return Response.json({ received: true });
};

export const config: Config = {
  path: "/api/stripe-webhook",
  method: "POST",
};
