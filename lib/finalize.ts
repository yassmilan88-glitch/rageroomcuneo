/**
 * Conferma di una prenotazione pagata su Stripe: la usano sia il webhook sia
 * la pagina di ritorno dal pagamento, quindi deve essere idempotente.
 * Se nel pagamento c'era anche un buono regalo, il buono si segna come usato
 * solo adesso, a pagamento avvenuto.
 */

import type Stripe from "stripe";
import { type BookingRow, confirmAndNotify } from "./bookings-store.js";
import { getStripe } from "./payments.js";

export async function finalizePaidBooking(booking: BookingRow, session: Stripe.Checkout.Session): Promise<BookingRow> {
  const meta = session.metadata || {};
  const voucherCode = meta.voucher_code || undefined;
  const voucherCents = meta.voucher_cents ? Number(meta.voucher_cents) : undefined;

  if (voucherCode && meta.voucher_pi) {
    try {
      await getStripe().paymentIntents.update(meta.voucher_pi, {
        metadata: { voucher_redeemed: `#${booking.id} ${booking.slotDate} ${booking.slotTime}` },
      });
    } catch (error) {
      // Il cliente ha pagato: la prenotazione si conferma comunque.
      console.error("Errore nel segnare il buono come usato", voucherCode, error);
    }
  }

  return confirmAndNotify(booking, { paid: true, voucherCode, voucherCents });
}
