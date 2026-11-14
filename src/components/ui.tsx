import Link from "next/link";
import type { ReactNode } from "react";
import { formatAud, formatPoints, pointsToCents } from "@/lib/money";

/** The Points mark: a small brass coin. Used consistently wherever Points appear. */
export function Coin({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={`inline-block shrink-0 ${className}`}>
      <circle cx="10" cy="10" r="9" fill="#d9ad4f" stroke="#9c7120" strokeWidth="1.2" />
      <circle cx="10" cy="10" r="6.4" fill="none" stroke="#9c7120" strokeWidth="0.8" opacity="0.7" />
      <path d="M8 6.2h2.6a2.1 2.1 0 0 1 0 4.2H8V6.2Zm0 4.2v3.6" fill="none" stroke="#5e430f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Points({
  value,
  signed = false,
  size = 16,
  className = "",
  tone,
}: {
  value: number;
  signed?: boolean;
  size?: number;
  className?: string;
  tone?: "auto" | "plain";
}) {
  const color = tone === "auto" ? (value > 0 ? "text-credit" : "text-ink") : "";
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums whitespace-nowrap ${color} ${className}`}>
      <Coin size={size} />
      <span>{formatPoints(value, { signed })}</span>
      <span className="sr-only"> Points</span>
    </span>
  );
}

export function Aud({ points, rate, className = "" }: { points: number; rate: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatAud(pointsToCents(points, rate))}</span>;
}

export function PageHeader({ title, subtitle, action, back }: { title: string; subtitle?: ReactNode; action?: ReactNode; back?: string }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-block text-sm text-muted hover:text-ink">
            ‹ Back
          </Link>
        )}
        <h1 className="text-[1.65rem] font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Section({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mb-6 ${className}`}>
      {(title || action) && (
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          {title && <h2 className="text-[1.05rem] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function Rows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel rows overflow-hidden ${className}`}>{children}</div>;
}

export function Row({
  href,
  children,
  className = "",
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = `flex items-center gap-3 px-4 py-3 ${className}`;
  if (href)
    return (
      <Link href={href} className={`${cls} hover:bg-euc-100/50`}>
        {children}
      </Link>
    );
  return <div className={cls}>{children}</div>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel px-5 py-6 text-center text-muted">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  // [label, classes]
  ACTIVE: ["Active", "bg-euc-100 text-euc"],
  PAUSED: ["Paused", "bg-hold-100 text-hold"],
  NOT_PARTICIPATING: ["Not participating", "bg-line/60 text-muted"],
  ARCHIVED: ["Archived", "bg-line/60 text-muted"],
  OPEN: ["Open", "bg-euc-100 text-euc"],
  CLAIMED: ["Claimed", "bg-brass-100 text-[#7a5a17]"],
  IN_PROGRESS: ["In progress", "bg-brass-100 text-[#7a5a17]"],
  SUBMITTED: ["Awaiting approval", "bg-hold-100 text-hold"],
  RETURNED: ["Needs fixes", "bg-danger-100 text-danger"],
  APPROVED: ["Approved", "bg-euc-100 text-euc"],
  PAID: ["Paid", "bg-euc-100 text-credit"],
  REJECTED: ["Not approved", "bg-danger-100 text-danger"],
  CANCELLED: ["Cancelled", "bg-line/60 text-muted"],
  REQUESTED: ["Awaiting approval", "bg-hold-100 text-hold"],
  AWAITING_FULFILMENT: ["Awaiting delivery", "bg-brass-100 text-[#7a5a17]"],
  FULFILLED: ["Delivered", "bg-euc-100 text-euc"],
  REFUNDED: ["Refunded", "bg-line/60 text-muted"],
  GRACE: ["Payment due", "bg-hold-100 text-hold"],
  UNPAID: ["Unpaid", "bg-danger-100 text-danger"],
  PENDING: ["Pending", "bg-hold-100 text-hold"],
  INFO_REQUESTED: ["More info needed", "bg-brass-100 text-[#7a5a17]"],
  COUNTERED: ["Counter-offer", "bg-brass-100 text-[#7a5a17]"],
  DECLINED: ["Declined", "bg-line/60 text-muted"],
  WITHDRAWN: ["Withdrawn", "bg-line/60 text-muted"],
  RESOLVED: ["Resolved", "bg-euc-100 text-euc"],
  COMPLETED: ["Completed", "bg-euc-100 text-euc"],
  EXPIRED: ["Expired", "bg-line/60 text-muted"],
  CLOSED: ["Closed", "bg-line/60 text-muted"],
};

export function Status({ value }: { value: string }) {
  const [label, cls] = STATUS[value] ?? [value, "bg-line/60 text-muted"];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white"
      style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-0.5 font-display text-xl font-semibold">{children}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: ReactNode }) {
  const cls = tone === "warn" ? "bg-hold-100 text-hold" : tone === "danger" ? "bg-danger-100 text-danger" : "bg-euc-100 text-euc";
  return <div className={`mb-4 rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export const LEDGER_LABEL: Record<string, string> = {
  OPENING_BALANCE: "Opening balance",
  JOB_EARNING: "Job",
  BONUS: "Bonus",
  MANUAL_AWARD: "Award",
  MARKETPLACE_PURCHASE: "Purchase",
  SUBSCRIPTION_PAYMENT: "Subscription",
  CASH_CONVERSION: "Cash-out",
  REFUND: "Refund",
  CORRECTION: "Correction",
};

/** Simple accessible SVG bar chart. */
export function BarChart({
  data,
  series,
  height = 160,
}: {
  data: { label: string; [k: string]: number | string }[];
  series: { key: string; label: string; color: string }[];
  height?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const w = 100 / data.length;
  const bw = (w * 0.7) / series.length;
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={series.map((s) => s.label).join(" and ") + " by period"}>
        {data.map((d, i) =>
          series.map((s, j) => {
            const v = Number(d[s.key]) || 0;
            const h = (v / max) * (height / 3 - 2);
            return (
              <rect key={`${i}-${j}`} x={i * w + w * 0.15 + j * bw} y={height / 3 - h} width={bw * 0.9} height={h} rx={0.6} fill={s.color}>
                <title>{`${d.label} ${s.label}: ${v.toLocaleString("en-AU")}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="mt-1 flex text-[11px] text-muted">
        {data.map((d, i) => (
          <span key={i} className="text-center" style={{ width: `${w}%` }}>
            {i % Math.ceil(data.length / 8) === 0 ? d.label : ""}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function HBars({ data, color = "#15514a" }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="px-1 text-sm text-muted">Nothing yet.</p>;
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label}>
          <div className="flex justify-between text-sm">
            <span className="truncate">{d.label}</span>
            <span className="tabular-nums text-muted">{d.value.toLocaleString("en-AU")}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-line/60">
            <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-2 rounded-full bg-line/70" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 rounded-full bg-brass" style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

/** A charter body with simple markdown: # headings, - bullets, *italic*, paragraphs. */
export function CharterText({ body, rate }: { body: string; rate: string }) {
  const blocks: ReactNode[] = [];
  const lines = body.replaceAll("{{rate}}", rate).split("\n");
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    list = [];
  };
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.join(" ").replace(/^\*(.*)\*$/, "$1")}</p>);
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("# ")) {
      flushList();
      flushPara();
      blocks.push(<h1 key={blocks.length}>{line.slice(2)}</h1>);
    } else if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2));
    } else if (!line) {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushList();
  flushPara();
  return <div className="prose-charter">{blocks}</div>;
}
