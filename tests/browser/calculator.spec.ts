import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginForTest } from './auth-helper';

test('calculator requires login, preserves sales/rental calculations, and works on desktop/mobile', async ({ page, request }) => {
  for (const asset of ['index', 'style', 'script', 'sale-products', 'rent-products']) {
    expect((await request.get(`/calculator/content/${asset}`)).status()).toBe(401);
  }
  await page.goto('/calculator');
  await expect(page).toHaveURL(/\/$/);
  await loginForTest(page.request);
  for (const action of ['trash.restore', 'trash.purge', 'trash.empty']) {
    expect((await page.request.post('/api/inventory', { headers: { Origin: 'http://127.0.0.1:3100' }, data: { action, request_id: randomUUID(), is_admin: true } })).status()).toBe(403);
  }
  await page.goto('/trash');
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('navigation', { name: '관리자 메뉴' })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/calculator');
  const nav = page.getByRole('navigation', { name: '주 메뉴', exact: true });
  await expect(nav.getByRole('link', { name: '판매·임대 계산' })).toBeVisible();
  await expect(nav.getByRole('link', { name: '휴지통' })).toHaveCount(0);
  const frame = page.frameLocator('iframe[title="판매·임대 계산기"]');
  await expect(frame.locator('#modelLookupStatus')).toContainText('연결 완료');
  const saleResponse = await page.request.get('/calculator/content/sale-products');
  expect(saleResponse.headers()['cache-control']).toContain('no-store');
  const sale = await saleResponse.json();
  expect([sale.printerCount, sale.consumableCount, sale.filterCount]).toEqual([88, 151, 14]);
  expect(sale.priceUpdate.label).toBe('2026년 9월');
  const product = sale.products.find((p: { kind: string; status: string; productCost: number }) => p.kind === 'printer' && p.status === 'ok' && p.productCost > 0);
  await frame.locator('#modelName').fill(product.model);
  await frame.locator('#modelName').press('Tab');
  await expect(frame.locator('#productCost')).toHaveValue(product.productCost.toLocaleString('ko-KR'));
  await frame.locator('#salePrice').fill('1000000');
  await frame.locator('#shippingCost').fill('3000');
  for (const [store, rate] of [['smartstore', 3.5], ['coupang', 10], ['gmarket', 13], ['eleven', 12], ['school', 5]] as const) {
    await frame.locator(`[data-store="${store}"]`).click();
    await expect(frame.locator('#feeResult')).toHaveText((1000000 * rate / 100).toLocaleString('ko-KR') + '원');
    await expect(frame.locator('#marginResult')).toHaveText((1000000 - 1000000 * rate / 100 - 3000 - product.productCost).toLocaleString('ko-KR') + '원');
  }
  await frame.getByRole('button', { name: '가격표', exact: true }).click();
  await expect(frame.getByRole('dialog')).toBeVisible();
  await frame.getByRole('tab', { name: '소모품', exact: true }).click();
  await expect(frame.locator('#consumablePriceTable tbody tr')).toHaveCount(151);
  await frame.getByRole('tab', { name: '필터', exact: true }).click();
  await expect(frame.locator('#filterPriceTable tbody tr')).toHaveCount(14);
  await frame.getByRole('button', { name: '가격표 닫기' }).click();
  await page.screenshot({ path: 'work/calculator-desktop.png', fullPage: true });
  const rentals = await (await page.request.get('/calculator/content/rent-products')).json();
  expect(rentals.count).toBe(15);
  const rental = rentals.products.find((p: { machineType: string }) => p.machineType === 'color');
  await frame.locator('[data-page="rent"]').click();
  await expect(frame.locator('#rentModelLookupStatus')).toContainText('연결 완료');
  await frame.locator('#rentModelName').fill(rental.model);
  await frame.locator('#rentModelDropdown').getByRole('option').filter({ hasText: rental.model }).first().click();
  await frame.locator('#rentYears').selectOption('2');
  await frame.getByRole('radio', { name: '중고', exact: true }).check();
  await frame.locator('#faxKit').check();
  await frame.locator('#blackCopies').fill('1000');
  await frame.locator('#colorCopies').fill('100');
  await frame.locator('#rentCalcBtn').click();
  const monthly = rental.baseRent - rental.usedDiscount + 10000 + 5000 + 1000 * rental.blackRate + 100 * rental.colorRate;
  await expect(frame.locator('#rentMonthlyTotal')).toHaveText(monthly.toLocaleString('ko-KR') + '원');
  await expect(frame.locator('#rentContractTotal')).toHaveText((monthly * 24).toLocaleString('ko-KR') + '원');
  await expect(frame.locator('#rentDepositResult')).toHaveText('300,000원');
  await page.reload();
  await expect(frame.locator('.history-model-load')).toHaveText(rental.model);
  await frame.locator('.history-model-load').click();
  await expect(frame.locator('#rentMonthlyTotal')).toHaveText(monthly.toLocaleString('ko-KR') + '원');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '모바일 메뉴' }).getByRole('link', { name: '판매·임대 계산' })).toBeVisible();
  await page.screenshot({ path: 'work/calculator-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await loginForTest(page.request);
  await page.reload();
  await frame.locator('[data-page="rent"]').click();
  await expect(frame.locator('.history-model-load')).toHaveCount(0);
});
