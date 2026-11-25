import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { executeTool, type ToolContext } from "@/server/agent/tools";
import { closeDb, getDb, type Db } from "@/server/db/client";
import { conversations } from "@/server/db/schema";
import { createConversation } from "@/server/conversations";
import { addDays, madridToday } from "@/server/domain/timetable";

let db: Db;
let ctx: ToolContext;

beforeAll(async () => {
  db = await getDb();
  const conversation = await createConversation(db, "eval");
  ctx = { db, conversationId: conversation.id, now: new Date(), meta: {} };
});
afterAll(closeDb);

describe("get_booking", () => {
  it("returns the booking when code and email match, ignoring case and spaces", async () => {
    const result = await executeTool("get_booking", { code: " nb4k7q2 ", email: "Maria.Lopez@Example.com" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.ok && (result.data as { passenger_name: string }).passenger_name).toBe("Maria Lopez");
  });

  it("gives the same answer for a wrong email and an unknown code (no enumeration)", async () => {
    const wrongEmail = await executeTool("get_booking", { code: "NB4K7Q2", email: "someone@example.com" }, ctx);
    const unknownCode = await executeTool("get_booking", { code: "NB0000X", email: "maria.lopez@example.com" }, ctx);
    expect(wrongEmail).toEqual(unknownCode);
    expect(wrongEmail.ok).toBe(false);
  });
});

describe("search_trips", () => {
  it("returns trips and collects trip cards for the UI", async () => {
    const local: ToolContext = { ...ctx, meta: {} };
    const result = await executeTool("search_trips", { origin: "Madrid", destination: "Valencia", date: addDays(madridToday(), 3) }, local);
    expect(result.ok).toBe(true);
    expect(local.meta.trips?.length).toBeGreaterThan(0);
  });

  it("rejects past dates and invalid cities", async () => {
    const past = await executeTool("search_trips", { origin: "Madrid", destination: "Valencia", date: "2020-01-01" }, ctx);
    expect(past).toMatchObject({ ok: false });
    const invalid = await executeTool("search_trips", { origin: "Paris", destination: "Madrid", date: madridToday() }, ctx);
    expect(invalid).toMatchObject({ ok: false });
  });

  it("explains when there is no direct route", async () => {
    const result = await executeTool("search_trips", { origin: "Bilbao", destination: "Malaga", date: addDays(madridToday(), 1) }, ctx);
    expect(result.ok && (result.data as { direct_destinations_from_origin: string[] }).direct_destinations_from_origin).toEqual(["Madrid"]);
  });
});

describe("create_ticket and handoff_to_human", () => {
  it("creates a numbered ticket", async () => {
    const local: ToolContext = { ...ctx, meta: {} };
    const result = await executeTool(
      "create_ticket",
      { category: "refund", priority: "normal", summary: "Customer wants a refund for NB4K7Q2", booking_code: "nb4k7q2" },
      local,
    );
    expect(result.ok && (result.data as { ticket_number: string }).ticket_number).toMatch(/^T-\d{5}$/);
    expect(local.meta.ticketId).toBeTypeOf("number");
  });

  it("moves the conversation to the human queue", async () => {
    const local: ToolContext = { ...ctx, meta: {} };
    const result = await executeTool("handoff_to_human", { reason: "Customer asked for a person", urgency: "normal" }, local);
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, ctx.conversationId));
    expect(row.status).toBe("needs_human");
    expect(row.handoffReason).toBe("Customer asked for a person");
  });

  it("rejects unknown tools and invalid input without throwing", async () => {
    expect(await executeTool("drop_tables", {}, ctx)).toMatchObject({ ok: false });
    expect(await executeTool("create_ticket", { category: "refund" }, ctx)).toMatchObject({ ok: false });
  });
});
