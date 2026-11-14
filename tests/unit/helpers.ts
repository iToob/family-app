import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Actor } from "@/server/core";
import { getBalances } from "@/server/core";
import { acknowledgeCharter, addMember, latestCharter, setupHousehold, updateSettings } from "@/server/household";
import { awardPoints } from "@/server/money-ops";

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/family_economy_test";
export const db = getDb();

export async function resetDb() {
  await db.transaction(async (tx) => {
    // Test-only: replica mode skips the append-only triggers so tables can be wiped.
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    const rows = await tx.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    const names = rows.rows.map((r) => `"${r.tablename}"`).join(", ");
    await tx.execute(sql.raw(`TRUNCATE ${names} CASCADE`));
  });
}

let n = 0;
export async function makeFamily() {
  await resetDb();
  n++;
  const { household, member } = await setupHousehold(db, {
    householdName: "Test Family",
    centsPerPoint: 10,
    parent: { displayName: "Parent One", username: `p1_${n}`, password: "password123" },
  });
  const p1: Actor = { householdId: household.id, memberId: member.id, role: "PARENT", displayName: "Parent One" };
  const p2m = await addMember(db, p1, { displayName: "Parent Two", username: `p2_${n}`, password: "password123", role: "PARENT" });
  const p2: Actor = { householdId: household.id, memberId: p2m.id, role: "PARENT", displayName: "Parent Two" };
  // Most tests exercise the request flows; view-only mode (the default) is tested explicitly.
  await updateSettings(db, p1, { childRequestsEnabled: true });
  const kids: Actor[] = [];
  for (const name of ["Kid A", "Kid B", "Kid C"]) {
    const m = await addMember(db, p1, { displayName: name, username: `${name.replace(" ", "").toLowerCase()}_${n}`, password: "password123", role: "CHILD" });
    const a: Actor = { householdId: household.id, memberId: m.id, role: "CHILD", displayName: name };
    const charter = await latestCharter(db, household.id);
    await acknowledgeCharter(db, a, charter!.id, "ACTIVE");
    kids.push(a);
  }
  return { household, p1, p2, kids };
}

let k = 0;
export const key = () => `test-key-${Date.now()}-${k++}`;

export async function give(parent: Actor, kid: Actor, points: number) {
  return awardPoints(db, parent, { memberId: kid.memberId, points, kind: "MANUAL_AWARD", reason: "test funds", idempotencyKey: key() });
}

export const bal = (a: Actor) => getBalances(db, a.memberId);
