import { config } from '../config.ts';

// RDAP is the structured successor of WHOIS. rdap.org redirects to the right registry.

interface RdapEvent {
  eventAction: string;
  eventDate: string;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, unknown, string, string][]];
}

interface RdapDomain {
  events?: RdapEvent[];
  entities?: RdapEntity[];
}

export interface DomainInfo {
  expiresAt: string | null;
  registrar: string | null;
}

export async function lookupDomain(domain: string): Promise<DomainInfo> {
  const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    headers: { accept: 'application/rdap+json', 'user-agent': config.userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RDAP responded ${res.status}`);
  const data = (await res.json()) as RdapDomain;

  const expiration = data.events?.find((e) => e.eventAction === 'expiration')?.eventDate ?? null;
  const registrarEntity = data.entities?.find((e) => e.roles?.includes('registrar'));
  const fn = registrarEntity?.vcardArray?.[1]?.find((f) => f[0] === 'fn');

  return {
    // Some registries (e.g. DENIC for .de) do not publish expiry dates.
    expiresAt: expiration ? new Date(expiration).toISOString() : null,
    registrar: fn ? String(fn[3]) : null,
  };
}
