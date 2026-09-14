import { createClient, type Client } from '@libsql/client';
import { existsSync, mkdirSync } from 'node:fs';
import { DEFAULT_MAINS } from './types';
import { databaseConfig } from './database-config';

const globalDb = globalThis as unknown as { inventoryDb?: Promise<Client> };
export async function getDb(): Promise<Client> {
  if (!globalDb.inventoryDb) globalDb.inventoryDb = initialize().catch(e => { globalDb.inventoryDb = undefined; throw e; });
  return globalDb.inventoryDb;
}
async function initialize() {
  const { url, authToken } = databaseConfig();
  if (process.env.VERCEL && url.startsWith('file:')) throw new Error('Vercel에서는 원격 DATABASE_URL을 설정하세요.');
  if (url === 'file:instance/inventory-next.db') {
    mkdirSync('instance', { recursive: true });
    if (!existsSync('instance/inventory-next.db') && existsSync('instance/inventory.db')) {
      throw new Error('먼저 npm run db:prepare 명령으로 기존 DB를 복제하세요.');
    }
  }
  const db = createClient({ url, authToken });
  try {
    await db.batch([
      'CREATE TABLE IF NOT EXISTS category (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT, parent_id INTEGER REFERENCES category(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS item (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, low_stock_threshold INTEGER NOT NULL DEFAULT 5, manager TEXT NOT NULL, category TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS "transaction" (id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES item(id), quantity INTEGER NOT NULL, transaction_type TEXT NOT NULL, manager TEXT NOT NULL, customer_name TEXT, date TEXT DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS partner (id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT DEFAULT \'\', phone TEXT DEFAULT \'\', note TEXT DEFAULT \'\', created_at TEXT DEFAULT CURRENT_TIMESTAMP)',
      'CREATE INDEX IF NOT EXISTS idx_item_category ON item(category)',
      'CREATE INDEX IF NOT EXISTS idx_transaction_item ON "transaction"(item_id)',
    ], 'write');
    // Serialize additive schema upgrades across cold starts without replacing legacy tables.
    const upgrade = await db.transaction('write');
    try {
      for (const table of ['item', 'category', 'partner']) {
        const columns = new Set((await upgrade.execute(`PRAGMA table_info("${table}")`)).rows.map(c => c.name));
        const additions = [['version', 'INTEGER NOT NULL DEFAULT 0'], ['deleted_at', 'TEXT'], ['trash_group', 'TEXT']];
        const statements = additions.filter(([name]) => !columns.has(name)).map(([name, type]) => `ALTER TABLE "${table}" ADD COLUMN "${name}" ${type}`);
        if (statements.length) await upgrade.batch(statements);
      }
      await upgrade.batch([
        'CREATE TABLE IF NOT EXISTS mutation_request (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
        'CREATE TABLE IF NOT EXISTS trash_entry (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, restored_at TEXT)',
        'CREATE INDEX IF NOT EXISTS idx_item_trash ON item(trash_group)',
        'CREATE INDEX IF NOT EXISTS idx_category_trash ON category(trash_group)',
        'CREATE INDEX IF NOT EXISTS idx_partner_trash ON partner(trash_group)',
      ]);
      await upgrade.commit();
    } catch (error) { if (!upgrade.closed) await upgrade.rollback(); throw error; }
    finally { upgrade.close(); }
    const count = await db.execute('SELECT COUNT(*) AS n FROM category');
    if (Number(count.rows[0].n) === 0) await db.batch(DEFAULT_MAINS.map((name, i) => ({ sql: 'INSERT OR IGNORE INTO category(name,display_name,created_at) VALUES (?,?,CURRENT_TIMESTAMP)', args: [`main_default_${i}`, name] })), 'write');
    return db;
  } catch (e) { db.close(); throw e; }
}
