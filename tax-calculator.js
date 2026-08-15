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
function recomputeSrGiftUnpaidDays(){
  const giftDate = document.getElementById('srGiftDate');
  const paidDate = document.getElementById('srPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(giftDate ? giftDate.value : '', 3);
  setUnpaidDaysField_('srUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
}
function recomputeJmUnpaidDays(){
  const fiscalYearEnd = document.getElementById('jmFiscalYearEnd');
  const paidDate = document.getElementById('jmPaidDate');
  const deadline = taxCalcDeadlineFromMonthEnd_(fiscalYearEnd ? fiscalYearEnd.value : '', 3);
  setUnpaidDaysField_('jmUnpaidDays', taxCalcDaysLate_(deadline, paidDate ? paidDate.value : ''));
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
  let minorYears = 0, elderlyCount = 0;
  heirs.forEach(function(h){
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

// 사후관리위반 추징 이자상당액 계산은 이자율이 2022.2.14. 개정으로 바뀌어서 그 날을 기준으로
// 일수를 나눠 계산해야 한다. 일수를 손으로 두 칸에 나눠 입력하게 하는 대신, 이자 기산일과
// 추징사유 발생일(원천 데이터)만 입력받아 자동으로 그 경계일 기준으로 일수를 갈라준다.
function computeClawbackDaySplit_(startDateStr, endDateStr){
  if (!startDateStr || !endDateStr) return { before: 0, after: 0 };
  const start = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  const cutoff = new Date(2022, 1, 14);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return { before: 0, after: 0 };
  const total = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (start >= cutoff) return { before: 0, after: total };
  if (end <= cutoff) return { before: total, after: 0 };
  const before = Math.round((cutoff.getTime() - start.getTime()) / 86400000);
  return { before: before, after: total - before };
}
function recomputeClawbackDaySplit(){
  const startEl = document.getElementById('ckStartDate');
  const endEl = document.getElementById('ckEndDate');
  const split = computeClawbackDaySplit_(startEl ? startEl.value : '', endEl ? endEl.value : '');
  setUnpaidDaysField_('ckDaysBefore', split.before);
  setUnpaidDaysField_('ckDaysAfter', split.after);
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
  return '' +
    '<div class="taxcalc-field"><label>유형</label><select data-field="assetKind">' +
      '<option value="land"' + (kind === 'land' ? ' selected' : '') + '>토지</option>' +
      '<option value="building"' + (kind === 'building' ? ' selected' : '') + '>건물(구분소유 건물·아파트 등 대지권 포함분도 건물면적만 입력)</option>' +
      '<option value="other"' + (kind === 'other' ? ' selected' : '') + '>기타</option>' +
    '</select></div>' +
    '<div class="taxcalc-field"><label>소재지</label><input type="text" data-field="assetLocation" value="' + (a.assetLocation || '').replace(/"/g, '&quot;') + '" placeholder="예: OO시 OO구 OO동 123-4"></div>' +
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
  if (st === 'loading') return '<span class="taxcalc-badge info">📄 증빙 읽는 중…</span>';
  if (st === 'error') return '<span class="taxcalc-badge danger">자동입력 실패</span><div class="taxcalc-ai-fields">' + (vals._aiError || '') + '</div>';
  if (st === 'done') return '<span class="taxcalc-badge warning">자동입력됨 · 확인 필요</span>' +
    (vals._aiFilledFields && vals._aiFilledFields.length ? '<div class="taxcalc-ai-fields">채운 항목: ' + vals._aiFilledFields.join(', ') + (vals._aiFileName ? ' (출처: ' + vals._aiFileName + ')' : '') + '</div>' : '');
  return '';
}

// 양도소득세 거래 1건을 증빙 파일 하나로 채운다(파일럿 — 다른 세목은 추후 확장).
const TRANSFER_AI_FIELD_LABELS = {
  transferPrice: '양도가액', acquisitionPrice: '취득가액', acquisitionExpenses: '취득 관련 비용', transferExpensesOnly: '양도비용',
  acquisitionDate: '취득일', transferDate: '양도일', assetType: '자산종류',
  assetKind: '유형', assetLocation: '소재지', assetSubType: '지목/층수·용도', assetArea: '면적'
};
async function runAiAutoFillTransfer(fileName, idx){
  const vals = transferAssets[idx];
  vals._aiStatus = 'loading';
  document.getElementById('aiStatus-' + idx).innerHTML = renderAiStatusHtml(vals);

  const instruction = '현재 사건 폴더에서 "' + fileName + '" 파일을 읽어줘. 그 안에서 양도소득세 계산에 필요한 값을 찾아서, ' +
    '다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n{"transferPrice": 숫자 또는 null, "acquisitionPrice": 숫자 또는 null, "acquisitionExpenses": 숫자 또는 null, "transferExpensesOnly": 숫자 또는 null, ' +
    '"acquisitionDate": "YYYY-MM-DD 또는 null", "transferDate": "YYYY-MM-DD 또는 null", "assetType": "house 또는 other 또는 null", ' +
    '"assetKind": "land 또는 building 또는 other 또는 null", "assetLocation": "문자열 또는 null(소재지·지번)", ' +
    '"assetSubType": "문자열 또는 null(토지면 지목, 건물이면 층수·용도)", "assetArea": "숫자 또는 null(면적, ㎡)"}\n```\n' +
    '(transferPrice=양도가액, acquisitionPrice=취득가액, acquisitionExpenses=취득세·법무사비 등 취득 관련 비용, transferExpensesOnly=중개보수·양도세 신고수수료 등 양도비용, assetType은 주택·조합원입주권이면 house, 그 외 부동산이면 other, assetKind는 토지만이면 land·구분소유 건물 포함 건물이면 building)';

  try {
    const reply = await runFolderAiExtraction(instruction);
    const json = extractJsonFromReply(reply);
    if (!json) throw new Error('응답에서 값을 찾지 못했습니다. 응답: ' + reply.slice(0, 200));
    const filled = [];
    ['transferPrice','acquisitionPrice','acquisitionExpenses','transferExpensesOnly','acquisitionDate','transferDate','assetType','assetKind','assetLocation','assetSubType','assetArea'].forEach(function(key){
      if (json[key] !== null && json[key] !== undefined && json[key] !== '') {
        if (key === 'acquisitionExpenses') vals.acquisitionExpenseItems = [{ label: '증빙 자동입력', amount: json[key] }];
        else if (key === 'transferExpensesOnly') vals.transferExpenseItems = [{ label: '증빙 자동입력', amount: json[key] }];
        else vals[key] = json[key];
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
  deceasedName: { id: 'ihDeceasedName', type: 'text' }, deceasedRegNo: { id: 'ihDeceasedRegNo', type: 'text' }, deathDate: { id: 'ihDeathDate', type: 'date' }
};
const INHERITANCE_AI_FIELD_LABELS = {
  deceasedName: '피상속인 성명', deceasedRegNo: '피상속인 주민등록번호', deathDate: '상속개시일'
};
// 자녀 수·배우자 유무·신고인 등은 이제 상속인 명부에서 자동으로 유도하므로(recomputeHeirDerivedFields),
// AI자동입력은 피상속인 정보만 채운다 — 상속인 명부 자체는 사건 폴더의 가족관계증명서를 보고 직접 입력한다.
function runAiAutoFillInheritance(fileName){
  const instruction = '현재 사건 폴더에서 "' + fileName + '" 파일을 읽어줘. 상속세 신고에 필요한 피상속인 정보를 찾아서, ' +
    '다른 설명 없이 아래 스키마의 JSON 코드블록 하나만 답해줘. 모르거나 문서에 없는 값은 null로 남겨줘.\n' +
    '```json\n{"deceasedName": "문자열 또는 null(피상속인)", "deceasedRegNo": "문자열 또는 null", "deathDate": "YYYY-MM-DD 또는 null(상속개시일=사망일)"}\n```';
  return runAiAutoFillForm(fileName, 'aiStatus-inheritance', instruction, INHERITANCE_AI_FIELD_MAP, INHERITANCE_AI_FIELD_LABELS);
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
  goodwill: '영업권(§64, 초과이익의 5년 현재가치)'
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
    case 'listedStock': value = calculateListedStockValueJS(a.listedPrice, a.listedShares); break;
    case 'rental': {
      const t = computeRentalLeaseTotals_(a.rentalLeases);
      value = calculateRentalConversionValueJS(t.annualRent, t.deposit);
      break;
    }
    case 'goodwill': value = calculateGoodwillValueJS(a.gwProfit1, a.gwProfit2, a.gwProfit3, a.gwSelfCapital); break;
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
  if (VALUATION_RATIO_EXEMPT_METHODS.indexOf(a.method) === -1){
    const parsed = parseShareFraction_(a.ownershipRatio);
    const ratio = parsed === null ? 1 : parsed;
    value = value * ratio;
  }
  // 저당권·질권 등이 설정된 재산 및 임대차계약이 체결된 재산의 평가특례(상증세법 §66, 시행령 §63①1호) —
  // 시가·보충적평가액, 그 재산이 담보하는 채권액(또는 등기된 전세금), 임대보증금 환산가액(임대보증금+연간임대료÷12%)
  // 중 가장 큰 금액으로 평가한다. 세 가지는 서로 다른 근거이므로 해당되는 값만 입력하면 자동으로 셋 중 최댓값을 쓴다.
  const securedDebtAmount = numVal(a.securedDebtAmount) || 0;
  const leaseTotals = computeRentalLeaseTotals_(a.rentalLeases);
  const rentalCapValue = (leaseTotals.deposit > 0 || leaseTotals.annualRent > 0) ? calculateRentalConversionValueJS(leaseTotals.annualRent, leaseTotals.deposit) : 0;
  return Math.max(value, securedDebtAmount, rentalCapValue);
}

function valuationAssetMethodFieldsHtml(m, a){
  if (m === 'land') return '' +
    '<div class="taxcalc-field"><label>개별공시지가(원/㎡)</label><input type="number" data-field="landPrice" value="' + (a.landPrice || '') + '"></div>' +
    '<div class="taxcalc-field"><label>면적(㎡)</label><input type="number" data-field="landArea" value="' + (a.landArea || '') + '"></div>';
  if (m === 'house' || m === 'apartment' || m === 'officetel') return '' +
    '<div class="taxcalc-field"><label>고시된 ' + (m === 'apartment' ? '공동주택가격' : m === 'officetel' ? '오피스텔·상업용건물 기준시가' : '개별주택가격') + '</label><input type="number" data-field="housePrice" value="' + (a.housePrice || '') + '"></div>';
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
    '<div class="taxcalc-field"><label>주식수</label><input type="number" data-field="listedShares" value="' + (a.listedShares || '') + '"></div>';
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
  return '<div class="taxcalc-field"><label>평가액</label><input type="number" data-field="directValue" value="' + (a.directValue || '') + '"></div>';
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
      '<div class="taxcalc-field"><label>주민번호</label><input type="text" data-lfield="tenantBizNo" value="' + (l.tenantBizNo || '').replace(/"/g,'&quot;') + '" placeholder="사업자 123-45-67890 / 개인 000000-0000000"></div>' +
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
      if (key === 'method' || key === 'assetKind'){
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
            '<button type="button" class="taxcalc-ai-btn" data-action="open-evidence-transfer" data-idx="' + idx + '">📄 증빙에서 자동 입력</button>' +
            '<button type="button" class="taxcalc-calcbasis-btn" data-action="show-calc-basis" data-idx="' + idx + '">🧮 계산근거</button>' +
            (transferAssets.length > 1 ? '<button type="button" class="taxcalc-del-asset" data-action="del-asset" data-idx="' + idx + '">✕ 삭제</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="taxcalc-ai-status" id="aiStatus-' + idx + '">' + renderAiStatusHtml(transferAssets[idx]) + '</div>' +
        '<div class="taxcalc-calcbasis" id="calcBasis-' + idx + '" style="display:none;"></div>' +
        '<div class="taxcalc-grid">' +
          '<div class="taxcalc-field"><label>자산종류</label><select data-field="assetType"><option value="other">그 외 부동산</option><option value="house">주택·조합원입주권</option></select></div>' +
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
          '<div class="taxcalc-field"><label>취득가액</label><input type="number" data-field="acquisitionPrice" placeholder="원 (환산취득가액을 쓰면 자동계산되어 무시됩니다)"></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="useConvertedAcquisitionPrice" id="convAcq-' + idx + '"><label for="convAcq-' + idx + '">취득당시 실지거래가액을 확인할 수 없어 환산취득가액 사용</label></div>' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="useEstimatedNecessaryExpense" id="estExp-' + idx + '"><label for="estExp-' + idx + '">취득가액은 알지만 필요경비 지출증빙이 없어 개산공제(3%)만 사용(위 비용 내역을 입력하지 않았을 때만 적용)</label></div>' +
          '<div class="taxcalc-field"><label>취득당시 기준시가</label><input type="number" data-field="acquisitionStandardPriceForExpense" placeholder="원 (환산취득가액·개산공제 계산용)"></div>' +
          '<div class="taxcalc-field"><label>양도당시 기준시가</label><input type="number" data-field="transferStandardPriceForConversion" placeholder="원 (환산취득가액 비율 계산용)"></div>' +
          (transferAssets[idx].acquisitionDate && transferAssets[idx].acquisitionDate < '1990-08-31' ?
            '<div class="taxcalc-field"><span class="taxcalc-result-note">⚠ 1990.8.31. 이전 취득분은 개별공시지가가 없어 국세청 고시 배율표에 따른 별도 환산방법이 적용될 수 있습니다 — 이 계산기는 그 배율표를 반영하지 않으니 취득당시 기준시가를 직접 확인해서 입력하세요.</span></div>' : '') +
        '</div>' +
        renderCostItemsSectionHtml_(transferAssets[idx], 'transferExpenseItems', '양도비용 내역', '예: 중개보수') +
        renderCostItemsSectionHtml_(transferAssets[idx], 'acquisitionExpenseItems', '취득비용 내역', '예: 취득세') +
        '<div class="taxcalc-asset-head" style="margin-top:10px;"><b>관리처분인가 이후 조합원입주권·신축주택으로 양도했다면(재건축·재개발 특례)</b></div>' +
        '<div class="taxcalc-grid">' +
          '<div class="taxcalc-field checkbox"><input type="checkbox" data-field="isReconstructionRights" id="rr-' + idx + '"><label for="rr-' + idx + '">해당(위 취득일은 종전 부동산 취득일 그대로 유지)</label></div>' +
          '<div class="taxcalc-field"><label>관리처분계획인가일</label><input type="date" data-field="managementDispositionDate" min="1900-01-01" max="2099-12-31"></div>' +
          '<div class="taxcalc-field"><label>종전자산 취득가액</label><input type="number" data-field="originalAssetAcquisitionPrice" placeholder="원 (환지·재건축 전 원 취득가액)"></div>' +
          '<div class="taxcalc-field"><label>권리가액(종전자산평가액)</label><input type="number" data-field="rightsValue" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>청산금 납부액(분담금, 없으면 0)</label><input type="number" data-field="settlementPaid" placeholder="원"></div>' +
          '<div class="taxcalc-field"><label>청산금 환급액(받은 돈, 없으면 0)</label><input type="number" data-field="settlementReceived" placeholder="원"></div>' +
          (transferAssets[idx].isReconstructionRights ?
            '<div class="taxcalc-field"><span class="taxcalc-result-note">취득가액 = 권리가액 + 청산금납부액으로 자동 대체됩니다. 청산금 환급액이 있으면 그 부분은 관리처분인가일에 별도로 양도한 것으로 과세되니(소득세법 기본통칙 참조) 아래 버튼으로 별도 거래를 추가하세요.</span></div>' +
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
          '<div class="taxcalc-field"><label>임대기간</label><input type="number" data-field="rentalYears" placeholder="년 (위 특례 선택 시)" maxlength="2"></div>' +
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
    '<div class="taxcalc-asset"><div class="taxcalc-asset-head"><b>양도인 정보</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>양도인 성명</label><input type="text" id="trTransferorName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>양도인 주민등록번호</label><input type="text" id="trTransferorRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
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
        '<div class="taxcalc-field"><label>양도일</label><input type="date" id="stTransferDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>취득가액</label><input type="number" id="stAcquisitionPrice" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>양도비용</label><input type="number" id="stTransferExpenses" placeholder="원 (증권거래세 등, 없으면 0)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="stIsDaejuju"><label for="stIsDaejuju">대주주(국내주식만 해당, 지분율·시가총액 기준은 별도 확인)</label></div>' +
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
        if (key === 'isReconstructionRights' || key === 'isLandReplotment') renderTransferPane(); // 청산금 안내·버튼 표시 여부가 바뀌므로 다시 그림
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
  // 환산취득가액(소득세법 시행령§176의2) — 취득당시 실지거래가액을 확인할 수 없을 때, 양도가액에
  // (취득당시기준시가÷양도당시기준시가) 비율을 곱해 취득가액을 추정하고, 취득당시기준시가의 3%를
  // 필요경비 개산공제로 추가 인정한다. 취득가액 직접입력을 대체한다(직접입력값보다 우선 적용).
  if (vals.useConvertedAcquisitionPrice){
    const acqStd = numVal(vals.acquisitionStandardPriceForExpense) || 0;
    const trStd = numVal(vals.transferStandardPriceForConversion) || 0;
    if (acqStd > 0 && trStd > 0){
      acquisitionPrice = Math.round(transferPrice * acqStd / trStd);
      necessaryExpenses += Math.round(acqStd * 0.03);
    }
  }
  // 관리처분인가 이후 조합원입주권·신축주택 양도 — 취득가액은 권리가액(종전자산평가액)에 청산금
  // 납부액(추가분담금)을 더한 금액으로 대체된다(청산금 환급분은 별도 거래로 관리처분인가일에 과세).
  // 취득일은 위 acquisitionDate(종전 부동산 취득일)를 그대로 쓴다(보유기간 통산).
  if (vals.isReconstructionRights){
    const rightsValue = numVal(vals.rightsValue) || 0;
    const settlementPaid = numVal(vals.settlementPaid) || 0;
    if (rightsValue > 0 || settlementPaid > 0) acquisitionPrice = rightsValue + settlementPaid;
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
    isNewBuildingWithin5Years: !!vals.isNewBuildingWithin5Years,
    convertedBuildingAcquisitionValueForPenalty: numVal(vals.convertedBuildingAcquisitionValueForPenalty) || 0,
    rentalSpecialType: vals.rentalSpecialType || '',
    rentalYears: numVal(vals.rentalYears) || 0,
    pensionAccountContribution: numVal(vals.pensionAccountContribution) || 0,
    compensationType: vals.compensationType || '',
    downContractPriceDifference: numVal(vals.downContractPriceDifference) || 0
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
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>수증자·증여자 정보 및 관계</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-gift">📄 증빙에서 자동 입력</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-gift"></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>수증자 성명</label><input type="text" id="giftDoneeName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>수증자 주민등록번호</label><input type="text" id="giftDoneeRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>수증자 주소</label><input type="text" id="giftDoneeAddress"></div>' +
        '<div class="taxcalc-field"><span class="taxcalc-result-note" id="giftMinorHint" style="margin:0;">수증자 미성년 여부는 위 주민등록번호로 자동 판정됩니다</span></div>' +
        '<div class="taxcalc-field"><label>증여자 성명</label><input type="text" id="giftDonorName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>증여자 주민등록번호</label><input type="text" id="giftDonorRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>증여자 주소</label><input type="text" id="giftDonorAddress"></div>' +
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
        '<div class="taxcalc-field"><label>10년내 동일인 기증여합산액</label><input type="number" id="giftPriorAmount" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>위 기증여분 기납부세액</label><input type="number" id="giftPriorPaidTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="giftGenSkipOver2B"><label for="giftGenSkipOver2B">세대생략+미성년자 20억 초과(할증 40%, 아니면 30%)</label></div>' +
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
        '<div class="taxcalc-field"><label>납부세액공제(§58, 재차증여 기납부분)</label><input type="number" id="srPriorPaidTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액공제(§59)</label><input type="number" id="srForeignTax" placeholder="원"></div>' +
        '<div class="taxcalc-field"><label>신고 상태</label><select id="srFilingStatus">' +
          '<option value="ontime">정상(기한내) 신고</option><option value="unreported">무신고</option><option value="underreported">과소신고</option>' +
        '</select></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="srFraudulent"><label for="srFraudulent">부정행위(가산세율 40%로 상향)</label></div>' +
        '<div class="taxcalc-field"><label>과소신고분 세액</label><input type="number" id="srUnderreportedTax" placeholder="원 (과소신고일 때만)"></div>' +
        '<div class="taxcalc-field"><label>실제 납부일</label><input type="date" id="srPaidDate" min="1900-01-01" max="2099-12-31"></div>' +
        '<div class="taxcalc-field"><label>납부지연일수(자동계산: 증여일+3개월 신고기한 대비)</label><input type="number" id="srUnpaidDays" placeholder="0" readonly></div>' +
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
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-business-opportunity-gift">일감떼어주기 증여세 계산하기</button>' +
      '<div id="taxCalcBusinessOpportunityGiftResult"></div>' +
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
        '<div class="taxcalc-field"><label>2022.2.14. 이전 일수(자동계산)</label><input type="number" id="ckDaysBefore" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>2022.2.14. 이후 일수(자동계산)</label><input type="number" id="ckDaysAfter" placeholder="0" readonly></div>' +
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
        '<div class="taxcalc-field"><label>적정이자율(법정 기본값 4.6%, 개정 시 직접 수정)</label><input type="number" step="0.1" id="loanRate" value="4.6"></div>' +
        '<div class="taxcalc-field"><label>대출기간</label><input type="number" id="loanMonths" placeholder="개월 (기본 12)" maxlength="3"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-interest-free-loan">증여재산가액 계산하기</button>' +
      '<div id="taxCalcLoanResult"></div>' +
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
  recomputeSrGiftUnpaidDays();
  const jmFiscalYearEndEl = document.getElementById('jmFiscalYearEnd');
  const jmPaidDateEl = document.getElementById('jmPaidDate');
  if (jmFiscalYearEndEl) jmFiscalYearEndEl.addEventListener('input', recomputeJmUnpaidDays);
  if (jmPaidDateEl) jmPaidDateEl.addEventListener('input', recomputeJmUnpaidDays);
  recomputeJmUnpaidDays();
  const jtFiscalYearEndEl = document.getElementById('jtFiscalYearEnd');
  const jtPaidDateEl = document.getElementById('jtPaidDate');
  if (jtFiscalYearEndEl) jtFiscalYearEndEl.addEventListener('input', recomputeJtUnpaidDays);
  if (jtPaidDateEl) jtPaidDateEl.addEventListener('input', recomputeJtUnpaidDays);
  recomputeJtUnpaidDays();
  const ckStartDateEl = document.getElementById('ckStartDate');
  const ckEndDateEl = document.getElementById('ckEndDate');
  if (ckStartDateEl) ckStartDateEl.addEventListener('input', recomputeClawbackDaySplit);
  if (ckEndDateEl) ckEndDateEl.addEventListener('input', recomputeClawbackDaySplit);
  recomputeClawbackDaySplit();
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
  html += '<button type="button" class="taxcalc-calcbasis-btn" data-action="toggle-gift-calc-basis" style="margin-top:8px;">🧮 계산근거 접기/펴기</button>';
  html += '<div class="taxcalc-calcbasis" id="giftCalcBasis">' +
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
  html += '<button type="button" class="taxcalc-run-btn" data-action="apply-clawback-to-gift">이 이자상당액을 증여세 계산기에 반영</button>';
  html += '<button type="button" class="taxcalc-run-btn" data-action="apply-clawback-to-inheritance">이 이자상당액을 상속세 계산기에 반영</button>';
  html += '<div class="taxcalc-result-note">일수는 당초 감면·특례 적용받은 신고기한 다음 날부터 추징사유가 발생한 날까지의 기간입니다. 이자율은 향후 시행령 개정으로 바뀔 수 있으니 신고 시점 기준으로 재확인하세요.</div>';
  html += '</div>';
  box.innerHTML = html;
  box.dataset.lastInterestTotal = r.이자상당액_합계;
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
    '<div class="taxcalc-asset">' +
      '<div class="taxcalc-asset-head"><b>피상속인 정보</b>' +
        '<span><button type="button" class="taxcalc-ai-btn" data-action="open-evidence-inheritance">📄 증빙에서 자동 입력</button></span>' +
      '</div>' +
      '<div class="taxcalc-ai-status" id="aiStatus-inheritance"></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>피상속인 성명</label><input type="text" id="ihDeceasedName" data-nameonly="1"></div>' +
        '<div class="taxcalc-field"><label>피상속인 주민등록번호</label><input type="text" id="ihDeceasedRegNo" placeholder="000000-0000000" data-regno="1"></div>' +
        '<div class="taxcalc-field"><label>상속개시일</label><input type="date" id="ihDeathDate" min="1900-01-01" max="2099-12-31"><span class="taxcalc-result-note" id="ihDeathDateDeadlineHint" style="margin:2px 0 0;"></span></div>' +
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
        '<div class="taxcalc-field"><label>세대생략 상속인이 받는 재산가액(자동, 명부에서 "세대생략" 체크된 행 합계)</label><input type="number" id="ihGenSkipAmount" placeholder="0" readonly></div>' +
        '<div class="taxcalc-field"><label>세대생략 상속인이 받는 재산 비율(자동계산: 위 금액÷총상속재산가액)</label><input type="number" step="0.0001" id="ihGenSkipRatio" placeholder="0" readonly><span class="taxcalc-result-note" id="ihGenSkipRatioHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field checkbox"><input type="checkbox" id="ihGenSkipOver2B"><label for="ihGenSkipOver2B">세대생략+미성년자 20억 초과(할증 40%, 아니면 30%)</label></div>' +
      '</div>' +
      '<div class="taxcalc-asset-head" style="margin-top:14px;"><b>세액공제</b></div>' +
      '<div class="taxcalc-grid">' +
        '<div class="taxcalc-field"><label>기납부증여세액(10년내 사전증여분)</label><input type="number" id="ihPriorGiftTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>외국납부세액</label><input type="number" id="ihForeignTax" placeholder="원 (없으면 비움)"></div>' +
        '<div class="taxcalc-field"><label>전 상속세액 중 재상속분(단기재상속공제)</label><input type="number" id="ihPriorInheritanceTax" placeholder="원 (없으면 비움)"></div>' +
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
        '<div class="taxcalc-field"><label>총 납부세액</label><input type="number" id="ipIhTotal" placeholder="원 (2천만원 초과해야 신청 가능)"><span class="taxcalc-result-note" id="ipIhTotalHint" style="margin:2px 0 0;"></span></div>' +
        '<div class="taxcalc-field"><label>최초 납부세액(신고기한까지 먼저 납부)</label><input type="number" id="ipIhInitial" placeholder="원 (없으면 0)"></div>' +
        '<div class="taxcalc-field"><label>연부연납기간</label><input type="number" id="ipIhYears" placeholder="년 (상속세 일반10/가업20, 증여세 일반5/특례15)" maxlength="2"></div>' +
        '<div class="taxcalc-field"><label>연부연납 가산금 연이자율</label><input type="number" step="0.01" id="ipIhRate" placeholder="% (신고 시점 기준 확인 필요)"></div>' +
      '</div>' +
      '<button type="button" class="taxcalc-run-btn" data-action="run-installment-inheritance">연부연납 계산하기</button>' +
      '<div id="taxCalcInstallmentInheritanceResult"></div>' +
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
// 시행령§11 산식의 중간 단계를 그대로 노출) — 순인출액=총인출-내돈입금액, 미소명액=순인출액-소명액,
// 문턱=MIN(순인출액×20%, 2억원)이며 미소명액이 문턱 "미만"이면 0(전액 소명 간주), 문턱 이상이면
// 미소명액 전액이 산입된다(문턱을 빼는 게 아님). 최종 산입액은 1년/2년 중 큰 금액.
function computeDisposalBasisPresumed_(amount, selfDeposit, explained, thresholdAmount){
  const net = Math.max(0, numVal(amount) - numVal(selfDeposit));
  if (net < thresholdAmount) return { net: net, unexplained: 0, cutoff: 0, presumed: 0, meets: false };
  const unexplained = Math.max(0, net - numVal(explained));
  const cutoff = Math.min(net * 0.2, 200000000);
  return { net: net, unexplained: unexplained, cutoff: cutoff, presumed: (unexplained >= cutoff ? unexplained : 0), meets: true };
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
      '<div class="taxcalc-field"><label>지급처 사업자번호</label><input type="text" data-ffield="bizNo" value="' + (item.bizNo || '').replace(/"/g, '&quot;') + '" placeholder="123-45-67890"></div>' +
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
  html += taxCalcResultRow('장례비용공제', won(r.장례비용공제));
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
      if (key === 'isCohabitHouse'){
        const field = row.querySelector('[data-show-if-heir="isCohabitHouse"]');
        if (field) field.style.display = el.checked ? 'flex' : 'none';
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
  } else if (action === 'open-evidence-transfer'){
    const idx = numVal(btn.dataset.idx);
    openEvidencePicker(function(fileName){ runAiAutoFillTransfer(fileName, idx); });
  } else if (action === 'open-evidence-gift'){
    openEvidencePicker(function(fileName){ runAiAutoFillGift(fileName); });
  } else if (action === 'open-evidence-inheritance'){
    openEvidencePicker(function(fileName){ runAiAutoFillInheritance(fileName); });
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
      isSelfElectronicFiling: document.getElementById('trSelfEfiling').checked
    };
    const result = calculateTransferTaxMultiJS(inputs, filingParams);
    renderTransferResult(result);
    transferAssets.forEach(function(_, idx){ populateTransferCalcBasis_(idx); }); // 산출내역을 토글 없이 한꺼번에 보여준다
  } else if (action === 'run-stock-transfer'){
    const input = {
      assetCategory: document.getElementById('stAssetCategory').value,
      transferPrice: numVal(document.getElementById('stTransferPrice').value) || 0,
      acquisitionPrice: numVal(document.getElementById('stAcquisitionPrice').value) || 0,
      transferExpenses: numVal(document.getElementById('stTransferExpenses').value) || 0,
      isDaejuju: document.getElementById('stIsDaejuju').checked,
      holdingMonths: document.getElementById('stHoldingMonths').value === '' ? null : numVal(document.getElementById('stHoldingMonths').value),
      isSmallMediumCompany: document.getElementById('stIsSmallMedium').checked,
      priorNetGainOrLoss: numVal(document.getElementById('stPriorNetGain').value) || 0,
      basicDeductionAlreadyUsed: numVal(document.getElementById('stBasicDeductionUsed').value) || 0,
      foreignTaxPaidAmount: numVal(document.getElementById('stForeignTax').value) || 0,
      filingStatus: document.getElementById('stFilingStatus').value,
      isFraudulent: document.getElementById('stFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('stUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('stUnpaidDays').value) || 0
    };
    renderStockTransferResult(calculateStockTransferTaxJS(input));
  } else if (action === 'send-debt-to-transfer'){
    // 부담부증여의 인수채무액 상당분은 증여자가 그 지분만큼 대가(채무인수)를 받고 양도한 것으로
    // 과세된다(소득세법§88①). 양도가액=인수채무액, 취득가액·필요경비는 증여자의 전체 재산 기준
    // 취득정보에 (인수채무액÷증여재산가액) 비율을 곱해 안분한다.
    const giftAmount = numVal(document.getElementById('giftAmount').value) || 0;
    const debtAmount = numVal(document.getElementById('giftDebtAssumed').value) || 0;
    if (!giftAmount || !debtAmount) return;
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
      debtAssumedAmount: numVal(document.getElementById('giftDebtAssumed').value) || 0,
      priorGiftAmount: numVal(document.getElementById('giftPriorAmount').value) || 0,
      priorPaidTax: numVal(document.getElementById('giftPriorPaidTax').value) || 0,
      isGenerationSkip: (function(){
        const sel = document.getElementById('giftRelation');
        const opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
        return !!(opt && opt.dataset.genskip === '1');
      })(),
      generationSkipOver2Billion: document.getElementById('giftGenSkipOver2B').checked,
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
      unpaidDays: numVal(document.getElementById('srUnpaidDays').value) || 0
    };
    renderSpecialRateGiftResult(calculateSpecialRateGiftTaxJS(input));
  } else if (action === 'run-related-party-gift'){
    const input = {
      companySize: document.getElementById('jmCompanySize').value,
      afterTaxOperatingIncome: numVal(document.getElementById('jmOperatingIncome').value) || 0,
      relatedPartyTransactionRatio: numVal(document.getElementById('jmTradeRatio').value) || 0,
      shareholderOwnershipRatio: numVal(document.getElementById('jmShareRatio').value) || 0,
      dividendDeduction: numVal(document.getElementById('jmDividendDeduction').value) || 0,
      filingStatus: document.getElementById('jmFilingStatus').value,
      isFraudulent: document.getElementById('jmFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('jmUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('jmUnpaidDays').value) || 0,
      reportedInTime: document.getElementById('jmReportedInTime').checked
    };
    renderRelatedPartyGiftResult(calculateRelatedPartyTransactionGiftTaxJS(input));
  } else if (action === 'run-business-opportunity-gift'){
    const input = {
      phase: document.getElementById('jtPhase').value,
      profitFromOpportunity: numVal(document.getElementById('jtProfit').value) || 0,
      shareholderOwnershipRatio: numVal(document.getElementById('jtShareRatio').value) || 0,
      corporateTaxPortion: numVal(document.getElementById('jtCorporateTax').value) || 0,
      monthsInInitialYear: numVal(document.getElementById('jtMonths').value) || 0,
      dividendDeduction: numVal(document.getElementById('jtDividendDeduction').value) || 0,
      filingStatus: document.getElementById('jtFilingStatus').value,
      isFraudulent: document.getElementById('jtFraudulent').checked,
      underreportedTaxAmount: numVal(document.getElementById('jtUnderreportedTax').value) || 0,
      unpaidDays: numVal(document.getElementById('jtUnpaidDays').value) || 0,
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
      daysBefore20220214: numVal(document.getElementById('ckDaysBefore').value) || 0,
      daysOnOrAfter20220214: numVal(document.getElementById('ckDaysAfter').value) || 0
    };
    renderClawbackResult(calculateClawbackInterestJS(input));
  } else if (action === 'run-low-price-transfer'){
    const input = {
      fairMarketValue: numVal(document.getElementById('lpFairValue').value) || 0,
      transferPrice: numVal(document.getElementById('lpTransferPrice').value) || 0
    };
    renderLowPriceResult(calculateLowPriceTransferGiftAmountJS(input));
  } else if (action === 'run-interest-free-loan'){
    const input = {
      loanPrincipal: numVal(document.getElementById('loanPrincipal').value) || 0,
      actualInterestPaid: numVal(document.getElementById('loanActualInterest').value) || 0,
      appropriateInterestRatePercent: document.getElementById('loanRate').value === '' ? null : numVal(document.getElementById('loanRate').value),
      loanMonths: document.getElementById('loanMonths').value === '' ? null : numVal(document.getElementById('loanMonths').value)
    };
    renderLoanGiftResult(calculateInterestFreeLoanGiftAmountJS(input));
  } else if (action === 'run-installment-inheritance'){
    const input = {
      taxType: document.getElementById('ipIhTaxType').value,
      totalTaxAmount: numVal(document.getElementById('ipIhTotal').value) || 0,
      initialPaymentAmount: numVal(document.getElementById('ipIhInitial').value) || 0,
      installmentPeriodYears: numVal(document.getElementById('ipIhYears').value) || 0,
      annualInterestRatePercent: numVal(document.getElementById('ipIhRate').value)
    };
    renderInstallmentResult(calculateInstallmentPaymentScheduleJS(input), 'taxCalcInstallmentInheritanceResult');
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
      hasSpouse: taxCalcHeirRegistryHasSpouse,
      spouseActualInheritedAmount: numVal(document.getElementById('ihSpouseActual').value) || 0,
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
      farmingInheritanceDeduction: numVal(document.getElementById('ihFarmingDeduction').value) || 0,
      farmingIndividualAssetValue: numVal(document.getElementById('ihFarmingIndividualAsset').value) || 0,
      farmingStockValue: numVal(document.getElementById('ihFarmingStockValue').value) || 0,
      farmingTotalAssetValue: numVal(document.getElementById('ihFarmingTotalAsset').value) || 0,
      farmingNonBizAsset55: numVal(document.getElementById('ihFarmingNonBiz55').value) || 0,
      farmingNonBizAsset49: numVal(document.getElementById('ihFarmingNonBiz49').value) || 0,
      farmingNonBizAsset61: numVal(document.getElementById('ihFarmingNonBiz61').value) || 0,
      farmingExcessCash: numVal(document.getElementById('ihFarmingExcessCash').value) || 0,
      farmingNonBizStock: numVal(document.getElementById('ihFarmingNonBizStock').value) || 0,
      priorGiftTaxableBaseForOverallLimit: numVal(document.getElementById('ihPriorGiftBaseTotal').value) || 0,
      disclaimedShareRedistributedAmount: numVal(document.getElementById('ihDisclaimedRedistributed').value) || 0,
      generationSkipHeirRatio: numVal(document.getElementById('ihGenSkipRatio').value) || 0,
      generationSkipOver2Billion: document.getElementById('ihGenSkipOver2B').checked,
      priorGiftTaxPaid: numVal(document.getElementById('ihPriorGiftTax').value) || 0,
      foreignTaxPaidAmount: numVal(document.getElementById('ihForeignTax').value) || 0,
      priorInheritanceTaxPortion: numVal(document.getElementById('ihPriorInheritanceTax').value) || 0,
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
