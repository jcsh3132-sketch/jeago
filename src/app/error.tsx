'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="form-card"><h2>데이터를 불러오지 못했습니다.</h2><p>DB 연결 설정과 실행 터미널의 오류를 확인한 뒤 다시 시도하세요.</p><button className="top-btn primary" onClick={reset}>다시 시도</button></div>;
}
