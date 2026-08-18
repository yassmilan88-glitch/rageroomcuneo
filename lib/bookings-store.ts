/**
 * Accesso al database delle prenotazioni: regole di occupazione delle fasce e
 * conferma (con relative notifiche) una volta incassato l'acconto.
 */

import { and, count, eq, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bookings } from "../db/schema.js";
import { depositCentsFor, formatDateIt, getRoom, slotEndTime } from "./booking.js";
import { notifyBooking } from "./notify.js";

export type BookingRow = typeof bookings.$inferSelect;

/**
 * Una fascia è occupata se la prenotazione è confermata oppure se è ancora in
 * attesa dell'acconto entro il tempo di blocco. Le prenotazioni create prima
 * dell'introduzione dell'acconto non hanno scadenza (`hold_expires_at` nullo)
 * e restano valide per sempre.
 */
export const isSlotHeld = sql`(
  ${bookings.status} = 'confirmed'
  OR (${bookings.status} = 'pending' AND (${bookings.holdExpiresAt} IS NULL OR ${bookings.holdExpiresAt} > now()))
)`;

/** L'opposto: una riga che non blocca più la fascia e può essere sovrascritta. */
const isSlotReleased = sql`(
  ${bookings.status} = 'cancelled'
  OR (${bookings.status} = 'pending' AND ${bookings.holdExpiresAt} IS NOT NULL AND ${bookings.holdExpiresAt} <= now())
)`;

export interface NewBooking {
  slotDate: string;
  slotTime: string;
  room: string;
  people: number;
  name: string;
  phone: string;
  email: string;
  notes: string;
  status: string;
  depositCents: number;
  publicToken: string;
  holdExpiresAt: Date | null;
}

/**
 * Inserisce la prenotazione tenendo conto dell'indice univoco su
 * (giorno, orario, stanza). Se la fascia è occupata da una prenotazione scaduta
 * o annullata la rimpiazza; se è occupata davvero restituisce `null`.
 */
export async function claimSlot(values: NewBooking): Promise<BookingRow | null> {
  const [saved] = await db
    .insert(bookings)
    .values(values)
    .onConflictDoUpdate({
      target: [bookings.slotDate, bookings.slotTime, bookings.room],
      setWhere: isSlotReleased,
      set: {
        people: values.people,
        name: values.name,
        phone: values.phone,
        email: values.email,
        notes: values.notes,
        status: values.status,
        depositCents: values.depositCents,
        publicToken: values.publicToken,
        holdExpiresAt: values.holdExpiresAt,
        stripeSessionId: null,
        paidAt: null,
        notifiedAt: null,
      },
    })
    .returning();

  return saved ?? null;
}

export async function attachCheckoutSession(bookingId: number, sessionId: string): Promise<void> {
  await db.update(bookings).set({ stripeSessionId: sessionId }).where(eq(bookings.id, bookingId));
}

/** Libera la fascia quando il cliente non completa il pagamento. */
export async function releaseBooking(bookingId: number): Promise<void> {
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "pending")));
}

export async function findByCheckoutSession(sessionId: string): Promise<BookingRow | undefined> {
  const [row] = await db.select().from(bookings).where(eq(bookings.stripeSessionId, sessionId)).limit(1);
  return row;
}

export async function findById(bookingId: number): Promise<BookingRow | undefined> {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return row;
}

/** Promo di lancio: le prime 50 prenotazioni confermate ricevono il video POV con GoPro in omaggio. */
export const GOPRO_PROMO_LIMIT = 50;

/**
 * Posizione di questa prenotazione tra le confermate (1 = la prima in assoluto).
 * Contiamo solo le righe già confermate con id <= a questa, così l'ordine
 * riflette chi ha effettivamente pagato per primo, non l'ordine di tentativi.
 */
async function confirmedPosition(bookingId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bookings)
    .where(and(eq(bookings.status, "confirmed"), lte(bookings.id, bookingId)));
  return row?.n ?? 0;
}

export async function isGopromoEligible(bookingId: number): Promise<boolean> {
  const position = await confirmedPosition(bookingId);
  return position > 0 && position <= GOPRO_PROMO_LIMIT;
}

/**
 * L'importo salvato in `deposit_cents` è quello scelto dal cliente: acconto
 * (5 € a persona) oppure prezzo pieno. Non avendo una colonna dedicata,
 * lo deduciamo confrontandolo con l'acconto standard per quel numero di persone.
 */
function isFullPayment(row: BookingRow): boolean {
  return row.depositCents > depositCentsFor(row.people);
}

/** Vista pubblica di una prenotazione, quella che il sito mostra al cliente. */
export function publicView(row: BookingRow) {
  const room = getRoom(row.room);
  return {
    id: row.id,
    date: row.slotDate,
    dateLabel: formatDateIt(row.slotDate),
    time: row.slotTime,
    end: slotEndTime(row.slotTime),
    room: row.room,
    roomName: room?.name ?? row.room,
    people: row.people,
    status: row.status,
    depositCents: row.depositCents,
    isFullPayment: isFullPayment(row),
    paid: Boolean(row.paidAt),
  };
}

/** Come `publicView`, ma include se questa prenotazione ha diritto al video GoPro omaggio. */
export async function publicViewWithPromo(row: BookingRow) {
  const gopromo = row.status === "confirmed" ? await isGopromoEligible(row.id) : false;
  return { ...publicView(row), gopromo };
}

/**
 * Segna la prenotazione come confermata e manda le notifiche una sola volta.
 * È idempotente: Stripe può recapitare lo stesso evento più volte.
 */
export async function confirmAndNotify(
  row: BookingRow,
  options: { paid: boolean } = { paid: true },
): Promise<BookingRow> {
  const now = new Date();

  // `notified_at IS NULL` nel WHERE fa da lucchetto: solo la prima chiamata
  // ottiene la riga aggiornata, le successive non notificano di nuovo.
  const [claimed] = await db
    .update(bookings)
    .set({
      status: "confirmed",
      paidAt: options.paid ? (row.paidAt ?? now) : null,
      notifiedAt: now,
      holdExpiresAt: null,
    })
    .where(and(eq(bookings.id, row.id), sql`${bookings.notifiedAt} IS NULL`))
    .returning();

  if (!claimed) return (await findById(row.id)) ?? row;

  const view = publicView(claimed);
  const gopromo = await isGopromoEligible(claimed.id);
  await notifyBooking({
    id: claimed.id,
    name: claimed.name,
    phone: claimed.phone,
    email: claimed.email,
    notes: claimed.notes,
    roomName: view.roomName,
    people: claimed.people,
    dateLabel: view.dateLabel,
    time: view.time,
    end: view.end,
    depositCents: claimed.depositCents,
    isFullPayment: view.isFullPayment,
    gopromo,
    paid: options.paid,
  });

  return claimed;
}
