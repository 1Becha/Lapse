// Regenerates the sample contracts: node examples/generate.ts
import { writeFileSync } from 'node:fs';
import { ENGLISH_SUBSCRIPTION, GERMAN_LEASE, makePdf } from './make-pdf.ts';

writeFileSync(new URL('./sample-lease-de.pdf', import.meta.url), makePdf(GERMAN_LEASE));
writeFileSync(new URL('./sample-subscription-en.pdf', import.meta.url), makePdf(ENGLISH_SUBSCRIPTION));
console.log('Wrote examples/sample-lease-de.pdf and examples/sample-subscription-en.pdf');
