import { loadTrash, trashSnapshot } from '@/lib/inventory';
import { ActionForm, Hidden } from './forms';

export async function Trash() {
  const entries = await loadTrash();
  const kinds: Record<string, string> = { item: '모델', category: '카테고리', partner: '거래처' };
  return <section className="data-card"><div className="section-head"><div><h2>휴지통</h2><p>모델 영구 삭제 시 연결된 입출고 이력도 삭제되며 복구할 수 없습니다. 거래처만 삭제하면 기존 출고 이력은 유지됩니다. 상위 카테고리를 먼저 복구하세요.</p></div>{entries.length > 0 && <ActionForm action="trash.empty" confirm={`휴지통의 ${entries.length}개 항목과 연결된 모델·입출고 이력을 모두 영구 삭제합니다. 복구할 수 없습니다. 전체 비우기를 진행하시겠습니까?`}><Hidden name="snapshot" value={trashSnapshot(entries.map(e => e.id))}/><Hidden name="confirm_permanent" value="yes"/><button type="submit" className="top-btn danger-btn">전체 비우기</button></ActionForm>}</div>
    <div className="next-partner-list">{entries.length ? entries.map(entry => <article className="trash-entry" key={entry.id}>
      <div><strong>{entry.name}</strong><p>{kinds[entry.kind]} · 모델 {entry.items}개 · 카테고리 {entry.categories}개 · 거래처 {entry.partners}개</p><small>{entry.deleted_at} UTC</small></div>
      <div className="trash-actions"><ActionForm action="trash.restore"><Hidden name="group_id" value={entry.id}/><button className="top-btn primary">복구</button></ActionForm><ActionForm action="trash.purge" confirm={`${entry.name} 항목을 영구 삭제합니다. 포함된 모델·입출고 이력은 복구할 수 없습니다. 계속하시겠습니까?`}><Hidden name="group_id" value={entry.id}/><Hidden name="confirm_permanent" value="yes"/><button type="submit" className="top-btn danger-btn">영구 삭제</button></ActionForm></div>
    </article>) : <div className="empty-state"><h3>휴지통이 비어 있습니다.</h3></div>}</div>
  </section>;
}
