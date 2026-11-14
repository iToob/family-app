import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { databaseUrl } from "@/lib/db-url";

export type DB = NodePgDatabase<typeof schema>;
/** A transaction handle. All financial writes take one of these. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __fePool?: Pool; __feDb?: DB };

function createPool() {
  const url = databaseUrl();
  if (!url) throw new Error("No database connection string found. Set DATABASE_URL (or connect a Neon database in Vercel).");
  const needsSsl = /sslmode=require/.test(url) || process.env.DATABASE_SSL === "true";
  return new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: needsSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true" } : undefined,
  });
}

export function getDb(): DB {
  if (!globalForDb.__feDb) {
    globalForDb.__fePool = createPool();
    globalForDb.__feDb = drizzle(globalForDb.__fePool, { schema });
  }
  return globalForDb.__feDb;
}

export async function closeDb() {
  await globalForDb.__fePool?.end();
  globalForDb.__fePool = undefined;
  globalForDb.__feDb = undefined;
}

export { schema };
