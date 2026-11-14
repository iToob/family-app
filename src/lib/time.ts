/**
 * Timezone-aware calendar helpers. Timestamps are stored in UTC; calendar logic
 * (recurrence, billing periods, "this week") is done in the household timezone.
 * Local dates are handled as "YYYY-MM-DD" strings to avoid accidental UTC shifts.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

function parts(date: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const { type, value } of dtf(tz).formatToParts(date)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset (ms) of tz from UTC at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The local calendar date ("YYYY-MM-DD") of an instant in tz. */
export function localDate(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The UTC instant of local midnight at the start of a local date in tz. */
export function startOfLocalDate(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes handle DST transitions correctly.
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  ts = guess - tzOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Add calendar months, clamping to the end of shorter months (31 Jan + 1 = 28/29 Feb). */
export function addMonths(dateStr: string, months: number, anchorDay?: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = anchorDay ?? d;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Monday of the local week containing dateStr. */
export function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDays(dateStr, -((dow + 6) % 7));
}

export function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 8) + "01";
}

export type Frequency = "DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";

/** Next period start after `dateStr` for a frequency. */
export function nextPeriod(dateStr: string, freq: Frequency, everyDays?: number | null, anchorDay?: number): string {
  switch (freq) {
    case "DAILY":
      return addDays(dateStr, 1);
    case "WEEKLY":
      return addDays(dateStr, 7);
    case "FORTNIGHTLY":
      return addDays(dateStr, 14);
    case "MONTHLY":
      return addMonths(dateStr, 1, anchorDay);
    case "CUSTOM":
      return addDays(dateStr, Math.max(1, everyDays ?? 1));
  }
}

/**
 * The start of the recurrence period that contains `today`, counting from `anchor`.
 * Returns null if today is before the anchor.
 */
export function currentPeriodStart(
  anchor: string,
  today: string,
  freq: Frequency,
  everyDays?: number | null,
): string | null {
  if (today < anchor) return null;
  if (freq === "MONTHLY") {
    const anchorDay = Number(anchor.slice(8, 10));
    const [ay, am] = anchor.split("-").map(Number);
    const [ty, tm] = today.split("-").map(Number);
    let k = (ty - ay) * 12 + (tm - am);
    let candidate = addMonths(anchor, k, anchorDay);
    while (candidate > today) candidate = addMonths(anchor, --k, anchorDay);
    return candidate;
  }
  const step = freq === "DAILY" ? 1 : freq === "WEEKLY" ? 7 : freq === "FORTNIGHTLY" ? 14 : Math.max(1, everyDays ?? 1);
  const diff = daysBetween(anchor, today);
  return addDays(anchor, diff - (diff % step));
}

const displayCache = new Map<string, Intl.DateTimeFormat>();
export function formatDate(date: Date | null | undefined, tz = "Australia/Brisbane", withTime = false): string {
  if (!date) return "";
  const key = tz + withTime;
  let f = displayCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-AU", {
      timeZone: tz,
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    });
    displayCache.set(key, f);
  }
  return f.format(date);
}
