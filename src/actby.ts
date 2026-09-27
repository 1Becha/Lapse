// The act-by engine: the date that matters is not when something expires,
// but the last day you can still do something about it.
//
//   act-by = expiry − notice period − lead time − safety buffer

export type NoticeUnit = 'days' | 'weeks' | 'months';
// 'missed' is assigned by items.ts for auto-renewing contracts; urgencyOf never returns it.
export type Urgency = 'expired' | 'overdue' | 'critical' | 'missed' | 'soon' | 'upcoming' | 'ok';

export const DAY = 86_400_000;

export interface ActByInput {
  expiresAt: string;
  noticeValue: number;
  noticeUnit: NoticeUnit;
  leadDays: number;
  bufferDays: number;
}

export function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function daysBetween(from: number, to: number): number {
  return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / DAY);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Calendar month arithmetic. Month-end dates stay month-end
// (a contract ending 28 Feb with 1 month notice must be cancelled by 31 Jan).
export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const isMonthEnd = day === lastDayOfMonth(year, month);
  const target = new Date(Date.UTC(year, month + months, 1));
  const targetLast = lastDayOfMonth(target.getUTCFullYear(), target.getUTCMonth());
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), isMonthEnd ? targetLast : Math.min(day, targetLast));
}

export function subtractNotice(ts: number, value: number, unit: NoticeUnit): number {
  if (!value) return ts;
  if (unit === 'months') return addMonths(ts, -value);
  return ts - value * (unit === 'weeks' ? 7 : 1) * DAY;
}

export function computeActBy(i: ActByInput): number {
  const expiry = startOfUtcDay(Date.parse(i.expiresAt));
  const noticeDeadline = subtractNotice(expiry, i.noticeValue, i.noticeUnit);
  return noticeDeadline - (i.leadDays + i.bufferDays) * DAY;
}

export function urgencyOf(expiresAt: number, actBy: number, now: number): Urgency {
  if (daysBetween(now, expiresAt) < 0) return 'expired';
  const daysToAct = daysBetween(now, actBy);
  if (daysToAct < 0) return 'overdue';
  if (daysToAct <= 7) return 'critical';
  if (daysToAct <= 30) return 'soon';
  if (daysToAct <= 90) return 'upcoming';
  return 'ok';
}

export function ymd(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
