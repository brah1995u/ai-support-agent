import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  devIndicators: false,
  partialPrefetching: true,
  // Native / WASM packages are loaded from node_modules at runtime instead of being bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@electric-sql/pglite-pgvector",
    "@huggingface/transformers",
    "onnxruntime-node",
    "pg",
  ],
  // The knowledge base is read from disk at seed time.
  outputFileTracingIncludes: {
    "/api/**": ["./data/kb/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
