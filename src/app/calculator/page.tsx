import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function CalculatorPage() {
  const user = await currentUser();
  if (!user) redirect('/');
  return <Shell username={user.display_name}><iframe className="calculator-frame" src="/calculator/content/index" title="판매·임대 계산기" /></Shell>;
}
