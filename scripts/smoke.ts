/** Quick end-to-end check of the data layer without the LLM: DB, seed, retrieval, timetable. */
import { getDb, closeDb } from "../src/server/db/client";
import { searchKnowledge } from "../src/server/rag/search";
import { searchTrips, addDays, madridToday } from "../src/server/domain/timetable";
import { executeTool } from "../src/server/agent/tools";
import { createConversation } from "../src/server/conversations";

async function main() {
  const t0 = Date.now();
  const db = await getDb();
  console.log(`db ready in ${Date.now() - t0} ms`);
  for (const q of ["refund basic fare cancel 3 days before", "¿Puedo llevar a mi perro en el autobús?", "Чи можна взяти велосипед?", "Bizum"]) {
    const hits = await searchKnowledge(db, q);
    console.log(`\nQ: ${q}`);
    for (const h of hits) console.log(`  ${h.score}  ${h.title} > ${h.heading}`);
  }
  const date = addDays(madridToday(), 2);
  console.log("\ntrips Madrid->Valencia", date, searchTrips("Madrid", "Valencia", date).map((t) => `${t.id} ${t.priceBasic}`));
  const conv = await createConversation(db, "eval");
  const ctx = { db, conversationId: conv.id, now: new Date(), meta: {} };
  console.log("\nget_booking ok:", JSON.stringify(await executeTool("get_booking", { code: "nb4k7q2", email: "Maria.Lopez@example.com" }, ctx)).slice(0, 300));
  console.log("get_booking wrong email:", JSON.stringify(await executeTool("get_booking", { code: "NB4K7Q2", email: "x@example.com" }, ctx)));
  console.log("bad input:", JSON.stringify(await executeTool("search_trips", { origin: "Paris", destination: "Madrid", date: "2026-01-01" }, ctx)));
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
