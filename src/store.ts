import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AUTO_RENEW_CERT_LEAD_DAYS, TEMPLATES, type ItemType } from './templates.ts';
import type { NoticeUnit } from './actby.ts';

export type ItemStatus = 'open' | 'acknowledged' | 'done';
export type ChannelKind = 'slack' | 'discord' | 'ntfy' | 'webhook' | 'email';
export const CHANNEL_KINDS: readonly ChannelKind[] = ['slack', 'discord', 'ntfy', 'webhook', 'email'];

export interface ItemRow {
  id: number;
  name: string;
  type: ItemType;
  expires_at: string;
  notice_value: number;
  notice_unit: NoticeUnit;
  lead_days: number;
  buffer_days: number;
  auto_renews: number;
  renewal_term_months: number | null;
  owner: string | null;
  notes: string | null;
  status: ItemStatus;
  source: string;
  source_ref: string | null;
  meta: string | null;
  attachment: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemInput {
  name: string;
  type: ItemType;
  expiresAt: string;
  noticeValue: number;
  noticeUnit: NoticeUnit;
  leadDays: number;
  bufferDays: number;
  autoRenews: boolean;
  renewalTermMonths: number | null;
  owner: string | null;
  notes: string | null;
  // Only set on create (a contract PDF imported for this item).
  attachment?: string | null;
}

export interface DiscoveredItem {
  source: 'tls' | 'rdap';
  sourceRef: string;
  name: string;
  type: ItemType;
  expiresAt: string;
  autoRenews: boolean;
  meta: Record<string, unknown>;
}

export interface DomainRow {
  id: number;
  name: string;
  last_scan_at: string | null;
  last_result: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ChannelRow {
  id: number;
  name: string;
  kind: ChannelKind;
  target: string;
  escalation_only: number;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  notice_value INTEGER NOT NULL DEFAULT 0,
  notice_unit TEXT NOT NULL DEFAULT 'days',
  lead_days INTEGER NOT NULL DEFAULT 0,
  buffer_days INTEGER NOT NULL DEFAULT 0,
  auto_renews INTEGER NOT NULL DEFAULT 0,
  renewal_term_months INTEGER,
  owner TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT UNIQUE,
  meta TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  last_scan_at TEXT,
  last_result TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  escalation_only INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS alerts_sent (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  act_by TEXT NOT NULL,
  key TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, act_by, key)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class Store {
  db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    const columns = (this.db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map((c) => c.name);
    if (!columns.includes('attachment')) this.db.exec('ALTER TABLE items ADD COLUMN attachment TEXT');
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  // Items

  listItems(): ItemRow[] {
    return this.all<ItemRow>('SELECT * FROM items');
  }

  getItem(id: number): ItemRow | undefined {
    return this.get<ItemRow>('SELECT * FROM items WHERE id = ?', id);
  }

  createItem(i: ItemInput): number {
    const res = this.run(
      `INSERT INTO items (name, type, expires_at, notice_value, notice_unit, lead_days, buffer_days,
         auto_renews, renewal_term_months, owner, notes, attachment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.name, i.type, i.expiresAt, i.noticeValue, i.noticeUnit, i.leadDays, i.bufferDays,
      i.autoRenews ? 1 : 0, i.renewalTermMonths, i.owner, i.notes, i.attachment ?? null,
    );
    return Number(res.lastInsertRowid);
  }

  updateItem(id: number, i: ItemInput): void {
    const before = this.getItem(id);
    // A new expiry date means a new cycle: reopen the item.
    const reopen = before && before.expires_at !== i.expiresAt;
    this.run(
      `UPDATE items SET name = ?, type = ?, expires_at = ?, notice_value = ?, notice_unit = ?,
         lead_days = ?, buffer_days = ?, auto_renews = ?, renewal_term_months = ?, owner = ?, notes = ?,
         status = CASE WHEN ? THEN 'open' ELSE status END, updated_at = datetime('now')
       WHERE id = ?`,
      i.name, i.type, i.expiresAt, i.noticeValue, i.noticeUnit, i.leadDays, i.bufferDays,
      i.autoRenews ? 1 : 0, i.renewalTermMonths, i.owner, i.notes, reopen ? 1 : 0, id,
    );
  }

  setExpiry(id: number, expiresAt: string): void {
    this.run(
      `UPDATE items SET expires_at = ?, status = 'open', updated_at = datetime('now') WHERE id = ?`,
      expiresAt, id,
    );
  }

  setStatus(id: number, status: ItemStatus): void {
    this.run(`UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, id);
  }

  deleteItem(id: number): void {
    this.run('DELETE FROM items WHERE id = ?', id);
  }

  attachmentIds(): Set<string> {
    const rows = this.all<{ attachment: string }>('SELECT attachment FROM items WHERE attachment IS NOT NULL');
    return new Set(rows.map((r) => r.attachment));
  }

  // Discovered items keep the user's edits (owner, lead times, status) and only
  // refresh what the source knows. A changed expiry reopens the item.
  upsertDiscovered(d: DiscoveredItem): 'created' | 'renewed' | 'unchanged' {
    const existing = this.get<ItemRow>('SELECT * FROM items WHERE source_ref = ?', d.sourceRef);
    const meta = JSON.stringify(d.meta);
    if (!existing) {
      const t = TEMPLATES[d.type];
      const autoCert = d.type === 'certificate' && d.autoRenews;
      this.run(
        `INSERT INTO items (name, type, expires_at, notice_value, notice_unit, lead_days, buffer_days,
           auto_renews, source, source_ref, meta, last_checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        d.name, d.type, d.expiresAt, t.noticeValue, t.noticeUnit,
        autoCert ? AUTO_RENEW_CERT_LEAD_DAYS : t.leadDays, autoCert ? 0 : t.bufferDays,
        d.autoRenews ? 1 : 0, d.source, d.sourceRef, meta,
      );
      return 'created';
    }
    const renewed = existing.expires_at !== d.expiresAt;
    this.run(
      `UPDATE items SET expires_at = ?, meta = ?, last_checked_at = datetime('now'),
         status = CASE WHEN ? THEN 'open' ELSE status END
       WHERE id = ?`,
      d.expiresAt, meta, renewed ? 1 : 0, existing.id,
    );
    return renewed ? 'renewed' : 'unchanged';
  }

  // Domains

  listDomains(): DomainRow[] {
    return this.all<DomainRow>('SELECT * FROM domains ORDER BY name');
  }

  getDomain(id: number): DomainRow | undefined {
    return this.get<DomainRow>('SELECT * FROM domains WHERE id = ?', id);
  }

  addDomain(name: string): void {
    this.run('INSERT OR IGNORE INTO domains (name) VALUES (?)', name);
  }

  deleteDomain(id: number): void {
    this.run('DELETE FROM domains WHERE id = ?', id);
  }

  recordScan(id: number, result: Record<string, unknown> | null, error: string | null): void {
    this.run(
      `UPDATE domains SET last_scan_at = datetime('now'), last_result = ?, last_error = ? WHERE id = ?`,
      result ? JSON.stringify(result) : null, error, id,
    );
  }

  // Channels

  listChannels(): ChannelRow[] {
    return this.all<ChannelRow>('SELECT * FROM channels ORDER BY name');
  }

  getChannel(id: number): ChannelRow | undefined {
    return this.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', id);
  }

  addChannel(name: string, kind: ChannelKind, target: string, escalationOnly: boolean): void {
    this.run(
      'INSERT INTO channels (name, kind, target, escalation_only) VALUES (?, ?, ?, ?)',
      name, kind, target, escalationOnly ? 1 : 0,
    );
  }

  deleteChannel(id: number): void {
    this.run('DELETE FROM channels WHERE id = ?', id);
  }

  // Alert de-duplication

  wasAlertSent(itemId: number, actBy: string, key: string): boolean {
    return !!this.get('SELECT 1 FROM alerts_sent WHERE item_id = ? AND act_by = ? AND key = ?', itemId, actBy, key);
  }

  markAlertSent(itemId: number, actBy: string, key: string): void {
    this.run('INSERT OR IGNORE INTO alerts_sent (item_id, act_by, key) VALUES (?, ?, ?)', itemId, actBy, key);
  }

  // Settings

  icsToken(): string {
    const row = this.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'ics_token'`);
    if (row) return row.value;
    const token = randomBytes(24).toString('base64url');
    this.run(`INSERT INTO settings (key, value) VALUES ('ics_token', ?)`, token);
    return token;
  }
}
