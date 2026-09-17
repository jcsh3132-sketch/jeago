import { NextRequest, NextResponse } from 'next/server';
import { listMembers } from '@/lib/admin';
import { AuthError, SESSION_COOKIE } from '@/lib/auth';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try { return NextResponse.json({ members: await listMembers(request.cookies.get(SESSION_COOKIE)?.value) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return NextResponse.json({ message: error instanceof AuthError ? error.message : '회원 정보를 불러오지 못했습니다.' }, { status: error instanceof AuthError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } }); }
}
