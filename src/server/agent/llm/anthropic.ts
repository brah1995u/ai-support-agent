import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config";
import { costUsd } from "../pricing";
import { SYSTEM_PROMPT } from "../prompt";
import { TOOL_DEFINITIONS } from "../tools";
import type { AgentSession, HistoryMessage, LlmDriver, StepEvent, ToolResultItem } from "./types";

/**
 * Claude through the official SDK. The system prompt and tools are frozen and marked for the
 * prompt cache; the per-turn context is an appended system message. Within a turn the
 * message list is append-only (assistant content, including thinking, is replayed verbatim).
 */
export class AnthropicDriver implements LlmDriver {
  readonly provider = "anthropic" as const;
  readonly model = config.model;

  constructor(private readonly client: Anthropic = new Anthropic()) {}

  start(history: HistoryMessage[], context: string): AgentSession {
    const client = this.client;
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    messages.push({ role: "system", content: context } as unknown as Anthropic.Beta.BetaMessageParam);

    return {
      async *step(signal?: AbortSignal): AsyncGenerator<StepEvent> {
        const stream = client.beta.messages.stream(
          {
            model: config.model,
            // Thinking counts toward max_tokens; replies are short, the headroom is for reasoning.
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: config.effort },
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            tools: TOOL_DEFINITIONS,
            messages,
          },
          { signal },
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", delta: event.delta.text };
          }
        }
        const message = await stream.finalMessage();
        const toolUses = message.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));
        if (message.stop_reason === "pause_turn" || (toolUses.length && message.stop_reason !== "max_tokens")) {
          messages.push({ role: "assistant", content: message.content });
        }
        const usage = {
          input: message.usage.input_tokens ?? 0,
          output: message.usage.output_tokens ?? 0,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
        };
        yield {
          type: "result",
          result: { model: message.model, stopReason: message.stop_reason, toolUses, usage, costUsd: costUsd(message.model, usage) },
        };
      },
      addToolResults(results: ToolResultItem[]) {
        messages.push({
          role: "user",
          content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
        });
      },
    };
  }

  describeError(error: unknown): string {
    if (error instanceof Anthropic.AuthenticationError) return "Invalid Anthropic API key";
    if (error instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API";
    if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status}: ${error.message}`;
    return (error as Error).message;
  }
}
