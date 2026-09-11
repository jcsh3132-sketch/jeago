import { createClient } from '@libsql/client';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const quote = name => '"' + name.replaceAll('"', '""') + '"';
const canonical = rows => JSON.stringify(rows, (_, value) => {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  return value;
});

// Refuse populated targets; never overwrite an existing remote database.
export async function migrateDatabase({ source, url, authToken, apply = false }) {
  if (!url) throw new Error('A target database URL is required.');
  if (!existsSync(source)) throw new Error('Source database does not exist.');
  const db = new DatabaseSync(source, { readOnly: true });
  const remote = createClient({ url, authToken });
  let tx;
  try {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name").all();
    const tables = schema.filter(s => s.type === 'table').map(s => {
      const columns = db.prepare(`PRAGMA table_info(${quote(s.name)})`).all().map(c => c.name);
      const rows = db.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(s.name)} ORDER BY rowid`).all();
      return { name: s.name, columns, rows };
    });
    const summary = tables.map(t => ({ table: t.name, rows: t.rows.length }));
    tx = await remote.transaction('write');
    const existing = await tx.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    if (existing.rows.length) throw new Error('Target is not empty. Migration refused; existing data has not been changed.');
    if (!apply) { await tx.rollback(); return { applied: false, tables: summary }; }
    const statements = ['PRAGMA defer_foreign_keys=ON', ...schema.filter(s => s.type === 'table').map(s => s.sql)];
    for (const table of tables) {
      const sql = `INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`;
      for (const row of table.rows) statements.push({ sql, args: table.columns.map(c => row[c]) });
    }
    statements.push(...schema.filter(s => s.type !== 'table').map(s => s.sql));
    // Keep remote round trips short enough for the interactive transaction limit.
    await tx.batch(statements);
    for (const table of tables) {
      const result = await tx.execute(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)} ORDER BY rowid`);
      const expected = table.rows.map(r => table.columns.map(c => r[c]));
      const actual = result.rows.map(r => table.columns.map(c => r[c]));
      if (canonical(expected) !== canonical(actual)) throw new Error(`Verification failed for ${table.name}; transaction rolled back.`);
    }
    const integrity = await tx.execute('PRAGMA foreign_key_check');
    if (integrity.rows.length) throw new Error('Foreign-key verification failed; transaction rolled back.');
    await tx.commit();
    return { applied: true, verified: true, tables: summary };
  } catch (e) { if (tx && !tx.closed) await tx.rollback(); throw e; }
  finally { tx?.close(); remote.close(); db.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const envFile = option('--env');
  if (envFile) process.loadEnvFile(envFile);
  const source = resolve(option('--source') || 'instance/inventory-next.db');
  const snapshot = resolve(`work/migration-snapshot-${Date.now()}.db`);
  mkdirSync(dirname(snapshot), { recursive: true });
  const original = new DatabaseSync(source, { readOnly: true });
  try { await backup(original, snapshot); } finally { original.close(); }
  const result = await migrateDatabase({
    source: snapshot,
    url: process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
    apply: args.includes('--apply'),
  });
  console.log(JSON.stringify({ snapshot, ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
