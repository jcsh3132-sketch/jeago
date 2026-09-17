'use client';
import { useEffect } from 'react';

export function SessionRenewal() {
  useEffect(() => {
    let lastSuccess = 0, pending = false, stopped = false;
    async function renew() {
      if (stopped || pending || document.hidden || !navigator.onLine || Date.now() - lastSuccess < 12 * 3600000) return;
      pending = true;
      try {
        const response = await fetch('/api/auth/renew', { method: 'POST', signal: AbortSignal.timeout(15000) });
        if (response.ok) lastSuccess = Date.now();
        // Do not discard an inventory form or retry its mutations when login expires.
      } catch { /* Retry after reconnecting or at the next interval. */ }
      finally { pending = false; }
    }
    void renew();
    const timer = setInterval(renew, 60000);
    window.addEventListener('focus', renew); window.addEventListener('online', renew);
    document.addEventListener('visibilitychange', renew);
    return () => {
      stopped = true; clearInterval(timer);
      window.removeEventListener('focus', renew); window.removeEventListener('online', renew);
      document.removeEventListener('visibilitychange', renew);
    };
  }, []);
  return null;
}
