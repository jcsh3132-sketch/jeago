import {test,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtempSync,mkdirSync} from 'node:fs';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {NextRequest} from 'next/server';
import {getDb} from '../src/lib/db';import {register,createSession,SESSION_COOKIE} from '../src/lib/auth';import {GET,POST} from '../src/app/api/quotation/route';import {quotationDb} from '../src/lib/quotation';
mkdirSync('work',{recursive:true});process.env.JEAGO_TEST_MODE='1';process.env.JEAGO_TEST_DATABASE_URL=pathToFileURL(join(mkdtempSync(join(resolve('work'),'quotation-')),'test.db')).href;
after(async()=>{(await getDb()).close();});
const q={title:'납품 견적서',date:'2026-10-16',number:'2026-10-16-001',recipient:'거래처',reference:'',phone:'',fax:'',email:'',payment:'',memo:'',manager:'위조 담당자',managerPhone:'wrong',managerEmail:'wrong',items:[{name:'복합기',kind:'판매',qty:1,price:100000,note:''}]};
function request(token:string|undefined,input?:unknown,origin='http://localhost:3100',query=''){return new NextRequest('http://localhost:3100/api/quotation'+query,{method:input?'POST':'GET',headers:{...(token?{cookie:SESSION_COOKIE+'='+token}:{}),origin,'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});}
test('quotation jobs require authentication, bind profile, isolate owners, reject CSRF and duplicate sends',async()=>{
 assert.equal((await GET(request(undefined))).status,401);
 const a=await register({username:'quotation1',password:'test-password',password_confirm:'test-password',display_name:'담당자1'});const b=await register({username:'quotation2',password:'test-password',password_confirm:'test-password',display_name:'담당자2'});const token=await createSession(a.id,false),other=await createSession(b.id,false);const db=await quotationDb();await db.execute({sql:'UPDATE app_user SET phone=?,email=? WHERE id=?',args:['010-1111-2222','staff@example.com',a.id]});
 const id=randomUUID(),input={id,kind:'send',data:{quote:q,to:'customer@example.com',subject:'위조 제목',body:'감사합니다'}};
 assert.equal((await POST(request(token,input,'https://attacker.example'))).status,403);
 assert.equal((await POST(request(token,input))).status,503);
 await db.execute({sql:'INSERT INTO quotation_worker(id,last_seen,sender,mail_ready) VALUES(1,?,?,1)',args:[Date.now(),'company@naver.com']});
 const state=await(await GET(request(token))).json();assert.equal(state.profile.name,'담당자1');assert.equal(state.profile.email,'staff@example.com');assert.equal(state.online,true);
 assert.equal((await POST(request(token,input))).status,202);assert.equal((await POST(request(token,input))).status,200);assert.equal((await GET(request(other,undefined,undefined,'?id='+id))).status,404);
 const jobs=await db.execute('SELECT payload FROM quotation_job');assert.equal(jobs.rows.length,1);const saved=JSON.parse(String(jobs.rows[0].payload));assert.equal(saved.quote.manager,'담당자1');assert.equal(saved.quote.managerPhone,'010-1111-2222');assert.equal(saved.quote.managerEmail,'staff@example.com');assert.equal(saved.subject,q.title);assert.equal(saved.password,undefined);
 const invalid={...input,id:randomUUID(),data:{...input.data,quote:{...q,title:'invalid/title'}}};assert.equal((await POST(request(token,invalid))).status,400);
 const blank={...q,items:[{name:'',kind:'',qty:'',price:'',note:''}]};assert.equal((await POST(request(token,{id:randomUUID(),kind:'pdf',data:blank}))).status,202);
});
