"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Markdown } from "../markdown";
import { AlertIcon, ArrowRightIcon, CheckIcon, PersonIcon, SendIcon, SparkIcon, TicketIcon } from "../icons";
import { TripCards } from "../chat/trip-cards";
import type { ConversationStatus, MessageMeta, MessageRole } from "@/server/db/schema";

interface ListItem {
  id: string;
  channel: string;
  status: ConversationStatus;
  title: string | null;
  handoff_reason: string | null;
  updated_at: string;
  message_count: number;
  last_message: string | null;
  last_role: MessageRole | null;
  cost_usd: number;
}

interface Metrics {
  conversations: number;
  needs_human: number;
  handed_off: number;
  runs: number;
  avg_latency_ms: number | null;
  p90_latency_ms: number | null;
  avg_first_token_ms: number | null;
  total_cost_usd: number | null;
  avg_cost_usd: number | null;
  tool_calls: number;
  tool_errors: number;
  tickets: number;
  cache_read_tokens: number;
  input_tokens: number;
}

interface Detail {
  conversation: { id: string; status: ConversationStatus; title: string | null; handoffReason: string | null; channel: string; createdAt: string };
  messages: { id: number; role: MessageRole; content: string; meta: MessageMeta; createdAt: string }[];
  runs: {
    id: number;
    model: string;
    steps: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    latencyMs: number;
    firstTokenMs: number | null;
    stopReason: string | null;
    error: string | null;
    createdAt: string;
    toolCalls: { id: number; name: string; input: unknown; output: unknown; isError: boolean; durationMs: number }[];
  }[];
  tickets: { id: number; category: string; priority: string; summary: string; bookingCode: string | null; status: string; createdAt: string }[];
}

const FILTERS: { key: "all" | ConversationStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_human", label: "Needs human" },
  { key: "human", label: "With agent" },
  { key: "bot", label: "AI" },
  { key: "closed", label: "Closed" },
];

const STATUS_STYLE: Record<ConversationStatus, string> = {
  needs_human: "bg-warn-soft text-warn",
  human: "bg-brand-soft text-brand-strong",
  bot: "bg-success-soft text-success",
  closed: "bg-surface-2 text-ink-faint",
};
const STATUS_LABEL: Record<ConversationStatus, string> = { needs_human: "Needs human", human: "With agent", bot: "AI", closed: "Closed" };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const usd = (v: number | null | undefined) => (v == null ? "—" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold tabular-nums ${tone === "warn" ? "text-warn" : "text-ink"}`}>{value}</div>
      {hint ? <div className="text-[11px] text-ink-faint">{hint}</div> : null}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="scroll-thin max-h-56 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Console() {
  const [items, setItems] = useState<ListItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [agent, setAgent] = useState<{ model: string; effort: string | null; online: boolean; provider: "anthropic" | "local" | null } | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [authError, setAuthError] = useState(false);
  const [openCall, setOpenCall] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState<"queue" | "chat" | "trace">("queue");

  const loadList = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (res.status === 401) return setAuthError(true);
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.conversations);
    setMetrics(data.metrics);
    setAgent(data.agent);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, []);

  // Deep link: /dashboard?c=<conversation id> opens that conversation.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (!id) return;
    const t = setTimeout(() => {
      setSelected(id);
      setMobileTab("chat");
      void loadDetail(id);
    }, 0);
    return () => clearTimeout(t);
  }, [loadDetail]);

  // Polling: the first tick runs right away, then every few seconds.
  useEffect(() => {
    const first = setTimeout(() => void loadList(), 0);
    const t = setInterval(() => void loadList(), 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    const t = setInterval(() => void loadDetail(selected), 2000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  const act = async (action: "takeover" | "release" | "close" | "reply", text?: string) => {
    if (!selected) return;
    await fetch(`/api/conversations/${selected}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, text }),
    });
    if (action === "reply") setReply("");
    await Promise.all([loadDetail(selected), loadList()]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && reply.trim()) {
      e.preventDefault();
      void act("reply", reply.trim());
    }
  };

  const visible = useMemo(() => items.filter((i) => filter === "all" || i.status === filter), [items, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  const handoffRate = metrics && metrics.conversations ? Math.round((metrics.handed_off / metrics.conversations) * 100) : 0;
  const cacheRate =
    metrics && metrics.input_tokens + metrics.cache_read_tokens > 0
      ? Math.round((metrics.cache_read_tokens / (metrics.input_tokens + metrics.cache_read_tokens)) * 100)
      : 0;
  const status = detail?.conversation.status;

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-6">
          <AlertIcon className="mx-auto text-warn" width={24} height={24} />
          <h1 className="mt-3 text-[16px] font-semibold">Operator access required</h1>
          <p className="mt-2 text-[13px] text-ink-soft">This deployment sets OPERATOR_TOKEN. Open /dashboard?token=… with the operator token.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-[13px] font-bold text-white">N</div>
        <div className="mr-auto">
          <div className="text-[14px] font-semibold leading-tight">Nimbus Console</div>
          <div className="text-[11px] text-ink-faint">Support operations · demo data</div>
        </div>
        {agent ? (
          <span
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${agent.online ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
            title={agent.online ? (agent.provider === "local" ? "Local open-weight model (OpenAI-compatible server)" : "Claude via the Anthropic API") : "No model: set ANTHROPIC_API_KEY or run Ollama. Every message goes to a human."}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${agent.online ? "bg-success" : "bg-danger"}`} />
            {agent.online ? `${agent.provider === "local" ? "local · " : ""}${agent.model}${agent.effort ? ` · effort ${agent.effort}` : ""}` : "AI offline (no model)"}
          </span>
        ) : null}
        <Link href="/" className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft hover:text-ink">
          Customer site <ArrowRightIcon width={12} height={12} />
        </Link>
      </header>

      <div className="scroll-thin hidden shrink-0 grid-cols-2 gap-2 border-b border-line bg-bg px-4 py-3 sm:grid md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Conversations · 7d" value={String(metrics?.conversations ?? 0)} hint={`${metrics?.runs ?? 0} agent turns`} />
        <Metric label="Waiting for human" value={String(metrics?.needs_human ?? 0)} tone={metrics?.needs_human ? "warn" : undefined} hint={`${handoffRate}% handoff rate`} />
        <Metric label="Latency p90" value={ms(metrics?.p90_latency_ms)} hint={`first token ${ms(metrics?.avg_first_token_ms)}`} />
        <Metric label="Cost per turn" value={usd(metrics?.avg_cost_usd)} hint={`total ${usd(metrics?.total_cost_usd)}`} />
        <Metric label="Tool calls" value={String(metrics?.tool_calls ?? 0)} hint={`${metrics?.tool_errors ?? 0} errors · ${metrics?.tickets ?? 0} tickets`} />
        <Metric label="Prompt cache" value={`${cacheRate}%`} hint="input tokens read from cache" />
      </div>

      <div className="flex border-b border-line bg-surface text-[13px] lg:hidden">
        {(["queue", "chat", "trace"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setMobileTab(t)} className={`flex-1 py-2 capitalize ${mobileTab === t ? "border-b-2 border-brand font-medium text-ink" : "text-ink-soft"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)_380px]">
        {/* Queue */}
        <aside className={`min-h-0 flex-col border-r border-line bg-surface ${mobileTab === "queue" ? "flex" : "hidden"} lg:flex`}>
          <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line p-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] ${filter === f.key ? "bg-navy text-white" : "text-ink-soft hover:bg-surface-2"}`}
              >
                {f.label} <span className="opacity-60">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="p-6 text-center text-[13px] text-ink-faint">
                No conversations yet. Open the{" "}
                <Link href="/" className="text-brand underline">
                  customer site
                </Link>{" "}
                and write to the assistant.
              </div>
            ) : null}
            {visible.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelected(c.id);
                  setDetail(null);
                  setMobileTab("chat");
                  void loadDetail(c.id);
                }}
                className={`block w-full border-b border-line px-4 py-3 text-left transition hover:bg-surface-2 ${selected === c.id ? "bg-brand-soft/60" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                  {c.channel !== "web" ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] uppercase text-ink-faint">{c.channel}</span> : null}
                  <span className="ml-auto text-[11px] text-ink-faint">{ago(c.updated_at)}</span>
                </div>
                <div className="mt-1.5 truncate text-[13px] font-medium">{c.title ?? "New conversation"}</div>
                <div className="mt-0.5 truncate text-[12px] text-ink-soft">
                  {c.last_role === "user" ? "Customer: " : c.last_role === "operator" ? "You: " : ""}
                  {c.last_message ?? "—"}
                </div>
                {c.status === "needs_human" && c.handoff_reason ? (
                  <div className="mt-1 line-clamp-2 text-[11.5px] text-warn">↳ {c.handoff_reason}</div>
                ) : null}
              </button>
            ))}
          </div>
        </aside>

        {/* Transcript */}
        <section className={`min-h-0 flex-col bg-bg ${mobileTab === "chat" ? "flex" : "hidden"} lg:flex`}>
          {!detail ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-ink-faint">
              {selected ? "Loading…" : "Select a conversation to see the transcript and the agent trace."}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
                <div className="mr-auto min-w-0">
                  <div className="truncate text-[14px] font-semibold">{detail.conversation.title ?? "Conversation"}</div>
                  <div className="text-[11px] text-ink-faint">
                    {detail.conversation.id} · {detail.conversation.channel}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[detail.conversation.status]}`}>{STATUS_LABEL[detail.conversation.status]}</span>
                {status !== "human" ? (
                  <button type="button" onClick={() => void act("takeover")} className="rounded-lg bg-navy px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
                    Take over
                  </button>
                ) : null}
                {status === "human" || status === "needs_human" ? (
                  <button type="button" onClick={() => void act("release")} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium hover:bg-surface-2">
                    Return to AI
                  </button>
                ) : null}
                {status !== "closed" ? (
                  <button type="button" onClick={() => void act("close")} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:bg-surface-2">
                    Close
                  </button>
                ) : null}
              </div>
              {detail.conversation.status === "needs_human" && detail.conversation.handoffReason ? (
                <div className="flex items-start gap-2 border-b border-line bg-warn-soft px-4 py-2 text-[12.5px] text-ink">
                  <AlertIcon width={15} height={15} className="mt-0.5 shrink-0 text-warn" />
                  <span>
                    <b>Handoff:</b> {detail.conversation.handoffReason}
                  </span>
                </div>
              ) : null}
              <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {detail.messages.map((m) => {
                  if (m.role === "event") return <div key={m.id} className="text-center text-[11px] text-ink-faint">— {m.content} —</div>;
                  const customer = m.role === "user";
                  return (
                    <div key={m.id} className={`flex ${customer ? "justify-start" : "justify-end"}`}>
                      <div className="max-w-[80%]">
                        <div className={`mb-0.5 text-[11px] text-ink-faint ${customer ? "" : "text-right"}`}>
                          {customer ? "Customer" : m.role === "operator" ? "You (human agent)" : "Nimbus Assist (AI)"} ·{" "}
                          {new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                        <div
                          className={`rounded-2xl px-3.5 py-2 text-[13.5px] ${
                            customer ? "rounded-tl-md border border-line bg-surface" : m.role === "operator" ? "rounded-tr-md bg-accent/90 text-navy" : "rounded-tr-md bg-navy text-white"
                          }`}
                        >
                          <Markdown text={m.content} />
                        </div>
                        {m.meta?.trips?.length ? <TripCards trips={m.meta.trips} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-line bg-surface p-3">
                <div className="flex items-end gap-2 rounded-xl border border-line bg-bg px-3 py-2 focus-within:border-brand">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={onKey}
                    rows={1}
                    placeholder={status === "human" ? "Reply as a human agent…" : "Replying takes the conversation over from the AI…"}
                    className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13.5px] outline-none placeholder:text-ink-faint"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    disabled={!reply.trim()}
                    onClick={() => void act("reply", reply.trim())}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-white disabled:opacity-40"
                    aria-label="Send reply"
                  >
                    <SendIcon width={15} height={15} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Agent trace */}
        <aside className={`scroll-thin min-h-0 overflow-y-auto border-l border-line bg-surface p-4 ${mobileTab === "trace" ? "block" : "hidden"} lg:block`}>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <SparkIcon width={15} height={15} className="text-brand" /> Agent trace
          </h2>
          {!detail ? (
            <p className="mt-3 text-[12.5px] text-ink-faint">Each AI turn shows its model steps, tool calls with inputs and outputs, tokens, cost and latency.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {detail.tickets.map((t) => (
                <div key={t.id} className="rounded-xl border border-success/30 bg-success-soft p-3 text-[12px]">
                  <div className="flex items-center gap-1.5 font-semibold text-success">
                    <TicketIcon width={13} height={13} /> T-{String(t.id).padStart(5, "0")} · {t.category} · {t.priority}
                  </div>
                  <div className="mt-1 text-ink">{t.summary}</div>
                  {t.bookingCode ? <div className="mt-1 text-ink-soft">Booking {t.bookingCode}</div> : null}
                </div>
              ))}
              {detail.runs.length === 0 ? <p className="text-[12.5px] text-ink-faint">No AI turns yet.</p> : null}
              {detail.runs.map((r, i) => (
                <div key={r.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold">Turn {i + 1}</span>
                    <span className="text-ink-faint">
                      {r.steps} step{r.steps === 1 ? "" : "s"} · {r.stopReason ?? "—"}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                    <div className="rounded-lg bg-surface-2 py-1.5">
                      <div className="font-semibold tabular-nums">{ms(r.latencyMs)}</div>
                      <div className="text-ink-faint">total</div>
                    </div>
                    <div className="rounded-lg bg-surface-2 py-1.5">
                      <div className="font-semibold tabular-nums">{ms(r.firstTokenMs)}</div>
                      <div className="text-ink-faint">first token</div>
                    </div>
                    <div className="rounded-lg bg-surface-2 py-1.5">
                      <div className="font-semibold tabular-nums">{usd(r.costUsd)}</div>
                      <div className="text-ink-faint">cost</div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[11px] tabular-nums text-ink-faint">
                    in {r.inputTokens.toLocaleString()} · cache read {r.cacheReadTokens.toLocaleString()} · out {r.outputTokens.toLocaleString()} · {r.model}
                  </div>
                  {r.error ? <div className="mt-2 rounded-lg bg-danger-soft px-2 py-1 text-[11.5px] text-danger">{r.error}</div> : null}
                  {r.toolCalls.length ? (
                    <div className="mt-2 space-y-1.5">
                      {r.toolCalls.map((c) => (
                        <div key={c.id} className="rounded-lg border border-line">
                          <button
                            type="button"
                            onClick={() => setOpenCall(openCall === c.id ? null : c.id)}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]"
                          >
                            {c.isError ? <AlertIcon width={13} height={13} className="text-danger" /> : <CheckIcon width={13} height={13} className="text-success" />}
                            <span className="font-mono">{c.name}</span>
                            <span className="ml-auto text-ink-faint">{ms(c.durationMs)}</span>
                          </button>
                          {openCall === c.id ? (
                            <div className="space-y-1.5 border-t border-line p-2">
                              <div className="text-[10.5px] font-medium uppercase text-ink-faint">Input</div>
                              <Json value={c.input} />
                              <div className="text-[10.5px] font-medium uppercase text-ink-faint">Output</div>
                              <Json value={c.output} />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {status === "needs_human" ? (
                <div className="flex items-center gap-1.5 rounded-xl bg-warn-soft p-3 text-[12px] text-ink">
                  <PersonIcon width={14} height={14} className="text-warn" /> The AI is paused until a human takes over or hands it back.
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
