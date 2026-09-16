'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { AccountProfile } from '@/lib/auth';

export function AccountSettings({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const [saved, setSaved] = useState(profile);
  const [pending, setPending] = useState('');
  const [dirty, setDirty] = useState({ profile: false, password: false });
  const [feedback, setFeedback] = useState({ section: '', message: '', error: false, expired: false });
  async function submit(event: FormEvent<HTMLFormElement>, section: 'profile' | 'password') {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    if (section === 'password' && fields.new_password !== fields.password_confirm) {
      setFeedback({ section, message: '새 비밀번호 확인이 일치하지 않습니다.', error: true, expired: false }); return;
    }
    setPending(section); setFeedback({ section, message: '', error: false, expired: false });
    try {
      const response = await fetch(`/api/auth/${section}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields), signal: AbortSignal.timeout(25000) });
      const result = await response.json();
      if (!response.ok) {
        setFeedback({ section, message: result.message || '저장하지 못했습니다.', error: true, expired: response.status === 401 }); return;
      }
      form.reset();
      setDirty(value => ({ ...value, [section]: false }));
      if (section === 'password') { location.replace('/?password_changed=1'); return; }
      const updated = result.profile as AccountProfile;
      try {
        if (localStorage.getItem('jeago:remember-id')?.toLowerCase() === saved.username) localStorage.setItem('jeago:remember-id', updated.username);
      } catch { /* Optional device preference. Never store passwords. */ }
      setSaved(updated);
      setFeedback({ section, message: '계정 정보를 저장했습니다.', error: false, expired: false });
      router.refresh();
    } catch {
      setFeedback({ section, message: section === 'password' ? '연결이 끊겨 변경 결과를 확인하지 못했습니다. 로그인 화면에서 새 비밀번호로 먼저 로그인해 보세요.' : '연결이 끊겨 저장 결과를 확인하지 못했습니다. 페이지를 새로 열어 정보를 확인해주세요.', error: true, expired: section === 'password' });
    } finally { setPending(''); }
  }
  function notice(section: string) {
    return feedback.section === section && feedback.message && <p role={feedback.error ? 'alert' : 'status'} className={`form-status ${feedback.error ? 'error' : ''}`}>{feedback.message} {feedback.expired && <Link href="/">로그인 화면으로 이동</Link>}</p>;
  }
  return <div className="account-settings">
    <section className="form-card"><div className="form-heading"><h2>계정 정보</h2><p>이름을 변경하면 이후 입출고 담당자에 반영됩니다. 기존 입출고 기록의 이름은 유지됩니다.</p></div>
      <form key={JSON.stringify(saved)} onSubmit={event => submit(event, 'profile')} onChange={() => setDirty(value => ({ ...value, profile: true }))} data-dirty={dirty.profile} data-pending={pending === 'profile'} autoComplete="on">
        <fieldset className="action-fields" disabled={!!pending}>
          <div className="account-fields">
            <label className="field field-label">ID<input name="username" autoComplete="username" defaultValue={saved.username} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" autoCapitalize="none" spellCheck={false}/></label>
            <label className="field field-label">이름<input name="display_name" autoComplete="name" defaultValue={saved.display_name} required maxLength={50}/></label>
            <label className="field field-label">이메일 (선택)<input name="email" type="email" autoComplete="email" defaultValue={saved.email} maxLength={254}/></label>
            <label className="field field-label">연락처 (선택)<input name="phone" type="tel" autoComplete="tel" defaultValue={saved.phone} maxLength={30}/></label>
            <label className="field field-label">부서 (선택)<input name="department" defaultValue={saved.department} maxLength={100}/></label>
            <label className="field field-label">현재 비밀번호<input name="current_password" type="password" autoComplete="current-password" required minLength={10} maxLength={128}/></label>
          </div><p className="muted">ID는 영문·숫자로 시작하는 3~32자입니다. 변경한 ID로 다음 로그인부터 이용하세요. 이메일은 연락 정보로만 저장됩니다.</p>
          <div className="form-actions"><button type="submit" className="top-btn primary">{pending === 'profile' ? '저장 중…' : '계정 정보 저장'}</button></div>
        </fieldset>{notice('profile')}
      </form>
    </section>
    <section className="form-card"><div className="form-heading"><h2>비밀번호 변경</h2><p>변경하면 PC·모바일을 포함한 모든 기기에서 로그아웃됩니다. 새 비밀번호로 다시 로그인해주세요.</p></div>
      <form onSubmit={event => submit(event, 'password')} onChange={() => setDirty(value => ({ ...value, password: true }))} data-dirty={dirty.password} data-pending={pending === 'password'} autoComplete="on">
        <fieldset className="action-fields" disabled={!!pending}>
          <input name="username" autoComplete="username" value={saved.username} readOnly hidden/>
          <label className="field field-label">현재 비밀번호<input name="current_password" type="password" autoComplete="current-password" required minLength={10} maxLength={128}/></label>
          <label className="field field-label">새 비밀번호<input name="new_password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="10~128자로 입력하세요"/></label>
          <label className="field field-label">새 비밀번호 확인<input name="password_confirm" type="password" autoComplete="new-password" required minLength={10} maxLength={128}/></label>
          <div className="form-actions"><button type="submit" className="top-btn primary">{pending === 'password' ? '변경 중…' : '비밀번호 변경'}</button></div>
        </fieldset>{notice('password')}
      </form>
    </section>
  </div>;
}
