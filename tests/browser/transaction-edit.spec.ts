import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginForTest } from './auth-helper';

test('another ordinary employee edits history with stock correction and safe response retry',async({page,request})=>{
  const creator=await loginForTest(page.request);
  const suffix=randomUUID().slice(0,8);
  const ids:string[]=[];
  for(const [name,quantity] of [[`수정원본-${suffix}`,'10'],[`수정대상-${suffix}`,'7']]){
    await page.goto('/add');
    await page.getByLabel('모델명',{exact:true}).fill(name);
    await page.getByLabel('품목 카테고리').selectOption({index:1});
    await page.getByRole('button',{name:'모델 등록',exact:true}).click();
    await expect(page).toHaveURL(/item=\d+/);
    const id=new URL(page.url()).searchParams.get('item')!;ids.push(id);
    await page.goto(`/inbound/${id}`);
    await page.getByLabel('입고 수량').fill(quantity);
    await page.getByRole('button',{name:'입고 처리',exact:true}).click();
    await expect(page).toHaveURL(/item=\d+/);
  }
  const [sourceId,targetId]=ids;
  await page.goto(`/outbound/${sourceId}`);
  await page.getByLabel('출고 수량').fill('4');
  await page.getByRole('combobox',{name:'출고업체',exact:true}).fill(`원래 업체-${suffix}`);
  await page.getByRole('button',{name:'출고 처리',exact:true}).click();
  await expect(page).toHaveURL(/item=\d+/);
  const editor=await loginForTest(page.request);
  expect(editor.username).not.toBe(creator.username);
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  await page.goto(`/transactions?q=${suffix}&type=출고`);
  const row=page.locator('.history-table tbody tr');
  await expect(row).toHaveCount(1);
  await row.getByRole('link',{name:'수정',exact:true}).click();
  await expect(page).toHaveURL(/\/transactions\/\d+\/edit$/);
  const editUrl=page.url();
  expect((await request.post('/api/inventory',{headers:{Origin:'http://127.0.0.1:3100'},data:{action:'transaction.edit',request_id:randomUUID()}})).status()).toBe(401);
  await page.getByRole('combobox',{name:'모델',exact:true}).selectOption(targetId);
  await page.getByLabel('수량',{exact:true}).fill('2');
  await page.getByLabel('처리일시 (한국시간)',{exact:true}).fill('2026-10-01T00:30');
  await page.getByRole('combobox',{name:'출고업체',exact:true}).fill(`정정 업체-${suffix}`);
  await page.getByLabel('담당자',{exact:true}).fill('기존 담당자 정정');
  await expect(page.locator('.transaction-stock-preview')).toContainText('6개 → 10개');
  await expect(page.locator('.transaction-stock-preview')).toContainText('7개 → 5개');
  await page.screenshot({path:'work/transaction-edit-desktop.png',fullPage:true});
  await page.route('**/api/inventory',async route=>{
    const response=await route.fetch();expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await page.getByRole('button',{name:'수정 저장',exact:true}).click();
  await expect(page.getByRole('button',{name:'저장 결과 확인'})).toBeVisible();
  await page.unroute('**/api/inventory');
  await page.reload();
  await expect(page.getByRole('button',{name:'저장 결과 확인'})).toBeVisible();
  await page.getByRole('button',{name:'저장 결과 확인'}).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.goto(`/transactions?q=${suffix}&type=출고`);
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-label="모델명"]')).toContainText(`수정대상-${suffix}`);
  await expect(row.locator('[data-label="수량"]')).toHaveText('2');
  await expect(row.locator('[data-label="담당자"]')).toHaveText('기존 담당자 정정');
  await expect(row.locator('[data-label="처리일시"]')).toHaveText('2026-10-01 00:30');
  for(const [id,quantity] of [[sourceId,'10'],[targetId,'5']]){
    await page.goto(`/?item=${id}`);await expect(page.locator(`#item-${id} .qty-value`)).toHaveText(quantity);
  }
  await page.goto(editUrl);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('combobox',{name:'입출고 유형',exact:true}).selectOption('입고');
  await page.getByLabel('수량',{exact:true}).fill('3');
  await expect(page.getByRole('combobox',{name:'출고업체',exact:true})).toHaveCount(0);
  await expect(page.locator('.transaction-stock-preview')).toContainText('5개 → 10개');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:'work/transaction-edit-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'수정 저장',exact:true}).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.goto(`/?item=${targetId}`);await expect(page.locator(`#item-${targetId} .qty-value`)).toHaveText('10');
  // Stock changed by another request while this form was open must not be overwritten.
  await page.goto(editUrl);
  await page.getByLabel('수량',{exact:true}).fill('2');
  const expected=await page.locator('input[name="expected_item_version"]').inputValue();
  expect((await page.request.post('/api/inventory',{headers:{Origin:'http://127.0.0.1:3100'},data:{action:'stock.in',id:targetId,quantity:1,expected_version:expected,request_id:randomUUID()}})).status()).toBe(200);
  await page.getByRole('button',{name:'수정 저장',exact:true}).click();
  await expect(page.locator('.form-status[role="alert"]')).toContainText('다른 사용자가 변경');
  await page.getByRole('button',{name:'최신 내용 불러오기'}).click();
  await expect(page.getByLabel('수량',{exact:true})).toHaveValue('3');
  await page.goto(`/?item=${targetId}`);await expect(page.locator(`#item-${targetId} .qty-value`)).toHaveText('11');
});
