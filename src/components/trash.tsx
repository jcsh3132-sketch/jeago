import { loadTrash } from '@/lib/inventory';
import { ActionForm, Hidden } from './forms';

export async function Trash() {
  const entries = await loadTrash();
  const kinds: Record<string, string> = { item: '모델', category: '카테고리', partner: '거래처' };
  return <section className="data-card"><div className="section-head"><div><span className="section-kicker">RECOVERY</span><h2>휴지통</h2><p>삭제한 모델의 재고와 입출고 이력을 함께 보관합니다. 상위 카테고리가 삭제되었다면 먼저 복구하세요.</p></div></div>
    <div className="next-partner-list">{entries.length ? entries.map(entry => <article className="trash-entry" key={entry.id}>
      <div><strong>{entry.name}</strong><p>{kinds[entry.kind]} · 모델 {entry.items}개 · 카테고리 {entry.categories}개 · 거래처 {entry.partners}개</p><small>{entry.deleted_at} UTC</small></div>
      <ActionForm action="trash.restore"><Hidden name="group_id" value={entry.id}/><button className="top-btn primary">복구</button></ActionForm>
    </article>) : <div className="empty-state"><h3>휴지통이 비어 있습니다.</h3></div>}</div>
  </section>;
}
