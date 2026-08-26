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

// 콤마가 찍힌 입력값("1,234,567")도 안전하게 숫자로 바꾼다. numVal(x)||0 자리를 전부 이걸로 바꿔서
// 쓰므로, 콤마가 없는 값(날짜 아닌 일반 숫자·비율)에도 똑같이 안전하게 동작해야 한다 — 그래서
// 내부에서 numVal(...)를 직접 쓰지 않고 parseFloat로 처리한다(무한 자기참조 방지 목적도 겸함).
function numVal(v){
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// §43②(1년 이내 동일거래 합산) 입력칸 하나(합계액)를 각 계산기가 요구하는 priorBenefitsWithinOneYear
// 배열로 변환한다. 비어있으면 빈 배열(합산 없음, 기존 동작과 동일).
function priorBenefitsArray_(elementId){
  const el = document.getElementById(elementId);
  const v = el ? numVal(el.value) : 0;
  return v > 0 ? [v] : [];
}

// 금액·숫자 입력칸에 입력 중 천단위 콤마를 자동으로 찍어준다. type="number"는 브라우저가 콤마를
// 아예 허용하지 않아서(입력 자체가 막힘) type="text"로 바꾸고 흉내낸다. 소수점(비율·이자율 필드)도
// 그대로 지원하므로 이 함수는 금액 필드뿐 아니라 정밀계산 화면의 모든 숫자 입력칸에 공통으로 쓴다.
function formatNumberInputValue_(raw){
  const cleaned = String(raw == null ? '' : raw).replace(/[^\d.]/g, '');
  if (cleaned === '') return '';
  const firstDot = cleaned.indexOf('.');
  const intPart = (firstDot === -1 ? cleaned : cleaned.slice(0, firstDot)).replace(/^0+(?=\d)/, '');
  const fracPart = firstDot === -1 ? '' : '.' + cleaned.slice(firstDot + 1).replace(/\./g, '');
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fracPart;
}
function enhanceNumberInputs(container){
  if (!container) return;
  container.querySelectorAll('input[type="number"]').forEach(function(el){
    el.type = 'text';
    el.setAttribute('inputmode', 'decimal');
    el.classList.add('taxcalc-money');
    if (el.value !== '') el.value = formatNumberInputValue_(el.value);
    if (el.dataset.commaEnhanced) return;
    el.dataset.commaEnhanced = '1';
    el.addEventListener('input', function(){
      const before = el.value;
      const caretFromEnd = before.length - (el.selectionStart == null ? before.length : el.selectionStart);
      const formatted = formatNumberInputValue_(before);
      el.value = formatted;
      const pos = Math.max(0, formatted.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 일부 브라우저·타입 조합에서 미지원이면 무시 */ }
    });
  });
}

// 법정신고기한 계산: "OO일이 속하는 달의 말일부터 N개월 이내"는 그 달 말일에서 N개월을 더한
// 달의 말일과 같다(원래 기준일 자체가 이미 그 달의 마지막 날이므로). new Date(y, m+1, 0)이
// (y,m)월의 말일이므로, 여기에 N개월을 더하려면 new Date(y, m+1+N, 0)을 쓰면 된다.
function taxCalcDeadlineFromMonthEnd_(dateStr, monthsAfter){
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth() + 1 + monthsAfter, 0);
}
// 실제납부일이 법정신고기한보다 늦은 날수(음수·미입력이면 0)를 계산한다.
function taxCalcDaysLate_(deadline, paidDateStr){
  if (!deadline || !paidDateStr) return 0;
  const paid = new Date(paidDateStr + 'T00:00:00');
  if (isNaN(paid.getTime())) return 0;
  const days = Math.round((paid.getTime() - deadline.getTime()) / 86400000);
  return days > 0 ? days : 0;
}
function setUnpaidDaysField_(fieldId, days){
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.value = String(days);
}
function recomputeTransferUnpaidDays(){
  let maxTransferDate = null;
  taxCalcTransferPane.querySelectorAll('[data-field="transferDate"]').forEach(function(el){
    if (el.value && (!maxTransferDate || el.value > maxTransferDate)) maxTransferDate = el.value;
  });
  if (!maxTransferDate){ setUnpaidDaysField_('trUnpaidDays', 0); return; }
  const y = Number(maxTransferDate.slice(0, 4));
  const deadline = new Date(y + 1, 4, 31); // 확정신고기한: 양도일 속한 해의 다음해 5.31
  const paidDate = document.getElementById('trPaidDate');
  setUnpaidDaysField_('trUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function formatDateYmd_(d){
  if (!d) return '';
  const pad = function(n){ return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function recomputeGiftUnpaidDays(){
  const giftDate = document.getElementById('giftDate');
  const paidDate = document.getElementById('giftPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('giftUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
  const hint = document.getElementById('giftDateDeadlineHint');
  if (hint) hint.textContent = deadline ? '법정신고기한: ' + formatDateYmd_(deadline) + '까지(증여일+3개월)' : '';
}
function recomputeInheritanceUnpaidDays(){
  const deathDate = document.getElementById('ihDeathDate');
  const paidDate = document.getElementById('ihPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(deathDate ? deathDate.value : '', 6);
  setUnpaidDaysField_('ihUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
  const hint = document.getElementById('ihDeathDateDeadlineHint');
  if (hint) hint.textContent = deadline ? '법정신고기한: ' + formatDateYmd_(deadline) + '까지(상속개시일+6개월)' : '';
}

// 배우자 법정상속분 비율(민법§1009②) — 배우자는 다른 공동상속인 1인당 지분의 1.5배를 받는다.
// ratio = 1.5 / (다른 상속인 수 + 1.5). 배우자 유무·다른 상속인 수는 모두 상속인 명부
// (recomputeHeirDerivedFields)에서 자동으로 유도되어 ihOtherHeirsCount/taxCalcHeirRegistryHasSpouse에 반영된다.
function recomputeSpouseRatio(){
  const otherHeirsEl = document.getElementById('ihOtherHeirsCount');
  const hint = document.getElementById('ihSpouseRatioHint');
  const ratioEl = document.getElementById('ihSpouseRatio');
  if (!ratioEl) return;
  if (!taxCalcHeirRegistryHasSpouse){
    ratioEl.value = '0';
    if (hint) hint.textContent = '상속인 명부에 배우자가 없어 0으로 처리';
    return;
  }
  const otherHeirs = numVal(otherHeirsEl ? otherHeirsEl.value : 0);
  if (otherHeirs > 0){
    const ratio = 1.5 / (otherHeirs + 1.5);
    ratioEl.value = ratio.toFixed(4);
    if (hint) hint.textContent = '1.5 / (' + otherHeirs + ' + 1.5) ≈ ' + ratio.toFixed(4);
  } else {
    ratioEl.value = '1';
    if (hint) hint.textContent = '공동상속인 0명 → 배우자 단독상속 가정(1)';
  }
}

function recomputeStockUnpaidDays(){
  const transferDate = document.getElementById('stTransferDate');
  const paidDate = document.getElementById('stPaidDate');
  if (!transferDate || !transferDate.value){ setUnpaidDaysField_('stUnpaidDays', 0); return; }
  const y = Number(transferDate.value.slice(0, 4));
  const deadline = new Date(y + 1, 4, 31); // 확정신고기한: 양도일 속한 해의 다음해 5.31
  setUnpaidDaysField_('stUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeOverseasAssetUnpaidDays(){
  const transferDate = document.getElementById('oaTransferDate');
  const paidDate = document.getElementById('oaPaidDate');
  if (!transferDate || !transferDate.value){ setUnpaidDaysField_('oaUnpaidDays', 0); return; }
  const y = Number(transferDate.value.slice(0, 4));
  const deadline = new Date(y + 1, 4, 31); // 확정신고기한: 양도일 속한 해의 다음해 5.31
  setUnpaidDaysField_('oaUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeSrGiftUnpaidDays(){
  const giftDate = document.getElementById('srGiftDate');
  const paidDate = document.getElementById('srPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('srUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeAfUnpaidDays(){
  const giftDate = document.getElementById('afGiftDate');
  const paidDate = document.getElementById('afPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('afUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeDfUnpaidDays(){
  const giftDate = document.getElementById('dfGiftDate');
  const paidDate = document.getElementById('dfPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('dfUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeCiUnpaidDays(){
  const giftDate = document.getElementById('ciGiftDate');
  const paidDate = document.getElementById('ciPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('ciUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeCrUnpaidDays(){
  const giftDate = document.getElementById('crGiftDate');
  const paidDate = document.getElementById('crPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('crUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeIcfUnpaidDays(){
  const giftDate = document.getElementById('icfGiftDate');
  const paidDate = document.getElementById('icfPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('icfUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeCbUnpaidDays(){
  const giftDate = document.getElementById('cbGiftDate');
  const paidDate = document.getElementById('cbPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('cbUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeEdUnpaidDays(){
  const giftDate = document.getElementById('edGiftDate');
  const paidDate = document.getElementById('edPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('edUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeSlUnpaidDays(){
  const giftDate = document.getElementById('slGiftDate');
  const paidDate = document.getElementById('slPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('slUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeFuUnpaidDays(){
  const giftDate = document.getElementById('fuGiftDate');
  const paidDate = document.getElementById('fuPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('fuUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeSpUnpaidDays(){
  const giftDate = document.getElementById('spGiftDate');
  const paidDate = document.getElementById('spPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('spUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeIpUnpaidDays(){
  const giftDate = document.getElementById('ipGiftDate');
  const paidDate = document.getElementById('ipPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('ipUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeTiUnpaidDays(){
  const giftDate = document.getElementById('tiGiftDate');
  const paidDate = document.getElementById('tiPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('tiUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeJmUnpaidDays(){
  const fiscalYearEnd = document.getElementById('jmFiscalYearEnd');
  const paidDate = document.getElementById('jmPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(fiscalYearEnd ? fiscalYearEnd.value : '', 3);
  setUnpaidDaysField_('jmUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeScUnpaidDays(){
  const fiscalYearEnd = document.getElementById('scFiscalYearEnd');
  const paidDate = document.getElementById('scPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(fiscalYearEnd ? fiscalYearEnd.value : '', 3);
  setUnpaidDaysField_('scUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeMgUnpaidDays(){
  const giftDate = document.getElementById('mgGiftDate');
  const paidDate = document.getElementById('mgPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('mgUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputePuUnpaidDays(){
  const giftDate = document.getElementById('puGiftDate');
  const paidDate = document.getElementById('puPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('puUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeOcUnpaidDays(){
  const giftDate = document.getElementById('ocGiftDate');
  const paidDate = document.getElementById('ocPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('ocUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputePvUnpaidDays(){
  const giftDate = document.getElementById('pvGiftDate');
  const paidDate = document.getElementById('pvPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('pvUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeJtUnpaidDays(){
  const fiscalYearEnd = document.getElementById('jtFiscalYearEnd');
  const paidDate = document.getElementById('jtPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(fiscalYearEnd ? fiscalYearEnd.value : '', 3);
  setUnpaidDaysField_('jtUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}

// 상속인 명부(inheritanceHeirs)를 "원천 데이터"로 삼아 인적공제·배우자공제·동거주택공제·
// 세대생략비율·신고인 정보를 전부 자동으로 유도한다. 상속인 목록을 맨 먼저 입력받고 나머지는
// 거기서 파생시키라는 요구사항을 그대로 구현한 것 — 개별 공제란에 따로 손으로 채우지 않는다.
// 주민등록번호 앞 6자리(생년월일)+7번째 자리(성별·출생세기 코드)로 생년월일을 역산한다.
// 미성년자·세대생략 등은 이미 입력받은 인적사항(주민등록번호)에서 그대로 확인되는 사항이므로
// 별도로 "미성년자입니까?" 체크박스를 또 받지 않는다.
function parseBirthDateFromRegNo_(regNo){
  const digits = String(regNo || '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const g = digits.charAt(6);
  let century;
  if (g === '1' || g === '2' || g === '5' || g === '6') century = 1900;
  else if (g === '3' || g === '4' || g === '7' || g === '8') century = 2000;
  else if (g === '9' || g === '0') century = 1800;
  else return null;
  const month = Number(mm), day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return (century + Number(yy)) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
// 실무에서 지분은 항상 분수(예: 1/2, 1/3)로 표기하지 백분율로 쓰지 않는다. "분자/분모" 형태를
// 우선 인식하고, 분수가 아니면 그대로 소수 비율(0~1)로 취급한다.
function parseShareFraction_(raw){
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m){
    const den = Number(m[2]);
    if (!den) return null;
    return Number(m[1]) / den;
  }
  const n = Number(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
// 실제상속재산가액(협의분할·유언 등에 따른 실제 귀속)은 상속인 명부 입력 시점에는 알 수 없다 —
// 재산평가 자산목록에서 각 자산을 어느 상속인이 받는지 배분해야 비로소 정해지는 값이기 때문이다.
// 그래서 상속인 명부에서 지분을 직접 입력받지 않고, 각 자산행의 "상속인별 배분"(heirAllocations)을
// 전부 훑어 이 상속인에게 배분된 몫만 합산한다. 법정상속지분(민법§1009, 배우자공제 한도용)은
// 이것과 별개로 recomputeSpouseRatio()가 공동상속인 수만으로 자동계산한다.
function computeHeirActualValue_(heirIdx){
  return Math.round((inheritanceValuationAssets || []).reduce(function(sum, a){
    const value = computeValuationAssetValue(a);
    const allocations = Array.isArray(a.heirAllocations) ? a.heirAllocations : [];
    const heirRatio = allocations.reduce(function(s, al){
      if (String(al.heirIdx) !== String(heirIdx)) return s;
      const r = parseShareFraction_(al.ratio);
      return s + (r === null ? 0 : r);
    }, 0);
    return sum + value * heirRatio;
  }, 0));
}
function calcAgeAt_(birthDateStr, atDateStr){
  if (!birthDateStr || !atDateStr) return null;
  const b = new Date(birthDateStr + 'T00:00:00');
  const a = new Date(atDateStr + 'T00:00:00');
  if (isNaN(b.getTime()) || isNaN(a.getTime())) return null;
  let age = a.getFullYear() - b.getFullYear();
  const beforeBirthdayThisYear = (a.getMonth() < b.getMonth()) || (a.getMonth() === b.getMonth() && a.getDate() < b.getDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}
function setReadonlyField_(fieldId, value){
  const el = document.getElementById(fieldId);
  if (el) el.value = String(value);
}
function recomputeHeirDerivedFields(){
  const deathDateEl = document.getElementById('ihDeathDate');
  const deathDate = deathDateEl ? deathDateEl.value : '';
  const heirs = inheritanceHeirs;

  const childHeirs = heirs.filter(function(h){ return h.relation === '자녀' || (h.relation || '').indexOf('손자녀') !== -1; });
  const childCount = heirs.filter(function(h){ return h.relation === '자녀'; }).length;
  // §20①2호·3호 — 미성년자공제·연로자공제는 "상속인(배우자는 제외한다) 및 동거가족"만 대상이다.
  // 4호(장애인공제)는 배우자 제외 문구가 없으므로 disabledCount는 배우자를 포함해 그대로 센다.
  let minorYears = 0, elderlyCount = 0;
  heirs.forEach(function(h){
    if (h.relation === '배우자') return;
    const age = calcAgeAt_(h.birthDate, deathDate);
    if (age === null) return;
    if (age < 19) minorYears += (19 - age);
    if (age >= 65) elderlyCount += 1;
  });
  const spouseHeirs = heirs.filter(function(h){ return h.relation === '배우자'; });
  const hasSpouse = spouseHeirs.length > 0;
  let spouseActual = 0, genSkipAmount = 0;
  heirs.forEach(function(h, hidx){
    if (h.relation === '배우자') spouseActual += computeHeirActualValue_(hidx);
    if ((h.relation || '').indexOf('세대생략') !== -1) genSkipAmount += computeHeirActualValue_(hidx);
  });
  const otherHeirsCount = childHeirs.length > 0 ? childHeirs.length : heirs.filter(function(h){ return (h.relation || '').indexOf('부모') !== -1; }).length;
  const cohabitAmount = heirs.filter(function(h){ return h.isCohabitHouse; }).reduce(function(s, h){ return s + (numVal(h.cohabitHouseValue) || 0); }, 0);
  const reporter = heirs.find(function(h){ return h.isReporter; });
  // 장애인공제(§20①4호)는 1인당 기대여명(통계청 생명표)이 필요해 자동계산할 수 없다 — 명부의
  // "장애인" 체크는 대상자 수만 확인해주고, 실제 잔여연수 합계는 사용자가 직접 확인해 입력해야 한다.
  const disabledCount = heirs.filter(function(h){ return h.isDisabled; }).length;
  const disabledHint = document.getElementById('ihDisabledCountHint');
  if (disabledHint){
    disabledHint.textContent = disabledCount > 0 ?
      '체크된 장애인 상속인 ' + disabledCount + '명 — 각자 상속개시일 기준 통계청 기대여명을 확인해 위 칸에 합계로 입력하세요(자동계산 불가)' : '';
  }

  setReadonlyField_('ihChildCount', childCount);
  setReadonlyField_('ihMinorYears', minorYears);
  setReadonlyField_('ihElderlyCount', elderlyCount);
  setReadonlyField_('ihSpouseActual', spouseActual);
  setReadonlyField_('ihOtherHeirsCount', otherHeirsCount);
  setReadonlyField_('ihGenSkipAmount', genSkipAmount);
  setReadonlyField_('ihCohabitValue', cohabitAmount);
  setReadonlyField_('ihReporterName', reporter ? (reporter.name || '') : '');
  setReadonlyField_('ihReporterRegNo', reporter ? (reporter.regNo || '') : '');
  setReadonlyField_('ihReporterRelation', reporter ? (reporter.relation || '') : '');
  taxCalcHeirRegistryHasSpouse = hasSpouse;
  taxCalcHeirRegistryHasCohabit = cohabitAmount > 0;
  recomputeSpouseRatio();
  recomputeGenSkipRatio();
  wireMoneyCapHint_('ihCohabitValue', 'ihCohabitValueHint', 600000000);
}

// 세대생략가산액(§27) 계산에 쓰는 "세대생략 상속인이 받는 재산 비율" — 비율을 직접 입력받는 대신
// 세대생략상속인이 실제 받는 재산가액과 총 상속재산가액(입력돼 있으면 그 값, 아니면 상속세과세가액)을
// 입력받아 나눗셈으로 자동 산출한다.
function recomputeGenSkipRatio(){
  const amountEl = document.getElementById('ihGenSkipAmount');
  const totalEl = document.getElementById('ihTotalGrossEstate');
  const estateEl = document.getElementById('ihEstate');
  const ratioEl = document.getElementById('ihGenSkipRatio');
  const hint = document.getElementById('ihGenSkipRatioHint');
  if (!ratioEl) return;
  const amount = numVal(amountEl ? amountEl.value : 0);
  const total = numVal(totalEl ? totalEl.value : 0) || numVal(estateEl ? estateEl.value : 0);
  if (amount <= 0 || total <= 0){
    ratioEl.value = '0';
    if (hint) hint.textContent = total <= 0 ? '총상속재산가액(또는 상속세과세가액)을 먼저 입력하세요' : '';
    return;
  }
  const ratio = Math.min(1, amount / total);
  ratioEl.value = ratio.toFixed(4);
  if (hint) hint.textContent = won(amount) + ' ÷ ' + won(total) + ' ≈ ' + ratio.toFixed(4);
}

// 혼인·출산 증여재산공제(상증세법§53의2) 요건을 날짜로 직접 판정한다(수동 체크박스 대신).
function taxCalcAddYears_(dateStr, years){
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
}
function taxCalcDateInRange_(dateStr, startDate, endDate){
  if (!dateStr || !startDate || !endDate) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  return d.getTime() >= startDate.getTime() && d.getTime() <= endDate.getTime();
}
// 혼인일 전후 2년 이내(총 4년) 증여받은 경우에만 공제 대상이다.
function taxCalcIsMarriageGiftEligible_(giftDateStr, marriageDateStr){
  if (!giftDateStr || !marriageDateStr) return false;
  return taxCalcDateInRange_(giftDateStr, taxCalcAddYears_(marriageDateStr, -2), taxCalcAddYears_(marriageDateStr, 2));
}
// 자녀의 출생일·입양일부터 2년 이내 증여받은 경우에만 공제 대상이다(출생 전 증여는 해당 없음).
function taxCalcIsBirthGiftEligible_(giftDateStr, birthDateStr){
  if (!giftDateStr || !birthDateStr) return false;
  return taxCalcDateInRange_(giftDateStr, new Date(birthDateStr + 'T00:00:00'), taxCalcAddYears_(birthDateStr, 2));
}
// 법정 한도가 있는 금액 필드(감정평가수수료 500만원, 동거주택공제 6억, 주식양도 기본공제 250만원 등) —
// tax-calc.js/Code.js가 이미 Math.min(입력값, 한도)로 캡을 적용하므로, 입력칸 옆에 실제 반영될 금액을
// 바로 보여줘서 한도가 실제로 걸리는지 눈으로 확인할 수 있게 한다.
function wireMoneyCapHint_(fieldId, hintId, capAmount){
  const el = document.getElementById(fieldId);
  const hint = document.getElementById(hintId);
  if (!el || !hint) return;
  function update(){
    const v = numVal(el.value);
    hint.textContent = v > capAmount ? '⚠ ' + won(capAmount) + ' 한도 적용 → 실제 반영액 ' + won(capAmount) : (v > 0 ? '반영액 ' + won(v) + ' (한도 이내 전액 반영)' : '');
  }
  el.addEventListener('input', update);
  update();
}
function taxCalcGiftDoneeIsMinor(){
  const regNoEl = document.getElementById('giftDoneeRegNo');
  const giftDateEl = document.getElementById('giftDate');
  const birthDate = parseBirthDateFromRegNo_(regNoEl ? regNoEl.value : '');
  const age = calcAgeAt_(birthDate, giftDateEl ? giftDateEl.value : '');
  return age !== null && age < 19;
}
function updateGiftMinorHint(){
  const hint = document.getElementById('giftMinorHint');
  if (!hint) return;
  const regNoEl = document.getElementById('giftDoneeRegNo');
  const giftDateEl = document.getElementById('giftDate');
  if (!regNoEl || !regNoEl.value || !giftDateEl || !giftDateEl.value){
    hint.textContent = '수증자 미성년 여부는 위 주민등록번호로 자동 판정됩니다';
    return;
  }
  hint.textContent = taxCalcGiftDoneeIsMinor() ? '⚠ 수증자 미성년자로 자동 판정됨(직계존속 증여 공제 축소 적용)' : '수증자 성년으로 자동 판정됨';
}
function updateGiftMarriageBirthHints(){
  const giftDate = (document.getElementById('giftDate') || {}).value;
  const marriageDate = (document.getElementById('giftMarriageDate') || {}).value;
  const birthDate = (document.getElementById('giftBirthDate') || {}).value;
  const mHint = document.getElementById('giftMarriageHint');
  const bHint = document.getElementById('giftBirthHint');
  if (mHint) mHint.textContent = !marriageDate ? '' : (!giftDate ? '증여일을 입력하세요' : (taxCalcIsMarriageGiftEligible_(giftDate, marriageDate) ? '✓ 공제대상(혼인일 전후 2년 이내)' : '✗ 기간 벗어남(혼인일 전후 2년 초과)'));
  if (bHint) bHint.textContent = !birthDate ? '' : (!giftDate ? '증여일을 입력하세요' : (taxCalcIsBirthGiftEligible_(giftDate, birthDate) ? '✓ 공제대상(출생일부터 2년 이내)' : '✗ 기간 벗어남(출생일부터 2년 초과)'));
}

// 일부 브라우저는 type="date" 입력칸의 연도 세그먼트에 계속 숫자를 입력하면 4자리를 넘겨서
// 6자리 이상 연도(예: 202566)가 그대로 값으로 잡히는 버그가 있다. min/max 속성만으로는
// 타이핑 도중 커밋되는 값을 막지 못하므로, 값이 확정될 때마다 연도 세그먼트를 직접 검사해서
// 1900~2099 범위를 벗어나면 강제로 비운다.
// 주민등록번호 입력칸(000000-0000000)에 숫자만 입력해도 6자리 뒤에 자동으로 하이픈이 찍히게 한다.
function formatRegNoValue_(raw){
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, 13);
  return digits.length <= 6 ? digits : digits.slice(0, 6) + '-' + digits.slice(6);
}
// 주민등록번호 "형식" 검증(체크섬) — 실제로 그 번호를 쓰는 사람이 존재하는지(실명확인)는 행정안전부
// 본인인증기관과의 유료 계약이 있어야 확인 가능해 여기서는 할 수 없다. 대신 누구나 계산으로 확인 가능한
// 구조적 오류(자릿수·생년월일·성별코드·체크섬 불일치 = 십중팔구 오타)는 100% 걸러낼 수 있어 그것만 본다.
function validateResidentRegistrationNumber_(raw){
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return { valid: null };
  if (digits.length !== 13) return { valid: false, reason: '13자리 숫자가 아닙니다(현재 ' + digits.length + '자리)' };
  const genderCode = digits.charAt(6);
  const centuryMap = { '1':1900,'2':1900,'3':2000,'4':2000,'5':1900,'6':1900,'7':2000,'8':2000,'9':1800,'0':1800 };
  if (!(genderCode in centuryMap)) return { valid: false, reason: '성별·출생세기 코드(7번째 자리 "' + genderCode + '")가 올바르지 않습니다' };
  const year = centuryMap[genderCode] + Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const dt = new Date(year, month - 1, day);
  if (month < 1 || month > 12 || day < 1 || dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return { valid: false, reason: '생년월일(앞 6자리)이 실제 존재하는 날짜와 맞지 않습니다' };
  }
  const weights = [2,3,4,5,6,7,8,9,2,3,4,5];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits.charAt(i)) * weights[i];
  const check = (11 - (sum % 11)) % 10;
  if (check !== Number(digits.charAt(12))) return { valid: false, reason: '검증번호(마지막 자리)가 맞지 않습니다 — 오타 가능성이 높습니다' };
  return { valid: true };
}
function enhanceRegNoInputs(container){
  if (!container) return;
  container.querySelectorAll('[data-regno]').forEach(function(el){
    el.setAttribute('maxlength', '14');
    if (el.dataset.regnoGuarded) return;
    el.dataset.regnoGuarded = '1';
    el.addEventListener('input', function(){
      const before = el.value;
      const caretFromEnd = before.length - (el.selectionStart == null ? before.length : el.selectionStart);
      const formatted = formatRegNoValue_(before);
      el.value = formatted;
      const pos = Math.max(0, formatted.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 일부 브라우저 미지원이면 무시 */ }
      el.style.borderColor = '';
    });
    el.addEventListener('blur', function(){
      const check = validateResidentRegistrationNumber_(el.value);
      if (check.valid === false){
        el.style.borderColor = '#e53935';
        const proceed = confirm('주민등록번호 형식 오류: ' + check.reason + '\n\n그래도 이 값을 그대로 입력하시겠습니까?\n(취소를 누르면 이 칸을 비웁니다)');
        if (!proceed){ el.value = ''; el.style.borderColor = ''; }
      } else {
        el.style.borderColor = '';
      }
    });
  });
}
// 성명란은 숫자가 들어올 수 없는 항목이므로 입력 즉시 숫자만 걸러낸다.
function enhanceNameOnlyInputs(container){
  if (!container) return;
  container.querySelectorAll('[data-nameonly]').forEach(function(el){
    if (el.dataset.nameGuarded) return;
    el.dataset.nameGuarded = '1';
    el.addEventListener('input', function(){
      const before = el.value;
      const stripped = before.replace(/[0-9]/g, '');
      if (stripped === before) return;
      const caretFromEnd = before.length - (el.selectionStart == null ? before.length : el.selectionStart);
      el.value = stripped;
      const pos = Math.max(0, stripped.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 일부 브라우저 미지원이면 무시 */ }
    });
  });
}
// 비율·이자율 필드는 숫자 자체에 상한이 있다(예: 지분비율 0~100%, 세대생략비율 0~1).
// type="number"의 min/max는 enhanceNumberInputs가 type="text"로 바꾸면서 무력화되므로,
// 입력을 마쳤을 때(blur) 범위를 벗어나면 강제로 잘라낸다(타이핑 도중엔 건드리지 않는다).
// 연부연납은 총 납부세액이 2천만원을 초과해야 신청 가능하다(상증세법§71①, tax-calc.js 1305행에서
// 이 조건 미달 시 error를 던짐). 계산 버튼을 누르기 전에 미리 눈에 띄게 경고한다.
function wireMinThresholdHint_(fieldId, hintId, minAmount){
  const el = document.getElementById(fieldId);
  const hint = document.getElementById(hintId);
  if (!el || !hint) return;
  function update(){
    const v = numVal(el.value);
    hint.textContent = (v > 0 && v <= minAmount) ? '⚠ ' + won(minAmount) + ' 이하이면 연부연납 신청 불가' : '';
  }
  el.addEventListener('input', update);
  update();
}
function wireRangeClamp_(fieldId, min, max){
  const el = document.getElementById(fieldId);
  if (!el) return;
  el.addEventListener('blur', function(){
    if (el.value === '') return;
    const v = numVal(el.value);
    const clamped = Math.min(max, Math.max(min, v));
    if (clamped !== v) el.value = formatNumberInputValue_(String(clamped));
  });
}
// 브라우저 네이티브 type="date" 입력칸은 로케일에 따라 "연도-월-일" 같은 자체 placeholder를 강제로
// 보여주고, placeholder 속성 자체를 무시하므로 "YYYY-MM-DD"를 입력칸 밖 라벨에 따로 적어야 했다.
// 그게 지저분하다는 지적을 받아, 아예 type="text"로 바꾸고 실제 placeholder를 YYYY-MM-DD로 보여주며
// 숫자만 입력해도 자동으로 하이픈이 찍히게 한다(콤마 포맷터·주민번호 하이픈 포맷터와 같은 패턴).
// 부수적으로 연도가 4자리를 넘게 입력되는 것도 자릿수 자체가 막혀서 원천적으로 방지된다.
function formatDateInputValue_(raw){
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4);
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
}
function enhanceDateInputs(container){
  if (!container) return;
  container.querySelectorAll('input[type="date"]').forEach(function(el){
    if (el.dataset.dateGuarded) return;
    el.dataset.dateGuarded = '1';
    const initialValue = el.value;
    el.type = 'text';
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('placeholder', 'YYYY-MM-DD');
    el.setAttribute('maxlength', '10');
    el.classList.add('taxcalc-date');
    if (initialValue) el.value = formatDateInputValue_(initialValue);
  });
  // 캡처 단계 위임 리스너: 개별 입력요소에 나중에 등록되는 상태동기화([data-field] 등) 리스너보다
  // 항상 먼저 실행되어야 el.value가 하이픈 포맷된 채로 상태에 반영된다(등록 순서에 의존하지 않음).
  if (!container.dataset.dateDelegated) {
    container.dataset.dateDelegated = '1';
    container.addEventListener('input', function(e){
      const el = e.target;
      if (!el || !el.classList || !el.classList.contains('taxcalc-date')) return;
      const before = el.value;
      const caretFromEnd = before.length - (el.selectionStart == null ? before.length : el.selectionStart);
      const formatted = formatDateInputValue_(before);
      el.value = formatted;
      const pos = Math.max(0, formatted.length - caretFromEnd);
      try { el.setSelectionRange(pos, pos); } catch (e2) { /* 일부 브라우저 미지원이면 무시 */ }
    }, true);
  }
}

// "토지+건물"을 별도 유형으로 두면 무엇을 입력받는다는 것인지 모호하다 — 대지권을 포함해 건물면적만
// 받는 구분소유 건물(아파트·오피스텔 등)이라면 "건물" 유형과 입력항목이 동일하고(대지권은 별도
// 지번·지목이 없는 지분이라 따로 받을 게 없다), 토지·건물을 각각 등기해 함께 파는 단독주택 등은
// 서로 다른 두 필지(자산)를 일괄양도하는 것이므로 자산을 두 줄로 나눠 입력하고 필요하면 안분계산
// 도구를 쓰는 게 맞다. 그래서 유형은 토지/건물/기타 세 가지만 둔다.
const ASSET_LAND_CATEGORY_OPTIONS = ['전', '답', '과수원', '목장용지', '임야', '광천지', '염전', '대', '공장용지', '학교용지', '주차장', '주유소용지', '창고용지', '도로', '철도용지', '제방', '하천', '구거', '유지', '양어장', '수도용지', '공원', '체육용지', '유원지', '종교용지', '사적지', '묘지', '잡종지'];
// 자산내역은 "소재지·지번·면적 등"을 한 줄 텍스트로 뭉뚱그려 받지 않고, 등기부·건축물대장처럼
// 유형(토지/건물 등)·소재지·지목(건물은 층수·용도)·면적을 각각의 필드로 받는다. 건물이면 지목 대신
// 층수·용도를 받도록 라벨만 바뀐다. 양도세 거래카드와 증여/상속 재산평가 자산행에서 공통으로 쓴다.
function assetDetailFieldsHtml_(a){
  const kind = a.assetKind || 'land';
  const isBuilding = kind === 'building';
  const subTypeFieldHtml = isBuilding ?
    '<div class="taxcalc-field"><label>층수·용도</label><input type="text" data-field="assetSubType" value="' + (a.assetSubType || '').replace(/"/g, '&quot;') + '" placeholder="예: 3층, 상가"></div>' :
    '<div class="taxcalc-field"><label>지목</label><select data-field="assetSubType"><option value="">선택</option>' +
      ASSET_LAND_CATEGORY_OPTIONS.map(function(c){ return '<option value="' + c + '"' + (a.assetSubType === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select></div>';
  const dongOptions = (Array.isArray(a.assetDongList) && a.assetDongList.length) ? a.assetDongList :
    (a.assetDong ? [a.assetDong] : []);
  return '' +
    '<div class="taxcalc-field"><label>유형</label><select data-field="assetKind">' +
      '<option value="land"' + (kind === 'land' ? ' selected' : '') + '>토지</option>' +
      '<option value="building"' + (kind === 'building' ? ' selected' : '') + '>건물(구분소유 건물·아파트 등 대지권 포함분도 건물면적만 입력)</option>' +
      '<option value="other"' + (kind === 'other' ? ' selected' : '') + '>기타</option>' +
    '</select></div>' +
    '<div class="taxcalc-field"><label>소재지</label><div class="taxcalc-field-inline"><input type="text" data-field="assetLocation" value="' + (a.assetLocation || '').replace(/"/g, '&quot;') + '" placeholder="예: OO시 OO구 OO동 123-4"><button type="button" class="taxcalc-ai-btn" data-action="open-address-search" title="주소 검색">🔍</button></div>' +
      (a.assetZipNo ? '<span class="taxcalc-result-note" style="margin:2px 0 0;">우편번호 ' + a.assetZipNo + '</span>' : '') +
    '</div>' +
    '<div class="taxcalc-field"><label>동</label><select data-field="assetDong"><option value="">직접입력/해당없음</option>' +
      dongOptions.map(function(d){ return '<option value="' + d + '"' + (a.assetDong === d ? ' selected' : '') + '>' + d + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="taxcalc-field"><label>호</label><input type="text" data-field="assetHo" value="' + (a.assetHo || '').replace(/"/g, '&quot;') + '" placeholder="예: 1502호(공공데이터에 없어 직접 입력)"></div>' +
    subTypeFieldHtml +
    '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-field="assetArea" value="' + (a.assetArea || '') + '"></div>';
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

// 도로명주소 API(juso.go.kr) 검색 모달 — 건물명(아파트명 등)으로 검색하면 도로명·지번주소 후보와,
// 공동주택이면 동(棟) 목록(detBdNmList)까지 함께 온다. 호수는 공공데이터에 없는 개인정보라 항상
// 직접 입력해야 한다. API 키가 아직 등록 안 됐으면 GAS 쪽에서 그 안내 문구를 그대로 돌려준다.
function openAddressSearchModal_(onPick){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML =
    '<div class="modal-panel" style="width:min(480px, 92vw);">' +
      '<div class="modal-head"><span>주소 검색</span><span class="modal-close" id="btnCloseAddrSearch">✕</span></div>' +
      '<div class="modal-body">' +
        '<div class="taxcalc-grid" style="margin-bottom:8px;">' +
          '<div class="taxcalc-field" style="flex:1;"><input type="text" id="addrSearchKeyword" placeholder="건물명·도로명·지번 등으로 검색"></div>' +
          '<button type="button" class="taxcalc-run-btn" id="btnAddrSearchRun">검색</button>' +
        '</div>' +
        '<div id="addrSearchList" class="taxcalc-evidence-list"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  function close(){ overlay.remove(); }
  overlay.querySelector('#btnCloseAddrSearch').onclick = close;
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });

  function runSearch(){
    const keyword = overlay.querySelector('#addrSearchKeyword').value.trim();
    const listBox = overlay.querySelector('#addrSearchList');
    if (!keyword){ listBox.innerHTML = '<div class="taxcalc-evidence-empty">검색어를 입력하세요.</div>'; return; }
    listBox.innerHTML = '<div class="taxcalc-evidence-empty">검색 중…</div>';
    fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'searchAddress', keyword: keyword })
    }).then(function(res){ return res.json(); }).then(function(data){
      if (data.error){ listBox.innerHTML = '<div class="taxcalc-evidence-empty">' + data.error.replace(/</g,'&lt;') + '</div>'; return; }
      const juso = data.juso || [];
      if (!juso.length){ listBox.innerHTML = '<div class="taxcalc-evidence-empty">검색 결과가 없습니다.</div>'; return; }
      listBox.innerHTML = juso.map(function(j, idx){
        return '<div class="taxcalc-evidence-item"><span class="name">' + (j.roadAddr || j.jibunAddr || '').replace(/</g,'&lt;') +
          (j.dongList && j.dongList.length ? ' <span style="color:var(--sub);">(동 ' + j.dongList.length + '개)</span>' : '') + '</span>' +
          '<button type="button" data-addr-idx="' + idx + '">선택</button></div>';
      }).join('');
      listBox.querySelectorAll('[data-addr-idx]').forEach(function(btn){
        btn.addEventListener('click', function(){
          const picked = juso[numVal(btn.dataset.addrIdx)];
          close();
          onPick(picked);
        });
      });
    }).catch(function(err){
      listBox.innerHTML = '<div class="taxcalc-evidence-empty">검색 실패: ' + (err && err.message || err) + '</div>';
    });
  }
  overlay.querySelector('#btnAddrSearchRun').onclick = runSearch;
  overlay.querySelector('#addrSearchKeyword').addEventListener('keydown', function(e){ if (e.key === 'Enter') runSearch(); });
  overlay.querySelector('#addrSearchKeyword').focus();
}

// 매매사례가액(아파트 실거래가) 참고조회 모달 — 계약년월(YYYYMM)로 그 지역 아파트 실거래 목록을
// 받아와 사용자가 유사한 거래를 골라 평가액에 채울 수 있게 한다. 시가로 그대로 쓸지는 면적·층·거래
// 시점의 유사성을 사용자가 직접 판단해야 하므로 자동으로 채우지 않고 "골라서 채우기"로만 동작한다.
function openRealPriceModal_(lawdCd, onPick){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  const now = new Date();
  const defaultYm = String(now.getFullYear()) + ('0' + (now.getMonth() + 1)).slice(-2);
  overlay.innerHTML =
    '<div class="modal-panel" style="width:min(560px, 94vw);">' +
      '<div class="modal-head"><span>아파트 실거래가 조회(참고)</span><span class="modal-close" id="btnCloseRealPrice">✕</span></div>' +
      '<div class="modal-body">' +
        '<div class="taxcalc-grid" style="margin-bottom:8px;">' +
          '<div class="taxcalc-field"><label>계약년월</label><input type="text" id="realPriceYm" value="' + defaultYm + '" placeholder="YYYYMM" maxlength="6"></div>' +
          '<button type="button" class="taxcalc-run-btn" id="btnRealPriceRun">조회</button>' +
        '</div>' +
        '<div class="taxcalc-result-note">국토교통부 실거래가 공개시스템 자료입니다 — 같은 면적·층·거래시점인지 직접 확인하고 고르세요.</div>' +
        '<div id="realPriceList" class="taxcalc-evidence-list"></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  function close(){ overlay.remove(); }
  overlay.querySelector('#btnCloseRealPrice').onclick = close;
  overlay.addEventListener('click', function(e){ if (e.target === overlay) close(); });
  function runSearch(){
    const dealYm = overlay.querySelector('#realPriceYm').value.trim();
    const listBox = overlay.querySelector('#realPriceList');
    listBox.innerHTML = '<div class="taxcalc-evidence-empty">조회 중…</div>';
    fetch(GAS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'lookupRealPrice', lawdCd: lawdCd, dealYm: dealYm })
    }).then(function(res){ return res.json(); }).then(function(data){
      if (data.error){ listBox.innerHTML = '<div class="taxcalc-evidence-empty">' + data.error.replace(/</g,'&lt;') + '</div>'; return; }
      const items = data.items || [];
      if (!items.length){ listBox.innerHTML = '<div class="taxcalc-evidence-empty">해당 월 거래 내역이 없습니다.</div>'; return; }
      listBox.innerHTML = items.map(function(it, idx){
        return '<div class="taxcalc-evidence-item"><span class="name">' + (it.aptNm || '').replace(/</g,'&lt;') + ' ' + (it.dong || '') + ' ' + (it.jibun || '') +
          ' · ' + it.area + '㎡ · ' + it.floor + '층 · ' + it.dealDate + ' · ' + won(it.dealAmount) + '</span>' +
          '<button type="button" data-real-idx="' + idx + '">선택</button></div>';
      }).join('');
      listBox.querySelectorAll('[data-real-idx]').forEach(function(b){
        b.addEventListener('click', function(){
          const picked = items[numVal(b.dataset.realIdx)];
          close();
          onPick(picked);
        });
      });
    }).catch(function(err){
      listBox.innerHTML = '<div class="taxcalc-evidence-empty">조회 실패: ' + (err && err.message || err) + '</div>';
    });
  }
  overlay.querySelector('#btnRealPriceRun').onclick = runSearch;
  overlay.querySelector('#realPriceYm').addEventListener('keydown', function(e){ if (e.key === 'Enter') runSearch(); });
  runSearch();
}

// 거래(자산) 하나의 AI 자동입력 상태(_aiStatus: 'loading'|'done'|'error'|undefined)를 배지로 렌더링.
function renderAiStatusHtml(vals){
  const st = vals && vals._aiStatus;
  if (st === 'loading') return '<span class="taxcalc-badge info">📄 증빙 읽는 중…</span>';
  if (st === 'error') return '<span class="taxcalc-badge danger">자동입력 실패</span><div class="taxcalc-ai-fields">' + (vals._aiError || '') + '</div>';
  if (st === 'done') return '<span class="taxcalc-badge warning">자동입력됨 · 확인 필요</span>' +
    (vals._aiFilledFields && vals._aiFilledFields.length ? '<div class="taxcalc-ai-fields">채운 항목: ' + vals._aiFilledFields.join(', ') + (vals._aiFileName ? ' (출처: ' + vals._aiFileName + ')' : '') + '</div>' : '');
  return '';
}

// 양도소득세 — 사건폴더 전체를 한 번에 훑어서 거래를 몇 건이든 찾아 각 거래행에 자동 배분한다.
// 기존 값이 비어있는 행부터 채우고, 모자라면 행을 새로 만든다(버튼을 거래마다 누를 필요 없음).
const TRANSFER_AI_FIELD_LABELS = {
  transferPrice: '양도가액', acquisitionPrice: '취득가액', acquisitionExpenses: '취득 관련 비용', transferExpensesOnly: '양도비용',
  acquisitionDate: '취득일', transferDate: '양도일', assetType: '자산종류',
  assetKind: '유형', assetLocation: '소재지', assetSubType: '지목/층수·용도', assetArea: '면적'
};
async function runAiAutoFillTransferBulk(){
  transferBulkAiState = { _aiStatus: 'loading' };
  const statusEl = document.getElementById('aiStatus-transfer-bulk');
  if (statusEl) statusEl.innerHTML = renderAiStatusHtml(transferBulkAiState);

  const instruction = '현재 사건 폴더 안의 모든 파일을 살펴봐줘(매매계약서·등기부등본 등 양도소득세 관련 증빙일 수 있는 파일 전부). ' +
    '그 안에서 서로 다른 양도거래가 몇 건인지 파악하고, 각 거래마다 아래 스키마의 객체를 하나씩 만들어서, 다른 설명 없이 ' +
    '그 객체들을 담은 JSON 배열 코드블록 하나만 답해줘(거래가 1건이면 원소도 1개). 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n[{"transferPrice": 숫자 또는 null, "acquisitionPrice": 숫자 또는 null, "acquisitionExpenses": 숫자 또는 null, "transferExpensesOnly": 숫자 또는 null, ' +
    '"acquisitionDate": "YYYY-MM-DD 또는 null", "transferDate": "YYYY-MM-DD 또는 null", "assetType": "house 또는 presale_right 또는 other 또는 null", ' +
    '"assetKind": "land 또는 building 또는 other 또는 null", "assetLocation": "문자열 또는 null(소재지·지번)", ' +
    '"assetSubType": "문자열 또는 null(토지면 지목, 건물이면 층수·용도)", "assetArea": "숫자 또는 null(면적, ㎡)"}]\n```\n' +
    '(transferPrice=양도가액, acquisitionPrice=취득가액, acquisitionExpenses=취득세·법무사비 등 취득 관련 비용, transferExpensesOnly=중개보수·양도세 신고수수료 등 양도비용, assetType은 주택·조합원입주권이면 house, 분양권(아파트 등 공급계약상 지위)이면 presale_right, 그 외 부동산이면 other, assetKind는 토지만이면 land·구분소유 건물 포함 건물이면 building. 같은 거래를 서로 다른 문서에서 중복으로 찾았으면 하나로 합쳐라.)';

  try {
    const reply = await runFolderAiExtraction(instruction);
    const json = extractJsonFromReply(reply);
    const items = Array.isArray(json) ? json : (json ? [json] : []);
    if (!items.length) throw new Error('응답에서 거래를 찾지 못했습니다. 응답: ' + reply.slice(0, 200));
    let filledCount = 0;
    items.forEach(function(item){
      let target = transferAssets.find(function(v){ return !v.transferPrice && !v._aiStatus; });
      if (!target) { target = {}; transferAssets.push(target); }
      const filled = [];
      Object.keys(TRANSFER_AI_FIELD_LABELS).forEach(function(key){
        if (item[key] !== null && item[key] !== undefined && item[key] !== '') {
          if (key === 'acquisitionExpenses') target.acquisitionExpenseItems = [{ label: '증빙 자동입력', amount: item[key] }];
          else if (key === 'transferExpensesOnly') target.transferExpenseItems = [{ label: '증빙 자동입력', amount: item[key] }];
          else target[key] = item[key];
          filled.push(TRANSFER_AI_FIELD_LABELS[key]);
        }
      });
      target._aiStatus = filled.length ? 'done' : 'error';
      target._aiFilledFields = filled;
      target._aiFileName = '증빙 일괄조회';
      if (!filled.length) target._aiError = '이 거래는 문서에서 값을 찾지 못했습니다 — 직접 입력하세요.';
      else filledCount++;
    });
    transferBulkAiState = { _aiStatus: 'done', _aiFilledFields: [items.length + '건 거래 인식, ' + filledCount + '건 자동입력 완료'] };
  } catch (err) {
    transferBulkAiState = { _aiStatus: 'error', _aiError: err && err.message ? err.message : String(err) };
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
    if (!json) throw new Error('응답에서 값을 찾지 못했습니다. 응답: ' + reply.slice(0, 200));
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
function runAiAutoFillGift(){
  const instruction = '현재 사건 폴더 안의 모든 파일을 살펴봐줘(증여계약서·가족관계증명서·주민등록초본 등 증여세 관련 증빙일 수 있는 파일 전부, 여러 개면 전부 종합해서). ' +
    '증여세 신고에 필요한 값을 찾아서, 다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n{"giftAmount": 숫자 또는 null, "relation": "배우자 또는 직계존속 또는 직계비속 또는 기타친족 또는 기타 또는 null(수증자 기준 증여자와의 관계)", ' +
    '"giftDate": "YYYY-MM-DD 또는 null", "debtAssumedAmount": 숫자 또는 null(부담부증여로 수증자가 인수한 채무, 없으면 0), ' +
    '"doneeName": "문자열 또는 null", "doneeRegNo": "문자열 또는 null", "doneeAddress": "문자열 또는 null", ' +
    '"donorName": "문자열 또는 null", "donorRegNo": "문자열 또는 null", "donorAddress": "문자열 또는 null"}\n```';
  return runAiAutoFillForm('증빙 일괄조회', 'aiStatus-gift', instruction, GIFT_AI_FIELD_MAP, GIFT_AI_FIELD_LABELS);
}

const INHERITANCE_AI_FIELD_MAP = {
  deceasedName: { id: 'ihDeceasedName', type: 'text' }, deceasedRegNo: { id: 'ihDeceasedRegNo', type: 'text' }, deathDate: { id: 'ihDeathDate', type: 'date' }
};
const INHERITANCE_AI_FIELD_LABELS = {
  deceasedName: '피상속인 성명', deceasedRegNo: '피상속인 주민등록번호', deathDate: '상속개시일'
};
// 자녀 수·배우자 유무·신고인 등은 이제 상속인 명부에서 자동으로 유도하므로(recomputeHeirDerivedFields),
// AI자동입력은 피상속인 정보만 채운다 — 상속인 명부 자체는 사건 폴더의 가족관계증명서를 보고 직접 입력한다.
function runAiAutoFillInheritance(){
  const instruction = '현재 사건 폴더 안의 모든 파일을 살펴봐줘(가족관계증명서·기본증명서·사망진단서 등 상속세 관련 증빙일 수 있는 파일 전부, 여러 개면 전부 종합해서). ' +
    '상속세 신고에 필요한 피상속인 정보를 찾아서, 다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n{"deceasedName": "문자열 또는 null(피상속인)", "deceasedRegNo": "문자열 또는 null", "deathDate": "YYYY-MM-DD 또는 null(상속개시일=사망일)"}\n```';
  return runAiAutoFillForm('증빙 일괄조회', 'aiStatus-inheritance', instruction, INHERITANCE_AI_FIELD_MAP, INHERITANCE_AI_FIELD_LABELS);
}

// ---- 상속증여재산 평가(자산 목록) — 증여세·상속세 화면 공통 ----
// [별지 제10호서식 부표1](증여재산 및 평가명세서)·[별지 제9호서식 부표1·2](상속재산 및 평가명세서)의
// "자산을 하나씩 나열해서 합산"하는 구조를 그대로 반영한다. 평가방법 자체(상증세법 §60~66
// 보충적평가방법)는 토지·주택·상장주식·비상장주식만 계산해주고, 그 외(시가·감정가액 등)는
// 이미 알고 있는 금액을 직접 입력하게 한다.
let giftValuationAssets = [{}];
let inheritanceValuationAssets = [{}];

const VALUATION_METHOD_LABELS = {
  direct: '직접입력(시가·감정가액·매매사례가액 등)',
  land: '토지(개별공시지가 × 면적)',
  house: '단독주택(고시된 개별주택가격)',
  apartment: '공동주택/아파트(고시된 공동주택가격)',
  officetel: '오피스텔·상업용건물(고시된 기준시가)',
  building: '일반건물(고시가격 없음 — 구조·용도·신축연도 기준 자동계산)',
  listedStock: '상장주식(기준일 전후 2개월 종가평균 × 주식수)',
  unlistedStock: '비상장주식(순손익·순자산가치 가중평균)',
  rental: '임대 중인 부동산(임대료환산가액)',
  goodwill: '영업권(§64, 초과이익의 5년 현재가치)',
  trustBenefit: '신탁의 이익을 받을 권리(§65, 시행령§61, 연3% 현재가치할인)',
  periodicPayment: '정기금을 받을 권리(§65, 시행령§62, 유기·무기·종신 구분, 연3% 현재가치할인)',
  conditionalRight: '조건부권리·존속기간불확정권리·소송중인권리(§65, 시행령§60① — 계산식 없이 사실판단으로 적정가액 결정)',
  otherTangible: '선박·항공기·차량·기계장비·입목/상품·제품 등(§62, 재취득가액→장부가액→시가표준액)',
  groundRight: '지상권(§61③, 토지가액×2%를 잔존연수 현재가치화)',
  patentRight: '특허권·상표권·저작권등(§64, 연도별수입금액을 잔존연수(최대20년) 현재가치화 vs 취득가액-감가상각 중 큰 금액)',
  miningRight: '광업권·채석권등(§64, 3년평균소득을 채굴가능연수 현재가치화 vs 취득가액-감가상각 중 큰 금액)',
  memberRight: '조합원입주권(재개발·재건축 조합원권리가액, §61③)'
};
// 지분은 평가방법과 무관하게 모든 자산에 공통으로 적용되는 별도 항목이다(예: 확인된 시가가 그 자체로
// 100% 평가액인 자산도 있고, 매매실례가액 등에 피상속인 지분을 곱해야 하는 자산도 있다 — 그 구분은
// "평가방법"이 아니라 "이 자산에서 피상속인 지분이 몇 %인가"의 문제이므로, 방법과 상관없이 한 자리에서만 받는다).
// 주식류(listedStock/unlistedStock)는 보유수량·보유주식수 자체가 이미 지분을 반영하므로 별도로 곱하지 않는다.
const VALUATION_RATIO_EXEMPT_METHODS = ['listedStock', 'unlistedStock'];
// 임대료환산가액(상증세법§61⑤)은 개별 임대차(호실별 보증금·월세)를 전부 더한 합계로 계산해야 한다 —
// 집계된 금액을 손으로 입력받지 말고, 임대차 건을 하나씩 입력받아 시스템이 자동으로 합산한다.
function computeRentalLeaseTotals_(leases){
  const list = Array.isArray(leases) ? leases : [];
  const deposit = list.reduce(function(s, l){ return s + (numVal(l.deposit) || 0); }, 0);
  const annualRent = list.reduce(function(s, l){ return s + (numVal(l.monthlyRent) || 0) * 12; }, 0);
  return { deposit: deposit, annualRent: annualRent };
}
// 개별공시지가·공동주택가격 자동조회에 쓸 19자리 PNU(고유번호) = 법정동코드10 + 산여부1(1=일반,2=산)
// + 지번본번4 + 지번부번4. 원자재(admCd·mtYn·지번)는 주소검색이 돌려준 값을 자산에 저장해둔 것을 쓴다.
function buildPnu_(a){
  if (!a || !a.assetAdmCd || !a.assetLnbrMnnm) return '';
  const san = a.assetMtYn === '1' ? '2' : '1';
  const mnnm = ('0000' + a.assetLnbrMnnm).slice(-4);
  const slno = ('0000' + (a.assetLnbrSlno || '0')).slice(-4);
  return a.assetAdmCd + san + mnnm + slno;
}
function computeValuationAssetValue(a){
  let value;
  switch (a.method){
    case 'land': value = calculateLandValueJS(a.landPrice, a.landArea, 100); break;
    case 'house': case 'apartment': case 'officetel': value = calculateHouseValueJS(a.housePrice, 100); break;
    case 'building': {
      const r = calculateBuildingStandardPriceJS(a.buildingStructure, numVal(a.buildingUse), a.landPriceForBuilding, numVal(a.builtYear), numVal(a.buildingArea), 'inheritance_gift', []);
      value = (r && !r.error) ? r.건물기준시가 : 0;
      break;
    }
    case 'listedStock': {
      const r = calculateListedStockValueJS({
        averageClosingPrice: a.listedPrice, shares: a.listedShares,
        isMajorShareholder: a.lsMajorShareholder, isSmallBusiness: a.lsIsSmallBusiness, isMediumBusinessUnder500B: a.lsIsMediumUnder500B
      });
      value = (typeof r === 'number') ? r : r.상장주식가액;
      break;
    }
    case 'rental': {
      const t = computeRentalLeaseTotals_(a.rentalLeases);
      value = calculateRentalConversionValueJS(t.annualRent, t.deposit);
      break;
    }
    case 'goodwill': value = calculateGoodwillValueJS(a.gwProfit1, a.gwProfit2, a.gwProfit3, a.gwSelfCapital); break;
    case 'groundRight': value = calculateGroundRightValueJS(a.grLandValue, a.grRemainingYears).지상권가액; break;
    case 'patentRight': value = calculatePatentRightValueJS(a.prAnnualIncome, a.prRemainingYears, a.prAcquisitionCost, a.prDepreciation).특허권등가액; break;
    case 'miningRight': value = calculateMiningRightValueJS(a.mrAverageIncome, a.mrMiningYears, a.mrAcquisitionCost, a.mrDepreciation).광업권등가액; break;
    case 'memberRight': {
      const r = calculateMemberRightValueJS({
        formerLandBuildingValue: a.mbFormerValue, expectedRevenueAfterCompletion: a.mbExpectedRevenue,
        totalProjectCost: a.mbProjectCost, totalFormerValue: a.mbTotalFormerValue,
        paidInstallments: a.mbPaidInstallments, premium: a.mbPremium
      });
      value = r.error ? 0 : r.부동산취득권리_평가액;
      break;
    }
    case 'otherTangible': {
      const r = calculateOtherTangiblePropertyValueJS({
        itemType: a.otTangibleType, reacquisitionValue: a.otReacquisitionValue, bookValue: a.otBookValue,
        standardTaxValue: a.otStandardTaxValue, disposalValue: a.otDisposalValue
      });
      value = r.error ? 0 : r.평가액;
      break;
    }
    case 'trustBenefit': {
      const r = calculateTrustBenefitValueJS({
        trustPropertyValue: a.tbPropertyValue, sameBeneficiary: a.tbSameBeneficiary, beneficiaryType: a.tbBeneficiaryType,
        cancellationValue: a.tbCancellationValue, annualBenefits: a.trustAnnualBenefits
      });
      value = r.error ? 0 : r.평가액;
      break;
    }
    case 'periodicPayment': {
      const r = calculatePeriodicPaymentRightValueJS({
        annuityType: a.ppAnnuityType, annualAmount: a.ppAnnualAmount,
        remainingYears: a.ppRemainingYears, lifeExpectancyYears: a.ppLifeExpectancyYears,
        cancellationValue: a.ppCancellationValue
      });
      value = r.error ? 0 : r.평가액;
      break;
    }
    case 'conditionalRight': value = numVal(a.crManualValue) || 0; break;
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
    default: value = numVal(a.directValue) || 0;
  }
  // 저당권·질권 등이 설정된 재산 및 임대차계약이 체결된 재산의 평가특례(상증세법 §66, 시행령 §63①1호) —
  // 시가·보충적평가액, 그 재산이 담보하는 채권액(또는 등기된 전세금), 임대보증금 환산가액(임대보증금+연간임대료÷12%)
  // 중 가장 큰 금액으로 평가한다. 담보채권액·임대보증금은 등기부·임대차계약상 재산 "전체" 기준으로
  // 입력받으므로, 지분을 곱하기 전(전체 재산 기준 금액끼리) 먼저 비교해야 한다 — 지분을 먼저 곱해버리면
  // 전체 기준인 담보채권액·임대보증금과 단위가 안 맞아 지분이 작을수록 담보채권액이 부당하게 이겨버린다.
  // 지분은 셋 중 최댓값을 정한 "다음"에 그 결과 전체에 한 번만 곱한다.
  const securedDebtAmount = numVal(a.securedDebtAmount) || 0;
  const leaseTotals = computeRentalLeaseTotals_(a.rentalLeases);
  const rentalCapValue = (leaseTotals.deposit > 0 || leaseTotals.annualRent > 0) ? calculateRentalConversionValueJS(leaseTotals.annualRent, leaseTotals.deposit) : 0;
  let finalValue = Math.max(value, securedDebtAmount, rentalCapValue);
  if (VALUATION_RATIO_EXEMPT_METHODS.indexOf(a.method) === -1){
    const parsed = parseShareFraction_(a.ownershipRatio);
    const ratio = parsed === null ? 1 : parsed;
    finalValue = finalValue * ratio;
  }
  return finalValue;
}

function valuationAssetMethodFieldsHtml(m, a){
  if (m === 'land') return '' +
    '<div class="taxcalc-field"><label>개별공시지가(원/㎡)</label><input type="number" data-field="landPrice" value="' + (a.landPrice || '') + '"><button type="button" class="taxcalc-ai-btn" data-action="lookup-official-price" data-price-kind="land" style="margin-top:4px;">🔍 공시지가 자동조회</button></div>' +
    '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-field="landArea" value="' + (a.landArea || '') + '"></div>';
  if (m === 'house' || m === 'apartment' || m === 'officetel') return '' +
    '<div class="taxcalc-field"><label>고시된 ' + (m === 'apartment' ? '공동주택가격' : m === 'officetel' ? '오피스텔·상업용건물 기준시가' : '개별주택가격') + '</label><input type="number" data-field="housePrice" value="' + (a.housePrice || '') + '">' +
    (m === 'apartment' ? '<button type="button" class="taxcalc-ai-btn" data-action="lookup-official-price" data-price-kind="apartment" style="margin-top:4px;">🔍 공동주택가격 자동조회</button>' : '') +
    (m === 'house' ? '<button type="button" class="taxcalc-ai-btn" data-action="lookup-official-price" data-price-kind="house" style="margin-top:4px;">🔍 개별주택가격 자동조회</button>' : '') +
    '</div>';
  if (m === 'building'){
    const structureOptions = (window.BUILDING_STRUCTURE_TABLE || []).map(function(s){ return '<option value="' + s.name + '"' + (a.buildingStructure === s.name ? ' selected' : '') + '>' + s.name + '</option>'; }).join('');
    const useOptions = (window.BUILDING_USE_TABLE || []).filter(function(u){ return u.index !== null; }).map(function(u){ return '<option value="' + u.no + '"' + (String(a.buildingUse) === String(u.no) ? ' selected' : '') + '>' + u.no + '. ' + u.desc + '</option>'; }).join('');
    return '<div class="taxcalc-field"><label>구조</label><select data-field="buildingStructure"><option value="">선택</option>' + structureOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>용도</label><select data-field="buildingUse"><option value="">선택</option>' + useOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>신축(증축)연도</label><input type="number" data-field="builtYear" value="' + (a.builtYear || '') + '" maxlength="4"></div>' +
      '<div class="taxcalc-field"><label>건물면적(㎡)</label><input type="number" data-field="buildingArea" value="' + (a.buildingArea || '') + '"></div>' +
      '<div class="taxcalc-field"><label>부속토지 개별공시지가(원/㎡)</label><input type="number" data-field="landPriceForBuilding" value="' + (a.landPriceForBuilding || '') + '"></div>';
  }
  if (m === 'listedStock') return '' +
    '<div class="taxcalc-field"><label>2개월 종가평균(원/주)</label><input type="number" data-field="listedPrice" value="' + (a.listedPrice || '') + '"></div>' +
    '<div class="taxcalc-field"><label>주식수</label><input type="number" data-field="listedShares" value="' + (a.listedShares || '') + '"></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="lsMajorShareholder" ' + (a.lsMajorShareholder ? 'checked' : '') + '><label>최대주주 등 할증(20%, §63③)</label></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="lsIsSmallBusiness" ' + (a.lsIsSmallBusiness ? 'checked' : '') + '><label>중소기업이 발행한 주식(할증 배제)</label></div>' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="lsIsMediumUnder500B" ' + (a.lsIsMediumUnder500B ? 'checked' : '') + '><label>중견기업(직전3년 매출평균 5천억 미만)이 발행한 주식(할증 배제)</label></div>';
  if (m === 'rental'){
    return '<div class="taxcalc-field"><label style="color:var(--sub);">※ 아래 "임대차 내역"에서 자동 합산된 금액으로 환산가액을 계산합니다. 이 값과 별도로 계산한 기준시가 중 큰 금액을 실제 평가액으로 쓰세요</label></div>';
  }
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
  if (m === 'goodwill') return '' +
    '<div class="taxcalc-field"><label>1년전 순손익액</label><input type="number" data-field="gwProfit1" value="' + (a.gwProfit1 || '') + '"></div>' +
    '<div class="taxcalc-field"><label>2년전 순손익액</label><input type="number" data-field="gwProfit2" value="' + (a.gwProfit2 || '') + '"></div>' +
    '<div class="taxcalc-field"><label>3년전 순손익액</label><input type="number" data-field="gwProfit3" value="' + (a.gwProfit3 || '') + '"></div>' +
    '<div class="taxcalc-field"><label>자기자본(평가기준일 현재)</label><input type="number" data-field="gwSelfCapital" value="' + (a.gwSelfCapital || '') + '"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 가중평균순손익액×50%가 자기자본×10%를 넘는 초과분만 5년 연금현가(3.79079)로 평가되며, 넘지 않으면 0원입니다</label></div>';
  if (m === 'otherTangible') {
    const isCommodity = a.otTangibleType === 'commodity';
    const isArt = a.otTangibleType === 'art_antique';
    return '<div class="taxcalc-field"><label>구분</label><select data-field="otTangibleType">' +
        '<option value="vessel_etc"' + (a.otTangibleType === 'vessel_etc' || !a.otTangibleType ? ' selected' : '') + '>선박·항공기·차량·기계장비·입목</option>' +
        '<option value="commodity"' + (isCommodity ? ' selected' : '') + '>상품·제품·반제품·원재료 등 동산</option>' +
        '<option value="art_antique"' + (isArt ? ' selected' : '') + '>서화·골동품 등 예술적 가치가 있는 유형재산</option>' +
      '</select></div>' +
      (isArt ? '<div class="taxcalc-field"><label style="color:var(--sub);">※ 전문분야별 2개 이상 전문감정기관의 감정가액 평균액이 필요합니다(시행령§52②2호) — 감정평가를 받아 위 "직접입력" 방식으로 그 평균액을 입력하세요.</label></div>' :
        isCommodity ? '' +
          '<div class="taxcalc-field"><label>처분예상가액</label><input type="number" data-field="otDisposalValue" value="' + (a.otDisposalValue || '') + '"></div>' +
          '<div class="taxcalc-field"><label>장부가액(처분예상가액 확인 안 될 때)</label><input type="number" data-field="otBookValue" value="' + (a.otBookValue || '') + '"></div>'
        : '' +
          '<div class="taxcalc-field"><label>재취득예상가액</label><input type="number" data-field="otReacquisitionValue" value="' + (a.otReacquisitionValue || '') + '"></div>' +
          '<div class="taxcalc-field"><label>장부가액(취득가액-감가상각비, 재취득예상가액 없을 때)</label><input type="number" data-field="otBookValue" value="' + (a.otBookValue || '') + '"></div>' +
          '<div class="taxcalc-field"><label>지방세법시행령§4① 시가표준액(둘 다 없을 때)</label><input type="number" data-field="otStandardTaxValue" value="' + (a.otStandardTaxValue || '') + '"></div>');
  }
  if (m === 'trustBenefit') return '' +
    '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="tbSameBeneficiary" ' + (a.tbSameBeneficiary ? 'checked' : '') + '><label>원본을 받을 권리와 수익을 받을 권리의 수익자가 같음(상증세법시행령§61①1호 — 신탁재산가액 그대로 평가)</label></div>' +
    '<div class="taxcalc-field"><label>신탁재산가액</label><input type="number" data-field="tbPropertyValue" value="' + (a.tbPropertyValue || '') + '"></div>' +
    (a.tbSameBeneficiary ? '' :
      '<div class="taxcalc-field"><label>평가 대상 권리</label><select data-field="tbBeneficiaryType">' +
        '<option value="">선택</option>' +
        '<option value="income"' + (a.tbBeneficiaryType === 'income' ? ' selected' : '') + '>수익을 받을 권리(상증세법시행령§61①2호나목)</option>' +
        '<option value="principal"' + (a.tbBeneficiaryType === 'principal' ? ' selected' : '') + '>원본을 받을 권리(상증세법시행령§61①2호가목)</option>' +
      '</select></div>') +
    '<div class="taxcalc-field"><label>해지시 받을 일시금(있으면)</label><input type="number" data-field="tbCancellationValue" placeholder="원 (신탁 철회·해지·취소로 받을 수 있는 일시금 — 이보다 크면 이 금액을 그대로 평가액으로 씀)" value="' + (a.tbCancellationValue || '') + '"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 연 이자율 1,000분의 30(상증세법시행규칙§14①)으로 각 연도 수익의 현재가치를 할인합니다. 아래 "신탁 수익 내역"에서 연도별로 입력하세요</label></div>';
  if (m === 'periodicPayment') return '' +
    '<div class="taxcalc-field"><label>정기금 종류</label><select data-field="ppAnnuityType">' +
      '<option value="">선택</option>' +
      '<option value="fixed_term"' + (a.ppAnnuityType === 'fixed_term' ? ' selected' : '') + '>유기정기금(잔존기간 정해짐)</option>' +
      '<option value="perpetual"' + (a.ppAnnuityType === 'perpetual' ? ' selected' : '') + '>무기정기금(기간 없음)</option>' +
      '<option value="lifetime"' + (a.ppAnnuityType === 'lifetime' ? ' selected' : '') + '>종신정기금(받을 자 생존기간)</option>' +
    '</select></div>' +
    '<div class="taxcalc-field"><label>1년분 정기금액</label><input type="number" data-field="ppAnnualAmount" value="' + (a.ppAnnualAmount || '') + '" placeholder="원 (매년 동일 가정)"></div>' +
    (a.ppAnnuityType === 'fixed_term' ? '<div class="taxcalc-field"><label>잔존기간</label><input type="number" data-field="ppRemainingYears" value="' + (a.ppRemainingYears || '') + '" placeholder="년"></div>' : '') +
    (a.ppAnnuityType === 'lifetime' ? '<div class="taxcalc-field"><label>기대여명 연수</label><input type="number" data-field="ppLifeExpectancyYears" value="' + (a.ppLifeExpectancyYears || '') + '" placeholder="년 (통계청 고시 성별·연령별 기대여명, 소수점 버림)"></div>' : '') +
    '<div class="taxcalc-field"><label>해지시 받을 일시금(있으면)</label><input type="number" data-field="ppCancellationValue" value="' + (a.ppCancellationValue || '') + '" placeholder="원 (계약 철회·해지·취소로 받을 일시금 — 이보다 크면 이 금액을 씀)"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 유기·종신정기금은 매년 정기금액을 연3% 할인율로 현재가치화한 합계(유기는 1년분의 20배 한도), 무기정기금은 1년분의 20배 정액입니다(§65①, 시행령§62)</label></div>';
  if (m === 'conditionalRight') return '' +
    '<div class="taxcalc-field"><label>권리 유형</label><select data-field="crRightType">' +
      '<option value="">선택</option>' +
      '<option value="conditional"' + (a.crRightType === 'conditional' ? ' selected' : '') + '>조건부 권리</option>' +
      '<option value="undetermined_duration"' + (a.crRightType === 'undetermined_duration' ? ' selected' : '') + '>존속기간이 확정되지 않은 권리</option>' +
      '<option value="litigation"' + (a.crRightType === 'litigation' ? ' selected' : '') + '>소송 중인 권리</option>' +
    '</select></div>' +
    (a.crRightType ? '<div class="taxcalc-field"><label style="color:var(--sub);">※ ' + (explainConditionalRightValuationFactorsJS({ rightType: a.crRightType }).안내 || '') + '</label></div>' : '') +
    '<div class="taxcalc-field"><label>전문가 평가 등으로 확정한 적정가액</label><input type="number" data-field="crManualValue" value="' + (a.crManualValue || '') + '" placeholder="원 — 이 계산기는 금액을 산출하지 않으므로 직접 입력"></div>';
  if (m === 'groundRight') return '' +
    '<div class="taxcalc-field"><label>지상권이 설정된 토지가액</label><input type="number" data-field="grLandValue" value="' + (a.grLandValue || '') + '"></div>' +
    '<div class="taxcalc-field"><label>잔존연수</label><input type="number" data-field="grRemainingYears" value="' + (a.grRemainingYears || '') + '" placeholder="년 (민법§280·281 준용)"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 토지가액의 연 2%를 매년 수입금액으로 보고, 잔존연수만큼 연 10% 할인율로 현재가치화합니다(시행규칙§16①②)</label></div>';
  if (m === 'patentRight') return '' +
    '<div class="taxcalc-field"><label>각 연도 수입금액</label><input type="number" data-field="prAnnualIncome" value="' + (a.prAnnualIncome || '') + '" placeholder="확정되지 않았으면 평가기준일 전 3년 평균 수입금액"></div>' +
    '<div class="taxcalc-field"><label>평가기준일부터의 잔존(경과)연수</label><input type="number" data-field="prRemainingYears" value="' + (a.prRemainingYears || '') + '" placeholder="년 (20년 초과시 20년)"></div>' +
    '<div class="taxcalc-field"><label>[매입한 경우만] 취득가액</label><input type="number" data-field="prAcquisitionCost" value="' + (a.prAcquisitionCost || '') + '" placeholder="원 (자체개발·출원 등이면 비움)"></div>' +
    '<div class="taxcalc-field"><label>[취득가액 입력시] 취득일~평가기준일 감가상각비 누계</label><input type="number" data-field="prDepreciation" value="' + (a.prDepreciation || '') + '" placeholder="원 (없으면 0)"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 연도별 수입금액을 잔존연수만큼 연 10% 할인율로 현재가치화한 금액과, 매입가액이 있으면 그 취득가액에서 감가상각비를 뺀 금액 중 큰 금액입니다(§64, 시행규칙§19②③④)</label></div>';
  if (m === 'miningRight') return '' +
    '<div class="taxcalc-field"><label>평가기준일전 3년간 평균소득</label><input type="number" data-field="mrAverageIncome" value="' + (a.mrAverageIncome || '') + '" placeholder="실적 없으면 예상순소득"></div>' +
    '<div class="taxcalc-field"><label>채굴가능연수</label><input type="number" data-field="mrMiningYears" value="' + (a.mrMiningYears || '') + '" placeholder="년"></div>' +
    '<div class="taxcalc-field"><label>[매입한 경우만] 취득가액</label><input type="number" data-field="mrAcquisitionCost" value="' + (a.mrAcquisitionCost || '') + '" placeholder="원 (비움 가능)"></div>' +
    '<div class="taxcalc-field"><label>[취득가액 입력시] 취득일~평가기준일 감가상각비 누계</label><input type="number" data-field="mrDepreciation" value="' + (a.mrDepreciation || '') + '" placeholder="원 (없으면 0)"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 3년평균소득을 채굴가능연수만큼 연 10% 할인율로 현재가치화한 금액과, 매입가액이 있으면 그 취득가액에서 감가상각비를 뺀 금액 중 큰 금액입니다(§64, 시행규칙§19⑤)</label></div>';
  if (m === 'memberRight') return '' +
    '<div class="taxcalc-field"><label>분양대상자의 종전 토지·건축물 가격</label><input type="number" data-field="mbFormerValue" value="' + (a.mbFormerValue || '') + '"></div>' +
    '<div class="taxcalc-field"><label>정비사업완료후 대지·건축물의 총 수입추산액</label><input type="number" data-field="mbExpectedRevenue" value="' + (a.mbExpectedRevenue || '') + '"></div>' +
    '<div class="taxcalc-field"><label>총 소요사업비</label><input type="number" data-field="mbProjectCost" value="' + (a.mbProjectCost || '') + '"></div>' +
    '<div class="taxcalc-field"><label>종전 토지·건축물의 총 가액</label><input type="number" data-field="mbTotalFormerValue" value="' + (a.mbTotalFormerValue || '') + '"></div>' +
    '<div class="taxcalc-field"><label>평가기준일까지 납입한 계약금·중도금 등</label><input type="number" data-field="mbPaidInstallments" value="' + (a.mbPaidInstallments || '') + '"></div>' +
    '<div class="taxcalc-field"><label>평가기준일 현재 프리미엄상당액</label><input type="number" data-field="mbPremium" value="' + (a.mbPremium || '') + '"></div>' +
    '<div class="taxcalc-field"><label style="color:var(--sub);">※ 도시및주거환경정비법§74① 관리처분계획 기준 조합원권리가액(시행령§51②, 시행규칙§16③)에 납입금·프리미엄을 더한 금액입니다</label></div>';
  return '<div class="taxcalc-field"><label>평가액</label><input type="number" data-field="directValue" value="' + (a.directValue || '') + '"><button type="button" class="taxcalc-ai-btn" data-action="lookup-real-price" style="margin-top:4px;">🔍 아파트 실거래가 조회(참고)</button></div>';
}

// 임대차 내역은 자산의 평가방법과 무관하게(§66 평가특례의 담보·임대보증금 캡 비교, §61⑤ 임대료환산가액
// 계산 모두에) 공통으로 쓰이므로, 평가방법을 뭘 고르든 항상 같은 자리에서 호실별로 입력받아 자동합산한다.
function renderRentalLeasesSectionHtml_(a){
  const leases = (Array.isArray(a.rentalLeases) && a.rentalLeases.length) ? a.rentalLeases : [{}];
  const totals = computeRentalLeaseTotals_(leases);
  const leaseRowsHtml = leases.map(function(l, lidx){
    return '<div class="taxcalc-grid" data-lease-idx="' + lidx + '" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>호실/구분</label><input type="text" data-lfield="unitLabel" value="' + (l.unitLabel || '').replace(/"/g,'&quot;') + '" placeholder="예: 101호"></div>' +
      '<div class="taxcalc-field"><label>성명</label><input type="text" data-lfield="tenantName" value="' + (l.tenantName || '').replace(/"/g,'&quot;') + '" placeholder="예: 홍길동 또는 OO상회"></div>' +
      '<div class="taxcalc-field"><label>주민번호</label><input type="text" data-lfield="tenantBizNo" value="' + (l.tenantBizNo || '').replace(/"/g,'&quot;') + '" placeholder="사업자 123-45-67890 / 개인 000000-0000000"><button type="button" class="taxcalc-ai-btn" data-action="check-bizno" style="margin-top:4px;">🔍 확인</button><span class="taxcalc-result-note" data-bizno-result style="margin:2px 0 0;"></span></div>' +
      '<div class="taxcalc-field"><label>임대보증금</label><input type="number" data-lfield="deposit" value="' + (l.deposit || '') + '"></div>' +
      '<div class="taxcalc-field"><label>월세</label><input type="number" data-lfield="monthlyRent" value="' + (l.monthlyRent || '') + '"></div>' +
      (leases.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-rental-lease" data-idx="' + lidx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');
  return '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>임대차 내역</b></div>' +
    leaseRowsHtml +
    '<button type="button" class="taxcalc-add-asset" data-action="add-rental-lease" style="margin-top:6px;">+ 임대차 추가</button>' +
    '<div class="taxcalc-result-note" data-rental-hint="1">보증금 합계 ' + won(totals.deposit) + ' · 연간임대료 합계 ' + won(totals.annualRent) + '</div>';
}
// 신탁의 이익을 받을 권리(상증세법시행령§61①2호나목) 평가는 "각 연도에 받을 수익의 이익"을 연도별로
// 따로 현재가치할인해서 더해야 하므로, 임대차 내역처럼 연도별 행을 여러 개 입력받는다.
function renderTrustBenefitsSectionHtml_(a){
  const benefits = (Array.isArray(a.trustAnnualBenefits) && a.trustAnnualBenefits.length) ? a.trustAnnualBenefits : [{}];
  const rowsHtml = benefits.map(function(b, bidx){
    const undetermined = !!b.isRateUndetermined;
    return '<div class="taxcalc-grid" data-tb-idx="' + bidx + '" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>평가기준일부터 수익시기까지 연수(n)</label><input type="number" data-tbfield="yearsFromValuation" value="' + (b.yearsFromValuation || '') + '"></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" data-tbfield="isRateUndetermined" ' + (undetermined ? 'checked' : '') + '><label>수익률 미확정(시행규칙§14② — 신탁재산가액×3%로 추산)</label></div>' +
      (undetermined ? '' : '<div class="taxcalc-field"><label>그 연도에 받을 수익의 이익</label><input type="number" data-tbfield="annualBenefit" value="' + (b.annualBenefit || '') + '"></div>') +
      '<div class="taxcalc-field"><label>원천징수세액상당액</label><input type="number" data-tbfield="withholdingTaxEquivalent" value="' + (b.withholdingTaxEquivalent || '') + '"></div>' +
      (benefits.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-trust-benefit" data-idx="' + bidx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');
  return '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>신탁 수익 내역(연도별)</b></div>' +
    rowsHtml +
    '<button type="button" class="taxcalc-add-asset" data-action="add-trust-benefit" style="margin-top:6px;">+ 연도 추가</button>';
}
// 상속인별 실제상속재산가액은 상속인 명부에서 지분을 미리 적어 넣는 게 아니라, 협의분할·유언에
// 따라 "이 자산을 누가 받는지"를 자산별로 배분해야 정해지는 값이다(법정상속지분은 이것과 별개로
// recomputeSpouseRatio()가 배우자공제 한도용으로 자동계산). 자산 하나를 여러 상속인이 나눠 받을 수도
// 있으므로 임대차 내역처럼 행을 여러 개 추가할 수 있게 한다.
function renderHeirAllocationSectionHtml_(a){
  if (!inheritanceHeirs.length) return '';
  const allocations = (Array.isArray(a.heirAllocations) && a.heirAllocations.length) ? a.heirAllocations : [{}];
  const rowsHtml = allocations.map(function(al, alidx){
    const heirOptionsHtml = inheritanceHeirs.map(function(h, hidx){
      return '<option value="' + hidx + '"' + (String(al.heirIdx) === String(hidx) ? ' selected' : '') + '>' + (h.name || ('상속인' + (hidx + 1))) + (h.relation ? ' (' + h.relation + ')' : '') + '</option>';
    }).join('');
    return '<div class="taxcalc-grid" data-alloc-idx="' + alidx + '" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>받는 상속인</label><select data-hafield="heirIdx"><option value="">선택</option>' +
        heirOptionsHtml +
      '</select></div>' +
      '<div class="taxcalc-field"><label>배분(분수, 예: 1/2 · 기본 전부)</label><input type="text" data-hafield="ratio" placeholder="1/1" value="' + (al.ratio || '').replace(/"/g, '&quot;') + '"></div>' +
      (allocations.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-heir-alloc" data-idx="' + alidx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');
  return '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>상속인별 배분(협의분할·유언 등 실제 귀속) — 비워두면 이 자산은 실제상속재산가액 계산에서 빠집니다</b></div>' +
    rowsHtml +
    '<button type="button" class="taxcalc-add-asset" data-action="add-heir-alloc" style="margin-top:6px;">+ 배분 추가</button>';
}
function renderValuationAssetRow(a, idx, isInheritance){
  const method = a.method || 'direct';
  const value = computeValuationAssetValue(a);
  return '' +
    '<div class="taxcalc-asset" data-idx="' + idx + '">' +
      '<div class="taxcalc-asset-head"><b>자산 ' + (idx + 1) + '</b><button type="button" class="taxcalc-del-asset" data-action="del-valuation-asset" data-idx="' + idx + '">✕ 삭제</button></div>' +
      '<div class="taxcalc-grid">' +
        assetDetailFieldsHtml_(a) +
        '<div class="taxcalc-field"><label>평가방법</label><select data-field="method">' +
          Object.keys(VALUATION_METHOD_LABELS).map(function (k) { return '<option value="' + k + '"' + (method === k ? ' selected' : '') + '>' + VALUATION_METHOD_LABELS[k] + '</option>'; }).join('') +
        '</select></div>' +
        (VALUATION_RATIO_EXEMPT_METHODS.indexOf(method) === -1 ?
          '<div class="taxcalc-field"><label>피상속인(증여자) 지분</label><input type="text" data-field="ownershipRatio" placeholder="1/1" value="' + (a.ownershipRatio || '').replace(/"/g, '&quot;') + '"></div>' : '') +
        '<div class="taxcalc-field"><label>담보채권액(저당권·질권 등, §66)</label><input type="number" data-field="securedDebtAmount" placeholder="원 (있으면 시가/보충적평가액과 비교해 큰 금액 적용)" value="' + (a.securedDebtAmount || '') + '"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isBusinessAsset" id="vaBiz-' + idx + '"' + (a.isBusinessAsset ? ' checked' : '') + '><label for="vaBiz-' + idx + '">사업용자산(가업상속공제용, 상속세일 때만 자동집계)</label></div>' +
      '</div>' +
      '<div class="taxcalc-grid" style="margin-top:6px;">' + valuationAssetMethodFieldsHtml(method, a) + '</div>' +
      renderRentalLeasesSectionHtml_(a) +
      (method === 'trustBenefit' && !a.tbSameBeneficiary ? renderTrustBenefitsSectionHtml_(a) : '') +
      (isInheritance ? renderHeirAllocationSectionHtml_(a) : '') +
      '<div class="taxcalc-result-row"><span>평가액</span><span class="v">' + won(value) + '</span></div>' +
    '</div>';
}

// 가업상속공제(§18의2, 개인사업)는 "사업용자산 순액"이 있어야 계산되는데, 이걸 손으로 다시 더해
// 입력하게 하지 않고 위 상속재산 명세에서 "사업용자산" 체크된 항목들의 평가액을 자동으로 합산한다.
function recomputeBusinessAssetTotal_(containerId, assets){
  if (containerId !== 'inheritanceValuationList') return;
  const el = document.getElementById('ihBusinessIndividualNet');
  if (!el) return;
  const total = assets.filter(function(a){ return a.isBusinessAsset; }).reduce(function(s, a){ return s + computeValuationAssetValue(a); }, 0);
  el.value = String(total);
}
// 임대보증금은 언젠가 돌려줘야 할 채무(임대보증금반환채무)이므로, 자산 목록에 입력된 모든 임대차의
// 보증금 합계를 자동으로 더해서 "자산 평가액 합계"에서 빼줄 수 있게 한다(순재산가액 = 자산가액-채무).
function computeTotalRentalDepositDebt_(assets){
  return assets.reduce(function(s, a){ return s + computeRentalLeaseTotals_(a.rentalLeases).deposit; }, 0);
}
function renderValuationAssetList(containerId, assets){
  const container = document.getElementById(containerId);
  if (!container) return;
  const isInheritance = containerId === 'inheritanceValuationList';
  const total = assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0);
  const depositDebt = computeTotalRentalDepositDebt_(assets);
  container.innerHTML =
    assets.map(function (a, idx) { return renderValuationAssetRow(a, idx, isInheritance); }).join('') +
    '<button type="button" class="taxcalc-add-asset" data-action="add-valuation-asset" data-target="' + containerId + '">+ 자산 추가</button>' +
    (assets.length ? '<div class="taxcalc-result-row total"><span>자산 평가액 합계</span><span class="v">' + won(total) + '</span></div>' +
      (depositDebt > 0 ? '<div class="taxcalc-result-row" data-debt-row="1"><span>임대보증금반환채무 합계(자동집계)</span><span class="v">-' + won(depositDebt) + '</span></div>' +
        '<div class="taxcalc-result-row total" data-net-row="1"><span>순자산가액(자산가액-임대보증금채무)</span><span class="v">' + won(Math.max(0, total - depositDebt)) + '</span></div>' : '') +
      '<button type="button" class="taxcalc-run-btn" data-action="apply-valuation-total" data-target="' + containerId + '">이 합계를 위 금액란에 반영</button>' : '');

  container.querySelectorAll('[data-field]').forEach(function (el) {
    el.addEventListener((el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input', function () {
      const idx = numVal(el.closest('.taxcalc-asset').dataset.idx);
      const key = el.dataset.field;
      assets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'method' || key === 'assetKind' || key === 'tbSameBeneficiary' || key === 'otTangibleType' || key === 'ppAnnuityType' || key === 'crRightType'){
        renderValuationAssetList(containerId, assets); // 필드 구성 자체가 바뀌므로 다시 그림
      } else {
        const row = el.closest('.taxcalc-asset');
        row.querySelector('.taxcalc-result-row .v').textContent = won(computeValuationAssetValue(assets[idx]));
        const totalEl = container.querySelector('.taxcalc-result-row.total .v');
        if (totalEl) totalEl.textContent = won(assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0));
        recomputeBusinessAssetTotal_(containerId, assets);
      }
    });
  });
  container.querySelectorAll('[data-lfield]').forEach(function (el) {
    el.addEventListener('input', function () {
      const assetIdx = numVal(el.closest('.taxcalc-asset').dataset.idx);
      const leaseIdx = numVal(el.closest('[data-lease-idx]').dataset.leaseIdx);
      const key = el.dataset.lfield;
      if (!Array.isArray(assets[assetIdx].rentalLeases)) assets[assetIdx].rentalLeases = [{}];
      assets[assetIdx].rentalLeases[leaseIdx][key] = el.value;
      const row = el.closest('.taxcalc-asset');
      row.querySelector('.taxcalc-result-row .v').textContent = won(computeValuationAssetValue(assets[assetIdx]));
      const totals = computeRentalLeaseTotals_(assets[assetIdx].rentalLeases);
      const hintEl = row.querySelector('[data-rental-hint]');
      if (hintEl) hintEl.textContent = '보증금 합계 ' + won(totals.deposit) + ' · 연간임대료 합계 ' + won(totals.annualRent);
      const newTotal = assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0);
      const totalEl = container.querySelector('.taxcalc-result-row.total .v');
      if (totalEl) totalEl.textContent = won(newTotal);
      const newDebt = computeTotalRentalDepositDebt_(assets);
      const debtRowEl = container.querySelector('[data-debt-row] .v');
      const netRowEl = container.querySelector('[data-net-row] .v');
      if (debtRowEl) debtRowEl.textContent = '-' + won(newDebt);
      if (netRowEl) netRowEl.textContent = won(Math.max(0, newTotal - newDebt));
      if (newDebt > 0 && !debtRowEl) renderValuationAssetList(containerId, assets); // 채무가 새로 생긴 경우에만 합계행을 새로 그림
      recomputeBusinessAssetTotal_(containerId, assets);
    });
  });
  container.querySelectorAll('[data-tbfield]').forEach(function (el) {
    el.addEventListener((el.type === 'checkbox') ? 'change' : 'input', function () {
      const assetIdx = numVal(el.closest('.taxcalc-asset').dataset.idx);
      const benefitIdx = numVal(el.closest('[data-tb-idx]').dataset.tbIdx);
      const key = el.dataset.tbfield;
      if (!Array.isArray(assets[assetIdx].trustAnnualBenefits)) assets[assetIdx].trustAnnualBenefits = [{}];
      assets[assetIdx].trustAnnualBenefits[benefitIdx][key] = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'isRateUndetermined') { renderValuationAssetList(containerId, assets); return; } // 수익금 입력란 표시 여부가 바뀌므로 다시 그림
      const row = el.closest('.taxcalc-asset');
      row.querySelector('.taxcalc-result-row .v').textContent = won(computeValuationAssetValue(assets[assetIdx]));
      const totalEl = container.querySelector('.taxcalc-result-row.total .v');
      if (totalEl) totalEl.textContent = won(assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0));
    });
  });
  container.querySelectorAll('[data-hafield]').forEach(function (el) {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
      const assetIdx = numVal(el.closest('.taxcalc-asset').dataset.idx);
      const allocIdx = numVal(el.closest('[data-alloc-idx]').dataset.allocIdx);
      const key = el.dataset.hafield;
      if (!Array.isArray(assets[assetIdx].heirAllocations)) assets[assetIdx].heirAllocations = [{}];
      assets[assetIdx].heirAllocations[allocIdx][key] = el.value;
      updateHeirActualValueHints();
    });
  });
  recomputeBusinessAssetTotal_(containerId, assets);
  enhanceNumberInputs(container);
}

// ---- 양도소득세 (다건 합산) ----
let transferAssets = [{}]; // 각 원소는 입력값 객체(비어있는 채로 시작)
let transferBulkAiState = {}; // 증빙 일괄 자동입력(사건폴더 전체 스캔) 진행상태 — 거래행이 아직 없을 때도 보여줄 상단 배지용

// ---- 안분계산 도구(소득세법 시행령 §166④) ----
let allocationAssets = [{}, {}];

const ALLOCATION_METHOD_LABELS = {
  standard_price: '양도가액 안분 (기준시가·감정가액 비율)',
  standard_price_vat: '양도가액 안분(부가세 포함, 건물분 VAT 분리)',
  area: '면적 안분',
  acq_expense_together: '취득/필요경비 함께 안분(양도시 비율 동일 적용)',
  acq_expense_separate: '취득/필요경비 각각 안분(취득시 비율 별도 적용)'
};

// 안분계산 도구는 "기준시가를 이미 알고 있다"고 가정하고 그 숫자를 바로 입력받지 않는다 — 토지는
// 개별공시지가×면적, 건물은 건물기준시가계산기와 똑같은 원시데이터(구조·용도·신축연도·면적·부속토지
// 공시지가)를 입력받아 시스템이 직접 산출한다. 이미 감정가액 등 최종금액을 알고 있는 경우에만
// "직접입력"을 고르면 된다.
function computeAllocationRowStandardPrice_(a, timing){
  const type = a.componentType || 'land';
  if (type === 'land'){
    const price = numVal(a['landPricePerSqm' + timing]);
    const area = numVal(a.landArea);
    return calculateLandValueJS(price, area, 100);
  }
  if (type === 'building'){
    const price = numVal(a['buildingLandPricePerSqm' + timing]);
    if (!a.buildingStructure || !a.buildingUse || !price || !a.builtYear || !a.buildingArea) return 0;
    const r = calculateBuildingStandardPriceJS(a.buildingStructure, numVal(a.buildingUse), price, numVal(a.builtYear), numVal(a.buildingArea), 'transfer', []);
    return (r && !r.error) ? r.건물기준시가 : 0;
  }
  return numVal(a['standardPrice' + timing]);
}
function allocationRowComponentFieldsHtml_(a, showAcqStd){
  const type = a.componentType || 'land';
  if (type === 'land'){
    return '<div class="taxcalc-field"><label>개별공시지가(원/㎡, 양도시)</label><input type="number" data-afield="landPricePerSqmTransfer" value="' + (a.landPricePerSqmTransfer || '') + '"></div>' +
      '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-afield="landArea" value="' + (a.landArea || '') + '"></div>' +
      (showAcqStd ? '<div class="taxcalc-field"><label>개별공시지가(원/㎡, 취득시)</label><input type="number" data-afield="landPricePerSqmAcquisition" value="' + (a.landPricePerSqmAcquisition || '') + '"></div>' : '');
  }
  if (type === 'building'){
    const structureOptions = (window.BUILDING_STRUCTURE_TABLE || []).map(function(s){ return '<option value="' + s.name + '"' + (a.buildingStructure === s.name ? ' selected' : '') + '>' + s.name + '</option>'; }).join('');
    const useOptions = (window.BUILDING_USE_TABLE || []).filter(function(u){ return u.index !== null; }).map(function(u){ return '<option value="' + u.no + '"' + (String(a.buildingUse) === String(u.no) ? ' selected' : '') + '>' + u.no + '. ' + u.desc + '</option>'; }).join('');
    return '<div class="taxcalc-field"><label>구조</label><select data-afield="buildingStructure"><option value="">선택</option>' + structureOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>용도</label><select data-afield="buildingUse"><option value="">선택</option>' + useOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>신축(증축)연도</label><input type="number" data-afield="builtYear" value="' + (a.builtYear || '') + '" maxlength="4"></div>' +
      '<div class="taxcalc-field"><label>건물면적(㎡)</label><input type="number" data-afield="buildingArea" value="' + (a.buildingArea || '') + '"></div>' +
      '<div class="taxcalc-field"><label>부속토지 개별공시지가(원/㎡, 양도시)</label><input type="number" data-afield="buildingLandPricePerSqmTransfer" value="' + (a.buildingLandPricePerSqmTransfer || '') + '"></div>' +
      (showAcqStd ? '<div class="taxcalc-field"><label>부속토지 개별공시지가(원/㎡, 취득시)</label><input type="number" data-afield="buildingLandPricePerSqmAcquisition" value="' + (a.buildingLandPricePerSqmAcquisition || '') + '"></div>' : '');
  }
  return '<div class="taxcalc-field"><label>기준시가(양도시, 감정가액 등 직접입력)</label><input type="number" data-afield="standardPriceTransfer" value="' + (a.standardPriceTransfer || '') + '"></div>' +
    (showAcqStd ? '<div class="taxcalc-field"><label>기준시가(취득시)</label><input type="number" data-afield="standardPriceAcquisition" value="' + (a.standardPriceAcquisition || '') + '"></div>' : '');
}
function renderAllocationTool(){
  const box = document.getElementById('taxCalcAllocationTool');
  if (!box) return;
  const method = box.dataset.method || 'standard_price';
  const showAcq = method === 'acq_expense_together' || method === 'acq_expense_separate';
  const showAcqStd = method === 'acq_expense_separate';
  const showArea = method === 'area';
  const showVat = method === 'standard_price_vat';

  const rowsHtml = allocationAssets.map(function(a, idx){
    const componentType = a.componentType || 'land';
    const computedTransfer = showArea ? null : computeAllocationRowStandardPrice_(a, 'Transfer');
    return '<div class="taxcalc-grid" data-alloc-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>자산명</label><input type="text" data-afield="label" value="' + (a.label || '').replace(/"/g,'&quot;') + '" placeholder="예: 토지 / 건물"></div>' +
      (showArea
        ? '<div class="taxcalc-field"><label>면적</label><input type="number" data-afield="area" value="' + (a.area || '') + '" placeholder="㎡"></div>'
        : '<div class="taxcalc-field"><label>구성요소</label><select data-afield="componentType">' +
            '<option value="land"' + (componentType === 'land' ? ' selected' : '') + '>토지(개별공시지가 입력 → 자동계산)</option>' +
            '<option value="building"' + (componentType === 'building' ? ' selected' : '') + '>건물(구조·용도 등 입력 → 자동계산, 건물기준시가계산기와 동일)</option>' +
            '<option value="direct"' + (componentType === 'direct' ? ' selected' : '') + '>직접입력(감정가액 등 이미 아는 금액)</option>' +
          '</select></div>') +
      (showArea ? '' : allocationRowComponentFieldsHtml_(a, showAcqStd)) +
      (showArea ? '' : '<div class="taxcalc-field"><span class="taxcalc-result-note" data-alloc-computed="1" style="margin:0;">기준시가(양도시) 자동계산 = ' + won(computedTransfer) + '</span></div>') +
      (showVat ? '<div class="taxcalc-field checkbox"><input type="checkbox" data-afield="isBuilding" id="allocBldg-' + idx + '"' + (a.isBuilding ? ' checked' : '') + '><label for="allocBldg-' + idx + '">건물분(부가세 과세대상)</label></div>' : '') +
      (allocationAssets.length > 2 ? '<button type="button" class="taxcalc-del-asset" data-action="del-alloc-asset" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  box.innerHTML =
    '<div class="taxcalc-asset" style="margin-top:10px;">' +
      '<div class="taxcalc-asset-head"><b>토지·건물 등을 함께 양도했다면(안분계산, 소득세법 시행령§166④) — 계산하면 거래 목록에 자동으로 추가됩니다</b></div>' +
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
    el.addEventListener((el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input', function(){
      const idx = numVal(el.closest('[data-alloc-idx]').dataset.allocIdx);
      const key = el.dataset.afield;
      allocationAssets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'componentType' || key === 'buildingStructure' || key === 'buildingUse'){
        renderAllocationTool(); // 구성요소·구조·용도가 바뀌면 입력칸 구성 자체가 달라지므로 다시 그림
      } else {
        const row = el.closest('[data-alloc-idx]');
        const hintEl = row.querySelector('[data-alloc-computed]');
        if (hintEl) hintEl.textContent = '기준시가(양도시) 자동계산 = ' + won(computeAllocationRowStandardPrice_(allocationAssets[idx], 'Transfer'));
      }
    });
  });
  enhanceNumberInputs(box);
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
  });
  html += '<div class="taxcalc-result-note">위 자산별 결과가 이미 아래 거래 목록에 자동으로 추가되었습니다. ' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
  box.dataset.lastResult = JSON.stringify(r);
}

// ---- 건물기준시가 계산기(층별/부속시설별 상세) ----
let buildingPriceRows = [{}];

function renderBuildingPriceTool(){
  const box = document.getElementById('taxCalcBuildingPriceTool');
  if (!box) return;
  const taxType = box.dataset.taxType || 'transfer';

  const rowsHtml = buildingPriceRows.map(function(r, idx){
    const structureOptions = BUILDING_STRUCTURE_TABLE.map(function(s){ return '<option value="' + s.name + '"' + (r.structureName === s.name ? ' selected' : '') + '>' + s.name + '</option>'; }).join('');
    const useOptions = BUILDING_USE_TABLE.filter(function(u){ return u.index !== null; }).map(function(u){ return '<option value="' + u.no + '"' + (String(r.useNo) === String(u.no) ? ' selected' : '') + '>' + u.no + '. ' + u.desc + '</option>'; }).join('');
    return '<div class="taxcalc-grid" data-bp-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>구분</label><input type="text" data-bfield="label" value="' + (r.label || '').replace(/"/g,'&quot;') + '" placeholder="예: 1층 / 지하주차장"></div>' +
      '<div class="taxcalc-field"><label>구조</label><select data-bfield="structureName"><option value="">선택</option>' + structureOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>용도</label><select data-bfield="useNo"><option value="">선택</option>' + useOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>신축(증축)연도</label><input type="number" data-bfield="builtYear" value="' + (r.builtYear || '') + '" placeholder="예: 2010" maxlength="4"></div>' +
      '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-bfield="floorAreaSqm" value="' + (r.floorAreaSqm || '') + '"></div>' +
      (buildingPriceRows.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-building-row" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  box.innerHTML =
    '<div class="taxcalc-asset" style="margin-top:10px;">' +
      '<div class="taxcalc-asset-head"><b>건물 취득가액을 모르면(건물기준시가 자동계산, 2026.1.1. 시행 국세청 고시) — 층·부속시설마다 구조·용도·신축연도가 다르면 행을 나눠 입력. 계산하면 거래 목록에 자동으로 추가됩니다</b></div>' +
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
      const idx = numVal(el.closest('[data-bp-idx]').dataset.bpIdx);
      buildingPriceRows[idx][el.dataset.bfield] = el.value;
    });
  });
  enhanceNumberInputs(box);
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
  const taxType = document.getElementById('taxCalcBuildingPriceTool').dataset.taxType || 'transfer';
  html += '<div class="taxcalc-result-note">' + (taxType === 'transfer' ? '위 합계가 이미 아래 거래 목록에 취득가액으로 자동 추가되었습니다. ' : '상속세·증여세는 위 재산평가 자산목록의 "일반건물" 항목에 직접 입력하세요. ') + r.안내 + '</div>';
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

// 양도비용·취득비용도 임대차 내역처럼 항목별로 입력받아 자동합산한다 — 총액을 손으로 더해서
// 한 번에 적지 않게 한다. 두 목록(양도비용/취득비용)이 한 카드 안에 같이 있으므로 listKey로 구분한다.
function computeCostItemsTotal_(items){
  return (Array.isArray(items) ? items : []).reduce(function(s, it){ return s + (numVal(it.amount) || 0); }, 0);
}
function renderCostItemsSectionHtml_(a, listKey, title, placeholderExample){
  const items = (Array.isArray(a[listKey]) && a[listKey].length) ? a[listKey] : [{}];
  const rowsHtml = items.map(function(it, iidx){
    const isInformal = it.receiptType === 'informal' || it.receiptType === 'other';
    return '<div class="taxcalc-grid" data-cost-idx="' + iidx + '" style="margin-top:4px;padding-top:4px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>항목</label><input type="text" data-costfield="label" value="' + (it.label || '').replace(/"/g, '&quot;') + '" placeholder="' + placeholderExample + '"></div>' +
      '<div class="taxcalc-field"><label>지급처</label><input type="text" data-costfield="payee" value="' + (it.payee || '').replace(/"/g, '&quot;') + '" placeholder="예: OO공인중개사"></div>' +
      '<div class="taxcalc-field"><label>증빙종류</label><select data-costfield="receiptType">' +
        '<option value="taxinvoice"' + (it.receiptType === 'taxinvoice' ? ' selected' : '') + '>세금계산서</option>' +
        '<option value="invoice"' + (it.receiptType === 'invoice' ? ' selected' : '') + '>계산서</option>' +
        '<option value="card"' + (it.receiptType === 'card' ? ' selected' : '') + '>신용카드매출전표</option>' +
        '<option value="cashreceipt"' + (it.receiptType === 'cashreceipt' ? ' selected' : '') + '>현금영수증</option>' +
        '<option value="informal"' + (it.receiptType === 'informal' ? ' selected' : '') + '>간이영수증(정규증빙 아님)</option>' +
        '<option value="other"' + (it.receiptType === 'other' ? ' selected' : '') + '>기타/증빙없음</option>' +
      '</select></div>' +
      '<div class="taxcalc-field"><label>금액</label><input type="number" data-costfield="amount" value="' + (it.amount || '') + '"></div>' +
      (isInformal ? '<div class="taxcalc-field"><span class="taxcalc-result-note">⚠ 정규증빙(세금계산서·계산서·신용카드매출전표·현금영수증)이 아니면 일정 시점 이후 지출분은 필요경비로 인정되지 않을 수 있습니다 — 정확한 기준일을 확인하세요</span></div>' : '') +
      (items.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-cost-item" data-cost-list="' + listKey + '" data-idx="' + iidx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');
  return '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>' + title + '</b></div>' +
    '<div data-cost-list="' + listKey + '">' + rowsHtml + '</div>' +
    '<button type="button" class="taxcalc-add-asset" data-action="add-cost-item" data-cost-list="' + listKey + '" style="margin-top:6px;">+ 항목 추가</button>' +
    '<div class="taxcalc-result-note" data-cost-total="' + listKey + '">합계 ' + won(computeCostItemsTotal_(items)) + '</div>';
}

function renderTransferPane(){
  const cardsHtml = transferAssets.map(function(_, idx){
    return '' +
      '<div class="taxcalc-asset" data-idx="' + idx + '">' +
        '<div class="taxcalc-asset-head"><b>거래 ' + (idx+1) + '</b>' +
          '<span>' +
            '<button type="button" class="taxcalc-calcbasis-btn" data-action="show-calc-basis" data-idx="' + idx + '">🧮 계산근거</button>' +
            (transferAssets.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-asset" data-idx="' + idx + '">✕ 삭제</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="taxcalc-ai-status" id="aiStatus-' + idx + '">' + renderAiStatusHtml(transferAssets[idx]) + '</div>' +
        '<div class="taxcalc-calcbasis" id="calcBasis-' + idx + '" style="display:none;"></div>' +
        '<div class="taxcalc-grid">' +
          '<div class="taxcalc-field"><label>자산종류</label><select data-field="assetType"><option value="other">그 외 부동산</option><option value="house">주택·조합원입주권</option><option value="presale_right">분양권(§104①1호·2호·3호 — 1년미만 70%/1년이상 60% 단일세율, 장기보유특별공제·기본세율누진 배제)</option></select></div>' +
          assetDetailFieldsHtml_(transferAssets[idx]) +
          '<div class="taxcalc-field"><label>양수인 성명</label><input type="text" data-field="buyerName" data-nameonly="1" value="' + (transferAssets[idx].buyerName || '').replace(/"/g, '&quot;') + '"></div>' +
          '<div class="taxcalc-field"><label>양수인 주민등록번호</label><input type="text" data-field="buyerRegNo" data-regno="1" placeholder="000000-0000000" value="' + (transferAssets[idx].buyerRegNo || '').replace(/"/g, '&quot;') + '"></div>' +
          '<div class="taxcalc-field"><label>양수인과의 관계(부당행위계산부인·증여의제 판정용)</label><select data-field="buyerRelation">' +
            '<option value="none">특수관계 없음(제3자)</option>' +
            '<option value="spouse">배우자</option>' +
            '<option value="lineal">직계존비속</option>' +
            '<option value="sibling">형제자매</option>' +
            '<option value="relative">기타 친족(6촌 이내 혈족·4촌 이내 인척 등)</option>' +
            '<option value="economic">사용인 등 경제적 연관관계</option>' +
            '<option value="control">법인 등 경영지배관계</option>' +
          '</select><span class="taxcalc-result-note" style="margin:2px 0 0;">특수관계인과 시가보다 현저히 낮거나 높게 거래했다면 소득세법§101(부당행위계산부인)·상증세법§35(저가양수·고가양도 증여의제, 증여세 탭)를 확인하세요</span></div>' +
          (transferAssets[idx].buyerRelation && transferAssets[idx].buyerRelation !== 'none' ?
            '<div class="taxcalc-field"><label>시가(알고 있으면 입력, §35 증여의제 판정용)</label><input type="number" data-field="fairMarketValueForGiftCheck" placeholder="원" value="' + (transferAssets[idx].fairMarketValueForGiftCheck || '') + '"></div>' +
            '<div class="taxcalc-field"><button type="button" class="taxcalc-run-btn" data-action="send-transfer-to-gift-deemed" data-idx="' + idx + '">차액을 증여세 §35 계산기로 보내기</button></div>' : '') +
          '<div class="taxcalc-field"><label>양도일</label><input type="date" data-field="transferDate" min="1900-01-01" max="2099-12-31"></div>' +
          '<div class="taxcalc-field"><label>양도가액</label><input type="number" data-field="transferPrice" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>취득일</label><input type="date" data-field="acquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
          '<div class="taxcalc-field"><label>취득가액(실지거래가액)</label><input type="number" data-field="acquisitionPrice" placeholder="원 (모르면 비워두세요 — 아래 값들로 자동 산정합니다. 재건축·재개발 특례에 해당하면 무시됩니다)"></div>' +
          '<div class="taxcalc-field"><label>[실지거래가액 모를 때] 매매사례가액</label><input type="number" data-field="comparableTransactionPrice" placeholder="원 (취득일 전후 3개월 이내 유사자산 매매사례, §176의2③1호 — 최우선 적용)"></div>' +
          '<div class="taxcalc-field"><label>[실지거래가액·매매사례가액 모를 때] 감정가액</label><input type="number" data-field="appraisalValue" placeholder="원 (§176의2③2호)"></div>' +
          '<div class="taxcalc-field"><label>[그마저 모를 때] 취득당시 기준시가</label><input type="number" data-field="acquisitionStandardPriceForExpense" placeholder="원 (환산취득가액·개산공제 계산용)"></div>' +
          '<div class="taxcalc-field"><label>[그마저 모를 때] 양도당시 기준시가</label><input type="number" data-field="transferStandardPriceForConversion" placeholder="원 (함께 입력하면 환산취득가액=양도가액×취득당시÷양도당시 기준시가 자동계산, 없으면 취득당시기준시가를 그대로 취득가액으로 사용)"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="useEstimatedNecessaryExpense" id="estExp-' + idx + '"><label for="estExp-' + idx + '">취득가액은 알지만 필요경비 지출증빙이 없어 개산공제(3%, 미등기양도자산은 0.3%)만 사용(위 비용 내역을 입력하지 않았을 때만 적용)</label></div>' +
          '<div class="taxcalc-field"><label>사업용자산 감가상각비(필요경비 산입분)</label><input type="number" data-field="depreciationDeductedAsBusinessExpense" placeholder="원 (사업소득 계산시 감가상각비를 필요경비로 공제했다면 그 금액, §97③ — 취득가액에서 차감됩니다. 해당 없으면 비움)"></div>' +
          (transferAssets[idx].acquisitionDate && transferAssets[idx].acquisitionDate < '1990-08-31' ?
            '<div class="taxcalc-field"><span class="taxcalc-result-note">⚠ 1990.8.31. 이전 취득분은 개별공시지가가 없어 국세청 고시 배율표에 따른 별도 환산방법이 적용될 수 있습니다 — 이 계산기는 그 배율표를 반영하지 않으니 취득당시 기준시가를 직접 확인해서 입력하세요.</span></div>' : '') +
        '</div>' +
        renderCostItemsSectionHtml_(transferAssets[idx], 'transferExpenseItems', '양도비용 내역', '예: 중개보수') +
        renderCostItemsSectionHtml_(transferAssets[idx], 'acquisitionExpenseItems', '취득비용 내역', '예: 취득세') +
        '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>관리처분인가 이후 조합원입주권·신축주택으로 양도했다면(재건축·재개발 특례, 소득세법시행령§166①②③)</b></div>' +
        '<div class="taxcalc-grid">' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isReconstructionRights" id="rr-' + idx + '"><label for="rr-' + idx + '">해당(위 취득일은 종전 부동산 취득일 그대로 유지)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isCompletedNewHousing" id="rrCompleted-' + idx + '"><label for="rrCompleted-' + idx + '">준공된 신축주택을 양도(체크 안하면 준공 전 조합원입주권 자체 양도로 계산 — 신축주택 양도시 12억 초과 고가주택이면 소득세법시행령§160① 초과분 안분도 자동 적용)</label></div>' +
          (!transferAssets[idx].isCompletedNewHousing ?
            '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isOneMemberRightOneFamily" id="rrOneMember-' + idx + '"><label for="rrOneMember-' + idx + '">1세대1조합원입주권 비과세 요건 충족 전제(소득세법§89①4호) — 12억 초과분만 과세(§95③ 후단, 시행령§160①②를 유추적용, 확정 조문 아님)</label></div>' +
            '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isSuccessorMember" id="rrSuccessor-' + idx + '"><label for="rrSuccessor-' + idx + '">승계조합원(다른 조합원으로부터 매매 등으로 이 조합원입주권 자체를 취득) — 체크시 §95②본문 괄호에 따라 관리처분계획인가 전 구간 장기보유특별공제를 아예 적용하지 않음(체크 안하면 원조합원으로 간주)</label></div>' : '') +
          '<div class="taxcalc-field"><label>관리처분계획인가일</label><input type="date" data-field="managementDispositionDate" min="1900-01-01" max="2099-12-31"></div>' +
          '<div class="taxcalc-field"><label>권리가액(종전자산평가액)</label><input type="number" data-field="rightsValue" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>청산금 납부액(분담금, 없으면 0)</label><input type="number" data-field="settlementPaid" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>청산금 환급액(받은 돈, 없으면 0)</label><input type="number" data-field="settlementReceived" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>종전자산(기존건물) 취득가액</label><input type="number" data-field="originalAssetAcquisitionPrice" placeholder="원 (환지·재건축 전 원 취득가액, 환지 항목과 공용)"></div>' +
          '<div class="taxcalc-field"><label>기존건물분 필요경비</label><input type="number" data-field="originalNecessaryExpenses" placeholder="원 (기존건물 취득세 등 §97①2·3호 또는 §163⑥)"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="useConvertedRightsBaseAcquisitionPrice" id="rrConv-' + idx + '"><label for="rrConv-' + idx + '">종전자산 취득가액을 확인할 수 없어 환산가액 사용(소득세법시행령§166③)</label></div>' +
          (transferAssets[idx].useConvertedRightsBaseAcquisitionPrice ?
            '<div class="taxcalc-field"><label>기존건물 취득당시 기준시가</label><input type="number" data-field="originalAcquisitionStandardPrice" placeholder="원"></div>' +
            '<div class="taxcalc-field"><label>관리처분계획인가일 현재 기존건물 기준시가</label><input type="number" data-field="approvalDateStandardPrice" placeholder="원"></div>' +
            '<div class="taxcalc-field"><span class="taxcalc-result-note">종전자산 취득가액 = 권리가액 × (취득당시기준시가 ÷ 인가일현재기준시가)로 자동 환산됩니다.</span></div>' : '') +
          (transferAssets[idx].isReconstructionRights ?
            '<div class="taxcalc-field"><span class="taxcalc-result-note">양도차익은 관리처분계획등인가전·인가후로 나눠 각각 다른 장기보유특별공제를 적용합니다(시행령§166①②③). 청산금 환급액이 있으면 그 부분은 관리처분인가일에 별도로 양도한 것으로 과세되니(소득세법 기본통칙 참조) 아래 버튼으로 별도 거래를 추가하세요.</span></div>' +
            '<div class="taxcalc-field"><button type="button" class="taxcalc-run-btn" data-action="send-settlement-to-new-transfer" data-idx="' + idx + '" data-kind="reconstruction">청산금 환급분을 별도 거래로 추가</button></div>' : '') +
        '</div>' +
        '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>도시개발사업 등 환지처분으로 취득한 토지를 양도했다면(환지 특례)</b></div>' +
        '<div class="taxcalc-grid">' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isLandReplotment" id="lr-' + idx + '"><label for="lr-' + idx + '">해당(위 취득일은 환지 전 종전토지 취득일 그대로 유지)</label></div>' +
          '<div class="taxcalc-field"><label>환지처분(확정)공고일</label><input type="date" data-field="replotmentDisposalDate" min="1900-01-01" max="2099-12-31"></div>' +
          '<div class="taxcalc-field"><label>종전토지 취득가액</label><input type="number" data-field="originalAssetAcquisitionPrice" placeholder="원 (환지 전 원 취득가액, 위 재건축 항목과 공용)"></div>' +
          '<div class="taxcalc-field"><label>권리(예정)면적(㎡)</label><input type="number" data-field="rightsAreaSqm" placeholder="환지예정지 지정 당시"></div>' +
          '<div class="taxcalc-field"><label>확정면적(㎡)</label><input type="number" data-field="finalAreaSqm" placeholder="환지처분 후 최종"></div>' +
          '<div class="taxcalc-field"><label>환지청산금 납부액(확정면적&gt;권리면적, 없으면 0)</label><input type="number" data-field="replotmentSettlementPaid" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>환지청산금 환급액(확정면적&lt;권리면적, 없으면 0)</label><input type="number" data-field="replotmentSettlementReceived" placeholder="원"></div>' +
          (transferAssets[idx].isLandReplotment ?
            '<div class="taxcalc-field"><span class="taxcalc-result-note">취득가액 = 종전토지 취득가액 + 환지청산금납부액으로 자동 대체됩니다(취득일은 환지 전 취득일 그대로 승계). 청산금 환급액이 있으면 그 부분(면적 감소분)은 환지처분공고일에 별도로 양도한 것으로 과세되니 아래 버튼으로 별도 거래를 추가하세요.</span></div>' +
            '<div class="taxcalc-field"><button type="button" class="taxcalc-run-btn" data-action="send-settlement-to-new-transfer" data-idx="' + idx + '" data-kind="replotment">환지청산금 환급분을 별도 거래로 추가</button></div>' : '') +
        '</div>' +
        '<div class="taxcalc-grid" style="margin-top:8px;">' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isOneHouseOneFamily" id="oneHouse-' + idx + '"><label for="oneHouse-' + idx + '">1세대1주택 비과세 전제</label></div>' +
          '<div class="taxcalc-field" data-show-if="isOneHouseOneFamily" style="display:none;"><label>거주연수</label><input type="number" data-field="residenceYears" placeholder="년" maxlength="2"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isAdjustedArea" id="adj-' + idx + '"><label for="adj-' + idx + '">조정대상지역(2026.5.9까지 양도분은 시행령§167조의3①12호의2 등에 따라 중과 한시배제 자동 적용, 이후 재연장 여부는 별도 확인)</label></div>' +
          '<div class="taxcalc-field"><label>다주택중과 판정용 주택수</label><select data-field="multiHouseCount"><option value="0">해당없음/1주택</option><option value="2">2주택</option><option value="3">3주택 이상</option></select></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isNonBusinessLand" id="nbl-' + idx + '"><label for="nbl-' + idx + '">비사업용토지</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isUnregisteredTransfer" id="unreg-' + idx + '"><label for="unreg-' + idx + '">미등기양도</label></div>' +
          '<div class="taxcalc-field"><label>가업상속공제 적용률(0~1, 해당시)</label><input type="number" step="0.01" min="0" max="1" data-field="businessSuccessionDeductionRatio" placeholder="예: 0.5"></div>' +
          '<div class="taxcalc-field"><label>피상속인 취득가액(위와 함께 입력, §97의2④)</label><input type="number" data-field="decedentAcquisitionValue" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>피상속인 취득일(위와 함께 입력, §95④단서)</label><input type="date" data-field="decedentAcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isEightYearFarmland" id="farm-' + idx + '"><label for="farm-' + idx + '">8년 자경농지 감면(§69, 농지소재지 재촌+8년 자경 요건 모두 충족 전제)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isLivestockLandExempt" id="livestock-' + idx + '"><label for="livestock-' + idx + '">8년 이상 자경 축사용지 폐업 감면(§69의2)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isLivestockRestartedWithin5Years" id="livestockRestart-' + idx + '"><label for="livestockRestart-' + idx + '">[§69의2만] 양도 후 5년 이내 축산업 재개(§69의2②, 감면세액 추징)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isLivestockRestartException" id="livestockRestartExc-' + idx + '"><label for="livestockRestartExc-' + idx + '">[재개 체크시만] 상속 등 부득이한 사유(추징 예외)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isFisheryLandExempt" id="fishery-' + idx + '"><label for="fishery-' + idx + '">8년 이상 자영 어업용토지 감면(§69의3)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isFarmlandSubstitutionExempt" id="farmsub-' + idx + '"><label for="farmsub-' + idx + '">농지대토 감면(§70)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isFarmlandSubstitutionRequirementFailed" id="farmsubFail-' + idx + '"><label for="farmsubFail-' + idx + '">[§70만] 사후에 요건 미충족(§70④, 감면세액+이자상당액 추징)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isForestManagementExempt" id="forest-' + idx + '"><label for="forest-' + idx + '">자경산지 감면(§69의4, 10년 이상 직접경영 — 경영기간별 10~50%)</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isNewBuildingWithin5Years" id="newbldg-' + idx + '"><label for="newbldg-' + idx + '">신축(증축, 85㎡초과분) 후 5년 이내 양도 + 감정가액 또는 환산취득가액을 취득가액으로 사용</label></div>' +
          '<div class="taxcalc-field"><label>감정가액·환산취득가액 중 건물분</label><input type="number" data-field="convertedBuildingAcquisitionValueForPenalty" placeholder="원 (위 체크 시, 가산세 5%, 소득세법§114의2)"></div>' +
          '<div class="taxcalc-field"><label>등록임대주택 장특공제 특례</label><select data-field="rentalSpecialType">' +
            '<option value="">해당없음</option>' +
            '<option value="rental_general">장기일반민간임대주택(조특법§97의3, 10년↑70%)</option>' +
            '<option value="rental_long">장기임대주택(조특법§97의4, 일반공제+임대기간별 추가공제)</option>' +
          '</select></div>' +
          '<div class="taxcalc-field"><label>임대기간</label><input type="number" data-field="rentalYears" placeholder="년 (위 특례 선택 시)" maxlength="2"></div>' +
          '<div class="taxcalc-field"><label>[§97의3 선택시 필수] 취득 당시 기준시가</label><input type="number" data-field="acquisitionStandardPrice" placeholder="원 (임대기간중 양도차익 안분용, 3종 모두 없으면 계산 불가)"></div>' +
          '<div class="taxcalc-field"><label>[§97의3 선택시 필수] 등록일 당시 기준시가</label><input type="number" data-field="registrationStandardPrice" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>[§97의3 선택시 필수] 양도 당시 기준시가</label><input type="number" data-field="transferStandardPrice" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>연금계좌 납입액</label><input type="number" data-field="pensionAccountContribution" placeholder="원 (조특법§99의14, 양도대금 중 6개월 내 납입액 — 기초연금수급자·1주택 또는 무주택 세대구성원만 해당)"></div>' +
          '<div class="taxcalc-field"><label>공익사업용토지 수용감면</label><select data-field="compensationType">' +
            '<option value="">해당없음</option>' +
            '<option value="cash">현금보상(조특법§77①, 15%)</option>' +
            '<option value="bond">채권보상 - 만기특약 없음(20%)</option>' +
            '<option value="bond_3y">채권보상 - 3년만기특약(35%)</option>' +
            '<option value="bond_5y">채권보상 - 5년만기특약(45%)</option>' +
            '<option value="land_replacement">대토보상(조특법§77의2, 40%)</option>' +
            '<option value="restricted_zone_40">개발제한구역 매수 - 지정일 이전 취득(조특법§77의3, 40%)</option>' +
            '<option value="restricted_zone_25">개발제한구역 매수 - 20년 이전 취득(조특법§77의3, 25%)</option>' +
          '</select></div>' +
          '<div class="taxcalc-field"><label>사업인정고시일</label><input type="date" data-field="publicNoticeDate" min="1900-01-01" max="2099-12-31" placeholder="현금·채권·대토보상 선택시, 2년이전취득 요건(§77①·§77의2①) 판정용 — 모르면 비워두면 양도일 기준으로 판정"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isBondPledgeBreached" id="bondBreach-' + idx + '"><label for="bondBreach-' + idx + '">채권 만기보유 특약 위반(§77④, 3년·5년만기특약 선택시만 해당 — 즉시 차액 추징)</label></div>' +
          '<div class="taxcalc-field"><label>다운계약서 등 계약서·실거래 차액</label><input type="number" data-field="downContractPriceDifference" placeholder="원 (소득세법§91② 비과세·감면 배제 추징용, 해당 시만)"></div>' +
        '</div>' +
      '</div>';
  }).join('');

  taxCalcTransferPane.innerHTML =
    '<div class="taxcalc-hint">여러 건을 추가하면 2년 이상 보유·특례 없는(또는 다주택중과·비사업용토지만 해당하는) 거래는 자동으로 합산해서 기본공제(250만원, 전체 1회)와 누진세율을 함께 적용합니다(확정신고 합산 개념). 단기양도·미등기양도는 건별로 따로 계산해서 더합니다. 다주택 중과는 조정대상지역 지정·한시배제 여부를 신고 시점 기준으로 직접 확인한 뒤 체크하세요.</div>' +
    '<div class="taxcalc-asset"><div class="taxcalc-asset-head"><b>양도인 정보</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-transfer">📄 증빙에서 자동 입력(사건폴더 전체)</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-transfer-bulk">' + renderAiStatusHtml(transferBulkAiState) + '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>양도인 성명</label><input type="text" id="trTransferorName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>양도인 주민등록번호</label><input type="text" id="trTransferorRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>양도인 주소(납세지)</label><div class="taxcalc-field-inline"><input type="text" id="trTransferorAddress"><button type="button" class="taxcalc-ai-btn" data-action="open-address-search-simple" data-target-input="trTransferorAddress" title="주소 검색">🔍</button></div>' +
          '<button type="button" class="taxcalc-ai-btn" data-action="open-tax-office-guide" data-address-input="trTransferorAddress" style="margin-top:4px;">🏢 관할세무서 확인</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="taxCalcTransferCards">' + cardsHtml + '</div>' +
    '<button type="button" class="taxcalc-add-asset" data-action="add-asset">+ 거래 추가</button>' +
    '<div id="taxCalcAllocationTool"></div>' +
    '<div id="taxCalcBuildingPriceTool"></div>' +
    '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세(확정신고 전체 기준)</b></div>' +
    '<div class="taxcalc-grid">' +
      '<div class="taxcalc-field"><label>신고 상태</label><select id="trFilingStatus">' +
        '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
      '</select></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" id="trFraudulent"><label for="trFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
      '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="trUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
      '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="trPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
      '<div class="taxcalc-field"><label>납부지연일수(자동계산: 확정신고기한 다음해 5.31 대비)</label><input type="number" id="trUnpaidDays" placeholder="0" readonly></div>' +
      '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="trMonthsAfterDesignated" placeholder="0"></div>' +
      '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="trUnpaidAtDesignated" placeholder="0"></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" id="trSelfEfiling"><label for="trSelfEfiling">납세자 본인이 직접 전자신고(2만원 공제)</label></div>' +
    '</div>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-transfer">세액 계산하기</button>' +
    '<div id="taxCalcTransferResult"></div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>이월과세(소득세법§97의2) — 배우자·직계존비속에게 증여받은 부동산·분양권을 증여일로부터 10년 이내에 양도할 때. 위 일반 양도세 계산과 별도로 여기서 계산합니다(요건 미충족·비과세전환·세액비교로 이월과세가 배제되면 자동으로 수증자 본인 값으로 계산됩니다)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="coTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="coTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>자산구분</label><select id="coAssetType"><option value="house">주택·조합원입주권</option><option value="presale_right">분양권</option><option value="other">그 외 부동산</option></select></div>' +
        '<div class="taxcalc-field"><label>수증자가 이번 양도에 추가로 쓴 필요경비</label><input type="number" id="coNecessaryExpenses" placeholder="원 (중개보수 등, 없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="coOneHouse"><label for="coOneHouse">1세대1주택 비과세 요건 충족 전제</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="coAdjustedArea"><label for="coAdjustedArea">조정대상지역 소재(다주택 중과 판정용)</label></div>' +
        '<div class="taxcalc-field"><label>소유 주택 수(다주택중과 판정용)</label><input type="number" id="coMultiHouseCount" placeholder="0" maxlength="2"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>증여·이월과세 판정 정보</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여받은 날</label><input type="date" id="coGiftDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>증여자와의 관계</label><select id="coDonorRelation"><option value="spouse">배우자</option><option value="lineal">직계존속·직계비속</option><option value="other">그 밖의 관계(이월과세 대상 아님)</option></select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="coEminentDomain"><label for="coEminentDomain">사업인정고시일로부터 소급 2년 이전 증여 + 수용·협의매수됨(이월과세 제외)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>증여자(원소유자) 취득정보 — 이월과세 적용시 이 값을 취득가액·취득일로 씁니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여자의 취득가액</label><input type="number" id="coDonorAcqPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>증여자의 취득일</label><input type="date" id="coDonorAcqDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>증여자가 지출한 필요경비</label><input type="number" id="coDonorExpenses" placeholder="원 (취득세 등)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>수증자 본인 기준 정보 — 이월과세가 배제될 때(요건 미충족·비과세전환·세액비교) 대신 쓰이는 값</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여 당시 평가액(수증자의 취득가액)</label><input type="number" id="coDoneeAcqPrice" placeholder="원 (=이 자산의 증여세 과세가액)"></div>' +
        '<div class="taxcalc-field"><label>수증자가 증여받은 후 지출한 필요경비</label><input type="number" id="coDoneeExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>수증자가 낸 증여세 산출세액</label><input type="number" id="coGiftTaxPaid" placeholder="원 (이 자산분, §56에 따른 산출세액)"></div>' +
        '<div class="taxcalc-field"><label>수증자의 전체 증여세 과세가액</label><input type="number" id="coGiftTaxableValue" placeholder="원 (이 자산만 증여받았으면 위 평가액과 동일)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-transfer-carryover">이월과세 적용 여부 판정하고 세액 계산하기</button>' +
      '<div id="taxCalcCarryoverResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>중소기업간 통합·법인전환 양도소득세 이월과세(조특법§31·§32) — 사업용고정자산을 통합법인에 양도하거나 현물출자·사업양수도로 법인전환할 때. 이월과세액은 위 일반 양도세 계산기로 별도 계산해 입력하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>적용 조문</label><select id="btProvision">' +
          '<option value="sect31">§31(중소기업간 통합)</option><option value="sect32">§32(법인전환)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>이월과세액</label><input type="number" id="btDeferredTax" placeholder="원 (일반 양도세 계산기로 별도 계산)"></div>' +
        '<div class="taxcalc-field"><label>사후관리 위반 사유</label><select id="btTriggerEvent">' +
          '<option value="none">없음(이월과세 계속 유지)</option>' +
          '<option value="business_discontinued">승계받은 사업 폐지</option>' +
          '<option value="shares_disposed_50pct_plus">취득주식·출자지분 50%이상 처분</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>양도일(§31)/설립등기일(§32)부터 경과연수</label><input type="number" id="btYearsSince" placeholder="년" maxlength="2"></div>' +
        '<div class="taxcalc-field"><label>법인이 이미 납부한 세액</label><input type="number" id="btAlreadyPaid" placeholder="원 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-business-transfer-carryover">이월과세·사후관리 판정하기</button>' +
      '<div id="taxCalcBusinessTransferCarryoverResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>부담부증여시 양도로 보는 부분의 취득가액·양도가액(소득세법시행령§159) — 수증자가 인수한 채무액에 상당하는 부분은 양도로 봅니다. 결과의 양도가액·취득가액·필요경비를 위 일반 양도세 계산기에 그대로 넣어 나머지 세액을 계산하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>자산 취득가액</label><input type="number" id="bgAcquisitionPrice" placeholder="원 (실지거래가액)"></div>' +
        '<div class="taxcalc-field"><label>자산 증여재산가액</label><input type="number" id="bgGiftValue" placeholder="원 (상증세법상 평가액, 부담부증여 전체 자산가액)"></div>' +
        '<div class="taxcalc-field"><label>수증자가 인수한 채무액</label><input type="number" id="bgDebtAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>함께 증여한 다른 재산의 증여재산가액 합계</label><input type="number" id="bgOtherAssetsValue" placeholder="원 (양도세 비과세대상 재산과 함께 부담부증여한 경우만, §159②)"></div>' +
        '<div class="taxcalc-field"><label>필요경비</label><input type="number" id="bgNecessaryExpenses" placeholder="원 (자본적지출액·양도비 등, 없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-burdened-gift-transfer">양도가액·취득가액 계산하기</button>' +
      '<div id="taxCalcBurdenedGiftTransferResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>양도소득의 부당행위계산 - 증여 후 우회양도 부인(소득세법§101②) — 배우자·직계존비속이 아닌 특수관계인(형제자매 등)에게 증여 후 수증자가 10년 이내 재양도할 때. 증여세·양도세는 각각 별도로 계산한 뒤 그 결과를 아래에 입력해 비교합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ddSpouseLineal"><label for="ddSpouseLineal">배우자·직계존비속으로서 이월과세(§97의2) 적용대상임(체크시 §101②는 적용대상 제외)</label></div>' +
        '<div class="taxcalc-field"><label>증여일로부터 재양도일까지 경과연수</label><input type="number" id="ddYearsSinceGift" placeholder="년" maxlength="2"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ddGainToDonee"><label for="ddGainToDonee">양도소득이 수증자에게 실질적으로 귀속됨이 명백함(§101②단서, 체크시 적용배제)</label></div>' +
        '<div class="taxcalc-field"><label>수증자가 부담한 증여세(결정세액)</label><input type="number" id="ddDoneeGiftTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>수증자가 부담하는 양도소득세(수증자 취득가액 기준, 결정세액)</label><input type="number" id="ddDoneeTransferTax" placeholder="원 — 위 이월과세 계산기의 미적용시 세액 등으로 별도 계산"></div>' +
        '<div class="taxcalc-field"><label>증여자가 직접 양도했다고 볼 경우의 양도소득세</label><input type="number" id="ddDonorTax" placeholder="원 — 증여자의 원취득가액 기준, 위 일반 양도세 계산기로 별도 계산"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-donor-direct-transfer">우회양도 부인 여부 판정하기</button>' +
      '<div id="taxCalcDonorDirectTransferResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>신축주택·미분양주택 취득자 양도세 감면(조특법§99/§99의2/§99의3) — 취득기간이 정해진 특정 신축주택·미분양주택을 취득해 5년 이내(또는 그 이후) 양도할 때. 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 양도차익으로 대신 입력하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>적용 조문</label><select id="nhProvision">' +
          '<option value="sect99">§99(1998.5.22~1999.6.30, 국민주택은 ~1999.12.31 취득)</option>' +
          '<option value="sect99_2">§99의2(2013.4.1~2013.12.31 취득, 6억원 또는 85㎡ 이하)</option>' +
          '<option value="sect99_3">§99의3(2001.5.23~2003.6.30 취득)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="nhHighPrice"><label for="nhHighPrice">고가주택(소득세법§89①3호 비과세 제외 대상)에 해당함(체크시 적용배제)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="nhPriceAreaQualified"><label for="nhPriceAreaQualified">[§99의2만] 취득가액 6억원 이하 또는 전용면적 85㎡ 이하 요건 충족</label></div>' +
        '<div class="taxcalc-field"><label>취득일</label><input type="date" id="nhAcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="nhTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="nhAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="nhTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>필요경비</label><input type="number" id="nhNecessaryExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>취득일로부터 5년 시점 평가액(5년 초과보유, 근사치용)</label><input type="number" id="nhFiveYearMarkValue" placeholder="원 (아래 기준시가 3종이 없을 때만 사용)"></div>' +
        '<div class="taxcalc-field"><label>취득 당시 기준시가(5년 초과보유, 정확한 계산용)</label><input type="number" id="nhAcquisitionStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>5년 시점 기준시가</label><input type="number" id="nhFiveYearStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도 당시 기준시가</label><input type="number" id="nhTransferStandardPrice" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-new-house-reduction">감면대상 양도소득금액 계산하기</button>' +
      '<div id="taxCalcNewHouseReductionResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>미분양주택 취득자 양도세 특례(조특법§98의3~§98의8) — 특정기간 미분양주택·준공후미분양주택을 취득해 양도할 때. 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 양도차익으로 대신 입력하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>적용 조문</label><select id="uhProvision">' +
          '<option value="sect98_3">§98의3(2009.2~2010.2 취득, 5년이내100%·수도권과밀60%)</option>' +
          '<option value="sect98_4">§98의4(비거주자, 2009.3.16~2010.2.11 취득, 세액10%정액감면)</option>' +
          '<option value="sect98_5">§98의5(2010.2~2011.4 취득, 분양가인하율별 60/80/100%)</option>' +
          '<option value="sect98_6">§98의6(2011.5 이전 준공후미분양, 50%)</option>' +
          '<option value="sect98_7">§98의7(2012.9~12 취득, 100%)</option>' +
          '<option value="sect98_8">§98의8(2015년 취득, 5년이상임대, 5년간발생분의 50%)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="uhOverconcentration"><label for="uhOverconcentration">[§98의3만] 수도권과밀억제권역 소재(감면율 60%로 낮아짐)</label></div>' +
        '<div class="taxcalc-field"><label>[§98의5만] 분양가격 인하율</label><input type="number" step="0.1" id="uhDiscountRate" placeholder="%"></div>' +
        '<div class="taxcalc-field"><label>취득일</label><input type="date" id="uhAcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="uhTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="uhAcquisitionPrice" placeholder="원 (§98의7=9억원, §98의8=6억원 초과시 특례 적용불가)"></div>' +
        '<div class="taxcalc-field"><label>[§98의8만] 연면적(공동주택은 전용면적)</label><input type="number" id="uhExclusiveAreaSqm" placeholder="㎡ (135㎡ 초과시 특례 적용불가)"></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="uhTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>필요경비</label><input type="number" id="uhNecessaryExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>취득일로부터 5년 시점 평가액(5년 초과보유, 근사치용)</label><input type="number" id="uhFiveYearMarkValue" placeholder="원 (아래 기준시가 3종이 없을 때만 사용)"></div>' +
        '<div class="taxcalc-field"><label>취득 당시 기준시가(5년 초과보유, 정확한 계산용)</label><input type="number" id="uhAcquisitionStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>5년 시점 기준시가</label><input type="number" id="uhFiveYearStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도 당시 기준시가</label><input type="number" id="uhTransferStandardPrice" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-unsold-house-reduction">감면대상 양도소득금액 계산하기</button>' +
      '<div id="taxCalcUnsoldHouseReductionResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>수도권 밖 준공후미분양주택 1세대1주택 비과세 특례(조특법§98의9, 2024.1.10~2026.12.31 취득분, 현재 시행중) — 세액은 계산하지 않고 적용 가능 여부만 판정합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>준공후미분양주택 취득일</label><input type="date" id="u9AcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="u9OutsideMetro"><label for="u9OutsideMetro">수도권 밖의 지역에 소재</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="u9WasOneHouse"><label for="u9WasOneHouse">취득 전 1주택을 보유한 1세대였음</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="u9AreaPriceOk"><label for="u9AreaPriceOk">전용면적·취득가액 등 시행령 요건 충족(별도 확인)</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-unsold-house-one-house">적용 가능 여부 판정하기</button>' +
      '<div id="taxCalcUnsoldHouseOneHouseResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>구조조정대상 부동산 취득자 양도세 감면(조특법§43) — 1999.12.31 이전 취득분만 적용. 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 양도차익으로 대신 입력하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>취득일</label><input type="date" id="rpAcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="rpTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="rpAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="rpTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>필요경비</label><input type="number" id="rpNecessaryExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>취득일로부터 5년 시점 평가액(5년 초과보유, 근사치용)</label><input type="number" id="rpFiveYearMarkValue" placeholder="원 (아래 기준시가 3종이 없을 때만 사용)"></div>' +
        '<div class="taxcalc-field"><label>취득 당시 기준시가(5년 초과보유, 정확한 계산용)</label><input type="number" id="rpAcquisitionStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>5년 시점 기준시가</label><input type="number" id="rpFiveYearStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도 당시 기준시가</label><input type="number" id="rpTransferStandardPrice" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-restructuring-property-reduction">감면대상 양도소득금액 계산하기</button>' +
      '<div id="taxCalcRestructuringPropertyReductionResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>인구감소지역 주택 1세대1주택 비과세 특례(조특법§71의2, 2024.1.4~2026.12.31 취득분, 현재 시행중) — 세액은 계산하지 않고 적용 가능 여부만 판정합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>인구감소지역주택 취득일</label><input type="date" id="pdAcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="pdPopulationDeclineArea"><label for="pdPopulationDeclineArea">인구감소지역 또는 수도권 밖 인구감소관심지역에 소재</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="pdWasOneOrFewer"><label for="pdWasOneOrFewer">취득 전 주택·조합원입주권·분양권 중 1채(1개)를 보유한 1세대였음</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="pdAreaPriceOk"><label for="pdAreaPriceOk">주택 소재지·가액 등 시행령 요건 충족(별도 확인)</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-population-decline-house">적용 가능 여부 판정하기</button>' +
      '<div id="taxCalcPopulationDeclineHouseResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>농어촌주택등 취득자 1세대1주택 특례(조특법§99의4, 2003.8.1~2028.12.31 취득분, 현재 시행중) — 세액은 계산하지 않고 적용 가능 여부·사후관리 추징대상 여부만 판정합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="rhHouseType">' +
          '<option value="rural">농어촌주택(2003.8.1~)</option><option value="hometown">고향주택(2009.1.1~)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>농어촌주택등 취득일</label><input type="date" id="rhAcquisitionDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="rhLocationPriceOk"><label for="rhLocationPriceOk">소재지·가액(3억원, 한옥은 4억원) 등 시행령 요건 충족(별도 확인)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="rhSameDistrict"><label for="rhSameDistrict">농어촌주택등과 일반주택이 같은(연접) 읍·면·동(고향주택은 시)에 소재(체크시 적용배제)</label></div>' +
        '<div class="taxcalc-field"><label>농어촌주택등 보유기간</label><input type="number" id="rhHoldingYears" placeholder="년"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="rhPendingHolding"><label for="rhPendingHolding">3년 보유요건 충족 전 일반주택을 먼저 양도하는 경우임</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="rhClawback"><label for="rhClawback">특례 적용 후 농어촌주택등을 3년 이상 보유하지 않게 된 사후관리 위반이 발생함</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="rhExempted"><label for="rhExempted">[사후관리 위반일 때만] 수용 등 부득이한 사유에 해당(추징 예외)</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-rural-house-exclusion">적용 가능 여부 판정하기</button>' +
      '<div id="taxCalcRuralHouseExclusionResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>장기임대주택 등 양도세 감면(조특법§97·§97의2·§97의5, §97의4와 별개) — 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 양도차익으로 대신 입력하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>적용 조문</label><select id="lrProvision">' +
          '<option value="sect97">§97(2000.12.31 이전 임대개시 국민주택)</option>' +
          '<option value="sect97_2">§97의2(1999.8.20~2001.12.31 신축임대주택)</option>' +
          '<option value="sect97_5">§97의5(2018.12.31까지 취득+3개월내 등록, 10년이상 계속임대)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[§97만] 세부 유형</label><select id="lrSubType">' +
          '<option value="baseline">그 외 5년이상 임대(50%)</option>' +
          '<option value="construction_5yr">건설임대주택 5년이상(100%)</option>' +
          '<option value="purchase_5yr_novacancy">매입임대주택(1995.1.1이후취득·무입주) 5년이상(100%)</option>' +
          '<option value="rental_10yr">10년이상 임대(100%)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="lrTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="lrAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>필요경비</label><input type="number" id="lrNecessaryExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>[§97의5만] 등록일 현재 평가액(근사치용)</label><input type="number" id="lrRegistrationValue" placeholder="원 (아래 기준시가 3종이 없을 때만 사용)"></div>' +
        '<div class="taxcalc-field"><label>[§97의5만] 취득 당시 기준시가(정확한 계산용)</label><input type="number" id="lrAcquisitionStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[§97의5만] 등록일 당시 기준시가</label><input type="number" id="lrRegistrationStandardPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[§97의5만] 양도 당시 기준시가</label><input type="number" id="lrTransferStandardPrice" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-long-term-rental-house">감면대상 양도소득금액 계산하기</button>' +
      '<div id="taxCalcLongTermRentalHouseResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>국가양도산지 감면(조특법§85의10, 2022.12.31 신청기한 만료 — 과거 거래용) — 2년이상 보유한 산지를 국가에 양도할 때 10% 세액감면</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="nfTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>보유기간</label><input type="number" id="nfHoldingYears" placeholder="년"></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="nfTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="nfAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>필요경비</label><input type="number" id="nfNecessaryExpenses" placeholder="원 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-national-forest-land">적용 가능 여부 확인하기</button>' +
      '<div id="taxCalcNationalForestLandResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>산업단지 이주택지 세율특례(조특법§104의20, 2012.12.31 적용기한 만료 — 과거 거래용) — 세액은 계산하지 않고 적용 가능 여부만 판정합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="icTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>이주택지 분양가격</label><input type="number" id="icSalePrice" placeholder="원 (1억원 이하)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="icWasResident"><label for="icWasResident">실시계획승인일부터 소급 2년이상 그 사업 제공 주거용건축물에 거주</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-industrial-complex-lot">적용 가능 여부 확인하기</button>' +
      '<div id="taxCalcIndustrialComplexLotResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>박물관등 이전 양도세 분할납부(조특법§83, 2022.12.31 적용기한 만료 — 과거 거래용) — 신고기한 종료일+3년부터 5년간 균분납부 스케줄</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>종전시설 양도일</label><input type="date" id="mrTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>분할납부할 양도소득세액</label><input type="number" id="mrTotalTax" placeholder="원 (종전시설 양도차익에 대한 산출세액)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-museum-relocation">분할납부 스케줄 계산하기</button>' +
      '<div id="taxCalcMuseumRelocationResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>경영회생 지원 농지 매매 환급(조특법§70의2) — 한국농어촌공사에 양도한 농지등을 임차기간 내 환매했을 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="frWithinLeaseTerm"><label for="frWithinLeaseTerm">한국농어촌공사와의 임차기간 내에 환매함</label></div>' +
        '<div class="taxcalc-field"><label>한국농어촌공사 양도 당시 납부한 양도소득세</label><input type="number" id="frOriginalTax" placeholder="원 (환급대상액)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-farmland-repurchase">환급 가능 여부 확인하기</button>' +
      '<div id="taxCalcFarmlandRepurchaseResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제62호서식 등] 주식등 양도소득세 — 부동산과 완전히 별도 세목입니다(장기보유특별공제 없음, 대주주/소액주주·국내/국외·중소기업 여부로 세율 결정)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>자산구분</label><select id="stAssetCategory">' +
          '<option value="domestic_stock">국내주식등</option><option value="foreign_stock">국외주식등</option>' +
          '<option value="derivative">파생상품등</option><option value="other_asset">기타자산(특정주식·부동산과다보유법인)</option>' +
          '<option value="trust_beneficiary">신탁 수익권(§94①6호)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="stTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="stTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="stAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도비용</label><input type="number" id="stTransferExpenses" placeholder="원 (증권거래세 등, 없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stMajorityNonBizLand"><label for="stMajorityNonBizLand">[기타자산만] 발행법인 자산의 50%이상이 비사업용토지(§104①9호, 기본세율+10%p 가산)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stIsDaejuju"><label for="stIsDaejuju">대주주(국내주식만 해당, 지분율·시가총액 기준은 별도 확인)</label></div>' +
        '<div class="taxcalc-field"><label>기장누락·미기장 소득금액(대주주만, §115)</label><input type="number" id="stUnrecordedIncome" placeholder="원 (거래명세 등 기장의무 위반분, 없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>기장불성실가산세용 거래금액(산출세액 0원일 때만)</label><input type="number" id="stBookkeepingPenaltyTxAmount" placeholder="원 (산출세액이 없을 때 거래금액×7/10000으로 가산)"></div>' +
        '<div class="taxcalc-field"><label>보유기간(대주주만)</label><input type="number" id="stHoldingMonths" placeholder="개월 (12개월 미만이면 30%)" maxlength="3"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stIsSmallMedium"><label for="stIsSmallMedium">중소기업 발행주식</label></div>' +
        '<div class="taxcalc-field"><label>같은 기간 다른 국내외주식 순손익</label><input type="number" id="stPriorNetGain" placeholder="원 (이익+/손실-, 손익통산용, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>이미 사용한 기본공제액(연 250만원 한도)</label><input type="number" id="stBasicDeductionUsed" placeholder="원 (같은 기간 다른 주식양도에서 이미 썼으면)"><span class="taxcalc-result-note" id="stBasicDeductionUsedHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>외국납부세액공제</label><input type="number" id="stForeignTax" placeholder="원 (국외주식, 없으면 0)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="stFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stFraudulent"><label for="stFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="stUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="stPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 확정신고기한 다음해 5.31 대비)</label><input type="number" id="stUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="stMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="stUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-stock-transfer">세액 계산하기</button>' +
      '<div id="taxCalcStockTransferResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>주식등 이월과세(소득세법§97의2①) — 배우자·직계존비속에게 증여받은 주식등을 증여일로부터 1년 이내에 양도할 때. 위 주식 양도세 계산과 별도로 여기서 계산합니다(요건 미충족·세액비교로 배제되면 자동으로 수증자 본인 값으로 계산됩니다)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>자산구분</label><select id="scAssetCategory">' +
          '<option value="domestic_stock">국내주식등</option><option value="foreign_stock">국외주식등</option>' +
          '<option value="derivative">파생상품등</option><option value="other_asset">기타자산</option>' +
          '<option value="trust_beneficiary">신탁 수익권</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="scTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="scTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>양도비용</label><input type="number" id="scTransferExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="scIsDaejuju"><label for="scIsDaejuju">대주주(국내주식만 해당)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="scIsSmallMedium"><label for="scIsSmallMedium">중소기업 발행주식</label></div>' +
        '<div class="taxcalc-field"><label>보유기간(대주주만)</label><input type="number" id="scHoldingMonths" placeholder="개월"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>증여·이월과세 판정 정보</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여받은 날</label><input type="date" id="scGiftDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>증여자와의 관계</label><select id="scDonorRelation"><option value="spouse">배우자</option><option value="lineal">직계존속·직계비속</option><option value="other">그 밖의 관계(이월과세 대상 아님)</option></select></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>증여자(원소유자) 취득정보 — 이월과세 적용시 취득가액으로 씁니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여자의 취득가액</label><input type="number" id="scDonorAcqPrice" placeholder="원"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>수증자 본인 기준 정보 — 이월과세가 배제될 때 대신 쓰이는 값</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여 당시 평가액(수증자의 취득가액)</label><input type="number" id="scDoneeAcqPrice" placeholder="원 (=이 자산의 증여세 과세가액)"></div>' +
        '<div class="taxcalc-field"><label>수증자가 낸 증여세 산출세액</label><input type="number" id="scGiftTaxPaid" placeholder="원 (이 자산분)"></div>' +
        '<div class="taxcalc-field"><label>수증자의 전체 증여세 과세가액</label><input type="number" id="scGiftTaxableValue" placeholder="원 (이 자산만 증여받았으면 위 평가액과 동일)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-stock-transfer-carryover">이월과세 적용 여부 판정하고 세액 계산하기</button>' +
      '<div id="taxCalcStockCarryoverResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>국외자산 양도소득세(소득세법§118의2~§118의8) — 국내자산 양도세와 완전히 별도 세목. 양도일까지 계속 5년이상 국내거주자가 국외 토지·건물·부동산에관한권리·기타자산을 양도할 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="oaResident5yr"><label for="oaResident5yr">양도일까지 계속 5년 이상 국내에 주소·거소를 둔 거주자</label></div>' +
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="oaTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>양도가액</label><input type="number" id="oaTransferPrice" placeholder="원 (원칙 실지거래가액)"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="oaAcquisitionPrice" placeholder="원 (원칙 실지거래가액)"></div>' +
        '<div class="taxcalc-field"><label>자본적지출액</label><input type="number" id="oaCapitalExpenditure" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>양도비</label><input type="number" id="oaTransferExpenses" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액 처리방법</label><select id="oaForeignTaxMethod">' +
          '<option value="credit">외국납부세액공제(세액공제, 산출세액 한도)</option>' +
          '<option value="expense">필요경비산입방법(위 취득가액 등에 이미 포함해 입력)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[세액공제방법만] 외국에 납부한 세액</label><input type="number" id="oaForeignTaxPaid" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>같은 과세기간 국내자산 양도소득금액(있으면)</label><input type="number" id="oaDomesticIncome" placeholder="원 (없으면 국외자산만 있다고 보아 공제한도=산출세액)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="oaFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="oaFraudulent"><label for="oaFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="oaUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="oaPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 확정신고기한 다음해 5.31 대비)</label><input type="number" id="oaUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="oaMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="oaUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-overseas-asset-transfer">세액 계산하기</button>' +
      '<div id="taxCalcOverseasAssetTransferResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>양도소득의 부당행위계산 — 특수관계인 시가재계산(§101①, 시행령§167③④) — 특수관계인 간에 시가보다 낮게 양도했거나(양도가액 재계산) 시가보다 높게 매입했다면(장래 취득가액 재계산) 그 재계산 여부를 판정합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>거래 구분</label><select id="rpaRole">' +
          '<option value="sale">특수관계인에게 양도(시가보다 낮은지 확인)</option>' +
          '<option value="purchase">특수관계인으로부터 매입(시가보다 높은지 확인)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>실제 거래가액</label><input type="number" id="rpaActualPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>시가</label><input type="number" id="rpaMarketValue" placeholder="원 (상증세법§60~66 준용 평가액)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-transfer-related-party-adjustment">시가재계산 여부 판정하기</button>' +
      '<div id="taxCalcRelatedPartyAdjustmentResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>시가 인정범위 판정(§60②, 시행령§49·소득세법시행령§167⑤) — 위 시가재계산에 쓸 매매·감정 등 증거가액이 유효한 시가로 인정되는지 확인합니다(평가기간: 양도일·취득일 전후 각 3개월)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>평가기준일(양도일 또는 취득일)</label><input type="date" id="tfvBaseDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>증거 유형</label><select id="tfvEvidenceType">' +
          '<option value="sale">매매</option>' +
          '<option value="appraisal">감정</option>' +
          '<option value="expropriation_auction_public_sale">수용·경매·공매</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>증거일</label><input type="date" id="tfvEvidenceDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="tfvRelatedParty"><label for="tfvRelatedParty">[매매만] 특수관계인과의 거래</label></div>' +
        '<div class="taxcalc-field"><label>[감정만] 감정가액 평균</label><input type="number" id="tfvAppraisalAvg" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[감정만] 보충적평가액</label><input type="number" id="tfvSupplementaryValue" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-transfer-fair-market-value-recognition">시가 인정 여부 판정하기</button>' +
      '<div id="taxCalcTransferFmvResult"></div>' +
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
    const idx = numVal(card.dataset.idx);
    card.querySelectorAll('[data-field]').forEach(function(el){
      el.addEventListener('input', function(){
        const key = el.dataset.field;
        transferAssets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'isOneHouseOneFamily') updateOneHouseVisibility(card);
        if (key === 'transferDate') recomputeTransferUnpaidDays();
      });
      el.addEventListener('change', function(){
        const key = el.dataset.field;
        transferAssets[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
        if (key === 'assetKind') renderTransferPane(); // 지목(토지)↔층수·용도(건물)로 입력요소 자체가 바뀌므로 다시 그림
        if (key === 'buyerRelation') renderTransferPane(); // 특수관계 여부에 따라 시가 입력란·§35 연결버튼 표시가 바뀌므로 다시 그림
        if (key === 'isReconstructionRights' || key === 'isLandReplotment' || key === 'useConvertedRightsBaseAcquisitionPrice' || key === 'isCompletedNewHousing') renderTransferPane(); // 청산금 안내·버튼·환산가액 입력란·1세대1조합원입주권 체크박스 표시 여부가 바뀌므로 다시 그림
      });
    });
    card.querySelectorAll('[data-costfield]').forEach(function(el){
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function(){
        const listKey = el.closest('[data-cost-list]').dataset.costList;
        const itemIdx = numVal(el.closest('[data-cost-idx]').dataset.costIdx);
        const key = el.dataset.costfield;
        if (!Array.isArray(transferAssets[idx][listKey])) transferAssets[idx][listKey] = [{}];
        transferAssets[idx][listKey][itemIdx][key] = el.value;
        if (key === 'receiptType') { renderTransferPane(); return; } // 증빙없음 경고 표시 여부가 바뀌므로 다시 그림
        const totalEl = card.querySelector('[data-cost-total="' + listKey + '"]');
        if (totalEl) totalEl.textContent = '합계 ' + won(computeCostItemsTotal_(transferAssets[idx][listKey]));
      });
    });
  });
  const trPaidDateEl = document.getElementById('trPaidDate');
  if (trPaidDateEl) trPaidDateEl.addEventListener('input', recomputeTransferUnpaidDays);
  recomputeTransferUnpaidDays();
  const stTransferDateEl = document.getElementById('stTransferDate');
  const stPaidDateEl = document.getElementById('stPaidDate');
  if (stTransferDateEl) stTransferDateEl.addEventListener('input', recomputeStockUnpaidDays);
  if (stPaidDateEl) stPaidDateEl.addEventListener('input', recomputeStockUnpaidDays);
  recomputeStockUnpaidDays();
  const oaTransferDateEl = document.getElementById('oaTransferDate');
  const oaPaidDateEl = document.getElementById('oaPaidDate');
  if (oaTransferDateEl) oaTransferDateEl.addEventListener('input', recomputeOverseasAssetUnpaidDays);
  if (oaPaidDateEl) oaPaidDateEl.addEventListener('input', recomputeOverseasAssetUnpaidDays);
  recomputeOverseasAssetUnpaidDays();
  wireMoneyCapHint_('stBasicDeductionUsed', 'stBasicDeductionUsedHint', 2500000);
  enhanceNumberInputs(taxCalcTransferPane);
  enhanceDateInputs(taxCalcTransferPane);
  enhanceRegNoInputs(taxCalcTransferPane);
  enhanceNameOnlyInputs(taxCalcTransferPane);
}

function updateOneHouseVisibility(card){
  const checked = card.querySelector('[data-field="isOneHouseOneFamily"]').checked;
  const field = card.querySelector('[data-show-if="isOneHouseOneFamily"]');
  if (field) field.style.display = checked ? 'flex' : 'none';
}


function collectTransferInput(vals){
  const transferPrice = numVal(vals.transferPrice) || 0;
  let acquisitionPrice = numVal(vals.acquisitionPrice) || 0;
  let necessaryExpenses = computeCostItemsTotal_(vals.acquisitionExpenseItems) + computeCostItemsTotal_(vals.transferExpenseItems);
  // 취득가액 자동산정 — 실지거래가액(위 직접입력)이 없으면 소득세법시행령§176의2③ 순차적용
  // (1호 매매사례가액 → 2호 감정가액 → 3호 환산취득가액 → 4호 취득당시기준시가)으로 자동 결정한다.
  // 환산취득가액·기준시가로 대체하는 경우에는 실제 필요경비 증빙도 없는 게 보통이므로, 그 경우에 한해
  // 취득당시기준시가의 3%를 필요경비 개산공제로 함께 인정한다(매매사례가액·감정가액을 확인할 수 있는
  // 경우는 실제 필요경비도 확인 가능한 게 보통이라 개산공제를 자동으로 얹지 않는다 — 필요하면
  // "필요경비 지출증빙이 없어 개산공제만 사용" 체크박스를 별도로 쓰면 된다).
  if (!acquisitionPrice){
    const comparableTransactionPrice = numVal(vals.comparableTransactionPrice) || 0;
    const appraisalValue = numVal(vals.appraisalValue) || 0;
    const acqStd = numVal(vals.acquisitionStandardPriceForExpense) || 0;
    const trStd = numVal(vals.transferStandardPriceForConversion) || 0;
    if (comparableTransactionPrice > 0){
      acquisitionPrice = comparableTransactionPrice;
    } else if (appraisalValue > 0){
      acquisitionPrice = appraisalValue;
    } else if (acqStd > 0 && trStd > 0){
      acquisitionPrice = Math.round(transferPrice * acqStd / trStd);
      necessaryExpenses += Math.round(acqStd * 0.03);
    } else if (acqStd > 0){
      acquisitionPrice = acqStd;
      necessaryExpenses += Math.round(acqStd * 0.03);
    }
  }
  // §97③ — 보유기간 중 사업소득금액 계산시 감가상각비로 필요경비에 산입했거나 산입할 금액이 있으면
  // 그 금액을 취득가액에서 공제한다(이중공제 방지). 실제 산입액은 과거 사업소득 신고내역에 따른
  // 사실관계라 자동계산할 수 없으므로 직접 입력을 받는다.
  const depreciationDeductedAsBusinessExpense = numVal(vals.depreciationDeductedAsBusinessExpense) || 0;
  if (depreciationDeductedAsBusinessExpense > 0) acquisitionPrice = Math.max(0, acquisitionPrice - depreciationDeductedAsBusinessExpense);
  // 관리처분인가 이후 조합원입주권·신축주택 양도(소득세법시행령§166①②③) — 취득가액을 단순 대체하는
  // 대신, tax-calc.js의 transferAssetCore가 관리처분계획등인가전·인가후 양도차익을 나눠 각각 다른
  // 장기보유특별공제를 적용하도록 원시 데이터(권리가액·청산금·기존건물 관련 필드)를 그대로 넘긴다.
  // 이때 필요경비는 최종양도분(transferExpenseItems)만 쓰고, 기존건물분은 별도 입력칸을 쓴다
  // (아래 originalNecessaryExpenses) — 취득비용 내역(acquisitionExpenseItems)은 무시한다.
  if (vals.isReconstructionRights){
    necessaryExpenses = computeCostItemsTotal_(vals.transferExpenseItems);
  }
  // 환지처분 — 취득가액은 환지 전 종전토지 취득가액에 환지청산금 납부액(면적 증가분 추가취득)을
  // 더한 금액으로 대체된다(청산금 환급분은 별도 거래로 환지처분공고일에 과세). 취득일은 환지 전
  // 종전토지 취득일을 그대로 승계한다(취득시기 의제 없음).
  if (vals.isLandReplotment){
    const origPrice = numVal(vals.originalAssetAcquisitionPrice) || 0;
    const replotPaid = numVal(vals.replotmentSettlementPaid) || 0;
    if (origPrice > 0 || replotPaid > 0) acquisitionPrice = origPrice + replotPaid;
  }
  return {
    assetType: vals.assetType || 'other',
    buyerName: vals.buyerName || '',
    buyerRegNo: vals.buyerRegNo || '',
    buyerRelation: vals.buyerRelation || 'none',
    fairMarketValueForGiftCheck: numVal(vals.fairMarketValueForGiftCheck) || 0,
    useEstimatedNecessaryExpense: !!vals.useEstimatedNecessaryExpense,
    acquisitionStandardPriceForExpense: numVal(vals.acquisitionStandardPriceForExpense) || 0,
    transferPrice: transferPrice,
    acquisitionPrice: acquisitionPrice,
    necessaryExpenses: necessaryExpenses,
    acquisitionDate: vals.acquisitionDate || '',
    transferDate: vals.transferDate || '',
    isOneHouseOneFamily: !!vals.isOneHouseOneFamily,
    residenceYears: numVal(vals.residenceYears) || 0,
    isAdjustedArea: !!vals.isAdjustedArea,
    multiHouseCount: numVal(vals.multiHouseCount) || 0,
    isNonBusinessLand: !!vals.isNonBusinessLand,
    isUnregisteredTransfer: !!vals.isUnregisteredTransfer,
    isEightYearFarmland: !!vals.isEightYearFarmland,
    isLivestockLandExempt: !!vals.isLivestockLandExempt,
    isLivestockRestartedWithin5Years: !!vals.isLivestockRestartedWithin5Years,
    isLivestockRestartException: !!vals.isLivestockRestartException,
    isFisheryLandExempt: !!vals.isFisheryLandExempt,
    isFarmlandSubstitutionExempt: !!vals.isFarmlandSubstitutionExempt,
    isFarmlandSubstitutionRequirementFailed: !!vals.isFarmlandSubstitutionRequirementFailed,
    isForestManagementExempt: !!vals.isForestManagementExempt,
    isNewBuildingWithin5Years: !!vals.isNewBuildingWithin5Years,
    convertedBuildingAcquisitionValueForPenalty: numVal(vals.convertedBuildingAcquisitionValueForPenalty) || 0,
    rentalSpecialType: vals.rentalSpecialType || '',
    rentalYears: numVal(vals.rentalYears) || 0,
    acquisitionStandardPrice: numVal(vals.acquisitionStandardPrice) || 0,
    registrationStandardPrice: numVal(vals.registrationStandardPrice) || 0,
    transferStandardPrice: numVal(vals.transferStandardPrice) || 0,
    pensionAccountContribution: numVal(vals.pensionAccountContribution) || 0,
    compensationType: vals.compensationType || '',
    publicNoticeDate: vals.publicNoticeDate || '',
    isBondPledgeBreached: !!vals.isBondPledgeBreached,
    downContractPriceDifference: numVal(vals.downContractPriceDifference) || 0,
    isReconstructionRights: !!vals.isReconstructionRights,
    isCompletedNewHousing: !!vals.isCompletedNewHousing,
    isOneMemberRightOneFamily: !!vals.isOneMemberRightOneFamily,
    isOriginalMember: !vals.isSuccessorMember,
    managementDispositionDate: vals.managementDispositionDate || '',
    rightsValue: numVal(vals.rightsValue) || 0,
    settlementPaid: numVal(vals.settlementPaid) || 0,
    originalAssetAcquisitionPrice: numVal(vals.originalAssetAcquisitionPrice) || 0,
    originalNecessaryExpenses: numVal(vals.originalNecessaryExpenses) || 0,
    useConvertedRightsBaseAcquisitionPrice: !!vals.useConvertedRightsBaseAcquisitionPrice,
    originalAcquisitionStandardPrice: numVal(vals.originalAcquisitionStandardPrice) || 0,
    approvalDateStandardPrice: numVal(vals.approvalDateStandardPrice) || 0,
    businessSuccessionDeductionRatio: numVal(vals.businessSuccessionDeductionRatio) || 0,
    decedentAcquisitionValue: vals.decedentAcquisitionValue !== '' && vals.decedentAcquisitionValue != null ? numVal(vals.decedentAcquisitionValue) : null,
    decedentAcquisitionDate: vals.decedentAcquisitionDate || ''
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
  if (r.자경농지감면액) lines.push((r.자경농지감면_구분 || '8년 자경농지 감면(조특법§69)') + ' = -' + won(r.자경농지감면액));
  if (r.자경농지감면_요건안내) lines.push('※ ' + r.자경농지감면_요건안내);
  if (r.자경농지감면_추징액) lines.push('자경농지등 감면 사후관리 추징(§69의2②·§70④) = +' + won(r.자경농지감면_추징액));
  if (r.수용감면액) lines.push((r.수용감면_구분 || '공익사업용토지 수용감면(조특법§77①)') + ' = -' + won(r.수용감면액));
  if (r.수용감면_요건안내) lines.push('※ ' + r.수용감면_요건안내);
  if (r.채권만기특약위반_추징액) lines.push('채권 만기특약 위반 추징(조특법§77④) = +' + won(r.채권만기특약위반_추징액));
  if (r.다운계약서_감면배제_추징액) lines.push('다운계약서 감면배제 추징(소득세법§91②) = +' + won(r.다운계약서_감면배제_추징액));
  if (r.연금계좌세액공제) lines.push('연금계좌세액공제(조특법§99의14) = -' + won(r.연금계좌세액공제));
  if (r.전자신고세액공제) lines.push('전자신고세액공제 = -' + won(r.전자신고세액공제));
  if (r.환산취득가액가산세) lines.push('환산취득가액가산세(소득세법§114의2) = +' + won(r.환산취득가액가산세));
  if (r.무신고가산세) lines.push('무신고가산세 = +' + won(r.무신고가산세));
  if (r.과소신고가산세) lines.push('과소신고가산세 = +' + won(r.과소신고가산세));
  if (r.납부지연가산세) lines.push('납부지연가산세 = +' + won(r.납부지연가산세));
  lines.push('지방소득세(산출세액의 10%) = ' + won(r.지방소득세));
  lines.push('납부세액 합계 = ' + won(r.납부세액_합계));
  return lines;
}
function populateTransferCalcBasis_(idx){
  const box = document.getElementById('calcBasis-' + idx);
  if (!box) return;
  const single = calculateTransferTaxSingleJS(collectTransferInput(transferAssets[idx]));
  const lines = buildTransferCalcBasisLines(single);
  box.innerHTML = '<div class="taxcalc-calcbasis-title">계산근거(이 거래 단독 기준 — 다른 거래와의 합산 전)</div>' +
    lines.map(function(l){ return '<div class="taxcalc-calcbasis-line">' + l + '</div>'; }).join('');
  box.style.display = 'block';
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
  if (r.합산자경감면_추징액) html += taxCalcResultRow('자경농지등 감면 사후관리 추징(§69의2②·§70④)', '+' + won(r.합산자경감면_추징액));
  if (r.합산수용감면액) html += taxCalcResultRow('공익사업용토지 수용감면(조특법§77)', '-' + won(r.합산수용감면액));
  if (r.합산채권만기특약위반_추징액) html += taxCalcResultRow('채권 만기특약 위반 추징(조특법§77④)', '+' + won(r.합산채권만기특약위반_추징액));
  if (r.다운계약서_감면배제_추징액) html += taxCalcResultRow('다운계약서 감면배제 추징액', '+' + won(r.다운계약서_감면배제_추징액));
  if (r.비과세거래_다운계약서_추징액) html += taxCalcResultRow('다운계약서 비과세배제 추징액(별건)', '+' + won(r.비과세거래_다운계약서_추징액));
  html += taxCalcResultRow('합산(장기) 그룹 산출세액', won(r.합산그룹_산출세액));
  if (r.단기거래_산출세액_합계) html += taxCalcResultRow('단기양도 산출세액 합계', won(r.단기거래_산출세액_합계));
  if (r.미등기거래_산출세액_합계) html += taxCalcResultRow('미등기양도 산출세액 합계', won(r.미등기거래_산출세액_합계));
  if (r.연금계좌세액공제_합계) html += taxCalcResultRow('연금계좌세액공제(조특법§99의14)', '-' + won(r.연금계좌세액공제_합계));
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
    (r.합산자경감면_추징액 ? '<div class="taxcalc-calcbasis-line">자경농지등 감면 사후관리 추징(§69의2②·§70④) = +' + won(r.합산자경감면_추징액) + '</div>' : '') +
    (r.합산수용감면액 ? '<div class="taxcalc-calcbasis-line">공익사업용토지 수용감면 = -' + won(r.합산수용감면액) + '</div>' : '') +
    (r.합산채권만기특약위반_추징액 ? '<div class="taxcalc-calcbasis-line">채권 만기특약 위반 추징(§77④) = +' + won(r.합산채권만기특약위반_추징액) + '</div>' : '') +
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

function renderBusinessTransferCarryoverResult(r){
  const box = document.getElementById('taxCalcBusinessTransferCarryoverResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('이월과세액', won(r.이월과세액));
  if (r.법인기납부세액 !== undefined) html += taxCalcResultRow('법인 기납부세액', '-' + won(r.법인기납부세액));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderBurdenedGiftTransferResult(r){
  const box = document.getElementById('taxCalcBurdenedGiftTransferResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('안분채무액(=양도가액)', won(r.안분채무액));
  html += taxCalcResultRow('채무액비율', (r.채무액비율 * 100).toFixed(2) + '%');
  html += taxCalcResultRow('양도로보는부분 양도가액', won(r.양도로보는부분_양도가액));
  html += taxCalcResultRow('양도로보는부분 취득가액', won(r.양도로보는부분_취득가액));
  html += taxCalcResultRow('필요경비', won(r.필요경비));
  html += taxCalcResultRow('양도차익', won(r.양도차익), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderCarryoverResult(r){
  const box = document.getElementById('taxCalcCarryoverResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.이월과세_적용여부 === true){
    html += '<div class="taxcalc-result-note">✅ 이월과세(소득세법§97의2)를 적용했습니다 — 증여자의 취득가액·취득일·필요경비를 승계했습니다.</div>';
  } else if (r.이월과세_적용여부 === false){
    html += '<div class="taxcalc-result-note">⛔ 이월과세를 적용하지 않았습니다(' + (r.이월과세_미적용사유 || '') + ') — 수증자 본인의 취득가액·취득일로 계산했습니다.</div>';
  }
  if (r.이월과세_비교){
    html += taxCalcResultRow('(이월과세 적용시 세액)', won(r.이월과세_비교.적용시_세액));
    html += taxCalcResultRow('(이월과세 미적용시 세액)', won(r.이월과세_비교.미적용시_세액));
    if (r.이월과세_비교.증여세상당액_필요경비산입) html += taxCalcResultRow('증여세상당액(필요경비 산입)', won(r.이월과세_비교.증여세상당액_필요경비산입));
  }
  if (r.비과세여부){
    html += taxCalcResultRow('비과세 여부', '전액 비과세', { total: true });
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  html += taxCalcResultRow('양도차익', won(r.양도차익));
  if (r.장기보유특별공제액) html += taxCalcResultRow('장기보유특별공제액', '-' + won(r.장기보유특별공제액));
  html += taxCalcResultRow('양도소득금액', won(r.양도소득금액));
  html += taxCalcResultRow('기본공제', won(r.기본공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('적용세율', r.적용세율_설명);
  (r.세율가산_내역 || []).forEach(function(note){ html += '<div class="taxcalc-result-note">' + note + '</div>'; });
  if (r.자경농지감면액) html += taxCalcResultRow(r.자경농지감면_구분 || '8년자경농지 감면', '-' + won(r.자경농지감면액));
  if (r.자경농지감면_추징액) html += taxCalcResultRow('자경농지등 감면 사후관리 추징', '+' + won(r.자경농지감면_추징액));
  if (r.연금계좌세액공제) html += taxCalcResultRow('연금계좌세액공제', '-' + won(r.연금계좌세액공제));
  if (r.전자신고세액공제) html += taxCalcResultRow('전자신고세액공제', '-' + won(r.전자신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  html += '<div class="taxcalc-result-note">이 결과는 참고용 개산이며, 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderDonorDirectTransferResult(r){
  const box = document.getElementById('taxCalcDonorDirectTransferResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.적용여부 === true){
    html += '<div class="taxcalc-result-note">✅ 증여자 직접양도로 의제됩니다(소득세법§101②) — 증여세는 부과되지 않고, 증여자에게 양도소득세가 과세됩니다.</div>';
  } else {
    html += '<div class="taxcalc-result-note">⛔ §101②을 적용하지 않습니다 — 수증자에게 증여세·양도소득세가 각각 그대로 부과됩니다.</div>';
  }
  if (r.수증자부담세액합계 !== undefined) html += taxCalcResultRow('수증자 부담세액 합계(증여세+양도세)', won(r.수증자부담세액합계));
  if (r.증여자직접양도시양도세 !== undefined) html += taxCalcResultRow('증여자 직접양도시 양도소득세', won(r.증여자직접양도시양도세));
  if (r.납부세액 !== undefined) html += taxCalcResultRow('실제 부담할 세액', won(r.납부세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderNewHouseReductionResult(r){
  const box = document.getElementById('taxCalcNewHouseReductionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.적용여부 === false){
    html += taxCalcResultRow('적용 여부', '적용 안 됨', { total: true });
    if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  html += taxCalcResultRow('보유기간', r.보유기간_년 + '년');
  html += taxCalcResultRow('전체 양도차익', won(r.전체양도차익));
  html += taxCalcResultRow('감면·비과세대상 양도소득금액', '-' + won(r.감면_비과세대상_양도소득금액));
  html += taxCalcResultRow('과세대상양도소득금액', won(r.과세대상양도소득금액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderUnsoldHouseReductionResult(r){
  const box = document.getElementById('taxCalcUnsoldHouseReductionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.적용여부 === false){
    html += taxCalcResultRow('적용 여부', '적용 안 됨', { total: true });
    if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  if (r.세액감면율 !== undefined){
    html += taxCalcResultRow('전체 양도차익', won(r.전체양도차익));
    html += taxCalcResultRow('세액감면율', r.세액감면율 + '%', { total: true });
  } else {
    html += taxCalcResultRow('보유기간', r.보유기간_년 + '년');
    html += taxCalcResultRow('적용감면율', r.적용감면율 + '%');
    html += taxCalcResultRow('전체 양도차익', won(r.전체양도차익));
    html += taxCalcResultRow('감면·비과세대상 양도소득금액', '-' + won(r.감면_비과세대상_양도소득금액));
    html += taxCalcResultRow('과세대상양도소득금액', won(r.과세대상양도소득금액), { total: true });
  }
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderUnsoldHouseOneHouseResult(r){
  const box = document.getElementById('taxCalcUnsoldHouseOneHouseResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용 여부', r.적용여부 ? '적용 가능' : '적용 안 됨', { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderRestructuringPropertyReductionResult(r){
  const box = document.getElementById('taxCalcRestructuringPropertyReductionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('보유기간', r.보유기간_년 + '년');
  html += taxCalcResultRow('전체 양도차익', won(r.전체양도차익));
  html += taxCalcResultRow('감면·비과세대상 양도소득금액', '-' + won(r.감면_비과세대상_양도소득금액));
  html += taxCalcResultRow('과세대상양도소득금액', won(r.과세대상양도소득금액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderPopulationDeclineHouseResult(r){
  const box = document.getElementById('taxCalcPopulationDeclineHouseResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용 여부', r.적용여부 ? '적용 가능' : '적용 안 됨', { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderLongTermRentalHouseResult(r){
  const box = document.getElementById('taxCalcLongTermRentalHouseResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용감면율', r.적용감면율 + '%');
  html += taxCalcResultRow('전체 양도차익', won(r.전체양도차익));
  html += taxCalcResultRow('감면대상 양도소득금액', '-' + won(r.감면대상_양도소득금액));
  html += taxCalcResultRow('과세대상양도소득금액', won(r.과세대상양도소득금액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderNationalForestLandResult(r){
  const box = document.getElementById('taxCalcNationalForestLandResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.적용여부 === false){
    html += taxCalcResultRow('적용 여부', '적용 안 됨', { total: true });
  } else {
    html += taxCalcResultRow('전체 양도차익', won(r.전체양도차익));
    html += taxCalcResultRow('세액감면율', r.세액감면율 + '%', { total: true });
  }
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderIndustrialComplexLotResult(r){
  const box = document.getElementById('taxCalcIndustrialComplexLotResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용 여부', r.적용여부 ? '적용 가능' : '적용 안 됨', { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderMuseumRelocationResult(r){
  const box = document.getElementById('taxCalcMuseumRelocationResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('분할납부대상세액', won(r.분할납부대상세액));
  html += '<div class="taxcalc-result-note" style="margin:6px 0;"><table style="width:100%; border-collapse:collapse; font-size:0.9em;">' +
    '<tr><th style="text-align:left;">회차</th><th style="text-align:right;">납부액</th></tr>' +
    (r.회차별_납부예정세액 || []).map(function(row){
      return '<tr><td>' + row.회차 + '</td><td style="text-align:right;">' + won(row.납부액) + '</td></tr>';
    }).join('') +
  '</table></div>';
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderFarmlandRepurchaseResult(r){
  const box = document.getElementById('taxCalcFarmlandRepurchaseResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('환급 가능 여부', r.환급가능여부 ? '환급 가능' : '환급 불가');
  if (r.환급대상세액 !== undefined) html += taxCalcResultRow('환급대상세액', won(r.환급대상세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
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
  if (r.기장불성실가산세) html += taxCalcResultRow('기장불성실가산세(§115)', '+' + won(r.기장불성실가산세));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  html += '<div class="taxcalc-result-note">' + (r.안내 || '') + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderStockCarryoverResult(r){
  const box = document.getElementById('taxCalcStockCarryoverResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.이월과세_적용여부 === true){
    html += '<div class="taxcalc-result-note">✅ 이월과세(소득세법§97의2①)를 적용했습니다 — 증여자의 취득가액을 승계했습니다.</div>';
  } else if (r.이월과세_적용여부 === false){
    html += '<div class="taxcalc-result-note">⛔ 이월과세를 적용하지 않았습니다(' + (r.이월과세_미적용사유 || '') + ') — 수증자 본인의 취득가액으로 계산했습니다.</div>';
  }
  if (r.이월과세_비교){
    html += taxCalcResultRow('(이월과세 적용시 세액)', won(r.이월과세_비교.적용시_세액));
    html += taxCalcResultRow('(이월과세 미적용시 세액)', won(r.이월과세_비교.미적용시_세액));
    if (r.이월과세_비교.증여세상당액_필요경비산입) html += taxCalcResultRow('증여세상당액(양도비용 산입)', won(r.이월과세_비교.증여세상당액_필요경비산입));
  }
  html += taxCalcResultRow('양도차익', won(r.양도차익));
  html += taxCalcResultRow('기본공제', won(r.기본공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('적용세율', r.적용세율_설명);
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  html += '</div>';
  box.innerHTML = html;
}

function renderOverseasAssetTransferResult(r){
  const box = document.getElementById('taxCalcOverseasAssetTransferResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.적용여부 === false){
    html += taxCalcResultRow('적용 여부', '적용 안 됨', { total: true });
    if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  html += taxCalcResultRow('양도차익', won(r.양도차익));
  html += taxCalcResultRow('기본공제', won(r.기본공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.외국납부세액공제한도 !== undefined) html += taxCalcResultRow('외국납부세액공제 한도', won(r.외국납부세액공제한도));
  if (r.외국납부세액공제) html += taxCalcResultRow('외국납부세액공제', '-' + won(r.외국납부세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('지방소득세(10%)', won(r.지방소득세));
  html += taxCalcResultRow('납부세액 합계', won(r.납부세액_합계), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

// ---- 증여세 (국세청 [별지 제10호서식] 증여세과세표준신고 및 자진납부계산서 기준) ----
function renderGiftPane(){
  taxCalcGiftPane.innerHTML =
    '<div class="taxcalc-hint">국세청 [별지 제10호서식] 증여세과세표준신고 및 자진납부계산서 항목을 기준으로 계산합니다. 10년 이내 동일인(직계존속 증여는 그 배우자 포함)으로부터 받은 기증여재산이 있으면 합산액과 기납부세액을 함께 넣으세요.</div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>수증자·증여자 정보 및 관계</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-gift">📄 증빙에서 자동 입력</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-gift"></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>수증자 성명</label><input type="text" id="giftDoneeName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>수증자 주민등록번호</label><input type="text" id="giftDoneeRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>수증자 주소(납세지)</label><div class="taxcalc-field-inline"><input type="text" id="giftDoneeAddress"><button type="button" class="taxcalc-ai-btn" data-action="open-address-search-simple" data-target-input="giftDoneeAddress" title="주소 검색">🔍</button></div>' +
          '<button type="button" class="taxcalc-ai-btn" data-action="open-tax-office-guide" data-address-input="giftDoneeAddress" style="margin-top:4px;">🏢 관할세무서 확인</button>' +
        '</div>' +
        '<div class="taxcalc-field"><label>수증자 거주구분(국내에 주소를 두거나 183일 이상 거소를 둔 사람=거주자)</label><select id="giftDoneeResident"><option value="resident" selected>거주자</option><option value="nonresident">비거주자</option></select><span class="taxcalc-result-note" style="margin:2px 0 0;">비거주자면 증여재산공제(§53)·혼인출산증여재산공제(§53의2)를 받을 수 없습니다.</span></div>' +
        '<div class="taxcalc-field"><span class="taxcalc-result-note" id="giftMinorHint" style="margin:0;">수증자 미성년 여부는 위 주민등록번호로 자동 판정됩니다</span></div>' +
        '<div class="taxcalc-field"><label>증여자 성명</label><input type="text" id="giftDonorName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>증여자 주민등록번호</label><input type="text" id="giftDonorRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>증여자 주소</label><div class="taxcalc-field-inline"><input type="text" id="giftDonorAddress"><button type="button" class="taxcalc-ai-btn" data-action="open-address-search-simple" data-target-input="giftDonorAddress" title="주소 검색">🔍</button></div></div>' +
        '<div class="taxcalc-field"><label>증여일자</label><input type="date" id="giftDate" min="1900-01-01" max="2099-12-31"><span class="taxcalc-result-note" id="giftDateDeadlineHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>관계(수증자 기준)</label><select id="giftRelation">' +
          '<option value="배우자">배우자</option>' +
          '<option value="직계존속" data-genskip="0" selected>부모 등(직계존속, 1촌)→자녀</option>' +
          '<option value="직계존속" data-genskip="1">조부모 등(직계존속, 2촌 이상 — 세대생략)→손자녀</option>' +
          '<option value="직계비속" data-genskip="0">자녀 등(직계비속, 1촌)→부모</option>' +
          '<option value="직계비속" data-genskip="1">손자녀 등(직계비속, 2촌 이상 — 세대생략)→조부모</option>' +
          '<option value="기타친족">기타친족</option><option value="기타">그 밖의 자(상속인 아닌 자 등)</option>' +
        '</select></div>' +
      '</div>' +
    '</div>' +
    '<div class="taxcalc-asset-head"><b>[부표1] 증여재산 및 평가명세 — 자산을 추가하면 아래 증여재산가액에 반영할 수 있습니다</b></div>' +
    '<div id="giftValuationList"></div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>증여재산가액 · 부담부증여</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여재산가액</label><input type="number" id="giftAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>인수채무액(부담부증여, 없으면 0)</label><input type="number" id="giftDebtAssumed" placeholder="원"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftDebtObjProven"><label for="giftDebtObjProven">배우자·직계존비속간 증여일 때만 — 위 채무가 국가·지자체 채무 등 객관적으로 인수 사실이 인정됨(§47③ 단서, 체크 안하면 배우자·직계존비속간 채무는 공제 안 됨)</label></div>' +
        '<div class="taxcalc-field"><label>10년내 동일인 기증여합산액</label><input type="number" id="giftPriorAmount" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>위 기증여분 기납부세액</label><input type="number" id="giftPriorPaidTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>위 기증여분에서 이미 받은 증여재산공제(§53)</label><input type="number" id="giftPriorRelationDeductionUsed" placeholder="원 (없으면 비움 — 관계별 공제도 10년 합산 한도)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftGenSkipOver2B"><label for="giftGenSkipOver2B">세대생략증여재산가액 20억 초과(수증자 미성년 여부는 위 주민등록번호로 자동판정 — 둘 다 충족해야 할증 40%, 아니면 30%)</label></div>' +
        '<div class="taxcalc-field"><label>세대생략(조부모 등)분 증여재산가액</label><input type="number" id="giftGenSkipAmount" placeholder="원 (증여재산가액·기증여합산액 중 조부모 등 분, 전액이면 비움)"></div>' +
        '<div class="taxcalc-field"><label>기증여분 중 이미 납부한 세대생략 할증과세액</label><input type="number" id="giftGenSkipPriorPaid" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>인수채무액에 상당하는 부분은 증여자에게 양도로 과세됩니다(소득세법§88①) — 증여자의 원 취득정보를 입력하면 양도세 탭 거래로 자동 계산해 보냅니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>증여자 취득일</label><input type="date" id="giftDonorAcqDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>증여자 취득가액(전체 재산 기준)</label><input type="number" id="giftDonorAcqPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>증여자 필요경비(전체 재산 기준)</label><input type="number" id="giftDonorAcqExpense" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><button type="button" class="taxcalc-run-btn" data-action="send-debt-to-transfer">인수채무분을 양도세 거래로 보내기</button></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>㉙㉚ 혼인·출산 증여재산공제 (혼인+출산 평생통산 1억원 한도, 위 증여일자를 기준으로 자동 판정)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>혼인일(비어있으면 미해당)</label><input type="date" id="giftMarriageDate" min="1900-01-01" max="2099-12-31"><span class="taxcalc-result-note" id="giftMarriageHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>출생일·입양일(비어있으면 미해당)</label><input type="date" id="giftBirthDate" min="1900-01-01" max="2099-12-31"><span class="taxcalc-result-note" id="giftBirthHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>과거에 이미 받은 혼인·출산공제 누적액</label><input type="number" id="giftPriorMarriageBirth" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>㉜㉝ 그 밖의 공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftExcludedAgg"><label for="giftExcludedAgg">상증세법 §55①3호 합산배제증여재산(3천만원 고정공제)</label></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="giftAppraisalFee" placeholder="원 (500만원 한도)"><span class="taxcalc-result-note" id="giftAppraisalFeeHint" style="margin:2px 0 0;"></span></div>' +
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
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="giftFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftReportedInTime" checked><label for="giftReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftFraudulent"><label for="giftFraudulent">부정행위(무신고·과소신고 가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="giftUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="giftPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 증여일+3개월 신고기한 대비)</label><input type="number" id="giftUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="giftMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="giftUnpaidAtDesignated" placeholder="0"></div>' +
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
        '<div class="taxcalc-field"><label>증여일자</label><input type="date" id="srGiftDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>인수채무액(부담부증여, 창업자금만)</label><input type="number" id="srDebtAssumed" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>기 과세특례적용분 증여세과세가액</label><input type="number" id="srPriorSpecialGift" placeholder="원 (동일특례 재차증여, 없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="srJobsCreated10Plus"><label for="srJobsCreated10Plus">(창업자금) 창업으로 10명 이상 신규고용 — 한도 100억(아니면 50억)</label></div>' +
        '<div class="taxcalc-field"><label>(가업승계) 증여자(부모)의 가업영위기간</label><input type="number" id="srBusinessYears" placeholder="년 — 20미만 300억/20~30 400억/30이상 600억" maxlength="2"></div>' +
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
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="srAppraisalFee" placeholder="원 (500만원 한도)"><span class="taxcalc-result-note" id="srAppraisalFeeHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>이전 특례증여분 기납부세액(조특법§30의5①후단)</label><input type="number" id="srPriorPaidTax" placeholder="원 (같은 특례를 2회 이상 받은 경우 그 이전분에 낸 산출세액 — 상증세법§58과 무관)"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액공제(§59)</label><input type="number" id="srForeignTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="srFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="srFraudulent"><label for="srFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="srUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="srPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 증여일+3개월 신고기한 대비)</label><input type="number" id="srUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="srMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="srUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-special-rate-gift">특례세율 증여세 계산하기</button>' +
      '<div id="taxCalcSpecialRateGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>명의신탁재산의 증여 의제(§45의2) — 등기·등록·명의개서가 필요한 재산(주식등, 토지·건물 제외)의 실제소유자와 명의자가 다를 때. 증여재산공제 없이 재산가액 전액이 과세표준입니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>명의신탁재산의 가액</label><input type="number" id="ntPropertyValue" placeholder="원 (명의개서일 또는 소유권취득일이 속한 해의 다음 해 말일의 다음 날 현재 평가액)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ntAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntNoAvoidancePurpose"><label for="ntNoAvoidancePurpose">조세회피 목적 없음(§45의2①1호 — 적용배제)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntTrustPropertyReg"><label for="ntTrustPropertyReg">자본시장법상 신탁재산 등기(§45의2①3호 — 적용배제)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntNonResidentAgentReg"><label for="ntNonResidentAgentReg">비거주자 법정대리인·재산관리인 명의 등기(§45의2①4호 — 적용배제)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntNameChangeNeglect"><label for="ntNameChangeNeglect">실제소유자 명의로 명의개서를 하지 않은 경우(§45의2③ — 조세회피목적 추정, 아래 세이프하버 확인)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntSaleWithTransferReport"><label for="ntSaleWithTransferReport">[명의개서해태만] 매매취득 + 종전소유자 양도소득세(증권거래세)신고시 소유권변경신고(세이프하버)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntInheritanceWithEstateReport"><label for="ntInheritanceWithEstateReport">[명의개서해태만] 상속취득 + 상속세신고에 포함(세이프하버)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ntLateAmendedAfterAudit"><label for="ntLateAmendedAfterAudit">[상속세이프하버만] 결정·경정 알고 한 수정신고·기한후신고(세이프하버 무효화)</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-nominee-trust">증여세 계산하기</button>' +
      '<div id="taxCalcNomineeTrustResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>재산 취득자금 등의 증여 추정(§45) — 자력취득 능력이 부족한 사람이 재산을 취득(또는 채무를 상환)했는데 그 자금출처를 입증하지 못하면, 미입증금액을 증여받은 것으로 추정합니다(자금출처조사)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>취득재산의 가액(또는 채무 상환금액)</label><input type="number" id="afTotalValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>자금출처로 입증된 금액 합계</label><input type="number" id="afProvenAmount" placeholder="원 (신고·과세된 소득·상속·수증재산가액, 재산처분대가 등 — 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="afAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="afFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="afFraudulent"><label for="afFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="afUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(자금출처가 된 재산 취득일 또는 채무 상환일)</label><input type="text" class="taxcalc-date" id="afGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="afPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 증여일+3개월 신고기한 대비)</label><input type="number" id="afUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="afMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="afUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-property-funds">증여세 계산하기</button>' +
      '<div id="taxCalcPropertyFundsResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>채무면제 등에 따른 증여(§36) — 채권자로부터 채무를 면제받거나 제3자로부터 채무의 인수·변제를 받았을 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>면제·인수·변제받은 채무액</label><input type="number" id="dfDebtAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>지급한 보상액</label><input type="number" id="dfCompensation" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="dfRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="dfAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="dfFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="dfFraudulent"><label for="dfFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="dfUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(면제·인수·변제받은 날)</label><input type="text" class="taxcalc-date" id="dfGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="dfPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="dfUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="dfMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="dfUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-debt-forgiveness">증여세 계산하기</button>' +
      '<div id="taxCalcDebtForgivenessResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>증자에 따른 이익의 증여(§39) — 신주를 시가보다 낮거나 높은 가액으로 발행할 때. 실권주 배정여부·저가/고가여부에 따라 5가지 케이스로 나뉩니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>케이스 구분</label><select id="ciCaseType">' +
          '<option value="low_allocated">저가발행 - 실권주 배정(또는 비주주직접배정·균등초과배정)</option>' +
          '<option value="low_unallocated">저가발행 - 실권주 미배정(특수관계인이 신주인수)</option>' +
          '<option value="high_allocated">고가발행 - 실권주 배정</option>' +
          '<option value="high_unallocated">고가발행 - 실권주 미배정</option>' +
          '<option value="high_nonshareholder">고가발행 - 비주주직접배정 또는 균등초과배정</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>증자전 1주당 평가가액</label><input type="number" id="ciPreValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>증자전 발행주식총수</label><input type="number" id="ciPreShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>신주 1주당 인수가액</label><input type="number" id="ciIssuePrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[저가배정·고가배정·고가미배정·고가비주주] 증자로 실제 증가한 주식수</label><input type="number" id="ciIncreasedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[저가배정·고가배정만] 배정받은 실권주수(또는 신주수)</label><input type="number" id="ciAllocatedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[저가미배정만] 균등증자시 증가주식수</label><input type="number" id="ciEqualIncreaseShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[저가미배정만] 배정간주실권주수(실권주총수×증자후지분비율×특수관계인실권주비율)</label><input type="number" id="ciDeemedAllocatedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가미배정만] 포기주주의 실권주수</label><input type="number" id="ciForfeitedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가미배정·고가비주주] 특수관계인이 인수한 신주수(실권주수)</label><input type="number" id="ciRelatedAcquiredShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가미배정만] 균등증자시 주식총수</label><input type="number" id="ciEqualIncreaseTotalShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가비주주만] 미달배정 주주의 그 신주수</label><input type="number" id="ciUnderAllocatedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가비주주만] 비주주배정+균등초과인수 신주 총수</label><input type="number" id="ciNonShareholderTotalShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형(케이스) 이전거래 이익 합계(§43②)</label><input type="number" id="ciPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="ciRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ciAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="ciFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ciFraudulent"><label for="ciFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="ciUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(주식대금 납입일 등)</label><input type="text" class="taxcalc-date" id="ciGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="ciPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="ciUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="ciMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="ciUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-capital-increase-gift">증여세 계산하기</button>' +
      '<div id="taxCalcCapitalIncreaseGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>감자에 따른 이익의 증여(§39의2) — 주식등을 시가보다 낮거나 높은 대가로 소각(감자)할 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>케이스 구분</label><select id="crCaseType">' +
          '<option value="low_price">저가소각(시가보다 낮은 대가로 소각 — 다른 대주주등이 이익)</option>' +
          '<option value="high_price">고가소각(시가보다 높은 대가로 소각, 1주당평가액이 액면가 미달일 때 — 소각된 주주 본인이 이익)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>감자한 주식등의 1주당 평가액</label><input type="number" id="crValuePerShare" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>소각시 지급한 1주당 금액</label><input type="number" id="crPaymentPerShare" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[저가소각만] 총 감자 주식등의 수</label><input type="number" id="crTotalReducedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[저가소각만] 대주주등의 감자후 지분비율</label><input type="number" step="0.01" min="0" max="1" id="crPostRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field"><label>[저가소각만] 대주주등과 특수관계인의 감자 주식등의 수</label><input type="number" id="crRelatedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가소각만] 해당 주주등의 감자한 주식등의 수</label><input type="number" id="crOwnShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형(케이스) 이전거래 이익 합계(§43②)</label><input type="number" id="crPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="crRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="crAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="crFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="crFraudulent"><label for="crFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="crUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(주주총회결의일 등)</label><input type="text" class="taxcalc-date" id="crGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="crPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="crUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="crMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="crUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-capital-reduction-gift">증여세 계산하기</button>' +
      '<div id="taxCalcCapitalReductionGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>현물출자에 따른 이익의 증여(§39의3) — §39(증자)와 계산구조가 같습니다(증자→현물출자로 치환)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>케이스 구분</label><select id="icfCaseType">' +
          '<option value="low_price">저가발행(1호)</option><option value="high_price">고가발행(2호)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>현물출자전 1주당 평가가액</label><input type="number" id="icfPreValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>현물출자전 발행주식총수</label><input type="number" id="icfPreShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>신주 1주당 인수가액</label><input type="number" id="icfIssuePrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>현물출자로 증가한 주식수(전체)</label><input type="number" id="icfIncreasedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[저가발행만] 현물출자자가 배정받은 신주수</label><input type="number" id="icfAllocatedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가발행만] 현물출자자가 인수한 신주수</label><input type="number" id="icfAcquiredShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[고가발행만] 현물출자자 외 특수관계인주주등의 지분비율</label><input type="number" step="0.01" min="0" max="1" id="icfRelatedRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형(케이스) 이전거래 이익 합계(§43②)</label><input type="number" id="icfPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="icfRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="icfAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="icfFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="icfFraudulent"><label for="icfFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="icfUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(현물출자 납입일 등)</label><input type="text" class="taxcalc-date" id="icfGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="icfPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="icfUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="icfMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="icfUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-in-kind-contribution-gift">증여세 계산하기</button>' +
      '<div id="taxCalcInKindContributionGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>전환사채등의 주식전환등에 따른 이익의 증여(§40) — 전환사채·신주인수권부사채 등을 인수·취득·양도하거나 주식전환등을 할 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>케이스 구분</label><select id="cbCaseType">' +
          '<option value="acquisition">취득시(법1호 — 저가취득)</option>' +
          '<option value="conversion">전환시(법2호가~다목 — 교부주식가액이 전환가액등 초과)</option>' +
          '<option value="conversion_reverse">전환시 반대편(법2호라목 — 특수관계인이 얻은 이익)</option>' +
          '<option value="transfer">양도시(법3호 — 특수관계인에게 고가양도)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[취득·양도시만] 전환사채등의 시가</label><input type="number" id="cbFairValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[취득시만] 인수·취득가액</label><input type="number" id="cbAcquisitionCost" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[양도시만] 양도가액</label><input type="number" id="cbTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[전환시만] 전환등 전 1주당 평가가액</label><input type="number" id="cbPreValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[전환시만] 전환등 전 발행주식총수</label><input type="number" id="cbPreShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[전환시만] 전환가액등(1주당 전환·교환·인수가액)</label><input type="number" id="cbConversionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[전환시만] 전환등으로 증가한(교부받은) 주식수</label><input type="number" id="cbIncreasedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[전환시(정방향)만] 이자손실분 직접입력(선택)</label><input type="number" id="cbInterestLoss" placeholder="원 (비워두면 아래 3개 필드로 자동계산)"></div>' +
        '<div class="taxcalc-field"><label>[전환시(정방향)만] 전환사채등 만기상환금액</label><input type="number" id="cbFaceValueAtMaturity" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[전환시(정방향)만] 사채발행이율</label><input type="number" step="0.001" id="cbIssueRate" placeholder="연 이자율(소수, 예: 2%는 0.02)"></div>' +
        '<div class="taxcalc-field"><label>[전환시(정방향)만] 취득일부터 만기까지 기간</label><input type="number" step="0.1" id="cbYearsToMaturity" placeholder="년"></div>' +
        '<div class="taxcalc-field"><label>[전환시(정방향)만] 기과세된 취득시 이익</label><input type="number" id="cbPriorAcquisitionGift" placeholder="원 (같은 건 법1호로 이미 과세된 금액, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>[전환시 반대편만] 그 특수관계인의 전환등전 보유지분비율</label><input type="number" step="0.01" min="0" max="1" id="cbRelatedRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형(케이스) 이전거래 이익 합계(§43②)</label><input type="number" id="cbPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액(취득시만)</label><input type="number" id="cbRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="cbAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="cbFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="cbFraudulent"><label for="cbFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="cbUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일</label><input type="text" class="taxcalc-date" id="cbGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="cbPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="cbUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="cbMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="cbUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-convertible-bond-gift">증여세 계산하기</button>' +
      '<div id="taxCalcConvertibleBondGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>부동산 무상사용·담보이용에 따른 이익의 증여(§37) — 타인의 부동산을 무상으로 사용하거나, 무상으로 담보 제공받아 차입했을 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="fuUseType">' +
          '<option value="occupancy">부동산 무상사용</option><option value="collateral">부동산 무상담보 이용(차입)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>부동산가액(무상사용일 때)</label><input type="number" id="fuPropertyValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>차입금액(담보이용일 때)</label><input type="number" id="fuLoanAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>실제 지급한 이자(담보이용일 때)</label><input type="number" id="fuActualInterest" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형 이전거래 이익 합계(§43②)</label><input type="number" id="fuPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="fuRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="fuAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="fuFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="fuFraudulent"><label for="fuFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="fuUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(무상사용·담보이용 개시일)</label><input type="text" class="taxcalc-date" id="fuGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="fuPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="fuUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="fuMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="fuUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-free-property-use">증여세 계산하기</button>' +
      '<div id="taxCalcFreePropertyUseResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>배우자 등에게 양도한 재산의 증여 추정(§44) — 배우자·직계존비속에게 양도한 재산, 또는 특수관계인을 거쳐 3년 이내 재양도한 재산</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="spTransferType">' +
          '<option value="direct">배우자·직계존비속에게 직접 양도(§44①)</option><option value="bypass">특수관계인 경유 후 3년 이내 재양도(§44②)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>증여추정 대상 재산가액</label><input type="number" id="spAssetValue" placeholder="원 (직접양도는 양도가액, 재양도는 재양도 당시 재산가액)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="spExcluded"><label for="spExcluded">적용배제 사유 해당(§44③ — 경매·파산선고·공매·증권시장처분·대가받고 양도한 사실이 명백히 인정)</label></div>' +
        '<div class="taxcalc-field"><label>당초양도자·양수자 소득세 결정세액 합계(재양도일 때만)</label><input type="number" id="spPriorTaxesSum" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>재양도가액 증여추정시 증여세액 직접입력(선택, 재양도일 때만)</label><input type="number" id="spComparisonGiftTax" placeholder="비워두면 아래 재산가액·공제로 자동계산"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="spRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="spAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="spFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="spFraudulent"><label for="spFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="spUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(양도일)</label><input type="text" class="taxcalc-date" id="spGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="spPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="spUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="spMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="spUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-spouse-property-transfer">증여세 계산하기</button>' +
      '<div id="taxCalcSpousePropertyTransferResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>보험금의 증여(§34) — 보험사고(만기보험금 포함) 발생시, 보험료를 낸 사람과 보험금을 받는 사람이 다르거나 증여받은 돈으로 보험료를 낸 경우</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>수령한 보험금</label><input type="number" id="ipProceeds" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>납부된 총 보험료</label><input type="number" id="ipTotalPremium" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>보험금 수령인이 아닌 자가 낸 보험료</label><input type="number" id="ipPremiumByOthers" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>수령인이 증여받은 재산으로 낸 보험료</label><input type="number" id="ipPremiumFromGifted" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="ipRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ipAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="ipFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ipFraudulent"><label for="ipFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="ipUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(보험사고 발생일)</label><input type="text" class="taxcalc-date" id="ipGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="ipPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="ipUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="ipMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="ipUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-insurance-proceeds">증여세 계산하기</button>' +
      '<div id="taxCalcInsuranceProceedsResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>신탁이익의 증여(§33) — 위탁자가 타인을 수익자로 지정한 신탁에서, 원본 또는 수익을 받은 경우</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신탁이익(원본 또는 수익의 가액)</label><input type="number" id="tiGiftAmount" placeholder="원 — 여러 차례 나눠 받는 경우 재산평가 화면의 §61 신탁수익권 평가액을 입력"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="tiRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="tiAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="tiFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="tiFraudulent"><label for="tiFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="tiUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(원본·수익 실제 지급일 등)</label><input type="text" class="taxcalc-date" id="tiGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="tiPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="tiUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="tiMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="tiUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-trust-income">증여세 계산하기</button>' +
      '<div id="taxCalcTrustIncomeResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제10호의3서식] 일감몰아주기 증여의제(§45의3) — 지배주주+친족이 지분을 가진 법인이 특수관계법인과 매출비중이 높고 지분율도 높을 때 과세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>수혜법인 기업규모</label><select id="jmCompanySize">' +
          '<option value="general">일반(중견·중소 아님)</option><option value="medium">중견기업</option><option value="small">중소기업</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>수혜법인 세후영업이익(중견·일반기업용, §45의3①2호나·다목)</label><input type="number" id="jmOperatingIncome" placeholder="원 (중소기업이면 비워도 됨)"></div>' +
        '<div class="taxcalc-field"><label>수혜법인 세후순이익(중소기업용, §45의3①2호가목)</label><input type="number" id="jmNetIncome" placeholder="원 (중소기업일 때만 사용)"></div>' +
        '<div class="taxcalc-field"><label>특수관계법인거래비율</label><input type="number" step="0.01" id="jmTradeRatio" placeholder="% (과세제외매출액 반영한 최종비율)"></div>' +
        '<div class="taxcalc-field"><label>특수관계법인 매출액(일반기업 대체과세요건용)</label><input type="number" id="jmRelatedPartySales" placeholder="원 (일반기업이고 거래비율 20~30%일 때만 — §45의3①1호나목2)"></div>' +
        '<div class="taxcalc-field"><label>지배주주+친족 주식보유비율(직접 또는 간접, 출자관계별로 따로 계산)</label><input type="number" step="0.01" id="jmShareRatio" placeholder="%"></div>' +
        '<div class="taxcalc-field"><label>배당소득공제</label><input type="number" id="jmDividendDeduction" placeholder="원 (신고기한 내 받은 배당소득 공제액, 없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>수혜법인 사업연도 종료일</label><input type="date" id="jmFiscalYearEnd" min="1900-01-01" max="2099-12-31"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="jmFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jmReportedInTime" checked><label for="jmReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jmFraudulent"><label for="jmFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="jmUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="jmPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 사업연도종료일+3개월 신고기한 대비)</label><input type="number" id="jmUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="jmMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="jmUnpaidAtDesignated" placeholder="0"></div>' +
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
        '<div class="taxcalc-field"><label>법인세 납부세액 중 상당액(직접 입력시 아래 자동계산값보다 우선)</label><input type="number" id="jtCorporateTax" placeholder="원 (개시: 해당연도분 / 정산: 누적 합계, 비우면 자동계산)"></div>' +
        '<div class="taxcalc-field"><label>수혜법인의 법인세 산출세액(공제·감면 차감후)</label><input type="number" id="jtCorpTaxAfterCredit" placeholder="원 (법인세 납부세액 중 상당액 자동계산용)"></div>' +
        '<div class="taxcalc-field"><label>수혜법인의 해당 사업연도 소득금액</label><input type="number" id="jtCorpTaxableIncome" placeholder="원 (법인세법§14, 자동계산용)"></div>' +
        '<div class="taxcalc-field"><label>(개시사업연도만) 개시사업연도 월수</label><input type="number" id="jtMonths" placeholder="보통 12" maxlength="2"></div>' +
        '<div class="taxcalc-field"><label>(정산사업연도만) 배당소득공제액</label><input type="number" id="jtDividendDeduction" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>해당 사업연도 종료일</label><input type="date" id="jtFiscalYearEnd" min="1900-01-01" max="2099-12-31"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="jtFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jtReportedInTime" checked><label for="jtReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="jtFraudulent"><label for="jtFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="jtUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="jtPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 사업연도종료일+3개월 신고기한 대비)</label><input type="number" id="jtUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="jtMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="jtUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-business-opportunity-gift">일감떼어주기 증여세 계산하기</button>' +
      '<div id="taxCalcBusinessOpportunityGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>특정법인과의 거래를 통한 이익의 증여의제(§45의5) — 지배주주 지분 30%이상 법인이 지배주주의 특수관계인과 무상제공·저가양도·고가양수·불균등 자본거래 등을 할 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>특정법인이 얻는 이익</label><input type="number" id="scBenefitToCorp" placeholder="원 (증여재산가액·채무면제이익·자본거래이익·시가차액 등, 별도 계산)"></div>' +
        '<div class="taxcalc-field"><label>특정법인의 법인세 산출세액(공제·감면 차감후)</label><input type="number" id="scCorpTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>특정법인의 해당 사업연도 소득금액</label><input type="number" id="scCorpIncome" placeholder="원 (법인세법§14)"></div>' +
        '<div class="taxcalc-field"><label>지배주주등의 주식보유비율</label><input type="number" step="0.01" min="0" max="1" id="scShareRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field"><label>직접증여시 증여세상당액(§45의5② 한도용)</label><input type="number" id="scDirectGiftTax" placeholder="원 (관계별공제 반영해 별도 계산, 없으면 한도 미적용)"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 같은 특정법인과의 이전거래 이익 합계(§43②)</label><input type="number" id="scPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="scRelationDeduction" placeholder="원 (증여자가 법인이므로 통상 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="scAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="scFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="scFraudulent"><label for="scFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="scUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>특정법인 사업연도 종료일</label><input type="date" id="scFiscalYearEnd" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="scPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 사업연도종료일+3개월 신고기한 대비)</label><input type="number" id="scUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="scMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="scUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-specific-corp-gift">증여세 계산하기</button>' +
      '<div id="taxCalcSpecificCorpGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>초과배당에 따른 이익의 증여(§41의2) — 최대주주등이 배당을 포기하거나 불균등 조건으로 배당받아 그 특수관계인이 본인 지분보다 많은 배당을 받았을 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="edFinalSettlement"><label for="edFinalSettlement">정산 신고임(실제소득세액 기준, 체크 안 하면 최초 신고=추정소득세상당액 기준)</label></div>' +
        '<div class="taxcalc-field"><label>특수관계인이 실제 받은 배당등의 금액</label><input type="number" id="edBaseAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>최대주주등의 과소배당금액이 차지하는 비율</label><input type="number" step="0.01" min="0" max="1" id="edShortfallRatio" placeholder="0~1 (시행령§31의2②2호)"></div>' +
        '<div class="taxcalc-field"><label>[최초신고만] 추정 소득세상당액(선택)</label><input type="number" id="edEstimatedTax" placeholder="비워두면 시행규칙§10의3① 추정율표로 자동계산"></div>' +
        '<div class="taxcalc-field"><label>[정산신고·종합과세만] 종합소득과세표준</label><input type="number" id="edComprehensiveBase" placeholder="원 (초과배당금액발생연도, 초과배당금액 포함된 값 — 입력시 자동계산)"></div>' +
        '<div class="taxcalc-field"><label>[정산신고·비과세/분리과세만] 실제 소득세액 직접입력</label><input type="number" id="edActualTax" placeholder="원 (종합과세면 위 종합소득과세표준을 입력하세요)"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일 최대주주등의 이전 초과배당금액 합계(§43②)</label><input type="number" id="edPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="edRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="edAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="edFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="edFraudulent"><label for="edFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="edUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(배당지급일)</label><input type="text" class="taxcalc-date" id="edGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="edPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="edUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="edMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="edUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-excess-dividend-gift">증여세 계산하기</button>' +
      '<div id="taxCalcExcessDividendGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>주식등 상장·합병에 따른 이익의 증여(§41의3·§41의5) — 최대주주등의 특수관계인이 증여·유상취득한 주식이 5년 이내 상장되거나 특수관계 상장법인과 합병되어 가치가 증가했을 때</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="slProvision">' +
          '<option value="listing">주식등의 상장(§41의3)</option><option value="merger">합병에 따른 상장(§41의5)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>정산기준일 1주당 평가가액</label><input type="number" id="slSettlementValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>증여받은날(취득일) 1주당 과세가액(취득가액)</label><input type="number" id="slOriginalValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>1주당 기업가치의 실질적인 증가로 인한 이익</label><input type="number" id="slRealIncrease" placeholder="원 (시행령§31의3⑤, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>[가액 하락시만] 당초 납부한 증여세액</label><input type="number" id="slOriginalGiftTaxPaid" placeholder="원 (정산기준일 가액이 당초보다 기준금액 이상 낮아졌을 때 환급액 계산용)"></div>' +
        '<div class="taxcalc-field"><label>증여받거나 유상취득한 주식수</label><input type="number" id="slShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="slRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="slAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="slFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="slFraudulent"><label for="slFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="slUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(정산기준일)</label><input type="text" class="taxcalc-date" id="slGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="slPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="slUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="slMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="slUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-stock-listing-gift">증여세 계산하기</button>' +
      '<div id="taxCalcStockListingGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>비과세되는 증여재산(§46) — 국가·지자체 증여, 우리사주조합 취득이익, 정당·사내근로복지기금 등 단체 증여, 이재구호금품·치료비·생활비·교육비, 장애인 보험금, 국가유공자 유족 성금, 비영리법인 승계재산 등</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>항목 구분</label><select id="ntItemType">' +
          '<option value="government">국가·지방자치단체 증여(1호)</option>' +
          '<option value="esop">우리사주조합 취득이익(2호)</option>' +
          '<option value="political_party">정당 증여(3호)</option>' +
          '<option value="labor_welfare_fund">사내근로복지기금 등(4호)</option>' +
          '<option value="disaster_relief">이재구호금품·치료비·생활비·교육비(5호)</option>' +
          '<option value="credit_guarantee_fund">신용보증기금 등(6호)</option>' +
          '<option value="public_entity">국가·지자체·공공단체(7호)</option>' +
          '<option value="disabled_insurance">장애인 보험금(8호)</option>' +
          '<option value="veteran_bereaved">국가유공자·의사자 유족 성금(9호)</option>' +
          '<option value="npo_succession">비영리법인 승계재산(10호)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>금액</label><input type="number" id="ntAmount" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-nontaxable-gift">비과세 여부 확인하기</button>' +
      '<div id="taxCalcNontaxableGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>공익법인 출연재산 과세가액 불산입(§16 상속세·§48① 증여세) — 원칙 전액 불산입, 내국법인 주식등은 합산주식수가 한도비율(10/20/5%) 초과시 그 초과분만 과세가액 산입</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="cdTaxType"><option value="gift">증여세(§48①)</option><option value="inheritance">상속세(§16)</option></select></div>' +
        '<div class="taxcalc-field"><label>출연재산 구분</label><select id="cdAssetType"><option value="general">일반재산</option><option value="stock">내국법인 의결권있는 주식등</option></select></div>' +
        '<div class="taxcalc-field"><label>출연재산가액</label><input type="number" id="cdDonatedAmount" placeholder="원 (주식등이면 출연주식 평가액)"></div>' +
        '<div class="taxcalc-field"><label>[주식등만] 한도비율 구분</label><select id="cdRatioType">' +
          '<option value="general">원칙(10%)</option>' +
          '<option value="nonvoting_charity">의결권미행사+자선장학사회복지목적(20%)</option>' +
          '<option value="conglomerate_related">상호출자제한기업집단 특수관계(5%)</option>' +
          '<option value="noncompliant">§48⑪요건 미충족(5%)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[주식등만] 발행주식총수등</label><input type="number" id="cdTotalShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[주식등만] 이번 출연주식수</label><input type="number" id="cdDonatedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>[주식등만] 합산대상 기존 보유 동일법인 주식수</label><input type="number" id="cdPriorRelatedShares" placeholder="주 (없으면 0)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-charity-donation-exclusion">과세가액 산입액 계산하기</button>' +
      '<div id="taxCalcCharityDonationExclusionResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>공익법인등에 대한 가산세(§78) — 유형을 고른 뒤 해당하는 입력란만 채우세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>가산세 유형</label><select id="poPenaltyType">' +
          '<option value="report_not_filed">§78③ 출연재산 사용계획보고서 미제출·불분명</option>' +
          '<option value="stock_holding_exceeded_5pct">§78④(§49①) 주식등 5%보유기준 초과</option>' +
          '<option value="management_violation">§78⑤ 세무확인·장부작성비치·회계감사 의무 불이행</option>' +
          '<option value="director_excess">§78⑥ 이사정원(5분의1) 초과</option>' +
          '<option value="stock_holding_exceeded_related">§78⑦(§48⑨) 특수관계법인주식 30%/50%한도 초과</option>' +
          '<option value="advertising">§78⑧(§48⑩) 특수관계법인 무상 광고·홍보</option>' +
          '<option value="income_underused">§78⑨(§48②5·7호) 운용소득·매각대금·기준금액 미달사용</option>' +
          '<option value="dedicated_account_not_opened">§78⑩2호 전용계좌 개설·신고 미이행</option>' +
          '<option value="dedicated_account_unused">§78⑩1호 전용계좌 미사용</option>' +
          '<option value="disclosure_violation">§78⑪ 결산서류등 공시의무 위반</option>' +
          '<option value="report_not_filed_5pct">§78⑭(§48⑬) 의무이행여부 신고 미이행</option>' +
          '<option value="cultural_heritage_status_not_filed">§78⑮1호(§74⑤⑥) 문화유산 보유현황자료 미제출</option>' +
          '<option value="cultural_heritage_transfer_not_filed">§78⑮2호(§74⑤⑦) 문화유산 양도사실 미신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[보고서미제출만] 상당 상속세·증여세액</label><input type="number" id="poBaseTaxAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[문화유산자료미제출·미신고만] 징수유예 받은 상속세액</label><input type="number" id="poDeferredTaxAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[5%보유초과만] 초과주식 시가</label><input type="number" id="poExcessStockValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[세무확인등만] 수입금액+출연재산가액</label><input type="number" id="poRevenueAndDonation" placeholder="원 (해당 과세기간·사업연도)"></div>' +
        '<div class="taxcalc-field"><label>[세무확인등만] 위반 세부유형</label><select id="poViolationSubType">' +
          '<option value="tax_confirmation">세무확인 보고의무 불이행(최소100만원)</option>' +
          '<option value="bookkeeping">장부작성·비치의무 불이행</option>' +
          '<option value="audit">회계감사의무 불이행</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[이사초과만] 관련 직접·간접경비</label><input type="number" id="poRelatedExpense" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[30/50%초과만] 보유 중인 특수관계법인 주식가액</label><input type="number" id="poStockValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[30/50%초과·공시위반·미신고만] 총재산가액(자산총액)</label><input type="number" id="poTotalAssetValue" placeholder="원"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="poMeetsCompliance"><label for="poMeetsCompliance">[30/50%초과만] 회계감사·전용계좌·결산공시 의무 모두 이행(한도 50%)</label></div>' +
        '<div class="taxcalc-field"><label>[광고홍보만] 직접 지출경비</label><input type="number" id="poDirectExpense" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[미달사용만] 기준금액 미달사용액(직접입력, §48②5호)</label><input type="number" id="poUnderusedAmount" placeholder="원 (§48②7호는 아래 4개 필드로 자동계산 가능)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②7호만] 부채가액</label><input type="number" id="poLiabilityValue" placeholder="원 (직전 과세기간·사업연도 종료일 재무상태표)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②7호만] 당기순이익</label><input type="number" id="poNetIncomeValue" placeholder="원 (같은 기준일 운영성과표)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②7호만] 실제 직접공익목적사업 사용액</label><input type="number" id="poActualDirectUseAmount" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="poUseAssessedValueBasis"><label for="poUseAssessedValueBasis">[미달사용·§48②7호만] 위 총재산가액이 상증세법상 평가액 기준(재무상태표 자산가액이 평가액의 70%이하인 경우)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="poHighHoldingType"><label for="poHighHoldingType">[미달사용만] §48②7호가목 유형(10%초과보유, 가산율 200%)</label></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②5호매각대금만] 매각대금</label><input type="number" id="poSaleProceedsAmount" placeholder="원 (기본재산 매각대금)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②5호매각대금만] 확인시점</label><select id="poSaleCheckpointYear">' +
          '<option value="">선택</option>' +
          '<option value="1">매각일로부터 1년(30%기준)</option>' +
          '<option value="2">매각일로부터 2년(60%기준)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②5호매각대금만] 누적 실제사용액</label><input type="number" id="poCumulativeActualUsedAmount" placeholder="원 (매각일부터 확인시점까지)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②5호운용소득만] 수익사업 소득금액등 합계</label><input type="number" id="poOperatingIncomeAmount" placeholder="원 (시행령§38⑤1호)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②5호운용소득만] 법인세등 및 이월결손금</label><input type="number" id="poTaxAndCarryforwardLossAmount" placeholder="원 (시행령§38⑤2호)"></div>' +
        '<div class="taxcalc-field"><label>[미달사용·§48②5호운용소득만] 실제 사용액</label><input type="number" id="poActualOperatingIncomeUsedAmount" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>[전용계좌미사용만] 미사용 거래금액</label><input type="number" id="poUnusedTransaction" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[전용계좌미개설·가목만] 직접 공익목적사업 관련 수입금액 총액</label><input type="number" id="poDirectBusinessRevenueAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[전용계좌미개설·가목만] 미개설·미신고 일수</label><input type="number" id="poUnregisteredDays" placeholder="일 (신고기한 다음날~신고일 전날)"></div>' +
        '<div class="taxcalc-field"><label>[전용계좌미개설·가목만] 해당 과세기간(사업연도) 총 일수</label><input type="number" id="poTotalPeriodDays" placeholder="일"></div>' +
        '<div class="taxcalc-field"><label>[전용계좌미개설·나목만] §50의2①1~4호 거래금액 합계</label><input type="number" id="poTotalRelevantTransactionAmount" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-public-interest-org-penalty">가산세액 계산하기</button>' +
      '<div id="taxCalcPublicInterestOrgPenaltyResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>장애인이 증여받은 재산의 과세가액 불산입(§52의2) — 장애인 본인 수익 자익신탁 또는 타인이 장애인 수익으로 설정한 타익신탁, 생애 5억원 한도</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="dtMeetsRequirements"><label for="dtMeetsRequirements">신탁업자 신탁·장애인 전부수익자 등 §52의2①·②요건 충족</label></div>' +
        '<div class="taxcalc-field"><label>증여받은 재산가액(자익) 또는 신탁원본가액(타익)</label><input type="number" id="dtAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>기존 누적 활용액(생애)</label><input type="number" id="dtPriorCumulative" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>사후관리 위반 사유</label><select id="dtTriggerEvent">' +
          '<option value="none">없음</option>' +
          '<option value="terminated_not_rejoined">해지·만료(1개월내 재가입 안함)</option>' +
          '<option value="beneficiary_changed">수익자 변경</option>' +
          '<option value="benefit_diverted">이익이 타인에게 귀속</option>' +
          '<option value="principal_decreased">신탁원본 감소</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="dtExempted"><label for="dtExempted">부득이한 사유 또는 의료비 등 정해진 용도의 인출임(즉시과세 예외)</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-disabled-trust-exclusion">과세가액 산입액 계산하기</button>' +
      '<div id="taxCalcDisabledTrustExclusionResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>합병에 따른 이익의 증여(§38) — 특수관계 법인간 합병에서 대주주등이 합병대가를 주식등으로 교부받아 이익을 얻은 경우(가장 흔한 유형)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>합병후 신설·존속법인 1주당평가액</label><input type="number" id="mgPostValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>과대평가법인 합병전 1주당평가액</label><input type="number" id="mgOvervaluedValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>과대평가법인 합병전 주식수</label><input type="number" id="mgOvervaluedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>과대평가법인 주주등이 교부받은 신설법인 주식수(전체)</label><input type="number" id="mgReceivedShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>대주주등이 교부받은 신설법인 주식수</label><input type="number" id="mgLargeShareholderShares" placeholder="주"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일한 합병등 이전거래 이익 합계(§43②)</label><input type="number" id="mgPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="mgRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="mgAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="mgFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="mgFraudulent"><label for="mgFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="mgUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(합병등기일)</label><input type="text" class="taxcalc-date" id="mgGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="mgPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="mgUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="mgMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="mgUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-merger-gift">증여세 계산하기</button>' +
      '<div id="taxCalcMergerGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>재산사용·용역제공 등에 따른 이익의 증여(§42) — 부동산·금전이 아닌 재산을 무상·저가·고가로 사용하거나 용역을 무상·저가·고가로 제공·제공받은 경우</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="puUseType">' +
          '<option value="free">무상사용·무상용역·무상담보차입</option><option value="low_or_high">저가 또는 고가로 사용·제공</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="puCollateralLoan"><label for="puCollateralLoan">[무상만] 타인재산을 무상담보로 제공받아 차입함</label></div>' +
        '<div class="taxcalc-field"><label>[무상+담보차입] 차입금</label><input type="number" id="puLoanAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[무상+담보차입] 실제 지급한 이자</label><input type="number" id="puActualInterest" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>[무상, 담보차입 아님] 시가 상당액</label><input type="number" id="puMarketValueEquiv" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[저가·고가만] 시가</label><input type="number" id="puMarketValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[저가·고가만] 실제 지급·수령한 대가</label><input type="number" id="puConsideration" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형 이전거래 이익 합계(§43②)</label><input type="number" id="puPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="puRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="puAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="puFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="puFraudulent"><label for="puFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="puUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일</label><input type="text" class="taxcalc-date" id="puGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="puPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="puUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="puMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="puUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-property-use-gift">증여세 계산하기</button>' +
      '<div id="taxCalcPropertyUseGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>법인의 조직 변경 등에 따른 이익의 증여(§42의2) — 주식의 포괄적 교환·이전, 사업양수도, 사업교환, 조직변경 등으로 소유지분이나 그 가액이 변동된 경우</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="ocSubType">' +
          '<option value="share_change">소유지분이 변동된 경우</option><option value="value_change">평가액이 변동된 경우</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[지분변동만] 변동 전 지분</label><input type="number" id="ocBeforeShares" placeholder="주식수 등"></div>' +
        '<div class="taxcalc-field"><label>[지분변동만] 변동 후 지분</label><input type="number" id="ocAfterShares" placeholder="주식수 등"></div>' +
        '<div class="taxcalc-field"><label>[지분변동만] 지분 변동 후 1주당 가액</label><input type="number" id="ocAfterValuePerShare" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[지분변동만] 변동 전 재산가액(게이트용)</label><input type="number" id="ocBeforePropertyValue" placeholder="원 (없으면 변동전지분×변동후1주당가액으로 대체)"></div>' +
        '<div class="taxcalc-field"><label>[평가액변동만] 변동 전 가액</label><input type="number" id="ocBeforeValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[평가액변동만] 변동 후 가액</label><input type="number" id="ocAfterValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>증여재산공제 남은 한도액</label><input type="number" id="ocRelationDeduction" placeholder="원 (관계별 §53 한도, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ocAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="ocFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ocFraudulent"><label for="ocFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="ocUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일</label><input type="text" class="taxcalc-date" id="ocGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="ocPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="ocUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="ocMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="ocUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-org-change-gift">증여세 계산하기</button>' +
      '<div id="taxCalcOrgChangeGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>재산 취득 후 재산가치 증가에 따른 이익의 증여(§42의3) — 자력없는 자가 특수관계인으로부터 증여·차입 등으로 재산을 취득한 후 5년 이내 개발사업·형질변경 등으로 재산가치가 증가한 경우</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>재산가치증가사유 발생일 현재 재산가액</label><input type="number" id="pvEventValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="pvAcquisitionCost" placeholder="원 (증여받은 재산이면 그 증여세 과세가액)"></div>' +
        '<div class="taxcalc-field"><label>통상적인 가치상승분</label><input type="number" id="pvNormalAppreciation" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>가치상승기여분</label><input type="number" id="pvContribution" placeholder="원 (개발·형질변경 등 자본적지출액)"></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="pvAppraisalFee" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="pvFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="pvFraudulent"><label for="pvFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="pvUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>증여일(재산가치증가사유 발생일)</label><input type="text" class="taxcalc-date" id="pvGiftDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="text" class="taxcalc-date" id="pvPaidDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산)</label><input type="number" id="pvUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="pvMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="pvUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-property-value-increase-gift">증여세 계산하기</button>' +
      '<div id="taxCalcPropertyValueIncreaseGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제11호서식] 연부연납(다년 분할납부) 계산 — 신고 후 매년 나눠 낼 회차별 세액을 계산합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="ipGiftTaxType"><option value="gift" selected>증여세</option><option value="inheritance">상속세</option></select></div>' +
        '<div class="taxcalc-field"><label>총 납부세액</label><input type="number" id="ipGiftTotal" placeholder="원 (2천만원 초과해야 신청 가능)"><span class="taxcalc-result-note" id="ipGiftTotalHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>최초 납부세액(신고기한까지 먼저 납부)</label><input type="number" id="ipGiftInitial" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>연부연납기간</label><input type="number" id="ipGiftYears" placeholder="년 (증여세 일반5/특례15, 상속세 일반10/가업20)" maxlength="2"></div>' +
        '<div class="taxcalc-field"><label>연부연납 가산금 연이자율</label><input type="number" step="0.01" id="ipGiftRate" placeholder="% (신고 시점 기준 확인 필요)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-installment-gift">연부연납 계산하기</button>' +
      '<div id="taxCalcInstallmentGiftResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>사후관리 위반 추징 이자상당액 계산 — 영농자녀 증여농지 감면·창업자금 특례·가업승계 주식등 특례 등 사후관리 위반으로 추징될 때 공통으로 씁니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>추징세액(당초 감면·특례로 줄었던 세액)</label><input type="number" id="ckAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>이자 기산일(당초 신고기한 다음날 등)</label><input type="date" id="ckStartDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>추징사유 발생일</label><input type="date" id="ckEndDate" min="1900-01-01" max="2099-12-31"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-clawback-interest">이자상당액 계산하기</button>' +
      '<div id="taxCalcClawbackResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>가업상속납부유예(§72의2)·가업승계증여세납부유예(조특법§30의7) 납부유예금액 계산 — 얼마까지 유예받을 수 있는지 계산합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>적용 조문</label><select id="bdProvision">' +
          '<option value="inheritance">§72의2(가업상속납부유예)</option>' +
          '<option value="gift">조특법§30의7(가업승계증여세납부유예)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>산출세액</label><input type="number" id="bdTaxPayable" placeholder="원 (상속세 또는 증여세)"></div>' +
        '<div class="taxcalc-field"><label>가업상속재산가액·가업자산상당액</label><input type="number" id="bdBusinessValue" placeholder="원 (§15⑤ 기준, 증여는 같은 호 준용·상속개시일→증여일)"></div>' +
        '<div class="taxcalc-field"><label>총 상속재산가액·총 증여재산가액</label><input type="number" id="bdTotalValue" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-business-succession-deferral-amount">납부유예금액 계산하기</button>' +
      '<div id="taxCalcBusinessSuccessionDeferralAmountResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>가업상속납부유예(§72의2)·가업승계증여세납부유예(조특법§30의7) 사후관리 추징 판정 — 추징세액이 나오면 위 "사후관리 위반 추징 이자상당액 계산"에 이 추징세액과 납부유예 허가일·사유발생일을 넣어 이자상당액을 마저 계산하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>적용 조문</label><select id="bcProvision">' +
          '<option value="inheritance">§72의2(가업상속납부유예)</option>' +
          '<option value="gift">조특법§30의7(가업승계증여세납부유예)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>납부유예된 세액</label><input type="number" id="bcDeferredTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>사후관리 위반 사유</label><select id="bcTriggerEvent">' +
          '<option value="none">없음(납부유예 계속 유지)</option>' +
          '<option value="asset_disposed_40pct">[§72의2만] 가업용자산 40%이상 처분</option>' +
          '<option value="not_engaged">가업 미종사</option>' +
          '<option value="equity_decreased">지분 감소</option>' +
          '<option value="employment_failed">고용유지요건(70%기준) 미달</option>' +
          '<option value="heir_death">[§72의2만] 상속인 사망</option>' +
          '<option value="donee_death">[조특법§30의7만] 수증자 사망</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>[가업용자산처분만] 처분비율</label><input type="number" step="0.01" id="bcDisposalRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field"><label>[지분감소만] 상속개시일·증여일부터 경과연수</label><input type="number" id="bcYearsSinceBase" placeholder="년"></div>' +
        '<div class="taxcalc-field"><label>[지분감소·5년후만] 기준일 현재 지분율</label><input type="number" step="0.01" id="bcEquityRatioAtBase" placeholder="0~1 (상속개시일·증여일 현재)"></div>' +
        '<div class="taxcalc-field"><label>[지분감소·5년후만] 감소 후 현재 지분율</label><input type="number" step="0.01" id="bcCurrentEquityRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field"><label>[지분감소·5년후만] 지분감소비율 직접입력(선택)</label><input type="number" step="0.01" id="bcEquityDecreaseRatio" placeholder="0~1 (위 2개 필드 대신 이미 계산된 B÷C값을 직접 입력할 때만)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-business-succession-deferral-clawback">추징세액 판정하기</button>' +
      '<div id="taxCalcBusinessSuccessionDeferralClawbackResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>물납 적용 가능 여부 판정(상증세법§73 일반물납·§73의2 문화유산등물납) — 요건 충족 여부만 판정하며, 물납충당재산의 구체적 범위·수납가액 산정(시행령 사항)은 다루지 않습니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>물납 종류</label><select id="ikProvision">' +
          '<option value="general">§73(일반물납)</option>' +
          '<option value="cultural_heritage">§73의2(문화유산등물납)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>상속세 납부세액</label><input type="number" id="ikTaxPayable" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>금융재산가액</label><input type="number" id="ikFinancialAsset" placeholder="원 (§13 가산 증여재산가액 제외, 없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>[일반물납만] 부동산·유가증권 가액</label><input type="number" id="ikRealEstateSecurities" placeholder="원 (물납충당가능재산으로 한정)"></div>' +
        '<div class="taxcalc-field"><label>상속재산가액</label><input type="number" id="ikTotalValue" placeholder="원 (§13 가산 증여재산 포함, 일반물납은 필수)"></div>' +
        '<div class="taxcalc-field"><label>[문화유산등물납만] 문화유산등 가액</label><input type="number" id="ikCulturalValue" placeholder="원 (물납신청가능세액 한도 계산용)"></div>' +
        '<div class="taxcalc-field"><label>[문화유산등물납만] 정당한사유없이 훼손·멸실된 가액(선택)</label><input type="number" id="ikExcludedDamagedValue" placeholder="원 (상속개시일~물납신청 전, 있으면 한도에서 제외)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-property-in-kind-payment-eligibility">적용 가능 여부 판정하기</button>' +
      '<div id="taxCalcPropertyInKindPaymentResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>물납충당재산(주식) 수납가액 계산(시행규칙§20의2) — 상속개시일부터 물납수납일까지 신주발행·감자가 있었던 경우에만 씁니다(그 외에는 수납가액=상속재산의 가액)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>구분</label><select id="svChangeType">' +
          '<option value="free_increase">무상증자</option>' +
          '<option value="paid_increase">유상증자</option>' +
          '<option value="free_decrease">무상감자</option>' +
          '<option value="paid_decrease">유상감자</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>구주식 1주당 과세가액</label><input type="number" id="svOldValue" placeholder="원 (신주발행·감자 전)"></div>' +
        '<div class="taxcalc-field"><label>[증자만] 구주식 1주당 신주배정수</label><input type="number" step="0.01" id="svNewSharesPerOld" placeholder="예: 0.2 (구주 5주당 신주 1주)"></div>' +
        '<div class="taxcalc-field"><label>[유상증자만] 신주 1주당 주금납입액</label><input type="number" id="svPaymentPerNewShare" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[감자만] 구주식 1주당 감자주식수</label><input type="number" step="0.01" id="svDecreasedSharesPerOld" placeholder="예: 0.1 (1 미만)"></div>' +
        '<div class="taxcalc-field"><label>[유상감자만] 1주당 지급금액</label><input type="number" id="svPaymentPerDecreasedShare" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-property-in-kind-stock-receipt-value">수납가액 계산하기</button>' +
      '<div id="taxCalcPropertyInKindStockReceiptResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>지정문화유산 등에 대한 상속세·증여세 징수유예(상증세법§74·§75) — 문화유산자료등·박물관자료등·국가지정문화유산등·천연기념물등에 상당하는 세액의 징수를 유예합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="chTaxType"><option value="inheritance">상속세(§74)</option><option value="gift">증여세(§75, 박물관자료등만 가능)</option></select></div>' +
        '<div class="taxcalc-field"><label>재산 종류</label><select id="chItemType">' +
          '<option value="cultural_property">문화유산자료등</option>' +
          '<option value="museum_material">박물관자료등</option>' +
          '<option value="national_heritage">국가지정문화유산등</option>' +
          '<option value="natural_monument">천연기념물등</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>전체 산출세액</label><input type="number" id="chTotalTax" placeholder="원 (징수유예 적용 전)"></div>' +
        '<div class="taxcalc-field"><label>전체 재산가액</label><input type="number" id="chTotalProperty" placeholder="원 (상속재산가액 또는 증여재산가액)"></div>' +
        '<div class="taxcalc-field"><label>징수유예 대상 재산가액</label><input type="number" id="chEligibleProperty" placeholder="원 (문화유산자료등·박물관자료등 등)"></div>' +
        '<div class="taxcalc-field"><label>사후관리 사유</label><select id="chTriggerEvent">' +
          '<option value="none">없음(계속 유예)</option>' +
          '<option value="transferred_or_withdrawn">유상양도 또는 인출(즉시징수)</option>' +
          '<option value="reinheritance_death">[상속세만] 소유자 사망으로 재상속(부과철회)</option>' +
        '</select></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-cultural-heritage-tax-deferral">징수유예세액 계산하기</button>' +
      '<div id="taxCalcCulturalHeritageTaxDeferralResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>저가양수·고가양도에 따른 이익의 증여의제(§35) — 시가보다 낮게(높게) 거래했을 때 증여재산가액을 계산합니다. 계산된 금액은 위 일반 증여세 계산기의 증여재산가액에 넣어 세액까지 계산하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>거래 상대방</label><select id="lpIsSpecialRelation">' +
          '<option value="true">특수관계인 간(§35①, 기준금액=min(시가×30%, 3억원))</option>' +
          '<option value="false">비특수관계인 간(§35②, 게이트=시가×30%, 차감액=3억원 정액 — 거래관행상 정당한 사유 없을 것)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>시가</label><input type="number" id="lpFairValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>실제 거래대가</label><input type="number" id="lpTransferPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형 이전거래 이익 합계(§43②)</label><input type="number" id="lpPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-low-price-transfer">증여재산가액 계산하기</button>' +
      '<div id="taxCalcLowPriceResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>금전 무상대출 등에 따른 이익의 증여의제(§41의4) — 특수관계인 간 무이자·저리로 돈을 빌려줬을 때 증여재산가액을 계산합니다. 계산된 금액은 위 일반 증여세 계산기의 증여재산가액에 넣어 세액까지 계산하세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>대여원금</label><input type="number" id="loanPrincipal" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>실제 지급(약정)이자</label><input type="number" id="loanActualInterest" placeholder="원 (무이자면 0)"></div>' +
        '<div class="taxcalc-field"><label>1년 이내 동일유형 이전거래 이익 합계(§43②)</label><input type="number" id="loanPriorBenefitsSum" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>적정이자율(법정 기본값 4.6%, 개정 시 직접 수정)</label><input type="number" step="0.1" id="loanRate" value="4.6"></div>' +
        '<div class="taxcalc-field"><label>대출기간</label><input type="number" id="loanMonths" placeholder="개월 (기본 12)" maxlength="3"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-interest-free-loan">증여재산가액 계산하기</button>' +
      '<div id="taxCalcLoanResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>증여세 과세특례 — 조문 중복적용 배제(§43①) — 하나의 증여에 §33~39·39의2·39의3·40·41의2~41의5·42·42의2·42의3·44·45·45의3~45의5 중 둘 이상의 증여의제·증여추정 규정이 동시에 적용될 수 있을 때, 각 조문별로 계산한 증여재산가액을 아래에 입력하면 이익이 가장 많은 것 하나만 골라줍니다(나머지는 적용하지 않음)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>후보1 조문</label><input type="text" id="gspArticle1" placeholder="예: §35 저가양수"></div>' +
        '<div class="taxcalc-field"><label>후보1 증여재산가액</label><input type="number" id="gspAmount1" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>후보2 조문</label><input type="text" id="gspArticle2" placeholder="예: §42 재산사용이익"></div>' +
        '<div class="taxcalc-field"><label>후보2 증여재산가액</label><input type="number" id="gspAmount2" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>후보3 조문(선택)</label><input type="text" id="gspArticle3" placeholder=""></div>' +
        '<div class="taxcalc-field"><label>후보3 증여재산가액(선택)</label><input type="number" id="gspAmount3" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>후보4 조문(선택)</label><input type="text" id="gspArticle4" placeholder=""></div>' +
        '<div class="taxcalc-field"><label>후보4 증여재산가액(선택)</label><input type="number" id="gspAmount4" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-gift-special-provision-overlap">중복적용 배제 판정하기</button>' +
      '<div id="taxCalcGiftOverlapResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>시가 인정범위 판정(§60②, 시행령§49) — 매매·감정·수용·경매·공매 증거가액을 다른 계산기의 "시가"로 쓰기 전에, 평가기간·특수관계인거래·비상장주식 최소요건·감정가액 기준금액을 확인합니다(상속·증여 공통)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="fmvTaxType">' +
          '<option value="gift">증여(평가기준일 전 6개월~후 3개월)</option>' +
          '<option value="inheritance">상속(평가기준일 전후 6개월)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>평가기준일(상속개시일 또는 증여일)</label><input type="text" class="taxcalc-date" id="fmvBaseDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field"><label>증거 유형</label><select id="fmvEvidenceType">' +
          '<option value="sale">매매</option>' +
          '<option value="appraisal">감정</option>' +
          '<option value="expropriation_auction_public_sale">수용·경매·공매</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>증거일(매매계약일 / 가격산정기준일·감정평가서작성일 / 가액결정일)</label><input type="text" class="taxcalc-date" id="fmvEvidenceDate" placeholder="YYYY-MM-DD"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="fmvRelatedParty"><label for="fmvRelatedParty">[매매만] 특수관계인과의 거래</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="fmvUnlistedStock"><label for="fmvUnlistedStock">평가대상이 비상장주식등</label></div>' +
        '<div class="taxcalc-field"><label>[비상장주식만] 거래(취득)주식 액면가액 합계</label><input type="number" id="fmvTradedFaceValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[비상장주식만] 발행주식총액(액면가액 합계)</label><input type="number" id="fmvTotalFaceValue" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[감정만] 감정가액 평균</label><input type="number" id="fmvAppraisalAvg" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[감정만] 보충적평가액(§61·62·64·65)</label><input type="number" id="fmvSupplementaryValue" placeholder="원 (유가증권등§63 재산은 해당없음)"></div>' +
        '<div class="taxcalc-field"><label>[감정만, 선택] 유사재산 시가의 90%</label><input type="number" id="fmvSimilar90" placeholder="원 (있으면)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-fair-market-value-recognition">시가 인정 여부 판정하기</button>' +
      '<div id="taxCalcFmvRecognitionResult"></div>' +
    '</div>';
  renderValuationAssetList('giftValuationList', giftValuationAssets);
  const giftDateEl = document.getElementById('giftDate');
  const giftPaidDateEl = document.getElementById('giftPaidDate');
  if (giftDateEl) giftDateEl.addEventListener('input', recomputeGiftUnpaidDays);
  if (giftPaidDateEl) giftPaidDateEl.addEventListener('input', recomputeGiftUnpaidDays);
  recomputeGiftUnpaidDays();
  const giftMarriageDateEl = document.getElementById('giftMarriageDate');
  const giftBirthDateEl = document.getElementById('giftBirthDate');
  if (giftDateEl) giftDateEl.addEventListener('input', updateGiftMarriageBirthHints);
  if (giftMarriageDateEl) giftMarriageDateEl.addEventListener('input', updateGiftMarriageBirthHints);
  if (giftBirthDateEl) giftBirthDateEl.addEventListener('input', updateGiftMarriageBirthHints);
  updateGiftMarriageBirthHints();
  const giftDoneeRegNoEl = document.getElementById('giftDoneeRegNo');
  if (giftDateEl) giftDateEl.addEventListener('input', updateGiftMinorHint);
  if (giftDoneeRegNoEl) giftDoneeRegNoEl.addEventListener('input', updateGiftMinorHint);
  updateGiftMinorHint();
  const srGiftDateEl = document.getElementById('srGiftDate');
  const srPaidDateEl = document.getElementById('srPaidDate');
  if (srGiftDateEl) srGiftDateEl.addEventListener('input', recomputeSrGiftUnpaidDays);
  if (srPaidDateEl) srPaidDateEl.addEventListener('input', recomputeSrGiftUnpaidDays);
  const afGiftDateEl = document.getElementById('afGiftDate');
  const afPaidDateEl = document.getElementById('afPaidDate');
  if (afGiftDateEl) afGiftDateEl.addEventListener('input', recomputeAfUnpaidDays);
  if (afPaidDateEl) afPaidDateEl.addEventListener('input', recomputeAfUnpaidDays);
  const dfGiftDateEl = document.getElementById('dfGiftDate');
  const dfPaidDateEl = document.getElementById('dfPaidDate');
  if (dfGiftDateEl) dfGiftDateEl.addEventListener('input', recomputeDfUnpaidDays);
  if (dfPaidDateEl) dfPaidDateEl.addEventListener('input', recomputeDfUnpaidDays);
  const ciGiftDateEl = document.getElementById('ciGiftDate');
  const ciPaidDateEl = document.getElementById('ciPaidDate');
  if (ciGiftDateEl) ciGiftDateEl.addEventListener('input', recomputeCiUnpaidDays);
  if (ciPaidDateEl) ciPaidDateEl.addEventListener('input', recomputeCiUnpaidDays);
  const crGiftDateEl = document.getElementById('crGiftDate');
  const crPaidDateEl = document.getElementById('crPaidDate');
  if (crGiftDateEl) crGiftDateEl.addEventListener('input', recomputeCrUnpaidDays);
  if (crPaidDateEl) crPaidDateEl.addEventListener('input', recomputeCrUnpaidDays);
  const icfGiftDateEl = document.getElementById('icfGiftDate');
  const icfPaidDateEl = document.getElementById('icfPaidDate');
  if (icfGiftDateEl) icfGiftDateEl.addEventListener('input', recomputeIcfUnpaidDays);
  if (icfPaidDateEl) icfPaidDateEl.addEventListener('input', recomputeIcfUnpaidDays);
  const cbGiftDateEl = document.getElementById('cbGiftDate');
  const cbPaidDateEl = document.getElementById('cbPaidDate');
  if (cbGiftDateEl) cbGiftDateEl.addEventListener('input', recomputeCbUnpaidDays);
  if (cbPaidDateEl) cbPaidDateEl.addEventListener('input', recomputeCbUnpaidDays);
  const edGiftDateEl = document.getElementById('edGiftDate');
  const edPaidDateEl = document.getElementById('edPaidDate');
  if (edGiftDateEl) edGiftDateEl.addEventListener('input', recomputeEdUnpaidDays);
  if (edPaidDateEl) edPaidDateEl.addEventListener('input', recomputeEdUnpaidDays);
  const slGiftDateEl = document.getElementById('slGiftDate');
  const slPaidDateEl = document.getElementById('slPaidDate');
  if (slGiftDateEl) slGiftDateEl.addEventListener('input', recomputeSlUnpaidDays);
  if (slPaidDateEl) slPaidDateEl.addEventListener('input', recomputeSlUnpaidDays);
  const fuGiftDateEl = document.getElementById('fuGiftDate');
  const fuPaidDateEl = document.getElementById('fuPaidDate');
  if (fuGiftDateEl) fuGiftDateEl.addEventListener('input', recomputeFuUnpaidDays);
  if (fuPaidDateEl) fuPaidDateEl.addEventListener('input', recomputeFuUnpaidDays);
  const spGiftDateEl = document.getElementById('spGiftDate');
  const spPaidDateEl = document.getElementById('spPaidDate');
  if (spGiftDateEl) spGiftDateEl.addEventListener('input', recomputeSpUnpaidDays);
  if (spPaidDateEl) spPaidDateEl.addEventListener('input', recomputeSpUnpaidDays);
  const ipGiftDateEl = document.getElementById('ipGiftDate');
  const ipPaidDateEl = document.getElementById('ipPaidDate');
  if (ipGiftDateEl) ipGiftDateEl.addEventListener('input', recomputeIpUnpaidDays);
  if (ipPaidDateEl) ipPaidDateEl.addEventListener('input', recomputeIpUnpaidDays);
  const tiGiftDateEl = document.getElementById('tiGiftDate');
  const tiPaidDateEl = document.getElementById('tiPaidDate');
  if (tiGiftDateEl) tiGiftDateEl.addEventListener('input', recomputeTiUnpaidDays);
  if (tiPaidDateEl) tiPaidDateEl.addEventListener('input', recomputeTiUnpaidDays);
  recomputeSrGiftUnpaidDays();
  const jmFiscalYearEndEl = document.getElementById('jmFiscalYearEnd');
  const jmPaidDateEl = document.getElementById('jmPaidDate');
  if (jmFiscalYearEndEl) jmFiscalYearEndEl.addEventListener('input', recomputeJmUnpaidDays);
  if (jmPaidDateEl) jmPaidDateEl.addEventListener('input', recomputeJmUnpaidDays);
  const scFiscalYearEndEl = document.getElementById('scFiscalYearEnd');
  const scPaidDateEl = document.getElementById('scPaidDate');
  if (scFiscalYearEndEl) scFiscalYearEndEl.addEventListener('input', recomputeScUnpaidDays);
  if (scPaidDateEl) scPaidDateEl.addEventListener('input', recomputeScUnpaidDays);
  const mgGiftDateEl = document.getElementById('mgGiftDate');
  const mgPaidDateEl = document.getElementById('mgPaidDate');
  if (mgGiftDateEl) mgGiftDateEl.addEventListener('input', recomputeMgUnpaidDays);
  if (mgPaidDateEl) mgPaidDateEl.addEventListener('input', recomputeMgUnpaidDays);
  const puGiftDateEl = document.getElementById('puGiftDate');
  const puPaidDateEl = document.getElementById('puPaidDate');
  if (puGiftDateEl) puGiftDateEl.addEventListener('input', recomputePuUnpaidDays);
  if (puPaidDateEl) puPaidDateEl.addEventListener('input', recomputePuUnpaidDays);
  const ocGiftDateEl = document.getElementById('ocGiftDate');
  const ocPaidDateEl = document.getElementById('ocPaidDate');
  if (ocGiftDateEl) ocGiftDateEl.addEventListener('input', recomputeOcUnpaidDays);
  if (ocPaidDateEl) ocPaidDateEl.addEventListener('input', recomputeOcUnpaidDays);
  const pvGiftDateEl = document.getElementById('pvGiftDate');
  const pvPaidDateEl = document.getElementById('pvPaidDate');
  if (pvGiftDateEl) pvGiftDateEl.addEventListener('input', recomputePvUnpaidDays);
  if (pvPaidDateEl) pvPaidDateEl.addEventListener('input', recomputePvUnpaidDays);
  recomputeJmUnpaidDays();
  const jtFiscalYearEndEl = document.getElementById('jtFiscalYearEnd');
  const jtPaidDateEl = document.getElementById('jtPaidDate');
  if (jtFiscalYearEndEl) jtFiscalYearEndEl.addEventListener('input', recomputeJtUnpaidDays);
  if (jtPaidDateEl) jtPaidDateEl.addEventListener('input', recomputeJtUnpaidDays);
  recomputeJtUnpaidDays();
  wireMoneyCapHint_('giftAppraisalFee', 'giftAppraisalFeeHint', 5000000);
  wireMoneyCapHint_('srAppraisalFee', 'srAppraisalFeeHint', 5000000);
  wireRangeClamp_('jmTradeRatio', 0, 100);
  wireRangeClamp_('jmShareRatio', 0, 100);
  wireRangeClamp_('jtShareRatio', 0, 100);
  wireRangeClamp_('ipGiftRate', 0, 30);
  wireMinThresholdHint_('ipGiftTotal', 'ipGiftTotalHint', 20000000);
  wireRangeClamp_('loanRate', 0, 30);
  enhanceNumberInputs(taxCalcGiftPane);
  enhanceDateInputs(taxCalcGiftPane);
  enhanceRegNoInputs(taxCalcGiftPane);
  enhanceNameOnlyInputs(taxCalcGiftPane);
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
  if (r.세대생략할증_적용비율 != null) html += taxCalcResultRow('(세대생략할증 적용비율)', (r.세대생략할증_적용비율 * 100).toFixed(1) + '%');
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
  if (r.채무공제_배제여부) html += '<div class="taxcalc-result-note">⚠ ' + r.채무공제_배제사유 + '</div>';
  if (r.인수채무액) html += '<div class="taxcalc-result-note">인수채무액 ' + won(r.인수채무액) + '에 상당하는 부분은 증여자에게 별도로 양도소득세가 과세됩니다 — 양도소득세 탭에서 함께 계산하세요.</div>';
  html += '<div class="taxcalc-result-note">납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있습니다. 창업자금·가업승계 증여세 과세특례(조특법§30의5·6)를 적용받는 경우 이 계산이 아니라 아래 별도의 특례세율 증여세 계산기를 쓰세요. 실제 신고 전 홈택스 모의계산으로 재검증하세요.</div>';
  html += '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-gift-calc-basis" style="margin-top:8px;">🧮 계산근거 접기/펴기</button>';
  html += '<div class="taxcalc-calcbasis" id="giftCalcBasis">' +
    '<div class="taxcalc-calcbasis-title">계산근거([별지 제10호서식] 증여세과세표준신고 기준)</div>' +
    buildGiftCalcBasisLines(r).map(function(l){ return '<div class="taxcalc-calcbasis-line">' + l + '</div>'; }).join('') +
  '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderNomineeTrustResult(r){
  const box = document.getElementById('taxCalcNomineeTrustResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('명의신탁재산가액', won(r.명의신탁재산가액));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', '-' + won(r.감정평가수수료공제));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.신고세액공제) html += taxCalcResultRow('신고세액공제', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderPropertyFundsResult(r){
  const box = document.getElementById('taxCalcPropertyFundsResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('취득재산의 가액(또는 상환금액)', won(r.취득재산가액));
  html += taxCalcResultRow('입증된 금액', won(r.입증된금액));
  html += taxCalcResultRow('미입증금액', won(r.미입증금액));
  html += taxCalcResultRow('배제기준금액(20%와 2억원 중 적은 금액)', won(r.배제기준금액));
  if (!r.과세대상여부){
    html += taxCalcResultRow('증여추정 적용여부', '적용 안 됨', { total: true });
    html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  html += taxCalcResultRow('증여의제이익(=미입증금액)', won(r.증여의제이익));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.신고세액공제) html += taxCalcResultRow('신고세액공제', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderDeemedGiftGenericResult_(box, r, fields){
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  fields.forEach(function(f){ if (r[f.key] !== undefined && r[f.key] !== null) html += taxCalcResultRow(f.label, f.fmt ? f.fmt(r[f.key]) : won(r[f.key])); });
  if (r.과세대상여부 === false){
    if (r.환급대상여부){
      html += taxCalcResultRow('가액하락액', won(r.가액하락액));
      html += taxCalcResultRow('환급세액', won(r.환급세액), { total: true });
    } else {
      html += taxCalcResultRow('과세대상 여부', '적용 안 됨', { total: true });
    }
    html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  if (r.증여재산공제) html += taxCalcResultRow('증여재산공제', '-' + won(r.증여재산공제));
  if (r.혼인출산공제) html += taxCalcResultRow('혼인출산공제', '-' + won(r.혼인출산공제));
  if (r.감정평가수수료공제) html += taxCalcResultRow('감정평가수수료공제', '-' + won(r.감정평가수수료공제));
  if (r.재해손실공제) html += taxCalcResultRow('재해손실공제', '-' + won(r.재해손실공제));
  if (r.과세표준 !== undefined) html += taxCalcResultRow('과세표준', won(r.과세표준));
  if (r.산출세액 !== undefined) html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.신고세액공제) html += taxCalcResultRow('신고세액공제', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}
function renderDebtForgivenessResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcDebtForgivenessResult'), r, [
    { key: '채무면제등이익', label: '채무면제등이익' }
  ]);
}
function renderCapitalIncreaseGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcCapitalIncreaseGiftResult'), r, [
    { key: '증자후1주당평가액', label: '증자후 1주당 평가액' },
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
}
function renderCapitalReductionGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcCapitalReductionGiftResult'), r, [
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
}
function renderInKindContributionGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcInKindContributionGiftResult'), r, [
    { key: '현물출자후1주당평가액', label: '현물출자후 1주당 평가액' },
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
}
function renderConvertibleBondGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcConvertibleBondGiftResult'), r, [
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
}
function renderExcessDividendGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcExcessDividendGiftResult'), r, [
    { key: '초과배당금액', label: '초과배당금액' },
    { key: '소득세상당액', label: '소득세상당액' },
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
}
function renderStockListingGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcStockListingGiftResult'), r, [
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
}
function renderNontaxableInheritanceResult(r){
  const box = document.getElementById('taxCalcNontaxableInheritanceResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('근거호', r.근거호);
  html += taxCalcResultRow('비과세금액', won(r.비과세금액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}
function renderRuralHouseExclusionResult(r){
  const box = document.getElementById('taxCalcRuralHouseExclusionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용 여부', r.적용여부 ? '적용 가능' : '적용 안 됨', { total: true });
  if (r.사후관리추징대상 !== undefined) html += taxCalcResultRow('사후관리 추징대상', r.사후관리추징대상 ? '예' : '아니오');
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}
function renderFreePropertyUseResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcFreePropertyUseResult'), r, [
    { key: '연간이익', label: '연간이익' },
    { key: '오년간현재가치합계', label: '5년간 현재가치 합계' },
    { key: '기준금액', label: '기준금액' },
    { key: '담보이용이익', label: '담보이용이익' }
  ]);
}
function renderSpousePropertyTransferResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcSpousePropertyTransferResult'), r, [
    { key: '증여추정재산가액', label: '증여추정재산가액' }
  ]);
}
function renderInsuranceProceedsResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcInsuranceProceedsResult'), r, [
    { key: '보험금상당액', label: '보험금상당액' },
    { key: '증여받은재산으로낸보험료', label: '증여받은재산으로낸보험료' },
    { key: '증여재산가액', label: '증여재산가액' }
  ]);
}
function renderTrustIncomeResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcTrustIncomeResult'), r, [
    { key: '신탁이익', label: '신탁이익' }
  ]);
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
  if (r.납부세액공제) html += taxCalcResultRow('이전 특례증여분 기납부세액(조특법§30의5①후단)', '-' + won(r.납부세액공제));
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

function renderMergerGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcMergerGiftResult'), r, [
    { key: '합병이익', label: '합병이익' }
  ]);
}
function renderPropertyUseGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcPropertyUseGiftResult'), r, [
    { key: '이익', label: '이익' }
  ]);
}
function renderOrgChangeGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcOrgChangeGiftResult'), r, [
    { key: '이익', label: '이익' }
  ]);
}
function renderPropertyValueIncreaseGiftResult(r){
  const box = document.getElementById('taxCalcPropertyValueIncreaseGiftResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.과세대상여부 === false){
    html += taxCalcResultRow('재산가치증가이익', won(r.재산가치증가이익));
    html += taxCalcResultRow('과세대상 여부', '적용 안 됨', { total: true });
    if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  html += taxCalcResultRow('재산가치증가이익', won(r.재산가치증가이익));
  html += taxCalcResultRow('과세표준(3천만원 공제후)', won(r.과세표준_3천만원공제후));
  html += taxCalcResultRow('산출세액', won(r.산출세액));
  if (r.신고세액공제) html += taxCalcResultRow('신고세액공제', '-' + won(r.신고세액공제));
  if (r.무신고가산세) html += taxCalcResultRow('무신고가산세', '+' + won(r.무신고가산세));
  if (r.과소신고가산세) html += taxCalcResultRow('과소신고가산세', '+' + won(r.과소신고가산세));
  if (r.납부지연가산세) html += taxCalcResultRow('납부지연가산세', '+' + won(r.납부지연가산세));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderNontaxableGiftResult(r){
  const box = document.getElementById('taxCalcNontaxableGiftResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('근거호', r.근거호);
  html += taxCalcResultRow('비과세금액', won(r.비과세금액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderCharityDonationExclusionResult(r){
  const box = document.getElementById('taxCalcCharityDonationExclusionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.한도비율 !== undefined){
    html += taxCalcResultRow('한도비율', r.한도비율 + '%');
    html += taxCalcResultRow('한도주식수', r.한도주식수 + '주');
    html += taxCalcResultRow('합산주식수', r.합산주식수 + '주');
    html += taxCalcResultRow('초과주식수', r.초과주식수 + '주');
  }
  html += taxCalcResultRow('과세가액불산입액', won(r.과세가액불산입액));
  html += taxCalcResultRow('과세가액산입액', won(r.과세가액산입액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderPublicInterestOrgPenaltyResult(r){
  const box = document.getElementById('taxCalcPublicInterestOrgPenaltyResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('가산세액', won(r.가산세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderDisabledTrustExclusionResult(r){
  const box = document.getElementById('taxCalcDisabledTrustExclusionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  if (r.적용여부 === false){
    html += taxCalcResultRow('적용 여부', '적용 안 됨', { total: true });
    if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }
  if (r.즉시과세대상){
    html += taxCalcResultRow('즉시과세대상금액', won(r.납부세액대상금액), { total: true });
  } else {
    html += taxCalcResultRow('생애누적한도', won(r.생애누적한도));
    html += taxCalcResultRow('기존누적활용액', won(r.기존누적활용액));
    html += taxCalcResultRow('이번한도잔액', won(r.이번한도잔액));
    html += taxCalcResultRow('과세가액불산입액', won(r.과세가액불산입액));
    html += taxCalcResultRow('과세가액산입액', won(r.과세가액산입액), { total: true });
  }
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderSpecificCorpGiftResult(r){
  renderDeemedGiftGenericResult_(document.getElementById('taxCalcSpecificCorpGiftResult'), r, [
    { key: '특정법인의이익', label: '특정법인의 이익(법인세상당액 차감후)' },
    { key: '법인세상당액_전체', label: '법인세상당액(전체)' },
    { key: '증여의제이익', label: '증여의제이익' }
  ]);
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

function renderDeemedInheritanceResult(r){
  const box = document.getElementById('taxCalcDeemedInheritanceResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('원금액', won(r.원금액));
  html += taxCalcResultRow('간주상속재산포함액', won(r.간주상속재산포함액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderClawbackResult(r){
  const box = document.getElementById('taxCalcClawbackResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('추징세액', won(r.추징세액));
  (r.구간별_이자상당액 || []).forEach(function(seg){
    html += taxCalcResultRow(seg.시작일 + ' ~ ' + seg.종료일 + ' (' + seg.일수 + '일, 연 ' + (seg.연이율 * 100).toFixed(1) + '%)', won(seg.이자상당액));
  });
  html += taxCalcResultRow('이자상당액 합계', won(r.이자상당액_합계));
  html += taxCalcResultRow('납부할 세액', won(r.납부할세액), { total: true });
  html += '<button type="button" class="taxcalc-run-btn" data-action="apply-clawback-to-gift">이 이자상당액을 증여세 계산기에 반영</button>';
  html += '<button type="button" class="taxcalc-run-btn" data-action="apply-clawback-to-inheritance">이 이자상당액을 상속세 계산기에 반영</button>';
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
  box.dataset.lastInterestTotal = r.이자상당액_합계;
}

function renderBusinessSuccessionDeferralAmountResult(r){
  const box = document.getElementById('taxCalcBusinessSuccessionDeferralAmountResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('납부유예금액', won(r.납부유예금액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderPropertyInKindStockReceiptResult(r){
  const box = document.getElementById('taxCalcPropertyInKindStockReceiptResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('구주1주당 수납가액', won(r.구주1주당수납가액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderBusinessSuccessionDeferralClawbackResult(r){
  const box = document.getElementById('taxCalcBusinessSuccessionDeferralClawbackResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('상태', r.상태);
  html += taxCalcResultRow('납부유예세액', won(r.납부유예세액));
  if (r.사용비율 !== null && r.사용비율 !== undefined) html += taxCalcResultRow('적용비율', (r.사용비율 * 100).toFixed(1) + '%');
  html += taxCalcResultRow('추징세액', won(r.추징세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderPropertyInKindPaymentResult(r){
  const box = document.getElementById('taxCalcPropertyInKindPaymentResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용 가능 여부', r.적용가능여부 ? '가능' : '불가능', { total: true });
  if (r.부동산유가증권비율 !== null && r.부동산유가증권비율 !== undefined) html += taxCalcResultRow('부동산·유가증권 비율', (r.부동산유가증권비율 * 100).toFixed(1) + '%');
  if (r.물납신청가능세액_한도 !== undefined) html += taxCalcResultRow('물납신청가능세액 한도', won(r.물납신청가능세액_한도));
  (r.미충족사유 || []).forEach(function(reason){ html += '<div class="taxcalc-result-note">- ' + reason + '</div>'; });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderCulturalHeritageTaxDeferralResult(r){
  const box = document.getElementById('taxCalcCulturalHeritageTaxDeferralResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('상태', r.상태);
  html += taxCalcResultRow('징수유예세액', won(r.징수유예세액));
  html += taxCalcResultRow('납부세액', won(r.납부세액), { total: true });
  if (r.안내) html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderLowPriceResult(r){
  const box = document.getElementById('taxCalcLowPriceResult');
  if (r.error){ box.innerHTML = '<div class="taxcalc-error">' + r.error + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('구분', r.특수관계여부);
  html += taxCalcResultRow('거래유형', r.거래유형);
  html += taxCalcResultRow('시가와 대가의 차액', won(r.시가와대가의차액));
  if (r.차감기준액 != null) html += taxCalcResultRow('차감기준액', won(r.차감기준액));
  if (r.차감기준액_게이트 != null) html += taxCalcResultRow('게이트 기준금액(시가×30%)', won(r.차감기준액_게이트));
  if (r.차감액_공제 != null) html += taxCalcResultRow('차감액(정액)', won(r.차감액_공제));
  html += taxCalcResultRow('증여재산가액', won(r.증여재산가액), { total: true });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderGiftOverlapResult(r){
  const box = document.getElementById('taxCalcGiftOverlapResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('적용조문', r.적용조문);
  html += taxCalcResultRow('적용 증여재산가액', won(r.적용증여재산가액), { total: true });
  (r.배제된조문 || []).forEach(function(c){ html += taxCalcResultRow('배제 — ' + c.article, won(c.giftAmount)); });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderFmvRecognitionResult(r){
  const box = document.getElementById('taxCalcFmvRecognitionResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('시가 인정 여부', r.시가인정여부 ? '인정됨' : '인정 안 됨', { total: true });
  html += taxCalcResultRow('평가기간', r.평가기간_시작 + ' ~ ' + r.평가기간_종료);
  html += taxCalcResultRow('평가기간 이내 여부', r.평가기간이내여부 ? '예' : '아니오');
  (r.게이트별_판정 || []).forEach(function(g){
    html += taxCalcResultRow(g.항목, g.통과 ? '통과' : '미통과');
    if (g.사유) html += '<div class="taxcalc-result-note">' + g.사유 + '</div>';
  });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderTransferFmvResult(r){
  const box = document.getElementById('taxCalcTransferFmvResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('시가 인정 여부', r.시가인정여부 ? '인정됨' : '인정 안 됨', { total: true });
  html += taxCalcResultRow('평가기간', r.평가기간_시작 + ' ~ ' + r.평가기간_종료);
  html += taxCalcResultRow('평가기간 이내 여부', r.평가기간이내여부 ? '예' : '아니오');
  (r.게이트별_판정 || []).forEach(function(g){
    html += taxCalcResultRow(g.항목, g.통과 ? '통과' : '미통과');
    if (g.사유) html += '<div class="taxcalc-result-note">' + g.사유 + '</div>';
  });
  html += '<div class="taxcalc-result-note">' + r.안내 + '</div>';
  html += '</div>';
  box.innerHTML = html;
}

function renderRelatedPartyAdjustmentResult(r){
  const box = document.getElementById('taxCalcRelatedPartyAdjustmentResult');
  if (!r || r.error){ box.innerHTML = '<div class="taxcalc-error">' + ((r && r.error) || '계산 결과가 없습니다.') + '</div>'; return; }
  let html = '<div class="taxcalc-result">';
  html += taxCalcResultRow('시가재계산 적용 여부', r.시가재계산적용여부 ? '적용됨' : '적용 안 됨', { total: true });
  if (r.시가와거래가액의차액 != null) html += taxCalcResultRow('시가와 거래가액의 차액', won(r.시가와거래가액의차액));
  if (r.차감기준액 != null) html += taxCalcResultRow('기준금액', won(r.차감기준액));
  if (r.재계산가액 != null) html += taxCalcResultRow('재계산가액(시가)', won(r.재계산가액));
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
    '<div class="taxcalc-hint">국세청 [별지 제9호서식] 상속세과세표준신고 및 자진납부계산서 항목을 기준으로 계산합니다. 상속세과세가액은 총상속재산가액에서 공과금·채무를 빼고, 10년 이내 사전증여재산을 가산해 이미 계산된 값을 넣어야 합니다. ⚠ 장례비용은 이 값에서 미리 빼지 마세요 — 아래 "장례비용" 전용 섹션에 입력하면 이 계산기가 상속공제 단계(§14①3호, 5백만~1천만원+봉안시설분 5백만원 한도)에서 자동으로 반영합니다. 미리 빼고 아래에도 입력하면 이중으로 공제됩니다.</div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>피상속인 정보</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-inheritance">📄 증빙에서 자동 입력</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-inheritance"></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>피상속인 성명</label><input type="text" id="ihDeceasedName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>피상속인 주민등록번호</label><input type="text" id="ihDeceasedRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>상속개시일</label><input type="date" id="ihDeathDate" min="1900-01-01" max="2099-12-31"><span class="taxcalc-result-note" id="ihDeathDateDeadlineHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>피상속인 주소(사망 당시 주소지=납세지)</label><div class="taxcalc-field-inline"><input type="text" id="ihDeceasedAddress"><button type="button" class="taxcalc-ai-btn" data-action="open-address-search-simple" data-target-input="ihDeceasedAddress" title="주소 검색">🔍</button></div>' +
          '<button type="button" class="taxcalc-ai-btn" data-action="open-tax-office-guide" data-address-input="ihDeceasedAddress" style="margin-top:4px;">🏢 관할세무서 확인</button>' +
        '</div>' +
        '<div class="taxcalc-field"><label>피상속인 거주구분(국내에 주소를 두거나 183일 이상 거소를 둔 사람=거주자)</label><select id="ihDecedentResident"><option value="resident" selected>거주자</option><option value="nonresident">비거주자</option></select><span class="taxcalc-result-note" style="margin:2px 0 0;">비거주자면 기초공제(2억원)만 적용되고 배우자공제·일괄공제·인적공제·금융재산공제·동거주택공제·장례비용공제·가업/영농상속공제는 적용되지 않습니다(§14②·§18~§23의2).</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="taxcalc-asset-head"><b>상속인 명부 — 여기 입력한 관계·생년월일·상속재산가액으로 아래 인적공제·배우자공제·동거주택공제·세대생략비율·신고인 정보가 전부 자동으로 채워집니다</b></div>' +
    '<div id="ihHeirRegistry"></div>' +
    '<div class="taxcalc-asset-head"><b>[부표1·2] 상속재산 및 평가명세 — 자산을 추가하면 아래 상속세과세가액에 반영할 수 있습니다(공과금·장례비용·채무 차감 전 재산가액 기준)</b></div>' +
    '<div id="inheritanceValuationList"></div>' +
    '<div class="taxcalc-asset-head"><b>[부표4] 상속개시전 처분재산 등 산입액(§15) — 상속개시 전 1년 이내 재산종류별 2억원 이상(2년 이내 5억원 이상) 처분·인출·채무부담인데 용도가 불분명하면 자동으로 과세가액에 가산됩니다. 해당 없으면 비워두세요.</b></div>' +
    '<div id="ihDisposalItems"></div>' +
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>과세가액 · 인적공제(자녀 수·미성년·65세이상은 위 상속인 명부에서 자동 산출)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>상속세과세가액</label><input type="number" id="ihEstate" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>비과세재산가액(§12)</label><input type="number" id="ihNonTaxable" placeholder="원 (국가등 유증·금양임야 등, 없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익법인출연재산가액(§16)</label><input type="number" id="ihPublicOrg" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>공익신탁재산가액(§17)</label><input type="number" id="ihPublicTrust" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>자녀 수(자동, 1인당 5천만원)</label><input type="number" id="ihChildCount" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>미성년 상속인 19세까지 잔여연수 합(자동, 1년당 1천만원)</label><input type="number" id="ihMinorYears" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>65세 이상 상속인 수(자동, 1인당 5천만원)</label><input type="number" id="ihElderlyCount" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>장애인 상속인 기대여명 잔여연수 합</label><input type="number" id="ihDisabledYears" placeholder="년 (1년당 1천만원)" maxlength="3"><span class="taxcalc-result-note" id="ihDisabledCountHint" style="margin:2px 0 0;"></span></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>배우자상속공제 (부표3의2 한도액 계산)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>배우자 실제 상속액(자동, 명부의 배우자 행 기준)</label><input type="number" id="ihSpouseActual" placeholder="0 (5억 미만/미입력이면 최소 5억 자동 적용)" readonly></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isSpousePropertyDivided" id="ihSpouseDivided" checked><label for="ihSpouseDivided">배우자상속재산분할기한(신고기한 다음날부터 9개월)까지 배우자 상속재산을 분할·등기하고 신고함 (§19②③ — 체크 해제시 실제상속액과 무관하게 최소 5억원만 공제)</label></div>' +
        '<div class="taxcalc-field"><label>배우자 외 같은 순위 공동상속인 수(자동, 명부에 자녀·손자녀가 있으면 그 수, 없으면 부모 수)</label><input type="number" id="ihOtherHeirsCount" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>배우자 법정상속분 비율(자동계산: 위 공동상속인 수 기준, 민법§1009②)</label><input type="number" step="0.0001" id="ihSpouseRatio" placeholder="0" readonly><span class="taxcalc-result-note" id="ihSpouseRatioHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>상속인 아닌 자 유증재산가액</label><input type="number" id="ihNonHeirBequest" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>10년내 상속인에게 증여한 재산가액</label><input type="number" id="ihGiftToHeirs" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>과세가액에 가산된 사전증여재산 원본액</label><input type="number" id="ihPriorGiftedIncluded" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>배우자 사전증여분 증여세 과세표준</label><input type="number" id="ihSpouseGiftBase" placeholder="원 (없으면 비움)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>그 밖의 상속공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>순금융재산가액(금융재산-금융채무)</label><input type="number" id="ihNetFinancial" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>동거주택가액(자동, 명부에서 "동거주택 상속" 체크된 행 합계, 6억 한도)</label><input type="number" id="ihCohabitValue" placeholder="0" readonly><span class="taxcalc-result-note" id="ihCohabitValueHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>감정평가수수료</label><input type="number" id="ihAppraisalFee" placeholder="원 (500만원 한도)"><span class="taxcalc-result-note" id="ihAppraisalFeeHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>재해손실공제액</label><input type="number" id="ihDisasterLoss" placeholder="원 (신고기한 내 재난 멸실분)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>동거주택상속공제 자격요건(§23의2①) — 동거주택가액을 입력했다면, 하나라도 체크 해제하면 이 공제가 전액 배제됩니다.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="tenYearCohabitationRequirementMet" id="ihCohabitReq1" checked><label for="ihCohabitReq1">상속개시일부터 소급 10년 이상(상속인 미성년자기간 제외) 계속 한 주택에서 동거(1호)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="tenYearOneHouseholdRequirementMet" id="ihCohabitReq2" checked><label for="ihCohabitReq2">10년 이상 계속 1세대를 구성하며 1세대1주택 해당(무주택기간 포함)(2호)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="noHouseOrJointHeirRequirementMet" id="ihCohabitReq3" checked><label for="ihCohabitReq3">상속개시일 현재 무주택자이거나 피상속인과 공동1주택 보유한 동거상속인이 상속받은 주택(3호)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>장례비용 내역(§14①3호) — 지급처별로 입력하면 일반분·봉안시설분을 자동 구분·합산합니다(일반분 없으면 자동 500만원 공제, 봉안시설분은 별도 500만원 한도)</b></div>' +
      '<div id="ihFuneralItemsList"></div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>가업상속공제(§18의2, [별지 제1호서식]) — 아래 상세내역을 채우면 자동계산됩니다. 모르면 최종 공제액만 직접 입력하세요.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>최종 공제액(직접 입력, 상세내역 없을 때만)</label><input type="number" id="ihBusinessDeduction" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>가업영위기간</label><input type="number" id="ihBusinessYears" placeholder="년 (10년 미만이면 공제 불가)" maxlength="2"></div>' +
        '<div class="taxcalc-field"><label>[개인사업] 사업용자산 순액 합계(자동, 위 상속재산명세의 "사업용자산" 체크분 합계)</label><input type="number" id="ihBusinessIndividualNet" placeholder="원 (담보채무가 있으면 직접 차감해 수정)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 상속개시일 현재 주식등 가액</label><input type="number" id="ihBusinessStockValue" placeholder="원 (가업법인 주식가액)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 총자산가액</label><input type="number" id="ihBusinessTotalAsset" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - §55의2</label><input type="number" id="ihBusinessNonBiz55" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - 시행령§49</label><input type="number" id="ihBusinessNonBiz49" placeholder="원 (임대용부동산 포함)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 사업무관자산 - 시행령§61①2호</label><input type="number" id="ihBusinessNonBiz61" placeholder="원 (대여금)"></div>' +
        '<div class="taxcalc-field"><label>[법인] 과다보유현금</label><input type="number" id="ihBusinessExcessCash" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>[법인] 영업무관 주식·채권·금융상품</label><input type="number" id="ihBusinessNonBizStock" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>총 상속재산가액(가업상속납부유예 참고계산용)</label><input type="number" id="ihTotalGrossEstate" placeholder="원 (§72의2 납부유예 가능세액을 참고로 보려면 입력)"></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>가업상속공제 자격요건(시행령§15③) — 하나라도 체크 해제하면 가업상속공제가 전액 배제됩니다. 반드시 확인 후 체크하세요.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="decedentOwnershipRequirementMet" id="ihBizReqOwnership" checked><label for="ihBizReqOwnership">피상속인+특수관계인 지분이 40%(상장 20%) 이상을 10년 이상 계속 보유(③1호가목)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="decedentCeoTenureRequirementMet" id="ihBizReqCeoTenure" checked><label for="ihBizReqCeoTenure">피상속인 대표이사 재직요건 충족(가업영위기간 50%이상, 또는 10년이상 승계재직, 또는 소급10년중5년이상)(③1호나목)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="heirAge18OrOlder" id="ihBizReqAge18" checked><label for="ihBizReqAge18">상속인이 상속개시일 현재 18세 이상(③2호가목)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="heirEngagedInBusiness2YearsOrExempt" id="ihBizReqEngaged" checked><label for="ihBizReqEngaged">상속인 2년 이상 직접 가업종사(또는 피상속인 65세이전사망 등으로 면제)(③2호나목)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="heirBecameOfficerByFilingDeadline" id="ihBizReqOfficer" checked><label for="ihBizReqOfficer">상속인 신고기한까지 임원 취임(③2호다목)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="heirBecameCeoWithin2Years" id="ihBizReqCeo2yr" checked><label for="ihBizReqCeo2yr">상속인 신고기한부터 2년 이내 대표이사등 취임(③2호라목)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>중견기업 게이트(§18의2②, 시행령§15⑥⑦) — 가업이 중견기업일 때만 해당. 가업상속인의 "가업상속재산 외 상속재산가액"이 "가업상속공제 미적용시 그 상속인 납부세액×200%"를 초과하면 공제가 전액 배제됩니다. 두 금액 모두 전체 상속세 계산 이후에나 확정되는 값이라 직접 계산해서 입력해야 합니다.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihBusinessMediumSized"><label for="ihBusinessMediumSized">가업이 중견기업에 해당</label></div>' +
        '<div class="taxcalc-field"><label>가업상속인의 가업상속재산 외 상속재산가액</label><input type="number" id="ihBusinessHeirNonBizAsset" placeholder="원 (시행령§15⑥ — 그 상속인이 받는 상속재산-부담채무-가업상속재산)"></div>' +
        '<div class="taxcalc-field"><label>가업상속공제 미적용시 그 상속인 납부세액</label><input type="number" id="ihBusinessHeirTaxWithoutDeduction" placeholder="원 (§3조의2①②에 따라 계산, 별도 계산 필요)"></div>' +
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
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>영농상속공제 자격요건(시행령§16②③) — 하나라도 체크 해제하면 영농상속공제가 전액 배제됩니다.</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="decedentFarmingRequirementMet" id="ihFarmReqDecedent" checked><label for="ihFarmReqDecedent">피상속인 8년 이상 계속 직접 영농종사(+거주요건), 또는 법인영농이면 8년경영+지분50%이상(②)</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="heirFarmingRequirementMet" id="ihFarmReqHeir" checked><label for="ihFarmReqHeir">상속인 18세이상+2년이상 영농종사(+거주요건, 또는 부득이한사유로 면제) 또는 영농·영어·임업후계자(③)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>상속공제 종합한도(§24) · 세대생략가산액(§27)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><span class="taxcalc-result-note" style="margin:0;">사전증여재산 과세표준 합계는 위 상속인 명부의 "10년 이내 사전증여" 입력에서 자동 집계됩니다</span></div>' +
        '<div class="taxcalc-field"><label>상속포기로 다음순위가 받은 재산가액</label><input type="number" id="ihDisclaimedRedistributed" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>세대생략 상속인이 받는 재산가액(자동, 명부에서 "세대생략" 체크된 행 합계)</label><input type="number" id="ihGenSkipAmount" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세대생략 상속인이 받는 재산 비율(자동계산: 위 금액÷총상속재산가액)</label><input type="number" step="0.0001" id="ihGenSkipRatio" placeholder="0" readonly><span class="taxcalc-result-note" id="ihGenSkipRatioHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihGenSkipOver2B"><label for="ihGenSkipOver2B">세대생략 상속재산가액 20억 초과</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihGenSkipMinorHeir"><label for="ihGenSkipMinorHeir">세대생략 상속인·수유자(자녀 제외 직계비속)가 미성년자(위 둘 다 충족해야 할증 40%, 아니면 30%)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>세액공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><span class="taxcalc-result-note" style="margin:0;">기납부증여세액공제(§28)는 위 상속인 명부의 "10년 이내 사전증여" 입력에서 상속인별로 자동 계산됩니다(과세가액 5억원 이하면 배제)</span></div>' +
        '<div class="taxcalc-field"><label>외국납부세액</label><input type="number" id="ihForeignTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>단기재상속공제(§30②) — 전의 상속세 산출세액</label><input type="number" id="ihPriorInheritanceTax" placeholder="원 (재상속인 경우만, 없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>단기재상속공제 — 재상속분의 재산가액</label><input type="number" id="ihReinheritedPropertyValue" placeholder="원 (전의 상속재산 중 이번에 다시 상속되는 부분)"></div>' +
        '<div class="taxcalc-field"><label>단기재상속공제 — 전의 상속재산가액</label><input type="number" id="ihPriorInheritanceTotalPropertyValue" placeholder="원 (전의 상속 전체 재산가액)"></div>' +
        '<div class="taxcalc-field"><label>단기재상속공제 — 전의 상속세 과세가액</label><input type="number" id="ihPriorInheritanceTaxableBase" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>전 상속개시일로부터 경과연수</label><input type="number" id="ihYearsSincePrior" placeholder="1~10년 (재상속인 경우만)" maxlength="2"></div>' +
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
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고인 정보(위 상속인 명부에서 "신고인" 체크된 행 기준 자동 표시)</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고인(상속인) 성명</label><input type="text" id="ihReporterName" readonly></div>' +
        '<div class="taxcalc-field"><label>신고인 주민등록번호</label><input type="text" id="ihReporterRegNo" readonly></div>' +
        '<div class="taxcalc-field"><label>신고인의 피상속인과의 관계</label><input type="text" id="ihReporterRelation" readonly></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>신고 상태 · 가산세</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="ihFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihReportedInTime" checked><label for="ihReportedInTime">(정상신고일 때) 법정신고기한 내 — 신고세액공제 3%</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihFraudulent"><label for="ihFraudulent">부정행위(무신고·과소신고 가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="ihUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="ihPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 상속개시일+6개월 신고기한 대비)</label><input type="number" id="ihUnpaidDays" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세무서 고지 후 체납 — 지정납부기한 경과 개월수(있으면)</label><input type="number" id="ihMonthsAfterDesignated" placeholder="0"></div>' +
        '<div class="taxcalc-field"><label>지정납부기한까지 미납세액(원, 위와 함께 입력)</label><input type="number" id="ihUnpaidAtDesignated" placeholder="0"></div>' +
      '</div>' +
    '</div>' +
    '<button type="button" class="taxcalc-run-btn" data-action="run-inheritance">세액 계산하기</button>' +
    '<div id="taxCalcInheritanceResult"></div>' +
    '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-heir-tool" style="margin-bottom:10px;">👪 상속인별 세액 안분(상증세법§3조의2①, 실제상속재산가액 비율 근사)</button>' +
    '<div id="taxCalcHeirTool"></div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>[별지 제11호서식] 연부연납(다년 분할납부) 계산 — 신고 후 매년 나눠 낼 회차별 세액을 계산합니다</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>세목</label><select id="ipIhTaxType"><option value="inheritance" selected>상속세</option><option value="gift">증여세</option></select></div>' +
        '<div class="taxcalc-field"><label>총 납부세액</label><input type="number" id="ipIhTotal" placeholder="원 (2천만원 초과해야 신청 가능)"><span class="taxcalc-result-note" id="ipIhTotalHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>최초 납부세액(신고기한까지 먼저 납부)</label><input type="number" id="ipIhInitial" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>연부연납기간</label><input type="number" id="ipIhYears" placeholder="년 (상속세 일반10/가업20, 증여세 일반5/특례15)" maxlength="2"></div>' +
        '<div class="taxcalc-field"><label>연부연납 가산금 연이자율</label><input type="number" step="0.01" id="ipIhRate" placeholder="% (신고 시점 기준 확인 필요)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-installment-inheritance">연부연납 계산하기</button>' +
      '<div id="taxCalcInstallmentInheritanceResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>상속재산으로 보는 보험금·신탁재산·퇴직금 등(간주상속재산, §8,§9,§10) — 결과의 "간주상속재산포함액"을 위 상속재산가액에 합산해 넣으세요</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>항목 구분</label><select id="diItemType">' +
          '<option value="insurance">보험금(§8)</option>' +
          '<option value="trust_settled">피상속인이 신탁한 재산(§9①)</option>' +
          '<option value="trust_benefit_from_others">피상속인이 타인신탁의 수익권 보유(§9②)</option>' +
          '<option value="retirement">퇴직금·퇴직수당·공로금·연금 등(§10)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>금액</label><input type="number" id="diAmount" placeholder="원"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="diPolicyholderDecedent"><label for="diPolicyholderDecedent">[보험금만] 피상속인이 보험계약자였음</label></div>' +
        '<div class="taxcalc-field"><label>[보험금만, 계약자가 다를 때] 피상속인 실질보험료부담비율</label><input type="number" step="0.01" min="0" max="1" id="diPremiumRatio" placeholder="0~1"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="diAlreadyGiftTaxed"><label for="diAlreadyGiftTaxed">[피상속인이 신탁한 재산만] 이미 §33①로 증여재산가액 처리됨</label></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="diExcludedPension"><label for="diExcludedPension">[퇴직금등만] 국민연금법 등 열거된 유족연금·유족보상금류에 해당</label></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-deemed-inheritance">포함 여부·포함액 판정하기</button>' +
      '<div id="taxCalcDeemedInheritanceResult"></div>' +
    '</div>' +
    '<div class="taxcalc-asset" style="margin-top:20px;">' +
      '<div class="taxcalc-asset-head"><b>비과세되는 상속재산(§12) — 국가·지자체·공공단체 유증등, 민법§1008의3 제사용재산, 정당 유증등, 사내근로복지기금 등 유증등, 이재구호금품·치료비 등</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>항목 구분</label><select id="niItemType">' +
          '<option value="government">국가·지자체·공공단체 유증등(1호)</option>' +
          '<option value="ancestral_property">민법§1008의3 제사용재산(3호, 금양임야·묘토·족보·제구 등)</option>' +
          '<option value="political_party">정당 유증등(4호)</option>' +
          '<option value="labor_welfare_fund">사내근로복지기금 등 유증등(5호)</option>' +
          '<option value="disaster_relief">이재구호금품·치료비 등(6호)</option>' +
        '</select></div>' +
        '<div class="taxcalc-field"><label>금액</label><input type="number" id="niAmount" placeholder="원"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-nontaxable-inheritance">비과세 여부 확인하기</button>' +
      '<div id="taxCalcNontaxableInheritanceResult"></div>' +
    '</div>';
  renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
  renderDisposalItemsList();
  renderFuneralItemsList();
  renderHeirTool();
  const ihDeathDateEl = document.getElementById('ihDeathDate');
  const ihPaidDateEl = document.getElementById('ihPaidDate');
  if (ihDeathDateEl) ihDeathDateEl.addEventListener('input', recomputeInheritanceUnpaidDays);
  if (ihPaidDateEl) ihPaidDateEl.addEventListener('input', recomputeInheritanceUnpaidDays);
  recomputeInheritanceUnpaidDays();
  wireMoneyCapHint_('ihAppraisalFee', 'ihAppraisalFeeHint', 5000000);
  wireMoneyCapHint_('ihCohabitValue', 'ihCohabitValueHint', 600000000);
  wireRangeClamp_('ihGenSkipRatio', 0, 1);
  wireRangeClamp_('ihYearsSincePrior', 0, 10);
  wireRangeClamp_('ihOtherHeirsCount', 0, 20);
  wireRangeClamp_('ihForProfitRatio', 0, 1);
  wireRangeClamp_('ipIhRate', 0, 30);
  wireMinThresholdHint_('ipIhTotal', 'ipIhTotalHint', 20000000);
  const ihTotalGrossEstateEl = document.getElementById('ihTotalGrossEstate');
  const ihEstateEl = document.getElementById('ihEstate');
  if (ihTotalGrossEstateEl) ihTotalGrossEstateEl.addEventListener('input', recomputeGenSkipRatio);
  if (ihEstateEl) ihEstateEl.addEventListener('input', function(){
    recomputeGenSkipRatio();
    updateHeirActualValueHints();
    recomputeHeirDerivedFields();
  });
  renderHeirRegistry();
  recomputeHeirDerivedFields();
  if (ihDeathDateEl) ihDeathDateEl.addEventListener('input', renderHeirRegistry);
  enhanceNumberInputs(taxCalcInheritancePane);
  enhanceDateInputs(taxCalcInheritancePane);
  enhanceRegNoInputs(taxCalcInheritancePane);
  enhanceNameOnlyInputs(taxCalcInheritancePane);
}

let lastInheritanceResult = null;
let inheritanceHeirs = [{}, {}];
let inheritanceHeirToolShown = false;
let taxCalcHeirRegistryHasSpouse = false;
let taxCalcHeirRegistryHasCohabit = false;

// [부표4] 상속개시전 처분재산 등 산입액(§15) — 재산종류 5가지를 고정된 5행으로 나열하는 대신,
// 필요한 항목만 콤보(재산종류 선택)로 고르고 + 로 추가하는 방식으로 구성한다.
const DISPOSAL_CATEGORY_LABELS = ['현금·예금·유가증권', '부동산', '기타재산', '부담채무Ⅰ(국가·지자체·금융기관)', '부담채무Ⅱ(그 외)'];
let inheritanceDisposalItems = [{}];
// 장례비용도 임대차·처분재산과 같은 원칙 — 지급처별로 항목을 입력받아 일반분/봉안시설분을
// 자동 구분·합산한다(§14①3호는 이 둘의 한도가 서로 다르므로 반드시 구분해서 집계해야 한다).
let inheritanceFuneralItems = [{}];
function computeFuneralTotals_(items){
  const list = Array.isArray(items) ? items : [];
  const general = list.filter(function(it){ return it.category !== 'niche'; }).reduce(function(s, it){ return s + (numVal(it.amount) || 0); }, 0);
  const niche = list.filter(function(it){ return it.category === 'niche'; }).reduce(function(s, it){ return s + (numVal(it.amount) || 0); }, 0);
  return { general: general, niche: niche };
}

// 처분재산 한 줄을 1년기준·2년기준 각각 별도로 계산해 화면에 실시간으로 보여준다(상증세법§15,
// 시행령§11④ 산식의 중간 단계를 그대로 노출) — 순인출액=총인출-내돈입금액, 미소명액=순인출액-소명액,
// 문턱=MIN(순인출액×20%, 2억원). 시행령§11④ 원문: 미소명액이 문턱 "미만"이면 추정하지 않음(0),
// 문턱 "이상"이면 문턱금액을 "차감한 금액"을 추정한다 — 즉 문턱을 넘어도 미소명액 전액이 아니라
// 그 차액만 산입된다. 최종 산입액은 1년/2년 중 큰 금액.
function computeDisposalBasisPresumed_(amount, selfDeposit, explained, thresholdAmount){
  const net = Math.max(0, numVal(amount) - numVal(selfDeposit));
  if (net < thresholdAmount) return { net: net, unexplained: 0, cutoff: 0, presumed: 0, meets: false };
  const unexplained = Math.max(0, net - numVal(explained));
  const cutoff = Math.min(net * 0.2, 200000000);
  return { net: net, unexplained: unexplained, cutoff: cutoff, presumed: (unexplained >= cutoff ? unexplained - cutoff : 0), meets: true };
}
function computeDisposalItemPresumedAmount_(item){
  const oneYear = computeDisposalBasisPresumed_(item.oneYearAmount, item.oneYearSelfDeposit, item.oneYearExplained, 200000000);
  const twoYear = computeDisposalBasisPresumed_(item.twoYearAmount, item.twoYearSelfDeposit, item.twoYearExplained, 500000000);
  return Math.max(oneYear.presumed, twoYear.presumed);
}
function updateDisposalItemComputedHints_(row, item){
  const oneYear = computeDisposalBasisPresumed_(item.oneYearAmount, item.oneYearSelfDeposit, item.oneYearExplained, 200000000);
  const twoYear = computeDisposalBasisPresumed_(item.twoYearAmount, item.twoYearSelfDeposit, item.twoYearExplained, 500000000);
  const oneYearEl = row.querySelector('[data-dcomputed="oneYear"]');
  const twoYearEl = row.querySelector('[data-dcomputed="twoYear"]');
  const finalEl = row.querySelector('[data-dcomputed="final"]');
  if (oneYearEl) oneYearEl.textContent = !oneYear.meets ? '① 1년기준(2억) 미충족 — 산입 대상 아님' :
    '① 순인출 ' + won(oneYear.net) + ' · 미소명 ' + won(oneYear.unexplained) + ' · 문턱 ' + won(oneYear.cutoff) + ' → 산입액 ' + won(oneYear.presumed);
  if (twoYearEl) twoYearEl.textContent = !twoYear.meets ? '② 2년기준(5억) 미충족 — 산입 대상 아님' :
    '② 순인출 ' + won(twoYear.net) + ' · 미소명 ' + won(twoYear.unexplained) + ' · 문턱 ' + won(twoYear.cutoff) + ' → 산입액 ' + won(twoYear.presumed);
  if (finalEl) finalEl.textContent = '이 재산종류의 추정상속재산 산입액(①·② 중 큰 금액) = ' + won(Math.max(oneYear.presumed, twoYear.presumed));
}
function renderDisposalItemsList(){
  const container = document.getElementById('ihDisposalItems');
  if (!container) return;
  const rowsHtml = inheritanceDisposalItems.map(function(item, idx){
    const categoryOptions = DISPOSAL_CATEGORY_LABELS.map(function(label){
      return '<option value="' + label + '"' + (item.category === label ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
    return '<div class="taxcalc-grid" data-disposal-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>재산종류</label><select data-dfield="category"><option value="">선택</option>' + categoryOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>① 1년 이내 총인출(처분·차입)액</label><input type="number" data-dfield="oneYearAmount" value="' + (item.oneYearAmount || '') + '" placeholder="원 (2억원 이상이면 검토 대상)"></div>' +
      '<div class="taxcalc-field"><label>① 1년 이내 내돈입금액(재입금 등)</label><input type="number" data-dfield="oneYearSelfDeposit" value="' + (item.oneYearSelfDeposit || '') + '" placeholder="원 (없으면 0)"></div>' +
      '<div class="taxcalc-field"><label>① 1년 이내 소명액(소비대차·생활비 등)</label><input type="number" data-dfield="oneYearExplained" value="' + (item.oneYearExplained || '') + '" placeholder="원 (없으면 0)"></div>' +
      '<div class="taxcalc-field"><span class="taxcalc-result-note" data-dcomputed="oneYear" style="margin:0;"></span></div>' +
      '<div class="taxcalc-field"><label>② 2년 이내 누계 총인출(처분·차입)액</label><input type="number" data-dfield="twoYearAmount" value="' + (item.twoYearAmount || '') + '" placeholder="원 (5억원 이상이면 검토 대상)"></div>' +
      '<div class="taxcalc-field"><label>② 2년 이내 누계 내돈입금액(재입금 등)</label><input type="number" data-dfield="twoYearSelfDeposit" value="' + (item.twoYearSelfDeposit || '') + '" placeholder="원 (없으면 0)"></div>' +
      '<div class="taxcalc-field"><label>② 2년 이내 누계 소명액(소비대차·생활비 등)</label><input type="number" data-dfield="twoYearExplained" value="' + (item.twoYearExplained || '') + '" placeholder="원 (없으면 0)"></div>' +
      '<div class="taxcalc-field"><span class="taxcalc-result-note" data-dcomputed="twoYear" style="margin:0;"></span></div>' +
      '<div class="taxcalc-field"><span class="taxcalc-result-note" data-dcomputed="final" style="margin:0;"></span></div>' +
      (inheritanceDisposalItems.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-disposal-item" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  container.innerHTML = rowsHtml +
    '<button type="button" class="taxcalc-add-asset" data-action="add-disposal-item" style="margin-top:8px;">+ 항목 추가</button>';

  container.querySelectorAll('[data-disposal-idx]').forEach(function(row){
    const idx = numVal(row.dataset.disposalIdx);
    updateDisposalItemComputedHints_(row, inheritanceDisposalItems[idx]);
  });
  container.querySelectorAll('[data-dfield]').forEach(function(el){
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function(){
      const row = el.closest('[data-disposal-idx]');
      const idx = numVal(row.dataset.disposalIdx);
      const key = el.dataset.dfield;
      inheritanceDisposalItems[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
      updateDisposalItemComputedHints_(row, inheritanceDisposalItems[idx]);
    });
  });
  enhanceNumberInputs(container);
}

function renderFuneralItemsList(){
  const container = document.getElementById('ihFuneralItemsList');
  if (!container) return;
  const rowsHtml = inheritanceFuneralItems.map(function(item, idx){
    return '<div class="taxcalc-grid" data-funeral-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>지급처</label><input type="text" data-ffield="payee" value="' + (item.payee || '').replace(/"/g, '&quot;') + '" placeholder="예: OO장례식장"></div>' +
      '<div class="taxcalc-field"><label>지급처 사업자번호</label><input type="text" data-ffield="bizNo" value="' + (item.bizNo || '').replace(/"/g, '&quot;') + '" placeholder="123-45-67890"><button type="button" class="taxcalc-ai-btn" data-action="check-bizno" style="margin-top:4px;">🔍 확인</button><span class="taxcalc-result-note" data-bizno-result style="margin:2px 0 0;"></span></div>' +
      '<div class="taxcalc-field"><label>구분</label><select data-ffield="category"><option value="general"' + (item.category !== 'niche' ? ' selected' : '') + '>일반 장례비용</option><option value="niche"' + (item.category === 'niche' ? ' selected' : '') + '>봉안시설·자연장지 비용</option></select></div>' +
      '<div class="taxcalc-field"><label>금액</label><input type="number" data-ffield="amount" value="' + (item.amount || '') + '"></div>' +
      (inheritanceFuneralItems.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-funeral-item" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');
  const totals = computeFuneralTotals_(inheritanceFuneralItems);
  const generalDeduction = totals.general > 0 ? Math.min(Math.max(totals.general, 5000000), 10000000) : 5000000;
  const nicheDeduction = Math.min(totals.niche, 5000000);
  container.innerHTML = rowsHtml +
    '<button type="button" class="taxcalc-add-asset" data-action="add-funeral-item" style="margin-top:8px;">+ 항목 추가</button>' +
    '<div class="taxcalc-result-note" data-funeral-total="1">일반분 합계 ' + won(totals.general) + '(공제 ' + won(generalDeduction) + ') · 봉안시설분 합계 ' + won(totals.niche) + '(공제 ' + won(nicheDeduction) + ') · 공제액 합계 ' + won(generalDeduction + nicheDeduction) + '</div>';

  container.querySelectorAll('[data-ffield]').forEach(function(el){
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function(){
      const row = el.closest('[data-funeral-idx]');
      const idx = numVal(row.dataset.funeralIdx);
      const key = el.dataset.ffield;
      inheritanceFuneralItems[idx][key] = el.value;
      const t = computeFuneralTotals_(inheritanceFuneralItems);
      const gd = t.general > 0 ? Math.min(Math.max(t.general, 5000000), 10000000) : 5000000;
      const nd = Math.min(t.niche, 5000000);
      const totalEl = container.querySelector('[data-funeral-total]');
      if (totalEl) totalEl.textContent = '일반분 합계 ' + won(t.general) + '(공제 ' + won(gd) + ') · 봉안시설분 합계 ' + won(t.niche) + '(공제 ' + won(nd) + ') · 공제액 합계 ' + won(gd + nd);
    });
  });
  enhanceNumberInputs(container);
}

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
  if (r.장례비용공제) lines.push('장례비용공제(§14①3호, 일반분 ' + won(r.장례비용공제_일반분) + ' + 봉안시설분 ' + won(r.장례비용공제_봉안시설분) + ') = -' + won(r.장례비용공제));
  if (r.가업상속공제) lines.push('가업상속공제(§18의2) = -' + won(r.가업상속공제));
  if (r.영농상속공제) lines.push('영농상속공제(§18의3) = -' + won(r.영농상속공제));
  lines.push('상속공제 합계' + (r.상속공제종합한도_적용여부 ? '(§24 종합한도 적용됨)' : '') + ' = -' + won(r.상속공제_합계));
  lines.push('과세표준 = 적용된 상속세과세가액 - 상속공제 합계 = ' + won(r.과세표준));
  lines.push('산출세액(누진세율) = ' + won(r.산출세액 - (r.세대생략가산액 || 0)));
  if (r.세대생략가산액) lines.push('세대생략가산액(§27) = +' + won(r.세대생략가산액));
  lines.push('산출세액 합계 = ' + won(r.산출세액));
  if (r.증여세액공제_5억이하배제) lines.push('기납부증여세액공제(§28①단서) = 0 (상속세 과세가액 5억원 이하로 공제 배제)');
  else if (r.기납부증여세액공제) {
    lines.push('기납부증여세액공제(§28, 상속인별 정밀계산 합계) = -' + won(r.기납부증여세액공제));
    (r.증여세액공제_상속인별내역 || []).forEach(function(h){
      if (h.공제액 > 0) lines.push('  · ' + (h.성명 || '상속인') + ' = -' + won(h.공제액) + ' (한도 ' + won(h.한도) + ')');
    });
  }
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
  if (r.피상속인_거주구분 === '비거주자') html += '<div class="taxcalc-result-note">⚠ 피상속인이 비거주자로 설정되어 기초공제(2억원)와 감정평가수수료공제만 적용되고, 배우자공제·일괄공제·인적공제·금융재산공제·동거주택공제·장례비용공제·가업/영농상속공제는 모두 0원 처리되었습니다.</div>';
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
  html += taxCalcResultRow('장례비용공제', won(r.장례비용공제));
  if (r.가업상속공제 || (r.가업상속공제_계산내역 && r.가업상속공제_계산내역.중견기업게이트_적용여부)) {
    html += taxCalcResultRow('가업상속공제', won(r.가업상속공제));
    if (r.가업상속공제_계산내역 && r.가업상속공제_계산내역.중견기업게이트_적용여부) html += '<div class="taxcalc-result-note">⛔ 중견기업 게이트(§18의2②, 시행령§15⑥⑦) — 가업상속인의 가업상속재산 외 상속재산가액이 가업상속공제 미적용시 납부세액의 200%를 초과해 가업상속공제가 전액 배제되었습니다.</div>';
    else if (r.가업상속공제_계산내역) html += '<div class="taxcalc-result-note">자동계산: 대상금액 ' + won(r.가업상속공제_계산내역.대상금액) + ' / 한도액 ' + won(r.가업상속공제_계산내역.한도액) + '</div>';
  }
  if (r.영농상속공제) {
    html += taxCalcResultRow('영농상속공제', won(r.영농상속공제));
    if (r.영농상속공제_계산내역) html += '<div class="taxcalc-result-note">자동계산: 대상금액 ' + won(r.영농상속공제_계산내역.대상금액) + ' / 한도액 ' + won(r.영농상속공제_계산내역.한도액) + '</div>';
  }
  html += taxCalcResultRow('상속공제 합계', won(r.상속공제_합계) + (r.상속공제종합한도_적용여부 ? ' (종합한도 적용됨)' : ''));
  html += taxCalcResultRow('과세표준', won(r.과세표준));
  html += taxCalcResultRow('산출세액', won(r.산출세액) + (r.세대생략가산액 ? ' (세대생략가산액 ' + won(r.세대생략가산액) + ' 포함)' : ''));
  if (r.증여세액공제_5억이하배제) html += taxCalcResultRow('기납부증여세액공제', '0 (§28①단서: 상속세 과세가액 5억원 이하)');
  else if (r.기납부증여세액공제) html += taxCalcResultRow('기납부증여세액공제', '-' + won(r.기납부증여세액공제));
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
  html += '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-inheritance-calc-basis" style="margin-top:8px;">🧮 계산근거 접기/펴기</button>';
  html += '<div class="taxcalc-calcbasis" id="inheritanceCalcBasis">' +
    '<div class="taxcalc-calcbasis-title">계산근거([별지 제9호서식] 상속세과세표준신고 기준)</div>' +
    buildInheritanceCalcBasisLines(r).map(function(l){ return '<div class="taxcalc-calcbasis-line">' + l + '</div>'; }).join('') +
  '</div>';
  html += '</div>';
  box.innerHTML = html;
  renderHeirTool();
}

// 손자녀는 두 경우가 세법상 다르게 취급된다(상증세법§27 단서) — 부모가 먼저 사망·결격되어
// 대신 상속받는 "대습상속"은 세대생략할증이 배제되고, 부모가 생존한 상태에서 유증·상속포기 등으로
// 세대를 건너뛰어 상속받는 경우만 할증(30%/40%)이 적용된다. 체크박스로 다시 물을 필요 없이
// 관계 선택만으로 자동 판정한다.
const HEIR_RELATION_OPTIONS = ['배우자', '자녀', '손자녀(대습상속 — 부모가 먼저 사망·결격)', '손자녀(세대생략 — 부모 생존, 유증·상속포기 등)', '부모(직계존속)', '상속인 아닌 자(유증·사인증여 등)'];
function renderHeirRegistry(){
  const container = document.getElementById('ihHeirRegistry');
  if (!container) return;
  const deathDateEl = document.getElementById('ihDeathDate');
  const deathDate = deathDateEl ? deathDateEl.value : '';
  const rowsHtml = inheritanceHeirs.map(function(h, idx){
    const relationOptions = HEIR_RELATION_OPTIONS.map(function(opt){
      return '<option value="' + opt + '"' + (h.relation === opt ? ' selected' : '') + '>' + opt + '</option>';
    }).join('');
    const age = calcAgeAt_(h.birthDate, deathDate);
    return '<div class="taxcalc-grid" data-heir-idx="' + idx + '" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">' +
      '<div class="taxcalc-field"><label>성명</label><input type="text" data-hfield="name" data-nameonly="1" value="' + (h.name || '').replace(/"/g,'&quot;') + '"></div>' +
      '<div class="taxcalc-field"><label>주민등록번호</label><input type="text" data-hfield="regNo" data-regno="1" placeholder="000000-0000000" value="' + (h.regNo || '').replace(/"/g,'&quot;') + '"></div>' +
      '<div class="taxcalc-field"><label>관계</label><select data-hfield="relation"><option value="">선택</option>' + relationOptions + '</select></div>' +
      '<div class="taxcalc-field"><label>생년월일' + (age !== null ? '(만 ' + age + '세)' : '') + '</label><input type="date" data-hfield="birthDate" min="1900-01-01" max="2099-12-31" value="' + (h.birthDate || '') + '"></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" data-hfield="isDisabled" id="hDisabled-' + idx + '"' + (h.isDisabled ? ' checked' : '') + '><label for="hDisabled-' + idx + '">장애인</label></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" data-hfield="isReporter" id="hReporter-' + idx + '"' + (h.isReporter ? ' checked' : '') + '><label for="hReporter-' + idx + '">신고인</label></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" data-hfield="isCohabitHouse" id="hCohabit-' + idx + '"' + (h.isCohabitHouse ? ' checked' : '') + '><label for="hCohabit-' + idx + '">동거주택 상속(10년이상 동거·무주택 등)</label></div>' +
      '<div class="taxcalc-field" data-show-if-heir="isCohabitHouse" style="' + (h.isCohabitHouse ? '' : 'display:none;') + '"><label>동거주택가액</label><input type="number" data-hfield="cohabitHouseValue" value="' + (h.cohabitHouseValue || '') + '"></div>' +
      '<div class="taxcalc-field"><span class="taxcalc-result-note" data-heir-computed="actual" style="margin:0;">실제상속재산가액(자동) = ' + won(computeHeirActualValue_(idx)) + ' — 아래 재산평가 자산목록의 "상속인별 배분"에서 정해집니다</span></div>' +
      '<div class="taxcalc-field checkbox"><input type="checkbox" data-hfield="hasPriorGift" id="hPriorGift-' + idx + '"' + (h.hasPriorGift ? ' checked' : '') + '><label for="hPriorGift-' + idx + '">10년 이내 이 상속인에게 사전증여 있음(§13 가산대상)</label></div>' +
      '<div class="taxcalc-field" data-show-if-heir="hasPriorGift" style="' + (h.hasPriorGift ? '' : 'display:none;') + '"><label>사전증여재산가액(증여 당시 원본가액)</label><input type="number" data-hfield="priorGiftAmount" value="' + (h.priorGiftAmount || '') + '"></div>' +
      '<div class="taxcalc-field" data-show-if-heir="hasPriorGift" style="' + (h.hasPriorGift ? '' : 'display:none;') + '"><label>위 증여재산의 증여세 과세표준</label><input type="number" data-hfield="priorGiftTaxableBase" value="' + (h.priorGiftTaxableBase || '') + '"></div>' +
      '<div class="taxcalc-field" data-show-if-heir="hasPriorGift" style="' + (h.hasPriorGift ? '' : 'display:none;') + '"><label>위 증여 당시 납부한 증여세산출세액</label><input type="number" data-hfield="priorGiftTaxPaid" value="' + (h.priorGiftTaxPaid || '') + '"></div>' +
      (inheritanceHeirs.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-heir-row" data-idx="' + idx + '">✕ 삭제</button>' : '') +
    '</div>';
  }).join('');

  container.innerHTML = rowsHtml +
    '<button type="button" class="taxcalc-add-asset" data-action="add-heir-row" style="margin-top:8px;">+ 상속인 추가</button>';

  container.querySelectorAll('[data-hfield]').forEach(function(el){
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function(){
      const row = el.closest('[data-heir-idx]');
      const idx = numVal(row.dataset.heirIdx);
      const key = el.dataset.hfield;
      inheritanceHeirs[idx][key] = el.type === 'checkbox' ? el.checked : el.value;
      if (key === 'isCohabitHouse' || key === 'hasPriorGift'){
        row.querySelectorAll('[data-show-if-heir="' + key + '"]').forEach(function(field){
          field.style.display = el.checked ? 'flex' : 'none';
        });
      }
      recomputeHeirDerivedFields();
      updateHeirActualValueHints();
    });
  });
  enhanceNumberInputs(container);
  enhanceDateInputs(container);
  enhanceRegNoInputs(container);
  enhanceNameOnlyInputs(container);
}
// 상속세과세가액(ihEstate)이 바뀌면 모든 상속인 행의 "실제상속재산가액 = 순상속재산×지분율" 표시도
// 함께 갱신해야 한다(입력칸은 지분율뿐이므로, 계산된 금액은 항상 이 함수로만 다시 그린다).
function updateHeirActualValueHints(){
  document.querySelectorAll('#ihHeirRegistry [data-heir-idx]').forEach(function(row){
    const idx = numVal(row.dataset.heirIdx);
    const hintEl = row.querySelector('[data-heir-computed="actual"]');
    if (hintEl) hintEl.textContent = '실제상속재산가액(자동) = ' + won(computeHeirActualValue_(idx)) + ' — 아래 재산평가 자산목록의 "상속인별 배분"에서 정해집니다';
  });
}

function renderHeirTool(){
  const box = document.getElementById('taxCalcHeirTool');
  if (!box) return;
  if (!inheritanceHeirToolShown){ box.innerHTML = ''; return; }
  if (!lastInheritanceResult){
    box.innerHTML = '<div class="taxcalc-result-note" style="margin-top:10px;">먼저 위에서 전체 상속세를 계산하세요.</div>';
    return;
  }
  const summaryRows = inheritanceHeirs.map(function(h, idx){
    return '<div class="taxcalc-result-row"><span>' + (h.name || '(이름 미입력)') + (h.relation ? ' (' + h.relation + ')' : '') + '</span><span class="v">' + won(computeHeirActualValue_(idx)) + '</span></div>';
  }).join('');
  box.innerHTML =
    '<div class="taxcalc-asset" style="margin-top:10px;">' +
      '<div class="taxcalc-asset-head"><b>상속인별 세액 안분 — 전체 산출세액·세액공제·가산세를 위 상속인 명부의 실제상속재산가액 비율로 나눕니다(유산세 방식)</b></div>' +
      summaryRows +
      '<button type="button" class="taxcalc-run-btn" data-action="run-heir-allocation">상속인별 세액 안분 계산하기</button>' +
      '<div id="taxCalcHeirResult"></div>' +
    '</div>';
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
    const idx = numVal(btn.dataset.idx);
    transferAssets.splice(idx, 1);
    renderTransferPane();
  } else if (action === 'add-cost-item' || action === 'del-cost-item'){
    const idx = numVal(btn.closest('.taxcalc-asset').dataset.idx);
    const listKey = btn.dataset.costList;
    if (!Array.isArray(transferAssets[idx][listKey])) transferAssets[idx][listKey] = [{}];
    if (action === 'add-cost-item') transferAssets[idx][listKey].push({});
    else transferAssets[idx][listKey].splice(numVal(btn.dataset.idx), 1);
    renderTransferPane();
  } else if (action === 'add-valuation-asset'){
    const target = btn.dataset.target;
    const assets = target === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    assets.push({ method: 'direct' });
    renderValuationAssetList(target, assets);
  } else if (action === 'del-valuation-asset'){
    const containerId = btn.closest('[id="giftValuationList"], [id="inheritanceValuationList"]').id;
    const assets = containerId === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    assets.splice(numVal(btn.dataset.idx), 1);
    renderValuationAssetList(containerId, assets);
  } else if (action === 'add-rental-lease' || action === 'del-rental-lease'){
    const containerId = btn.closest('[id="giftValuationList"], [id="inheritanceValuationList"]').id;
    const assets = containerId === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    const assetIdx = numVal(btn.closest('.taxcalc-asset').dataset.idx);
    if (!Array.isArray(assets[assetIdx].rentalLeases)) assets[assetIdx].rentalLeases = [{}];
    if (action === 'add-rental-lease') assets[assetIdx].rentalLeases.push({});
    else assets[assetIdx].rentalLeases.splice(numVal(btn.dataset.idx), 1);
    renderValuationAssetList(containerId, assets);
  } else if (action === 'add-trust-benefit' || action === 'del-trust-benefit'){
    const containerId = btn.closest('[id="giftValuationList"], [id="inheritanceValuationList"]').id;
    const assets = containerId === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    const assetIdx = numVal(btn.closest('.taxcalc-asset').dataset.idx);
    if (!Array.isArray(assets[assetIdx].trustAnnualBenefits)) assets[assetIdx].trustAnnualBenefits = [{}];
    if (action === 'add-trust-benefit') assets[assetIdx].trustAnnualBenefits.push({});
    else assets[assetIdx].trustAnnualBenefits.splice(numVal(btn.dataset.idx), 1);
    renderValuationAssetList(containerId, assets);
  } else if (action === 'add-heir-alloc' || action === 'del-heir-alloc'){
    const assets = inheritanceValuationAssets;
    const assetIdx = numVal(btn.closest('.taxcalc-asset').dataset.idx);
    if (!Array.isArray(assets[assetIdx].heirAllocations)) assets[assetIdx].heirAllocations = [{}];
    if (action === 'add-heir-alloc') assets[assetIdx].heirAllocations.push({});
    else assets[assetIdx].heirAllocations.splice(numVal(btn.dataset.idx), 1);
    renderValuationAssetList('inheritanceValuationList', assets);
    updateHeirActualValueHints();
  } else if (action === 'apply-valuation-total'){
    const target = btn.dataset.target;
    const assets = target === 'giftValuationList' ? giftValuationAssets : inheritanceValuationAssets;
    const total = assets.reduce(function (s, a) { return s + computeValuationAssetValue(a); }, 0);
    const net = Math.max(0, total - computeTotalRentalDepositDebt_(assets));
    if (target === 'giftValuationList') document.getElementById('giftAmount').value = net;
    else document.getElementById('ihEstate').value = net;
  } else if (action === 'open-address-search'){
    // 이 버튼이 어느 자산 목록(양도세 거래카드/증여·상속 재산평가 자산행) 안에 있는지 DOM으로
    // 찾아서, 검색결과를 그 자산의 소재지·동·면적 관련 상태에 바로 채운다.
    const card = btn.closest('.taxcalc-asset');
    const idx = numVal(card.dataset.idx);
    const giftListEl = card.closest('#giftValuationList');
    const ihListEl = card.closest('#inheritanceValuationList');
    const assets = giftListEl ? giftValuationAssets : (ihListEl ? inheritanceValuationAssets : transferAssets);
    openAddressSearchModal_(function(picked){
      assets[idx].assetLocation = picked.roadAddr || picked.jibunAddr || '';
      assets[idx].assetDongList = picked.dongList || [];
      assets[idx].assetDong = '';
      assets[idx].assetZipNo = picked.zipNo || '';
      // 개별공시지가·공동주택가격 자동조회용 PNU 원자재를 함께 저장해둔다(화면엔 안 보이지만
      // "🔍 공시가격 자동조회" 버튼을 누를 때 조립해서 쓴다).
      assets[idx].assetAdmCd = picked.admCd || '';
      assets[idx].assetMtYn = picked.mtYn || '0';
      assets[idx].assetLnbrMnnm = picked.lnbrMnnm || '';
      assets[idx].assetLnbrSlno = picked.lnbrSlno || '';
      if (giftListEl) renderValuationAssetList('giftValuationList', giftValuationAssets);
      else if (ihListEl) renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
      else renderTransferPane();
    });
  } else if (action === 'open-address-search-simple'){
    // 자산목록이 아니라 단일 텍스트 입력칸(양도인/피상속인 주소 등)에 바로 채우는 단순 버전.
    const targetId = btn.dataset.targetInput;
    openAddressSearchModal_(function(picked){
      const el = targetId ? document.getElementById(targetId) : null;
      if (el) el.value = picked.roadAddr || picked.jibunAddr || '';
    });
  } else if (action === 'open-tax-office-guide'){
    // 특정 주소를 넣으면 관할세무서를 바로 알려주는 안정적인 공개 API가 확인되지 않아, 국세청 공식
    // 조회 페이지로 바로 연결 + 주소 클립보드 복사로 구현했다(완전 자동입력은 아니지만 실제로 동작함).
    const targetId = btn.dataset.addressInput;
    const el = targetId ? document.getElementById(targetId) : null;
    const addr = el ? el.value.trim() : '';
    if (addr && navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(addr).catch(function(){});
    }
    window.open('https://www.nts.go.kr/nts/taxSrch/taxSrchPage.do', '_blank');
    alert('국세청 관할세무서 조회 페이지를 새 창으로 열었습니다.' +
      (addr ? '\n주소가 클립보드에 복사되었으니 조회 화면 검색창에 붙여넣기(Ctrl+V)만 하면 됩니다:\n' + addr : '\n검색창에 주소를 입력해 조회하세요.'));
  } else if (action === 'check-bizno'){
    const field = btn.closest('.taxcalc-field');
    const input = field ? field.querySelector('input') : null;
    const resultEl = field ? field.querySelector('[data-bizno-result]') : null;
    const raw = (input && input.value || '').replace(/\D/g, '');
    if (raw.length === 13){
      const check = validateResidentRegistrationNumber_(raw);
      if (resultEl) resultEl.textContent = check.valid === false ? ('⚠ 개인 주민등록번호 형식 오류: ' + check.reason) : '개인 주민등록번호 형식은 정상입니다(실명 확인은 아님)';
    } else if (raw.length === 10){
      if (resultEl) resultEl.textContent = '확인 중…';
      fetch(GAS_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'checkBusinessNumber', bNo: raw })
      }).then(function(res){ return res.json(); }).then(function(data){
        if (!resultEl) return;
        if (data.error){ resultEl.textContent = '⚠ ' + data.error; return; }
        resultEl.textContent = (data.status === '계속사업자' ? '✅ ' : '⚠ ') + '사업자상태: ' + (data.status || '확인불가') + (data.closeDate ? ' (폐업일 ' + data.closeDate + ')' : '');
      }).catch(function(err){ if (resultEl) resultEl.textContent = '확인 실패: ' + (err && err.message || err); });
    } else {
      if (resultEl) resultEl.textContent = '10자리(사업자등록번호) 또는 13자리(개인 주민등록번호)를 입력하세요.';
    }
  } else if (action === 'lookup-official-price'){
    const card = btn.closest('.taxcalc-asset');
    const idx = numVal(card.dataset.idx);
    const giftListEl = card.closest('#giftValuationList');
    const ihListEl = card.closest('#inheritanceValuationList');
    const assets = giftListEl ? giftValuationAssets : (ihListEl ? inheritanceValuationAssets : transferAssets);
    const a = assets[idx];
    const pnu = buildPnu_(a);
    if (!pnu){ alert('먼저 "🔍 주소 검색"으로 소재지(지번)를 선택해야 공시가격을 자동조회할 수 있습니다.'); return; }
    const priceKind = btn.dataset.priceKind;
    fetch(GAS_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'lookupOfficialPrice', pnu: pnu, priceKind: priceKind, dong: a.assetDong || '', ho: a.assetHo || '' })
    }).then(function(res){ return res.json(); }).then(function(data){
      if (data.error){ alert(data.error); return; }
      if (priceKind === 'apartment' || priceKind === 'house') a.housePrice = data.price; else a.landPrice = data.price;
      if (giftListEl) renderValuationAssetList('giftValuationList', giftValuationAssets);
      else if (ihListEl) renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
      else renderTransferPane();
    }).catch(function(err){ alert('공시가격 조회 실패: ' + (err && err.message || err)); });
  } else if (action === 'lookup-real-price'){
    const card = btn.closest('.taxcalc-asset');
    const idx = numVal(card.dataset.idx);
    const giftListEl = card.closest('#giftValuationList');
    const ihListEl = card.closest('#inheritanceValuationList');
    const assets = giftListEl ? giftValuationAssets : (ihListEl ? inheritanceValuationAssets : transferAssets);
    const a = assets[idx];
    const lawdCd = (a.assetAdmCd || '').slice(0, 5);
    if (!/^\d{5}$/.test(lawdCd)){ alert('먼저 "🔍 주소 검색"으로 소재지를 선택해야 실거래가를 조회할 수 있습니다.'); return; }
    openRealPriceModal_(lawdCd, function(picked){
      a.directValue = picked.dealAmount;
      if (giftListEl) renderValuationAssetList('giftValuationList', giftValuationAssets);
      else if (ihListEl) renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
      else renderTransferPane();
    });
  } else if (action === 'open-evidence-transfer'){
    if (!explorerPath.length){ alert('먼저 탐색기에서 고객/사건 폴더를 여세요.'); return; }
    runAiAutoFillTransferBulk();
  } else if (action === 'open-evidence-gift'){
    if (!explorerPath.length){ alert('먼저 탐색기에서 고객/사건 폴더를 여세요.'); return; }
    runAiAutoFillGift();
  } else if (action === 'open-evidence-inheritance'){
    if (!explorerPath.length){ alert('먼저 탐색기에서 고객/사건 폴더를 여세요.'); return; }
    runAiAutoFillInheritance();
  } else if (action === 'show-calc-basis'){
    const idx = numVal(btn.dataset.idx);
    const box = document.getElementById('calcBasis-' + idx);
    if (box.style.display !== 'none' && box.innerHTML) {
      box.style.display = 'none';
    } else {
      populateTransferCalcBasis_(idx);
    }
  } else if (action === 'show-agg-calc-basis'){
    const box = document.getElementById('calcBasisAgg');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  } else if (action === 'add-alloc-asset'){
    allocationAssets.push({});
    renderAllocationTool();
  } else if (action === 'del-alloc-asset'){
    allocationAssets.splice(numVal(btn.dataset.idx), 1);
    renderAllocationTool();
  } else if (action === 'run-allocation'){
    const toolBox = document.getElementById('taxCalcAllocationTool');
    const method = document.getElementById('allocMethod').value;
    toolBox.dataset.method = method;
    toolBox.dataset.totalTransfer = document.getElementById('allocTotalTransfer').value;
    const input = {
      method: method,
      totalTransferPrice: numVal(document.getElementById('allocTotalTransfer').value) || 0,
      assets: allocationAssets.map(function(a){
        return {
          label: a.label, area: numVal(a.area) || 0,
          standardPriceTransfer: computeAllocationRowStandardPrice_(a, 'Transfer'),
          standardPriceAcquisition: computeAllocationRowStandardPrice_(a, 'Acquisition'),
          isBuilding: !!a.isBuilding
        };
      })
    };
    if (method === 'acq_expense_together' || method === 'acq_expense_separate') {
      toolBox.dataset.totalAcq = document.getElementById('allocTotalAcq').value;
      toolBox.dataset.totalExpense = document.getElementById('allocTotalExpense').value;
      input.totalAcquisitionPrice = numVal(document.getElementById('allocTotalAcq').value) || 0;
      input.totalNecessaryExpenses = numVal(document.getElementById('allocTotalExpense').value) || 0;
    }
    const result = calculateProportionalAllocationJS(input);
    // 계산 즉시 자산별 결과를 거래 목록에 자동으로 추가한다 — "적용" 버튼을 따로 눌러 복사해오지
    // 않아도 되게, 안분계산과 거래 추가를 한 동작으로 합친다.
    if (result && Array.isArray(result.자산별_안분결과)){
      result.자산별_안분결과.forEach(function(row){
        const newAsset = {
          transferPrice: row.양도가액_부가세제외 !== undefined ? row.양도가액_부가세제외 : row.양도가액_안분액
        };
        if (row.취득가액_안분액 !== undefined) newAsset.acquisitionPrice = row.취득가액_안분액;
        if (row.필요경비_안분액 !== undefined) newAsset.acquisitionExpenseItems = [{ label: '안분계산 반영', amount: row.필요경비_안분액 }];
        transferAssets.push(newAsset);
      });
      renderTransferPane();
    }
    renderAllocationResult(result);
  } else if (action === 'add-building-row'){
    buildingPriceRows.push({});
    renderBuildingPriceTool();
  } else if (action === 'del-building-row'){
    buildingPriceRows.splice(numVal(btn.dataset.idx), 1);
    renderBuildingPriceTool();
  } else if (action === 'run-building-price'){
    const toolBox = document.getElementById('taxCalcBuildingPriceTool');
    const taxType = document.getElementById('bpTaxType').value;
    toolBox.dataset.taxType = taxType;
    toolBox.dataset.landPrice = document.getElementById('bpLandPrice').value;
    const rows = buildingPriceRows.map(function(r){
      return {
        label: r.label, structureName: r.structureName,
        useNo: numVal(r.useNo) || 0, builtYear: numVal(r.builtYear) || 0,
        floorAreaSqm: numVal(r.floorAreaSqm) || 0
      };
    });
    const result = calculateBuildingStandardPriceMultiJS(rows, numVal(document.getElementById('bpLandPrice').value) || 0, taxType);
    // 계산 즉시 합계를 거래 목록에 자동으로 추가한다(양도세 탭 기준일 때만 — 상속세·증여세용으로
    // 계산했다면 재산평가 자산목록에 직접 입력해야 하므로 여기서 자동으로 거래를 만들지 않는다).
    if (result && !result.error && taxType === 'transfer' && result.건물기준시가_합계 > 0){
      transferAssets.push({ acquisitionPrice: result.건물기준시가_합계 });
      renderTransferPane();
    }
    renderBuildingPriceResult(result);
  } else if (action === 'apply-clawback-to-gift' || action === 'apply-clawback-to-inheritance'){
    const resultBox = document.getElementById('taxCalcClawbackResult');
    const total = numVal(resultBox.dataset.lastInterestTotal) || 0;
    const targetId = action === 'apply-clawback-to-gift' ? 'giftInterest' : 'ihInterest';
    const targetEl = document.getElementById(targetId);
    if (targetEl){ targetEl.value = String(total); targetEl.dispatchEvent(new Event('input', { bubbles: true })); }
  } else if (action === 'run-transfer'){
    const inputs = transferAssets.map(collectTransferInput);
    const filingParams = {
      transferorName: document.getElementById('trTransferorName').value,
      transferorRegNo: document.getElementById('trTransferorRegNo').value,
      filingStatus: document.getElementById('trFilingStatus').value,
      isFraudulent: document.getElementById('trFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('trUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('trUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('trMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('trUnpaidAtDesignated').value) || 0,
      isSelfElectronicFiling: document.getElementById('trSelfEfiling').checked
    };
    const result = calculateTransferTaxMultiJS(inputs, filingParams);
    renderTransferResult(result);
    transferAssets.forEach(function(_, idx){ populateTransferCalcBasis_(idx); }); // 산출내역을 토글 없이 한꺼번에 보여준다
  } else if (action === 'run-transfer-carryover'){
    const donorRelationSel = document.getElementById('coDonorRelation').value;
    const input = {
      transferPrice: numVal(document.getElementById('coTransferPrice').value) || 0,
      transferDate: document.getElementById('coTransferDate').value,
      assetType: document.getElementById('coAssetType').value,
      necessaryExpenses: numVal(document.getElementById('coNecessaryExpenses').value) || 0,
      isOneHouseOneFamily: document.getElementById('coOneHouse').checked,
      isAdjustedArea: document.getElementById('coAdjustedArea').checked,
      multiHouseCount: numVal(document.getElementById('coMultiHouseCount').value) || 0,
      giftReceivedDate: document.getElementById('coGiftDate').value,
      donorRelation: donorRelationSel === 'other' ? '' : donorRelationSel,
      isEminentDomainExcludedFromCarryover: document.getElementById('coEminentDomain').checked,
      donorAcquisitionPrice: numVal(document.getElementById('coDonorAcqPrice').value) || 0,
      donorAcquisitionDate: document.getElementById('coDonorAcqDate').value,
      donorNecessaryExpenses: numVal(document.getElementById('coDonorExpenses').value) || 0,
      doneeOwnAcquisitionPrice: numVal(document.getElementById('coDoneeAcqPrice').value) || 0,
      doneeOwnNecessaryExpenses: numVal(document.getElementById('coDoneeExpenses').value) || 0,
      giftTaxPaid: numVal(document.getElementById('coGiftTaxPaid').value) || 0,
      giftTaxableValue: numVal(document.getElementById('coGiftTaxableValue').value) || 0
    };
    renderCarryoverResult(calculateTransferTaxWithCarryoverJS(input));
  } else if (action === 'run-business-transfer-carryover'){
    const input = {
      provision: document.getElementById('btProvision').value,
      deferredTaxAmount: numVal(document.getElementById('btDeferredTax').value) || 0,
      triggerEvent: document.getElementById('btTriggerEvent').value,
      yearsSinceTransfer: numVal(document.getElementById('btYearsSince').value) || 0,
      alreadyPaidByCorp: numVal(document.getElementById('btAlreadyPaid').value) || 0
    };
    renderBusinessTransferCarryoverResult(calculateBusinessTransferCarryoverJS(input));
  } else if (action === 'run-burdened-gift-transfer'){
    const input = {
      assetAcquisitionPrice: numVal(document.getElementById('bgAcquisitionPrice').value) || 0,
      assetGiftValue: numVal(document.getElementById('bgGiftValue').value) || 0,
      totalDebtAmount: numVal(document.getElementById('bgDebtAmount').value) || 0,
      otherAssetsGiftValueSum: numVal(document.getElementById('bgOtherAssetsValue').value) || 0,
      necessaryExpenses: numVal(document.getElementById('bgNecessaryExpenses').value) || 0
    };
    renderBurdenedGiftTransferResult(calculateBurdenedGiftTransferJS(input));
  } else if (action === 'run-donor-direct-transfer'){
    const input = {
      isSpouseOrLinealCarryoverApplies: document.getElementById('ddSpouseLineal').checked,
      yearsSinceGift: numVal(document.getElementById('ddYearsSinceGift').value) || 0,
      isGainActuallyAttributedToDonee: document.getElementById('ddGainToDonee').checked,
      doneeGiftTax: numVal(document.getElementById('ddDoneeGiftTax').value) || 0,
      doneeTransferTax: numVal(document.getElementById('ddDoneeTransferTax').value) || 0,
      donorDirectTransferTax: numVal(document.getElementById('ddDonorTax').value) || 0
    };
    renderDonorDirectTransferResult(calculateDonorDirectTransferDeemedJS(input));
  } else if (action === 'run-new-house-reduction'){
    const input = {
      provision: document.getElementById('nhProvision').value,
      isHighPriceHouseExcluded: document.getElementById('nhHighPrice').checked,
      isPriceOrAreaQualified: document.getElementById('nhPriceAreaQualified').checked,
      acquisitionDate: document.getElementById('nhAcquisitionDate').value,
      transferDate: document.getElementById('nhTransferDate').value,
      acquisitionPrice: numVal(document.getElementById('nhAcquisitionPrice').value) || 0,
      transferPrice: numVal(document.getElementById('nhTransferPrice').value) || 0,
      necessaryExpenses: numVal(document.getElementById('nhNecessaryExpenses').value) || 0,
      fiveYearMarkValue: numVal(document.getElementById('nhFiveYearMarkValue').value) || 0,
      acquisitionStandardPrice: numVal(document.getElementById('nhAcquisitionStandardPrice').value) || 0,
      fiveYearStandardPrice: numVal(document.getElementById('nhFiveYearStandardPrice').value) || 0,
      transferStandardPrice: numVal(document.getElementById('nhTransferStandardPrice').value) || 0
    };
    renderNewHouseReductionResult(calculateNewHouseAcquisitionReductionJS(input));
  } else if (action === 'run-unsold-house-reduction'){
    const input = {
      provision: document.getElementById('uhProvision').value,
      isOverconcentrationZone: document.getElementById('uhOverconcentration').checked,
      priceDiscountRate: numVal(document.getElementById('uhDiscountRate').value) || 0,
      acquisitionDate: document.getElementById('uhAcquisitionDate').value,
      transferDate: document.getElementById('uhTransferDate').value,
      acquisitionPrice: numVal(document.getElementById('uhAcquisitionPrice').value) || 0,
      exclusiveAreaSqm: numVal(document.getElementById('uhExclusiveAreaSqm').value) || undefined,
      transferPrice: numVal(document.getElementById('uhTransferPrice').value) || 0,
      necessaryExpenses: numVal(document.getElementById('uhNecessaryExpenses').value) || 0,
      fiveYearMarkValue: numVal(document.getElementById('uhFiveYearMarkValue').value) || 0,
      acquisitionStandardPrice: numVal(document.getElementById('uhAcquisitionStandardPrice').value) || 0,
      fiveYearStandardPrice: numVal(document.getElementById('uhFiveYearStandardPrice').value) || 0,
      transferStandardPrice: numVal(document.getElementById('uhTransferStandardPrice').value) || 0
    };
    renderUnsoldHouseReductionResult(calculateUnsoldHouseAcquisitionReductionJS(input));
  } else if (action === 'run-unsold-house-one-house'){
    const input = {
      acquisitionDate: document.getElementById('u9AcquisitionDate').value,
      isOutsideMetropolitanArea: document.getElementById('u9OutsideMetro').checked,
      wasOneHouseBeforeAcquisition: document.getElementById('u9WasOneHouse').checked,
      meetsAreaAndPriceRequirements: document.getElementById('u9AreaPriceOk').checked
    };
    renderUnsoldHouseOneHouseResult(calculateUnsoldHouseOneHouseExclusionJS(input));
  } else if (action === 'run-restructuring-property-reduction'){
    const input = {
      acquisitionDate: document.getElementById('rpAcquisitionDate').value,
      transferDate: document.getElementById('rpTransferDate').value,
      acquisitionPrice: numVal(document.getElementById('rpAcquisitionPrice').value) || 0,
      transferPrice: numVal(document.getElementById('rpTransferPrice').value) || 0,
      necessaryExpenses: numVal(document.getElementById('rpNecessaryExpenses').value) || 0,
      fiveYearMarkValue: numVal(document.getElementById('rpFiveYearMarkValue').value) || 0,
      acquisitionStandardPrice: numVal(document.getElementById('rpAcquisitionStandardPrice').value) || 0,
      fiveYearStandardPrice: numVal(document.getElementById('rpFiveYearStandardPrice').value) || 0,
      transferStandardPrice: numVal(document.getElementById('rpTransferStandardPrice').value) || 0
    };
    renderRestructuringPropertyReductionResult(calculateRestructuringPropertyReductionJS(input));
  } else if (action === 'run-population-decline-house'){
    const input = {
      acquisitionDate: document.getElementById('pdAcquisitionDate').value,
      isPopulationDeclineArea: document.getElementById('pdPopulationDeclineArea').checked,
      wasOneOrFewerBeforeAcquisition: document.getElementById('pdWasOneOrFewer').checked,
      meetsAreaAndPriceRequirements: document.getElementById('pdAreaPriceOk').checked
    };
    renderPopulationDeclineHouseResult(calculatePopulationDeclineAreaHouseExclusionJS(input));
  } else if (action === 'run-long-term-rental-house'){
    const input = {
      provision: document.getElementById('lrProvision').value,
      subType: document.getElementById('lrSubType').value,
      transferPrice: numVal(document.getElementById('lrTransferPrice').value) || 0,
      acquisitionPrice: numVal(document.getElementById('lrAcquisitionPrice').value) || 0,
      necessaryExpenses: numVal(document.getElementById('lrNecessaryExpenses').value) || 0,
      registrationDateValue: numVal(document.getElementById('lrRegistrationValue').value) || 0,
      acquisitionStandardPrice: numVal(document.getElementById('lrAcquisitionStandardPrice').value) || 0,
      registrationStandardPrice: numVal(document.getElementById('lrRegistrationStandardPrice').value) || 0,
      transferStandardPrice: numVal(document.getElementById('lrTransferStandardPrice').value) || 0
    };
    renderLongTermRentalHouseResult(calculateLongTermRentalHouseReductionJS(input));
  } else if (action === 'run-national-forest-land'){
    const input = {
      transferDate: document.getElementById('nfTransferDate').value,
      holdingYears: numVal(document.getElementById('nfHoldingYears').value) || 0,
      transferPrice: numVal(document.getElementById('nfTransferPrice').value) || 0,
      acquisitionPrice: numVal(document.getElementById('nfAcquisitionPrice').value) || 0,
      necessaryExpenses: numVal(document.getElementById('nfNecessaryExpenses').value) || 0
    };
    renderNationalForestLandResult(calculateNationalForestLandReductionJS(input));
  } else if (action === 'run-industrial-complex-lot'){
    const input = {
      transferDate: document.getElementById('icTransferDate').value,
      salePrice: numVal(document.getElementById('icSalePrice').value) || 0,
      wasResidentForTwoYears: document.getElementById('icWasResident').checked
    };
    renderIndustrialComplexLotResult(calculateIndustrialComplexRelocationLotRateJS(input));
  } else if (action === 'run-museum-relocation'){
    const input = {
      transferDate: document.getElementById('mrTransferDate').value,
      totalTaxAmount: numVal(document.getElementById('mrTotalTax').value) || 0
    };
    renderMuseumRelocationResult(calculateMuseumRelocationInstallmentJS(input));
  } else if (action === 'run-farmland-repurchase'){
    const input = {
      wasRepurchasedWithinLeaseTerm: document.getElementById('frWithinLeaseTerm').checked,
      originalTaxPaid: numVal(document.getElementById('frOriginalTax').value) || 0
    };
    renderFarmlandRepurchaseResult(calculateFarmlandRepurchaseRefundJS(input));
  } else if (action === 'run-stock-transfer'){
    const input = {
      assetCategory: document.getElementById('stAssetCategory').value,
      transferPrice: numVal(document.getElementById('stTransferPrice').value) || 0,
      acquisitionPrice: numVal(document.getElementById('stAcquisitionPrice').value) || 0,
      transferExpenses: numVal(document.getElementById('stTransferExpenses').value) || 0,
      isMajorityNonBusinessLandCorp: document.getElementById('stMajorityNonBizLand').checked,
      isDaejuju: document.getElementById('stIsDaejuju').checked,
      holdingMonths: document.getElementById('stHoldingMonths').value === '' ? null : numVal(document.getElementById('stHoldingMonths').value),
      isSmallMediumCompany: document.getElementById('stIsSmallMedium').checked,
      priorNetGainOrLoss: numVal(document.getElementById('stPriorNetGain').value) || 0,
      basicDeductionAlreadyUsed: numVal(document.getElementById('stBasicDeductionUsed').value) || 0,
      foreignTaxPaidAmount: numVal(document.getElementById('stForeignTax').value) || 0,
      filingStatus: document.getElementById('stFilingStatus').value,
      isFraudulent: document.getElementById('stFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('stUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('stUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('stMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('stUnpaidAtDesignated').value) || 0,
      unrecordedIncomeAmount: numVal(document.getElementById('stUnrecordedIncome').value) || 0,
      transactionAmountForBookkeepingPenalty: numVal(document.getElementById('stBookkeepingPenaltyTxAmount').value) || 0
    };
    renderStockTransferResult(calculateStockTransferTaxJS(input));
  } else if (action === 'run-stock-transfer-carryover'){
    const scDonorRelationSel = document.getElementById('scDonorRelation').value;
    const input = {
      assetCategory: document.getElementById('scAssetCategory').value,
      transferPrice: numVal(document.getElementById('scTransferPrice').value) || 0,
      transferDate: document.getElementById('scTransferDate').value,
      transferExpenses: numVal(document.getElementById('scTransferExpenses').value) || 0,
      isDaejuju: document.getElementById('scIsDaejuju').checked,
      isSmallMediumCompany: document.getElementById('scIsSmallMedium').checked,
      holdingMonths: numVal(document.getElementById('scHoldingMonths').value) || 0,
      giftReceivedDate: document.getElementById('scGiftDate').value,
      donorRelation: scDonorRelationSel === 'other' ? '' : scDonorRelationSel,
      donorAcquisitionPrice: numVal(document.getElementById('scDonorAcqPrice').value) || 0,
      doneeOwnAcquisitionPrice: numVal(document.getElementById('scDoneeAcqPrice').value) || 0,
      giftTaxPaid: numVal(document.getElementById('scGiftTaxPaid').value) || 0,
      giftTaxableValue: numVal(document.getElementById('scGiftTaxableValue').value) || 0
    };
    renderStockCarryoverResult(calculateStockTransferTaxWithCarryoverJS(input));
  } else if (action === 'run-overseas-asset-transfer'){
    const input = {
      wasResidentFiveYearsContinuously: document.getElementById('oaResident5yr').checked,
      transferPrice: numVal(document.getElementById('oaTransferPrice').value) || 0,
      acquisitionPrice: numVal(document.getElementById('oaAcquisitionPrice').value) || 0,
      capitalExpenditure: numVal(document.getElementById('oaCapitalExpenditure').value) || 0,
      transferExpenses: numVal(document.getElementById('oaTransferExpenses').value) || 0,
      foreignTaxCreditMethod: document.getElementById('oaForeignTaxMethod').value,
      foreignTaxPaidAmount: numVal(document.getElementById('oaForeignTaxPaid').value) || 0,
      domesticTransferIncomeAmount: numVal(document.getElementById('oaDomesticIncome').value) || 0,
      filingStatus: document.getElementById('oaFilingStatus').value,
      isFraudulent: document.getElementById('oaFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('oaUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('oaUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('oaMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('oaUnpaidAtDesignated').value) || 0
    };
    renderOverseasAssetTransferResult(calculateOverseasAssetTransferTaxJS(input));
  } else if (action === 'run-transfer-related-party-adjustment'){
    const input = {
      isRelatedPartyTransaction: true,
      transactionRole: document.getElementById('rpaRole').value,
      actualPrice: numVal(document.getElementById('rpaActualPrice').value) || 0,
      marketValue: numVal(document.getElementById('rpaMarketValue').value) || 0
    };
    renderRelatedPartyAdjustmentResult(calculateTransferRelatedPartyPriceAdjustmentJS(input));
  } else if (action === 'run-transfer-fair-market-value-recognition'){
    const input = {
      taxType: 'transfer',
      valuationBaseDate: document.getElementById('tfvBaseDate').value,
      evidenceType: document.getElementById('tfvEvidenceType').value,
      evidenceDate: document.getElementById('tfvEvidenceDate').value,
      isRelatedPartyTransaction: document.getElementById('tfvRelatedParty').checked,
      appraisalValueAverage: numVal(document.getElementById('tfvAppraisalAvg').value) || 0,
      supplementaryValue: numVal(document.getElementById('tfvSupplementaryValue').value) || 0
    };
    renderTransferFmvResult(checkFairMarketValueRecognitionJS(input));
  } else if (action === 'send-debt-to-transfer'){
    // 부담부증여의 인수채무액 상당분은 증여자가 그 지분만큼 대가(채무인수)를 받고 양도한 것으로
    // 과세된다(소득세법§88①). 양도가액=인수채무액, 취득가액·필요경비는 증여자의 전체 재산 기준
    // 취득정보에 (인수채무액÷증여재산가액) 비율을 곱해 안분한다.
    const giftAmount = numVal(document.getElementById('giftAmount').value) || 0;
    const debtAmount = numVal(document.getElementById('giftDebtAssumed').value) || 0;
    if (!giftAmount || !debtAmount) return;
    const closeRelation = ['배우자', '직계존속', '직계비속'].indexOf(document.getElementById('giftRelation').value) !== -1;
    if (closeRelation && !document.getElementById('giftDebtObjProven').checked) {
      if (!confirm('배우자·직계존비속간 부담부증여는 채무 인수가 객관적으로 입증되지 않으면(§47③) 애초에 채무 인수 자체가 없는 것으로 추정되어, 인수채무액에 대한 양도세도 발생하지 않습니다.\n\n그래도 양도세 탭으로 보내시겠습니까?')) return;
    }
    const ratio = Math.min(1, debtAmount / giftAmount);
    const donorAcqPrice = numVal(document.getElementById('giftDonorAcqPrice').value) || 0;
    const donorAcqExpense = numVal(document.getElementById('giftDonorAcqExpense').value) || 0;
    const donorAcqDate = document.getElementById('giftDonorAcqDate').value;
    const giftDate = document.getElementById('giftDate').value;
    const newAsset = {
      transferPrice: debtAmount,
      acquisitionPrice: Math.round(donorAcqPrice * ratio),
      acquisitionDate: donorAcqDate,
      transferDate: giftDate,
      buyerName: document.getElementById('giftDoneeName').value,
      buyerRegNo: document.getElementById('giftDoneeRegNo').value,
      buyerRelation: 'lineal'
    };
    if (donorAcqExpense > 0) newAsset.acquisitionExpenseItems = [{ label: '부담부증여 안분(증여자 필요경비)', amount: Math.round(donorAcqExpense * ratio) }];
    transferAssets.push(newAsset);
    renderTransferPane();
    const btns2 = Array.from(document.querySelectorAll('.taxcalc-tab'));
    const transferTab = btns2.find(function(b){ return b.textContent.trim() === '양도소득세'; });
    if (transferTab) transferTab.click();
  } else if (action === 'send-transfer-to-gift-deemed'){
    // 특수관계인과 시가보다 낮게(높게) 거래한 경우, 그 차액을 상증세법§35 저가양수·고가양도
    // 증여의제 계산기로 넘긴다 — 실제거래대가·시가만 옮기고, 세액계산은 그 계산기에서 그대로 진행.
    const idx = numVal(btn.dataset.idx);
    const vals = transferAssets[idx];
    const fairValue = numVal(vals.fairMarketValueForGiftCheck) || 0;
    const transferPrice = numVal(vals.transferPrice) || 0;
    if (!fairValue || !transferPrice) return;
    const btns3 = Array.from(document.querySelectorAll('.taxcalc-tab'));
    const giftTab = btns3.find(function(b){ return b.textContent.trim() === '증여세'; });
    if (giftTab) giftTab.click();
    const fairValueEl = document.getElementById('lpFairValue');
    const transferPriceEl = document.getElementById('lpTransferPrice');
    if (fairValueEl){ fairValueEl.value = String(fairValue); fairValueEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (transferPriceEl){ transferPriceEl.value = String(transferPrice); transferPriceEl.dispatchEvent(new Event('input', { bubbles: true })); }
  } else if (action === 'send-settlement-to-new-transfer'){
    // 청산금 환급액(재건축·환지 공통)은 관리처분인가일(또는 환지처분공고일)에 종전자산 중 그 만큼을
    // 먼저 양도한 것으로 과세된다 — 종전 취득가액을 (환급액÷권리가액 또는 면적) 비율로 안분한다.
    const idx = numVal(btn.dataset.idx);
    const kind = btn.dataset.kind;
    const vals = transferAssets[idx];
    const origPrice = numVal(vals.originalAssetAcquisitionPrice) || 0;
    const newAsset = { acquisitionDate: vals.acquisitionDate || '' };
    if (kind === 'reconstruction'){
      const received = numVal(vals.settlementReceived) || 0;
      const rightsValue = numVal(vals.rightsValue) || 0;
      if (!received || !rightsValue) return;
      newAsset.transferPrice = received;
      newAsset.transferDate = vals.managementDispositionDate || '';
      newAsset.acquisitionPrice = Math.round(origPrice * Math.min(1, received / rightsValue));
    } else {
      const received = numVal(vals.replotmentSettlementReceived) || 0;
      const rightsArea = numVal(vals.rightsAreaSqm) || 0;
      const finalArea = numVal(vals.finalAreaSqm) || 0;
      if (!received || !rightsArea) return;
      const reducedRatio = Math.min(1, Math.max(0, (rightsArea - finalArea)) / rightsArea);
      newAsset.transferPrice = received;
      newAsset.transferDate = vals.replotmentDisposalDate || '';
      newAsset.acquisitionPrice = Math.round(origPrice * reducedRatio);
    }
    transferAssets.push(newAsset);
    renderTransferPane();
  } else if (action === 'run-gift'){
    const input = {
      giftAmount: numVal(document.getElementById('giftAmount').value) || 0,
      relation: document.getElementById('giftRelation').value,
      isMinor: taxCalcGiftDoneeIsMinor(),
      isDoneeResident: document.getElementById('giftDoneeResident').value !== 'nonresident',
      debtAssumedAmount: numVal(document.getElementById('giftDebtAssumed').value) || 0,
      isDebtObjectivelyProven: !!document.getElementById('giftDebtObjProven').checked,
      priorGiftAmount: numVal(document.getElementById('giftPriorAmount').value) || 0,
      priorPaidTax: numVal(document.getElementById('giftPriorPaidTax').value) || 0,
      priorRelationDeductionUsed: numVal(document.getElementById('giftPriorRelationDeductionUsed').value) || 0,
      isGenerationSkip: (function(){
        const sel = document.getElementById('giftRelation');
        const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
        return !!(opt && opt.dataset.genskip === '1');
      })(),
      generationSkipOver2Billion: document.getElementById('giftGenSkipOver2B').checked,
      generationSkipGiftAmount: (function(){
        const raw = document.getElementById('giftGenSkipAmount').value;
        return raw === '' ? undefined : numVal(raw);
      })(),
      priorPaidGenerationSkipPremium: numVal(document.getElementById('giftGenSkipPriorPaid').value) || 0,
      isMarriageGift: taxCalcIsMarriageGiftEligible_(document.getElementById('giftDate').value, document.getElementById('giftMarriageDate').value),
      isBirthGift: taxCalcIsBirthGiftEligible_(document.getElementById('giftDate').value, document.getElementById('giftBirthDate').value),
      priorMarriageOrBirthDeductionUsed: numVal(document.getElementById('giftPriorMarriageBirth').value) || 0,
      isExcludedFromAggregation: document.getElementById('giftExcludedAgg').checked,
      appraisalFeeAmount: numVal(document.getElementById('giftAppraisalFee').value) || 0,
      disasterLossAmount: numVal(document.getElementById('giftDisasterLoss').value) || 0,
      nonTaxableAmount: numVal(document.getElementById('giftNonTaxable').value) || 0,
      publicInterestOrgAmount: numVal(document.getElementById('giftPublicOrg').value) || 0,
      publicTrustAmount: numVal(document.getElementById('giftPublicTrust').value) || 0,
      disabledTrustAmount: numVal(document.getElementById('giftDisabledTrust').value) || 0,
      foreignTaxPaidAmount: numVal(document.getElementById('giftForeignTax').value) || 0,
      otherCreditsAmount: numVal(document.getElementById('giftOtherCredits').value) || 0,
      interestAmount: numVal(document.getElementById('giftInterest').value) || 0,
      publicInterestOrgPenalty: numVal(document.getElementById('giftPublicOrgPenalty').value) || 0,
      museumDeferredTaxAmount: numVal(document.getElementById('giftMuseumDeferred').value) || 0,
      businessSuccessionDeferredTaxAmount: numVal(document.getElementById('giftBizSuccessionDeferred').value) || 0,
      farmlandGiftTaxExemptionAmount: numVal(document.getElementById('giftFarmlandExemption').value) || 0,
      doneeName: document.getElementById('giftDoneeName').value,
      doneeRegNo: document.getElementById('giftDoneeRegNo').value,
      doneeAddress: document.getElementById('giftDoneeAddress').value,
      donorName: document.getElementById('giftDonorName').value,
      donorRegNo: document.getElementById('giftDonorRegNo').value,
      donorAddress: document.getElementById('giftDonorAddress').value,
      giftDate: document.getElementById('giftDate').value,
      filingStatus: document.getElementById('giftFilingStatus').value,
      isFraudulent: document.getElementById('giftFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('giftUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('giftUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('giftMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('giftUnpaidAtDesignated').value) || 0,
      reportedInTime: document.getElementById('giftReportedInTime').checked
    };
    renderGiftResult(calculateGiftTaxJS(input));
  } else if (action === 'run-special-rate-gift'){
    const input = {
      specialType: document.getElementById('srGiftType').value,
      giftAmount: numVal(document.getElementById('srGiftAmount').value) || 0,
      debtAssumedAmount: numVal(document.getElementById('srDebtAssumed').value) || 0,
      priorSpecialGiftAmount: numVal(document.getElementById('srPriorSpecialGift').value) || 0,
      jobsCreated10Plus: document.getElementById('srJobsCreated10Plus').checked,
      businessOwnershipYearsOfParent: numVal(document.getElementById('srBusinessYears').value) || 0,
      totalAssetValue: numVal(document.getElementById('srTotalAsset').value) || 0,
      nonBizAsset55: numVal(document.getElementById('srNonBiz55').value) || 0,
      nonBizAsset49: numVal(document.getElementById('srNonBiz49').value) || 0,
      nonBizAsset61: numVal(document.getElementById('srNonBiz61').value) || 0,
      excessCash: numVal(document.getElementById('srExcessCash').value) || 0,
      nonBizStock: numVal(document.getElementById('srNonBizStock').value) || 0,
      disasterLossAmount: numVal(document.getElementById('srDisasterLoss').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('srAppraisalFee').value) || 0,
      priorPaidTax: numVal(document.getElementById('srPriorPaidTax').value) || 0,
      foreignTaxPaidAmount: numVal(document.getElementById('srForeignTax').value) || 0,
      filingStatus: document.getElementById('srFilingStatus').value,
      isFraudulent: document.getElementById('srFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('srUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('srUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('srMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('srUnpaidAtDesignated').value) || 0
    };
    renderSpecialRateGiftResult(calculateSpecialRateGiftTaxJS(input));
  } else if (action === 'run-nominee-trust'){
    const input = {
      nomineeTrustPropertyValue: numVal(document.getElementById('ntPropertyValue').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('ntAppraisalFee').value) || 0,
      isNoTaxAvoidancePurpose: document.getElementById('ntNoAvoidancePurpose').checked,
      isTrustPropertyRegistration: document.getElementById('ntTrustPropertyReg').checked,
      isNonResidentAgentRegistration: document.getElementById('ntNonResidentAgentReg').checked,
      isNameChangeNeglectCase: document.getElementById('ntNameChangeNeglect').checked,
      isSaleAcquisitionWithTransferReport: document.getElementById('ntSaleWithTransferReport').checked,
      isInheritanceAcquisitionWithEstateReport: document.getElementById('ntInheritanceWithEstateReport').checked,
      isLateAmendedAfterAuditNotice: document.getElementById('ntLateAmendedAfterAudit').checked
    };
    renderNomineeTrustResult(calculateNomineeTrustGiftTaxJS(input));
  } else if (action === 'run-property-funds'){
    const input = {
      acquisitionValue: numVal(document.getElementById('afTotalValue').value) || 0,
      provenAmount: numVal(document.getElementById('afProvenAmount').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('afAppraisalFee').value) || 0,
      filingStatus: document.getElementById('afFilingStatus').value,
      isFraudulent: document.getElementById('afFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('afUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('afUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('afMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('afUnpaidAtDesignated').value) || 0
    };
    renderPropertyFundsResult(calculatePropertyAcquisitionFundsGiftTaxJS(input));
  } else if (action === 'run-debt-forgiveness'){
    const input = {
      debtAmount: numVal(document.getElementById('dfDebtAmount').value) || 0,
      compensationPaid: numVal(document.getElementById('dfCompensation').value) || 0,
      relationDeductionLimit: numVal(document.getElementById('dfRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('dfAppraisalFee').value) || 0,
      filingStatus: document.getElementById('dfFilingStatus').value,
      isFraudulent: document.getElementById('dfFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('dfUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('dfUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('dfMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('dfUnpaidAtDesignated').value) || 0
    };
    renderDebtForgivenessResult(calculateDebtForgivenessGiftTaxJS(input));
  } else if (action === 'run-capital-increase-gift'){
    const input = {
      caseType: document.getElementById('ciCaseType').value,
      preValuePerShare: numVal(document.getElementById('ciPreValue').value) || 0,
      preShares: numVal(document.getElementById('ciPreShares').value) || 0,
      issuePricePerShare: numVal(document.getElementById('ciIssuePrice').value) || 0,
      increasedShares: numVal(document.getElementById('ciIncreasedShares').value) || 0,
      allocatedShares: numVal(document.getElementById('ciAllocatedShares').value) || 0,
      equalIncreaseShares: numVal(document.getElementById('ciEqualIncreaseShares').value) || 0,
      deemedAllocatedShares: numVal(document.getElementById('ciDeemedAllocatedShares').value) || 0,
      forfeitedShares: numVal(document.getElementById('ciForfeitedShares').value) || 0,
      relatedAcquiredShares: numVal(document.getElementById('ciRelatedAcquiredShares').value) || 0,
      equalIncreaseTotalShares: numVal(document.getElementById('ciEqualIncreaseTotalShares').value) || 0,
      underAllocatedShares: numVal(document.getElementById('ciUnderAllocatedShares').value) || 0,
      nonShareholderAndExcessTotalShares: numVal(document.getElementById('ciNonShareholderTotalShares').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('ciPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('ciRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('ciAppraisalFee').value) || 0,
      filingStatus: document.getElementById('ciFilingStatus').value,
      isFraudulent: document.getElementById('ciFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('ciUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('ciUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('ciMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('ciUnpaidAtDesignated').value) || 0
    };
    renderCapitalIncreaseGiftResult(calculateCapitalIncreaseGiftTaxJS(input));
  } else if (action === 'run-capital-reduction-gift'){
    const input = {
      caseType: document.getElementById('crCaseType').value,
      valuePerShare: numVal(document.getElementById('crValuePerShare').value) || 0,
      paymentPerShare: numVal(document.getElementById('crPaymentPerShare').value) || 0,
      totalReducedShares: numVal(document.getElementById('crTotalReducedShares').value) || 0,
      postReductionOwnershipRatio: numVal(document.getElementById('crPostRatio').value) || 0,
      relatedReducedShares: numVal(document.getElementById('crRelatedShares').value) || 0,
      ownReducedShares: numVal(document.getElementById('crOwnShares').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('crPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('crRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('crAppraisalFee').value) || 0,
      filingStatus: document.getElementById('crFilingStatus').value,
      isFraudulent: document.getElementById('crFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('crUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('crUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('crMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('crUnpaidAtDesignated').value) || 0
    };
    renderCapitalReductionGiftResult(calculateCapitalReductionGiftTaxJS(input));
  } else if (action === 'run-in-kind-contribution-gift'){
    const input = {
      caseType: document.getElementById('icfCaseType').value,
      preValuePerShare: numVal(document.getElementById('icfPreValue').value) || 0,
      preShares: numVal(document.getElementById('icfPreShares').value) || 0,
      issuePricePerShare: numVal(document.getElementById('icfIssuePrice').value) || 0,
      increasedShares: numVal(document.getElementById('icfIncreasedShares').value) || 0,
      allocatedShares: numVal(document.getElementById('icfAllocatedShares').value) || 0,
      acquiredShares: numVal(document.getElementById('icfAcquiredShares').value) || 0,
      relatedShareholderRatio: numVal(document.getElementById('icfRelatedRatio').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('icfPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('icfRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('icfAppraisalFee').value) || 0,
      filingStatus: document.getElementById('icfFilingStatus').value,
      isFraudulent: document.getElementById('icfFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('icfUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('icfUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('icfMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('icfUnpaidAtDesignated').value) || 0
    };
    renderInKindContributionGiftResult(calculateInKindContributionGiftTaxJS(input));
  } else if (action === 'run-convertible-bond-gift'){
    const input = {
      caseType: document.getElementById('cbCaseType').value,
      fairValue: numVal(document.getElementById('cbFairValue').value) || 0,
      acquisitionCost: numVal(document.getElementById('cbAcquisitionCost').value) || 0,
      transferPrice: numVal(document.getElementById('cbTransferPrice').value) || 0,
      preConversionValuePerShare: numVal(document.getElementById('cbPreValue').value) || 0,
      preConversionShares: numVal(document.getElementById('cbPreShares').value) || 0,
      conversionPricePerShare: numVal(document.getElementById('cbConversionPrice').value) || 0,
      increasedShares: numVal(document.getElementById('cbIncreasedShares').value) || 0,
      interestLossAmount: numVal(document.getElementById('cbInterestLoss').value) || 0,
      bondFaceValueAtMaturity: numVal(document.getElementById('cbFaceValueAtMaturity').value) || 0,
      bondIssueRate: numVal(document.getElementById('cbIssueRate').value) || 0,
      yearsToMaturityAtAcquisition: numVal(document.getElementById('cbYearsToMaturity').value) || 0,
      priorAcquisitionGiftAmount: numVal(document.getElementById('cbPriorAcquisitionGift').value) || 0,
      relatedPriorOwnershipRatio: numVal(document.getElementById('cbRelatedRatio').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('cbPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('cbRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('cbAppraisalFee').value) || 0,
      filingStatus: document.getElementById('cbFilingStatus').value,
      isFraudulent: document.getElementById('cbFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('cbUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('cbUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('cbMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('cbUnpaidAtDesignated').value) || 0
    };
    renderConvertibleBondGiftResult(calculateConvertibleBondGiftTaxJS(input));
  } else if (action === 'run-excess-dividend-gift'){
    const input = {
      isFinalSettlement: document.getElementById('edFinalSettlement').checked,
      excessDividendBaseAmount: numVal(document.getElementById('edBaseAmount').value) || 0,
      disproportionateShortfallRatio: numVal(document.getElementById('edShortfallRatio').value) || 0,
      estimatedIncomeTaxEquivalent: numVal(document.getElementById('edEstimatedTax').value) || 0,
      actualIncomeTax: numVal(document.getElementById('edActualTax').value) || 0,
      comprehensiveIncomeTaxBase: numVal(document.getElementById('edComprehensiveBase').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('edPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('edRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('edAppraisalFee').value) || 0,
      filingStatus: document.getElementById('edFilingStatus').value,
      isFraudulent: document.getElementById('edFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('edUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('edUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('edMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('edUnpaidAtDesignated').value) || 0
    };
    renderExcessDividendGiftResult(calculateExcessDividendGiftTaxJS(input));
  } else if (action === 'run-stock-listing-gift'){
    const input = {
      provision: document.getElementById('slProvision').value,
      settlementValuePerShare: numVal(document.getElementById('slSettlementValue').value) || 0,
      originalValuePerShare: numVal(document.getElementById('slOriginalValue').value) || 0,
      realValueIncreasePerShare: numVal(document.getElementById('slRealIncrease').value) || 0,
      shares: numVal(document.getElementById('slShares').value) || 0,
      originalGiftTaxPaid: numVal(document.getElementById('slOriginalGiftTaxPaid').value) || 0,
      relationDeductionLimit: numVal(document.getElementById('slRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('slAppraisalFee').value) || 0,
      filingStatus: document.getElementById('slFilingStatus').value,
      isFraudulent: document.getElementById('slFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('slUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('slUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('slMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('slUnpaidAtDesignated').value) || 0
    };
    renderStockListingGiftResult(calculateStockListingGiftTaxJS(input));
  } else if (action === 'run-nontaxable-inheritance'){
    const input = {
      itemType: document.getElementById('niItemType').value,
      amount: numVal(document.getElementById('niAmount').value) || 0
    };
    renderNontaxableInheritanceResult(calculateNontaxableInheritancePropertyJS(input));
  } else if (action === 'run-rural-house-exclusion'){
    const input = {
      houseType: document.getElementById('rhHouseType').value,
      acquisitionDate: document.getElementById('rhAcquisitionDate').value,
      meetsLocationAndPriceRequirements: document.getElementById('rhLocationPriceOk').checked,
      isSameOrAdjacentDistrict: document.getElementById('rhSameDistrict').checked,
      holdingYears: numVal(document.getElementById('rhHoldingYears').value) || 0,
      isPendingHoldingPeriod: document.getElementById('rhPendingHolding').checked,
      triggerClawback: document.getElementById('rhClawback').checked,
      isExemptedReason: document.getElementById('rhExempted').checked
    };
    renderRuralHouseExclusionResult(calculateRuralHouseOneHouseExclusionJS(input));
  } else if (action === 'run-free-property-use'){
    const input = {
      useType: document.getElementById('fuUseType').value,
      propertyValue: numVal(document.getElementById('fuPropertyValue').value) || 0,
      loanAmount: numVal(document.getElementById('fuLoanAmount').value) || 0,
      actualInterestPaid: numVal(document.getElementById('fuActualInterest').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('fuPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('fuRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('fuAppraisalFee').value) || 0,
      filingStatus: document.getElementById('fuFilingStatus').value,
      isFraudulent: document.getElementById('fuFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('fuUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('fuUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('fuMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('fuUnpaidAtDesignated').value) || 0
    };
    renderFreePropertyUseResult(calculateFreePropertyUseGiftTaxJS(input));
  } else if (action === 'run-spouse-property-transfer'){
    const input = {
      transferType: document.getElementById('spTransferType').value,
      assetValue: numVal(document.getElementById('spAssetValue').value) || 0,
      isExcluded: document.getElementById('spExcluded').checked,
      priorTaxesSum: numVal(document.getElementById('spPriorTaxesSum').value) || 0,
      comparisonGiftTax: numVal(document.getElementById('spComparisonGiftTax').value) || 0,
      relationDeductionLimit: numVal(document.getElementById('spRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('spAppraisalFee').value) || 0,
      filingStatus: document.getElementById('spFilingStatus').value,
      isFraudulent: document.getElementById('spFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('spUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('spUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('spMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('spUnpaidAtDesignated').value) || 0
    };
    renderSpousePropertyTransferResult(calculateSpousePropertyTransferGiftTaxJS(input));
  } else if (action === 'run-insurance-proceeds'){
    const input = {
      insuranceProceeds: numVal(document.getElementById('ipProceeds').value) || 0,
      totalPremiumPaid: numVal(document.getElementById('ipTotalPremium').value) || 0,
      premiumPaidByOthers: numVal(document.getElementById('ipPremiumByOthers').value) || 0,
      premiumPaidFromGiftedAssets: numVal(document.getElementById('ipPremiumFromGifted').value) || 0,
      relationDeductionLimit: numVal(document.getElementById('ipRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('ipAppraisalFee').value) || 0,
      filingStatus: document.getElementById('ipFilingStatus').value,
      isFraudulent: document.getElementById('ipFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('ipUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('ipUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('ipMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('ipUnpaidAtDesignated').value) || 0
    };
    renderInsuranceProceedsResult(calculateInsuranceProceedsGiftTaxJS(input));
  } else if (action === 'run-trust-income'){
    const input = {
      giftAmount: numVal(document.getElementById('tiGiftAmount').value) || 0,
      relationDeductionLimit: numVal(document.getElementById('tiRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('tiAppraisalFee').value) || 0,
      filingStatus: document.getElementById('tiFilingStatus').value,
      isFraudulent: document.getElementById('tiFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('tiUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('tiUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('tiMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('tiUnpaidAtDesignated').value) || 0
    };
    renderTrustIncomeResult(calculateTrustIncomeGiftTaxJS(input));
  } else if (action === 'run-specific-corp-gift'){
    const input = {
      benefitToCorpAmount: numVal(document.getElementById('scBenefitToCorp').value) || 0,
      corporateTaxAfterCredit: numVal(document.getElementById('scCorpTax').value) || 0,
      corporateTaxableIncome: numVal(document.getElementById('scCorpIncome').value) || 0,
      shareholderOwnershipRatio: numVal(document.getElementById('scShareRatio').value) || 0,
      directGiftTaxEquivalent: numVal(document.getElementById('scDirectGiftTax').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('scPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('scRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('scAppraisalFee').value) || 0,
      filingStatus: document.getElementById('scFilingStatus').value,
      isFraudulent: document.getElementById('scFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('scUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('scUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('scMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('scUnpaidAtDesignated').value) || 0
    };
    renderSpecificCorpGiftResult(calculateSpecificCorporationGiftTaxJS(input));
  } else if (action === 'run-nontaxable-gift'){
    const input = {
      itemType: document.getElementById('ntItemType').value,
      amount: numVal(document.getElementById('ntAmount').value) || 0
    };
    renderNontaxableGiftResult(calculateNontaxableGiftPropertyJS(input));
  } else if (action === 'run-charity-donation-exclusion'){
    const input = {
      taxType: document.getElementById('cdTaxType').value,
      assetType: document.getElementById('cdAssetType').value,
      donatedAmount: numVal(document.getElementById('cdDonatedAmount').value) || 0,
      ratioType: document.getElementById('cdRatioType').value,
      totalIssuedShares: numVal(document.getElementById('cdTotalShares').value) || 0,
      donatedShares: numVal(document.getElementById('cdDonatedShares').value) || 0,
      priorRelatedShares: numVal(document.getElementById('cdPriorRelatedShares').value) || 0
    };
    renderCharityDonationExclusionResult(calculateCharityDonationTaxExclusionJS(input));
  } else if (action === 'run-public-interest-org-penalty'){
    const input = {
      penaltyType: document.getElementById('poPenaltyType').value,
      baseTaxAmount: numVal(document.getElementById('poBaseTaxAmount').value) || 0,
      excessStockValue: numVal(document.getElementById('poExcessStockValue').value) || 0,
      revenueAndDonationAmount: numVal(document.getElementById('poRevenueAndDonation').value) || 0,
      violationSubType: document.getElementById('poViolationSubType').value,
      relatedExpenseAmount: numVal(document.getElementById('poRelatedExpense').value) || 0,
      stockValue: numVal(document.getElementById('poStockValue').value) || 0,
      totalAssetValue: numVal(document.getElementById('poTotalAssetValue').value) || 0,
      meetsComplianceRequirements: document.getElementById('poMeetsCompliance').checked,
      directExpenseAmount: numVal(document.getElementById('poDirectExpense').value) || 0,
      underusedAmount: numVal(document.getElementById('poUnderusedAmount').value) || 0,
      liabilityValue: numVal(document.getElementById('poLiabilityValue').value) || 0,
      netIncomeValue: numVal(document.getElementById('poNetIncomeValue').value) || 0,
      actualDirectUseAmount: numVal(document.getElementById('poActualDirectUseAmount').value) || 0,
      useAssessedValueBasis: document.getElementById('poUseAssessedValueBasis').checked,
      isSect48_2_7HighHoldingType: document.getElementById('poHighHoldingType').checked,
      saleProceedsAmount: numVal(document.getElementById('poSaleProceedsAmount').value) || 0,
      saleCheckpointYear: Number(document.getElementById('poSaleCheckpointYear').value) || 0,
      cumulativeActualUsedAmount: numVal(document.getElementById('poCumulativeActualUsedAmount').value) || 0,
      operatingIncomeAmount: numVal(document.getElementById('poOperatingIncomeAmount').value) || 0,
      taxAndCarryforwardLossAmount: numVal(document.getElementById('poTaxAndCarryforwardLossAmount').value) || 0,
      actualOperatingIncomeUsedAmount: numVal(document.getElementById('poActualOperatingIncomeUsedAmount').value) || 0,
      unusedTransactionAmount: numVal(document.getElementById('poUnusedTransaction').value) || 0,
      directBusinessRevenueAmount: numVal(document.getElementById('poDirectBusinessRevenueAmount').value) || 0,
      unregisteredDays: numVal(document.getElementById('poUnregisteredDays').value) || 0,
      totalPeriodDays: numVal(document.getElementById('poTotalPeriodDays').value) || 0,
      totalRelevantTransactionAmount: numVal(document.getElementById('poTotalRelevantTransactionAmount').value) || 0,
      deferredTaxAmount: numVal(document.getElementById('poDeferredTaxAmount').value) || 0
    };
    renderPublicInterestOrgPenaltyResult(calculatePublicInterestOrgPenaltyJS(input));
  } else if (action === 'run-disabled-trust-exclusion'){
    const input = {
      meetsRequirements: document.getElementById('dtMeetsRequirements').checked,
      amount: numVal(document.getElementById('dtAmount').value) || 0,
      priorCumulativeAmount: numVal(document.getElementById('dtPriorCumulative').value) || 0,
      triggerEvent: document.getElementById('dtTriggerEvent').value,
      isExemptedReason: document.getElementById('dtExempted').checked
    };
    renderDisabledTrustExclusionResult(calculateDisabledPersonTrustExclusionJS(input));
  } else if (action === 'run-merger-gift'){
    const input = {
      postMergerValuePerShare: numVal(document.getElementById('mgPostValue').value) || 0,
      overvaluedPreMergerValuePerShare: numVal(document.getElementById('mgOvervaluedValue').value) || 0,
      overvaluedPreMergerShareCount: numVal(document.getElementById('mgOvervaluedShares').value) || 0,
      sharesReceivedByOvervaluedShareholders: numVal(document.getElementById('mgReceivedShares').value) || 0,
      largeShareholderSharesReceived: numVal(document.getElementById('mgLargeShareholderShares').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('mgPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('mgRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('mgAppraisalFee').value) || 0,
      filingStatus: document.getElementById('mgFilingStatus').value,
      isFraudulent: document.getElementById('mgFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('mgUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('mgUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('mgMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('mgUnpaidAtDesignated').value) || 0
    };
    renderMergerGiftResult(calculateMergerBenefitGiftTaxJS(input));
  } else if (action === 'run-property-use-gift'){
    const input = {
      useType: document.getElementById('puUseType').value,
      isCollateralLoan: document.getElementById('puCollateralLoan').checked,
      loanAmount: numVal(document.getElementById('puLoanAmount').value) || 0,
      actualInterestPaid: numVal(document.getElementById('puActualInterest').value) || 0,
      marketValueEquivalent: numVal(document.getElementById('puMarketValueEquiv').value) || 0,
      marketValue: numVal(document.getElementById('puMarketValue').value) || 0,
      considerationPaid: numVal(document.getElementById('puConsideration').value) || 0,
      priorBenefitsWithinOneYear: priorBenefitsArray_('puPriorBenefitsSum'),
      relationDeductionLimit: numVal(document.getElementById('puRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('puAppraisalFee').value) || 0,
      filingStatus: document.getElementById('puFilingStatus').value,
      isFraudulent: document.getElementById('puFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('puUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('puUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('puMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('puUnpaidAtDesignated').value) || 0
    };
    renderPropertyUseGiftResult(calculatePropertyUseServiceGiftTaxJS(input));
  } else if (action === 'run-org-change-gift'){
    const input = {
      subType: document.getElementById('ocSubType').value,
      beforeShares: numVal(document.getElementById('ocBeforeShares').value) || 0,
      afterShares: numVal(document.getElementById('ocAfterShares').value) || 0,
      afterValuePerShare: numVal(document.getElementById('ocAfterValuePerShare').value) || 0,
      beforePropertyValue: numVal(document.getElementById('ocBeforePropertyValue').value) || 0,
      beforeValue: numVal(document.getElementById('ocBeforeValue').value) || 0,
      afterValue: numVal(document.getElementById('ocAfterValue').value) || 0,
      relationDeductionLimit: numVal(document.getElementById('ocRelationDeduction').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('ocAppraisalFee').value) || 0,
      filingStatus: document.getElementById('ocFilingStatus').value,
      isFraudulent: document.getElementById('ocFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('ocUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('ocUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('ocMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('ocUnpaidAtDesignated').value) || 0
    };
    renderOrgChangeGiftResult(calculateOrgChangeGiftTaxJS(input));
  } else if (action === 'run-property-value-increase-gift'){
    const input = {
      propertyValueAtIncreaseEvent: numVal(document.getElementById('pvEventValue').value) || 0,
      acquisitionCost: numVal(document.getElementById('pvAcquisitionCost').value) || 0,
      normalAppreciationAmount: numVal(document.getElementById('pvNormalAppreciation').value) || 0,
      valueIncreaseContributionAmount: numVal(document.getElementById('pvContribution').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('pvAppraisalFee').value) || 0,
      filingStatus: document.getElementById('pvFilingStatus').value,
      isFraudulent: document.getElementById('pvFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('pvUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('pvUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('pvMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('pvUnpaidAtDesignated').value) || 0
    };
    renderPropertyValueIncreaseGiftResult(calculatePropertyValueIncreaseGiftTaxJS(input));
  } else if (action === 'run-related-party-gift'){
    const input = {
      companySize: document.getElementById('jmCompanySize').value,
      afterTaxOperatingIncome: numVal(document.getElementById('jmOperatingIncome').value) || 0,
      afterTaxNetIncome: numVal(document.getElementById('jmNetIncome').value) || 0,
      relatedPartyTransactionRatio: numVal(document.getElementById('jmTradeRatio').value) || 0,
      relatedPartySalesAmount: numVal(document.getElementById('jmRelatedPartySales').value) || 0,
      shareholderOwnershipRatio: numVal(document.getElementById('jmShareRatio').value) || 0,
      dividendDeduction: numVal(document.getElementById('jmDividendDeduction').value) || 0,
      filingStatus: document.getElementById('jmFilingStatus').value,
      isFraudulent: document.getElementById('jmFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('jmUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('jmUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('jmMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('jmUnpaidAtDesignated').value) || 0,
      reportedInTime: document.getElementById('jmReportedInTime').checked
    };
    renderRelatedPartyGiftResult(calculateRelatedPartyTransactionGiftTaxJS(input));
  } else if (action === 'run-business-opportunity-gift'){
    const input = {
      phase: document.getElementById('jtPhase').value,
      profitFromOpportunity: numVal(document.getElementById('jtProfit').value) || 0,
      shareholderOwnershipRatio: numVal(document.getElementById('jtShareRatio').value) || 0,
      corporateTaxPortion: numVal(document.getElementById('jtCorporateTax').value) || 0,
      corporateTaxAfterCredit: numVal(document.getElementById('jtCorpTaxAfterCredit').value) || 0,
      corporateTaxableIncome: numVal(document.getElementById('jtCorpTaxableIncome').value) || 0,
      monthsInInitialYear: numVal(document.getElementById('jtMonths').value) || 0,
      dividendDeduction: numVal(document.getElementById('jtDividendDeduction').value) || 0,
      filingStatus: document.getElementById('jtFilingStatus').value,
      isFraudulent: document.getElementById('jtFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('jtUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('jtUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('jtMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('jtUnpaidAtDesignated').value) || 0,
      reportedInTime: document.getElementById('jtReportedInTime').checked
    };
    renderBusinessOpportunityGiftResult(calculateBusinessOpportunityGiftTaxJS(input));
  } else if (action === 'run-installment-gift'){
    const input = {
      taxType: document.getElementById('ipGiftTaxType').value,
      totalTaxAmount: numVal(document.getElementById('ipGiftTotal').value) || 0,
      initialPaymentAmount: numVal(document.getElementById('ipGiftInitial').value) || 0,
      installmentPeriodYears: numVal(document.getElementById('ipGiftYears').value) || 0,
      annualInterestRatePercent: numVal(document.getElementById('ipGiftRate').value)
    };
    renderInstallmentResult(calculateInstallmentPaymentScheduleJS(input), 'taxCalcInstallmentGiftResult');
  } else if (action === 'run-clawback-interest'){
    const input = {
      clawedBackTaxAmount: numVal(document.getElementById('ckAmount').value) || 0,
      startDate: document.getElementById('ckStartDate').value,
      endDate: document.getElementById('ckEndDate').value
    };
    renderClawbackResult(calculateClawbackInterestJS(input));
  } else if (action === 'run-business-succession-deferral-amount'){
    const input = {
      provision: document.getElementById('bdProvision').value,
      taxPayable: numVal(document.getElementById('bdTaxPayable').value) || 0,
      businessSuccessionPropertyValue: numVal(document.getElementById('bdBusinessValue').value) || 0,
      totalPropertyValue: numVal(document.getElementById('bdTotalValue').value) || 0
    };
    renderBusinessSuccessionDeferralAmountResult(calculateBusinessSuccessionDeferralAmountJS(input));
  } else if (action === 'run-business-succession-deferral-clawback'){
    const input = {
      provision: document.getElementById('bcProvision').value,
      deferredTaxAmount: numVal(document.getElementById('bcDeferredTax').value) || 0,
      triggerEvent: document.getElementById('bcTriggerEvent').value,
      disposalRatio: numVal(document.getElementById('bcDisposalRatio').value) || 0,
      yearsSinceBase: numVal(document.getElementById('bcYearsSinceBase').value) || 0,
      equityDecreaseRatio: numVal(document.getElementById('bcEquityDecreaseRatio').value) || 0,
      equityRatioAtBase: numVal(document.getElementById('bcEquityRatioAtBase').value) || 0,
      currentEquityRatio: numVal(document.getElementById('bcCurrentEquityRatio').value) || 0
    };
    renderBusinessSuccessionDeferralClawbackResult(calculateBusinessSuccessionDeferralClawbackJS(input));
  } else if (action === 'run-property-in-kind-payment-eligibility'){
    const input = {
      provision: document.getElementById('ikProvision').value,
      inheritanceTaxPayable: numVal(document.getElementById('ikTaxPayable').value) || 0,
      financialAssetValue: numVal(document.getElementById('ikFinancialAsset').value) || 0,
      realEstateSecuritiesValue: numVal(document.getElementById('ikRealEstateSecurities').value) || 0,
      totalInheritanceValue: numVal(document.getElementById('ikTotalValue').value) || 0,
      culturalHeritageValue: numVal(document.getElementById('ikCulturalValue').value) || 0,
      excludedDamagedCulturalHeritageValue: numVal(document.getElementById('ikExcludedDamagedValue').value) || 0
    };
    renderPropertyInKindPaymentResult(calculatePropertyInKindPaymentEligibilityJS(input));
  } else if (action === 'run-property-in-kind-stock-receipt-value'){
    const input = {
      changeType: document.getElementById('svChangeType').value,
      oldSharePreChangeValue: numVal(document.getElementById('svOldValue').value) || 0,
      newSharesPerOldShare: numVal(document.getElementById('svNewSharesPerOld').value) || 0,
      paymentPerNewShare: numVal(document.getElementById('svPaymentPerNewShare').value) || 0,
      decreasedSharesPerOldShare: numVal(document.getElementById('svDecreasedSharesPerOld').value) || 0,
      paymentPerDecreasedShare: numVal(document.getElementById('svPaymentPerDecreasedShare').value) || 0
    };
    renderPropertyInKindStockReceiptResult(calculatePropertyInKindStockReceiptValueJS(input));
  } else if (action === 'run-cultural-heritage-tax-deferral'){
    const input = {
      taxType: document.getElementById('chTaxType').value,
      itemType: document.getElementById('chItemType').value,
      totalTaxPayable: numVal(document.getElementById('chTotalTax').value) || 0,
      totalPropertyValue: numVal(document.getElementById('chTotalProperty').value) || 0,
      eligiblePropertyValue: numVal(document.getElementById('chEligibleProperty').value) || 0,
      triggerEvent: document.getElementById('chTriggerEvent').value
    };
    renderCulturalHeritageTaxDeferralResult(calculateCulturalHeritageTaxDeferralJS(input));
  } else if (action === 'run-low-price-transfer'){
    const input = {
      fairMarketValue: numVal(document.getElementById('lpFairValue').value) || 0,
      transferPrice: numVal(document.getElementById('lpTransferPrice').value) || 0,
      isSpecialRelation: document.getElementById('lpIsSpecialRelation').value !== 'false',
      priorBenefitsWithinOneYear: priorBenefitsArray_('lpPriorBenefitsSum')
    };
    renderLowPriceResult(calculateLowPriceTransferGiftAmountJS(input));
  } else if (action === 'run-interest-free-loan'){
    const input = {
      loanPrincipal: numVal(document.getElementById('loanPrincipal').value) || 0,
      actualInterestPaid: numVal(document.getElementById('loanActualInterest').value) || 0,
      appropriateInterestRatePercent: document.getElementById('loanRate').value === '' ? null : numVal(document.getElementById('loanRate').value),
      loanMonths: document.getElementById('loanMonths').value === '' ? null : numVal(document.getElementById('loanMonths').value),
      priorBenefitsWithinOneYear: priorBenefitsArray_('loanPriorBenefitsSum')
    };
    renderLoanGiftResult(calculateInterestFreeLoanGiftAmountJS(input));
  } else if (action === 'run-gift-special-provision-overlap'){
    const candidates = [];
    for (let i = 1; i <= 4; i++) {
      const amountEl = document.getElementById('gspAmount' + i);
      const amountVal = amountEl.value;
      if (amountVal === '') continue;
      const articleEl = document.getElementById('gspArticle' + i);
      candidates.push({ article: articleEl.value || ('후보' + i), giftAmount: numVal(amountVal) || 0 });
    }
    renderGiftOverlapResult(calculateGiftSpecialProvisionOverlapJS({ candidates: candidates }));
  } else if (action === 'run-fair-market-value-recognition'){
    const input = {
      taxType: document.getElementById('fmvTaxType').value,
      valuationBaseDate: document.getElementById('fmvBaseDate').value,
      evidenceType: document.getElementById('fmvEvidenceType').value,
      evidenceDate: document.getElementById('fmvEvidenceDate').value,
      isRelatedPartyTransaction: document.getElementById('fmvRelatedParty').checked,
      isUnlistedStock: document.getElementById('fmvUnlistedStock').checked,
      tradedStockFaceValueSum: numVal(document.getElementById('fmvTradedFaceValue').value) || 0,
      totalIssuedStockFaceValue: numVal(document.getElementById('fmvTotalFaceValue').value) || 0,
      appraisalValueAverage: numVal(document.getElementById('fmvAppraisalAvg').value) || 0,
      supplementaryValue: numVal(document.getElementById('fmvSupplementaryValue').value) || 0,
      similarAssetMarketValue90pct: document.getElementById('fmvSimilar90').value === '' ? null : numVal(document.getElementById('fmvSimilar90').value)
    };
    renderFmvRecognitionResult(checkFairMarketValueRecognitionJS(input));
  } else if (action === 'run-installment-inheritance'){
    const input = {
      taxType: document.getElementById('ipIhTaxType').value,
      totalTaxAmount: numVal(document.getElementById('ipIhTotal').value) || 0,
      initialPaymentAmount: numVal(document.getElementById('ipIhInitial').value) || 0,
      installmentPeriodYears: numVal(document.getElementById('ipIhYears').value) || 0,
      annualInterestRatePercent: numVal(document.getElementById('ipIhRate').value)
    };
    renderInstallmentResult(calculateInstallmentPaymentScheduleJS(input), 'taxCalcInstallmentInheritanceResult');
  } else if (action === 'run-deemed-inheritance'){
    const input = {
      itemType: document.getElementById('diItemType').value,
      amount: numVal(document.getElementById('diAmount').value) || 0,
      wasPolicyholderDecedent: document.getElementById('diPolicyholderDecedent').checked,
      premiumPaidByDecedentRatio: numVal(document.getElementById('diPremiumRatio').value) || 0,
      isAlreadyGiftTaxedUnder33_1: document.getElementById('diAlreadyGiftTaxed').checked,
      isExcludedSurvivorPension: document.getElementById('diExcludedPension').checked
    };
    renderDeemedInheritanceResult(calculateDeemedInheritancePropertyJS(input));
  } else if (action === 'run-inheritance'){
    const disposalPresumptionItems = inheritanceDisposalItems.map(function(item){
      return {
        category: item.category || '',
        oneYearAmount: numVal(item.oneYearAmount) || 0,
        oneYearSelfDeposit: numVal(item.oneYearSelfDeposit) || 0,
        oneYearExplained: numVal(item.oneYearExplained) || 0,
        twoYearAmount: numVal(item.twoYearAmount) || 0,
        twoYearSelfDeposit: numVal(item.twoYearSelfDeposit) || 0,
        twoYearExplained: numVal(item.twoYearExplained) || 0
      };
    }).filter(function(item){ return item.oneYearAmount > 0 || item.twoYearAmount > 0; });
    const input = {
      taxableEstateAmount: numVal(document.getElementById('ihEstate').value) || 0,
      nonTaxableAmount: numVal(document.getElementById('ihNonTaxable').value) || 0,
      publicInterestOrgAmount: numVal(document.getElementById('ihPublicOrg').value) || 0,
      publicTrustAmount: numVal(document.getElementById('ihPublicTrust').value) || 0,
      totalGrossEstateValue: numVal(document.getElementById('ihTotalGrossEstate').value) || 0,
      disposalPresumptionItems: disposalPresumptionItems,
      isDecedentResident: document.getElementById('ihDecedentResident').value !== 'nonresident',
      hasSpouse: taxCalcHeirRegistryHasSpouse,
      spouseActualInheritedAmount: numVal(document.getElementById('ihSpouseActual').value) || 0,
      isSpousePropertyDivided: document.getElementById('ihSpouseDivided').checked,
      spouseLegalShareRatio: numVal(document.getElementById('ihSpouseRatio').value) || 0,
      nonHeirBequestAmount: numVal(document.getElementById('ihNonHeirBequest').value) || 0,
      giftToHeirsWithin10Years: numVal(document.getElementById('ihGiftToHeirs').value) || 0,
      priorGiftedAmountIncludedInEstate: numVal(document.getElementById('ihPriorGiftedIncluded').value) || 0,
      spouseTaxableBaseOfPriorGift: numVal(document.getElementById('ihSpouseGiftBase').value) || 0,
      childCount: numVal(document.getElementById('ihChildCount').value) || 0,
      minorHeirRemainingYears: numVal(document.getElementById('ihMinorYears').value) || 0,
      elderlyHeirCount: numVal(document.getElementById('ihElderlyCount').value) || 0,
      disabledHeirRemainingYears: numVal(document.getElementById('ihDisabledYears').value) || 0,
      netFinancialAssets: numVal(document.getElementById('ihNetFinancial').value) || 0,
      hasCohabitingHouseDeduction: taxCalcHeirRegistryHasCohabit,
      tenYearCohabitationRequirementMet: document.getElementById('ihCohabitReq1').checked,
      tenYearOneHouseholdRequirementMet: document.getElementById('ihCohabitReq2').checked,
      noHouseOrJointHeirRequirementMet: document.getElementById('ihCohabitReq3').checked,
      cohabitingHouseValue: numVal(document.getElementById('ihCohabitValue').value) || 0,
      appraisalFeeAmount: numVal(document.getElementById('ihAppraisalFee').value) || 0,
      disasterLossAmount: numVal(document.getElementById('ihDisasterLoss').value) || 0,
      funeralCostAmount: computeFuneralTotals_(inheritanceFuneralItems).general,
      funeralNicheCostAmount: computeFuneralTotals_(inheritanceFuneralItems).niche,
      businessInheritanceDeduction: numVal(document.getElementById('ihBusinessDeduction').value) || 0,
      businessOwnershipYears: numVal(document.getElementById('ihBusinessYears').value) || 0,
      businessInheritanceIndividualNetAssetValue: numVal(document.getElementById('ihBusinessIndividualNet').value) || 0,
      businessInheritanceStockValue: numVal(document.getElementById('ihBusinessStockValue').value) || 0,
      businessInheritanceTotalAssetValue: numVal(document.getElementById('ihBusinessTotalAsset').value) || 0,
      businessInheritanceNonBizAsset55: numVal(document.getElementById('ihBusinessNonBiz55').value) || 0,
      businessInheritanceNonBizAsset49: numVal(document.getElementById('ihBusinessNonBiz49').value) || 0,
      businessInheritanceNonBizAsset61: numVal(document.getElementById('ihBusinessNonBiz61').value) || 0,
      businessInheritanceExcessCash: numVal(document.getElementById('ihBusinessExcessCash').value) || 0,
      businessInheritanceNonBizStock: numVal(document.getElementById('ihBusinessNonBizStock').value) || 0,
      decedentOwnershipRequirementMet: document.getElementById('ihBizReqOwnership').checked,
      decedentCeoTenureRequirementMet: document.getElementById('ihBizReqCeoTenure').checked,
      heirAge18OrOlder: document.getElementById('ihBizReqAge18').checked,
      heirEngagedInBusiness2YearsOrExempt: document.getElementById('ihBizReqEngaged').checked,
      heirBecameOfficerByFilingDeadline: document.getElementById('ihBizReqOfficer').checked,
      heirBecameCeoWithin2Years: document.getElementById('ihBizReqCeo2yr').checked,
      isMediumSizedBusiness: document.getElementById('ihBusinessMediumSized').checked,
      businessHeirNonBusinessAssetValue: numVal(document.getElementById('ihBusinessHeirNonBizAsset').value) || 0,
      businessHeirTaxWithoutDeduction: numVal(document.getElementById('ihBusinessHeirTaxWithoutDeduction').value) || 0,
      farmingInheritanceDeduction: numVal(document.getElementById('ihFarmingDeduction').value) || 0,
      farmingIndividualAssetValue: numVal(document.getElementById('ihFarmingIndividualAsset').value) || 0,
      farmingStockValue: numVal(document.getElementById('ihFarmingStockValue').value) || 0,
      farmingTotalAssetValue: numVal(document.getElementById('ihFarmingTotalAsset').value) || 0,
      farmingNonBizAsset55: numVal(document.getElementById('ihFarmingNonBiz55').value) || 0,
      farmingNonBizAsset49: numVal(document.getElementById('ihFarmingNonBiz49').value) || 0,
      farmingNonBizAsset61: numVal(document.getElementById('ihFarmingNonBiz61').value) || 0,
      farmingExcessCash: numVal(document.getElementById('ihFarmingExcessCash').value) || 0,
      farmingNonBizStock: numVal(document.getElementById('ihFarmingNonBizStock').value) || 0,
      decedentFarmingRequirementMet: document.getElementById('ihFarmReqDecedent').checked,
      heirFarmingRequirementMet: document.getElementById('ihFarmReqHeir').checked,
      priorGiftHeirs: inheritanceHeirs.map(function(h, idx){
        return {
          name: h.name || '',
          actualInheritedValue: computeHeirActualValue_(idx),
          priorGiftAmount: h.hasPriorGift ? (numVal(h.priorGiftAmount) || 0) : 0,
          priorGiftTaxableBase: h.hasPriorGift ? (numVal(h.priorGiftTaxableBase) || 0) : 0,
          priorGiftTaxPaid: h.hasPriorGift ? (numVal(h.priorGiftTaxPaid) || 0) : 0
        };
      }),
      disclaimedShareRedistributedAmount: numVal(document.getElementById('ihDisclaimedRedistributed').value) || 0,
      generationSkipHeirRatio: numVal(document.getElementById('ihGenSkipRatio').value) || 0,
      generationSkipOver2Billion: document.getElementById('ihGenSkipOver2B').checked,
      generationSkipMinorHeir: document.getElementById('ihGenSkipMinorHeir').checked,
      foreignTaxPaidAmount: numVal(document.getElementById('ihForeignTax').value) || 0,
      priorInheritanceTax: numVal(document.getElementById('ihPriorInheritanceTax').value) || 0,
      reinheritedPropertyValue: numVal(document.getElementById('ihReinheritedPropertyValue').value) || 0,
      priorInheritanceTotalPropertyValue: numVal(document.getElementById('ihPriorInheritanceTotalPropertyValue').value) || 0,
      priorInheritanceTaxableBase: numVal(document.getElementById('ihPriorInheritanceTaxableBase').value) || 0,
      yearsSincePriorInheritance: numVal(document.getElementById('ihYearsSincePrior').value) || 0,
      specialGiftTaxCredit: numVal(document.getElementById('ihSpecialGiftCredit').value) || 0,
      otherCreditsAmount: numVal(document.getElementById('ihOtherCredits').value) || 0,
      interestAmount: numVal(document.getElementById('ihInterest').value) || 0,
      forProfitBequestAmount: numVal(document.getElementById('ihForProfitBequest').value) || 0,
      forProfitExemptedTaxAmount: numVal(document.getElementById('ihForProfitExempted').value) || 0,
      forProfitHeirShareRatio: numVal(document.getElementById('ihForProfitRatio').value) || 0,
      culturalPropertyDeferredTaxAmount: numVal(document.getElementById('ihCulturalDeferred').value) || 0,
      businessInheritanceDeferredTaxAmount: numVal(document.getElementById('ihBizInheritDeferred').value) || 0,
      reporterName: document.getElementById('ihReporterName').value,
      reporterRegNo: document.getElementById('ihReporterRegNo').value,
      reporterRelationToDeceased: document.getElementById('ihReporterRelation').value,
      deceasedName: document.getElementById('ihDeceasedName').value,
      deceasedRegNo: document.getElementById('ihDeceasedRegNo').value,
      dateOfDeath: document.getElementById('ihDeathDate').value,
      filingStatus: document.getElementById('ihFilingStatus').value,
      isFraudulent: document.getElementById('ihFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('ihUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('ihUnpaidDays').value) || 0,
      monthsAfterDesignatedDueDate: numVal(document.getElementById('ihMonthsAfterDesignated').value) || 0,
      unpaidTaxAtDesignatedDueDate: numVal(document.getElementById('ihUnpaidAtDesignated').value) || 0,
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
  } else if (action === 'add-disposal-item'){
    inheritanceDisposalItems.push({});
    renderDisposalItemsList();
  } else if (action === 'del-disposal-item'){
    inheritanceDisposalItems.splice(numVal(btn.dataset.idx), 1);
    renderDisposalItemsList();
  } else if (action === 'add-funeral-item'){
    inheritanceFuneralItems.push({});
    renderFuneralItemsList();
  } else if (action === 'del-funeral-item'){
    inheritanceFuneralItems.splice(numVal(btn.dataset.idx), 1);
    renderFuneralItemsList();
  } else if (action === 'add-heir-row'){
    inheritanceHeirs.push({});
    renderHeirRegistry();
    renderHeirTool();
    renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
  } else if (action === 'del-heir-row'){
    const deletedIdx = numVal(btn.dataset.idx);
    inheritanceHeirs.splice(deletedIdx, 1);
    // 상속인 행이 삭제되면 뒤 상속인들의 인덱스가 한 칸씩 당겨지므로, 자산별 "상속인별 배분"에
    // 저장된 heirIdx도 같이 보정한다(삭제된 인덱스를 가리키던 배분은 제거).
    inheritanceValuationAssets.forEach(function(a){
      if (!Array.isArray(a.heirAllocations)) return;
      a.heirAllocations = a.heirAllocations.filter(function(al){ return String(al.heirIdx) !== String(deletedIdx); }).map(function(al){
        const hi = Number(al.heirIdx);
        if (!isNaN(hi) && hi > deletedIdx) al.heirIdx = String(hi - 1);
        return al;
      });
    });
    renderHeirRegistry();
    renderHeirTool();
    renderValuationAssetList('inheritanceValuationList', inheritanceValuationAssets);
  } else if (action === 'run-heir-allocation'){
    const heirs = inheritanceHeirs.map(function(h, idx){
      return { name: h.name, relation: h.relation, actualInheritedValue: computeHeirActualValue_(idx) };
    });
    const result = allocateInheritanceTaxByHeirJS(lastInheritanceResult, heirs);
    renderHeirResult(result);
  }
});
