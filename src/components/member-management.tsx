'use client';
import Link from 'next/link';
import { koreaTime } from '@/lib/korea-time';
import { useState, type FormEvent } from 'react';
import type { ManagedMember } from '@/lib/admin';

export function MemberManagement({ initial }: { initial: ManagedMember[] }) {
  const [members, setMembers] = useState(initial), [selected, setSelected] = useState(initial.find(m => !m.is_admin)?.id || '');
  const [search, setSearch] = useState(''), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const member = members.find(m => m.id === selected);
  async function refresh() {
    const response = await fetch('/api/admin/users', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('회원 목록을 다시 불러오지 못했습니다. 관리자 로그인 상태를 확인해주세요.');
    setMembers((await response.json()).members);
  }
  async function submit(event: FormEvent<HTMLFormElement>, action: 'admin-profile' | 'admin-password' | 'admin-transfer') {
    event.preventDefault(); if (!member || pending) return;
    const form = event.currentTarget, fields = Object.fromEntries(new FormData(form));
    if (action === 'admin-transfer' && !window.confirm(`${member.display_name} (${member.username}) 회원에게 관리자 권한을 위임합니다. 본인은 즉시 일반 회원으로 변경됩니다. 진행하시겠습니까?`)) return;
    if (action === 'admin-password' && !window.confirm(`${member.username} 회원의 비밀번호를 변경하고 해당 회원의 모든 기기에서 로그아웃합니다. 진행하시겠습니까?`)) return;
    setPending(true); setMessage(''); setError(false);
    try {
      const response = await fetch(`/api/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, target_id: member.id, expected_version: member.account_version }), signal: AbortSignal.timeout(25000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || '수정하지 못했습니다.');
      form.reset(); form.dataset.dirty = 'false';
      if (action === 'admin-transfer') { window.alert('관리자 권한을 위임했습니다. 본인은 일반 회원으로 변경되었습니다.'); window.location.replace('/account'); return; }
      await refresh();
      setMessage(action === 'admin-profile' ? '회원 정보를 저장했습니다.' : '비밀번호를 변경했습니다. 해당 회원은 새 비밀번호로 로그인해야 합니다.');
    } catch (failure) {
      setError(true); setMessage(failure instanceof Error && failure.name !== 'TimeoutError' && failure.name !== 'TypeError' ? failure.message : '변경 결과를 확인하지 못했습니다. 최신 정보를 확인해주세요. 비밀번호 변경은 새 비밀번호로 로그인 여부를 확인하세요.');
    } finally { setPending(false); }
  }
  return <div className="account-settings member-management"><div className="form-card"><div className="form-heading"><h2>회원 관리</h2><p>가입 회원 {members.length}명 · 본인 정보는 <Link href="/account">내 계정</Link>에서 수정하세요.</p></div>
    <label className="field field-label">회원 검색<input value={search} onChange={event => setSearch(event.target.value)} placeholder="ID 또는 이름"/></label>
    <div className="member-picker" aria-label="가입 회원 목록">{members.filter(m => `${m.username} ${m.display_name}`.toLowerCase().includes(search.toLowerCase())).map(m => <button type="button" key={m.id} disabled={pending || !!m.is_admin} aria-pressed={selected === m.id} onClick={() => { setSelected(m.id); setMessage(''); }}><strong>{m.display_name}</strong><span>{m.username}{m.is_admin ? ' · 관리자' : ''}</span></button>)}</div>
  </div>
  {message && <p role={error ? 'alert' : 'status'} className={`form-status ${error ? 'error' : ''}`}>{message}</p>}
  <button type="button" className="top-btn ghost" disabled={pending} onClick={() => { setMessage(''); refresh().catch(failure => { setError(true); setMessage(failure.message); }); }}>최신 회원 정보 불러오기</button>
  {member && !member.is_admin && <div key={`${member.id}-${member.account_version}`} className="member-editor">
    <section className="form-card"><div className="form-heading"><h2>회원 정보 수정</h2><p>{member.username} · 가입일 {koreaTime(member.created_at, true)}</p></div>
      <form onSubmit={event => submit(event, 'admin-profile')} data-pending={pending} onChange={event => { event.currentTarget.dataset.dirty = 'true'; }}><fieldset disabled={pending} className="action-fields"><div className="account-fields">
        <label className="field field-label">회원 ID<input name="username" defaultValue={member.username} required minLength={3} maxLength={32} autoCapitalize="none" autoComplete="off"/></label>
        <label className="field field-label">이름<input name="display_name" defaultValue={member.display_name} required maxLength={50}/></label>
        <label className="field field-label">이메일<input name="email" type="email" defaultValue={member.email} maxLength={254}/></label>
        <label className="field field-label">연락처<input name="phone" type="tel" defaultValue={member.phone} maxLength={30}/></label>
        <label className="field field-label">부서<input name="department" defaultValue={member.department} maxLength={100}/></label>
        <label className="field field-label">관리자 비밀번호<input name="admin_password" type="password" autoComplete="off" required minLength={4} maxLength={128}/></label>
      </div><p className="muted">이름 변경은 이후 입출고에 반영되며 과거 이력은 유지됩니다.</p><button className="top-btn primary">회원 정보 저장</button></fieldset></form>
    </section>
    <section className="form-card"><div className="form-heading"><h2>회원 비밀번호 재설정</h2><p>기존 비밀번호는 표시하지 않습니다. 변경 시 해당 회원의 모든 로그인이 종료됩니다.</p></div>
      <form onSubmit={event => submit(event, 'admin-password')} data-pending={pending} onChange={event => { event.currentTarget.dataset.dirty = 'true'; }}><fieldset disabled={pending} className="action-fields">
        <label className="field field-label">새 비밀번호<input name="new_password" type="password" autoComplete="new-password" required minLength={4} maxLength={128}/></label>
        <label className="field field-label">새 비밀번호 확인<input name="password_confirm" type="password" autoComplete="new-password" required minLength={4} maxLength={128}/></label>
        <label className="field field-label">관리자 비밀번호<input name="admin_password" type="password" autoComplete="off" required minLength={4} maxLength={128}/></label>
        <button className="top-btn primary">비밀번호 재설정</button>
      </fieldset></form>
    </section>
    <section className="form-card"><div className="form-heading"><h2>관리자 위임</h2><p>{member.display_name} ({member.username}) 회원에게 관리자 권한을 넘깁니다. 완료하면 본인은 일반 회원으로 변경되며, 관리자는 1명만 유지됩니다.</p></div>
      <form onSubmit={event => submit(event, 'admin-transfer')} data-pending={pending} onChange={event => { event.currentTarget.dataset.dirty = 'true'; }}><fieldset disabled={pending} className="action-fields">
        <label className="field field-label">위임할 회원 ID 확인<input name="confirm_username" required maxLength={32} autoComplete="off" autoCapitalize="none" placeholder={member.username}/></label>
        <label className="field field-label">관리자 비밀번호<input name="admin_password" type="password" autoComplete="off" required minLength={4} maxLength={128}/></label>
        <button className="top-btn primary">관리자 권한 위임</button>
      </fieldset></form>
    </section>
  </div>}
  </div>;
}
