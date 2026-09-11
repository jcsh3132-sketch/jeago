import type { Metadata } from 'next';
import { Shell } from '@/components/shell';
import './globals.css';
export const metadata: Metadata = { title: '재고 관리 | INVENTORY', description: '모델별 재고, 입출고, 카테고리 및 거래처 관리' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body><Shell>{children}</Shell></body></html>; }
