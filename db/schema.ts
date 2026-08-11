import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const bookings = pgTable(
  "bookings",
  {
    id: serial().primaryKey(),
    // Data della sessione in ora locale (Europe/Rome), formato YYYY-MM-DD
    slotDate: text("slot_date").notNull(),
    // Ora di inizio della sessione, formato HH:MM
    slotTime: text("slot_time").notNull(),
    // singola | doppia | festa
    room: text().notNull(),
    people: integer().notNull().default(1),
    name: text().notNull(),
    phone: text().notNull(),
    email: text().notNull(),
    notes: text().notNull().default(""),
    // pending = fascia bloccata in attesa dell'acconto | confirmed = acconto pagato
    // | cancelled = pagamento scaduto o annullato, la fascia torna libera
    status: text().notNull().default("pending"),
    // Acconto dovuto in centesimi (5 € a persona)
    depositCents: integer("deposit_cents").notNull().default(0),
    // Chiave casuale per rileggere la propria prenotazione dalla pagina di ritorno
    publicToken: text("public_token").notNull().default(""),
    // Sessione Stripe Checkout collegata all'acconto
    stripeSessionId: text("stripe_session_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Oltre questo istante una prenotazione ancora `pending` non blocca più la fascia
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    // Istante in cui sono partite email e WhatsApp: evita notifiche doppie
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    // Una sola prenotazione per stanza, per fascia oraria: blocca i doppioni a livello di database
    uniqueIndex("bookings_slot_room_unique").on(table.slotDate, table.slotTime, table.room),
    index("bookings_stripe_session_idx").on(table.stripeSessionId),
  ],
);

