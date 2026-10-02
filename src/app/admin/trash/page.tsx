import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAdministrator } from '@/lib/admin';
import { AuthError, SESSION_COOKIE } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Trash } from '@/components/trash';
import { AdminNavigation } from '@/components/admin-navigation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default async function TrashPage() {
  const user = await requireAdministrator((await cookies()).get(SESSION_COOKIE)?.value).catch(error => {
    if (error instanceof AuthError) redirect(error.status === 401 ? '/' : '/account');
    throw error;
  });
  return <Shell username={user.display_name}><AdminNavigation/><Trash/></Shell>;
}
