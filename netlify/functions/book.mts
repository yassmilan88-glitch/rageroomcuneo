import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import {
  BOOKING_LIVE,
  HOLD_MINUTES,
  MAX_PEOPLE,
  SESSION_MINUTES,
  candidateRoomsFor,
  dateRejectionReason,
  extrasLabel,
  formatDateIt,
  getPackage,
  getRoom,
  isSlotInPast,
  isValidExtras,
  slotEndTime,
  slotTimesFor,
  totalCentsFor,
} from "../../lib/booking.js";
import {
  type BookingRow,
  attachCheckoutSession,
  claimSlot,
  confirmAndNotify,
  publicView,
  publicViewWithPromo,
  releaseBooking,
} from "../../lib/bookings-store.js";
import { OWNER_WHATSAPP } from "../../lib/notify.js";
import { createBookingCheckout, isPaymentEnabled } from "../../lib/payments.js";
import {
  type Voucher,
  findVoucher,
  markVoucherRedeemed,
  normalizeVoucherCode,
  voucherRejectionReason,
} from "../../lib/vouchers.js";

function badRequest(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

/**
 * Nuova prenotazione. Si paga tutto online: la fascia resta bloccata finché il
 * cliente completa il pagamento su Stripe. Un buono regalo scala il totale;
 * se lo copre tutto, la prenotazione si conferma subito.
 */
export default async (req: Request) => {
  if (!BOOKING_LIVE) {
    return badRequest("Le prenotazioni online non sono ancora aperte.", 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return badRequest("Richiesta non valida.");
  }

  const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const date = asText(payload.date);
  const time = asText(payload.time);
  const name = asText(payload.name);
  const phone = asText(payload.phone);
  const email = asText(payload.email);
  const userNotes = asText(payload.notes).slice(0, 400);
  const people = Number(payload.people);
  const pkg = getPackage(asText(payload.package) || "base");
  const extras = { minutes: Number(payload.extraMinutes) || 0, big: Number(payload.extraBig) || 0 };

  const dateRejection = dateRejectionReason(date);
  if (dateRejection) return badRequest(dateRejection);
  if (!slotTimesFor(date).includes(time)) return badRequest("Fascia oraria non valida.");
  if (isSlotInPast(date, time)) return badRequest("Questa fascia oraria è già passata.");

  if (!Number.isInteger(people) || people < 1 || people > MAX_PEOPLE) {
    return badRequest(`Potete essere da 1 a ${MAX_PEOPLE} persone.`);
  }
  if (!pkg) return badRequest("Scegli il pacchetto: Base, Plus o Extreme.");
  if (!isValidExtras(extras)) return badRequest("Extra non validi.");

  if (name.length < 2 || name.length > 80) return badRequest("Inserisci il tuo nome e cognome.");
  if (phone.replace(/\D/g, "").length < 8) return badRequest("Inserisci un numero di telefono valido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return badRequest("Inserisci un indirizzo email valido.");
  if (payload.rulesAccepted !== true) return badRequest("Per prenotare devi accettare le regole della sessione.");

  const total = totalCentsFor(pkg.id, people, extras, date);

  // Buono regalo: scala il totale.
  const voucherInput = asText(payload.voucherCode);
  let voucher: Voucher | null = null;
  if (voucherInput) {
    const code = normalizeVoucherCode(voucherInput);
    if (!code) return badRequest("Il codice del buono ha questo formato: RR-XXXX-XXXX. Controllalo.");
    if (!isPaymentEnabled()) return badRequest("Non riesco a verificare il buono adesso. Scrivici su WhatsApp.", 503);
    try {
      voucher = await findVoucher(code);
    } catch (error) {
      console.error("Errore verifica buono regalo", error);
      return badRequest("Non riesco a verificare il buono adesso. Riprova tra poco o scrivici su WhatsApp.", 503);
    }
    if (!voucher) {
      return badRequest(
        "Codice buono non trovato. Se l'hai appena acquistato riprova tra qualche minuto, oppure scrivici su WhatsApp.",
      );
    }
    const rejection = voucherRejectionReason(voucher, date);
    if (rejection) return badRequest(rejection);
  }
  const voucherCents = voucher ? Math.min(voucher.valueCents, total) : 0;
  const onlineCents = total - voucherCents;

  const notes = [voucher ? `🎁 Buono ${voucher.code}` : "", userNotes].filter(Boolean).join(" · ").slice(0, 500);
  const withPayment = isPaymentEnabled() && onlineCents > 0;

  // La stanza si assegna da sola in base a quanti siete: la prima libera tra quelle adatte.
  let saved: BookingRow | null = null;
  try {
    for (const roomId of candidateRoomsFor(people)) {
      saved = await claimSlot({
        slotDate: date,
        slotTime: time,
        room: roomId,
        package: pkg.id,
        extraMinutes: extras.minutes,
        extraBig: extras.big,
        people,
        name,
        phone,
        email,
        notes,
        status: "pending",
        // Valore totale della sessione (buono + pagamento online).
        depositCents: total,
        publicToken: randomUUID(),
        holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      });
      if (saved) break;
    }
  } catch (error) {
    console.error("Errore salvataggio prenotazione", error);
    return badRequest("Non è stato possibile salvare la prenotazione. Riprova o scrivici su WhatsApp.", 500);
  }
  if (!saved) {
    return badRequest(`Alle ${time} è appena stato prenotato tutto. Scegli un altro orario.`, 409);
  }

  const room = getRoom(saved.room);
  const extrasText = extrasLabel(extras);
  const fullName = `${room?.name ?? saved.room} · Pacchetto ${pkg.name}${extrasText ? ` · ${extrasText}` : ""}`;
  const dateLabel = formatDateIt(date);
  const end = slotEndTime(time, SESSION_MINUTES + extras.minutes);

  // Niente da pagare online (buono che copre tutto, o pagamenti non configurati):
  // si conferma subito.
  if (!withPayment) {
    if (voucher) {
      try {
        await markVoucherRedeemed(voucher, `#${saved.id} ${date} ${time}`);
      } catch (error) {
        console.error("Errore nel segnare il buono come usato", error);
        await releaseBooking(saved.id);
        return badRequest("Non riesco a registrare il buono adesso. Riprova tra poco o scrivici su WhatsApp.", 502);
      }
    }
    const confirmed = await confirmAndNotify(saved, {
      paid: Boolean(voucher),
      voucherCode: voucher?.code,
      voucherCents: voucher ? voucherCents : undefined,
    });
    const summary =
      `Ciao! Ho prenotato online: ${fullName} — ${dateLabel} alle ${time} ` +
      `(${people} ${people === 1 ? "persona" : "persone"}). Nome: ${name}. Codice #${confirmed.id}`;
    return Response.json(
      {
        ok: true,
        booking: await publicViewWithPromo(confirmed),
        voucher: voucher ? { code: voucher.code } : undefined,
        whatsappUrl: `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(summary)}`,
      },
      { status: 201 },
    );
  }

  try {
    const checkout = await createBookingCheckout({
      bookingId: saved.id,
      publicToken: saved.publicToken,
      email,
      name,
      roomName: fullName,
      dateLabel,
      time,
      end,
      people,
      amountCents: onlineCents,
      voucher: voucher ? { code: voucher.code, paymentIntentId: voucher.paymentIntentId, cents: voucherCents } : undefined,
      // L'origine della richiesta è già quella su cui sta navigando il cliente:
      // così il ritorno da Stripe resta sul dominio giusto anche nelle preview.
      origin: new URL(req.url).origin || process.env.URL || "",
    });
    await attachCheckoutSession(saved.id, checkout.id);

    return Response.json(
      {
        ok: true,
        booking: publicView(saved),
        payment: { url: checkout.url, amountCents: onlineCents, holdMinutes: HOLD_MINUTES },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Errore creazione pagamento", error);
    // La fascia torna libera subito, senza aspettare la scadenza del blocco.
    await releaseBooking(saved.id);
    return badRequest("Non riesco ad aprire il pagamento. Riprova tra poco o scrivici su WhatsApp.", 502);
  }
};

export const config: Config = {
  path: "/api/prenota",
  method: "POST",
};
