import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';

export class AuthError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const SESSION_SECONDS = 12 * 60 * 60;
// Browser cookies have a finite lifetime; renew them while the app is used.
export const REMEMBER_SECONDS = 400 * 24 * 60 * 60;
export const PERSISTENT_SESSION_EXPIRY = Number.MAX_SAFE_INTEGER;
export const secureCookies = process.env.NODE_ENV === 'production' && process.env.JEAGO_TEST_MODE !== '1';
export const SESSION_COOKIE = secureCookies ? '__Host-jeago_session' : 'jeago_session';
export type User = { id: string; username: string; display_name: string };
export type AccountProfile = User & { email: string; phone: string; department: string };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [scheme, salt, encoded] = hash.split(':');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(encoded)) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(encoded, 'hex'));
}
export function credentials(fields: Record<string, unknown>) {
  const username = typeof fields.username === 'string' ? fields.username.trim().toLowerCase() : '';
  const password = typeof fields.password === 'string' ? fields.password : '';
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new AuthError('ID는 영문·숫자로 시작하는 3~32자의 영문, 숫자, 점, 밑줄, 하이픈으로 입력하세요.');
  if (password.length < 4 || password.length > 128) throw new AuthError('PW는 4~128자로 입력하세요.');
  return { username, password };
}
export async function register(fields: Record<string, unknown>) {
  const { username, password } = credentials(fields);
  const name = typeof fields.display_name === 'string' ? fields.display_name.trim() : '';
  if (!name || name.length > 50) throw new AuthError('이름은 1~50자로 입력하세요.');
  if (fields.password_confirm !== password) throw new AuthError('비밀번호 확인이 일치하지 않습니다.');
  const db = await getDb();
  const hash = await hashPassword(password);
  const user = { id: randomUUID(), username, display_name: name };
  try {
    await db.execute({ sql: 'INSERT INTO app_user(id,username,display_name,password_hash) VALUES (?,?,?,?)', args: [user.id, username, name, hash] });
  } catch (error) {
    if (String((error as { code?: string }).code).startsWith('SQLITE_CONSTRAINT')) throw new AuthError('이미 사용 중인 ID입니다.', 409);
    throw error;
  }
  return user;
}
export async function authenticate(fields: Record<string, unknown>): Promise<User> {
  const { username, password } = credentials(fields);
  const rows = (await (await getDb()).execute({ sql: 'SELECT * FROM app_user WHERE username=?', args: [username] })).rows;
  // Equal-cost password work even when the account does not exist.
  const hash = rows[0] ? String(rows[0].password_hash) : `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
  const valid = await verifyPassword(password, hash);
  if (!rows[0] || !valid) throw new AuthError('ID 또는 PW가 올바르지 않습니다.', 401);
  return { id: String(rows[0].id), username: String(rows[0].username), display_name: String(rows[0].display_name) };
}
export async function createSession(userId: string, remember: boolean, now = Date.now()) {
  const token = randomBytes(32).toString('hex');
  const expiry = remember ? PERSISTENT_SESSION_EXPIRY : now + SESSION_SECONDS * 1000;
  const db = await getDb();
  await db.batch([
    { sql: 'DELETE FROM auth_session WHERE expires_at<=?', args: [now] },
    { sql: 'INSERT INTO auth_session(token_hash,user_id,expires_at) VALUES (?,?,?)', args: [digest(token), userId, expiry] },
  ], 'write');
  return token;
}
export async function sessionUser(token: string | undefined, now = Date.now()): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await (await getDb()).execute({ sql: 'SELECT u.id,u.username,u.display_name FROM auth_session s JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', args: [digest(token), now] });
  return result.rows.length ? result.rows[0] as unknown as User : null;
}
export async function revokeSession(token: string | undefined) {
  if (token) await (await getDb()).execute({ sql: 'DELETE FROM auth_session WHERE token_hash=?', args: [digest(token)] });
}

export async function renewRememberedSession(token: string | undefined, now = Date.now()) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new AuthError('다시 로그인해주세요.', 401);
  const db = await getDb();
  const row = (await db.execute({ sql: 'SELECT expires_at,created_at FROM auth_session WHERE token_hash=? AND expires_at>?', args: [digest(token), now] })).rows[0];
  if (!row) throw new AuthError('다시 로그인해주세요.', 401);
  if (Number(row.expires_at) === PERSISTENT_SESSION_EXPIRY) return true;
  // Upgrade unexpired legacy 30-day sessions, but never turn a 12-hour login
  // without automatic-login consent into a persistent session.
  const created = Date.parse(String(row.created_at).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(created) || Number(row.expires_at) - created <= SESSION_SECONDS * 1000 + 60000) return false;
  const changed = await db.execute({ sql: 'UPDATE auth_session SET expires_at=? WHERE token_hash=? AND expires_at=? AND expires_at>?', args: [PERSISTENT_SESSION_EXPIRY, digest(token), row.expires_at, now] });
  if (!changed.rowsAffected) throw new AuthError('로그인 상태가 변경되었습니다. 다시 확인해주세요.', 401);
  return true;
}

export async function accountProfile(token: string | undefined): Promise<AccountProfile> {
  const user = await sessionUser(token);
  if (!user) throw new AuthError('로그인이 만료되었습니다. 다시 로그인해주세요.', 401);
  const row = (await (await getDb()).execute({ sql: 'SELECT id,username,display_name,email,phone,department FROM app_user WHERE id=?', args: [user.id] })).rows[0];
  return row as unknown as AccountProfile;
}

export async function updateAccount(token: string | undefined, action: 'profile' | 'password', fields: Record<string, unknown>) {
  const user = await sessionUser(token);
  if (!user) throw new AuthError('로그인이 만료되었습니다. 다시 로그인해주세요.', 401);
  await limitAuth(`account:${user.id}`, 20, 900);
  const current = typeof fields.current_password === 'string' ? fields.current_password : '';
  if (current.length < 4 || current.length > 128) throw new AuthError('현재 비밀번호를 확인해주세요.');
  const db = await getDb();
  const oldHash = String((await db.execute({ sql: 'SELECT password_hash FROM app_user WHERE id=?', args: [user.id] })).rows[0]?.password_hash || '');
  if (!await verifyPassword(current, oldHash)) throw new AuthError('현재 비밀번호가 올바르지 않습니다.');
  let nextHash = oldHash;
  let profile: AccountProfile | undefined;
  if (action === 'password') {
    const { password } = credentials({ username: user.username, password: fields.new_password });
    if (fields.password_confirm !== password) throw new AuthError('새 비밀번호 확인이 일치하지 않습니다.');
    if (password === current) throw new AuthError('현재 비밀번호와 다른 새 비밀번호를 입력하세요.');
    nextHash = await hashPassword(password);
  } else {
    const { username } = credentials({ username: fields.username, password: current });
    const field = (key: string, maximum: number) => {
      const value = typeof fields[key] === 'string' ? fields[key].trim() : '';
      if (value.length > maximum) throw new AuthError('입력 내용의 길이를 확인해주세요.');
      return value;
    };
    const display_name = field('display_name', 50), email = field('email', 254), phone = field('phone', 30), department = field('department', 100);
    if (!display_name) throw new AuthError('이름은 1~50자로 입력하세요.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('이메일 형식을 확인해주세요.');
    profile = { id: user.id, username, display_name, email, phone, department };
  }
  // Recheck both the credential and session inside the write transaction. A concurrent
  // password change/logout must prevent an already-started request from editing the account.
  const tx = await db.transaction('write');
  try {
    const active = (await tx.execute({ sql: 'SELECT u.id FROM app_user u JOIN auth_session s ON s.user_id=u.id WHERE u.id=? AND u.password_hash=? AND s.token_hash=? AND s.expires_at>?', args: [user.id, oldHash, digest(token!), Date.now()] })).rows;
    if (!active.length) throw new AuthError('계정 또는 로그인 상태가 변경되었습니다. 다시 로그인해주세요.', 401);
    if (profile) await tx.execute({ sql: 'UPDATE app_user SET username=?,display_name=?,email=?,phone=?,department=? WHERE id=?', args: [profile.username, profile.display_name, profile.email, profile.phone, profile.department, user.id] });
    else {
      await tx.execute({ sql: 'UPDATE app_user SET password_hash=? WHERE id=?', args: [nextHash, user.id] });
      await tx.execute({ sql: 'DELETE FROM auth_session WHERE user_id=?', args: [user.id] });
    }
    await tx.commit();
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    if (String((error as { code?: string }).code).startsWith('SQLITE_CONSTRAINT')) throw new AuthError('이미 사용 중인 ID입니다.', 409);
    throw error;
  } finally { tx.close(); }
  return profile;
}
export async function limitAuth(key: string, maximum: number, seconds: number, now = Date.now()) {
  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO auth_limit(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN auth_limit.expires_at<=? THEN 1 ELSE auth_limit.attempts+1 END,
      expires_at=CASE WHEN auth_limit.expires_at<=? THEN excluded.expires_at ELSE auth_limit.expires_at END RETURNING attempts`,
    args: [digest(key), now + seconds * 1000, now, now],
  });
  if (Number(result.rows[0].attempts) > maximum) throw new AuthError('시도가 너무 많습니다. 잠시 후 다시 시도하세요.', 429);
  await db.execute({ sql: 'DELETE FROM auth_limit WHERE expires_at<=?', args: [now] });
}
