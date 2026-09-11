import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const source = resolve('instance/inventory.db');
const target = resolve('instance/inventory-next.db');
mkdirSync('instance', { recursive: true });
if (existsSync(target)) {
  console.log('Next.js DB already exists; keeping it unchanged.');
} else if (existsSync(source)) {
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); } finally { db.close(); }
  console.log('Copied existing inventory to instance/inventory-next.db. Original preserved.');
} else {
  console.log('No legacy DB found. A new database will be initialized on first request.');
}
