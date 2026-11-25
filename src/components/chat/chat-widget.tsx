"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Markdown } from "../markdown";
import { BookIcon, ChatIcon, CloseIcon, PersonIcon, RefreshIcon, SearchIcon, SendIcon, SparkIcon, TicketIcon } from "../icons";
import { TripCards } from "./trip-cards";
import { useChat, type ChatMessage, type ToolActivity } from "./use-chat";

export const ASK_EVENT = "nimbus:ask";

const SUGGESTIONS = [
  "Trains from Madrid to Valencia tomorrow",
  "Can I bring my dog on the bus?",
  "Check my booking NB4K7Q2",
  "¿Cuánto cuesta una maleta extra?",
  "Хочу скасувати квиток",
];

const TOOL_LABEL: Record<string, string> = {
  search_trips: "Searching trips",
  get_booking: "Checking the booking",
  search_knowledge: "Reading the help center",
  create_ticket: "Opening a ticket",
  handoff_to_human: "Calling a human agent",
};

function ToolChip({ tool }: { tool: ToolActivity }) {
  const Icon = tool.name === "search_knowledge" ? BookIcon : tool.name === "create_ticket" ? TicketIcon : tool.name === "handoff_to_human" ? PersonIcon : SearchIcon;
  return (
    <span className="rise inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft">
      {tool.done ? (
        <span className={tool.ok ? "text-success" : "text-danger"}>●</span>
      ) : (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-brand border-t-transparent" />
      )}
      <Icon width={13} height={13} />
      {TOOL_LABEL[tool.name] ?? tool.name}
    </span>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "event") {
    return <div className="rise py-1 text-center text-[11px] text-ink-faint">{message.content}</div>;
  }
  if (message.role === "user") {
    return (
      <div className="rise flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[14px] text-white shadow-sm">{message.content}</div>
      </div>
    );
  }
  const human = message.role === "operator";
  const meta = message.meta ?? {};
  const sources = (meta.sources ?? []).filter((s, i, all) => all.findIndex((x) => x.title === s.title) === i);
  return (
    <div className="rise flex gap-2">
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          human ? "bg-accent text-navy" : "bg-navy text-white"
        }`}
        aria-hidden
      >
        {human ? <PersonIcon width={14} height={14} /> : "N"}
      </div>
      <div className="min-w-0 max-w-[88%]">
        <div className="mb-0.5 text-[11px] font-medium text-ink-faint">{human ? "Nimbus agent" : "Nimbus Assist"}</div>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2 text-[14px] text-ink shadow-sm">
          {message.content ? <Markdown text={message.content} /> : <span className="text-ink-faint">…</span>}
        </div>
        {meta.trips?.length ? <TripCards trips={meta.trips} /> : null}
        {meta.ticketId || sources.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {meta.ticketId ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                <TicketIcon width={12} height={12} /> Ticket T-{String(meta.ticketId).padStart(5, "0")}
              </span>
            ) : null}
            {sources.map((s) => (
              <span key={s.title} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">
                <BookIcon width={12} height={12} /> {s.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: string }) {
  if (status === "needs_human")
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Waiting for a human agent
      </span>
    );
  if (status === "human")
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Human agent · Nimbus team
      </span>
    );
  if (status === "closed") return <span>Conversation closed · write to reopen</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-success" /> AI assistant · answers instantly
    </span>
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const chat = useChat();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { send } = chat;

  // Deep link: /?chat=open opens the widget (demos, screenshots, links from emails).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("chat") !== "open") return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Other parts of the page (help topics, route search) can ask the assistant a question.
  useEffect(() => {
    const onAsk = (e: Event) => {
      setOpen(true);
      void send((e as CustomEvent<string>).detail);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [send]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.tools, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = () => {
    if (!input.trim() || chat.busy) return;
    void send(input);
    setInput("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const last = chat.messages[chat.messages.length - 1];
  const showTyping = chat.busy && (!last || last.role === "user" || (last.pending && !last.content));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support chat" : "Open support chat"}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition hover:scale-105 hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {open ? <CloseIcon width={22} height={22} /> : <ChatIcon width={22} height={22} />}
      </button>

      {!open && chat.messages.length === 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rise fixed bottom-[86px] right-5 z-40 hidden max-w-[240px] rounded-2xl rounded-br-md border border-line bg-surface px-4 py-2.5 text-left text-[13px] text-ink shadow-lg sm:block"
        >
          👋 Hi! Ask me about trips, prices or your booking.
        </button>
      ) : null}

      {open ? (
        <section
          aria-label="Nimbus support chat"
          className="rise fixed inset-0 z-50 flex flex-col overflow-hidden bg-bg sm:inset-auto sm:bottom-[88px] sm:right-5 sm:h-[min(680px,calc(100vh-120px))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-line sm:shadow-2xl"
        >
          <header className="flex items-center gap-3 bg-gradient-to-br from-navy to-[#1c2d6b] px-4 py-3.5 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 font-semibold">N</div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">Nimbus Assist</div>
              <div className="truncate text-[12px] text-white/70">
                <StatusLine status={chat.status} />
              </div>
            </div>
            <button type="button" onClick={chat.reset} title="New conversation" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white">
              <RefreshIcon />
            </button>
            <button type="button" onClick={() => setOpen(false)} title="Close" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white">
              <CloseIcon />
            </button>
          </header>

          <div ref={listRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {chat.messages.length === 0 ? (
              <div className="rise space-y-4 pt-2">
                <div className="flex gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-[11px] font-semibold text-white">N</div>
                  <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 text-[14px] shadow-sm">
                    Hi, I&apos;m Nimbus Assist. I can find trips and prices, check your booking, explain our rules and open a ticket. Write in any language.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pl-9">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-[12px] text-brand-strong transition hover:border-brand hover:bg-brand hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {chat.messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}

            {chat.tools.length ? (
              <div className="flex flex-wrap gap-1.5 pl-9">
                {chat.tools.map((t) => (
                  <ToolChip key={t.id} tool={t} />
                ))}
              </div>
            ) : null}

            {showTyping ? (
              <div className="flex items-center gap-1 pl-9 text-ink-faint" aria-label="Assistant is typing">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-current" />
              </div>
            ) : null}

            {chat.status === "needs_human" && !chat.busy ? (
              <div className="rise rounded-xl border border-accent/40 bg-warn-soft px-3 py-2 text-[12px] text-ink">
                <PersonIcon width={13} height={13} className="mr-1 inline" /> A human agent will join this chat. You can keep writing; they will see everything.
              </div>
            ) : null}

            {chat.error ? <div className="rounded-xl bg-danger-soft px-3 py-2 text-[12px] text-danger">{chat.error}</div> : null}
          </div>

          <div className="border-t border-line bg-surface p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-bg px-3 py-2 focus-within:border-brand">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                maxLength={1500}
                placeholder={chat.status === "human" ? "Message the Nimbus agent…" : "Ask about trips, bookings, rules…"}
                className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim() || chat.busy}
                aria-label="Send message"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white transition enabled:hover:bg-brand-strong disabled:opacity-40"
              >
                <SendIcon width={16} height={16} />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-center gap-1 text-[10.5px] text-ink-faint">
              <SparkIcon width={11} height={11} /> AI can make mistakes. Demo with a fictional company.
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
