import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
