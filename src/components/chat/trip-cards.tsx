import type { TripView } from "@/server/db/schema";
import { BusIcon, TrainIcon } from "../icons";

function time(iso: string) {
  return iso.slice(11, 16);
}

function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function TripCards({ trips }: { trips: TripView[] }) {
  if (!trips.length) return null;
  const date = new Date(trips[0].departsAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" });
  return (
    <div className="mt-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {trips[0].origin} → {trips[0].destination} · {date}
      </div>
      <div className="scroll-thin -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {trips.map((t) => {
          const Icon = t.mode === "train" ? TrainIcon : BusIcon;
          const low = t.seatsLeft > 0 && t.seatsLeft <= 5;
          return (
            <div key={t.id} className="w-[150px] shrink-0 snap-start rounded-xl border border-line bg-surface p-2.5 text-[12px] shadow-sm">
              <div className="flex items-center justify-between text-ink-soft">
                <span className="inline-flex items-center gap-1 capitalize">
                  <Icon width={14} height={14} /> {t.mode}
                </span>
                <span>{duration(t.durationMinutes)}</span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1 font-semibold tabular-nums text-ink">
                <span className="text-[15px]">{time(t.departsAt)}</span>
                <span className="text-ink-faint">→</span>
                <span>{time(t.arrivesAt)}</span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="font-semibold text-brand">{t.priceBasic.toFixed(2)} €</span>
                <span className="text-[11px] text-ink-faint">Flex {t.priceFlex.toFixed(2)}</span>
              </div>
              <div className={`mt-1 text-[11px] ${t.seatsLeft === 0 ? "text-danger" : low ? "text-warn" : "text-ink-faint"}`}>
                {t.seatsLeft === 0 ? "Sold out" : `${t.seatsLeft} seats left`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
