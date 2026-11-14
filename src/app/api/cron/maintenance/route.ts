import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { runMaintenanceAll } from "@/server/household";

export const dynamic = "force-dynamic";

/**
 * Daily scheduled job (Vercel Cron or any scheduler). Protected by CRON_SECRET.
 * Idempotent: safe to call repeatedly or concurrently; billing can never double-charge.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return new Response("Unauthorised", { status: 401 });
  }
  const result = await runMaintenanceAll(getDb());
  return Response.json({ ok: true, result });
}
