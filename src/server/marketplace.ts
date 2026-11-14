/**
 * Marketplace purchases, fulfilment, refunds, entitlements and recurring subscriptions.
 */
import { and, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db";
import {
  category,
  entitlement,
  household,
  householdMember,
  marketplaceItem,
  purchase,
  subscription,
  subscriptionBillingRecord,
} from "@/db/schema";
import { addDays, localDate, nextPeriod, startOfLocalDate, startOfMonth, startOfWeek } from "@/lib/time";
import {
  type Actor,
  DomainError,
  assertMayRequest,
  assertPositiveInt,
  audit,
  captureHold,
  createHold,
  getBalances,
  getHousehold,
  getMemberInHousehold,
  getSettings,
  insufficientMessage,
  lockMember,
  notify,
  notifyParents,
  postEntry,
  releaseHold,
  requireRole,
} from "./core";

export type ItemInput = {
  name: string;
  description?: string;
  categoryId?: string | null;
  pricePoints: number;
  icon?: string;
  imageUrl?: string | null;
  available?: boolean;
  perPersonLimit?: number | null;
  limitPeriod?: "DAY" | "WEEK" | "MONTH" | "EVER";
  requiresApproval?: boolean;
  fulfilmentType?: "NONE" | "MANUAL" | "ENTITLEMENT";
  entitlementDays?: number | null;
  isSubscription?: boolean;
  billingFrequency?: "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | null;
  refundable?: boolean;
};

function validateItem(input: Partial<ItemInput>) {
  if (input.pricePoints !== undefined) assertPositiveInt(input.pricePoints, "Price", 1_000_000);
  if (input.isSubscription && !input.billingFrequency) throw new DomainError("Choose a billing frequency for a subscription.");
  if (input.fulfilmentType === "ENTITLEMENT" && !input.isSubscription) {
    assertPositiveInt(input.entitlementDays, "Privilege duration (days)", 366);
  }
}

export async function createItem(db: DB, actor: Actor, input: ItemInput) {
  requireRole(actor, "PARENT");
  if (!input.name?.trim()) throw new DomainError("A name is required.");
  validateItem(input);
  return db.transaction(async (tx) => {
    if (input.categoryId) {
      const [c] = await tx
        .select()
        .from(category)
        .where(and(eq(category.id, input.categoryId), eq(category.householdId, actor.householdId), eq(category.kind, "MARKET")));
      if (!c) throw new DomainError("Unknown category.");
    }
    const [item] = await tx
      .insert(marketplaceItem)
      .values({
        ...input,
        name: input.name.trim(),
        householdId: actor.householdId,
        billingFrequency: input.isSubscription ? input.billingFrequency : null,
      })
      .returning();
    await audit(tx, actor, "item.create", "MarketplaceItem", item.id, { name: item.name, price: item.pricePoints });
    return item;
  });
}

export async function updateItem(db: DB, actor: Actor, id: string, input: Partial<ItemInput> & { archived?: boolean }) {
  requireRole(actor, "PARENT");
  validateItem(input);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(marketplaceItem)
      .where(and(eq(marketplaceItem.id, id), eq(marketplaceItem.householdId, actor.householdId)))
      .for("update");
    if (!before) throw new DomainError("Item not found.", "NOT_FOUND");
    const { archived, ...rest } = input;
    const [item] = await tx
      .update(marketplaceItem)
      .set({
        ...rest,
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
        ...(rest.isSubscription === false ? { billingFrequency: null } : {}),
      })
      .where(eq(marketplaceItem.id, id))
      .returning();
    await audit(tx, actor, archived ? "item.archive" : "item.update", "MarketplaceItem", id, {
      before: { price: before.pricePoints, name: before.name },
      changes: input,
    });
    return item;
  });
}

async function periodStartFor(tx: Tx, householdId: string, period: "DAY" | "WEEK" | "MONTH" | "EVER", now: Date) {
  const h = await getHousehold(tx, householdId);
  const today = localDate(now, h.timezone);
  if (period === "EVER") return new Date(0);
  if (period === "DAY") return startOfLocalDate(today, h.timezone);
  if (period === "WEEK") return startOfLocalDate(startOfWeek(today), h.timezone);
  return startOfLocalDate(startOfMonth(today), h.timezone);
}

/**
 * A child requests a purchase. Either completes immediately (pre-authorised item) or
 * reserves the Points pending parental approval. Never creates a negative balance.
 */
export async function requestPurchase(
  db: DB,
  actor: Actor,
  itemId: string,
  idempotencyKey: string,
  note?: string,
  /** Parents record a purchase on a child's behalf; it is approved by them immediately. */
  forMemberId?: string,
) {
  const byParent = actor.role === "PARENT";
  if (byParent && !forMemberId) throw new DomainError("Choose who this purchase is for.");
  const memberId = byParent ? forMemberId! : actor.memberId;
  if (!idempotencyKey || idempotencyKey.length < 8) throw new DomainError("Missing request key. Please reload and try again.");
  const result = await db.transaction(async (tx) => {
    await assertMayRequest(tx, actor);
    const me = await lockMember(tx, actor.householdId, memberId);
    if (me.role !== "CHILD") throw new DomainError("Purchases are for participant accounts.");
    // Idempotency: a retried submission returns the original purchase.
    const [dupe] = await tx.select().from(purchase).where(eq(purchase.idempotencyKey, `${memberId}:${idempotencyKey}`));
    if (dupe) return { purchase: dupe, duplicate: true };

    if (me.participationStatus === "NOT_PARTICIPATING" && !byParent) {
      throw new DomainError("Join the Family Economy to use the marketplace.");
    }
    const [item] = await tx
      .select()
      .from(marketplaceItem)
      .where(and(eq(marketplaceItem.id, itemId), eq(marketplaceItem.householdId, actor.householdId)));
    if (!item || item.archivedAt || !item.available) throw new DomainError("This item isn't available.");
    if (item.isSubscription && me.participationStatus !== "ACTIVE" && !byParent) {
      throw new DomainError("Resume participation to start a new subscription.");
    }

    if (item.perPersonLimit) {
      const since = await periodStartFor(tx, actor.householdId, item.limitPeriod, new Date());
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(purchase)
        .where(
          and(
            eq(purchase.memberId, memberId),
            eq(purchase.itemId, item.id),
            gte(purchase.requestedAt, since),
            notInArray(purchase.status, ["REJECTED", "CANCELLED", "REFUNDED"]),
          ),
        );
      if (n >= item.perPersonLimit) {
        const per = { DAY: "per day", WEEK: "per week", MONTH: "per month", EVER: "in total" }[item.limitPeriod];
        throw new DomainError(`The limit for this item is ${item.perPersonLimit} ${per}.`);
      }
    }
    if (item.isSubscription) {
      const live = await tx
        .select({ id: subscription.id })
        .from(subscription)
        .where(and(eq(subscription.memberId, memberId), eq(subscription.itemId, item.id), sql`${subscription.status} <> 'CANCELLED'`));
      const pendingReq = await tx
        .select({ id: purchase.id })
        .from(purchase)
        .where(and(eq(purchase.memberId, memberId), eq(purchase.itemId, item.id), eq(purchase.status, "REQUESTED")));
      if (live[0] || pendingReq[0]) throw new DomainError("You already have this subscription.");
    }

    const bal = await getBalances(tx, memberId);
    if (bal.available < item.pricePoints) throw new DomainError(insufficientMessage(item.pricePoints, bal.available), "INSUFFICIENT");

    const [{ receipt }] = await tx
      .update(household)
      .set({ nextReceiptNumber: sql`${household.nextReceiptNumber} + 1` })
      .where(eq(household.id, actor.householdId))
      .returning({ receipt: sql<number>`${household.nextReceiptNumber} - 1` });

    const [p] = await tx
      .insert(purchase)
      .values({
        householdId: actor.householdId,
        memberId,
        itemId: item.id,
        itemName: item.name,
        pricePoints: item.pricePoints,
        receiptNumber: receipt,
        idempotencyKey: `${memberId}:${idempotencyKey}`,
        note: note?.trim() || null,
      })
      .returning();
    await audit(tx, actor, "purchase.request", "Purchase", p.id, { item: item.name, points: item.pricePoints });

    if (item.requiresApproval && !byParent) {
      await createHold(tx, {
        householdId: actor.householdId,
        memberId: memberId,
        points: item.pricePoints,
        sourceType: "PURCHASE",
        sourceId: p.id,
        description: `Awaiting approval: ${item.name}`,
      });
      await notifyParents(tx, actor.householdId, `${actor.displayName} wants "${item.name}"`, `${item.pricePoints} Points reserved, awaiting approval.`, "/admin/approvals");
      return { purchase: p, duplicate: false };
    }
    const done = await completePurchase(tx, p, item, byParent ? actor.memberId : null);
    if (byParent) {
      await notify(tx, actor.householdId, memberId, `${actor.displayName} recorded a purchase`, `${item.name}: ${item.pricePoints} Points. Receipt #${p.receiptNumber}.`, `/spend/receipt/${p.id}`);
      return { purchase: done, duplicate: false };
    }
    await notifyParents(
      tx,
      actor.householdId,
      `${actor.displayName} bought "${item.name}"`,
      done.status === "AWAITING_FULFILMENT" ? "Pre-authorised. Needs fulfilment." : "Pre-authorised purchase.",
      "/admin/marketplace/orders",
    );
    return { purchase: done, duplicate: false };
  });
  return result;
}

/** Debit Points and apply the effects of a purchase. Caller holds the member lock. */
async function completePurchase(
  tx: Tx,
  p: typeof purchase.$inferSelect,
  item: typeof marketplaceItem.$inferSelect,
  approverId: string | null,
) {
  const h = await getHousehold(tx, p.householdId);
  const now = new Date();
  let subscriptionId: string | null = null;
  let entry;

  if (item.isSubscription && item.billingFrequency) {
    const settings = await getSettings(tx, p.householdId);
    const today = localDate(now, h.timezone);
    const end = nextPeriod(today, item.billingFrequency, null, Number(today.slice(8, 10)));
    const periodStart = startOfLocalDate(today, h.timezone);
    const periodEnd = startOfLocalDate(end, h.timezone);
    const [sub] = await tx
      .insert(subscription)
      .values({
        householdId: p.householdId,
        memberId: p.memberId,
        itemId: item.id,
        name: item.name,
        pricePoints: p.pricePoints,
        frequency: item.billingFrequency,
        startDate: now,
        nextDueAt: periodEnd,
        graceDays: settings.subscriptionGraceDays,
      })
      .returning();
    subscriptionId = sub.id;
    entry = await postEntry(tx, {
      householdId: p.householdId,
      memberId: p.memberId,
      type: "SUBSCRIPTION_PAYMENT",
      points: -p.pricePoints,
      description: `${item.name} (first period)`,
      idempotencyKey: `purchase:${p.id}`,
      sourceType: "PURCHASE",
      sourceId: p.id,
      approvedById: approverId,
      createdById: approverId ?? p.memberId,
      category: await categoryName(tx, item.categoryId),
    });
    const [rec] = await tx
      .insert(subscriptionBillingRecord)
      .values({ subscriptionId: sub.id, periodStart, periodEnd, points: p.pricePoints, status: "PAID", ledgerEntryId: entry.id })
      .returning();
    await tx.insert(entitlement).values({
      householdId: p.householdId,
      memberId: p.memberId,
      name: item.name,
      purchaseId: p.id,
      subscriptionId: sub.id,
      billingRecordId: rec.id,
      startsAt: now,
      endsAt: periodEnd,
    });
  } else {
    entry = await postEntry(tx, {
      householdId: p.householdId,
      memberId: p.memberId,
      type: "MARKETPLACE_PURCHASE",
      points: -p.pricePoints,
      description: item.name,
      idempotencyKey: `purchase:${p.id}`,
      sourceType: "PURCHASE",
      sourceId: p.id,
      approvedById: approverId,
      createdById: approverId ?? p.memberId,
      category: await categoryName(tx, item.categoryId),
    });
    if (item.fulfilmentType === "ENTITLEMENT" && item.entitlementDays) {
      await tx.insert(entitlement).values({
        householdId: p.householdId,
        memberId: p.memberId,
        name: item.name,
        purchaseId: p.id,
        startsAt: now,
        endsAt: new Date(now.getTime() + item.entitlementDays * 86_400_000),
      });
    }
  }

  const status = item.fulfilmentType === "MANUAL" ? "AWAITING_FULFILMENT" : "FULFILLED";
  const [updated] = await tx
    .update(purchase)
    .set({
      status,
      decidedAt: now,
      decidedById: approverId,
      ledgerEntryId: entry.id,
      subscriptionId,
      ...(status === "FULFILLED" ? { fulfilledAt: now } : {}),
    })
    .where(eq(purchase.id, p.id))
    .returning();
  return updated;
}

async function categoryName(tx: Tx, categoryId: string | null) {
  if (!categoryId) return null;
  const [c] = await tx.select({ name: category.name }).from(category).where(eq(category.id, categoryId));
  return c?.name ?? null;
}

async function loadPurchaseForUpdate(tx: Tx, householdId: string, id: string) {
  const [p] = await tx
    .select()
    .from(purchase)
    .where(and(eq(purchase.id, id), eq(purchase.householdId, householdId)))
    .for("update");
  if (!p) throw new DomainError("Purchase not found.", "NOT_FOUND");
  return p;
}

export async function approvePurchase(db: DB, actor: Actor, id: string) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const p = await loadPurchaseForUpdate(tx, actor.householdId, id);
    if (p.status !== "REQUESTED") throw new DomainError("This purchase has already been decided.", "STALE");
    await lockMember(tx, actor.householdId, p.memberId);
    const [item] = await tx.select().from(marketplaceItem).where(eq(marketplaceItem.id, p.itemId));
    const hold = await captureHold(tx, "PURCHASE", p.id);
    if (!hold) throw new DomainError("The reserved Points for this purchase are missing.");
    const updated = await completePurchase(tx, p, item, actor.memberId);
    await audit(tx, actor, "purchase.approve", "Purchase", id, { item: p.itemName, points: p.pricePoints });
    await notify(
      tx,
      actor.householdId,
      p.memberId,
      `"${p.itemName}" approved`,
      `${p.pricePoints} Points spent. Receipt #${p.receiptNumber}.`,
      `/spend/receipt/${p.id}`,
    );
    return updated;
  });
}

export async function rejectPurchase(db: DB, actor: Actor, id: string, reason: string) {
  requireRole(actor, "PARENT");
  if (!reason?.trim()) throw new DomainError("Please give a reason.");
  return db.transaction(async (tx) => {
    const p = await loadPurchaseForUpdate(tx, actor.householdId, id);
    if (p.status !== "REQUESTED") throw new DomainError("This purchase has already been decided.", "STALE");
    await lockMember(tx, actor.householdId, p.memberId);
    await releaseHold(tx, "PURCHASE", p.id);
    await tx
      .update(purchase)
      .set({ status: "REJECTED", decidedAt: new Date(), decidedById: actor.memberId, decisionReason: reason.trim() })
      .where(eq(purchase.id, id));
    await audit(tx, actor, "purchase.reject", "Purchase", id, { reason });
    await notify(tx, actor.householdId, p.memberId, `"${p.itemName}" wasn't approved`, `${reason.trim()} Your ${p.pricePoints} Points have been released.`, "/spend/orders");
  });
}

export async function cancelPurchase(db: DB, actor: Actor, id: string) {
  requireRole(actor, "CHILD");
  return db.transaction(async (tx) => {
    const p = await loadPurchaseForUpdate(tx, actor.householdId, id);
    if (p.memberId !== actor.memberId) throw new DomainError("That isn't your purchase.", "FORBIDDEN");
    if (p.status !== "REQUESTED") throw new DomainError("Only requests awaiting approval can be cancelled.");
    await lockMember(tx, actor.householdId, p.memberId);
    await releaseHold(tx, "PURCHASE", p.id);
    await tx.update(purchase).set({ status: "CANCELLED", decidedAt: new Date() }).where(eq(purchase.id, id));
    await audit(tx, actor, "purchase.cancel", "Purchase", id);
  });
}

export async function fulfilPurchase(db: DB, actor: Actor, id: string) {
  requireRole(actor, "PARENT");
  return db.transaction(async (tx) => {
    const p = await loadPurchaseForUpdate(tx, actor.householdId, id);
    if (p.status !== "AWAITING_FULFILMENT") throw new DomainError("This purchase isn't awaiting fulfilment.", "STALE");
    await tx
      .update(purchase)
      .set({ status: "FULFILLED", fulfilledAt: new Date(), fulfilledById: actor.memberId })
      .where(eq(purchase.id, id));
    await audit(tx, actor, "purchase.fulfil", "Purchase", id);
    await notify(tx, actor.householdId, p.memberId, `"${p.itemName}" delivered`, "Marked as fulfilled by a parent.", `/spend/receipt/${p.id}`);
  });
}

export async function refundPurchase(db: DB, actor: Actor, id: string, reason: string) {
  requireRole(actor, "PARENT");
  if (!reason?.trim()) throw new DomainError("Please give a reason for the refund.");
  return db.transaction(async (tx) => {
    const p = await loadPurchaseForUpdate(tx, actor.householdId, id);
    if (!["AWAITING_FULFILMENT", "FULFILLED", "APPROVED"].includes(p.status) || !p.ledgerEntryId) {
      throw new DomainError("Only completed purchases can be refunded.", "STALE");
    }
    await lockMember(tx, actor.householdId, p.memberId);
    const auditId = await audit(tx, actor, "purchase.refund", "Purchase", id, { reason, points: p.pricePoints });
    await postEntry(tx, {
      householdId: actor.householdId,
      memberId: p.memberId,
      type: "REFUND",
      points: p.pricePoints,
      description: `Refund: ${p.itemName}`,
      idempotencyKey: `refund:${p.id}`,
      sourceType: "PURCHASE",
      sourceId: p.id,
      approvedById: actor.memberId,
      createdById: actor.memberId,
      reversesEntryId: p.ledgerEntryId,
      auditLogId: auditId,
    });
    await tx
      .update(purchase)
      .set({ status: "REFUNDED", refundedAt: new Date(), refundedById: actor.memberId, refundReason: reason.trim() })
      .where(eq(purchase.id, id));
    await tx
      .update(entitlement)
      .set({ status: "CANCELLED" })
      .where(and(eq(entitlement.purchaseId, p.id), eq(entitlement.status, "ACTIVE")));
    if (p.subscriptionId) {
      await tx.update(subscription).set({ status: "CANCELLED", autoRenew: false }).where(eq(subscription.id, p.subscriptionId));
    }
    await notify(tx, actor.householdId, p.memberId, `Refund: ${p.pricePoints} Points`, `"${p.itemName}" was refunded. ${reason.trim()}`, "/wallet");
  });
}

// ─────────────── Subscriptions ───────────────

type SubRow = typeof subscription.$inferSelect;

function periodEndFor(sub: SubRow, periodStart: Date, tz: string) {
  const startLocal = localDate(periodStart, tz);
  const anchorDay = Number(localDate(sub.startDate, tz).slice(8, 10));
  return startOfLocalDate(nextPeriod(startLocal, sub.frequency, null, anchorDay), tz);
}

/**
 * Try to charge one billing period. Idempotent: the (subscription, periodStart) unique
 * index plus the ledger idempotency key mean a period can only ever be paid once.
 * Caller holds the subscription row lock.
 */
async function chargePeriod(tx: Tx, sub: SubRow, periodStart: Date, tz: string, now: Date) {
  await lockMember(tx, sub.householdId, sub.memberId);
  const periodEnd = periodEndFor(sub, periodStart, tz);
  const [existing] = await tx
    .select()
    .from(subscriptionBillingRecord)
    .where(and(eq(subscriptionBillingRecord.subscriptionId, sub.id), eq(subscriptionBillingRecord.periodStart, periodStart)));
  if (existing?.status === "PAID") return { paid: true, periodEnd, alreadyPaid: true };

  const bal = await getBalances(tx, sub.memberId);
  if (bal.available < sub.pricePoints) {
    if (existing) {
      await tx
        .update(subscriptionBillingRecord)
        .set({ attempts: existing.attempts + 1, lastAttemptAt: now })
        .where(eq(subscriptionBillingRecord.id, existing.id));
    } else {
      await tx
        .insert(subscriptionBillingRecord)
        .values({ subscriptionId: sub.id, periodStart, periodEnd, points: sub.pricePoints, status: "FAILED" });
    }
    return { paid: false, periodEnd, shortBy: sub.pricePoints - bal.available };
  }

  const entry = await postEntry(tx, {
    householdId: sub.householdId,
    memberId: sub.memberId,
    type: "SUBSCRIPTION_PAYMENT",
    points: -sub.pricePoints,
    description: `${sub.name} (${localDate(periodStart, tz)} to ${localDate(new Date(periodEnd.getTime() - 1), tz)})`,
    idempotencyKey: `sub:${sub.id}:${periodStart.toISOString()}`,
    sourceType: "SUBSCRIPTION",
    sourceId: sub.id,
    createdById: null,
    category: await categoryNameForItem(tx, sub.itemId),
  });
  let recId: string;
  if (existing) {
    await tx
      .update(subscriptionBillingRecord)
      .set({ status: "PAID", ledgerEntryId: entry.id, attempts: existing.attempts + 1, lastAttemptAt: now })
      .where(eq(subscriptionBillingRecord.id, existing.id));
    recId = existing.id;
  } else {
    const [rec] = await tx
      .insert(subscriptionBillingRecord)
      .values({ subscriptionId: sub.id, periodStart, periodEnd, points: sub.pricePoints, status: "PAID", ledgerEntryId: entry.id })
      .returning();
    recId = rec.id;
  }
  await tx.insert(entitlement).values({
    householdId: sub.householdId,
    memberId: sub.memberId,
    name: sub.name,
    subscriptionId: sub.id,
    billingRecordId: recId,
    startsAt: periodStart > now ? periodStart : now < periodEnd ? periodStart : now,
    endsAt: periodEnd,
  });
  return { paid: true, periodEnd, alreadyPaid: false };
}

async function categoryNameForItem(tx: Tx, itemId: string) {
  const [i] = await tx.select({ c: marketplaceItem.categoryId }).from(marketplaceItem).where(eq(marketplaceItem.id, itemId));
  return categoryName(tx, i?.c ?? null);
}

/**
 * Process every due subscription for a household. Safe to call any number of times;
 * retries can never create duplicate charges.
 */
export async function processDueSubscriptions(db: DB, householdId: string, now = new Date()) {
  const h = await db.select().from(household).where(eq(household.id, householdId));
  const tz = h[0]?.timezone ?? "Australia/Brisbane";
  const due = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(
      and(
        eq(subscription.householdId, householdId),
        inArray(subscription.status, ["ACTIVE", "GRACE"]),
        lte(subscription.nextDueAt, now),
      ),
    );
  const summary = { charged: 0, failed: 0, lapsed: 0, ended: 0 };
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < 24; i++) {
        const [sub] = await tx.select().from(subscription).where(eq(subscription.id, id)).for("update");
        if (!sub || !["ACTIVE", "GRACE"].includes(sub.status) || sub.nextDueAt > now) return;
        if (!sub.autoRenew) {
          await tx.update(subscription).set({ status: "CANCELLED" }).where(eq(subscription.id, id));
          await notify(tx, householdId, sub.memberId, `${sub.name} has ended`, "Auto-renew was off, so it wasn't renewed.", "/more/subscriptions");
          summary.ended++;
          return;
        }
        const r = await chargePeriod(tx, sub, sub.nextDueAt, tz, now);
        if (r.paid) {
          await tx
            .update(subscription)
            .set({ status: "ACTIVE", nextDueAt: r.periodEnd, graceUntil: null })
            .where(eq(subscription.id, id));
          if (!r.alreadyPaid) {
            summary.charged++;
            await notify(tx, householdId, sub.memberId, `${sub.name} renewed`, `${sub.pricePoints} Points paid.`, "/more/subscriptions");
          }
          continue; // catch up any further missed periods
        }
        if (sub.status === "ACTIVE") {
          const graceUntil = new Date(sub.nextDueAt.getTime() + sub.graceDays * 86_400_000);
          await tx.update(subscription).set({ status: "GRACE", graceUntil }).where(eq(subscription.id, id));
          await notify(
            tx,
            householdId,
            sub.memberId,
            `${sub.name} payment didn't go through`,
            `You need ${r.shortBy} more Points. It will retry until ${localDate(graceUntil, tz)}.`,
            "/more/subscriptions",
          );
          await notifyParents(tx, householdId, `Subscription payment failed`, `${sub.name}: not enough Points.`, "/admin/economy/subscriptions");
          summary.failed++;
        } else if (sub.graceUntil && now >= sub.graceUntil) {
          await tx.update(subscription).set({ status: "UNPAID" }).where(eq(subscription.id, id));
          await notify(tx, householdId, sub.memberId, `${sub.name} is now unpaid`, "The optional privilege has lapsed. Pay any time to restart it.", "/more/subscriptions");
          await notifyParents(tx, householdId, `Subscription lapsed`, `${sub.name} is unpaid.`, "/admin/economy/subscriptions");
          summary.lapsed++;
        }
        return;
      }
    });
  }
  return summary;
}

/** The child pays an overdue (GRACE) or lapsed (UNPAID) subscription now. */
export async function paySubscriptionNow(db: DB, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, id), eq(subscription.householdId, actor.householdId)))
      .for("update");
    if (!sub) throw new DomainError("Subscription not found.", "NOT_FOUND");
    if (actor.role === "CHILD" && sub.memberId !== actor.memberId) throw new DomainError("Not your subscription.", "FORBIDDEN");
    await assertMayRequest(tx, actor);
    if (!["GRACE", "UNPAID"].includes(sub.status)) throw new DomainError("Nothing is due on this subscription.");
    const h = await getHousehold(tx, actor.householdId);
    const now = new Date();
    const periodStart = sub.status === "UNPAID" ? startOfLocalDate(localDate(now, h.timezone), h.timezone) : sub.nextDueAt;
    const r = await chargePeriod(tx, sub, periodStart, h.timezone, now);
    if (!r.paid) throw new DomainError(insufficientMessage(sub.pricePoints, sub.pricePoints - (r.shortBy ?? 0)), "INSUFFICIENT");
    await tx.update(subscription).set({ status: "ACTIVE", nextDueAt: r.periodEnd, graceUntil: null }).where(eq(subscription.id, id));
    await audit(tx, actor, "subscription.pay_now", "Subscription", id);
  });
}

export async function setSubscriptionState(
  db: DB,
  actor: Actor,
  id: string,
  action: "PAUSE" | "RESUME" | "CANCEL" | "AUTORENEW_ON" | "AUTORENEW_OFF",
) {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(subscription)
      .where(and(eq(subscription.id, id), eq(subscription.householdId, actor.householdId)))
      .for("update");
    if (!sub) throw new DomainError("Subscription not found.", "NOT_FOUND");
    if (actor.role === "CHILD") {
      if (sub.memberId !== actor.memberId) throw new DomainError("Not your subscription.", "FORBIDDEN");
      if (action === "PAUSE" || action === "RESUME") throw new DomainError("Ask a parent to pause or resume this.");
      await assertMayRequest(tx, actor);
    }
    if (sub.status === "CANCELLED") throw new DomainError("This subscription has ended.");
    const h = await getHousehold(tx, actor.householdId);
    let patch: Partial<SubRow> = {};
    if (action === "PAUSE") patch = { status: "PAUSED", pausedReason: "parent" };
    if (action === "RESUME") {
      if (sub.status !== "PAUSED") throw new DomainError("This subscription isn't paused.");
      const todayStart = startOfLocalDate(localDate(new Date(), h.timezone), h.timezone);
      patch = { status: "ACTIVE", pausedReason: null, nextDueAt: sub.nextDueAt < todayStart ? todayStart : sub.nextDueAt };
    }
    if (action === "CANCEL") {
      // Cancels renewal immediately; any already-paid period runs to its end.
      patch = { status: "CANCELLED", autoRenew: false };
    }
    if (action === "AUTORENEW_ON") patch = { autoRenew: true };
    if (action === "AUTORENEW_OFF") patch = { autoRenew: false };
    await tx.update(subscription).set(patch).where(eq(subscription.id, id));
    await audit(tx, actor, `subscription.${action.toLowerCase()}`, "Subscription", id);
    if (actor.role === "PARENT") {
      await notify(tx, actor.householdId, sub.memberId, `${sub.name}: ${action.toLowerCase().replace("_", " ")}`, "Changed by a parent.", "/more/subscriptions");
    }
  });
}

/** Pause or resume a member's subscriptions when their participation changes. */
export async function applyParticipationToSubscriptions(tx: Tx, householdId: string, memberId: string, status: string) {
  const s = await getSettings(tx, householdId);
  if (!s.pauseSubscriptionsOnPause) return;
  const h = await getHousehold(tx, householdId);
  if (status === "ACTIVE") {
    const todayStart = startOfLocalDate(localDate(new Date(), h.timezone), h.timezone);
    await tx
      .update(subscription)
      .set({ status: "ACTIVE", pausedReason: null, nextDueAt: sql`GREATEST(${subscription.nextDueAt}, ${todayStart})` })
      .where(and(eq(subscription.memberId, memberId), eq(subscription.status, "PAUSED"), eq(subscription.pausedReason, "participation")));
  } else {
    await tx
      .update(subscription)
      .set({ status: "PAUSED", pausedReason: "participation" })
      .where(and(eq(subscription.memberId, memberId), inArray(subscription.status, ["ACTIVE", "GRACE"])));
  }
}

/** Upcoming subscription charges for a member over the next `days` days. */
export async function upcomingCharges(db: DB | Tx, memberId: string, tz: string, days = 31) {
  const subs = await db
    .select()
    .from(subscription)
    .where(and(eq(subscription.memberId, memberId), inArray(subscription.status, ["ACTIVE", "GRACE", "UNPAID"])));
  const horizon = new Date(Date.now() + days * 86_400_000);
  const out: { subscriptionId: string; name: string; dueAt: Date; points: number; status: string }[] = [];
  for (const s of subs) {
    if (s.status === "UNPAID") {
      out.push({ subscriptionId: s.id, name: s.name, dueAt: new Date(), points: s.pricePoints, status: s.status });
      continue;
    }
    if (!s.autoRenew) continue;
    let due = s.nextDueAt;
    for (let i = 0; i < 40 && due <= horizon; i++) {
      out.push({ subscriptionId: s.id, name: s.name, dueAt: due, points: s.pricePoints, status: s.status });
      due = periodEndFor(s, due, tz);
    }
  }
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

export async function expireEntitlements(db: DB | Tx, householdId: string, now = new Date()) {
  await db
    .update(entitlement)
    .set({ status: "EXPIRED" })
    .where(and(eq(entitlement.householdId, householdId), eq(entitlement.status, "ACTIVE"), lte(entitlement.endsAt, now)));
}

export { addDays, getMemberInHousehold, householdMember };
