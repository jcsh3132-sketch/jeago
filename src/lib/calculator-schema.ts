import type { Transaction } from '@libsql/client';
export async function upgradeCalculatorAccounts(tx: Transaction) {
  const columns = (await tx.execute('PRAGMA table_info(calculator_api_connection)')).rows;
  if (columns.some(column => column.name === 'account')) return;
  await tx.execute("CREATE TABLE calculator_api_connection_next (platform TEXT NOT NULL CHECK(platform IN ('smartstore','coupang')),account INTEGER NOT NULL DEFAULT 1 CHECK(account IN (1,2)),credentials TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_by TEXT NOT NULL,fees TEXT NOT NULL DEFAULT '[]',synced_at INTEGER NOT NULL DEFAULT 0,attempted_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',sync_id TEXT,sync_until INTEGER NOT NULL DEFAULT 0,range_from TEXT NOT NULL DEFAULT '',range_to TEXT NOT NULL DEFAULT '',PRIMARY KEY(platform,account))");
  // Keep encrypted credentials and revisions; old snapshots used a different
  // averaging rule and are invalidated rather than silently treated as averages.
  await tx.execute('INSERT INTO calculator_api_connection_next(platform,account,credentials,revision,updated_by) SELECT platform,1,credentials,revision,updated_by FROM calculator_api_connection');
  await tx.execute('DROP TABLE calculator_api_connection');
  await tx.execute('ALTER TABLE calculator_api_connection_next RENAME TO calculator_api_connection');
}
