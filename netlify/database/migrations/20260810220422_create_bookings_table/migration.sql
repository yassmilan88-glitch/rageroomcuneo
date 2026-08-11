CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY,
	"slot_date" text NOT NULL,
	"slot_time" text NOT NULL,
	"room" text NOT NULL,
	"people" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_slot_room_unique" ON "bookings" ("slot_date","slot_time","room");