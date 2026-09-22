import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { loginForTest } from './auth-helper';
test('mobile batch outbound selects two models and sends each once', async ({ page }) => {
  await loginForTest(page.request);
  const db = new DatabaseSync('instance/inventory-next.db', { readOnly: true });
  const category = String(db.prepare('SELECT category FROM item LIMIT 1').get()!.category); db.close();
  const ids: number[] = [];
  for (const name of ['묶음테스트 검정', '묶음테스트 파랑']) {
    const post = async (fields: Record<string, unknown>) => {
      const r = await page.request.post('/api/inventory', { headers: { Origin: 'http://127.0.0.1:3100' }, data: { ...fields, request_id: randomUUID() } });
      expect(r.ok(), await r.text()).toBe(true); return r.json();
    };
    const result = await post({ action: 'item.add', name, category });
    const id = Number(new URL(result.redirect, 'http://localhost').searchParams.get('item')); ids.push(id);
    await post({ action: 'stock.in', id, quantity: 3, expected_version: 0 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('link', { name: '묶음 출고', exact: true }).click();
  await page.getByLabel('모델·카테고리 검색').fill('묶음테스트');
  for (const name of ['묶음테스트 검정', '묶음테스트 파랑']) {
    await page.getByRole('checkbox', { name: `${name} 선택` }).check();
    await expect(page.getByLabel(`${name} 출고 수량`)).toHaveValue('1');
  }
  await page.getByRole('combobox', { name: '출고업체' }).fill('묶음테스트거래처');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'work/batch-outbound-mobile.png', fullPage: true });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '선택 모델 출고' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  for (const id of ids) {
    await page.goto(`/outbound/${id}`);
    await expect(page.getByText(/현재 재고/)).toContainText('2개');
  }
});
