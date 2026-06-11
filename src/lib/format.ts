const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact relative timestamp in the style of messaging apps. */
export function timeAgo(unixSeconds: number, now: Date = new Date()): string {
  const then = new Date(unixSeconds * 1000);
  const diffSec = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400 && then.getDate() === now.getDate()) return `${Math.floor(diffSec / 3600)}h`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (diffSec < 7 * 86400) return WEEKDAYS[then.getDay()];

  const md = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? md : `${md}, ${then.getFullYear()}`;
}

/** Compact relative timestamp for a future moment ("in 5m", "in 3h", "in 2d").
 * Counterpart of timeAgo for next-run displays; past/imminent times → "now". */
export function timeUntil(unixSeconds: number, now: Date = new Date()): string {
  const diffSec = (unixSeconds * 1000 - now.getTime()) / 1000;
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `in ${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `in ${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 30 * 86400) return `in ${Math.floor(diffSec / 86400)}d`;

  const then = new Date(unixSeconds * 1000);
  const md = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? md : `${md}, ${then.getFullYear()}`;
}

/** Parse an ISO-8601 timestamp (cron job records) to unix seconds; null when absent or invalid. */
export function isoToUnix(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
