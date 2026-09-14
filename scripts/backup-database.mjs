import { createClient } from '@libsql/client';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
export async function backupDatabase({ url, authToken, destination }) {
  if (!url) throw new Error('Source database URL is required.');
  if (existsSync(destination)) throw new Error('Backup destination already exists.');
  mkdirSync(dirname(destination), { recursive: true });
  const source = createClient({ url, authToken });
  let tx, target;
  try {
    tx = await source.transaction('read');
    const schema = (await tx.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name")).rows;
    const tables = schema.filter(s => s.type === 'table');
    const records = await tx.batch(tables.map(t => `SELECT * FROM ${quote(t.name)} ORDER BY rowid`));
    await tx.commit();
    target = new DatabaseSync(destination);
    target.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
    for (const table of tables) target.exec(table.sql);
    const summary = [];
    for (let i = 0; i < tables.length; i++) {
      const { columns, rows } = records[i];
      const insert = target.prepare(`INSERT INTO ${quote(tables[i].name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of rows) insert.run(...columns.map(c => row[c] instanceof ArrayBuffer ? new Uint8Array(row[c]) : row[c]));
      const copied = target.prepare(`SELECT * FROM ${quote(tables[i].name)} ORDER BY rowid`).all();
      const normalize = value => JSON.stringify(value, (_, v) => v instanceof Uint8Array || v instanceof ArrayBuffer ? Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : v).toString('base64') : v);
      if (normalize(rows.map(r => columns.map(c => r[c]))) !== normalize(copied.map(r => columns.map(c => r[c])))) throw new Error(`Backup verification failed: ${tables[i].name}`);
      summary.push({ table: tables[i].name, rows: rows.length });
    }
    for (const object of schema.filter(s => s.type !== 'table')) target.exec(object.sql);
    if (target.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup foreign-key verification failed.');
    if (target.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity verification failed.');
    target.exec('COMMIT');
    return { destination, verified: true, tables: summary };
  } finally { tx?.close(); source.close(); target?.close(); }
}
async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  if (option('--env')) process.loadEnvFile(option('--env'));
  const result = await backupDatabase({ url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
    destination: resolve(option('--output') || `work/backups/inventory-${new Date().toISOString().replaceAll(':', '-')}.db`) });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
