import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {webcrypto} from 'node:crypto';
test('preview bridge makes one direct request, merges duplicates and never caches mail sends',async()=>{
 let renders=0,sends=0,polls=0;const ids=new Set();const native=async(input:string,options?:RequestInit)=>{
  if(input==='/api/quotation'&&options?.method==='POST'){const d=JSON.parse(String(options.body));if(d.kind!=='send'){renders++;assert.equal((options.headers as Record<string,string>)['X-Quotation-Direct'],'1');return new Response('%PDF-test',{headers:{'Content-Type':'application/pdf'}});}sends++;ids.add(d.id);return Response.json({id:d.id});}
  if(input.startsWith('/api/quotation?id=')){polls++;return Response.json({status:'done',result:''});}throw Error('Unexpected request');
 };
 const window={fetch:native};runInNewContext(readFileSync('src/quotation/bridge.js','utf8'),{window,crypto:webcrypto,Response,Uint8Array,atob,setTimeout:(f:()=>void)=>{f();},Map,Date,JSON,Error});
 const opts={method:'POST',body:JSON.stringify({recipient:'거래처1'})};await Promise.all([window.fetch('/pdf',opts),window.fetch('/pdf',opts)]);assert.equal(renders,1);await window.fetch('/pdf',opts);assert.equal(renders,1);assert.equal(polls,0);
 await window.fetch('/pdf',{...opts,body:JSON.stringify({recipient:'거래처2'})});assert.equal(renders,2);
 await window.fetch('/send',opts);await window.fetch('/send',opts);assert.equal(sends,2);assert.equal(ids.size,2);assert.equal(polls,2);
});
