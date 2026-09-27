import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.ts';
import { ymd } from './actby.ts';
import type { ItemView } from './items.ts';
import type { ChannelRow } from './store.ts';

export interface Message {
  title: string;
  text: string;
  url: string;
  escalation: boolean;
  item?: ItemView;
}

// kind 'missed' announces a missed cancel-by date; 'deadline' counts down to the
// next deadline the user can still meet (the next chance, for missed items).
export function alertMessage(item: ItemView, escalation: boolean, kind: 'missed' | 'deadline' = 'deadline'): Message {
  const daysToAct = item.missed?.daysToNextAct ?? item.daysToAct;
  const when =
    kind === 'missed' ? `cancel-by date ${ymd(item.actBy)} missed, renews on ${ymd(item.expiresTs)}`
    : item.urgency === 'expired' ? `expired ${-item.daysToExpiry} day(s) ago`
    : daysToAct < 0 ? `act-by date passed ${-daysToAct} day(s) ago`
    : daysToAct === 0 ? 'act today'
    : `${daysToAct} day(s) left to act`;
  const url = `${config.baseUrl}/items/${item.id}`;
  const prefix = escalation ? '[ESCALATION] ' : '';
  const owner = item.owner ? ` Owner: ${item.owner}.` : ' No owner assigned.';
  const expires = item.missed ? '' : ` Expires ${ymd(item.expiresTs)}.`;
  return {
    title: `${prefix}${item.name}: ${when}`,
    text: `${prefix}${item.name} (${item.type}): ${when}. ${item.action}${expires}${owner}\n${url}`,
    url,
    escalation,
    item,
  };
}

let transporter: Transporter | null = null;

export function emailEnabled(): boolean {
  return !!config.smtpUrl;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!config.smtpUrl) throw new Error('SMTP_URL is not configured');
  transporter ??= nodemailer.createTransport(config.smtpUrl);
  await transporter.sendMail({ from: config.smtpFrom, to, subject, text });
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
}

// Header values must be ASCII; ntfy accepts RFC 2047 encoded words.
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

export async function sendToChannel(channel: ChannelRow, msg: Message): Promise<void> {
  switch (channel.kind) {
    case 'slack':
      return postJson(channel.target, { text: msg.text });
    case 'discord':
      return postJson(channel.target, { content: msg.text });
    case 'webhook':
      return postJson(channel.target, {
        title: msg.title,
        text: msg.text,
        url: msg.url,
        escalation: msg.escalation,
        item: msg.item && {
          id: msg.item.id,
          name: msg.item.name,
          type: msg.item.type,
          owner: msg.item.owner,
          expiresAt: msg.item.expires_at,
          actBy: ymd(msg.item.actBy),
          daysToAct: msg.item.daysToAct,
          nextChanceToCancel: msg.item.missed?.nextActBy ? ymd(msg.item.missed.nextActBy) : null,
          urgency: msg.item.urgency,
        },
      });
    case 'ntfy': {
      const res = await fetch(channel.target, {
        method: 'POST',
        body: msg.text,
        headers: {
          Title: encodeHeader(msg.title),
          Priority: msg.escalation ? 'high' : 'default',
          Tags: 'hourglass',
          Click: msg.url,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
      return;
    }
    case 'email':
      return sendEmail(channel.target, msg.title, msg.text);
  }
}
