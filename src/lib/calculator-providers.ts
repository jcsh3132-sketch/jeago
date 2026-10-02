import { createHmac } from 'node:crypto';
import { hash } from 'bcryptjs';

export type FeePlatform = 'smartstore' | 'coupang';
export type ApiCredentials = { clientId?: string; clientSecret?: string; accessKey?: string; secretKey?: string; vendorId?: string };
export type FeeRecord = { id: string; name: string; sku: string; rate: number; samples: number; basisDate: string; source: string };
export class ProviderError extends Error {}
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 400) : typeof v === 'number' ? String(v) : '';
const roundRate = (n: number) => Math.round(n * 10000) / 10000;

// Keep only product/rate information. Orders, customers, addresses and auth tokens
// are never stored in the calculator catalog or returned to the browser.
export function naverFeeRecords(rows: Row[]): FeeRecord[] {
  const orders = new Map<string, { id: string; name: string; date: string; kind: string; fee: number; bases: Map<string, number> }>();
  for (const r of rows) {
    if (r.productOrderType !== 'PROD_ORDER' || !['NORMAL_SETTLE_ORIGINAL', 'QUICK_SETTLE_ORIGINAL'].includes(text(r.settleType))) continue;
    const id = text(r.productId), orderId = text(r.productOrderId), amount = number(r.commissionAmount), basis = number(r.commissionBasisAmount);
    if (!id || !orderId || amount === null || amount < 0 || basis === null || basis <= 0 || !text(r.commissionType)) continue;
    const key = orderId + ':' + text(r.settleType);
    const o = orders.get(key) || { id, name: text(r.productName), date: text(r.settleBasisDate), kind: text(r.settleType), fee: 0, bases: new Map<string, number>() };
    o.fee += amount;
    // Payment means may split a fee type into multiple rows; other fee types
    // reuse the same sale basis. Never add that basis once per commission type.
    o.bases.set(text(r.commissionType), (o.bases.get(text(r.commissionType)) || 0) + basis);
    orders.set(key, o);
  }
  const groups = new Map<string, { id: string; name: string; date: string; fee: number; basis: number; samples: number }>();
  for (const [key, o] of orders) {
    if (o.kind === 'QUICK_SETTLE_ORIGINAL' && orders.has(key.replace(':QUICK_SETTLE_ORIGINAL', ':NORMAL_SETTLE_ORIGINAL'))) continue;
    const g = groups.get(o.id) || { id: o.id, name: o.name, date: o.date, fee: 0, basis: 0, samples: 0 };
    g.fee += o.fee; g.basis += Math.max(...o.bases.values()); g.samples++;
    if (o.date > g.date) { g.date = o.date; g.name = o.name; }
    groups.set(o.id, g);
  }
  return [...groups.values()].filter(g => g.basis > 0 && g.fee <= g.basis).map(g => ({ id: g.id, name: g.name, sku: '', rate: roundRate(g.fee / g.basis * 100), samples: g.samples, basisDate: g.date, source: '네이버 정산 실부과액 / 수수료 기준금액' }));
}

export function coupangFeeRecords(rows: Row[]): FeeRecord[] {
  const records = new Map<string, FeeRecord>();
  for (const r of rows) {
    if (r.saleType !== 'SALE') continue;
    for (const item of list(r.items)) {
      const id = text(item.vendorItemId), base = number(item.serviceFeeRatio), extra = number(item.couranteeFeeRatio) ?? 0;
      if (!id || base === null || base < 0 || extra < 0 || base + extra > 90.909) continue;
      // Coupang reports the nominal service rate excluding VAT. The calculator
      // deducts the VAT-inclusive platform cost, including Courantee when present.
      const rate = roundRate((base + extra) * 1.1), date = text(r.recognitionDate), prior = records.get(id);
      if (prior && prior.basisDate > date) continue;
      if (prior && prior.basisDate === date && prior.rate !== rate) {
        throw new ProviderError('같은 상품·날짜에 서로 다른 쿠팡 수수료율이 있습니다. 조회 기간을 좁혀주세요.');
      }
      records.set(id, { id, name: text(item.vendorItemName) || text(item.productName), sku: text(item.externalSellerSkuCode), rate, samples: (prior?.samples || 0) + 1, basisDate: date, source: `쿠팡 API 요율 ${base}%${extra ? ` + 쿠런티 ${extra}%` : ''} · 수수료 VAT 포함` });
    }
  }
  return [...records.values()];
}

export function coupangAuthorization(path: string, query: string, credentials: ApiCredentials, now = new Date()) {
  const signedDate = now.toISOString().slice(2, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
  const signature = createHmac('sha256', credentials.secretKey!).update(signedDate + 'GET' + path + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${credentials.accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

async function jsonRequest(url: string, options: RequestInit, platform: FeePlatform, deadline: number): Promise<Row> {
  const remaining = deadline - Date.now();
  if (remaining < 100) throw new ProviderError('조회 시간이 초과되었습니다. 기간을 좁혀 다시 조회해주세요.');
  let response: Response;
  try { response = await fetch(url, { ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.min(10000, remaining)) }); }
  catch { throw new ProviderError('API 서버에 연결하지 못했습니다. IP 허용 설정과 연결 상태를 확인해주세요.'); }
  if (!response.ok) {
    // Only expose documented error categories; provider bodies can contain credentials.
    let code = '', message = '';
    const reader = response.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); break; } chunks.push(value); }
      try { const body = row(JSON.parse(Buffer.concat(chunks).toString('utf8'))); code = text(body.code); message = text(body.message); } catch { /* no raw response is returned */ }
    }
    const name = platform === 'coupang' ? '쿠팡' : '네이버';
    if (code === 'GW.IP_NOT_ALLOWED' || /ip.*(allow|register|white)|whitelist|not allowed.*ip/i.test(message)) throw new ProviderError(name + '에서 운영 서버 IP를 허용하지 않았습니다. API 설정의 허용 IP를 확인해주세요(HTTP ' + response.status + ').');
    if (code === 'GW.AUTHN') throw new ProviderError('네이버 인증을 거절했습니다(GW.AUTHN). 커머스API 키와 애플리케이션 연결을 확인해주세요.');
    if (code === 'GW.AUTHZ') throw new ProviderError('네이버 API 조회 권한이 없습니다(GW.AUTHZ). 애플리케이션의 정산 API 권한을 확인해주세요.');
    if (/signature/i.test(message)) throw new ProviderError('쿠팡 인증 서명이 거절되었습니다. Access Key와 Secret Key의 짝 및 유효기간을 확인해주세요.');
    if (response.status === 401 || response.status === 403) throw new ProviderError('API 인증 또는 접근 권한이 거절되었습니다. 키·판매자 ID·API 권한·허용 IP를 확인해주세요.');
    if (response.status === 429) throw new ProviderError('API 요청 한도를 초과했습니다. 잠시 후 다시 조회해주세요.');
    throw new ProviderError(`${platform === 'coupang' ? '쿠팡' : '네이버'} API 조회에 실패했습니다(HTTP ${response.status}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('API 응답이 비어 있습니다.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 8000000) { await reader.cancel(); throw new ProviderError('API 응답이 너무 큽니다. 조회 기간을 좁혀주세요.'); }
    chunks.push(value);
  }
  try { return row(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new ProviderError('API 응답 형식을 확인하지 못했습니다.'); }
}

export async function collectFees(platform: FeePlatform, credentials: ApiCredentials, from: string, to: string): Promise<FeeRecord[]> {
  const deadline = Date.now() + 45000;
  if (platform === 'coupang') {
    const path = '/v2/providers/openapi/apis/api/v1/revenue-history', all: Row[] = [];
    let token = ''; const seen = new Set<string>();
    for (let page = 0; page < 40; page++) {
      const query = new URLSearchParams({ vendorId: credentials.vendorId!, recognitionDateFrom: from, recognitionDateTo: to, token, maxPerPage: '50' }).toString();
      const body = await jsonRequest('https://api-gateway.coupang.com' + path + '?' + query, { headers: { Authorization: coupangAuthorization(path, query, credentials), 'Content-Type': 'application/json' } }, platform, deadline);
      if (body.code !== 200 || !Array.isArray(body.data) || typeof body.hasNext !== 'boolean') throw new ProviderError('쿠팡 API가 정상적인 매출내역을 반환하지 않았습니다. 판매자 ID와 API 권한을 확인해주세요.');
      all.push(...list(body.data));
      if (!body.hasNext) return coupangFeeRecords(all);
      token = typeof body.nextToken === 'string' && body.nextToken.length <= 4096 ? body.nextToken : ''; if (!token || seen.has(token)) break; seen.add(token);
    }
    throw new ProviderError('매출내역이 많거나 페이지 정보가 올바르지 않습니다. 조회 기간을 좁혀주세요.');
  }
  const timestamp = Date.now();
  const signed = Buffer.from(await hash(credentials.clientId + '_' + timestamp, credentials.clientSecret!)).toString('base64');
  const auth = await jsonRequest('https://api.commerce.naver.com/external/v1/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: credentials.clientId!, timestamp: String(timestamp), client_secret_sign: signed, grant_type: 'client_credentials', type: 'SELF' }) }, platform, deadline);
  if (typeof auth.access_token !== 'string' || !auth.access_token) throw new ProviderError('네이버 인증 토큰을 발급받지 못했습니다. 커머스API 키를 확인해주세요.');
  const all: Row[] = []; let requests = 0;
  for (let date = from; date <= to; date = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    for (let page = 1; ; page++) {
      if (++requests > 40) throw new ProviderError('정산내역이 많습니다. 조회 기간을 좁혀주세요.');
      await new Promise(resolve => setTimeout(resolve, 1100));
      const query = new URLSearchParams({ searchDate: date, periodType: 'SETTLE_CASEBYCASE_SETTLE_BASIS_DATE', pageNumber: String(page), pageSize: '1000' });
      const body = await jsonRequest('https://api.commerce.naver.com/external/v1/pay-settle/settle/commission-details?' + query, { headers: { Authorization: 'Bearer ' + auth.access_token } }, platform, deadline);
      const pagination = row(body.pagination), pages = number(pagination.totalPages);
      if (!Array.isArray(body.elements) || pages === null || !Number.isSafeInteger(pages) || pages < 0) throw new ProviderError('네이버 API가 정상적인 수수료 내역을 반환하지 않았습니다. 정산 API 권한을 확인해주세요.');
      all.push(...list(body.elements));
      if (page >= pages) break;
    }
  }
  return naverFeeRecords(all);
}

