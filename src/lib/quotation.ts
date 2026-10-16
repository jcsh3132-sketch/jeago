import {AuthError,type AccountProfile} from './auth';
import {getDb} from './db';
import {ensureQuotation} from './quotation-schema';
export async function quotationDb(){const db=await getDb();await ensureQuotation(db);return db;}
export async function quotationProfile(userId:string){const row=(await(await getDb()).execute({sql:'SELECT id,username,display_name,email,phone,department FROM app_user WHERE id=?',args:[userId]})).rows[0];if(!row)throw new AuthError('로그인이 필요합니다.',401);return row as unknown as AccountProfile;}
export function quotationInput(kind:string,data:Record<string,unknown>,profile:AccountProfile){
 if(!['pdf','preview','send'].includes(kind))throw new AuthError('지원하지 않는 요청입니다.');
 const q=(kind==='send'?data.quote:data) as Record<string,unknown>;
 if(!q||typeof q!=='object'||Array.isArray(q))throw new AuthError('견적 내용을 확인해주세요.');
 const fields=['title','number','date','recipient','reference','phone','fax','email','payment','memo'];
 const clean:Record<string,unknown>={};for(const key of fields){if(q[key]!==undefined&&typeof q[key]!=='string')throw new AuthError('입력 형식을 확인해주세요.');clean[key]=String(q[key]||'').trim();if(String(clean[key]).length>(key==='memo'||key==='payment'?2000:150))throw new AuthError('입력 내용이 너무 깁니다.');}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(clean.date)))throw new AuthError('견적 일자를 확인해주세요.');
 if(!Array.isArray(q.items)||!q.items.length||q.items.length>12)throw new AuthError('품목은 1~12개까지 입력해주세요.');
 clean.items=q.items.map((item:Record<string,unknown>)=>{if(!item||typeof item!=='object')throw new AuthError('품목 내용을 확인해주세요.');const result:Record<string,unknown>={};for(const key of ['name','kind','note']){if(typeof item[key]!=='string'||item[key].length>150)throw new AuthError('품목 내용을 확인해주세요.');result[key]=item[key];}for(const key of ['qty','price']){const n=item[key];if(n!==''&&(!Number.isSafeInteger(n)||Number(n)<0||Number(n)>1e10))throw new AuthError('수량과 단가를 확인해주세요.');result[key]=n;}if(kind==='send'&&(!String(result.name).trim()||Number(result.qty)<1))throw new AuthError('품명과 수량을 입력해주세요.');return result;});
 Object.assign(clean,{manager:profile.display_name,managerPhone:profile.phone,managerEmail:profile.email,accountUsername:profile.username});
 if(kind!=='send')return clean;
 const title=String(clean.title);if(!title||title.length>100||/[\\/:*?"<>|\x00-\x1f]/.test(title)||/[. ]$/.test(title)||!clean.recipient)throw new AuthError('거래처명과 올바른 견적서 제목을 입력해주세요.');
 if(typeof data.to!=='string'||data.to.length>254||!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(data.to)||typeof data.body!=='string'||data.body.length>10000)throw new AuthError('받는 사람과 메일 내용을 확인해주세요.');
 return {quote:clean,to:data.to,subject:title,body:data.body};
}
