import Anthropic from '@anthropic-ai/sdk';
import { ZodError } from 'zod';
import { config } from '../config.ts';
import { addMonths, DAY, daysBetween, ymd, type NoticeUnit } from '../actby.ts';
import type { ItemType } from '../templates.ts';
import { extractWithClaude } from './anthropic.ts';
import { extractWithOllama } from './ollama.ts';
import { pdfText } from './pdf.ts';
import { extractWithRules } from './rules.ts';
import { EVIDENCE_FIELDS, type ContractTerms, type EvidenceField } from './schema.ts';

export type ExtractionMethod = 'claude' | 'ollama' | 'rules';

export interface EvidenceCheck {
  field: EvidenceField;
  quote: string;
  // null when the PDF has no text layer to check against.
  verified: boolean | null;
}

export interface Suggestion {
  name: string;
  type: ItemType;
  expiresAt: string | null;
  noticeValue: number;
  noticeUnit: NoticeUnit;
  autoRenews: boolean;
  renewalTermMonths: number | null;
  notes: string | null;
  // How dates were derived, shown to the user so nothing is a black box.
  derivation: string[];
}

export interface ExtractionResult {
  method: ExtractionMethod;
  pages: number;
  hasText: boolean;
  terms: ContractTerms;
  evidence: EvidenceCheck[];
  suggestion: Suggestion;
  warnings: string[];
}

export function configuredMethod(): ExtractionMethod {
  switch (config.aiProvider) {
    case 'anthropic': return 'claude';
    case 'ollama': return 'ollama';
    case 'none': return 'rules';
  }
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (config.ollamaUrl) return 'ollama';
  return 'rules';
}

export const METHOD_LABEL: Record<ExtractionMethod, string> = {
  claude: `Claude (${config.anthropicModel}). The PDF is sent to Anthropic's API.`,
  ollama: `local LLM via Ollama (${config.ollamaModel}). The contract stays on your server.`,
  rules: 'built-in rules for German and English contracts. The contract stays on your server. Set ANTHROPIC_API_KEY or OLLAMA_URL for AI extraction.',
};

// PDF text extraction mangles whitespace, hyphenation and quote styles; compare loosely.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/­/g, '')
    .replace(/[„“”«»"]/g, '"')
    .replace(/[‘’‚']/g, "'")
    .replace(/[‐‑–—]/g, '-')
    .replace(/\s+/g, '');
}

export function verifyEvidence(terms: ContractTerms, text: string): EvidenceCheck[] {
  const haystack = normalize(text);
  const checks: EvidenceCheck[] = [];
  for (const field of EVIDENCE_FIELDS) {
    const quote = terms.evidence[field];
    if (!quote) continue;
    checks.push({ field, quote, verified: text ? haystack.includes(normalize(quote.replace(/^…|…$|^\.\.\.|\.\.\.$/g, ''))) : null });
  }
  return checks;
}

export function suggestItem(terms: ContractTerms, filename: string, now = Date.now()): Suggestion {
  const derivation: string[] = [];
  let expiresAt = terms.end_date;

  if (!expiresAt && terms.start_date && terms.initial_term_months) {
    const end = addMonths(Date.parse(terms.start_date), terms.initial_term_months) - DAY;
    expiresAt = ymd(end);
    derivation.push(`End of the initial term calculated from the start date ${terms.start_date} plus ${terms.initial_term_months} months.`);
  }

  // A renewing contract whose first term is over is now in a later term.
  if (expiresAt && terms.auto_renews && terms.renewal_term_months && daysBetween(now, Date.parse(expiresAt)) < 0) {
    let ts = Date.parse(expiresAt);
    while (daysBetween(now, ts) < 0) ts = addMonths(ts, terms.renewal_term_months);
    derivation.push(`The initial term ended ${expiresAt} and the contract renewed automatically. The current term ends ${ymd(ts)}.`);
    expiresAt = ymd(ts);
  }

  const notes = [terms.counterparty && `Counterparty: ${terms.counterparty}.`, terms.notes].filter(Boolean).join(' ');
  return {
    name: terms.title ?? filename.replace(/\.pdf$/i, ''),
    type: terms.kind,
    expiresAt,
    noticeValue: terms.notice_period?.value ?? 0,
    noticeUnit: terms.notice_period?.unit ?? 'months',
    autoRenews: terms.auto_renews ?? false,
    renewalTermMonths: terms.renewal_term_months,
    notes: notes || null,
    derivation,
  };
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude: the API key is invalid.';
  if (err instanceof Anthropic.RateLimitError) return 'Claude: rate limited. Try again in a moment.';
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Claude API error${err.status ? ` ${err.status}` : ''}: ${err.message}`;
  if (err instanceof ZodError || err instanceof SyntaxError) return 'The AI returned output in an unexpected format.';
  return (err as Error).message;
}

export async function extractContract(pdf: Uint8Array, filename: string, now = Date.now()): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const today = ymd(now);

  let text = '';
  let pages = 0;
  try {
    ({ text, pages } = await pdfText(pdf));
  } catch (err) {
    warnings.push(`Could not read the PDF's text: ${(err as Error).message}`);
  }
  if (!text) warnings.push('This PDF has no text layer (probably a scan), so quotes cannot be checked against it.');

  let method = configuredMethod();
  let terms: ContractTerms | null = null;

  if (method === 'claude') {
    try {
      terms = await extractWithClaude(pdf, today);
    } catch (err) {
      warnings.push(`${describeError(err)} Fell back to the built-in rules.`);
    }
  } else if (method === 'ollama') {
    if (!text) {
      warnings.push('Ollama needs a text layer. Fell back to the built-in rules.');
    } else {
      try {
        terms = await extractWithOllama(text, today);
      } catch (err) {
        warnings.push(`${describeError(err)} Fell back to the built-in rules.`);
      }
    }
  }

  if (!terms) {
    method = 'rules';
    terms = extractWithRules(text);
  }

  const evidence = verifyEvidence(terms, text);
  const unverified = evidence.filter((e) => e.verified === false);
  if (unverified.length) {
    warnings.push(`${unverified.length} quote(s) could not be found in the document. Check those values against the original.`);
  }

  const suggestion = suggestItem(terms, filename, now);
  if (!suggestion.expiresAt) warnings.push('No end date found. Enter it manually.');
  if (!terms.notice_period) warnings.push('No notice period found. Check the termination clause and enter it manually.');

  return { method, pages, hasText: !!text, terms, evidence, suggestion, warnings };
}
