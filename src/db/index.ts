import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// Reuse a single client across hot-reloads in dev to avoid exhausting connections.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.pgClient ??
  postgres(connectionString, {
    // §14: at least 10 concurrent users, each request may hold a transaction.
    max: Number(process.env.DB_POOL_MAX ?? 15),
  });
if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema, client };
export type DB = typeof db;

/** Drizzle's transaction handle — structural, so it cannot be imported. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * "A `db` or a transaction". Query helpers accept this so the same function
 * works standalone and as part of a larger atomic operation.
 */
export type Executor = DB | Tx;

/** Close the underlying connection pool (used by tests / scripts to exit). */
export async function closeDb(): Promise<void> {
  await client.end();
}
