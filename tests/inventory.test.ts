import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from '../src/lib/db';
import { loadInventory, mutate, InputError } from '../src/lib/inventory';

const scratch = resolve('work');
mkdirSync(scratch, { recursive: true });
const dir = mkdtempSync(join(scratch, 'test-db-'));
process.env.DATABASE_URL = pathToFileURL(join(dir, 'test.db')).href;
process.env.JEAGO_TEST_MODE = '1';
process.env.JEAGO_TEST_DATABASE_URL = process.env.DATABASE_URL;
// Keep the isolated test DB in ignored work/ for debugging; never touch operational DBs.
after(async () => { (await getDb()).close(); });
test('inventory lifecycle, rollback, validation, concurrency, and hierarchy', async t => {
  let mainId = 0, deviceId = 0, leafId = 0, itemId = 0, key = '';
  const manager = '김채희';
  await t.test('creates hierarchy and zero-stock model', async () => {
    const initial = await loadInventory();
    assert.equal(initial.categories.length, 5);
    mainId = initial.categories[0].id;
    await mutate({ action: 'category.add', level: '1', parent_id: mainId, name: '테스트 장비' });
    deviceId = (await loadInventory()).categories.find(c => c.display_name === '테스트 장비')!.id;
    await mutate({ action: 'category.add', level: 2, parent_id: deviceId, name: '토너' });
    const leaf = (await loadInventory()).categories.find(c => c.display_name === '토너')!;
    leafId = leaf.id; key = leaf.name;
    await mutate({ action: 'item.add', name: 'T-100', manager, category: key });
    const item = (await loadInventory()).items[0]; itemId = item.id;
    assert.equal(item.quantity, 0); assert.equal(item.low_stock_threshold, 5);
  });
  await t.test('validates inputs, leaves and duplicate siblings', async () => {
    for (const quantity of ['-1', '0', '1.5', '', '1e2', 'NaN', true, 2147483648]) await assert.rejects(mutate({ action: 'stock.in', id: itemId, quantity, manager }), InputError);
    await assert.rejects(mutate({ action: 'item.add', name: 'bad', manager, category: 'not-found' }), InputError);
    await assert.rejects(mutate({ action: 'item.add', name: ' ', manager, category: key }), InputError);
    await assert.rejects(mutate({ action: 'item.add', name: 'bad', manager: 'invalid', category: key }), InputError);
    await assert.rejects(mutate({ action: 'category.add', level: 2, parent_id: mainId, name: '잘못된 계층' }), InputError);
    await assert.rejects(mutate({ action: 'category.add', level: 2, parent_id: deviceId, name: '토너' }), InputError);
    assert.equal((await loadInventory()).transactions.length, 0);
  });
  await t.test('records inbound and rejects excess/missing-customer outbound without partial changes', async () => {
    await mutate({ action: 'stock.in', id: itemId, quantity: 10, manager });
    await assert.rejects(mutate({ action: 'stock.out', id: itemId, quantity: 11, manager, customer_name: '업체 A' }), InputError);
    await assert.rejects(mutate({ action: 'stock.out', id: itemId, quantity: 2, manager, customer_name: '' }), InputError);
    const snapshot = await loadInventory();
    assert.equal(snapshot.items[0].quantity, 10); assert.equal(snapshot.transactions.length, 1);
  });
  await t.test('concurrent outbound never oversells', async () => {
    const results = await Promise.allSettled([1, 2].map(() => mutate({ action: 'stock.out', id: itemId, quantity: 7, manager, customer_name: '업체 A' })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const snapshot = await loadInventory(); assert.equal(snapshot.items[0].quantity, 3); assert.equal(snapshot.transactions.length, 2);
    assert.equal(snapshot.transactions[1].customer_name, '업체 A');
  });
  await t.test('threshold boundaries and model edits preserve stock', async () => {
    for (const threshold of [0, 999]) { await mutate({ action: 'item.threshold', id: itemId, threshold }); assert.equal((await loadInventory()).items[0].low_stock_threshold, threshold); }
    await assert.rejects(mutate({ action: 'item.threshold', id: itemId, threshold: 1000 }), InputError);
    await mutate({ action: 'item.edit', id: itemId, name: 'T-100 수정', manager, category: key });
    assert.equal((await loadInventory()).items[0].quantity, 3);
  });
  await t.test('partner CRUD and outgoing history snapshot', async () => {
    await mutate({ action: 'partner.add', name: '업체 A', contact_person: '담당자', phone: '010', note: '메모' });
    const id = (await loadInventory()).partners[0].id;
    await mutate({ action: 'partner.edit', id, name: '업체 B', contact_person: '', phone: '', note: '' });
    assert.equal((await loadInventory()).partners[0].name, '업체 B');
    await mutate({ action: 'partner.delete', id });
    const data = await loadInventory(); assert.equal(data.partners.length, 0); assert.equal(data.transactions[1].customer_name, '업체 A');
  });
  await t.test('moves devices and leaves, changes item category, blocks cycles and occupied root deletion', async () => {
    const data = await loadInventory(), target = data.categories.find(c => c.parent_id === null && c.id !== mainId)!;
    await assert.rejects(mutate({ action: 'category.delete', id: mainId }), InputError);
    await assert.rejects(mutate({ action: 'category.move', id: deviceId, parent_id: leafId }), InputError);
    await mutate({ action: 'category.move', id: deviceId, parent_id: target.id });
    await mutate({ action: 'category.rename', id: leafId, name: '정품 토너' });
    await mutate({ action: 'category.add', level: 1, parent_id: mainId, name: '다른 장비' });
    const other = (await loadInventory()).categories.find(c => c.display_name === '다른 장비')!;
    await mutate({ action: 'category.move', id: leafId, parent_id: other.id });
    await mutate({ action: 'category.add', level: 2, parent_id: other.id, name: '드럼' });
    const drum = (await loadInventory()).categories.find(c => c.display_name === '드럼')!;
    await mutate({ action: 'item.category', id: itemId, category: drum.name });
    assert.equal((await loadInventory()).items[0].category, drum.name);
    await mutate({ action: 'item.category', id: itemId, category: key });
    await mutate({ action: 'category.move', id: leafId, parent_id: deviceId });
    const current = await loadInventory();
    assert.equal(current.categories.find(c => c.id === deviceId)!.parent_id, target.id);
    assert.equal(current.items[0].category, key);
  });
  await t.test('cascade deletion removes only the selected branch and its history', async () => {
    await mutate({ action: 'category.delete', id: deviceId });
    const data = await loadInventory(); assert.equal(data.items.length, 0); assert.equal(data.transactions.length, 0);
    assert(!data.categories.some(c => c.id === leafId)); assert(data.categories.some(c => c.id === mainId));
    await assert.rejects(mutate({ action: 'anything' }), InputError);
    await assert.rejects(mutate({ action: 'item.delete', id: itemId }), InputError);
  });
});
