// SQLite CURRENT_TIMESTAMP and legacy naive timestamps are stored in UTC.
export function koreaDateTimeInput(value: string) {
  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 23);
}
export function koreaDateTimeToUtc(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match || match[1] < '1900-01-01') throw new Error('처리일시를 확인해주세요.');
  const normalized = `${match[1]}T${match[2]}:${match[3] || '00'}.${(match[4] || '').padEnd(3, '0')}`;
  const date = new Date(`${normalized}+09:00`);
  if (!Number.isFinite(date.getTime()) || koreaDateTimeInput(date.toISOString()) !== normalized) throw new Error('올바른 처리일시를 입력해주세요.');
  return date.toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, '');
}
export function koreaTime(value: string | null | undefined, dateOnly = false) {
  if (!value) return '-';
  const normalized = value.trim().replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
  if (!Number.isFinite(date.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}${dateOnly ? '' : ` ${p.hour}:${p.minute}`}`;
}
