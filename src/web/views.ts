import { ymd, type NoticeUnit, type Urgency } from '../actby.ts';
import type { ItemView, Missed } from '../items.ts';
import { ITEM_TYPES, TEMPLATES, type ItemType } from '../templates.ts';
import { METHOD_LABEL, type ExtractionMethod, type ExtractionResult } from '../extract/index.ts';
import { CHANNEL_KINDS, type ChannelRow, type DomainRow, type ItemRow } from '../store.ts';
import { html, raw, type SafeHtml } from './html.ts';

const CSS = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --line: #e4e4df;
  --accent: #3b5bdb; --red: #c92a2a; --red-bg: #fff0f0; --amber: #b35c00; --amber-bg: #fff6e6;
  --blue-bg: #eef2ff; --green: #2b8a3e; --green-bg: #ebfbee;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413; --panel: #1f1f1d; --text: #ececea; --muted: #9a9a94; --line: #33332f;
    --accent: #8ea2ff; --red: #ff8787; --red-bg: #3a1f1f; --amber: #ffb86b; --amber-bg: #3a2c16;
    --blue-bg: #22284a; --green: #69db7c; --green-bg: #1c3322;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header { display: flex; align-items: center; gap: 24px; padding: 14px 24px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
header .logo { font-weight: 700; font-size: 18px; color: var(--text); letter-spacing: -0.02em; }
header nav { display: flex; gap: 16px; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 16px; margin: 32px 0 10px; }
.sub { color: var(--muted); margin: 0 0 20px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 8px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.tile b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
.tile span { color: var(--muted); font-size: 13px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: none; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.muted { color: var(--muted); font-size: 13px; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.u-expired, .u-overdue { background: var(--red-bg); color: var(--red); }
.u-critical, .u-missed { background: var(--amber-bg); color: var(--amber); }
s.muted { text-decoration-thickness: 1px; }
.u-soon, .u-upcoming { background: var(--blue-bg); color: var(--accent); }
.u-ok, .s-done { background: var(--green-bg); color: var(--green); }
.s-acknowledged { background: var(--blue-bg); color: var(--accent); }
.flash { background: var(--blue-bg); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }
.flash.error { background: var(--red-bg); color: var(--red); }
form.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; display: grid; gap: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
label.check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
input, select, textarea { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); width: 100%; }
input[type=checkbox] { width: auto; }
button { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
button.ghost { background: transparent; color: var(--accent); }
button.danger { background: transparent; border-color: var(--red); color: var(--red); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.inline { display: inline; }
.action { font-size: 15px; font-weight: 600; margin: 8px 0 0; }
code { background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 13px; word-break: break-all; }
.empty { padding: 32px; text-align: center; color: var(--muted); }
`;

export function layout(title: string, body: SafeHtml, flash?: { msg?: string; error?: string }): string {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Lapse</title>
<style>${raw(CSS)}</style>
</head>
<body>
<header>
  <a class="logo" href="/">⏳ Lapse</a>
  <nav><a href="/">Dashboard</a><a href="/items/new">Add item</a><a href="/domains">Discovery</a><a href="/channels">Alerts</a></nav>
</header>
<main>
${flash?.error ? html`<div class="flash error">${flash.error}</div>` : ''}
${flash?.msg ? html`<div class="flash">${flash.msg}</div>` : ''}
${body}
</main>
</body>
</html>`.value;
}

const URGENCY_LABEL: Record<Urgency, string> = {
  expired: 'Expired',
  overdue: 'Act-by passed',
  critical: 'This week',
  missed: 'Missed, renewing',
  soon: 'This month',
  upcoming: 'Next 90 days',
  ok: 'Later',
};

function relative(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `${-days} day${days === -1 ? '' : 's'} ago`;
}

function urgencyBadge(item: ItemView): SafeHtml {
  if (item.status === 'done') return html`<span class="badge s-done">Done</span>`;
  return html`<span class="badge u-${item.urgency}">${URGENCY_LABEL[item.urgency]}</span>`;
}

function actByCell(i: ItemView): SafeHtml {
  if (!i.missed) return html`<b>${ymd(i.actBy)}</b><br><span class="muted">${relative(i.daysToAct)}</span>`;
  const { nextActBy, daysToNextAct } = i.missed;
  return html`<s class="muted">${ymd(i.actBy)}</s><br>${nextActBy !== null && daysToNextAct !== null
    ? html`<b>${ymd(nextActBy)}</b><br><span class="muted">next chance, ${relative(daysToNextAct)}</span>`
    : html`<span class="muted">next chance unknown</span>`}`;
}

function itemsTable(items: ItemView[]): SafeHtml {
  if (items.length === 0) return html`<div class="panel empty">Nothing here.</div>`;
  return html`<div class="panel"><table>
<thead><tr><th>Item</th><th>Act by</th><th>Expires</th><th>Owner</th><th>Status</th></tr></thead>
<tbody>${items.map((i) => html`<tr>
  <td><a href="/items/${i.id}"><b>${i.name}</b></a><br><span class="muted">${TEMPLATES[i.type].label}${i.source !== 'manual' ? ` · discovered via ${i.source.toUpperCase()}` : ''}</span></td>
  <td class="num">${actByCell(i)}</td>
  <td class="num">${ymd(i.expiresTs)}<br><span class="muted">${relative(i.daysToExpiry)}</span></td>
  <td>${i.owner ?? html`<span class="muted">nobody</span>`}</td>
  <td>${urgencyBadge(i)}${i.status === 'acknowledged' ? html` <span class="badge s-acknowledged">Acknowledged</span>` : ''}</td>
</tr>`)}</tbody></table></div>`;
}

export function dashboardPage(items: ItemView[], icsUrl: string): SafeHtml {
  const active = items.filter((i) => i.status !== 'done');
  const now = active.filter((i) => ['expired', 'overdue', 'critical'].includes(i.urgency));
  const missed = active.filter((i) => i.urgency === 'missed');
  const soon = active.filter((i) => i.urgency === 'soon');
  const later = active.filter((i) => ['upcoming', 'ok'].includes(i.urgency));
  const done = items.filter((i) => i.status === 'done');
  const unowned = active.filter((i) => !i.owner).length;

  return html`
<h1>What needs action</h1>
<p class="sub">Sorted by the date you actually need to act, not the expiry date.</p>
<div class="tiles">
  <div class="tile"><b>${now.length}</b><span>Act this week or overdue</span></div>
  <div class="tile"><b>${soon.length}</b><span>Act this month</span></div>
  <div class="tile"><b>${later.length}</b><span>Later</span></div>
  ${missed.length ? html`<div class="tile"><b>${missed.length}</b><span>Missed, renewing</span></div>` : ''}
  <div class="tile"><b>${unowned}</b><span>Without an owner</span></div>
</div>
${items.length === 0
    ? html`<h2>Get started</h2><div class="panel empty">Add a domain under <a href="/domains">Discovery</a> to find certificates automatically, or <a href="/items/new">add an item</a> by hand.</div>`
    : html`
<h2>Now</h2>${itemsTable(now)}
${missed.length ? html`<h2>Missed: renewing automatically</h2>
<p class="muted" style="margin-top:-4px">The cancel-by date passed, so these renew. Lapse is now counting down to your next chance to cancel.</p>
${itemsTable(missed)}` : ''}
<h2>This month</h2>${itemsTable(soon)}
<h2>Later</h2>${itemsTable(later)}
${done.length ? html`<h2>Done</h2>${itemsTable(done)}` : ''}`}
<h2>Calendar feed</h2>
<p class="muted">Subscribe in Google Calendar or Outlook to see every act-by date: <code>${icsUrl}</code></p>`;
}

export interface FormValues {
  name: string;
  type: ItemType;
  expires: string;
  noticeValue: number;
  noticeUnit: NoticeUnit;
  lead: number;
  buffer: number;
  auto: boolean;
  term: number | '';
  owner: string;
  notes: string;
  attachment?: string;
}

export function defaultValues(type: ItemType = 'contract'): FormValues {
  const t = TEMPLATES[type];
  return {
    name: '', type, expires: '', noticeValue: t.noticeValue, noticeUnit: t.noticeUnit,
    lead: t.leadDays, buffer: t.bufferDays, auto: t.autoRenews, term: '', owner: '', notes: '',
  };
}

export function valuesFromRow(item: ItemRow): FormValues {
  return {
    name: item.name,
    type: item.type,
    expires: ymd(Date.parse(item.expires_at)),
    noticeValue: item.notice_value,
    noticeUnit: item.notice_unit,
    lead: item.lead_days,
    buffer: item.buffer_days,
    auto: item.auto_renews === 1,
    term: item.renewal_term_months ?? '',
    owner: item.owner ?? '',
    notes: item.notes ?? '',
  };
}

export function itemForm(v: FormValues, opts: { action: string; submit: string; typeDefaults: boolean }): SafeHtml {
  const templatesJson = JSON.stringify(TEMPLATES).replace(/</g, '\\u003c');

  return html`
<form class="card" method="post" action="${opts.action}">
  ${v.attachment ? html`<input type="hidden" name="attachment" value="${v.attachment}">` : ''}
  <div class="grid">
    <label>Name<input name="name" required value="${v.name}" placeholder="Office lease, api.example.com, passport…"></label>
    <label>Type<select name="type" id="type">${ITEM_TYPES.map((type) => html`<option value="${type}" ${type === v.type ? 'selected' : ''}>${TEMPLATES[type].label}</option>`)}</select></label>
    <label>Expires / ends on<input type="date" name="expires_at" required value="${v.expires}"></label>
    <label>Owner<input name="owner" value="${v.owner}" placeholder="Name or email (email gets alerts)"></label>
  </div>
  <p class="muted" id="hint">${TEMPLATES[v.type].hint}</p>
  <div class="grid">
    <label>Notice period<div class="row"><input type="number" min="0" name="notice_value" id="notice_value" value="${v.noticeValue}" style="width:90px">
      <select name="notice_unit" id="notice_unit" style="width:auto">${(['days', 'weeks', 'months'] as const).map((u) => html`<option ${u === v.noticeUnit ? 'selected' : ''}>${u}</option>`)}</select></div></label>
    <label>Lead time (days)<input type="number" min="0" name="lead_days" id="lead_days" value="${v.lead}"></label>
    <label>Safety buffer (days)<input type="number" min="0" name="buffer_days" id="buffer_days" value="${v.buffer}"></label>
    <label>Renews for (months)<input type="number" min="0" name="renewal_term_months" value="${v.term}" placeholder="e.g. 12"></label>
  </div>
  <label class="check"><input type="checkbox" name="auto_renews" id="auto_renews" ${v.auto ? 'checked' : ''}> Renews automatically unless cancelled</label>
  <label>Notes<textarea name="notes" rows="3">${v.notes}</textarea></label>
  <div class="row"><button>${opts.submit}</button></div>
</form>
${!opts.typeDefaults ? '' : html`<script>
const T = ${raw(templatesJson)};
document.getElementById('type').addEventListener('change', (e) => {
  const t = T[e.target.value];
  for (const [id, key] of [['notice_value', 'noticeValue'], ['notice_unit', 'noticeUnit'], ['lead_days', 'leadDays'], ['buffer_days', 'bufferDays']]) document.getElementById(id).value = t[key];
  document.getElementById('auto_renews').checked = t.autoRenews;
  document.getElementById('hint').textContent = t.hint;
});
</script>`}`;
}

function missedTile(item: ItemView, m: Missed, notice: string): SafeHtml {
  const known = m.nextActBy !== null && m.nextExpiry !== null && m.daysToNextAct !== null;
  return html`<div class="tile">
  <span>Next chance to cancel</span>
  <b>${known ? ymd(m.nextActBy!) : 'unknown'}</b>
  <span>${known ? html`${relative(m.daysToNextAct!)} · ends the contract on ${ymd(m.nextExpiry!)} · ${notice}${item.lead_days} days lead time + ${item.buffer_days} days buffer` : 'Set "Renews for (months)" below to calculate it.'}</span>
  <p class="action">${item.action}</p>
  <p class="muted" style="margin:6px 0 0">Missed cancel-by date: <s>${ymd(item.actBy)}</s> (${relative(item.daysToAct)}). If you still cancelled in time, or the other party accepts a late cancellation, mark this done.</p>
</div>`;
}

export function itemPage(item: ItemView): SafeHtml {
  const meta = item.meta ? (JSON.parse(item.meta) as Record<string, unknown>) : null;
  const notice = item.notice_value ? `${item.notice_value} ${item.notice_unit} notice + ` : '';
  return html`
<h1>${item.name}</h1>
<p class="sub">${TEMPLATES[item.type].label} · expires ${ymd(item.expiresTs)} (${relative(item.daysToExpiry)}) ${urgencyBadge(item)}</p>
${item.missed ? missedTile(item, item.missed, notice) : html`<div class="tile">
  <span>Act by</span>
  <b>${ymd(item.actBy)}</b>
  <span>${relative(item.daysToAct)} · ${notice}${item.lead_days} days lead time + ${item.buffer_days} days buffer</span>
  <p class="action">${item.action}</p>
</div>`}
<div class="row" style="margin-top:14px">
  ${item.status === 'open' ? html`<form class="inline" method="post" action="/items/${item.id}/status"><input type="hidden" name="status" value="acknowledged"><button class="ghost">I'm on it</button></form>` : ''}
  ${item.status !== 'done' ? html`<form class="inline" method="post" action="/items/${item.id}/status"><input type="hidden" name="status" value="done"><button class="ghost">Mark done</button></form>` : ''}
  ${item.status !== 'open' ? html`<form class="inline" method="post" action="/items/${item.id}/status"><input type="hidden" name="status" value="open"><button class="ghost">Reopen</button></form>` : ''}
  <form class="inline row" method="post" action="/items/${item.id}/renewed"><input type="date" name="expires_at" required style="width:auto"><button>Renewed until…</button></form>
</div>
${meta ? html`<h2>Discovered details</h2><div class="panel"><table>${Object.entries(meta).map(([k, val]) => html`<tr><th>${k}</th><td>${String(val ?? '—')}</td></tr>`)}</table></div>
<p class="muted">Source: ${item.source.toUpperCase()} · last checked ${item.last_checked_at ?? 'never'} UTC</p>` : ''}
${item.attachment ? html`<p style="margin-top:14px">📄 <a href="/items/${item.id}/document" target="_blank">Open the contract PDF</a></p>` : ''}
<h2>Edit</h2>
${itemForm(valuesFromRow(item), { action: `/items/${item.id}`, submit: 'Save changes', typeDefaults: false })}
<form method="post" action="/items/${item.id}/delete" style="margin-top:14px" onsubmit="return confirm('Delete this item?')"><button class="danger">Delete item</button></form>`;
}

export function domainsPage(domains: DomainRow[]): SafeHtml {
  return html`
<h1>Discovery</h1>
<p class="sub">Add a domain. Lapse finds its subdomains in Certificate Transparency logs, checks the certificate each host really serves, and looks up the domain's own expiry via RDAP. Scans repeat daily.</p>
<form class="card" method="post" action="/domains">
  <div class="row"><input name="name" required placeholder="example.com" style="max-width:320px"><button>Add and scan</button></div>
</form>
<h2>Watched domains</h2>
${domains.length === 0 ? html`<div class="panel empty">No domains yet.</div>` : html`<div class="panel"><table>
<thead><tr><th>Domain</th><th>Last scan</th><th>Result</th><th></th></tr></thead>
<tbody>${domains.map((d) => {
    const r = d.last_result ? (JSON.parse(d.last_result) as { hostsInCtLogs: number; hostsReachable: number; created: number; renewed: number; notes: string[] }) : null;
    return html`<tr>
  <td><b>${d.name}</b></td>
  <td class="num">${d.last_scan_at ?? html`<span class="muted">pending…</span>`}</td>
  <td>${d.last_error ? html`<span class="badge u-overdue">${d.last_error}</span>` : r ? html`${r.hostsInCtLogs} hosts in CT logs, ${r.hostsReachable} reachable · ${r.created} new, ${r.renewed} renewed${r.notes.map((n) => html`<br><span class="muted">${n}</span>`)}` : ''}</td>
  <td><div class="row">
    <form class="inline" method="post" action="/domains/${d.id}/scan"><button class="ghost">Scan now</button></form>
    <form class="inline" method="post" action="/domains/${d.id}/delete"><button class="danger">Remove</button></form>
  </div></td>
</tr>`;
  })}</tbody></table></div>`}`;
}

export function channelsPage(channels: ChannelRow[], emailEnabled: boolean): SafeHtml {
  return html`
<h1>Alerts</h1>
<p class="sub">Alerts fire 30, 14, 7, 3 and 1 days before each act-by date, on the day, and when it passes. Owners with an email address are notified directly${emailEnabled ? '' : ' (configure SMTP_URL to enable email)'}. Escalation channels only hear about items nobody has acknowledged 3 days before the deadline.</p>
<form class="card" method="post" action="/channels">
  <div class="grid">
    <label>Name<input name="name" required placeholder="Ops channel"></label>
    <label>Type<select name="kind">${CHANNEL_KINDS.map((k) => html`<option>${k}</option>`)}</select></label>
    <label>Webhook URL, ntfy topic URL or email<input name="target" required placeholder="https://hooks.slack.com/…"></label>
  </div>
  <label class="check"><input type="checkbox" name="escalation_only"> Escalations only (e.g. team lead)</label>
  <div class="row"><button>Add channel</button></div>
</form>
<h2>Channels</h2>
${channels.length === 0 ? html`<div class="panel empty">No channels yet. Nothing will be sent.</div>` : html`<div class="panel"><table>
<thead><tr><th>Name</th><th>Type</th><th>Target</th><th></th></tr></thead>
<tbody>${channels.map((c) => html`<tr>
  <td><b>${c.name}</b>${c.escalation_only ? html` <span class="badge u-critical">escalation</span>` : ''}</td>
  <td>${c.kind}</td>
  <td><code>${c.target.replace(/(https?:\/\/[^/]+\/).+/, '$1…')}</code></td>
  <td><div class="row">
    <form class="inline" method="post" action="/channels/${c.id}/test"><button class="ghost">Send test</button></form>
    <form class="inline" method="post" action="/channels/${c.id}/delete"><button class="danger">Remove</button></form>
  </div></td>
</tr>`)}</tbody></table></div>`}`;
}

export function newItemPage(method: ExtractionMethod): SafeHtml {
  return html`
<h1>Add item</h1>
<p class="sub">Lapse works out the act-by date from the expiry, notice period, lead time and buffer.</p>
<form class="card" method="post" action="/items/import" enctype="multipart/form-data"
  onsubmit="const b=this.querySelector('button');b.disabled=true;b.textContent='Reading contract…'">
  <b>Import from a contract PDF</b>
  <p class="muted" style="margin:0">Lapse reads the end date, notice period and renewal clause, and shows where in the document it found each one. You review everything before it's saved. Extraction uses ${METHOD_LABEL[method]}</p>
  <div class="row"><input type="file" name="file" accept="application/pdf,.pdf" required style="max-width:360px"><button>Read contract</button></div>
</form>
<h2>Or enter it by hand</h2>
${itemForm(defaultValues(), { action: '/items', submit: 'Add item', typeDefaults: true })}`;
}

const EVIDENCE_LABEL: Record<string, string> = {
  end_date: 'End of term',
  initial_term: 'Initial term',
  notice_period: 'Notice period',
  auto_renews: 'Auto-renewal',
  renewal_term: 'Renewal term',
};

function evidenceBadge(verified: boolean | null): SafeHtml {
  if (verified === true) return html`<span class="badge u-ok">quote found in document</span>`;
  if (verified === false) return html`<span class="badge u-overdue">quote not found: check this</span>`;
  return html`<span class="badge u-upcoming">can't check (scanned PDF)</span>`;
}

export function reviewPage(result: ExtractionResult, filename: string, values: FormValues): SafeHtml {
  const t = result.terms;
  const months = (n: number | null) => (n ? `${n} month${n === 1 ? '' : 's'}` : '—');
  const found: [string, string][] = [
    ['end_date', t.end_date ?? (t.start_date ? `— (starts ${t.start_date})` : '—')],
    ['initial_term', months(t.initial_term_months)],
    ['notice_period', t.notice_period ? `${t.notice_period.value} ${t.notice_period.unit}` : '—'],
    ['auto_renews', t.auto_renews === null ? 'not stated' : t.auto_renews ? 'yes' : 'no'],
    ['renewal_term', months(t.renewal_term_months)],
  ];

  return html`
<h1>Review contract terms</h1>
<p class="sub">${filename}${result.pages ? ` · ${result.pages} page${result.pages === 1 ? '' : 's'}` : ''} · read with ${result.method === 'rules' ? 'built-in rules' : result.method === 'claude' ? 'Claude' : 'Ollama'}</p>
${result.warnings.map((w) => html`<div class="flash error">${w}</div>`)}
<div class="panel"><table>
<thead><tr><th>Term</th><th>Found</th><th>Where in the document</th></tr></thead>
<tbody>${found.map(([field, value]) => {
    const ev = result.evidence.find((e) => e.field === field);
    return html`<tr>
  <td><b>${EVIDENCE_LABEL[field]}</b></td>
  <td class="num">${value}</td>
  <td>${ev ? html`<q>${ev.quote}</q><br>${evidenceBadge(ev.verified)}` : html`<span class="muted">—</span>`}</td>
</tr>`;
  })}</tbody></table></div>
${result.suggestion.derivation.map((d) => html`<p class="muted">↳ ${d}</p>`)}
<h2>Confirm and save</h2>
<p class="sub">Adjust anything that looks wrong. The PDF is attached to the item.</p>
${itemForm(values, { action: '/items', submit: 'Save item', typeDefaults: false })}`;
}
