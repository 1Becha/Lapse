import { DAY, ymd } from './actby.ts';
import type { ItemView } from './items.ts';

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const icsDate = (ts: number) => ymd(ts).replace(/-/g, '');

// One all-day event per item on its act-by date, so the deadline that matters
// shows up in Google Calendar / Outlook next to everything else.
export function buildCalendar(items: ItemView[], baseUrl: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lapse//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Lapse deadlines',
  ];
  for (const item of items) {
    if (item.status === 'done') continue;
    const url = `${baseUrl}/items/${item.id}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:lapse-${item.id}-${icsDate(item.nextDeadline)}@lapse`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(item.nextDeadline)}`,
      `DTEND;VALUE=DATE:${icsDate(item.nextDeadline + DAY)}`,
      `SUMMARY:${escapeText(`${item.missed ? 'Last day to cancel' : 'Act'}: ${item.name}`)}`,
      `DESCRIPTION:${escapeText(`${item.action}\nExpires ${ymd(item.missed?.nextExpiry ?? item.expiresTs)}.\n${url}`)}`,
      `URL:${url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
