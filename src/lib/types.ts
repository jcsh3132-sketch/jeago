export const MANAGERS = ['김채희', '이승철', '이무현', '장수민', '황진철'];
export const DEFAULT_MAINS = ['컬러 복합기', '흑백 복합기', '컬러 소형 복합기', '흑백 소형 프린터', '미분류'];
export type Category = { id: number; name: string; display_name: string | null; parent_id: number | null };
export type Item = { id: number; name: string; quantity: number; low_stock_threshold: number; manager: string; category: string };
export type Partner = { id: number; name: string; contact_person: string; phone: string; note: string };
export type StockTransaction = { id: number; item_id: number; quantity: number; transaction_type: string; manager: string; customer_name: string | null; date: string };
export type InventoryData = { categories: Category[]; items: Item[]; partners: Partner[]; transactions: StockTransaction[] };
export const label = (c?: Category) => c?.display_name || c?.name || '';
export function ancestry(categories: Category[], key: string) {
  const leaf = categories.find(c => c.name === key);
  const device = categories.find(c => c.id === leaf?.parent_id);
  const main = categories.find(c => c.id === device?.parent_id);
  return { leaf, device, main };
}
export const categoryPath = (categories: Category[], key: string) => {
  const { main, device, leaf } = ancestry(categories, key);
  return [main, device, leaf].filter(Boolean).map(label).join(' · ');
};
export const stockState = (i: Item) => i.quantity === 0 ? 'out' : i.quantity <= i.low_stock_threshold ? 'low' : 'good';
