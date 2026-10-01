'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ActionForm, Field, Hidden } from './forms';
import { categoryPath, type Category, type Item, type StockTransaction } from '@/lib/types';
import { koreaDateTimeInput, koreaTime } from '@/lib/korea-time';

export function TransactionEditor({ transaction, items, categories, customerNames }: { transaction: StockTransaction; items: Item[]; categories: Category[]; customerNames: string[] }) {
  const source = items.find(item => item.id === transaction.item_id)!;
  const [targetId, setTargetId] = useState(source.id);
  const [type, setType] = useState(transaction.transaction_type);
  const [quantity, setQuantity] = useState(String(transaction.quantity));
  const target = items.find(item => item.id === targetId)!;
  const oldEffect = transaction.transaction_type === '입고' ? transaction.quantity : -transaction.quantity;
  const validQuantity = /^\d+$/.test(quantity) && Number(quantity) >= 1 && Number(quantity) <= 2147483647;
  const newEffect = (type === '입고' ? 1 : -1) * Number(quantity);
  const balances = target.id === source.id
    ? [{ item: source, after: source.quantity - oldEffect + newEffect }]
    : [{ item: source, after: source.quantity - oldEffect }, { item: target, after: target.quantity + newEffect }];
  return <div className="form-page"><section className="form-card transaction-edit-card">
    <div className="form-heading"><h2>입출고 내역 수정</h2><p>{source.name} · {transaction.transaction_type} {transaction.quantity}개 · {koreaTime(transaction.date)}</p></div>
    <ActionForm action="transaction.edit">
      <Hidden name="id" value={transaction.id}/><Hidden name="original_item_id" value={source.id}/>
      <Hidden name="expected_version" value={transaction.version}/><Hidden name="expected_item_version" value={source.version}/><Hidden name="expected_target_version" value={target.version}/>
      <label className="field field-label">처리일시 (한국시간)<input type="datetime-local" name="date" defaultValue={koreaDateTimeInput(transaction.date)} step="0.001" required/></label>
      <label className="field field-label">모델<select name="item_id" value={targetId} onChange={event => setTargetId(Number(event.target.value))} required>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {categoryPath(categories, item.category)}</option>)}</select></label>
      <div className="transaction-edit-fields">
        <label className="field field-label">입출고 유형<select name="transaction_type" value={type} onChange={event => setType(event.target.value)}><option>입고</option><option>출고</option></select></label>
        <label className="field field-label">수량<input name="quantity" type="number" min="1" max="2147483647" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} required/></label>
      </div>
      {type === '출고' && <label className="field field-label">출고업체<input name="customer_name" list="transaction-edit-partners" defaultValue={transaction.customer_name || ''} maxLength={120} required/><datalist id="transaction-edit-partners">{customerNames.map(name => <option value={name} key={name}/>)}</datalist></label>}
      {type === '입고' && <><Field name="inbound_source" label="입고처" value={transaction.inbound_source || ''} maxLength={120}/><p className="muted">선택 입력 · 입고 내역에만 메모로 저장되며 거래처 관리에는 등록되지 않습니다.</p></>}
      <Field name="manager" label="담당자" value={transaction.manager} maxLength={50} required/>
      <div className="transaction-stock-preview" aria-live="polite"><strong>수정 후 재고</strong>{validQuantity ? balances.map(({ item, after }) => <p key={item.id} className={after < 0 || after > 2147483647 ? 'transaction-stock-error' : ''}>{item.name}: {item.quantity}개 → <b>{after}개</b></p>) : <p>올바른 수량을 입력해주세요.</p>}</div>
      <p className="muted">수량·모델·유형을 수정하면 현재 재고도 함께 조정됩니다. 변경 전후 내용과 수정한 직원은 별도로 기록됩니다.</p>
      <div className="form-actions"><Link href="/transactions" className="top-btn ghost">취소</Link><button type="submit" className="top-btn primary">수정 저장</button></div>
    </ActionForm>
  </section></div>;
}
