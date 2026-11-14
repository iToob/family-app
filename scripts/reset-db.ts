/**
 * DESTRUCTIVE: drops every table and re-runs migrations. For local development only.
 * Refuses to run when NODE_ENV=production unless FORCE_RESET=yes.
 */
import { Client } from "pg";
import { execSync } from "node:child_process";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.FORCE_RESET !== "yes") throw new Error("Refusing to reset a production database.");
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await c.end();
  execSync("npx tsx scripts/migrate.ts", { stdio: "inherit" });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
