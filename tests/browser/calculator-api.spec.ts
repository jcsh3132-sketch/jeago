import { test, expect } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loginForTest, assignTestAdministrator } from './auth-helper';

test('company API settings replace dark mode, hide secrets, and share automatic product rates on mobile', async ({ page, request }) => {
  const origin = { Origin: 'http://127.0.0.1:3100' };
  expect((await request.get('/api/calculator/connections')).status()).toBe(401);
  const admin = await loginForTest(page.request);
  const member = await loginForTest(request);
  expect((await request.post('/api/calculator/connections', { headers: origin, data: { action: 'save', platform: 'coupang', revision: 0 } })).status()).toBe(403);
  assignTestAdministrator(admin.username);
  await page.goto('/calculator');
  const frame = page.frameLocator('iframe[title="판매·임대 계산기"]');
  await expect(frame.locator('#modelLookupStatus')).toContainText('연결 완료');
  await expect(frame.getByRole('button', { name: /다크모드|라이트모드/ })).toHaveCount(0);
  await frame.getByRole('button', { name: 'API 연결 설정' }).click();
  const cp = frame.locator('[data-api-platform="coupang"]');
  await expect(cp.getByRole('button', { name: '저장하고 연결 확인' })).toBeVisible();
  await page.screenshot({ path: 'work/calculator-api-admin-desktop.png', fullPage: true });
  const saved = await page.request.post('/api/calculator/connections', { headers: origin, data: { action: 'save', platform: 'coupang', revision: 0, accessKey: 'browser-access', secretKey: 'browser-private-secret', vendorId: 'A00012345' } });
  expect(saved.ok()).toBe(true);
  expect(await saved.text()).not.toContain('browser-private-secret');
  // Populate only the disposable DB with a verified API snapshot. No provider
  // requests or production writes are performed by this browser test.
  const file = readdirSync('work').filter(name => /^browser-[a-f0-9-]+\.db$/.test(name)).map(name => join('work', name)).sort((a,b) => statSync(b).birthtimeMs - statSync(a).birthtimeMs)[0];
  const db = new DatabaseSync(file);
  try {
    const row = db.prepare('SELECT credentials FROM calculator_api_connection WHERE platform=?').get('coupang')!;
    expect(String(row.credentials)).not.toContain('browser-private-secret');
    const fees = [{ id: '123', name: '삼성 SL-J1685 프린터', sku: 'SL-J1685', rate: 11.99, samples: 3, basisDate: '2026-09-29', source: '쿠팡 API 요율 10.9% · 수수료 VAT 포함' }];
    db.prepare('UPDATE calculator_api_connection SET fees=?,synced_at=?,attempted_at=?,range_from=?,range_to=? WHERE platform=?').run(JSON.stringify(fees), Date.now(), Date.now(), '2026-09-23', '2026-09-29', 'coupang');
  } finally { db.close(); }
  await frame.getByRole('button', { name: 'API 설정 닫기' }).click();
  await page.reload();
  await frame.locator('[data-store="coupang"]').click();
  await frame.locator('#modelName').fill('SL-J1685');
  await frame.locator('#modelName').press('Escape');
  await frame.locator('#modelName').press('Tab');
  await expect(frame.locator('#feeRate')).toHaveValue('11.99');
  await expect(frame.locator('#feeRate')).toHaveAttribute('readonly', '');
  await frame.locator('#salePrice').fill('100000');
  await expect(frame.locator('#feeResult')).toHaveText('11,990원');
  await frame.locator('#apiFeeMode').selectOption('manual');
  await frame.locator('#feeRate').fill('8');
  await expect(frame.locator('#feeResult')).toHaveText('8,000원');
  await frame.locator('#apiFeeMode').selectOption('auto');
  await expect(frame.locator('#feeResult')).toHaveText('11,990원');
  await frame.locator('#modelName').fill('SL-T1685W');
  await frame.locator('#modelName').press('Escape');
  await expect(frame.locator('#apiFeeStatus')).toContainText('이 모델의 조회 수수료가 없습니다');
  await expect(frame.locator('#feeRate')).toHaveValue('8');
  await frame.locator('#apiFeeProduct').selectOption('123');
  await expect(frame.locator('#feeRate')).toHaveValue('11.99');
  await frame.locator('#modelName').fill('SL-J1685W');
  await expect(frame.locator('#apiFeeStatus')).toContainText('이 모델의 조회 수수료가 없습니다');
  await frame.locator('#modelName').press('Escape');
  await frame.getByRole('button', { name: 'API 연결 설정' }).click();
  await expect(cp.locator('input[name="secretKey"]')).toHaveValue('');
  await frame.getByRole('button', { name: 'API 설정 닫기' }).click();
  // Same company snapshot is returned to a different employee, without keys.
  const state = await (await request.get('/api/calculator/connections')).json();
  expect(state.canManage).toBe(false); expect(state.platforms[1].fees[0].rate).toBe(11.99);
  expect(JSON.stringify(state)).not.toContain('browser-access');
  await page.request.post('/api/auth/login', { headers: origin, data: member });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.getByRole('button', { name: 'API 연결 설정' }).click();
  await expect(cp.getByRole('button', { name: '저장하고 연결 확인' })).toBeHidden();
  await expect(frame.locator('#apiAdminNotice')).toContainText('관리자가 등록');
  await page.screenshot({ path: 'work/calculator-api-mobile.png', fullPage: true });
  expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect((await request.post('/api/calculator/connections', { headers: { Origin: 'https://example.com' }, data: { action: 'refresh', platform: 'coupang' } })).status()).toBe(403);
  await page.request.post('/api/auth/login', { headers: origin, data: admin });
  expect((await page.request.post('/api/calculator/connections', { headers: origin, data: { action: 'disconnect', platform: 'coupang', revision: 1 } })).ok()).toBe(true);
});
