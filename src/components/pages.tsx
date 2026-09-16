import Link from 'next/link';
import type { User } from '@/lib/auth';
import { ActionForm, CategorySelect, DeleteButton, Field, Hidden } from './forms';
import { PartnerInput } from './partner-input';
import { label, categoryPath, MANAGERS, type InventoryData, type Item, type Category, type StockTransaction } from '@/lib/types';

function ManagerSelect({ value }: { value?: string }) {
  return <label className="field field-label">담당자<select name="manager" aria-label="담당자" required defaultValue={value || MANAGERS[0]}>{[...new Set([...(value ? [value] : []), ...MANAGERS])].map(m => <option key={m}>{m}</option>)}</select></label>;
}
export function ItemEditor({ data, item, selected, user }: { data: InventoryData; item?: Item; selected?: string; user: User }) {
  return <div className="form-page"><section className="form-card"><div className="form-heading"><span className="section-kicker">{item ? 'EDIT ITEM' : 'NEW ITEM'}</span><h2>{item ? '모델 정보 수정' : '새 모델 등록'}</h2><p>모델을 등록한 후 입고 처리로 재고를 추가하세요.</p></div>
    <ActionForm action={item ? 'item.edit' : 'item.add'}>{item && <><Hidden name="id" value={item.id}/><Hidden name="expected_version" value={item.version}/></>}<Field name="name" label="모델명" value={item?.name} required maxLength={100}/>{item ? <ManagerSelect value={item.manager}/> : <><label className="field field-label">담당자<input value={user.display_name} readOnly aria-describedby="model-owner-note"/></label><p id="model-owner-note" className="muted">로그인 계정 {user.username}의 이름으로 자동 등록됩니다.</p></>}<CategorySelect categories={data.categories} selected={item?.category || selected}/><p className="muted">필요한 분류가 없다면 <Link href="/categories">카테고리 관리</Link>에서 먼저 추가하세요.</p><div className="form-actions"><Link href="/" className="top-btn ghost">취소</Link><button type="submit" className="top-btn primary">{item ? '변경 저장' : '모델 등록'}</button></div></ActionForm>
  </section></div>;
}
export function StockEditor({ data, item, outbound, user }: { data: InventoryData; item: Item; outbound: boolean; user: User }) {
  return <div className="form-page"><section className="form-card transaction-card"><div className="form-heading"><span className="section-kicker">{outbound ? 'OUTBOUND' : 'INBOUND'}</span><h2>{item.name}</h2><p>현재 재고 <strong>{item.quantity}개</strong> · {categoryPath(data.categories, item.category)}</p></div>
    <ActionForm action={outbound ? 'stock.out' : 'stock.in'}><Hidden name="id" value={item.id}/><Hidden name="expected_version" value={item.version}/><label className="field field-label">{outbound ? '출고' : '입고'} 수량<input name="quantity" type="number" min="1" max={outbound ? item.quantity : 2147483647} step="1" required autoFocus/></label><label className="field field-label">담당자<input value={user.display_name} readOnly aria-describedby="stock-owner-note"/></label><p id="stock-owner-note" className="muted">로그인 계정 {user.username}의 이름으로 자동 기록됩니다.</p>
      {outbound && <PartnerInput names={data.customerNames}/>}
      {outbound && item.quantity === 0 && <p role="status" className="form-status error">현재 재고가 없어 출고할 수 없습니다.</p>}
      <div className="form-actions"><Link href="/" className="top-btn ghost">취소</Link><button type="submit" disabled={outbound && item.quantity === 0} className={`top-btn ${outbound ? 'danger-btn' : 'success'}`}>{outbound ? '출고 처리' : '입고 처리'}</button></div>
    </ActionForm></section></div>;
}
function dateString(s: string) { return s?.replace('T', ' ').slice(0, 16) || '-'; }
export function History({ data, item, query }: { data: InventoryData; item?: Item; query: Record<string, string> }) {
  const q = (query.q || '').trim().toLowerCase();
  const type = ['입고', '출고'].includes(query.type) ? query.type : 'all';
  const itemMap = new Map(data.items.map(i => [i.id, i]));
  let rows: (StockTransaction & { remaining?: number })[];
  if (item) {
    const txs = data.transactions.filter(t => t.item_id === item.id);
    // Preserve any opening balance that predates the recorded transaction history.
    let balance = item.quantity - txs.reduce((s, t) => s + (t.transaction_type === '입고' ? t.quantity : -t.quantity), 0);
    rows = txs.map(t => { balance += t.transaction_type === '입고' ? t.quantity : -t.quantity; return { ...t, remaining: balance }; }).reverse();
  } else rows = data.transactions.filter(t => (type === 'all' || t.transaction_type === type) && `${itemMap.get(t.item_id)?.name || ''} ${t.manager} ${t.customer_name || ''}`.toLowerCase().includes(q)).reverse();
  return <section className="data-card history-card"><div className="section-head"><div><span className="section-kicker">TRANSACTION HISTORY</span><h2>{item?.name || '전체 입출고 내역'}</h2><p>{rows.length}건 · 처리일시는 기존 DB와 같은 UTC 기준입니다.</p></div>{item ? <Link href="/" className="top-btn ghost">목록으로</Link> : <form method="get" className="history-filters"><input name="q" aria-label="입출고 검색" placeholder="모델 · 담당자 · 출고업체" defaultValue={query.q}/><select name="type" aria-label="입출고 유형" defaultValue={type}><option value="all">전체 유형</option><option>입고</option><option>출고</option></select><button className="top-btn ghost">검색</button></form>}</div>
    {rows.length ? <div className="table-wrap"><table className="history-table"><thead><tr>{['처리일시', ...(item ? [] : ['모델명']), '유형', '수량', '출고업체', '담당자', ...(item ? ['처리 후 재고'] : [])].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(t => <tr key={t.id}><td data-label="처리일시">{dateString(t.date)}</td>{!item && <td data-label="모델명"><Link href={`/history/${t.item_id}`}>{itemMap.get(t.item_id)?.name || `#${t.item_id}`}</Link></td>}<td data-label="유형"><span className={`stock-badge ${t.transaction_type === '입고' ? 'good' : 'out'}`}>{t.transaction_type}</span></td><td data-label="수량"><strong>{t.quantity}</strong></td><td data-label="출고업체">{t.customer_name || '-'}</td><td data-label="담당자">{t.manager}</td>{item && <td data-label="처리 후 재고"><strong>{t.remaining}</strong></td>}</tr>)}</tbody></table></div> : <div className="empty-state"><h3>입출고 내역이 없습니다.</h3></div>}
  </section>;
}
export function Partners({ data, query }: { data: InventoryData; query: Record<string, string> }) {
  const q = (query.q || '').trim().toLowerCase();
  const partners = data.partners.filter(p => `${p.name} ${p.contact_person} ${p.phone}`.toLowerCase().includes(q));
  return <div className="partner-grid"><section className="form-card partner-form-card"><div className="form-heading"><span className="section-kicker">CUSTOMER SETUP</span><h2>거래처 추가</h2></div><ActionForm action="partner.add"><Field name="name" label="거래처명" required/><Field name="contact_person" label="담당자" maxLength={80}/><Field name="phone" label="연락처" maxLength={50}/><Field name="note" label="메모" maxLength={255}/><button className="top-btn primary">+ 거래처 추가</button></ActionForm></section>
    <section className="data-card"><div className="section-head"><div><span className="section-kicker">CUSTOMER LIST</span><h2>거래처 목록</h2></div><form className="history-filters"><input name="q" defaultValue={query.q} aria-label="거래처 검색" placeholder="거래처 · 담당자 · 연락처"/><button className="top-btn ghost">검색</button></form></div><div className="next-partner-list">{partners.map(p => <article className="next-partner" key={p.id}><ActionForm key={`${p.id}-${p.name}-${p.contact_person}-${p.phone}-${p.note}`} action="partner.edit"><Hidden name="id" value={p.id}/><Hidden name="expected_version" value={p.version}/><div className="partner-fields"><Field name="name" label="거래처명" required value={p.name}/><Field name="contact_person" label="담당자" value={p.contact_person || ''} maxLength={80}/><Field name="phone" label="연락처" value={p.phone || ''} maxLength={50}/><Field name="note" label="메모" value={p.note || ''} maxLength={255}/></div><button className="top-btn ghost">수정 저장</button></ActionForm><DeleteButton action="partner.delete" id={p.id} version={p.version} message={`${p.name} 거래처를 휴지통으로 이동하시겠습니까? 기존 출고 이력의 업체명은 유지됩니다.`}/></article>)}{!partners.length && <div className="empty-state"><h3>조건에 해당하는 거래처가 없습니다.</h3></div>}</div></section>
  </div>;
}
export function Categories({ data }: { data: InventoryData }) {
  const mains = data.categories.filter(c => c.parent_id === null);
  const devices = data.categories.filter(c => mains.some(m => m.id === c.parent_id));
  function add(level: number, choices: Category[], heading: string) {
    return <section className="form-card"><div className="form-heading"><h2>{heading} 추가</h2></div><ActionForm action="category.add"><Hidden name="level" value={level}/>{level > 0 && <label className="field field-label">{level === 1 ? '대분류' : '장비 모델'}<select name="parent_id" required defaultValue=""><option value="" disabled>상위 분류 선택</option>{choices.map(c => <option key={c.id} value={c.id}>{level === 2 ? `${label(mains.find(m => m.id === c.parent_id))} · ` : ''}{label(c)}</option>)}</select></label>}<Field name="name" label={`${heading} 이름`} required maxLength={80}/><button className="top-btn primary">추가</button></ActionForm></section>;
  }
  function branch(c: Category, level: number) {
    const children = data.categories.filter(n => n.parent_id === c.id);
    const items = data.items.filter(i => i.category === c.name);
    const targets = level === 1 ? mains : devices;
    return <details className={`admin-node level-${level}`} key={c.id} open={level === 0}><summary><strong>{label(c)}</strong><span className="category-count">{level === 2 ? `모델 ${items.length}개` : `${level === 0 ? '장비' : '품목'} ${children.length}개`}</span></summary>
      <div className="admin-node-body"><div className="admin-tools"><ActionForm action="category.rename" key={`${c.id}-${label(c)}`}><Hidden name="id" value={c.id}/><Hidden name="expected_version" value={c.version}/><input name="name" aria-label={`${label(c)} 새 이름`} defaultValue={label(c)} required maxLength={80}/><button className="top-btn ghost">이름 변경</button></ActionForm>
      {level > 0 && <ActionForm action="category.move"><Hidden name="id" value={c.id}/><Hidden name="expected_version" value={c.version}/><select key={c.parent_id} name="parent_id" defaultValue={c.parent_id || ''} aria-label={`${label(c)} 이동 대상`} required>{targets.map(t => <option key={t.id} value={t.id}>{level === 2 ? `${label(mains.find(m => m.id === t.parent_id))} · ` : ''}{label(t)}</option>)}</select><button className="top-btn ghost">이동</button></ActionForm>}
      <DeleteButton action="category.delete" id={c.id} version={c.version} message={level === 0 ? `${label(c)} 대분류를 휴지통으로 이동하시겠습니까? 장비가 포함된 대분류는 삭제할 수 없습니다.` : `${label(c)} 및 하위 모델과 모든 입출고 이력을 휴지통으로 이동합니다. 계속하시겠습니까?`}/></div>
      {children.map(n => branch(n, level + 1))}{level === 2 && <div className="admin-items">{items.map(i => <div key={i.id}><Link href={`/?category=${encodeURIComponent(i.category)}&item=${i.id}#item-${i.id}`}>{i.name}</Link><small>재고 {i.quantity}</small><Link href={`/edit/${i.id}`}>수정</Link><DeleteButton action="item.delete" id={i.id} version={i.version} message={`${i.name} 및 입출고 이력을 휴지통으로 이동하시겠습니까?`}/></div>)}{!items.length && <p className="muted">등록된 모델이 없습니다.</p>}</div>}</div>
    </details>;
  }
  return <div className="category-admin-grid"><div className="category-create-stack">{add(0, [], '대분류')}{add(1, mains, '장비 모델')}{add(2, devices, '품목 카테고리')}</div><section className="data-card"><div className="section-head"><div><span className="section-kicker">CATEGORY MANAGEMENT</span><h2>카테고리 구조</h2><p>대분류 → 장비 모델 → 품목 카테고리 → 재고 모델</p></div></div><div className="admin-tree">{mains.map(c => branch(c, 0))}</div></section></div>;
}
