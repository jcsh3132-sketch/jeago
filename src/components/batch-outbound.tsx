'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { User } from '@/lib/auth';
import { categoryPath, type InventoryData } from '@/lib/types';
import { ActionForm, Hidden } from './forms';
import { PartnerInput } from './partner-input';

export function BatchOutbound({ data, user }: { data: InventoryData; user: User }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<number, { id: number; quantity: string; expected_version: number }>>({});
  const lines = Object.values(selected);
  const visible = data.items.filter(item => `${item.name} ${categoryPath(data.categories, item.category)}`.toLowerCase().includes(search.toLowerCase()));
  const invalid = !lines.length || lines.some(line => !/^\d+$/.test(line.quantity) || Number(line.quantity) < 1 || Number(line.quantity) > (data.items.find(item => item.id === line.id)?.quantity ?? 0));
  return <section className="form-card batch-outbound"><div className="form-heading"><h2>묶음 출고</h2><p>함께 출고할 토너를 선택하세요. 기본 수량은 각각 1개이며 필요한 수량으로 변경할 수 있습니다.</p></div>
    <ActionForm action="stock.out.batch" confirm={`선택한 ${lines.length}개 모델을 한 번에 출고하시겠습니까?`}>
      <Hidden name="lines" value={JSON.stringify(lines)}/>
      <label className="field field-label">모델·카테고리 검색<input value={search} onChange={e => setSearch(e.target.value)} placeholder="토너 또는 모델명"/></label>
      <div className="batch-model-list">{visible.map(item => <label key={item.id} className="batch-model"><input type="checkbox" aria-label={`${item.name} 선택`} checked={!!selected[item.id]} disabled={item.quantity === 0 && !selected[item.id]} onChange={e => setSelected(previous => { const next = { ...previous }; if (e.target.checked) next[item.id] = { id: item.id, quantity: '1', expected_version: item.version }; else delete next[item.id]; return next; })}/><span><b>{item.name}</b><small>{categoryPath(data.categories, item.category)} · 재고 {item.quantity}개</small></span></label>)}</div>
      {!visible.length && <p>검색 결과가 없습니다.</p>}
      <h3>선택한 모델 {lines.length}개</h3>
      {lines.map(line => { const item = data.items.find(item => item.id === line.id); return <div key={line.id} className="batch-selection"><label className="field field-label">{item?.name || '삭제된 모델'} 출고 수량<input aria-label={`${item?.name} 출고 수량`} type="number" min="1" max={item?.quantity ?? 0} step="1" required value={line.quantity} onChange={e => setSelected(previous => ({ ...previous, [line.id]: { ...previous[line.id], quantity: e.target.value } }))}/></label><button type="button" className="top-btn ghost" onClick={() => setSelected(previous => { const next = { ...previous }; delete next[line.id]; return next; })}>선택 해제</button></div>; })}
      <PartnerInput names={data.customerNames}/>
      <label className="field field-label">담당자<input value={user.display_name} readOnly/></label>
      <p className="muted">한 항목이라도 재고가 부족하거나 변경되면 전체 출고를 중단합니다. 출고 이력은 모델별로 기록됩니다.</p>
      <div className="form-actions"><Link href="/" className="top-btn ghost">취소</Link><button type="submit" className="top-btn primary" disabled={invalid || lines.length > 100}>선택 모델 출고</button></div>
    </ActionForm>
  </section>;
}
