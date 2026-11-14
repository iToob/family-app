import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import { cashOutRequest, jobOccurrence, pointsLedgerEntry, purchase, subscription } from "@/db/schema";
import { pointsToCents, formatAud } from "@/lib/money";
import { DomainError } from "@/server/core";
import {
  childRespondToProposal,
  claimJob,
  createOpportunity,
  listAvailableJobs,
  recordJobForChild,
  respondToProposal,
  reviewJob,
  submitJob,
  submitProposal,
} from "@/server/jobs";
import {
  approvePurchase,
  cancelPurchase,
  createItem,
  processDueSubscriptions,
  rejectPurchase,
  refundPurchase,
  requestPurchase,
} from "@/server/marketplace";
import {
  approveCashOut,
  awardPoints,
  cancelCashOut,
  createGoal,
  decideCorrection,
  markCashOutPaid,
  moveSavings,
  proposeCorrection,
  recordDirectSpend,
  rejectCashOut,
  requestCashOut,
} from "@/server/money-ops";
import { runMaintenance, setParticipation, updateSettings, activateEconomy } from "@/server/household";
import { bal, db, give, key, makeFamily } from "./helpers";
import { goals, opportunities } from "@/server/queries";

afterAll(() => closeDb());

let F: Awaited<ReturnType<typeof makeFamily>>;
beforeEach(async () => {
  F = await makeFamily();
});

async function oneOffJob(points = 150, extra: Record<string, unknown> = {}) {
  const opp = await createOpportunity(db, F.p1, { kind: "JOB", title: "Wash the car", rewardPoints: points, ...extra });
  const [occ] = await db.select().from(jobOccurrence).where(eq(jobOccurrence.opportunityId, opp.id));
  return { opp, occ };
}

async function item(price: number, extra: Record<string, unknown> = {}) {
  return createItem(db, F.p1, { name: "Treat", pricePoints: price, ...extra });
}

const expectDomain = async (p: Promise<unknown>, re?: RegExp) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, "expected an error").toBeInstanceOf(DomainError);
  if (re) expect((err as Error).message).toMatch(re);
};

describe("Money", () => {
  it("converts Points to cents exactly with integers", () => {
    expect(pointsToCents(300, 10)).toBe(3000);
    expect(pointsToCents(1, 10)).toBe(10);
    expect(pointsToCents(333, 3)).toBe(999);
    expect(formatAud(3000)).toBe("$30.00");
    expect(formatAud(8405)).toBe("$84.05");
    expect(formatAud(123456789)).toBe("$1,234,567.89");
    expect(() => pointsToCents(1.5, 10)).toThrow();
  });
});

describe("Workflow A: earn Points", () => {
  it("claim → submit → approve credits exactly once", async () => {
    const kid = F.kids[0];
    const { occ } = await oneOffJob(150);
    const claim = await claimJob(db, kid, occ.id);
    await submitJob(db, kid, claim.id, { notes: "Done" });
    expect((await bal(kid)).available).toBe(0); // pending earnings don't count
    await reviewJob(db, F.p1, claim.id, "APPROVED");
    expect((await bal(kid)).available).toBe(150);
    // Repeated approval (e.g. double-click, other parent) cannot pay twice.
    await expectDomain(reviewJob(db, F.p2, claim.id, "APPROVED"), /already/);
    expect((await bal(kid)).ledger).toBe(150);
  });

  it("concurrent approvals pay once", async () => {
    const kid = F.kids[0];
    const { occ } = await oneOffJob(150);
    const claim = await claimJob(db, kid, occ.id);
    await submitJob(db, kid, claim.id, {});
    const results = await Promise.allSettled([
      reviewJob(db, F.p1, claim.id, "APPROVED"),
      reviewJob(db, F.p2, claim.id, "APPROVED"),
      reviewJob(db, F.p1, claim.id, "APPROVED"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await bal(kid)).ledger).toBe(150);
  });

  it("rejected work credits nothing; returned work can be resubmitted", async () => {
    const kid = F.kids[0];
    const { occ } = await oneOffJob(100);
    const claim = await claimJob(db, kid, occ.id);
    await submitJob(db, kid, claim.id, {});
    await expectDomain(reviewJob(db, F.p1, claim.id, "RETURNED"), /reason/);
    await reviewJob(db, F.p1, claim.id, "RETURNED", { reason: "Missed the wheels" });
    await submitJob(db, kid, claim.id, { notes: "Wheels done" });
    await reviewJob(db, F.p1, claim.id, "REJECTED", { reason: "Not done" });
    expect((await bal(kid)).ledger).toBe(0);
  });

  it("partial payment pays the agreed amount", async () => {
    const kid = F.kids[0];
    const { occ } = await oneOffJob(200);
    const claim = await claimJob(db, kid, occ.id);
    await submitJob(db, kid, claim.id, {});
    await reviewJob(db, F.p1, claim.id, "PARTIAL", { points: 120, reason: "Half the lawn" });
    expect((await bal(kid)).ledger).toBe(120);
  });

  it("prevents duplicate and over-subscribed claims", async () => {
    const { occ } = await oneOffJob(100);
    await claimJob(db, F.kids[0], occ.id);
    await expectDomain(claimJob(db, F.kids[0], occ.id), /already/);
    await expectDomain(claimJob(db, F.kids[1], occ.id), /already claimed/);
  });

  it("concurrent claims on a single-position job: exactly one wins", async () => {
    const { occ } = await oneOffJob(100);
    const r = await Promise.allSettled(F.kids.map((k) => claimJob(db, k, occ.id)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("children cannot approve work", async () => {
    const { occ } = await oneOffJob(100);
    const claim = await claimJob(db, F.kids[0], occ.id);
    await submitJob(db, F.kids[0], claim.id, {});
    await expectDomain(reviewJob(db, F.kids[0], claim.id, "APPROVED"), /permission/);
    await expectDomain(reviewJob(db, F.kids[1], claim.id, "APPROVED"), /permission/);
  });

  it("jobs without approval are auto-approved by the system, never by the child", async () => {
    const kid = F.kids[0];
    const { occ } = await oneOffJob(80, { requiresApproval: false });
    const claim = await claimJob(db, kid, occ.id);
    await submitJob(db, kid, claim.id, {});
    expect((await bal(kid)).ledger).toBe(80);
  });

  it("parents can record a completed job for a child", async () => {
    const { occ } = await oneOffJob(150);
    await recordJobForChild(db, F.p1, occ.id, F.kids[1].memberId);
    expect((await bal(F.kids[1])).ledger).toBe(150);
    await expectDomain(recordJobForChild(db, F.p2, occ.id, F.kids[1].memberId));
    expect((await bal(F.kids[1])).ledger).toBe(150);
  });

  it("paused children cannot claim new work but keep their balance", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 300);
    await setParticipation(db, kid, kid.memberId, "PAUSED");
    const { occ } = await oneOffJob(100);
    await expectDomain(claimJob(db, kid, occ.id), /paused/);
    expect((await bal(kid)).available).toBe(300);
    await setParticipation(db, kid, kid.memberId, "ACTIVE");
    await claimJob(db, kid, occ.id);
  });
});

describe("Recurring jobs", () => {
  it("each occurrence is paid separately and never twice", async () => {
    const kid = F.kids[0];
    const opp = await createOpportunity(db, F.p1, {
      kind: "JOB",
      title: "Bins",
      rewardPoints: 50,
      recurrence: "WEEKLY",
      recurrenceAnchor: "2026-01-05",
    });
    const t1 = new Date("2026-03-03T01:00:00Z");
    const t2 = new Date("2026-03-10T01:00:00Z");
    await runMaintenance(db, F.household.id, t1);
    await runMaintenance(db, F.household.id, t1); // idempotent
    await runMaintenance(db, F.household.id, t2);
    const occs = await db.select().from(jobOccurrence).where(eq(jobOccurrence.opportunityId, opp.id));
    const keys = occs.map((o) => o.periodKey).sort();
    expect(keys).toContain("2026-03-02");
    expect(keys).toContain("2026-03-09");
    expect(new Set(keys).size).toBe(keys.length);
    const open = occs.filter((o) => o.periodKey === "2026-03-09")[0];
    const claim = await claimJob(db, kid, open.id);
    await submitJob(db, kid, claim.id, {});
    await reviewJob(db, F.p1, claim.id, "APPROVED");
    await expectDomain(reviewJob(db, F.p1, claim.id, "APPROVED"));
    expect((await bal(kid)).ledger).toBe(50);
  });
});

describe("Projects and proposals", () => {
  it("pays project milestones independently", async () => {
    const kid = F.kids[2];
    const opp = await createOpportunity(db, F.p1, {
      kind: "PROJECT",
      title: "Garage",
      rewardPoints: 0,
      milestones: [
        { title: "Sort", rewardPoints: 150 },
        { title: "Clean", rewardPoints: 150 },
        { title: "Organise", rewardPoints: 200 },
        { title: "Inspect", rewardPoints: 100 },
      ],
    });
    expect(opp.rewardPoints).toBe(600);
    const listed = (await opportunities(db, F.household.id)).find((x) => x.opp.id === opp.id)!;
    expect(listed.openOccurrences).toBe(4);
    const occs = await db.select().from(jobOccurrence).where(eq(jobOccurrence.opportunityId, opp.id));
    const c1 = await claimJob(db, kid, occs[0].id);
    // Non-collaborative: other kids can't take milestones once someone started.
    await expectDomain(claimJob(db, F.kids[0], occs[1].id), /someone else/i);
    await submitJob(db, kid, c1.id, {});
    await reviewJob(db, F.p1, c1.id, "APPROVED");
    expect((await bal(kid)).ledger).toBe(occs[0].rewardPoints);
  });

  it("Workflow F: proposal → counter → accept → paid", async () => {
    const kid = F.kids[1];
    const p = await submitProposal(db, kid, {
      title: "Wash windows",
      whatToDo: "All downstairs windows",
      beneficiaries: "Everyone",
      proposedPoints: 250,
      valueReason: "They're filthy",
    });
    await respondToProposal(db, F.p1, p.id, "COUNTER", { points: 200, message: "200 is fair" });
    await childRespondToProposal(db, kid, p.id, "ACCEPT");
    const jobs = await listAvailableJobs(db, kid);
    const job = jobs.find((j) => j.title === "Wash windows")!;
    expect(job.reward_points).toBe(200);
    // Reserved for the proposer only.
    expect((await listAvailableJobs(db, F.kids[0])).find((j) => j.title === "Wash windows")).toBeUndefined();
    const claim = await claimJob(db, kid, job.occurrence_id);
    await submitJob(db, kid, claim.id, {});
    await reviewJob(db, F.p2, claim.id, "APPROVED");
    expect((await bal(kid)).ledger).toBe(200);
  });
});

describe("Workflow B and D: spending", () => {
  it("reserves, approves and debits once", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 500);
    const it200 = await item(200);
    const { purchase: p } = await requestPurchase(db, kid, it200.id, key());
    let b = await bal(kid);
    expect(b.held).toBe(200);
    expect(b.available).toBe(300);
    expect(b.ledger).toBe(500);
    await approvePurchase(db, F.p1, p.id);
    b = await bal(kid);
    expect(b).toMatchObject({ ledger: 300, held: 0, available: 300 });
    await expectDomain(approvePurchase(db, F.p2, p.id), /already/);
    expect((await bal(kid)).ledger).toBe(300);
    const [row] = await db.select().from(purchase).where(eq(purchase.id, p.id));
    expect(row.status).toBe("AWAITING_FULFILMENT");
    expect(row.receiptNumber).toBeGreaterThan(1000);
  });

  it("insufficient balance: explains the gap and posts nothing", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 80);
    const it150 = await item(150);
    await expectDomain(requestPurchase(db, kid, it150.id, key()), /70 more Points/);
    const entries = await db.select().from(pointsLedgerEntry).where(eq(pointsLedgerEntry.memberId, kid.memberId));
    expect(entries).toHaveLength(1);
    expect((await bal(kid)).available).toBe(80);
  });

  it("held Points can't be spent twice; rejection/cancel releases them", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 300);
    const it200 = await item(200);
    const { purchase: p1 } = await requestPurchase(db, kid, it200.id, key());
    await expectDomain(requestPurchase(db, kid, it200.id, key()), /100 more/);
    await rejectPurchase(db, F.p1, p1.id, "Not this week");
    expect((await bal(kid)).available).toBe(300);
    const { purchase: p2 } = await requestPurchase(db, kid, it200.id, key());
    await cancelPurchase(db, kid, p2.id);
    expect((await bal(kid))).toMatchObject({ available: 300, ledger: 300, held: 0 });
  });

  it("concurrent purchases cannot overspend", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 250);
    const it100 = await item(100, { requiresApproval: false, fulfilmentType: "NONE" });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => requestPurchase(db, kid, it100.id, key())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const b = await bal(kid);
    expect(b.ledger).toBe(50);
    expect(b.available).toBeGreaterThanOrEqual(0);
  });

  it("retrying the same request is idempotent", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 500);
    const it100 = await item(100, { requiresApproval: false, fulfilmentType: "NONE" });
    const k = key();
    const a = await requestPurchase(db, kid, it100.id, k);
    const b = await requestPurchase(db, kid, it100.id, k);
    expect(b.duplicate).toBe(true);
    expect(b.purchase.id).toBe(a.purchase.id);
    expect((await bal(kid)).ledger).toBe(400);
  });

  it("refund reverses the exact amount, once", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 300);
    const it = await item(120, { requiresApproval: false });
    const { purchase: p } = await requestPurchase(db, kid, it.id, key());
    expect((await bal(kid)).ledger).toBe(180);
    await refundPurchase(db, F.p1, p.id, "Shop was closed");
    expect((await bal(kid)).ledger).toBe(300);
    await expectDomain(refundPurchase(db, F.p1, p.id, "again"));
    expect((await bal(kid)).ledger).toBe(300);
  });

  it("time-limited privileges get the right expiry", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 300);
    const it = await item(150, { requiresApproval: false, fulfilmentType: "ENTITLEMENT", entitlementDays: 7 });
    const before = Date.now();
    await requestPurchase(db, kid, it.id, key());
    const ents = await db.execute<{ starts_at: Date; ends_at: Date }>(sql`SELECT starts_at, ends_at FROM entitlement WHERE member_id = ${kid.memberId}`);
    const e = ents.rows[0];
    const ms = new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime();
    expect(ms).toBe(7 * 86_400_000);
    expect(new Date(e.starts_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("per-person limits apply", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 500);
    const it = await item(20, { requiresApproval: false, fulfilmentType: "NONE", perPersonLimit: 2, limitPeriod: "WEEK" });
    await requestPurchase(db, kid, it.id, key());
    await requestPurchase(db, kid, it.id, key());
    await expectDomain(requestPurchase(db, kid, it.id, key()), /limit/);
  });

  it("parents can record spends directly but never below zero", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 50);
    await recordDirectSpend(db, F.p1, { memberId: kid.memberId, points: 20, description: "Chocolate", idempotencyKey: key() });
    expect((await bal(kid)).ledger).toBe(30);
    await expectDomain(recordDirectSpend(db, F.p1, { memberId: kid.memberId, points: 40, description: "x", idempotencyKey: key() }), /only has 30/);
  });
});

describe("Workflow C: cash conversion", () => {
  it("quotes, reserves, pays once and records the rate", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 600);
    const req = await requestCashOut(db, kid, 300, key());
    expect(req.audCents).toBe(3000);
    expect(req.centsPerPoint).toBe(10);
    expect((await bal(kid))).toMatchObject({ ledger: 600, held: 300, available: 300 });
    // Held Points can't be spent elsewhere.
    const it = await item(400);
    await expectDomain(requestPurchase(db, kid, it.id, key()), /100 more/);
    await approveCashOut(db, F.p1, req.id);
    await markCashOutPaid(db, F.p1, req.id, { method: "Cash" });
    expect((await bal(kid))).toMatchObject({ ledger: 300, held: 0, available: 300 });
    await expectDomain(markCashOutPaid(db, F.p2, req.id, { method: "Cash" }), /already been paid/);
    const [entry] = await db
      .select()
      .from(pointsLedgerEntry)
      .where(and(eq(pointsLedgerEntry.memberId, kid.memberId), eq(pointsLedgerEntry.type, "CASH_CONVERSION")));
    expect(entry).toMatchObject({ points: -300, audCents: 3000, centsPerPoint: 10 });
    const [row] = await db.select().from(cashOutRequest).where(eq(cashOutRequest.id, req.id));
    expect(row.status).toBe("PAID");
    expect(row.paidAt).toBeTruthy();
  });

  it("concurrent payment recording pays once", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 600);
    const req = await requestCashOut(db, kid, 300, key());
    const r = await Promise.allSettled([
      markCashOutPaid(db, F.p1, req.id, { method: "Cash" }),
      markCashOutPaid(db, F.p2, req.id, { method: "Bank transfer" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await bal(kid)).ledger).toBe(300);
  });

  it("rejected or cancelled requests release the hold", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 600);
    const r1 = await requestCashOut(db, kid, 300, key());
    await rejectCashOut(db, F.p1, r1.id, "Wait till Saturday");
    const r2 = await requestCashOut(db, kid, 300, key());
    await cancelCashOut(db, kid, r2.id);
    expect((await bal(kid))).toMatchObject({ ledger: 600, held: 0, available: 600 });
  });

  it("enforces the minimum", async () => {
    await give(F.p1, F.kids[0], 600);
    await expectDomain(requestCashOut(db, F.kids[0], 50, key()), /minimum/);
  });

  it("past payouts keep their rate after a rate increase; rate can't be lowered once live", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 600);
    const req = await requestCashOut(db, kid, 100, key());
    await activateEconomy(db, F.p1);
    await expectDomain(updateSettings(db, F.p1, { centsPerPoint: 5 }), /can't be lowered/);
    await updateSettings(db, F.p1, { centsPerPoint: 12 });
    await markCashOutPaid(db, F.p1, req.id, { method: "Cash" });
    const [row] = await db.select().from(cashOutRequest).where(eq(cashOutRequest.id, req.id));
    expect(row.audCents).toBe(1000); // locked at request time
  });
});

describe("Savings", () => {
  it("earmarks Points without creating income or spending", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 500);
    const g = await createGoal(db, kid, { title: "Headphones", targetPoints: 2000 });
    await moveSavings(db, kid, g.id, 300);
    expect((await bal(kid))).toMatchObject({ ledger: 500, saved: 300, available: 200 });
    const [shown] = await goals(db, kid.memberId);
    expect(shown.saved).toBe(300);
    expect(shown.pct).toBe(15);
    const entries = await db.select().from(pointsLedgerEntry).where(eq(pointsLedgerEntry.memberId, kid.memberId));
    expect(entries).toHaveLength(1);
    await expectDomain(moveSavings(db, kid, g.id, 300), /100 more/);
    await moveSavings(db, kid, g.id, -100);
    expect((await bal(kid)).available).toBe(300);
    await expectDomain(moveSavings(db, kid, g.id, -500), /Only 200/);
  });
});

describe("Workflow E: subscriptions", () => {
  async function subscribe(kidIdx: number, funds: number) {
    const kid = F.kids[kidIdx];
    await give(F.p1, kid, funds);
    const it = await createItem(db, F.p1, {
      name: "Phone plan",
      pricePoints: 400,
      isSubscription: true,
      billingFrequency: "WEEKLY",
      requiresApproval: false,
      fulfilmentType: "MANUAL",
    });
    await requestPurchase(db, kid, it.id, key());
    const [sub] = await db.select().from(subscription).where(eq(subscription.memberId, kid.memberId));
    return { kid, sub };
  }

  it("first payment activates; renewal charges once even when retried", async () => {
    const { kid, sub } = await subscribe(0, 1000);
    expect((await bal(kid)).ledger).toBe(600);
    const due = new Date(sub.nextDueAt.getTime() + 60_000);
    await processDueSubscriptions(db, F.household.id, due);
    await processDueSubscriptions(db, F.household.id, due);
    await Promise.all([
      processDueSubscriptions(db, F.household.id, due),
      processDueSubscriptions(db, F.household.id, due),
    ]);
    expect((await bal(kid)).ledger).toBe(200);
    const [after] = await db.select().from(subscription).where(eq(subscription.id, sub.id));
    expect(after.nextDueAt.getTime() - sub.nextDueAt.getTime()).toBe(7 * 86_400_000);
  });

  it("insufficient Points never go negative and don't create a paid period", async () => {
    const { kid, sub } = await subscribe(1, 500);
    expect((await bal(kid)).ledger).toBe(100);
    const due = new Date(sub.nextDueAt.getTime() + 60_000);
    await processDueSubscriptions(db, F.household.id, due);
    let [s] = await db.select().from(subscription).where(eq(subscription.id, sub.id));
    expect(s.status).toBe("GRACE");
    expect((await bal(kid)).ledger).toBe(100);
    const ents = await db.execute(sql`SELECT * FROM entitlement WHERE subscription_id = ${sub.id} AND ends_at > ${due}`);
    expect(ents.rows).toHaveLength(0);
    // After grace expires it lapses to UNPAID.
    await processDueSubscriptions(db, F.household.id, new Date(due.getTime() + 4 * 86_400_000));
    [s] = await db.select().from(subscription).where(eq(subscription.id, sub.id));
    expect(s.status).toBe("UNPAID");
    expect((await bal(kid)).ledger).toBe(100);
  });

  it("pausing participation pauses billing", async () => {
    const { kid, sub } = await subscribe(2, 1000);
    await setParticipation(db, kid, kid.memberId, "PAUSED");
    await processDueSubscriptions(db, F.household.id, new Date(sub.nextDueAt.getTime() + 60_000));
    expect((await bal(kid)).ledger).toBe(600);
  });
});

describe("Corrections and integrity", () => {
  it("corrections are visible reversing entries; debits can need the other parent", async () => {
    const kid = F.kids[0];
    const e = await give(F.p1, kid, 200);
    await updateSettings(db, F.p1, { correctionsNeedSecondParent: true });
    const r = await proposeCorrection(db, F.p1, { memberId: kid.memberId, reason: "Paid twice by mistake", reversesEntryId: e.id });
    expect(r.status).toBe("PENDING");
    expect((await bal(kid)).available).toBe(0);
    await expectDomain(decideCorrection(db, F.p1, r.request.id, true), /other parent/);
    await decideCorrection(db, F.p2, r.request.id, true);
    expect((await bal(kid)).ledger).toBe(0);
    const entries = await db.select().from(pointsLedgerEntry).where(eq(pointsLedgerEntry.memberId, kid.memberId));
    expect(entries).toHaveLength(2);
    expect(entries.find((x) => x.type === "CORRECTION")?.reversesEntryId).toBe(e.id);
  });

  it("the database rejects ledger updates, deletes and negative balances", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 100);
    const dbError = (p: Promise<unknown>) =>
      p.then(
        () => "no error",
        (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ""}`,
      );
    expect(await dbError(db.execute(sql`UPDATE points_ledger_entry SET points = 999`))).toMatch(/append-only/);
    expect(await dbError(db.execute(sql`DELETE FROM points_ledger_entry`))).toMatch(/append-only/);
    expect(await dbError(db.execute(sql`DELETE FROM audit_log`))).toMatch(/append-only/);
    await expect(
      db.insert(pointsLedgerEntry).values({
        householdId: F.household.id,
        memberId: kid.memberId,
        type: "CORRECTION",
        points: -500,
        description: "sneaky",
        idempotencyKey: key(),
      }).then(() => "no error", (e: Error & { cause?: Error }) => e.cause?.message ?? e.message),
    ).resolves.toMatch(/negative/);
    expect((await bal(kid)).ledger).toBe(100);
  });

  it("awards require a reason and opening balances happen once", async () => {
    const kid = F.kids[0];
    await expectDomain(awardPoints(db, F.p1, { memberId: kid.memberId, points: 10, kind: "BONUS", reason: " ", idempotencyKey: key() }), /reason/);
    await awardPoints(db, F.p1, { memberId: kid.memberId, points: 100, kind: "OPENING_BALANCE", reason: "Start", idempotencyKey: key() });
    await expectDomain(awardPoints(db, F.p1, { memberId: kid.memberId, points: 100, kind: "OPENING_BALANCE", reason: "Start", idempotencyKey: key() }), /already/);
    await expectDomain(awardPoints(db, F.kids[1], { memberId: kid.memberId, points: 100, kind: "BONUS", reason: "hack", idempotencyKey: key() }), /permission/);
  });

  it("view-only mode blocks child requests but not parent recording", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 300);
    await updateSettings(db, F.p1, { childRequestsEnabled: false });
    const { occ } = await oneOffJob(100);
    await expectDomain(claimJob(db, kid, occ.id), /view-only/);
    const it = await item(50);
    await expectDomain(requestPurchase(db, kid, it.id, key()), /view-only/);
    await expectDomain(requestCashOut(db, kid, 100, key()), /view-only/);
    await requestPurchase(db, F.p1, it.id, key(), undefined, kid.memberId);
    await recordJobForChild(db, F.p1, occ.id, kid.memberId);
    expect((await bal(kid)).ledger).toBe(350);
  });

  it("ledger always reconciles: sum of entries equals derived balances", async () => {
    const kid = F.kids[0];
    await give(F.p1, kid, 1000);
    const it = await item(100, { requiresApproval: false, fulfilmentType: "NONE" });
    await requestPurchase(db, kid, it.id, key());
    const req = await requestCashOut(db, kid, 200, key());
    await markCashOutPaid(db, F.p1, req.id, { method: "Cash" });
    const r = await db.execute<{ s: string }>(sql`SELECT SUM(points) s FROM points_ledger_entry WHERE member_id = ${kid.memberId}`);
    expect(Number(r.rows[0].s)).toBe(700);
    expect((await bal(kid)).ledger).toBe(700);
  });
});
