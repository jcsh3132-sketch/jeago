import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAdministrator, listMembers } from '@/lib/admin';
import { AuthError, SESSION_COOKIE } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { MemberManagement } from '@/components/member-management';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default async function MembersPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await requireAdministrator(token).catch(error => {
    if (error instanceof AuthError) redirect(error.status === 401 ? '/' : '/account');
    throw error;
  });
  return <Shell username={user.display_name}><MemberManagement initial={await listMembers(token)}/></Shell>;
}
