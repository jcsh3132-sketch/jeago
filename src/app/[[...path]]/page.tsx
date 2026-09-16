import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-request';
import { AuthPanel } from '@/components/auth-panel';
import { Shell } from '@/components/shell';
import { loadInventory } from '@/lib/inventory';
import { Dashboard } from '@/components/dashboard';
import { Categories, History, ItemEditor, Partners, StockEditor } from '@/components/pages';
import { Trash } from '@/components/trash';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function Page({ params, searchParams }: Props) {
  const user = await currentUser();
  if (!user) {
    const { path = [] } = await params;
    if (path.length) redirect('/');
    return <AuthPanel registered={(await searchParams).registered === '1'}/>;
  }
  return <Shell username={user.display_name}><InventoryPage params={params} searchParams={searchParams}/></Shell>;
}
async function InventoryPage({ params, searchParams }: Props) {
  const { path = [] } = await params;
  const raw = await searchParams;
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') query[k] = v;
  const section = path[0] || '';
  if (path.length > 2 || !['', 'add', 'categories', 'partners', 'transactions', 'edit', 'inbound', 'outbound', 'history', 'trash'].includes(section)) notFound();
  const itemRoute = ['edit', 'inbound', 'outbound', 'history'].includes(section);
  if (itemRoute ? path.length !== 2 || !/^\d+$/.test(path[1]) : path.length > 1) notFound();
  if (section === 'trash') return <Trash/>;
  const data = await loadInventory({ history: ['history', 'transactions'].includes(section) });
  if (itemRoute) {
    const item = data.items.find(i => i.id === Number(path[1]));
    if (!item) notFound();
    if (section === 'edit') return <ItemEditor key={item.id} data={data} item={item}/>;
    if (section === 'history') return <History data={data} item={item} query={query}/>;
    return <StockEditor key={`${section}-${item.id}`} data={data} item={item} outbound={section === 'outbound'}/>;
  }
  if (section === 'add') return <ItemEditor data={data} selected={query.category}/>;
  if (section === 'categories') return <Categories data={data}/>;
  if (section === 'partners') return <Partners data={data} query={query}/>;
  if (section === 'transactions') return <History data={data} query={query}/>;
  return <Dashboard items={data.items} categories={data.categories} query={query}/>;
}
