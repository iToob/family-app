import { execSync } from "node:child_process";

export default async function setup() {
  const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL_E2E ?? "postgresql://postgres:postgres@localhost:5432/family_economy_e2e" };
  execSync("npx tsx scripts/reset-db.ts", { env, stdio: "inherit" });
  execSync("npx tsx scripts/seed-demo.ts", { env, stdio: "inherit" });
}
