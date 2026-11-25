import type Anthropic from "@anthropic-ai/sdk";

/** One scripted model response: optional text, then optional tool calls. */
export interface ScriptedTurn {
  text?: string;
  tools?: { name: string; input: unknown }[];
  stopReason?: "end_turn" | "tool_use" | "refusal" | "max_tokens";
}

/**
 * Minimal stand-in for `client.beta.messages.stream()`: replays scripted turns as stream
 * events and a final message, and records every request so tests can assert on them.
 */
export function fakeClaude(turns: ScriptedTurn[]) {
  const requests: Record<string, unknown>[] = [];
  let call = 0;
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(structuredClone(params));
          const turn = turns[call++];
          if (!turn) throw new Error(`Unexpected model call #${call}`);
          const toolBlocks = (turn.tools ?? []).map((t, i) => ({ type: "tool_use", id: `toolu_${call}_${i}`, name: t.name, input: t.input }));
          const content = [...(turn.text ? [{ type: "text", text: turn.text }] : []), ...toolBlocks];
          const final = {
            id: `msg_${call}`,
            model: "claude-opus-5-5",
            role: "assistant",
            content,
            stop_reason: turn.stopReason ?? (toolBlocks.length ? "tool_use" : "end_turn"),
            usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
          };
          const events = turn.text
            ? turn.text.match(/[\s\S]{1,12}/g)!.map((chunk) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } }))
            : [];
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e;
            },
            finalMessage: async () => final,
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests, calls: () => call };
}
