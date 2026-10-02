import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from '../src/lib/db';
import { AuthError, register, createSession } from '../src/lib/auth';
import { encryptCredentials, decryptCredentials, calculatorApiState, saveCalculatorCredentials, refreshCalculatorFees, disconnectCalculator, dateRange } from '../src/lib/calculator-api';
import { collectFees, coupangAuthorization, naverFeeRecords, coupangFeeRecords } from '../src/lib/calculator-providers';
mkdirSync('work', { recursive: true });
process.env.JEAGO_TEST_MODE = '1';
process.env.JEAGO_TEST_DATABASE_URL = pathToFileURL(join(mkdtempSync(join(resolve('work'), 'calculator-api-test-')), 'test.db')).href;
process.env.CALCULATOR_API_ENCRYPTION_KEY = '1'.repeat(64);
const nativeFetch = globalThis.fetch;
after(async () => { globalThis.fetch = nativeFetch; (await getDb()).close(); });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('official signing, VAT, fee bases, original/refund filtering and credential encryption', async () => {
  const creds = { accessKey: 'test-access', secretKey: 'test-secret', vendorId: 'A00012345' };
  const encrypted = encryptCredentials('coupang', creds);
  assert(!encrypted.includes('test-secret'));
  assert.deepEqual(decryptCredentials('coupang', encrypted), creds);
  assert.notEqual(encryptCredentials('coupang', creds), encrypted);
  assert.throws(() => decryptCredentials('smartstore', encrypted), /키를 읽지/);
  const last = encrypted.at(-2)!;
  assert.throws(() => decryptCredentials('coupang', encrypted.slice(0,-2) + (last === 'A' ? 'B' : 'A') + encrypted.slice(-1)), /키를 읽지/);
  const path = '/v2/providers/openapi/apis/api/v1/revenue-history', query = 'vendorId=A00012345&token=';
  const signature = createHmac('sha256', 'test-secret').update('260930T001234ZGET' + path + query).digest('hex');
  assert.equal(coupangAuthorization(path, query, creds, new Date('2026-09-30T00:12:34Z')), `CEA algorithm=HmacSHA256, access-key=test-access, signed-date=260930T001234Z, signature=${signature}`);
  const base = { productId: 'p1', productOrderId: 'o1', productOrderType: 'PROD_ORDER', productName: 'SL-J1685', settleType: 'NORMAL_SETTLE_ORIGINAL', settleBasisDate: '2026-09-29' };
  const rates = naverFeeRecords([
    { ...base, commissionType: 'PAY_COMMISSION', commissionBasisAmount: 60000, commissionAmount: 1200 },
    { ...base, commissionType: 'PAY_COMMISSION', commissionBasisAmount: 40000, commissionAmount: 800 },
    { ...base, commissionType: 'PLATFORM_COMMISSION', commissionBasisAmount: 100000, commissionAmount: 3000 },
    { ...base, settleType: 'NORMAL_SETTLE_AFTER_CANCEL', commissionType: 'PAY_COMMISSION', commissionBasisAmount: 100000, commissionAmount: 5000 },
    { ...base, settleType: 'QUICK_SETTLE_ORIGINAL', commissionType: 'PAY_COMMISSION', commissionBasisAmount: 100000, commissionAmount: 5000 },
    { ...base, productOrderType: 'DELIVERY', commissionType: 'PAY_COMMISSION', commissionBasisAmount: 100000, commissionAmount: 5000 },
  ]);
  assert.equal(rates.length, 1); assert.equal(rates[0].rate, 5); assert.equal(rates[0].samples, 1);
  const sale = { saleType: 'SALE', recognitionDate: '2026-09-29', items: [{ vendorItemId: 123, vendorItemName: 'SL-J1685', serviceFeeRatio: 10.9, couranteeFeeRatio: 0, externalSellerSkuCode: 'SL-J1685' }] };
  assert.equal(coupangFeeRecords([sale, { ...sale, saleType: 'REFUND' }])[0].rate, 11.99);
  assert.equal(coupangFeeRecords([{ ...sale, items: [{ vendorItemId: 123, serviceFeeRatio: 10, couranteeFeeRatio: 1 }] }])[0].rate, 12.1);
  assert.throws(() => dateRange({ from: '2026-02-30', to: '2026-03-01' }), /날짜/);
  assert.throws(() => dateRange({ from: '2026-01-01', to: '2026-03-01' }), /31일/);
});

test('shared fees expose no secrets; admin-only changes, full pagination, failed refresh and concurrent key changes', async () => {
  const admin = await register({ username: 'fees-admin', display_name: '관리자', password: '1234', password_confirm: '1234' });
  const member = await register({ username: 'fees-member', display_name: '직원', password: '1234', password_confirm: '1234' });
  const adminToken = await createSession(admin.id, true), memberToken = await createSession(member.id, true), db = await getDb();
  await db.execute({ sql: 'INSERT INTO app_admin(singleton,user_id) VALUES (1,?)', args: [admin.id] });
  const credentials = { platform: 'coupang', revision: 0, accessKey: 'test-access', secretKey: 'test-secret', vendorId: 'A00012345' };
  await assert.rejects(calculatorApiState(undefined), error => error instanceof AuthError && error.status === 401);
  await assert.rejects(saveCalculatorCredentials(memberToken, credentials), error => error instanceof AuthError && error.status === 403);
  await saveCalculatorCredentials(adminToken, credentials);
  const stored = (await db.execute('SELECT credentials FROM calculator_api_connection')).rows[0];
  assert(!String(stored.credentials).includes('test-secret'));
  const state = await calculatorApiState(memberToken); assert.equal(state.canManage, false);
  assert(!JSON.stringify(state).includes('test-access')); assert(!JSON.stringify(state).includes('test-secret'));
  const calls: URL[] = [];
  globalThis.fetch = (async (url, init) => {
    const uri = new URL(String(url)); calls.push(uri);
    assert.equal(uri.hostname, 'api-gateway.coupang.com');
    assert.equal(init?.redirect, 'error');
    assert(String((init?.headers as Record<string,string>).Authorization).includes('signature='));
    const second = uri.searchParams.get('token') === 'page-2';
    return json({ code: 200, hasNext: !second, nextToken: second ? '' : 'page-2', data: [{ saleType: 'SALE', recognitionDate: '2026-09-29', purchaserName: 'PRIVATE BUYER', items: [{ vendorItemId: second ? 124 : 123, vendorItemName: second ? 'SL-T1685W' : 'SL-J1685', serviceFeeRatio: second ? 5 : 10.9 }] }] });
  }) as typeof fetch;
  await refreshCalculatorFees(memberToken, { platform: 'coupang', from: '2026-09-28', to: '2026-09-29' });
  assert.equal(calls.length, 2);
  const shared = await calculatorApiState(memberToken);
  assert.equal(shared.platforms[1].fees.length, 2); assert.equal(shared.platforms[1].fees[0].rate, 11.99);
  assert(!JSON.stringify(shared).includes('PRIVATE BUYER'));
  globalThis.fetch = (async () => new Response('test-secret PRIVATE BUYER', { status: 403 })) as typeof fetch;
  await assert.rejects(refreshCalculatorFees(memberToken, { platform: 'coupang' }), /인증 또는 접근 권한/);
  const afterFailure = await calculatorApiState(memberToken);
  assert.deepEqual(afterFailure.platforms[1].fees, shared.platforms[1].fees);
  assert.equal(afterFailure.platforms[1].syncedAt, shared.platforms[1].syncedAt);
  assert(!JSON.stringify(afterFailure).includes('test-secret'));
  await assert.rejects(saveCalculatorCredentials(adminToken, { ...credentials, revision: 0 }), error => error instanceof AuthError && error.status === 409);
  await assert.rejects(saveCalculatorCredentials(adminToken, { ...credentials, revision: 1, accessKey: 'new-access', secretKey: '' }), /시크릿도/);
  globalThis.fetch = (async () => {
    await saveCalculatorCredentials(adminToken, { ...credentials, revision: 1, secretKey: 'replacement-secret' });
    return json({ code: 200, hasNext: false, data: [{ saleType: 'SALE', recognitionDate: '2026-09-29', items: [{ vendorItemId: 123, serviceFeeRatio: 10 }] }] });
  }) as typeof fetch;
  await assert.rejects(refreshCalculatorFees(memberToken, { platform: 'coupang' }), error => error instanceof AuthError && error.status === 409);
  assert.equal((await calculatorApiState(memberToken)).platforms[1].fees.length, 0);
  await assert.rejects(disconnectCalculator(memberToken, { platform: 'coupang', revision: 2 }), error => error instanceof AuthError && error.status === 403);
  await disconnectCalculator(adminToken, { platform: 'coupang', revision: 2 });
  assert.equal((await calculatorApiState(memberToken)).platforms[1].configured, false);
  globalThis.fetch = nativeFetch;
});

test('Naver token signature matches official example and collects every settlement page', async () => {
  const nativeNow = Date.now;
  Date.now = () => 1643961623299;
  let pages = 0;
  try {
    globalThis.fetch = (async (url, init) => {
      const uri = new URL(String(url));
      assert.equal(uri.hostname, 'api.commerce.naver.com');
      if (uri.pathname.endsWith('/oauth2/token')) {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get('client_secret_sign'), 'JDJhJDEwJGFiY2RlZmdoaWprbG1ub3BxcnN0dXVCVldZSk42T0VPdEx1OFY0cDQxa2IuTnpVaUEzbmsy');
        assert.equal(body.get('type'), 'SELF'); assert(!body.has('client_secret'));
        return json({ access_token: 'server-only-token' });
      }
      pages++;
      return json({ pagination: { totalPages: 2 }, elements: [{ productId: String(pages), productOrderId: String(pages), productOrderType: 'PROD_ORDER', productName: 'SL-J1685', settleType: 'NORMAL_SETTLE_ORIGINAL', commissionType: 'PAY_COMMISSION', commissionBasisAmount: 10000, commissionAmount: 350, settleBasisDate: '2026-09-29' }] });
    }) as typeof fetch;
    const rates = await collectFees('smartstore', { clientId: 'aaaabbbbcccc', clientSecret: '$2a$10$abcdefghijklmnopqrstuv' }, '2026-09-29', '2026-09-29');
    assert.equal(pages, 2); assert.equal(rates.length, 2); assert.equal(rates[0].rate, 3.5);
  } finally { Date.now = nativeNow; globalThis.fetch = nativeFetch; }
});
