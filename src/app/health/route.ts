import { getDb } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { await (await getDb()).execute('SELECT 1'); return Response.json({ status: 'ok' }); }
  catch { return Response.json({ status: 'error' }, { status: 503 }); }
}
