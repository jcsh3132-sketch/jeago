import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register, authenticate, createSession, sessionUser, revokeSession, limitAuth, AuthError, REMEMBER_SECONDS, SESSION_SECONDS } from '../src/lib/auth';
import { getDb } from '../src/lib/db';
mkdirSync('work', { recursive: true });
process.env.JEAGO_TEST_MODE = '1';
process.env.JEAGO_TEST_DATABASE_URL = pathToFileURL(join(mkdtempSync(join(resolve('work'), 'auth-test-')), 'test.db')).href;
after(async () => (await getDb()).close());

test('accounts use salted hashes, normalize IDs and validate registration', async () => {
  const fields = { username: 'Test.Member', display_name: '테스터', password: 'test-password-2026', password_confirm: 'test-password-2026' };
  const user = await register(fields);
  assert.equal(user.username, 'test.member');
  await assert.rejects(register({ ...fields, username: 'test.member' }), error => error instanceof AuthError && error.status === 409);
  await assert.rejects(register({ ...fields, username: 'another', password_confirm: 'different' }), /일치/);
  await assert.rejects(register({ ...fields, username: 'another', password: 'short' }), /10~128/);
  assert.equal((await authenticate({ username: 'TEST.MEMBER', password: fields.password })).id, user.id);
  await assert.rejects(authenticate({ username: user.username, password: 'wrong-password' }), /올바르지/);
  await assert.rejects(authenticate({ username: 'missing', password: fields.password }), /올바르지/);
  await register({ ...fields, username: 'second.member' });
  const hashes = (await (await getDb()).execute('SELECT password_hash FROM app_user')).rows.map(r => r.password_hash);
  assert.notEqual(hashes[0], hashes[1]); assert(hashes.every(hash => !String(hash).includes(fields.password)));
});

test('device sessions expire independently; logout revokes only that device', async () => {
  const user = await authenticate({ username: 'test.member', password: 'test-password-2026' });
  const now = 100000;
  const pc = await createSession(user.id, true, now);
  const mobile = await createSession(user.id, true, now);
  const temporary = await createSession(user.id, false, now);
  assert.notEqual(pc, mobile);
  assert.equal((await sessionUser(pc, now))!.id, user.id);
  assert.equal(await sessionUser(temporary, now + SESSION_SECONDS * 1000), null);
  assert.equal(await sessionUser(pc, now + REMEMBER_SECONDS * 1000), null);
  assert.equal(await sessionUser('f'.repeat(64), now), null);
  const stored = (await (await getDb()).execute('SELECT token_hash FROM auth_session')).rows;
  assert(stored.every(row => row.token_hash !== pc && row.token_hash !== mobile));
  await revokeSession(pc);
  assert.equal(await sessionUser(pc, now), null);
  assert.equal((await sessionUser(mobile, now))!.id, user.id);
});

test('persistent rate limits reject excessive attempts and recover after the window', async () => {
  await limitAuth('test:ip', 2, 60, 1000);
  await limitAuth('test:ip', 2, 60, 1000);
  await assert.rejects(limitAuth('test:ip', 2, 60, 1000), error => error instanceof AuthError && error.status === 429);
  await limitAuth('test:other-ip', 2, 60, 1000);
  await limitAuth('test:ip', 2, 60, 61000);
});
