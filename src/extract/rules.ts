import type { NoticeUnit } from '../actby.ts';
import type { ContractTerms } from './schema.ts';

// A dependency-free extractor for common German and English contract wording.
// It is deliberately conservative: it only fills a field when a clear pattern matches.

const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einem: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6,
  neun: 9, zwölf: 12, achtzehn: 18, vierundzwanzig: 24, dreißig: 30, sechzig: 60, neunzig: 90,
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, twelve: 12,
  eighteen: 18, 'twenty-four': 24, thirty: 30, sixty: 60, ninety: 90,
};
const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})`;
// "three (3) months" is common in English contracts.
const PAREN = `(?:\\s*\\(\\d{1,3}\\))?`;

const MONTHS: Record<string, number> = {
  januar: 1, january: 1, jan: 1, februar: 2, february: 2, feb: 2, märz: 3, maerz: 3, march: 3, mar: 3,
  april: 4, apr: 4, mai: 5, may: 5, juni: 6, june: 6, jun: 6, juli: 7, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, oktober: 10, october: 10, okt: 10, oct: 10, november: 11, nov: 11,
  dezember: 12, december: 12, dez: 12, dec: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const DATE_PATTERNS: [RegExp, (m: RegExpExecArray) => [number, number, number]][] = [
  [/(\d{4})-(\d{2})-(\d{2})/, (m) => [+m[1], +m[2], +m[3]]],
  [/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/, (m) => [+m[3], +m[2], +m[1]]],
  [new RegExp(`(\\d{1,2})\\.?\\s+(${MONTH_NAMES})\\.?\\s+(\\d{4})`, 'i'), (m) => [+m[3], MONTHS[m[2].toLowerCase()], +m[1]]],
  [new RegExp(`(${MONTH_NAMES})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'), (m) => [+m[3], MONTHS[m[1].toLowerCase()], +m[2]]],
];

function toNumber(word: string): number | null {
  const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()];
  return n && n > 0 ? n : null;
}

function toUnit(word: string): { unit: NoticeUnit; factor: number } {
  const w = word.toLowerCase();
  if (w.startsWith('jahr') || w.startsWith('year')) return { unit: 'months', factor: 12 };
  if (w.startsWith('monat') || w.startsWith('month')) return { unit: 'months', factor: 1 };
  if (w.startsWith('woche') || w.startsWith('week')) return { unit: 'weeks', factor: 1 };
  return { unit: 'days', factor: 1 };
}

// The earliest date written anywhere in `s`, as YYYY-MM-DD.
export function findDate(s: string): string | null {
  let best: { index: number; value: string } | null = null;
  for (const [re, parts] of DATE_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const [y, mo, d] = parts(m);
    if (!mo || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) continue;
    const value = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!best || m.index < best.index) best = { index: m.index, value };
  }
  return best?.value ?? null;
}

// Sentence ends: punctuation followed by a capital letter, § or a clause number, but not
// the dots inside "01.01.2024" or "31. Dezember" (a year may end a sentence, though).
// A line starting with a clause number ("(2)", "8.1", "§ 4") also starts a new sentence;
// other PDF line breaks do not, and "twelve (12) months" mid-line is not a clause.
const SENTENCE_END =
  /(?:(?<!\d)|(?<=\d{4}))[.;!?](?=\s+(?:[A-ZÄÖÜ§(]|\d+(?:\.\d*)+\s)|\s*$)|\n(?=\s*(?:\(\d{1,2}\)|\d+(?:\.\d+)+|§)\s)/g;

// The sentence around a match, used as evidence.
function sentenceAt(text: string, index: number): string {
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(SENTENCE_END)) {
    if (m.index < index) start = m.index + 1;
    else {
      end = m.index + 1;
      break;
    }
  }
  return text.slice(Math.max(start, index - 200), Math.min(end, index + 250)).replace(/\s+/g, ' ').trim();
}

const NOTICE_PATTERNS = [
  new RegExp(`kündigungsfrist\\s+(?:von|beträgt)?\\s*(?:jeweils\\s+)?${NUM}\\s+(tage?n?|wochen?|monate?n?|jahre?n?)`, 'i'),
  new RegExp(`(?:mit\\s+einer\\s+frist\\s+von|unter\\s+einhaltung\\s+einer\\s+(?:kündigungs)?frist\\s+von)\\s+${NUM}\\s+(tage?n?|wochen?|monate?n?|jahre?n?)`, 'i'),
  new RegExp(`${NUM}\\s+(tage?n?|wochen?|monate?n?)\\s+(?:vor|zum)\\s+(?:ablauf|ende|vertragsende|laufzeitende)`, 'i'),
  new RegExp(`notice\\s+period\\s+(?:of|is)\\s+${NUM}${PAREN}\\s+(days?|weeks?|months?|years?)`, 'i'),
  new RegExp(`(?:at\\s+least\\s+|no\\s+less\\s+than\\s+)?${NUM}${PAREN}\\s+(days?|weeks?|months?)['’]?\\s+(?:prior\\s+|advance\\s+)?(?:written\\s+)?notice`, 'i'),
  new RegExp(`(?:written\\s+)?notice\\s+(?:of\\s+)?(?:at\\s+least\\s+)?${NUM}${PAREN}\\s+(days?|weeks?|months?)\\s+(?:prior|before|in\\s+advance)`, 'i'),
  // "written notice of non-renewal at least sixty (60) days prior to ..."
  new RegExp(`notice[^.;]{0,60}?(?:at\\s+least|no\\s+less\\s+than|not\\s+less\\s+than)\\s+${NUM}${PAREN}\\s+(days?|weeks?|months?)\\s+(?:prior|before|in\\s+advance)`, 'i'),
];

const RENEWAL_PATTERNS = [
  new RegExp(`verlängert\\s+sich\\s+(?:der\\s+vertrag\\s+)?(?:jeweils\\s+)?(?:automatisch\\s+|stillschweigend\\s+)?(?:jeweils\\s+)?um\\s+(?:jeweils\\s+)?(?:weitere\\s+)?${NUM}\\s+(monate?n?|jahre?n?)`, 'i'),
  new RegExp(`(?:automatically|auto-?)\\s*renew\\w*[^.;]{0,80}?(?:for\\s+)?(?:successive|additional|further|subsequent)?\\s*(?:periods?|terms?)?\\s*(?:of\\s+)?${NUM}${PAREN}\\s*[- ]?(months?|years?)`, 'i'),
  new RegExp(`renew\\w*\\s+(?:automatically\\s+)?for\\s+(?:successive|additional|further)\\s+${NUM}${PAREN}\\s*[- ]?(months?|years?)`, 'i'),
];
const RENEWAL_FLAG = /verlängert\s+sich[^.;]{0,60}(automatisch|stillschweigend|jeweils)|automatically\s+renew|auto-?renew|shall\s+renew|will\s+renew/i;

const TERM_PATTERNS = [
  new RegExp(`(?:mindest|vertrags)?laufzeit\\s+(?:von|beträgt)\\s+${NUM}\\s+(monate?n?|jahre?n?)`, 'i'),
  new RegExp(`(?:initial|minimum)\\s+term\\s+(?:of|is)\\s+${NUM}${PAREN}\\s*[- ]?(months?|years?)`, 'i'),
  new RegExp(`for\\s+(?:a|an)\\s+(?:initial\\s+)?(?:term|period)\\s+of\\s+${NUM}${PAREN}\\s*[- ]?(months?|years?)`, 'i'),
];

const END_KEYWORDS = /endet\s+(?:am|mit\s+ablauf\s+des)|läuft\s+bis|laufzeit\s+bis|befristet\s+bis|vertragsende|bis\s+einschließlich|ends\s+on|expires\s+on|expir(?:y|ation)\s+date|end\s+date|terminates\s+on|remain\s+in\s+(?:full\s+)?(?:force|effect)\s+until|valid\s+until/i;
const START_KEYWORDS = /beginnt\s+am|vertragsbeginn|mit\s+wirkung\s+(?:ab|zum)|gültig\s+ab|commences\s+on|commencement\s+date|effective\s+date|start\s+date|begins\s+on|effective\s+as\s+of/i;

function dateAfterKeyword(text: string, keywords: RegExp): { date: string; evidence: string } | null {
  const re = new RegExp(keywords.source, 'gi');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const date = findDate(text.slice(m.index, m.index + 120));
    if (date) return { date, evidence: sentenceAt(text, m.index) };
  }
  return null;
}

function firstMatch(text: string, patterns: RegExp[]): RegExpExecArray | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}

// "MASTER SUBSCRIPTION AGREEMENT" -> "Master Subscription Agreement"
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function extractWithRules(rawText: string): ContractTerms {
  const text = rawText.replace(/­/g, '').replace(/[ \t]+/g, ' ');
  const terms: ContractTerms = {
    title: null, counterparty: null, kind: 'contract',
    start_date: null, end_date: null, initial_term_months: null,
    notice_period: null, auto_renews: null, renewal_term_months: null,
    evidence: { end_date: null, notice_period: null, auto_renews: null, renewal_term: null, initial_term: null },
    notes: null,
  };

  const notice = firstMatch(text, NOTICE_PATTERNS);
  const noticeValue = notice && toNumber(notice[1]);
  if (notice && noticeValue) {
    const { unit, factor } = toUnit(notice[2]);
    terms.notice_period = { value: noticeValue * factor, unit };
    terms.evidence.notice_period = sentenceAt(text, notice.index);
  }

  const renewal = firstMatch(text, RENEWAL_PATTERNS);
  const renewalValue = renewal && toNumber(renewal[1]);
  if (renewal && renewalValue) {
    terms.auto_renews = true;
    terms.renewal_term_months = renewalValue * toUnit(renewal[2]).factor;
    terms.evidence.renewal_term = sentenceAt(text, renewal.index);
    terms.evidence.auto_renews = terms.evidence.renewal_term;
  } else {
    const flag = RENEWAL_FLAG.exec(text);
    if (flag) {
      terms.auto_renews = true;
      terms.evidence.auto_renews = sentenceAt(text, flag.index);
    }
  }

  const term = firstMatch(text, TERM_PATTERNS);
  const termValue = term && toNumber(term[1]);
  if (term && termValue) {
    terms.initial_term_months = termValue * toUnit(term[2]).factor;
    terms.evidence.initial_term = sentenceAt(text, term.index);
  }

  const end = dateAfterKeyword(text, END_KEYWORDS);
  if (end) {
    terms.end_date = end.date;
    terms.evidence.end_date = end.evidence;
  }
  terms.start_date = dateAfterKeyword(text, START_KEYWORDS)?.date ?? null;

  if (/schriftform|schriftlich|written\s+notice|in\s+writing/i.test(text)) {
    terms.notes = 'Cancellation must be in writing.';
  }

  if (/subscription|abonnement|\babo\b/i.test(text)) terms.kind = 'subscription';
  else if (/licen[cs]e\s+agreement|lizenzvertrag/i.test(text)) terms.kind = 'license';

  // Contracts usually open with their title.
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length >= 5);
  if (firstLine && firstLine.length <= 80) terms.title = firstLine === firstLine.toUpperCase() ? titleCase(firstLine) : firstLine;
  return terms;
}
