import type { Config } from "@netlify/functions";
import { getPackage } from "../../lib/booking.js";
import { isPaymentEnabled } from "../../lib/payments.js";
import { createVoucherCheckout } from "../../lib/vouchers.js";

function badRequest(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

/**
 * Acquisto di un buono regalo: valida i dati e apre il pagamento su Stripe.
 * Il buono viene consegnato via email quando Stripe conferma l'incasso.
 */
export default async (req: Request) => {
  if (!isPaymentEnabled()) {
    return badRequest("I buoni regalo online non sono disponibili in questo momento. Scrivici su WhatsApp.", 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return badRequest("Richiesta non valida.");
  }

  const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const pkg = getPackage(asText(payload.package));
  if (!pkg) return badRequest("Scegli il pacchetto da regalare.");

  const people = Number(payload.people);
  if (!Number.isInteger(people) || people < 1 || people > 5) {
    return badRequest("Il buono vale da 1 a 5 persone.");
  }

  const buyerName = asText(payload.buyerName);
  const buyerEmail = asText(payload.buyerEmail);
  const recipientName = asText(payload.recipientName);
  const message = asText(payload.message).replace(/\s+/g, " ").slice(0, 300);

  if (buyerName.length < 2 || buyerName.length > 80) return badRequest("Scrivi il tuo nome.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyerEmail)) {
    return badRequest("Scrivi un'email valida: lì ti mandiamo il buono.");
  }
  if (recipientName.length < 1 || recipientName.length > 80) return badRequest("Scrivi il nome di chi riceve il regalo.");

  try {
    const checkout = await createVoucherCheckout({
      pkg,
      people,
      buyerName,
      buyerEmail,
      recipientName,
      message,
      origin: new URL(req.url).origin || process.env.URL || "",
    });
    return Response.json({ ok: true, payment: { url: checkout.url } }, { status: 201 });
  } catch (error) {
    console.error("Errore creazione pagamento buono regalo", error);
    return badRequest("Non riesco ad aprire il pagamento. Riprova tra poco o scrivici su WhatsApp.", 502);
  }
};

export const config: Config = {
  path: "/api/buono",
  method: "POST",
};
