import { SYSTEM_PROMPT } from "../prompt";
import { TOOL_DEFINITIONS } from "../tools";
import type { AgentSession, HistoryMessage, LlmDriver, StepEvent, ToolResultItem, ToolUse } from "./types";

/**
 * Open-weight models on the user's machine through an OpenAI-compatible endpoint (Ollama by
 * default; LM Studio and vLLM expose the same API). No key and no cost: the project runs
 * end to end on a laptop.
 */
export const LOCAL_URL = (process.env.LOCAL_LLM_URL ?? "http://localhost:11434/v1").replace(/\/$/, "");
export const LOCAL_MODEL = process.env.LOCAL_LLM_MODEL ?? "qwen2.5:7b";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface Chunk {
  model?: string;
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

const OPENAI_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

const STOP_REASONS: Record<string, string> = { tool_calls: "tool_use", stop: "end_turn", length: "max_tokens", content_filter: "refusal" };

/** Splits an SSE byte stream into the JSON payloads of its `data:` lines. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) yield trimmed.slice(5).trim();
    }
  }
  if (buffer.trim().startsWith("data:")) yield buffer.trim().slice(5).trim();
}

export class LocalDriver implements LlmDriver {
  readonly provider = "local" as const;
  readonly model = LOCAL_MODEL;

  constructor(
    private readonly baseUrl = LOCAL_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  start(history: HistoryMessage[], context: string): AgentSession {
    const { baseUrl, fetchImpl, model } = this;
    // Local models have no prompt cache to protect, so the turn context joins the system prompt.
    const messages: ChatMessage[] = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${context}` }, ...history];

    return {
      async *step(signal?: AbortSignal): AsyncGenerator<StepEvent> {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            tools: OPENAI_TOOLS,
            stream: true,
            stream_options: { include_usage: true },
            temperature: 0.2,
          }),
          signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Local model error ${response.status}: ${(await response.text()).slice(0, 300)}`);
        }

        let text = "";
        let finish: string | null = null;
        let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        const calls = new Map<number, { id: string; name: string; args: string }>();

        for await (const data of sseData(response.body)) {
          if (data === "[DONE]") break;
          const chunk = JSON.parse(data) as Chunk;
          if (chunk.usage) usage = { ...usage, input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.delta?.content) {
            text += choice.delta.content;
            yield { type: "text", delta: choice.delta.content };
          }
          for (const [i, call] of (choice.delta?.tool_calls ?? []).entries()) {
            const index = call.index ?? i;
            const entry = calls.get(index) ?? { id: call.id ?? `call_${index}_${Date.now()}`, name: "", args: "" };
            if (call.id) entry.id = call.id;
            if (call.function?.name) entry.name += call.function.name;
            if (call.function?.arguments) entry.args += call.function.arguments;
            calls.set(index, entry);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }

        const toolUses: ToolUse[] = [...calls.values()].map((c) => {
          let input: unknown;
          try {
            input = c.args ? JSON.parse(c.args) : {};
          } catch {
            input = { unparseable_arguments: c.args };
          }
          return { id: c.id, name: c.name, input };
        });
        if (toolUses.length) {
          messages.push({
            role: "assistant",
            content: text || null,
            tool_calls: [...calls.values()].map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
          });
        }
        const stopReason = toolUses.length ? "tool_use" : (STOP_REASONS[finish ?? "stop"] ?? "end_turn");
        yield { type: "result", result: { model, stopReason, toolUses, usage, costUsd: 0 } };
      },
      addToolResults(results: ToolResultItem[]) {
        for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
      },
    };
  }

  describeError(error: unknown): string {
    const message = (error as Error).message ?? String(error);
    return /fetch failed|ECONNREFUSED/i.test(message) ? `Local model not reachable at ${this.baseUrl}` : message;
  }
}

/** Is an OpenAI-compatible server answering? Cached briefly so every message doesn't probe. */
let probe: { at: number; ok: boolean } | null = null;
export async function localAvailable(): Promise<boolean> {
  if (probe && Date.now() - probe.at < 30_000) return probe.ok;
  let ok = false;
  try {
    const res = await fetch(`${LOCAL_URL}/models`, { signal: AbortSignal.timeout(800) });
    ok = res.ok;
  } catch {
    ok = false;
  }
  probe = { at: Date.now(), ok };
  return ok;
}
