import type { TokenUsage } from "../pricing";

/** A provider-neutral view of the conversation so far (earlier turns as plain text). */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultItem {
  id: string;
  content: string;
  isError: boolean;
}

export interface StepResult {
  model: string;
  /** Normalised to Anthropic's names: end_turn, tool_use, max_tokens, refusal, pause_turn. */
  stopReason: string | null;
  toolUses: ToolUse[];
  usage: TokenUsage;
  costUsd: number;
}

export type StepEvent = { type: "text"; delta: string } | { type: "result"; result: StepResult };

/** One agent turn against one model: call step() until there are no tool calls left. */
export interface AgentSession {
  step(signal?: AbortSignal): AsyncGenerator<StepEvent>;
  addToolResults(results: ToolResultItem[]): void;
}

export interface LlmDriver {
  provider: "anthropic" | "local";
  model: string;
  /** Starts a turn. `context` is per-turn information such as today's date. */
  start(history: HistoryMessage[], context: string): AgentSession;
  /** Human-readable error for the run record and the console. */
  describeError(error: unknown): string;
}
