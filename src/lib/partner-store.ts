import type { Transaction } from '@libsql/client';
import { cleanPartnerName, partnerKey } from './partner-names';

// Preserve the high-water mark after permanent deletion: stale forms must never
// address a new model/category/partner that happens to reuse an old integer ID.
export async function nextInventoryId(tx: Transaction, table: 'item' | 'category' | 'partner') {
  const result = await tx.execute({ sql: `INSERT INTO inventory_sequence(name,value) VALUES (?,(SELECT COALESCE(MAX(id),0)+1 FROM ${table})) ON CONFLICT(name) DO UPDATE SET value=MAX(value+1,(SELECT COALESCE(MAX(id),0)+1 FROM ${table})) RETURNING value`, args: [table] });
  return Number(result.rows[0].value);
}
export async function existingPartner(tx: Transaction, name: string, except = 0) {
  const rows = (await tx.execute({ sql: 'SELECT id,name FROM partner WHERE deleted_at IS NULL AND id<>? ORDER BY id', args: [except] })).rows;
  return rows.find(row => partnerKey(String(row.name)) === partnerKey(name));
}
export async function ensurePartner(tx: Transaction, name: string) {
  const existing = await existingPartner(tx, name);
  if (existing) return String(existing.name);
  const clean = cleanPartnerName(name);
  await tx.execute({ sql: "INSERT INTO partner(id,name,contact_person,phone,note,created_at) VALUES (?,?,'','','',CURRENT_TIMESTAMP)", args: [await nextInventoryId(tx, 'partner'), clean] });
  return clean;
}
export async function importHistoricalPartners(tx: Transaction) {
  if ((await tx.execute("SELECT name FROM inventory_migration WHERE name='outbound-partners-v1'")).rows.length) return;
  const names = (await tx.execute('SELECT DISTINCT customer_name FROM "transaction" WHERE transaction_type=\'출고\' AND customer_name IS NOT NULL ORDER BY customer_name')).rows;
  // Do not undo a deliberate prior move to the trash during historical import.
  const excluded = new Set((await tx.execute('SELECT name FROM partner WHERE deleted_at IS NOT NULL')).rows.map(row => partnerKey(String(row.name))));
  for (const row of names) {
    const name = cleanPartnerName(String(row.customer_name));
    if (name && name.length <= 120 && !excluded.has(partnerKey(name))) await ensurePartner(tx, name);
  }
  await tx.execute("INSERT INTO inventory_migration(name) VALUES ('outbound-partners-v1')");
}
