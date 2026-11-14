import { getDb } from "@/db";
import { requireParentSession } from "@/server/auth";
import { inboxCount } from "@/server/queries";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireParentSession();
  const inbox = await inboxCount(getDb(), s.actor.householdId);
  const items: NavItem[] = [
    { href: "/admin", label: "Home", icon: "dashboard" },
    { href: "/admin/approvals", label: "Inbox", icon: "approvals", badge: inbox },
    { href: "/admin/jobs", label: "Jobs", icon: "jobs" },
    { href: "/admin/marketplace", label: "Shop", icon: "market" },
    { href: "/admin/economy", label: "Economy", icon: "economy" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
  ];
  return (
    <div className="lg:flex">
      <SideNav items={items} title={s.householdName} />
      <div className="min-w-0 flex-1">
        {s.isDemo && <div className="bg-hold-100 px-4 py-1.5 text-center text-xs text-hold">Demonstration data. Not real balances.</div>}
        <main className="mx-auto max-w-4xl px-4 pt-5 pb-28 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <BottomNav items={items} />
    </div>
  );
}
