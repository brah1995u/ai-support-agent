import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 384;

export type ConversationStatus = "bot" | "needs_human" | "human" | "closed";
export type MessageRole = "user" | "assistant" | "operator" | "event";
export type Channel = "web" | "mcp" | "eval";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  channel: text("channel").$type<Channel>().notNull().default("web"),
  status: text("status").$type<ConversationStatus>().notNull().default("bot"),
  title: text("title"),
  handoffReason: text("handoff_reason"),
  language: text("language"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface MessageMeta {
  /** Knowledge-base chunks the answer was grounded on. */
  sources?: { slug: string; title: string; heading: string }[];
  /** Trips returned by search_trips, rendered as cards in the widget. */
  trips?: TripView[];
  /** Ticket created during this turn. */
  ticketId?: number;
  /** Set on assistant messages: the agent run that produced it. */
  runId?: number;
}

export interface TripView {
  id: string;
  mode: "bus" | "train";
  origin: string;
  destination: string;
  departsAt: string;
  arrivesAt: string;
  durationMinutes: number;
  priceBasic: number;
  priceFlex: number;
  seatsLeft: number;
}

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").$type<MessageMeta>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.id)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    steps: integer("steps").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    firstTokenMs: integer("first_token_ms"),
    stopReason: text("stop_reason"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_runs_conversation_idx").on(t.conversationId)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull(),
    name: text("name").notNull(),
    input: jsonb("input").$type<unknown>().notNull(),
    output: jsonb("output").$type<unknown>().notNull(),
    isError: boolean("is_error").notNull().default(false),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tool_calls_run_idx").on(t.runId)],
);

export type BookingStatus = "confirmed" | "cancelled" | "travelled";
export type Fare = "basic" | "flex";

export const bookings = pgTable("bookings", {
  code: text("code").primaryKey(),
  email: text("email").notNull(),
  passengerName: text("passenger_name").notNull(),
  passengers: integer("passengers").notNull().default(1),
  tripId: text("trip_id").notNull(),
  fare: text("fare").$type<Fare>().notNull(),
  status: text("status").$type<BookingStatus>().notNull().default("confirmed"),
  totalEur: numeric("total_eur", { precision: 10, scale: 2, mode: "number" }).notNull(),
  extras: jsonb("extras").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketCategory =
  | "cancellation"
  | "change"
  | "refund"
  | "compensation"
  | "lost_item"
  | "invoice"
  | "payment"
  | "accessibility"
  | "complaint"
  | "other";

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  category: text("category").$type<TicketCategory>().notNull(),
  priority: text("priority").$type<"low" | "normal" | "high" | "urgent">().notNull(),
  summary: text("summary").notNull(),
  bookingCode: text("booking_code"),
  status: text("status").$type<"open" | "resolved">().notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kbChunks = pgTable("kb_chunks", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  heading: text("heading").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
});
