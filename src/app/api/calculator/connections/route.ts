import { NextRequest, NextResponse } from 'next/server';
import { AuthError, SESSION_COOKIE } from '@/lib/auth';
import { calculatorApiState, saveCalculatorCredentials, disconnectCalculator, refreshCalculatorFees } from '@/lib/calculator-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
function failure(error: unknown) {
  return NextResponse.json({ message: error instanceof AuthError ? error.message : 'API 연결 상태를 확인하지 못했습니다.' }, { status: error instanceof AuthError ? error.status : 503, headers });
}
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await calculatorApiState(request.cookies.get(SESSION_COOKIE)?.value), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    let sameOrigin = false;
    try { sameOrigin = new URL(request.headers.get('origin') || '').host === (request.headers.get('x-forwarded-host') || request.headers.get('host')); } catch { /* rejected below */ }
    if (!sameOrigin) throw new AuthError('허용하지 않는 요청 출처입니다.', 403);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AuthError('JSON 요청이 필요합니다.', 415);
    const reader = request.body?.getReader(); if (!reader) throw new AuthError('입력 내용을 확인해주세요.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8000) { await reader.cancel(); throw new AuthError('입력 내용이 너무 큽니다.', 413); } chunks.push(value); }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AuthError('입력 형식을 확인해주세요.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError('입력 내용을 확인해주세요.');
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (input.action === 'save') await saveCalculatorCredentials(token, input);
    else if (input.action === 'disconnect') await disconnectCalculator(token, input);
    else if (input.action === 'refresh') await refreshCalculatorFees(token, input);
    else throw new AuthError('지원하지 않는 요청입니다.');
    return NextResponse.json({ ok: true, ...await calculatorApiState(token) }, { headers });
  } catch (error) { return failure(error); }
}
