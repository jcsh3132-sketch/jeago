import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { getDb } from './db';
import { AuthError, limitAuth, sessionUser } from './auth';
import { isAdministrator } from './admin';
import { collectFees, ProviderError, type ApiCredentials, type FeePlatform, type FeeRecord } from './calculator-providers';

type Connection = { platform: FeePlatform; credentials: string; revision: number; fees: string; synced_at: number; attempted_at: number; last_error: string; sync_id: string | null; sync_until: number; range_from: string; range_to: string };
export function platformValue(value: unknown): FeePlatform {
  if (value !== 'smartstore' && value !== 'coupang') throw new AuthError('네이버 또는 쿠팡을 선택해주세요.');
  return value;
}
function encryptionKey() {
  const raw = process.env.CALCULATOR_API_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new AuthError('API 키 저장 설정이 준비되지 않았습니다. 관리자에게 문의해주세요.', 503);
  return Buffer.from(raw, 'hex');
}
export function encryptCredentials(platform: FeePlatform, credentials: ApiCredentials) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('jeago-calculator-v1:' + platform));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
}
export function decryptCredentials(platform: FeePlatform, encrypted: string): ApiCredentials {
  const [iv, tag, body] = encrypted.split('.').map(v => Buffer.from(v, 'base64'));
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAAD(Buffer.from('jeago-calculator-v1:' + platform)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('저장된 API 키를 읽지 못했습니다. 관리자가 키를 다시 등록해주세요.', 503);
  }
}
async function authenticated(token: string | undefined) {
  const user = await sessionUser(token); if (!user) throw new AuthError('로그인이 필요합니다.', 401); return user;
}
async function connection(platform: FeePlatform): Promise<Connection | undefined> {
  return (await (await getDb()).execute({ sql: 'SELECT * FROM calculator_api_connection WHERE platform=?', args: [platform] })).rows[0] as unknown as Connection | undefined;
}
export async function calculatorApiState(token: string | undefined) {
  const user = await authenticated(token), canManage = await isAdministrator(user.id), now = Date.now();
  const platforms = await Promise.all((['smartstore', 'coupang'] as const).map(async platform => {
    const c = await connection(platform);
    return { platform, configured: !!c, revision: Number(c?.revision || 0), fees: (c ? JSON.parse(c.fees) : []) as FeeRecord[], syncedAt: Number(c?.synced_at || 0), lastError: c?.last_error || '', rangeFrom: c?.range_from || '', rangeTo: c?.range_to || '', syncing: Number(c?.sync_until || 0) > now, shouldRefresh: !!c && now - Number(c.attempted_at) > 5 * 60000 && now - Number(c.synced_at) > 24 * 3600000 };
  }));
  return { canManage, platforms };
}
export function dateRange(input: Record<string, unknown>) {
  const end = new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(end) - 6 * 86400000).toISOString().slice(0, 10);
  const from = input.from === undefined ? start : input.from, to = input.to === undefined ? end : input.to;
  const valid = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 30 || to > new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) throw new AuthError('조회 날짜는 오늘 이전의 최대 31일 범위로 입력해주세요.');
  return { from, to };
}
export async function saveCalculatorCredentials(token: string | undefined, input: Record<string, unknown>) {
  const user = await authenticated(token); if (!await isAdministrator(user.id)) throw new AuthError('관리자만 회사 API 키를 등록할 수 있습니다.', 403);
  const platform = platformValue(input.platform), prior = await connection(platform);
  if (input.revision !== Number(prior?.revision || 0)) throw new AuthError('연결 설정이 변경됐습니다. 화면을 다시 불러와주세요.', 409);
  const next = prior ? decryptCredentials(platform, prior.credentials) : {};
  const keys = platform === 'smartstore' ? ['clientId', 'clientSecret'] as const : ['accessKey', 'secretKey', 'vendorId'] as const;
  for (const key of keys) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new AuthError('API 키 형식을 확인해주세요.');
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (value) next[key] = value;
    if (!next[key] || next[key]!.length > 200 || /[\r\n]/.test(next[key]!)) throw new AuthError('필요한 API 키와 판매자 정보를 모두 입력해주세요.');
  }
  if (platform === 'smartstore' && !/^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{22}$/.test(next.clientSecret!)) throw new AuthError('네이버 커머스API 애플리케이션 시크릿을 입력해주세요.');
  if (platform === 'coupang' && (!/^[A-Za-z0-9_-]+$/.test(next.accessKey!) || !/^A\d{8}$/.test(next.vendorId!))) throw new AuthError('쿠팡 Access Key와 판매자 ID(A로 시작하는 9자리)를 확인해주세요.');
  // A changed principal must never reuse the other principal's saved secret.
  if (prior) {
    const old = decryptCredentials(platform, prior.credentials), secret = platform === 'smartstore' ? 'clientSecret' : 'secretKey';
    const changedId = platform === 'smartstore' ? next.clientId !== old.clientId : next.accessKey !== old.accessKey || next.vendorId !== old.vendorId;
    if (changedId && !input[secret]) throw new AuthError('연결 계정이 변경되면 시크릿도 함께 입력해주세요.');
  }
  const encrypted = encryptCredentials(platform, next), tx = await (await getDb()).transaction('write');
  try {
    if (!(await tx.execute({ sql: 'SELECT user_id FROM app_admin WHERE user_id=?', args: [user.id] })).rows.length) throw new AuthError('관리자 권한이 변경되었습니다.', 403);
    const current = (await tx.execute({ sql: 'SELECT revision FROM calculator_api_connection WHERE platform=?', args: [platform] })).rows[0];
    if (Number(current?.revision || 0) !== input.revision) throw new AuthError('연결 설정이 변경됐습니다. 화면을 다시 불러와주세요.', 409);
    await tx.execute({ sql: `INSERT INTO calculator_api_connection(platform,credentials,revision,updated_by) VALUES (?,?,1,?) ON CONFLICT(platform) DO UPDATE SET credentials=excluded.credentials,revision=revision+1,updated_by=excluded.updated_by,fees='[]',synced_at=0,attempted_at=0,last_error='',sync_id=NULL,sync_until=0,range_from='',range_to=''`, args: [platform, encrypted, user.id] });
    await tx.commit();
  } catch (error) { if (!tx.closed) await tx.rollback(); throw error; } finally { tx.close(); }
}
export async function disconnectCalculator(token: string | undefined, input: Record<string, unknown>) {
  const user = await authenticated(token), platform = platformValue(input.platform), tx = await (await getDb()).transaction('write');
  try {
    if (!(await tx.execute({ sql: 'SELECT user_id FROM app_admin WHERE user_id=?', args: [user.id] })).rows.length) throw new AuthError('관리자만 회사 API 연결을 해제할 수 있습니다.', 403);
    const result = await tx.execute({ sql: 'DELETE FROM calculator_api_connection WHERE platform=? AND revision=?', args: [platform, typeof input.revision === 'number' ? input.revision : -1] });
    if (!result.rowsAffected) throw new AuthError('연결 설정이 변경됐습니다. 화면을 다시 불러와주세요.', 409);
    await tx.commit();
  } catch (error) { if (!tx.closed) await tx.rollback(); throw error; } finally { tx.close(); }
}
export async function refreshCalculatorFees(token: string | undefined, input: Record<string, unknown>) {
  await authenticated(token);
  const platform = platformValue(input.platform), { from, to } = dateRange(input), c = await connection(platform);
  if (!c) throw new AuthError('관리자가 회사 API 키를 먼저 등록해주세요.');
  const now = Date.now(), id = randomUUID(), db = await getDb();
  await limitAuth('calculator-fee-refresh:' + platform, 4, 60);
  const acquired = await db.execute({ sql: 'UPDATE calculator_api_connection SET sync_id=?,sync_until=?,attempted_at=? WHERE platform=? AND revision=? AND sync_until<?', args: [id, now + 60000, now, platform, c.revision, now] });
  if (!acquired.rowsAffected) throw new AuthError('다른 직원이 수수료를 조회하고 있습니다. 잠시 후 다시 확인해주세요.', 409);
  try {
    const fees = await collectFees(platform, decryptCredentials(platform, c.credentials), from, to);
    const published = await db.execute({ sql: 'UPDATE calculator_api_connection SET fees=?,synced_at=?,range_from=?,range_to=?,last_error=\'\',sync_id=NULL,sync_until=0 WHERE platform=? AND revision=? AND sync_id=?', args: [JSON.stringify(fees), Date.now(), from, to, platform, c.revision, id] });
    if (!published.rowsAffected) throw new AuthError('조회 중 연결 설정이 변경됐습니다. 다시 조회해주세요.', 409);
    return { count: fees.length };
  } catch (error) {
    const message = error instanceof ProviderError || error instanceof AuthError ? error.message : '수수료를 조회하지 못했습니다. 잠시 후 다시 시도해주세요.';
    await db.execute({ sql: 'UPDATE calculator_api_connection SET last_error=?,sync_id=NULL,sync_until=0 WHERE platform=? AND revision=? AND sync_id=?', args: [message, platform, c.revision, id] });
    if (error instanceof AuthError) throw error;
    throw new AuthError(message, 502);
  }
}
