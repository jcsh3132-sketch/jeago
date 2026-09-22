import { NextRequest, NextResponse } from 'next/server';
import { AuthError, SESSION_COOKIE } from '@/lib/auth';
import { leaveEmployees, saveLeave } from '@/lib/leave-store';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
function failure(error: unknown) { return NextResponse.json({ message: error instanceof AuthError ? error.message : '저장 결과를 확인하지 못했습니다. 다시 확인해주세요.' }, { status: error instanceof AuthError ? error.status : 503, headers }); }
export async function GET(request: NextRequest) {
  try { return NextResponse.json({ employees: await leaveEmployees(request.cookies.get(SESSION_COOKIE)?.value) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    let valid = false;
    try { valid = new URL(request.headers.get('origin') || '').host === (request.headers.get('x-forwarded-host') || request.headers.get('host')); } catch { /* reject */ }
    if (!valid) throw new AuthError('허용하지 않는 요청 출처입니다.', 403);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AuthError('JSON 요청이 필요합니다.', 415);
    const reader = request.body?.getReader(); if (!reader) throw new AuthError('입력 내용을 확인해주세요.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 600000) { await reader.cancel(); throw new AuthError('입력 내용이 너무 큽니다.', 413); } chunks.push(value); }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AuthError('입력 형식을 확인해주세요.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError('입력 내용을 확인해주세요.');
    await saveLeave(request.cookies.get(SESSION_COOKIE)?.value, input);
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}
