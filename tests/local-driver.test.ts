import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDriver } from "@/server/agent/llm";
import { sseData } from "@/server/agent/llm/local";
import { runAgent, type AgentEvent } from "@/server/agent/run";
import { closeDb, getDb, type Db } from "@/server/db/client";
import { createConversation, listMessages } from "@/server/conversations";

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
afterAll(closeDb);

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  // Split mid-line to exercise the buffering in sseData().
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** An OpenAI-compatible server (like Ollama) that answers with scripted streams. */
function fakeServer(responses: Response[]) {
  const bodies: { messages: { role: string; content: string | null; tool_call_id?: string }[]; tools: unknown[] }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

describe("sseData", () => {
  it("reassembles data lines split across chunks", async () => {
    const out: string[] = [];
    for await (const d of sseData(sse([{ a: 1 }, { b: "x\ny" }]).body!)) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":"x\\ny"}', "[DONE]"]);
  });
});

describe("LocalDriver in the agent loop", () => {
  it("streams text, runs streamed tool calls and sends tool results back", async () => {
    const { fetchImpl, bodies } = fakeServer([
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "search_knowledge", arguments: '{"query":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"pets on buses"}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } },
      ]),
      sse([
        { choices: [{ delta: { content: "Small pets travel for 5 EUR. " } }] },
        { choices: [{ delta: { content: "Large dogs only on trains." }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 1300, completion_tokens: 30 } },
      ]),
    ]);
    const { id } = await createConversation(db);
    const events: AgentEvent[] = [];
    for await (const e of runAgent({ db, conversationId: id, text: "Pets?", driver: new LocalDriver("http://local/v1", fetchImpl) })) events.push(e);

    const done = events.at(-1) as Extract<AgentEvent, { type: "done" }>;
    expect(done.metrics).toMatchObject({ steps: 2, costUsd: 0 });
    expect(done.metrics.usage).toMatchObject({ input: 2200, output: 50 });
    expect(done.meta.sources?.[0].slug).toBe("pets");

    // Second request carries the assistant tool call and the tool result.
    const second = bodies[1].messages;
    expect(second.at(-2)).toMatchObject({ role: "assistant" });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    expect(bodies[0].tools).toHaveLength(5);

    const messages = await listMessages(db, id);
    expect(messages.at(-1)?.content).toBe("Small pets travel for 5 EUR. Large dogs only on trains.");
  });

  it("hands off to a human when the local server is down", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const { id } = await createConversation(db);
    const events: AgentEvent[] = [];
    for await (const e of runAgent({ db, conversationId: id, text: "Hi", driver: new LocalDriver("http://local/v1", fetchImpl) })) events.push(e);
    expect(events.some((e) => e.type === "handoff")).toBe(true);
  });
});
