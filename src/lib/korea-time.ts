// SQLite CURRENT_TIMESTAMP and legacy naive timestamps are stored in UTC.
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
