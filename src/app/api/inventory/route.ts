import { NextRequest, NextResponse } from 'next/server';
import { ACTIONS, ConflictError, InputError, mutate } from '@/lib/inventory';
import { sessionUser, SESSION_COOKIE } from '@/lib/auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  let sameOrigin = false;
  try { sameOrigin = !!origin && new URL(origin).host === host; } catch { /* Invalid Origin is rejected. */ }
  if (!sameOrigin) return NextResponse.json({ message: '허용하지 않는 요청 출처입니다.' }, { status: 403 });
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ message: 'JSON 요청이 필요합니다.' }, { status: 415 });
  try {
    const user = await sessionUser(request.cookies.get(SESSION_COOKIE)?.value);
    if (!user) return NextResponse.json({ message: '로그인이 필요합니다. 다시 로그인해주세요.' }, { status: 401 });
    const fields = await request.json();
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new InputError('입력 형식이 올바르지 않습니다.');
    if (!ACTIONS.includes(fields.action)) throw new InputError('지원하지 않는 요청입니다.');
    if (typeof fields.request_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(fields.request_id)) throw new ConflictError('화면을 새로 불러온 뒤 다시 입력하세요.');
    if (!fields.action.endsWith('.add') && !fields.action.startsWith('trash.') && fields.expected_version === undefined) throw new ConflictError('화면을 새로 불러온 뒤 다시 입력하세요.');
    return NextResponse.json({ ok: true, ...await mutate(fields, user) });
  } catch (e) {
    if (e instanceof InputError || e instanceof SyntaxError) return NextResponse.json({ ok: false, message: e.message }, { status: e instanceof ConflictError ? 409 : 400 });
    console.error('Inventory mutation failed:', e);
    return NextResponse.json({ ok: false, message: '저장하지 못했습니다. 잠시 후 다시 시도하세요.' }, { status: 500 });
  }
}
