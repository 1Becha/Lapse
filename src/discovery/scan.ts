import { config } from '../config.ts';
import type { DomainRow, Store } from '../store.ts';
import { findHostnames } from './ct.ts';
import { lookupDomain } from './rdap.ts';
import { checkTls, isAcmeIssuer } from './tls.ts';

export interface ScanResult {
  hostsInCtLogs: number;
  hostsReachable: number;
  created: number;
  renewed: number;
  domainExpiry: string | null;
  notes: string[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function scanDomain(store: Store, domain: DomainRow): Promise<ScanResult> {
  const result: ScanResult = { hostsInCtLogs: 0, hostsReachable: 0, created: 0, renewed: 0, domainExpiry: null, notes: [] };
  const count = (outcome: 'created' | 'renewed' | 'unchanged') => {
    if (outcome === 'created') result.created++;
    if (outcome === 'renewed') result.renewed++;
  };

  try {
    const info = await lookupDomain(domain.name);
    result.domainExpiry = info.expiresAt;
    if (info.expiresAt) {
      count(store.upsertDiscovered({
        source: 'rdap',
        sourceRef: `rdap:${domain.name}`,
        name: domain.name,
        type: 'domain',
        expiresAt: info.expiresAt,
        autoRenews: false,
        meta: { registrar: info.registrar },
      }));
    } else {
      result.notes.push('The registry does not publish an expiry date for this domain. Add it manually.');
    }
  } catch (err) {
    result.notes.push(`Domain lookup failed: ${(err as Error).message}`);
  }

  let hosts = [domain.name];
  try {
    hosts = await findHostnames(domain.name, config.ctMaxHosts);
    result.hostsInCtLogs = hosts.length;
  } catch (err) {
    result.notes.push(`Certificate Transparency lookup failed: ${(err as Error).message}. Checked the apex only.`);
  }

  const checks = await mapLimit(hosts, 5, (host) => checkTls(host));
  checks.forEach((check, i) => {
    if (check.status !== 'fulfilled') return;
    result.hostsReachable++;
    const tlsInfo = check.value;
    count(store.upsertDiscovered({
      source: 'tls',
      sourceRef: `tls:${hosts[i]}:443`,
      name: hosts[i],
      type: 'certificate',
      expiresAt: tlsInfo.validTo,
      autoRenews: isAcmeIssuer(tlsInfo.issuer),
      meta: { issuer: tlsInfo.issuer, trusted: tlsInfo.trusted, error: tlsInfo.error },
    }));
  });

  store.recordScan(domain.id, { ...result }, null);
  return result;
}

export async function scanDomainSafe(store: Store, domain: DomainRow): Promise<void> {
  try {
    await scanDomain(store, domain);
  } catch (err) {
    store.recordScan(domain.id, null, (err as Error).message);
  }
}
