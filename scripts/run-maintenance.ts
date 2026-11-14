/** Run the daily job by hand: recurring jobs, subscription billing, entitlement expiry. */
import { closeDb, getDb } from "../src/db";
import { runMaintenanceAll } from "../src/server/household";

runMaintenanceAll(getDb())
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .then(closeDb)
  .catch(async (e) => { console.error(e); await closeDb(); process.exit(1); });
