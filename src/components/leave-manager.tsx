'use client';
import { useRef, useState } from 'react';
import { calculateLeave, weekdays, approvedLeaveDays, pendingLeaveDays, approvalLabel, type LeaveEmployee, type LeaveEntry } from '@/lib/leave-calculator';

type LeaveMutation = { employee: LeaveEmployee; request_id: string } | { action: 'approve'; employee_id: string; entry_id: string; version: number; stage: 1 | 2; request_id: string };
function entryDates(row: LeaveEntry) { return row.start ? row.start === row.end ? row.start : `${row.start} ~ ${row.end}` : '날짜 없는 합산 내역'; }
function ApprovalDetails({ entry }: { entry: LeaveEntry }) {
  const approval = entry.approval;
  const stampText = (stamp: NonNullable<typeof approval>['first']) => stamp ? `${stamp.username} · ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(stamp.at))}` : '대기';
  return <div className="leave-approval-details"><span className={`leave-approval-badge ${approval?.status || 'approved'}`}>{approvalLabel(entry)}</span>{approval && <p>1차: {stampText(approval.first)}<br/>최종: {stampText(approval.final)}</p>}</div>;
}
export function LeaveManager({ initial, today, username, displayName, canEditHistory, approvalStage }: { initial: LeaveEmployee[]; today: string; username: string; displayName: string; canEditHistory: boolean; approvalStage: 1 | 2 | null }) {
  const [employees, setEmployees] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.id || '');
  const [asOf, setAsOf] = useState(today), [draft, setDraft] = useState<LeaveEmployee | null>(initial[0] || null);
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [retry, setRetry] = useState<LeaveMutation | null>(null);
  const sending = useRef(false);
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [days, setDays] = useState('1'), [note, setNote] = useState(''), [editing, setEditing] = useState<string | null>(null);
  const patch = (values: Partial<LeaveEmployee>) => { if (draft) setDraft({ ...draft, ...values }); setDirty(true); setMessage(''); };
  let totals: ReturnType<typeof calculateLeave> | null = null, calculationError = '';
  if (draft) try { totals = calculateLeave(draft.hired, asOf, draft.special, approvedLeaveDays(draft.entries)); } catch (error) { calculationError = (error as Error).message; }
  const awaitingMyApproval = (row: LeaveEntry) => approvalStage === 1 ? row.approval?.status === 'pending_first' : approvalStage === 2 && row.approval?.status === 'pending_final';
  const approvalQueue = employees.flatMap(employee => employee.entries.filter(awaitingMyApproval).map(entry => ({ employee, entry })));
  function resetEntry() { setStart(''); setEnd(''); setDays('1'); setNote(''); setEditing(null); }
  function choose(id: string) {
    if (dirty && !window.confirm('저장하지 않은 변경을 취소하고 이동하시겠습니까?')) return;
    setSelected(id); setDraft(employees.find(employee => employee.id === id) || null); setDirty(false); setMessage(''); resetEntry();
  }
  function dates(a: string, b: string) { setStart(a); setEnd(b); try { setDays(String(weekdays(a, b))); } catch { setDays(''); } }
  function employeeForSave() {
    if (!draft) return null;
    if (!editing && !start && !end && !note.trim()) return draft;
    const count = Number(days);
    if (!days || !Number.isFinite(count) || count <= 0 || count * 2 % 1 !== 0) { setMessage('사용 일수는 0.5일 단위로 입력해주세요.'); return null; }
    try { if (start || end) { weekdays(start, end); if (start < draft.hired) throw new Error('사용일은 입사일 이후로 선택해주세요.'); } else if (!note.trim()) throw new Error('날짜 없는 합산 내역에는 설명이 필요합니다.'); }
    catch (error) { setMessage((error as Error).message); return null; }
    const entry = { id: editing || crypto.randomUUID(), start, end, days: count, note };
    return { ...draft, entries: editing ? draft.entries.map(row => row.id === editing ? entry : row) : [...draft.entries, entry] };
  }
  async function reload(id = selected) {
    const response = await fetch('/api/leave', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('내역을 불러오지 못했습니다. 로그인 상태를 확인해주세요.');
    const result = await response.json();
    const next = result.employees.some((e: LeaveEmployee) => e.is_self) ? result.employees : initial[0]?.version === 0 ? [initial[0], ...result.employees] : result.employees;
    setEmployees(next); const item = next.find((e: LeaveEmployee) => e.id === id) || next[0] || null;
    setDraft(item); setSelected(item?.id || ''); setDirty(false); resetEntry();
  }
  async function save() {
    if (retry) return submitMutation(retry);
    const employee = employeeForSave(); if (!employee) return;
    await submitMutation({ employee, request_id: crypto.randomUUID() });
  }
  async function approve(employee: LeaveEmployee, entry: LeaveEntry) {
    if (!approvalStage || pending || retry) return;
    if (dirty) { setMessage('입력 중인 내용을 먼저 저장한 뒤 승인해주세요.'); return; }
    await submitMutation({ action: 'approve', employee_id: employee.id, entry_id: entry.id, version: employee.version, stage: approvalStage, request_id: crypto.randomUUID() });
  }
  async function submitMutation(body: LeaveMutation) {
    if (sending.current) return; sending.current = true; setPending(true); setMessage('');
    try {
      const response = await fetch('/api/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 500 || response.status === 401) setRetry(body); else setRetry(null);
        setMessage(result.message); return;
      }
      setRetry(null); await reload('employee' in body ? body.employee.id : selected);
      setMessage('employee' in body ? '연차 내역을 저장했습니다.' : body.stage === 1 ? '1차 승인했습니다. 최종 승인 후 연차가 차감됩니다.' : '최종 승인했습니다. 사용 연차에 반영되었습니다.');
    } catch { setRetry(body); setMessage('저장 결과를 확인하지 못했습니다. 연결 후 저장 결과 확인을 눌러주세요.'); }
    finally { sending.current = false; setPending(false); }
  }
  function editEntry(row: LeaveEntry) { setEditing(row.id); setStart(row.start); setEnd(row.end); setDays(String(row.days)); setNote(row.note); document.getElementById('leave-entry')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  return <div className="leave-page"><section className="form-card leave-panel"><div className="form-heading"><h2>연차계산</h2><p>로그인 계정의 연차를 확인하세요. 연차 관리자는 직원 선택으로 전체 내역을 조회하고 연차 사용을 등록·수정할 수 있습니다.</p></div>
    <div className="leave-controls"><label className="field field-label">로그인 계정<input value={`${displayName} (${username})`} readOnly/></label>{canEditHistory && <label className="field field-label">직원 선택<select value={selected} disabled={pending || !!retry} onChange={e => choose(e.target.value)}>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.is_self ? ' (본인)' : ''}</option>)}</select></label>}<div className="leave-controls leave-date-controls"><label className="field field-label">계산 기준일<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}/></label><button type="button" className="top-btn ghost" onClick={() => setAsOf(today)}>오늘 기준</button></div></div>
    {totals && <div className="leave-totals" aria-live="polite">{[['근속 기간', `${totals.months}개월`], ['총 발생 연차', `${totals.earned}일`], ['사용 연차', `${totals.used}일`], ['잔여 연차', `${totals.remaining}일`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    {calculationError && <p role="alert">{calculationError}</p>}
    <p className="leave-approval-guide">best7 1차 승인 → best 최종 승인 후 사용 연차에 반영됩니다.</p>
    {draft && <p className="muted">승인 대기: <strong>{pendingLeaveDays(draft.entries)}일</strong> · 대기 중인 연차는 잔여 연차에서 차감하지 않습니다. 기존 저장 내역은 승인 완료로 유지됩니다.</p>}
  </section>
  {message && <p role="status" className="form-status">{message}</p>}
  {retry && <button type="button" disabled={pending} className="top-btn primary" onClick={() => save()}>저장 결과 확인</button>}
  {approvalStage && <section className="form-card leave-panel leave-approval-inbox"><h2>{approvalStage === 1 ? '1차 승인' : '최종 승인'} 대기 {approvalQueue.length}건</h2><p className="muted">직원과 신청 내용을 확인한 뒤 승인해주세요. 최종 승인자에게는 1차 승인이 완료된 신청만 표시됩니다.</p>
    {approvalQueue.length === 0 && <p className="muted">승인할 신청이 없습니다.</p>}
    <div className="leave-history">{approvalQueue.map(({ employee, entry }) => <div className="leave-history-row" key={`${employee.id}-${entry.id}`}><div><b>{employee.name} · {entryDates(entry)}</b><p>{entry.note}</p><ApprovalDetails entry={entry}/></div><strong>{entry.days}일</strong><div className="leave-buttons"><button type="button" className="top-btn ghost" disabled={pending || !!retry} onClick={() => choose(employee.id)}>직원 내역 보기</button><button type="button" className="top-btn primary" disabled={pending || !!retry} onClick={() => approve(employee, entry)}>{approvalStage === 1 ? '1차 승인' : '최종 승인'}</button></div></div>)}</div>
  </section>}
  {draft && <form className="form-card leave-panel" data-dirty={dirty} data-pending={pending || !!retry} onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); save(); }}><fieldset disabled={pending || !!retry} className="action-fields">
    <h2>직원 정보</h2><div className="leave-controls"><label className="field field-label">성명<input value={draft.is_self === false ? draft.name : displayName} readOnly/></label><label className="field field-label">직급<input value={draft.position} maxLength={50} onChange={e => patch({ position: e.target.value })}/></label><label className="field field-label">입사일<input type="date" value={draft.hired} required onChange={e => patch({ hired: e.target.value })}/></label><label className="field field-label">특별연차<input type="number" min="0" max="10000" step="0.5" value={draft.special} required onChange={e => patch({ special: e.target.valueAsNumber })}/></label></div>
    <h2 id="leave-entry">{editing ? '사용 내역 수정' : '사용 날짜 입력'}</h2><div className="leave-controls"><label className="field field-label">사용 시작일<input type="date" disabled={draft.is_self === false && !canEditHistory} value={start} onChange={e => dates(e.target.value, end < e.target.value ? e.target.value : end)}/></label><label className="field field-label">사용 종료일<input type="date" disabled={draft.is_self === false && !canEditHistory} value={end} min={start || undefined} onChange={e => dates(start, e.target.value)}/></label><div className="leave-days-save"><label className="field field-label">사용 일수<input type="number" min="0.5" step="0.5" disabled={draft.is_self === false && !canEditHistory} value={days} onChange={e => setDays(e.target.value)}/></label><button type="submit" className="top-btn primary">연차 내역 저장</button></div></div>
    <div className="leave-buttons"><button type="button" className="top-btn ghost" disabled={draft.is_self === false && !canEditHistory} onClick={() => { setEnd(start); setDays('0.5'); }}>반차 0.5일</button><button type="button" className="top-btn ghost" disabled={draft.is_self === false && !canEditHistory} onClick={() => { setEnd(start); setDays('1'); }}>하루 1일</button></div>
    <p className="muted">저장하면 연차가 신청되며, 1차·최종 승인 완료 후 차감됩니다. 관리자 대리 신청도 동일합니다. 날짜·일수·메모를 수정하면 다시 1차 승인부터 진행합니다. 기간 선택 시 토·일요일을 제외한 일수를 제안하며 공휴일은 사용 일수에서 조정해주세요.</p>
    <label className="field field-label">메모<input value={note} disabled={draft.is_self === false && !canEditHistory} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="필요한 내용만 입력"/></label><div className="leave-buttons">{(editing || start || end || note) && <button type="button" className="top-btn ghost" onClick={resetEntry}>입력 취소</button>}</div>
    <h2>신청·사용 내역 {draft.entries.length}건</h2><div className="leave-history">{[...draft.entries].sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end)).map(row => <div key={row.id} className="leave-history-row"><div><b>{entryDates(row)}</b><p>{row.note}</p><ApprovalDetails entry={row}/></div><strong>{row.days}일</strong>{canEditHistory && <div className="leave-buttons"><button type="button" className="top-btn ghost" onClick={() => editEntry(row)}>수정</button>{awaitingMyApproval(row) && <button type="button" className="top-btn primary" onClick={() => approve(draft, row)}>{approvalStage === 1 ? '1차 승인' : '최종 승인'}</button>}</div>}</div>)}</div>
    <div className="leave-save"><span>{dirty ? '저장을 눌러 신청해주세요. 최종 승인 후 차감됩니다.' : '저장된 내역입니다.'}</span></div>
  </fieldset></form>}
  <button type="button" disabled={pending || !!retry} className="top-btn ghost" onClick={() => { if (!dirty || window.confirm('저장하지 않은 변경을 취소하고 최신 내역을 불러오시겠습니까?')) reload().catch(error => setMessage(error.message)); }}>최신 내역 불러오기</button>
  </div>;
}
