import {redirect} from 'next/navigation';
import {currentUser} from '@/lib/auth-request';
import {Shell} from '@/components/shell';
export const dynamic='force-dynamic';
export default async function QuotationPage(){const user=await currentUser();if(!user)redirect('/');return <Shell username={user.display_name}><iframe className="calculator-frame quotation-frame" src="/quotation/content/index.html" title="견적서 작성"/></Shell>;}
