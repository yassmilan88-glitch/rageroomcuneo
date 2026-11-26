import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import {
  BOOKING_LIVE,
  HOLD_MINUTES,
  dateRejectionReason,
  depositCentsFor,
  formatDateIt,
  getPackage,
  getRoom,
  isSlotInPast,
  priceCentsFor,
  slotEndTime,
  slotTimesFor,
} from "../../lib/booking.js";
import {
  attachCheckoutSession,
  claimSlot,
  confirmAndNotify,
  publicView,
  publicViewWithPromo,
  releaseBooking,
} from "../../lib/bookings-store.js";
import { OWNER_WHATSAPP } from "../../lib/notify.js";
import { createDepositCheckout, isPaymentEnabled } from "../../lib/payments.js";
import {
  findVoucher,
  markVoucherRedeemed,
  normalizeVoucherCode,
  unmarkVoucherRedeemed,
  voucherCoverage,
  voucherRejectionReason,
  type Voucher,
} from "../../lib/vouchers.js";

function badRequest(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export default async (req: Request) => {
  if (!BOOKING_LIVE) {
    return badRequest(
      "Prenotazioni in arrivo! Iscriviti alla lista d'attesa per essere avvisato appena aprono.",
      403,
    );
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
  const roomId = asText(payload.room);
  const packageId = asText(payload.package) || "base";
  const name = asText(payload.name);
  const phone = asText(payload.phone);
  const email = asText(payload.email);
  const notes = asText(payload.notes).slice(0, 500);
  const people = Number(payload.people);

  const dateRejection = dateRejectionReason(date);
  if (dateRejection) return badRequest(dateRejection);

  if (!slotTimesFor(date).includes(time)) return badRequest("Fascia oraria non valida.");
  if (isSlotInPast(date, time)) return badRequest("Questa fascia oraria è già passata.");

  const room = getRoom(roomId);
  if (!room) return badRequest("Stanza non valida.");
  const pkg = getPackage(packageId);
  if (!pkg) return badRequest("Scegli il pacchetto: Base, Plus o Extreme.");
  const fullName = `${room.name} · Pacchetto ${pkg.name}`;

  if (!Number.isInteger(people) || people < room.minPeople || people > room.maxPeople) {
    return badRequest(
      `${room.name}: il numero di persone deve essere tra ${room.minPeople} e ${room.maxPeople}.`,
    );
  }

  if (name.length < 2 || name.length > 80) return badRequest("Inserisci il tuo nome e cognome.");
  if (phone.replace(/\D/g, "").length < 8) return badRequest("Inserisci un numero di telefono valido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return badRequest("Inserisci un indirizzo email valido.");

  // Buono regalo: se c'è, la sessione è già pagata e non serve la riserva.
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

  const slotTaken = () =>
    badRequest(
      `${room.name} è appena stata prenotata alle ${time}. Scegli un altro orario o un'altra stanza.`,
      409,
    );

  if (voucher) return bookWithVoucher();

  const withDeposit = isPaymentEnabled();
  const paymentTypeRaw = asText(payload.paymentType);
  // La scelta "paga tutto ora" ha senso solo se il gateway è attivo: senza
  // Stripe la prenotazione si conferma comunque e il saldo si versa in sede.
  const isFullPayment = withDeposit && paymentTypeRaw === "full";
  const amount = isFullPayment ? priceCentsFor(pkg.id, people) : depositCentsFor(people);

  async function bookWithVoucher() {
    const v = voucher as Voucher;
    const { coveredCents, extraDueCents } = voucherCoverage(v, pkg!.id, people);
    let claimed;
    try {
      claimed = await claimSlot({
        slotDate: date,
        slotTime: time,
        room: room!.id,
        package: pkg!.id,
        people,
        name,
        phone,
        email,
        notes: `🎁 Buono ${v.code}${notes ? ` · ${notes}` : ""}`.slice(0, 500),
        status: "pending",
        depositCents: coveredCents,
        publicToken: randomUUID(),
        holdExpiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
      });
    } catch (error) {
      console.error("Errore salvataggio prenotazione con buono", error);
      return badRequest("Non è stato possibile salvare la prenotazione. Riprova o scrivici su WhatsApp.", 500);
    }
    if (!claimed) return slotTaken();

    // Il buono si segna come usato prima di confermare: se Stripe non risponde
    // la fascia torna libera e il buono resta valido.
    try {
      await markVoucherRedeemed(v, `#${claimed.id} ${date} ${time}`);
    } catch (error) {
      console.error("Errore nel segnare il buono come usato", error);
      await releaseBooking(claimed.id);
      return badRequest("Non riesco a registrare il buono adesso. Riprova tra poco o scrivici su WhatsApp.", 502);
    }

    let confirmed;
    try {
      confirmed = await confirmAndNotify(claimed, { paid: true, voucherCode: v.code, extraDueCents });
    } catch (error) {
      console.error("Errore conferma prenotazione con buono", error);
      await releaseBooking(claimed.id);
      await unmarkVoucherRedeemed(v).catch(() => undefined);
      return badRequest("Non è stato possibile confermare la prenotazione. Riprova o scrivici su WhatsApp.", 500);
    }

    const summary =
      `Ciao! Ho prenotato con il buono regalo ${v.code}: ${fullName} — ${formatDateIt(date)} alle ${time} ` +
      `(${people} ${people === 1 ? "persona" : "persone"}). Nome: ${name}. Codice #${confirmed.id}`;
    return Response.json(
      {
        ok: true,
        booking: await publicViewWithPromo(confirmed),
        voucher: { code: v.code, extraDueCents },
        whatsappUrl: `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(summary)}`,
      },
      { status: 201 },
    );
  }

  let saved;
  try {
    saved = await claimSlot({
      slotDate: date,
      slotTime: time,
      room: room.id,
      package: pkg.id,
      people,
      name,
      phone,
      email,
      notes,
      // Con l'acconto attivo la fascia resta bloccata solo finché il cliente
      // completa il pagamento su Stripe.
      status: withDeposit ? "pending" : "confirmed",
      depositCents: amount,
      publicToken: randomUUID(),
      holdExpiresAt: withDeposit ? new Date(Date.now() + HOLD_MINUTES * 60_000) : null,
    });
  } catch (error) {
    console.error("Errore salvataggio prenotazione", error);
    return badRequest("Non è stato possibile salvare la prenotazione. Riprova o scrivici su WhatsApp.", 500);
  }

  if (!saved) return slotTaken();

  const dateLabel = formatDateIt(date);
  const end = slotEndTime(time, pkg.minutes);

  // Nessun gateway configurato: la prenotazione vale subito e l'acconto si
  // salda in sede, così il sito continua a funzionare durante la messa a punto.
  if (!withDeposit) {
    const confirmed = await confirmAndNotify(saved, { paid: false });
    const summary =
      `Ciao! Ho prenotato online: ${fullName} — ${dateLabel} alle ${time} ` +
      `(${people} ${people === 1 ? "persona" : "persone"}). Nome: ${name}. Codice #${confirmed.id}`;

    return Response.json(
      {
        ok: true,
        booking: await publicViewWithPromo(confirmed),
        whatsappUrl: `https://wa.me/${OWNER_WHATSAPP}?text=${encodeURIComponent(summary)}`,
      },
      { status: 201 },
    );
  }

  try {
    const checkout = await createDepositCheckout({
      bookingId: saved.id,
      publicToken: saved.publicToken,
      email,
      name,
      roomName: fullName,
      dateLabel,
      time,
      end,
      people,
      depositCents: amount,
      isFullPayment,
      // L'origine della richiesta è già quella su cui sta navigando il cliente:
      // così il ritorno da Stripe resta sul dominio giusto anche nelle preview.
      origin: new URL(req.url).origin || process.env.URL || "",
    });
    await attachCheckoutSession(saved.id, checkout.id);

    return Response.json(
      {
        ok: true,
        booking: publicView(saved),
        payment: { url: checkout.url, amountCents: amount, holdMinutes: HOLD_MINUTES },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Errore creazione pagamento acconto", error);
    // La fascia torna libera subito, senza aspettare la scadenza del blocco.
    await releaseBooking(saved.id);
    return badRequest(
      "Non riesco ad aprire il pagamento della riserva. Riprova tra poco o scrivici su WhatsApp.",
      502,
    );
  }
};

export const config: Config = {
  path: "/api/prenota",
  method: "POST",
};
