/** Apply all pending SQL migrations in ./drizzle. Safe to run repeatedly. */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "../src/db";
import { databaseUrl } from "../src/lib/db-url";

async function main() {
  if (!databaseUrl()) {
    // Lets the first build succeed before a database is connected; the next deploy migrates.
    console.warn("DATABASE_URL not set: skipping migrations.");
    return;
  }
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
