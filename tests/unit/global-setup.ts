import { Client } from "pg";
import { execSync } from "node:child_process";

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/family_economy_test";
  process.env.DATABASE_URL = url;
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await c.end();
  execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
