import { createHash, randomUUID } from 'node:crypto';
import { getDb } from './db';
import { AuthError, credentials, hashPassword, limitAuth, sessionUser, verifyPassword, type AccountProfile } from './auth';

export type ManagedMember = AccountProfile & { account_version: number; created_at: string; is_admin: number };
export async function isAdministrator(userId: string) {
  return (await (await getDb()).execute({ sql: 'SELECT user_id FROM app_admin WHERE singleton=1 AND user_id=?', args: [userId] })).rows.length === 1;
}
export async function requireAdministrator(token: string | undefined) {
  const user = await sessionUser(token);
  if (!user) throw new AuthError('로그인이 필요합니다.', 401);
  if (!await isAdministrator(user.id)) throw new AuthError('관리자만 이용할 수 있습니다.', 403);
  return user;
}
export async function listMembers(token: string | undefined): Promise<ManagedMember[]> {
  await requireAdministrator(token);
  return (await (await getDb()).execute('SELECT u.id,u.username,u.display_name,u.email,u.phone,u.department,u.created_at,u.account_version,EXISTS(SELECT 1 FROM app_admin a WHERE a.user_id=u.id) AS is_admin FROM app_user u ORDER BY u.created_at,u.id')).rows as unknown as ManagedMember[];
}
export async function editMember(token: string | undefined, action: 'admin-profile' | 'admin-password', fields: Record<string, unknown>) {
  const admin = await requireAdministrator(token);
  await limitAuth(`admin-edit:${admin.id}`, 20, 900);
  const password = typeof fields.admin_password === 'string' ? fields.admin_password : '';
  if (password.length < 4 || password.length > 128) throw new AuthError('관리자 비밀번호를 확인해주세요.');
  const db = await getDb();
  const adminHash = String((await db.execute({ sql: 'SELECT password_hash FROM app_user WHERE id=?', args: [admin.id] })).rows[0].password_hash);
  if (!await verifyPassword(password, adminHash)) throw new AuthError('관리자 비밀번호가 올바르지 않습니다.');
  const target = typeof fields.target_id === 'string' ? fields.target_id : '';
  if (!target || target.length > 80) throw new AuthError('수정할 회원을 선택해주세요.');
  if (target === admin.id) throw new AuthError('본인 계정은 내 계정 화면에서 수정해주세요.');
  const version = Number(fields.expected_version);
  if (fields.expected_version === undefined || !Number.isSafeInteger(version) || version < 0) throw new AuthError('최신 회원 정보를 불러와주세요.', 409);
  let profile: AccountProfile | undefined, hash: string | undefined;
  if (action === 'admin-profile') {
    const { username } = credentials({ username: fields.username, password });
    const field = (key: string, max: number) => {
      if (typeof fields[key] !== 'string' || fields[key].length > max) throw new AuthError('입력 내용을 확인해주세요.');
      return fields[key].trim();
    };
    const display_name = field('display_name', 50), email = field('email', 254), phone = field('phone', 30), department = field('department', 100);
    if (!display_name) throw new AuthError('이름을 입력해주세요.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('이메일 형식을 확인해주세요.');
    profile = { id: target, username, display_name, email, phone, department };
  } else {
    const { password: next } = credentials({ username: 'member', password: fields.new_password });
    if (next !== fields.password_confirm) throw new AuthError('새 비밀번호 확인이 일치하지 않습니다.');
    hash = await hashPassword(next);
  }
  const tx = await db.transaction('write');
  try {
    const authorized = (await tx.execute({ sql: 'SELECT u.id FROM app_user u JOIN app_admin a ON a.user_id=u.id JOIN auth_session s ON s.user_id=u.id WHERE u.id=? AND u.password_hash=? AND s.token_hash=? AND s.expires_at>?', args: [admin.id, adminHash, createHash('sha256').update(token!).digest('hex'), Date.now()] })).rows;
    if (!authorized.length) throw new AuthError('관리자 로그인 상태가 변경되었습니다. 다시 로그인해주세요.', 403);
    const row = (await tx.execute({ sql: 'SELECT account_version FROM app_user WHERE id=?', args: [target] })).rows[0];
    if (!row) throw new AuthError('회원을 찾을 수 없습니다.', 404);
    if (Number(row.account_version) !== version) throw new AuthError('회원 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 수정해주세요.', 409);
    if (profile) await tx.execute({ sql: 'UPDATE app_user SET username=?,display_name=?,email=?,phone=?,department=?,account_version=account_version+1 WHERE id=?', args: [profile.username, profile.display_name, profile.email, profile.phone, profile.department, target] });
    else {
      await tx.execute({ sql: 'UPDATE app_user SET password_hash=?,account_version=account_version+1 WHERE id=?', args: [hash!, target] });
      await tx.execute({ sql: 'DELETE FROM auth_session WHERE user_id=?', args: [target] });
    }
    await tx.execute({ sql: 'INSERT INTO admin_audit(id,actor_id,target_id,action) VALUES (?,?,?,?)', args: [randomUUID(), admin.id, target, action] });
    await tx.commit();
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    if (String((error as { code?: string }).code).startsWith('SQLITE_CONSTRAINT')) throw new AuthError('이미 사용 중인 ID입니다.', 409);
    throw error;
  } finally { tx.close(); }
}
