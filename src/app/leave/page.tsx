import { cookies } from 'next/headers';
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
  return <Shell username={user.display_name}><LeaveManager initial={await leaveEmployees((await cookies()).get(SESSION_COOKIE)?.value)} today={todayKorea()}/></Shell>;
}
