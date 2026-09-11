import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { getDb } from '../src/lib/db';
import { loadInventory, mutate } from '../src/lib/inventory';

mkdirSync('work', { recursive: true });
const dir = mkdtempSync(join(resolve('work'), 'legacy-test-'));
process.env.DATABASE_URL = pathToFileURL(join(dir, 'legacy.db')).href;
after(async () => { (await getDb()).close(); });
test('Flask schema without SQL timestamp defaults supports all new writes', async () => {
  const fixture = createClient({ url: process.env.DATABASE_URL! });
  await fixture.batch([
    'CREATE TABLE category(id INTEGER PRIMARY KEY,name TEXT NOT NULL,display_name TEXT,parent_id INTEGER,created_at DATETIME NOT NULL)',
    'CREATE TABLE item(id INTEGER PRIMARY KEY,name TEXT NOT NULL,quantity INTEGER,manager TEXT NOT NULL,category TEXT,low_stock_threshold INTEGER NOT NULL DEFAULT 5)',
    'CREATE TABLE "transaction"(id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL,quantity INTEGER NOT NULL,transaction_type TEXT NOT NULL,manager TEXT NOT NULL,date DATETIME,customer_name TEXT,memo TEXT,operation_id TEXT,edited_at DATETIME)',
    'CREATE TABLE partner(id INTEGER PRIMARY KEY,name TEXT NOT NULL,contact_person TEXT,phone TEXT,note TEXT,created_at DATETIME)',
  ], 'write');
  fixture.close();
  const main = (await loadInventory()).categories[0];
  await mutate({ action: 'category.add', level: 1, parent_id: main.id, name: '장비' });
  const device = (await loadInventory()).categories.find(c => c.display_name === '장비')!;
  await mutate({ action: 'category.add', level: 2, parent_id: device.id, name: '품목' });
  const leaf = (await loadInventory()).categories.find(c => c.display_name === '품목')!;
  await mutate({ action: 'item.add', name: '모델', category: leaf.name, manager: '김채희' });
  const item = (await loadInventory()).items[0];
  await mutate({ action: 'stock.in', id: item.id, quantity: 5, manager: '김채희' });
  await mutate({ action: 'stock.out', id: item.id, quantity: 2, manager: '김채희', customer_name: '업체' });
  await mutate({ action: 'partner.add', name: '업체' });
  const data = await loadInventory();
  assert.equal(data.items[0].quantity, 3);
  assert(data.transactions.every(t => /^\d{4}-\d{2}-\d{2} /.test(t.date)));
  const db = await getDb();
  for (const table of ['category', 'partner']) {
    const result = await db.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE created_at IS NULL`);
    assert.equal(Number(result.rows[0].n), 0);
  }
});
