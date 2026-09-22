'use client';
import { useRef, useState } from 'react';
import { calculateLeave, weekdays, type LeaveEmployee, type LeaveEntry } from '@/lib/leave-calculator';

export function LeaveManager({ initial, today }: { initial: LeaveEmployee[]; today: string }) {
  const [employees, setEmployees] = useState(initial), [selected, setSelected] = useState(initial[0]?.id || '');
  const [asOf, setAsOf] = useState(today), [draft, setDraft] = useState<LeaveEmployee | null>(initial[0] || null);
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState('');
  const [retry, setRetry] = useState<{ employee: LeaveEmployee; request_id: string } | null>(null);
  const sending = useRef(false);
  const [start, setStart] = useState(today), [end, setEnd] = useState(today), [days, setDays] = useState('1'), [note, setNote] = useState(''), [editing, setEditing] = useState<string | null>(null);
  const patch = (values: Partial<LeaveEmployee>) => { if (draft) setDraft({ ...draft, ...values }); setDirty(true); setMessage(''); };
  let totals: ReturnType<typeof calculateLeave> | null = null, calculationError = '';
  if (draft) try { totals = calculateLeave(draft.hired, asOf, draft.special, draft.entries.reduce((sum, row) => sum + row.days, 0)); } catch (error) { calculationError = (error as Error).message; }
  function resetEntry() { setStart(today); setEnd(today); setDays('1'); setNote(''); setEditing(null); }
  function choose(id: string) {
    if (dirty && !window.confirm('저장하지 않은 변경을 취소하고 이동하시겠습니까?')) return;
    setSelected(id); setDraft(employees.find(e => e.id === id) || { id: crypto.randomUUID(), name: '', position: '', hired: today, special: 0, entries: [], version: 0 }); setDirty(id === 'new'); setMessage(''); resetEntry();
  }
  function dates(a: string, b: string) { setStart(a); setEnd(b); try { setDays(String(weekdays(a, b))); } catch { setDays(''); } }
  function putEntry() {
    if (!draft) return;
    const count = Number(days);
    if (!days || !Number.isFinite(count) || count <= 0 || count * 2 % 1 !== 0) { setMessage('사용 일수는 0.5일 단위로 입력해주세요.'); return; }
    try { if (start || end) { weekdays(start, end); if (start < draft.hired) throw new Error('사용일은 입사일 이후로 선택해주세요.'); } else if (!note.trim()) throw new Error('날짜 없는 합산 내역에는 설명이 필요합니다.'); }
    catch (error) { setMessage((error as Error).message); return; }
    const entry = { id: editing || crypto.randomUUID(), start, end, days: count, note };
    patch({ entries: editing ? draft.entries.map(row => row.id === editing ? entry : row) : [...draft.entries, entry] }); resetEntry();
  }
  async function reload(id = selected) {
    const response = await fetch('/api/leave', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('내역을 불러오지 못했습니다. 로그인 상태를 확인해주세요.');
    const result = await response.json(); setEmployees(result.employees); const item = result.employees.find((e: LeaveEmployee) => e.id === id) || result.employees[0] || null;
    setDraft(item); setSelected(item?.id || ''); setDirty(false); resetEntry();
  }
  async function save(body = retry || (draft ? { employee: draft, request_id: crypto.randomUUID() } : null)) {
    if (!body || sending.current) return; sending.current = true; setPending(true); setMessage('');
    try {
      const response = await fetch('/api/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 500 || response.status === 401) setRetry(body); else setRetry(null);
        setMessage(result.message); return;
      }
      setRetry(null); await reload(body.employee.id); setMessage('연차 내역을 저장했습니다.');
    } catch { setRetry(body); setMessage('저장 결과를 확인하지 못했습니다. 연결 후 저장 결과 확인을 눌러주세요.'); }
    finally { sending.current = false; setPending(false); }
  }
  function editEntry(row: LeaveEntry) { setEditing(row.id); setStart(row.start); setEnd(row.end); setDays(String(row.days)); setNote(row.note); document.getElementById('leave-entry')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  return <div className="leave-page"><section className="form-card leave-panel"><div className="form-heading"><h2>연차계산</h2><p>직원별 발생·사용·잔여 연차를 확인하고 사용 날짜를 등록하세요.</p></div>
    <div className="leave-controls"><label className="field field-label">직원 선택<select value={selected} disabled={pending || !!retry} onChange={e => choose(e.target.value)}><option value="" disabled>직원을 선택하세요</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name} {e.position}</option>)}<option value="new">+ 직원 추가</option></select></label><label className="field field-label">계산 기준일<input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}/></label><button type="button" className="top-btn ghost" onClick={() => setAsOf(today)}>오늘 기준</button></div>
    {totals && <div className="leave-totals" aria-live="polite">{[['근속 기간', `${totals.months}개월`], ['총 발생 연차', `${totals.earned}일`], ['사용 연차', `${totals.used}일`], ['잔여 연차', `${totals.remaining}일`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    {calculationError && <p role="alert">{calculationError}</p>}
    <p className="muted">첨부 엑셀의 누적 계산식 기준입니다. 사용 연차는 등록된 전체 내역(예약 포함)을 합산합니다.</p>
  </section>
  {draft && <form className="form-card leave-panel" data-dirty={dirty} data-pending={pending || !!retry} onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); save(); }}><fieldset disabled={pending || !!retry} className="action-fields">
    <h2>직원 정보</h2><div className="leave-controls"><label className="field field-label">성명<input value={draft.name} required maxLength={50} onChange={e => patch({ name: e.target.value })}/></label><label className="field field-label">직급<input value={draft.position} maxLength={50} onChange={e => patch({ position: e.target.value })}/></label><label className="field field-label">입사일<input type="date" value={draft.hired} required onChange={e => patch({ hired: e.target.value })}/></label><label className="field field-label">특별연차<input type="number" min="0" max="10000" step="0.5" value={draft.special} required onChange={e => patch({ special: e.target.valueAsNumber })}/></label></div>
    <h2 id="leave-entry">{editing ? '사용 내역 수정' : '사용 내역 추가'}</h2><div className="leave-controls"><label className="field field-label">사용 시작일<input type="date" value={start} onChange={e => dates(e.target.value, end < e.target.value ? e.target.value : end)}/></label><label className="field field-label">사용 종료일<input type="date" value={end} min={start || undefined} onChange={e => dates(start, e.target.value)}/></label><label className="field field-label">사용 일수<input type="number" min="0.5" step="0.5" value={days} onChange={e => setDays(e.target.value)}/></label></div>
    <div className="leave-buttons"><button type="button" className="top-btn ghost" onClick={() => { setEnd(start); setDays('0.5'); }}>반차 0.5일</button><button type="button" className="top-btn ghost" onClick={() => { setEnd(start); setDays('1'); }}>하루 1일</button></div>
    <p className="muted">기간 선택 시 토·일요일을 제외한 일수를 제안합니다. 공휴일이나 회사 휴무일은 사용 일수에서 조정해주세요.</p>
    <label className="field field-label">메모<input value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="필요한 내용만 입력"/></label><div className="leave-buttons"><button type="button" className="top-btn ghost" onClick={putEntry}>{editing ? '내역 수정 반영' : '사용 내역 추가'}</button>{editing && <button type="button" className="top-btn ghost" onClick={resetEntry}>수정 취소</button>}</div>
    <h2>사용 내역 {draft.entries.length}건</h2><div className="leave-history">{draft.entries.map(row => <div key={row.id} className="leave-history-row"><div><b>{row.start ? row.start === row.end ? row.start : `${row.start} ~ ${row.end}` : '이전 합산 내역'}</b><p>{row.note}</p></div><strong>{row.days}일</strong><div className="leave-buttons"><button type="button" className="top-btn ghost" onClick={() => editEntry(row)}>수정</button><button type="button" className="top-btn ghost" onClick={() => { if (window.confirm('이 사용 내역을 삭제하시겠습니까? 저장 버튼을 누르면 반영됩니다.')) { patch({ entries: draft.entries.filter(e => e.id !== row.id) }); if (editing === row.id) resetEntry(); } }}>삭제</button></div></div>)}</div>
    <div className="leave-save"><span>{dirty ? '변경 후 저장을 눌러주세요.' : '저장된 내역입니다.'}</span><button type="submit" className="top-btn primary">연차 내역 저장</button></div>
  </fieldset></form>}
  {message && <p role="status" className="form-status">{message}</p>}
  {retry && <button type="button" disabled={pending} className="top-btn primary" onClick={() => save()}>저장 결과 확인</button>}
  <button type="button" disabled={pending || !!retry} className="top-btn ghost" onClick={() => { if (!dirty || window.confirm('저장하지 않은 변경을 취소하고 최신 내역을 불러오시겠습니까?')) reload().catch(error => setMessage(error.message)); }}>최신 내역 불러오기</button>
  </div>;
}
