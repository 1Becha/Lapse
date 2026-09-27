// Minimal single-page PDF writer (Helvetica, WinAnsi) used for sample contracts and tests.

export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = ['BT', '/F1 11 Tf', '15 TL', '56 800 Td', ...lines.map((l) => `(${esc(l)}) '`), 'ET'].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

export const GERMAN_LEASE = [
  'Mietvertrag über Gewerberäume',
  '',
  'zwischen der Muster Immobilien GmbH, Hauptstraße 1, 10115 Berlin (Vermieterin)',
  'und der Beispiel AG, Lindenweg 7, 10117 Berlin (Mieterin).',
  '',
  '§ 3 Mietdauer und Kündigung',
  '(1) Das Mietverhältnis beginnt am 01.01.2024 und endet am 31.12.2026.',
  '(2) Es verlängert sich jeweils um 12 Monate, wenn es nicht von einer Partei',
  'mit einer Frist von 6 Monaten zum Vertragsende gekündigt wird.',
  '(3) Die Kündigung bedarf der Schriftform.',
];

export const ENGLISH_SUBSCRIPTION = [
  'MASTER SUBSCRIPTION AGREEMENT',
  '',
  'This Agreement is entered into by Acme Analytics Inc. and Beispiel AG.',
  'The Effective Date is March 1, 2025.',
  '',
  '8. Term and Termination',
  '8.1 The Subscription Term commences on the Effective Date and continues for an',
  'initial term of twelve (12) months.',
  '8.2 Thereafter, this Agreement shall automatically renew for successive periods of',
  'twelve (12) months, unless either party gives the other written notice of non-renewal',
  'at least sixty (60) days prior to the end of the then-current term.',
];
