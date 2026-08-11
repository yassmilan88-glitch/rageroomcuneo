import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import {
  HOLD_MINUTES,
  dateRejectionReason,
  depositCentsFor,
  formatDateIt,
  getRoom,
  isSlotInPast,
  slotEndTime,
  slotTimesFor,
} from "../../lib/booking.js";
import {
  attachCheckoutSession,
  claimSlot,
  confirmAndNotify,
  publicView,
  releaseBooking,
} from "../../lib/bookings-store.js";
import { OWNER_WHATSAPP } from "../../lib/notify.js";
import { createDepositCheckout, isPaymentEnabled } from "../../lib/payments.js";

function badRequest(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export default async (req: Request) => {
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

  if (!Number.isInteger(people) || people < room.minPeople || people > room.maxPeople) {
    return badRequest(
      `${room.name}: il numero di persone deve essere tra ${room.minPeople} e ${room.maxPeople}.`,
    );
  }

  if (name.length < 2 || name.length > 80) return badRequest("Inserisci il tuo nome e cognome.");
  if (phone.replace(/\D/g, "").length < 8) return badRequest("Inserisci un numero di telefono valido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return badRequest("Inserisci un indirizzo email valido.");

  const slotTaken = () =>
    badRequest(
      `${room.name} è appena stata prenotata alle ${time}. Scegli un altro orario o un'altra stanza.`,
      409,
    );

  const deposit = depositCentsFor(people);
  const withDeposit = isPaymentEnabled();

  let saved;
  try {
    saved = await claimSlot({
      slotDate: date,
      slotTime: time,
      room: room.id,
      people,
      name,
      phone,
      email,
      notes,
      // Con l'acconto attivo la fascia resta bloccata solo finché il cliente
      // completa il pagamento su Stripe.
      status: withDeposit ? "pending" : "confirmed",
      depositCents: deposit,
      publicToken: randomUUID(),
      holdExpiresAt: withDeposit ? new Date(Date.now() + HOLD_MINUTES * 60_000) : null,
    });
  } catch (error) {
    console.error("Errore salvataggio prenotazione", error);
    return badRequest("Non è stato possibile salvare la prenotazione. Riprova o scrivici su WhatsApp.", 500);
  }

  if (!saved) return slotTaken();

  const dateLabel = formatDateIt(date);
  const end = slotEndTime(time);

  // Nessun gateway configurato: la prenotazione vale subito e l'acconto si
  // salda in sede, così il sito continua a funzionare durante la messa a punto.
  if (!withDeposit) {
    const confirmed = await confirmAndNotify(saved, { paid: false });
    const summary =
      `Ciao! Ho prenotato online: ${room.name} — ${dateLabel} alle ${time} ` +
      `(${people} ${people === 1 ? "persona" : "persone"}). Nome: ${name}. Codice #${confirmed.id}`;

    return Response.json(
      {
        ok: true,
        booking: publicView(confirmed),
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
      roomName: room.name,
      dateLabel,
      time,
      end,
      people,
      depositCents: deposit,
      // L'origine della richiesta è già quella su cui sta navigando il cliente:
      // così il ritorno da Stripe resta sul dominio giusto anche nelle preview.
      origin: new URL(req.url).origin || process.env.URL || "",
    });
    await attachCheckoutSession(saved.id, checkout.id);

    return Response.json(
      {
        ok: true,
        booking: publicView(saved),
        payment: { url: checkout.url, amountCents: deposit, holdMinutes: HOLD_MINUTES },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Errore creazione pagamento acconto", error);
    // La fascia torna libera subito, senza aspettare la scadenza del blocco.
    await releaseBooking(saved.id);
    return badRequest(
      "Non riesco ad aprire il pagamento dell'acconto. Riprova tra poco o scrivici su WhatsApp.",
      502,
    );
  }
};

export const config: Config = {
  path: "/api/prenota",
  method: "POST",
};
