"use server";
/**
 * Server actions. Each one re-derives the actor from the session cookie, validates
 * input with zod, and delegates to the domain layer, which enforces authorisation,
 * household isolation and financial integrity. UI state is never trusted.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { type Actor, DomainError } from "@/server/core";
import { PREVIEW_COOKIE, actorOrThrow, changeOwnPassword, getSession, login, logout } from "@/server/auth";
import * as jobs from "@/server/jobs";
import * as market from "@/server/marketplace";
import * as money from "@/server/money-ops";
import * as hh from "@/server/household";
import { recoverParentAccount } from "@/server/recovery";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number };

/** Runs a domain call. If it resolves to a string, that becomes the success message. */
async function run(fn: (actor: Actor) => Promise<unknown>, message = "Done"): Promise<ActionState> {
  try {
    const actor = await actorOrThrow();
    const result = await fn(actor);
    revalidatePath("/", "layout");
    return { ok: true, message: typeof result === "string" ? result : message, at: Date.now() };
  } catch (e) {
    return toError(e);
  }
}

function toError(e: unknown): ActionState {
  if (e instanceof DomainError) return { error: e.message, at: Date.now() };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Please check the form.", at: Date.now() };
  console.error(e);
  return { error: "Something went wrong. Nothing was changed. Please try again.", at: Date.now() };
}

// ─────────────── form helpers ───────────────

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const opt = (fd: FormData, k: string) => s(fd, k) || null;
const int = (fd: FormData, k: string, label = k) => {
  const raw = s(fd, k).replace(/[,\s]/g, "");
  return z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .parse(raw === "" ? NaN : raw);
};
const optInt = (fd: FormData, k: string, label = k) => (s(fd, k) === "" ? null : int(fd, k, label));
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const date = (fd: FormData, k: string) => (s(fd, k) ? new Date(s(fd, k) + "T23:59:00+10:00") : null);
const db = () => getDb();

// ─────────────── auth & setup ───────────────

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let dest = "/";
  try {
    const r = await login(s(fd, "username"), String(fd.get("password") ?? ""));
    dest = r.mustChangePassword ? "/change-password" : r.role === "PARENT" ? "/admin" : "/home";
  } catch (e) {
    return toError(e);
  }
  redirect(dest);
}

export async function recoverAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    if (s(fd, "password") !== s(fd, "confirm")) throw new DomainError("The passwords don't match.");
    await recoverParentAccount({ code: s(fd, "code"), username: s(fd, "username"), password: s(fd, "password") });
    return { ok: true, message: "Password reset. You can sign in now.", at: Date.now() };
  } catch (e) {
    return toError(e);
  }
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    if (s(fd, "next") !== s(fd, "confirm")) throw new DomainError("The new passwords don't match.");
    await changeOwnPassword(String(fd.get("current") ?? ""), String(fd.get("next") ?? ""));
  } catch (e) {
    return toError(e);
  }
  const sess = await getSession();
  redirect(sess?.actor.role === "PARENT" ? "/admin" : "/home");
}

export async function setupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const token = process.env.SETUP_TOKEN;
    if (!token) throw new DomainError("Setup is disabled: set SETUP_TOKEN in the server environment first.");
    if (s(fd, "token") !== token) throw new DomainError("The setup code is incorrect.");
    if (s(fd, "password") !== s(fd, "confirm")) throw new DomainError("The passwords don't match.");
    const pointsPerDollar = int(fd, "pointsPerDollar", "Points per dollar");
    if (pointsPerDollar < 1 || 100 % pointsPerDollar !== 0) {
      throw new DomainError("Points per dollar must divide evenly into 100 (e.g. 1, 2, 4, 5, 10, 20, 25, 50, 100).");
    }
    await hh.setupHousehold(db(), {
      householdName: s(fd, "householdName") || "Our Family",
      centsPerPoint: 100 / pointsPerDollar,
      parent: { displayName: s(fd, "displayName"), username: s(fd, "username"), password: s(fd, "password") },
    });
    await login(s(fd, "username"), s(fd, "password"));
  } catch (e) {
    return toError(e);
  }
  redirect("/admin/setup");
}

// ─────────────── preview (parents viewing a child's screens) ───────────────

export async function previewAction(fd: FormData) {
  const sess = await getSession();
  if (sess?.actor.role !== "PARENT") redirect("/");
  const jar = await cookies();
  const id = s(fd, "memberId");
  if (id) {
    jar.set(PREVIEW_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    redirect("/home");
  }
  jar.delete(PREVIEW_COOKIE);
  redirect("/admin");
}

// ─────────────── jobs ───────────────

function opportunityFromForm(fd: FormData): jobs.OpportunityInput {
  const kind = s(fd, "kind") === "PROJECT" ? "PROJECT" : "JOB";
  const milestones: { title: string; rewardPoints: number }[] = [];
  if (kind === "PROJECT") {
    const titles = fd.getAll("mTitle").map(String);
    const pts = fd.getAll("mPoints").map(String);
    titles.forEach((t, i) => {
      if (t.trim()) milestones.push({ title: t.trim(), rewardPoints: Number(pts[i]) });
    });
  }
  const recurrence = (s(fd, "recurrence") || "NONE") as jobs.OpportunityInput["recurrence"];
  return {
    kind,
    title: z.string().min(1, "A title is required").max(120).parse(s(fd, "title")),
    description: s(fd, "description"),
    categoryId: opt(fd, "categoryId"),
    rewardPoints: kind === "PROJECT" ? 0 : int(fd, "rewardPoints", "Reward"),
    estimatedMinutes: optInt(fd, "estimatedMinutes", "Estimated minutes"),
    difficulty: (s(fd, "difficulty") || "EASY") as "EASY",
    requirements: opt(fd, "requirements"),
    location: opt(fd, "location"),
    instructions: opt(fd, "instructions"),
    equipment: opt(fd, "equipment"),
    safetyNotes: opt(fd, "safetyNotes"),
    dueAt: date(fd, "dueAt"),
    positions: optInt(fd, "positions", "Positions") ?? 1,
    requiresApproval: s(fd, "requiresApproval") !== "no",
    collaborative: bool(fd, "collaborative"),
    recurrence,
    recurrenceEveryDays: recurrence === "CUSTOM" ? int(fd, "recurrenceEveryDays", "Interval") : null,
    recurrenceAnchor: opt(fd, "recurrenceAnchor"),
    milestones,
  };
}

export async function createJobAction(_: ActionState, fd: FormData) {
  let id = "";
  const r = await run(async (a) => {
    id = (await jobs.createOpportunity(db(), a, opportunityFromForm(fd))).id;
  }, "Job published");
  if (r.ok) redirect(`/admin/jobs`);
  return r;
}

export async function updateJobAction(_: ActionState, fd: FormData) {
  return run(async (a) => {
    const input = opportunityFromForm(fd);
    delete input.milestones;
    delete (input as Partial<jobs.OpportunityInput>).recurrence;
    await jobs.updateOpportunity(db(), a, s(fd, "id"), input);
  }, "Saved");
}

export async function jobStatusAction(_: ActionState, fd: FormData) {
  return run((a) => jobs.setOpportunityStatus(db(), a, s(fd, "id"), s(fd, "status") as "ACTIVE"), "Updated");
}

export async function reviewJobAction(_: ActionState, fd: FormData) {
  const decision = s(fd, "decision") as jobs.ReviewDecision;
  return run(
    (a) =>
      jobs.reviewJob(db(), a, s(fd, "claimId"), decision, {
        points: decision === "PARTIAL" ? int(fd, "points", "Partial Points") : undefined,
        reason: s(fd, "reason"),
      }),
    decision === "APPROVED" ? "Approved and paid" : decision === "PARTIAL" ? "Partial payment made" : "Sent back",
  );
}

export async function bulkApproveAction(_: ActionState, fd: FormData) {
  const ids = fd.getAll("claimId").map(String);
  let done = 0;
  const errors: string[] = [];
  const r = await run(async (a) => {
    for (const id of ids) {
      try {
        await jobs.reviewJob(db(), a, id, "APPROVED");
        done++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  });
  if (r.error) return r;
  return { ok: errors.length === 0, message: `${done} approved`, error: errors.length ? `${errors.length} skipped: ${errors[0]}` : undefined, at: Date.now() };
}

export async function recordJobAction(_: ActionState, fd: FormData) {
  return run((a) => jobs.recordJobForChild(db(), a, s(fd, "occurrenceId"), s(fd, "memberId"), s(fd, "note")), "Job recorded and paid");
}

export async function claimJobAction(_: ActionState, fd: FormData) {
  let claimId = "";
  const r = await run(async (a) => {
    claimId = (await jobs.claimJob(db(), a, s(fd, "occurrenceId"))).id;
  }, "Job claimed. It's yours!");
  if (r.ok) redirect(`/earn/claim/${claimId}?claimed=1`);
  return r;
}

export async function startJobAction(_: ActionState, fd: FormData) {
  return run((a) => jobs.startJob(db(), a, s(fd, "claimId")), "Started");
}

export async function releaseClaimAction(_: ActionState, fd: FormData) {
  return run((a) => jobs.cancelClaim(db(), a, s(fd, "claimId")), "Job released");
}

export async function submitJobAction(_: ActionState, fd: FormData) {
  return run(async (a) => {
    const file = fd.get("photo");
    let photo: Buffer | null = null;
    let photoType: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new DomainError("Photos must be JPEG, PNG, WebP or HEIC.");
      if (file.size > 3_000_000) throw new DomainError("Photo is too large (max 3 MB).");
      photo = Buffer.from(await file.arrayBuffer());
      photoType = file.type;
    }
    await jobs.submitJob(db(), a, s(fd, "claimId"), {
      notes: opt(fd, "notes"),
      minutesSpent: optInt(fd, "minutesSpent", "Minutes"),
      photo,
      photoType,
    });
  }, "Submitted for approval");
}

export async function proposeAction(_: ActionState, fd: FormData) {
  const r = await run(
    (a) =>
      jobs.submitProposal(db(), a, {
        title: z.string().min(1, "Give it a title").max(120).parse(s(fd, "title")),
        whatToDo: z.string().min(1, "Describe what you'll do").parse(s(fd, "whatToDo")),
        beneficiaries: z.string().min(1, "Who benefits?").parse(s(fd, "beneficiaries")),
        estimatedMinutes: optInt(fd, "estimatedMinutes", "Time"),
        proposedPoints: int(fd, "proposedPoints", "Proposed Points"),
        materials: opt(fd, "materials"),
        costs: opt(fd, "costs"),
        valueReason: z.string().min(1, "Why is it valuable?").parse(s(fd, "valueReason")),
      }),
    "Proposal sent",
  );
  if (r.ok) redirect("/earn/proposals");
  return r;
}

export async function respondProposalAction(_: ActionState, fd: FormData) {
  const action = s(fd, "action") as "APPROVE" | "COUNTER" | "DECLINE" | "INFO";
  return run(
    (a) =>
      jobs.respondToProposal(db(), a, s(fd, "id"), action, {
        points: action === "COUNTER" ? int(fd, "points", "Counter-offer") : undefined,
        message: s(fd, "message"),
      }),
    "Response sent",
  );
}

export async function childProposalAction(_: ActionState, fd: FormData) {
  const action = s(fd, "action") as "ACCEPT" | "DECLINE_COUNTER" | "RESUBMIT" | "WITHDRAW";
  return run(
    (a) =>
      jobs.childRespondToProposal(db(), a, s(fd, "id"), action, {
        message: s(fd, "message"),
        update: action === "RESUBMIT" ? { proposedPoints: int(fd, "proposedPoints", "Points"), whatToDo: s(fd, "whatToDo") || undefined } : undefined,
      }),
    "Sent",
  );
}

// ─────────────── marketplace ───────────────

function itemFromForm(fd: FormData): market.ItemInput {
  const isSubscription = s(fd, "isSubscription") === "yes";
  return {
    name: z.string().min(1, "Name is required").max(120).parse(s(fd, "name")),
    description: s(fd, "description"),
    categoryId: opt(fd, "categoryId"),
    pricePoints: int(fd, "pricePoints", "Price"),
    icon: s(fd, "icon") || "🎁",
    available: s(fd, "available") !== "no",
    perPersonLimit: optInt(fd, "perPersonLimit", "Limit"),
    limitPeriod: (s(fd, "limitPeriod") || "WEEK") as "WEEK",
    requiresApproval: s(fd, "requiresApproval") !== "no",
    fulfilmentType: (s(fd, "fulfilmentType") || "MANUAL") as "MANUAL",
    entitlementDays: optInt(fd, "entitlementDays", "Duration"),
    isSubscription,
    billingFrequency: isSubscription ? ((s(fd, "billingFrequency") || "MONTHLY") as "MONTHLY") : null,
    refundable: s(fd, "refundable") !== "no",
  };
}

export async function createItemAction(_: ActionState, fd: FormData) {
  const r = await run((a) => market.createItem(db(), a, itemFromForm(fd)), "Item added");
  if (r.ok) redirect("/admin/marketplace");
  return r;
}

export async function updateItemAction(_: ActionState, fd: FormData) {
  return run((a) => market.updateItem(db(), a, s(fd, "id"), itemFromForm(fd)), "Saved");
}

export async function archiveItemAction(_: ActionState, fd: FormData) {
  return run((a) => market.updateItem(db(), a, s(fd, "id"), { archived: s(fd, "archived") === "yes" }), "Updated");
}

export async function purchaseAction(_: ActionState, fd: FormData) {
  return run(async (a) => {
    const r = await market.requestPurchase(db(), a, s(fd, "itemId"), s(fd, "key"), opt(fd, "note") ?? undefined, opt(fd, "memberId") ?? undefined);
    if (r.purchase.status === "REQUESTED") return "Requested. Your Points are reserved while a parent approves.";
    return a.role === "PARENT" ? "Purchase recorded" : "Done! Check your receipts.";
  });
}

export async function approvePurchaseAction(_: ActionState, fd: FormData) {
  return run((a) => market.approvePurchase(db(), a, s(fd, "id")), "Approved");
}
export async function rejectPurchaseAction(_: ActionState, fd: FormData) {
  return run((a) => market.rejectPurchase(db(), a, s(fd, "id"), s(fd, "reason")), "Declined and Points released");
}
export async function cancelPurchaseAction(_: ActionState, fd: FormData) {
  return run((a) => market.cancelPurchase(db(), a, s(fd, "id")), "Cancelled and Points released");
}
export async function fulfilPurchaseAction(_: ActionState, fd: FormData) {
  return run((a) => market.fulfilPurchase(db(), a, s(fd, "id")), "Marked as delivered");
}
export async function refundPurchaseAction(_: ActionState, fd: FormData) {
  return run((a) => market.refundPurchase(db(), a, s(fd, "id"), s(fd, "reason")), "Refunded");
}

export async function subscriptionAction(_: ActionState, fd: FormData) {
  const action = s(fd, "action");
  if (action === "PAY") return run((a) => market.paySubscriptionNow(db(), a, s(fd, "id")), "Paid");
  return run((a) => market.setSubscriptionState(db(), a, s(fd, "id"), action as "PAUSE"), "Updated");
}

// ─────────────── cash, savings, awards ───────────────

export async function cashOutAction(_: ActionState, fd: FormData) {
  return run((a) => money.requestCashOut(db(), a, int(fd, "points", "Points"), s(fd, "key"), opt(fd, "method") ?? undefined), "Request sent. Points reserved.");
}
export async function approveCashOutAction(_: ActionState, fd: FormData) {
  return run((a) => money.approveCashOut(db(), a, s(fd, "id")), "Approved");
}
export async function payCashOutAction(_: ActionState, fd: FormData) {
  return run(
    (a) => money.markCashOutPaid(db(), a, s(fd, "id"), { method: s(fd, "method"), reference: opt(fd, "reference"), paidAt: s(fd, "paidAt") ? new Date(s(fd, "paidAt") + "T12:00:00+10:00") : null }),
    "Payment recorded",
  );
}
export async function rejectCashOutAction(_: ActionState, fd: FormData) {
  return run((a) => money.rejectCashOut(db(), a, s(fd, "id"), s(fd, "reason")), "Declined and Points released");
}
export async function cancelCashOutAction(_: ActionState, fd: FormData) {
  return run((a) => money.cancelCashOut(db(), a, s(fd, "id")), "Cancelled");
}

export async function createGoalAction(_: ActionState, fd: FormData) {
  return run(
    (a) => money.createGoal(db(), a, { title: s(fd, "title"), targetPoints: int(fd, "targetPoints", "Target"), targetDate: date(fd, "targetDate"), icon: s(fd, "icon"), memberId: opt(fd, "memberId") ?? undefined }),
    "Goal created",
  );
}
export async function moveSavingsAction(_: ActionState, fd: FormData) {
  const pts = int(fd, "points", "Points");
  return run((a) => money.moveSavings(db(), a, s(fd, "goalId"), s(fd, "direction") === "out" ? -pts : pts), "Moved");
}
export async function goalLockAction(_: ActionState, fd: FormData) {
  return run((a) => money.setGoalLock(db(), a, s(fd, "goalId"), s(fd, "locked") === "yes"), "Updated");
}
export async function closeGoalAction(_: ActionState, fd: FormData) {
  return run((a) => money.closeGoal(db(), a, s(fd, "goalId"), s(fd, "status") === "COMPLETED" ? "COMPLETED" : "ARCHIVED"), "Goal closed. Points are available again.");
}

export async function awardAction(_: ActionState, fd: FormData) {
  return run(
    (a) =>
      money.awardPoints(db(), a, {
        memberId: s(fd, "memberId"),
        points: int(fd, "points", "Points"),
        kind: (s(fd, "kind") || "BONUS") as money.AwardKind,
        reason: s(fd, "reason"),
        idempotencyKey: s(fd, "key"),
      }),
    "Points added",
  );
}

export async function directSpendAction(_: ActionState, fd: FormData) {
  return run(
    (a) => money.recordDirectSpend(db(), a, { memberId: s(fd, "memberId"), points: int(fd, "points", "Points"), description: s(fd, "description"), idempotencyKey: s(fd, "key") }),
    "Spend recorded",
  );
}

export async function correctionAction(_: ActionState, fd: FormData) {
  return run(async (a) => {
    const rev = opt(fd, "reversesEntryId");
    const r = await money.proposeCorrection(db(), a, {
      memberId: s(fd, "memberId"),
      points: rev ? undefined : int(fd, "points", "Points"),
      reason: s(fd, "reason"),
      reversesEntryId: rev,
    });
    if (r.status === "PENDING") return "Correction proposed. The other parent needs to approve it.";
  }, "Correction applied");
}

export async function decideCorrectionAction(_: ActionState, fd: FormData) {
  return run((a) => money.decideCorrection(db(), a, s(fd, "id"), s(fd, "approve") === "yes", s(fd, "reason")), "Done");
}

// ─────────────── household ───────────────

export async function addMemberAction(_: ActionState, fd: FormData) {
  return run(
    (a) =>
      hh.addMember(db(), a, {
        displayName: s(fd, "displayName"),
        username: s(fd, "username"),
        password: s(fd, "password"),
        role: s(fd, "role") === "PARENT" ? "PARENT" : "CHILD",
      }),
    "Account created. They'll choose their own password on first sign-in.",
  );
}
export async function updateMemberAction(_: ActionState, fd: FormData) {
  return run(
    (a) => hh.updateMember(db(), a, s(fd, "memberId"), { displayName: s(fd, "displayName") || undefined, avatarColor: s(fd, "avatarColor") || undefined, archived: fd.has("archived") ? s(fd, "archived") === "yes" : undefined }),
    "Saved",
  );
}
export async function resetPasswordAction(_: ActionState, fd: FormData) {
  return run((a) => hh.resetMemberPassword(db(), a, s(fd, "memberId"), s(fd, "password")), "Temporary password set. They'll change it at next sign-in.");
}
export async function participationAction(_: ActionState, fd: FormData) {
  return run(async (a) => {
    const memberId = a.role === "CHILD" ? a.memberId : s(fd, "memberId");
    await hh.setParticipation(db(), a, memberId, s(fd, "status") as "ACTIVE");
  }, "Participation updated");
}
export async function acknowledgeAction(_: ActionState, fd: FormData) {
  return run((a) => hh.acknowledgeCharter(db(), a, s(fd, "versionId"), s(fd, "choice") === "ACTIVE" ? "ACTIVE" : "NOT_PARTICIPATING"), "Thanks! Recorded.");
}
export async function publishCharterAction(_: ActionState, fd: FormData) {
  return run(
    (a) => hh.publishCharter(db(), a, { title: s(fd, "title"), body: String(fd.get("body") ?? ""), changeSummary: s(fd, "changeSummary"), significant: bool(fd, "significant") }),
    "New charter version published",
  );
}

export async function settingsAction(_: ActionState, fd: FormData) {
  return run(async (a) => {
    const input: hh.SettingsInput = {};
    if (fd.has("householdName")) input.householdName = s(fd, "householdName");
    if (fd.has("pointsPerDollar")) {
      const p = int(fd, "pointsPerDollar", "Points per dollar");
      if (p < 1 || 100 % p !== 0) throw new DomainError("Points per dollar must divide evenly into 100.");
      input.centsPerPoint = 100 / p;
    }
    if (fd.has("minCashOutPoints")) input.minCashOutPoints = int(fd, "minCashOutPoints", "Minimum cash-out");
    if (fd.has("maxCashOutPoints")) input.maxCashOutPoints = optInt(fd, "maxCashOutPoints", "Maximum cash-out");
    if (fd.has("cashOutMethods")) input.cashOutMethods = s(fd, "cashOutMethods").split(",").map((x) => x.trim()).filter(Boolean);
    if (fd.has("payoutSchedule")) input.payoutSchedule = s(fd, "payoutSchedule");
    if (fd.has("weeklyBudgetPoints")) input.weeklyBudgetPoints = optInt(fd, "weeklyBudgetPoints", "Weekly budget");
    if (fd.has("monthlyBudgetPoints")) input.monthlyBudgetPoints = optInt(fd, "monthlyBudgetPoints", "Monthly budget");
    if (fd.has("subscriptionGraceDays")) input.subscriptionGraceDays = int(fd, "subscriptionGraceDays", "Grace days");
    if (fd.has("rewardGuidelines")) input.rewardGuidelines = s(fd, "rewardGuidelines");
    for (const k of ["pauseSubscriptionsOnPause", "correctionsNeedSecondParent", "childRequestsEnabled"] as const) {
      if (fd.has(`${k}__present`)) input[k] = bool(fd, k);
    }
    await hh.updateSettings(db(), a, input);
  }, "Settings saved");
}

export async function activateAction(_: ActionState) {
  return run((a) => hh.activateEconomy(db(), a), "The economy is live!");
}

export async function categoryAction(_: ActionState, fd: FormData) {
  return run(
    (a) => hh.upsertCategory(db(), a, { id: opt(fd, "id") ?? undefined, kind: s(fd, "kind") === "MARKET" ? "MARKET" : "JOB", name: s(fd, "name"), icon: s(fd, "icon"), archived: s(fd, "archived") === "yes" }),
    "Saved",
  );
}

export async function disputeAction(_: ActionState, fd: FormData) {
  return run(
    (a) => hh.submitDispute(db(), a, { subjectType: s(fd, "subjectType") || "OTHER", subjectRef: opt(fd, "subjectRef"), subjectLabel: opt(fd, "subjectLabel"), explanation: s(fd, "explanation") }),
    "Sent to your parents for review",
  );
}
export async function resolveDisputeAction(_: ActionState, fd: FormData) {
  return run((a) => hh.resolveDispute(db(), a, s(fd, "id"), s(fd, "outcome")), "Outcome recorded");
}

export async function runMaintenanceAction(_: ActionState) {
  let msg = "Done";
  const r = await run(async (a) => {
    const res = await hh.runMaintenance(db(), a.householdId);
    msg = `Processed: ${res.charged} charged, ${res.failed} failed, ${res.lapsed} lapsed, ${res.ended} ended.`;
  });
  return r.ok ? { ...r, message: msg } : r;
}

export async function markReadAction(fd: FormData) {
  const a = await actorOrThrow();
  await hh.markNotificationsRead(db(), a, s(fd, "id") || undefined);
  revalidatePath("/", "layout");
}

