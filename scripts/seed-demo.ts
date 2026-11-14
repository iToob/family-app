/**
 * DEMONSTRATION DATA ONLY. Creates a demo household with placeholder people, jobs,
 * marketplace items, transactions and goals, all posted through the real domain logic.
 * Refuses to run if a household already exists. For a real family, use /setup instead.
 */
import { closeDb, getDb } from "../src/db";
import { jobOccurrence, user } from "../src/db/schema";
import type { Actor } from "../src/server/core";
import { acknowledgeCharter, activateEconomy, addMember, householdExists, latestCharter, setupHousehold, updateSettings } from "../src/server/household";
import { claimJob, createOpportunity, reviewJob, submitJob, submitProposal } from "../src/server/jobs";
import { createItem, requestPurchase } from "../src/server/marketplace";
import { awardPoints, createGoal, markCashOutPaid, moveSavings, requestCashOut } from "../src/server/money-ops";
import { categories } from "../src/server/queries";

const PASSWORD = "demo-password";
const key = () => crypto.randomUUID();

async function main() {
  const db = getDb();
  if (await householdExists(db)) throw new Error("A household already exists. Run `npm run db:reset` first if you really want demo data.");
  const { household, member } = await setupHousehold(db, {
    householdName: "Demo Family (demonstration data)",
    centsPerPoint: 10,
    parent: { displayName: "Parent One", username: "parent1", password: PASSWORD },
    isDemo: true,
  });
  const p1: Actor = { householdId: household.id, memberId: member.id, role: "PARENT", displayName: "Parent One" };
  await addMember(db, p1, { displayName: "Parent Two", username: "parent2", password: PASSWORD, role: "PARENT" });
  await updateSettings(db, p1, { childRequestsEnabled: true, weeklyBudgetPoints: 1500 });

  const kids: Actor[] = [];
  for (const [name, u] of [["Child A (14)", "child14"], ["Child B (16)", "child16"], ["Child C (18)", "child18"]]) {
    const m = await addMember(db, p1, { displayName: name, username: u, password: PASSWORD, role: "CHILD" });
    const a: Actor = { householdId: household.id, memberId: m.id, role: "CHILD", displayName: name };
    await acknowledgeCharter(db, a, (await latestCharter(db, household.id))!.id, "ACTIVE");
    kids.push(a);
  }
  const jobCats = Object.fromEntries((await categories(db, household.id, "JOB")).map((c) => [c.name, c.id]));
  const mktCats = Object.fromEntries((await categories(db, household.id, "MARKET")).map((c) => [c.name, c.id]));

  const jobs = [
    { title: "Wash and vacuum a family car", rewardPoints: 150, categoryId: jobCats["Vehicles"], estimatedMinutes: 60, instructions: "Outside washed and dried, inside vacuumed including boot. Wipe the dash." },
    { title: "Mow the back lawn", rewardPoints: 200, categoryId: jobCats["Garden & Outdoor"], estimatedMinutes: 75, safetyNotes: "Closed shoes and ear protection.", recurrence: "WEEKLY" as const },
    { title: "Clean the shared bathroom", rewardPoints: 80, categoryId: jobCats["Household"], estimatedMinutes: 40, recurrence: "WEEKLY" as const },
    { title: "Cook a family dinner", rewardPoints: 120, categoryId: jobCats["Cooking"], estimatedMinutes: 90, positions: 2 },
    { title: "Take out and wash the bins", rewardPoints: 30, categoryId: jobCats["Household"], estimatedMinutes: 15, recurrence: "WEEKLY" as const },
  ];
  for (const j of jobs) await createOpportunity(db, p1, { kind: "JOB", ...j });
  await createOpportunity(db, p1, {
    kind: "PROJECT",
    title: "Organise the garage",
    rewardPoints: 0,
    categoryId: jobCats["Projects"],
    milestones: [
      { title: "Sort tools and materials", rewardPoints: 150 },
      { title: "Clean shelves and workbenches", rewardPoints: 150 },
      { title: "Organise storage", rewardPoints: 200 },
      { title: "Final inspection and tidy", rewardPoints: 100 },
    ],
  });

  const items = [
    { name: "Premium phone plan", pricePoints: 400, categoryId: mktCats["Phone & Technology"], icon: "📱", isSubscription: true, billingFrequency: "MONTHLY" as const, description: "Extra data and calls beyond the basic plan." },
    { name: "Recreational internet upgrade", pricePoints: 150, categoryId: mktCats["Internet & Entertainment"], icon: "📶", fulfilmentType: "ENTITLEMENT" as const, entitlementDays: 7, requiresApproval: false },
    { name: "Optional local lift", pricePoints: 50, categoryId: mktCats["Transport"], icon: "🚗", description: "Non-essential lift within 10 km." },
    { name: "Chocolate or special treat", pricePoints: 20, categoryId: mktCats["Food & Treats"], icon: "🍫", requiresApproval: false, perPersonLimit: 3, limitPeriod: "WEEK" as const },
    { name: "Streaming subscription", pricePoints: 200, categoryId: mktCats["Internet & Entertainment"], icon: "📺", isSubscription: true, billingFrequency: "MONTHLY" as const },
    { name: "Entertainment outing contribution", pricePoints: 250, categoryId: mktCats["Activities & Outings"], icon: "🎟️" },
    { name: "$20 discretionary shopping voucher", pricePoints: 200, categoryId: mktCats["Clothing & Personal Purchases"], icon: "🛍️" },
  ];
  const created = [];
  for (const i of items) created.push(await createItem(db, p1, i));

  // Example activity.
  for (const [i, pts] of [[0, 300], [1, 600], [2, 1000]] as const) {
    await awardPoints(db, p1, { memberId: kids[i].memberId, points: pts, kind: "OPENING_BALANCE", reason: "Demo opening balance", idempotencyKey: key() });
  }
  const occs = await db.select().from(jobOccurrence);
  const car = occs.find((o) => o.title.startsWith("Wash and vacuum"))!;
  const c1 = await claimJob(db, kids[0], car.id);
  await submitJob(db, kids[0], c1.id, { notes: "Did the boot too." });
  await reviewJob(db, p1, c1.id, "APPROVED");
  const dinner = occs.find((o) => o.title.startsWith("Cook"))!;
  const c2 = await claimJob(db, kids[1], dinner.id);
  await submitJob(db, kids[1], c2.id, { notes: "Spaghetti bolognese for five." });
  await awardPoints(db, p1, { memberId: kids[2].memberId, points: 50, kind: "BONUS", reason: "Fixed the wifi without being asked", idempotencyKey: key() });
  await requestPurchase(db, kids[0], created[3].id, key());
  await requestPurchase(db, kids[1], created[6].id, key(), "For new shoes");
  await requestPurchase(db, kids[2], created[0].id, key());
  const co = await requestCashOut(db, kids[2], 300, key(), "Bank transfer");
  await markCashOutPaid(db, p1, co.id, { method: "Bank transfer", reference: "Demo" });
  const g = await createGoal(db, kids[1], { title: "Noise-cancelling headphones", targetPoints: 3500, icon: "🎧" });
  await moveSavings(db, kids[1], g.id, 200);
  await submitProposal(db, kids[2], {
    title: "Pressure-wash the driveway",
    whatToDo: "Hire a pressure washer and clean the driveway and front path.",
    beneficiaries: "Whole family",
    estimatedMinutes: 180,
    proposedPoints: 250,
    costs: "About $40 hire",
    valueReason: "It's mouldy and slippery.",
  });
  await activateEconomy(db, p1);
  await db.update(user).set({ mustChangePassword: false }); // demo convenience only

  console.log("\nDEMO household created (demonstration data only).");
  console.log(`Sign in as parent1 / parent2 / child14 / child16 / child18 with password: ${PASSWORD}\n`);
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
