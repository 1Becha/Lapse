import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { rollForwardRenewals } from '../src/items.ts';
import { alertKeys } from '../src/scheduler.ts';
import { listViews } from '../src/items.ts';

const cert = (expiresAt: string) => ({
  source: 'tls' as const,
  sourceRef: 'tls:api.example.com:443',
  name: 'api.example.com',
  type: 'certificate' as const,
  expiresAt,
  autoRenews: true,
  meta: { issuer: "Let's Encrypt" },
});

test('discovered items keep user edits and reopen when renewed', () => {
  const store = new Store(':memory:');
  assert.equal(store.upsertDiscovered(cert('2026-11-01T00:00:00.000Z')), 'created');
  const [item] = store.listItems();
  assert.equal(item.lead_days, 20, 'auto-renewing certs use the auto-renew window');

  store.db.prepare(`UPDATE items SET owner = 'ops@example.com', status = 'acknowledged'`).run();
  assert.equal(store.upsertDiscovered(cert('2026-11-01T00:00:00.000Z')), 'unchanged');
  assert.equal(store.getItem(item.id)!.status, 'acknowledged');

  assert.equal(store.upsertDiscovered(cert('2027-01-30T00:00:00.000Z')), 'renewed');
  const after = store.getItem(item.id)!;
  assert.equal(after.status, 'open');
  assert.equal(after.owner, 'ops@example.com');
});

test('auto-renewing contracts roll forward to the next term', () => {
  const store = new Store(':memory:');
  const id = store.createItem({
    name: 'Office lease', type: 'contract', expiresAt: '2025-12-31', noticeValue: 3, noticeUnit: 'months',
    leadDays: 5, bufferDays: 7, autoRenews: true, renewalTermMonths: 12, owner: null, notes: null,
  });
  assert.equal(rollForwardRenewals(store, Date.UTC(2026, 8, 26)), 1);
  assert.equal(store.getItem(id)!.expires_at, '2026-12-31');
});

test('alert keys follow thresholds', () => {
  const store = new Store(':memory:');
  store.createItem({
    name: 'Token', type: 'token', expiresAt: '2026-10-10', noticeValue: 0, noticeUnit: 'days',
    leadDays: 3, bufferDays: 2, autoRenews: false, renewalTermMonths: null, owner: null, notes: null,
  });
  const now = Date.UTC(2026, 8, 26); // act-by is 2026-10-05, 9 days away
  const [view] = listViews(store, now);
  assert.equal(view.daysToAct, 9);
  assert.deepEqual(alertKeys(view), [{ actBy: '2026-10-05', key: 't14' }]);
});
