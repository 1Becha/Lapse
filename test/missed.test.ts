import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ymd } from '../src/actby.ts';
import { toView } from '../src/items.ts';
import { alertKeys } from '../src/scheduler.ts';
import { buildCalendar } from '../src/ics.ts';
import type { ItemRow } from '../src/store.ts';

const NOW = Date.UTC(2026, 8, 26); // 2026-09-26

function row(overrides: Partial<ItemRow>): ItemRow {
  return {
    id: 1, name: 'Office lease', type: 'contract', expires_at: '2026-12-31',
    notice_value: 3, notice_unit: 'months', lead_days: 5, buffer_days: 7,
    auto_renews: 1, renewal_term_months: 12, owner: null, notes: null, status: 'open',
    source: 'manual', source_ref: null, meta: null, attachment: null, last_checked_at: null,
    created_at: '', updated_at: '', ...overrides,
  };
}

test('a missed cancel-by date points to the next chance, one term later', () => {
  const v = toView(row({}), NOW);
  assert.equal(ymd(v.actBy), '2026-09-18');
  assert.equal(v.urgency, 'missed');
  assert.ok(v.missed);
  assert.equal(ymd(v.missed.renewsOn), '2026-12-31');
  assert.equal(ymd(v.missed.nextExpiry!), '2027-12-31');
  assert.equal(ymd(v.missed.nextActBy!), '2027-09-18');
  assert.equal(ymd(v.nextDeadline), '2027-09-18');
  assert.match(v.action, /Next chance to cancel: 2027-09-18, to end it on 2027-12-31/);
});

test('notice longer than the term skips ahead several terms', () => {
  // Monthly plan, 3 months notice: cancelling now can only end it in January.
  const v = toView(row({ type: 'subscription', expires_at: '2026-10-15', renewal_term_months: 1, lead_days: 0, buffer_days: 0 }), NOW);
  assert.equal(v.urgency, 'missed');
  assert.equal(ymd(v.missed!.nextActBy!), '2026-10-15');
  assert.equal(ymd(v.missed!.nextExpiry!), '2027-01-15');
  assert.equal(v.missed!.daysToNextAct, 19);
});

test('unknown renewal term: missed, but no next chance', () => {
  const v = toView(row({ renewal_term_months: null }), NOW);
  assert.equal(v.urgency, 'missed');
  assert.equal(v.missed!.nextActBy, null);
  assert.match(v.action, /Set how many months it renews for/);
});

test('only items that renew unless cancelled can be missed', () => {
  assert.equal(toView(row({ auto_renews: 0 }), NOW).urgency, 'overdue');
  // An auto-renewing certificate past its act-by date means renewal broke: still overdue.
  assert.equal(toView(row({ type: 'certificate', notice_value: 0, lead_days: 20, buffer_days: 0, expires_at: '2026-10-10' }), NOW).urgency, 'overdue');
  // After the end date it's expired (the scheduler rolls it forward).
  assert.equal(toView(row({ expires_at: '2026-09-20' }), NOW).urgency, 'expired');
});

test('alerts: one "missed" notice, then a countdown to the next chance', () => {
  assert.deepEqual(alertKeys(toView(row({}), NOW)), [{ actBy: '2026-09-18', key: 'missed' }]);

  const monthly = toView(row({ type: 'subscription', expires_at: '2026-10-15', renewal_term_months: 1, lead_days: 0, buffer_days: 0 }), NOW);
  assert.deepEqual(alertKeys(monthly), [
    { actBy: '2026-07-15', key: 'missed' },
    { actBy: '2026-10-15', key: 't30' },
  ]);

  assert.deepEqual(alertKeys(toView(row({ status: 'done' }), NOW)), []);
});

test('the calendar shows the next chance, not the missed date', () => {
  const ics = buildCalendar([toView(row({}), NOW)], 'http://lapse.test');
  assert.match(ics, /DTSTART;VALUE=DATE:20270918/);
  assert.match(ics, /SUMMARY:Last day to cancel: Office lease/);
  assert.doesNotMatch(ics, /20260918/);
});
