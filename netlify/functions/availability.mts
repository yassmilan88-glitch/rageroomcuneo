import type { Config } from "@netlify/functions";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";
import {
  MAX_PEOPLE,
  PACKAGES,
  addDays,
  isValidDate,
  CLOSED_DATES,
  DEPOSIT_CENTS_PER_PERSON,
  EARLY_CLOSING,
  EXTRA_OPEN_DATES,
  HOLIDAY_HOURS_LABEL,
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
  const params = new URL(req.url).searchParams;
  const requestedDate = params.get("date");
  const from = params.get("from");
  const to = params.get("to");

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
    // Feste: chiusure straordinarie e aperture extra, per disegnare il calendario.
    closedDates: CLOSED_DATES,
    extraOpenDates: EXTRA_OPEN_DATES,
    earlyClosingDates: Object.keys(EARLY_CLOSING),
    holidayHoursLabel: HOLIDAY_HOURS_LABEL,
    openingTime: "14:00",
    closingTime: "22:00",
    lateClosingTime: "00:00",
    openingHoursLabel: OPENING_HOURS_LABEL,
    depositCentsPerPerson: DEPOSIT_CENTS_PER_PERSON,
    packages: PACKAGES,
    maxPeople: MAX_PEOPLE,
  };

  // Intervallo di giorni: quante fasce restano libere per stanza, giorno per giorno.
  if (from && to) {
    if (!isValidDate(from) || !isValidDate(to) || to < from || addDays(from, 45) < to) {
      return Response.json({ ...base, error: "Intervallo non valido." }, { status: 400 });
    }
    const rows: { slotDate: string; slotTime: string; room: string }[] = [];
    try {
      rows.push(
        ...(await db
          .select({ slotDate: bookings.slotDate, slotTime: bookings.slotTime, room: bookings.room })
          .from(bookings)
          .where(and(gte(bookings.slotDate, from), lte(bookings.slotDate, to), isSlotHeld))),
      );
    } catch (error) {
      console.error("Errore lettura disponibilità del mese", error);
      return Response.json({ ...base, error: "Disponibilità non leggibile ora." }, { status: 503 });
    }
    const taken = new Set(rows.map((row) => `${row.slotDate}|${row.slotTime}|${row.room}`));
    const days: Record<string, { slots: number; free: Record<string, number> }> = {};
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (dateRejectionReason(day)) continue;
      const times = slotTimesFor(day).filter((time) => !isSlotInPast(day, time));
      const free: Record<string, number> = {};
      for (const room of ROOMS) free[room.id] = times.filter((time) => !taken.has(`${day}|${time}|${room.id}`)).length;
      days[day] = { slots: slotTimesFor(day).length, free };
    }
    return Response.json({ ...base, from, to, days }, { headers: { "Cache-Control": "no-store" } });
  }

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
