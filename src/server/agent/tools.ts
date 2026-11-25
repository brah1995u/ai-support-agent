import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { bookings, conversations, tickets, type MessageMeta, type TicketCategory } from "../db/schema";
import { CITIES, destinationsFrom, getTrip, madridToday, searchTrips } from "../domain/timetable";
import { searchKnowledge } from "../rag/search";

export interface ToolContext {
  db: Db;
  conversationId: string;
  now: Date;
  /** Collected for the UI: sources, trip cards, ticket id. */
  meta: MessageMeta;
  /** Set when the agent hands the conversation to a human. */
  handoff?: { reason: string; urgency: string };
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

const TICKET_CATEGORIES = [
  "cancellation",
  "change",
  "refund",
  "compensation",
  "lost_item",
  "invoice",
  "payment",
  "accessibility",
  "complaint",
  "other",
] as const satisfies readonly TicketCategory[];

// ---- Input schemas (validated before a tool runs; the model's input is untrusted) ----

const SearchTripsInput = z.object({
  origin: z.enum(CITIES),
  destination: z.enum(CITIES),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const GetBookingInput = z.object({
  code: z.string().min(4).max(20),
  email: z.string().min(3).max(200),
});

const SearchKnowledgeInput = z.object({ query: z.string().min(2).max(300) });

const CreateTicketInput = z.object({
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  summary: z.string().min(10).max(1000),
  booking_code: z.string().max(20).nullable(),
});

const HandoffInput = z.object({
  reason: z.string().min(5).max(500),
  urgency: z.enum(["normal", "urgent"]),
});

// ---- Tool definitions sent to Claude (strict: inputs always match the schema) ----

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "search_trips",
    description:
      "Search Nimbus bus and train departures between two cities on one date. Returns trip ids, times, duration, Basic and Flex prices in EUR and seats left. Use it for any question about schedules, availability or prices.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", enum: [...CITIES], description: "Departure city" },
        destination: { type: "string", enum: [...CITIES], description: "Arrival city" },
        date: { type: "string", description: "Travel date as YYYY-MM-DD (Spanish local date)" },
      },
      required: ["origin", "destination", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "get_booking",
    description:
      "Look up a booking. Requires the booking code (like NB4K7Q2) and the email used for the booking; both must match. Returns the trip, fare, passengers, status and extras.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Booking code, e.g. NB4K7Q2" },
        email: { type: "string", description: "Email used for the booking" },
      },
      required: ["code", "email"],
      additionalProperties: false,
    },
  },
  {
    name: "search_knowledge",
    description:
      "Search the Nimbus help center (refunds, cancellations, changes, baggage, pets, children, accessibility, delays and compensation, payments, invoices, support hours). Write the query in English. Returns the most relevant passages with their document title.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short English search query, e.g. 'refund basic fare 3 days before'" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "create_ticket",
    description:
      "Open a ticket for the human support team when the customer needs an action you cannot do yourself (cancellation, change, refund, compensation, lost item, invoice, payment problem, complaint). Returns the ticket number to share with the customer.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...TICKET_CATEGORIES] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        summary: {
          type: "string",
          description: "What the customer needs, with the facts the team needs to act (booking code, dates, amounts). English.",
        },
        booking_code: { type: ["string", "null"], description: "Booking code if known, otherwise null" },
      },
      required: ["category", "priority", "summary", "booking_code"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description:
      "Pass the conversation to a human agent. Use it when the customer asks for a person, is upset, reports an urgent problem on the day of travel, or when you could not solve the problem after two attempts. After calling it, tell the customer what happens next.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One sentence for the human agent: what the customer needs and what was already tried" },
        urgency: { type: "string", enum: ["normal", "urgent"] },
      },
      required: ["reason", "urgency"],
      additionalProperties: false,
    },
  },
];

// ---- Executors ----

function madridHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(now));
}

async function runSearchTrips(input: z.infer<typeof SearchTripsInput>, ctx: ToolContext): Promise<ToolResult> {
  if (input.origin === input.destination) return { ok: false, error: "Origin and destination are the same city." };
  const today = madridToday(ctx.now);
  if (input.date < today) return { ok: false, error: `The date ${input.date} is in the past (today is ${today}).` };
  const trips = searchTrips(input.origin, input.destination, input.date);
  if (trips.length === 0) {
    return {
      ok: true,
      data: {
        trips: [],
        note: `Nimbus has no direct connection ${input.origin} - ${input.destination}.`,
        direct_destinations_from_origin: destinationsFrom(input.origin),
      },
    };
  }
  // Same-day searches hide departures that already left.
  const upcoming = input.date === today ? trips.filter((t) => new Date(t.departsAt) > ctx.now) : trips;
  ctx.meta.trips = upcoming.slice(0, 6);
  return {
    ok: true,
    data: {
      trips: upcoming.map((t) => ({
        id: t.id,
        mode: t.mode,
        departs: t.departsAt,
        arrives: t.arrivesAt,
        duration_minutes: t.durationMinutes,
        price_basic_eur: t.priceBasic,
        price_flex_eur: t.priceFlex,
        seats_left: t.seatsLeft,
      })),
      note: upcoming.length < trips.length ? "Departures that already left today are not listed." : undefined,
    },
  };
}

async function runGetBooking(input: z.infer<typeof GetBookingInput>, ctx: ToolContext): Promise<ToolResult> {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const email = input.email.trim().toLowerCase();
  const [booking] = await ctx.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.code, code), eq(sql`lower(${bookings.email})`, email)))
    .limit(1);
  // Same answer for "no such code" and "wrong email": don't confirm that a code exists.
  if (!booking) return { ok: false, error: "No booking matches this code and email. Ask the customer to check both." };
  const trip = getTrip(booking.tripId);
  const departs = trip ? new Date(trip.departsAt) : null;
  const hoursToDeparture = departs ? Math.round(((departs.getTime() - ctx.now.getTime()) / 3_600_000) * 10) / 10 : null;
  return {
    ok: true,
    data: {
      code: booking.code,
      passenger_name: booking.passengerName,
      passengers: booking.passengers,
      status: booking.status,
      fare: booking.fare,
      total_eur: booking.totalEur,
      extras: booking.extras,
      trip: trip
        ? { id: trip.id, mode: trip.mode, from: trip.origin, to: trip.destination, departs: trip.departsAt, arrives: trip.arrivesAt }
        : null,
      hours_until_departure: hoursToDeparture,
    },
  };
}

async function runSearchKnowledge(input: z.infer<typeof SearchKnowledgeInput>, ctx: ToolContext): Promise<ToolResult> {
  const hits = await searchKnowledge(ctx.db, input.query);
  const sources = ctx.meta.sources ?? [];
  for (const h of hits.slice(0, 2)) {
    if (!sources.some((s) => s.slug === h.slug && s.heading === h.heading)) {
      sources.push({ slug: h.slug, title: h.title, heading: h.heading });
    }
  }
  ctx.meta.sources = sources;
  return {
    ok: true,
    data: hits.length
      ? hits.map((h) => ({ document: h.title, section: h.heading, text: h.content }))
      : { note: "No matching help-center article." },
  };
}

async function runCreateTicket(input: z.infer<typeof CreateTicketInput>, ctx: ToolContext): Promise<ToolResult> {
  const [ticket] = await ctx.db
    .insert(tickets)
    .values({
      conversationId: ctx.conversationId,
      category: input.category,
      priority: input.priority,
      summary: input.summary,
      bookingCode: input.booking_code?.toUpperCase() ?? null,
    })
    .returning({ id: tickets.id });
  ctx.meta.ticketId = ticket.id;
  return { ok: true, data: { ticket_number: `T-${String(ticket.id).padStart(5, "0")}`, status: "open" } };
}

async function runHandoff(input: z.infer<typeof HandoffInput>, ctx: ToolContext): Promise<ToolResult> {
  await ctx.db
    .update(conversations)
    .set({ status: "needs_human", handoffReason: input.reason, updatedAt: new Date() })
    .where(eq(conversations.id, ctx.conversationId));
  ctx.handoff = input;
  const hour = madridHour(ctx.now);
  const staffed = hour >= 8 && hour < 22;
  return {
    ok: true,
    data: staffed
      ? { status: "queued", message: "A human agent has been notified and will join this chat shortly (usually within a few minutes)." }
      : {
          status: "after_hours",
          message: "Human agents work 08:00-22:00 Spanish time. The request is queued and a human will reply in this chat when the team starts.",
        },
  };
}

const EXECUTORS = {
  search_trips: { schema: SearchTripsInput, run: runSearchTrips },
  get_booking: { schema: GetBookingInput, run: runGetBooking },
  search_knowledge: { schema: SearchKnowledgeInput, run: runSearchKnowledge },
  create_ticket: { schema: CreateTicketInput, run: runCreateTicket },
  handoff_to_human: { schema: HandoffInput, run: runHandoff },
} as const;

export type ToolName = keyof typeof EXECUTORS;

export function isToolName(name: string): name is ToolName {
  return name in EXECUTORS;
}

/** Validates the model's input against the zod schema, then runs the tool. Never throws. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!isToolName(name)) return { ok: false, error: `Unknown tool ${name}` };
  const tool = EXECUTORS[name];
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  try {
    // Each executor narrows its own input type; the cast keeps the dispatch table simple.
    return await (tool.run as (i: unknown, c: ToolContext) => Promise<ToolResult>)(parsed.data, ctx);
  } catch (error) {
    console.error(`[tool:${name}]`, error);
    return { ok: false, error: "The tool failed unexpectedly. Apologise and offer a ticket or a human agent." };
  }
}
