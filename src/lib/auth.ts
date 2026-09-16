import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';

export class AuthError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const SESSION_SECONDS = 12 * 60 * 60;
export const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
export const secureCookies = process.env.NODE_ENV === 'production' && process.env.JEAGO_TEST_MODE !== '1';
export const SESSION_COOKIE = secureCookies ? '__Host-jeago_session' : 'jeago_session';
export type User = { id: string; username: string; display_name: string };
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
  if (password.length < 10 || password.length > 128) throw new AuthError('PW는 10~128자로 입력하세요.');
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
  const lifetime = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
  const db = await getDb();
  await db.batch([
    { sql: 'DELETE FROM auth_session WHERE expires_at<=?', args: [now] },
    { sql: 'INSERT INTO auth_session(token_hash,user_id,expires_at) VALUES (?,?,?)', args: [digest(token), userId, now + lifetime * 1000] },
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
