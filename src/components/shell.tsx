'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RefreshStatus } from './refresh-status';
const nav = [['/', '▦', '재고 현황'], ['/add', '＋', '모델 등록'], ['/transactions', '↻', '입출고 내역'], ['/categories', '≡', '카테고리 관리'], ['/partners', '◎', '거래처 관리'], ['/trash', '↶', '휴지통']];
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const title = nav.find(n => n[0] === path)?.[2] || (path.startsWith('/edit/') ? '모델 수정' : path.startsWith('/inbound/') ? '입고 처리' : path.startsWith('/outbound/') ? '출고 처리' : path.startsWith('/history/') ? '입출고 이력' : '재고 관리');
  return <div className="app-shell">
    <aside className="app-sidebar"><div className="brand"><div className="brand-mark">I</div><div><strong>INVENTORY</strong><span>Internal Stock Manager</span></div></div>
      <nav className="side-nav" aria-label="주 메뉴">{nav.map(([href, icon, text]) => <Link key={href} href={href} className={`side-link ${path === href ? 'active' : ''}`}><span className="nav-icon">{icon}</span><span>{text}</span></Link>)}</nav>
      <div className="sidebar-footer"><span className="status-dot"/><div><b>내부 운영 시스템</b><small>재고 · 입출고 · 거래처</small></div></div></aside>
    <nav className="mobile-nav" aria-label="모바일 메뉴">{nav.map(([href, icon, text]) => <Link key={href} href={href} className={`mobile-nav-link ${path === href ? 'active' : ''}`}><span>{icon}</span><b>{text}</b></Link>)}</nav>
    <section className="app-main"><header className="topbar"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{title}</h1><RefreshStatus/></div><div className="top-actions"><Link href="/" className="top-btn ghost">재고 목록</Link><Link href="/add" className="top-btn primary">+ 모델 추가</Link></div></header><main className="content-area">{children}</main></section>
  </div>;
}
