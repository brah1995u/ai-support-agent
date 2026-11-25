import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Pool } from "pg";
import { config } from "../config";
import { DDL } from "./migrate";
import * as schema from "./schema";
import { seed } from "./seed";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Raw SQL that returns rows; both PGlite and node-postgres results expose `.rows`. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

interface DbHandle {
  db: Db;
  /** Runs migrations + seed while holding a lock, so parallel instances don't race. */
  initialize: (run: (exec: (sql: string) => Promise<void>) => Promise<void>) => Promise<void>;
  close: () => Promise<void>;
}

const INIT_LOCK = 7_262_001;

async function open(): Promise<DbHandle> {
  if (config.databaseUrl) {
    const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
    return {
      db: drizzlePg(pool, { schema }) as unknown as Db,
      initialize: async (run) => {
        // Advisory locks are per connection: take it on a dedicated client.
        const lock = await pool.connect();
        try {
          await lock.query("SELECT pg_advisory_lock($1)", [INIT_LOCK]);
          await run(async (sql) => {
            await lock.query(sql);
          });
        } finally {
          await lock.query("SELECT pg_advisory_unlock($1)", [INIT_LOCK]).catch(() => undefined);
          lock.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const dataDir = config.pgliteDir === "memory://" ? undefined : config.pgliteDir;
  if (dataDir) await mkdir(path.dirname(path.resolve(dataDir)), { recursive: true });
  const client = new PGlite({ dataDir, extensions: { vector } });
  return {
    db: drizzlePglite(client, { schema }) as unknown as Db,
    // PGlite is single-connection and in-process: nothing to lock.
    initialize: (run) =>
      run(async (sql) => {
        await client.exec(sql);
      }),
    close: () => client.close(),
  };
}

// One handle per process. Next.js dev re-evaluates modules on hot reload, so the handle
// lives on globalThis instead of in module scope.
const globalForDb = globalThis as unknown as { __supportAgentDb?: Promise<DbHandle> };

async function init(): Promise<DbHandle> {
  const handle = await open();
  await handle.initialize(async (exec) => {
    await exec(DDL);
    await seed(handle.db);
  });
  return handle;
}

export async function getDb(): Promise<Db> {
  globalForDb.__supportAgentDb ??= init().catch((error) => {
    globalForDb.__supportAgentDb = undefined;
    throw error;
  });
  return (await globalForDb.__supportAgentDb).db;
}

/** For tests and scripts: close the shared handle so the process can exit. */
export async function closeDb(): Promise<void> {
  const pending = globalForDb.__supportAgentDb;
  globalForDb.__supportAgentDb = undefined;
  if (pending) await (await pending).close();
}
