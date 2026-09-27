import type { NoticeUnit } from './actby.ts';

export const ITEM_TYPES = [
  'certificate',
  'domain',
  'token',
  'contract',
  'subscription',
  'license',
  'document',
  'other',
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

export interface Template {
  label: string;
  noticeValue: number;
  noticeUnit: NoticeUnit;
  leadDays: number;
  bufferDays: number;
  autoRenews: boolean;
  hint: string;
}

// Sensible defaults so users get a meaningful act-by date without thinking.
// Every value can be overridden per item.
export const TEMPLATES: Record<ItemType, Template> = {
  certificate: {
    label: 'TLS certificate',
    noticeValue: 0, noticeUnit: 'days', leadDays: 5, bufferDays: 2, autoRenews: false,
    hint: 'Manual certificates need time for CSR, validation and deployment.',
  },
  domain: {
    label: 'Domain name',
    noticeValue: 0, noticeUnit: 'days', leadDays: 7, bufferDays: 7, autoRenews: false,
    hint: 'Registrars can take days to process; expired domains get snapped up.',
  },
  token: {
    label: 'API key / token',
    noticeValue: 0, noticeUnit: 'days', leadDays: 3, bufferDays: 4, autoRenews: false,
    hint: 'Rotation means updating every system that uses the token.',
  },
  contract: {
    label: 'Contract',
    noticeValue: 3, noticeUnit: 'months', leadDays: 5, bufferDays: 7, autoRenews: true,
    hint: 'The deadline is the notice period, not the end date. Leave time for a registered letter.',
  },
  subscription: {
    label: 'Subscription',
    noticeValue: 0, noticeUnit: 'days', leadDays: 2, bufferDays: 3, autoRenews: true,
    hint: 'Cancel before the renewal charge, not after.',
  },
  license: {
    label: 'Software license',
    noticeValue: 0, noticeUnit: 'days', leadDays: 30, bufferDays: 7, autoRenews: false,
    hint: 'Procurement and approvals usually take weeks.',
  },
  document: {
    label: 'Document (passport, ID, permit)',
    noticeValue: 0, noticeUnit: 'days', leadDays: 42, bufferDays: 14, autoRenews: false,
    hint: 'Government offices are slow; appointments are booked out.',
  },
  other: {
    label: 'Other',
    noticeValue: 0, noticeUnit: 'days', leadDays: 7, bufferDays: 3, autoRenews: false,
    hint: '',
  },
};

// For certificates that renew themselves (ACME), the act-by date is the point
// where auto-renewal should already have happened. Let's Encrypt renews ~30 days out.
export const AUTO_RENEW_CERT_LEAD_DAYS = 20;

export function isItemType(v: string): v is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(v);
}
