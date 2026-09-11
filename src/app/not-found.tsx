import Link from 'next/link';
export default function NotFound() { return <div className="empty-state"><h2>요청한 페이지 또는 모델을 찾을 수 없습니다.</h2><Link href="/" className="top-btn primary">재고 목록으로</Link></div>; }
