import type {Client} from '@libsql/client';
const initialized=new WeakMap<Client,Promise<void>>();
export async function ensureQuotation(db:Client){if(!initialized.has(db))initialized.set(db,db.batch([
"CREATE TABLE IF NOT EXISTS quotation_job (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',result TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)",
"CREATE INDEX IF NOT EXISTS quotation_job_queue ON quotation_job(status,created_at)",
"CREATE TABLE IF NOT EXISTS quotation_worker (id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL,sender TEXT NOT NULL DEFAULT '',mail_ready INTEGER NOT NULL DEFAULT 0)"
]).then(()=>{}).catch(error=>{initialized.delete(db);throw error;}));await initialized.get(db);}
