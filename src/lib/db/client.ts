import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Runs the table statements on the connection a database was opened with: postgres-js or PGlite. */
function createTables(db: Db): Promise<unknown> {
  const client = (db as unknown as { $client: { unsafe?: (sql: string) => Promise<unknown>; exec?: (sql: string) => Promise<unknown> } }).$client;
  return client.unsafe ? client.unsafe(schema.CREATE_TABLES_SQL) : client.exec!(schema.CREATE_TABLES_SQL);
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ default: postgres }, { drizzle }] = await Promise.all([
      import("postgres"),
      import("drizzle-orm/postgres-js"),
    ]);
    const db = drizzle(postgres(url, { prepare: false }), { schema }) as unknown as Db;
    await createTables(db);
    return db;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production.");
  }
  const dir = resolve(/*turbopackIgnore: true*/ process.env.PGLITE_DIR ?? ".data/pglite");
  mkdirSync(dir, { recursive: true });
  const db = await createLocalDb(dir);
  closeOnExit(db);
  return db;
}

/**
 * The local database keeps part of its work in memory. Stopping the studio without closing it can
 * leave the files half written, and then it won't open again. So close it before the process ends.
 */
function closeOnExit(db: Db) {
  const flags = globalThis as unknown as { __studioDbCloseHooked?: boolean };
  if (flags.__studioDbCloseHooked) return;
  flags.__studioDbCloseHooked = true;
  const client = (db as unknown as { $client: { close?: () => Promise<void> } }).$client;
  let closing = false;
  const close = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    // Never hang on the way out: give the database a few seconds, then exit anyway.
    const timer = setTimeout(() => process.exit(signal === "SIGINT" ? 130 : 143), 5000);
    Promise.resolve(client.close?.())
      .catch((error) => console.error("Couldn't close the local database cleanly:", error))
      .finally(() => {
        clearTimeout(timer);
        process.exit(signal === "SIGINT" ? 130 : 143);
      });
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => close(signal));
}

/** Embedded Postgres for local development and tests. Omit `dir` to keep it in memory. */
export async function createLocalDb(dir?: string): Promise<Db> {
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const db = drizzle(new PGlite(dir), { schema }) as unknown as Db;
  await createTables(db);
  return db;
}

// Kept on globalThis so hot reloads in development reuse one connection. When a reload brings new
// tables, they are created on that same connection, so the studio keeps working without a restart.
const store = globalThis as unknown as { __studioDb?: Promise<Db>; __studioTables?: Promise<unknown> & { sql?: string } };

export async function getDb(): Promise<Db> {
  const fresh = !store.__studioDb;
  store.__studioDb ??= connect().catch((error) => {
    store.__studioDb = undefined;
    throw error;
  });
  const db = await store.__studioDb;
  if (store.__studioTables?.sql !== schema.CREATE_TABLES_SQL) {
    const created: Promise<unknown> & { sql?: string } = fresh
      ? Promise.resolve()
      : createTables(db).catch((error) => {
          // Tried again on the next request.
          store.__studioTables = undefined;
          throw error;
        });
    created.sql = schema.CREATE_TABLES_SQL;
    store.__studioTables = created;
  }
  await store.__studioTables;
  return db;
}
