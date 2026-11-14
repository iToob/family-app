"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8.5Z" />,
  earn: <path d="M12 3v18M7.5 7.5h6.25a2.75 2.75 0 0 1 0 5.5h-3.5a2.75 2.75 0 0 0 0 5.5H16.5" />,
  spend: <path d="M5 8h14l-1.2 11.1a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9L5 8Zm4 0V6.5a3 3 0 0 1 6 0V8" />,
  wallet: <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-8.5a1.5 1.5 0 0 0-1.5-1.5H6.5A2.5 2.5 0 0 1 4 7.5Zm12.5 6.5h.01" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
  dashboard: <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" />,
  approvals: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  jobs: <path d="M9 6V4.5h6V6m-11 1h16v12H4V7Zm0 5h16" />,
  market: <path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5V20h16V9.5M9 20v-5h6v5" />,
  economy: <path d="M4 20V10m6 10V4m6 16v-7m4 7H3" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />,
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export type NavItem = { href: string; label: string; icon: string; badge?: number; match?: string };

function isActive(path: string, item: NavItem) {
  const base = item.match ?? item.href;
  return base === "/admin" ? path === "/admin" : path === base || path.startsWith(base + "/");
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto flex max-w-xl">
        {items.map((i) => {
          const active = isActive(path, i);
          return (
            <li key={i.href} className="flex-1">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-medium ${active ? "text-euc" : "text-muted"}`}
              >
                <Icon name={i.icon} />
                {i.label}
                {!!i.badge && (
                  <span className="absolute top-1 left-1/2 ml-2 min-w-[18px] rounded-full bg-hold px-1 text-center text-[10px] leading-[18px] text-white">
                    {i.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav({ items, title }: { items: NavItem[]; title: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2">
        <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
        <span className="font-display text-[1.05rem] font-semibold leading-tight">{title}</span>
      </Link>
      <ul className="space-y-0.5">
        {items.map((i) => {
          const active = isActive(path, i);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 font-medium ${active ? "bg-euc-100 text-euc" : "text-muted hover:bg-paper hover:text-ink"}`}
              >
                <Icon name={i.icon} size={20} />
                <span className="flex-1">{i.label}</span>
                {!!i.badge && <span className="rounded-full bg-hold px-1.5 text-xs leading-5 text-white">{i.badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
