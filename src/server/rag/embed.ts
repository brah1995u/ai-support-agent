/**
 * Local multilingual embeddings (no API key): intfloat/multilingual-e5-small through
 * transformers.js, 384 dimensions. Customers write in Spanish, Ukrainian or English while the
 * knowledge base is in English, so a multilingual model matters for recall.
 *
 * Embeddings are optional: with EMBEDDINGS=off, or if the model cannot load, retrieval falls
 * back to Postgres full-text search only and the app keeps working.
 */
const MODEL_ID = "Xenova/multilingual-e5-small";

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

const globalForEmbed = globalThis as unknown as { __embedder?: Promise<Extractor | null> };

function enabled(): boolean {
  return (process.env.EMBEDDINGS ?? "local") !== "off";
}

async function loadExtractor(): Promise<Extractor | null> {
  if (!enabled()) return null;
  try {
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    return extractor as unknown as Extractor;
  } catch (error) {
    console.warn("[embeddings] local model unavailable, using full-text search only:", (error as Error).message);
    return null;
  }
}

function extractor(): Promise<Extractor | null> {
  globalForEmbed.__embedder ??= loadExtractor();
  return globalForEmbed.__embedder;
}

async function embed(texts: string[]): Promise<number[][] | null> {
  const run = await extractor();
  if (!run) return null;
  const output = await run(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

/** e5 models expect "passage: " / "query: " prefixes. */
export function embedPassages(texts: string[]) {
  return embed(texts.map((t) => `passage: ${t}`));
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const vectors = await embed([`query: ${text}`]);
  return vectors?.[0] ?? null;
}
