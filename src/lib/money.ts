/**
 * Points and money. All amounts are integers: Points are whole numbers and money is
 * whole AUD cents. The exchange rate is stored as integer cents per Point, so
 * conversion is a single integer multiplication with no rounding and no floats.
 */

export function assertSafeInt(n: number, label = "amount"): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be a whole number`);
  return n;
}

/** Points to AUD cents. Exact and deterministic. */
export function pointsToCents(points: number, centsPerPoint: number): number {
  assertSafeInt(points, "points");
  assertSafeInt(centsPerPoint, "rate");
  if (centsPerPoint <= 0) throw new Error("rate must be positive");
  const cents = points * centsPerPoint;
  return assertSafeInt(cents, "cents");
}

const audFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

/** Format integer cents as Australian dollars, e.g. 8400 -> "$84.00". */
export function formatAud(cents: number): string {
  // Integer cents -> string without float error: split dollars and cents.
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  const formatted = audFormatter.format(dollars).replace(/\.00$/, "") + "." + String(rem).padStart(2, "0");
  return negative ? `-${formatted}` : formatted;
}

const pointsFormatter = new Intl.NumberFormat("en-AU");

export function formatPoints(points: number, opts: { signed?: boolean } = {}): string {
  const s = pointsFormatter.format(Math.abs(points));
  if (opts.signed) return (points > 0 ? "+" : points < 0 ? "−" : "") + s;
  return points < 0 ? `−${s}` : s;
}

/** Human description of a rate, e.g. 10 cents/point -> "10 Points = $1.00". */
export function describeRate(centsPerPoint: number): string {
  if (100 % centsPerPoint === 0) return `${100 / centsPerPoint} Points = $1.00`;
  return `1 Point = ${formatAud(centsPerPoint)}`;
}
