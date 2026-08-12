// ============================================================
// 정밀 세액계산기 — 항목별 입력폼 화면.
// 계산기 워크시트(explorer.js의 =수식)와 달리 문자열 수식을 전혀 거치지 않고,
// tax-calc.js의 구조화된 함수(calculateTransferTaxMultiJS/calculateGiftTaxJS/
// calculateInheritanceTaxJS)를 입력값 객체로 직접 호출한다.
// explorer.js가 먼저 로드되어 있어야 하며(hideAllPanelViews·ensureExplorerVisible·
// explorerView 등을 그대로 재사용), chat.js보다 먼저 로드되어야 WORK_TOOLS 목록
// 구성 시점에 openTaxCalcView가 이미 정의되어 있다.
// ============================================================

const taxCalcView = document.getElementById('taxCalcView');
const taxCalcTransferPane = document.getElementById('taxCalcTransferPane');
const taxCalcGiftPane = document.getElementById('taxCalcGiftPane');
const taxCalcInheritancePane = document.getElementById('taxCalcInheritancePane');

function won(n){
  return Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') + '원' : '-';
}

function taxCalcResultRow(label, value, opts){
  opts = opts || {};
  const cls = 'taxcalc-result-row' + (opts.total ? ' total' : '');
  return '<div class="' + cls + '"><span>' + label + '</span><span class="v">' + value + '</span></div>';
}

// ---- 상속증여재산 평가(자산 목록) — 증여세·상속세 화면 공통 ----
// [별지 제10호서식 부표1](증여재산 및 평가명세서)·[별지 제9호서식 부표1·2](상속재산 및 평가명세서)의
// "자산을 하나씩 나열해서 합산"하는 구조를 그대로 반영한다. 평가방법 자체(상증세법 §60~66
// 보충적평가방법)는 토지·주택·상장주식·비상장주식만 계산해주고, 그 외(시가·감정가액 등)는
// 이미 알고 있는 금액을 직접 입력하게 한다.
let giftValuationAssets = [];
let inheritanceValuationAssets = [];

const VALUATION_METHOD_LABELS = {
  direct: '직접입력(시가·감정가액·매매사례가액 등)',
  land: '토지(개별공시지가 × 면적 × 지분)',
  house: '주택(고시된 개별·공동주택가격 × 지분)',
  listedStock: '상장주식(기준일 전후 2개월 종가평균 × 주식수)',
  unlistedStock: '비상장주식(순손익·순자산가치 가중평균)',
  rental: '임대 중인 부동산(임대료환산가액)'
};

function computeValuationAssetValue(a){
  switch (a.method){
    case 'land': return calculateLandValueJS(a.landPrice, a.landArea, a.landShare || 100);
    case 'house': return calculateHouseValueJS(a.housePrice, a.houseShare || 100);
    case 'listedStock': return calculateListedStockValueJS(a.listedPrice, a.listedShares);
    case 'rental': return calculateRentalConversionValueJS(a.rentalAnnualRent, a.rentalDeposit);
    case 'unlistedStock': {
      const r = calculateUnlistedStockValueJS({
        totalIssuedShares: a.uTotalShares, ownedShares: a.uOwnedShares,
        netProfit1YearAgo: a.uProfit1, netProfit2YearsAgo: a.uProfit2, netProfit3YearsAgo: a.uProfit3,
        netAssetValue: a.uNetAsset, isRealEstateHeavy: a.uRealEstateHeavy, isMajorShareholder: a.uMajorShareholder
      });
      return r.error ? 0 : r.평가총액;
    }
    default: return Number(a.directValue) || 0;
  }
}

function valuationAssetMethodFieldsHtml(m, a){
  if (m === 'land') return '' +
    '<div class="taxcalc-field"><label>개별공시지가(원/㎡)</label><input type="number" data-field="landPrice" value="' + (a.landPrice || '') + '"></div>' +
    '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-field="landArea" value="' + (a.landArea || '') + '"></div>' +
    '<div class="taxcalc-field"><label>지분율(%)</label><input type="number" data-field="landShare" placeholder="기본 100" value="' + (a.landShare || '') + '"></div>';
  if (m === 'house') return '' +
    '<div class="taxcalc-field"><label>고시된 주택가격</label><input type="number" data-field="housePrice" value="' + (a.housePrice || '') + '"></div>' +
    '<div class="taxcalc-field"><label>지분율(%)</label><input type="number" data-field="houseShare" placeholder="기본 100" value="' + (a.houseShare || '') + '"></div>';
  if (m === 'listedStock') return '' +
    '<div class="taxcalc-field"><label>2개월 종가평균(원/주)</label><input type="number" data-field="listedPrice" value="' + (a.listedPrice || '') + '"></div>' +
    '<div class="taxcalc-field"><label>주식수</label><input type="number" data-field="listedShares" value="' + (a.listedShares || '') + '"></div>';
  if (m === 'rental') return '' +
    '<div class="taxcalc-field"><label>연간 임대료 합계</label><input type="number" data-field="rentalAnnualRent" value="' + (a.rentalAnnualRent || '') + '"></div>' +
    '<div class="taxcalc-field"><label>임대보증금</label><input type="number" data-field="rentalDeposit" value="' + (a.rentalDeposit || '') + '"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 이 환산가액과 별도로 계산한 기준시가 중 큰 금액을 실제 평가액으로 쓰세요</label></div>';
  if (m === 'unlistedStock') return '' +
    '<div class="taxcalc-field"><label>발행주식총수</label><input type="number" data-field="uTotalShares" value="' + (a.uTotalShares || '') + '"></div>' +
    '<div class="taxcalc-field"><label>평가대상 주식수</label><input type="number" data-field="uOwnedShares" value="' + (a.uOwnedShares || '') + '"></div>' +
    '<div class="taxcalc-field"><label>1년전 법인 전체 순손익액</label><input type="number" data-field="uProfit1" value="' + (a.uProfit1 || '') + '"></div>' +
    '<div class="taxcalc-field"><label>2년전 법인 전체 순손익액</label><input type="number" data-field="uProfit2" value="' + (a.uProfit2 || '') + '"></div>' +
    '<div class="taxcalc-field"><label>3년전 법인 전체 순손익액</label><input type="number" data-field="uProfit3" value="' + (a.uProfit3 || '') + '"></div>' +
    '<div class="taxcalc-field"><label>순자산가액</label><input type="number" data-field="uNetAsset" value="' + (a.uNetAsset || '') + '"></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="uRealEstateHeavy" ' + (a.uRealEstateHeavy ? 'checked' : '') + '><label>부동산과다보유법인(순손익2:순자산3)</label></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="uMajorShareholder" ' + (a.uMajorShareholder ? 'checked' : '') + '><label>최대주주 등 할증(20%)</label></div>';
  return '<div class="taxcalc-field"><label>평가액</label><input type="number" data-field="directValue" value="' + (a.directValue || '') + '"></div>';
}

function renderValuationAssetRow(a, idx){
  const method = a.method || 'direct';
  const value = computeValuationAssetValue(a);
  return '' +
    '<div class="taxcalc-asset" data-idx="' + idx + '">' +
      '<div class="taxcalc-asset-head"><b>자산 ' + (idx + 1) + '</b><button type="button" class="taxcalc-del-asset" data-action="del-valuation-asset" data-idx="' + idx + '">✕ 삭제</button></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>자산명(메모)</label><input type="text" data-field="label" value="' + (a.label || '').replace(/"/g, '&quot;') + '"></div>' +
        '<div class="taxcalc-field"><label>평가방법</label><select data-field="method">' +
          Object.keys(VALUATION_METHOD_LABELS).map(function (k) { return '<option value="' + k + '"' + (method === k ? ' selected' : '') + '>' + VALUATION_METHOD_LABELS[k] + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="taxcalc-grid" style="margin-top:6px;">' + valuationAssetMethodFieldsHtml(method, a) + '</div>' +
      '<div class="taxcalc-result-row"><span>평가액</span><span class="v">' + won(value) + '</span></div>' +
    '</div>';
}

function renderValuationAssetList(containerId, assets){
  const container = document.getElementById(containerId);
  if (!container) return;
  const total = assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0);
  container.innerHTML =
    assets.map(function (a, idx) { return renderValuationAssetRow(a, idx); }).join('') +
    '<button type="button" class="taxcalc-add-asset" data-action="add-valuation-asset" data-target="' + containerId + '">+ 자산 추가</button>' +
    (assets.length ? '<div class="taxcalc-result-row total"><span>자산 평가액 합계</span><span class="v">' + won(total) + '</span></div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="apply-valuation-total" data-target="' + containerId + '">이 합계를 위 금액란에 반영</button>' : '');

  container.querySelectorAll('[data-field]').forEach(function (el) {
    el.addEventListener((el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input', function () {
      const idx = Number(el.closest('.taxcalc-asset').dataset.idx);
      const key = el.dataset.field;
      assets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'method'){
        renderValuationAssetList(containerId, assets); // 필드 구성 자체가 바뀌므로 다시 그림
      } else {
        const row = el.closest('.taxcalc-asset');
        row.querySelector('.taxcalc-result-row .v').textContent = won(computeValuationAssetValue(assets[idx]));
        const totalEl = container.querySelector('.taxcalc-result-row.total .v');
        if (totalEl) totalEl.textContent = won(assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0));
      }
    });
  });
}

// ---- 양도소득세 (다건 합산) ----
let transferAssets = [{}]; // 각 원소는 입력값 객체(비어있는 채로 시작)

function renderTransferPane(){
  const cardsHtml = transferAssets.map(function(_, idx){
    return '' +
      '<div class="taxcalc-asset" data-idx="' + idx + '">' +
        '<div class="taxcalc-asset-head"><b>거래 ' + (idx+1) + '</b>' +
          (transferAssets.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-asset" data-idx="' + idx + '">✕ 삭제</button>' : '') +
        '</div>' +
        '<div class="taxcalc-grid">' +
          '<div class="taxcalc-field"><label>자산종류</label><select data-field="assetType"><option value="other">그 외 부동산</option><option value="house">주택·조합원입주권</option></select></div>' +
          '<div class="taxcalc-field"><label>양도가액</label><input type="number" data-field="transferPrice" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>취득가액</label><input type="number" data-field="acquisitionPrice" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>필요경비</label><input type="number" data-field="necessaryExpenses" placeholder="원 (선택, 취득세·중개보수 등)"></div>' +
          '<div class="taxcalc-field"><label>취득일</label><input type="date" data-field="acquisitionDate"></div>' +
          '<div class="taxcalc-field"><label>양도일</label><input type="date" data-field="transferDate"></div>' +
        '</div>' +
        '<div class="taxcalc-grid" style="margin-top:8px;">' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isOneHouseOneFamily" id="oneHouse-' + idx + '"><label for="oneHouse-' + idx + '">1세대1주택 비과세 전제</label></div>' +
          '<div class="taxcalc-field" data-show-if="isOneHouseOneFamily" style="display:none;"><label>거주연수</label><input type="number" data-field="residenceYears" placeholder="년"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isAdjustedArea" id="adj-' + idx + '"><label for="adj-' + idx + '">조정대상지역</label></div>' +
          '<div class="taxcalc-field"><label>다주택중과 판정용 주택수</label><select data-field="multiHouseCount"><option value="0">해당없음/1주택</option><option value="2">2주택</option><option value="3">3주택 이상</option></select></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isNonBusinessLand" id="nbl-' + idx + '"><label for="nbl-' + idx + '">비사업용토지</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isUnregisteredTransfer" id="unreg-' + idx + '"><label for="unreg-' + idx + '">미등기양도</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isEightYearFarmland" id="farm-' + idx + '"><label for="farm-' + idx + '">8년 자경농지 감면</label></div>' +
        '</div>' +
      '</div>';
  }).join('');

  taxCalcTransferPane.innerHTML =
    '<div class="taxcalc-hint">여러 건을 추가하면 2년 이상 보유·특례 없는(또는 다주택중과·비사업용토지만 해당하는) 거래는 자동으로 합산해서 기본공제(250만원, 전체 1회)와 누진세율을 함께 적용합니다(확정신고 합산 개념). 단기양도·미등기양도는 건별로 따로 계산해서 더합니다. 다주택 중과는 조정대상지역 지정·한시배제 여부를 신고 시점 기준으로 직접 확인한 뒤 체크하세요.</div>' +
    '<div id="taxCalcTransferCards">' + cardsHtml + '</div>' +
    '<button type="button" class="taxcalc-add-asset" data-action="add-asset">+ 거래 추가</button>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-transfer">세액 계산하기</button>' +
    '<div id="taxCalcTransferResult"></div>';

  // 저장해뒀던 입력값 다시 채워넣기(카드 추가/삭제로 다시 그릴 때 기존 입력 유지)
  transferAssets.forEach(function(vals, idx){
    const card = taxCalcTransferPane.querySelector('.taxcalc-asset[data-idx="' + idx + '"]');
    if (!card) return;
    Object.keys(vals).forEach(function(key){
      const el = card.querySelector('[data-field="' + key + '"]');
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!vals[key];
      else el.value = vals[key];
    });
    updateOneHouseVisibility(card);
  });

  // 입력 변경 시 transferAssets 배열에 즉시 반영(계산 버튼 누를 때 다시 읽지 않아도 되게)
  taxCalcTransferPane.querySelectorAll('.taxcalc-asset').forEach(function(card){
    const idx = Number(card.dataset.idx);
    card.querySelectorAll('[data-field]').forEach(function(el){
      el.addEventListener('input', function(){
        const key = el.dataset.field;
        transferAssets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'isOneHouseOneFamily') updateOneHouseVisibility(card);
      });
      el.addEventListener('change', function(){
        const key = el.dataset.field;
        transferAssets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
      });
    });
  });
}

function updateOneHouseVisibility(card){
  const checked = card.querySelector('[data-field="isOneHouseOneFamily"]').checked;
  const field = card.querySelector('[data-show-if="isOneHouseOneFamily"]');
  if (field) field.style.display = checked ? 'flex' : 'none';
}

function collectTransferInput(vals){
  return {
    assetType: vals.assetType || 'other',
    transferPrice: Number(vals.transferPrice) || 0,
    acquisitionPrice: Number(vals.acquisitionPrice) || 0,
    necessaryExpenses: Number(vals.necessaryExpenses) || 0,
    acquisitionDate: vals.acquisitionDate || '',
    transferDate: vals.transferDate || '',
    isOneHouseOneFamily: !!vals.isOneHouseOneFamily,
    residenceYears: Number(vals.residenceYears) || 0,
    isAdjustedArea: !!vals.isAdjustedArea,
    multiHouseCount: Number(vals.multiHouseCount) || 0,
    isNonBusinessLand: !!vals.isNonBusinessLand,
    isUnregisteredTransfer: !!vals.isUnregisteredTransfer,
    isEightYearFarmland: !!vals.isEightYearFarmland
  };
}

function renderTransferResult(r){
  const box = document.getElementById('taxCalcTransferResult');
  if (r.error){
    box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>';
    return;
  }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('거래건수 / 비과세', r.거래건수 + '건 / ' + r.비과세건수 + '건');
  html += taxCalcResultRow('합산대상(장기) 소득금액', won(r.합산소득금액));
  html += taxCalcResultRow('기본공제', won(r.기본공제));
  html += taxCalcResultRow('합산과세표준', won(r.합산과세표준));
  if (r.합산가산액) html += taxCalcResultRow('다주택중과·비사업용토지 가산', won(r.합산가산액));
  if (r.합산자경감면액) html += taxCalcResultRow('8년자경농지 감면', '-' + won(r.합산자경감면액));
  html += taxCalcResultRow('합산(장기) 그룹 산출세액', won(r.합산그룹_산출세액));
  if (r.단기거래_산출세액_합계) html += taxCalcResultRow('단기양도 산출세액 합계', won(r.단기거래_산출세액_합계));
  if (r.미등기거래_산출세액_합계) html += taxCalcResultRow('미등기양도 산출세액 합계', won(r.미등기거래_산출세액_합계));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '<div class="taxcalc-result-note">이 결과는 참고용 개산이며, 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

// ---- 증여세 (국세청 [별지 제10호서식] 증여세과세표준신고 및 자진납부계산서 기준) ----
function renderGiftPane(){
  taxCalcGiftPane.innerHTML =
    '<div class="taxcalc-hint">국세청 [별지 제10호서식] 증여세과세표준신고 및 자진납부계산서 항목을 기준으로 계산합니다. 10년 이내 동일인(직계존속 증여는 그 배우자 포함)으로부터 받은 기증여재산이 있으면 합산액과 기납부세액을 함께 넣으세요.</div>' +
    '<div class="taxcalc-asset-head"><b>[부표1] 증여재산 및 평가명세 — 자산을 추가하면 아래 증여재산가액에 반영할 수 있습니다</b></div>' +
    '<div id="giftValuationList"></div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>증여재산 · 관계</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여재산가액</label><input type="number" id="giftAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>관계(수증자 기준)</label><select id="giftRelation">' +
          '<option value="배우자">배우자</option><option value="직계존속" selected>직계존속(부모 등→자녀)</option>' +
          '<option value="직계비속">직계비속(자녀→부모)</option><option value="기타친족">기타친족</option><option value="기타">기타</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftIsMinor"><label for="giftIsMinor">수증자가 미성년자(직계존속 증여 시 공제 축소)</label></div>' +
        '<div class="taxcalc-field"><label>인수채무액(부담부증여, 없으면 0)</label><input type="number" id="giftDebtAssumed" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>10년내 동일인 기증여합산액</label><input type="number" id="giftPriorAmount" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>위 기증여분 기납부세액</label><input type="number" id="giftPriorPaidTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftGenSkip"><label for="giftGenSkip">세대생략 증여(예: 조부모→손자녀)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftGenSkipOver2B"><label for="giftGenSkipOver2B">세대생략+미성년자 20억 초과(할증 40%, 아니면 30%)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>㉙㉚ 혼인·출산 증여재산공제 (혼인+출산 평생통산 1억원 한도)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftIsMarriage"><label for="giftIsMarriage">혼인일 전후 2년 이내 증여</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftIsBirth"><label for="giftIsBirth">출생일·입양일부터 2년 이내 증여</label></div>' +
        '<div class="taxcalc-field"><label>과거에 이미 받은 혼인·출산공제 누적액</label><input type="number" id="giftPriorMarriageBirth" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>㉜㉝ 그 밖의 공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftExcludedAgg"><label for="giftExcludedAgg">상증세법 §55①3호 합산배제증여재산(3천만원 고정공제)</label></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="giftAppraisalFee" placeholder="원 (500만원 한도)"></div>' +
        '<div class="taxcalc-field"><label>재해손실공제액</label><input type="number" id="giftDisasterLoss" placeholder="원 (신고기한 내 재난 멸실분)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>비과세·과세가액 불산입(§46·§48·§52·§52의2)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>비과세재산가액</label><input type="number" id="giftNonTaxable" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익법인등출연재산가액</label><input type="number" id="giftPublicOrg" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익신탁재산가액</label><input type="number" id="giftPublicTrust" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>장애인신탁재산가액</label><input type="number" id="giftDisabledTrust" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>기타 세액공제·가산세·유예 (해당 사안일 때만 별도로 계산하여 입력)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>외국납부세액공제</label><input type="number" id="giftForeignTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>그 밖의 공제·감면세액</label><input type="number" id="giftOtherCredits" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>이자상당액</label><input type="number" id="giftInterest" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익법인등 관련 가산세</label><input type="number" id="giftPublicOrgPenalty" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>박물관자료등 징수유예세액</label><input type="number" id="giftMuseumDeferred" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>가업승계 납부유예세액</label><input type="number" id="giftBizSuccessionDeferred" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>영농자녀 증여농지 세액감면(조특법§71)</label><input type="number" id="giftFarmlandExemption" placeholder="원 (감면요건·한도는 별도 확인 후 입력)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>수증자·증여자 정보 — 사건 폴더에 가족관계증명서·신분증 사본이 있으면 AI에게 찾아 채우도록 요청하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>수증자 성명</label><input type="text" id="giftDoneeName"></div>' +
        '<div class="taxcalc-field"><label>수증자 주민등록번호</label><input type="text" id="giftDoneeRegNo" placeholder="000000-0000000"></div>' +
        '<div class="taxcalc-field"><label>수증자 주소</label><input type="text" id="giftDoneeAddress"></div>' +
        '<div class="taxcalc-field"><label>증여자 성명</label><input type="text" id="giftDonorName"></div>' +
        '<div class="taxcalc-field"><label>증여자 주민등록번호</label><input type="text" id="giftDonorRegNo" placeholder="000000-0000000"></div>' +
        '<div class="taxcalc-field"><label>증여자 주소</label><input type="text" id="giftDonorAddress"></div>' +
        '<div class="taxcalc-field"><label>증여일자</label><input type="date" id="giftDate"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="giftFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftReportedInTime" checked><label for="giftReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftFraudulent"><label for="giftFraudulent">부정행위(무신고·과소신고 가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="giftUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="giftUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
    '</div>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-gift">세액 계산하기</button>' +
    '<div id="taxCalcGiftResult"></div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제10호의2서식] 조특법§30의5·§30의6 증여세 과세특례(창업자금·가업승계주식) — 해당하는 경우에만 별도로 계산합니다. 일반 증여세와는 세율·공제·한도가 전혀 다릅니다.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>특례 종류</label><select id="srGiftType">' +
          '<option value="startup">창업자금(§30의5)</option><option value="business_succession">가업승계 주식등(§30의6)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>해당 증여재산가액</label><input type="number" id="srGiftAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>인수채무액(부담부증여, 창업자금만)</label><input type="number" id="srDebtAssumed" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>기 과세특례적용분 증여세과세가액</label><input type="number" id="srPriorSpecialGift" placeholder="원 (동일특례 재차증여, 없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="srJobsCreated10Plus"><label for="srJobsCreated10Plus">(창업자금) 창업으로 10명 이상 신규고용 — 한도 100억(아니면 50억)</label></div>' +
        '<div class="taxcalc-field"><label>(가업승계) 증여자(부모)의 가업영위기간</label><input type="number" id="srBusinessYears" placeholder="년 — 20미만 300억/20~30 400억/30이상 600억"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>(가업승계 주식등만) 사업관련자산가액 비율 — 비워두면 주식가액 전체를 가업자산으로 간주</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>총자산가액</label><input type="number" id="srTotalAsset" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>사업무관자산 - §55의2</label><input type="number" id="srNonBiz55" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>사업무관자산 - 시행령§49</label><input type="number" id="srNonBiz49" placeholder="원 (임대용부동산 포함)"></div>' +
        '<div class="taxcalc-field"><label>사업무관자산 - 시행령§61①2호</label><input type="number" id="srNonBiz61" placeholder="원 (대여금)"></div>' +
        '<div class="taxcalc-field"><label>과다보유현금</label><input type="number" id="srExcessCash" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>영업무관 주식·채권·금융상품</label><input type="number" id="srNonBizStock" placeholder="원"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>공제 · 세액공제 · 신고 상태</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>재해손실공제액</label><input type="number" id="srDisasterLoss" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="srAppraisalFee" placeholder="원 (500만원 한도)"></div>' +
        '<div class="taxcalc-field"><label>납부세액공제(§58, 재차증여 기납부분)</label><input type="number" id="srPriorPaidTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액공제(§59)</label><input type="number" id="srForeignTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="srFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="srFraudulent"><label for="srFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="srUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="srUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-special-rate-gift">특례세율 증여세 계산하기</button>' +
      '<div id="taxCalcSpecialRateGiftResult"></div>' +
    '</div>';
  renderValuationAssetList('giftValuationList', giftValuationAssets);
}

function renderGiftResult(r){
  const box = document.getElementById('taxCalcGiftResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.비과세재산가액) html += taxCalcResultRow('비과세재산가액', '-' + won(r.비과세재산가액));
  if (r.공익법인출연재산가액) html += taxCalcResultRow('공익법인등출연재산가액', '-' + won(r.공익법인출연재산가액));
  if (r.공익신탁재산가액) html += taxCalcResultRow('공익신탁재산가액', '-' + won(r.공익신탁재산가액));
  if (r.장애인신탁재산가액) html += taxCalcResultRow('장애인신탁재산가액', '-' + won(r.장애인신탁재산가액));
  if (r.인수채무액 || r.비과세재산가액 || r.공익법인출연재산가액 || r.공익신탁재산가액 || r.장애인신탁재산가액) html += taxCalcResultRow('순수증여재산가액', won(r.순수증여재산가액));
  html += taxCalcResultRow('증여재산공제', won(r.증여재산공제));
  if (r.혼인출산증여재산공제) html += taxCalcResultRow('혼인·출산 증여재산공제', won(r.혼인출산증여재산공제));
  if (r.합산배제증여재산공제) html += taxCalcResultRow('합산배제증여재산공제', won(r.합산배제증여재산공제));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', won(r.감정평가수수료공제));
  if (r.재해손실공제) html += taxCalcResultRow('재해손실공제', won(r.재해손실공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액(할증 전)', won(r.산출세액_할증전));
  if (r.세대생략할증액) html += taxCalcResultRow('세대생략할증액', won(r.세대생략할증액));
  if (r.기납부세액공제) html += taxCalcResultRow('기납부세액공제', '-' + won(r.기납부세액공제));
  if (r.외국납부세액공제) html += taxCalcResultRow('외국납부세액공제', '-' + won(r.외국납부세액공제));
  if (r.그밖의공제감면세액) html += taxCalcResultRow('그 밖의 공제·감면세액', '-' + won(r.그밖의공제감면세액));
  html += taxCalcResultRow('신고세액공제(3%)', '-' + won(r.신고세액공제));
  if (r.이자상당액) html += taxCalcResultRow('이자상당액', '+' + won(r.이자상당액));
  if (r.공익법인등관련가산세) html += taxCalcResultRow('공익법인등 관련 가산세', '+' + won(r.공익법인등관련가산세));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  if (r.박물관자료등징수유예세액) html += taxCalcResultRow('박물관자료등 징수유예세액', '-' + won(r.박물관자료등징수유예세액));
  if (r.가업승계납부유예세액) html += taxCalcResultRow('가업승계 납부유예세액', '-' + won(r.가업승계납부유예세액));
  if (r.영농자녀증여농지세액감면) html += taxCalcResultRow('영농자녀 증여농지 세액감면', '-' + won(r.영농자녀증여농지세액감면));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.인수채무액) html += '<div class="taxcalc-result-note">인수채무액 ' + won(r.인수채무액) + '에 상당하는 부분은 증여자에게 별도로 양도소득세가 과세됩니다 — 양도소득세 탭에서 함께 계산하세요.</div>';
  html += '<div class="taxcalc-result-note">납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있습니다. 창업자금·가업승계 증여세 과세특례(조특법§30의5·6)를 적용받는 경우 이 계산이 아니라 아래 별도의 특례세율 증여세 계산기를 쓰세요. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderSpecialRateGiftResult(r){
  const box = document.getElementById('taxCalcSpecialRateGiftResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('특례 종류', r.특례종류);
  if (r.가업자산상당액 != null) html += taxCalcResultRow('가업자산상당액', won(r.가업자산상당액) + (r.사업관련자산가액비율 != null ? ' (사업관련자산비율 ' + (r.사업관련자산가액비율 * 100).toFixed(1) + '%)' : ''));
  if (r.인수채무액) html += taxCalcResultRow('인수채무액', won(r.인수채무액));
  html += taxCalcResultRow('과세특례 적용전 과세가액 계', won(r.과세특례적용전_증여세과세가액_계));
  html += taxCalcResultRow('총한도액', won(r.총한도액));
  html += taxCalcResultRow('과세특례 적용대상 과세가액', won(r.과세특례적용대상_증여세과세가액));
  if (r.기본세율적용대상_증여재산가액) html += taxCalcResultRow('기본세율 적용대상 증여재산가액(한도초과분)', won(r.기본세율적용대상_증여재산가액));
  html += taxCalcResultRow('증여재산공제', won(r.증여재산공제));
  if (r.재해손실공제) html += taxCalcResultRow('재해손실공제', won(r.재해손실공제));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', won(r.감정평가수수료공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('세율', r.세율);
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.납부세액공제) html += taxCalcResultRow('납부세액공제(§58)', '-' + won(r.납부세액공제));
  if (r.외국납부세액공제) html += taxCalcResultRow('외국납부세액공제(§59)', '-' + won(r.외국납부세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.기본세율적용대상_증여재산가액) html += '<div class="taxcalc-result-note">한도를 초과하는 ' + won(r.기본세율적용대상_증여재산가액) + '은 이 결과와 별개로 위 일반 증여세 계산기로 반드시 신고하세요.</div>';
  html += '<div class="taxcalc-result-note">이 특례에는 신고세액공제(3%)가 적용되지 않습니다. 가업영위기간·중소/중견기업 여부 등 자격요건은 별도로 확인하세요. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

// ---- 상속세 ----
function renderInheritancePane(){
  taxCalcInheritancePane.innerHTML =
    '<div class="taxcalc-hint">국세청 [별지 제9호서식] 상속세과세표준신고 및 자진납부계산서 항목을 기준으로 계산합니다. 상속세과세가액은 총상속재산가액에서 공과금·장례비용·채무를 빼고, 10년 이내 사전증여재산을 가산해 이미 계산된 값을 넣어야 합니다.</div>' +
    '<div class="taxcalc-asset-head"><b>[부표1·2] 상속재산 및 평가명세 — 자산을 추가하면 아래 상속세과세가액에 반영할 수 있습니다(공과금·장례비용·채무 차감 전 재산가액 기준)</b></div>' +
    '<div id="inheritanceValuationList"></div>' +
    '<div class="taxcalc-asset-head"><b>[부표4] 상속개시전 처분재산 등 산입액(§15) — 상속개시 전 1년 이내 재산종류별 2억원 이상(2년 이내 5억원 이상) 처분·인출·채무부담인데 용도가 불분명하면 자동으로 과세가액에 가산됩니다. 해당 없으면 비워두세요.</b></div>' +
    '<div class="taxcalc-asset">' +
      ['현금·예금·유가증권', '부동산', '기타재산', '부담채무Ⅰ(국가·지자체·금융기관)', '부담채무Ⅱ(그 외)'].map(function(label, i){
        return '<div class="taxcalc-grid" style="margin-bottom:6px;">' +
          '<div class="taxcalc-field"><label>' + label + ' — 처분(인출)·차입금액</label><input type="number" data-disposal-idx="' + i + '" data-disposal-field="disposalAmount"></div>' +
          '<div class="taxcalc-field"><label>소명금액</label><input type="number" data-disposal-idx="' + i + '" data-disposal-field="explainedAmount"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-disposal-idx="' + i + '" data-disposal-field="meetsThreshold"><label>1년내 2억 또는 2년내 5억 이상</label></div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>과세가액 · 인적공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>상속세과세가액</label><input type="number" id="ihEstate" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>자녀 수</label><input type="number" id="ihChildCount" placeholder="명 (1인당 5천만원)"></div>' +
        '<div class="taxcalc-field"><label>미성년 상속인 19세까지 잔여연수 합</label><input type="number" id="ihMinorYears" placeholder="년 (1년당 1천만원)"></div>' +
        '<div class="taxcalc-field"><label>65세 이상 상속인 수</label><input type="number" id="ihElderlyCount" placeholder="명 (1인당 5천만원)"></div>' +
        '<div class="taxcalc-field"><label>장애인 상속인 기대여명 잔여연수 합</label><input type="number" id="ihDisabledYears" placeholder="년 (1년당 1천만원)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>배우자상속공제 (부표3의2 한도액 계산)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihHasSpouse"><label for="ihHasSpouse">배우자가 상속인에 포함</label></div>' +
        '<div class="taxcalc-field"><label>배우자 실제 상속액</label><input type="number" id="ihSpouseActual" placeholder="원 (5억 미만/미입력이면 최소 5억 자동 적용)"></div>' +
        '<div class="taxcalc-field"><label>배우자 법정상속분 비율</label><input type="number" step="0.0001" id="ihSpouseRatio" placeholder="0~1 (예: 배우자+자녀2명=1.5/3.5≈0.4286)"></div>' +
        '<div class="taxcalc-field"><label>상속인 아닌 자 유증재산가액</label><input type="number" id="ihNonHeirBequest" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>10년내 상속인에게 증여한 재산가액</label><input type="number" id="ihGiftToHeirs" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>과세가액에 가산된 사전증여재산 원본액</label><input type="number" id="ihPriorGiftedIncluded" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>배우자 사전증여분 증여세 과세표준</label><input type="number" id="ihSpouseGiftBase" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>그 밖의 상속공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>순금융재산가액(금융재산-금융채무)</label><input type="number" id="ihNetFinancial" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihHasCohabit"><label for="ihHasCohabit">동거주택상속공제 대상(10년 이상 동거·무주택 등)</label></div>' +
        '<div class="taxcalc-field"><label>동거주택가액</label><input type="number" id="ihCohabitValue" placeholder="원 (6억 한도)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ihAppraisalFee" placeholder="원 (500만원 한도)"></div>' +
        '<div class="taxcalc-field"><label>재해손실공제액</label><input type="number" id="ihDisasterLoss" placeholder="원 (신고기한 내 재난 멸실분)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>가업상속공제(§18의2, [별지 제1호서식]) — 아래 상세내역을 채우면 자동계산됩니다. 모르면 최종 공제액만 직접 입력하세요.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>최종 공제액(직접 입력, 상세내역 없을 때만)</label><input type="number" id="ihBusinessDeduction" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>가업영위기간</label><input type="number" id="ihBusinessYears" placeholder="년 (10년 미만이면 공제 불가)"></div>' +
        '<div class="taxcalc-field"><label>[개인사업] 사업용자산 순액 합계</label><input type="number" id="ihBusinessIndividualNet" placeholder="원 (토지·건축물·기계장치 등-담보채무, 부표1가 ①계)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 상속개시일 현재 주식등 가액</label><input type="number" id="ihBusinessStockValue" placeholder="원 (가업법인 주식가액)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 총자산가액</label><input type="number" id="ihBusinessTotalAsset" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - §55의2</label><input type="number" id="ihBusinessNonBiz55" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - 시행령§49</label><input type="number" id="ihBusinessNonBiz49" placeholder="원 (임대용부동산 포함)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - 시행령§61①2호</label><input type="number" id="ihBusinessNonBiz61" placeholder="원 (대여금)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 과다보유현금</label><input type="number" id="ihBusinessExcessCash" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 영업무관 주식·채권·금융상품</label><input type="number" id="ihBusinessNonBizStock" placeholder="원"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>영농상속공제(§18의3, [별지 제2호서식], 30억 고정한도) — 마찬가지로 상세내역을 채우면 자동계산됩니다.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>최종 공제액(직접 입력, 상세내역 없을 때만)</label><input type="number" id="ihFarmingDeduction" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[개인] 영농재산가액 합계</label><input type="number" id="ihFarmingIndividualAsset" placeholder="원 (농지·초지·산림지·어선 등, 별지2호 ①합계)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 상속개시일 현재 주식등 가액</label><input type="number" id="ihFarmingStockValue" placeholder="원 (영농법인 주식가액)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 총자산가액</label><input type="number" id="ihFarmingTotalAsset" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - §55의2</label><input type="number" id="ihFarmingNonBiz55" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - 시행령§49</label><input type="number" id="ihFarmingNonBiz49" placeholder="원 (임대용부동산 포함)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - 시행령§61①2호</label><input type="number" id="ihFarmingNonBiz61" placeholder="원 (대여금)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 과다보유현금</label><input type="number" id="ihFarmingExcessCash" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 영업무관 주식·채권·금융상품</label><input type="number" id="ihFarmingNonBizStock" placeholder="원"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>상속공제 종합한도(§24) · 세대생략가산액(§27)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>사전증여재산 전체 증여세 과세표준 합계</label><input type="number" id="ihPriorGiftBaseTotal" placeholder="원 (종합한도 계산용, 없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>상속포기로 다음순위가 받은 재산가액</label><input type="number" id="ihDisclaimedRedistributed" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>세대생략 상속인이 받는 재산 비율</label><input type="number" step="0.01" id="ihGenSkipRatio" placeholder="0~1 (없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihGenSkipOver2B"><label for="ihGenSkipOver2B">세대생략+미성년자 20억 초과(할증 40%, 아니면 30%)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>세액공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>기납부증여세액(10년내 사전증여분)</label><input type="number" id="ihPriorGiftTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액</label><input type="number" id="ihForeignTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>전 상속세액 중 재상속분(단기재상속공제)</label><input type="number" id="ihPriorInheritanceTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>전 상속개시일로부터 경과연수</label><input type="number" id="ihYearsSincePrior" placeholder="1~10년 (재상속인 경우만)"></div>' +
        '<div class="taxcalc-field"><label>조특법§30의5·6 특례증여세액공제</label><input type="number" id="ihSpecialGiftCredit" placeholder="원 (별도 계산 후 입력)"></div>' +
        '<div class="taxcalc-field"><label>그 밖의 공제</label><input type="number" id="ihOtherCredits" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>이자상당액 · 영리법인 상속세 면제(§3의2) · 징수유예</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>이자상당액</label><input type="number" id="ihInterest" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>영리법인 유증재산가액</label><input type="number" id="ihForProfitBequest" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>영리법인 면제세액</label><input type="number" id="ihForProfitExempted" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>상속인 등의 지분 상당 비율</label><input type="number" step="0.01" id="ihForProfitRatio" placeholder="0~1 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>문화재등 징수유예세액</label><input type="number" id="ihCulturalDeferred" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>가업상속 납부유예세액</label><input type="number" id="ihBizInheritDeferred" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고인·피상속인 정보 — 사건 폴더에 가족관계증명서·신분증 사본이 있으면 AI에게 찾아 채우도록 요청하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고인(상속인) 성명</label><input type="text" id="ihReporterName"></div>' +
        '<div class="taxcalc-field"><label>신고인 주민등록번호</label><input type="text" id="ihReporterRegNo" placeholder="000000-0000000"></div>' +
        '<div class="taxcalc-field"><label>신고인의 피상속인과의 관계</label><input type="text" id="ihReporterRelation" placeholder="예: 자녀, 배우자"></div>' +
        '<div class="taxcalc-field"><label>피상속인 성명</label><input type="text" id="ihDeceasedName"></div>' +
        '<div class="taxcalc-field"><label>피상속인 주민등록번호</label><input type="text" id="ihDeceasedRegNo" placeholder="000000-0000000"></div>' +
        '<div class="taxcalc-field"><label>상속개시일</label><input type="date" id="ihDeathDate"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="ihFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihReportedInTime" checked><label for="ihReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihFraudulent"><label for="ihFraudulent">부정행위(무신고·과소신고 가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="ihUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="ihUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
    '</div>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-inheritance">세액 계산하기</button>' +
    '<div id="taxCalcInheritanceResult"></div>';
  renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
}

function renderInheritanceResult(r){
  const box = document.getElementById('taxCalcInheritanceResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.상속개시전처분재산_추정합계) {
    html += taxCalcResultRow('상속세과세가액(입력값)', won(r.상속세과세가액_입력값));
    html += taxCalcResultRow('상속개시전 처분재산 추정 가산액(§15)', '+' + won(r.상속개시전처분재산_추정합계));
    html += taxCalcResultRow('적용된 상속세과세가액', won(r.상속세과세가액_적용값));
  }
  html += taxCalcResultRow('인적공제', won(r.인적공제));
  html += taxCalcResultRow('기초+인적공제 vs 일괄공제(5억) 중 큰 값', won(r['기초인적공제_또는_일괄공제']));
  html += taxCalcResultRow('배우자공제', won(r.배우자공제));
  if (r.배우자공제한도액 != null) html += taxCalcResultRow('(배우자공제 한도액)', won(r.배우자공제한도액));
  if (r.금융재산상속공제) html += taxCalcResultRow('금융재산상속공제', won(r.금융재산상속공제));
  if (r.동거주택상속공제) html += taxCalcResultRow('동거주택상속공제', won(r.동거주택상속공제));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', won(r.감정평가수수료공제));
  if (r.재해손실공제) html += taxCalcResultRow('재해손실공제', won(r.재해손실공제));
  if (r.가업상속공제) {
    html += taxCalcResultRow('가업상속공제', won(r.가업상속공제));
    if (r.가업상속공제_계산내역) html += '<div class="taxcalc-result-note">자동계산: 대상금액 ' + won(r.가업상속공제_계산내역.대상금액) + ' / 한도액 ' + won(r.가업상속공제_계산내역.한도액) + '</div>';
  }
  if (r.영농상속공제) {
    html += taxCalcResultRow('영농상속공제', won(r.영농상속공제));
    if (r.영농상속공제_계산내역) html += '<div class="taxcalc-result-note">자동계산: 대상금액 ' + won(r.영농상속공제_계산내역.대상금액) + ' / 한도액 ' + won(r.영농상속공제_계산내역.한도액) + '</div>';
  }
  html += taxCalcResultRow('상속공제 합계', won(r.상속공제_합계) + (r.상속공제종합한도_적용여부 ? ' (종합한도 적용됨)' : ''));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액) + (r.세대생략가산액 ? ' (세대생략가산액 ' + won(r.세대생략가산액) + ' 포함)' : ''));
  if (r.기납부증여세액공제) html += taxCalcResultRow('기납부증여세액공제', '-' + won(r.기납부증여세액공제));
  if (r.특례증여세액공제) html += taxCalcResultRow('특례증여세액공제', '-' + won(r.특례증여세액공제));
  if (r.외국납부세액공제) html += taxCalcResultRow('외국납부세액공제', '-' + won(r.외국납부세액공제));
  if (r.단기재상속세액공제) html += taxCalcResultRow('단기재상속세액공제', '-' + won(r.단기재상속세액공제));
  if (r.그밖의공제) html += taxCalcResultRow('그 밖의 공제', '-' + won(r.그밖의공제));
  html += taxCalcResultRow('신고세액공제(3%)', '-' + won(r.신고세액공제));
  if (r.이자상당액) html += taxCalcResultRow('이자상당액', '+' + won(r.이자상당액));
  if (r.영리법인면제분납부세액) html += taxCalcResultRow('영리법인 면제분 상속인 납부세액', '+' + won(r.영리법인면제분납부세액));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  if (r.문화재등징수유예세액) html += taxCalcResultRow('문화재등 징수유예세액', '-' + won(r.문화재등징수유예세액));
  if (r.가업상속납부유예세액) html += taxCalcResultRow('가업상속 납부유예세액', '-' + won(r.가업상속납부유예세액));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  html += '<div class="taxcalc-result-note">배우자가 단독상속인이면 일괄공제(5억)를 선택할 수 없고 기초공제+인적공제만 적용됩니다 — 해당되면 이 결과를 그대로 쓰지 마세요. 가업상속공제·영농상속공제·특례증여세액공제·영리법인 면제세액은 자격요건 판정과 세액 자체를 이 계산기가 산출하지 않으므로 별도로 계산한 값을 직접 입력해야 합니다. 납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있습니다. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

// ---- 화면 전환 및 이벤트 바인딩 ----
function openTaxCalcView(){
  ensureExplorerVisible();
  hideAllPanelViews();
  taxCalcView.style.display = 'flex';
  renderTransferPane();
  renderGiftPane();
  renderInheritancePane();
}

function closeTaxCalcView(){
  hideAllPanelViews();
  explorerView.style.display = 'flex';
  explorerPanelHead.style.display = 'flex';
  navigateTo(explorerPath);
}

document.getElementById('btnOpenTaxCalc').addEventListener('click', openTaxCalcView);
document.getElementById('btnTaxCalcBack').addEventListener('click', closeTaxCalcView);

document.querySelectorAll('.taxcalc-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.taxcalc-tab').forEach(function(t){ t.classList.remove('active'); });
    tab.classList.add('active');
    const which = tab.dataset.tab;
    taxCalcTransferPane.style.display = which === 'transfer' ? 'block' : 'none';
    taxCalcGiftPane.style.display = which === 'gift' ? 'block' : 'none';
    taxCalcInheritancePane.style.display = which === 'inheritance' ? 'block' : 'none';
  });
});

// 클릭 위임 — 거래추가/삭제/계산 버튼들은 매번 다시 그려지므로(renderTransferPane) 위임 방식이 안전하다.
taxCalcView.addEventListener('click', function(e){
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'add-asset'){
    transferAssets.push({});
    renderTransferPane();
  } else if (action === 'del-asset'){
    const idx = Number(btn.dataset.idx);
    transferAssets.splice(idx, 1);
    renderTransferPane();
  } else if (action === 'add-valuation-asset'){
    const target = btn.dataset.target;
    const assets = target === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    assets.push({ method: 'direct' });
    renderValuationAssetList(target, assets);
  } else if (action === 'del-valuation-asset'){
    const containerId = btn.closest('[id="giftValuationList"], [id="inheritanceValuationList"]').id;
    const assets = containerId === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    assets.splice(Number(btn.dataset.idx), 1);
    renderValuationAssetList(containerId, assets);
  } else if (action === 'apply-valuation-total'){
    const target = btn.dataset.target;
    const assets = target === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    const total = assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0);
    if (target === 'giftValuationList') document.getElementById('giftAmount').value = total;
    else document.getElementById('ihEstate').value = total;
  } else if (action === 'run-transfer'){
    const inputs = transferAssets.map(collectTransferInput);
    const result = calculateTransferTaxMultiJS(inputs);
    renderTransferResult(result);
  } else if (action === 'run-gift'){
    const input = {
      giftAmount: Number(document.getElementById('giftAmount').value) || 0,
      relation: document.getElementById('giftRelation').value,
      isMinor: document.getElementById('giftIsMinor').checked,
      debtAssumedAmount: Number(document.getElementById('giftDebtAssumed').value) || 0,
      priorGiftAmount: Number(document.getElementById('giftPriorAmount').value) || 0,
      priorPaidTax: Number(document.getElementById('giftPriorPaidTax').value) || 0,
      isGenerationSkip: document.getElementById('giftGenSkip').checked,
      generationSkipOver2Billion: document.getElementById('giftGenSkipOver2B').checked,
      isMarriageGift: document.getElementById('giftIsMarriage').checked,
      isBirthGift: document.getElementById('giftIsBirth').checked,
      priorMarriageOrBirthDeductionUsed: Number(document.getElementById('giftPriorMarriageBirth').value) || 0,
      isExcludedFromAggregation: document.getElementById('giftExcludedAgg').checked,
      appraisalFeeAmount: Number(document.getElementById('giftAppraisalFee').value) || 0,
      disasterLossAmount: Number(document.getElementById('giftDisasterLoss').value) || 0,
      nonTaxableAmount: Number(document.getElementById('giftNonTaxable').value) || 0,
      publicInterestOrgAmount: Number(document.getElementById('giftPublicOrg').value) || 0,
      publicTrustAmount: Number(document.getElementById('giftPublicTrust').value) || 0,
      disabledTrustAmount: Number(document.getElementById('giftDisabledTrust').value) || 0,
      foreignTaxPaidAmount: Number(document.getElementById('giftForeignTax').value) || 0,
      otherCreditsAmount: Number(document.getElementById('giftOtherCredits').value) || 0,
      interestAmount: Number(document.getElementById('giftInterest').value) || 0,
      publicInterestOrgPenalty: Number(document.getElementById('giftPublicOrgPenalty').value) || 0,
      museumDeferredTaxAmount: Number(document.getElementById('giftMuseumDeferred').value) || 0,
      businessSuccessionDeferredTaxAmount: Number(document.getElementById('giftBizSuccessionDeferred').value) || 0,
      farmlandGiftTaxExemptionAmount: Number(document.getElementById('giftFarmlandExemption').value) || 0,
      doneeName: document.getElementById('giftDoneeName').value,
      doneeRegNo: document.getElementById('giftDoneeRegNo').value,
      doneeAddress: document.getElementById('giftDoneeAddress').value,
      donorName: document.getElementById('giftDonorName').value,
      donorRegNo: document.getElementById('giftDonorRegNo').value,
      donorAddress: document.getElementById('giftDonorAddress').value,
      giftDate: document.getElementById('giftDate').value,
      filingStatus: document.getElementById('giftFilingStatus').value,
      isFraudulent: document.getElementById('giftFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('giftUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('giftUnpaidDays').value) || 0,
      reportedInTime: document.getElementById('giftReportedInTime').checked
    };
    renderGiftResult(calculateGiftTaxJS(input));
  } else if (action === 'run-special-rate-gift'){
    const input = {
      specialType: document.getElementById('srGiftType').value,
      giftAmount: Number(document.getElementById('srGiftAmount').value) || 0,
      debtAssumedAmount: Number(document.getElementById('srDebtAssumed').value) || 0,
      priorSpecialGiftAmount: Number(document.getElementById('srPriorSpecialGift').value) || 0,
      jobsCreated10Plus: document.getElementById('srJobsCreated10Plus').checked,
      businessOwnershipYearsOfParent: Number(document.getElementById('srBusinessYears').value) || 0,
      totalAssetValue: Number(document.getElementById('srTotalAsset').value) || 0,
      nonBizAsset55: Number(document.getElementById('srNonBiz55').value) || 0,
      nonBizAsset49: Number(document.getElementById('srNonBiz49').value) || 0,
      nonBizAsset61: Number(document.getElementById('srNonBiz61').value) || 0,
      excessCash: Number(document.getElementById('srExcessCash').value) || 0,
      nonBizStock: Number(document.getElementById('srNonBizStock').value) || 0,
      disasterLossAmount: Number(document.getElementById('srDisasterLoss').value) || 0,
      appraisalFeeAmount: Number(document.getElementById('srAppraisalFee').value) || 0,
      priorPaidTax: Number(document.getElementById('srPriorPaidTax').value) || 0,
      foreignTaxPaidAmount: Number(document.getElementById('srForeignTax').value) || 0,
      filingStatus: document.getElementById('srFilingStatus').value,
      isFraudulent: document.getElementById('srFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('srUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('srUnpaidDays').value) || 0
    };
    renderSpecialRateGiftResult(calculateSpecialRateGiftTaxJS(input));
  } else if (action === 'run-inheritance'){
    const disposalLabels = ['현금·예금·유가증권', '부동산', '기타재산', '부담채무Ⅰ(국가·지자체·금융기관)', '부담채무Ⅱ(그 외)'];
    const disposalPresumptionItems = disposalLabels.map(function(label, i){
      const disposalEl = document.querySelector('[data-disposal-idx="' + i + '"][data-disposal-field="disposalAmount"]');
      const explainedEl = document.querySelector('[data-disposal-idx="' + i + '"][data-disposal-field="explainedAmount"]');
      const thresholdEl = document.querySelector('[data-disposal-idx="' + i + '"][data-disposal-field="meetsThreshold"]');
      return { category: label, disposalAmount: Number(disposalEl.value) || 0, explainedAmount: Number(explainedEl.value) || 0, meetsThreshold: thresholdEl.checked };
    }).filter(function(item){ return item.disposalAmount > 0; });
    const input = {
      taxableEstateAmount: Number(document.getElementById('ihEstate').value) || 0,
      disposalPresumptionItems: disposalPresumptionItems,
      hasSpouse: document.getElementById('ihHasSpouse').checked,
      spouseActualInheritedAmount: Number(document.getElementById('ihSpouseActual').value) || 0,
      spouseLegalShareRatio: Number(document.getElementById('ihSpouseRatio').value) || 0,
      nonHeirBequestAmount: Number(document.getElementById('ihNonHeirBequest').value) || 0,
      giftToHeirsWithin10Years: Number(document.getElementById('ihGiftToHeirs').value) || 0,
      priorGiftedAmountIncludedInEstate: Number(document.getElementById('ihPriorGiftedIncluded').value) || 0,
      spouseTaxableBaseOfPriorGift: Number(document.getElementById('ihSpouseGiftBase').value) || 0,
      childCount: Number(document.getElementById('ihChildCount').value) || 0,
      minorHeirRemainingYears: Number(document.getElementById('ihMinorYears').value) || 0,
      elderlyHeirCount: Number(document.getElementById('ihElderlyCount').value) || 0,
      disabledHeirRemainingYears: Number(document.getElementById('ihDisabledYears').value) || 0,
      netFinancialAssets: Number(document.getElementById('ihNetFinancial').value) || 0,
      hasCohabitingHouseDeduction: document.getElementById('ihHasCohabit').checked,
      cohabitingHouseValue: Number(document.getElementById('ihCohabitValue').value) || 0,
      appraisalFeeAmount: Number(document.getElementById('ihAppraisalFee').value) || 0,
      disasterLossAmount: Number(document.getElementById('ihDisasterLoss').value) || 0,
      businessInheritanceDeduction: Number(document.getElementById('ihBusinessDeduction').value) || 0,
      businessOwnershipYears: Number(document.getElementById('ihBusinessYears').value) || 0,
      businessInheritanceIndividualNetAssetValue: Number(document.getElementById('ihBusinessIndividualNet').value) || 0,
      businessInheritanceStockValue: Number(document.getElementById('ihBusinessStockValue').value) || 0,
      businessInheritanceTotalAssetValue: Number(document.getElementById('ihBusinessTotalAsset').value) || 0,
      businessInheritanceNonBizAsset55: Number(document.getElementById('ihBusinessNonBiz55').value) || 0,
      businessInheritanceNonBizAsset49: Number(document.getElementById('ihBusinessNonBiz49').value) || 0,
      businessInheritanceNonBizAsset61: Number(document.getElementById('ihBusinessNonBiz61').value) || 0,
      businessInheritanceExcessCash: Number(document.getElementById('ihBusinessExcessCash').value) || 0,
      businessInheritanceNonBizStock: Number(document.getElementById('ihBusinessNonBizStock').value) || 0,
      farmingInheritanceDeduction: Number(document.getElementById('ihFarmingDeduction').value) || 0,
      farmingIndividualAssetValue: Number(document.getElementById('ihFarmingIndividualAsset').value) || 0,
      farmingStockValue: Number(document.getElementById('ihFarmingStockValue').value) || 0,
      farmingTotalAssetValue: Number(document.getElementById('ihFarmingTotalAsset').value) || 0,
      farmingNonBizAsset55: Number(document.getElementById('ihFarmingNonBiz55').value) || 0,
      farmingNonBizAsset49: Number(document.getElementById('ihFarmingNonBiz49').value) || 0,
      farmingNonBizAsset61: Number(document.getElementById('ihFarmingNonBiz61').value) || 0,
      farmingExcessCash: Number(document.getElementById('ihFarmingExcessCash').value) || 0,
      farmingNonBizStock: Number(document.getElementById('ihFarmingNonBizStock').value) || 0,
      priorGiftTaxableBaseForOverallLimit: Number(document.getElementById('ihPriorGiftBaseTotal').value) || 0,
      disclaimedShareRedistributedAmount: Number(document.getElementById('ihDisclaimedRedistributed').value) || 0,
      generationSkipHeirRatio: Number(document.getElementById('ihGenSkipRatio').value) || 0,
      generationSkipOver2Billion: document.getElementById('ihGenSkipOver2B').checked,
      priorGiftTaxPaid: Number(document.getElementById('ihPriorGiftTax').value) || 0,
      foreignTaxPaidAmount: Number(document.getElementById('ihForeignTax').value) || 0,
      priorInheritanceTaxPortion: Number(document.getElementById('ihPriorInheritanceTax').value) || 0,
      yearsSincePriorInheritance: Number(document.getElementById('ihYearsSincePrior').value) || 0,
      specialGiftTaxCredit: Number(document.getElementById('ihSpecialGiftCredit').value) || 0,
      otherCreditsAmount: Number(document.getElementById('ihOtherCredits').value) || 0,
      interestAmount: Number(document.getElementById('ihInterest').value) || 0,
      forProfitBequestAmount: Number(document.getElementById('ihForProfitBequest').value) || 0,
      forProfitExemptedTaxAmount: Number(document.getElementById('ihForProfitExempted').value) || 0,
      forProfitHeirShareRatio: Number(document.getElementById('ihForProfitRatio').value) || 0,
      culturalPropertyDeferredTaxAmount: Number(document.getElementById('ihCulturalDeferred').value) || 0,
      businessInheritanceDeferredTaxAmount: Number(document.getElementById('ihBizInheritDeferred').value) || 0,
      reporterName: document.getElementById('ihReporterName').value,
      reporterRegNo: document.getElementById('ihReporterRegNo').value,
      reporterRelationToDeceased: document.getElementById('ihReporterRelation').value,
      deceasedName: document.getElementById('ihDeceasedName').value,
      deceasedRegNo: document.getElementById('ihDeceasedRegNo').value,
      dateOfDeath: document.getElementById('ihDeathDate').value,
      filingStatus: document.getElementById('ihFilingStatus').value,
      isFraudulent: document.getElementById('ihFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('ihUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('ihUnpaidDays').value) || 0,
      reportedInTime: document.getElementById('ihReportedInTime').checked
    };
    renderInheritanceResult(calculateInheritanceTaxJS(input));
  }
});
