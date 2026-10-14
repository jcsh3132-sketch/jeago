import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { sessionUser, SESSION_COOKIE } from '@/lib/auth';
import { calculatorHeaders as headers, calculatorHtml, calculatorPath, calculatorUpstream } from '@/lib/calculator-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const assets: Record<string, [string, string]> = {
  'integration-style': ['integration.css', 'text/css; charset=utf-8'],
  'api-settings': ['api-settings.js', 'text/javascript; charset=utf-8'],
};
export async function GET(request: NextRequest, { params }: { params: Promise<{ asset: string }> }) {
  const user = await sessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ detail: '로그인이 필요합니다.' }, { status: 401, headers });
  const { asset } = await params;
  if (asset === 'cost-discounts' || (!calculatorPath(asset) && !Object.hasOwn(assets, asset))) return new NextResponse(null, { status: 404, headers });
  try {
    if (Object.hasOwn(assets, asset)) {
      const [file, type] = assets[asset];
      return new NextResponse(await readFile(join(process.cwd(), 'src/calculator', file), 'utf8'), { headers: { ...headers, 'Content-Type': type } });
    }
    const response = await calculatorUpstream(asset);
    const type = response.headers.get('Content-Type') || 'application/octet-stream';
    if (asset === 'index' && response.ok) {
      const integration = await readFile(join(process.cwd(), 'src/calculator/api-settings.html'), 'utf8');
      return new NextResponse(calculatorHtml(await response.text(), user.id, integration), { status: response.status, headers: { ...headers, 'Content-Type': type } });
    }
    return new NextResponse(response.body, { status: response.status, headers: { ...headers, 'Content-Type': type } });
  } catch { return NextResponse.json({ detail: '계산기 서버에 연결하지 못했습니다. 잠시 후 새로고침해주세요.' }, { status: 502, headers }); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ asset: string }> }) {
  const user = await sessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ detail: '로그인이 필요합니다.' }, { status: 401, headers });
  const { asset } = await params;
  if (asset !== 'cost-discounts') return new NextResponse(null, { status: 405, headers });
  try {
    if (new URL(request.headers.get('origin') || '').host !== (request.headers.get('x-forwarded-host') || request.headers.get('host'))) throw new Error();
  } catch { return NextResponse.json({ detail: '허용하지 않는 요청 출처입니다.' }, { status: 403, headers }); }
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ detail: 'JSON 요청이 필요합니다.' }, { status: 415, headers });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ detail: '입력 내용을 확인해주세요.' }, { status: 400, headers });
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); return NextResponse.json({ detail: '입력 내용이 너무 큽니다.' }, { status: 413, headers }); } chunks.push(value); }
    const body = Buffer.concat(chunks).toString('utf8');
    try { const value = JSON.parse(body); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); }
    catch { return NextResponse.json({ detail: '입력 형식을 확인해주세요.' }, { status: 400, headers }); }
    const response = await calculatorUpstream(asset, { body });
    return new NextResponse(response.body, { status: response.status, headers: { ...headers, 'Content-Type': response.headers.get('Content-Type') || 'application/json' } });
  } catch { return NextResponse.json({ detail: '할인 저장 결과를 확인하지 못했습니다. 가격표를 다시 불러와 확인해주세요.' }, { status: 502, headers }); }
}
