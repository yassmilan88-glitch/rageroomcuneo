/**
 * Regole di prenotazione di Rage Room Cuneo.
 * Unica fonte di verità per giorni di apertura, orari, stanze, acconto e
 * validazioni: usata sia dall'API disponibilità che dall'API di prenotazione.
 */

/** Sessione di 20 minuti, 20 minuti di pausa per pulizia e ricarica stanza. */
export const SESSION_MINUTES = 20;
export const TURNAROUND_MINUTES = 20;
/** Una sessione parte ogni 40 minuti. */
export const SLOT_STEP_MINUTES = SESSION_MINUTES + TURNAROUND_MINUTES;

/** Apertura alle 14:00 in tutti i giorni lavorativi. */
export const OPENING_MINUTES = 14 * 60;
/** Chiusura alle 22:00 da mercoledì a venerdì. */
export const CLOSING_MINUTES = 22 * 60;
/** Chiusura a mezzanotte il sabato e la domenica. */
export const LATE_CLOSING_MINUTES = 24 * 60;

/**
 * Giorni di apertura, con la numerazione di `Date.getUTCDay()`
 * (0 = domenica … 6 = sabato): siamo aperti da mercoledì a domenica.
 */
export const OPEN_WEEKDAYS = [3, 4, 5, 6, 0];
/** Giorni con chiusura posticipata a mezzanotte: sabato e domenica. */
export const LATE_WEEKDAYS = [6, 0];

/** Le prenotazioni partono da sabato 3 ottobre 2026. */
export const BOOKING_OPEN_DATE = "2026-10-03";

/**
 * Interruttore generale del sistema di prenotazione online.
 * Finché resta `false` il sito mostra solo la lista d'attesa e l'endpoint
 * di prenotazione rifiuta ogni richiesta. Passare a `true` quando si è
 * pronti ad aprire davvero le prenotazioni.
 */
export const BOOKING_LIVE = false;
/** Finestra di prenotazione: 90 giorni in avanti. */
export const BOOKING_WINDOW_DAYS = 90;

export const TIMEZONE = "Europe/Rome";

/** Acconto online obbligatorio: 5 € a persona, il resto si salda in sede. */
export const DEPOSIT_CENTS_PER_PERSON = 500;
export const DEPOSIT_CURRENCY = "eur";
/** Quanto resta bloccata una fascia in attesa del pagamento dell'acconto. */
export const HOLD_MINUTES = 30;

export type RoomId = "singola" | "doppia" | "festa";

export interface Room {
  id: RoomId;
  name: string;
  minPeople: number;
  maxPeople: number;
  price: string;
}

export const ROOMS: Room[] = [
  { id: "singola", name: "Stanza Singola", minPeople: 1, maxPeople: 1, price: "€33" },
  { id: "doppia", name: "Stanza Doppia", minPeople: 1, maxPeople: 2, price: "€55" },
  { id: "festa", name: "Sala Festa", minPeople: 3, maxPeople: 5, price: "€28" },
];

export const ROOM_IDS = ROOMS.map((room) => room.id);

export function getRoom(roomId: string): Room | undefined {
  return ROOMS.find((room) => room.id === roomId);
}

/** Acconto totale, in centesimi, per una prenotazione da `people` persone. */
export function depositCentsFor(people: number): number {
  return people * DEPOSIT_CENTS_PER_PERSON;
}

/**
 * Prezzo pieno della sessione, in centesimi.
 * Singola e Doppia hanno un prezzo fisso; la Sala Festa è a persona.
 */
export function priceCentsFor(roomId: string, people: number): number {
  switch (roomId) {
    case "singola":
      return 3300;
    case "doppia":
      return 5500;
    case "festa":
      return 2800 * people;
    default:
      return 0;
  }
}

export function formatEuro(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function toTime(minutes: number): string {
  const normalized = minutes % (24 * 60);
  const hours = Math.floor(normalized / 60);
  return `${String(hours).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function minutesFromTime(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Giorno della settimana di una data `YYYY-MM-DD` (0 = domenica). */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function isOpenDay(date: string): boolean {
  return OPEN_WEEKDAYS.includes(weekdayOf(date));
}

/** Orario di chiusura del giorno: mezzanotte nel weekend, 22:00 negli altri giorni. */
export function closingMinutesFor(date: string): number {
  return LATE_WEEKDAYS.includes(weekdayOf(date)) ? LATE_CLOSING_MINUTES : CLOSING_MINUTES;
}

export function closingTimeFor(date: string): string {
  return toTime(closingMinutesFor(date));
}

/**
 * Tutti gli orari di inizio possibili nella giornata indicata.
 * Sessione di 20 minuti ogni 40 minuti (20 min sessione + 20 min pausa).
 * Mer–Ven: 14:00 … 21:40. Sab–Dom: 14:00 … 23:40. Lun e Mar: nessuno.
 */
export function slotTimesFor(date: string): string[] {
  if (!isOpenDay(date)) return [];
  const closing = closingMinutesFor(date);
  const slots: string[] = [];
  for (let start = OPENING_MINUTES; start + SESSION_MINUTES <= closing; start += SLOT_STEP_MINUTES) {
    slots.push(toTime(start));
  }
  return slots;
}

/** Orario di fine della sessione che inizia a `time`. */
export function slotEndTime(time: string): string {
  const start = minutesFromTime(time);
  if (start === null) return time;
  return toTime(start + SESSION_MINUTES);
}

/** Data e ora correnti nel fuso orario del locale, come stringhe confrontabili. */
export function nowInTimezone(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Primo giorno prenotabile: l'apertura, oppure oggi se l'apertura è già passata. */
export function firstBookableDate(today = nowInTimezone().date): string {
  return today > BOOKING_OPEN_DATE ? today : BOOKING_OPEN_DATE;
}

export function lastBookableDate(today = nowInTimezone().date): string {
  return addDays(firstBookableDate(today), BOOKING_WINDOW_DAYS);
}

/** Primo giorno prenotabile in cui siamo effettivamente aperti (per il calendario). */
export function firstOpenBookableDate(today = nowInTimezone().date): string {
  let date = firstBookableDate(today);
  for (let i = 0; i < 7 && !isOpenDay(date); i++) date = addDays(date, 1);
  return date;
}

/** Motivo per cui una data non è prenotabile, oppure `null` se va bene. */
export function dateRejectionReason(date: string): string | null {
  if (!isValidDate(date)) return "Data non valida.";
  const { date: today } = nowInTimezone();
  if (date < firstBookableDate(today)) {
    return `Le prenotazioni sono disponibili a partire dal ${formatDateIt(firstBookableDate(today))}.`;
  }
  if (date > lastBookableDate(today)) {
    return "Questa data è troppo lontana: puoi prenotare fino a 90 giorni in anticipo.";
  }
  if (!isOpenDay(date)) {
    return "Il lunedì e il martedì siamo chiusi. Siamo aperti dal mercoledì alla domenica.";
  }
  return null;
}

/** Una fascia è passata se è oggi e l'orario di inizio è già trascorso. */
export function isSlotInPast(date: string, time: string): boolean {
  const now = nowInTimezone();
  if (date > now.date) return false;
  if (date < now.date) return true;
  return time <= now.time;
}

const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

const WEEKDAYS_IT = [
  "domenica",
  "lunedì",
  "martedì",
  "mercoledì",
  "giovedì",
  "venerdì",
  "sabato",
];

export function formatDateIt(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS_IT[parsed.getUTCDay()];
  return `${weekday} ${parsed.getUTCDate()} ${MONTHS_IT[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

/** Riepilogo degli orari mostrato nel sito e nelle email. */
export const OPENING_HOURS_LABEL =
  "Mercoledì–venerdì 14:00–22:00 · Sabato e domenica 14:00–00:00 · Lunedì e martedì chiusi";
