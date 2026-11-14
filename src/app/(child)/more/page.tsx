import Link from "next/link";
import { getDb } from "@/db";
import { householdMember } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireViewer } from "@/server/auth";
import { unreadCount } from "@/server/queries";
import { logoutAction, participationAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { PageHeader, Row, Rows, Section, Status } from "@/components/ui";

export default async function More() {
  const v = await requireViewer();
  const db = getDb();
  const [[me], unread] = await Promise.all([
    db.select().from(householdMember).where(eq(householdMember.id, v.subjectId)),
    unreadCount(db, v.subjectId),
  ]);
  const links: [string, string, React.ReactNode?][] = [
    ["/more/notifications", "Notifications", unread ? <span className="rounded-full bg-hold px-2 text-xs leading-5 text-white">{unread}</span> : null],
    ["/more/subscriptions", "Subscriptions and privileges"],
    ["/spend/orders", "Orders and receipts"],
    ["/earn/proposals", "Job proposals"],
    ["/more/charter", "Family charter"],
    ["/more/disputes", "Review requests"],
  ];
  return (
    <>
      <PageHeader title="More" subtitle={`Signed in as ${v.username}`} />
      <Section>
        <Rows>
          {links.map(([href, label, extra]) => (
            <Row key={href} href={href}>
              <span className="flex-1 font-medium">{label}</span>
              {extra}
              <span className="text-muted" aria-hidden>›</span>
            </Row>
          ))}
        </Rows>
      </Section>
      <Section title="Participation">
        <div className="panel px-4 py-4">
          <div className="flex items-center justify-between">
            <span>Your status</span>
            <Status value={me.participationStatus} />
          </div>
          <p className="mt-2 text-sm text-muted">
            Joining is your choice. Pausing keeps your balance and history; you just won't take on new jobs or subscriptions until you resume. Essentials never change.
          </p>
          {!v.previewing && (
            <div className="mt-3 flex gap-2">
              {me.participationStatus === "ACTIVE" ? (
                <ActionForm action={participationAction} confirm="Pause your participation? Your balance stays yours.">
                  <input type="hidden" name="status" value="PAUSED" />
                  <Submit small variant="secondary">Pause</Submit>
                </ActionForm>
              ) : me.participationStatus === "PAUSED" ? (
                <ActionForm action={participationAction}>
                  <input type="hidden" name="status" value="ACTIVE" />
                  <Submit small>Resume</Submit>
                </ActionForm>
              ) : (
                <Link href="/more/charter" className="btn btn-primary btn-small">Read the charter and join</Link>
              )}
            </div>
          )}
        </div>
      </Section>
      {!v.previewing && (
        <Section>
          <Rows>
            <Row href="/change-password"><span className="flex-1 font-medium">Change password</span></Row>
          </Rows>
          <form action={logoutAction} className="mt-4">
            <button className="btn btn-secondary w-full">Sign out</button>
          </form>
        </Section>
      )}
    </>
  );
}
