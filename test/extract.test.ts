import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActBy, ymd } from '../src/actby.ts';
import { pdfText, isPdf } from '../src/extract/pdf.ts';
import { extractWithRules, findDate } from '../src/extract/rules.ts';
import { suggestItem, verifyEvidence } from '../src/extract/index.ts';
import { ENGLISH_SUBSCRIPTION, GERMAN_LEASE, makePdf } from '../examples/make-pdf.ts';

const NOW = Date.UTC(2026, 8, 26);

test('dates in German and English formats', () => {
  assert.equal(findDate('endet am 31.12.2026'), '2026-12-31');
  assert.equal(findDate('bis zum 31. Dezember 2026'), '2026-12-31');
  assert.equal(findDate('ends on December 31, 2026'), '2026-12-31');
  assert.equal(findDate('expires 31 March 2027'), '2027-03-31');
  assert.equal(findDate('no date here'), null);
});

test('German lease: end date, 6 months notice, 12 month renewal (from a real PDF)', async () => {
  const pdf = makePdf(GERMAN_LEASE);
  assert.ok(isPdf(pdf));
  const { text } = await pdfText(pdf);
  const terms = extractWithRules(text);

  assert.equal(terms.title, 'Mietvertrag über Gewerberäume');
  assert.equal(terms.start_date, '2024-01-01');
  assert.equal(terms.end_date, '2026-12-31');
  assert.deepEqual(terms.notice_period, { value: 6, unit: 'months' });
  assert.equal(terms.auto_renews, true);
  assert.equal(terms.renewal_term_months, 12);
  assert.equal(terms.notes, 'Cancellation must be in writing.');

  const evidence = verifyEvidence(terms, text);
  assert.ok(evidence.length >= 3);
  assert.ok(evidence.every((e) => e.verified), 'every quote is found in the document');

  // 31 Dec 2026 minus 6 months: cancellation must arrive by 30 Jun 2026.
  const s = suggestItem(terms, 'lease.pdf', NOW);
  assert.equal(s.expiresAt, '2026-12-31');
  assert.equal(ymd(computeActBy({ expiresAt: s.expiresAt!, noticeValue: 6, noticeUnit: 'months', leadDays: 0, bufferDays: 0 })), '2026-06-30');
});

test('English subscription: derives the end date and rolls into the current term', async () => {
  const { text } = await pdfText(makePdf(ENGLISH_SUBSCRIPTION));
  const terms = extractWithRules(text);

  assert.equal(terms.title, 'Master Subscription Agreement');
  assert.equal(terms.kind, 'subscription');
  assert.equal(terms.start_date, '2025-03-01');
  assert.equal(terms.end_date, null);
  assert.equal(terms.initial_term_months, 12);
  assert.deepEqual(terms.notice_period, { value: 60, unit: 'days' });
  assert.equal(terms.auto_renews, true);
  assert.equal(terms.renewal_term_months, 12);
  assert.ok(verifyEvidence(terms, text).every((e) => e.verified));

  const s = suggestItem(terms, 'msa.pdf', NOW);
  // Initial term 2025-03-01 + 12 months ends 2026-02-28; it renewed until 2027-02-28.
  assert.equal(s.expiresAt, '2027-02-28');
  assert.equal(s.derivation.length, 2);
});

test('quotes that are not in the document are flagged', () => {
  const terms = extractWithRules('Die Kündigungsfrist beträgt 3 Monate.');
  terms.evidence.end_date = 'Der Vertrag endet am 31.12.2030.';
  const checks = verifyEvidence(terms, 'Die Kündigungsfrist beträgt 3 Monate.');
  assert.equal(checks.find((c) => c.field === 'notice_period')?.verified, true);
  assert.equal(checks.find((c) => c.field === 'end_date')?.verified, false);
  assert.ok(verifyEvidence(terms, '').every((c) => c.verified === null), 'scans cannot be verified');
});
