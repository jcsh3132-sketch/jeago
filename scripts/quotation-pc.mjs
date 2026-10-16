import {createClient} from '@libsql/client';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.loadEnvFile(path.join(root,'.env.migration.local'));
const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
const base='http://127.0.0.1:3332';
await db.batch([
"CREATE TABLE IF NOT EXISTS quotation_job (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',result TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
"CREATE INDEX IF NOT EXISTS quotation_job_queue ON quotation_job(status,created_at)",
"CREATE TABLE IF NOT EXISTS quotation_worker (id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL,sender TEXT NOT NULL DEFAULT '',mail_ready INTEGER NOT NULL DEFAULT 0)"
]);
async function heartbeat(){const r=await fetch(base+'/mail-config',{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('LOCAL_OFFLINE');const state=await r.json();await db.execute({sql:'INSERT INTO quotation_worker(id,last_seen,sender,mail_ready) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,sender=excluded.sender,mail_ready=excluded.mail_ready',args:[Date.now(),String(state.sender||''),state.configured?1:0]});}
let heartbeatBusy=false;const timer=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{await heartbeat();}catch{}finally{heartbeatBusy=false;}},5000);
let lastMaintenance=0;
async function poll(){
 const now=Date.now();
 if(now-lastMaintenance>60000){lastMaintenance=now;
 await db.execute({sql:"UPDATE quotation_job SET status='error',payload='',error=CASE WHEN kind='send' THEN '발송 결과를 확인하지 못했습니다. 재발송 전 보낸메일함을 확인해주세요.' ELSE '처리 시간이 초과되었습니다. 다시 시도해주세요.' END,updated_at=? WHERE status IN ('queued','running') AND created_at<?",args:[now,now-120000]});
 await db.execute({sql:'DELETE FROM quotation_job WHERE updated_at<?',args:[now-30*60000]});}
 const jobs=(await db.execute("SELECT id,kind,payload FROM quotation_job WHERE status='queued' ORDER BY created_at LIMIT 1")).rows;
 for(const job of jobs){const claim=await db.execute({sql:"UPDATE quotation_job SET status='running',updated_at=? WHERE id=? AND status='queued'",args:[Date.now(),job.id]});if(!claim.rowsAffected)continue;
 try{if(!['pdf','preview','send'].includes(String(job.kind)))throw Error('INVALID');const r=await fetch(base+'/'+job.kind,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:String(job.payload),signal:AbortSignal.timeout(85000)});if(!r.ok){let message='견적서 처리에 실패했습니다.';try{message=(await r.json()).message||message;}catch{}throw Error(message);}const result=job.kind==='send'?'':Buffer.from(await r.arrayBuffer()).toString('base64');if(result.length>4_000_000)throw Error('파일이 너무 큽니다.');await db.execute({sql:"UPDATE quotation_job SET status='done',payload='',result=?,updated_at=? WHERE id=? AND status='running'",args:[result,Date.now(),job.id]});console.log('Quotation '+job.kind+' completed');}
 catch(e){const message=job.kind==='send'?'메일 발송 결과를 확인하지 못했습니다. 중복 발송을 방지하기 위해 보낸메일함을 확인해주세요.':'견적서 처리에 실패했습니다. 회사 PC 연결을 확인하고 다시 시도해주세요.';await db.execute({sql:"UPDATE quotation_job SET status='error',payload='',error=?,updated_at=? WHERE id=? AND status='running'",args:[message,Date.now(),job.id]});console.log('Quotation processing failed; private details suppressed');}
 }
}
await heartbeat();
console.log('Quotation PC connection started');
while(true){try{await poll();}catch{console.log('Quotation PC connection unavailable; retrying');}await new Promise(resolve=>setTimeout(resolve,1000));}
