import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, computeActBy, urgencyOf, ymd, DAY } from '../src/actby.ts';

const actBy = (expiresAt: string, noticeValue: number, noticeUnit: 'days' | 'weeks' | 'months', leadDays = 0, bufferDays = 0) =>
  ymd(computeActBy({ expiresAt, noticeValue, noticeUnit, leadDays, bufferDays }));

test('contract ending 31 Dec with 3 months notice must be cancelled by 30 Sep', () => {
  assert.equal(actBy('2026-12-31', 3, 'months'), '2026-09-30');
});

test('month-end stays month-end (28 Feb minus 1 month is 31 Jan)', () => {
  assert.equal(actBy('2027-02-28', 1, 'months'), '2027-01-31');
});

test('mid-month dates keep their day', () => {
  assert.equal(actBy('2026-06-15', 1, 'months'), '2026-05-15');
});

test('lead time and buffer are subtracted after the notice period', () => {
  assert.equal(actBy('2026-12-31', 3, 'months', 5, 7), '2026-09-18');
  assert.equal(actBy('2026-10-20', 0, 'days', 7, 3), '2026-10-10');
  assert.equal(actBy('2026-10-20', 2, 'weeks'), '2026-10-06');
});

test('certificate timestamps are handled at day level', () => {
  assert.equal(actBy('2026-11-01T13:45:00.000Z', 0, 'days', 20), '2026-10-12');
});

test('addMonths rolls month-end terms forward correctly', () => {
  const jan31 = Date.UTC(2027, 0, 31);
  assert.equal(ymd(addMonths(jan31, 1)), '2027-02-28');
  assert.equal(ymd(addMonths(addMonths(jan31, 1), 1)), '2027-03-31');
  assert.equal(ymd(addMonths(Date.UTC(2026, 11, 31), 12)), '2027-12-31');
});

test('urgency levels', () => {
  const now = Date.UTC(2026, 8, 26);
  const in_ = (d: number) => now + d * DAY;
  assert.equal(urgencyOf(in_(-1), in_(-10), now), 'expired');
  assert.equal(urgencyOf(in_(20), in_(-1), now), 'overdue');
  assert.equal(urgencyOf(in_(20), in_(0), now), 'critical');
  assert.equal(urgencyOf(in_(60), in_(7), now), 'critical');
  assert.equal(urgencyOf(in_(60), in_(8), now), 'soon');
  assert.equal(urgencyOf(in_(200), in_(90), now), 'upcoming');
  assert.equal(urgencyOf(in_(200), in_(91), now), 'ok');
});
