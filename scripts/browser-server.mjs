import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
mkdirSync('work', { recursive: true });
const destination = resolve(`work/browser-${randomUUID()}.db`);
const db = new DatabaseSync('instance/inventory-next.db', { readOnly: true });
try { await backup(db, destination); } finally { db.close(); }
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, DATABASE_URL: pathToFileURL(destination).href, DATABASE_AUTH_TOKEN: '' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
