import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,rgb,type PDFFont} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import nodemailer from 'nodemailer';
const asset=(name:string)=>path.join(process.cwd(),'src/quotation-server',name);
const quoteAsset=(name:string)=>path.join(process.cwd(),'src/quotation',name);
export type Quote={title:string;number:string;date:string;recipient:string;reference:string;phone:string;fax:string;email:string;payment:string;memo:string;manager:string;managerPhone:string;managerEmail:string;items:{name:string;kind:string;qty:number|'';price:number|'';note:string}[]};
export function serverQuotationEnabled(){return process.env.QUOTATION_ENGINE==='server';}
export function quotationMailReady(){return !!(process.env.QUOTATION_SMTP_USER&&process.env.QUOTATION_SMTP_PASSWORD);}
export function koreanAmount(value:number):string{
 if(!Number.isSafeInteger(value)||value<0)throw Error('INVALID_AMOUNT');if(!value)return '영';
 const digits=['','일','이','삼','사','오','육','칠','팔','구'],small=['','십','백','천'],large=['','만','억','조','경'];let result='',group=0;
 while(value){let part=value%10000,text='';for(let i=0;i<4;i++){const n=part%10;if(n)text=digits[n]+small[i]+text;part=Math.floor(part/10);}if(text)result=text+large[group]+result;value=Math.floor(value/10000);group++;}return result;
}
let assetPromise:Promise<Buffer[]>|undefined;
function assets(){return assetPromise??=Promise.all([readFile(asset('template.pdf')),readFile(asset('gulim.ttf'))]);}
async function createQuotationPdf(q:Quote){
 const [template,fontBytes]=await assets();const pdf=await PDFDocument.load(template);pdf.registerFontkit(fontkit);const font:PDFFont=await pdf.embedFont(fontBytes,{subset:false});const page=pdf.getPages()[0],height=page.getHeight();
 const safe=(value:unknown)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/[^\u0020-\u007e\uac00-\ud7a3\u3131-\u318e\u00b7\u20a9\u203b]/g,' ');
 function text(value:unknown,x:number,top:number,width:number,size=10,align:'left'|'center'|'right'='center',black=false){const str=safe(value);if(!str)return;const desired=font.widthOfTextAtSize(str,size);if(desired>width)size*=width/desired;const w=font.widthOfTextAtSize(str,size);page.drawText(str,{x:x+(align==='center'?(width-w)/2:align==='right'?width-w:0),y:height-top-size*.86,font,size,color:black?rgb(0,0,0):rgb(0,.12,.3)});}
 text('F. 051-504-2243',30,58,170,8,'left');
 text(q.number,86,141,115,10);for(const [i,key] of (['recipient','reference','phone','fax','email'] as const).entries())text(q[key],82,160+i*18.96,120,10);
 text(q.date,85,254,177,10);
 let subtotal=0;
 for(let row=0;row<12;row++){
  const item=q.items[row],top=330.5+row*18.96;
  if(item){const amount=Number(item.qty)*Number(item.price);subtotal+=amount;text(item.name,88,top,173,10,'center',true);text(item.kind,265,top,51);text(item.qty,320,top,46);text(item.price===''?'':Number(item.price).toLocaleString('en-US'),371,top,62);text(amount?amount.toLocaleString('en-US'):'-',437,top,66);text(item.note,508,top,63);}
  else text('-',437,top,66);
 }
 const tax=Math.round(subtotal*.1),total=subtotal+tax;if(!Number.isSafeInteger(total))throw Error('INVALID_AMOUNT');
 text(koreanAmount(total),86,272.8,231,12,'center',true);
 for(const [i,amount] of [subtotal,tax,total].entries())text(amount?amount.toLocaleString('en-US'):'-',438,621+i*18.96,131,11,'right',true);
 const wrap=(value:string,maxWidth:number,size:number)=>{const lines:string[]=[];for(const raw of value.split('\n')){let line='';for(const ch of safe(raw)){if(line&&font.widthOfTextAtSize(line+ch,size)>maxWidth){lines.push(line);line='';}line+=ch;}lines.push(line);}return lines;};
 const payment=wrap(q.payment,196,10);const memo=wrap(q.memo,196,8);const lines=[...payment,...memo];const lineHeight=Math.min(14,52/Math.max(lines.length,1));const lineSize=Math.min(10,lineHeight*.8);lines.forEach((line,i)=>text(line,373,711+i*lineHeight,197,lineSize));
 text(`견적담당 : ${q.manager} / 연락처 : ${q.managerPhone} / e-mail : ${q.managerEmail}`,32,773,539,10,'center',true);
 pdf.setTitle(q.title||'견적서');pdf.setAuthor('베스트시스템');return Buffer.from(await pdf.save());
}
const renderCache=new Map<string,{at:number;bytes:Buffer}>();
const renderPending=new Map<string,Promise<Buffer>>();
async function cachedRender(key:string,render:()=>Promise<Buffer>){
 const hit=renderCache.get(key);if(hit&&Date.now()-hit.at<180000)return hit.bytes;
 const pending=renderPending.get(key);if(pending)return pending;
 const task=render().then(bytes=>{renderCache.delete(key);renderCache.set(key,{at:Date.now(),bytes});let total=[...renderCache.values()].reduce((n,e)=>n+e.bytes.length,0);while(total>12000000||renderCache.size>16){const first=renderCache.keys().next().value!;total-=renderCache.get(first)!.bytes.length;renderCache.delete(first);}return bytes;}).finally(()=>renderPending.delete(key));
 renderPending.set(key,task);return task;
}
export function quotationPdf(q:Quote){const key='pdf:'+createHash('sha256').update(JSON.stringify(q)).digest('hex');return cachedRender(key,()=>createQuotationPdf(q));}
export function quotationPng(bytes:Uint8Array){const key='png:'+createHash('sha256').update(bytes).digest('hex');return cachedRender(key,()=>createQuotationPng(bytes));}
async function createQuotationPng(bytes:Uint8Array){
 const canvas=await import('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true});const doc=await task.promise;
 try{const page=await doc.getPage(1);const viewport=page.getViewport({scale:1800/595.2});const image=canvas.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvas:image as never,canvasContext:image.getContext('2d') as never,viewport}).promise;return image.toBuffer('image/png');}finally{await task.destroy();}
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function quotationMail(data:{quote:Quote;to:string;subject:string;body:string},pdf:Buffer){
 const q=data.quote;const mapping=JSON.parse(await readFile(quoteAsset('cards/mapping.json'),'utf8')) as Record<string,string>;const card=mapping[q.manager];const contact=[q.manager,q.managerPhone,q.managerEmail].filter(Boolean).join(' | ');
 const attachments:{filename:string;content:Buffer;cid?:string;contentType:string}[]=[{filename:q.title+'.pdf',content:pdf,contentType:'application/pdf'},{filename:'best_logo.jpg',content:await readFile(quoteAsset('best_logo.jpg')),cid:'best-company-logo',contentType:'image/jpeg'}];
 if(card){for(const [file,cid] of [[card,'best-person-card'],['back.png','best-card-back']])attachments.push({filename:file,content:await readFile(quoteAsset('cards/'+file)),cid,contentType:'image/png'});}
 const html=`<!doctype html><html lang="ko"><body style="margin:0;padding:24px 12px;font-family:Arial,'Malgun Gothic',sans-serif;color:#263548"><table role="presentation" width="900" style="width:100%;max-width:900px;border:1px solid #e1e6eb;border-top:4px solid #0872aa" cellpadding="28"><tr><td><div style="font-size:15px;line-height:1.9">${escape(data.body).replace(/\n/g,'<br>')}</div><table role="presentation" width="100%" style="margin-top:26px;border-top:1px solid #e1e6eb;padding-top:20px"><tr><td width="22%" valign="top"><a href="https://itbest.kr/"><img src="cid:best-company-logo" width="140" alt="베스트시스템" style="max-width:100%;height:auto"></a><p style="font-size:12px;line-height:1.8">${escape(contact)}</p><a href="https://itbest.kr/">베스트시스템 홈페이지 · itbest.kr</a></td>${card?`<td width="39%" valign="top"><img src="cid:best-person-card" width="320" style="width:100%;max-width:320px;height:auto" alt="${escape(q.manager)} 명함"></td><td width="39%" valign="top"><img src="cid:best-card-back" width="320" style="width:100%;max-width:320px;height:auto" alt="취급 품목"></td>`:''}</tr></table></td></tr></table></body></html>`;
 const user=process.env.QUOTATION_SMTP_USER!;const smtp=nodemailer.createTransport({host:'smtp.naver.com',port:587,secure:false,requireTLS:true,auth:{user:user.split('@')[0],pass:process.env.QUOTATION_SMTP_PASSWORD!},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
 try{await smtp.sendMail({from:user,to:data.to,subject:q.title,text:data.body+'\n\n베스트시스템 | https://itbest.kr/',html,attachments});}finally{smtp.close();}
}
export async function executeQuotation(kind:string,payload:unknown){
 const data=payload as {quote:Quote;to:string;subject:string;body:string};const q=kind==='send'?data.quote:payload as Quote;const pdf=await quotationPdf(q);
 if(kind==='send'){await quotationMail(data,pdf);return '';}
 return (kind==='preview'?await quotationPng(pdf):pdf).toString('base64');
}


let mailVerification:{at:number;result:Promise<boolean>}|undefined;
export function verifyQuotationMail(){
 if(mailVerification&&Date.now()-mailVerification.at<60000)return mailVerification.result;
 const result=(async()=>{if(!quotationMailReady())return false;const smtp=nodemailer.createTransport({host:'smtp.naver.com',port:587,secure:false,requireTLS:true,auth:{user:process.env.QUOTATION_SMTP_USER!.split('@')[0],pass:process.env.QUOTATION_SMTP_PASSWORD!},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000});try{await smtp.verify();return true;}catch{return false;}finally{smtp.close();}})();mailVerification={at:Date.now(),result};return result;
}
