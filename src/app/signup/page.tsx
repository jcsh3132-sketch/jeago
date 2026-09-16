import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { AuthPanel } from '@/components/auth-panel';
export const dynamic = 'force-dynamic';
export default async function SignupPage() {
  if (await currentUser()) redirect('/');
  return <AuthPanel signup/>;
}
