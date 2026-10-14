// Jeago presentation adapter. Upstream prices and calculation formulas remain unchanged.
(() => {
  const tables = ['printerPriceTable', 'consumablePriceTable', 'filterPriceTable'].map(id => document.getElementById(id)).filter(Boolean);
  const filters = new Map();
  const menu = document.createElement('div'); menu.className = 'unified-column-menu'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '가격표 열 필터');
  document.getElementById('priceTableModal').append(menu);
  let active = null;
  function close() { menu.hidden = true; if (active) active.button.setAttribute('aria-expanded', 'false'); active = null; }
  const cellValue = (row, column) => (row.cells[column]?.textContent || '').trim();
  function apply(table) {
    const rules = filters.get(table.id), rows = [...table.tBodies[0].rows];
    for (const row of rows) row.hidden = !!rules && [...rules].some(([column, selected]) => selected.size > 0 && !selected.has(cellValue(row, column)));
    if (!table.hidden && rules && [...rules.values()].some(selected => selected.size)) {
      const count = rows.filter(row => !row.hidden && !row.querySelector('.price-table-empty')).length;
      document.getElementById('priceTableSummary').textContent = `검색 결과 ${count.toLocaleString('ko-KR')}개 · 열 필터 적용`;
    }
    for (const button of table.querySelectorAll('.unified-column-button')) button.classList.toggle('filtered', !!rules?.get(Number(button.dataset.column))?.size);
  }
  function open(table, column, button, label) {
    if (active?.button === button) { close(); return; } close();
    active = { table, column, button }; button.setAttribute('aria-expanded', 'true');
    const title = document.createElement('strong'); title.textContent = `${label} 필터`;
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = '필터 값 검색'; search.setAttribute('aria-label', `${label} 필터 값 검색`);
    const choices = document.createElement('div'); choices.className = 'unified-column-options';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '이 열 초기화';
    const tableRules = filters.get(table.id) || new Map(); filters.set(table.id, tableRules);
    const selected = tableRules.get(column) || new Set(); tableRules.set(column, selected);
    const values = [...new Set([...table.tBodies[0].rows].filter(row => !row.querySelector('.price-table-empty')).map(row => cellValue(row, column)))].sort((a,b) => a.localeCompare(b, 'ko', {numeric:true}));
    function render() {
      choices.replaceChildren();
      for (const value of values.filter(value => value.toLowerCase().includes(search.value.toLowerCase()))) {
        const labelNode = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span');
        checkbox.type = 'checkbox'; checkbox.checked = selected.has(value); text.textContent = value || '-';
        checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(value) : selected.delete(value); apply(table); });
        labelNode.append(checkbox, text); choices.append(labelNode);
      }
    }
    search.addEventListener('input', render);
    reset.addEventListener('click', () => { selected.clear(); render(); apply(table); if (![...tableRules.values()].some(v=>v.size)) document.getElementById('priceTableSummary').textContent = `표시 ${[...table.tBodies[0].rows].filter(r=>!r.hidden).length}개`; });
    render(); menu.replaceChildren(title, search, choices, reset); menu.hidden = false;
    const rect = button.getBoundingClientRect(); menu.style.left = `${Math.max(12,Math.min(rect.left,innerWidth - 272))}px`; menu.style.top = `${Math.max(12,Math.min(rect.bottom+6,innerHeight - 350))}px`; search.focus();
  }
  for (const table of tables) {
    table.classList.add('unified-price-table');
    for (const [column, th] of [...table.tHead.rows[0].cells].entries()) {
      // Replace printer-only handlers with the same filter for every tab/column.
      th.querySelectorAll('button').forEach(button => button.remove());
      const label = th.textContent.trim().replace(/\s+/g, ' '), button = document.createElement('button');
      button.type = 'button'; button.className = 'unified-column-button'; button.dataset.column = String(column); button.textContent = '▾'; button.setAttribute('aria-label', `${label} 필터`); button.setAttribute('aria-expanded','false');
      button.addEventListener('click', () => open(table, column, button, label)); th.append(button);
    }
    new MutationObserver(() => apply(table)).observe(table.tBodies[0], { childList:true });
    apply(table);
  }
  for (const tab of document.querySelectorAll('.price-view-tab')) tab.addEventListener('click', () => { close(); for (const table of tables) apply(table); });
  document.addEventListener('click', event => { if (!menu.contains(event.target) && !event.target.closest('.unified-column-button')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.stopImmediatePropagation(); const button=active?.button; close(); button?.focus(); } }, true);
  document.getElementById('priceTableCloseBtn').addEventListener('click', close);
})();
