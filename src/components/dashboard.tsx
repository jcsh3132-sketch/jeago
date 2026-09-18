'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { ActionForm, CategorySelect, DeleteButton, Hidden } from './forms';
import { ancestry, categoryPath, label, stockState, type Category, type Item } from '@/lib/types';

export function Dashboard({ items, categories, query }: { items: Item[]; categories: Category[]; query: Record<string, string> }) {
  const [search, setSearch] = useState(''), [order, setOrder] = useState<number[]>([]);
  const [move, setMove] = useState<Item | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), dragged = useRef<number | null>(null);
  const validLeaf = categories.find(c => c.name === query.category && ancestry(categories, c.name).main?.parent_id === null);
  const validDevice = categories.find(c => c.id === Number(query.device) && categories.some(m => m.id === c.parent_id && m.parent_id === null));
  const validMain = categories.find(c => c.id === Number(query.main) && c.parent_id === null);
  const scope: Record<string, string> = validLeaf ? { category: validLeaf.name } : validDevice ? { device: String(validDevice.id) } : validMain ? { main: String(validMain.id) } : {};
  const scoped = items.filter(i => { const a = ancestry(categories, i.category); return validLeaf ? i.category === validLeaf.name : validDevice ? a.device?.id === validDevice.id : validMain ? a.main?.id === validMain.id : true; });
  const filter = ['in_stock', 'low', 'out'].includes(query.stock) ? query.stock : 'all';
  const visible = useMemo(() => scoped.filter(i => (filter === 'all' || (filter === 'in_stock' ? i.quantity > 0 : stockState(i) === filter)) && `${i.name} ${categoryPath(categories, i.category)} ${i.manager}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    const ai = order.indexOf(a.id), bi = order.indexOf(b.id); return (ai < 0 ? 999999 : ai) - (bi < 0 ? 999999 : bi);
  }), [scoped, filter, categories, search, order]);
  const metrics = [
    ['all', '등록 모델', scoped.length, '전체 모델 목록 보기', '□'],
    ['in_stock', '총 재고 수량', scoped.reduce((s, i) => s + i.quantity, 0), `재고 보유 모델 ${scoped.filter(i => i.quantity > 0).length}개`, 'Σ'],
    ['low', '재고 부족', scoped.filter(i => stockState(i) === 'low').length, '모델별 설정 기준 이하', '!'],
    ['out', '재고 없음', scoped.filter(i => i.quantity === 0).length, '0개 모델 보기', '×'],
  ];
  const showInventory = !!(validLeaf || validDevice || validMain || search.trim() || items.some(item => item.id === Number(query.item)) || ['all', 'in_stock', 'low', 'out'].includes(query.stock));
  const link = (stock: string) => `/?${new URLSearchParams({ ...scope, stock })}`;
  const selected = ancestry(categories, validLeaf?.name || '');
  const selectedMain = selected.main?.id || validDevice?.parent_id || validMain?.id;
  const selectedDevice = selected.device?.id || validDevice?.id;
  function branch(c: Category, level: number) {
    const children = categories.filter(n => n.parent_id === c.id);
    const leafItems = items.filter(i => i.category === c.name);
    const href = level === 0 ? `/?main=${c.id}` : level === 1 ? `/?device=${c.id}` : `/?category=${encodeURIComponent(c.name)}`;
    const open = level === 0 ? selectedMain === c.id : level === 1 ? selectedDevice === c.id : validLeaf?.id === c.id;
    return <details className="next-tree" key={c.id} open={open || undefined}><summary><Link href={href} className={`category-desktop-link ${open ? 'selected' : ''}`}>{label(c)}</Link><span className={`category-mobile-label ${open ? 'selected' : ''}`}>{label(c)}</span></summary><div className="next-tree-children">{children.map(n => branch(n, level + 1))}{level === 2 && leafItems.map(i => <Link key={i.id} className="tree-item-link" href={`${href}&item=${i.id}#item-${i.id}`}><span>{i.name}</span><small>{i.quantity}</small></Link>)}{!children.length && !leafItems.length && <small className="muted">등록 항목 없음</small>}</div></details>;
  }
  return <>
    <section className="metric-grid dashboard-metrics" aria-label="재고 요약 필터">{metrics.map(([key, title, count, sub, icon]) => <Link key={key} href={link(String(key))} className={`metric-card metric-link ${filter === key ? 'active' : ''} ${key === 'low' ? 'warning' : key === 'out' ? 'danger' : ''}`}><div className="metric-icon">{icon}</div><div><span>{title}</span><strong>{count}</strong><small>{sub}</small></div></Link>)}</section>
    <div className="workspace-grid"><aside className="filter-card tree-filter-card" data-expanded={categoriesOpen}><div className="section-head compact category-desktop-heading"><h2>카테고리</h2></div><button type="button" className="category-toggle" aria-expanded={categoriesOpen} aria-controls="inventory-categories" onClick={() => setCategoriesOpen(!categoriesOpen)}><span><b>카테고리 선택</b><small>{validLeaf ? categoryPath(categories, validLeaf.name) : label(validDevice || validMain) || '전체 모델'}</small></span><strong>{categoriesOpen ? '접기 ▴' : '펼치기 ▾'}</strong></button><div id="inventory-categories" className="category-tree" onClick={event => { if ((event.target as HTMLElement).closest('a')) setCategoriesOpen(false); }}><Link href="/?stock=all" className="category-link">전체 모델 <b>{items.length}</b></Link>{categories.filter(c => c.parent_id === null).map(c => branch(c, 0))}</div></aside>
    <section className="data-card"><div className="section-head inventory-list-head"><div><span className="section-kicker">STOCK LIST</span><h2>{label(validLeaf || validDevice || validMain) || (search.trim() ? '검색 결과' : '재고 조회')}</h2><p>검색과 카테고리 필터로 모델을 찾아 입출고를 처리하세요.</p></div><div className="search-box"><span>⌕</span><input aria-label="재고 검색" placeholder="모델명 · 장비명 · 담당자 검색" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
    {!showInventory ? <div className="empty-state inventory-start"><h3>조회할 재고를 선택하세요.</h3><p>카테고리를 선택하거나 모델명을 검색하세요.</p></div> : visible.length ? <div className="table-wrap"><table className="inventory-table"><thead><tr>{['모델명', '재고', '부족 기준', '상태', '담당자', '카테고리', '빠른 작업', '관리'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{visible.map(i => <tr key={i.id} id={`item-${i.id}`} className={Number(query.item) === i.id ? 'selected-item-row' : ''} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragged.current === null) return; const ids = visible.map(i => i.id).filter(id => id !== dragged.current); ids.splice(ids.indexOf(i.id), 0, dragged.current); setOrder(ids); dragged.current = null; }}>
      <td className="item-name" data-label="모델명"><div className="model-cell"><span className="model-icon">▣</span><div><strong>{i.name}</strong><small>#{String(i.id).padStart(4, '0')}</small></div></div></td>
      <td data-label="재고"><strong className="qty-value">{i.quantity}</strong></td>
      <td data-label="부족 기준"><Threshold key={`${i.id}-${i.low_stock_threshold}`} item={i}/></td>
      <td data-label="상태"><span className={`stock-badge ${stockState(i)}`}>{i.quantity === 0 ? '재고 없음' : stockState(i) === 'low' ? '부족' : '정상'}</span></td>
      <td data-label="담당자">{i.manager}</td><td data-label="카테고리"><button className="category-pill" onClick={() => { setMove(i); dialog.current?.showModal(); }}>{categoryPath(categories, i.category)}</button></td>
      <td data-label="빠른 작업"><div className="quick-actions"><Link href={`/inbound/${i.id}`} className="action-btn inbound">입고</Link><Link href={`/outbound/${i.id}`} className="action-btn outbound">출고</Link></div></td>
      <td data-label="관리"><div className="manage-actions"><Link href={`/history/${i.id}`}>이력</Link><Link href={`/edit/${i.id}`}>수정</Link><DeleteButton action="item.delete" id={i.id} version={i.version} message={`${i.name} 모델과 입출고 이력을 휴지통으로 이동하시겠습니까?`}/><span className="drag-handle" draggable onDragStart={() => { dragged.current = i.id; }} title="끌어서 표시 순서 변경">⋮⋮</span></div></td>
    </tr>)}</tbody></table></div> : <div className="empty-state"><h3>조건에 해당하는 모델이 없습니다.</h3><p>필터를 변경하거나 새 모델을 추가하세요.</p><Link className="top-btn primary" href="/add">모델 등록</Link></div>}</section></div>
    <dialog ref={dialog} className="next-dialog"><button className="modal-close" aria-label="닫기" onClick={() => dialog.current?.close()}>×</button><h3>{move?.name} 카테고리 변경</h3>{move && <ActionForm key={move.id} action="item.category" onSuccess={() => dialog.current?.close()}><Hidden name="id" value={move.id}/><Hidden name="expected_version" value={move.version}/><CategorySelect categories={categories} selected={move.category}/><button className="top-btn primary">저장</button></ActionForm>}</dialog>
  </>;
}
function Threshold({ item }: { item: Item }) {
  const [value, setValue] = useState(String(item.low_stock_threshold));
  return <ActionForm action="item.threshold" className="threshold-form"><Hidden name="id" value={item.id}/><Hidden name="expected_version" value={item.version}/><div className="threshold-control"><input type="range" min="0" max="50" value={Math.min(Number(value), 50)} onChange={e => setValue(e.target.value)} aria-label={`${item.name} 부족 기준 슬라이더`}/><input name="threshold" type="number" min="0" max="999" required value={value} onChange={e => setValue(e.target.value)} aria-label={`${item.name} 부족 기준`}/><button type="submit" className="small-save">저장</button></div></ActionForm>;
}
