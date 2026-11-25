/**
 * Runtime configuration. Everything comes from environment variables so the same build
 * runs locally (PGlite, no Docker) and in production (any Postgres via DATABASE_URL).
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

function readEffort(value: string | undefined): Effort {
  return EFFORTS.includes(value as Effort) ? (value as Effort) : "low";
}

export const config = {
  /** Claude model used by the support agent. */
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  /**
   * Thinking depth. Support chat is a latency-sensitive route where "low" holds quality,
   * so it is the default; raise it per deployment if evals show headroom.
   */
  effort: readEffort(process.env.ANTHROPIC_EFFORT),
  /** Max agent steps (model calls) per customer message. */
  maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 6),
  /** Postgres connection string. Empty means embedded PGlite in `.data/pglite`. */
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Directory for the embedded database. "memory://" keeps it in RAM (tests, evals). */
  pgliteDir: process.env.PGLITE_DIR ?? ".data/pglite",
  /** Business timezone used to tell the agent what "today" and "tomorrow" mean. */
  timezone: "Europe/Madrid",
  /** Shared secret for the operator console API. Empty means open (local demo). */
  operatorToken: process.env.OPERATOR_TOKEN ?? "",
} as const;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
