import type { Config } from "@netlify/functions";
import { getStripe, isPaymentEnabled } from "../../lib/payments.js";
import { deliverVoucher, voucherPublicView } from "../../lib/vouchers.js";

/**
 * Pagina di ritorno dopo l'acquisto di un buono: mostra il codice appena
 * pagato. L'id della sessione Stripe è lungo e casuale, quindi fa da chiave.
 * Se il webhook non è ancora arrivato, consegna qui il buono (una volta sola).
 */
export default async (req: Request) => {
  const sessionId = new URL(req.url).searchParams.get("session") || "";
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId) || !isPaymentEnabled()) {
    return Response.json({ ok: false, error: "Buono non trovato." }, { status: 400 });
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.kind !== "voucher") {
      return Response.json({ ok: false, error: "Buono non trovato." }, { status: 404 });
    }
    if (session.payment_status !== "paid") {
      return Response.json({ ok: true, status: "pending" }, { headers: { "Cache-Control": "no-store" } });
    }
    const voucher = await deliverVoucher(session);
    if (!voucher) return Response.json({ ok: true, status: "pending" }, { headers: { "Cache-Control": "no-store" } });
    return Response.json(
      { ok: true, status: "paid", voucher: voucherPublicView(voucher) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Errore lettura buono regalo", error);
    return Response.json({ ok: false, error: "Servizio non disponibile, riprova tra poco." }, { status: 503 });
  }
};

export const config: Config = {
  path: "/api/buono-stato",
  method: "GET",
};
