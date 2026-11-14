/**
 * Emergency parent account recovery for when both parents are locked out.
 * Protected by RECOVERY_TOKEN, a secret that exists only in the hosting settings
 * (so only someone with access to the Vercel account can use it). Rate limited,
 * audited, and every other parent is notified.
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { householdMember, loginAttempt, session, user } from "@/db/schema";
import { DomainError, audit, notifyParents } from "./core";
import { hashPassword, validatePassword } from "./passwords";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 60;

export function recoveryEnabled() {
  return !!process.env.RECOVERY_TOKEN && process.env.RECOVERY_TOKEN.length >= 12;
}

function codeMatches(given: string) {
  const want = process.env.RECOVERY_TOKEN ?? "";
  const a = Buffer.from(given.trim());
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function recoverParentAccount(input: { code: string; username: string; password: string }) {
  if (!recoveryEnabled()) throw new DomainError("Account recovery isn't switched on. Add RECOVERY_TOKEN in your hosting settings first.");
  const db = getDb();
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const recent = await db
    .select({ id: loginAttempt.id })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.username, "__recovery__"), eq(loginAttempt.success, false), gt(loginAttempt.createdAt, since)));
  if (recent.length >= MAX_ATTEMPTS) throw new DomainError(`Too many attempts. Please wait an hour and try again.`);

  const ok = codeMatches(input.code ?? "");
  const username = (input.username ?? "").trim().toLowerCase();
  const [row] = ok
    ? await db
        .select({ u: user, m: householdMember })
        .from(user)
        .innerJoin(householdMember, eq(householdMember.userId, user.id))
        .where(eq(user.username, username))
    : [];
  const valid = ok && row && row.m.role === "PARENT" && !row.m.archivedAt;
  await db.insert(loginAttempt).values({ username: "__recovery__", ip, success: !!valid });
  if (!valid) throw new DomainError("That recovery code or parent username isn't right.");

  validatePassword(input.password);
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx.update(user).set({ passwordHash, mustChangePassword: false }).where(eq(user.id, row.u.id));
    await tx.delete(session).where(eq(session.userId, row.u.id));
    await audit(tx, { householdId: row.m.householdId, memberId: row.m.id }, "member.password_recovered", "HouseholdMember", row.m.id, { ip });
    await notifyParents(
      tx,
      row.m.householdId,
      "A parent password was reset with the recovery code",
      `${row.m.displayName}'s password was reset. If this wasn't you, change the RECOVERY_TOKEN in your hosting settings.`,
    );
  });
}
