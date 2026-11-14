import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { earningOpportunity, jobClaim, jobOccurrence, jobSubmission } from "@/db/schema";
import { getSession } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Serves a submission photo to parents in the household, or to the child who submitted it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Unauthorised", { status: 401 });
  const { id } = await params;
  const [row] = await getDb()
    .select({ photo: jobSubmission.photo, type: jobSubmission.photoType, memberId: jobClaim.memberId })
    .from(jobSubmission)
    .innerJoin(jobClaim, eq(jobSubmission.claimId, jobClaim.id))
    .innerJoin(jobOccurrence, eq(jobClaim.occurrenceId, jobOccurrence.id))
    .innerJoin(earningOpportunity, eq(jobOccurrence.opportunityId, earningOpportunity.id))
    .where(and(eq(jobSubmission.id, id), eq(earningOpportunity.householdId, s.actor.householdId)));
  if (!row?.photo) return new Response("Not found", { status: 404 });
  if (s.actor.role === "CHILD" && row.memberId !== s.actor.memberId) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(row.photo), {
    headers: { "Content-Type": row.type ?? "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
