import { addMonths, computeActBy, daysBetween, urgencyOf, ymd, type Urgency } from './actby.ts';
import type { ItemRow, Store } from './store.ts';

// The cancel-by date passed, so the item renews on its expiry date. Nothing can be
// done about this term any more; what matters now is the next chance to cancel.
export interface Missed {
  renewsOn: number;
  // Null when the renewal term is unknown.
  nextExpiry: number | null;
  nextActBy: number | null;
  daysToNextAct: number | null;
}

export interface ItemView extends ItemRow {
  expiresTs: number;
  actBy: number;
  daysToAct: number;
  daysToExpiry: number;
  urgency: Urgency;
  missed: Missed | null;
  // The deadline the user can still meet: the next chance when missed, else actBy.
  nextDeadline: number;
  action: string;
}

// Items that renew by themselves unless someone cancels them in time.
// (Auto-renewing certificates are different: a passed act-by date means renewal broke.)
export function renewsUnlessCancelled(row: ItemRow): boolean {
  return row.auto_renews === 1 && (row.type === 'contract' || row.type === 'subscription' || row.type === 'license');
}

export function actByFor(row: ItemRow, expiresAt: string): number {
  return computeActBy({
    expiresAt,
    noticeValue: row.notice_value,
    noticeUnit: row.notice_unit,
    leadDays: row.lead_days,
    bufferDays: row.buffer_days,
  });
}

export function findMissed(row: ItemRow, expiresTs: number, actBy: number, now: number): Missed | null {
  if (!renewsUnlessCancelled(row) || daysBetween(now, actBy) >= 0 || daysBetween(now, expiresTs) < 0) return null;
  const term = row.renewal_term_months;
  if (!term) return { renewsOn: expiresTs, nextExpiry: null, nextActBy: null, daysToNextAct: null };

  // Step forward term by term. When the notice period is longer than the term
  // (a monthly plan with 3 months notice), the next chance may be several terms out.
  let nextExpiry = expiresTs;
  let nextActBy = actBy;
  while (daysBetween(now, nextActBy) < 0) {
    nextExpiry = addMonths(nextExpiry, term);
    nextActBy = actByFor(row, ymd(nextExpiry));
  }
  return { renewsOn: expiresTs, nextExpiry, nextActBy, daysToNextAct: daysBetween(now, nextActBy) };
}

export function toView(row: ItemRow, now = Date.now()): ItemView {
  const expiresTs = Date.parse(row.expires_at);
  const actBy = actByFor(row, row.expires_at);
  const missed = findMissed(row, expiresTs, actBy, now);
  return {
    ...row,
    expiresTs,
    actBy,
    daysToAct: daysBetween(now, actBy),
    daysToExpiry: daysBetween(now, expiresTs),
    urgency: missed ? 'missed' : urgencyOf(expiresTs, actBy, now),
    missed,
    nextDeadline: missed?.nextActBy ?? actBy,
    action: missed ? describeMissed(row, missed) : describeAction(row, actBy),
  };
}

export function describeMissed(row: ItemRow, m: Missed): string {
  const renews = `It renews automatically on ${ymd(m.renewsOn)}`;
  if (!m.nextExpiry || !m.nextActBy) {
    return `The cancel-by date has passed. ${renews}. Set how many months it renews for to see your next chance to cancel.`;
  }
  return `The cancel-by date has passed. ${renews}. Next chance to cancel: ${ymd(m.nextActBy)}, to end it on ${ymd(m.nextExpiry)}.`;
}

export function describeAction(row: ItemRow, actBy: number): string {
  const date = ymd(actBy);
  const auto = row.auto_renews === 1;
  switch (row.type) {
    case 'certificate':
      return auto
        ? `Should auto-renew before ${date}. If it hasn't by then, renewal is broken.`
        : `Renew and deploy by ${date}.`;
    case 'contract':
    case 'subscription':
      return auto
        ? `Cancel or renegotiate by ${date}, or it renews automatically.`
        : `Decide on renewal by ${date}.`;
    case 'token':
      return `Rotate by ${date} and update every system that uses it.`;
    case 'document':
      return `Apply for renewal by ${date}.`;
    default:
      return `Start renewal by ${date}.`;
  }
}

const ORDER: Record<Urgency, number> = { expired: 0, overdue: 1, critical: 2, missed: 3, soon: 4, upcoming: 5, ok: 6 };

export function listViews(store: Store, now = Date.now()): ItemView[] {
  return store
    .listItems()
    .map((r) => toView(r, now))
    .sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency] || a.nextDeadline - b.nextDeadline);
}

// Contracts and subscriptions with a known term roll over on their own when
// nobody cancels. Move them to the next cycle so the next cancel-by date shows up.
export function rollForwardRenewals(store: Store, now = Date.now()): number {
  let rolled = 0;
  for (const row of store.listItems()) {
    if (!row.auto_renews || !row.renewal_term_months || row.source !== 'manual') continue;
    let ts = Date.parse(row.expires_at);
    if (daysBetween(now, ts) >= 0) continue;
    while (daysBetween(now, ts) < 0) ts = addMonths(ts, row.renewal_term_months);
    store.setExpiry(row.id, ymd(ts));
    rolled++;
  }
  return rolled;
}
