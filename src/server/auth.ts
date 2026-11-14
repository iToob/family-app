/**
 * Username/password authentication with Argon2id hashes and server-side sessions.
 * The session cookie holds a random token; only its SHA-256 is stored, so a database
 * leak can't be replayed as a login.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { economySetting, household, householdMember, loginAttempt, session, user } from "@/db/schema";
import { type Actor, DomainError } from "./core";
import { burnPasswordCheck, hashPassword, validatePassword, verifyPassword } from "./passwords";

export const SESSION_COOKIE = "fe_session";
export const PREVIEW_COOKIE = "fe_preview";
const SESSION_DAYS = 30;
const MAX_FAILURES_PER_USER = 5;
const MAX_FAILURES_PER_IP = 20;
const WINDOW_MINUTES = 15;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function login(usernameRaw: string, password: string) {
  const db = getDb();
  const username = (usernameRaw ?? "").trim().toLowerCase();
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const recent = await db
    .select({ username: loginAttempt.username, ip: loginAttempt.ip })
    .from(loginAttempt)
    .where(and(gt(loginAttempt.createdAt, since), eq(loginAttempt.success, false)));
  const userFails = recent.filter((r) => r.username === username).length;
  const ipFails = recent.filter((r) => r.ip === ip).length;
  if (userFails >= MAX_FAILURES_PER_USER || ipFails >= MAX_FAILURES_PER_IP) {
    throw new DomainError(`Too many attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`);
  }

  const [u] = await db.select().from(user).where(eq(user.username, username));
  let ok = false;
  if (u) ok = await verifyPassword(u.passwordHash, password);
  else await burnPasswordCheck(password);

  let member = null;
  if (ok && u) {
    [member] = await db
      .select()
      .from(householdMember)
      .where(and(eq(householdMember.userId, u.id), isNull(householdMember.archivedAt)));
    if (!member) ok = false;
  }
  await db.insert(loginAttempt).values({ username, ip, success: ok });
  if (!ok || !u) throw new DomainError("Incorrect username or password.");

  const token = randomBytes(32).toString("base64url");
  await db.insert(session).values({
    id: sha256(token),
    userId: u.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return { mustChangePassword: u.mustChangePassword, role: member!.role };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(session).where(eq(session.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
  jar.delete(PREVIEW_COOKIE);
}

export type SessionInfo = {
  actor: Actor;
  userId: string;
  username: string;
  mustChangePassword: boolean;
  householdName: string;
  timezone: string;
  isDemo: boolean;
  childRequestsEnabled: boolean;
  centsPerPoint: number;
};

/** The current signed-in member, or null. Cached for the duration of a request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const rows = await db
    .select({ s: session, u: user, m: householdMember, h: household, st: economySetting })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .innerJoin(householdMember, eq(householdMember.userId, user.id))
    .innerJoin(household, eq(householdMember.householdId, household.id))
    .innerJoin(economySetting, eq(economySetting.householdId, household.id))
    .where(and(eq(session.id, sha256(token)), gt(session.expiresAt, new Date()), isNull(householdMember.archivedAt)));
  const r = rows[0];
  if (!r) return null;
  const settings = r.st;
  return {
    actor: { householdId: r.h.id, memberId: r.m.id, role: r.m.role, displayName: r.m.displayName },
    userId: r.u.id,
    username: r.u.username,
    mustChangePassword: r.u.mustChangePassword,
    householdName: r.h.name,
    timezone: r.h.timezone,
    isDemo: r.h.isDemo,
    childRequestsEnabled: settings.childRequestsEnabled,
    centsPerPoint: settings.centsPerPoint,
  };
});

/** For pages: require a signed-in member, redirecting to login otherwise. */
export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mustChangePassword) redirect("/change-password");
  return s;
}

export async function requireParentSession() {
  const s = await requireSession();
  if (s.actor.role !== "PARENT") redirect("/home");
  return s;
}

/**
 * The participant whose screens are being shown. For a child that's themselves. For a
 * parent it's the child they chose to preview, always read-only.
 */
export type Viewer = SessionInfo & {
  householdId: string;
  subjectId: string;
  subjectName: string;
  readOnly: boolean;
  previewing: boolean;
};

export async function requireViewer(): Promise<Viewer> {
  const s = await requireSession();
  if (s.actor.role === "CHILD") {
    return {
      ...s,
      householdId: s.actor.householdId,
      subjectId: s.actor.memberId,
      subjectName: s.actor.displayName,
      readOnly: !s.childRequestsEnabled,
      previewing: false,
    };
  }
  const jar = await cookies();
  const previewId = jar.get(PREVIEW_COOKIE)?.value;
  if (previewId) {
    const [m] = await getDb()
      .select()
      .from(householdMember)
      .where(and(eq(householdMember.id, previewId), eq(householdMember.householdId, s.actor.householdId), eq(householdMember.role, "CHILD")));
    if (m) return { ...s, householdId: s.actor.householdId, subjectId: m.id, subjectName: m.displayName, readOnly: true, previewing: true };
  }
  redirect("/admin");
}

/** For server actions: the verified actor, or an error. */
export async function actorOrThrow(): Promise<Actor> {
  const s = await getSession();
  if (!s) throw new DomainError("Please sign in again.", "UNAUTHENTICATED");
  return s.actor;
}

export async function changeOwnPassword(current: string, next: string) {
  const s = await getSession();
  if (!s) throw new DomainError("Please sign in again.");
  validatePassword(next);
  const db = getDb();
  const [u] = await db.select().from(user).where(eq(user.id, s.userId));
  if (!(await verifyPassword(u.passwordHash, current))) throw new DomainError("Your current password is incorrect.");
  if (current === next) throw new DomainError("Choose a new password that's different from the old one.");
  await db.update(user).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(user.id, u.id));
  // Sign out other devices; keep this one.
  const jar = await cookies();
  const keep = sha256(jar.get(SESSION_COOKIE)?.value ?? "");
  const all = await db.select({ id: session.id }).from(session).where(eq(session.userId, u.id));
  for (const x of all) if (x.id !== keep) await db.delete(session).where(eq(session.id, x.id));
}
