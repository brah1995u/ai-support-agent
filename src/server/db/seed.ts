import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { chunkMarkdown } from "../rag/chunk";
import { embedPassages } from "../rag/embed";
import { addDays, madridToday, searchTrips, type City } from "../domain/timetable";
import { queryRows, type Db } from "./client";
import { bookings, kbChunks, type BookingStatus, type Fare } from "./schema";

export const KB_DIR = path.join(process.cwd(), "data", "kb");

/** Demo bookings documented in the README so anyone can try the booking lookup. */
export const DEMO_BOOKINGS: {
  code: string;
  email: string;
  passengerName: string;
  passengers: number;
  from: City;
  to: City;
  inDays: number;
  pick: number;
  fare: Fare;
  status: BookingStatus;
  extras: string[];
}[] = [
  { code: "NB4K7Q2", email: "maria.lopez@example.com", passengerName: "Maria Lopez", passengers: 1, from: "Madrid", to: "Valencia", inDays: 2, pick: 1, fare: "basic", status: "confirmed", extras: [] },
  { code: "NB9XT3M", email: "oleh.k@example.com", passengerName: "Oleh Kovalenko", passengers: 2, from: "Valencia", to: "Gandia", inDays: 1, pick: 3, fare: "flex", status: "confirmed", extras: ["small_pet"] },
  { code: "NB2HW8R", email: "james.p@example.org", passengerName: "James Parker", passengers: 1, from: "Madrid", to: "Barcelona", inDays: 9, pick: 0, fare: "flex", status: "confirmed", extras: ["extra_suitcase"] },
  { code: "NB7PL5D", email: "lucia.g@example.net", passengerName: "Lucia Garcia", passengers: 3, from: "Sevilla", to: "Malaga", inDays: -3, pick: 1, fare: "basic", status: "travelled", extras: [] },
  { code: "NB5ZN1C", email: "anna.s@example.com", passengerName: "Anna Shevchenko", passengers: 1, from: "Barcelona", to: "Valencia", inDays: 5, pick: 2, fare: "basic", status: "cancelled", extras: [] },
];

async function count(db: Db, table: "bookings" | "kb_chunks"): Promise<number> {
  const rows = await queryRows<{ n: number }>(db, sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return Number(rows[0]?.n ?? 0);
}

export async function seedBookings(db: Db): Promise<void> {
  if ((await count(db, "bookings")) > 0) return;
  const today = madridToday();
  const rows = DEMO_BOOKINGS.map((b) => {
    const trips = searchTrips(b.from, b.to, addDays(today, b.inDays));
    const trip = trips[Math.min(b.pick, trips.length - 1)];
    const unit = b.fare === "flex" ? trip.priceFlex : trip.priceBasic;
    return {
      code: b.code,
      email: b.email,
      passengerName: b.passengerName,
      passengers: b.passengers,
      tripId: trip.id,
      fare: b.fare,
      status: b.status,
      totalEur: Math.round(unit * b.passengers * 100) / 100,
      extras: b.extras,
    };
  });
  await db.insert(bookings).values(rows);
}

export async function seedKnowledgeBase(db: Db): Promise<void> {
  if ((await count(db, "kb_chunks")) > 0) return;
  const files = (await readdir(KB_DIR)).filter((f) => f.endsWith(".md")).sort();
  const chunks = (
    await Promise.all(
      files.map(async (file) => chunkMarkdown(file.replace(/\.md$/, ""), await readFile(path.join(KB_DIR, file), "utf8"))),
    )
  ).flat();
  const vectors = await embedPassages(chunks.map((c) => `${c.title}. ${c.heading}. ${c.content}`));
  await db.insert(kbChunks).values(chunks.map((c, i) => ({ ...c, embedding: vectors?.[i] ?? null })));
}

export async function seed(db: Db): Promise<void> {
  await seedBookings(db);
  await seedKnowledgeBase(db);
}
