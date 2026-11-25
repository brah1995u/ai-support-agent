/**
 * Eval runner: plays every case against the real agent (fresh in-memory database), applies
 * deterministic checks, then asks an LLM judge to grade groundedness, correctness, policy
 * and language. Writes evals/results/latest.{md,json}; `--save` also updates evals/REPORT.md.
 *
 *   npm run evals                 # all cases
 *   npm run evals -- refund       # cases whose id contains "refund"
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CASES, type EvalCase } from "./cases";

const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-opus-5-5";
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS ?? 0.85);

const Verdict = z.object({
  grounded: z.number().int().min(1).max(5).describe("5 = every fact comes from a tool result; 1 = invents prices, times or rules"),
  correct: z.number().int().min(1).max(5).describe("How well the reply meets the expectation"),
  policy: z.number().int().min(1).max(5).describe("Follows privacy, security, handoff and no-direct-action rules"),
  language_ok: z.boolean().describe("Replies in the customer's language"),
  pass: z.boolean().describe("true only if grounded >= 4, correct >= 4, policy >= 4 and language_ok"),
  reason: z.string().describe("One or two sentences explaining the main issue, or why it passes"),
});
type Verdict = z.infer<typeof Verdict>;

interface CaseResult {
  id: string;
  lang: string;
  pass: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
  verdict: Verdict | null;
  tools: string[];
  status: string;
  reply: string;
  latencyMs: number;
  costUsd: number;
}

async function main() {
  process.env.PGLITE_DIR = "memory://";
  // Imported after the env is set: config reads it at module load.
  const { getDb, closeDb } = await import("../src/server/db/client");
  const { runAgent } = await import("../src/server/agent/run");
  const { createConversation, getConversation } = await import("../src/server/conversations");
  const { toolCalls } = await import("../src/server/db/schema");
  const { SYSTEM_PROMPT } = await import("../src/server/agent/prompt");
  const { config, hasApiKey } = await import("../src/server/config");
  const { selectDriver } = await import("../src/server/agent/llm");

  const driver = await selectDriver();
  if (!driver) {
    console.log("Skipping evals: no model. Set ANTHROPIC_API_KEY, or run Ollama (LLM_PROVIDER=local).");
    return;
  }
  // The judge is Claude; without a key only the deterministic checks run.
  const judge = hasApiKey() && process.env.JUDGE !== "off" ? new Anthropic() : null;
  const db = await getDb();
  const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const cases = CASES.filter((c) => !filter || c.id.includes(filter));
  const agentLabel = driver.provider === "anthropic" ? `${driver.model} (effort ${config.effort})` : `local ${driver.model}`;
  const judgeLabel = judge ? JUDGE_MODEL : "off (deterministic checks only)";
  console.log(`Running ${cases.length} eval cases · agent ${agentLabel} · judge ${judgeLabel}\n`);

  async function runCase(c: EvalCase): Promise<CaseResult> {
    const { id: conversationId } = await createConversation(db, "eval");
    const transcript: string[] = [];
    let reply = "";
    let latencyMs = 0;
    let costUsd = 0;
    for (const turn of c.turns) {
      transcript.push(`CUSTOMER: ${turn}`);
      reply = "";
      for await (const event of runAgent({ db, conversationId, text: turn, driver })) {
        if (event.type === "text") reply += event.delta;
        if (event.type === "done") {
          latencyMs += event.metrics.latencyMs;
          costUsd += event.metrics.costUsd;
        }
      }
      transcript.push(`ASSISTANT: ${reply.trim()}`);
    }
    const calls = await db.select().from(toolCalls).where(eq(toolCalls.conversationId, conversationId));
    const tools = calls.map((t) => t.name);
    const status = (await getConversation(db, conversationId))?.status ?? "bot";
    const allReplies = transcript.filter((l) => l.startsWith("ASSISTANT:")).join("\n");

    const checks: CaseResult["checks"] = [];
    for (const t of c.mustCall ?? []) checks.push({ name: `calls ${t}`, ok: tools.includes(t) });
    for (const t of c.mustNotCall ?? []) checks.push({ name: `does not call ${t}`, ok: !tools.includes(t) });
    if (c.status) checks.push({ name: `status ${c.status}`, ok: status === c.status, detail: status });
    for (const re of c.mustMatch ?? []) checks.push({ name: `matches ${re}`, ok: re.test(allReplies) });
    for (const re of c.mustNotMatch ?? []) checks.push({ name: `avoids ${re}`, ok: !re.test(allReplies) });

    const toolLog = calls
      .map((t) => `TOOL ${t.name}(${JSON.stringify(t.input)}) -> ${JSON.stringify(t.output).slice(0, 1500)}`)
      .join("\n");
    let verdict: Verdict | null = null;
    if (judge) try {
      const response = await judge.messages.parse({
        model: JUDGE_MODEL,
        max_tokens: 2000,
        output_config: { format: zodOutputFormat(Verdict) },
        messages: [
          {
            role: "user",
            content: `You grade a customer-support AI agent. Judge only what the transcript and the tool results show.

<agent_rules>
${SYSTEM_PROMPT}
</agent_rules>

<expectation>
${c.expectation}
Customer language: ${c.lang}
</expectation>

<tool_calls>
${toolLog || "(none)"}
</tool_calls>

<transcript>
${transcript.join("\n\n")}
</transcript>

Score the agent's replies. A fact (price, time, fee, deadline, rule) that is not in a tool result counts against "grounded". Rules from the agent_rules (asking for the email, not cancelling directly, not repeating card numbers, handing off when needed) count for "policy".`,
          },
        ],
      });
      verdict = response.parsed_output;
    } catch (error) {
      checks.push({ name: "judge", ok: false, detail: (error as Error).message });
    }

    const pass = checks.every((k) => k.ok) && (judge ? (verdict?.pass ?? false) : true);
    return { id: c.id, lang: c.lang, pass, checks, verdict, tools, status, reply: allReplies, latencyMs, costUsd };
  }

  const results: CaseResult[] = [];
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const r = await runCase(c);
        results.push(r);
        const failed = r.checks.filter((k) => !k.ok).map((k) => k.name);
        console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(28)} ${r.lang}  ${(r.latencyMs / 1000).toFixed(1)}s  $${r.costUsd.toFixed(4)}  ${failed.join("; ")}${r.verdict && !r.verdict.pass ? `  judge: ${r.verdict.reason}` : ""}`);
      }
    }),
  );
  results.sort((a, b) => cases.findIndex((c) => c.id === a.id) - cases.findIndex((c) => c.id === b.id));

  const passed = results.filter((r) => r.pass).length;
  const rate = passed / results.length;
  const avg = (f: (r: CaseResult) => number) => results.reduce((s, r) => s + f(r), 0) / results.length;
  const summary = {
    date: new Date().toISOString(),
    model: agentLabel,
    effort: driver.provider === "anthropic" ? config.effort : null,
    judge: judgeLabel,
    cases: results.length,
    passed,
    passRate: Math.round(rate * 1000) / 10,
    avgLatencyMs: Math.round(avg((r) => r.latencyMs)),
    avgCostUsd: Math.round(avg((r) => r.costUsd) * 10000) / 10000,
    avgGrounded: Math.round(avg((r) => r.verdict?.grounded ?? 0) * 100) / 100,
    avgCorrect: Math.round(avg((r) => r.verdict?.correct ?? 0) * 100) / 100,
    avgPolicy: Math.round(avg((r) => r.verdict?.policy ?? 0) * 100) / 100,
  };

  const md = [
    `# Eval report`,
    ``,
    `${summary.date.slice(0, 10)} · agent \`${summary.model}\` · judge \`${summary.judge}\``,
    ``,
    `**${passed}/${results.length} passed (${summary.passRate}%)** · avg latency ${(summary.avgLatencyMs / 1000).toFixed(1)}s · avg cost $${summary.avgCostUsd} per case${judge ? ` · judge scores (1-5): grounded ${summary.avgGrounded}, correct ${summary.avgCorrect}, policy ${summary.avgPolicy}` : ""}`,
    ``,
    `| Case | Lang | Result | Tools | Grounded | Correct | Policy | Notes |`,
    `|---|---|---|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.lang} | ${r.pass ? "✅" : "❌"} | ${[...new Set(r.tools)].join(", ") || "—"} | ${r.verdict?.grounded ?? "—"} | ${r.verdict?.correct ?? "—"} | ${r.verdict?.policy ?? "—"} | ${[
          ...r.checks.filter((k) => !k.ok).map((k) => `failed: ${k.name}`),
          r.verdict && !r.verdict.pass ? r.verdict.reason : "",
        ]
          .filter(Boolean)
          .join("; ")
          .replaceAll("|", "\\|")} |`,
    ),
    ``,
  ].join("\n");

  const dir = path.join(process.cwd(), "evals", "results");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "latest.md"), md);
  await writeFile(path.join(dir, "latest.json"), JSON.stringify({ summary, results }, null, 2));
  if (process.argv.includes("--save")) await writeFile(path.join(process.cwd(), "evals", "REPORT.md"), md);

  console.log(`\n${passed}/${results.length} passed (${summary.passRate}%) · avg ${(summary.avgLatencyMs / 1000).toFixed(1)}s · $${summary.avgCostUsd}/case`);
  console.log(`Report: evals/results/latest.md`);
  await closeDb();
  if (rate < MIN_PASS_RATE) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
