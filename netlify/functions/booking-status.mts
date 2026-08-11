import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { confirmAndNotify, findById, publicView } from "../../lib/bookings-store.js";
import { getStripe, isPaymentEnabled } from "../../lib/payments.js";

function tokenMatches(expected: string, provided: string): boolean {
  if (!expected || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/**
 * Stato di una prenotazione, letto dalla pagina di ritorno dal pagamento.
 * Serve il token generato alla creazione, così nessuno può sfogliare le
 * prenotazioni altrui cambiando l'id nell'URL.
 *
 * Se il webhook di Stripe non è ancora arrivato, l'esito del pagamento viene
 * chiesto direttamente a Stripe: il cliente vede subito la conferma giusta.
 */
export default async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const id = Number(params.get("id"));
  const token = params.get("token") || "";

  if (!Number.isInteger(id) || id <= 0 || !token) {
    return Response.json({ ok: false, error: "Prenotazione non trovata." }, { status: 400 });
  }

  let booking;
  try {
    booking = await findById(id);
  } catch (error) {
    console.error("Errore lettura prenotazione", error);
    return Response.json({ ok: false, error: "Servizio non disponibile." }, { status: 503 });
  }

  if (!booking || !tokenMatches(booking.publicToken, token)) {
    return Response.json({ ok: false, error: "Prenotazione non trovata." }, { status: 404 });
  }

  if (booking.status === "pending" && booking.stripeSessionId && isPaymentEnabled()) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(booking.stripeSessionId);
      if (session.payment_status === "paid") {
        booking = await confirmAndNotify(booking, { paid: true });
      }
    } catch (error) {
      console.error("Errore verifica pagamento su Stripe", error);
    }
  }

  return Response.json(
    { ok: true, booking: publicView(booking) },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const config: Config = {
  path: "/api/prenotazione",
  method: "GET",
};
