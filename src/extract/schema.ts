import { z } from 'zod';

// What we want out of a contract: enough to compute the last day to cancel.

export const EVIDENCE_FIELDS = ['end_date', 'notice_period', 'auto_renews', 'renewal_term', 'initial_term'] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ContractTermsSchema = z.object({
  title: z.string().nullable(),
  counterparty: z.string().nullable(),
  kind: z.enum(['contract', 'subscription', 'license', 'other']),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  initial_term_months: z.number().int().positive().nullable(),
  notice_period: z
    .object({ value: z.number().int().nonnegative(), unit: z.enum(['days', 'weeks', 'months']) })
    .nullable(),
  auto_renews: z.boolean().nullable(),
  renewal_term_months: z.number().int().positive().nullable(),
  evidence: z.object({
    end_date: z.string().nullable(),
    notice_period: z.string().nullable(),
    auto_renews: z.string().nullable(),
    renewal_term: z.string().nullable(),
    initial_term: z.string().nullable(),
  }),
  notes: z.string().nullable(),
});

export type ContractTerms = z.infer<typeof ContractTermsSchema>;

// Hand-written JSON Schema for structured outputs (Claude) and Ollama's `format`.
// Kept in sync with the zod schema above, which validates whatever comes back.
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const nullableString = nullable({ type: 'string' });
const nullableDate = nullable({ type: 'string', description: 'YYYY-MM-DD' });
const nullableInt = nullable({ type: 'integer' });

export const CONTRACT_TERMS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title', 'counterparty', 'kind', 'start_date', 'end_date', 'initial_term_months',
    'notice_period', 'auto_renews', 'renewal_term_months', 'evidence', 'notes',
  ],
  properties: {
    title: { ...nullableString, description: 'Short name, e.g. "Office lease, Musterstraße 5" or "Salesforce subscription"' },
    counterparty: nullableString,
    kind: { type: 'string', enum: ['contract', 'subscription', 'license', 'other'] },
    start_date: nullableDate,
    end_date: { ...nullableDate, description: 'End of the current (initial) term, not the notice deadline' },
    initial_term_months: nullableInt,
    notice_period: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['value', 'unit'],
      properties: {
        value: { type: 'integer' },
        unit: { type: 'string', enum: ['days', 'weeks', 'months'] },
      },
    }),
    auto_renews: nullable({ type: 'boolean' }),
    renewal_term_months: nullableInt,
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: [...EVIDENCE_FIELDS],
      properties: Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, nullableString])),
    },
    notes: nullableString,
  },
};

export const SYSTEM_PROMPT = `You extract renewal and cancellation terms from contracts so that a deadline tracker can compute the last day the customer can cancel.

Contracts may be in German, English or another language. Rules:
- Return null for anything the document does not state. Do not guess, and do not invent dates that are not written in the document.
- Dates are YYYY-MM-DD.
- end_date is the end of the current or initial term, not the notice deadline. If the contract only states a start date and a minimum term, give start_date and initial_term_months and leave end_date null.
- notice_period is how long before the end of a term the cancellation must be received. Convert years to months.
- auto_renews is true if the contract extends itself unless cancelled; renewal_term_months is the length of each extension.
- Each evidence field is the exact sentence from the document that supports the value, copied verbatim in the original language (at most about 300 characters), or null.
- notes: other conditions that matter for cancelling on time, such as written form, registered letter, special termination rights or price-increase clauses. Keep it short.`;
