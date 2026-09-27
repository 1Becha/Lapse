import { config } from '../config.ts';

// Certificate Transparency: every publicly trusted certificate is logged,
// so crt.sh reveals hostnames you forgot you had.

interface CrtShEntry {
  name_value: string;
  not_after: string;
}

export async function findHostnames(domain: string, max: number): Promise<string[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent('%.' + domain)}&output=json&exclude=expired`;
  const res = await fetch(url, {
    headers: { 'user-agent': config.userAgent },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`crt.sh responded ${res.status}`);
  const entries = (await res.json()) as CrtShEntry[];

  const hosts = new Set<string>([domain]);
  for (const entry of entries) {
    for (let name of entry.name_value.split('\n')) {
      name = name.trim().toLowerCase().replace(/^\*\./, '');
      if (name === domain || name.endsWith('.' + domain)) hosts.add(name);
    }
  }
  return [...hosts].sort().slice(0, max);
}
