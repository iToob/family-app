import Link from "next/link";
import { getDb } from "@/db";
import { requireViewer } from "@/server/auth";
import { unreadCount } from "@/server/queries";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";
import { previewAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ChildLayout({ children }: { children: React.ReactNode }) {
  const v = await requireViewer();
  const unread = v.previewing ? 0 : await unreadCount(getDb(), v.subjectId);
  const items: NavItem[] = [
    { href: "/home", label: "Home", icon: "home" },
    { href: "/earn", label: "Earn", icon: "earn" },
    { href: "/spend", label: "Spend", icon: "spend" },
    { href: "/wallet", label: "Wallet", icon: "wallet" },
    { href: "/more", label: "More", icon: "more", badge: unread },
  ];
  return (
    <div className="lg:flex">
      <SideNav items={items} title={v.householdName} />
      <div className="min-w-0 flex-1">
        {v.previewing && (
          <form action={previewAction} className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-brass px-4 py-2 text-sm text-white">
            <span>Previewing {v.subjectName}'s view (read-only)</span>
            <button className="rounded-full bg-white/20 px-3 py-1 font-semibold">Back to admin</button>
          </form>
        )}
        {v.isDemo && !v.previewing && (
          <div className="bg-hold-100 px-4 py-1.5 text-center text-xs text-hold">Demonstration data. Not real balances.</div>
        )}
        <main className="mx-auto max-w-xl px-4 pt-5 pb-28 lg:pb-10">{children}</main>
      </div>
      <BottomNav items={items} />
    </div>
  );
}
