// Company credentials stay on the server. This module only receives product fees.
const apiState = { canManage: false, platforms: [] };
let apiMode = 'auto';
let apiFeeSelection = '';
let apiModel = '';
const connectionFor = (platform) => apiState.platforms.find(c => c.platform === platform);
const apiSupported = () => currentStore === 'smartstore' || currentStore === 'coupang';
const apiDate = (offset = 0) => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

async function apiRequest(input) {
  const response = await fetch('/api/calculator/connections', input ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(60000), cache: 'no-store',
  } : { cache: 'no-store' });
  let body; try { body = await response.json(); } catch { throw new Error('API 연결 상태를 확인하지 못했습니다.'); }
  if (!response.ok) throw new Error(body.message || 'API 요청에 실패했습니다.');
  apiState.canManage = body.canManage; apiState.platforms = body.platforms;
  renderApiSettings(); updateApiFee();
  return body;
}

function modelMatchesFee(fee, model) {
  const query = model.trim().toUpperCase(); if (!query) return false;
  if (String(fee.sku || '').trim().toUpperCase() === query) return true;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^A-Z0-9/-])' + escaped + '($|[^A-Z0-9/-])').test(String(fee.name).toUpperCase());
}

function updateApiFee() {
  const wrap = $('apiFeeControls'), supported = apiSupported();
  wrap.hidden = !supported;
  const model = saleFields.modelName.value.trim();
  if (model !== apiModel) { apiModel = model; apiFeeSelection = ''; }
  saleFields.feeRate.readOnly = false;
  if (!supported) return;
  const c = connectionFor(currentStore), select = $('apiFeeProduct');
  const rates = c?.fees || [], matches = rates.filter(fee => modelMatchesFee(fee, model));
  const options = [new Option('선택 모델과 자동 연결', '')];
  for (const fee of rates) options.push(new Option(`${fee.name} · ${fee.rate}%`, fee.id));
  select.replaceChildren(...options);
  select.value = apiFeeSelection;
  if (select.value !== apiFeeSelection) apiFeeSelection = '';
  select.disabled = apiMode !== 'auto' || !rates.length;
  $('apiFeeMode').value = apiMode;
  const selected = rates.find(fee => fee.id === apiFeeSelection) || (matches.length === 1 ? matches[0] : undefined);
  let status;
  if (apiMode === 'manual') {
    status = '직접 입력한 수수료율을 적용합니다.';
  } else if (selected) {
    saleFields.feeRate.value = selected.rate;
    saleFields.feeRate.readOnly = true;
    status = `${selected.source} · ${selected.rate}% · ${selected.samples}건 기준 · ${c.rangeFrom} ~ ${c.rangeTo}`;
    if (Date.now() - c.syncedAt > 24 * 3600000) status += ' · 이전 조회값(갱신 필요)';
  } else {
    saleFields.feeRate.value = storeFeeRates[currentStore] ?? stores[currentStore].rate;
    status = !c?.configured ? '회사 API를 연결하면 상품별 수수료를 자동 적용합니다. 현재는 직접 입력 기준입니다.'
      : matches.length > 1 ? '일치하는 API 상품이 여러 개입니다. 수수료 기준 상품을 선택하거나 직접 입력해주세요.'
      : '이 모델의 조회 수수료가 없습니다. API 상품을 선택하거나 수수료율을 직접 입력해주세요.';
  }
  $('apiFeeStatus').textContent = status;
  calculateSale(false);
}

function renderApiSettings() {
  $('apiAdminNotice').textContent = apiState.canManage ? '회사 API 키는 관리자가 등록하며 모든 직원의 계산에 함께 적용됩니다. 저장된 키를 유지하려면 입력칸을 비워두세요.' : '회사 API 키는 관리자가 등록합니다. 직원들은 조회된 수수료를 함께 사용할 수 있습니다.';
  for (const platform of ['smartstore', 'coupang']) {
    const form = document.querySelector(`[data-api-platform="${platform}"]`), c = connectionFor(platform);
    form.querySelector('.api-credentials').hidden = !apiState.canManage;
    form.querySelector('[data-api-save]').hidden = !apiState.canManage;
    const disconnect = form.querySelector('[data-api-disconnect]');
    disconnect.hidden = !apiState.canManage || !c?.configured;
    form.querySelector('[data-api-refresh]').disabled = !c?.configured || !!c?.syncing;
    const synced = c?.syncedAt ? new Date(c.syncedAt).toLocaleString('ko-KR') : '';
    form.querySelector('.api-connection-status').textContent = c?.configured ? `키 등록됨 · ${c.fees.length}개 상품${synced ? ' · 조회 ' + synced : ' · 수수료 조회 필요'}${c.syncing ? ' · 회사 PC 조회 대기/진행 중' : ''}${c.lastError ? ' · ' + c.lastError : ''}` : '연결된 회사 API가 없습니다.';
  }
}

async function refreshPlatform(platform, automatic = false) {
  const form = document.querySelector(`[data-api-platform="${platform}"]`);
  const status = form.querySelector('.api-action-status'), button = form.querySelector('[data-api-refresh]');
  status.textContent = '수수료를 조회하고 있습니다.'; button.disabled = true;
  try {
    await apiRequest({ action: 'refresh', platform, ...(!automatic ? { from: form.elements.from.value, to: form.elements.to.value } : {}) });
    if (connectionFor(platform)?.syncing) { status.textContent = '회사 PC에 조회를 요청했습니다. PC 연결 프로그램이 켜져 있으면 자동 갱신됩니다.'; return; }
    const count = connectionFor(platform)?.fees.length || 0;
    status.textContent = count ? `${count}개 상품의 수수료를 갱신했습니다.` : '연결은 확인됐지만 선택 기간의 상품 수수료 내역이 없습니다. 조회 날짜를 변경해주세요.';
  } catch (error) {
    status.textContent = error.message || '수수료 조회를 완료하지 못했습니다.';
    if (currentStore === platform) $('apiFeeStatus').textContent = `수수료 갱신 실패 · ${status.textContent} 기존 조회값 또는 직접 입력값을 사용합니다.`;
  } finally { button.disabled = !connectionFor(platform)?.configured; }
}

function setupApiSettings() {
  const dialog = $('apiSettingsDialog');
  $('apiSettingsBtn').addEventListener('click', () => { dialog.showModal(); apiRequest().catch(error => { $('apiAdminNotice').textContent = error.message; }); });
  $('apiSettingsClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.querySelectorAll('.api-credentials input').forEach(input => { input.value = ''; }));
  for (const form of dialog.querySelectorAll('[data-api-platform]')) {
    form.elements.from.value = apiDate(-7); form.elements.to.value = apiDate(-1);
    form.elements.from.max = apiDate(); form.elements.to.max = apiDate();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const platform = form.dataset.apiPlatform, status = form.querySelector('.api-action-status'), save = form.querySelector('[data-api-save]');
      const input = { action: 'save', platform, revision: connectionFor(platform)?.revision || 0 };
      for (const field of form.querySelectorAll('.api-credentials input')) input[field.name] = field.value;
      save.disabled = true; status.textContent = 'API 키를 저장하고 있습니다.';
      try {
        await apiRequest(input);
        form.querySelectorAll('.api-credentials input').forEach(field => { field.value = ''; });
        status.textContent = '키를 저장했습니다. 연결을 확인하고 수수료를 조회합니다.';
        await refreshPlatform(platform);
      } catch (error) { status.textContent = error.message || 'API 키를 저장하지 못했습니다.'; }
      finally { save.disabled = false; }
    });
    form.querySelector('[data-api-refresh]').addEventListener('click', () => refreshPlatform(form.dataset.apiPlatform));
    form.querySelector('[data-api-disconnect]').addEventListener('click', async () => {
      if (!confirm('회사 API 연결을 해제할까요? 모든 직원의 자동 수수료 적용이 해제됩니다.')) return;
      try { await apiRequest({ action: 'disconnect', platform: form.dataset.apiPlatform, revision: connectionFor(form.dataset.apiPlatform)?.revision }); form.querySelector('.api-action-status').textContent = '회사 API 연결을 해제했습니다.'; }
      catch (error) { form.querySelector('.api-action-status').textContent = error.message; }
    });
  }
  $('apiFeeMode').addEventListener('change', event => { apiMode = event.target.value; if (apiMode === 'manual') saleFields.feeRate.value = storeFeeRates[currentStore] ?? stores[currentStore].rate; updateApiFee(); });
  $('apiFeeProduct').addEventListener('change', event => { apiFeeSelection = event.target.value; updateApiFee(); });
  saleFields.feeRate.addEventListener('input', () => { if (apiSupported()) { apiMode = 'manual'; $('apiFeeMode').value = 'manual'; updateApiFee(); } });
  saleFields.modelName.addEventListener('input', updateApiFee);
  apiRequest().then(async () => {
    for (const c of apiState.platforms) if (c.shouldRefresh && !c.syncing) await refreshPlatform(c.platform, true);
  }).catch(error => { $('apiAdminNotice').textContent = error.message; });
}

setupApiSettings();

setInterval(() => { if (apiState.platforms.some(c => c.syncing)) apiRequest().catch(() => {}); }, 5000);
