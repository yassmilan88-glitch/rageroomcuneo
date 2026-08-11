import type { Config } from "@netlify/functions";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import {
  DEPOSIT_CENTS_PER_PERSON,
  LATE_WEEKDAYS,
  OPENING_HOURS_LABEL,
  OPEN_WEEKDAYS,
  ROOMS,
  SESSION_MINUTES,
  TURNAROUND_MINUTES,
  closingTimeFor,
  dateRejectionReason,
  firstBookableDate,
  firstOpenBookableDate,
  formatDateIt,
  isOpenDay,
  isSlotInPast,
  lastBookableDate,
  slotEndTime,
  slotTimesFor,
} from "../../lib/booking.js";
import { isSlotHeld } from "../../lib/bookings-store.js";

/**
 * Restituisce le regole di prenotazione e, se viene passata una data,
 * la disponibilità di ogni fascia oraria stanza per stanza.
 */
export default async (req: Request) => {
  const requestedDate = new URL(req.url).searchParams.get("date");

  const base = {
    sessionMinutes: SESSION_MINUTES,
    turnaroundMinutes: TURNAROUND_MINUTES,
    rooms: ROOMS,
    firstBookableDate: firstBookableDate(),
    firstOpenDate: firstOpenBookableDate(),
    lastBookableDate: lastBookableDate(),
    // Numerazione JavaScript dei giorni: 0 = domenica … 6 = sabato
    openWeekdays: OPEN_WEEKDAYS,
    lateWeekdays: LATE_WEEKDAYS,
    openingTime: "14:00",
    closingTime: "22:00",
    lateClosingTime: "00:00",
    openingHoursLabel: OPENING_HOURS_LABEL,
    depositCentsPerPerson: DEPOSIT_CENTS_PER_PERSON,
  };

  // Nessuna data: il frontend chiede solo le regole per impostare il calendario.
  if (!requestedDate) {
    return Response.json({ ...base, date: null, slots: [] });
  }

  const rejection = dateRejectionReason(requestedDate);
  if (rejection) {
    return Response.json({ ...base, date: requestedDate, slots: [], error: rejection }, { status: 400 });
  }

  const slotTimes = slotTimesFor(requestedDate);
  if (!isOpenDay(requestedDate) || !slotTimes.length) {
    return Response.json({
      ...base,
      date: requestedDate,
      dateLabel: formatDateIt(requestedDate),
      slots: [],
      closed: true,
    });
  }

  const taken: { slotTime: string; room: string }[] = [];
  try {
    const rows = await db
      .select({ slotTime: bookings.slotTime, room: bookings.room })
      .from(bookings)
      .where(
        and(
          eq(bookings.slotDate, requestedDate),
          inArray(
            bookings.room,
            ROOMS.map((room) => room.id),
          ),
          // Le prenotazioni non pagate e scadute non occupano più la fascia.
          isSlotHeld,
        ),
      );
    taken.push(...rows);
  } catch (error) {
    console.error("Errore lettura disponibilità", error);
    return Response.json(
      {
        ...base,
        date: requestedDate,
        slots: [],
        error: "Non riesco a leggere le disponibilità in questo momento. Riprova o scrivici su WhatsApp.",
      },
      { status: 503 },
    );
  }

  const takenKeys = new Set(taken.map((row) => `${row.slotTime}|${row.room}`));

  const slots = slotTimes.map((time) => {
    const past = isSlotInPast(requestedDate, time);
    const rooms: Record<string, boolean> = {};
    for (const room of ROOMS) {
      rooms[room.id] = !past && !takenKeys.has(`${time}|${room.id}`);
    }
    return {
      time,
      end: slotEndTime(time),
      past,
      rooms,
      available: Object.values(rooms).some(Boolean),
    };
  });

  return Response.json(
    {
      ...base,
      date: requestedDate,
      dateLabel: formatDateIt(requestedDate),
      dayClosingTime: closingTimeFor(requestedDate),
      slots,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const config: Config = {
  path: "/api/disponibilita",
  method: "GET",
};
