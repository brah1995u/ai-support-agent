import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each test file gets its own in-memory Postgres (PGlite) and its own module state.
    env: { PGLITE_DIR: "memory://", EMBEDDINGS: process.env.EMBEDDINGS ?? "off", ANTHROPIC_API_KEY: "", LLM_PROVIDER: "anthropic" },
    // A shared external Postgres (DATABASE_URL) runs files one by one; PGlite runs them in parallel.
    fileParallelism: !process.env.DATABASE_URL,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
