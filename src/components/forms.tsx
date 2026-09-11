'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Category } from '@/lib/types';
import { categoryPath } from '@/lib/types';

export function ActionForm({ action, children, className, confirm, onSuccess }: {
  action: string; children: ReactNode; className?: string; confirm?: string; onSuccess?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (confirm && !window.confirm(confirm))) return;
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    setPending(true); setMessage('');
    try {
      const res = await fetch('/api/inventory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, action }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || '저장에 실패했습니다.');
      setError(false); setMessage(result.message);
      if (action.endsWith('.add')) form.reset();
      onSuccess?.();
      if (result.redirect) router.push(result.redirect);
      router.refresh();
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : '네트워크 연결을 확인하세요.'); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className={className}>
    <fieldset disabled={pending} className="action-fields">{children}</fieldset>
    {pending && <span className="form-status" role="status">저장 중…</span>}
    {message && <span className={`form-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{message}</span>}
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
export function DeleteButton({ action, id, message = '삭제하면 복구할 수 없습니다. 삭제하시겠습니까?' }: { action: string; id: number; message?: string }) {
  return <ActionForm action={action} confirm={message} className="inline-form"><Hidden name="id" value={id}/><button type="submit" className="small-danger-btn">삭제</button></ActionForm>;
}
