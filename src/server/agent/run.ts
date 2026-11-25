import { eq } from "drizzle-orm";
import { config } from "../config";
import type { Db } from "../db/client";
import { agentRuns, conversations, toolCalls, type MessageMeta } from "../db/schema";
import { addMessage, getConversation, listMessages, setStatus } from "../conversations";
import { selectDriver, type LlmDriver } from "./llm";
import type { HistoryMessage, StepResult } from "./llm/types";
import type { TokenUsage } from "./pricing";
import { turnContext } from "./prompt";
import { executeTool, type ToolContext } from "./tools";

/** Events streamed to the chat widget (and consumed by evals). */
export type AgentEvent =
  | { type: "user_message"; id: number }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean; durationMs: number }
  | { type: "handoff"; reason: string }
  | { type: "queued_for_human" }
  | {
      type: "done";
      messageId: number;
      runId: number;
      meta: MessageMeta;
      metrics: { latencyMs: number; firstTokenMs: number | null; steps: number; costUsd: number; usage: TokenUsage };
    }
  | { type: "error"; message: string };

const OFFLINE_REPLY =
  "Sorry, the AI assistant is offline right now. I have passed your message to our human team and someone will reply in this chat.";

/**
 * Rebuilds the model-facing history from the stored transcript. Earlier turns are sent as
 * text only (their tool calls and thinking blocks are dropped as a whole, which keeps the
 * request small and is always valid); within the current turn the driver appends the full
 * assistant content, append-only.
 */
async function buildHistory(db: Db, conversationId: string): Promise<HistoryMessage[]> {
  const rows = await listMessages(db, conversationId);
  const history: HistoryMessage[] = [];
  for (const m of rows) {
    if (m.role === "user") history.push({ role: "user", content: m.content });
    else if (m.role === "assistant") history.push({ role: "assistant", content: m.content });
    else if (m.role === "operator") history.push({ role: "assistant", content: `[Human agent] ${m.content}` });
  }
  // The API needs a user message first; drop a leading assistant greeting if any.
  while (history.length && history[0].role !== "user") history.shift();
  return history;
}

function toolResultContent(result: Awaited<ReturnType<typeof executeTool>>): string {
  return JSON.stringify(result.ok ? result.data : { error: result.error });
}

export interface RunOptions {
  db: Db;
  conversationId: string;
  text: string;
  now?: Date;
  signal?: AbortSignal;
  /** Injected in tests; defaults to Claude with a key, else a local model, else offline. */
  driver?: LlmDriver | null;
}

/**
 * One customer message -> one agent run. Streams text deltas and tool activity, runs the
 * tool loop (bounded by config.maxSteps), and persists the transcript, tool trace, token
 * usage, cost and latency so the operator console and evals can inspect every decision.
 */
export async function* runAgent({ db, conversationId, text, now = new Date(), signal, driver: injected }: RunOptions): AsyncGenerator<AgentEvent> {
  const conversation = await getConversation(db, conversationId);
  if (!conversation) {
    yield { type: "error", message: "Conversation not found" };
    return;
  }

  const userMessage = await addMessage(db, conversationId, "user", text);
  yield { type: "user_message", id: userMessage.id };
  if (!conversation.title) {
    await db.update(conversations).set({ title: text.slice(0, 80) }).where(eq(conversations.id, conversationId));
  }

  // A human owns the conversation: the bot stays silent and the operator sees the message.
  if (conversation.status !== "bot") {
    if (conversation.status === "closed") await setStatus(db, conversationId, "needs_human", "Customer wrote after the conversation was closed");
    yield { type: "queued_for_human" };
    return;
  }

  const started = Date.now();
  const llm = injected === undefined ? await selectDriver() : injected;
  const [run] = await db.insert(agentRuns).values({ conversationId, model: llm?.model ?? config.model }).returning();

  if (!llm) {
    await setStatus(db, conversationId, "needs_human", "AI assistant offline (no model configured)");
    const reply = await addMessage(db, conversationId, "assistant", OFFLINE_REPLY, { runId: run.id });
    await db.update(agentRuns).set({ error: "missing_api_key", latencyMs: Date.now() - started }).where(eq(agentRuns.id, run.id));
    yield { type: "text", delta: OFFLINE_REPLY };
    yield { type: "handoff", reason: "AI assistant offline" };
    yield {
      type: "done",
      messageId: reply.id,
      runId: run.id,
      meta: {},
      metrics: { latencyMs: Date.now() - started, firstTokenMs: null, steps: 0, costUsd: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    };
    return;
  }

  const ctx: ToolContext = { db, conversationId, now, meta: { runId: run.id } };
  const session = llm.start(await buildHistory(db, conversationId), turnContext(now));

  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  let firstTokenMs: number | null = null;
  let steps = 0;
  let stopReason: string | null = null;
  let spoken = "";
  let errorMessage: string | null = null;

  try {
    while (steps < config.maxSteps) {
      steps++;
      let stepText = "";
      let stepResult: StepResult | null = null;
      for await (const event of session.step(signal)) {
        if (event.type === "result") {
          stepResult = event.result;
          continue;
        }
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
        // Separate the text of consecutive steps ("Let me check..." + the answer).
        const delta = stepText === "" && spoken !== "" && !spoken.endsWith("\n") ? `\n\n${event.delta}` : event.delta;
        stepText += event.delta;
        spoken += delta;
        yield { type: "text", delta };
      }
      if (!stepResult) throw new Error("Model stream ended without a result");

      usage.input += stepResult.usage.input;
      usage.output += stepResult.usage.output;
      usage.cacheRead += stepResult.usage.cacheRead;
      usage.cacheWrite += stepResult.usage.cacheWrite;
      cost += stepResult.costUsd;
      stopReason = stepResult.stopReason;

      if (stepResult.stopReason === "refusal") break;
      if (stepResult.stopReason === "pause_turn") continue;

      const toolUses = stepResult.toolUses;
      if (toolUses.length === 0) break;
      if (stepResult.stopReason === "max_tokens") {
        errorMessage = "Tool input truncated at max_tokens";
        break;
      }

      for (const use of toolUses) yield { type: "tool_start", id: use.id, name: use.name, input: use.input };

      // Independent tools run in parallel; all results go back in one user message.
      const results = await Promise.all(
        toolUses.map(async (use) => {
          const t0 = Date.now();
          const result = await executeTool(use.name, use.input, ctx);
          const durationMs = Date.now() - t0;
          await db.insert(toolCalls).values({
            runId: run.id,
            conversationId,
            name: use.name,
            input: use.input as object,
            output: (result.ok ? result.data : { error: result.error }) as object,
            isError: !result.ok,
            durationMs,
          });
          return { use, result, durationMs };
        }),
      );
      for (const { use, result, durationMs } of results) {
        yield { type: "tool_end", id: use.id, name: use.name, ok: result.ok, durationMs };
      }
      if (ctx.handoff) yield { type: "handoff", reason: ctx.handoff.reason };

      session.addToolResults(results.map(({ use, result }) => ({ id: use.id, content: toolResultContent(result), isError: !result.ok })));
    }
    if (steps >= config.maxSteps && stopReason === "tool_use") errorMessage = "Max agent steps reached";
    // With server-side fallbacks a refusal here means every model in the chain declined.
    if (stopReason === "refusal") errorMessage = "Model refused the request";
  } catch (error) {
    errorMessage = signal?.aborted ? "Client disconnected" : llm.describeError(error);
    console.error("[agent]", errorMessage);
  }

  // Never leave the customer without an answer: fall back to a human.
  if (!spoken.trim() || (errorMessage && !ctx.handoff)) {
    const fallback = spoken.trim()
      ? "\n\nSorry, something went wrong on my side. I have asked a human agent to continue this conversation."
      : stopReason === "refusal"
        ? "I can't help with that request here. I have passed the conversation to a human agent."
        : "Sorry, something went wrong on my side. I have asked a human agent to continue this conversation.";
    spoken += fallback;
    yield { type: "text", delta: fallback };
    if (!ctx.handoff) {
      await setStatus(db, conversationId, "needs_human", errorMessage ?? stopReason ?? "Agent produced no answer");
      yield { type: "handoff", reason: errorMessage ?? "Agent produced no answer" };
    }
  }

  const latencyMs = Date.now() - started;
  const reply = await addMessage(db, conversationId, "assistant", spoken.trim(), ctx.meta);
  await db
    .update(agentRuns)
    .set({
      steps,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
      costUsd: cost,
      latencyMs,
      firstTokenMs,
      stopReason,
      error: errorMessage,
    })
    .where(eq(agentRuns.id, run.id));

  yield {
    type: "done",
    messageId: reply.id,
    runId: run.id,
    meta: ctx.meta,
    metrics: { latencyMs, firstTokenMs, steps, costUsd: cost, usage },
  };
}
