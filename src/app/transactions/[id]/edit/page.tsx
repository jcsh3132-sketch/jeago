import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { loadInventory } from '@/lib/inventory';
import { Shell } from '@/components/shell';
import { TransactionEditor } from '@/components/transaction-editor';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function TransactionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/');
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const data = await loadInventory();
  const transaction = data.transactions.find(row => row.id === Number(id));
  if (!transaction) notFound();
  return <Shell username={user.display_name}><TransactionEditor key={`${transaction.id}-${transaction.version}`} transaction={transaction} items={data.items} categories={data.categories} customerNames={data.customerNames}/></Shell>;
}
