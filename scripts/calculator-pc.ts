import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
async function main() {
process.loadEnvFile('.env.migration.local');
process.loadEnvFile('.env.local');
const { decryptCredentials } = await import('../src/lib/calculator-api');
const { collectFees, ProviderError } = await import('../src/lib/calculator-providers');
const db = createClient({url:process.env.TURSO_DATABASE_URL!,authToken:process.env.TURSO_AUTH_TOKEN});
const runOnce = process.argv.includes('--once');
async function poll() {
  for (const c of (await db.execute('SELECT * FROM calculator_api_connection')).rows) {
    let request = String(c.sync_id || '');
    if (!request.startsWith('pc:')) {
      if (!runOnce) continue;
      if (Number(c.sync_until) > Date.now()) continue;
      const to = new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);
      const from = new Date(Date.parse(to)-6*86400000).toISOString().slice(0,10);
      request = `pc:${from}:${to}:${randomUUID()}`;
      const set = await db.execute({sql:'UPDATE calculator_api_connection SET sync_id=?,sync_until=? WHERE platform=? AND revision=? AND sync_until<?',args:[request,Date.now()+86400000,c.platform,c.revision,Date.now()]});
      if (!set.rowsAffected) continue;
    }
    const [,from,to] = request.split(':'), id=randomUUID();
    const acquired=await db.execute({sql:'UPDATE calculator_api_connection SET sync_id=?,sync_until=?,attempted_at=? WHERE platform=? AND revision=? AND sync_id=?',args:[id,Date.now()+60000,Date.now(),c.platform,c.revision,request]});
    if (!acquired.rowsAffected) continue;
    try {
      const platform = c.platform as 'smartstore'|'coupang';
      const fees=await collectFees(platform,decryptCredentials(platform,String(c.credentials)),from,to);
      const saved=await db.execute({sql:"UPDATE calculator_api_connection SET fees=?,synced_at=?,range_from=?,range_to=?,last_error='',sync_id=NULL,sync_until=0 WHERE platform=? AND revision=? AND sync_id=?",args:[JSON.stringify(fees),Date.now(),from,to,c.platform,c.revision,id]});
      console.log(`${platform}: ${saved.rowsAffected ? fees.length+' products synchronized' : 'settings changed; skipped'}`);
    } catch(error) {
      const message=error instanceof ProviderError ? error.message : '회사 PC에서 수수료 조회에 실패했습니다. 연결 프로그램을 확인해주세요.';
      await db.execute({sql:'UPDATE calculator_api_connection SET last_error=?,sync_id=NULL,sync_until=0 WHERE platform=? AND revision=? AND sync_id=?',args:[message,c.platform,c.revision,id]});
      console.log(`${c.platform}: ${message}`);
    }
  }
}
do { try { await poll(); } catch { console.log('PC connection unavailable; retrying'); } if (!runOnce) await new Promise(r=>setTimeout(r,15000)); } while(!runOnce);
db.close();

}
main().catch(() => { console.error('PC connection failed; credentials suppressed'); process.exitCode=1; });

