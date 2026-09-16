'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Category } from '@/lib/types';
import { categoryPath } from '@/lib/types';

export function ActionForm({ action, children, className, confirm, onSuccess }: {
  action: string; children: ReactNode; className?: string; confirm?: string; onSuccess?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const [uncertain, setUncertain] = useState<Record<string, unknown> | null>(null), [conflict, setConflict] = useState(false);
  const formRef = useRef<HTMLFormElement>(null), sending = useRef(false), keyRef = useRef('');
  function storageKey() {
    if (keyRef.current) return keyRef.current;
    const fields = Object.fromEntries(new FormData(formRef.current!));
    keyRef.current = `jeago:pending:${location.pathname}:${action}:${fields.id || fields.group_id || fields.level || 'new'}`;
    return keyRef.current;
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null');
      if (saved?.action === action && typeof saved.request_id === 'string') {
        setUncertain(saved); setMessage('이전 저장 요청의 결과를 확인해주세요.'); setError(true);
      }
    } catch { /* Storage may be unavailable; a new submit reports it before writing. */ }
  }, [action]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || uncertain || conflict || (confirm && !window.confirm(confirm))) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    await send({ ...fields, action, request_id: crypto.randomUUID() });
  }
  async function send(body: Record<string, unknown>) {
    if (sending.current) return;
    const key = storageKey();
    try { sessionStorage.setItem(key, JSON.stringify(body)); }
    catch { setError(true); setMessage('브라우저 저장 공간을 사용할 수 없습니다. 브라우저 설정을 확인해주세요.'); return; }
    sending.current = true; setPending(true); setMessage('');
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setUncertain(body); setError(true); setMessage('로그인이 만료되었습니다. 새 탭에서 로그인한 뒤 저장 결과 확인을 누르세요.'); return;
        }
        if (res.status >= 400 && res.status < 500) {
          sessionStorage.removeItem(key); setUncertain(null); setConflict(res.status === 409);
          setError(true); setMessage(result.message || '입력 내용을 확인하세요.'); return;
        }
        throw new Error('저장 결과를 확인하지 못했습니다.');
      }
      sessionStorage.removeItem(key); setUncertain(null);
      formRef.current!.dataset.dirty = 'false';
      setError(false); setMessage(result.message);
      if (action.endsWith('.add')) formRef.current!.reset();
      try { localStorage.setItem('jeago:last-change', String(Date.now())); } catch { /* Periodic refresh remains available. */ }
      onSuccess?.();
      if (result.redirect) router.push(result.redirect);
      router.refresh();
    } catch { setUncertain(body); setError(true); setMessage('저장 여부를 확인하지 못했습니다. 연결 후 아래 버튼으로 같은 요청의 결과를 확인하세요.'); }
    finally { clearTimeout(timeout); sending.current = false; setPending(false); }
  }
  return <form ref={formRef} onSubmit={submit} className={className} data-pending={pending || !!uncertain || conflict ? 'true' : 'false'} onChange={() => { formRef.current!.dataset.dirty = 'true'; }}>
    <fieldset disabled={pending || !!uncertain || conflict} className="action-fields">{children}</fieldset>
    {pending && <span className="form-status" role="status">저장 중…</span>}
    {message && <span className={`form-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{message}</span>}
    {uncertain && <><button type="button" disabled={pending} className="top-btn ghost" onClick={() => send(uncertain)}>저장 결과 확인</button><a href="/" target="_blank" rel="noopener" className="top-btn ghost">새 탭에서 로그인</a></>}
    {conflict && <button type="button" className="top-btn ghost" onClick={() => location.reload()}>최신 내용 불러오기</button>}
  </form>;
}
export function Hidden({ name, value }: { name: string; value: string | number }) { return <input type="hidden" name={name} value={value} />; }
export function Field({ label, name, value, required = false, maxLength = 120, type = 'text' }: {
  label: string; name: string; value?: string; required?: boolean; maxLength?: number; type?: string;
}) {
  return <label className="field field-label">{label}<input name={name} defaultValue={value} required={required} maxLength={maxLength} type={type} /></label>;
}
export function CategorySelect({ categories, selected }: { categories: Category[]; selected?: string }) {
  const ids = new Set(categories.filter(c => c.parent_id === null).map(c => c.id));
  const devices = new Set(categories.filter(c => c.parent_id !== null && ids.has(c.parent_id)).map(c => c.id));
  const leaves = categories.filter(c => c.parent_id !== null && devices.has(c.parent_id));
  return <label className="field field-label">품목 카테고리<select name="category" required defaultValue={selected || ''}>
    <option value="" disabled>카테고리를 선택하세요</option>
    {leaves.map(c => <option key={c.id} value={c.name}>{categoryPath(categories, c.name)}</option>)}
  </select></label>;
}
export function DeleteButton({ action, id, version, message = '휴지통으로 이동하시겠습니까? 나중에 복구할 수 있습니다.' }: { action: string; id: number; version: number; message?: string }) {
  return <ActionForm action={action} confirm={message} className="inline-form"><Hidden name="id" value={id}/><Hidden name="expected_version" value={version}/><button type="submit" className="small-danger-btn">삭제</button></ActionForm>;
}
