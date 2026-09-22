export type LeaveEntry = { id: string; start: string; end: string; days: number; note: string };
export type LeaveEmployee = { id: string; name: string; position: string; hired: string; special: number; entries: LeaveEntry[]; version: number };
export function todayKorea() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()); }
export function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('날짜를 선택해주세요.');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01') throw new Error('올바른 날짜를 입력해주세요.');
  return date;
}
// Exact translation of 연차계산기!D3:E7. No statutory-policy substitutions.
export function calculateLeave(hired: string, asOf: string, special: number, used: number) {
  const start = parseDate(hired), end = parseDate(asOf);
  if (end < start) throw new Error('계산 기준일은 입사일 이후로 선택해주세요.');
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
  const years = Math.floor(months / 12), remainingMonths = months % 12;
  let base = months;
  if (years > 0) {
    base = 0;
    for (let year = 1; year <= years; year++) base += 15 + Math.floor((year - 1) / 2);
    base += Math.trunc((15 + Math.floor(years / 2)) * remainingMonths / 12);
  }
  return { months, earned: base + special, used, remaining: base + special - used };
}
export function weekdays(start: string, end: string) {
  const a = parseDate(start), b = parseDate(end);
  if (b < a) throw new Error('종료일은 시작일 이후로 선택해주세요.');
  if ((b.getTime() - a.getTime()) / 86400000 > 3660) throw new Error('기간을 10년 이내로 선택해주세요.');
  let days = 0;
  for (let time = a.getTime(); time <= b.getTime(); time += 86400000) { const weekday = new Date(time).getUTCDay(); if (weekday !== 0 && weekday !== 6) days++; }
  return days;
}
