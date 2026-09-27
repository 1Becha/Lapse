import { config } from './config.ts';
import { ymd } from './actby.ts';
import { listViews, rollForwardRenewals, type ItemView } from './items.ts';
import { alertMessage, emailEnabled, sendEmail, sendToChannel } from './notify.ts';
import { scanDomainSafe } from './discovery/scan.ts';
import { removeOrphans } from './attachments.ts';
import type { Store } from './store.ts';

// Alerts fire once when the act-by date comes within each threshold (in days).
const THRESHOLDS = [0, 1, 3, 7, 14, 30];
const ESCALATE = new Set(['t0', 't1', 't3', 'overdue', 'expired']);

export interface AlertKey {
  // The deadline the alert is about; alerts are de-duplicated per (item, deadline, key).
  actBy: string;
  key: string;
}

function thresholdKey(actBy: number, daysToAct: number): AlertKey[] {
  const t = THRESHOLDS.find((t) => daysToAct <= t);
  return t === undefined ? [] : [{ actBy: ymd(actBy), key: `t${t}` }];
}

export function alertKeys(item: ItemView): AlertKey[] {
  if (item.status === 'done') return [];
  if (item.urgency === 'expired') return [{ actBy: ymd(item.actBy), key: 'expired' }];
  if (item.missed) {
    // Say once that the deadline was missed, then count down to the next chance.
    const keys = [{ actBy: ymd(item.actBy), key: 'missed' }];
    const { nextActBy, daysToNextAct } = item.missed;
    if (nextActBy !== null && daysToNextAct !== null) keys.push(...thresholdKey(nextActBy, daysToNextAct));
    return keys;
  }
  if (item.daysToAct < 0) return [{ actBy: ymd(item.actBy), key: 'overdue' }];
  return thresholdKey(item.actBy, item.daysToAct);
}

export async function sendDueAlerts(store: Store, now = Date.now()): Promise<number> {
  const channels = store.listChannels();
  let sent = 0;

  for (const item of listViews(store, now)) {
    for (const { actBy, key } of alertKeys(item)) {
      if (store.wasAlertSent(item.id, actBy, key)) continue;

      // Nobody has acknowledged it and time is running out: widen the audience.
      const escalation = ESCALATE.has(key) && item.status === 'open';
      const msg = alertMessage(item, escalation, key === 'missed' ? 'missed' : 'deadline');
      const targets = channels.filter((c) => !c.escalation_only || escalation);

      const deliveries: Promise<void>[] = targets.map((c) => sendToChannel(c, msg));
      if (item.owner?.includes('@') && emailEnabled()) deliveries.push(sendEmail(item.owner, msg.title, msg.text));
      if (deliveries.length === 0) continue;

      const results = await Promise.allSettled(deliveries);
      for (const r of results) if (r.status === 'rejected') console.error(`[lapse] alert delivery failed: ${r.reason}`);
      if (results.some((r) => r.status === 'fulfilled')) {
        store.markAlertSent(item.id, actBy, key);
        sent++;
      }
    }
  }
  return sent;
}

function scanDue(lastScanAt: string | null, now: number): boolean {
  if (!lastScanAt) return true;
  // SQLite datetime('now') is UTC without a zone marker.
  return now - Date.parse(lastScanAt.replace(' ', 'T') + 'Z') >=config.scanIntervalHours * 3_600_000;
}

let running = false;

export async function tick(store: Store): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    rollForwardRenewals(store, now);
    removeOrphans(store.attachmentIds());
    for (const domain of store.listDomains()) {
      if (scanDue(domain.last_scan_at, now)) await scanDomainSafe(store, domain);
    }
    const sent = await sendDueAlerts(store);
    if (sent) console.log(`[lapse] sent ${sent} alert(s)`);
  } catch (err) {
    console.error('[lapse] scheduler error', err);
  } finally {
    running = false;
  }
}

export function startScheduler(store: Store): void {
  void tick(store);
  setInterval(() => void tick(store), 60 * 60 * 1000).unref();
}
