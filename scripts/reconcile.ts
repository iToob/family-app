/** Verify every household's ledger reconciles with derived balances. Exits 1 on mismatch. */
import { closeDb, getDb } from "../src/db";
import { household } from "../src/db/schema";
import { reconcile } from "../src/server/queries";

async function main() {
  const db = getDb();
  let ok = true;
  for (const h of await db.select().from(household)) {
    const r = await reconcile(db, h.id);
    console.log(`${h.name}: ${r.ok ? "OK" : "MISMATCH"} (ledger ${r.ledgerTotal}, balances ${r.memberTotal})`);
    console.table(r.rows);
    ok &&= r.ok;
  }
  if (!ok) process.exitCode = 1;
}
main().then(closeDb).catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
