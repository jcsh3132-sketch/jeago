import type { Transaction } from '@libsql/client';
import type { User } from './auth';
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from './db';
import { MANAGERS, type Category, type Item, type Partner, type StockTransaction, type InventoryData } from './types';

export class InputError extends Error {}
export class ConflictError extends InputError {}
export const ACTIONS = ['item.add', 'item.edit', 'item.delete', 'item.threshold', 'item.category', 'stock.in', 'stock.out', 'partner.add', 'partner.edit', 'partner.delete', 'category.add', 'category.rename', 'category.move', 'category.delete', 'trash.restore'];
type Fields = Record<string, unknown>;
function text(f: Fields, key: string, max = 120, required = true): string {
  const v = f[key];
  if (v != null && typeof v !== 'string') throw new InputError('입력 형식이 올바르지 않습니다.');
  const s = (v as string | undefined)?.trim() || '';
  if ((required && !s) || s.length > max) throw new InputError(`입력 내용을 확인하세요. (${key}, 최대 ${max}자)`);
  return s;
}
function integer(v: unknown, min = 1, max = 2147483647): number {
  if ((typeof v !== 'string' && typeof v !== 'number') || !/^\d+$/.test(String(v))) throw new InputError('올바른 정수를 입력하세요.');
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new InputError(`${min}~${max} 사이의 정수를 입력하세요.`);
  return n;
}
function manager(f: Fields) {
  const m = text(f, 'manager', 50);
  if (!MANAGERS.includes(m)) throw new InputError('담당자를 선택하세요.');
  return m;
}
async function node(tx: Transaction, id: number): Promise<Category> {
  const r = await tx.execute({ sql: 'SELECT * FROM category WHERE id=? AND deleted_at IS NULL', args: [id] });
  if (!r.rows.length) throw new InputError('카테고리를 찾을 수 없습니다.');
  return r.rows[0] as unknown as Category;
}
async function depth(tx: Transaction, c: Category) {
  let d = 0;
  while (c.parent_id !== null) {
    c = await node(tx, c.parent_id);
    if (++d > 2) throw new InputError('카테고리 계층이 올바르지 않습니다.');
  }
  return d;
}
async function leaf(tx: Transaction, key: string) {
  const r = await tx.execute({ sql: 'SELECT * FROM category WHERE name=? AND deleted_at IS NULL', args: [key] });
  if (!r.rows.length || await depth(tx, r.rows[0] as unknown as Category) !== 2) throw new InputError('품목 카테고리를 선택하세요.');
}
async function item(tx: Transaction, id: number): Promise<Item> {
  const r = await tx.execute({ sql: 'SELECT * FROM item WHERE id=? AND deleted_at IS NULL', args: [id] });
  if (!r.rows.length) throw new InputError('모델을 찾을 수 없습니다.');
  return r.rows[0] as unknown as Item;
}
async function noDuplicate(tx: Transaction, parent: number | null, name: string, except = 0) {
  const r = await tx.execute({ sql: 'SELECT id, name, display_name FROM category WHERE parent_id IS ? AND id != ? AND deleted_at IS NULL', args: [parent, except] });
  if (r.rows.some(c => String(c.display_name || c.name).toLocaleLowerCase() === name.toLocaleLowerCase())) throw new InputError('같은 위치에 동일한 이름의 카테고리가 있습니다.');
}
function checkVersion(f: Fields, current: { version: number }) {
  if (f.expected_version !== undefined && integer(f.expected_version, 0) !== current.version) {
    throw new ConflictError('다른 사용자가 변경했습니다. 최신 내용을 불러온 뒤 다시 입력하세요.');
  }
}
async function archive(tx: Transaction, table: 'item' | 'partner', id: number, name: string) {
  const group = randomUUID();
  await tx.batch([
    { sql: 'INSERT INTO trash_entry(id,kind,name) VALUES (?,?,?)', args: [group, table, name] },
    { sql: `UPDATE ${table} SET deleted_at=CURRENT_TIMESTAMP,trash_group=?,version=version+1 WHERE id=? AND deleted_at IS NULL`, args: [group, id] },
  ]);
}
async function restoreTrash(tx: Transaction, group: string) {
  const entry = await tx.execute({ sql: 'SELECT id FROM trash_entry WHERE id=? AND restored_at IS NULL', args: [group] });
  if (!entry.rows.length) throw new InputError('복구할 항목이 없거나 이미 복구되었습니다.');
  const rows = (await tx.execute({ sql: 'SELECT * FROM category WHERE deleted_at IS NULL OR trash_group=?', args: [group] })).rows;
  const categories = rows as unknown as (Category & { trash_group: string | null })[];
  const byId = new Map(categories.map(c => [c.id, c]));
  const categoryDepth = (c: Category) => {
    let depth = 0;
    while (c.parent_id !== null) {
      const parent = byId.get(c.parent_id);
      if (!parent || ++depth > 2) throw new InputError('상위 카테고리를 먼저 복구하세요.');
      c = parent;
    }
    return depth;
  };
  for (const c of categories.filter(c => c.trash_group === group)) {
    categoryDepth(c);
    if (categories.some(other => other.id !== c.id && other.parent_id === c.parent_id && (other.display_name || other.name).toLowerCase() === (c.display_name || c.name).toLowerCase())) throw new InputError('같은 이름의 카테고리가 있습니다. 이름을 변경한 뒤 복구하세요.');
  }
  const items = await tx.execute({ sql: 'SELECT DISTINCT category FROM item WHERE trash_group=? AND deleted_at IS NOT NULL', args: [group] });
  for (const row of items.rows) {
    const c = categories.find(c => c.name === row.category);
    if (!c || categoryDepth(c) !== 2) throw new InputError('품목 카테고리를 먼저 복구하세요.');
  }
  await tx.batch([
    ...['category', 'item', 'partner'].map(table => ({ sql: `UPDATE ${table} SET deleted_at=NULL,trash_group=NULL,version=version+1 WHERE trash_group=?`, args: [group] })),
    { sql: 'UPDATE trash_entry SET restored_at=CURRENT_TIMESTAMP WHERE id=?', args: [group] },
  ]);
}
export type TrashEntry = { id: string; kind: string; name: string; deleted_at: string; items: number; categories: number; partners: number };
export async function loadTrash(): Promise<TrashEntry[]> {
  const result = await (await getDb()).execute(`SELECT e.*,
    (SELECT COUNT(*) FROM item WHERE trash_group=e.id) AS items,
    (SELECT COUNT(*) FROM category WHERE trash_group=e.id) AS categories,
    (SELECT COUNT(*) FROM partner WHERE trash_group=e.id) AS partners
    FROM trash_entry e WHERE restored_at IS NULL ORDER BY deleted_at DESC,id`);
  return result.rows as unknown as TrashEntry[];
}
export async function loadInventory({ history = true } = {}): Promise<InventoryData> {
  const db = await getDb();
  const [categories, items, partners, transactions] = await db.batch([
    'SELECT * FROM category WHERE deleted_at IS NULL ORDER BY id', 'SELECT * FROM item WHERE deleted_at IS NULL ORDER BY name,id',
    'SELECT * FROM partner WHERE deleted_at IS NULL ORDER BY name,id', history ? 'SELECT t.* FROM "transaction" t JOIN item i ON i.id=t.item_id WHERE i.deleted_at IS NULL ORDER BY t.date,t.id' : 'SELECT * FROM "transaction" WHERE 0',
  ], 'read');
  return { categories: categories.rows as unknown as Category[], items: items.rows as unknown as Item[], partners: partners.rows as unknown as Partner[], transactions: transactions.rows as unknown as StockTransaction[] };
}
export async function mutate(f: Fields, actor?: Pick<User, 'id' | 'display_name'>): Promise<{ message: string; redirect?: string }> {
  // Only the server's verified session supplies the stock operator. Client
  // manager/actor fields cannot impersonate another member, including retries.
  if (actor) f = { ...f, actor_id: actor.id, ...(['stock.in', 'stock.out'].includes(String(f.action)) ? { manager: actor.display_name } : {}) };
  const action = text(f, 'action', 40);
  if (!ACTIONS.includes(action)) throw new InputError('지원하지 않는 요청입니다.');
  const requestId = text(f, 'request_id', 80, false);
  const payload = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(f).filter(([key]) => key !== 'request_id').sort(([a], [b]) => a.localeCompare(b))))).digest('hex');
  const db = await getDb();
  // A write transaction serializes read/modify/write operations, including stock checks.
  // SQLite can reject a simultaneous BEGIN before either request reaches its
  // idempotency check. Retry only acquisition, never an ambiguous commit.
  const beginWrite = async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction('write'); }
      catch (error) {
        if (attempt >= 5 || (error as { code?: string }).code !== 'SQLITE_BUSY') throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }
  };
  const tx = await beginWrite();
  let redirect: string | undefined;
  try {
    if (requestId) {
      const prior = await tx.execute({ sql: 'SELECT payload,result FROM mutation_request WHERE id=?', args: [requestId] });
      if (prior.rows.length) {
        if (prior.rows[0].payload !== payload) throw new ConflictError('이전 요청과 입력 내용이 다릅니다. 최신 내용을 불러오세요.');
        await tx.rollback();
        return JSON.parse(String(prior.rows[0].result));
      }
    }
    if (action === 'item.add' || action === 'item.edit') {
      const name = text(f, 'name', 100), category = text(f, 'category'), owner = manager(f);
      await leaf(tx, category);
      let id: number;
      if (action === 'item.add') {
        const r = await tx.execute({ sql: 'INSERT INTO item(name,manager,category,quantity,low_stock_threshold) VALUES (?,?,?,0,5)', args: [name, owner, category] });
        id = Number(r.lastInsertRowid);
      } else {
        id = integer(f.id); checkVersion(f, await item(tx, id));
        await tx.execute({ sql: 'UPDATE item SET name=?, manager=?, category=?,version=version+1 WHERE id=?', args: [name, owner, category, id] });
      }
      redirect = `/?category=${encodeURIComponent(category)}&item=${id}#item-${id}`;
    } else if (action === 'item.delete') {
      const current = await item(tx, integer(f.id)); checkVersion(f, current);
      await archive(tx, 'item', current.id, current.name);
    } else if (action === 'item.threshold') {
      const id = integer(f.id), value = integer(f.threshold, 0, 999); checkVersion(f, await item(tx, id));
      await tx.execute({ sql: 'UPDATE item SET low_stock_threshold=?,version=version+1 WHERE id=?', args: [value, id] });
    } else if (action === 'item.category') {
      const id = integer(f.id), category = text(f, 'category'); checkVersion(f, await item(tx, id)); await leaf(tx, category);
      await tx.execute({ sql: 'UPDATE item SET category=?,version=version+1 WHERE id=?', args: [category, id] });
    } else if (action === 'stock.in' || action === 'stock.out') {
      const id = integer(f.id), qty = integer(f.quantity), owner = actor ? actor.display_name : manager(f), current = await item(tx, id);
      checkVersion(f, current);
      const outbound = action === 'stock.out';
      const customer = outbound ? text(f, 'customer_name') : '';
      if (outbound && qty > current.quantity) throw new InputError('출고 수량이 현재 재고보다 많습니다.');
      const remaining = current.quantity + (outbound ? -qty : qty);
      if (!Number.isSafeInteger(remaining) || remaining > 2147483647) throw new InputError('재고 수량이 허용 범위를 초과합니다.');
      await tx.execute({ sql: 'UPDATE item SET quantity=?,version=version+1 WHERE id=?', args: [remaining, id] });
      await tx.execute({ sql: 'INSERT INTO "transaction"(item_id,quantity,transaction_type,manager,customer_name,date) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)', args: [id, qty, outbound ? '출고' : '입고', owner, customer || null] });
      redirect = `/?category=${encodeURIComponent(current.category)}&item=${id}#item-${id}`;
    } else if (action === 'partner.add' || action === 'partner.edit') {
      const values = [text(f, 'name'), text(f, 'contact_person', 80, false), text(f, 'phone', 50, false), text(f, 'note', 255, false)];
      if (action === 'partner.add') await tx.execute({ sql: 'INSERT INTO partner(name,contact_person,phone,note,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)', args: values });
      else {
        const current = await tx.execute({ sql: 'SELECT version FROM partner WHERE id=? AND deleted_at IS NULL', args: [integer(f.id)] });
        if (!current.rows.length) throw new InputError('거래처를 찾을 수 없습니다.');
        checkVersion(f, { version: Number(current.rows[0].version) });
        const r = await tx.execute({ sql: 'UPDATE partner SET name=?,contact_person=?,phone=?,note=?,version=version+1 WHERE id=? AND deleted_at IS NULL', args: [...values, integer(f.id)] });
        if (!r.rowsAffected) throw new InputError('거래처를 찾을 수 없습니다.');
      }
    } else if (action === 'partner.delete') {
      const r = await tx.execute({ sql: 'SELECT * FROM partner WHERE id=? AND deleted_at IS NULL', args: [integer(f.id)] });
      if (!r.rows.length) throw new InputError('거래처를 찾을 수 없습니다.');
      checkVersion(f, { version: Number(r.rows[0].version) });
      await archive(tx, 'partner', integer(f.id), String(r.rows[0].name));
    } else if (action === 'category.add') {
      const name = text(f, 'name', 80), level = integer(f.level, 0, 2);
      const parent = level === 0 ? null : integer(f.parent_id);
      if (parent !== null && await depth(tx, await node(tx, parent)) !== level - 1) throw new InputError('상위 카테고리를 확인하세요.');
      await noDuplicate(tx, parent, name);
      await tx.execute({ sql: 'INSERT INTO category(name,display_name,parent_id,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)', args: [`category_${randomUUID()}`, name, parent] });
    } else if (action === 'category.rename') {
      const id = integer(f.id), current = await node(tx, id), name = text(f, 'name', 80);
      checkVersion(f, current);
      await noDuplicate(tx, current.parent_id, name, id);
      await tx.execute({ sql: 'UPDATE category SET display_name=?,version=version+1 WHERE id=?', args: [name, id] });
    } else if (action === 'category.move') {
      const id = integer(f.id), current = await node(tx, id), target = await node(tx, integer(f.parent_id));
      checkVersion(f, current);
      const level = await depth(tx, current);
      if (level === 0 || await depth(tx, target) !== level - 1) throw new InputError('이동할 상위 카테고리를 확인하세요.');
      await noDuplicate(tx, target.id, current.display_name || current.name, id);
      await tx.execute({ sql: 'UPDATE category SET parent_id=?,version=version+1 WHERE id=?', args: [target.id, id] });
    } else if (action === 'category.delete') {
      const id = integer(f.id), current = await node(tx, id), level = await depth(tx, current);
      checkVersion(f, current);
      const children = await tx.execute({ sql: 'SELECT * FROM category WHERE parent_id=? AND deleted_at IS NULL', args: [id] });
      if (level === 0 && children.rows.length) throw new InputError('장비 모델을 먼저 이동하거나 삭제하세요.');
      const nodes = [current, ...(level === 1 ? children.rows as unknown as Category[] : [])];
      const group = randomUUID(), placeholders = nodes.map(() => '?').join(',');
      await tx.batch([
        { sql: 'INSERT INTO trash_entry(id,kind,name) VALUES (?,?,?)', args: [group, 'category', current.display_name || current.name] },
        { sql: `UPDATE item SET deleted_at=CURRENT_TIMESTAMP,trash_group=?,version=version+1 WHERE deleted_at IS NULL AND category IN (${placeholders})`, args: [group, ...nodes.map(c => c.name)] },
        { sql: `UPDATE category SET deleted_at=CURRENT_TIMESTAMP,trash_group=?,version=version+1 WHERE id IN (${placeholders})`, args: [group, ...nodes.map(c => c.id)] },
      ]);
    } else if (action === 'trash.restore') {
      await restoreTrash(tx, text(f, 'group_id', 80));
    } else throw new InputError('지원하지 않는 요청입니다.');
    const result = { message: action === 'trash.restore' ? '복구했습니다.' : action.endsWith('.delete') ? '휴지통으로 이동했습니다.' : '저장했습니다.', redirect };
    if (requestId) await tx.execute({ sql: 'INSERT INTO mutation_request(id,payload,result) VALUES (?,?,?)', args: [requestId, payload, JSON.stringify(result)] });
    await tx.commit();
    return result;
  } catch (e) { if (!tx.closed) await tx.rollback(); throw e; }
  finally { tx.close(); }
}
