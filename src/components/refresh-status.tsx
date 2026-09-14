'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshStatus() {
  const router = useRouter();
  const [status, setStatus] = useState('자동 갱신 사용 중');
  useEffect(() => {
    let lastRefresh = 0;
    const refresh = () => {
      if (document.hidden) return;
      if (!navigator.onLine) { setStatus('오프라인 · 연결 후 다시 시도하세요'); return; }
      if (document.querySelector('form[data-dirty="true"],form[data-pending="true"]')) {
        setStatus('입력 중 · 저장 후 최신 내용 반영'); return;
      }
      if (Date.now() - lastRefresh < 3000) return;
      lastRefresh = Date.now(); router.refresh(); setStatus('자동 갱신 사용 중');
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh); window.removeEventListener('storage', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return <span className="refresh-status" role="status">{status}</span>;
}
