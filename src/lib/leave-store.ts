import { createHash } from 'node:crypto';
import { getDb } from './db';
import { sessionUser, AuthError } from './auth';
import { parseDate, type LeaveEmployee, type LeaveEntry } from './leave-calculator';
import type { Client, Transaction } from '@libsql/client';
const uuid = /^[a-f0-9-]{36}$/i;
export async function leaveApprovalStage(userId: string, db?: Client | Transaction): Promise<1 | 2 | null> {
  const stage = Number((await (db || await getDb()).execute({ sql: 'SELECT approval_stage FROM leave_admin WHERE user_id=?', args: [userId] })).rows[0]?.approval_stage);
  return stage === 1 || stage === 2 ? stage : null;
}
function entryChanged(a: LeaveEntry, b: LeaveEntry) {
  return a.start !== b.start || a.end !== b.end || a.days !== b.days || a.note !== b.note;
}
export async function isLeaveAdministrator(userId: string, db?: Client | Transaction) {
  return (await (db || await getDb()).execute({ sql: 'SELECT user_id FROM app_admin WHERE singleton=1 AND user_id=? UNION SELECT user_id FROM leave_admin WHERE user_id=?', args: [userId, userId] })).rows.length > 0;
}
export async function leaveEmployees(token: string | undefined): Promise<LeaveEmployee[]> {
  const user = await sessionUser(token);
  if (!user) throw new AuthError('로그인이 필요합니다.', 401);
  const admin = await isLeaveAdministrator(user.id);
  const rows = (await (await getDb()).execute({ sql: 'SELECT * FROM leave_employee WHERE user_id=? OR ?=1 ORDER BY CASE WHEN user_id=? THEN 0 ELSE 1 END,created_at,id', args: [user.id, admin ? 1 : 0, user.id] })).rows;
  return rows.map(row => ({ id: String(row.id), name: String(row.name), position: String(row.position), hired: String(row.hired), special: Number(row.special), version: Number(row.version), entries: JSON.parse(String(row.entries)), is_self: row.user_id === user.id }));
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
  let entries: LeaveEntry[] = f.entries.map(entry => {
    if (!entry || typeof entry !== 'object' || !uuid.test(entry.id) || ids.has(entry.id) || typeof entry.start !== 'string' || typeof entry.end !== 'string' || typeof entry.note !== 'string' || entry.note.length > 300 || !Number.isFinite(entry.days) || entry.days <= 0 || entry.days > 10000 || entry.days * 2 % 1 !== 0) throw new AuthError('사용 일수는 0.5일 단위로 입력하고 내역을 확인해주세요.');
    ids.add(entry.id);
    if (entry.start || entry.end) { try { parseDate(entry.start); parseDate(entry.end); if (entry.end < entry.start) throw new Error(); } catch { throw new AuthError('사용 시작일과 종료일을 확인해주세요.'); } }
    else if (!entry.note.trim()) throw new AuthError('날짜 없는 합산 내역에는 설명을 입력해주세요.');
    return { id: entry.id, start: entry.start, end: entry.end, days: entry.days, note: entry.note.trim() };
  });
  const payload = createHash('sha256').update(JSON.stringify({ user: user.id, employee: f })).digest('hex');
  const tx = await (await getDb()).transaction('write');
  try {
    const admin = await isLeaveAdministrator(user.id, tx);
    const current = (await tx.execute({ sql: 'SELECT version,user_id,entries,name FROM leave_employee WHERE id=?', args: [f.id] })).rows[0];
    if (current && current.user_id !== user.id && !admin) throw new AuthError('본인의 연차 내역만 수정할 수 있습니다.', 403);
    if (!current && (await tx.execute({ sql: 'SELECT id FROM leave_employee WHERE user_id=?', args: [user.id] })).rows.length) throw new AuthError('이미 본인의 연차 자료가 있습니다. 최신 내역을 불러와주세요.', 409);
    const prior = (await tx.execute({ sql: 'SELECT payload FROM leave_request WHERE id=?', args: [input.request_id] })).rows[0];
    if (prior) { if (prior.payload !== payload) throw new AuthError('저장 요청이 변경되었습니다.', 409); await tx.rollback(); return; }
    if (current ? Number(current.version) !== f.version : f.version !== 0) throw new AuthError('다른 회원이 수정했습니다. 최신 내역을 불러온 뒤 다시 수정해주세요.', 409);
    const previous: LeaveEntry[] = current ? JSON.parse(String(current.entries)) : [];
    if (current) {
      for (const old of previous) {
        const next = entries.find(entry => entry.id === old.id);
        if (!next) throw new AuthError('연차 사용 이력은 삭제할 수 없습니다.', 403);
        if (!admin && entryChanged(next, old)) throw new AuthError('기존 사용 이력은 관리자만 수정할 수 있습니다.', 403);
      }
    }
    const submittedAt = new Date().toISOString();
    entries = entries.map(entry => {
      const old = previous.find(item => item.id === entry.id);
      // Never accept client-provided approval metadata. Changing approved content requires fresh approvals.
      if (old && !entryChanged(entry, old)) return old.approval ? { ...entry, approval: old.approval } : entry;
      return { ...entry, approval: { status: 'pending_first', submitted_by: user.id, submitted_at: submittedAt } };
    });
    if (current) await tx.execute({ sql: 'UPDATE leave_employee SET name=?,position=?,hired=?,special=?,entries=?,version=version+1,updated_by=? WHERE id=?', args: [current.user_id === user.id ? user.display_name : String(current.name), f.position.trim(), f.hired, f.special, JSON.stringify(entries), user.id, f.id] });
    else await tx.execute({ sql: 'INSERT INTO leave_employee(id,name,position,hired,special,entries,version,updated_by,user_id) VALUES (?,?,?,?,?,?,1,?,?)', args: [f.id, user.display_name, f.position.trim(), f.hired, f.special, JSON.stringify(entries), user.id, user.id] });
    await tx.execute({ sql: 'INSERT INTO leave_request(id,payload,employee_id,actor_id) VALUES (?,?,?,?)', args: [input.request_id, payload, f.id, user.id] });
    await tx.commit();
  } catch (error) { if (!tx.closed) await tx.rollback(); throw error; } finally { tx.close(); }
}

export async function approveLeave(token: string | undefined, input: Record<string, unknown>) {
  const user = await sessionUser(token);
  if (!user) throw new AuthError('로그인이 필요합니다.', 401);
  if (input.action !== 'approve' || typeof input.employee_id !== 'string' || !uuid.test(input.employee_id) || typeof input.entry_id !== 'string' || !uuid.test(input.entry_id) || typeof input.request_id !== 'string' || !uuid.test(input.request_id) || !Number.isSafeInteger(input.version) || Number(input.version) < 0 || (input.stage !== 1 && input.stage !== 2)) throw new AuthError('승인 요청을 확인해주세요.');
  const payload = createHash('sha256').update(JSON.stringify({ action: 'approve', user: user.id, employee: input.employee_id, entry: input.entry_id, stage: input.stage, version: input.version })).digest('hex');
  const tx = await (await getDb()).transaction('write');
  try {
    const stage = await leaveApprovalStage(user.id, tx);
    if (!stage || stage !== input.stage) throw new AuthError('해당 단계의 지정 승인자만 승인할 수 있습니다.', 403);
    const prior = (await tx.execute({ sql: 'SELECT payload FROM leave_request WHERE id=?', args: [input.request_id] })).rows[0];
    if (prior) { if (prior.payload !== payload) throw new AuthError('승인 요청이 변경되었습니다.', 409); await tx.rollback(); return; }
    const current = (await tx.execute({ sql: 'SELECT entries,version FROM leave_employee WHERE id=?', args: [input.employee_id] })).rows[0];
    if (!current) throw new AuthError('직원의 연차 내역을 찾을 수 없습니다.', 404);
    if (Number(current.version) !== input.version) throw new AuthError('내역이 변경되었습니다. 최신 내역을 불러온 뒤 다시 확인해주세요.', 409);
    const entries = JSON.parse(String(current.entries)) as LeaveEntry[];
    const entry = entries.find(item => item.id === input.entry_id);
    if (!entry) throw new AuthError('신청 내역을 찾을 수 없습니다.', 404);
    const approval = entry.approval;
    if (!approval || approval.status !== (stage === 1 ? 'pending_first' : 'pending_final') || (stage === 2 && !approval.first)) throw new AuthError('1차 승인 후 최종 승인할 수 있습니다. 현재 승인 상태를 확인해주세요.', 409);
    const stamp = { user_id: user.id, username: user.username, at: new Date().toISOString() };
    entry.approval = stage === 1 ? { ...approval, status: 'pending_final', first: stamp } : { ...approval, status: 'approved', final: stamp };
    await tx.execute({ sql: 'UPDATE leave_employee SET entries=?,version=version+1,updated_by=? WHERE id=?', args: [JSON.stringify(entries), user.id, input.employee_id] });
    await tx.execute({ sql: 'INSERT INTO leave_request(id,payload,employee_id,actor_id) VALUES (?,?,?,?)', args: [input.request_id, payload, input.employee_id, user.id] });
    await tx.commit();
  } catch (error) { if (!tx.closed) await tx.rollback(); throw error; } finally { tx.close(); }
}
