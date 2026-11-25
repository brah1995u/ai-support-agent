import Link from "next/link";
import { AskButton, RouteSearch } from "@/components/ask";
import { ChatWidget } from "@/components/chat/chat-widget";
import { ArrowRightIcon, BookIcon, BusIcon, PersonIcon, SearchIcon, SparkIcon, TrainIcon } from "@/components/icons";

const ROUTES = [
  { from: "Madrid", to: "Valencia", mode: "train", time: "1h 55m", price: 29 },
  { from: "Madrid", to: "Barcelona", mode: "train", time: "2h 40m", price: 41 },
  { from: "Valencia", to: "Gandia", mode: "bus", time: "1h", price: 7 },
  { from: "Madrid", to: "Sevilla", mode: "train", time: "2h 35m", price: 35 },
  { from: "Barcelona", to: "Valencia", mode: "train", time: "3h", price: 27 },
  { from: "Valencia", to: "Alicante", mode: "train", time: "1h 50m", price: 17 },
] as const;

const HELP = [
  { title: "Refunds & cancellations", q: "How much do I get back if I cancel a Basic ticket 3 days before the trip?" },
  { title: "Changes", q: "Can I change the date of my Flex ticket?" },
  { title: "Baggage", q: "How many suitcases can I take and how much is an extra one?" },
  { title: "Pets", q: "Can I travel with my dog on the train?" },
  { title: "Delays & compensation", q: "My train arrived 70 minutes late. What compensation do I get?" },
  { title: "Invoices", q: "I need an invoice for my company for booking NB2HW8R" },
];

const FEATURES = [
  {
    icon: SearchIcon,
    title: "Agent with tools",
    text: "Claude decides when to search trips, look up a booking (code + email), read the help center, open a ticket or call a human. Inputs are schema-validated before anything runs.",
  },
  {
    icon: BookIcon,
    title: "Hybrid RAG",
    text: "pgvector + Postgres full-text search fused with RRF over the help center. Multilingual embeddings run locally, answers cite their source.",
  },
  {
    icon: PersonIcon,
    title: "Human handoff",
    text: "The agent escalates angry, urgent or unsolved cases. An operator takes over live from the console; the bot goes silent until handed back.",
  },
  {
    icon: SparkIcon,
    title: "Observable & evaluated",
    text: "Every turn records steps, tool calls, tokens, cost and latency. An eval suite and an MCP server expose the same tools to other agents.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <div className="bg-navy px-4 py-2 text-center text-[12.5px] text-white/80">
        <span className="font-medium text-white">Nimbus Travel is a fictional company.</span> This page demos an AI customer-support agent.{" "}
        <Link href="/dashboard" className="whitespace-nowrap font-medium text-accent underline-offset-4 hover:underline">
          Open the operator console →
        </Link>
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy text-[15px] font-bold text-white">N</div>
          <span className="text-[17px] font-semibold tracking-tight">Nimbus Travel</span>
        </div>
        <nav className="hidden items-center gap-7 text-[14px] text-ink-soft sm:flex">
          <a href="#routes" className="hover:text-ink">Routes</a>
          <a href="#help" className="hover:text-ink">Help center</a>
          <a href="#demo" className="hover:text-ink">About this demo</a>
          <AskButton question="I want to check my booking" className="rounded-full border border-line px-4 py-1.5 hover:border-ink-faint hover:text-ink">
            My booking
          </AskButton>
        </nav>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-brand/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-32 top-40 h-[360px] w-[360px] rounded-full bg-accent/15 blur-3xl" />
          <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-10 sm:pt-16">
            <div aria-hidden className="absolute right-5 top-14 hidden w-[300px] rotate-[3deg] xl:block">
              <div className="rounded-3xl border border-line bg-surface p-5 shadow-2xl shadow-navy/10">
                <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                  <span className="inline-flex items-center gap-1.5">
                    <TrainIcon width={14} height={14} /> Nimbus train
                  </span>
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-brand-strong">Flex</span>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-[26px] font-semibold tabular-nums">06:30</div>
                    <div className="text-[12px] text-ink-soft">Madrid</div>
                  </div>
                  <div className="mb-3 flex-1 px-3">
                    <div className="border-t border-dashed border-ink-faint" />
                    <div className="mt-1 text-center text-[10px] text-ink-faint">2h 40m</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[26px] font-semibold tabular-nums">09:10</div>
                    <div className="text-[12px] text-ink-soft">Barcelona</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-dashed border-line pt-3 text-[11px]">
                  <div>
                    <div className="text-ink-faint">Coach</div>
                    <div className="font-semibold">4</div>
                  </div>
                  <div>
                    <div className="text-ink-faint">Seat</div>
                    <div className="font-semibold">12A</div>
                  </div>
                  <div>
                    <div className="text-ink-faint">Booking</div>
                    <div className="font-mono font-semibold">NB2HW8R</div>
                  </div>
                </div>
              </div>
              <div className="-mt-3 ml-10 -rotate-[3deg] rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 text-[12.5px] shadow-xl shadow-navy/10">
                <div className="mb-0.5 text-[10.5px] font-medium text-brand">Nimbus Assist</div>
                Your Flex ticket can be changed for free until 2 hours before departure.
              </div>
            </div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> Support in English, Español, Українська — 24/7
            </p>
            <h1 className="max-w-3xl text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-[60px]">
              Spain by bus and train, <span className="text-brand">without the queue at the desk.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
              Search routes, check your booking or ask about refunds and baggage. Our assistant answers in seconds and brings in a human when you need one.
            </p>
            <div className="mt-8 max-w-4xl">
              <RouteSearch />
            </div>
          </div>
        </section>

        <section id="routes" className="mx-auto max-w-6xl px-5 py-12">
          <div className="mb-6 flex items-end justify-between">
            <h2 className="text-[24px] font-semibold tracking-tight">Popular routes</h2>
            <span className="text-[13px] text-ink-faint">Click a route to ask the assistant</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROUTES.map((r) => {
              const Icon = r.mode === "train" ? TrainIcon : BusIcon;
              return (
                <AskButton
                  key={`${r.from}-${r.to}`}
                  question={`Trips from ${r.from} to ${r.to} tomorrow`}
                  className="group flex items-center justify-between rounded-2xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg hover:shadow-navy/5"
                >
                  <div>
                    <div className="text-[16px] font-semibold">
                      {r.from} <span className="text-ink-faint">→</span> {r.to}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1.5 text-[13px] capitalize text-ink-soft">
                      <Icon width={14} height={14} /> {r.mode} · {r.time}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-ink-faint">from</div>
                    <div className="text-[18px] font-semibold text-brand">{r.price} €</div>
                  </div>
                </AskButton>
              );
            })}
          </div>
        </section>

        <section id="help" className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="mb-6 text-[24px] font-semibold tracking-tight">Help center</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HELP.map((h) => (
              <AskButton
                key={h.title}
                question={h.q}
                className="group rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-brand/40"
              >
                <div className="text-[15px] font-semibold">{h.title}</div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">“{h.q}”</div>
                <div className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-brand opacity-80 group-hover:opacity-100">
                  Ask the assistant <ArrowRightIcon width={13} height={13} />
                </div>
              </AskButton>
            ))}
          </div>
        </section>

        <section id="demo" className="mx-auto max-w-6xl px-5 py-14">
          <div className="overflow-hidden rounded-3xl bg-navy text-white">
            <div className="grid gap-10 p-8 sm:p-12 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-accent">About this demo</p>
                <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight">An AI support agent you can inspect end to end.</h2>
                <p className="mt-4 text-[15px] leading-relaxed text-white/70">
                  Try it: ask for trips, then look up booking <code className="rounded bg-white/10 px-1.5 font-mono">NB4K7Q2</code> with{" "}
                  <code className="rounded bg-white/10 px-1.5 font-mono">maria.lopez@example.com</code>, ask for a refund, or say you want a human. Then open the
                  console to see every tool call, token and millisecond.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[14px] font-semibold text-navy hover:brightness-95">
                    Operator console <ArrowRightIcon width={15} height={15} />
                  </Link>
                  <AskButton
                    question="I'd like to talk to a human, please"
                    className="rounded-xl border border-white/20 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-white/10"
                  >
                    Test the handoff
                  </AskButton>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {FEATURES.map((f) => (
                  <div key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <f.icon width={20} height={20} className="text-accent" />
                    <div className="mt-2.5 text-[14px] font-semibold">{f.title}</div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/65">{f.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-28 pt-6 text-[12px] text-ink-faint">
        Nimbus Travel is fictional: routes, prices, bookings and policies are demo data. Built with Next.js, Claude, Postgres + pgvector and MCP.
      </footer>

      <ChatWidget />
    </div>
  );
}
