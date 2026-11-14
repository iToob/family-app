/**
 * The database connection string. Vercel's Neon integration names it after the prefix
 * chosen when connecting (DATABASE_URL, STORAGE_URL, POSTGRES_URL...), so accept the
 * common names rather than making setup depend on typing the prefix exactly.
 */
export function databaseUrl(): string | undefined {
  const names = ["DATABASE_URL", "POSTGRES_URL", "STORAGE_URL", "NEON_DATABASE_URL", "DATABASE_POSTGRES_URL"];
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  // Any other <PREFIX>_URL that looks like a Postgres URL.
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith("_URL") && v && /^postgres(ql)?:\/\//.test(v) && !k.includes("UNPOOLED")) return v;
  }
  return undefined;
}
