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

// ============================================================
// 증빙에서 AI 자동입력 — 기존 채팅(chat.js sendChatMessage)과 동일한 GAS_URL 대화 엔드포인트를
// 화면(말풍선) 없이 단발성으로 호출한다. 백엔드는 이미 list_drive_folder/read_drive_file 도구를
// 갖고 있으므로, context.currentPath(현재 탐색기 폴더)를 넘기고 "이 파일을 읽고 JSON만 답하라"고
// 지시하면 대화 turn을 새로 만들지 않고도 값을 뽑아올 수 있다.
// ============================================================
async function runFolderAiExtraction(instructionText){
  const payload = Object.assign({
    messages: [{ role: 'user', content: instructionText }],
    context: { currentPath: explorerPath }
  }, (typeof buildAiSettingsPayload === 'function') ? buildAiSettingsPayload(false) : {});
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.reply || '';
}

// AI 답변 중 ```json 코드블록(없으면 첫 { ... } 블록)을 찾아 파싱한다. 못 찾으면 null.
function extractJsonFromReply(text){
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/) || [null])[0];
  if (!candidate) return null;
  try { return JSON.parse(candidate); } catch (e) { return null; }
}

// 증빙파일 선택 모달 — 현재 탐색기 폴더(explorerPath)의 파일 목록을 보여주고, 고르면 onPick(fileName)을 호출한다.
function openEvidencePicker(onPick){
  const overlay = document.getElementById('taxCalcEvidenceOverlay');
  const listBox = document.getElementById('taxCalcEvidenceList');
  const folderLabel = document.getElementById('taxCalcEvidenceFolderLabel');
  folderLabel.textContent = explorerPath.length ? '📁 ' + explorerPath.join(' / ') + ' 폴더의 파일' : '⚠️ 먼저 탐색기에서 고객/사건 폴더를 여세요.';
  listBox.innerHTML = '<div class="taxcalc-evidence-empty">불러오는 중…</div>';
  overlay.style.display = 'flex';

  if (!explorerPath.length){
    listBox.innerHTML = '<div class="taxcalc-evidence-empty">사건 폴더가 선택되지 않았습니다.</div>';
  } else {
    listFolder(explorerPath).then(function(data){
      const files = (data.files || []).filter(function(f){ return !/\.gdoc$|\.gsheet$/i.test(f.name); });
      if (!files.length){ listBox.innerHTML = '<div class="taxcalc-evidence-empty">이 폴더에 파일이 없습니다. 스캔해서 추가하세요.</div>'; return; }
      listBox.innerHTML = files.map(function(f){
        return '<div class="taxcalc-evidence-item"><span class="name">' + f.name.replace(/</g,'&lt;') + '</span>' +
          '<button type="button" data-pick-file="' + f.name.replace(/"/g,'&quot;') + '">이 파일로 채우기</button></div>';
      }).join('');
      listBox.querySelectorAll('[data-pick-file]').forEach(function(btn){
        btn.addEventListener('click', function(){
          overlay.style.display = 'none';
          onPick(btn.dataset.pickFile);
        });
      });
    }).catch(function(err){
      listBox.innerHTML = '<div class="taxcalc-evidence-empty">폴더 목록을 가져오지 못했습니다: ' + (err && err.message || err) + '</div>';
    });
  }

  document.getElementById('btnCloseTaxCalcEvidence').onclick = function(){ overlay.style.display = 'none'; };
  document.getElementById('btnTaxCalcEvidenceScan').onclick = function(){
    overlay.style.display = 'none';
    openScanModal();
  };
}

// 거래(자산) 하나의 AI 자동입력 상태(_aiStatus: 'loading'|'done'|'error'|undefined)를 배지로 렌더링.
function renderAiStatusHtml(vals){
  const st = vals && vals._aiStatus;
  if (st === 'loading') return '<span class="taxcalc-badge info">🤖 증빙 읽는 중…</span>';
  if (st === 'error') return '<span class="taxcalc-badge danger">자동입력 실패</span><div class="taxcalc-ai-fields">' + (vals._aiError || '') + '</div>';
  if (st === 'done') return '<span class="taxcalc-badge warning">AI 자동입력됨 · 확인 필요</span>' +
    (vals._aiFilledFields && vals._aiFilledFields.length ? '<div class="taxcalc-ai-fields">채운 항목: ' + vals._aiFilledFields.join(', ') + (vals._aiFileName ? ' (출처: ' + vals._aiFileName + ')' : '') + '</div>' : '');
  return '';
}

// 양도소득세 거래 1건을 증빙 파일 하나로 채운다(파일럿 — 다른 세목은 추후 확장).
const TRANSFER_AI_FIELD_LABELS = {
  transferPrice: '양도가액', acquisitionPrice: '취득가액', necessaryExpenses: '필요경비',
  acquisitionDate: '취득일', transferDate: '양도일', assetType: '자산종류'
};
async function runAiAutoFillTransfer(fileName, idx){
  const vals = transferAssets[idx];
  vals._aiStatus = 'loading';
  document.getElementById('aiStatus-' + idx).innerHTML = renderAiStatusHtml(vals);

  const instruction = '현재 사건 폴더에서 "' + fileName + '" 파일을 읽어줘. 그 안에서 양도소득세 계산에 필요한 값을 찾아서, ' +
    '다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n{"transferPrice": 숫자 또는 null, "acquisitionPrice": 숫자 또는 null, "necessaryExpenses": 숫자 또는 null, ' +
    '"acquisitionDate": "YYYY-MM-DD 또는 null", "transferDate": "YYYY-MM-DD 또는 null", "assetType": "house 또는 other 또는 null"}\n```\n' +
    '(transferPrice=양도가액, acquisitionPrice=취득가액, necessaryExpenses=취득세·중개보수 등 필요경비, assetType은 주택·조합원입주권이면 house, 그 외 부동산이면 other)';

  try {
    const reply = await runFolderAiExtraction(instruction);
    const json = extractJsonFromReply(reply);
    if (!json) throw new Error('AI 응답에서 값을 찾지 못했습니다. 응답: ' + reply.slice(0, 200));
    const filled = [];
    ['transferPrice','acquisitionPrice','necessaryExpenses','acquisitionDate','transferDate','assetType'].forEach(function(key){
      if (json[key] !== null && json[key] !== undefined && json[key] !== '') {
        vals[key] = json[key];
        filled.push(TRANSFER_AI_FIELD_LABELS[key]);
      }
    });
    if (!filled.length) throw new Error('문서에서 값을 찾지 못했습니다(전부 null) — 직접 입력하세요.');
    vals._aiStatus = 'done';
    vals._aiFilledFields = filled;
    vals._aiFileName = fileName;
  } catch (err) {
    vals._aiStatus = 'error';
    vals._aiError = err && err.message ? err.message : String(err);
  }
  renderTransferPane();
}

// 증여세·상속세 화면은 "거래 카드 배열"이 아니라 단일 폼이라, 화면 전체를 다시 그리지 않고
// 해당 필드 DOM만 직접 채운 뒤 상태배지만 갱신한다(재렌더링하면 사용자가 이미 입력한 다른 값이 날아간다).
async function runAiAutoFillForm(fileName, statusElId, instruction, fieldMap, fieldLabels){
  const statusEl = document.getElementById(statusElId);
  const state = { _aiStatus: 'loading' };
  statusEl.innerHTML = renderAiStatusHtml(state);
  try {
    const reply = await runFolderAiExtraction(instruction);
    const json = extractJsonFromReply(reply);
    if (!json) throw new Error('AI 응답에서 값을 찾지 못했습니다. 응답: ' + reply.slice(0, 200));
    const filled = [];
    Object.keys(fieldMap).forEach(function(key){
      if (json[key] !== null && json[key] !== undefined && json[key] !== '') {
        const spec = fieldMap[key];
        const el = document.getElementById(spec.id);
        if (!el) return;
        if (spec.type === 'checkbox') el.checked = !!json[key];
        else el.value = json[key];
        filled.push(fieldLabels[key] || key);
      }
    });
    if (!filled.length) throw new Error('문서에서 값을 찾지 못했습니다(전부 null) — 직접 입력하세요.');
    state._aiStatus = 'done'; state._aiFilledFields = filled; state._aiFileName = fileName;
  } catch (err) {
    state._aiStatus = 'error'; state._aiError = err && err.message ? err.message : String(err);
  }
  statusEl.innerHTML = renderAiStatusHtml(state);
}

const GIFT_AI_FIELD_MAP = {
  giftAmount: { id: 'giftAmount', type: 'number' }, relation: { id: 'giftRelation', type: 'text' },
  giftDate: { id: 'giftDate', type: 'date' }, debtAssumedAmount: { id: 'giftDebtAssumed', type: 'number' },
  doneeName: { id: 'giftDoneeName', type: 'text' }, doneeRegNo: { id: 'giftDoneeRegNo', type: 'text' }, doneeAddress: { id: 'giftDoneeAddress', type: 'text' },
  donorName: { id: 'giftDonorName', type: 'text' }, donorRegNo: { id: 'giftDonorRegNo', type: 'text' }, donorAddress: { id: 'giftDonorAddress', type: 'text' }
};
const GIFT_AI_FIELD_LABELS = {
  giftAmount: '증여재산가액', relation: '관계', giftDate: '증여일자', debtAssumedAmount: '인수채무액',
  doneeName: '수증자 성명', doneeRegNo: '수증자 주민등록번호', doneeAddress: '수증자 주소',
  donorName: '증여자 성명', donorRegNo: '증여자 주민등록번호', donorAddress: '증여자 주소'
};
function runAiAutoFillGift(fileName){
  const instruction = '현재 사건 폴더에서 "' + fileName + '" 파일을 읽어줘. 증여세 신고에 필요한 값을 찾아서, ' +
    '다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n{"giftAmount": 숫자 또는 null, "relation": "배우자 또는 직계존속 또는 직계비속 또는 기타친족 또는 기타 또는 null(수증자 기준 증여자와의 관계)", ' +
    '"giftDate": "YYYY-MM-DD 또는 null", "debtAssumedAmount": 숫자 또는 null(부담부증여로 수증자가 인수한 채무, 없으면 0), ' +
    '"doneeName": "문자열 또는 null", "doneeRegNo": "문자열 또는 null", "doneeAddress": "문자열 또는 null", ' +
    '"donorName": "문자열 또는 null", "donorRegNo": "문자열 또는 null", "donorAddress": "문자열 또는 null"}\n```';
  return runAiAutoFillForm(fileName, 'aiStatus-gift', instruction, GIFT_AI_FIELD_MAP, GIFT_AI_FIELD_LABELS);
}

const INHERITANCE_AI_FIELD_MAP = {
  childCount: { id: 'ihChildCount', type: 'number' }, hasSpouse: { id: 'ihHasSpouse', type: 'checkbox' },
  reporterName: { id: 'ihReporterName', type: 'text' }, reporterRegNo: { id: 'ihReporterRegNo', type: 'text' }, reporterRelation: { id: 'ihReporterRelation', type: 'text' },
  deceasedName: { id: 'ihDeceasedName', type: 'text' }, deceasedRegNo: { id: 'ihDeceasedRegNo', type: 'text' }, deathDate: { id: 'ihDeathDate', type: 'date' }
};
const INHERITANCE_AI_FIELD_LABELS = {
  childCount: '자녀 수', hasSpouse: '배우자 유무', reporterName: '신고인 성명', reporterRegNo: '신고인 주민등록번호',
  reporterRelation: '신고인과 피상속인 관계', deceasedName: '피상속인 성명', deceasedRegNo: '피상속인 주민등록번호', deathDate: '상속개시일'
};
function runAiAutoFillInheritance(fileName){
  const instruction = '현재 사건 폴더에서 "' + fileName + '" 파일을 읽어줘. 상속세 신고에 필요한 값을 찾아서, ' +
    '다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘. ' +
    '상속세과세가액(전체 세액계산 결과)은 이 도구가 별도로 계산하는 값이라 여기서 채우지 않는다 — 요청하지 말 것.\n' +
    '```json\n{"childCount": 숫자 또는 null(피상속인의 자녀 수), "hasSpouse": true/false/null(배우자가 상속인에 포함되는지), ' +
    '"reporterName": "문자열 또는 null(신고인=상속인 대표)", "reporterRegNo": "문자열 또는 null", "reporterRelation": "문자열 또는 null(예: 자녀, 배우자)", ' +
    '"deceasedName": "문자열 또는 null(피상속인)", "deceasedRegNo": "문자열 또는 null", "deathDate": "YYYY-MM-DD 또는 null(상속개시일=사망일)"}\n```';
  return runAiAutoFillForm(fileName, 'aiStatus-inheritance', instruction, INHERITANCE_AI_FIELD_MAP, INHERITANCE_AI_FIELD_LABELS);
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
  house: '단독주택(고시된 개별주택가격 × 지분)',
  apartment: '공동주택/아파트(고시된 공동주택가격 × 지분)',
  officetel: '오피스텔·상업용건물(고시된 기준시가 × 지분)',
  listedStock: '상장주식(기준일 전후 2개월 종가평균 × 주식수)',
  unlistedStock: '비상장주식(순손익·순자산가치 가중평균)',
  rental: '임대 중인 부동산(임대료환산가액)'
};

function computeValuationAssetValue(a){
  let value;
  switch (a.method){
    case 'land': value = calculateLandValueJS(a.landPrice, a.landArea, a.landShare || 100); break;
    case 'house': case 'apartment': case 'officetel': value = calculateHouseValueJS(a.housePrice, a.houseShare || 100); break;
    case 'listedStock': value = calculateListedStockValueJS(a.listedPrice, a.listedShares); break;
    case 'rental': value = calculateRentalConversionValueJS(a.rentalAnnualRent, a.rentalDeposit); break;
    case 'unlistedStock': {
      const r = calculateUnlistedStockValueJS({
        totalIssuedShares: a.uTotalShares, ownedShares: a.uOwnedShares,
        netProfit1YearAgo: a.uProfit1, netProfit2YearsAgo: a.uProfit2, netProfit3YearsAgo: a.uProfit3,
        netAssetValue: a.uNetAsset, isRealEstateHeavy: a.uRealEstateHeavy, isMajorShareholder: a.uMajorShareholder,
        isSmallBusiness: a.uIsSmallBusiness, isMediumBusinessUnder500B: a.uIsMediumUnder500B
      });
      value = r.error ? 0 : r.평가총액;
      break;
    }
    default: value = Number(a.directValue) || 0;
  }
  // 저당권·질권 등이 설정된 재산 및 임대차계약이 체결된 재산의 평가특례(상증세법 §66, 시행령 §63①1호) —
  // 시가·보충적평가액, 그 재산이 담보하는 채권액(또는 등기된 전세금), 임대보증금 환산가액(임대보증금+연간임대료÷12%)
  // 중 가장 큰 금액으로 평가한다. 세 가지는 서로 다른 근거이므로 해당되는 값만 입력하면 자동으로 셋 중 최댓값을 쓴다.
  const securedDebtAmount = Number(a.securedDebtAmount) || 0;
  const hasRentalCapInput = (Number(a.rentalAnnualRentForCap) || 0) > 0 || (Number(a.rentalDepositForCap) || 0) > 0;
  const rentalCapValue = hasRentalCapInput ? calculateRentalConversionValueJS(a.rentalAnnualRentForCap, a.rentalDepositForCap) : 0;
  return Math.max(value, securedDebtAmount, rentalCapValue);
}

function valuationAssetMethodFieldsHtml(m, a){
  if (m === 'land') return '' +
    '<div class="taxcalc-field"><label>개별공시지가(원/㎡)</label><input type="number" data-field="landPrice" value="' + (a.landPrice || '') + '"></div>' +
    '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-field="landArea" value="' + (a.landArea || '') + '"></div>' +
    '<div class="taxcalc-field"><label>지분율(%)</label><input type="number" data-field="landShare" placeholder="기본 100" value="' + (a.landShare || '') + '"></div>';
  if (m === 'house' || m === 'apartment' || m === 'officetel') return '' +
    '<div class="taxcalc-field"><label>고시된 ' + (m === 'apartment' ? '공동주택가격' : m === 'officetel' ? '오피스텔·상업용건물 기준시가' : '개별주택가격') + '</label><input type="number" data-field="housePrice" value="' + (a.housePrice || '') + '"></div>' +
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
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="uMajorShareholder" ' + (a.uMajorShareholder ? 'checked' : '') + '><label>최대주주 등 할증(20%)</label></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="uIsSmallBusiness" ' + (a.uIsSmallBusiness ? 'checked' : '') + '><label>중소기업이 발행한 주식(할증 배제)</label></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="uIsMediumUnder500B" ' + (a.uIsMediumUnder500B ? 'checked' : '') + '><label>중견기업(직전3년 매출평균 5천억 미만)이 발행한 주식(할증 배제)</label></div>';
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
        '<div class="taxcalc-field"><label>담보채권액(저당권·질권 등, §66)</label><input type="number" data-field="securedDebtAmount" placeholder="원 (있으면 시가/보충적평가액과 비교해 큰 금액 적용)" value="' + (a.securedDebtAmount || '') + '"></div>' +
        '<div class="taxcalc-field"><label>임대보증금(평가특례, §66)</label><input type="number" data-field="rentalDepositForCap" placeholder="원 (임대차 있으면 입력)" value="' + (a.rentalDepositForCap || '') + '"></div>' +
        '<div class="taxcalc-field"><label>연간임대료(평가특례, §66)</label><input type="number" data-field="rentalAnnualRentForCap" placeholder="원 (임대차 있으면 입력)" value="' + (a.rentalAnnualRentForCap || '') + '"></div>' +
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

// ---- 안분계산 도구(소득세법 시행령 §166④) ----
let allocationAssets = [{}, {}];
let allocationShown = false;

const ALLOCATION_METHOD_LABELS = {
  standard_price: '양도가액 안분 (기준시가·감정가액 비율)',
  standard_price_vat: '양도가액 안분(부가세 포함, 건물분 VAT 분리)',
  area: '면적 안분',
  acq_expense_together: '취득/필요경비 함께 안분(양도시 비율 동일 적용)',
  acq_expense_separate: '취득/필요경비 각각 안분(취득시 비율 별도 적용)'
};

function renderAllocationTool(){
  const box = document.getElementById('taxCalcAllocationTool');
  if (!box) return;
  if (!allocationShown){ box.innerHTML = ''; return; }
  const method = box.dataset.method || 'standard_price';
  const showAcq = method === 'acq_expense_together' || method === 'acq_expense_separate';
  const showAcqStd = method === 'acq_expense_separate';
  const showArea = method === 'area';
  const showVat = method === 'standard_price_vat';

  const rowsHtml = allocationAssets.map(function(a, idx){
    return '<div class="taxcalc-grid" data-alloc-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>자산명</label><input type="text" data-afield="label" value="' + (a.label || '').replace(/"/g,'&quot;') + '" placeholder="예: 토지 / 건물"></div>' +
      (showArea
        ? '<div class="taxcalc-field"><label>면적</label><input type="number" data-afield="area" value="' + (a.area || '') + '" placeholder="㎡"></div>'
        : '<div class="taxcalc-field"><label>기준시가(양도시)</label><input type="number" data-afield="standardPriceTransfer" value="' + (a.standardPriceTransfer || '') + '" placeholder="원 (감정가액 있으면 감정가액)"></div>') +
      (showAcqStd ? '<div class="taxcalc-field"><label>기준시가(취득시)</label><input type="number" data-afield="standardPriceAcquisition" value="' + (a.standardPriceAcquisition || '') + '" placeholder="원"></div>' : '') +
      (showVat ? '<div class="taxcalc-field checkbox"><input type="checkbox" data-afield="isBuilding" id="allocBldg-' + idx + '"' + (a.isBuilding ? ' checked' : '') + '><label for="allocBldg-' + idx + '">건물분(부가세 과세대상)</label></div>' : '') +
      (allocationAssets.length > 2 ? '<button type="button" class="taxcalc-del-asset" data-action="del-alloc-asset" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  box.innerHTML =
    '<div class="taxcalc-asset" style="margin-top:10px;">' +
      '<div class="taxcalc-asset-head"><b>안분계산(소득세법 시행령 §166④) — 토지·건물 등을 함께 양도했는데 가액 구분이 불분명할 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>안분방식</label><select id="allocMethod">' +
          Object.keys(ALLOCATION_METHOD_LABELS).map(function(k){ return '<option value="' + k + '"' + (k === method ? ' selected' : '') + '>' + ALLOCATION_METHOD_LABELS[k] + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="taxcalc-field"><label>총 양도가액</label><input type="number" id="allocTotalTransfer" placeholder="원" value="' + (box.dataset.totalTransfer || '') + '"></div>' +
        (showAcq ? '<div class="taxcalc-field"><label>총 취득가액</label><input type="number" id="allocTotalAcq" placeholder="원" value="' + (box.dataset.totalAcq || '') + '"></div>' : '') +
        (showAcq ? '<div class="taxcalc-field"><label>총 필요경비</label><input type="number" id="allocTotalExpense" placeholder="원" value="' + (box.dataset.totalExpense || '') + '"></div>' : '') +
      '</div>' +
      '<div id="allocAssetRows">' + rowsHtml + '</div>' +
      '<button type="button" class="taxcalc-add-asset" data-action="add-alloc-asset" style="margin-top:8px;">+ 자산 추가</button>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-allocation">안분계산하기</button>' +
      '<div id="taxCalcAllocationResult"></div>' +
    '</div>';

  box.querySelector('#allocMethod').addEventListener('change', function(e){
    box.dataset.method = e.target.value;
    box.dataset.totalTransfer = document.getElementById('allocTotalTransfer').value;
    renderAllocationTool();
  });
  box.querySelector('#allocTotalTransfer').addEventListener('input', function(e){ box.dataset.totalTransfer = e.target.value; });
  const allocTotalAcqEl = document.getElementById('allocTotalAcq');
  if (allocTotalAcqEl) allocTotalAcqEl.addEventListener('input', function(e){ box.dataset.totalAcq = e.target.value; });
  const allocTotalExpenseEl = document.getElementById('allocTotalExpense');
  if (allocTotalExpenseEl) allocTotalExpenseEl.addEventListener('input', function(e){ box.dataset.totalExpense = e.target.value; });
  box.querySelectorAll('[data-afield]').forEach(function(el){
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function(){
      const idx = Number(el.closest('[data-alloc-idx]').dataset.allocIdx);
      const key = el.dataset.afield;
      allocationAssets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
    });
  });
}

function renderAllocationResult(r){
  const box = document.getElementById('taxCalcAllocationResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result" style="margin-top:10px;">';
  r.자산별_안분결과.forEach(function(row, idx){
    html += '<div class="taxcalc-result-row total"><span>' + row.label + '</span><span class="v"></span></div>';
    html += taxCalcResultRow('안분비율(양도)', (row.안분비율_양도 * 100).toFixed(2) + '%');
    html += taxCalcResultRow('양도가액 안분액', won(row.양도가액_안분액));
    if (row.부가세 !== undefined) html += taxCalcResultRow('부가세(10/110)', won(row.부가세));
    if (row.양도가액_부가세제외 !== undefined) html += taxCalcResultRow('양도가액(부가세 제외)', won(row.양도가액_부가세제외));
    if (row.안분비율_취득 !== undefined) html += taxCalcResultRow('안분비율(취득)', (row.안분비율_취득 * 100).toFixed(2) + '%');
    if (row.취득가액_안분액 !== undefined) html += taxCalcResultRow('취득가액 안분액', won(row.취득가액_안분액));
    if (row.필요경비_안분액 !== undefined) html += taxCalcResultRow('필요경비 안분액', won(row.필요경비_안분액));
    html += '<button type="button" class="taxcalc-run-btn" data-action="apply-allocation-to-new-asset" data-ridx="' + idx + '">이 결과로 새 거래 추가</button>';
  });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
  box.dataset.lastResult = JSON.stringify(r);
}

// ---- 건물기준시가 계산기(층별/부속시설별 상세) ----
let buildingPriceRows = [{}];
let buildingPriceShown = false;

function renderBuildingPriceTool(){
  const box = document.getElementById('taxCalcBuildingPriceTool');
  if (!box) return;
  if (!buildingPriceShown){ box.innerHTML = ''; return; }
  const taxType = box.dataset.taxType || 'transfer';

  const rowsHtml = buildingPriceRows.map(function(r, idx){
    const structureOptions = BUILDING_STRUCTURE_TABLE.map(function(s){ return '<option value="' + s.name + '"' + (r.structureName === s.name ? ' selected' : '') + '>' + s.name + '</option>'; }).join('');
    const useOptions = BUILDING_USE_TABLE.filter(function(u){ return u.index !== null; }).map(function(u){ return '<option value="' + u.no + '"' + (String(r.useNo) === String(u.no) ? ' selected' : '') + '>' + u.no + '. ' + u.desc + '</option>'; }).join('');
    return '<div class="taxcalc-grid" data-bp-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>구분</label><input type="text" data-bfield="label" value="' + (r.label || '').replace(/"/g,'&quot;') + '" placeholder="예: 1층 / 지하주차장"></div>' +
      '<div class="taxcalc-field"><label>구조</label><select data-bfield="structureName"><option value="">선택</option>' + structureOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>용도</label><select data-bfield="useNo"><option value="">선택</option>' + useOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>신축(증축)연도</label><input type="number" data-bfield="builtYear" value="' + (r.builtYear || '') + '" placeholder="예: 2010"></div>' +
      '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-bfield="floorAreaSqm" value="' + (r.floorAreaSqm || '') + '"></div>' +
      (buildingPriceRows.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-building-row" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  box.innerHTML =
    '<div class="taxcalc-asset" style="margin-top:10px;">' +
      '<div class="taxcalc-asset-head"><b>건물기준시가 계산기(2026.1.1. 시행 국세청 고시) — 층·부속시설마다 구조·용도·신축연도가 다르면 행을 나눠 입력</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="bpTaxType">' +
          '<option value="transfer"' + (taxType === 'transfer' ? ' selected' : '') + '>양도소득세(조정률 미적용)</option>' +
          '<option value="inheritance_gift"' + (taxType === 'inheritance_gift' ? ' selected' : '') + '>상속세·증여세</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>부속토지 개별공시지가(㎡당)</label><input type="number" id="bpLandPrice" value="' + (box.dataset.landPrice || '') + '" placeholder="원"></div>' +
      '</div>' +
      '<div id="bpRows">' + rowsHtml + '</div>' +
      '<button type="button" class="taxcalc-add-asset" data-action="add-building-row" style="margin-top:8px;">+ 층/부속시설 추가</button>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-building-price">건물기준시가 계산하기</button>' +
      '<div id="taxCalcBuildingPriceResult"></div>' +
    '</div>';

  box.querySelector('#bpTaxType').addEventListener('change', function(e){ box.dataset.taxType = e.target.value; renderBuildingPriceTool(); });
  box.querySelector('#bpLandPrice').addEventListener('input', function(e){ box.dataset.landPrice = e.target.value; });
  box.querySelectorAll('[data-bfield]').forEach(function(el){
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function(){
      const idx = Number(el.closest('[data-bp-idx]').dataset.bpIdx);
      buildingPriceRows[idx][el.dataset.bfield] = el.value;
    });
  });
}

function renderBuildingPriceResult(r){
  const box = document.getElementById('taxCalcBuildingPriceResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result" style="margin-top:10px;">';
  r.행별_결과.forEach(function(row){
    html += '<div class="taxcalc-result-row total"><span>' + row.구분 + '</span><span class="v"></span></div>';
    html += taxCalcResultRow('㎡당 금액', won(row['㎡당_금액']));
    html += taxCalcResultRow('면적', row['건물면적_㎡'] + '㎡');
    html += taxCalcResultRow('기준시가', won(row.건물기준시가));
  });
  html += taxCalcResultRow('건물기준시가 합계', won(r.건물기준시가_합계), { total: true });
  html += '<button type="button" class="taxcalc-run-btn" data-action="apply-building-price-to-new-asset">이 합계로 새 거래(취득가액) 추가</button>';
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
  box.dataset.lastTotal = r.건물기준시가_합계;
}

// ============================================================
// 간편계산 / 정밀계산 — 두 화면을 따로 만들지 않는다. 국세청 간편신고서([별지 제84호의4서식] 등)를
// 보면 "간편"도 취득가액 세부내역·장기보유특별공제·가산세·세액공제까지 다 받는, 그 자체로 완전한
// 계산이다. 간편과 정밀의 차이는 필드 수가 아니라 "값을 손으로 다 채우느냐, 증빙을 올리면 AI가
// 채워주느냐"뿐이다 — 그래서 같은 입력폼(정밀계산 화면)을 그대로 쓰고, 증빙업로드·AI자동입력
// 버튼만 tier에 따라 보이거나 숨긴다(updateTaxCalcPaneVisibility의 taxCalcView 클래스 토글).
// ============================================================
let taxCalcTier = 'simple';

function renderTransferPane(){
  const cardsHtml = transferAssets.map(function(_, idx){
    return '' +
      '<div class="taxcalc-asset" data-idx="' + idx + '">' +
        '<div class="taxcalc-asset-head"><b>거래 ' + (idx+1) + '</b>' +
          '<span>' +
            '<button type="button" class="taxcalc-ai-btn" data-action="open-evidence-transfer" data-idx="' + idx + '">🤖 증빙에서 자동 입력</button>' +
            '<button type="button" class="taxcalc-calcbasis-btn" data-action="show-calc-basis" data-idx="' + idx + '">🧮 계산근거</button>' +
            (transferAssets.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-asset" data-idx="' + idx + '">✕ 삭제</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="taxcalc-ai-status" id="aiStatus-' + idx + '">' + renderAiStatusHtml(transferAssets[idx]) + '</div>' +
        '<div class="taxcalc-calcbasis" id="calcBasis-' + idx + '" style="display:none;"></div>' +
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
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isNewBuildingWithin5Years" id="newbldg-' + idx + '"><label for="newbldg-' + idx + '">신축(증축) 후 5년 이내 양도 + 환산취득가액 사용</label></div>' +
          '<div class="taxcalc-field"><label>환산취득가액 중 건물분</label><input type="number" data-field="convertedBuildingAcquisitionValueForPenalty" placeholder="원 (위 체크 시, 가산세 5%)"></div>' +
          '<div class="taxcalc-field"><label>등록임대주택 장특공제 특례</label><select data-field="rentalSpecialType">' +
            '<option value="">해당없음</option>' +
            '<option value="rental_general">장기일반민간임대주택(조특법§97의3, 10년↑70%/8년↑50%)</option>' +
            '<option value="rental_long">장기임대주택(조특법§97의4, 일반공제+임대기간별 추가공제)</option>' +
          '</select></div>' +
          '<div class="taxcalc-field"><label>임대기간</label><input type="number" data-field="rentalYears" placeholder="년 (위 특례 선택 시)"></div>' +
          '<div class="taxcalc-field"><label>연금계좌 납입액</label><input type="number" data-field="pensionAccountContribution" placeholder="원 (조특법§99의13, 양도대금 중 6개월 내 납입액)"></div>' +
          '<div class="taxcalc-field"><label>공익사업용토지 수용감면</label><select data-field="compensationType">' +
            '<option value="">해당없음</option>' +
            '<option value="cash">현금보상(조특법§77, 10%)</option>' +
            '<option value="bond">채권보상 - 만기특약 없음(15%)</option>' +
            '<option value="bond_3y">채권보상 - 3년만기특약(30%)</option>' +
            '<option value="bond_5y">채권보상 - 5년만기특약(40%)</option>' +
          '</select></div>' +
          '<div class="taxcalc-field"><label>다운계약서 등 계약서·실거래 차액</label><input type="number" data-field="downContractPriceDifference" placeholder="원 (소득세법§91② 비과세·감면 배제 추징용, 해당 시만)"></div>' +
        '</div>' +
      '</div>';
  }).join('');

  taxCalcTransferPane.innerHTML =
    '<div class="taxcalc-hint">여러 건을 추가하면 2년 이상 보유·특례 없는(또는 다주택중과·비사업용토지만 해당하는) 거래는 자동으로 합산해서 기본공제(250만원, 전체 1회)와 누진세율을 함께 적용합니다(확정신고 합산 개념). 단기양도·미등기양도는 건별로 따로 계산해서 더합니다. 다주택 중과는 조정대상지역 지정·한시배제 여부를 신고 시점 기준으로 직접 확인한 뒤 체크하세요.</div>' +
    '<div id="taxCalcTransferCards">' + cardsHtml + '</div>' +
    '<button type="button" class="taxcalc-add-asset" data-action="add-asset">+ 거래 추가</button>' +
    '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-allocation-tool" style="margin-bottom:10px;">🧮 안분계산 도구(토지·건물 등 일괄양도시)</button>' +
    '<div id="taxCalcAllocationTool"></div>' +
    '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-building-price-tool" style="margin-bottom:10px;">🏢 건물기준시가 계산기(층별 상세)</button>' +
    '<div id="taxCalcBuildingPriceTool"></div>' +
    '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세(확정신고 전체 기준)</b></div>' +
    '<div class="taxcalc-grid">' +
      '<div class="taxcalc-field"><label>신고 상태</label><select id="trFilingStatus">' +
        '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
      '</select></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" id="trFraudulent"><label for="trFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
      '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="trUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
      '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="trUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" id="trSelfEfiling"><label for="trSelfEfiling">납세자 본인이 직접 전자신고(2만원 공제)</label></div>' +
    '</div>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-transfer">세액 계산하기</button>' +
    '<div id="taxCalcTransferResult"></div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제62호서식 등] 주식등 양도소득세 — 부동산과 완전히 별도 세목입니다(장기보유특별공제 없음, 대주주/소액주주·국내/국외·중소기업 여부로 세율 결정)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>자산구분</label><select id="stAssetCategory">' +
          '<option value="domestic_stock">국내주식등</option><option value="foreign_stock">국외주식등</option>' +
          '<option value="derivative">파생상품등</option><option value="other_asset">기타자산(특정주식·부동산과다보유법인)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="stTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="stAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도비용</label><input type="number" id="stTransferExpenses" placeholder="원 (증권거래세 등, 없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stIsDaejuju"><label for="stIsDaejuju">대주주(국내주식만 해당, 지분율·시가총액 기준은 별도 확인)</label></div>' +
        '<div class="taxcalc-field"><label>보유기간(대주주만)</label><input type="number" id="stHoldingMonths" placeholder="개월 (12개월 미만이면 30%)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stIsSmallMedium"><label for="stIsSmallMedium">중소기업 발행주식</label></div>' +
        '<div class="taxcalc-field"><label>같은 기간 다른 국내외주식 순손익</label><input type="number" id="stPriorNetGain" placeholder="원 (이익+/손실-, 손익통산용, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>이미 사용한 기본공제액</label><input type="number" id="stBasicDeductionUsed" placeholder="원 (같은 기간 다른 주식양도에서 이미 썼으면)"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액공제</label><input type="number" id="stForeignTax" placeholder="원 (국외주식, 없으면 0)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="stFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stFraudulent"><label for="stFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="stUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="stUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-stock-transfer">세액 계산하기</button>' +
      '<div id="taxCalcStockTransferResult"></div>' +
    '</div>';

  renderAllocationTool();
  renderBuildingPriceTool();

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
    isEightYearFarmland: !!vals.isEightYearFarmland,
    isNewBuildingWithin5Years: !!vals.isNewBuildingWithin5Years,
    convertedBuildingAcquisitionValueForPenalty: Number(vals.convertedBuildingAcquisitionValueForPenalty) || 0,
    rentalSpecialType: vals.rentalSpecialType || '',
    rentalYears: Number(vals.rentalYears) || 0,
    pensionAccountContribution: Number(vals.pensionAccountContribution) || 0,
    compensationType: vals.compensationType || '',
    downContractPriceDifference: Number(vals.downContractPriceDifference) || 0
  };
}

// 거래 1건의 계산근거(산출과정)를 [별지 84호서식] "양도소득계산명세" 스타일로 단계별 수식+실제금액 텍스트로 만든다.
// calculateTransferTaxSingleJS 결과 하나만 보고 만들므로, 다건 합산의 "합산과세표준→산출세액" 단계는 별도로 renderTransferResult에서 덧붙인다.
function buildTransferCalcBasisLines(r){
  const lines = [];
  if (r.error) { lines.push('오류: ' + r.error); return lines; }
  if (r.미등기양도 || (r.입력값 && r.입력값.미등기양도)) {
    lines.push('미등기양도자산 — 장기보유특별공제·기본공제 배제');
    lines.push('양도차익 = 양도가액 - 취득가액 - 필요경비 = ' + won(r.입력값.양도가액) + ' - ' + won(r.입력값.취득가액) + ' - ' + won(r.입력값.필요경비) + ' = ' + won(r.양도차익));
    lines.push('산출세액 = 양도차익 × 70% = ' + won(r.산출세액));
    lines.push('지방소득세(10%) = ' + won(r.지방소득세));
    lines.push('납부세액 합계 = ' + won(r.납부세액_합계));
    return lines;
  }
  if (r.다운계약서_비과세배제) {
    lines.push('1세대1주택 비과세 대상이나, 다운계약서(업계약서) 등 거짓 계약으로 비과세를 적용받은 것으로 전제(소득세법§91②)');
    lines.push('비과세 미적용시 산출세액(지방소득세 포함) = ' + won(r.비과세미적용시_산출세액));
    lines.push('계약서·실거래 차액 = ' + won(r.계약서_실거래_차액));
    lines.push('추징세액 = MIN(비과세 미적용시 세액, 계약서·실거래 차액) = ' + won(r.납부세액_합계));
    return lines;
  }
  if (r.비과세여부) {
    lines.push('1세대1주택 비과세 요건 충족 전제 — 양도가액 ' + won(r.입력값.양도가액) + '이 12억원 이하이므로 전액 비과세');
    lines.push('납부세액 = 0원');
    return lines;
  }
  const iv = r.입력값 || {};
  lines.push('양도가액 = ' + won(iv.양도가액));
  lines.push('취득가액 = ' + won(iv.취득가액));
  lines.push('필요경비 = ' + won(iv.필요경비));
  lines.push('양도차익 = 양도가액 - 취득가액 - 필요경비 = ' + won(iv.양도가액) + ' - ' + won(iv.취득가액) + ' - ' + won(iv.필요경비) + ' = ' + won(r.양도차익));
  if (r.과세대상양도차익 !== undefined && r.과세대상양도차익 !== r.양도차익) {
    lines.push('과세대상양도차익(1세대1주택 12억 초과분 안분) = 양도차익 × (양도가액-12억)/양도가액 = ' + won(r.과세대상양도차익));
  }
  const gainForRate = r.과세대상양도차익 !== undefined ? r.과세대상양도차익 : r.양도차익;
  lines.push('장기보유특별공제액 = 과세대상양도차익 × 장기보유특별공제율(' + (r.장기보유특별공제율 * 100).toFixed(1) + '%, 보유기간 ' + iv.보유기간_년 + '년' + (r.장기임대주택특례_적용여부 ? ', 등록임대주택 특례' : '') + ') = ' + won(gainForRate) + ' × ' + r.장기보유특별공제율 + ' = ' + won(r.장기보유특별공제액));
  lines.push('양도소득금액 = 과세대상양도차익 - 장기보유특별공제액 = ' + won(gainForRate) + ' - ' + won(r.장기보유특별공제액) + ' = ' + won(r.양도소득금액));
  lines.push('기본공제 = ' + won(r.기본공제));
  lines.push('과세표준 = 양도소득금액 - 기본공제 = ' + won(r.양도소득금액) + ' - ' + won(r.기본공제) + ' = ' + won(r.과세표준));
  lines.push('산출세액(' + r.적용세율_설명 + ') = ' + won(r.산출세액));
  (r.세율가산_내역 || []).forEach(function(n){ lines.push('· ' + n); });
  if (r.자경농지감면액) lines.push('8년자경농지 감면(조특법§69) = -' + won(r.자경농지감면액));
  if (r.수용감면액) lines.push('공익사업용토지 수용감면(조특법§77) = -' + won(r.수용감면액));
  if (r.다운계약서_감면배제_추징액) lines.push('다운계약서 감면배제 추징(소득세법§91②) = +' + won(r.다운계약서_감면배제_추징액));
  if (r.연금계좌세액공제) lines.push('연금계좌세액공제(조특법§99의13) = -' + won(r.연금계좌세액공제));
  if (r.전자신고세액공제) lines.push('전자신고세액공제 = -' + won(r.전자신고세액공제));
  if (r.환산취득가액가산세) lines.push('환산취득가액가산세(소득세법§114의2) = +' + won(r.환산취득가액가산세));
  if (r.무신고가산세) lines.push('무신고가산세 = +' + won(r.무신고가산세));
  if (r.과소신고가산세) lines.push('과소신고가산세 = +' + won(r.과소신고가산세));
  if (r.납부지연가산세) lines.push('납부지연가산세 = +' + won(r.납부지연가산세));
  lines.push('지방소득세(산출세액의 10%) = ' + won(r.지방소득세));
  lines.push('납부세액 합계 = ' + won(r.납부세액_합계));
  return lines;
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
  if (r.합산수용감면액) html += taxCalcResultRow('공익사업용토지 수용감면(조특법§77)', '-' + won(r.합산수용감면액));
  if (r.다운계약서_감면배제_추징액) html += taxCalcResultRow('다운계약서 감면배제 추징액', '+' + won(r.다운계약서_감면배제_추징액));
  if (r.비과세거래_다운계약서_추징액) html += taxCalcResultRow('다운계약서 비과세배제 추징액(별건)', '+' + won(r.비과세거래_다운계약서_추징액));
  html += taxCalcResultRow('합산(장기) 그룹 산출세액', won(r.합산그룹_산출세액));
  if (r.단기거래_산출세액_합계) html += taxCalcResultRow('단기양도 산출세액 합계', won(r.단기거래_산출세액_합계));
  if (r.미등기거래_산출세액_합계) html += taxCalcResultRow('미등기양도 산출세액 합계', won(r.미등기거래_산출세액_합계));
  if (r.연금계좌세액공제_합계) html += taxCalcResultRow('연금계좌세액공제(조특법§99의13)', '-' + won(r.연금계좌세액공제_합계));
  if (r.전자신고세액공제) html += taxCalcResultRow('전자신고세액공제', '-' + won(r.전자신고세액공제));
  if (r.환산취득가액가산세_합계) html += taxCalcResultRow('환산취득가액 가산세', '+' + won(r.환산취득가액가산세_합계));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  html += '<button type="button" class="taxcalc-calcbasis-btn" data-action="show-agg-calc-basis" style="margin-top:8px;">🧮 합산 산출과정 보기</button>';
  html += '<div class="taxcalc-calcbasis" id="calcBasisAgg" style="display:none;">' +
    '<div class="taxcalc-calcbasis-title">합산(장기) 그룹 산출과정</div>' +
    '<div class="taxcalc-calcbasis-line">합산소득금액 = Σ(2년 이상 보유·특례 없는 거래의 양도소득금액) = ' + won(r.합산소득금액) + '</div>' +
    '<div class="taxcalc-calcbasis-line">합산과세표준 = 합산소득금액 - 기본공제 = ' + won(r.합산소득금액) + ' - ' + won(r.기본공제) + ' = ' + won(r.합산과세표준) + '</div>' +
    '<div class="taxcalc-calcbasis-line">합산기본세액(누진세율) = ' + won(r.합산기본세액) + '</div>' +
    (r.합산가산액 ? '<div class="taxcalc-calcbasis-line">다주택중과·비사업용토지 가산 = +' + won(r.합산가산액) + '</div>' : '') +
    (r.합산자경감면액 ? '<div class="taxcalc-calcbasis-line">8년자경농지 감면 = -' + won(r.합산자경감면액) + '</div>' : '') +
    (r.합산수용감면액 ? '<div class="taxcalc-calcbasis-line">공익사업용토지 수용감면 = -' + won(r.합산수용감면액) + '</div>' : '') +
    (r.다운계약서_감면배제_추징액 ? '<div class="taxcalc-calcbasis-line">다운계약서 감면배제 추징 = +' + won(r.다운계약서_감면배제_추징액) + '</div>' : '') +
    '<div class="taxcalc-calcbasis-line">합산(장기) 그룹 산출세액 = ' + won(r.합산그룹_산출세액) + '</div>' +
    (r.단기거래_산출세액_합계 ? '<div class="taxcalc-calcbasis-line">+ 단기양도 산출세액 합계(건별 계산) = ' + won(r.단기거래_산출세액_합계) + '</div>' : '') +
    (r.미등기거래_산출세액_합계 ? '<div class="taxcalc-calcbasis-line">+ 미등기양도 산출세액 합계(건별 계산) = ' + won(r.미등기거래_산출세액_합계) + '</div>' : '') +
    (r.비과세거래_다운계약서_추징액 ? '<div class="taxcalc-calcbasis-line">+ 다운계약서 비과세배제 추징액(별건) = ' + won(r.비과세거래_다운계약서_추징액) + '</div>' : '') +
    (r.연금계좌세액공제_합계 ? '<div class="taxcalc-calcbasis-line">- 연금계좌세액공제 = ' + won(r.연금계좌세액공제_합계) + '</div>' : '') +
    (r.전자신고세액공제 ? '<div class="taxcalc-calcbasis-line">- 전자신고세액공제 = ' + won(r.전자신고세액공제) + '</div>' : '') +
    '<div class="taxcalc-calcbasis-line">지방소득세(10%) = ' + won(r.지방소득세) + '</div>' +
    '<div class="taxcalc-calcbasis-line">납부세액 합계 = ' + won(r.납부세액_합계) + '</div>' +
    '<div class="taxcalc-calcbasis-line" style="margin-top:6px;color:var(--sub);">각 거래별 세부 산출과정은 위 거래 카드의 🧮 계산근거 버튼을 눌러 확인하세요.</div>' +
  '</div>';
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '<div class="taxcalc-result-note">이 결과는 참고용 개산이며, 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderStockTransferResult(r){
  const box = document.getElementById('taxCalcStockTransferResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('양도차익', won(r.양도차익));
  if (r.손익통산_적용후_소득금액 !== r.양도차익) html += taxCalcResultRow('손익통산 적용후 소득금액', won(r.손익통산_적용후_소득금액));
  html += taxCalcResultRow('기본공제', won(r.기본공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('적용세율', r.적용세율_설명);
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.외국납부세액공제) html += taxCalcResultRow('외국납부세액공제', '-' + won(r.외국납부세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  html += '<div class="taxcalc-result-note">' + (r.안내 || '') + '</div>';
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
      '<div class="taxcalc-asset-head"><b>증여재산 · 관계</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-gift">🤖 증빙에서 자동 입력</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-gift"></div>' +
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
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제10호의3서식] 일감몰아주기 증여의제(§45의3) — 지배주주+친족이 지분을 가진 법인이 특수관계법인과 매출비중이 높고 지분율도 높을 때 과세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>수혜법인 기업규모</label><select id="jmCompanySize">' +
          '<option value="general">일반(중견·중소 아님)</option><option value="medium">중견기업</option><option value="small">중소기업</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>수혜법인 세후영업이익</label><input type="number" id="jmOperatingIncome" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>특수관계법인거래비율</label><input type="number" step="0.01" id="jmTradeRatio" placeholder="% (과세제외매출액 반영한 최종비율)"></div>' +
        '<div class="taxcalc-field"><label>지배주주+친족 주식보유비율(직접 또는 간접, 출자관계별로 따로 계산)</label><input type="number" step="0.01" id="jmShareRatio" placeholder="%"></div>' +
        '<div class="taxcalc-field"><label>배당소득공제</label><input type="number" id="jmDividendDeduction" placeholder="원 (신고기한 내 받은 배당소득 공제액, 없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="jmFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jmReportedInTime" checked><label for="jmReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jmFraudulent"><label for="jmFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="jmUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="jmUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-related-party-gift">일감몰아주기 증여세 계산하기</button>' +
      '<div id="taxCalcRelatedPartyGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제10호의4서식] 일감떼어주기 증여의제(§45의4) — 특수관계법인의 사업기회를 지분 30% 이상 보유한 법인에 제공했을 때 과세. 개시사업연도에 잠정신고 후 2년 경과 시 정산사업연도로 반드시 재계산</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 단계</label><select id="jtPhase">' +
          '<option value="initial">개시사업연도(잠정)</option><option value="settlement">정산사업연도(2년 경과, 확정)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>사업기회로 인한 수혜법인 이익</label><input type="number" id="jtProfit" placeholder="원 (개시: 해당연도분 / 정산: 누적 합계)"></div>' +
        '<div class="taxcalc-field"><label>지배주주+친족 주식보유비율</label><input type="number" step="0.01" id="jtShareRatio" placeholder="% (30% 이상이어야 과세)"></div>' +
        '<div class="taxcalc-field"><label>법인세 납부세액 중 상당액</label><input type="number" id="jtCorporateTax" placeholder="원 (개시: 해당연도분 / 정산: 누적 합계)"></div>' +
        '<div class="taxcalc-field"><label>(개시사업연도만) 개시사업연도 월수</label><input type="number" id="jtMonths" placeholder="보통 12"></div>' +
        '<div class="taxcalc-field"><label>(정산사업연도만) 배당소득공제액</label><input type="number" id="jtDividendDeduction" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="jtFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jtReportedInTime" checked><label for="jtReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jtFraudulent"><label for="jtFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="jtUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수</label><input type="number" id="jtUnpaidDays" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-business-opportunity-gift">일감떼어주기 증여세 계산하기</button>' +
      '<div id="taxCalcBusinessOpportunityGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제11호서식] 연부연납(다년 분할납부) 계산 — 신고 후 매년 나눠 낼 회차별 세액을 계산합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="ipGiftTaxType"><option value="gift" selected>증여세</option><option value="inheritance">상속세</option></select></div>' +
        '<div class="taxcalc-field"><label>총 납부세액</label><input type="number" id="ipGiftTotal" placeholder="원 (2천만원 초과해야 신청 가능)"></div>' +
        '<div class="taxcalc-field"><label>최초 납부세액(신고기한까지 먼저 납부)</label><input type="number" id="ipGiftInitial" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>연부연납기간</label><input type="number" id="ipGiftYears" placeholder="년 (증여세 일반5/특례15, 상속세 일반10/가업20)"></div>' +
        '<div class="taxcalc-field"><label>연부연납 가산금 연이자율</label><input type="number" step="0.01" id="ipGiftRate" placeholder="% (신고 시점 기준 확인 필요)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-installment-gift">연부연납 계산하기</button>' +
      '<div id="taxCalcInstallmentGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>사후관리 위반 추징 이자상당액 계산 — 영농자녀 증여농지 감면·창업자금 특례·가업승계 주식등 특례 등 사후관리 위반으로 추징될 때 공통으로 씁니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>추징세액(당초 감면·특례로 줄었던 세액)</label><input type="number" id="ckAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>2022.2.14. 이전 일수</label><input type="number" id="ckDaysBefore" placeholder="일 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>2022.2.14. 이후 일수</label><input type="number" id="ckDaysAfter" placeholder="일 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-clawback-interest">이자상당액 계산하기</button>' +
      '<div id="taxCalcClawbackResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>저가양수·고가양도에 따른 이익의 증여의제(§35) — 특수관계인 간 시가보다 낮게(높게) 거래했을 때 증여재산가액을 계산합니다. 계산된 금액은 위 일반 증여세 계산기의 증여재산가액에 넣어 세액까지 계산하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>시가</label><input type="number" id="lpFairValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>실제 거래대가</label><input type="number" id="lpTransferPrice" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-low-price-transfer">증여재산가액 계산하기</button>' +
      '<div id="taxCalcLowPriceResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>금전 무상대출 등에 따른 이익의 증여의제(§41의4) — 특수관계인 간 무이자·저리로 돈을 빌려줬을 때 증여재산가액을 계산합니다. 계산된 금액은 위 일반 증여세 계산기의 증여재산가액에 넣어 세액까지 계산하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>대여원금</label><input type="number" id="loanPrincipal" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>실제 지급(약정)이자</label><input type="number" id="loanActualInterest" placeholder="원 (무이자면 0)"></div>' +
        '<div class="taxcalc-field"><label>적정이자율</label><input type="number" step="0.1" id="loanRate" placeholder="% (기본 4.6, 시점에 따라 확인 필요)"></div>' +
        '<div class="taxcalc-field"><label>대출기간</label><input type="number" id="loanMonths" placeholder="개월 (기본 12)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-interest-free-loan">증여재산가액 계산하기</button>' +
      '<div id="taxCalcLoanResult"></div>' +
    '</div>';
  renderValuationAssetList('giftValuationList', giftValuationAssets);
}

// [별지 제10호서식] 증여세과세표준신고 스타일로 단계별 수식+실제금액 텍스트를 만든다(계산근거 표시용, UI 전용 — 새 계산 로직 없이 결과값만 다시 서술).
function buildGiftCalcBasisLines(r){
  const lines = [];
  lines.push('증여재산가액 = ' + won(r.증여재산가액));
  if (r.인수채무액) lines.push('인수채무액(부담부증여) = -' + won(r.인수채무액));
  if (r.비과세재산가액) lines.push('비과세재산가액(§46) = -' + won(r.비과세재산가액));
  if (r.공익법인출연재산가액) lines.push('공익법인출연재산가액(§48) = -' + won(r.공익법인출연재산가액));
  if (r.공익신탁재산가액) lines.push('공익신탁재산가액(§52) = -' + won(r.공익신탁재산가액));
  if (r.장애인신탁재산가액) lines.push('장애인신탁재산가액(§52의2) = -' + won(r.장애인신탁재산가액));
  lines.push('순수증여재산가액 = ' + won(r.순수증여재산가액));
  lines.push('증여재산공제(§53) = -' + won(r.증여재산공제));
  if (r.혼인출산증여재산공제) lines.push('혼인·출산 증여재산공제(§53의2) = -' + won(r.혼인출산증여재산공제));
  if (r.합산배제증여재산공제) lines.push('합산배제증여재산공제 = -' + won(r.합산배제증여재산공제));
  if (r.감정평가수수료공제) lines.push('감정평가수수료공제 = -' + won(r.감정평가수수료공제));
  if (r.재해손실공제) lines.push('재해손실공제 = -' + won(r.재해손실공제));
  lines.push('과세표준 = 순수증여재산가액 - 공제 합계 = ' + won(r.과세표준));
  lines.push('산출세액(할증 전, 누진세율) = ' + won(r.산출세액_할증전));
  if (r.세대생략할증액) lines.push('세대생략할증액(§57) = +' + won(r.세대생략할증액));
  lines.push('산출세액(할증 후) = ' + won(r.산출세액_할증후));
  if (r.기납부세액공제) lines.push('기납부세액공제(10년내 동일인 기증여분) = -' + won(r.기납부세액공제));
  if (r.외국납부세액공제) lines.push('외국납부세액공제(§59) = -' + won(r.외국납부세액공제));
  if (r.그밖의공제감면세액) lines.push('그 밖의 공제·감면세액 = -' + won(r.그밖의공제감면세액));
  lines.push('신고세액공제(3%) = -' + won(r.신고세액공제));
  if (r.이자상당액) lines.push('이자상당액 = +' + won(r.이자상당액));
  if (r.공익법인등관련가산세) lines.push('공익법인등 관련 가산세(§78) = +' + won(r.공익법인등관련가산세));
  if (r.무신고가산세) lines.push('무신고가산세 = +' + won(r.무신고가산세));
  if (r.과소신고가산세) lines.push('과소신고가산세 = +' + won(r.과소신고가산세));
  if (r.납부지연가산세) lines.push('납부지연가산세 = +' + won(r.납부지연가산세));
  if (r.박물관자료등징수유예세액) lines.push('박물관자료등 징수유예세액 = -' + won(r.박물관자료등징수유예세액));
  if (r.가업승계납부유예세액) lines.push('가업승계 납부유예세액(조특법§30의6) = -' + won(r.가업승계납부유예세액));
  if (r.영농자녀증여농지세액감면) lines.push('영농자녀 증여농지 세액감면(조특법§71) = -' + won(r.영농자녀증여농지세액감면));
  lines.push('납부세액 = ' + won(r.납부세액));
  return lines;
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
  html += '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-gift-calc-basis" style="margin-top:8px;">🧮 계산근거 보기</button>';
  html += '<div class="taxcalc-calcbasis" id="giftCalcBasis" style="display:none;">' +
    '<div class="taxcalc-calcbasis-title">계산근거([별지 제10호서식] 증여세과세표준신고 기준)</div>' +
    buildGiftCalcBasisLines(r).map(function(l){ return '<div class="taxcalc-calcbasis-line">' + l + '</div>'; }).join('') +
  '</div>';
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

function renderRelatedPartyGiftResult(r){
  const box = document.getElementById('taxCalcRelatedPartyGiftResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (!r.과세대상여부) {
    html += '<div class="taxcalc-result-note">' + r.안내 + '</div></div>';
    box.innerHTML = html;
    return;
  }
  if (r.배당소득공제) html += taxCalcResultRow('배당소득공제', '-' + won(r.배당소득공제));
  html += taxCalcResultRow('증여의제이익', won(r.증여의제이익));
  html += taxCalcResultRow('과세표준(증여재산공제 없음)', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  html += taxCalcResultRow('신고세액공제(3%)', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  html += '<div class="taxcalc-result-note">특수관계법인거래비율·주식보유비율은 과세제외매출액을 반영해 이미 계산된 최종 비율을 넣어야 합니다. 지배주주 판정, 다수 특수관계법인이 있는 경우의 증여자별 안분은 별도로 확인하세요. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderBusinessOpportunityGiftResult(r){
  const box = document.getElementById('taxCalcBusinessOpportunityGiftResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (!r.과세대상여부) {
    html += '<div class="taxcalc-result-note">' + r.안내 + '</div></div>';
    box.innerHTML = html;
    return;
  }
  html += taxCalcResultRow('증여의제이익', won(r.증여의제이익));
  html += taxCalcResultRow('과세표준(증여재산공제 없음)', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  html += taxCalcResultRow('신고세액공제(3%)', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  html += '<div class="taxcalc-result-note">' + (r.안내 || '') + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderInstallmentResult(r, boxId){
  const box = document.getElementById(boxId);
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('연부연납대상금액', won(r.연부연납대상금액));
  html += '<div class="taxcalc-result-note" style="margin:6px 0;"><table style="width:100%; border-collapse:collapse; font-size:0.9em;">' +
    '<tr><th style="text-align:left;">회차</th><th style="text-align:right;">원금</th><th style="text-align:right;">가산금</th><th style="text-align:right;">납부예정세액</th></tr>' +
    r.회차별_납부예정세액.map(function(row){
      return '<tr><td>' + row.회차 + '</td><td style="text-align:right;">' + won(row.원금) + '</td><td style="text-align:right;">' + won(row.가산금) + '</td><td style="text-align:right;">' + won(row.납부예정세액) + '</td></tr>';
    }).join('') +
  '</table></div>';
  html += taxCalcResultRow('가산금 합계', won(r.가산금_합계));
  html += taxCalcResultRow('총 납부액(최초납부 포함)', won(r.총납부액_최초포함), { total: true });
  if (r.각회분_1천만원미만_경고) html += '<div class="taxcalc-result-note">⚠ 회당 원금이 1천만원 미만입니다 — 연부연납기간을 줄이거나 신청 요건을 재확인하세요.</div>';
  html += '<div class="taxcalc-result-note">가산금은 잔여 미납액에 연이자율을 적용하는 근사 모델로, 거치기간(가업상속재산 비율 50%이상시 5년까지, 미만시 3년까지)은 반영하지 않습니다. 연부연납기간 한도(증여세 일반5년/특례15년, 상속세 일반10년/가업상속 50%미만10년·50%이상20년)와 정확한 이자율·거치기간 적용은 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderClawbackResult(r){
  const box = document.getElementById('taxCalcClawbackResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('추징세액', won(r.추징세액));
  if (r['2022.2.14.이전_이자상당액']) html += taxCalcResultRow('2022.2.14. 이전 이자상당액', won(r['2022.2.14.이전_이자상당액']));
  if (r['2022.2.14.이후_이자상당액']) html += taxCalcResultRow('2022.2.14. 이후 이자상당액', won(r['2022.2.14.이후_이자상당액']));
  html += taxCalcResultRow('이자상당액 합계', won(r.이자상당액_합계));
  html += taxCalcResultRow('납부할 세액', won(r.납부할세액), { total: true });
  html += '<div class="taxcalc-result-note">일수는 당초 감면·특례 적용받은 신고기한 다음 날부터 추징사유가 발생한 날까지의 기간입니다. 이자율은 향후 시행령 개정으로 바뀔 수 있으니 신고 시점 기준으로 재확인하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderLowPriceResult(r){
  const box = document.getElementById('taxCalcLowPriceResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('거래유형', r.거래유형);
  html += taxCalcResultRow('시가와 대가의 차액', won(r.시가와대가의차액));
  html += taxCalcResultRow('차감기준액', won(r.차감기준액));
  html += taxCalcResultRow('증여재산가액', won(r.증여재산가액), { total: true });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderLoanGiftResult(r){
  const box = document.getElementById('taxCalcLoanResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적정이자상당액', won(r.적정이자상당액));
  if (r.실제지급이자) html += taxCalcResultRow('실제 지급이자', '-' + won(r.실제지급이자));
  html += taxCalcResultRow('증여재산가액', won(r.증여재산가액), { total: true });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
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
      '<div class="taxcalc-asset-head"><b>과세가액 · 인적공제</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-inheritance">🤖 증빙에서 자동 입력</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-inheritance"></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>상속세과세가액</label><input type="number" id="ihEstate" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>비과세재산가액(§12)</label><input type="number" id="ihNonTaxable" placeholder="원 (국가등 유증·금양임야 등, 없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익법인출연재산가액(§16)</label><input type="number" id="ihPublicOrg" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익신탁재산가액(§17)</label><input type="number" id="ihPublicTrust" placeholder="원 (없으면 비움)"></div>' +
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
        '<div class="taxcalc-field"><label>총 상속재산가액(가업상속납부유예 참고계산용)</label><input type="number" id="ihTotalGrossEstate" placeholder="원 (§72의2 납부유예 가능세액을 참고로 보려면 입력)"></div>' +
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
    '<div id="taxCalcInheritanceResult"></div>' +
    '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-heir-tool" style="margin-bottom:10px;">👪 상속인별 세액 안분(상증세법§3조의2②)</button>' +
    '<div id="taxCalcHeirTool"></div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제11호서식] 연부연납(다년 분할납부) 계산 — 신고 후 매년 나눠 낼 회차별 세액을 계산합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="ipIhTaxType"><option value="inheritance" selected>상속세</option><option value="gift">증여세</option></select></div>' +
        '<div class="taxcalc-field"><label>총 납부세액</label><input type="number" id="ipIhTotal" placeholder="원 (2천만원 초과해야 신청 가능)"></div>' +
        '<div class="taxcalc-field"><label>최초 납부세액(신고기한까지 먼저 납부)</label><input type="number" id="ipIhInitial" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>연부연납기간</label><input type="number" id="ipIhYears" placeholder="년 (상속세 일반10/가업20, 증여세 일반5/특례15)"></div>' +
        '<div class="taxcalc-field"><label>연부연납 가산금 연이자율</label><input type="number" step="0.01" id="ipIhRate" placeholder="% (신고 시점 기준 확인 필요)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-installment-inheritance">연부연납 계산하기</button>' +
      '<div id="taxCalcInstallmentInheritanceResult"></div>' +
    '</div>';
  renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
  renderHeirTool();
}

let lastInheritanceResult = null;
let inheritanceHeirs = [{}, {}];
let inheritanceHeirToolShown = false;

// [별지 제9호서식] 상속세과세표준신고 스타일로 단계별 수식+실제금액 텍스트를 만든다(계산근거 표시용, UI 전용).
function buildInheritanceCalcBasisLines(r){
  const lines = [];
  lines.push('상속세과세가액(입력값) = ' + won(r.상속세과세가액_입력값));
  if (r.비과세재산가액) lines.push('비과세되는 상속재산가액(§12) = -' + won(r.비과세재산가액));
  if (r.공익법인출연재산가액) lines.push('공익법인출연재산가액(§16) = -' + won(r.공익법인출연재산가액));
  if (r.공익신탁재산가액) lines.push('공익신탁재산가액(§17) = -' + won(r.공익신탁재산가액));
  if (r.상속개시전처분재산_추정합계) lines.push('상속개시전 처분재산 등 산입액(§15) = +' + won(r.상속개시전처분재산_추정합계));
  lines.push('적용된 상속세과세가액 = ' + won(r.상속세과세가액_적용값));
  lines.push('기초공제+인적공제(' + won(r.인적공제) + ') vs 일괄공제(5억) 중 큰 값 = -' + won(r['기초인적공제_또는_일괄공제']));
  if (r.배우자공제) lines.push('배우자상속공제(§19) = -' + won(r.배우자공제));
  if (r.금융재산상속공제) lines.push('금융재산상속공제(§22) = -' + won(r.금융재산상속공제));
  if (r.동거주택상속공제) lines.push('동거주택상속공제(§23의2) = -' + won(r.동거주택상속공제));
  if (r.감정평가수수료공제) lines.push('감정평가수수료공제(§25) = -' + won(r.감정평가수수료공제));
  if (r.재해손실공제) lines.push('재해손실공제(§23) = -' + won(r.재해손실공제));
  if (r.가업상속공제) lines.push('가업상속공제(§18의2) = -' + won(r.가업상속공제));
  if (r.영농상속공제) lines.push('영농상속공제(§18의3) = -' + won(r.영농상속공제));
  lines.push('상속공제 합계' + (r.상속공제종합한도_적용여부 ? '(§24 종합한도 적용됨)' : '') + ' = -' + won(r.상속공제_합계));
  lines.push('과세표준 = 적용된 상속세과세가액 - 상속공제 합계 = ' + won(r.과세표준));
  lines.push('산출세액(누진세율) = ' + won(r.산출세액 - (r.세대생략가산액 || 0)));
  if (r.세대생략가산액) lines.push('세대생략가산액(§27) = +' + won(r.세대생략가산액));
  lines.push('산출세액 합계 = ' + won(r.산출세액));
  if (r.기납부증여세액공제) lines.push('기납부증여세액공제(§28) = -' + won(r.기납부증여세액공제));
  if (r.특례증여세액공제) lines.push('특례증여세액공제(조특법§30의5·6) = -' + won(r.특례증여세액공제));
  if (r.외국납부세액공제) lines.push('외국납부세액공제(§29) = -' + won(r.외국납부세액공제));
  if (r.단기재상속세액공제) lines.push('단기재상속세액공제(§30) = -' + won(r.단기재상속세액공제));
  if (r.그밖의공제) lines.push('그 밖의 공제 = -' + won(r.그밖의공제));
  lines.push('신고세액공제(3%) = -' + won(r.신고세액공제));
  if (r.이자상당액) lines.push('이자상당액 = +' + won(r.이자상당액));
  if (r.영리법인면제분납부세액) lines.push('영리법인면제분 상속인 납부세액(§3의2) = +' + won(r.영리법인면제분납부세액));
  if (r.무신고가산세) lines.push('무신고가산세 = +' + won(r.무신고가산세));
  if (r.과소신고가산세) lines.push('과소신고가산세 = +' + won(r.과소신고가산세));
  if (r.납부지연가산세) lines.push('납부지연가산세 = +' + won(r.납부지연가산세));
  if (r.문화재등징수유예세액) lines.push('문화재등 징수유예세액 = -' + won(r.문화재등징수유예세액));
  if (r.가업상속납부유예세액) lines.push('가업상속 납부유예세액(§72의2) = -' + won(r.가업상속납부유예세액));
  lines.push('납부세액 = ' + won(r.납부세액));
  return lines;
}

function renderInheritanceResult(r){
  const box = document.getElementById('taxCalcInheritanceResult');
  lastInheritanceResult = r.error ? null : r;
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; renderHeirTool(); return; }
  let html = '<div class="taxcalc-result">';
  if (r.비과세재산가액) html += taxCalcResultRow('비과세재산가액', '-' + won(r.비과세재산가액));
  if (r.공익법인출연재산가액) html += taxCalcResultRow('공익법인출연재산가액', '-' + won(r.공익법인출연재산가액));
  if (r.공익신탁재산가액) html += taxCalcResultRow('공익신탁재산가액', '-' + won(r.공익신탁재산가액));
  if (r.상속개시전처분재산_추정합계 || r.비과세재산가액 || r.공익법인출연재산가액 || r.공익신탁재산가액) {
    html += taxCalcResultRow('상속세과세가액(입력값)', won(r.상속세과세가액_입력값));
    if (r.상속개시전처분재산_추정합계) html += taxCalcResultRow('상속개시전 처분재산 추정 가산액(§15)', '+' + won(r.상속개시전처분재산_추정합계));
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
  if (r.가업상속납부유예_가능세액 != null) html += '<div class="taxcalc-result-note">참고: §72의2에 따라 가업상속 납부유예를 신청할 경우 최대 ' + won(r.가업상속납부유예_가능세액) + '까지 유예 가능합니다(가업상속공제와 별개로 선택 가능 — 실제 유예받으려면 위 "가업상속 납부유예세액" 입력란에 이 금액을 넣고 다시 계산하세요).</div>';
  html += '<div class="taxcalc-result-note">배우자가 단독상속인이면 일괄공제(5억)를 선택할 수 없고 기초공제+인적공제만 적용됩니다 — 해당되면 이 결과를 그대로 쓰지 마세요. 가업상속공제·영농상속공제·특례증여세액공제·영리법인 면제세액은 자격요건 판정과 세액 자체를 이 계산기가 산출하지 않으므로 별도로 계산한 값을 직접 입력해야 합니다. 납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있습니다. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-inheritance-calc-basis" style="margin-top:8px;">🧮 계산근거 보기</button>';
  html += '<div class="taxcalc-calcbasis" id="inheritanceCalcBasis" style="display:none;">' +
    '<div class="taxcalc-calcbasis-title">계산근거([별지 제9호서식] 상속세과세표준신고 기준)</div>' +
    buildInheritanceCalcBasisLines(r).map(function(l){ return '<div class="taxcalc-calcbasis-line">' + l + '</div>'; }).join('') +
  '</div>';
  html += '</div>';
  box.innerHTML = html;
  renderHeirTool();
}

function renderHeirTool(){
  const box = document.getElementById('taxCalcHeirTool');
  if (!box) return;
  if (!inheritanceHeirToolShown){ box.innerHTML = ''; return; }
  if (!lastInheritanceResult){
    box.innerHTML = '<div class="taxcalc-result-note" style="margin-top:10px;">먼저 위에서 전체 상속세를 계산하세요.</div>';
    return;
  }
  const rowsHtml = inheritanceHeirs.map(function(h, idx){
    return '<div class="taxcalc-grid" data-heir-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>성명</label><input type="text" data-hfield="name" value="' + (h.name || '').replace(/"/g,'&quot;') + '"></div>' +
      '<div class="taxcalc-field"><label>관계</label><input type="text" data-hfield="relation" value="' + (h.relation || '').replace(/"/g,'&quot;') + '" placeholder="예: 자, 배우자, 대습상속/손"></div>' +
      '<div class="taxcalc-field"><label>실제상속재산가액</label><input type="number" data-hfield="actualInheritedValue" value="' + (h.actualInheritedValue || '') + '" placeholder="원 (채무부담분은 차감한 순액)"></div>' +
      (inheritanceHeirs.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-heir-row" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  box.innerHTML =
    '<div class="taxcalc-asset" style="margin-top:10px;">' +
      '<div class="taxcalc-asset-head"><b>상속인별 세액 안분 — 전체 산출세액·세액공제·가산세를 각자 실제상속재산가액 비율로 나눕니다(유산세 방식)</b></div>' +
      '<div id="heirRows">' + rowsHtml + '</div>' +
      '<button type="button" class="taxcalc-add-asset" data-action="add-heir-row" style="margin-top:8px;">+ 상속인 추가</button>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-heir-allocation">상속인별 세액 안분 계산하기</button>' +
      '<div id="taxCalcHeirResult"></div>' +
    '</div>';

  box.querySelectorAll('[data-hfield]').forEach(function(el){
    el.addEventListener('input', function(){
      const idx = Number(el.closest('[data-heir-idx]').dataset.heirIdx);
      inheritanceHeirs[idx][el.dataset.hfield] = el.value;
    });
  });
}

function renderHeirResult(r){
  const box = document.getElementById('taxCalcHeirResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result" style="margin-top:10px;">';
  r.상속인별_내역.forEach(function(row){
    html += '<div class="taxcalc-result-row total"><span>' + row.성명 + (row.관계 ? ' (' + row.관계 + ')' : '') + '</span><span class="v"></span></div>';
    html += taxCalcResultRow('실제상속재산가액 / 지분율', won(row.실제상속재산가액) + ' / ' + (row.지분율 * 100).toFixed(2) + '%');
    html += taxCalcResultRow('상속세과세가액(안분)', won(row.상속세과세가액));
    html += taxCalcResultRow('과세표준(안분)', won(row.과세표준));
    html += taxCalcResultRow('산출세액 합계(안분)', won(row.산출세액_합계));
    if (row.세액공제_합계) html += taxCalcResultRow('세액공제 합계(안분)', '-' + won(row.세액공제_합계));
    if (row.영리법인면제분납부세액) html += taxCalcResultRow('영리법인면제분납부세액(안분)', '+' + won(row.영리법인면제분납부세액));
    if (row.가산세_합계) html += taxCalcResultRow('가산세 합계(안분)', '+' + won(row.가산세_합계));
    html += taxCalcResultRow('납부세액(안분)', won(row.납부세액), { total: true });
  });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
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
  updateTaxCalcPaneVisibility();
}

// 현재 탭(양도/증여/상속)에 맞는 화면만 보이게 한다. 간편·정밀은 같은 화면을 공유하므로
// tier는 taxCalcView에 클래스만 하나 토글해서, 증빙업로드·AI자동입력 관련 UI만 CSS로 숨긴다
// (index.html의 .taxcalc-view-tier-simple .taxcalc-ai-btn 등 규칙).
function updateTaxCalcPaneVisibility(){
  const which = document.querySelector('.taxcalc-tab.active').dataset.tab;
  taxCalcTransferPane.style.display = which === 'transfer' ? 'block' : 'none';
  taxCalcGiftPane.style.display = which === 'gift' ? 'block' : 'none';
  taxCalcInheritancePane.style.display = which === 'inheritance' ? 'block' : 'none';
  taxCalcView.classList.toggle('taxcalc-view-tier-simple', taxCalcTier === 'simple');
}

function closeTaxCalcView(){
  if (isCalcStandaloneMode){ window.close(); return; }
  hideAllPanelViews();
  explorerView.style.display = 'flex';
  explorerPanelHead.style.display = 'flex';
  navigateTo(explorerPath);
}

// ============================================================
// 세액계산기 새 창(고객모드) — 세액계산은 넥스의 부속 서브화면이 아니라 그 자체로 독립된 도구라,
// 채팅·탐색기 안에 딸린 화면이 아니라 자기 창을 갖는다. 같은 index.html을 재사용하되
// ?calcMode=1로 열리면 그 창 안에서는 계산기만 전체화면으로 뜨고 나머지 내부 도구는 다 숨긴다.
// ============================================================
let isCalcStandaloneMode = false;

document.getElementById('btnOpenTaxCalc').addEventListener('click', function(){
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('calcMode', '1');
  if (explorerPath[0]) url.searchParams.set('customer', explorerPath[0]);
  if (explorerPath[1]) url.searchParams.set('case', explorerPath[1]);
  window.open(url.toString(), '_blank');
});
document.getElementById('btnTaxCalcBack').addEventListener('click', closeTaxCalcView);

window.addEventListener('load', function(){
  const params = new URLSearchParams(location.search);
  if (params.get('calcMode') !== '1') return;
  isCalcStandaloneMode = true;
  document.body.classList.add('calc-standalone-mode');

  function boot(){
    const customer = params.get('customer');
    const caseName = params.get('case');
    const path = [];
    if (customer) path.push(customer);
    if (caseName) path.push(caseName);
    const afterPath = function(){
      // 채팅 패널을 감추고 탐색작업창(계산기가 그 안의 뷰)을 100%로 — localStorage에는 남기지 않는다
      // (이 새 창만의 표시 방식일 뿐, 사용자의 평소 작업창 배치 설정을 덮어쓰면 안 되므로).
      applyWorkspaceMode('max');
      openTaxCalcView();
      const filenameEl = document.querySelector('#taxCalcView .editor-filename');
      if (filenameEl && path.length) filenameEl.textContent = '세액계산기 · ' + path.join(' / ');
    };
    if (path.length) navigateTo(path).then(afterPath).catch(afterPath);
    else afterPath();
  }

  if (window.__nxCustomersLoaded && typeof window.__nxCustomersLoaded.then === 'function'){
    window.__nxCustomersLoaded.then(boot).catch(boot);
  } else {
    boot();
  }
});

document.querySelectorAll('.taxcalc-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('.taxcalc-tab').forEach(function(t){ t.classList.remove('active'); });
    tab.classList.add('active');
    updateTaxCalcPaneVisibility();
  });
});

document.querySelectorAll('#taxCalcTierTabs [data-tier]').forEach(function(tab){
  tab.addEventListener('click', function(){
    document.querySelectorAll('#taxCalcTierTabs [data-tier]').forEach(function(t){ t.classList.remove('tier-on'); });
    tab.classList.add('tier-on');
    taxCalcTier = tab.dataset.tier;
    updateTaxCalcPaneVisibility();
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
  } else if (action === 'open-evidence-transfer'){
    const idx = Number(btn.dataset.idx);
    openEvidencePicker(function(fileName){ runAiAutoFillTransfer(fileName, idx); });
  } else if (action === 'open-evidence-gift'){
    openEvidencePicker(function(fileName){ runAiAutoFillGift(fileName); });
  } else if (action === 'open-evidence-inheritance'){
    openEvidencePicker(function(fileName){ runAiAutoFillInheritance(fileName); });
  } else if (action === 'show-calc-basis'){
    const idx = Number(btn.dataset.idx);
    const box = document.getElementById('calcBasis-' + idx);
    if (box.style.display !== 'none' && box.innerHTML) {
      box.style.display = 'none';
    } else {
      const single = calculateTransferTaxSingleJS(collectTransferInput(transferAssets[idx]));
      const lines = buildTransferCalcBasisLines(single);
      box.innerHTML = '<div class="taxcalc-calcbasis-title">계산근거(이 거래 단독 기준 — 다른 거래와의 합산 전)</div>' +
        lines.map(function(l){ return '<div class="taxcalc-calcbasis-line">' + l + '</div>'; }).join('');
      box.style.display = 'block';
    }
  } else if (action === 'show-agg-calc-basis'){
    const box = document.getElementById('calcBasisAgg');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  } else if (action === 'toggle-allocation-tool'){
    allocationShown = !allocationShown;
    renderAllocationTool();
  } else if (action === 'add-alloc-asset'){
    allocationAssets.push({});
    renderAllocationTool();
  } else if (action === 'del-alloc-asset'){
    allocationAssets.splice(Number(btn.dataset.idx), 1);
    renderAllocationTool();
  } else if (action === 'run-allocation'){
    const toolBox = document.getElementById('taxCalcAllocationTool');
    const method = document.getElementById('allocMethod').value;
    toolBox.dataset.method = method;
    toolBox.dataset.totalTransfer = document.getElementById('allocTotalTransfer').value;
    const input = {
      method: method,
      totalTransferPrice: Number(document.getElementById('allocTotalTransfer').value) || 0,
      assets: allocationAssets.map(function(a){
        return {
          label: a.label, area: Number(a.area) || 0,
          standardPriceTransfer: Number(a.standardPriceTransfer) || 0,
          standardPriceAcquisition: Number(a.standardPriceAcquisition) || 0,
          isBuilding: !!a.isBuilding
        };
      })
    };
    if (method === 'acq_expense_together' || method === 'acq_expense_separate') {
      toolBox.dataset.totalAcq = document.getElementById('allocTotalAcq').value;
      toolBox.dataset.totalExpense = document.getElementById('allocTotalExpense').value;
      input.totalAcquisitionPrice = Number(document.getElementById('allocTotalAcq').value) || 0;
      input.totalNecessaryExpenses = Number(document.getElementById('allocTotalExpense').value) || 0;
    }
    const result = calculateProportionalAllocationJS(input);
    renderAllocationResult(result);
  } else if (action === 'apply-allocation-to-new-asset'){
    const resultBox = document.getElementById('taxCalcAllocationResult');
    const lastResult = JSON.parse(resultBox.dataset.lastResult || '{}');
    const row = lastResult.자산별_안분결과 && lastResult.자산별_안분결과[Number(btn.dataset.ridx)];
    if (!row) return;
    const newAsset = {
      transferPrice: row.양도가액_부가세제외 !== undefined ? row.양도가액_부가세제외 : row.양도가액_안분액
    };
    if (row.취득가액_안분액 !== undefined) newAsset.acquisitionPrice = row.취득가액_안분액;
    if (row.필요경비_안분액 !== undefined) newAsset.necessaryExpenses = row.필요경비_안분액;
    transferAssets.push(newAsset);
    allocationShown = true;
    renderTransferPane();
  } else if (action === 'toggle-building-price-tool'){
    buildingPriceShown = !buildingPriceShown;
    renderBuildingPriceTool();
  } else if (action === 'add-building-row'){
    buildingPriceRows.push({});
    renderBuildingPriceTool();
  } else if (action === 'del-building-row'){
    buildingPriceRows.splice(Number(btn.dataset.idx), 1);
    renderBuildingPriceTool();
  } else if (action === 'run-building-price'){
    const toolBox = document.getElementById('taxCalcBuildingPriceTool');
    const taxType = document.getElementById('bpTaxType').value;
    toolBox.dataset.taxType = taxType;
    toolBox.dataset.landPrice = document.getElementById('bpLandPrice').value;
    const rows = buildingPriceRows.map(function(r){
      return {
        label: r.label, structureName: r.structureName,
        useNo: Number(r.useNo) || 0, builtYear: Number(r.builtYear) || 0,
        floorAreaSqm: Number(r.floorAreaSqm) || 0
      };
    });
    const result = calculateBuildingStandardPriceMultiJS(rows, Number(document.getElementById('bpLandPrice').value) || 0, taxType);
    renderBuildingPriceResult(result);
  } else if (action === 'apply-building-price-to-new-asset'){
    const resultBox = document.getElementById('taxCalcBuildingPriceResult');
    const total = Number(resultBox.dataset.lastTotal) || 0;
    if (!total) return;
    transferAssets.push({ acquisitionPrice: total });
    buildingPriceShown = true;
    renderTransferPane();
  } else if (action === 'run-transfer'){
    const inputs = transferAssets.map(collectTransferInput);
    const filingParams = {
      filingStatus: document.getElementById('trFilingStatus').value,
      isFraudulent: document.getElementById('trFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('trUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('trUnpaidDays').value) || 0,
      isSelfElectronicFiling: document.getElementById('trSelfEfiling').checked
    };
    const result = calculateTransferTaxMultiJS(inputs, filingParams);
    renderTransferResult(result);
  } else if (action === 'run-stock-transfer'){
    const input = {
      assetCategory: document.getElementById('stAssetCategory').value,
      transferPrice: Number(document.getElementById('stTransferPrice').value) || 0,
      acquisitionPrice: Number(document.getElementById('stAcquisitionPrice').value) || 0,
      transferExpenses: Number(document.getElementById('stTransferExpenses').value) || 0,
      isDaejuju: document.getElementById('stIsDaejuju').checked,
      holdingMonths: document.getElementById('stHoldingMonths').value === '' ? null : Number(document.getElementById('stHoldingMonths').value),
      isSmallMediumCompany: document.getElementById('stIsSmallMedium').checked,
      priorNetGainOrLoss: Number(document.getElementById('stPriorNetGain').value) || 0,
      basicDeductionAlreadyUsed: Number(document.getElementById('stBasicDeductionUsed').value) || 0,
      foreignTaxPaidAmount: Number(document.getElementById('stForeignTax').value) || 0,
      filingStatus: document.getElementById('stFilingStatus').value,
      isFraudulent: document.getElementById('stFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('stUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('stUnpaidDays').value) || 0
    };
    renderStockTransferResult(calculateStockTransferTaxJS(input));
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
  } else if (action === 'run-related-party-gift'){
    const input = {
      companySize: document.getElementById('jmCompanySize').value,
      afterTaxOperatingIncome: Number(document.getElementById('jmOperatingIncome').value) || 0,
      relatedPartyTransactionRatio: Number(document.getElementById('jmTradeRatio').value) || 0,
      shareholderOwnershipRatio: Number(document.getElementById('jmShareRatio').value) || 0,
      dividendDeduction: Number(document.getElementById('jmDividendDeduction').value) || 0,
      filingStatus: document.getElementById('jmFilingStatus').value,
      isFraudulent: document.getElementById('jmFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('jmUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('jmUnpaidDays').value) || 0,
      reportedInTime: document.getElementById('jmReportedInTime').checked
    };
    renderRelatedPartyGiftResult(calculateRelatedPartyTransactionGiftTaxJS(input));
  } else if (action === 'run-business-opportunity-gift'){
    const input = {
      phase: document.getElementById('jtPhase').value,
      profitFromOpportunity: Number(document.getElementById('jtProfit').value) || 0,
      shareholderOwnershipRatio: Number(document.getElementById('jtShareRatio').value) || 0,
      corporateTaxPortion: Number(document.getElementById('jtCorporateTax').value) || 0,
      monthsInInitialYear: Number(document.getElementById('jtMonths').value) || 0,
      dividendDeduction: Number(document.getElementById('jtDividendDeduction').value) || 0,
      filingStatus: document.getElementById('jtFilingStatus').value,
      isFraudulent: document.getElementById('jtFraudulent').checked,
      underreportedTaxAmount: Number(document.getElementById('jtUnderreportedTax').value) || 0,
      unpaidDays: Number(document.getElementById('jtUnpaidDays').value) || 0,
      reportedInTime: document.getElementById('jtReportedInTime').checked
    };
    renderBusinessOpportunityGiftResult(calculateBusinessOpportunityGiftTaxJS(input));
  } else if (action === 'run-installment-gift'){
    const input = {
      taxType: document.getElementById('ipGiftTaxType').value,
      totalTaxAmount: Number(document.getElementById('ipGiftTotal').value) || 0,
      initialPaymentAmount: Number(document.getElementById('ipGiftInitial').value) || 0,
      installmentPeriodYears: Number(document.getElementById('ipGiftYears').value) || 0,
      annualInterestRatePercent: Number(document.getElementById('ipGiftRate').value)
    };
    renderInstallmentResult(calculateInstallmentPaymentScheduleJS(input), 'taxCalcInstallmentGiftResult');
  } else if (action === 'run-clawback-interest'){
    const input = {
      clawedBackTaxAmount: Number(document.getElementById('ckAmount').value) || 0,
      daysBefore20220214: Number(document.getElementById('ckDaysBefore').value) || 0,
      daysOnOrAfter20220214: Number(document.getElementById('ckDaysAfter').value) || 0
    };
    renderClawbackResult(calculateClawbackInterestJS(input));
  } else if (action === 'run-low-price-transfer'){
    const input = {
      fairMarketValue: Number(document.getElementById('lpFairValue').value) || 0,
      transferPrice: Number(document.getElementById('lpTransferPrice').value) || 0
    };
    renderLowPriceResult(calculateLowPriceTransferGiftAmountJS(input));
  } else if (action === 'run-interest-free-loan'){
    const input = {
      loanPrincipal: Number(document.getElementById('loanPrincipal').value) || 0,
      actualInterestPaid: Number(document.getElementById('loanActualInterest').value) || 0,
      appropriateInterestRatePercent: document.getElementById('loanRate').value === '' ? null : Number(document.getElementById('loanRate').value),
      loanMonths: document.getElementById('loanMonths').value === '' ? null : Number(document.getElementById('loanMonths').value)
    };
    renderLoanGiftResult(calculateInterestFreeLoanGiftAmountJS(input));
  } else if (action === 'run-installment-inheritance'){
    const input = {
      taxType: document.getElementById('ipIhTaxType').value,
      totalTaxAmount: Number(document.getElementById('ipIhTotal').value) || 0,
      initialPaymentAmount: Number(document.getElementById('ipIhInitial').value) || 0,
      installmentPeriodYears: Number(document.getElementById('ipIhYears').value) || 0,
      annualInterestRatePercent: Number(document.getElementById('ipIhRate').value)
    };
    renderInstallmentResult(calculateInstallmentPaymentScheduleJS(input), 'taxCalcInstallmentInheritanceResult');
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
      nonTaxableAmount: Number(document.getElementById('ihNonTaxable').value) || 0,
      publicInterestOrgAmount: Number(document.getElementById('ihPublicOrg').value) || 0,
      publicTrustAmount: Number(document.getElementById('ihPublicTrust').value) || 0,
      totalGrossEstateValue: Number(document.getElementById('ihTotalGrossEstate').value) || 0,
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
  } else if (action === 'toggle-gift-calc-basis'){
    const b = document.getElementById('giftCalcBasis');
    b.style.display = b.style.display === 'none' ? 'block' : 'none';
  } else if (action === 'toggle-inheritance-calc-basis'){
    const b = document.getElementById('inheritanceCalcBasis');
    b.style.display = b.style.display === 'none' ? 'block' : 'none';
  } else if (action === 'toggle-heir-tool'){
    inheritanceHeirToolShown = !inheritanceHeirToolShown;
    renderHeirTool();
  } else if (action === 'add-heir-row'){
    inheritanceHeirs.push({});
    renderHeirTool();
  } else if (action === 'del-heir-row'){
    inheritanceHeirs.splice(Number(btn.dataset.idx), 1);
    renderHeirTool();
  } else if (action === 'run-heir-allocation'){
    const heirs = inheritanceHeirs.map(function(h){
      return { name: h.name, relation: h.relation, actualInheritedValue: Number(h.actualInheritedValue) || 0 };
    });
    const result = allocateInheritanceTaxByHeirJS(lastInheritanceResult, heirs);
    renderHeirResult(result);
  }
});
