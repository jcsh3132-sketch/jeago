import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('lost responses can be recovered after reload; stale edits and trash work on mobile', async ({ page, request }) => {
  await page.goto('/add');
  await page.getByLabel('모델명', { exact: true }).fill('E2E-복구검증');
  await page.getByLabel('품목 카테고리').selectOption({ index: 1 });
  await page.getByRole('button', { name: '모델 등록', exact: true }).click();
  await expect(page).toHaveURL(/item=\d+/);
  const id = new URL(page.url()).searchParams.get('item')!;
  await page.goto(`/inbound/${id}`);
  await page.getByLabel('입고 수량').fill('3');
  let delivered = false;
  await page.route('**/api/inventory', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    delivered = true;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '입고 처리', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장 결과 확인' })).toBeVisible();
  expect(delivered).toBe(true);
  await page.unroute('**/api/inventory');
  await page.reload();
  await expect(page.getByRole('button', { name: '저장 결과 확인' })).toBeVisible();
  await expect(page.getByLabel('입고 수량')).toBeDisabled();
  await page.getByRole('button', { name: '저장 결과 확인' }).click();
  await expect(page).toHaveURL(/item=\d+/);
  await expect(page.locator(`#item-${id} .qty-value`)).toHaveText('3');
  await page.goto(`/history/${id}`);
  await expect(page.locator('.history-table tbody tr')).toHaveCount(1);

  await page.goto(`/inbound/${id}`);
  const version = await page.locator('input[name="expected_version"]').inputValue();
  await page.getByLabel('입고 수량').fill('2');
  const other = await request.post('/api/inventory', { headers: { Origin: 'http://127.0.0.1:3100' }, data: { action: 'stock.in', id, quantity: '4', manager: '김채희', request_id: randomUUID(), expected_version: version } });
  expect(other.status()).toBe(200);
  await page.getByRole('button', { name: '입고 처리', exact: true }).click();
  await expect(page.locator('.form-status[role="alert"]')).toContainText('다른 사용자가 변경');
  await page.getByRole('button', { name: '최신 내용 불러오기' }).click();
  await expect(page.locator('input[name="expected_version"]')).toHaveValue(String(Number(version) + 1));

  await page.goto(`/?item=${id}`);
  await expect(page.locator(`#item-${id} .qty-value`)).toHaveText('7');
  const latest = Number(version) + 1;
  expect((await request.post('/api/inventory', { headers: { Origin: 'http://127.0.0.1:3100' }, data: { action: 'stock.in', id, quantity: '1', manager: '김채희', request_id: randomUUID(), expected_version: latest } })).status()).toBe(200);
  // No navigation or reload: another user's stock change appears on the periodic refresh.
  await expect(page.locator(`#item-${id} .qty-value`)).toHaveText('8', { timeout: 20000 });
  page.on('dialog', dialog => dialog.accept());
  await page.locator(`#item-${id}`).getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.locator(`#item-${id}`)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trash');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const entry = page.locator('.trash-entry').filter({ hasText: 'E2E-복구검증' });
  await expect(entry).toBeVisible();
  await page.screenshot({ path: 'work/trash-mobile.png', fullPage: true });
  await entry.getByRole('button', { name: '복구', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await page.goto(`/history/${id}`);
  await expect(page.locator('.history-table tbody tr')).toHaveCount(3);
  await page.goto(`/?item=${id}`);
  await expect(page.locator(`#item-${id} .qty-value`)).toHaveText('8');
});
