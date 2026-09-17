import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { accountProfile, SESSION_COOKIE } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { AccountSettings } from '@/components/account-settings';
import Link from 'next/link';
import { isAdministrator } from '@/lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/');
  const profile = await accountProfile((await cookies()).get(SESSION_COOKIE)?.value);
  return <Shell username={profile.display_name}>{await isAdministrator(user.id) && <div className="admin-entry"><Link href="/admin/users" className="top-btn primary">회원 관리</Link></div>}<AccountSettings profile={profile}/></Shell>;
}
