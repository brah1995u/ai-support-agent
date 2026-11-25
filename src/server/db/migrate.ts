/**
 * Idempotent DDL. Kept as plain SQL so it runs the same way on embedded PGlite and on a
 * real Postgres (Neon, Supabase, Docker) without a migration tool.
 */
export const DDL = /* sql */ `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  channel text NOT NULL DEFAULT 'web',
  status text NOT NULL DEFAULT 'bot',
  title text,
  handoff_reason text,
  language text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id serial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id serial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  model text NOT NULL,
  steps integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  first_token_ms integer,
  stop_reason text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_conversation_idx ON agent_runs (conversation_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id serial PRIMARY KEY,
  run_id integer NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  name text NOT NULL,
  input jsonb NOT NULL,
  output jsonb NOT NULL,
  is_error boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_calls_run_idx ON tool_calls (run_id);

CREATE TABLE IF NOT EXISTS bookings (
  code text PRIMARY KEY,
  email text NOT NULL,
  passenger_name text NOT NULL,
  passengers integer NOT NULL DEFAULT 1,
  trip_id text NOT NULL,
  fare text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  total_eur numeric(10, 2) NOT NULL,
  extras jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id serial PRIMARY KEY,
  conversation_id text NOT NULL,
  category text NOT NULL,
  priority text NOT NULL,
  summary text NOT NULL,
  booking_code text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id serial PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  heading text NOT NULL,
  content text NOT NULL,
  embedding vector(384),
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title || ' ' || heading), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) STORED
);
CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING gin (tsv);
`;
