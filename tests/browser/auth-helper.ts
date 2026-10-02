import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Only the disposable database created by browser-server.mjs is eligible.
export function assignTestAdministrator(username: string) {
  const file = readdirSync('work').filter(name => /^browser-[a-f0-9-]+\.db$/.test(name)).map(name => join('work', name)).sort((a,b) => statSync(b).birthtimeMs - statSync(a).birthtimeMs)[0];
  if (!file) throw new Error('Isolated browser database missing');
  const fixture = new DatabaseSync(file);
  try {
    const owner = fixture.prepare('SELECT id FROM app_user WHERE username=?').get(username);
    if (!owner) throw new Error('Test account missing from isolated database');
    fixture.prepare('INSERT INTO app_admin(singleton,user_id) VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET user_id=excluded.user_id').run(String(owner.id));
  } finally { fixture.close(); }
}
export async function loginForTest(request: APIRequestContext) {
  const username = `e2e-${randomUUID().slice(0, 12)}`;
  const fields = { username, password: 'browser-test-password', password_confirm: 'browser-test-password', display_name: '화면 테스트' };
  const headers = { Origin: 'http://127.0.0.1:3100' };
  const registered = await request.post('/api/auth/signup', { headers, data: fields });
  if (registered.status() !== 201) throw new Error(`Test registration failed: ${await registered.text()}`);
  const loggedIn = await request.post('/api/auth/login', { headers, data: fields });
  if (!loggedIn.ok()) throw new Error('Test login failed');
  return fields;
}
