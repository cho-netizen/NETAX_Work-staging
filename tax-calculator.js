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
    '<div id="taxCalcGiftResult"></div>';
}

function renderGiftResult(r){
  const box = document.getElementById('taxCalcGiftResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.인수채무액) html += taxCalcResultRow('순수증여재산가액(채무 제외)', won(r.순수증여재산가액));
  html += taxCalcResultRow('증여재산공제', won(r.증여재산공제));
  if (r.혼인출산증여재산공제) html += taxCalcResultRow('혼인·출산 증여재산공제', won(r.혼인출산증여재산공제));
  if (r.합산배제증여재산공제) html += taxCalcResultRow('합산배제증여재산공제', won(r.합산배제증여재산공제));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', won(r.감정평가수수료공제));
  if (r.재해손실공제) html += taxCalcResultRow('재해손실공제', won(r.재해손실공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액(할증 전)', won(r.산출세액_할증전));
  if (r.세대생략할증액) html += taxCalcResultRow('세대생략할증액', won(r.세대생략할증액));
  if (r.기납부세액공제) html += taxCalcResultRow('기납부세액공제', '-' + won(r.기납부세액공제));
  html += taxCalcResultRow('신고세액공제(3%)', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.인수채무액) html += '<div class="taxcalc-result-note">인수채무액 ' + won(r.인수채무액) + '에 상당하는 부분은 증여자에게 별도로 양도소득세가 과세됩니다 — 양도소득세 탭에서 함께 계산하세요.</div>';
  html += '<div class="taxcalc-result-note">납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있습니다. 창업자금·가업승계 증여세 과세특례는 포함되지 않았습니다. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

// ---- 상속세 ----
function renderInheritancePane(){
  taxCalcInheritancePane.innerHTML =
    '<div class="taxcalc-hint">상속세과세가액은 총상속재산가액에서 공과금·장례비용·채무를 빼고, 10년 이내 사전증여재산을 가산해 이미 계산된 값을 넣어야 합니다.</div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>상속세과세가액</label><input type="number" id="ihEstate" placeholder="원"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihHasSpouse"><label for="ihHasSpouse">배우자가 상속인에 포함</label></div>' +
        '<div class="taxcalc-field"><label>배우자 실제 상속액</label><input type="number" id="ihSpouseActual" placeholder="원 (5억 미만/미입력이면 최소 5억 자동 적용)"></div>' +
        '<div class="taxcalc-field"><label>배우자 법정상속분 상당액</label><input type="number" id="ihSpouseLegal" placeholder="원 (모르면 비움 → 30억 한도만 적용)"></div>' +
        '<div class="taxcalc-field"><label>자녀 수</label><input type="number" id="ihChildCount" placeholder="명 (1인당 5천만원)"></div>' +
        '<div class="taxcalc-field"><label>미성년 상속인 19세까지 잔여연수 합</label><input type="number" id="ihMinorYears" placeholder="년 (1년당 1천만원)"></div>' +
        '<div class="taxcalc-field"><label>65세 이상 상속인 수</label><input type="number" id="ihElderlyCount" placeholder="명 (1인당 5천만원)"></div>' +
        '<div class="taxcalc-field"><label>장애인 상속인 기대여명 잔여연수 합</label><input type="number" id="ihDisabledYears" placeholder="년 (1년당 1천만원)"></div>' +
        '<div class="taxcalc-field"><label>순금융재산가액(금융재산-금융채무)</label><input type="number" id="ihNetFinancial" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihHasCohabit"><label for="ihHasCohabit">동거주택상속공제 대상(10년 이상 동거·무주택 등)</label></div>' +
        '<div class="taxcalc-field"><label>동거주택가액</label><input type="number" id="ihCohabitValue" placeholder="원 (6억 한도)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ihAppraisalFee" placeholder="원 (500만원 한도)"></div>' +
        '<div class="taxcalc-field"><label>기납부증여세액(10년내 사전증여분)</label><input type="number" id="ihPriorGiftTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihReportedInTime" checked><label for="ihReportedInTime">법정신고기한 내 신고(신고세액공제 3%)</label></div>' +
      '</div>' +
    '</div>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-inheritance">세액 계산하기</button>' +
    '<div id="taxCalcInheritanceResult"></div>';
}

function renderInheritanceResult(r){
  const box = document.getElementById('taxCalcInheritanceResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('인적공제', won(r.인적공제));
  html += taxCalcResultRow('기초+인적공제 vs 일괄공제(5억) 중 큰 값', won(r['기초인적공제_또는_일괄공제']));
  html += taxCalcResultRow('배우자공제', won(r.배우자공제));
  if (r.금융재산상속공제) html += taxCalcResultRow('금융재산상속공제', won(r.금융재산상속공제));
  if (r.동거주택상속공제) html += taxCalcResultRow('동거주택상속공제', won(r.동거주택상속공제));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', won(r.감정평가수수료공제));
  html += taxCalcResultRow('상속공제 합계', won(r.상속공제_합계));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.기납부증여세액공제) html += taxCalcResultRow('기납부증여세액공제', '-' + won(r.기납부증여세액공제));
  html += taxCalcResultRow('신고세액공제(3%)', '-' + won(r.신고세액공제));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  html += '<div class="taxcalc-result-note">배우자가 단독상속인이면 일괄공제(5억)를 선택할 수 없고 기초공제+인적공제만 적용됩니다 — 해당되면 이 결과를 그대로 쓰지 마세요. 가업상속공제·재해손실공제는 포함되지 않았습니다. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
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
      filingStatus: document.getElementById('giftFilingStatus').value,
      isFraudulent: document.getElementById('giftFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('giftUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('giftUnpaidDays').value) || 0,
      reportedInTime: document.getElementById('giftReportedInTime').checked
    };
    renderGiftResult(calculateGiftTaxJS(input));
  } else if (action === 'run-inheritance'){
    const input = {
      taxableEstateAmount: Number(document.getElementById('ihEstate').value) || 0,
      hasSpouse: document.getElementById('ihHasSpouse').checked,
      spouseActualInheritedAmount: Number(document.getElementById('ihSpouseActual').value) || 0,
      spouseLegalShareAmount: Number(document.getElementById('ihSpouseLegal').value) || 0,
      childCount: Number(document.getElementById('ihChildCount').value) || 0,
      minorHeirRemainingYears: Number(document.getElementById('ihMinorYears').value) || 0,
      elderlyHeirCount: Number(document.getElementById('ihElderlyCount').value) || 0,
      disabledHeirRemainingYears: Number(document.getElementById('ihDisabledYears').value) || 0,
      netFinancialAssets: Number(document.getElementById('ihNetFinancial').value) || 0,
      hasCohabitingHouseDeduction: document.getElementById('ihHasCohabit').checked,
      cohabitingHouseValue: Number(document.getElementById('ihCohabitValue').value) || 0,
      appraisalFeeAmount: Number(document.getElementById('ihAppraisalFee').value) || 0,
      priorGiftTaxPaid: Number(document.getElementById('ihPriorGiftTax').value) || 0,
      reportedInTime: document.getElementById('ihReportedInTime').checked
    };
    renderInheritanceResult(calculateInheritanceTaxJS(input));
  }
});
