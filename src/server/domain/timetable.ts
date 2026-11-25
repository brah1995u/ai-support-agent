/**
 * Nimbus Travel timetable (fictional). Trips are computed deterministically from the route
 * table and the date, so the demo always has upcoming departures without a cron job.
 */
import type { TripView } from "../db/schema";

export const CITIES = [
  "Madrid",
  "Barcelona",
  "Valencia",
  "Sevilla",
  "Malaga",
  "Alicante",
  "Gandia",
  "Zaragoza",
  "Bilbao",
] as const;
export type City = (typeof CITIES)[number];

const CODES: Record<City, string> = {
  Madrid: "MAD",
  Barcelona: "BCN",
  Valencia: "VLC",
  Sevilla: "SVQ",
  Malaga: "AGP",
  Alicante: "ALC",
  Gandia: "GAN",
  Zaragoza: "ZAZ",
  Bilbao: "BIO",
};

interface Route {
  a: City;
  b: City;
  mode: "bus" | "train";
  minutes: number;
  basePrice: number;
  departures: string[];
}

const ROUTES: Route[] = [
  { a: "Madrid", b: "Valencia", mode: "train", minutes: 115, basePrice: 32, departures: ["07:10", "09:40", "13:15", "17:30", "20:45"] },
  { a: "Madrid", b: "Valencia", mode: "bus", minutes: 255, basePrice: 18, departures: ["08:00", "15:00", "23:30"] },
  { a: "Madrid", b: "Barcelona", mode: "train", minutes: 160, basePrice: 45, departures: ["06:30", "08:30", "11:00", "15:30", "19:00"] },
  { a: "Madrid", b: "Sevilla", mode: "train", minutes: 155, basePrice: 38, departures: ["07:00", "10:00", "14:00", "18:00"] },
  { a: "Madrid", b: "Malaga", mode: "train", minutes: 170, basePrice: 41, departures: ["08:05", "12:35", "17:05"] },
  { a: "Madrid", b: "Zaragoza", mode: "train", minutes: 80, basePrice: 26, departures: ["07:30", "12:30", "18:30"] },
  { a: "Madrid", b: "Bilbao", mode: "bus", minutes: 285, basePrice: 24, departures: ["09:00", "16:00", "00:30"] },
  { a: "Barcelona", b: "Valencia", mode: "train", minutes: 180, basePrice: 29, departures: ["07:45", "11:45", "16:45", "20:15"] },
  { a: "Barcelona", b: "Zaragoza", mode: "bus", minutes: 225, basePrice: 16, departures: ["08:15", "14:15", "19:15"] },
  { a: "Valencia", b: "Gandia", mode: "bus", minutes: 60, basePrice: 7, departures: ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"] },
  { a: "Valencia", b: "Alicante", mode: "train", minutes: 110, basePrice: 19, departures: ["08:20", "12:20", "16:20", "20:20"] },
  { a: "Gandia", b: "Alicante", mode: "bus", minutes: 95, basePrice: 11, departures: ["08:30", "13:30", "18:30"] },
  { a: "Sevilla", b: "Malaga", mode: "bus", minutes: 165, basePrice: 15, departures: ["09:30", "14:30", "19:30"] },
];

/** Small stable hash so seats and prices look varied but never change between calls. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Offset of Europe/Madrid for a given UTC instant, e.g. "+01:00". */
function madridOffset(utc: Date): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  })
    .formatToParts(utc)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = part?.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : "+01:00";
}

/** ISO timestamp for a local Madrid wall-clock time. */
export function madridIso(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  return `${date}T${time}:00${madridOffset(guess)}`;
}

export function addMinutes(iso: string, minutes: number): string {
  const d = new Date(new Date(iso).getTime() + minutes * 60_000);
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d); // "2026-11-26 10:25"
  const [day, hm] = local.split(" ");
  return madridIso(day, hm);
}

/** Today's date in Madrid as YYYY-MM-DD. */
export function madridToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function priceFor(route: Route, date: string, time: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 5 || weekday === 6 ? 1.15 : 1;
  const variance = 0.9 + (hash(`${route.a}${route.b}${date}${time}`) % 25) / 100;
  const basic = Math.round(route.basePrice * weekend * variance * 100) / 100;
  const flex = Math.round(basic * 1.35 * 100) / 100;
  return { basic, flex };
}

function buildTrip(route: Route, from: City, to: City, date: string, time: string): TripView {
  const departsAt = madridIso(date, time);
  const { basic, flex } = priceFor(route, date, time);
  const id = `${route.mode === "train" ? "T" : "B"}-${CODES[from]}-${CODES[to]}-${date.replaceAll("-", "")}-${time.replace(":", "")}`;
  return {
    id,
    mode: route.mode,
    origin: from,
    destination: to,
    departsAt,
    arrivesAt: addMinutes(departsAt, route.minutes),
    durationMinutes: route.minutes,
    priceBasic: basic,
    priceFlex: flex,
    seatsLeft: hash(id) % 41,
  };
}

/** All Nimbus trips between two cities on a date, sorted by departure. */
export function searchTrips(from: City, to: City, date: string): TripView[] {
  return ROUTES.filter((r) => (r.a === from && r.b === to) || (r.a === to && r.b === from))
    .flatMap((r) => r.departures.map((time) => buildTrip(r, from, to, date, time)))
    .sort((x, y) => x.departsAt.localeCompare(y.departsAt));
}

/** Rebuilds a trip from its id, e.g. "T-MAD-VLC-20261126-0710". */
export function getTrip(id: string): TripView | null {
  const m = id.match(/^([TB])-([A-Z]{3})-([A-Z]{3})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, modeCode, fromCode, toCode, y, mo, d, hh, mm] = m;
  const from = CITIES.find((c) => CODES[c] === fromCode);
  const to = CITIES.find((c) => CODES[c] === toCode);
  if (!from || !to) return null;
  const date = `${y}-${mo}-${d}`;
  const time = `${hh}:${mm}`;
  const mode = modeCode === "T" ? "train" : "bus";
  const route = ROUTES.find(
    (r) => r.mode === mode && ((r.a === from && r.b === to) || (r.a === to && r.b === from)) && r.departures.includes(time),
  );
  return route ? buildTrip(route, from, to, date, time) : null;
}

/** Cities that have a direct Nimbus connection from the given city. */
export function destinationsFrom(city: City): City[] {
  const set = new Set<City>();
  for (const r of ROUTES) {
    if (r.a === city) set.add(r.b);
    if (r.b === city) set.add(r.a);
  }
  return [...set].sort();
}
