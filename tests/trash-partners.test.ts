import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from '../src/lib/db';
import { mutate, loadInventory, loadTrash, trashSnapshot, ConflictError } from '../src/lib/inventory';
import { importHistoricalPartners } from '../src/lib/partner-store';
import { partnerKey, uniquePartnerNames } from '../src/lib/partner-names';

mkdirSync('work', { recursive: true });
process.env.JEAGO_TEST_MODE = '1';
process.env.JEAGO_TEST_DATABASE_URL = pathToFileURL(join(mkdtempSync(join(resolve('work'), 'trash-partners-')), 'test.db')).href;
after(async () => (await getDb()).close());

test('permanent trash and automatic partners preserve transactional safety', async t => {
  const root = (await loadInventory()).categories[0];
  await mutate({ action: 'category.add', level: 1, parent_id: root.id, name: '장비' });
  const device = (await loadInventory()).categories.find(c => c.parent_id === root.id)!;
  await mutate({ action: 'category.add', level: 2, parent_id: device.id, name: '품목' });
  const category = (await loadInventory()).categories.find(c => c.parent_id === device.id)!;
  const createItem = async (name: string) => {
    await mutate({ action: 'item.add', name, category: category.name, manager: '김채희' });
    return (await loadInventory()).items.find(i => i.name === name)!;
  };
  const current = await createItem('출고 모델');
  await mutate({ action: 'stock.in', id: current.id, quantity: 20, manager: '김채희' });
  await t.test('successful shipments register once under concurrent and replayed requests; failures register nothing', async () => {
    await assert.rejects(mutate({ action: 'stock.out', id: current.id, quantity: 21, manager: '김채희', customer_name: '실패업체' }));
    assert(!(await loadInventory()).partners.some(p => p.name === '실패업체'));
    const request = { action: 'stock.out', id: current.id, quantity: 1, manager: '김채희', customer_name: '  베스트시스템  ', request_id: randomUUID() };
    await Promise.all([mutate(request), mutate(request), mutate({ ...request, request_id: randomUUID() })]);
    assert.equal((await loadInventory()).items.find(i => i.id === current.id)!.quantity, 18);
    assert.equal((await loadInventory()).partners.filter(p => p.name === '베스트시스템').length, 1);
    await assert.rejects(mutate({ action: 'partner.add', name: ' 베스트시스템 ' }), /이미 등록/);
    await mutate({ action: 'stock.out', id: current.id, quantity: 1, manager: '김채희', customer_name: '베스트아이티' });
    const names = (await loadInventory({ history: false })).customerNames;
    assert.equal(names.filter(n => partnerKey(n).startsWith('베스')).length, 2);
    assert.deepEqual(names.filter(n => partnerKey(n).startsWith('베스트시')), ['베스트시스템']);
    assert.deepEqual(uniquePartnerNames([' Acme  Co ', 'acme co', 'ACME CO']), ['Acme Co']);
  });
  await t.test('manual edits and restore cannot create duplicate active partners', async () => {
    const [first, second] = (await loadInventory()).partners;
    await assert.rejects(mutate({ action: 'partner.edit', id: first.id, name: second.name }), /이미 등록/);
    await mutate({ action: 'partner.delete', id: first.id });
    const group = (await loadTrash()).find(e => e.kind === 'partner')!;
    await mutate({ action: 'stock.out', id: current.id, quantity: 1, manager: '김채희', customer_name: first.name });
    await assert.rejects(mutate({ action: 'trash.restore', group_id: group.id }), /같은 이름/);
    await mutate({ action: 'trash.purge', group_id: group.id, confirm_permanent: 'yes' });
    assert((await loadInventory()).transactions.some(row => row.customer_name === first.name));
  });
  await t.test('historical import is deduplicated and runs only once, even after permanent partner deletion', async () => {
    const db = await getDb();
    await db.execute({ sql: 'INSERT INTO "transaction"(item_id,quantity,transaction_type,manager,customer_name) VALUES (?,1,\'출고\',\'김채희\',\'과거업체\')', args: [current.id] });
    const tx = await db.transaction('write');
    try { await tx.execute("DELETE FROM inventory_migration WHERE name='outbound-partners-v1'"); await importHistoricalPartners(tx); await tx.commit(); } finally { tx.close(); }
    const partner = (await loadInventory()).partners.find(p => p.name === '과거업체')!;
    assert(partner);
    await mutate({ action: 'partner.delete', id: partner.id });
    await mutate({ action: 'trash.purge', group_id: (await loadTrash()).find(e => e.name === '과거업체')!.id, confirm_permanent: 'yes' });
    const next = await db.transaction('write');
    try { await importHistoricalPartners(next); await next.commit(); } finally { next.close(); }
    assert(!(await loadInventory()).partners.some(p => p.name === '과거업체'));
    assert((await loadInventory()).customerNames.includes('과거업체'));
  });
  await t.test('single purge deletes associated history and cannot reuse a deleted model ID', async () => {
    const target = await createItem('영구 삭제 모델');
    await mutate({ action: 'stock.in', id: target.id, quantity: 1, manager: '김채희' });
    await mutate({ action: 'item.delete', id: target.id });
    const group = (await loadTrash()).find(e => e.name === target.name)!;
    await assert.rejects(mutate({ action: 'trash.purge', group_id: group.id }), /확인/);
    const request = { action: 'trash.purge', group_id: group.id, confirm_permanent: 'yes', request_id: randomUUID() };
    const result = await mutate(request);
    assert.deepEqual(await mutate(request), result);
    const db = await getDb();
    assert.equal((await db.execute({ sql: 'SELECT id FROM "transaction" WHERE item_id=?', args: [target.id] })).rows.length, 0);
    assert.equal((await db.execute({ sql: 'SELECT id FROM item WHERE id=?', args: [target.id] })).rows.length, 0);
    const newer = await createItem('삭제 후 모델');
    assert(newer.id > target.id);
    await assert.rejects(mutate({ action: 'item.threshold', id: target.id, threshold: 9, expected_version: 0 }));
    assert((await loadInventory()).transactions.some(row => row.item_id === current.id));
  });
  await t.test('stale empty-all snapshots cannot delete newly trashed or restored entries', async () => {
    const stale = trashSnapshot((await loadTrash()).map(e => e.id));
    await mutate({ action: 'partner.add', name: '비우기 테스트' });
    const target = (await loadInventory()).partners.find(p => p.name === '비우기 테스트')!;
    await mutate({ action: 'partner.delete', id: target.id });
    await assert.rejects(mutate({ action: 'trash.empty', snapshot: stale, confirm_permanent: 'yes' }), ConflictError);
    const entries = await loadTrash();
    const group = entries.find(e => e.name === target.name)!;
    await mutate({ action: 'trash.restore', group_id: group.id });
    await assert.rejects(mutate({ action: 'trash.purge', group_id: group.id, confirm_permanent: 'yes' }), ConflictError);
    await assert.rejects(mutate({ action: 'trash.empty', snapshot: trashSnapshot(entries.map(e => e.id)), confirm_permanent: 'yes' }), ConflictError);
    assert((await loadInventory()).partners.some(p => p.id === target.id));
  });
  await t.test('linked trash groups require children first; empty-all safely deletes in dependency order', async () => {
    await mutate({ action: 'item.delete', id: current.id });
    await mutate({ action: 'category.delete', id: device.id });
    const entries = await loadTrash(), parent = entries.find(e => e.kind === 'category')!;
    await assert.rejects(mutate({ action: 'trash.purge', group_id: parent.id, confirm_permanent: 'yes' }), ConflictError);
    assert.equal((await loadTrash()).length, entries.length);
    const request = { action: 'trash.empty', snapshot: trashSnapshot(entries.map(e => e.id)), confirm_permanent: 'yes', request_id: randomUUID() };
    await mutate(request); await mutate(request);
    assert.equal((await loadTrash()).length, 0);
    assert.equal((await loadInventory()).transactions.length, 0);
    assert((await loadInventory()).partners.some(p => p.name === '비우기 테스트'));
    assert((await loadInventory()).categories.some(c => c.id === root.id));
    assert.equal((await (await getDb()).execute('PRAGMA foreign_key_check')).rows.length, 0);
    await mutate({ action: 'category.add', level: 1, parent_id: root.id, name: '새 장비' });
    assert((await loadInventory()).categories.find(c => c.display_name === '새 장비')!.id > category.id);
  });
});
