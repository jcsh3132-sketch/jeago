import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculateLeave, weekdays } from '../src/lib/leave-calculator';
import { saveLeave, leaveEmployees } from '../src/lib/leave-store';
import { register, createSession } from '../src/lib/auth';
import { getDb } from '../src/lib/db';
mkdirSync('work', { recursive: true });
process.env.JEAGO_TEST_MODE = '1';
process.env.JEAGO_TEST_DATABASE_URL = pathToFileURL(join(mkdtempSync(join(resolve('work'),'leave-test-')),'test.db')).href;
after(async () => (await getDb()).close());
test('leave calculation matches supplied workbook cached examples and date boundaries', () => {
  const examples = [['2024-06-03',1,34,33,-1],['2024-02-21',1,35,39,4],['2020-12-14',0,87,90,3],['2025-01-21',0,24.5,23,-1.5],['2025-01-02',0,22,23,1]] as const;
  for (const [hired,special,used,earned,remaining] of examples) { const result=calculateLeave(hired,'2026-08-25',special,used); assert.equal(result.earned,earned); assert.equal(result.remaining,remaining); }
  assert.equal(calculateLeave('2025-01-31','2025-02-28',0,0).months,0);
  assert.equal(calculateLeave('2024-02-29','2025-02-28',0,0).earned,11);
  assert.equal(calculateLeave('2024-02-29','2025-03-01',0,0).earned,15);
  assert.equal(calculateLeave('2020-01-01','2023-01-01',0,0).earned,46);
  assert.throws(() => calculateLeave('2025-02-30','2026-01-01',0,0));
  assert.throws(() => calculateLeave('2025-02-01','2025-01-01',0,0));
  assert.equal(weekdays('2026-09-18','2026-09-21'),2);
});
test('all authenticated members share leave editing with stale-write and replay protection', async () => {
  const a=await register({username:'leave.a',display_name:'A',password:'1234',password_confirm:'1234'});
  const b=await register({username:'leave.b',display_name:'B',password:'1234',password_confirm:'1234'});
  const token=await createSession(a.id,true), other=await createSession(b.id,true);
  const employee={id:randomUUID(),name:'테스트',position:'사원',hired:'2025-01-01',special:1,version:0,entries:[{id:randomUUID(),start:'2026-01-02',end:'2026-01-02',days:0.5,note:''}]};
  const request={employee,request_id:randomUUID()};
  await assert.rejects(saveLeave(undefined,request)); await assert.rejects(leaveEmployees(undefined));
  await saveLeave(token,request); await saveLeave(token,request);
  assert.equal((await leaveEmployees(other))[0].version,1);
  await assert.rejects(saveLeave(other,{...request,request_id:randomUUID()}),/다른 회원/);
  await saveLeave(other,{employee:{...employee,name:'수정',version:1},request_id:randomUUID()});
  assert.equal((await leaveEmployees(token))[0].name,'수정');
  await assert.rejects(saveLeave(token,{employee:{...employee,version:2,entries:[{...employee.entries[0],days:-1}]},request_id:randomUUID()}));
});
