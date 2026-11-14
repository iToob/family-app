import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { upcomingCharges } from "@/server/marketplace";
import { activeEntitlements, memberSubscriptions } from "@/server/queries";
import { subscriptionAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Empty, PageHeader, Points, Row, Rows, Section, Status } from "@/components/ui";
import { formatDate } from "@/lib/time";

const FREQ: Record<string, string> = { WEEKLY: "Weekly", FORTNIGHTLY: "Fortnightly", MONTHLY: "Monthly" };

export default async function Subs() {
  const v = await requireViewer();
  const db = getDb();
  const [subs, ents, upcoming] = await Promise.all([
    memberSubscriptions(db, v.subjectId),
    activeEntitlements(db, v.subjectId),
    upcomingCharges(db, v.subjectId, v.timezone, 31),
  ]);
  const total = upcoming.reduce((s, u) => s + u.points, 0);
  const btn = (id: string, action: string, label: string, variant: "primary" | "secondary" = "secondary") => (
    <ActionForm action={subscriptionAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <Submit small variant={variant}>{label}</Submit>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Subscriptions" back="/more" subtitle="Optional extras that renew automatically. If you're short of Points, the extra pauses. You never go negative." />
      <Section title="Upcoming this month">
        {upcoming.length === 0 ? (
          <Empty>No upcoming charges.</Empty>
        ) : (
          <Rows>
            {upcoming.map((u, i) => (
              <Row key={i}>
                <span className="flex-1">{u.name}</span>
                <span className="text-sm text-muted">{u.status === "UNPAID" ? "Overdue" : formatDate(u.dueAt, v.timezone)}</span>
                <Points value={u.points} size={14} />
              </Row>
            ))}
            <Row className="bg-paper/60">
              <span className="flex-1 font-medium">Total projected</span>
              <Points value={total} className="font-semibold" />
            </Row>
          </Rows>
        )}
      </Section>
      <Section title="Your subscriptions">
        {subs.length === 0 ? (
          <Empty>No subscriptions.</Empty>
        ) : (
          <ul className="space-y-3">
            {subs.map((s) => (
              <li key={s.id} className="panel px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{s.name}</h3>
                    <p className="text-sm text-muted">
                      {FREQ[s.frequency]}, <Points value={s.pricePoints} size={13} />
                      {s.status !== "CANCELLED" && s.autoRenew ? `. Next charge ${formatDate(s.nextDueAt, v.timezone)}` : ""}
                      {s.status !== "CANCELLED" && !s.autoRenew ? ". Ends at the end of this period" : ""}
                    </p>
                  </div>
                  <Status value={s.status} />
                </div>
                {!v.readOnly && s.status !== "CANCELLED" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(s.status === "GRACE" || s.status === "UNPAID") && btn(s.id, "PAY", "Pay now", "primary")}
                    {s.autoRenew ? btn(s.id, "AUTORENEW_OFF", "Turn off auto-renew") : btn(s.id, "AUTORENEW_ON", "Turn on auto-renew")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {ents.length > 0 && (
        <Section title="Active privileges">
          <Rows>
            {ents.map((e) => (
              <Row key={e.id}>
                <span className="flex-1 font-medium">{e.name}</span>
                <span className="text-sm text-muted">until {formatDate(e.endsAt, v.timezone, true)}</span>
              </Row>
            ))}
          </Rows>
        </Section>
      )}
    </>
  );
}
