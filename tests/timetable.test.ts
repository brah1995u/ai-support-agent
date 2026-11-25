import { describe, expect, it } from "vitest";
import { addDays, destinationsFrom, getTrip, madridIso, searchTrips } from "@/server/domain/timetable";

describe("timetable", () => {
  it("returns the same trips for the same query (deterministic)", () => {
    expect(searchTrips("Madrid", "Valencia", "2026-12-03")).toEqual(searchTrips("Madrid", "Valencia", "2026-12-03"));
  });

  it("lists bus and train departures sorted by time, in both directions", () => {
    const there = searchTrips("Madrid", "Valencia", "2026-12-03");
    const back = searchTrips("Valencia", "Madrid", "2026-12-03");
    expect(there.length).toBe(8);
    expect(back.length).toBe(8);
    expect(new Set(there.map((t) => t.mode))).toEqual(new Set(["bus", "train"]));
    expect([...there].sort((a, b) => a.departsAt.localeCompare(b.departsAt))).toEqual(there);
    expect(back[0].origin).toBe("Valencia");
  });

  it("rebuilds a trip from its id", () => {
    for (const trip of searchTrips("Valencia", "Gandia", "2026-12-03")) {
      expect(getTrip(trip.id)).toEqual(trip);
    }
    expect(getTrip("T-MAD-XXX-20261203-0710")).toBeNull();
    expect(getTrip("not-an-id")).toBeNull();
  });

  it("uses the Madrid UTC offset for winter and summer", () => {
    expect(madridIso("2026-12-03", "08:00")).toBe("2026-12-03T08:00:00+01:00");
    expect(madridIso("2026-07-03", "08:00")).toBe("2026-07-03T08:00:00+02:00");
  });

  it("flex is always more expensive than basic", () => {
    for (const t of searchTrips("Madrid", "Barcelona", "2026-12-05")) expect(t.priceFlex).toBeGreaterThan(t.priceBasic);
  });

  it("has no direct route between unconnected cities", () => {
    expect(searchTrips("Bilbao", "Malaga", "2026-12-03")).toEqual([]);
    expect(destinationsFrom("Bilbao")).toEqual(["Madrid"]);
  });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
