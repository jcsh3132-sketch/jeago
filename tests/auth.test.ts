import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register, authenticate, createSession, sessionUser, revokeSession, limitAuth, updateAccount, accountProfile, AuthError, REMEMBER_SECONDS, SESSION_SECONDS } from '../src/lib/auth';
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

test('profile edits require the current password and affect only the session owner', async () => {
  const password = 'profile-password-2026';
  const user = await register({ username: 'profile.owner', display_name: '원래 이름', password, password_confirm: password });
  const other = await register({ username: 'profile.other', display_name: '다른 사용자', password, password_confirm: password });
  const token = await createSession(user.id, true), otherToken = await createSession(other.id, false);
  const fields = { id: other.id, username: 'profile.updated', display_name: '수정 이름', email: 'member@example.com', phone: '010-1234-5678', department: '물류팀', current_password: password };
  const initial = await accountProfile(token);
  assert.equal(initial.email, '');
  await assert.rejects(updateAccount(undefined, 'profile', fields), error => error instanceof AuthError && error.status === 401);
  await assert.rejects(updateAccount(token, 'profile', { ...fields, current_password: 'wrong-password' }), /현재 비밀번호/);
  await assert.rejects(updateAccount(token, 'profile', { ...fields, username: other.username }), error => error instanceof AuthError && error.status === 409);
  for (const invalid of [{ email: 'invalid' }, { display_name: ' ' }, { department: 'x'.repeat(101) }, { username: '??' }]) {
    await assert.rejects(updateAccount(token, 'profile', { ...fields, ...invalid }), AuthError);
  }
  assert.deepEqual(await accountProfile(token), initial);
  await updateAccount(token, 'profile', fields);
  assert.equal((await authenticate({ username: fields.username, password })).id, user.id);
  await assert.rejects(authenticate({ username: user.username, password }), /올바르지/);
  assert.equal((await sessionUser(token))!.display_name, fields.display_name);
  assert.equal((await accountProfile(token)).department, fields.department);
  assert.equal((await accountProfile(otherToken)).display_name, '다른 사용자');
});

test('password updates validate confirmation, revoke all owner sessions, and leave other accounts intact', async () => {
  const password = 'password-before-2026', next = 'password-after-2026';
  const user = await register({ username: 'password.owner', display_name: '사용자', password, password_confirm: password });
  const other = await register({ username: 'password.other', display_name: '다른 사용자', password, password_confirm: password });
  const pc = await createSession(user.id, true), mobile = await createSession(user.id, true), untouched = await createSession(other.id, true);
  const fields = { current_password: password, new_password: next, password_confirm: next };
  await assert.rejects(updateAccount(pc, 'password', { ...fields, current_password: 'wrong-password' }), /현재 비밀번호/);
  await assert.rejects(updateAccount(pc, 'password', { ...fields, password_confirm: 'not-equal' }), /일치/);
  await assert.rejects(updateAccount(pc, 'password', { ...fields, new_password: 'short' }), /10~128/);
  await assert.rejects(updateAccount(pc, 'password', { ...fields, new_password: password, password_confirm: password }), /다른 새 비밀번호/);
  assert(await sessionUser(mobile));
  const attempts = await Promise.allSettled([updateAccount(pc, 'password', fields), updateAccount(mobile, 'password', fields)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await sessionUser(pc), null);
  assert.equal(await sessionUser(mobile), null);
  assert.equal((await sessionUser(untouched))!.id, other.id);
  await assert.rejects(updateAccount(pc, 'password', fields), error => error instanceof AuthError && error.status === 401);
  await assert.rejects(authenticate({ username: user.username, password }), /올바르지/);
  assert.equal((await authenticate({ username: user.username, password: next })).id, user.id);
  const hash = (await (await getDb()).execute({ sql: 'SELECT password_hash FROM app_user WHERE id=?', args: [user.id] })).rows[0].password_hash;
  assert(String(hash).startsWith('scrypt:')); assert(!String(hash).includes(next));
});
