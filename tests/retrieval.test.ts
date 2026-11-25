import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, type Db } from "@/server/db/client";
import { orQuery, searchKnowledge } from "@/server/rag/search";

let db: Db;
beforeAll(async () => {
  db = await getDb();
});
afterAll(closeDb);

// EMBEDDINGS=off in unit tests: this checks the full-text half of hybrid retrieval.
// The vector half (multilingual) is covered by the eval suite.
describe("searchKnowledge (full-text)", () => {
  it.each([
    ["Can I take my dog on the train?", "pets"],
    ["Bizum", "payments-and-invoices"],
    ["refund basic fare cancel", "refunds-and-cancellations"],
    ["bicycle on the bus", "baggage"],
    ["train arrived 70 minutes late compensation", "delays-and-compensation"],
  ])("%s -> %s", async (query, slug) => {
    const hits = await searchKnowledge(db, query);
    expect(hits[0]?.slug).toBe(slug);
  });

  it("builds an OR query from natural language", () => {
    expect(orQuery("Can I bring my DOG?")).toBe("can | bring | dog");
  });
});
