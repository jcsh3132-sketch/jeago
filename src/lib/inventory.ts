import type { Transaction } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { MANAGERS, type Category, type Item, type Partner, type StockTransaction, type InventoryData } from './types';

export class InputError extends Error {}
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
  const r = await tx.execute({ sql: 'SELECT * FROM category WHERE id=?', args: [id] });
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
  const r = await tx.execute({ sql: 'SELECT * FROM category WHERE name=?', args: [key] });
  if (!r.rows.length || await depth(tx, r.rows[0] as unknown as Category) !== 2) throw new InputError('품목 카테고리를 선택하세요.');
}
async function item(tx: Transaction, id: number): Promise<Item> {
  const r = await tx.execute({ sql: 'SELECT * FROM item WHERE id=?', args: [id] });
  if (!r.rows.length) throw new InputError('모델을 찾을 수 없습니다.');
  return r.rows[0] as unknown as Item;
}
async function noDuplicate(tx: Transaction, parent: number | null, name: string, except = 0) {
  const r = await tx.execute({ sql: 'SELECT id, name, display_name FROM category WHERE parent_id IS ? AND id != ?', args: [parent, except] });
  if (r.rows.some(c => String(c.display_name || c.name).toLocaleLowerCase() === name.toLocaleLowerCase())) throw new InputError('같은 위치에 동일한 이름의 카테고리가 있습니다.');
}
async function deleteItem(tx: Transaction, id: number) {
  await item(tx, id);
  await tx.execute({ sql: 'DELETE FROM "transaction" WHERE item_id=?', args: [id] });
  await tx.execute({ sql: 'DELETE FROM item WHERE id=?', args: [id] });
}
export async function loadInventory(): Promise<InventoryData> {
  const db = await getDb();
  const [categories, items, partners, transactions] = await db.batch([
    'SELECT * FROM category ORDER BY id', 'SELECT * FROM item ORDER BY name,id',
    'SELECT * FROM partner ORDER BY name,id', 'SELECT * FROM "transaction" ORDER BY date,id',
  ], 'read');
  return { categories: categories.rows as unknown as Category[], items: items.rows as unknown as Item[], partners: partners.rows as unknown as Partner[], transactions: transactions.rows as unknown as StockTransaction[] };
}
export async function mutate(f: Fields): Promise<{ message: string; redirect?: string }> {
  const action = text(f, 'action', 40);
  const db = await getDb();
  // A write transaction serializes read/modify/write operations, including stock checks.
  const tx = await db.transaction('write');
  let redirect: string | undefined;
  try {
    if (action === 'item.add' || action === 'item.edit') {
      const name = text(f, 'name', 100), category = text(f, 'category'), owner = manager(f);
      await leaf(tx, category);
      let id: number;
      if (action === 'item.add') {
        const r = await tx.execute({ sql: 'INSERT INTO item(name,manager,category,quantity,low_stock_threshold) VALUES (?,?,?,0,5)', args: [name, owner, category] });
        id = Number(r.lastInsertRowid);
      } else {
        id = integer(f.id); await item(tx, id);
        await tx.execute({ sql: 'UPDATE item SET name=?, manager=?, category=? WHERE id=?', args: [name, owner, category, id] });
      }
      redirect = `/?category=${encodeURIComponent(category)}&item=${id}#item-${id}`;
    } else if (action === 'item.delete') {
      await deleteItem(tx, integer(f.id));
    } else if (action === 'item.threshold') {
      const id = integer(f.id), value = integer(f.threshold, 0, 999); await item(tx, id);
      await tx.execute({ sql: 'UPDATE item SET low_stock_threshold=? WHERE id=?', args: [value, id] });
    } else if (action === 'item.category') {
      const id = integer(f.id), category = text(f, 'category'); await item(tx, id); await leaf(tx, category);
      await tx.execute({ sql: 'UPDATE item SET category=? WHERE id=?', args: [category, id] });
    } else if (action === 'stock.in' || action === 'stock.out') {
      const id = integer(f.id), qty = integer(f.quantity), owner = manager(f), current = await item(tx, id);
      const outbound = action === 'stock.out';
      const customer = outbound ? text(f, 'customer_name') : '';
      if (outbound && qty > current.quantity) throw new InputError('출고 수량이 현재 재고보다 많습니다.');
      const remaining = current.quantity + (outbound ? -qty : qty);
      if (!Number.isSafeInteger(remaining) || remaining > 2147483647) throw new InputError('재고 수량이 허용 범위를 초과합니다.');
      await tx.execute({ sql: 'UPDATE item SET quantity=? WHERE id=?', args: [remaining, id] });
      await tx.execute({ sql: 'INSERT INTO "transaction"(item_id,quantity,transaction_type,manager,customer_name,date) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)', args: [id, qty, outbound ? '출고' : '입고', owner, customer || null] });
      redirect = `/?category=${encodeURIComponent(current.category)}&item=${id}#item-${id}`;
    } else if (action === 'partner.add' || action === 'partner.edit') {
      const values = [text(f, 'name'), text(f, 'contact_person', 80, false), text(f, 'phone', 50, false), text(f, 'note', 255, false)];
      if (action === 'partner.add') await tx.execute({ sql: 'INSERT INTO partner(name,contact_person,phone,note,created_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)', args: values });
      else {
        const r = await tx.execute({ sql: 'UPDATE partner SET name=?,contact_person=?,phone=?,note=? WHERE id=?', args: [...values, integer(f.id)] });
        if (!r.rowsAffected) throw new InputError('거래처를 찾을 수 없습니다.');
      }
    } else if (action === 'partner.delete') {
      const r = await tx.execute({ sql: 'DELETE FROM partner WHERE id=?', args: [integer(f.id)] });
      if (!r.rowsAffected) throw new InputError('거래처를 찾을 수 없습니다.');
    } else if (action === 'category.add') {
      const name = text(f, 'name', 80), level = integer(f.level, 0, 2);
      const parent = level === 0 ? null : integer(f.parent_id);
      if (parent !== null && await depth(tx, await node(tx, parent)) !== level - 1) throw new InputError('상위 카테고리를 확인하세요.');
      await noDuplicate(tx, parent, name);
      await tx.execute({ sql: 'INSERT INTO category(name,display_name,parent_id,created_at) VALUES (?,?,?,CURRENT_TIMESTAMP)', args: [`category_${randomUUID()}`, name, parent] });
    } else if (action === 'category.rename') {
      const id = integer(f.id), current = await node(tx, id), name = text(f, 'name', 80);
      await noDuplicate(tx, current.parent_id, name, id);
      await tx.execute({ sql: 'UPDATE category SET display_name=? WHERE id=?', args: [name, id] });
    } else if (action === 'category.move') {
      const id = integer(f.id), current = await node(tx, id), target = await node(tx, integer(f.parent_id));
      const level = await depth(tx, current);
      if (level === 0 || await depth(tx, target) !== level - 1) throw new InputError('이동할 상위 카테고리를 확인하세요.');
      await noDuplicate(tx, target.id, current.display_name || current.name, id);
      await tx.execute({ sql: 'UPDATE category SET parent_id=? WHERE id=?', args: [target.id, id] });
    } else if (action === 'category.delete') {
      const id = integer(f.id), current = await node(tx, id), level = await depth(tx, current);
      const children = await tx.execute({ sql: 'SELECT * FROM category WHERE parent_id=?', args: [id] });
      if (level === 0 && children.rows.length) throw new InputError('장비 모델을 먼저 이동하거나 삭제하세요.');
      const leaves = level === 1 ? children.rows as unknown as Category[] : [current];
      for (const c of leaves) {
        const items = await tx.execute({ sql: 'SELECT id FROM item WHERE category=?', args: [c.name] });
        for (const i of items.rows) await deleteItem(tx, Number(i.id));
        if (c.id !== id) await tx.execute({ sql: 'DELETE FROM category WHERE id=?', args: [c.id] });
      }
      await tx.execute({ sql: 'DELETE FROM category WHERE id=?', args: [id] });
    } else throw new InputError('지원하지 않는 요청입니다.');
    await tx.commit();
    return { message: action.endsWith('.delete') ? '삭제했습니다.' : '저장했습니다.', redirect };
  } catch (e) { await tx.rollback(); throw e; }
  finally { tx.close(); }
}
