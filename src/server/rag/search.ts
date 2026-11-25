import { sql } from "drizzle-orm";
import { queryRows, type Db } from "../db/client";
import { embedQuery } from "./embed";

export interface KbHit {
  slug: string;
  title: string;
  heading: string;
  content: string;
  score: number;
}

interface Row {
  id: number;
  slug: string;
  title: string;
  heading: string;
  content: string;
  [key: string]: unknown;
}

const RRF_K = 60;

/**
 * Hybrid retrieval: pgvector cosine similarity + Postgres full-text search, merged with
 * Reciprocal Rank Fusion. Vector search handles paraphrases and other languages; full-text
 * search nails exact terms like "Flex", "Bizum" or "bicycle". Either side can be empty.
 */
export async function searchKnowledge(db: Db, query: string, limit = 4): Promise<KbHit[]> {
  const embedding = await embedQuery(query);

  const vectorRows: Row[] = embedding
    ? await queryRows<Row>(
        db,
        sql`
          SELECT id, slug, title, heading, content
          FROM kb_chunks
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
          LIMIT 8`,
      )
    : [];

  const textRows: Row[] = await queryRows<Row>(
    db,
    sql`
      SELECT id, slug, title, heading, content
      FROM kb_chunks, websearch_to_tsquery('english', ${query}) q
      WHERE tsv @@ q
      ORDER BY ts_rank_cd(tsv, q) DESC
      LIMIT 8`,
  );

  // Full-text search with AND semantics misses long natural questions; retry with OR terms.
  const looseRows: Row[] =
    textRows.length > 0
      ? []
      : await queryRows<Row>(
          db,
          sql`
            SELECT id, slug, title, heading, content
            FROM kb_chunks, to_tsquery('english', ${orQuery(query)}) q
            WHERE ${orQuery(query)} <> '' AND tsv @@ q
            ORDER BY ts_rank_cd(tsv, q) DESC
            LIMIT 8`,
        );

  const scores = new Map<number, { row: Row; score: number }>();
  for (const list of [vectorRows, textRows.length ? textRows : looseRows]) {
    list.forEach((row, rank) => {
      const entry = scores.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      scores.set(row.id, entry);
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({
      slug: row.slug,
      title: row.title,
      heading: row.heading,
      content: row.content,
      score: Math.round(score * 10_000) / 10_000,
    }));
}

/** "Can I take my dog?" -> "take | dog" (stop words are dropped by to_tsquery). */
export function orQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 12)
    .join(" | ");
}
