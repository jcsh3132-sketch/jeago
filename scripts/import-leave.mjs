import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';
const [file, env] = process.argv.slice(2);
if (!file || !env) throw new Error('Usage: node scripts/import-leave.mjs <private-json> <env-file>');
process.loadEnvFile(env);
const source = fs.readFileSync(file, 'utf8'), rows = JSON.parse(source);
const digest = createHash('sha256').update(source).digest('hex');
if (!Array.isArray(rows) || rows.length !== 5) throw new Error('Expected verified five-employee source');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const tx = await db.transaction('write');
try {
  await tx.execute('CREATE TABLE IF NOT EXISTS leave_import (source TEXT PRIMARY KEY,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const prior = (await tx.execute({ sql: 'SELECT source FROM leave_import WHERE source=?', args: [digest] })).rows;
  if (!prior.length) {
    for (const row of rows) {
      if ((await tx.execute({ sql: 'SELECT id FROM leave_employee WHERE id=?', args: [row.id] })).rows.length) throw new Error('Existing imported employee; refusing overwrite');
      await tx.execute({ sql: 'INSERT INTO leave_employee(id,name,position,hired,special,entries,version) VALUES (?,?,?,?,?,?,1)', args: [row.id,row.name,row.position,row.hired,row.special,JSON.stringify(row.entries)] });
      const saved = (await tx.execute({ sql: 'SELECT entries FROM leave_employee WHERE id=?', args: [row.id] })).rows[0];
      if (String(saved.entries) !== JSON.stringify(row.entries)) throw new Error('Import verification failed');
    }
    await tx.execute({ sql: 'INSERT INTO leave_import(source) VALUES (?)', args: [digest] });
  }
  await tx.commit();
  console.log(JSON.stringify({ imported: !prior.length, employees: rows.length, entries: rows.reduce((n,r) => n+r.entries.length,0), verified: true }));
} catch (error) { if (!tx.closed) await tx.rollback(); throw error; } finally { tx.close(); db.close(); }
