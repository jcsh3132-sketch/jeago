import { createHash } from 'node:crypto';
import { getDb } from './db';
import { sessionUser, AuthError } from './auth';
import { parseDate, type LeaveEmployee } from './leave-calculator';
const uuid = /^[a-f0-9-]{36}$/i;
export async function leaveEmployees(token: string | undefined): Promise<LeaveEmployee[]> {
  if (!await sessionUser(token)) throw new AuthError('로그인이 필요합니다.', 401);
  const rows = (await (await getDb()).execute('SELECT * FROM leave_employee ORDER BY created_at,id')).rows;
  return rows.map(row => ({ id: String(row.id), name: String(row.name), position: String(row.position), hired: String(row.hired), special: Number(row.special), version: Number(row.version), entries: JSON.parse(String(row.entries)) }));
}
export async function saveLeave(token: string | undefined, input: Record<string, unknown>) {
  const user = await sessionUser(token);
  if (!user) throw new AuthError('로그인이 필요합니다.', 401);
  const f = input.employee as LeaveEmployee;
  if (!f || typeof f !== 'object' || !uuid.test(f.id) || typeof input.request_id !== 'string' || !uuid.test(input.request_id)) throw new AuthError('입력 내용을 확인해주세요.');
  if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 50 || typeof f.position !== 'string' || f.position.length > 50) throw new AuthError('이름과 직급을 확인해주세요.');
  if (typeof f.hired !== 'string') throw new AuthError('입사일을 선택해주세요.');
  try { parseDate(f.hired); } catch { throw new AuthError('입사일을 확인해주세요.'); }
  if (!Number.isSafeInteger(f.version) || f.version < 0 || !Number.isFinite(f.special) || f.special < 0 || f.special > 10000 || f.special * 2 % 1 !== 0) throw new AuthError('특별연차는 0.5일 단위로 입력해주세요.');
  if (!Array.isArray(f.entries) || f.entries.length > 1000) throw new AuthError('사용 내역은 최대 1,000건입니다.');
  const ids = new Set<string>();
  const entries = f.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || !uuid.test(entry.id) || ids.has(entry.id) || typeof entry.start !== 'string' || typeof entry.end !== 'string' || typeof entry.note !== 'string' || entry.note.length > 300 || !Number.isFinite(entry.days) || entry.days <= 0 || entry.days > 10000 || entry.days * 2 % 1 !== 0) throw new AuthError('사용 일수는 0.5일 단위로 입력하고 내역을 확인해주세요.');
    ids.add(entry.id);
    if (entry.start || entry.end) { try { parseDate(entry.start); parseDate(entry.end); if (entry.end < entry.start) throw new Error(); } catch { throw new AuthError('사용 시작일과 종료일을 확인해주세요.'); } }
    else if (!entry.note.trim()) throw new AuthError('날짜 없는 합산 내역에는 설명을 입력해주세요.');
    return { id: entry.id, start: entry.start, end: entry.end, days: entry.days, note: entry.note.trim() };
  });
  const payload = createHash('sha256').update(JSON.stringify({ user: user.id, employee: f })).digest('hex');
  const tx = await (await getDb()).transaction('write');
  try {
    const prior = (await tx.execute({ sql: 'SELECT payload FROM leave_request WHERE id=?', args: [input.request_id] })).rows[0];
    if (prior) { if (prior.payload !== payload) throw new AuthError('저장 요청이 변경되었습니다.', 409); await tx.rollback(); return; }
    const current = (await tx.execute({ sql: 'SELECT version FROM leave_employee WHERE id=?', args: [f.id] })).rows[0];
    if (current ? Number(current.version) !== f.version : f.version !== 0) throw new AuthError('다른 회원이 수정했습니다. 최신 내역을 불러온 뒤 다시 수정해주세요.', 409);
    if (current) await tx.execute({ sql: 'UPDATE leave_employee SET name=?,position=?,hired=?,special=?,entries=?,version=version+1,updated_by=? WHERE id=?', args: [f.name.trim(), f.position.trim(), f.hired, f.special, JSON.stringify(entries), user.id, f.id] });
    else await tx.execute({ sql: 'INSERT INTO leave_employee(id,name,position,hired,special,entries,version,updated_by) VALUES (?,?,?,?,?,?,1,?)', args: [f.id, f.name.trim(), f.position.trim(), f.hired, f.special, JSON.stringify(entries), user.id] });
    await tx.execute({ sql: 'INSERT INTO leave_request(id,payload,employee_id,actor_id) VALUES (?,?,?,?)', args: [input.request_id, payload, f.id, user.id] });
    await tx.commit();
  } catch (error) { if (!tx.closed) await tx.rollback(); throw error; } finally { tx.close(); }
}
