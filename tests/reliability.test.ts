import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb } from '../src/lib/db';
import { loadInventory, loadTrash, mutate, ConflictError } from '../src/lib/inventory';
import { databaseConfig } from '../src/lib/database-config';
import { backupDatabase } from '../scripts/backup-database.mjs';
import { migrateDatabase } from '../scripts/migrate-database.mjs';

mkdirSync('work', { recursive: true });
const folder = mkdtempSync(join(resolve('work'), 'reliability-'));
const url = pathToFileURL(join(folder, 'test.db')).href;
process.env.JEAGO_TEST_MODE = '1';
process.env.JEAGO_TEST_DATABASE_URL = url;
after(async () => { (await getDb()).close(); });

test('test mode ignores inherited production credentials and refuses unsafe targets', () => {
  const env = { JEAGO_TEST_MODE: '1', JEAGO_TEST_DATABASE_URL: url, TURSO_DATABASE_URL: 'libsql://production.example', TURSO_AUTH_TOKEN: 'production-secret' };
  assert.deepEqual(databaseConfig(env), { url, authToken: undefined });
  for (const target of ['', 'libsql://production.example', pathToFileURL(resolve('instance/inventory-next.db')).href]) {
    assert.throws(() => databaseConfig({ ...env, JEAGO_TEST_DATABASE_URL: target }));
  }
});

test('request replay, stale writes, reversible deletion and backup recovery', async t => {
  const root = (await loadInventory()).categories[0];
  await mutate({ action: 'category.add', level: 1, parent_id: root.id, name: '신뢰성 장비' });
  const device = (await loadInventory()).categories.find(c => c.display_name === '신뢰성 장비')!;
  await mutate({ action: 'category.add', level: 2, parent_id: device.id, name: '신뢰성 품목' });
  const category = (await loadInventory()).categories.find(c => c.display_name === '신뢰성 품목')!;
  await mutate({ action: 'item.add', name: '원본 모델', manager: '김채희', category: category.name });
  const original = (await loadInventory()).items[0];
  const request = { action: 'stock.in', id: original.id, quantity: 3, manager: '김채희', expected_version: original.version, request_id: randomUUID() };
  await t.test('concurrent and later retries change stock exactly once', async () => {
    const results = await Promise.all([mutate(request), mutate(request)]);
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(await mutate(request), results[0]);
    const data = await loadInventory();
    assert.equal(data.items[0].quantity, 3);
    assert.equal(data.transactions.length, 1);
    await assert.rejects(mutate({ ...request, quantity: 7 }), ConflictError);
    await assert.rejects(mutate({ ...request, request_id: randomUUID() }), ConflictError);
    await assert.rejects(mutate({ action: 'item.edit', id: original.id, name: '덮어쓰기', manager: '김채희', category: category.name, expected_version: 0 }), ConflictError);
    assert.equal((await loadInventory()).items[0].name, '원본 모델');
  });
  await t.test('archive preserves IDs/history and a stale form cannot write another model', async () => {
    await mutate({ action: 'item.delete', id: original.id, expected_version: 1 });
    assert.equal((await loadInventory()).items.length, 0);
    const db = await getDb();
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM "transaction"')).rows[0].n, 1);
    await mutate({ action: 'item.add', name: '새 모델', manager: '김채희', category: category.name });
    assert((await loadInventory()).items[0].id > original.id);
    await assert.rejects(mutate({ ...request, request_id: randomUUID() }));
    const trash = (await loadTrash()).find(e => e.kind === 'item')!;
    await mutate({ action: 'trash.restore', group_id: trash.id });
    const restored = (await loadInventory()).items.find(i => i.id === original.id)!;
    assert.equal(restored.quantity, 3); assert.equal(restored.version, 3);
    assert.equal((await loadInventory()).transactions.length, 1);
  });
  await t.test('branch restoration requires parents and rejects name conflicts atomically', async () => {
    await mutate({ action: 'category.delete', id: device.id });
    const branch = (await loadTrash()).find(e => e.kind === 'category')!;
    assert.equal(branch.items, 2); assert.equal(branch.categories, 2);
    await mutate({ action: 'category.delete', id: root.id });
    const parent = (await loadTrash()).find(e => e.id !== branch.id)!;
    await assert.rejects(mutate({ action: 'trash.restore', group_id: branch.id }), /상위/);
    await mutate({ action: 'trash.restore', group_id: parent.id });
    await mutate({ action: 'category.add', level: 1, parent_id: root.id, name: '신뢰성 장비' });
    await assert.rejects(mutate({ action: 'trash.restore', group_id: branch.id }), /같은 이름/);
    assert.equal((await loadInventory()).items.length, 0);
    const duplicate = (await loadInventory()).categories.find(c => c.display_name === '신뢰성 장비')!;
    await mutate({ action: 'category.rename', id: duplicate.id, name: '다른 장비' });
    await mutate({ action: 'trash.restore', group_id: branch.id });
    assert.equal((await loadInventory()).items.length, 2);
    assert.equal((await loadInventory()).transactions.length, 1);
    assert.equal((await loadInventory()).categories.find(c => c.id === category.id)!.parent_id, device.id);
  });
  await t.test('partner restore retains contact fields', async () => {
    await mutate({ action: 'partner.add', name: '복구 거래처', phone: '010-1234', contact_person: '테스터', note: '보존' });
    const p = (await loadInventory()).partners[0];
    await mutate({ action: 'partner.delete', id: p.id, expected_version: p.version });
    await mutate({ action: 'trash.restore', group_id: (await loadTrash()).find(e => e.kind === 'partner')!.id });
    const restored = (await loadInventory()).partners[0];
    assert.equal(restored.id, p.id); assert.equal(restored.phone, p.phone); assert.equal(restored.note, p.note);
  });
  await t.test('verified backup restores all operational and recovery tables to an empty database', async () => {
    const destination = join(folder, 'backup.db');
    const backup = await backupDatabase({ url, destination, authToken: undefined });
    assert.equal(backup.verified, true);
    assert(backup.tables.some(t => t.table === 'mutation_request' && t.rows === 1));
    await assert.rejects(backupDatabase({ url, destination, authToken: undefined }), /already exists/);
    const restored = await migrateDatabase({ source: destination, url: pathToFileURL(join(folder, 'restored.db')).href, authToken: undefined, apply: true });
    assert.equal(restored.verified, true);
    assert.deepEqual(restored.tables, backup.tables);
  });
});
