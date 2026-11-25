import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AnthropicDriver } from "@/server/agent/llm";
import { runAgent, type AgentEvent } from "@/server/agent/run";
import { closeDb, getDb, type Db } from "@/server/db/client";
import { agentRuns, conversations, toolCalls } from "@/server/db/schema";
import { createConversation, listMessages } from "@/server/conversations";
import { fakeClaude } from "./fake-claude";

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
afterAll(closeDb);

async function collect(gen: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("runAgent", () => {
  it("runs the tool loop, streams text and persists the trace", async () => {
    const { id } = await createConversation(db);
    const claude = fakeClaude([
      { tools: [{ name: "search_knowledge", input: { query: "dog on train" } }] },
      { text: "Yes. Large dogs travel on trains for 15 EUR with a muzzle and a lead.\n\nSource: Travelling with pets" },
    ]);

    const events = await collect(runAgent({ db, conversationId: id, text: "Can I take my dog?", driver: new AnthropicDriver(claude.client) }));

    expect(events.map((e) => e.type)).toEqual(["user_message", "tool_start", "tool_end", ...Array(events.length - 4).fill("text"), "done"]);
    const done = events.at(-1) as Extract<AgentEvent, { type: "done" }>;
    expect(done.metrics.steps).toBe(2);
    expect(done.metrics.usage.cacheRead).toBe(1800);
    expect(done.metrics.costUsd).toBeGreaterThan(0);
    expect(done.meta.sources?.[0].slug).toBe("pets");

    const messages = await listMessages(db, id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1].content).toContain("15 EUR");

    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.conversationId, id));
    expect(run).toMatchObject({ steps: 2, stopReason: "end_turn", error: null });
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.runId, run.id));
    expect(calls.map((c) => c.name)).toEqual(["search_knowledge"]);
  });

  it("sends the frozen system prompt with cache_control and today's date as a turn message", async () => {
    const { id } = await createConversation(db);
    const claude = fakeClaude([{ text: "Hello!" }]);
    await collect(runAgent({ db, conversationId: id, text: "Hi", driver: new AnthropicDriver(claude.client), now: new Date("2026-12-03T10:00:00Z") }));
    const request = claude.requests[0] as { system: { cache_control: unknown }[]; messages: { role: string; content: string }[]; output_config: unknown };
    expect(request.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(request.messages.at(-1)).toMatchObject({ role: "system" });
    expect(request.messages.at(-1)!.content).toContain("2026-12-03");
    expect(request.output_config).toEqual({ effort: "low" });
  });

  it("hands off to a human and then stays silent while the human owns the chat", async () => {
    const { id } = await createConversation(db);
    const claude = fakeClaude([
      { tools: [{ name: "handoff_to_human", input: { reason: "Customer asked for a person", urgency: "normal" } }] },
      { text: "I've asked a colleague to join. They'll reply here shortly." },
    ]);
    const first = await collect(runAgent({ db, conversationId: id, text: "I want to talk to a human", driver: new AnthropicDriver(claude.client) }));
    expect(first.some((e) => e.type === "handoff")).toBe(true);

    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row.status).toBe("needs_human");

    const second = await collect(runAgent({ db, conversationId: id, text: "Hello?", driver: new AnthropicDriver(claude.client) }));
    expect(second.map((e) => e.type)).toEqual(["user_message", "queued_for_human"]);
    expect(claude.calls()).toBe(2); // no model call for the second message
  });

  it("falls back to a human when there is no model available", async () => {
    const { id } = await createConversation(db);
    const events = await collect(runAgent({ db, conversationId: id, text: "Hi", driver: null }));
    expect(events.some((e) => e.type === "handoff")).toBe(true);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    expect(row.status).toBe("needs_human");
  });

  it("never leaves the customer without an answer when the model fails", async () => {
    const { id } = await createConversation(db);
    const claude = fakeClaude([]); // first call throws
    const events = await collect(runAgent({ db, conversationId: id, text: "Hi", driver: new AnthropicDriver(claude.client) }));
    const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toMatch(/human agent/);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.conversationId, id));
    expect(run.error).toMatch(/Unexpected model call/);
  });

  it("stops after max steps when the model keeps calling tools", async () => {
    const { id } = await createConversation(db);
    const loop = Array.from({ length: 6 }, () => ({ tools: [{ name: "search_knowledge", input: { query: "refund" } }] }));
    const claude = fakeClaude(loop);
    const events = await collect(runAgent({ db, conversationId: id, text: "refund?", driver: new AnthropicDriver(claude.client) }));
    const done = events.at(-1) as Extract<AgentEvent, { type: "done" }>;
    expect(done.metrics.steps).toBe(6);
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.conversationId, id));
    expect(run.error).toBe("Max agent steps reached");
  });
});
