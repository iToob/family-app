/**
 * Emergency account recovery from the server (e.g. both parents locked out).
 * Usage: npm run admin:reset-password -- <username> <new-password>
 */
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db";
import { session, user } from "../src/db/schema";
import { hashPassword, validatePassword } from "../src/server/passwords";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) throw new Error("Usage: npm run admin:reset-password -- <username> <new-password>");
  validatePassword(password);
  const db = getDb();
  const [u] = await db.select().from(user).where(eq(user.username, username.toLowerCase()));
  if (!u) throw new Error(`No user called ${username}`);
  await db.update(user).set({ passwordHash: await hashPassword(password), mustChangePassword: true }).where(eq(user.id, u.id));
  await db.delete(session).where(eq(session.userId, u.id));
  console.log(`Password reset for ${username}. They'll be asked to choose a new one at sign-in.`);
}
main().then(closeDb).catch(async (e) => { console.error(e.message ?? e); await closeDb(); process.exit(1); });
