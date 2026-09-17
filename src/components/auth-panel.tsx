'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type PasswordCredentialConstructor = new (data: { id: string; password: string; name?: string }) => Credential;
export function AuthPanel({ signup = false, registered = false, passwordChanged = false }: { signup?: boolean; registered?: boolean; passwordChanged?: boolean }) {
  const [username, setUsername] = useState(''), [saveId, setSaveId] = useState(false), [savePassword, setSavePassword] = useState(false), [auto, setAuto] = useState(false);
  const [show, setShow] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (signup) return;
    try {
      const id = localStorage.getItem('jeago:remember-id');
      if (id) { setUsername(id); setSaveId(true); }
      setSavePassword(localStorage.getItem('jeago:password-manager') === '1');
      setAuto(localStorage.getItem('jeago:auto-login') === '1');
    } catch { /* Login remains available when optional device preferences are blocked. */ }
  }, [signup]);
  function preference(key: string, value: string | null) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* Optional preferences must not block login. */ }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (signup && fields.password !== fields.password_confirm) { setError('비밀번호 확인이 일치하지 않습니다.'); return; }
    setPending(true); setError('');
    try {
      const response = await fetch(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, auto_login: auto }), signal: AbortSignal.timeout(25000) });
      const result = await response.json();
      if (!response.ok) { setError(result.message || '다시 시도해주세요.'); setPending(false); return; }
      if (signup) { location.replace('/?registered=1'); return; }
      const enteredId = String(fields.username).trim();
      preference('jeago:remember-id', saveId ? enteredId : null);
      preference('jeago:password-manager', savePassword ? '1' : null);
      preference('jeago:auto-login', auto ? '1' : null);
      if (savePassword) {
        const PasswordCredential = (window as unknown as { PasswordCredential?: PasswordCredentialConstructor }).PasswordCredential;
        if (PasswordCredential && navigator.credentials) {
          try { await navigator.credentials.store(new PasswordCredential({ id: enteredId, password: String(fields.password) })); } catch { /* The browser/user may decline password storage. */ }
        }
      }
      location.replace('/');
    } catch { setError(signup ? '연결을 확인해주세요. 가입 결과가 불확실하면 입력한 ID와 PW로 로그인을 시도하세요.' : '연결을 확인한 뒤 다시 로그인해주세요.'); setPending(false); }
  }
  return <main className="auth-page">
    <div className="auth-brand"><Link href="/" aria-label="재고 관리 홈"><span className="auth-logo">▦</span><strong>재고 관리</strong></Link></div>
    <div className="auth-grid"><section className="auth-card" aria-labelledby="auth-title"><h1 id="auth-title">{signup ? '회원가입' : '로그인'}</h1><p className="auth-card-description">{signup ? '가입 정보를 입력하세요.' : 'ID와 PW를 입력하세요.'}</p>
      {registered && <p role="status" className="auth-success">회원가입이 완료되었습니다. ID와 PW로 로그인해주세요.</p>}
      {passwordChanged && <p role="status" className="auth-success">비밀번호가 변경되어 모든 기기에서 로그아웃되었습니다. 새 비밀번호로 로그인해주세요.</p>}
      <form method="post" action={`/api/auth/${signup ? 'signup' : 'login'}`} onSubmit={submit} autoComplete="on" className="auth-form"><fieldset disabled={pending}>
        {signup && <label>이름<input name="display_name" autoComplete="name" maxLength={50} required placeholder="사용할 이름을 입력하세요"/></label>}
        <label>ID<input name="username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}" required placeholder={signup ? '영문·숫자 등 3~32자' : 'ID를 입력하세요'}/></label>
        <label>PW<span className="auth-password"><input name="password" aria-label="PW" type={show ? 'text' : 'password'} autoComplete={signup ? 'new-password' : savePassword ? 'current-password' : 'off'} minLength={4} maxLength={128} required placeholder={signup ? '4자 이상 입력하세요' : 'PW를 입력하세요'}/><button type="button" onClick={() => setShow(!show)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}>{show ? '숨김' : '보기'}</button></span></label>
        {signup && <label>PW 확인<input name="password_confirm" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={4} maxLength={128} required placeholder="PW를 다시 입력하세요"/></label>}
        {!signup && <><div className="auth-options">
          <label><input type="checkbox" checked={saveId} onChange={event => { setSaveId(event.target.checked); if (!event.target.checked) preference('jeago:remember-id', null); }}/>ID 저장</label>
          <label><input type="checkbox" checked={savePassword} onChange={event => { setSavePassword(event.target.checked); preference('jeago:password-manager', event.target.checked ? '1' : null); }}/>PW 저장</label>
          <label><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)}/>자동로그인</label>
        </div><p className="auth-help">PW 저장은 브라우저의 비밀번호 관리자를 사용합니다.<br/>자동로그인은 이 기기에서 사용하는 동안 계속 유지됩니다.</p></>}
        {signup && <p className="auth-help">모든 회원이 같은 재고와 입출고 이력을 사용합니다.</p>}
        <button type="submit" className="auth-submit">{pending ? '처리 중…' : signup ? '회원가입' : '로그인'}<span aria-hidden="true">→</span></button>
      </fieldset>{error && <p role="alert" className="auth-error">{error}</p>}</form>
      <div className="auth-switch">{signup ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?'} <Link href={signup ? '/' : '/signup'}>{signup ? '로그인' : '회원가입'}</Link></div>
    </section></div>
  </main>;
}

export function LogoutButton() {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  async function logout() {
    setPending(true); setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      try { localStorage.removeItem('jeago:auto-login'); } catch { /* Optional preference. */ }
      location.replace('/');
    } catch { setPending(false); setError('로그아웃 실패. 다시 시도하세요.'); }
  }
  return <span className="logout-control"><button type="button" className="top-btn ghost" disabled={pending} onClick={logout}>{pending ? '처리 중…' : '로그아웃'}</button>{error && <small role="alert">{error}</small>}</span>;
}
