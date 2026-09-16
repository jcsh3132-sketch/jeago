import { NextRequest, NextResponse } from 'next/server';
import { AuthError, authenticate, credentials, createSession, limitAuth, register, revokeSession, updateAccount, REMEMBER_SECONDS, SESSION_COOKIE, secureCookies } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!['login', 'signup', 'logout', 'profile', 'password'].includes(action)) return NextResponse.json({ message: '지원하지 않는 요청입니다.' }, { status: 404 });
  const origin = request.headers.get('origin');
  try { if (!origin || new URL(origin).host !== (request.headers.get('x-forwarded-host') || request.headers.get('host'))) throw new Error(); }
  catch { return NextResponse.json({ message: '허용하지 않는 요청 출처입니다.' }, { status: 403 }); }
  const options = { httpOnly: true, secure: secureCookies, sameSite: 'lax' as const, path: '/' };
  try {
    if (action === 'logout') {
      await revokeSession(request.cookies.get(SESSION_COOKIE)?.value);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(SESSION_COOKIE, '', { ...options, maxAge: 0 });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AuthError('JSON 요청이 필요합니다.', 415);
    // Bound streamed bodies too, including requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new AuthError('입력 내용을 확인하세요.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); throw new AuthError('입력 내용이 너무 깁니다.', 413); } chunks.push(value); }
    const fields = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new AuthError('입력 내용을 확인하세요.');
    const ip = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
    await limitAuth(`${action}:ip:${ip}`, action === 'signup' ? 10 : 60, 900);
    if (action === 'profile' || action === 'password') {
      const profile = await updateAccount(request.cookies.get(SESSION_COOKIE)?.value, action, fields);
      const response = NextResponse.json({ ok: true, profile }, { headers: { 'Cache-Control': 'no-store' } });
      if (action === 'password') response.cookies.set(SESSION_COOKIE, '', { ...options, maxAge: 0 });
      return response;
    }
    const { username } = credentials(fields);
    if (action === 'signup') {
      await register(fields);
      return NextResponse.json({ ok: true, message: '회원가입이 완료되었습니다. 로그인해주세요.' }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    await limitAuth(`login:id:${username}`, 20, 900);
    const user = await authenticate(fields);
    const remember = fields.auto_login === true;
    const token = await createSession(user.id, remember);
    await revokeSession(request.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, token, { ...options, ...(remember ? { maxAge: REMEMBER_SECONDS } : {}) });
    return response;
  } catch (error) {
    if (error instanceof AuthError || error instanceof SyntaxError) return NextResponse.json({ message: error instanceof AuthError ? error.message : '입력 형식이 올바르지 않습니다.' }, { status: error instanceof AuthError ? error.status : 400, headers: { 'Cache-Control': 'no-store', ...(error instanceof AuthError && error.status === 429 ? { 'Retry-After': '900' } : {}) } });
    // Never log request bodies, passwords, session tokens, or database credentials.
    console.error('Authentication operation failed');
    return NextResponse.json({ message: '일시적인 오류가 발생했습니다. 다시 시도해주세요.' }, { status: 503 });
  }
}
