"use client";

import { useState, type ReactNode } from "react";
import { ASK_EVENT } from "./chat/chat-widget";
import { ArrowRightIcon } from "./icons";

export function ask(question: string) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: question }));
}

export function AskButton({ question, className, children }: { question: string; className?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => ask(question)} className={className}>
      {children}
    </button>
  );
}

const CITIES = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Malaga", "Alicante", "Gandia", "Zaragoza", "Bilbao"];

export function RouteSearch() {
  const [from, setFrom] = useState("Madrid");
  const [to, setTo] = useState("Valencia");
  const [when, setWhen] = useState("tomorrow");
  const field = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-[14px] text-ink outline-none focus:border-brand";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        ask(`Show me trips from ${from} to ${to} ${when === "tomorrow" ? "tomorrow" : when === "today" ? "today" : "this Friday"}`);
      }}
      className="grid gap-3 rounded-3xl border border-line bg-surface p-4 shadow-xl shadow-navy/5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
    >
      <label className="text-[12px] font-medium text-ink-soft">
        From
        <select value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} mt-1`}>
          {CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="text-[12px] font-medium text-ink-soft">
        To
        <select value={to} onChange={(e) => setTo(e.target.value)} className={`${field} mt-1`}>
          {CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="text-[12px] font-medium text-ink-soft">
        When
        <select value={when} onChange={(e) => setWhen(e.target.value)} className={`${field} mt-1`}>
          <option value="today">Today</option>
          <option value="tomorrow">Tomorrow</option>
          <option value="friday">This Friday</option>
        </select>
      </label>
      <button
        type="submit"
        className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-semibold text-navy transition hover:brightness-95"
      >
        Find trips <ArrowRightIcon width={16} height={16} />
      </button>
    </form>
  );
}
