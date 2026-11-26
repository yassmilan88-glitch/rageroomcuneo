/**
 * Regole di prenotazione di Rage Room Cuneo.
 * Unica fonte di verità per giorni di apertura, orari, stanze, acconto e
 * validazioni: usata sia dall'API disponibilità che dall'API di prenotazione.
 */

/**
 * Ogni sessione dura 15 minuti, qualunque sia il pacchetto (i pacchetti
 * cambiano solo gli oggetti). Tra una fascia e l'altra restano 25 minuti per
 * vestizione, pulizia e ricarica della stanza, ed eventuali 5 minuti extra.
 */
export const SESSION_MINUTES = 15;
export const TURNAROUND_MINUTES = 25;
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

/** Apertura: sabato 19 dicembre 2026. Prima di questa data non si prenota. */
export const BOOKING_OPEN_DATE = "2026-12-19";

/**
 * Interruttore generale del sistema di prenotazione online.
 * Finché resta `false` il sito mostra solo la lista d'attesa e l'endpoint
 * di prenotazione rifiuta ogni richiesta. Passare a `true` quando si è
 * pronti ad aprire davvero le prenotazioni.
 */
export const BOOKING_LIVE = true;
/** Finestra di prenotazione: 90 giorni in avanti. */
export const BOOKING_WINDOW_DAYS = 90;

export const TIMEZONE = "Europe/Rome";

/**
 * Zona del locale mostrata nel sito e nelle email. L'indirizzo esatto non si
 * pubblica: lo comunichiamo ai clienti prima dell'apertura.
 */
export const VENUE_AREA = "Madonna dell'Olmo, Cuneo";
export const VENUE_ADDRESS_NOTE = "L'indirizzo esatto te lo comunichiamo prima dell'apertura.";

/**
 * Calendario delle feste. Basta modificare queste tre liste per cambiare
 * chiusure straordinarie, aperture extra e giornate con orario ridotto.
 * (23 e 30 dicembre e 6 gennaio sono mercoledì: già aperti di regola.)
 */
/** Giorni di chiusura straordinaria. */
export const CLOSED_DATES: string[] = [];
/** Giorni di apertura extra, fuori dai giorni normali (lunedì e martedì delle feste). */
export const EXTRA_OPEN_DATES = ["2026-12-28", "2026-12-29"];
/** Giorni a prezzo maggiorato: data → moltiplicatore del totale (Natale e Capodanno a prezzo doppio). */
export const PRICE_MULTIPLIERS: Record<string, number> = {
  "2026-12-24": 2,
  "2026-12-25": 2,
  "2026-12-31": 2,
  "2027-01-01": 2,
};

export function priceMultiplierFor(date: string): number {
  return PRICE_MULTIPLIERS[date] ?? 1;
}

/** Giornate con chiusura anticipata: data → orario di chiusura in minuti. */
export const EARLY_CLOSING: Record<string, number> = {
  "2026-12-24": 19 * 60,
  "2026-12-31": 19 * 60,
};

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
}

/** Le tre stanze fisiche: ognuna si prenota una volta per fascia oraria. */
export const ROOMS: Room[] = [
  { id: "singola", name: "Stanza Singola", minPeople: 1, maxPeople: 1 },
  { id: "doppia", name: "Stanza Doppia", minPeople: 1, maxPeople: 2 },
  { id: "festa", name: "Sala Festa", minPeople: 3, maxPeople: 5 },
];

export type PackageId = "base" | "plus" | "extreme";

export interface Package {
  id: PackageId;
  name: string;
  /** Durata della sessione in minuti (15 per tutti i pacchetti). */
  minutes: number;
  /** Prezzo a persona, in centesimi. */
  priceCents: number;
  /** Oggetti a persona: piccoli, medi, grandi. */
  small: number;
  medium: number;
  large: number;
  contents: string;
}

/** Pacchetti, prezzo a persona: stessa durata, cambiano gli oggetti da rompere (a persona). */
export const PACKAGES: Package[] = [
  { id: "base", name: "Base", minutes: SESSION_MINUTES, priceCents: 4000, small: 15, medium: 1, large: 0, contents: "15 oggetti piccoli + 1 medio" },
  { id: "plus", name: "Plus", minutes: SESSION_MINUTES, priceCents: 6000, small: 30, medium: 2, large: 0, contents: "30 oggetti piccoli + 2 medi" },
  { id: "extreme", name: "Extreme", minutes: SESSION_MINUTES, priceCents: 9000, small: 40, medium: 3, large: 2, contents: "40 oggetti piccoli + 3 medi + 2 grandi" },
];

/** Persone ammesse per prenotazione e stanze adatte, in ordine di preferenza. */
export const MAX_PEOPLE = 5;
export function candidateRoomsFor(people: number): RoomId[] {
  if (people === 1) return ["singola", "doppia"];
  if (people === 2) return ["doppia"];
  if (people >= 3 && people <= MAX_PEOPLE) return ["festa"];
  return [];
}

export const DEFAULT_PACKAGE: PackageId = "base";
/** In due si scalano 10 € dal totale (es. Base: 70 € invece di 80 €). */
export const COUPLE_DISCOUNT_CENTS = 1000;
/** Extra a tendina in prenotazione: minuti in più e oggetti grandi in più. */
export const EXTRA_MINUTES_OPTIONS = [0, 5, 10];
export const EXTRA_CENTS_PER_5_MINUTES = 1000;
export const EXTRA_BIG_MAX = 3;
export const EXTRA_BIG_CENTS = 2500;

export interface Extras {
  minutes: number;
  big: number;
}

export function isValidExtras(extras: Extras): boolean {
  return (
    EXTRA_MINUTES_OPTIONS.includes(extras.minutes) &&
    Number.isInteger(extras.big) &&
    extras.big >= 0 &&
    extras.big <= EXTRA_BIG_MAX
  );
}

export function extrasCents(extras: Extras): number {
  return (extras.minutes / 5) * EXTRA_CENTS_PER_5_MINUTES + extras.big * EXTRA_BIG_CENTS;
}

/** Descrizione breve degli extra, vuota se non ce ne sono. */
export function extrasLabel(extras: Extras): string {
  const parts: string[] = [];
  if (extras.minutes) parts.push(`+${extras.minutes} min`);
  if (extras.big) parts.push(`${extras.big} ${extras.big === 1 ? "oggetto grande" : "oggetti grandi"} in più`);
  return parts.join(" · ");
}

export function getPackage(packageId: string): Package | undefined {
  return PACKAGES.find((pkg) => pkg.id === packageId);
}

export const ROOM_IDS = ROOMS.map((room) => room.id);

export function getRoom(roomId: string): Room | undefined {
  return ROOMS.find((room) => room.id === roomId);
}

/** Acconto totale, in centesimi, per una prenotazione da `people` persone. */
export function depositCentsFor(people: number): number {
  return people * DEPOSIT_CENTS_PER_PERSON;
}

/**
 * Prezzo pieno della sessione, in centesimi: prezzo del pacchetto a persona,
 * con 10 € di sconto sul totale quando si è in due.
 */
export function priceCentsFor(packageId: string, people: number): number {
  const pkg = getPackage(packageId);
  if (!pkg || !Number.isInteger(people) || people < 1) return 0;
  return pkg.priceCents * people - (people === 2 ? COUPLE_DISCOUNT_CENTS : 0);
}

/** Totale della prenotazione: pacchetto per le persone, più gli extra, per il moltiplicatore del giorno. */
export function totalCentsFor(packageId: string, people: number, extras: Extras, date?: string): number {
  const base = priceCentsFor(packageId, people);
  if (!base) return 0;
  return (base + extrasCents(extras)) * (date ? priceMultiplierFor(date) : 1);
}

/** Importo come nel sito: €40, €145, oppure €12,50 se ci sono centesimi. */
export function formatEuro(cents: number): string {
  return cents % 100 ? `€${(cents / 100).toFixed(2).replace(".", ",")}` : `€${cents / 100}`;
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
  if (CLOSED_DATES.includes(date)) return false;
  if (EXTRA_OPEN_DATES.includes(date)) return true;
  return OPEN_WEEKDAYS.includes(weekdayOf(date));
}

/**
 * Orario di chiusura del giorno: chiusura anticipata nelle vigilie,
 * mezzanotte nel weekend, 22:00 negli altri giorni.
 */
export function closingMinutesFor(date: string): number {
  if (EARLY_CLOSING[date]) return EARLY_CLOSING[date];
  return LATE_WEEKDAYS.includes(weekdayOf(date)) ? LATE_CLOSING_MINUTES : CLOSING_MINUTES;
}

export function closingTimeFor(date: string): string {
  return toTime(closingMinutesFor(date));
}

/**
 * Tutti gli orari di inizio possibili nella giornata indicata.
 * Una fascia ogni 40 minuti (15 min di sessione + 25 min di cambio stanza).
 * Mer–Ven: 14:00 … 21:20. Sab–Dom: 14:00 … 23:20. Lun e Mar: nessuno.
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

/** Orario di fine della sessione che inizia a `time` (durata del pacchetto, se indicata). */
export function slotEndTime(time: string, minutes: number = SESSION_MINUTES): string {
  const start = minutesFromTime(time);
  if (start === null) return time;
  return toTime(start + minutes);
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
  if (CLOSED_DATES.includes(date)) {
    return "In questo giorno siamo chiusi per le feste. Scegli un'altra data.";
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

/** Avviso sulle feste mostrato nel sito e nelle email. */
export const HOLIDAY_HOURS_LABEL =
  "Feste: aperti anche lunedì 28 e martedì 29 dicembre · 24 e 31 dicembre fino alle 19:00 · 24, 25, 31 dicembre e 1° gennaio prezzo doppio";
