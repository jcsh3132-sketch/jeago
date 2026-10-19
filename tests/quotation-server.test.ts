import {test,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtempSync,mkdirSync} from 'node:fs';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {NextRequest} from 'next/server';
import {getDb} from '../src/lib/db';import {register,createSession,SESSION_COOKIE} from '../src/lib/auth';import {GET,POST} from '../src/app/api/quotation/route';import {quotationDb} from '../src/lib/quotation';import {quotationPdf,quotationPng,koreanAmount} from '../src/lib/quotation-server';
mkdirSync('work',{recursive:true});process.env.JEAGO_TEST_MODE='1';process.env.JEAGO_TEST_DATABASE_URL=pathToFileURL(join(mkdtempSync(join(resolve('work'),'quotation-server-')),'test.db')).href;process.env.QUOTATION_ENGINE='server';delete process.env.QUOTATION_SMTP_USER;delete process.env.QUOTATION_SMTP_PASSWORD;
after(async()=>{(await getDb()).close();});
const q={title:'서버 견적서',date:'2026-10-19',number:'2026-10-19-001',recipient:'거래처',reference:'',phone:'',fax:'',email:'',payment:'',memo:'',manager:'위조',managerPhone:'wrong',managerEmail:'wrong',items:[{name:'삼성 복합기',kind:'판매',qty:2,price:1500000,note:''}]};
function req(token:string,input?:unknown,query=''){return new NextRequest('http://localhost:3100/api/quotation'+query,{method:input?'POST':'GET',headers:{cookie:SESSION_COOKIE+'='+token,origin:'http://localhost:3100','content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});}
test('server quotation works without PC heartbeat, binds owner and remains idempotent',async()=>{
 const user=await register({username:'serverquote',password:'test-password',password_confirm:'test-password',display_name:'실제 담당자'}),token=await createSession(user.id,false);
 const db=await quotationDb();assert.equal((await db.execute('SELECT * FROM quotation_worker')).rows.length,0);
 const state=await(await GET(req(token))).json();assert.equal(state.online,true);assert.equal(state.engine,'server');assert.equal(state.configured,false);
 const id=randomUUID();assert.equal((await POST(req(token,{id,kind:'pdf',data:q}))).status,202);
 const result=await(await GET(req(token,undefined,'?id='+id))).json();assert.equal(result.status,'done');assert.equal(Buffer.from(result.result,'base64').subarray(0,4).toString(),'%PDF');
 assert.equal((await POST(req(token,{id,kind:'pdf',data:q}))).status,200);assert.equal((await db.execute('SELECT * FROM quotation_job')).rows.length,1);
 assert.equal((await POST(req(token,{id:randomUUID(),kind:'send',data:{quote:q,to:'test@example.com',body:'테스트'}}))).status,503);
});
test('server PDF renders PNG and produces integer Korean amounts',async()=>{
 assert.equal(koreanAmount(3300000),'삼백삼십만');assert.equal(koreanAmount(1222221),'일백이십이만이천이백이십일');assert.equal(koreanAmount(0),'영');
 const pdf=await quotationPdf(q);const png=await quotationPng(pdf);assert.equal(png.subarray(1,4).toString(),'PNG');
 const blank=await quotationPdf({...q,items:[{name:'',kind:'',qty:'',price:'',note:''}]});assert.ok(blank.length>10000);
});
