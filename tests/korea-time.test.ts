import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koreaTime } from '../src/lib/korea-time';
test('database timestamps display in Korea, including midnight and explicit offsets', () => {
  assert.equal(koreaTime('2026-09-22 06:30:00'), '2026-09-22 15:30');
  assert.equal(koreaTime('2026-12-31T15:00:00.000Z'), '2027-01-01 00:00');
  assert.equal(koreaTime('2026-09-22T15:30:00+09:00'), '2026-09-22 15:30');
  assert.equal(koreaTime('2026-09-22 16:00:00', true), '2026-09-23');
  assert.equal(koreaTime(null), '-');
  assert.equal(koreaTime('invalid'), '-');
});
