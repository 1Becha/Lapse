import tls from 'node:tls';

export interface TlsInfo {
  validTo: string;
  issuer: string;
  trusted: boolean;
  error: string | null;
}

// Issuers that are practically always used with automatic (ACME) renewal.
const ACME_ISSUERS = /let's encrypt|zerossl|google trust services|buypass/i;

export function isAcmeIssuer(issuer: string): boolean {
  return ACME_ISSUERS.test(issuer);
}

// Checks the certificate a host actually serves, which is what matters
// (CT logs show what was issued, not what is deployed).
export function checkTls(host: string, port = 443, timeoutMs = 10_000): Promise<TlsInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return reject(new Error('No certificate presented'));
      const issuer = cert.issuer?.O ?? cert.issuer?.CN ?? 'unknown';
      resolve({
        validTo: new Date(cert.valid_to).toISOString(),
        issuer: Array.isArray(issuer) ? issuer.join(', ') : issuer,
        trusted: socket.authorized,
        error: socket.authorizationError ? String(socket.authorizationError) : null,
      });
    });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Timed out')));
    socket.on('error', reject);
  });
}
