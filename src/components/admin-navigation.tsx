import Link from 'next/link';
export function AdminNavigation() {
  return <nav className="admin-entry" aria-label="관리자 메뉴"><strong>관리자 메뉴</strong><Link href="/admin/users" className="top-btn">회원 관리</Link><Link href="/admin/trash" className="top-btn">휴지통</Link></nav>;
}
