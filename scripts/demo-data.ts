// Demo data for a fictional company, used for screenshots and the README GIF.
// All addresses use the reserved .example domain, so no alert can reach anyone.
import { addMonths, DAY, ymd } from '../src/actby.ts';
import type { Store } from '../src/store.ts';

export function seedDemo(store: Store, now = Date.now()): void {
  const inDays = (n: number) => ymd(now + n * DAY);
  const iso = (n: number) => new Date(now + n * DAY).toISOString();
  const base = { noticeValue: 0, noticeUnit: 'days' as const, autoRenews: false, renewalTermMonths: null, owner: null, notes: null };

  // Office lease ending on a month end, 3 months notice: cancel-by in about 3 weeks.
  const around = new Date(addMonths(now + 36 * DAY, 3));
  const leaseEnd = ymd(Date.UTC(around.getUTCFullYear(), around.getUTCMonth(), 0));
  store.createItem({
    ...base, name: 'Office lease, Hauptstraße 1', type: 'contract', expiresAt: leaseEnd,
    noticeValue: 3, noticeUnit: 'months', leadDays: 5, bufferDays: 7, autoRenews: true, renewalTermMonths: 12,
    owner: 'finance@acme.example', notes: 'Cancellation must be in writing (registered letter).',
  });

  const token = store.createItem({
    ...base, name: 'CI deploy token', type: 'token', expiresAt: inDays(9), leadDays: 3, bufferDays: 4,
    owner: 'ops@acme.example',
  });
  store.setStatus(token, 'acknowledged');

  // Monthly plan with 3 months notice: this cycle is lost, the next chance is shown.
  store.createItem({
    ...base, name: 'Analytics tool (monthly plan)', type: 'subscription', expiresAt: inDays(18),
    noticeValue: 3, noticeUnit: 'months', leadDays: 0, bufferDays: 0, autoRenews: true, renewalTermMonths: 1,
  });

  store.createItem({
    ...base, name: 'Design software (10 seats)', type: 'license', expiresAt: inDays(70), leadDays: 30, bufferDays: 7,
    owner: 'it@acme.example',
  });
  store.createItem({
    ...base, name: 'Passport, Anna Schmidt', type: 'document', expiresAt: inDays(140), leadDays: 42, bufferDays: 14,
    owner: 'anna@acme.example',
  });
  store.createItem({
    ...base, name: 'Fleet insurance', type: 'contract', expiresAt: inDays(220),
    noticeValue: 1, noticeUnit: 'months', leadDays: 5, bufferDays: 7, autoRenews: true, renewalTermMonths: 12,
    owner: 'finance@acme.example',
  });

  // Discovered by scanning acme.example. api.* should have auto-renewed by now: renewal is broken.
  const cert = (host: string, days: number) =>
    store.upsertDiscovered({
      source: 'tls', sourceRef: `tls:${host}:443`, name: host, type: 'certificate', expiresAt: iso(days),
      autoRenews: true, meta: { issuer: "Let's Encrypt", trusted: true, error: null },
    });
  cert('api.acme.example', 12);
  cert('shop.acme.example', 34);
  cert('www.acme.example', 75);
  cert('acme.example', 75);
  cert('status.acme.example', 81);
  store.upsertDiscovered({
    source: 'rdap', sourceRef: 'rdap:acme.example', name: 'acme.example', type: 'domain',
    expiresAt: iso(130), autoRenews: false, meta: { registrar: 'Example Registrar GmbH' },
  });

  store.addDomain('acme.example');
  const domain = store.listDomains()[0];
  store.recordScan(domain.id, {
    hostsInCtLogs: 7, hostsReachable: 5, created: 6, renewed: 0, domainExpiry: iso(130), notes: [],
  }, null);

  store.addChannel('#ops-alerts', 'slack', 'https://hooks.slack.example/services/T000/B000/demo', false);
  store.addChannel('Finance team', 'email', 'finance@acme.example', false);
  store.addChannel('Team lead phone', 'ntfy', 'https://ntfy.example/acme-deadlines', true);
}
