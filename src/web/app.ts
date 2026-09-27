import { Hono, type Context } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { bodyLimit } from 'hono/body-limit';
import { deleteAttachment, isAttachmentId, readAttachment, saveAttachment } from '../attachments.ts';
import { configuredMethod, extractContract } from '../extract/index.ts';
import { isPdf } from '../extract/pdf.ts';
import { config } from '../config.ts';
import { ymd } from '../actby.ts';
import { buildCalendar } from '../ics.ts';
import { listViews, toView } from '../items.ts';
import { emailEnabled, sendToChannel } from '../notify.ts';
import { scanDomainSafe } from '../discovery/scan.ts';
import { isItemType } from '../templates.ts';
import { CHANNEL_KINDS, type ChannelKind, type ItemInput, type ItemStatus, type Store } from '../store.ts';
import {
  channelsPage, dashboardPage, defaultValues, domainsPage, itemPage, layout, newItemPage, reviewPage,
  type FormValues,
} from './views.ts';
import type { SafeHtml } from './html.ts';

type Body = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown, fallback = 0): number => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function parseItemInput(b: Body): ItemInput | string {
  const name = str(b.name);
  if (!name) return 'Name is required.';
  const type = str(b.type);
  if (!isItemType(type)) return `Unknown type "${type}".`;
  const expires = str(b.expires_at);
  if (Number.isNaN(Date.parse(expires))) return 'Expiry date is missing or invalid.';
  const unit = str(b.notice_unit) || 'days';
  if (unit !== 'days' && unit !== 'weeks' && unit !== 'months') return 'Notice unit must be days, weeks or months.';
  const term = int(b.renewal_term_months);
  return {
    name,
    type,
    expiresAt: ymd(Date.parse(expires)),
    noticeValue: int(b.notice_value),
    noticeUnit: unit,
    leadDays: int(b.lead_days),
    bufferDays: int(b.buffer_days),
    autoRenews: b.auto_renews === true || b.auto_renews === 'on' || b.auto_renews === 'true',
    renewalTermMonths: term > 0 ? term : null,
    owner: str(b.owner) || null,
    notes: str(b.notes) || null,
  };
}

function isDomainName(s: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/.test(s);
}

export function createApp(store: Store): Hono {
  const app = new Hono();

  const page = (c: Context, title: string, body: SafeHtml) =>
    c.html(layout(title, body, { msg: c.req.query('msg'), error: c.req.query('error') }));
  const back = (c: Context, path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return c.redirect(qs ? `${path}?${qs}` : path, 303);
  };
  const idParam = (c: Context) => Number(c.req.param('id'));

  // Public endpoints: health check and the token-protected calendar feed.
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/calendar.ics', (c) => {
    if (c.req.query('token') !== store.icsToken()) return c.text('Forbidden', 403);
    c.header('content-type', 'text/calendar; charset=utf-8');
    return c.body(buildCalendar(listViews(store), config.baseUrl));
  });

  if (config.user && config.password) {
    app.use('*', basicAuth({ username: config.user, password: config.password }));
  }

  // Dashboard

  app.get('/', (c) => {
    const icsUrl = `${config.baseUrl}/calendar.ics?token=${store.icsToken()}`;
    return page(c, 'Dashboard', dashboardPage(listViews(store), icsUrl));
  });

  // Items

  app.get('/items/new', (c) => page(c, 'Add item', newItemPage(configuredMethod())));

  app.post('/items', async (c) => {
    const body = await c.req.parseBody();
    const input = parseItemInput(body);
    if (typeof input === 'string') return back(c, '/items/new', { error: input });
    const attachment = str(body.attachment);
    input.attachment = attachment && isAttachmentId(attachment) ? attachment : null;
    const id = store.createItem(input);
    return back(c, `/items/${id}`, { msg: 'Item added.' });
  });

  // Contract import: extract, then show a pre-filled form for review. Nothing is saved yet.
  app.post(
    '/items/import',
    bodyLimit({
      maxSize: config.maxUploadBytes + 64 * 1024,
      onError: (c) => back(c, '/items/new', { error: `The file is larger than ${config.maxUploadBytes / 1024 / 1024} MB.` }),
    }),
    async (c) => {
      const file = (await c.req.parseBody()).file;
      if (!(file instanceof File) || file.size === 0) return back(c, '/items/new', { error: 'Choose a PDF file.' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPdf(bytes)) return back(c, '/items/new', { error: 'That file is not a PDF.' });

      const result = await extractContract(bytes, file.name);
      const s = result.suggestion;
      const values: FormValues = {
        ...defaultValues(s.type),
        name: s.name,
        expires: s.expiresAt ?? '',
        noticeValue: s.noticeValue,
        noticeUnit: s.noticeUnit,
        auto: s.autoRenews,
        term: s.renewalTermMonths ?? '',
        notes: s.notes ?? '',
        attachment: saveAttachment(bytes),
      };
      return page(c, 'Review contract', reviewPage(result, file.name, values));
    },
  );

  app.get('/items/:id/document', (c) => {
    const row = store.getItem(idParam(c));
    const pdf = row?.attachment ? readAttachment(row.attachment) : null;
    if (!pdf) return c.notFound();
    c.header('content-type', 'application/pdf');
    c.header('content-disposition', 'inline');
    return c.body(new Uint8Array(pdf));
  });

  app.get('/items/:id', (c) => {
    const row = store.getItem(idParam(c));
    if (!row) return c.notFound();
    return page(c, row.name, itemPage(toView(row)));
  });

  app.post('/items/:id', async (c) => {
    const id = idParam(c);
    if (!store.getItem(id)) return c.notFound();
    const input = parseItemInput(await c.req.parseBody());
    if (typeof input === 'string') return back(c, `/items/${id}`, { error: input });
    store.updateItem(id, input);
    return back(c, `/items/${id}`, { msg: 'Saved.' });
  });

  app.post('/items/:id/status', async (c) => {
    const id = idParam(c);
    const status = str((await c.req.parseBody()).status) as ItemStatus;
    if (!['open', 'acknowledged', 'done'].includes(status)) return back(c, `/items/${id}`, { error: 'Invalid status.' });
    store.setStatus(id, status);
    return back(c, `/items/${id}`, { msg: `Marked as ${status}.` });
  });

  app.post('/items/:id/renewed', async (c) => {
    const id = idParam(c);
    const expires = str((await c.req.parseBody()).expires_at);
    if (Number.isNaN(Date.parse(expires))) return back(c, `/items/${id}`, { error: 'Enter the new expiry date.' });
    store.setExpiry(id, ymd(Date.parse(expires)));
    return back(c, `/items/${id}`, { msg: 'Renewed. New act-by date calculated.' });
  });

  app.post('/items/:id/delete', (c) => {
    const row = store.getItem(idParam(c));
    store.deleteItem(idParam(c));
    if (row?.attachment) deleteAttachment(row.attachment);
    return back(c, '/', { msg: 'Item deleted.' });
  });

  // Discovery

  app.get('/domains', (c) => page(c, 'Discovery', domainsPage(store.listDomains())));

  app.post('/domains', async (c) => {
    const name = str((await c.req.parseBody()).name).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!isDomainName(name)) return back(c, '/domains', { error: `"${name}" is not a valid domain name.` });
    store.addDomain(name);
    const domain = store.listDomains().find((d) => d.name === name);
    if (domain) void scanDomainSafe(store, domain);
    return back(c, '/domains', { msg: `Scanning ${name}. Refresh in a minute; Certificate Transparency lookups can be slow.` });
  });

  app.post('/domains/:id/scan', (c) => {
    const domain = store.getDomain(idParam(c));
    if (!domain) return c.notFound();
    void scanDomainSafe(store, domain);
    return back(c, '/domains', { msg: `Scanning ${domain.name}. Refresh in a minute.` });
  });

  app.post('/domains/:id/delete', (c) => {
    store.deleteDomain(idParam(c));
    return back(c, '/domains', { msg: 'Domain removed. Discovered items were kept.' });
  });

  // Alert channels

  app.get('/channels', (c) => page(c, 'Alerts', channelsPage(store.listChannels(), emailEnabled())));

  app.post('/channels', async (c) => {
    const b = await c.req.parseBody();
    const kind = str(b.kind) as ChannelKind;
    const name = str(b.name);
    const target = str(b.target);
    if (!CHANNEL_KINDS.includes(kind)) return back(c, '/channels', { error: 'Unknown channel type.' });
    if (!name || !target) return back(c, '/channels', { error: 'Name and target are required.' });
    if (kind === 'email' ? !target.includes('@') : !/^https?:\/\//.test(target)) {
      return back(c, '/channels', { error: kind === 'email' ? 'Enter an email address.' : 'Enter an http(s) URL.' });
    }
    store.addChannel(name, kind, target, b.escalation_only === 'on');
    return back(c, '/channels', { msg: 'Channel added. Send a test to check it.' });
  });

  app.post('/channels/:id/test', async (c) => {
    const channel = store.getChannel(idParam(c));
    if (!channel) return c.notFound();
    try {
      await sendToChannel(channel, {
        title: 'Lapse test alert',
        text: `This is a test from Lapse. Alerts for "${channel.name}" will arrive like this.\n${config.baseUrl}`,
        url: config.baseUrl,
        escalation: false,
      });
      return back(c, '/channels', { msg: `Test sent to ${channel.name}.` });
    } catch (err) {
      return back(c, '/channels', { error: `Test failed: ${(err as Error).message}` });
    }
  });

  app.post('/channels/:id/delete', (c) => {
    store.deleteChannel(idParam(c));
    return back(c, '/channels', { msg: 'Channel removed.' });
  });

  // JSON API (for scripts, CI pipelines and imports)

  app.get('/api/items', (c) =>
    c.json(listViews(store).map((i) => ({
      id: i.id, name: i.name, type: i.type, owner: i.owner, status: i.status, source: i.source,
      expiresAt: i.expires_at, actBy: ymd(i.actBy), daysToAct: i.daysToAct, urgency: i.urgency, action: i.action,
      nextChanceToCancel: i.missed?.nextActBy ? ymd(i.missed.nextActBy) : null,
      nextExpiry: i.missed?.nextExpiry ? ymd(i.missed.nextExpiry) : null,
    }))),
  );

  app.post('/api/items', async (c) => {
    const input = parseItemInput((await c.req.json().catch(() => ({}))) as Body);
    if (typeof input === 'string') return c.json({ error: input }, 400);
    const id = store.createItem(input);
    const row = store.getItem(id)!;
    const v = toView(row);
    return c.json({ id, actBy: ymd(v.actBy), urgency: v.urgency, action: v.action }, 201);
  });

  return app;
}
