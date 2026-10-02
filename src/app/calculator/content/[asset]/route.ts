import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { sessionUser, SESSION_COOKIE } from '@/lib/auth';
import catalog from '@/calculator/catalog.json';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' };
const assets: Record<string, [string, string]> = {
  index: ['index.html', 'text/html; charset=utf-8'],
  style: ['style.css', 'text/css; charset=utf-8'],
  script: ['script.js', 'text/javascript; charset=utf-8'],
};
export async function GET(request: NextRequest, { params }: { params: Promise<{ asset: string }> }) {
  const user = await sessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ detail: '로그인이 필요합니다.' }, { status: 401, headers });
  const { asset } = await params;
  if (asset === 'sale-products') return NextResponse.json(catalog.sale, { headers });
  if (asset === 'rent-products') return NextResponse.json(catalog.rent, { headers });
  if (!Object.hasOwn(assets, asset)) return new NextResponse(null, { status: 404, headers });
  const [file, type] = assets[asset];
  let body = await readFile(join(process.cwd(), 'src', 'calculator', file), 'utf8');
  if (asset === 'index') body = body.replace('__CALCULATOR_ACCOUNT__', encodeURIComponent(user.id));
  return new NextResponse(body, { headers: { ...headers, 'Content-Type': type } });
}
