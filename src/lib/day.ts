/**
 * Calendar-day helpers.
 *
 * `Date.prototype.toISOString()` renders in UTC, so a local midnight in Manila
 * (UTC+8) serialises as the *previous* day. Day keys written that way never
 * match day keys read that way, which silently broke the streak and the evening
 * check-in for everyone outside UTC. Everything day-shaped goes through here.
 */

/** The user's local calendar day, as YYYY-MM-DD. */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local calendar day N days before `from` (defaults to today). */
export function daysAgoKey(n: number, from: Date = new Date()): string {
  return dayKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() - n));
}

/**
 * Parses a date-only string (YYYY-MM-DD, as produced by <input type="date">)
 * into local midnight, so a deadline never lands a day early or late.
 */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
