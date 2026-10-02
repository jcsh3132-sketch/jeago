// Keep preferences/history separate for each signed-in member on shared devices.
const calculatorStorage = {
  getItem(key) { try { return localStorage.getItem('jeago:calculator:' + document.body.dataset.account + ':' + key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem('jeago:calculator:' + document.body.dataset.account + ':' + key, value); } catch { /* Storage unavailable: calculations still work. */ } },
  removeItem(key) { try { localStorage.removeItem('jeago:calculator:' + document.body.dataset.account + ':' + key); } catch { /* Storage unavailable. */ } },
};
/* =========================================================
  베스트 시스템 판매 계산기 - script.js
  ---------------------------------------------------------
  이 파일은 기능만 담당합니다.

  주요 기능:
  - 판매용 / 임대용 페이지 전환
  - 스토어별 기본 수수료율 적용
  - 판매용 계산
  - 임대용 계산
  - 최근 계산 기록 저장
  - 회사 API 수수료 연동
========================================================= */


/* =========================================================
  1. 스토어별 기본 수수료율
  ---------------------------------------------------------
  수수료율을 바꾸고 싶으면 rate 숫자만 수정하면 됩니다.

  예:
  쿠팡 수수료율을 10%에서 11%로 바꾸려면
  coupang: { name: "쿠팡", rate: 11 }
========================================================= */
const stores = {
  smartstore: { name: "스마트스토어", rate: 3.5 },
  coupang: { name: "쿠팡", rate: 10 },
  gmarket: { name: "지마켓/옥션", rate: 13 },
  eleven: { name: "11번가", rate: 12 },
  school: { name: "학교장터", rate: 5 }
};

const STORE_FEE_KEY = "storeFeeRates";


/* document.getElementById를 짧게 쓰기 위한 함수입니다. */
const $ = (id) => document.getElementById(id);


/* =========================================================
  2. 판매용 입력칸 연결
  ---------------------------------------------------------
  HTML에 있는 입력칸 id와 JavaScript를 연결합니다.
========================================================= */
const saleFields = {
  modelName: $("modelName"),
  salePrice: $("salePrice"),
  feeRate: $("feeRate"),
  shippingCost: $("shippingCost"),
  productCost: $("productCost")
};


/* 판매용 결과값이 표시될 HTML 요소입니다. */
const saleResults = {
  modelResult: $("modelResult"),
  netAmount: $("netAmount"),
  saleResult: $("saleResult"),
  feeResult: $("feeResult"),
  shippingResult: $("shippingResult"),
  costResult: $("costResult"),
  marginResult: $("marginResult"),
  marginRateResult: $("marginRateResult")
};


/* =========================================================
  3. 임대용 입력칸 연결
========================================================= */
const rentFields = {
  rentModelName: $("rentModelName"),
  rentYears: $("rentYears"),
  faxKit: $("faxKit"),
  wirelessKit: $("wirelessKit"),
  blackCopies: $("blackCopies"),
  colorCopies: $("colorCopies")
};


/* 임대용 결과값이 표시될 HTML 요소입니다. */
const rentResults = {
  rentModelResult: $("rentModelResult"),
  rentModelDetail: $("rentModelDetail"),
  rentMonthlyTotal: $("rentMonthlyTotal"),
  rentBaseResult: $("rentBaseResult"),
  rentConditionResult: $("rentConditionResult"),
  rentPeriodResult: $("rentPeriodResult"),
  rentOptionResult: $("rentOptionResult"),
  rentUsageResult: $("rentUsageResult"),
  rentContractTotal: $("rentContractTotal"),
  rentDepositResult: $("rentDepositResult")
};


/* 현재 선택된 스토어입니다. 기본값은 스마트스토어입니다. */
let currentStore = "smartstore";
let saleProducts = [];
let printerProducts = [];
let consumableProducts = [];
let filterProducts = [];
let productByModel = new Map();
let priceTableView = "printer";
let priceColumnFilters = {};
let activePriceFilterField = null;
let rentProducts = [];
let rentProductByModel = new Map();
let selectedRentProduct = null;

function loadStoreFeeRates() {
  try {
    const saved = JSON.parse(calculatorStorage.getItem(STORE_FEE_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch (error) {
    calculatorStorage.removeItem(STORE_FEE_KEY);
    return {};
  }
}

let storeFeeRates = loadStoreFeeRates();


/*
  최근 계산 기록입니다.
  localStorage를 사용하기 때문에 브라우저를 닫았다 열어도 기록이 남습니다.
*/
function loadHistory(key) {
  try {
    const saved = JSON.parse(calculatorStorage.getItem(key) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    console.warn(`${key} 기록을 불러오지 못해 초기화합니다.`, error);
    calculatorStorage.removeItem(key);
    return [];
  }
}

let rentHistory = loadHistory("rentHistoryVersion");


/* =========================================================
  4. 공통 보조 함수
========================================================= */

/* 숫자를 100,000원 같은 한국식 원화 표기로 바꿉니다. */
function won(value) {
  return Math.round(value || 0).toLocaleString("ko-KR") + "원";
}

function priceText(value) {
  return value === null || value === undefined ? "-" : won(value);
}

/* 입력칸 값을 숫자로 바꾸는 함수입니다. */
function num(input) {
  const value = Number(String(input.value).replaceAll(",", ""));
  return Number.isFinite(value) ? value : 0;
}

/* 금액 입력칸을 300,000 형식으로 표시합니다. */
function formatCurrencyField(input) {
  const digits = input.value.replace(/[^0-9]/g, "");
  input.value = digits ? Number(digits).toLocaleString("ko-KR") : "";
}

/* 금액과 개월 수는 화면 표시와 계산 결과가 일치하도록 정수로 처리합니다. */
function integer(input) {
  return Math.round(num(input));
}

/* 기록에는 날짜와 시간을 함께 저장합니다. */
function timestamp() {
  return new Date().toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* 외부 API나 직접 입력으로 잘못된 값이 들어오면 기록 저장을 막습니다. */
function validate(fields) {
  const invalid = fields.find((field) => !field.checkValidity());
  if (!invalid) return true;

  invalid.reportValidity();
  invalid.focus();
  return false;
}

/* 상단 오른쪽 날짜 배지에 오늘 날짜를 넣습니다. */
function today() {
  const d = new Date();

  $("todayText").textContent = d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}


/* =========================================================
  5. 스토어 선택 기능
  ---------------------------------------------------------
  스토어 탭을 클릭하면 해당 스토어 이름과 기본 수수료율이 적용됩니다.
========================================================= */
function loadStore(storeKey) {
  currentStore = storeKey;

  const base = stores[storeKey];

  saleFields.feeRate.value = storeFeeRates[storeKey] ?? base.rate;
  $("storeBadge").textContent = base.name;

  document.querySelectorAll(".store-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.store === storeKey);
  });

  if (typeof updateApiFee === "function") updateApiFee();
  calculateSale(false);
}


/* =========================================================
  6. 판매용 계산 기능
  ---------------------------------------------------------
  계산식:
  플랫폼 수수료 = 판매금액 × 수수료율
  예상 실수령액 = 판매금액 - 플랫폼 수수료 - 배송비
  예상 마진 = 판매금액 - 플랫폼 수수료 - 배송비 - 상품원가
========================================================= */
function calculateSale(addHistory = true) {
  if (addHistory && !validate(Object.values(saleFields))) return;

  const model = saleFields.modelName.value.trim() || "모델명 미입력";
  const sale = integer(saleFields.salePrice);
  const rate = num(saleFields.feeRate);
  const shipping = integer(saleFields.shippingCost);
  const cost = integer(saleFields.productCost);

  const fee = Math.round(sale * (rate / 100));
  const net = sale - fee - shipping;
  const margin = sale - fee - shipping - cost;
  const marginRate = sale > 0 ? (margin / sale) * 100 : null;

  saleResults.modelResult.textContent = model;
  saleResults.netAmount.textContent = won(net);
  saleResults.saleResult.textContent = won(sale);
  saleResults.feeResult.textContent = won(fee);
  saleResults.shippingResult.textContent = won(shipping);
  saleResults.costResult.textContent = won(cost);
  saleResults.marginResult.textContent = won(margin);
  saleResults.marginRateResult.textContent = marginRate === null
    ? "-"
    : `${marginRate.toFixed(1)}%`;
  updateMarginGrade(marginRate);
  updateTargetPrices(cost, shipping, rate);
}

function targetSalePrice(cost, shipping, feeRate, marginRate) {
  const denominator = 1 - (feeRate / 100) - (marginRate / 100);
  if (denominator <= 0) return null;
  return Math.ceil(((cost + shipping) / denominator) / 1000) * 1000;
}

function updateTargetPrices(cost, shipping, feeRate) {
  [5, 8, 10].forEach((marginRate) => {
    const price = targetSalePrice(cost, shipping, feeRate, marginRate);
    $(`targetPrice${marginRate}`).textContent = price === null ? "계산 불가" : won(price);
  });
}

function updateMarginGrade(marginRate) {
  const grade = $("marginGrade");
  grade.className = "margin-grade";

  if (marginRate === null) {
    grade.classList.add("waiting");
    grade.textContent = "판매금액을 입력하면 추천 여부를 알려드립니다.";
  } else if (marginRate < 5) {
    grade.classList.add("bad");
    grade.textContent = "추천하지 않음 · 마진율 5% 미만";
  } else if (marginRate < 8) {
    grade.classList.add("normal");
    grade.textContent = "보통 · 목표 마진율 8% 미만";
  } else {
    grade.classList.add("good");
    grade.textContent = "추천 · 목표 마진율 8% 이상";
  }
}

function setLookupStatus(message, type = "") {
  const status = $("modelLookupStatus");
  status.textContent = message;
  status.className = `field-status ${type}`.trim();
}

function findProduct(model) {
  return productByModel.get(model.trim().toUpperCase());
}

/* 대상 프린터가 등록되지 않은 렌탈 소모품은 엑셀의 대상 모델 문구를 그대로 보여줍니다. */
function compatibleSummary(product, limit = 2) {
  const models = product.compatibleModels || [];
  if (!models.length) return product.targetText || "";
  if (models.length <= limit) return models.join(", ");
  return `${models.slice(0, limit).join(", ")} 외 ${models.length - limit}개`;
}

function getModelGroup(product) {
  if (product.kind === "consumable") return "소모품";
  if (product.kind === "filter") return "공청기 필터";
  if (product.isRental) return "렌탈모델";
  if (/DMFP/i.test(product.category)) return "대형 복합기";

  const type = `${product.category} ${product.productType}`;
  if (type.includes("잉크젯")) return "잉크젯";
  if (type.includes("저속기")) return "저속기";
  return "고속기";
}

function renderModelDropdown(query = "") {
  const dropdown = $("modelDropdown");
  const keyword = query.trim().toUpperCase();
  const filtered = saleProducts.filter((product) => {
    /* 소모품은 대상 프린터 모델명으로도 검색됩니다. */
    const searchable = [
      product.model,
      product.category,
      product.productType,
      product.feature,
      product.color,
      product.kind === "consumable" ? product.targetText : "",
      ...(product.compatibleModels || [])
    ].join(" ").toUpperCase();
    return !keyword || searchable.includes(keyword);
  });

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "model-empty";
    empty.textContent = "일치하는 모델이 없습니다.";
    dropdown.replaceChildren(empty);
    return;
  }

  const groups = ["잉크젯", "저속기", "고속기", "대형 복합기", "렌탈모델", "소모품", "공청기 필터"];
  const sections = groups.flatMap((groupName) => {
    const groupProducts = filtered.filter((product) => getModelGroup(product) === groupName);
    if (!groupProducts.length) return [];

    const section = document.createElement("section");
    section.className = "model-group";

    const title = document.createElement("div");
    title.className = "model-group-title";
    title.textContent = `${groupName} · ${groupProducts.length}개`;
    section.append(title);

    groupProducts.forEach((product) => {
      const option = document.createElement("button");
      option.className = "model-option";
      option.type = "button";
      option.setAttribute("role", "option");

      const model = document.createElement("strong");
      model.textContent = product.model;
      const detail = document.createElement("span");
      if (product.kind === "consumable") {
        detail.textContent = [product.color, product.yield, compatibleSummary(product)].filter(Boolean).join(" · ");
      } else if (product.kind === "filter") {
        detail.textContent = [product.stock && `재고 ${product.stock}`, `매입가 ${priceText(product.purchasePrice)}`].filter(Boolean).join(" · ");
      } else {
        detail.textContent = [product.productType, product.feature].filter(Boolean).join(" · ");
      }
      option.append(model, detail);

      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        saleFields.modelName.value = product.model;
        applyProductFromModel();
        closeModelDropdown();
      });
      section.append(option);
    });

    return [section];
  });

  dropdown.replaceChildren(...sections);
}

function openModelDropdown() {
  renderModelDropdown(saleFields.modelName.value);
  $("modelDropdown").classList.add("open");
  $("modelToggleBtn").setAttribute("aria-expanded", "true");
}

function closeModelDropdown() {
  $("modelDropdown").classList.remove("open");
  $("modelToggleBtn").setAttribute("aria-expanded", "false");
}

function toggleModelDropdown() {
  saleFields.modelName.focus();
  renderModelDropdown("");
  $("modelDropdown").classList.add("open");
  $("modelToggleBtn").setAttribute("aria-expanded", "true");
}

function applyProductFromModel() {
  const model = saleFields.modelName.value.trim();
  if (typeof updateApiFee === "function") updateApiFee();
  if (!model) {
    saleFields.productCost.value = "0";
    setLookupStatus(`${saleProducts.length.toLocaleString("ko-KR")}개 모델에서 검색할 수 있습니다.`);
    calculateSale(false);
    return;
  }

  const product = findProduct(model);
  if (!product) {
    setLookupStatus("일치하는 모델이 없습니다. 추천 목록에서 모델을 선택해 주세요.", "warning");
    return;
  }

  if (product.status === "duplicate_cost") {
    saleFields.productCost.value = "0";
    setLookupStatus(
      `구매가가 2개입니다(12% ${won(product.purchase12)}, 20% ${won(product.purchase20)}). 시트를 확인해 주세요.`,
      "error"
    );
  } else if (product.status === "missing_cost" || product.productCost === null) {
    saleFields.productCost.value = "0";
    const sheetName = product.sourceSheet
      || { consumable: "소모품", filter: "필터판매금액" }[product.kind]
      || "프린터 가격";
    setLookupStatus(`원가가 비어 있습니다. 엑셀 「${sheetName}」 시트 ${product.rowNumber}행을 확인해 주세요.`, "error");
  } else {
    saleFields.productCost.value = product.productCost;
    formatCurrencyField(saleFields.productCost);
    const extraText = product.kind === "consumable"
      ? ` · 대상: ${compatibleSummary(product, 3)}`
      : product.isRental ? " · 렌탈전용모델" : "";
    setLookupStatus(`${product.costSource} ${won(product.productCost)} 적용${extraText}`, "success");
  }

  calculateSale(false);
}

async function loadSaleProducts() {
  setLookupStatus("가격표 파일에서 모델을 불러오는 중입니다.");
  try {
    const response = await fetch("/calculator/content/sale-products", { cache: "no-store" });
    if (!response.ok) {
      const detail = await response.json().then((body) => body.detail).catch(() => "");
      throw new Error(detail || "모델 데이터를 불러오지 못했습니다.");
    }

    const data = await response.json();
    saleProducts = data.products || [];
    printerProducts = saleProducts.filter((product) => product.kind === "printer");
    consumableProducts = saleProducts.filter((product) => product.kind === "consumable");
    filterProducts = saleProducts.filter((product) => product.kind === "filter");
    productByModel = new Map(
      saleProducts.map((product) => [product.model.toUpperCase(), product])
    );

    renderModelDropdown();
    renderPriceTable();

    const duplicateCount = saleProducts.filter((product) => product.status === "duplicate_cost").length;
    const updateText = data.priceUpdate ? ` · ${data.priceUpdate.label} 가격 반영` : "";
    const suffix = `${updateText}${duplicateCount ? ` · 구매가 중복 ${duplicateCount}건 확인 필요` : ""}`;
    setLookupStatus(
      `${data.file} · 프린터 ${printerProducts.length.toLocaleString("ko-KR")}개 · 소모품 ${consumableProducts.length.toLocaleString("ko-KR")}개 · 필터 ${filterProducts.length.toLocaleString("ko-KR")}개 연결 완료${suffix}`,
      duplicateCount ? "warning" : "success"
    );
  } catch (error) {
    console.error(error);
    setLookupStatus(`가격표를 불러오지 못했습니다. ${error.message}`, "error");
    $("priceTableSummary").textContent = "가격표를 불러오지 못했습니다.";
    $("printerPriceTableBody").innerHTML = '<tr><td colspan="9" class="price-table-empty">화면을 새로고침한 뒤 다시 시도해 주세요.</td></tr>';
  }
}

function normalizeFilter(value) {
  return String(value || "")
    .replaceAll(",", "")
    .trim()
    .toLocaleUpperCase("ko-KR");
}

function renderPriceTable() {
  const isPrinter = priceTableView === "printer";
  document.querySelectorAll(".price-view-tab").forEach((tab) => {
    const active = tab.dataset.view === priceTableView;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $("printerPriceTable").hidden = !isPrinter;
  $("consumablePriceTable").hidden = priceTableView !== "consumable";
  $("filterPriceTable").hidden = priceTableView !== "filter";
  if (!isPrinter) closeColumnFilter();
  if (isPrinter) renderPrinterPriceTable();
  else if (priceTableView === "consumable") renderConsumablePriceTable();
  else renderFilterPriceTable();
}

function renderFilterPriceTable() {
  const body = $("filterPriceTableBody");
  const keyword = normalizeFilter($("priceTableSearch").value);
  const filtered = filterProducts.filter((product) => !keyword || normalizeFilter(product.model).includes(keyword));

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="4" class="price-table-empty">${filterProducts.length ? "검색 결과가 없습니다." : "표시할 필터가 없습니다."}</td></tr>`;
    $("priceTableSummary").textContent = keyword ? "검색 결과 0개" : "표시할 필터가 없습니다.";
    return;
  }

  body.replaceChildren(...filtered.map((product) => {
    const row = document.createElement("tr");
    [product.model, product.stock || "-", priceText(product.purchasePrice), priceText(product.suggestedPrice)]
      .forEach((value, index) => {
        const column = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) column.scope = "row";
        column.textContent = value;
        if (index >= 2) column.className = "price-column";
        row.append(column);
      });
    return row;
  }));
  $("priceTableSummary").textContent = keyword
    ? `검색 결과 ${filtered.length.toLocaleString("ko-KR")}개`
    : `총 ${filterProducts.length.toLocaleString("ko-KR")}개 공청기 필터`;
}

function renderConsumablePriceTable() {
  const body = $("consumablePriceTableBody");
  const keyword = normalizeFilter($("priceTableSearch").value);
  const filtered = consumableProducts.filter((product) => !keyword || [
    product.category,
    product.model,
    product.color,
    product.supplyStatus,
    product.targetText,
    ...(product.compatibleModels || [])
  ].some((value) => normalizeFilter(value).includes(keyword)));

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" class="price-table-empty">${consumableProducts.length ? "검색 결과가 없습니다." : "표시할 소모품이 없습니다."}</td></tr>`;
    $("priceTableSummary").textContent = keyword ? "검색 결과 0개" : "표시할 소모품이 없습니다.";
    return;
  }

  body.replaceChildren(...filtered.map((product) => {
    const row = document.createElement("tr");
    const values = [
      product.category || "-",
      product.model,
      product.supplyStatus || "-",
      product.color || "-",
      product.yield || "-",
      compatibleSummary(product, Infinity) || "-",
      priceText(product.salePriceWithVat),
      priceText(product.productCost)
    ];
    values.forEach((value, index) => {
      const column = document.createElement(index === 1 ? "th" : "td");
      if (index === 1) column.scope = "row";
      column.textContent = value;
      if (index === 5) column.className = "compatible-column";
      if (index >= 6) column.className = "price-column";
      if (index === 7) column.title = product.costSource;
      row.append(column);
    });
    return row;
  }));
  $("priceTableSummary").textContent = keyword
    ? `검색 결과 ${filtered.length.toLocaleString("ko-KR")}개`
    : `총 ${consumableProducts.length.toLocaleString("ko-KR")}개 소모품 (등록 프린터 대상)`;
}

function renderPrinterPriceTable() {
  const body = $("printerPriceTableBody");
  if (!printerProducts.length) {
    body.innerHTML = '<tr><td colspan="9" class="price-table-empty">표시할 가격 데이터가 없습니다.</td></tr>';
    $("priceTableSummary").textContent = "표시할 가격 데이터가 없습니다.";
    return;
  }

  const keyword = normalizeFilter($("priceTableSearch").value);
  const columnFilters = Object.entries(priceColumnFilters)
    .filter(([, value]) => Array.isArray(value) ? value.length : value);
  const filteredProducts = printerProducts.filter((product) => {
    const matchesSearch = !keyword || [
      product.category,
      product.model,
      product.feature,
      product.productType,
      product.salesRoute
    ].some((value) => normalizeFilter(value).includes(keyword));
    const matchesColumns = columnFilters.every(([field, value]) => {
      const productValue = normalizeFilter(product[field]);
      if (Array.isArray(value)) {
        if (field === "releasePriceExVat") {
          const maximumPrice = Math.max(...value.map(Number));
          return product[field] !== null
            && product[field] !== undefined
            && Number(product[field]) <= maximumPrice;
        }
        return value.some((selected) => productValue === normalizeFilter(selected));
      }
      return productValue.includes(normalizeFilter(value));
    });
    return matchesSearch && matchesColumns;
  });

  if (!filteredProducts.length) {
    body.innerHTML = '<tr><td colspan="9" class="price-table-empty">검색 결과가 없습니다.</td></tr>';
    $("priceTableSummary").textContent = "검색 결과 0개";
    return;
  }

  body.replaceChildren(...filteredProducts.map((product) => {
    const row = document.createElement("tr");
    const values = [
      product.category || "-",
      product.model,
      product.feature || "-",
      product.productType || "-",
      product.salesRoute || "-",
      priceText(product.releasePriceExVat),
      priceText(product.purchase12),
      priceText(product.purchase20),
      product.status === "ok" ? priceText(product.productCost) : "-"
    ];
    values.forEach((value, index) => {
      const column = document.createElement(index === 1 ? "th" : "td");
      if (index === 1) column.scope = "row";
      if (index === 8) column.title = product.costSource;
      if (index === 0) {
        const category = document.createElement("span");
        const categoryText = String(value);
        category.className = "printer-category";
        if (/컬러/i.test(categoryText)) category.classList.add("category-color");
        else if (/흑백|모노/i.test(categoryText)) category.classList.add("category-mono");
        else if (/잉크/i.test(categoryText)) category.classList.add("category-ink");
        else if (/렌탈/i.test(categoryText)) category.classList.add("category-rental");
        category.textContent = categoryText;
        column.append(category);
      } else {
        column.textContent = value;
      }
      if (index >= 5) column.className = "price-column";
      row.append(column);
    });
    return row;
  }));
  $("priceTableSummary").textContent = keyword || columnFilters.length
    ? `검색 결과 ${filteredProducts.length.toLocaleString("ko-KR")}개`
    : `총 ${printerProducts.length.toLocaleString("ko-KR")}개 모델`;
}

function closeColumnFilter() {
  $("columnFilterPopover").hidden = true;
  document.querySelectorAll(".column-filter-btn").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  activePriceFilterField = null;
}

function openColumnFilter(button) {
  const field = button.dataset.filter;
  if (activePriceFilterField === field && !$("columnFilterPopover").hidden) {
    closeColumnFilter();
    return;
  }

  activePriceFilterField = field;
  document.querySelectorAll(".column-filter-btn").forEach((item) => {
    item.setAttribute("aria-expanded", String(item === button));
  });
  $("columnFilterLabel").textContent = `${button.dataset.label} 필터`;
  renderColumnFilterOptions(field);

  const rect = button.getBoundingClientRect();
  const popover = $("columnFilterPopover");
  popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 252))}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  popover.hidden = false;
  $("columnFilterOptions").querySelector("input")?.focus();
}

function renderColumnFilterOptions(field) {
  const optionsBox = $("columnFilterOptions");
  const selected = Array.isArray(priceColumnFilters[field]) ? priceColumnFilters[field] : [];
  const options = field === "releasePriceExVat"
    ? Array.from({ length: 13 }, (_, index) => String((index + 1) * 100000))
    : [...new Set(printerProducts
      .map((product) => String(product[field] || "").trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko-KR", { numeric: true }));

  optionsBox.replaceChildren(...options.map((option) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    const text = document.createElement("span");
    checkbox.type = "checkbox";
    checkbox.value = option;
    checkbox.checked = selected.includes(option);
    checkbox.addEventListener("change", () => {
      const values = [...optionsBox.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => input.value);
      if (values.length) priceColumnFilters[field] = values;
      else delete priceColumnFilters[field];
      updateColumnFilterButton(field);
      renderPrinterPriceTable();
    });
    text.textContent = field === "releasePriceExVat" ? `${won(Number(option))} 이하` : option;
    label.append(checkbox, text);
    return label;
  }));
}

function updateColumnFilterButton(field) {
  const value = priceColumnFilters[field];
  const active = Array.isArray(value) ? value.length > 0 : Boolean(value);
  document.querySelector(`.column-filter-btn[data-filter="${field}"]`)
    ?.classList.toggle("active", active);
}

function openPriceTable() {
  const modal = $("priceTableModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  $("priceTableSearch").focus();
}

function closePriceTable() {
  closeColumnFilter();
  const modal = $("priceTableModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  $("priceTableBtn").focus();
}


function calculateRent(addHistory = true) {
  if (addHistory && !validate(Object.values(rentFields))) return;

  const product = selectedRentProduct;
  const model = product?.model || rentFields.rentModelName.value.trim() || "모델을 선택해 주세요";
  const years = Number(rentFields.rentYears.value);
  const condition = document.querySelector('input[name="rentCondition"]:checked')?.value || "new";
  const baseRent = product?.baseRent || 0;
  const conditionAdjustment = condition === "used" && product ? -product.usedDiscount : 0;
  const periodAddition = (4 - years) * 5000;
  const optionAddition = (rentFields.faxKit.checked ? 5000 : 0)
    + (rentFields.wirelessKit.checked ? 5000 : 0);
  const blackUsage = integer(rentFields.blackCopies) * (product?.blackRate || 0);
  const colorUsage = product?.machineType === "color"
    ? integer(rentFields.colorCopies) * product.colorRate
    : 0;
  const usageTotal = blackUsage + colorUsage;
  const monthlyTotal = baseRent + conditionAdjustment + periodAddition + optionAddition + usageTotal;
  const contractMonths = years * 12;
  const contractTotal = monthlyTotal * contractMonths;
  const deposit = product?.deposit || 0;

  rentResults.rentModelResult.textContent = model;
  rentResults.rentModelDetail.textContent = product
    ? `${product.machineTypeName} · ${product.speed}`
    : "복합기 종류와 속도가 표시됩니다.";
  rentResults.rentMonthlyTotal.textContent = won(monthlyTotal);
  rentResults.rentBaseResult.textContent = won(baseRent);
  rentResults.rentConditionResult.textContent = conditionAdjustment
    ? `-${won(Math.abs(conditionAdjustment))}`
    : "0원";
  rentResults.rentPeriodResult.textContent = won(periodAddition);
  rentResults.rentOptionResult.textContent = won(optionAddition);
  rentResults.rentUsageResult.textContent = won(usageTotal);
  rentResults.rentContractTotal.textContent = won(contractTotal);
  rentResults.rentDepositResult.textContent = won(deposit);

  if (addHistory) {
    if (!product) {
      setRentLookupStatus("목록에서 임대 모델을 먼저 선택해 주세요.", "error");
      return;
    }

    const item = {
      model,
      monthly: monthlyTotal,
      years,
      condition,
      faxKit: rentFields.faxKit.checked,
      wirelessKit: rentFields.wirelessKit.checked,
      blackCopies: integer(rentFields.blackCopies),
      colorCopies: integer(rentFields.colorCopies),
      contractTotal,
      time: timestamp()
    };

    rentHistory.unshift(item);
    rentHistory = rentHistory.slice(0, 6);

    calculatorStorage.setItem("rentHistoryVersion", JSON.stringify(rentHistory));
    renderRentHistory();
  }
}

function setRentLookupStatus(message, type = "") {
  const status = $("rentModelLookupStatus");
  status.textContent = message;
  status.className = `field-status ${type}`.trim();
}

function findRentProduct(model) {
  return rentProductByModel.get(model.trim().toUpperCase());
}

function renderRentModelDropdown(query = "") {
  const dropdown = $("rentModelDropdown");
  const keyword = query.trim().toUpperCase();
  const filtered = rentProducts.filter((product) => {
    const searchable = `${product.model} ${product.machineTypeName} ${product.speed}`.toUpperCase();
    return !keyword || searchable.includes(keyword);
  });

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "model-empty";
    empty.textContent = "일치하는 임대 모델이 없습니다.";
    dropdown.replaceChildren(empty);
    return;
  }

  const sections = [
    ["컬러 복합기", "color"],
    ["흑백 복합기", "mono"]
  ].flatMap(([titleText, type]) => {
    const groupProducts = filtered.filter((product) => product.machineType === type);
    if (!groupProducts.length) return [];

    const section = document.createElement("section");
    section.className = "model-group";
    const title = document.createElement("div");
    title.className = "model-group-title";
    title.textContent = `${titleText} · ${groupProducts.length}개`;
    section.append(title);

    groupProducts.forEach((product) => {
      const option = document.createElement("button");
      option.className = "model-option";
      option.type = "button";
      option.setAttribute("role", "option");
      const model = document.createElement("strong");
      model.textContent = product.model;
      const detail = document.createElement("span");
      detail.textContent = `${product.speed} · 기본 ${won(product.baseRent)}`;
      option.append(model, detail);
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        rentFields.rentModelName.value = product.model;
        applyRentProductFromModel();
        closeRentModelDropdown();
      });
      section.append(option);
    });
    return [section];
  });

  dropdown.replaceChildren(...sections);
}

function openRentModelDropdown() {
  renderRentModelDropdown(rentFields.rentModelName.value);
  $("rentModelDropdown").classList.add("open");
  $("rentModelToggleBtn").setAttribute("aria-expanded", "true");
}

function closeRentModelDropdown() {
  $("rentModelDropdown").classList.remove("open");
  $("rentModelToggleBtn").setAttribute("aria-expanded", "false");
}

function toggleRentModelDropdown() {
  rentFields.rentModelName.focus();
  renderRentModelDropdown("");
  $("rentModelDropdown").classList.add("open");
  $("rentModelToggleBtn").setAttribute("aria-expanded", "true");
}

function applyRentProductFromModel() {
  const product = findRentProduct(rentFields.rentModelName.value);
  if (!product) {
    selectedRentProduct = null;
    setRentLookupStatus("일치하는 모델이 없습니다. 목록에서 선택해 주세요.", "warning");
    calculateRent(false);
    return;
  }

  selectedRentProduct = product;
  $("colorCopiesField").classList.toggle("hidden", product.machineType !== "color");
  if (product.machineType !== "color") rentFields.colorCopies.value = 0;
  setRentLookupStatus(
    `${product.machineTypeName} · ${product.speed} · 기본 임대료 ${won(product.baseRent)}`,
    "success"
  );
  calculateRent(false);
}

async function loadRentProducts() {
  setRentLookupStatus("가격표 파일에서 임대 모델을 불러오는 중입니다.");
  try {
    const response = await fetch("/calculator/content/rent-products", { cache: "no-store" });
    if (!response.ok) throw new Error("임대 모델 데이터를 불러오지 못했습니다.");
    const data = await response.json();
    rentProducts = data.products || [];
    rentProductByModel = new Map(
      rentProducts.map((product) => [product.model.toUpperCase(), product])
    );
    renderRentModelDropdown();
    setRentLookupStatus(`${data.sheet}에서 ${data.count.toLocaleString("ko-KR")}개 모델 연결 완료`, "success");
  } catch (error) {
    console.error(error);
    setRentLookupStatus("임대 가격표를 불러오지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.", "error");
  }
}


/* =========================================================
  9. 임대용 최근 기록 표시
========================================================= */
function renderRentHistory() {
  const box = $("rentHistoryList");
  $("clearRentHistoryBtn").disabled = !rentHistory.length;

  if (!rentHistory.length) {
    box.innerHTML = '<p class="empty">아직 임대 계산 기록이 없습니다.</p>';
    return;
  }

  box.replaceChildren(...rentHistory.map((item, index) => {
    const row = document.createElement("div");
    row.className = "history-item";

    const detail = document.createElement("div");
    const model = document.createElement("button");
    model.className = "history-model-load";
    model.type = "button";
    model.title = "이 계산 기록 불러오기";
    model.textContent = item.model;
    model.addEventListener("click", () => loadRentHistoryItem(index));
    const durationText = item.years ? `${item.years}년` : `${item.months || 0}개월`;
    detail.append(model, document.createTextNode(
      `월 ${won(item.monthly)} · ${durationText} · ${item.time}`
    ));

    const result = document.createElement("div");
    const amount = document.createElement("strong");
    amount.textContent = won(item.contractTotal ?? item.profit);
    result.append(amount);
    row.append(detail, result);
    return row;
  }));
}

function loadRentHistoryItem(index) {
  const item = rentHistory[index];
  if (!item) return;

  switchPage("rent");
  rentFields.rentModelName.value = item.model || "";
  selectedRentProduct = findRentProduct(item.model || "") || null;

  if (!selectedRentProduct) {
    setRentLookupStatus("현재 임대 모델 목록에서 해당 모델을 찾을 수 없습니다.", "error");
    return;
  }

  rentFields.rentYears.value = String(item.years || 4);
  const condition = item.condition === "used" ? "used" : "new";
  document.querySelector(`input[name="rentCondition"][value="${condition}"]`).checked = true;
  rentFields.faxKit.checked = Boolean(item.faxKit);
  rentFields.wirelessKit.checked = Boolean(item.wirelessKit);
  rentFields.blackCopies.value = item.blackCopies ?? 0;
  rentFields.colorCopies.value = item.colorCopies ?? 0;

  $("colorCopiesField").classList.toggle("hidden", selectedRentProduct.machineType !== "color");
  setRentLookupStatus(
    `${selectedRentProduct.machineTypeName} · ${selectedRentProduct.speed} · 저장 기록 불러옴`,
    "success"
  );
  calculateRent(false);
  window.scrollTo({ top: $("rentPage").offsetTop, behavior: "smooth" });
}

function clearRentHistory() {
  if (!window.confirm("임대 계산 기록을 모두 삭제할까요?")) return;
  rentHistory = [];
  calculatorStorage.removeItem("rentHistoryVersion");
  renderRentHistory();
}


/* =========================================================
  10. 입력값 초기화
========================================================= */

/* 판매용 입력값 초기화 */
function resetSaleInputs() {
  saleFields.modelName.value = "";
  saleFields.salePrice.value = "";
  saleFields.shippingCost.value = 0;
  saleFields.productCost.value = 0;

  loadStore(currentStore);
}

/* 임대용 입력값 초기화 */
function resetRentInputs() {
  rentFields.rentModelName.value = "";
  rentFields.rentYears.value = "4";
  rentFields.faxKit.checked = false;
  rentFields.wirelessKit.checked = false;
  rentFields.blackCopies.value = 0;
  rentFields.colorCopies.value = 0;
  document.querySelector('input[name="rentCondition"][value="new"]').checked = true;
  selectedRentProduct = null;
  $("colorCopiesField").classList.remove("hidden");
  setRentLookupStatus(`${rentProducts.length.toLocaleString("ko-KR")}개 모델에서 검색할 수 있습니다.`);
  calculateRent(false);
}


/* =========================================================
  11. 판매용 / 임대용 페이지 전환
  ---------------------------------------------------------
  active 클래스를 바꿔서 보여줄 페이지를 변경합니다.
  마지막으로 선택한 페이지는 localStorage에 저장됩니다.
========================================================= */
function switchPage(page) {
  document.querySelectorAll(".page-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });

  $("salePage").classList.toggle("active", page === "sale");
  $("rentPage").classList.toggle("active", page === "rent");

  calculatorStorage.setItem("calculatorPage", page);
}


/* =========================================================
  13. 클릭/입력 이벤트 연결
  ---------------------------------------------------------
  버튼 클릭이나 입력값 변경이 발생했을 때 어떤 함수를 실행할지 정합니다.
========================================================= */

/* 판매용 / 임대용 탭 클릭 */
document.querySelectorAll(".page-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page));
});

/* 스토어 탭 클릭 */
document.querySelectorAll(".store-tab").forEach((btn) => {
  btn.addEventListener("click", () => loadStore(btn.dataset.store));
});

/* 판매용 입력값이 바뀌면 오른쪽 결과값을 바로 갱신합니다. */
Object.values(saleFields).forEach((field) => {
  field.addEventListener("input", () => calculateSale(false));
});

[saleFields.salePrice, saleFields.productCost].forEach((field) => {
  field.addEventListener("input", () => {
    formatCurrencyField(field);
    calculateSale(false);
  });
});

saleFields.modelName.addEventListener("change", applyProductFromModel);
saleFields.modelName.addEventListener("blur", applyProductFromModel);
saleFields.modelName.addEventListener("focus", openModelDropdown);
saleFields.modelName.addEventListener("input", () => {
  renderModelDropdown(saleFields.modelName.value);
  openModelDropdown();
});
saleFields.modelName.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModelDropdown();
});
$("modelToggleBtn").addEventListener("click", toggleModelDropdown);
document.addEventListener("mousedown", (event) => {
  if (!event.target.closest(".model-picker")) closeModelDropdown();
});
saleFields.feeRate.addEventListener("input", () => {
  if (!saleFields.feeRate.checkValidity()) return;
  storeFeeRates[currentStore] = num(saleFields.feeRate);
  calculatorStorage.setItem(STORE_FEE_KEY, JSON.stringify(storeFeeRates));
});

/* 임대용 입력값이 바뀌면 오른쪽 결과값을 바로 갱신합니다. */
Object.values(rentFields).forEach((field) => {
  field.addEventListener("input", () => calculateRent(false));
  field.addEventListener("change", () => calculateRent(false));
});
document.querySelectorAll('input[name="rentCondition"]').forEach((field) => {
  field.addEventListener("change", () => calculateRent(false));
});
rentFields.rentModelName.addEventListener("focus", openRentModelDropdown);
rentFields.rentModelName.addEventListener("input", () => {
  selectedRentProduct = null;
  openRentModelDropdown();
  calculateRent(false);
});
rentFields.rentModelName.addEventListener("change", applyRentProductFromModel);
rentFields.rentModelName.addEventListener("blur", applyRentProductFromModel);
rentFields.rentModelName.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeRentModelDropdown();
});
$("rentModelToggleBtn").addEventListener("click", toggleRentModelDropdown);
document.addEventListener("mousedown", (event) => {
  if (!event.target.closest(".rent-model-picker")) closeRentModelDropdown();
});

/* 버튼 기능 연결 */
$("calcBtn").addEventListener("click", () => calculateSale(true));
$("resetBtn").addEventListener("click", resetSaleInputs);
$("rentCalcBtn").addEventListener("click", () => calculateRent(true));
$("rentResetBtn").addEventListener("click", resetRentInputs);
$("clearRentHistoryBtn").addEventListener("click", clearRentHistory);
$("priceTableBtn").addEventListener("click", openPriceTable);
$("priceTableCloseBtn").addEventListener("click", closePriceTable);
$("priceTableSearch").addEventListener("input", renderPriceTable);
document.querySelectorAll(".price-view-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    priceTableView = tab.dataset.view;
    renderPriceTable();
  });
});
document.querySelectorAll(".column-filter-btn").forEach((button) => {
  button.addEventListener("click", () => openColumnFilter(button));
});
$("columnFilterClearBtn").addEventListener("click", () => {
  if (!activePriceFilterField) return;
  delete priceColumnFilters[activePriceFilterField];
  updateColumnFilterButton(activePriceFilterField);
  renderColumnFilterOptions(activePriceFilterField);
  renderPrinterPriceTable();
});
document.addEventListener("mousedown", (event) => {
  if (!event.target.closest(".column-filter-popover, .column-filter-btn")) closeColumnFilter();
});
document.querySelector("[data-price-modal-close]").addEventListener("click", closePriceTable);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("columnFilterPopover").hidden) {
    closeColumnFilter();
    return;
  }
  if (event.key === "Escape" && $("priceTableModal").classList.contains("open")) {
    closePriceTable();
  }
});


/* =========================================================
  14. 처음 실행될 때 필요한 기능
  ---------------------------------------------------------
  페이지를 열자마자 날짜, 모드, 기록, 계산값을 세팅합니다.
========================================================= */
today();
calculatorStorage.removeItem("themeMode");
renderRentHistory();
loadStore(currentStore);
calculateRent(false);
switchPage(calculatorStorage.getItem("calculatorPage") || "sale");
loadSaleProducts();
loadRentProducts();
