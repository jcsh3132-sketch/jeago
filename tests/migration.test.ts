import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateDatabase } from '../scripts/migrate-database.mjs';

test('migration verifies all rows, preserves hierarchy and rejects overwrite', async () => {
  mkdirSync('work', { recursive: true });
  const folder = mkdtempSync(join(resolve('work'), 'migration-test-'));
  const source = join(folder, 'source.db');
  const target = join(folder, 'target.db');
  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE category(id INTEGER PRIMARY KEY,name TEXT,parent_id INTEGER REFERENCES category(id)); CREATE UNIQUE INDEX category_name ON category(name); CREATE TABLE item(id INTEGER PRIMARY KEY,name TEXT,category INTEGER REFERENCES category(id),quantity INTEGER);');
  // Parent IDs can be larger than child IDs in legacy databases.
  db.prepare('INSERT INTO category VALUES (?,?,?)').run(9, '상위', null);
  db.prepare('INSERT INTO category VALUES (?,?,?)').run(1, '하위', 9);
  db.prepare('INSERT INTO item VALUES (?,?,?,?)').run(10, "T-100 '토너'", 1, 7);
  db.close();
  const config = { source, url: pathToFileURL(target).href, authToken: undefined };
  const dry = await migrateDatabase(config);
  assert.equal(dry.applied, false);
  const result = await migrateDatabase({ ...config, apply: true });
  assert.equal(result.verified, true);
  assert.deepEqual(result.tables, [{ table: 'category', rows: 2 }, { table: 'item', rows: 1 }]);
  await assert.rejects(migrateDatabase({ ...config, apply: true }), /not empty/);
  const verify = new DatabaseSync(target, { readOnly: true });
  assert.equal(verify.prepare('SELECT quantity FROM item WHERE id=10').get()!.quantity, 7);
  assert.equal(verify.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='category_name'").get()!.n, 1);
  verify.close();
});
