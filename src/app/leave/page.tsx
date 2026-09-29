import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { isAdministrator } from '@/lib/admin';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { SESSION_COOKIE } from '@/lib/auth';
import { leaveEmployees } from '@/lib/leave-store';
import { todayKorea } from '@/lib/leave-calculator';
import { LeaveManager } from '@/components/leave-manager';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function LeavePage() {
  const user = await currentUser(); if (!user) redirect('/');
  const employees = await leaveEmployees((await cookies()).get(SESSION_COOKIE)?.value);
  const initial = employees.length ? employees : [{ id: randomUUID(), name: user.display_name, position: '', hired: '', special: 0, entries: [], version: 0 }];
  return <Shell username={user.display_name}><LeaveManager initial={initial} today={todayKorea()} username={user.username} displayName={user.display_name} canEditHistory={await isAdministrator(user.id)}/></Shell>;
}
