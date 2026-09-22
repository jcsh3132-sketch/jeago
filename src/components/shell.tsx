'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RefreshStatus } from './refresh-status';
import { LogoutButton } from './auth-panel';
import { SessionRenewal } from './session-renewal';
const nav = [['/', '▦', '재고 현황'], ['/add', '＋', '모델 등록'], ['/transactions', '↻', '입출고 내역'], ['/categories', '≡', '카테고리 관리'], ['/partners', '◎', '거래처 관리'], ['/trash', '↶', '휴지통']];
export function Shell({ children, username }: { children: ReactNode; username: string }) {
  const path = usePathname();
  const title = nav.find(n => n[0] === path)?.[2] || (path === '/batch-outbound' ? '묶음 출고' : path === '/admin/users' ? '회원 관리' : path === '/account' ? '내 계정' : path.startsWith('/edit/') ? '모델 수정' : path.startsWith('/inbound/') ? '입고 처리' : path.startsWith('/outbound/') ? '출고 처리' : path.startsWith('/history/') ? '입출고 이력' : '재고 관리');
  return <div className="app-shell"><SessionRenewal/>
    <aside className="app-sidebar"><a href="/" className="brand brand-home" aria-label="재고 관리 첫 화면 새로고침"><div className="brand-mark">▦</div><div><strong>재고 관리</strong><span>재고 · 입고 · 출고</span></div></a>
      <nav className="side-nav" aria-label="주 메뉴">{nav.map(([href, icon, text]) => <Link key={href} href={href} className={`side-link ${path === href ? 'active' : ''}`}><span className="nav-icon">{icon}</span><span>{text}</span></Link>)}</nav>
      <div className="sidebar-footer"><span className="status-dot"/><div><b>내부 운영 시스템</b><small>재고 · 입출고 · 거래처</small></div></div></aside>
    <nav className="mobile-nav" aria-label="모바일 메뉴">{nav.map(([href, icon, text]) => <Link key={href} href={href} className={`mobile-nav-link ${path === href ? 'active' : ''}`}><span>{icon}</span><b>{text}</b></Link>)}</nav>
    <section className="app-main"><header className="topbar"><div><p className="eyebrow"><a href="/" className="home-refresh" aria-label="재고 관리 첫 화면 새로고침">재고 관리</a></p><h1>{title}</h1><RefreshStatus/></div><div className="top-actions"><Link href="/account" className="account-link" aria-label="내 계정"><span className="account-name">{username}님</span><b>내 계정</b></Link><LogoutButton/><Link href="/add" className="top-btn primary">+ 모델 추가</Link></div></header><main className="content-area">{children}</main></section>
  </div>;
}
