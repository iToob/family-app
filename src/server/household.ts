/**
 * Household setup, members, participation, charter, settings, disputes, notifications
 * and scheduled maintenance.
 */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import {
  category,
  charterAcknowledgement,
  charterVersion,
  dispute,
  economySetting,
  household,
  householdMember,
  loginAttempt,
  notification,
  session,
  user,
} from "@/db/schema";
import { hashPassword, validatePassword, validateUsername } from "./passwords";
import {
  type Actor,
  DomainError,
  audit,
  getMemberInHousehold,
  getSettings,
  notify,
  notifyParents,
  requireRole,
} from "./core";
import { applyParticipationToSubscriptions, expireEntitlements, processDueSubscriptions } from "./marketplace";
import { ensureAllOccurrences } from "./jobs";
import { DEFAULT_CHARTER } from "./charter-default";

export const DEFAULT_JOB_CATEGORIES = [
  ["Household", "🏠"],
  ["Cooking", "🍳"],
  ["Garden & Outdoor", "🌿"],
  ["Vehicles", "🚗"],
  ["Projects", "🛠️"],
  ["Helping Others", "🤝"],
  ["Pets", "🐾"],
] as const;

export const DEFAULT_MARKET_CATEGORIES = [
  ["Phone & Technology", "📱"],
  ["Internet & Entertainment", "📺"],
  ["Food & Treats", "🍫"],
  ["Transport", "🚗"],
  ["Activities & Outings", "🎟️"],
  ["Clothing & Personal Purchases", "👕"],
  ["Other Privileges", "⭐"],
] as const;

const COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#dc2626"];

export async function householdExists(db: DB) {
  const rows = await db.select({ id: household.id }).from(household).limit(1);
  return rows.length > 0;
}

/**
 * Create a household and its first parent. Only allowed when no household exists yet
 * (this deployment serves one family) and, in production, with the SETUP_TOKEN.
 */
export async function setupHousehold(
  db: DB,
  input: {
    householdName: string;
    timezone?: string;
    centsPerPoint: number;
    parent: { displayName: string; username: string; password: string };
    isDemo?: boolean;
  },
) {
  validateUsername(input.parent.username);
  validatePassword(input.parent.password);
  if (!Number.isSafeInteger(input.centsPerPoint) || input.centsPerPoint < 1 || input.centsPerPoint > 10_000) {
    throw new DomainError("Exchange rate must be a whole number of cents per Point.");
  }
  const passwordHash = await hashPassword(input.parent.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE household IN EXCLUSIVE MODE`);
    const existing = await tx.select({ id: household.id }).from(household).limit(1);
    if (existing[0]) throw new DomainError("This app has already been set up.");
    const [h] = await tx
      .insert(household)
      .values({ name: input.householdName.trim(), timezone: input.timezone || "Australia/Brisbane", isDemo: !!input.isDemo })
      .returning();
    await tx.insert(economySetting).values({ householdId: h.id, centsPerPoint: input.centsPerPoint });
    let i = 0;
    for (const [name, icon] of DEFAULT_JOB_CATEGORIES) {
      await tx.insert(category).values({ householdId: h.id, kind: "JOB", name, icon, sortOrder: i++ });
    }
    i = 0;
    for (const [name, icon] of DEFAULT_MARKET_CATEGORIES) {
      await tx.insert(category).values({ householdId: h.id, kind: "MARKET", name, icon, sortOrder: i++ });
    }
    const [u] = await tx
      .insert(user)
      .values({ username: input.parent.username.trim().toLowerCase(), passwordHash })
      .returning();
    const [m] = await tx
      .insert(householdMember)
      .values({
        householdId: h.id,
        userId: u.id,
        displayName: input.parent.displayName.trim(),
        role: "PARENT",
        participationStatus: "ACTIVE",
        avatarColor: COLORS[0],
      })
      .returning();
    await tx.insert(charterVersion).values({
      householdId: h.id,
      version: 1,
      title: "Our Family Economy Charter",
      body: DEFAULT_CHARTER,
      changeSummary: "First version",
      publishedById: m.id,
    });
    await audit(tx, { householdId: h.id, memberId: m.id }, "household.setup", "Household", h.id, {
      name: h.name,
      centsPerPoint: input.centsPerPoint,
    });
    return { household: h, member: m, user: u };
  });
}

export async function addMember(
  db: DB,
  actor: Actor,
  input: { displayName: string; username: string; password: string; role: "PARENT" | "CHILD" },
) {
  requireRole(actor, "PARENT");
  validateUsername(input.username);
  validatePassword(input.password);
  if (!input.displayName?.trim()) throw new DomainError("Enter a name.");
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const uname = input.username.trim().toLowerCase();
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.username, uname));
    if (taken) throw new DomainError("That username is taken.");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(householdMember)
      .where(eq(householdMember.householdId, actor.householdId));
    const [u] = await tx.insert(user).values({ username: uname, passwordHash, mustChangePassword: true }).returning();
    const [m] = await tx
      .insert(householdMember)
      .values({
        householdId: actor.householdId,
        userId: u.id,
        displayName: input.displayName.trim(),
        role: input.role,
        participationStatus: input.role === "PARENT" ? "ACTIVE" : "NOT_PARTICIPATING",
        avatarColor: COLORS[n % COLORS.length],
      })
      .returning();
    await audit(tx, actor, "member.add", "HouseholdMember", m.id, { name: m.displayName, role: m.role, username: uname });
    return m;
  });
}

export async function updateMember(
  db: DB,
  actor: Actor,
  memberId: string,
  input: { displayName?: string; avatarColor?: string; archived?: boolean },
) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const m = await getMemberInHousehold(tx, actor.householdId, memberId);
    if (input.archived && m.id === actor.memberId) throw new DomainError("You can't archive your own account.");
    await tx
      .update(householdMember)
      .set({
        ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
        ...(input.avatarColor ? { avatarColor: input.avatarColor } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      })
      .where(eq(householdMember.id, memberId));
    if (input.archived) await tx.delete(session).where(eq(session.userId, m.userId));
    await audit(tx, actor, input.archived ? "member.archive" : "member.update", "HouseholdMember", memberId, input);
  });
}

/** Parent-controlled account recovery: set a temporary password the user must change. */
export async function resetMemberPassword(db: DB, actor: Actor, memberId: string, tempPassword: string) {
  requireRole(actor, "PARENT");
  validatePassword(tempPassword);
  const hash = await hashPassword(tempPassword);
  return db.transaction(async (tx) => {
    const m = await getMemberInHousehold(tx, actor.householdId, memberId);
    await tx.update(user).set({ passwordHash: hash, mustChangePassword: m.id !== actor.memberId }).where(eq(user.id, m.userId));
    await tx.delete(session).where(eq(session.userId, m.userId));
    await audit(tx, actor, "member.password_reset", "HouseholdMember", memberId);
    if (m.role === "PARENT" && m.id !== actor.memberId) {
      await notifyParents(tx, actor.householdId, `${actor.displayName} reset ${m.displayName}'s password`, "If this wasn't expected, check the audit log.", "/admin/economy/audit");
    }
  });
}

// ─────────────── Participation and charter ───────────────

export async function latestCharter(db: DB | Tx, householdId: string) {
  const [c] = await db
    .select()
    .from(charterVersion)
    .where(eq(charterVersion.householdId, householdId))
    .orderBy(desc(charterVersion.version))
    .limit(1);
  return c ?? null;
}

/** Latest charter version that requires acknowledgement (the newest "significant" one). */
export async function latestSignificantCharter(db: DB | Tx, householdId: string) {
  const [c] = await db
    .select()
    .from(charterVersion)
    .where(and(eq(charterVersion.householdId, householdId), eq(charterVersion.significant, true)))
    .orderBy(desc(charterVersion.version))
    .limit(1);
  return c ?? null;
}

export async function publishCharter(
  db: DB,
  actor: Actor,
  input: { title: string; body: string; changeSummary?: string; significant: boolean },
) {
  requireRole(actor, "PARENT");
  if (!input.body?.trim() || !input.title?.trim()) throw new DomainError("The charter needs a title and text.");
  return db.transaction(async (tx) => {
    const current = await latestCharter(tx, actor.householdId);
    const [v] = await tx
      .insert(charterVersion)
      .values({
        householdId: actor.householdId,
        version: (current?.version ?? 0) + 1,
        title: input.title.trim(),
        body: input.body,
        changeSummary: input.changeSummary?.trim() || null,
        significant: input.significant,
        publishedById: actor.memberId,
      })
      .returning();
    await audit(tx, actor, "charter.publish", "CharterVersion", v.id, {
      version: v.version,
      significant: v.significant,
      changeSummary: v.changeSummary,
    });
    const kids = await tx
      .select({ id: householdMember.id })
      .from(householdMember)
      .where(and(eq(householdMember.householdId, actor.householdId), eq(householdMember.role, "CHILD"), isNull(householdMember.archivedAt)));
    for (const k of kids) {
      await notify(
        tx,
        actor.householdId,
        k.id,
        `Family charter updated (v${v.version})`,
        v.significant ? "Please read and acknowledge the new version." : (v.changeSummary ?? "Minor update."),
        "/more/charter",
      );
    }
    return v;
  });
}

/**
 * A child acknowledges a charter version and, separately, chooses whether to participate.
 * Acknowledgement is a record of understanding, not a legal contract.
 */
export async function acknowledgeCharter(
  db: DB,
  actor: Actor,
  charterVersionId: string,
  choice: "ACTIVE" | "NOT_PARTICIPATING",
) {
  requireRole(actor, "CHILD");
  return db.transaction(async (tx) => {
    const [v] = await tx
      .select()
      .from(charterVersion)
      .where(and(eq(charterVersion.id, charterVersionId), eq(charterVersion.householdId, actor.householdId)));
    if (!v) throw new DomainError("Charter not found.");
    await tx
      .insert(charterAcknowledgement)
      .values({ charterVersionId: v.id, memberId: actor.memberId, participationChoice: choice })
      .onConflictDoUpdate({
        target: [charterAcknowledgement.charterVersionId, charterAcknowledgement.memberId],
        set: { participationChoice: choice, acknowledgedAt: new Date(), effectiveAt: new Date() },
      });
    await setParticipationInternal(tx, actor, actor.memberId, choice);
    await audit(tx, actor, "charter.acknowledge", "CharterVersion", v.id, { version: v.version, choice });
  });
}

async function setParticipationInternal(tx: Tx, actor: Actor, memberId: string, status: "ACTIVE" | "PAUSED" | "NOT_PARTICIPATING") {
  const m = await getMemberInHousehold(tx, actor.householdId, memberId);
  if (m.role !== "CHILD") throw new DomainError("Only participant accounts have a participation status.");
  if (m.participationStatus === status) return;
  if (status === "ACTIVE") {
    const required = await latestSignificantCharter(tx, actor.householdId);
    if (required) {
      const [ack] = await tx
        .select()
        .from(charterAcknowledgement)
        .where(and(eq(charterAcknowledgement.charterVersionId, required.id), eq(charterAcknowledgement.memberId, memberId)));
      if (!ack && actor.role === "CHILD") throw new DomainError("Please read and acknowledge the current charter first.");
    }
  }
  await tx.update(householdMember).set({ participationStatus: status }).where(eq(householdMember.id, memberId));
  await applyParticipationToSubscriptions(tx, actor.householdId, memberId, status);
  await audit(tx, actor, "participation.change", "HouseholdMember", memberId, { from: m.participationStatus, to: status });
  if (actor.role === "CHILD") {
    await notifyParents(tx, actor.householdId, `${m.displayName}: participation ${status.toLowerCase().replace("_", " ")}`);
  } else {
    await notify(tx, actor.householdId, memberId, `Your participation is now ${status.toLowerCase().replace("_", " ")}`, `Changed by ${actor.displayName}.`, "/more");
  }
}

/** Pause, resume or leave. Balances and history are never touched. */
export async function setParticipation(db: DB, actor: Actor, memberId: string, status: "ACTIVE" | "PAUSED" | "NOT_PARTICIPATING") {
  if (actor.role === "CHILD" && memberId !== actor.memberId) throw new DomainError("Not allowed.", "FORBIDDEN");
  return db.transaction((tx) => setParticipationInternal(tx, actor, memberId, status));
}

// ─────────────── Settings ───────────────

export type SettingsInput = Partial<{
  householdName: string;
  centsPerPoint: number;
  minCashOutPoints: number;
  maxCashOutPoints: number | null;
  cashOutMethods: string[];
  payoutSchedule: string;
  weeklyBudgetPoints: number | null;
  monthlyBudgetPoints: number | null;
  subscriptionGraceDays: number;
  pauseSubscriptionsOnPause: boolean;
  correctionsNeedSecondParent: boolean;
  childRequestsEnabled: boolean;
  rewardGuidelines: string;
}>;

export async function updateSettings(db: DB, actor: Actor, input: SettingsInput) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(household).where(eq(household.id, actor.householdId)).for("update");
    const before = await getSettings(tx, actor.householdId);
    const { householdName, ...rest } = input;
    if (rest.centsPerPoint !== undefined && rest.centsPerPoint !== before.centsPerPoint) {
      if (!Number.isSafeInteger(rest.centsPerPoint) || rest.centsPerPoint < 1) throw new DomainError("Invalid exchange rate.");
      if (h.activatedAt && rest.centsPerPoint < before.centsPerPoint) {
        throw new DomainError(
          "The economy is live, so the exchange rate can't be lowered. That would devalue Points the kids have already earned.",
        );
      }
    }
    for (const k of ["minCashOutPoints", "subscriptionGraceDays"] as const) {
      if (rest[k] !== undefined && (!Number.isSafeInteger(rest[k]) || rest[k]! < 0)) throw new DomainError("Enter whole numbers.");
    }
    if (householdName?.trim()) await tx.update(household).set({ name: householdName.trim() }).where(eq(household.id, h.id));
    await tx.update(economySetting).set(rest).where(eq(economySetting.householdId, actor.householdId));
    const changed = Object.fromEntries(
      Object.entries(rest).filter(([k, v]) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify(v)),
    );
    if (Object.keys(changed).length || householdName) {
      await audit(tx, actor, "settings.update", "EconomySetting", before.id, {
        before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: changed,
      });
    }
    if (rest.centsPerPoint !== undefined && rest.centsPerPoint !== before.centsPerPoint && h.activatedAt) {
      const kids = await tx
        .select({ id: householdMember.id })
        .from(householdMember)
        .where(and(eq(householdMember.householdId, h.id), eq(householdMember.role, "CHILD")));
      for (const k of kids) {
        await notify(tx, h.id, k.id, "Points are now worth more", `New rate: ${rest.centsPerPoint} cents per Point.`, "/wallet");
      }
    }
  });
}

/** Go live. After this the exchange rate can only be raised, never lowered. */
export async function activateEconomy(db: DB, actor: Actor) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const [h] = await tx.select().from(household).where(eq(household.id, actor.householdId)).for("update");
    if (h.activatedAt) return;
    await tx.update(household).set({ activatedAt: new Date() }).where(eq(household.id, h.id));
    const s = await getSettings(tx, h.id);
    await audit(tx, actor, "economy.activate", "Household", h.id, { centsPerPoint: s.centsPerPoint });
  });
}

export async function upsertCategory(
  db: DB,
  actor: Actor,
  input: { id?: string; kind: "JOB" | "MARKET"; name: string; icon?: string; archived?: boolean },
) {
  requireRole(actor, "PARENT");
  if (!input.name?.trim()) throw new DomainError("Enter a category name.");
  return db.transaction(async (tx) => {
    if (input.id) {
      await tx
        .update(category)
        .set({
          name: input.name.trim(),
          icon: input.icon || "•",
          archivedAt: input.archived ? new Date() : null,
        })
        .where(and(eq(category.id, input.id), eq(category.householdId, actor.householdId)));
    } else {
      await tx
        .insert(category)
        .values({ householdId: actor.householdId, kind: input.kind, name: input.name.trim(), icon: input.icon || "•", sortOrder: 99 })
        .onConflictDoNothing();
    }
    await audit(tx, actor, "category.save", "Category", input.id ?? null, input);
  });
}

// ─────────────── Disputes ───────────────

export async function submitDispute(
  db: DB,
  actor: Actor,
  input: { subjectType: string; subjectRef?: string | null; subjectLabel?: string | null; explanation: string },
) {
  requireRole(actor, "CHILD");
  if (!input.explanation?.trim()) throw new DomainError("Explain what you'd like reviewed.");
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(dispute)
      .values({ householdId: actor.householdId, memberId: actor.memberId, ...input, explanation: input.explanation.trim() })
      .returning();
    await audit(tx, actor, "dispute.submit", "Dispute", d.id, input);
    await notifyParents(tx, actor.householdId, `${actor.displayName} asked for a review`, input.subjectLabel ?? input.subjectType, "/admin/approvals");
    return d;
  });
}

export async function resolveDispute(db: DB, actor: Actor, id: string, outcome: string) {
  requireRole(actor, "PARENT");
  if (!outcome?.trim()) throw new DomainError("Record the outcome.");
  return db.transaction(async (tx) => {
    const [d] = await tx
      .select()
      .from(dispute)
      .where(and(eq(dispute.id, id), eq(dispute.householdId, actor.householdId)))
      .for("update");
    if (!d) throw new DomainError("Review request not found.", "NOT_FOUND");
    if (d.status !== "OPEN") throw new DomainError("This review is already resolved.", "STALE");
    await tx
      .update(dispute)
      .set({ status: "RESOLVED", outcome: outcome.trim(), resolvedById: actor.memberId, resolvedAt: new Date() })
      .where(eq(dispute.id, id));
    await audit(tx, actor, "dispute.resolve", "Dispute", id, { outcome });
    await notify(tx, actor.householdId, d.memberId, "Your review request was answered", outcome.trim(), "/more/disputes");
  });
}

// ─────────────── Notifications ───────────────

export async function markNotificationsRead(db: DB, actor: Actor, id?: string) {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.memberId, actor.memberId),
        isNull(notification.readAt),
        ...(id ? [eq(notification.id, id)] : []),
      ),
    );
}

// ─────────────── Maintenance (scheduled job) ───────────────

/**
 * Idempotent housekeeping: generate recurring job occurrences, expire old ones, bill
 * due subscriptions and expire entitlements. Run daily by cron, on parent dashboard
 * load, and manually from the Economy screen. Safe to run concurrently or repeatedly.
 */
export async function runMaintenance(db: DB, householdId: string, now = new Date()) {
  const [h] = await db.select().from(household).where(eq(household.id, householdId));
  if (!h) throw new DomainError("Household not found.");
  await db.transaction(async (tx) => {
    // Serialise concurrent maintenance runs for a household.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"maint:" + householdId}))`);
    await ensureAllOccurrences(tx, householdId, h.timezone, now);
    // Keep login-attempt records only as long as rate limiting needs them (plus a margin).
    await tx.delete(loginAttempt).where(lt(loginAttempt.createdAt, new Date(now.getTime() - 30 * 86_400_000)));
    await expireEntitlements(tx, householdId, now);
  });
  const billing = await processDueSubscriptions(db, householdId, now);
  await db.update(economySetting).set({ lastMaintenanceAt: now }).where(eq(economySetting.householdId, householdId));
  return billing;
}

export async function runMaintenanceAll(db: DB, now = new Date()) {
  const hs = await db.select({ id: household.id }).from(household);
  const results: Record<string, unknown> = {};
  for (const h of hs) results[h.id] = await runMaintenance(db, h.id, now);
  return results;
}
