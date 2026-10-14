import { NextRequest } from 'next/server';
import { GET as assetGet } from './[asset]/route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) { return assetGet(request, { params: Promise.resolve({ asset: 'index' }) }); }
