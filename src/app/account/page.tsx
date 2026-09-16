import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { accountProfile, SESSION_COOKIE } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { AccountSettings } from '@/components/account-settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect('/');
  const profile = await accountProfile((await cookies()).get(SESSION_COOKIE)?.value);
  return <Shell username={profile.display_name}><AccountSettings profile={profile}/></Shell>;
}
