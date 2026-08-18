// ============================================================
// 양도소득세·증여세·상속세 세액계산 — 계산기 워크시트(explorer.js의 =수식)에서
// 세율표·공제표를 사람이 직접 찾아 넣지 않아도 자동으로 적용되게 해주는 함수들.
// gs-backend/Code.js에도 같은 이름 규칙으로 동일한 세율·공제 기준을 넣어뒀으니,
// 세법 개정으로 여기 숫자를 고칠 땐 그쪽도 같이 맞춰야 한다.
// 세율·공제 구간은 이 코드 작성 시점 기준 현행법이며 매년 개정될 수 있으므로,
// 실제 신고 전에는 반드시 홈택스 모의계산 등으로 재검증할 것.
// 다주택 중과세율처럼 시행령으로 수시로 유예·변경되는 항목은 변동성이 너무 커서
// 자동계산에 포함하지 않았다 — 해당 사안은 별도로 확인해야 한다.
// ============================================================
(function () {
  // 증여세·상속세 공통 누진세율표 (상속세및증여세법 §26, §56)
  const GIFT_INHERIT_TAX_BRACKETS = [
    { max: 100000000, rate: 0.10, deduction: 0 },
    { max: 500000000, rate: 0.20, deduction: 10000000 },
    { max: 1000000000, rate: 0.30, deduction: 60000000 },
    { max: 3000000000, rate: 0.40, deduction: 160000000 },
    { max: Infinity, rate: 0.50, deduction: 460000000 }
  ];

  // 양도소득세 기본세율표 (소득세법 §55, 2023년 개정 이후 구간 — 종합소득세율과 동일)
  const TRANSFER_TAX_BRACKETS = [
    { max: 14000000, rate: 0.06, deduction: 0 },
    { max: 50000000, rate: 0.15, deduction: 1260000 },
    { max: 88000000, rate: 0.24, deduction: 5760000 },
    { max: 150000000, rate: 0.35, deduction: 15440000 },
    { max: 300000000, rate: 0.38, deduction: 19940000 },
    { max: 500000000, rate: 0.40, deduction: 25940000 },
    { max: 1000000000, rate: 0.42, deduction: 35940000 },
    { max: Infinity, rate: 0.45, deduction: 65940000 }
  ];

  function progressiveTax(base, brackets) {
    if (!base || base <= 0) return 0;
    const bracket = brackets.find(function (b) { return base <= b.max; }) || brackets[brackets.length - 1];
    return Math.max(0, Math.round(base * bracket.rate - bracket.deduction));
  }
  // 과세최저한(상증세법§25②·§55②) — 상속세·증여세는 과세표준이 50만원 미만이면 세액을 부과하지
  // 않는다(양도소득세·주식양도세에는 이런 문턱이 없으므로 progressiveTax 자체에는 넣지 않는다).
  function progressiveGiftInheritTax(base, brackets) {
    return (Number(base) || 0) < 500000 ? 0 : progressiveTax(base, brackets);
  }

  // 증여재산공제 (상증세법 §53, 10년간 합산 한도액 기준)
  function giftPropertyDeduction(relation, isMinor) {
    switch (relation) {
      case '배우자': return 600000000;
      case '직계존속': return isMinor ? 20000000 : 50000000;
      case '직계비속': return 50000000;
      case '기타친족': return 10000000;
      default: return 0;
    }
  }

  // 배우자상속공제 한도액 ([별지 제9호서식] 부표3의2): {(상속재산의 가액-유증재산가액+10년내 상속인증여재산)×배우자법정상속분비율} - 배우자의 사전증여 과세표준
  function spouseInheritanceLimit(estateValueForLimit, nonHeirBequestAmount, giftToHeirsWithin10Years, spouseLegalShareRatio, spouseTaxableBaseOfPriorGift) {
    if (!(spouseLegalShareRatio > 0)) return Infinity;
    const base = (Number(estateValueForLimit) || 0) - (Number(nonHeirBequestAmount) || 0) + (Number(giftToHeirsWithin10Years) || 0);
    return Math.max(0, base * spouseLegalShareRatio - (Number(spouseTaxableBaseOfPriorGift) || 0));
  }

  // 배우자 상속공제 (상증세법 §19) — 최소 5억, 최대 30억이며 (실제 상속액, 한도액) 중 작은 값
  function spouseInheritanceDeduction(actualAmount, limitAmount) {
    const actual = Number(actualAmount) || 0;
    if (actual < 500000000) return 500000000; // 실제 상속액이 없거나 5억 미만이어도 최소 5억은 공제
    const limit = Number.isFinite(limitAmount) ? limitAmount : Infinity;
    return Math.min(actual, limit, 3000000000);
  }

  // 단기재상속세액공제 (상증세법 §30②) — 10년 이내 재상속 시, §30②1호 산식대로 "전의 상속세 산출세액 ×
  // [재상속분의 재산가액 × (전의 상속세 과세가액/전의 상속재산가액)] / 전의 상속세 과세가액"을 구한 뒤
  // §30②2호 공제율표(재상속기간 1년 이내 100%에서 1년마다 10%p씩 감소, 10년 이내 10%)를 곱한다.
  // 산식상 "전의 상속세 과세가액" 항은 분자·분모에서 상쇄되어 결과적으로 재상속분재산가액/전의상속재산가액
  // 비율과 같아지지만, 법문 그대로 두 값을 모두 입력받아 계산한다(과세가액이 0이면 산식 자체가 성립하지
  // 않으므로 0을 반환).
  const SHORT_TERM_REINHERITANCE_RATES = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  function shortTermReinheritanceCredit(priorInheritanceTax, reinheritedPropertyValue, priorInheritanceTotalPropertyValue, priorInheritanceTaxableBase, yearsSincePriorInheritance) {
    const y = Math.ceil(Number(yearsSincePriorInheritance) || 0);
    if (y < 1 || y > 10) return 0;
    const totalProperty = Number(priorInheritanceTotalPropertyValue) || 0;
    const taxableBase = Number(priorInheritanceTaxableBase) || 0;
    if (totalProperty <= 0 || taxableBase <= 0) return 0;
    const portion = (Number(priorInheritanceTax) || 0) * ((Number(reinheritedPropertyValue) || 0) * (taxableBase / totalProperty)) / taxableBase;
    return Math.round(portion * SHORT_TERM_REINHERITANCE_RATES[y - 1]);
  }

  // 증여세액공제 (상증세법 §28) — 상속인별 정밀 계산.
  // ①단서: 상속세 과세가액이 5억원 이하이면 공제 자체를 배제한다.
  // ②본문+단서: 그 증여재산의 수증자가 상속인·수유자이면(사전증여 가산은 통상 이 경우다), 상속인 각자가
  // 납부할 상속세액에 "그 상속인이 받았거나 받을 상속재산에 대하여 대통령령으로 정하는 바에 따라 계산한
  // 과세표준(=상속인별 상속세과세표준 상당액, 시행령§3①1호)에 대하여 가산한 증여재산의 과세표준이 차지하는
  // 비율"을 곱한 금액을 한도로, 각자가 납부할 상속세액에서 공제한다. 시행령§3①1호 산식:
  //   상속인별 상속세과세표준상당액 = 그 상속인의 가산증여재산 과세표준
  //     + (전체과세표준－전체가산증여재산과세표준) × [(그 상속인 상속세과세가액상당액－그 상속인 가산증여재산가액)
  //                                                  ÷ (전체상속세과세가액－전체가산증여재산가액)]
  // "상속인별 상속세과세가액상당액"(다목)의 기준은 §28②후단 조문 자체가 이미 명시하고 있다 — "그 상속인
  // 또는 수유자가 받았거나 받을 상속재산에 대하여" 계산한다고 했으므로, 그 상속인에게 실제 귀속되는
  // 상속재산가액(=이 계산기의 actualInheritedValue) 그대로가 기준이다. "상속재산"이라 했지 "순재산"이라
  // 하지 않았으므로 채무 차감 전 금액이며, §3조의2③의 "각자가 받았거나 받을 재산"(총자산-부채-상속세-
  // 증여세, 연대납부의무의 "한도"를 정하는 별개 규정)과는 무관하다. "그 상속인이 납부할 상속세액"은
  // §3조의2①→시행령§3①이 정하는 "상속인별 상속세과세표준상당액 ÷ 제2호 금액" 비율을 전체 산출세액에
  // 곱한 값이며, 이 계산기의 §3조의2① 안분 도구(allocateInheritanceTaxByHeirJS)와 동일한 비율(실제상속재산가액
  // 비율)로 근사한다 — 제2호(§13①2호 관련 조정)까지 정밀 반영하지는 않았으니 유의할 것.
  function priorGiftTaxCreditPrecise(overallCalculatedTax, overallTaxBase, overallTaxableAmount, heirs) {
    heirs = Array.isArray(heirs) ? heirs : [];
    if (overallTaxableAmount <= 500000000) {
      return { totalCredit: 0, excludedBySmallEstate: true, perHeir: [] };
    }
    const totalActualValue = heirs.reduce(function (s, h) { return s + (Number(h.actualInheritedValue) || 0); }, 0);
    const totalPriorGiftAmount = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftAmount) || 0); }, 0);
    const totalPriorGiftTaxableBase = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0);
    const 가목 = Math.max(0, overallTaxBase - totalPriorGiftTaxableBase);
    const 나목 = Math.max(0, overallTaxableAmount - totalPriorGiftAmount);
    let totalCredit = 0;
    const perHeir = heirs.map(function (h) {
      const giftTaxableBase = Number(h.priorGiftTaxableBase) || 0;
      const giftTaxPaid = Number(h.priorGiftTaxPaid) || 0;
      const giftAmount = Number(h.priorGiftAmount) || 0;
      if (giftTaxableBase <= 0 || giftTaxPaid <= 0 || totalActualValue <= 0) {
        return { 성명: h.name || '', 공제액: 0, 한도: 0, 상속인별과세표준상당액: 0, 안분산출세액: 0 };
      }
      const actualValueRatio = (Number(h.actualInheritedValue) || 0) / totalActualValue;
      const heirTaxableAmountShare = overallTaxableAmount * actualValueRatio; // 상속인별 상속세과세가액상당액
      const 다목 = heirTaxableAmountShare - giftAmount;
      const ratio다나 = 나목 > 0 ? (다목 / 나목) : 0;
      const taxableBaseEquivalent = giftTaxableBase + 가목 * ratio다나; // 상속인별 상속세과세표준상당액
      const grossTaxShare = overallCalculatedTax * actualValueRatio; // 그 상속인이 납부할 상속세액(§3조의2②)
      const limit = taxableBaseEquivalent > 0 ? Math.round(grossTaxShare * Math.min(1, giftTaxableBase / taxableBaseEquivalent)) : 0;
      const credit = Math.min(giftTaxPaid, Math.round(grossTaxShare), limit);
      totalCredit += credit;
      return { 성명: h.name || '', 공제액: credit, 한도: limit, 상속인별과세표준상당액: Math.round(taxableBaseEquivalent), 안분산출세액: Math.round(grossTaxShare) };
    });
    return { totalCredit: Math.round(totalCredit), excludedBySmallEstate: false, perHeir: perHeir };
  }

  // 상속개시전 처분재산 등 산입액 (상증세법 §15, [별지 제9호서식] 부표4) — gs-backend와 동일 로직.
  // 상속개시전 처분재산 등 산입액(상증세법§15, 시행령§11④) — 1년 이내 2억원 이상 또는 2년 이내
  // 5억원 이상 처분·인출(재산종류별)한 경우로서 용도가 불분명하면 산입 대상이 된다.
  // 시행령§11④ 원문: "…입증되지 아니한 금액이 [MIN(순인출액×20%, 2억원)]에 미달하는 경우에는
  // 용도가 명백하지 아니한 것으로 추정하지 아니하며, 그 금액 이상인 경우에는 [MIN(순인출액×20%,
  // 2억원)]을 "차감한 금액"을 용도가 명백하지 아니한 것으로 추정한다" — 즉 미달이면 0(추정 안 함),
  // 이상이면 미소명금액에서 그 문턱금액을 뺀 "차액"만 산입한다(문턱을 넘었다고 미소명금액 전액이
  // 산입되는 게 아니다 — 이전 버전의 주석·구현이 이 부분을 반대로 잘못 이해하고 있었다).
  // 1년 기준과 2년 기준은 서로 다른 별도의 요건이므로 각각 독립적으로 계산한 뒤 더 큰 금액을
  // 채택한다(둘을 더하지 않음 — 2년 누계에는 1년분이 이미 포함되어 있으므로 중복산입 방지).
  function computeDisposalBasisPresumed_(amount, selfDeposit, explained, thresholdAmount) {
    const net = Math.max(0, (Number(amount) || 0) - (Number(selfDeposit) || 0));
    if (net < thresholdAmount) return 0;
    const unexplained = Math.max(0, net - (Number(explained) || 0));
    const cutoff = Math.min(net * 0.2, 200000000);
    return unexplained >= cutoff ? unexplained - cutoff : 0;
  }
  function presumedInheritedFromDisposal(item) {
    item = item || {};
    const oneYear = computeDisposalBasisPresumed_(item.oneYearAmount, item.oneYearSelfDeposit, item.oneYearExplained, 200000000);
    const twoYear = computeDisposalBasisPresumed_(item.twoYearAmount, item.twoYearSelfDeposit, item.twoYearExplained, 500000000);
    return Math.max(oneYear, twoYear);
  }

  // 금융재산 상속공제 (상증세법 §22) — 순금융재산 2천만원 이하면 전액, 초과하면 20%와 2천만원 중 큰 금액(2억원 한도)
  function financialAssetInheritanceDeduction(netFinancialAssets) {
    const net = Number(netFinancialAssets) || 0;
    if (net <= 0) return 0;
    if (net <= 20000000) return net;
    return Math.min(200000000, Math.max(net * 0.2, 20000000));
  }

  // 사업관련자산가액 비율 (상증세법 시행령 §15⑤2호가목~마목) — 가업상속공제·영농상속공제·조특법 가업승계 증여세 특례 공통 사용
  function businessRelatedAssetRatio(totalAssetValue, nonBiz) {
    const total = Number(totalAssetValue) || 0;
    const n = nonBiz || {};
    const nonBizTotal = (Number(n.asset55) || 0) + (Number(n.asset49) || 0) + (Number(n.asset61) || 0)
      + (Number(n.excessCash) || 0) + (Number(n.nonBizStock) || 0);
    const businessRelatedAssetValue = Math.max(0, total - nonBizTotal);
    const ratio = total > 0 ? businessRelatedAssetValue / total : 0;
    return { nonBizTotal, businessRelatedAssetValue, ratio };
  }

  // 가업상속공제 ([별지 제1호서식] 기준) — 소득세법 적용가업(순자산액 합계) 또는 법인세법 적용가업(주식등가액×사업관련자산비율).
  // 가업영위기간별 한도(10~20년 300억/20~30년 400억/30년이상 600억).
  function businessInheritanceDeductionDetailed(p) {
    const years = Number(p.businessOwnershipYears) || 0;
    const individualNet = Number(p.businessInheritanceIndividualNetAssetValue) || 0;
    const stockValue = Number(p.businessInheritanceStockValue) || 0;
    if (years <= 0 || (individualNet <= 0 && stockValue <= 0)) return null;

    const targetIndividual = individualNet;
    const ratioInfo = stockValue > 0 ? businessRelatedAssetRatio(p.businessInheritanceTotalAssetValue, {
      asset55: p.businessInheritanceNonBizAsset55, asset49: p.businessInheritanceNonBizAsset49,
      asset61: p.businessInheritanceNonBizAsset61, excessCash: p.businessInheritanceExcessCash, nonBizStock: p.businessInheritanceNonBizStock
    }) : null;
    const targetCorporate = ratioInfo ? Math.round(stockValue * ratioInfo.ratio) : 0;
    const targetAmount = targetIndividual + targetCorporate;

    const limitAmount = years < 10 ? 0 : (years < 20 ? 30000000000 : (years < 30 ? 40000000000 : 60000000000));
    const deductionAmount = Math.min(targetAmount, limitAmount);
    return { targetAmount, limitAmount, deductionAmount, targetIndividual, targetCorporate, ratioInfo };
  }

  // 영농상속공제 ([별지 제2호서식] 기준) — 소득세법 적용영농(①합계) + 법인세법 적용영농(주식등가액×사업관련자산비율), 30억원 고정한도.
  function farmingInheritanceDeductionDetailed(p) {
    const individualTotal = Number(p.farmingIndividualAssetValue) || 0;
    const stockValue = Number(p.farmingStockValue) || 0;
    if (individualTotal <= 0 && stockValue <= 0) return null;

    const ratioInfo = stockValue > 0 ? businessRelatedAssetRatio(p.farmingTotalAssetValue, {
      asset55: p.farmingNonBizAsset55, asset49: p.farmingNonBizAsset49,
      asset61: p.farmingNonBizAsset61, excessCash: p.farmingExcessCash, nonBizStock: p.farmingNonBizStock
    }) : null;
    const targetCorporate = ratioInfo ? Math.round(stockValue * ratioInfo.ratio) : 0;
    const targetAmount = individualTotal + targetCorporate;

    const limitAmount = 3000000000;
    const deductionAmount = Math.min(targetAmount, limitAmount);
    return { targetAmount, limitAmount, deductionAmount, individualTotal, targetCorporate, ratioInfo };
  }

  const TAX_FUNCS = {
    // 누진세(과세표준, "증여상속"|"양도") — 누진세율표를 적용한 산출세액(원)
    누진세: function (base, kind) {
      const brackets = (kind === '양도') ? TRANSFER_TAX_BRACKETS : GIFT_INHERIT_TAX_BRACKETS;
      return progressiveTax(Number(base) || 0, brackets);
    },
    // 장특공제율(보유연수) — 일반자산 장기보유특별공제율(0~0.30)
    장특공제율: function (years) {
      const y = Number(years) || 0;
      if (y < 3) return 0;
      return Math.min(0.30, y * 0.02);
    },
    // 장특공제율1주택(보유연수, 거주연수) — 1세대1주택 특례 장기보유특별공제율(0~0.80)
    장특공제율1주택: function (ownYears, liveYears) {
      const oy = Number(ownYears) || 0, ly = Number(liveYears) || 0;
      const ownRate = oy >= 3 ? Math.min(0.40, oy * 0.04) : 0;
      const liveRate = ly >= 2 ? Math.min(0.40, ly * 0.04) : 0;
      return ownRate + liveRate;
    },
    // 증여공제(관계, 미성년여부) — 증여재산공제액(원). 관계: 배우자/직계존속/직계비속/기타친족/기타
    증여공제: function (relation, isMinor) {
      return giftPropertyDeduction(relation, !!isMinor);
    },
    // 배우자공제(실제상속액, 법정상속분) — 상속세 배우자공제액(원, 최소5억~최대30억)
    배우자공제: function (actualAmount, legalShareAmount) {
      return spouseInheritanceDeduction(actualAmount, legalShareAmount);
    },
    // 일괄공제비교(인적공제합계) — 일괄공제 5억과 (기초공제2억+인적공제) 중 큰 값(원)
    일괄공제비교: function (personalDeductionSum) {
      return Math.max(500000000, 200000000 + (Number(personalDeductionSum) || 0));
    },
    // 금융재산공제(순금융재산) — 상속세 금융재산상속공제액(원, 2천만~2억)
    금융재산공제: function (netFinancialAssets) {
      return financialAssetInheritanceDeduction(netFinancialAssets);
    },
    // 자경농지감면(산출세액) — 8년 자경농지 감면액(원, 연간 1억원 한도. 5년 합산 2억원 한도는 별도 확인)
    자경농지감면: function (calculatedTax) {
      return Math.min(Number(calculatedTax) || 0, 100000000);
    },
    // 최소값(a, b) — 두 값 중 작은 값. 동거주택상속공제(6억 한도), 감정평가수수료공제(500만 한도) 등 한도 계산에 사용.
    최소값: function (a, b) {
      return Math.min(Number(a) || 0, Number(b) || 0);
    },
    // 최댓값(a, b) — 두 값 중 큰 값. 과세표준·산출세액처럼 음수가 나오면 안 되는 값을 0으로 바닥 처리(=최댓값(값,0))할 때 사용.
    최댓값: function (a, b) {
      return Math.max(Number(a) || 0, Number(b) || 0);
    }
  };

  const FUNC_NAME_PATTERN = Object.keys(TAX_FUNCS).sort(function (a, b) { return b.length - a.length; }).join('|');
  const FUNC_CALL_RE = new RegExp('(' + FUNC_NAME_PATTERN + ')\\(([^()]*)\\)');

  function parseArg(raw) {
    const s = (raw || '').trim();
    if (!s) return undefined;
    if ((s[0] === "'" && s[s.length - 1] === "'") || (s[0] === '"' && s[s.length - 1] === '"')) {
      return s.slice(1, -1);
    }
    const n = Number(s.replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
    // 순수 숫자가 아니면 "최댓값([4]-[5],0)"처럼 [n] 참조가 이미 치환된 산술식(+-*/())일 수 있으니
    // 같은 안전한 문자 화이트리스트로 계산해본다 — 실패하면 관계 키워드 등 문자열로 취급.
    if (/^[0-9+\-*/().\s]+$/.test(s)) {
      try {
        const v = Function('"use strict"; return (' + s + ')')();
        if (Number.isFinite(v)) return v;
      } catch (err) { /* fall through to string */ }
    }
    return s;
  }

  function splitArgs(argsStr) {
    return argsStr.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
  }

  // "누진세([3],'증여상속')" 같은 수식 문자열에서, [n] 참조가 이미 숫자로 치환된 뒤
  // 세무 함수 호출을 반복적으로 찾아 실제 계산값(숫자)으로 바꿔치기한다.
  // eval류를 전혀 쓰지 않고, 정해진 함수 이름·괄호·쉼표 패턴만 문자열로 치환하므로 안전하다.
  window.resolveCalcTaxFunctions = function (expr) {
    let out = expr;
    let guard = 0;
    while (FUNC_CALL_RE.test(out) && guard++ < 30) {
      out = out.replace(FUNC_CALL_RE, function (m, name, argsStr) {
        const args = splitArgs(argsStr).map(parseArg);
        let result;
        try { result = TAX_FUNCS[name].apply(null, args); }
        catch (err) { result = NaN; }
        return Number.isFinite(result) ? String(result) : '(0/0)'; // 실패하면 NaN이 되어 결과칸에 '오류'로 표시됨
      });
    }
    return out;
  };

  window.CALC_TAX_FUNC_NAMES = Object.keys(TAX_FUNCS);

  // ============================================================
  // 아래부터는 "독립 세액계산기 화면"(항목별 입력폼)이 쓰는, 문자열 수식 파싱을 전혀 거치지 않는
  // 구조화된 계산 함수들이다. gs-backend/Code.js의 toolCalculateTransferTax/GiftTax/InheritanceTax와
  // 세율·공제 로직을 최대한 동일하게 맞췄다(같은 상수·같은 계산 순서). 세법 개정으로 위쪽 브래킷·공제
  // 상수를 고치면 이 아래 함수들도 자동으로 같은 상수를 쓰므로 별도로 손댈 부분은 없다.
  // ============================================================

  function fullYearsElapsed(startDateStr, endDateStr) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    let years = end.getUTCFullYear() - start.getUTCFullYear();
    const monthDiff = end.getUTCMonth() - start.getUTCMonth();
    const dayDiff = end.getUTCDate() - start.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years--;
    return years;
  }

  function longTermRate(years) {
    if (years < 3) return 0;
    return Math.min(0.30, years * 0.02);
  }

  function longTermRate1House(ownYears, liveYears) {
    const ownRate = ownYears >= 3 ? Math.min(0.40, ownYears * 0.04) : 0;
    const liveRate = liveYears >= 2 ? Math.min(0.40, liveYears * 0.04) : 0;
    return ownRate + liveRate;
  }

  // 장기임대주택 등 장기보유특별공제 특례([별지 제84호서식] 코드04·05, 조특법 §97의3·§97의4)
  function rentalLongTermRate(type, holdingYears, rentalYears) {
    const ry = Number(rentalYears) || 0;
    if (type === 'rental_general') {
      if (ry >= 10) return 0.70;
      if (ry >= 8) return 0.50;
      return 0;
    }
    if (type === 'rental_long') {
      let addRate = 0;
      if (ry >= 10) addRate = 0.10;
      else if (ry >= 9) addRate = 0.08;
      else if (ry >= 8) addRate = 0.06;
      else if (ry >= 7) addRate = 0.04;
      else if (ry >= 6) addRate = 0.02;
      return longTermRate(holdingYears) + addRate;
    }
    return null;
  }

  // §21① — 원칙은 max(기초공제+그밖의인적공제, 5억원)이나, "다만, 제67조 또는 국세기본법§45의3에
  // 따른 신고가 없는 경우에는 5억원을 공제한다"는 단서가 있다 — 무신고시 인적공제 합계가 3억원을
  // 넘어도 5억원 고정이지 그 초과분까지 인정되는 것이 아니다.
  function basicOrLumpSumDeduction(personalDeductionSum, isUnreported) {
    if (isUnreported) return 500000000;
    return Math.max(500000000, 200000000 + (Number(personalDeductionSum) || 0));
  }

  // 거래 1건의 "소득금액 단계까지"만 계산한다(기본공제·세율 적용 전) — 다건 합산에서
  // 여러 거래를 먼저 이 단계까지 계산해두고, 합산 가능한 것끼리 묶어 기본공제·누진세를
  // 한 번에 적용하기 위한 building block이다. 단일거래 계산에도 그대로 재사용한다.
  // 의제취득일(소득세법 시행령§162④) — 1985.1.1. 전에 취득한 자산은 1985.1.1.에 취득한 것으로 보아
  // 보유기간(장기보유특별공제·단기양도세율 판정)을 계산한다. 취득가액 자체(환산취득가액 등)에는
  // 영향을 주지 않고, 오직 보유기간 산정에만 적용된다.
  function deemedAcquisitionDate(dateStr) {
    return dateStr && dateStr < '1985-01-01' ? '1985-01-01' : dateStr;
  }
  function transferAssetCore(t) {
    const transferPrice = Number(t.transferPrice);
    let necessaryExpenses = Number(t.necessaryExpenses) || 0;
    const acquisitionPrice = Number(t.acquisitionPrice);
    if (!transferPrice || transferPrice <= 0) return { error: '양도가액이 필요합니다.' };
    // 재건축·재개발 특례는 취득가액 대신 종전자산 취득가액(originalAssetAcquisitionPrice)·권리가액(rightsValue)을
    // 별도로 쓰므로, 이 경우에는 일반 취득가액 필수 검증을 적용하지 않는다(아래 재건축 분기에서 별도 검증).
    if (!t.isReconstructionRights && (!acquisitionPrice || acquisitionPrice < 0)) return { error: '취득가액이 필요합니다.' };
    if (!t.acquisitionDate || !t.transferDate) return { error: '취득일과 양도일이 필요합니다.' };

    const holdingYears = fullYearsElapsed(deemedAcquisitionDate(t.acquisitionDate), t.transferDate);
    if (holdingYears < 0) return { error: '양도일이 취득일보다 빠릅니다.' };

    // 개산공제율(시행령§163⑥1호·2호) — 원칙 3/100(3%)이나, 미등기양도자산은 3/1000(0.3%)로 10분의 1이다.
    if (!t.necessaryExpenses && t.useEstimatedNecessaryExpense && Number(t.acquisitionStandardPriceForExpense) > 0) {
      const estimatedExpenseRate = t.isUnregisteredTransfer ? 0.003 : 0.03;
      necessaryExpenses = Math.round(Number(t.acquisitionStandardPriceForExpense) * estimatedExpenseRate);
    }

    const assetType = t.assetType === 'house' ? 'house' : (t.assetType === 'presale_right' ? 'presale_right' : 'other');
    const isPresaleRight = assetType === 'presale_right';
    const isReconstruction = !!t.isReconstructionRights;
    const isOneHouse = !isPresaleRight && !isReconstruction && !!t.isOneHouseOneFamily;
    // 소득세법§95③은 §89①3호 단서의 고가주택뿐 아니라 §89①4호 각목외 단서의 "고가조합원입주권"
    // (1세대가 1조합원입주권만 보유하는 등 원래는 전액 비과세 요건을 충족하나 양도가액이 12억원을 초과하는
    // 경우)도 함께 "대통령령으로 정하는 바에 따라 계산"하도록 위임한다. 소득세법시행령§160①②는 문언상
    // "고가주택"만 명시하고 조합원입주권을 별도로 규정하지 않는데, 이는 입법미비로 보이며 §160①②의
    // 12억초과 비율안분 산식을 고가조합원입주권에도 유추적용하는 것이 §95③의 위임 취지에 맞다(준공 전
    // 조합원입주권 자체 양도, 즉 아래 §166①1호 분기에만 해당 — 준공 후 신축주택은 이미 "주택" 자체이므로
    // §160① 문언 그대로 적용된다). 다른 비과세 요건 없이 무조건 적용하면 정책 취지에 반하므로, 원래
    // §89①4호 요건(1세대1조합원입주권)을 충족한다는 전제가 있을 때만(isOneMemberRightOneFamily) 적용한다.
    const isOneMemberRightOnly = isReconstruction && !t.isCompletedNewHousing && !!t.isOneMemberRightOneFamily;
    const isUnregistered = !!t.isUnregisteredTransfer;
    const gainBeforeDeduction = transferPrice - acquisitionPrice - necessaryExpenses;

    if (isUnregistered) {
      return { holdingYears, isUnregistered: true, gainBeforeDeduction, transferPrice, acquisitionPrice, necessaryExpenses, assetType, raw: t };
    }

    if (isOneHouse && transferPrice <= 1200000000) {
      return { holdingYears, exempt: true, transferPrice, acquisitionPrice, necessaryExpenses, assetType, raw: t };
    }
    if (isOneMemberRightOnly && transferPrice <= 1200000000) {
      return { holdingYears, exempt: true, transferPrice, acquisitionPrice, necessaryExpenses, assetType, raw: t };
    }

    let taxableGain = gainBeforeDeduction;
    let ltRate = 0;
    let isRentalSpecial = false;
    let isMultiHouseSurcharge = false;
    const multiHouseCount = Number(t.multiHouseCount) || 0;
    let incomeAmount, longTermDeductionAmount, reconstructionDetail = null;

    if (isReconstruction) {
      // 소득세법시행령§166①②③ — 재개발·재건축 조합원이 기존건물과 그 부수토지를 제공하고 취득한
      // 조합원입주권(준공 전) 또는 신축주택(준공 후)을 청산금 납부하고 양도하는 경우의 양도차익 계산.
      const rightsValue = Number(t.rightsValue) || 0;
      const settlementPaid = Number(t.settlementPaid) || 0;
      const managementDispositionDate = t.managementDispositionDate;
      if (!rightsValue) return { error: '재건축·재개발 특례: 권리가액(종전자산평가액)이 필요합니다.' };
      if (!managementDispositionDate) return { error: '재건축·재개발 특례: 관리처분계획인가일이 필요합니다.' };

      // §166③ — 기존건물과 그 부수토지의 취득가액을 확인할 수 없는 경우의 환산:
      // 평가액 × (취득일 현재 기준시가 ÷ 관리처분계획등인가일 현재 기준시가)
      let originalAcqPrice = Number(t.originalAssetAcquisitionPrice) || 0;
      if (t.useConvertedRightsBaseAcquisitionPrice) {
        const acqStd = Number(t.originalAcquisitionStandardPrice) || 0;
        const apprStd = Number(t.approvalDateStandardPrice) || 0;
        if (acqStd > 0 && apprStd > 0) originalAcqPrice = Math.round(rightsValue * acqStd / apprStd);
      }
      const originalNecessaryExpenses = Number(t.originalNecessaryExpenses) || 0;

      // 관리처분계획등인가전양도차익 = (평가액-기존건물취득가액)-필요경비(§97①2·3호 또는 §163⑥)
      const gainBeforeApproval = (rightsValue - originalAcqPrice) - originalNecessaryExpenses;
      // 관리처분계획등인가후양도차익 = 양도가액-(평가액+납부한청산금)-필요경비(§97①2·3호)
      const gainAfterApproval = transferPrice - (rightsValue + settlementPaid) - necessaryExpenses;

      const holdingYearsBeforeApproval = fullYearsElapsed(deemedAcquisitionDate(t.acquisitionDate), managementDispositionDate);
      const holdingYearsSinceApproval = fullYearsElapsed(managementDispositionDate, t.transferDate);

      if (!t.isCompletedNewHousing) {
        // ①1호 — 조합원입주권 자체를 준공 전 양도. §95②단서 "관리처분계획인가...전 토지분 또는 건물분의
        // 양도차익으로 한정"에 따라 장기보유특별공제는 인가전양도차익에만 적용되고, 인가후양도차익에는 전혀 적용되지 않는다.
        taxableGain = gainBeforeApproval + gainAfterApproval;
        const ltRateBefore = longTermRate(holdingYearsBeforeApproval);
        longTermDeductionAmount = Math.round(Math.max(0, gainBeforeApproval) * ltRateBefore);
        incomeAmount = taxableGain - longTermDeductionAmount;
        reconstructionDetail = { 구분: '조합원입주권(준공전) 양도 — §166①1호', 관리처분계획등인가전양도차익: Math.round(gainBeforeApproval), 관리처분계획등인가후양도차익: Math.round(gainAfterApproval), 인가전_보유기간_년: holdingYearsBeforeApproval, 인가전_장특공제율: ltRateBefore };
        // 소득세법§95③ 후단(고가조합원입주권) — 시행령§160①②의 12억초과 비율안분을 유추적용한다(시행령이
        // 조합원입주권 몫을 명시하지 않은 입법미비로 보아, isOneMemberRightOnly 정의부의 근거 주석 참조).
        // 1세대1조합원입주권 비과세 요건 충족을 전제로 했을 때만 적용한다.
        if (isOneMemberRightOnly && transferPrice > 1200000000) {
          const highValueRatio = (transferPrice - 1200000000) / transferPrice;
          taxableGain = taxableGain * highValueRatio;
          longTermDeductionAmount = Math.round(longTermDeductionAmount * highValueRatio);
          incomeAmount = taxableGain - longTermDeductionAmount;
          reconstructionDetail.고가조합원입주권_12억초과비율 = highValueRatio;
        }
      } else {
        // ②1호 — 준공된 신축주택을 양도(청산금납부). 인가후양도차익을 "청산금납부분"과 "기존건물분"으로
        // (청산금납부액:평가액) 비율로 재분배하고, 각각 다른 보유기간(§166⑤2호가·나목)으로 장특공제를 적용한다.
        const denom = rightsValue + settlementPaid;
        const settlementPortionGain = denom > 0 ? gainAfterApproval * settlementPaid / denom : 0;
        const existingPortionGain = (gainAfterApproval - settlementPortionGain) + gainBeforeApproval;
        taxableGain = settlementPortionGain + existingPortionGain;
        const ltRateSettlement = longTermRate(holdingYearsSinceApproval);
        const ltRateExisting = longTermRate(holdingYears);
        longTermDeductionAmount = Math.round(Math.max(0, settlementPortionGain) * ltRateSettlement) + Math.round(Math.max(0, existingPortionGain) * ltRateExisting);
        incomeAmount = taxableGain - longTermDeductionAmount;
        reconstructionDetail = {
          구분: '신축주택(준공후) 양도 — §166②1호', 청산금납부분양도차익: Math.round(settlementPortionGain), 기존건물분양도차익: Math.round(existingPortionGain),
          청산금분_보유기간_년: holdingYearsSinceApproval, 청산금분_장특공제율: ltRateSettlement, 기존건물분_보유기간_년: holdingYears, 기존건물분_장특공제율: ltRateExisting
        };
        // §95③·시행령§160① — 신축주택은 문언상 "주택"이므로 고가주택(12억 초과)이면 §95①에 따른
        // 양도차익·§95②에 따른 장기보유특별공제액 모두에 "(양도가액-12억)/양도가액" 비율을 곱해
        // 12억 초과분에 해당하는 부분만 과세한다. 조합원입주권 자체(준공 전, 위 ①분기)의 고가조합원입주권
        // 특례는 위 466번째 줄 부근(isOneMemberRightOnly 분기)에서 별도로 적용했다.
        if (transferPrice > 1200000000) {
          const highValueRatio = (transferPrice - 1200000000) / transferPrice;
          taxableGain = taxableGain * highValueRatio;
          longTermDeductionAmount = Math.round(longTermDeductionAmount * highValueRatio);
          incomeAmount = taxableGain - longTermDeductionAmount;
          reconstructionDetail.고가주택_12억초과비율 = highValueRatio;
        }
      }
      ltRate = taxableGain !== 0 ? longTermDeductionAmount / taxableGain : 0;
    } else if (isPresaleRight) {
      // 소득세법§95②은 장기보유특별공제를 §94①1호 자산(부동산)과 조합원입주권에만 인정하고
      // 분양권은 열거하지 않으므로, 분양권은 보유기간과 무관하게 장특공제를 전혀 받지 못한다.
      ltRate = 0;
    } else if (isOneHouse) {
      taxableGain = gainBeforeDeduction * (transferPrice - 1200000000) / transferPrice;
      ltRate = longTermRate1House(holdingYears, Number(t.residenceYears) || 0);
    } else {
      ltRate = longTermRate(holdingYears);
    }

    if (!isReconstruction && !isPresaleRight) {
      const rentalRate = rentalLongTermRate(t.rentalSpecialType, holdingYears, t.rentalYears);
      isRentalSpecial = rentalRate !== null;
      if (isRentalSpecial) ltRate = rentalRate;

      // 소득세법시행령§167조의3①12호의2(및 §167조의4③6의2·§167조의10①12호의2·§167조의11①12호,
      // 부칙 제4조 — 2022.5.10 이후 양도분부터 적용) — 조정대상지역 다주택자라도 "2026년 5월 9일까지
      // 양도하는 주택"(2년 이상 보유)은 한시적으로 중과(세율가산+장특공제배제)를 적용하지 않는다.
      const isMultiHouseSurchargeExcluded = !!t.transferDate && t.transferDate <= '2026-05-09';
      isMultiHouseSurcharge = !isOneHouse && !isRentalSpecial && !!t.isAdjustedArea && multiHouseCount >= 2 && !isMultiHouseSurchargeExcluded;
      if (isMultiHouseSurcharge) ltRate = 0;
    }

    if (!isReconstruction) {
      longTermDeductionAmount = Math.round(taxableGain * ltRate);
      incomeAmount = taxableGain - longTermDeductionAmount;
    }
    // 분양권(§104①1호·2호·3호)은 보유기간과 무관하게 항상 60%(1년미만 70%) 단일세율이고 기본세율
    // 누진과세 대상이 될 수 없으므로(1호가 별도로 분양권 60%를 정함), 합산(pooling) 대상에서 제외한다.
    const isPoolable = !isPresaleRight && holdingYears >= 2; // 2년 이상 보유 → 기본세율(누진) 대상, 합산 가능

    const convertedBuildingAcquisitionValueForPenalty = Number(t.convertedBuildingAcquisitionValueForPenalty) || 0;
    const conversionValuePenalty = (t.isNewBuildingWithin5Years && convertedBuildingAcquisitionValueForPenalty > 0)
      ? Math.round(convertedBuildingAcquisitionValueForPenalty * 0.05) : 0;

    return {
      reconstructionDetail,
      holdingYears, exempt: false, isUnregistered: false, isPoolable,
      transferPrice, acquisitionPrice, necessaryExpenses, assetType, isOneHouse, isRentalSpecial,
      gainBeforeDeduction, taxableGain, longTermRate: ltRate, longTermDeductionAmount, incomeAmount,
      isMultiHouseSurcharge, multiHouseCount, isNonBusinessLand: !!t.isNonBusinessLand, isEightYearFarmland: !!t.isEightYearFarmland,
      conversionValuePenalty, pensionAccountContribution: Number(t.pensionAccountContribution) || 0,
      raw: t
    };
  }

  // 단일 거래 양도소득세 — gs-backend toolCalculateTransferTax와 동일 로직(기본공제 1건 전액 적용).
  window.calculateTransferTaxSingleJS = function (t) {
    const core = transferAssetCore(t);
    if (core.error) return { error: core.error };

    if (core.isUnregistered) {
      const tax = Math.max(0, Math.round(core.gainBeforeDeduction * 0.7));
      const local = Math.round(tax * 0.1);
      return {
        입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 미등기양도: true },
        양도차익: Math.round(core.gainBeforeDeduction), 과세표준: Math.max(0, Math.round(core.gainBeforeDeduction)),
        적용세율_설명: '미등기양도자산 — 장기보유특별공제·기본공제 배제, 70% 단일세율',
        산출세액: tax, 지방소득세: local, 납부세액_합계: tax + local
      };
    }
    if (core.exempt) {
      const downContractDiff = Number(t.downContractPriceDifference) || 0;
      if (downContractDiff > 0) {
        const wouldBeResult = window.calculateTransferTaxSingleJS(Object.assign({}, t, { isOneHouseOneFamily: false, downContractPriceDifference: 0 }));
        const wouldBeTax = (wouldBeResult && typeof wouldBeResult.납부세액_합계 === 'number') ? wouldBeResult.납부세액_합계 : 0;
        const clawback = Math.min(wouldBeTax, downContractDiff);
        return {
          입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
          비과세여부: false, 다운계약서_비과세배제: true,
          비과세미적용시_산출세액: wouldBeTax, 계약서_실거래_차액: downContractDiff,
          납부세액: clawback, 납부세액_합계: clawback
        };
      }
      return {
        입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
        비과세여부: true, 납부세액: 0
      };
    }

    const basicDeduction = 2500000;
    const taxBase = Math.max(0, core.incomeAmount - basicDeduction);
    let calculatedTax, appliedRateNote;
    const surchargeNotes = [];
    if (core.assetType === 'presale_right') {
      // §104①1호·2호·3호 — 분양권은 보유기간 1년 미만 70%, 1년 이상은 무조건 60%(기본세율 누진 적용 없음).
      const rate = core.holdingYears < 1 ? 0.70 : 0.60;
      calculatedTax = Math.round(taxBase * rate);
      appliedRateNote = '분양권 — ' + (core.holdingYears < 1 ? '보유기간 1년 미만 70%' : '60%') + ' 단일세율 적용(장기보유특별공제·기본세율누진 배제)';
    } else if (core.holdingYears < 1) {
      const rate = core.assetType === 'house' ? 0.70 : 0.50;
      calculatedTax = Math.round(taxBase * rate);
      appliedRateNote = '보유기간 1년 미만 단기세율 ' + (rate * 100) + '% 적용';
    } else if (core.holdingYears < 2) {
      const rate = core.assetType === 'house' ? 0.60 : 0.40;
      calculatedTax = Math.round(taxBase * rate);
      appliedRateNote = '보유기간 1년 이상 2년 미만 단기세율 ' + (rate * 100) + '% 적용';
    } else {
      calculatedTax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS);
      appliedRateNote = '보유기간 2년 이상 — 기본세율(누진 6~45%) 적용';
      if (core.isMultiHouseSurcharge) {
        const rate = core.multiHouseCount >= 3 ? 0.30 : 0.20;
        const amt = Math.round(taxBase * rate);
        calculatedTax += amt;
        surchargeNotes.push('다주택자 중과(+' + (rate * 100) + '%p): +' + amt + '원');
      }
      if (core.isNonBusinessLand) {
        const amt = Math.round(taxBase * 0.10);
        calculatedTax += amt;
        surchargeNotes.push('비사업용토지 가산(+10%p): +' + amt + '원');
      }
    }
    let farmlandReduction = 0;
    if (core.isEightYearFarmland) {
      farmlandReduction = Math.min(calculatedTax, 100000000);
      calculatedTax -= farmlandReduction;
    }
    // 조특법§77①(2025.3.14 개정) — 현금보상 15%, 채권보상 20%, 3년만기특약 35%, 5년만기특약 45%.
    const COMPENSATION_REDUCTION_RATES = { cash: 0.15, bond: 0.20, bond_3y: 0.35, bond_5y: 0.45 };
    let compensationReduction = 0;
    if (COMPENSATION_REDUCTION_RATES[t.compensationType] !== undefined) {
      compensationReduction = Math.round(calculatedTax * COMPENSATION_REDUCTION_RATES[t.compensationType]);
      calculatedTax -= compensationReduction;
    }
    const downContractDiff2 = Number(t.downContractPriceDifference) || 0;
    let downContractClawback = 0;
    if (downContractDiff2 > 0 && (farmlandReduction + compensationReduction) > 0) {
      downContractClawback = Math.min(farmlandReduction + compensationReduction, downContractDiff2);
      calculatedTax += downContractClawback;
    }
    // 조특법§99의14①(2024.12.31 신설) — "연금계좌 납입액의 100분의 10에 상당하는 금액을...공제하며,
    // 공제세액은 산출세액을 한도로 한다." 양도차익이나 1억원 한도는 법 조문에 없다.
    const pensionAccountCreditRaw = core.pensionAccountContribution > 0 ? Math.round(Number(core.pensionAccountContribution) * 0.1) : 0;
    const pensionAccountCredit = Math.min(pensionAccountCreditRaw, Math.max(0, calculatedTax));
    const eFilingCredit = t.isSelfElectronicFiling ? Math.min(20000, Math.max(0, calculatedTax - pensionAccountCredit)) : 0;

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(t.filingStatus) !== -1 ? t.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(calculatedTax, filingStatus, !!t.isFraudulent, t.underreportedTaxAmount, t.unpaidDays, Number(t.unpaidTaxForLatePenalty));
    const localIncomeTax = Math.round(calculatedTax * 0.1);
    const totalTax = Math.max(0, calculatedTax - pensionAccountCredit - eFilingCredit + core.conversionValuePenalty
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax);
    return {
      입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
      조합원입주권_재건축상세: core.reconstructionDetail,
      양도차익: Math.round(core.reconstructionDetail ? core.taxableGain : core.gainBeforeDeduction), 과세대상양도차익: Math.round(core.taxableGain),
      장기보유특별공제율: core.longTermRate, 장기보유특별공제액: core.longTermDeductionAmount,
      양도소득금액: Math.round(core.incomeAmount), 기본공제: basicDeduction, 과세표준: taxBase,
      적용세율_설명: appliedRateNote, 세율가산_내역: surchargeNotes, 자경농지감면액: farmlandReduction,
      수용감면액: compensationReduction, 다운계약서_감면배제_추징액: downContractClawback,
      장기임대주택특례_적용여부: core.isRentalSpecial,
      산출세액: calculatedTax, 연금계좌세액공제: pensionAccountCredit, 전자신고세액공제: eFilingCredit,
      환산취득가액가산세: core.conversionValuePenalty,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      지방소득세: localIncomeTax, 납부세액_합계: totalTax
    };
  };

  // 다건 양도소득세 합산(확정신고 개념) — 2년 이상 보유·미등기 아님 거래끼리는 소득금액을 합산해서
  // 기본공제 250만원을 "전체 중 1회만" 적용하고 하나의 과세표준에 누진세율을 적용한다.
  // 단기양도(2년 미만)·미등기양도는 성격상 합산 누진세 대상이 아니므로 건별로 따로 계산해서 더한다.
  // 다주택중과·비사업용토지 가산액은 합산 그룹 안에서도 자산별 소득금액(기본공제 차감 전) 기준으로
  // 개별 계산해서 더하고, 8년자경 감면은 합산세액을 자산별 소득금액 비중으로 안분한 뒤 자산당 1억 한도로 적용한다
  // — 이는 실제 시행령상 안분규정과 100% 일치를 보장하지 않는 단순화이니, 특례가 여러 건 섞인 복잡한 합산은
  // 결과를 참고용으로만 쓰고 반드시 재검토할 것.
  window.calculateTransferTaxMultiJS = function (transactions, filingParams) {
    if (!Array.isArray(transactions) || !transactions.length) return { error: '거래를 1건 이상 입력하세요.' };
    filingParams = filingParams || {};
    const cores = transactions.map(function (t, idx) {
      const c = transferAssetCore(t);
      c.idx = idx;
      return c;
    });
    const errorOne = cores.find(function (c) { return c.error; });
    if (errorOne) return { error: (errorOne.idx + 1) + '번째 거래: ' + errorOne.error };

    const exempt = cores.filter(function (c) { return c.exempt; });
    const unregistered = cores.filter(function (c) { return c.isUnregistered; });
    const active = cores.filter(function (c) { return !c.exempt && !c.isUnregistered; });
    const pooled = active.filter(function (c) { return c.isPoolable; });
    const shortTerm = active.filter(function (c) { return !c.isPoolable; });

    const poolIncomeSum = pooled.reduce(function (s, c) { return s + c.incomeAmount; }, 0);
    const basicDeductionUsedInPool = pooled.length > 0;
    const poolTaxBase = Math.max(0, poolIncomeSum - (basicDeductionUsedInPool ? 2500000 : 0));
    const poolBaseTax = progressiveTax(poolTaxBase, TRANSFER_TAX_BRACKETS);

    let poolSurchargeTotal = 0;
    const assetNotes = [];
    pooled.forEach(function (c) {
      let rate = 0; const notes = [];
      if (c.isMultiHouseSurcharge) { rate += (c.multiHouseCount >= 3 ? 0.30 : 0.20); notes.push('다주택중과'); }
      if (c.isNonBusinessLand) { rate += 0.10; notes.push('비사업용토지'); }
      if (rate > 0) {
        const amt = Math.round(c.incomeAmount * rate);
        poolSurchargeTotal += amt;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: notes.join('+'), 가산액: amt });
      }
    });

    let poolTaxWithSurcharge = poolBaseTax + poolSurchargeTotal;

    let farmlandReductionTotal = 0;
    const reductionByIdx_ = {};
    pooled.forEach(function (c) {
      if (c.isEightYearFarmland && poolIncomeSum > 0) {
        const share = Math.round(poolTaxWithSurcharge * (c.incomeAmount / poolIncomeSum));
        const reduction = Math.min(share, 100000000);
        farmlandReductionTotal += reduction;
        reductionByIdx_[c.idx] = (reductionByIdx_[c.idx] || 0) + reduction;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: '8년자경농지감면(안분)', 감면액: reduction });
      }
    });
    poolTaxWithSurcharge = Math.max(0, poolTaxWithSurcharge - farmlandReductionTotal);

    // 공익사업용 토지 등 수용감면(조특법§77①, 2025.3.14 개정, 안분) — 소득금액 비중으로 배분한 세액에 보상유형별 비율을 곱한다.
    const COMPENSATION_REDUCTION_RATES_M = { cash: 0.15, bond: 0.20, bond_3y: 0.35, bond_5y: 0.45 };
    let compensationReductionTotal = 0;
    pooled.forEach(function (c) {
      const rate = COMPENSATION_REDUCTION_RATES_M[c.raw.compensationType];
      if (rate !== undefined && poolIncomeSum > 0) {
        const share = Math.round(poolTaxWithSurcharge * (c.incomeAmount / poolIncomeSum));
        const reduction = Math.round(share * rate);
        compensationReductionTotal += reduction;
        reductionByIdx_[c.idx] = (reductionByIdx_[c.idx] || 0) + reduction;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: '수용감면(안분)', 감면액: reduction });
      }
    });
    poolTaxWithSurcharge = Math.max(0, poolTaxWithSurcharge - compensationReductionTotal);

    // 다운계약서 등 거짓 계약으로 위 감면을 받은 경우(소득세법§91②) — 거래별 MIN(그 거래에 배분된 감면액, 계약서·실거래 차액)을 배제·추징한다.
    let downContractClawbackTotal = 0;
    pooled.forEach(function (c) {
      const diff = Number(c.raw.downContractPriceDifference) || 0;
      const red = reductionByIdx_[c.idx] || 0;
      if (diff > 0 && red > 0) {
        const clawback = Math.min(red, diff);
        downContractClawbackTotal += clawback;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 특례: '다운계약서 감면배제', 추징액: clawback });
      }
    });
    poolTaxWithSurcharge += downContractClawbackTotal;

    // 비과세 거래인데 다운계약서로 비과세를 적용받은 경우 — 비과세 미적용시 세액과 차액 중 작은 금액을 별도로 추징한다.
    let exemptClawbackTotal = 0;
    exempt.forEach(function (c) {
      const diff = Number(c.raw.downContractPriceDifference) || 0;
      if (diff > 0) {
        const wouldBe = window.calculateTransferTaxSingleJS(Object.assign({}, c.raw, { isOneHouseOneFamily: false, downContractPriceDifference: 0 }));
        const wouldBeTax = (wouldBe && typeof wouldBe.납부세액_합계 === 'number') ? wouldBe.납부세액_합계 : 0;
        const clawback = Math.min(wouldBeTax, diff);
        exemptClawbackTotal += clawback;
        assetNotes.push({ idx: c.idx, 구분: '비과세거래(개별)', 특례: '다운계약서 비과세배제', 추징액: clawback });
      }
    });

    let usedBasicOnShort = !basicDeductionUsedInPool ? false : true; // 이미 장기그룹에서 썼으면 단기에서 또 쓰지 않음
    const shortResults = shortTerm.map(function (c) {
      const bd = (!usedBasicOnShort) ? 2500000 : 0;
      if (bd) usedBasicOnShort = true;
      const base = Math.max(0, c.incomeAmount - bd);
      const rate = (c.assetType === 'house' || c.assetType === 'presale_right')
        ? (c.holdingYears < 1 ? 0.70 : 0.60) : (c.holdingYears < 1 ? 0.50 : 0.40);
      const tax = Math.round(base * rate);
      assetNotes.push({ idx: c.idx, 구분: '단기양도(개별)', 소득금액: Math.round(c.incomeAmount), 기본공제적용: bd > 0, 세율: rate, 세액: tax });
      return tax;
    });
    const shortTaxTotal = shortResults.reduce(function (s, v) { return s + v; }, 0);

    const unregisteredResults = unregistered.map(function (c) {
      const tax = Math.max(0, Math.round(c.gainBeforeDeduction * 0.7));
      assetNotes.push({ idx: c.idx, 구분: '미등기양도(개별)', 양도차익: Math.round(c.gainBeforeDeduction), 세액: tax });
      return tax;
    });
    const unregisteredTaxTotal = unregisteredResults.reduce(function (s, v) { return s + v; }, 0);

    const conversionValuePenaltyTotal = active.reduce(function (s, c) { return s + (c.conversionValuePenalty || 0); }, 0);

    // 조특법§99의14① — "연금계좌 납입액의 100분의 10에 상당하는 금액을...공제하며, 공제세액은
    // 산출세액을 한도로 한다." 양도차익이나 1억원 한도는 법 조문에 없다 — 납입액×10%를 먼저 구하고,
    // 그 합계를 (풀 전체) 산출세액으로 한 번만 캡한다(개별 거래별 산출세액이 따로 없는 합산 구조이므로).
    const pensionAccountCreditRaw = active.reduce(function (s, c) {
      return s + (c.pensionAccountContribution > 0 ? Math.round(Number(c.pensionAccountContribution) * 0.1) : 0);
    }, 0);

    // exemptClawbackTotal(다운계약서 비과세배제 추징액)은 calculateTransferTaxSingleJS의 완전 계산 결과(지방소득세 포함)를
    // 상한으로 삼아 MIN한 값이라 이미 지방소득세가 녹아 있으므로, 아래 totalCalculatedTax에는 포함하지 않고
    // (그러면 다시 10% 지방소득세가 얹혀 이중계산된다) 최종 합계에만 그대로 더한다.
    const totalCalculatedTax = poolTaxWithSurcharge + shortTaxTotal + unregisteredTaxTotal;
    const pensionAccountCreditTotal = Math.min(pensionAccountCreditRaw, Math.max(0, totalCalculatedTax));
    const eFilingCredit = filingParams.isSelfElectronicFiling ? Math.min(20000, Math.max(0, totalCalculatedTax - pensionAccountCreditTotal)) : 0;
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(filingParams.filingStatus) !== -1 ? filingParams.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(totalCalculatedTax, filingStatus, !!filingParams.isFraudulent, filingParams.underreportedTaxAmount, filingParams.unpaidDays, Number(filingParams.unpaidTaxForLatePenalty));
    const localIncomeTax = Math.round(totalCalculatedTax * 0.1);
    const grandTotal = Math.max(0, totalCalculatedTax - pensionAccountCreditTotal - eFilingCredit + conversionValuePenaltyTotal
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax + exemptClawbackTotal);

    return {
      거래건수: transactions.length, 비과세건수: exempt.length,
      합산대상_장기거래건수: pooled.length, 합산소득금액: Math.round(poolIncomeSum),
      기본공제: basicDeductionUsedInPool ? 2500000 : (usedBasicOnShort && shortTerm.length ? 2500000 : 0),
      합산과세표준: poolTaxBase, 합산기본세액: poolBaseTax, 합산가산액: poolSurchargeTotal, 합산자경감면액: farmlandReductionTotal,
      합산수용감면액: compensationReductionTotal, 다운계약서_감면배제_추징액: downContractClawbackTotal, 비과세거래_다운계약서_추징액: exemptClawbackTotal,
      합산그룹_산출세액: poolTaxWithSurcharge,
      단기거래_산출세액_합계: shortTaxTotal, 미등기거래_산출세액_합계: unregisteredTaxTotal,
      산출세액_합계: totalCalculatedTax,
      연금계좌세액공제_합계: pensionAccountCreditTotal, 전자신고세액공제: eFilingCredit,
      환산취득가액가산세_합계: conversionValuePenaltyTotal,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      지방소득세: localIncomeTax, 납부세액_합계: grandTotal,
      자산별_내역: assetNotes,
      안내: '2년 이상 보유·특례 없는(또는 다주택중과·비사업용토지만 해당하는) 거래는 소득금액을 합산해 기본공제(250만원, 전체 1회)와 누진세율을 함께 적용했습니다. 단기양도(2년 미만)·미등기양도는 합산 누진세 대상이 아니라 건별로 따로 계산해 더했습니다. 다주택중과·비사업용토지 가산액과 8년자경농지 감면액은 자산별 소득금액 비중으로 계산한 근사치이니, 특례가 여러 건 섞인 복잡한 합산은 결과를 참고용으로만 쓰고 반드시 재검토하세요. 신고불성실·납부지연가산세는 전체 확정신고 기준(산출세액 합계)으로 한 번만 계산했습니다.'
    };
  };

  // 토지·건물 등 일괄양도시 안분계산 (소득세법 시행령 §166④) — 토지와 건물 등을 함께 양도(취득)하면서
  // 각각의 가액이 구분되지 않은 경우, 감정가액이 있으면 감정가액 비율로, 없으면 기준시가 비율로 안분한다.
  // method: 'standard_price'(기준시가·감정가액 비율 안분), 'standard_price_vat'(위와 동일하되 건물분에서 부가세를 분리),
  //         'area'(면적 비율 안분), 'acq_expense_together'(취득가액·필요경비도 양도가액과 같은 비율로 함께 안분),
  //         'acq_expense_separate'(취득가액은 취득시점 기준시가 비율로, 양도가액·필요경비는 양도시점 기준시가 비율로 각각 안분)
  window.calculateProportionalAllocationJS = function (input) {
    input = input || {};
    const assets = Array.isArray(input.assets) ? input.assets : [];
    if (assets.length < 2) return { error: '안분계산은 2개 이상의 자산을 입력해야 합니다.' };
    const totalTransferPrice = Number(input.totalTransferPrice) || 0;
    if (totalTransferPrice <= 0) return { error: '총 양도가액이 필요합니다.' };
    const totalAcquisitionPrice = Number(input.totalAcquisitionPrice) || 0;
    const totalNecessaryExpenses = Number(input.totalNecessaryExpenses) || 0;
    const method = input.method || 'standard_price';

    function weightOf(a, useAcquisition) {
      if (method === 'area') return Number(a.area) || 0;
      const w = useAcquisition ? Number(a.standardPriceAcquisition) || 0 : Number(a.standardPriceTransfer) || 0;
      return w;
    }

    const transferWeights = assets.map(function (a) { return weightOf(a, false); });
    const transferWeightSum = transferWeights.reduce(function (s, w) { return s + w; }, 0);
    if (transferWeightSum <= 0) return { error: (method === 'area' ? '면적' : '양도시점 기준시가(또는 감정가액)') + '을 자산마다 입력해야 합니다.' };

    const acqWeights = assets.map(function (a) { return weightOf(a, true); });
    const acqWeightSum = acqWeights.reduce(function (s, w) { return s + w; }, 0);

    const results = assets.map(function (a, i) {
      const transferRatio = transferWeights[i] / transferWeightSum;
      let allocatedTransferPrice = Math.round(totalTransferPrice * transferRatio);

      let allocatedAcquisitionPrice = 0, allocatedNecessaryExpenses = 0, acqRatio = transferRatio;
      if (method === 'acq_expense_together') {
        allocatedAcquisitionPrice = Math.round(totalAcquisitionPrice * transferRatio);
        allocatedNecessaryExpenses = Math.round(totalNecessaryExpenses * transferRatio);
      } else if (method === 'acq_expense_separate') {
        if (acqWeightSum <= 0) return { error: (i + 1) + '번째 자산: 취득시점 기준시가가 필요합니다(취득/필요경비 각각 안분).' };
        acqRatio = acqWeights[i] / acqWeightSum;
        allocatedAcquisitionPrice = Math.round(totalAcquisitionPrice * acqRatio);
        allocatedNecessaryExpenses = Math.round(totalNecessaryExpenses * transferRatio);
      }

      let vatAmount = 0, transferPriceExVat = allocatedTransferPrice;
      if (method === 'standard_price_vat' && a.isBuilding) {
        vatAmount = Math.round(allocatedTransferPrice * 10 / 110);
        transferPriceExVat = allocatedTransferPrice - vatAmount;
      }

      return {
        label: a.label || ('자산' + (i + 1)),
        안분비율_양도: transferRatio,
        안분비율_취득: method === 'acq_expense_separate' ? acqRatio : undefined,
        양도가액_안분액: allocatedTransferPrice,
        부가세: vatAmount || undefined,
        양도가액_부가세제외: method === 'standard_price_vat' ? transferPriceExVat : undefined,
        취득가액_안분액: (method === 'acq_expense_together' || method === 'acq_expense_separate') ? allocatedAcquisitionPrice : undefined,
        필요경비_안분액: (method === 'acq_expense_together' || method === 'acq_expense_separate') ? allocatedNecessaryExpenses : undefined
      };
    });
    const errorOne = results.find(function (r) { return r && r.error; });
    if (errorOne) return { error: errorOne.error };

    return {
      방식: method,
      총양도가액: totalTransferPrice,
      자산별_안분결과: results,
      안내: '소득세법 시행령 §166④에 따라, 토지와 건물 등을 함께 양도(취득)했는데 각각의 가액 구분이 불분명한 경우 감정가액이 있으면 감정가액 비율로, 없으면 기준시가 비율로 안분합니다(면적 비율 안분은 그 비율을 면적으로 대체한 실무상 방식이며, 계약서·감정가액 등으로 실제 구분이 가능하면 안분계산 자체가 필요 없으니 우선 그 가액을 그대로 쓰세요). "취득/필요경비 함께 안분"은 양도시점 비율을 취득가액·필요경비에도 동일하게 적용한 것이고, "각각 안분"은 취득가액에 취득시점 기준시가 비율을 별도로 적용한 것이니 사안에 맞는 방식을 선택하세요.'
    };
  };

  // ============================================================
  // 건물 기준시가 (2026.1.1. 시행 국세청 고시 제2025-39호) — gs-backend/Code.js의
  // toolCalculateBuildingStandardPrice와 동일한 표·계산식. 매년 1월 새 고시로 갱신되므로
  // 실제 신고 전에는 반드시 홈택스 공식 계산기로 재검증할 것.
  // ============================================================
  const BUILDING_BASE_PRICE_2026 = 860000;

  const BUILDING_STRUCTURE_TABLE = [
    { name: '통나무조', index: 135, group: 'I' }, { name: '목구조', index: 115, group: 'I' },
    { name: '철골(철골철근)콘크리트조', index: 110, group: 'I' }, { name: '철근콘크리트조', index: 100, group: 'I' },
    { name: '석조', index: 100, group: 'I' }, { name: '프리캐스트 콘크리트조', index: 100, group: 'I' },
    { name: '라멘조', index: 100, group: 'I' }, { name: '목조', index: 100, group: 'II' },
    { name: 'ALC조', index: 100, group: 'II' }, { name: '스틸하우스조', index: 100, group: 'II' },
    { name: '연와조', index: 95, group: 'II' }, { name: '철골조', index: 95, group: 'II' },
    { name: '보강콘크리트조', index: 95, group: 'II' }, { name: '보강블록조', index: 95, group: 'II' },
    { name: '시멘트벽돌조', index: 90, group: 'II' }, { name: '와이어패널조', index: 90, group: 'II' },
    { name: '황토조', index: 90, group: 'III' }, { name: '시멘트블록조', index: 90, group: 'III' },
    { name: '철골조 중 조립식패널(EPS패널)', index: 85, group: 'II' }, { name: '조립식패널조', index: 80, group: 'III' },
    { name: '경량철골조', index: 79, group: 'III' }, { name: '석회 및 흙벽돌조', index: 60, group: 'III' },
    { name: '돌담 및 토담조', index: 60, group: 'III' }, { name: '철파이프조', index: 59, group: 'IV' },
    { name: '컨테이너건물', index: 59, group: 'IV' }
  ];

  const BUILDING_USE_TABLE = [
    { no: 1, desc: '아파트', index: 110 }, { no: 2, desc: '단독주택(노인복지주택 제외)', index: 100 },
    { no: 3, desc: '관광호텔(5성급·4성급)', index: 140 }, { no: 4, desc: '호텔(일반숙박시설)', index: 130 },
    { no: 5, desc: '관광호텔(3성급이하)·생활숙박시설·외국인관광 도시민박·한옥체험시설', index: 120 },
    { no: 6, desc: '여관(모텔 포함)', index: 112 }, { no: 7, desc: '다중생활시설', index: 105 }, { no: 8, desc: '여인숙', index: 100 },
    { no: 9, desc: '백화점', index: 135 }, { no: 10, desc: '대형점·쇼핑센터·복합쇼핑몰', index: 125 },
    { no: 11, desc: '일반상점(바닥 1,000~3,000㎡)', index: 95 }, { no: 12, desc: '도매시장·전통시장·경매장', index: 85 },
    { no: 13, desc: '여객자동차터미널·철도·공항·항만시설', index: 120 }, { no: 14, desc: '무도장', index: 140 },
    { no: 15, desc: '유흥주점·카지노영업소', index: 130 }, { no: 16, desc: '테마파크업 시설', index: 120 },
    { no: 17, desc: '단란주점', index: 115 }, { no: 18, desc: '무도학원', index: 90 },
    { no: 19, desc: '집회장(경마·경륜·경정 장외발매소 등)', index: 130 }, { no: 20, desc: '예식장·공연장·집회장(공회당 등)', index: 115 },
    { no: 21, desc: '동물원·식물원·수족관·전시장', index: 110 }, { no: 22, desc: '관람장(경마장·경륜장·체육관 등)', index: 105 },
    { no: 23, desc: '종교시설(교회·성당·사찰 등)', index: 100 }, { no: 24, desc: '골프장·스키장·수영장·볼링장 등', index: 125 },
    { no: 25, desc: '기타 체육시설', index: 105 }, { no: 26, desc: '종합병원', index: 125 },
    { no: 27, desc: '일반병원·치과병원·한방병원·정신병원·요양병원', index: 110 }, { no: 28, desc: '오피스텔(주거용·사무용)', index: 135 },
    { no: 29, desc: '사무소·금융업소·출판사 등', index: 115 }, { no: 30, desc: '방송국·통신용시설', index: 110 },
    { no: 31, desc: '야외음악당·휴게소·공원유원지 부수시설', index: 110 }, { no: 32, desc: '학원·교습소', index: 107 },
    { no: 33, desc: '학교·교육원·연구소·도서관', index: 102 }, { no: 34, desc: '아동관련시설·노인복지시설(양로원 제외)', index: 109 },
    { no: 35, desc: '고아원·노인주거복지시설(양로원 등)·경로당', index: 85 }, { no: 36, desc: '청소년수련관·유스호스텔 등', index: 110 },
    { no: 37, desc: '목욕장(3,000㎡이상)', index: 130 }, { no: 38, desc: '목욕장(1,000~3,000㎡)', index: 115 },
    { no: 39, desc: '목욕장(1,000㎡미만)', index: 110 }, { no: 40, desc: '풍속영업시설(단란주점 150㎡미만 등)', index: 105 },
    { no: 41, desc: '제1종·제2종 근린생활시설(일반)', index: 95 }, { no: 42, desc: '화장시설·봉안당', index: 130 },
    { no: 43, desc: '동물화장시설·동물건조장', index: 105 }, { no: 44, desc: '장례식장', index: 115 },
    { no: 45, desc: '동물 전용 장례식장', index: 105 }, { no: 46, desc: '지식산업센터(아파트형공장)', index: 115 },
    { no: 47, desc: '냉동공장·반도체 및 평면디스플레이 공장', index: 100 }, { no: 48, desc: '기타 제조·가공·수리 공장', index: 78 },
    { no: 49, desc: '원자력 발전시설', index: 300 }, { no: 50, desc: '발전소', index: 90 },
    { no: 51, desc: '냉동창고·냉장창고', index: 105 }, { no: 52, desc: '냉동·냉장창고외 창고·물류터미널', index: 75 },
    { no: 53, desc: '주유소·가스충전소·위험물저장시설', index: 90 }, { no: 54, desc: '하수처리시설·고물상·폐기물시설', index: 80 },
    { no: 55, desc: '자동차매매장·운전학원·정비학원', index: 75 }, { no: 56, desc: '세차장·폐차장·정비공장·차고', index: 67 },
    { no: 57, desc: '주차장(자주식, 주택 차고 제외)', index: 60 }, { no: 58, desc: '가축용운동시설·동물검역소 등', index: 70 },
    { no: 59, desc: '축사·가축시설·도축장·작물재배사', index: 55 }, { no: 60, desc: '화초·분재 온실 등 식물관련시설', index: 50 },
    { no: 61, desc: '기계식주차전용빌딩(별도계산식 — 6,000,000원×잔가율(30년)×주차대수)', index: null }
  ];

  const BUILDING_ADJUSTMENT_TABLE = [
    { no: 1, desc: '지붕: 슬래브·기와·아스팔트슁글 등 (구조지수 100미만일 때만)', index: 100 },
    { no: 2, desc: '지붕: 패널·유리·슬레이트', index: 80 }, { no: 3, desc: '지붕: 함석·자연석·천막·초가 등', index: 60 },
    { no: 4, desc: '최고층수 5층 이하', index: 90 }, { no: 5, desc: '최고층수 6~10층', index: 100 },
    { no: 6, desc: '최고층수 11~15층', index: 110 }, { no: 7, desc: '최고층수 16~20층', index: 120 }, { no: 8, desc: '최고층수 21층 이상', index: 130 },
    { no: 9, desc: '연면적 1천㎡미만', index: 90 }, { no: 10, desc: '연면적 1천~5천㎡', index: 100 },
    { no: 11, desc: '연면적 5천~1만㎡', index: 110 }, { no: 12, desc: '연면적 1만~5만㎡', index: 120 }, { no: 13, desc: '연면적 5만㎡이상', index: 130 },
    { no: 14, desc: '지능형건축물 인증 3·4등급', index: 110 }, { no: 15, desc: '지능형건축물 인증 1·2등급', index: 120 },
    { no: 16, desc: '단독주택 연면적 264~331㎡', index: 120 }, { no: 17, desc: '단독주택 연면적 331㎡이상', index: 140 },
    { no: 18, desc: '공동주택 전유면적 149~215㎡', index: 120 }, { no: 19, desc: '공동주택 전유면적 215㎡이상', index: 140 },
    { no: 20, desc: '상가 1층', index: 120 }, { no: 21, desc: '상가 2층', index: 105 },
    { no: 22, desc: '최고층수 5층이하 건물의 지하1층', index: 80 }, { no: 23, desc: '최고층수 5층이하 건물의 지하2층이상', index: 70 },
    { no: 24, desc: '부속 주차장·기계실·보일러실·대피소 등', index: 60 }, { no: 25, desc: '주택간이부속건물(창고·화장실 등)', index: 60 },
    { no: 26, desc: '1회 개축(개축부분에 한함)', index: 110 }, { no: 27, desc: '2회 이상 개축(개축부분에 한함)', index: 120 },
    { no: 28, desc: '무벽건물 무벽면적비율 1/4~2/4', index: 80 }, { no: 29, desc: '무벽건물 무벽면적비율 2/4~3/4', index: 70 }, { no: 30, desc: '무벽건물 무벽면적비율 3/4이상', index: 60 },
    { no: 31, desc: '구조안전진단 B급(보조부재 경미결함)', index: 90 }, { no: 32, desc: '구조안전진단 C급(보조부재 손상)', index: 80 },
    { no: 33, desc: '구조안전진단 D급(주요부재 손상)', index: 60 }, { no: 34, desc: '구조안전진단 E급(주요부재 심각한 결함)', index: 30 },
    { no: 35, desc: '법령상 철거대상(사용 중)', index: 30 }, { no: 36, desc: '법령상 철거대상(미사용)', index: 0 }
  ];

  const BUILDING_DEPRECIATION_TABLE = {
    I:  { 2026:1.000,2025:0.982,2024:0.964,2023:0.946,2022:0.928,2021:0.910,2020:0.892,2019:0.874,2018:0.856,2017:0.838,2016:0.820,2015:0.802,2014:0.784,2013:0.766,2012:0.748,2011:0.730,2010:0.712,2009:0.694,2008:0.676,2007:0.658,2006:0.640,2005:0.622,2004:0.604,2003:0.586,2002:0.568,2001:0.550,2000:0.532,1999:0.514,1998:0.496,1997:0.478,1996:0.460,1995:0.442,1994:0.424,1993:0.406,1992:0.388,1991:0.370,1990:0.352,1989:0.334,1988:0.316,1987:0.298,1986:0.280,1985:0.262,1984:0.244,1983:0.226,1982:0.208,1981:0.190,1980:0.172,1979:0.154,1978:0.136,1977:0.118 },
    II: { 2026:1.0000,2025:0.9775,2024:0.9550,2023:0.9325,2022:0.9100,2021:0.8875,2020:0.8650,2019:0.8425,2018:0.8200,2017:0.7975,2016:0.7750,2015:0.7525,2014:0.7300,2013:0.7075,2012:0.6850,2011:0.6625,2010:0.6400,2009:0.6175,2008:0.5950,2007:0.5725,2006:0.5500,2005:0.5275,2004:0.5050,2003:0.4825,2002:0.4600,2001:0.4375,2000:0.4150,1999:0.3925,1998:0.3700,1997:0.3475,1996:0.3250,1995:0.3025,1994:0.2800,1993:0.2575,1992:0.2350,1991:0.2125,1990:0.1900,1989:0.1675,1988:0.1450,1987:0.1225,1986:0.1000 },
    III:{ 2026:1.000,2025:0.970,2024:0.940,2023:0.910,2022:0.880,2021:0.850,2020:0.820,2019:0.790,2018:0.760,2017:0.730,2016:0.700,2015:0.670,2014:0.640,2013:0.610,2012:0.580,2011:0.550,2010:0.520,2009:0.490,2008:0.460,2007:0.430,2006:0.400,2005:0.370,2004:0.340,2003:0.310,2002:0.280,2001:0.250,2000:0.220,1999:0.190,1998:0.160,1997:0.130,1996:0.100 },
    IV: { 2026:1.000,2025:0.955,2024:0.910,2023:0.865,2022:0.820,2021:0.775,2020:0.730,2019:0.685,2018:0.640,2017:0.595,2016:0.550,2015:0.505,2014:0.460,2013:0.415,2012:0.370,2011:0.325,2010:0.280,2009:0.235,2008:0.190,2007:0.145,2006:0.100 }
  };
  const BUILDING_DEPRECIATION_MIN_YEAR = { I: 1976, II: 1986, III: 1996, IV: 2006 };

  const BUILDING_LOCATION_TABLE = [
    { max: 20000, index: 78 }, { max: 30000, index: 83 }, { max: 50000, index: 85 }, { max: 70000, index: 86 },
    { max: 100000, index: 87 }, { max: 130000, index: 88 }, { max: 150000, index: 89 }, { max: 180000, index: 90 },
    { max: 200000, index: 91 }, { max: 300000, index: 92 }, { max: 350000, index: 93 }, { max: 500000, index: 94 },
    { max: 650000, index: 97 }, { max: 800000, index: 100 }, { max: 1000000, index: 102 }, { max: 1200000, index: 104 },
    { max: 1600000, index: 106 }, { max: 2000000, index: 118 }, { max: 2500000, index: 114 }, { max: 3000000, index: 116 },
    { max: 3500000, index: 118 }, { max: 4000000, index: 120 }, { max: 4500000, index: 122 }, { max: 5000000, index: 124 },
    { max: 5500000, index: 126 }, { max: 6000000, index: 128 }, { max: 7000000, index: 130 }, { max: 8000000, index: 132 },
    { max: 9000000, index: 134 }, { max: 10000000, index: 137 }, { max: 15000000, index: 140 }, { max: 20000000, index: 143 },
    { max: 25000000, index: 146 }, { max: 30000000, index: 149 }, { max: 35000000, index: 152 }, { max: 40000000, index: 155 },
    { max: 45000000, index: 158 }, { max: 50000000, index: 161 }, { max: 55000000, index: 164 }, { max: 60000000, index: 167 },
    { max: 65000000, index: 170 }, { max: 70000000, index: 173 }, { max: 75000000, index: 176 }, { max: 80000000, index: 179 },
    { max: Infinity, index: 182 }
  ];

  window.BUILDING_STRUCTURE_TABLE = BUILDING_STRUCTURE_TABLE;
  window.BUILDING_USE_TABLE = BUILDING_USE_TABLE;
  window.BUILDING_ADJUSTMENT_TABLE = BUILDING_ADJUSTMENT_TABLE;

  function lookupBuildingLocationIndex(pricePerSqm) {
    for (let i = 0; i < BUILDING_LOCATION_TABLE.length; i++) {
      if (pricePerSqm < BUILDING_LOCATION_TABLE[i].max) return BUILDING_LOCATION_TABLE[i].index;
    }
    return BUILDING_LOCATION_TABLE[BUILDING_LOCATION_TABLE.length - 1].index;
  }

  function lookupBuildingDepreciationRate(group, builtYear) {
    const table = BUILDING_DEPRECIATION_TABLE[group];
    if (!table) return null;
    if (builtYear >= 2026) return table[2026];
    if (table[builtYear] !== undefined) return table[builtYear];
    if (builtYear < BUILDING_DEPRECIATION_MIN_YEAR[group]) return table[BUILDING_DEPRECIATION_MIN_YEAR[group]];
    return null;
  }

  window.calculateBuildingStandardPriceJS = function (structureName, useNo, officialLandPricePerSqm, builtYear, floorAreaSqm, taxType, adjustmentNos) {
    const structure = BUILDING_STRUCTURE_TABLE.find(function (s) { return s.name === structureName; });
    if (!structure) return { error: '구조명을 찾을 수 없습니다: ' + structureName };
    const use = BUILDING_USE_TABLE.find(function (u) { return u.no === useNo; });
    if (!use) return { error: '용도번호를 찾을 수 없습니다: ' + useNo };
    if (use.index === null) return { error: '용도번호 61(기계식주차전용빌딩)은 별도 계산식이 필요합니다: 기준시가 = 6,000,000원 × 경과연수별잔가율(내용연수 30년) × 주차대수. 이 도구로는 계산할 수 없습니다.' };
    if (!officialLandPricePerSqm || officialLandPricePerSqm <= 0) return { error: '건물 부속토지의 ㎡당 개별공시지가가 필요합니다.' };
    if (!builtYear) return { error: '신축연도가 필요합니다.' };
    if (!floorAreaSqm || floorAreaSqm <= 0) return { error: '건물 면적(㎡)이 필요합니다.' };
    if (taxType !== 'transfer' && taxType !== 'inheritance_gift') return { error: 'taxType은 transfer 또는 inheritance_gift여야 합니다.' };

    const locationIndex = lookupBuildingLocationIndex(officialLandPricePerSqm);
    const depreciationRate = lookupBuildingDepreciationRate(structure.group, builtYear);
    if (depreciationRate === null) return { error: '해당 신축연도의 경과연수별잔가율을 찾을 수 없습니다.' };

    let adjustmentMultiplier = 1;
    const appliedAdjustments = [];
    if (taxType === 'inheritance_gift' && Array.isArray(adjustmentNos)) {
      for (let i = 0; i < adjustmentNos.length; i++) {
        const adj = BUILDING_ADJUSTMENT_TABLE.find(function (a) { return a.no === adjustmentNos[i]; });
        if (!adj) return { error: '조정률 번호를 찾을 수 없습니다: ' + adjustmentNos[i] };
        adjustmentMultiplier *= (adj.index / 100);
        appliedAdjustments.push({ 번호: adj.no, 내용: adj.desc, 지수: adj.index });
      }
    }

    let pricePerSqm = BUILDING_BASE_PRICE_2026 * (structure.index / 100) * (use.index / 100) * (locationIndex / 100) * depreciationRate * adjustmentMultiplier;
    pricePerSqm = Math.floor(pricePerSqm / 1000) * 1000;
    const totalPrice = Math.floor(pricePerSqm * floorAreaSqm);

    return {
      입력값: {
        구조: structure.name, 구조지수: structure.index, 경과연수그룹: structure.group,
        용도번호: use.no, 용도: use.desc, 용도지수: use.index,
        '공시지가_㎡당': officialLandPricePerSqm, 위치지수: locationIndex,
        신축연도: builtYear, 경과연수별잔가율: depreciationRate,
        세목: taxType === 'transfer' ? '양도소득세(조정률 미적용)' : '상속세·증여세',
        적용된_조정률: appliedAdjustments
      },
      '㎡당_금액': pricePerSqm, '건물면적_㎡': floorAreaSqm, 건물기준시가: totalPrice,
      안내: '이 값은 건물가격만 포함하며, 부속토지가격은 별도입니다. 2026.1.1. 시행 국세청 고시 기준이며 매년 1월 갱신되므로 신고 시점의 최신 고시 여부를 반드시 확인하세요.'
    };
  };

  // 층별/부속시설별 상세 계산 — 각 행을 위 함수로 개별 계산해 합산한다.
  window.calculateBuildingStandardPriceMultiJS = function (rows, officialLandPricePerSqm, taxType) {
    if (!Array.isArray(rows) || rows.length === 0) return { error: '층 또는 부속시설을 1개 이상 입력해야 합니다.' };
    const rowResults = [];
    let totalPrice = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const r = window.calculateBuildingStandardPriceJS(row.structureName, row.useNo, officialLandPricePerSqm, row.builtYear, row.floorAreaSqm, taxType, row.adjustmentNos);
      if (r.error) return { error: (i + 1) + '번째 행(' + (row.label || '') + '): ' + r.error };
      totalPrice += r.건물기준시가;
      rowResults.push(Object.assign({ 순번: i + 1, 구분: row.label || ('행' + (i + 1)) }, r));
    }
    return {
      행별_결과: rowResults, 건물기준시가_합계: totalPrice,
      안내: '각 층(또는 부속시설)을 개별 계산해 합산한 값입니다. 부속토지 공시지가는 건물 전체에 공통으로 적용했습니다. 부속 주차장·기계실·보일러실·대피소 등은 용도를 그에 맞게(예: 57.주차장) 선택해 별도 행으로 추가하세요.'
    };
  };

  // 혼인·출산 증여재산공제 (상증세법 §53의2, 2024.1.1. 이후) — 혼인·출산 합쳐 평생통산 1억원 한도.
  function marriageOrBirthGiftDeduction(eligibleGiftAmount, priorUsedAmount) {
    const remaining = Math.max(0, 100000000 - (Number(priorUsedAmount) || 0));
    return Math.min(Math.max(0, Number(eligibleGiftAmount) || 0), remaining);
  }

  // 무신고·과소신고·납부지연가산세 (국세기본법 §47의2~§47의4) — 일반 20%/10%, 부정행위 40%,
  // 납부지연 1일 10만분의22(시행령 개정 시 바뀔 수 있음).
  function giftFilingPenalties(taxAfterCredit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxOverride) {
    let unreportedPenalty = 0, underreportedPenalty = 0;
    if (filingStatus === 'unreported') {
      unreportedPenalty = Math.round(taxAfterCredit * (isFraudulent ? 0.40 : 0.20));
    } else if (filingStatus === 'underreported') {
      underreportedPenalty = Math.round((Number(underreportedTaxAmount) || 0) * (isFraudulent ? 0.40 : 0.10));
    }
    const base = Number.isFinite(unpaidTaxOverride) ? unpaidTaxOverride : taxAfterCredit;
    const latePenalty = Math.round(base * (Number(unpaidDays) || 0) * 0.00022);
    return { unreportedPenalty: unreportedPenalty, underreportedPenalty: underreportedPenalty, latePenalty: latePenalty };
  }

  // 증여세 — gs-backend toolCalculateGiftTax와 동일 로직([별지 제10호서식] 기준).
  window.calculateGiftTaxJS = function (p) {
    p = p || {};
    const giftAmount = Number(p.giftAmount);
    if (!giftAmount || giftAmount <= 0) return { error: '증여재산가액이 필요합니다.' };
    if (['배우자', '직계존속', '직계비속', '기타친족', '기타'].indexOf(p.relation) === -1) {
      return { error: '관계를 배우자/직계존속/직계비속/기타친족/기타 중에서 선택하세요.' };
    }
    const priorGiftAmount = Number(p.priorGiftAmount) || 0;
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    const isGenerationSkip = !!p.isGenerationSkip;
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    // §47③ — 배우자간 또는 직계존비속간 부담부증여는 수증자가 채무를 인수했더라도 "인수되지
    // 않은 것"으로 추정한다(그래서 원칙적으로 채무 공제를 못 받는다). 국가·지자체 채무 등
    // 객관적으로 인수 사실이 인정되는 채무만 예외적으로 공제 가능(isDebtObjectivelyProven).
    const isCloseRelationBurdenGift = (p.relation === '배우자' || p.relation === '직계존속' || p.relation === '직계비속');
    const debtDeductionDenied = isCloseRelationBurdenGift && !p.isDebtObjectivelyProven;
    const debtAssumedAmount = debtDeductionDenied ? 0 : Math.min(Number(p.debtAssumedAmount) || 0, giftAmount);
    const nonTaxableAmount = Number(p.nonTaxableAmount) || 0;
    const publicInterestOrgAmount = Number(p.publicInterestOrgAmount) || 0;
    const publicTrustAmount = Number(p.publicTrustAmount) || 0;
    const disabledTrustAmount = Number(p.disabledTrustAmount) || 0;
    const netGiftAmount = Math.max(0, giftAmount - debtAssumedAmount - nonTaxableAmount - publicInterestOrgAmount - publicTrustAmount - disabledTrustAmount);

    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);

    // §55①3호 — 명의신탁재산 증여의제(1호)·일감몰아주기등 이익의 증여의제(2호)를 제외한
    // "합산배제증여재산"은 §53(관계별공제)·§53의2(혼인출산공제)·§54(재해손실공제)를 적용하지 않고
    // "증여재산가액 - 3천만원"만 과세표준으로 한다(감정평가수수료는 모든 호에 공통 적용). 4호(일반증여)와는
    // 완전히 별개 산식이므로 10년내 동일인 증여 합산(priorGiftAmount)도 적용하지 않는다(§47②단서).
    let relationDeduction = 0, marriageBirthDeduction = 0, disasterLossDeduction = 0, aggregationExclusionDeduction = 0, taxBase;
    if (p.isExcludedFromAggregation) {
      aggregationExclusionDeduction = 30000000;
      taxBase = Math.max(0, netGiftAmount - aggregationExclusionDeduction - appraisalFeeDeduction);
    } else {
      // §53 본문 — "그 증여세 과세가액에서 공제받을 금액과 수증자가 증여받기 전 10년 이내에 공제받은
      // 금액을 합한 금액이 [한도]를 초과하면 초과분은 공제하지 아니한다" — 관계별 한도는 "이번 한 번"이
      // 아니라 "10년 합산" 기준이므로, 그 기간 중 이미 쓴 공제액을 이번 한도에서 미리 차감해야 한다.
      relationDeduction = Math.max(0, giftPropertyDeduction(p.relation, !!p.isMinor) - (Number(p.priorRelationDeductionUsed) || 0));
      marriageBirthDeduction = (p.isMarriageGift || p.isBirthGift)
        ? marriageOrBirthGiftDeduction(netGiftAmount, p.priorMarriageOrBirthDeductionUsed) : 0;
      disasterLossDeduction = Number(p.disasterLossAmount) || 0;
      const totalDeduction = relationDeduction + marriageBirthDeduction + appraisalFeeDeduction + disasterLossDeduction;
      taxBase = Math.max(0, netGiftAmount + priorGiftAmount - totalDeduction);
    }
    const taxBeforePremium = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    // 세대생략 증여 할증과세 (상증세법§57, 시행령§46의3②) — 산출세액 전액이 아니라 "수증자의 부모를
    // 제외한 직계존속으로부터 증여받은 재산가액/총증여재산가액" 비율만큼만 할증하고, 종전에 이미 납부한
    // 할증과세액이 있으면 그만큼 뺀다(10년 합산으로 동일 신고에 조부모분·부모분이 섞여 있을 수 있어서).
    // generationSkipGiftAmount를 넣지 않으면(구버전 호환) 증여재산 전액이 세대생략분이라고 보아 비율 1.
    const totalGiftAmountForSkipRatio = netGiftAmount + priorGiftAmount;
    const generationSkipRatio = isGenerationSkip
      ? (p.generationSkipGiftAmount != null && totalGiftAmountForSkipRatio > 0
        ? Math.min(1, Math.max(0, Number(p.generationSkipGiftAmount) || 0) / totalGiftAmountForSkipRatio)
        : 1)
      : 0;
    const premiumRate = isGenerationSkip ? (p.generationSkipOver2Billion ? 0.4 : 0.3) : 0;
    const priorPaidGenerationSkipPremium = Number(p.priorPaidGenerationSkipPremium) || 0;
    const premiumAmount = Math.max(0, Math.round(taxBeforePremium * generationSkipRatio * premiumRate) - priorPaidGenerationSkipPremium);
    const taxAfterPremium = taxBeforePremium + premiumAmount;

    // §58② — 기납부세액공제(§58①)는 무제한이 아니라 "증여세산출세액 × (가산한 증여재산의 과세표준 ÷
    // 이번 증여세 과세표준)"을 한도로 한다. priorGiftTaxableBase는 그 사전증여 당시 산정된 과세표준(가산한
    // 증여재산의 과세표준)이며, 없으면(0) 한도가 사실상 적용되지 않는다(구 입력과의 호환).
    const priorGiftTaxableBase = Number(p.priorGiftTaxableBase) || 0;
    const priorGiftCreditLimit = (taxBase > 0 && priorGiftTaxableBase > 0)
      ? Math.round(taxAfterPremium * Math.min(1, priorGiftTaxableBase / taxBase))
      : taxAfterPremium;
    const priorGiftTaxCredit = Math.min(priorPaidTax, taxAfterPremium, priorGiftCreditLimit);
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const otherCreditsAmount = Number(p.otherCreditsAmount) || 0;
    const taxAfterPriorCredit = Math.max(0, taxAfterPremium - priorGiftTaxCredit - foreignTaxPaidAmount - otherCreditsAmount);
    const reportCredit = reportedInTime ? Math.round(taxAfterPriorCredit * 0.03) : 0;
    const taxAfterCredit = taxAfterPriorCredit - reportCredit;

    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

    const interestAmount = Number(p.interestAmount) || 0;
    const publicInterestOrgPenalty = Number(p.publicInterestOrgPenalty) || 0;
    const museumDeferredTaxAmount = Number(p.museumDeferredTaxAmount) || 0;
    const businessSuccessionDeferredTaxAmount = Number(p.businessSuccessionDeferredTaxAmount) || 0;
    const farmlandGiftTaxExemptionAmount = Number(p.farmlandGiftTaxExemptionAmount) || 0;

    const finalTax = Math.max(0, taxAfterCredit + interestAmount + publicInterestOrgPenalty
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
      - museumDeferredTaxAmount - businessSuccessionDeferredTaxAmount - farmlandGiftTaxExemptionAmount);

    return {
      증여재산가액: giftAmount, 인수채무액: debtAssumedAmount,
      채무공제_배제여부: debtDeductionDenied,
      채무공제_배제사유: debtDeductionDenied ? '§47③ 배우자·직계존비속간 부담부증여는 채무 인수를 객관적으로 입증(국가·지자체 채무 등)하지 못하면 인수되지 않은 것으로 추정 — 채무액이 공제에서 제외됨' : '',
      비과세재산가액: nonTaxableAmount, 공익법인출연재산가액: publicInterestOrgAmount, 공익신탁재산가액: publicTrustAmount, 장애인신탁재산가액: disabledTrustAmount,
      순수증여재산가액: netGiftAmount,
      증여재산공제: relationDeduction, 혼인출산증여재산공제: marriageBirthDeduction,
      합산배제증여재산공제: aggregationExclusionDeduction, 감정평가수수료공제: appraisalFeeDeduction, 재해손실공제: disasterLossDeduction,
      과세표준: taxBase, 산출세액_할증전: taxBeforePremium, 세대생략할증_적용비율: isGenerationSkip ? generationSkipRatio : null, 세대생략할증액: premiumAmount,
      산출세액_할증후: taxAfterPremium, 기납부세액공제: priorGiftTaxCredit, 기납부세액공제_비율한도: priorGiftCreditLimit,
      외국납부세액공제: foreignTaxPaidAmount, 그밖의공제감면세액: otherCreditsAmount,
      신고세액공제: reportCredit, 이자상당액: interestAmount, 공익법인등관련가산세: publicInterestOrgPenalty,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty,
      납부지연가산세: penalties.latePenalty,
      박물관자료등징수유예세액: museumDeferredTaxAmount, 가업승계납부유예세액: businessSuccessionDeferredTaxAmount,
      영농자녀증여농지세액감면: farmlandGiftTaxExemptionAmount,
      납부세액: finalTax
    };
  };

  // 상속세 — gs-backend toolCalculateInheritanceTax와 동일 로직([별지 제9호서식] 기준).
  window.calculateInheritanceTaxJS = function (p) {
    p = p || {};
    const taxableEstateAmount = Number(p.taxableEstateAmount);
    if (!taxableEstateAmount || taxableEstateAmount <= 0) return { error: '상속세 과세가액이 필요합니다.' };

    const disposalItems = Array.isArray(p.disposalPresumptionItems) ? p.disposalPresumptionItems : [];
    const disposalPresumptionDetail = disposalItems.map(function (item) {
      return {
        구분: item.category || '',
        '1년이내_인출액': Number(item.oneYearAmount) || 0, '2년이내_인출액': Number(item.twoYearAmount) || 0,
        추정상속재산가액: presumedInheritedFromDisposal(item)
      };
    });
    const disposalPresumptionTotal = disposalPresumptionDetail.reduce(function (s, d) { return s + d.추정상속재산가액; }, 0);
    const nonTaxableAmount = Number(p.nonTaxableAmount) || 0;
    const publicInterestOrgAmount = Number(p.publicInterestOrgAmount) || 0;
    const publicTrustAmount = Number(p.publicTrustAmount) || 0;
    const effectiveEstateAmount = Math.max(0, taxableEstateAmount - nonTaxableAmount - publicInterestOrgAmount - publicTrustAmount) + disposalPresumptionTotal;

    const childCount = Number(p.childCount) || 0;
    const minorHeirRemainingYears = Number(p.minorHeirRemainingYears) || 0;
    const elderlyHeirCount = Number(p.elderlyHeirCount) || 0;
    const disabledHeirRemainingYears = Number(p.disabledHeirRemainingYears) || 0;
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;

    // 피상속인 거주자/비거주자 구분 — §18(기초공제 2억원)은 "거주자나 비거주자의 사망으로"라고 해서
    // 양쪽 다 적용되지만, §18의2(가업상속공제)·§18의3(영농상속공제)·§19(배우자공제)·§20(그 밖의 인적공제)·
    // §21(일괄공제)·§22(금융재산상속공제)·§23(재해손실공제)·§23의2(동거주택상속공제)는 전부 "거주자의
    // 사망으로 상속이 개시되는 경우"로 한정되어 있어 비거주자 피상속인이면 기초공제 2억원만 받는다.
    // 장례비용공제도 §14①3호(공과금 등을 상속재산가액에서 빼는 규정)가 거주자 한정이고, §14②(비거주자)
    // 열거항목(해당 상속재산 관련 공과금·담보채무·국내사업장 장부상 공과금·채무)에 장례비용이 없으므로
    // 비거주자는 장례비용공제도 받지 못한다. 감정평가수수료공제(§25①2호)는 거주자 요건이 없는 별도
    // 항목이라 비거주자도 그대로 적용한다.
    const isDecedentResident = p.isDecedentResident !== false;

    const personalDeduction = isDecedentResident
      ? (childCount * 50000000 + minorHeirRemainingYears * 10000000 + elderlyHeirCount * 50000000 + disabledHeirRemainingYears * 10000000)
      : 0;
    const basicOrLumpSum = isDecedentResident ? basicOrLumpSumDeduction(personalDeduction, filingStatus === 'unreported') : 200000000;

    const estateValueForSpouseLimit = effectiveEstateAmount - (Number(p.priorGiftedAmountIncludedInEstate) || 0);
    const spouseLimit = spouseInheritanceLimit(estateValueForSpouseLimit, p.nonHeirBequestAmount, p.giftToHeirsWithin10Years, Number(p.spouseLegalShareRatio) || 0, p.spouseTaxableBaseOfPriorGift);
    const spouseDeduction = (isDecedentResident && p.hasSpouse) ? spouseInheritanceDeduction(p.spouseActualInheritedAmount, spouseLimit) : 0;

    const financialDeduction = isDecedentResident ? financialAssetInheritanceDeduction(p.netFinancialAssets) : 0;
    const cohabitingHouseDeduction = (isDecedentResident && p.hasCohabitingHouseDeduction) ? Math.min(Number(p.cohabitingHouseValue) || 0, 600000000) : 0;
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossDeduction = isDecedentResident ? (Number(p.disasterLossAmount) || 0) : 0;
    // 장례비용공제(§14①3호) — 실제 지출액 증빙이 없으면 500만원, 있으면 500만~1000만원 범위에서 인정.
    // 봉안시설·자연장지 사용금액은 별도로 500만원 한도까지 추가 공제. (비거주자는 위 안내대로 전액 불가)
    const funeralCostInput = Number(p.funeralCostAmount) || 0;
    const funeralGeneralDeduction = !isDecedentResident ? 0 : (funeralCostInput > 0 ? Math.min(Math.max(funeralCostInput, 5000000), 10000000) : 5000000);
    const funeralNicheDeduction = isDecedentResident ? Math.min(Number(p.funeralNicheCostAmount) || 0, 5000000) : 0;
    const funeralDeduction = funeralGeneralDeduction + funeralNicheDeduction;
    const businessInheritanceDetail = isDecedentResident ? businessInheritanceDeductionDetailed(p) : null;
    const businessInheritanceDeduction = isDecedentResident ? (businessInheritanceDetail ? businessInheritanceDetail.deductionAmount : (Number(p.businessInheritanceDeduction) || 0)) : 0;
    const farmingInheritanceDetail = isDecedentResident ? farmingInheritanceDeductionDetailed(p) : null;
    const farmingInheritanceDeduction = isDecedentResident ? (farmingInheritanceDetail ? farmingInheritanceDetail.deductionAmount : (Number(p.farmingInheritanceDeduction) || 0)) : 0;

    let totalDeduction = basicOrLumpSum + spouseDeduction + financialDeduction + cohabitingHouseDeduction + appraisalFeeDeduction + disasterLossDeduction
      + funeralDeduction + businessInheritanceDeduction + farmingInheritanceDeduction;

    // 사전증여재산 상속인별 상세(§28②·시행령§3①1호 정밀계산 및 §24 종합한도 분모에 공통 사용) — 상속인
    // 명부에 상속인별로 입력된 사전증여 내역을 그대로 쓴다. 배우자분만이 아니라 전체 합계를 쓴다(§24).
    const priorGiftHeirs = Array.isArray(p.priorGiftHeirs) ? p.priorGiftHeirs : [];
    const priorGiftTaxableBaseTotal = priorGiftHeirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0);

    // §24단서 — "제3호(사전증여재산 과세표준상당액)는 상속세 과세가액이 5억원을 초과하는 경우에만
    // 적용한다" — 5억 이하면 1호·2호만 차감하고 3호(사전증여분)는 차감하지 않는다.
    const overallDeductionLimit = Math.max(0, effectiveEstateAmount
      - (Number(p.nonHeirBequestAmount) || 0)
      - (effectiveEstateAmount > 500000000 ? priorGiftTaxableBaseTotal : 0)
      - (Number(p.disclaimedShareRedistributedAmount) || 0));
    const overallLimitApplied = totalDeduction > overallDeductionLimit;
    if (overallLimitApplied) totalDeduction = overallDeductionLimit;

    const taxBase = Math.max(0, effectiveEstateAmount - totalDeduction);
    let calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);

    const generationSkipHeirRatio = Math.max(0, Math.min(1, Number(p.generationSkipHeirRatio) || 0));
    const generationSkipPremiumRate = p.generationSkipOver2Billion ? 0.4 : 0.3;
    const generationSkipPremium = Math.round(calculatedTax * generationSkipHeirRatio * generationSkipPremiumRate);
    calculatedTax += generationSkipPremium;

    // §28 증여세액공제 — 상속인별 정밀 계산(위 priorGiftTaxCreditPrecise 참고).
    const priorGiftCreditResult = priorGiftTaxCreditPrecise(calculatedTax, taxBase, effectiveEstateAmount, priorGiftHeirs);
    const priorGiftTaxCredit = priorGiftCreditResult.totalCredit;
    const giftCreditExcludedBySmallEstate = priorGiftCreditResult.excludedBySmallEstate;
    const specialGiftTaxCredit = Math.min(Number(p.specialGiftTaxCredit) || 0, Math.max(0, calculatedTax - priorGiftTaxCredit));
    const foreignTaxCredit = Math.min(Number(p.foreignTaxPaidAmount) || 0, Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit));
    const shortTermCredit = Math.min(
      shortTermReinheritanceCredit(p.priorInheritanceTax, p.reinheritedPropertyValue, p.priorInheritanceTotalPropertyValue, p.priorInheritanceTaxableBase, p.yearsSincePriorInheritance),
      Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit)
    );
    const otherCreditsAmount = Math.min(Number(p.otherCreditsAmount) || 0,
      Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit - shortTermCredit));

    const taxAfterCredits = Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit - shortTermCredit - otherCreditsAmount);
    const reportCredit = reportedInTime ? Math.round(taxAfterCredits * 0.03) : 0;
    const taxAfterReportCredit = taxAfterCredits - reportCredit;

    const penalties = giftFilingPenalties(taxAfterReportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

    const interestAmount = Number(p.interestAmount) || 0;
    const forProfitBequestAmount = Number(p.forProfitBequestAmount) || 0;
    const forProfitExemptedTaxAmount = Number(p.forProfitExemptedTaxAmount) || 0;
    const forProfitHeirShareRatio = Math.max(0, Math.min(1, Number(p.forProfitHeirShareRatio) || 0));
    const forProfitPayableByHeirs = Math.max(0, Math.round((forProfitExemptedTaxAmount - forProfitBequestAmount * 0.10) * forProfitHeirShareRatio));
    const culturalPropertyDeferredTaxAmount = Number(p.culturalPropertyDeferredTaxAmount) || 0;
    const businessInheritanceDeferredTaxAmount = Number(p.businessInheritanceDeferredTaxAmount) || 0;

    const totalGrossEstateValue = Number(p.totalGrossEstateValue) || 0;
    let businessInheritanceDeferralEligibleAmount = null;
    if (businessInheritanceDetail && totalGrossEstateValue > 0) {
      businessInheritanceDeferralEligibleAmount = Math.round(taxAfterReportCredit * businessInheritanceDetail.targetAmount / totalGrossEstateValue);
    }

    const finalTax = Math.max(0, taxAfterReportCredit + interestAmount + forProfitPayableByHeirs
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
      - culturalPropertyDeferredTaxAmount - businessInheritanceDeferredTaxAmount);

    return {
      상속세과세가액_입력값: taxableEstateAmount,
      피상속인_거주구분: isDecedentResident ? '거주자' : '비거주자',
      비과세재산가액: nonTaxableAmount, 공익법인출연재산가액: publicInterestOrgAmount, 공익신탁재산가액: publicTrustAmount,
      상속개시전처분재산_추정내역: disposalPresumptionDetail,
      상속개시전처분재산_추정합계: disposalPresumptionTotal, 상속세과세가액_적용값: effectiveEstateAmount,
      인적공제: personalDeduction, '기초인적공제_또는_일괄공제': basicOrLumpSum,
      배우자공제: spouseDeduction, 배우자공제한도액: Number.isFinite(spouseLimit) ? spouseLimit : null,
      금융재산상속공제: financialDeduction, 동거주택상속공제: cohabitingHouseDeduction,
      감정평가수수료공제: appraisalFeeDeduction, 재해손실공제: disasterLossDeduction,
      장례비용공제: funeralDeduction, 장례비용공제_일반분: funeralGeneralDeduction, 장례비용공제_봉안시설분: funeralNicheDeduction,
      가업상속공제: businessInheritanceDeduction,
      가업상속공제_계산내역: businessInheritanceDetail ? {
        대상금액: businessInheritanceDetail.targetAmount, 한도액: businessInheritanceDetail.limitAmount,
        소득세법적용분: businessInheritanceDetail.targetIndividual, 법인세법적용분: businessInheritanceDetail.targetCorporate,
        사업관련자산가액비율: businessInheritanceDetail.ratioInfo ? businessInheritanceDetail.ratioInfo.ratio : null
      } : null,
      영농상속공제: farmingInheritanceDeduction,
      영농상속공제_계산내역: farmingInheritanceDetail ? {
        대상금액: farmingInheritanceDetail.targetAmount, 한도액: farmingInheritanceDetail.limitAmount,
        소득세법적용분: farmingInheritanceDetail.individualTotal, 법인세법적용분: farmingInheritanceDetail.targetCorporate,
        사업관련자산가액비율: farmingInheritanceDetail.ratioInfo ? farmingInheritanceDetail.ratioInfo.ratio : null
      } : null,
      상속공제_합계: totalDeduction, 상속공제종합한도_적용여부: overallLimitApplied, 과세표준: taxBase,
      산출세액: calculatedTax, 세대생략가산액: generationSkipPremium,
      기납부증여세액공제: priorGiftTaxCredit, 증여세액공제_5억이하배제: giftCreditExcludedBySmallEstate, 증여세액공제_상속인별내역: priorGiftCreditResult.perHeir,
      특례증여세액공제: specialGiftTaxCredit, 외국납부세액공제: foreignTaxCredit, 단기재상속세액공제: shortTermCredit, 그밖의공제: otherCreditsAmount,
      신고세액공제: reportCredit, 이자상당액: interestAmount, 영리법인면제분납부세액: forProfitPayableByHeirs,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty,
      납부지연가산세: penalties.latePenalty,
      문화재등징수유예세액: culturalPropertyDeferredTaxAmount, 가업상속납부유예세액: businessInheritanceDeferredTaxAmount,
      가업상속납부유예_가능세액: businessInheritanceDeferralEligibleAmount,
      납부세액: finalTax
    };
  };

  // 상속인별 납부세액 안분 (상증세법 §3조의2①, gs-backend toolAllocateInheritanceTaxByHeir와 동일 로직) — 유산세
  // 방식이라 전체 세액을 실제상속재산가액(세금·채무 차감 전) 비율로 나눈다. 정확한 법정 비율은 시행령§3①이
  // 정하는 "상속인별 상속세과세표준상당액" 비율이나, 그 하위개념인 "상속인별 상속세과세가액상당액"의 산식이
  // 법령에 없어 확정할 수 없으므로, 이 실제상속재산가액 비율은 확정된 법적 근거가 아닌 이 계산기의 근사
  // 방식이다(§28②의 priorGiftTaxCreditPrecise와 동일한 조작적 정의를 재사용). 반올림 잔액은 실제상속재산가액이
  // 가장 큰 상속인에게 몰아 합계를 맞춘다.
  window.allocateInheritanceTaxByHeirJS = function (aggregateResult, heirs) {
    if (!aggregateResult || aggregateResult.error) return { error: '전체 상속세 계산 결과가 필요합니다.' };
    if (!Array.isArray(heirs) || heirs.length === 0) return { error: '상속인을 1명 이상 입력해야 합니다.' };
    const values = heirs.map(function (h) { return Number(h.actualInheritedValue) || 0; });
    const totalInherited = values.reduce(function (s, v) { return s + v; }, 0);
    if (totalInherited <= 0) return { error: '상속인별 실제상속재산가액 합계가 0보다 커야 합니다.' };

    const totalCreditAmount = (aggregateResult.기납부증여세액공제 || 0) + (aggregateResult.특례증여세액공제 || 0)
      + (aggregateResult.외국납부세액공제 || 0) + (aggregateResult.단기재상속세액공제 || 0)
      + (aggregateResult.그밖의공제 || 0) + (aggregateResult.신고세액공제 || 0);
    const totalGrossTax = (aggregateResult.산출세액 || 0) + (aggregateResult.세대생략가산액 || 0);
    const totalPenaltyAmount = (aggregateResult.무신고가산세 || 0) + (aggregateResult.과소신고가산세 || 0) + (aggregateResult.납부지연가산세 || 0);
    const fields = [
      { key: '상속세과세가액', total: aggregateResult.상속세과세가액_적용값 || 0 },
      { key: '과세표준', total: aggregateResult.과세표준 || 0 },
      { key: '산출세액_합계', total: totalGrossTax },
      { key: '세액공제_합계', total: totalCreditAmount },
      { key: '영리법인면제분납부세액', total: aggregateResult.영리법인면제분납부세액 || 0 },
      { key: '가산세_합계', total: totalPenaltyAmount },
      { key: '납부세액', total: aggregateResult.납부세액 || 0 }
    ];

    const maxIdx = values.indexOf(Math.max.apply(null, values));
    const rows = heirs.map(function (h, i) {
      const ratio = values[i] / totalInherited;
      const row = { 성명: h.name || ('상속인' + (i + 1)), 관계: h.relation || '', 실제상속재산가액: values[i], 지분율: ratio };
      fields.forEach(function (f) { row[f.key] = Math.round(f.total * ratio); });
      return row;
    });
    fields.forEach(function (f) {
      const sumAllocated = rows.reduce(function (s, r) { return s + r[f.key]; }, 0);
      rows[maxIdx][f.key] += (f.total - sumAllocated);
    });

    return {
      상속인별_내역: rows,
      합계검증: { 실제상속재산가액_합계: totalInherited, 납부세액_합계: aggregateResult.납부세액 || 0 },
      안내: '상증세법 §3조의2①에 따라, 전체 산출세액·세액공제·가산세 등을 상속인별 실제상속재산가액 비율로 안분했습니다(유산세 방식). 정확한 법정 비율(시행령§3①의 상속인별 상속세과세표준상당액 비율)은 그 하위개념 산식이 법령에 없어 확정할 수 없으므로, 이 비율은 확정된 법적 근거가 아닌 근사치입니다 — 정밀한 상속인별 부담이 중요한 사안에서는 별도로 검증하세요. 상속공제는 전체 1회만 적용되는 항목이라 인별로 나누지 않았습니다. 반올림 잔액은 실제상속재산가액이 가장 큰 상속인에게 몰아서 합계를 맞췄습니다.'
    };
  };

  // 조특법§30의5(창업자금)·§30의6(가업승계 주식등) 증여세 과세특례 ([별지 제10호의2서식]) — Code.js toolCalculateSpecialRateGiftTax와 동일 로직.
  window.calculateSpecialRateGiftTaxJS = function (p) {
    p = p || {};
    const specialType = p.specialType;
    if (['startup', 'business_succession'].indexOf(specialType) === -1) {
      return { error: '특례 종류를 창업자금 또는 가업승계 주식등 중에서 선택하세요.' };
    }
    const giftAmount = Number(p.giftAmount);
    if (!giftAmount || giftAmount <= 0) return { error: '증여재산가액이 필요합니다.' };

    const priorSpecialGiftAmount = Number(p.priorSpecialGiftAmount) || 0;
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';

    let grossBase, ratioInfo = null, businessAssetAmount = null, debtAssumedAmount = 0;
    if (specialType === 'business_succession') {
      const hasAssetDetail = (Number(p.totalAssetValue) || 0) > 0;
      ratioInfo = hasAssetDetail ? businessRelatedAssetRatio(p.totalAssetValue, {
        asset55: p.nonBizAsset55, asset49: p.nonBizAsset49, asset61: p.nonBizAsset61, excessCash: p.excessCash, nonBizStock: p.nonBizStock
      }) : null;
      const ratio = hasAssetDetail ? ratioInfo.ratio : 1;
      businessAssetAmount = Math.round(giftAmount * ratio);
      grossBase = businessAssetAmount + priorSpecialGiftAmount;
    } else {
      debtAssumedAmount = Math.min(Number(p.debtAssumedAmount) || 0, giftAmount);
      grossBase = Math.max(0, giftAmount - debtAssumedAmount) + priorSpecialGiftAmount;
    }

    let totalLimit;
    if (specialType === 'startup') {
      totalLimit = p.jobsCreated10Plus ? 10000000000 : 5000000000;
    } else {
      const years = Number(p.businessOwnershipYearsOfParent) || 0;
      totalLimit = years < 20 ? 30000000000 : (years < 30 ? 40000000000 : 60000000000);
    }
    const remainingLimit = Math.max(0, totalLimit - priorSpecialGiftAmount);
    const specialRateApplicableAmount = grossBase < totalLimit
      ? Math.max(0, grossBase - priorSpecialGiftAmount)
      : Math.min(grossBase, remainingLimit);
    const baseRateApplicableAmount = Math.max(0, giftAmount - specialRateApplicableAmount);

    const propertyDeductionLimit = specialType === 'startup' ? 500000000 : 1000000000;
    const propertyDeduction = Math.min(propertyDeductionLimit, specialRateApplicableAmount);
    const disasterLossDeduction = Number(p.disasterLossAmount) || 0;
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const taxBase = Math.max(0, specialRateApplicableAmount - propertyDeduction - disasterLossDeduction - appraisalFeeDeduction);

    const calculatedTax = specialType === 'startup'
      ? Math.round(taxBase * 0.10)
      : Math.round(Math.min(taxBase, 12000000000) * 0.10 + Math.max(0, taxBase - 12000000000) * 0.20);

    const priorPaidTax = Number(p.priorPaidTax) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);

    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
    const finalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);

    return {
      특례종류: specialType === 'startup' ? '창업자금(조특법 §30의5)' : '가업승계주식등(조특법 §30의6)', 증여재산가액: giftAmount,
      인수채무액: debtAssumedAmount, 가업자산상당액: businessAssetAmount, 사업관련자산가액비율: ratioInfo ? ratioInfo.ratio : null,
      과세특례적용전_증여세과세가액_계: grossBase, 총한도액: totalLimit,
      과세특례적용대상_증여세과세가액: specialRateApplicableAmount, 기본세율적용대상_증여재산가액: baseRateApplicableAmount,
      증여재산공제: propertyDeduction, 재해손실공제: disasterLossDeduction, 감정평가수수료공제: appraisalFeeDeduction,
      과세표준: taxBase, 세율: specialType === 'startup' ? '10%' : '10%(120억 초과분 20%)', 산출세액: calculatedTax,
      납부세액공제: priorPaidTax, 외국납부세액공제: foreignTaxPaidAmount,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax
    };
  };

  // 증여의제이익(일감몰아주기·일감떼어주기 등)에 대한 세액 계산 — 증여재산공제 없이 일반 누진세율+신고세액공제(3%)만 적용.
  function taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxForLatePenalty, reportedInTime) {
    const taxBase = Math.max(0, Math.round(deemedGiftProfit));
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const reportCredit = reportedInTime ? Math.round(calculatedTax * 0.03) : 0;
    const taxAfterCredit = calculatedTax - reportCredit;
    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxForLatePenalty);
    const finalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return { taxBase, calculatedTax, reportCredit, penalties, finalTax };
  }

  // 일감몰아주기 증여의제 (상증세법 §45의3, [별지 제10호의3서식]) — Code.js toolCalculateRelatedPartyTransactionGiftTax와 동일 로직.
  window.calculateRelatedPartyTransactionGiftTaxJS = function (p) {
    p = p || {};
    const companySize = p.companySize;
    if (['general', 'medium', 'small'].indexOf(companySize) === -1) {
      return { error: '기업규모를 일반/중견기업/중소기업 중에서 선택하세요.' };
    }
    // §45의3①2호가목(중소기업)은 "세후순이익"을, 나목(중견기업)·다목(그 외)은 "세후영업이익"을 쓴다 —
    // 두 값이 서로 다른 개념이므로 별도로 입력받는다.
    const afterTaxOperatingIncome = Number(p.afterTaxOperatingIncome) || 0;
    const afterTaxNetIncome = Number(p.afterTaxNetIncome) || 0;
    const incomeBase = companySize === 'small' ? afterTaxNetIncome : afterTaxOperatingIncome;
    const tradeRatio = Number(p.relatedPartyTransactionRatio) || 0;
    const shareRatio = Number(p.shareholderOwnershipRatio) || 0;

    const gateTradeThreshold = companySize === 'general' ? 30 : (companySize === 'medium' ? 40 : 50);
    const gateShareThreshold = companySize === 'general' ? 3 : 10;
    const meetsGate = incomeBase > 0 && tradeRatio > gateTradeThreshold && shareRatio > gateShareThreshold;

    if (!meetsGate) {
      return {
        과세대상여부: false,
        과세요건_거래비율기준: gateTradeThreshold, 과세요건_지분율기준: gateShareThreshold,
        증여의제이익: 0, 납부세액: 0,
        안내: '과세요건(세후영업이익 존재, 거래비율 ' + gateTradeThreshold + '% 초과, 주식보유비율 ' + gateShareThreshold + '% 초과)을 충족하지 못해 일감몰아주기 증여의제 과세대상이 아닙니다.'
      };
    }

    const formulaTradeSubtract = companySize === 'general' ? 5 : (companySize === 'medium' ? 20 : 50);
    const formulaShareSubtract = companySize === 'general' ? 0 : (companySize === 'medium' ? 5 : 10);
    const netTradeRatio = Math.max(0, (tradeRatio - formulaTradeSubtract) / 100);
    const netShareRatio = Math.max(0, (shareRatio - formulaShareSubtract) / 100);
    const dividendDeduction = Number(p.dividendDeduction) || 0;
    const deemedGiftProfit = Math.max(0, Math.round(incomeBase * netTradeRatio * netShareRatio) - dividendDeduction);

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const r = taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime);

    return {
      과세대상여부: true,
      적용소득기준: companySize === 'small' ? '세후순이익' : '세후영업이익', 적용소득금액: incomeBase,
      증여의제이익_계산식차감비율_거래: formulaTradeSubtract, 증여의제이익_계산식차감비율_지분: formulaShareSubtract,
      배당소득공제: dividendDeduction,
      증여의제이익: deemedGiftProfit,
      과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
      무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
      납부세액: r.finalTax,
      안내: '증여재산공제는 적용되지 않습니다(증여의제이익 전액이 과세표준). 특수관계법인거래비율·주식보유비율은 과세제외매출액을 반영해 이미 계산된 최종 비율을 입력해야 하며, 이 도구는 매출액 세부내역으로부터의 비율 산출 자체는 하지 않습니다. 지배주주 판정, 다수 특수관계법인이 있는 경우의 증여자별 안분 등은 별도로 확인하세요. 지배주주가 수혜법인에 직접출자와 간접출자를 모두 하고 있는 경우에는 출자관계별로 각각 계산한 뒤 증여의제이익을 합산해야 합니다.'
    };
  };

  // 일감떼어주기 증여의제 (상증세법 §45의4, [별지 제10호의4서식]) — Code.js toolCalculateBusinessOpportunityGiftTax와 동일 로직.
  window.calculateBusinessOpportunityGiftTaxJS = function (p) {
    p = p || {};
    const phase = p.phase;
    if (['initial', 'settlement'].indexOf(phase) === -1) {
      return { error: '단계를 개시사업연도 또는 정산사업연도 중에서 선택하세요.' };
    }
    const profitFromOpportunity = Number(p.profitFromOpportunity) || 0;
    const shareRatio = Number(p.shareholderOwnershipRatio) || 0;
    const corporateTaxPortion = Number(p.corporateTaxPortion) || 0;

    const meetsGate = profitFromOpportunity > 0 && shareRatio >= 30;
    if (!meetsGate) {
      return {
        과세대상여부: false,
        증여의제이익: 0, 납부세액: 0,
        안내: '과세요건(사업기회로 인한 부문별 영업이익 존재, 지배주주+친족 주식보유비율 30% 이상)을 충족하지 못해 일감떼어주기 증여의제 과세대상이 아닙니다.'
      };
    }

    let deemedGiftProfit;
    if (phase === 'initial') {
      const monthsInInitialYear = Number(p.monthsInInitialYear) || 12;
      deemedGiftProfit = Math.round(Math.max(0, (profitFromOpportunity * (shareRatio / 100) - corporateTaxPortion) / monthsInInitialYear * 12) * 3);
    } else {
      const dividendDeduction = Number(p.dividendDeduction) || 0;
      deemedGiftProfit = Math.max(0, Math.round(profitFromOpportunity * (shareRatio / 100) - corporateTaxPortion) - dividendDeduction);
    }

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const r = taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime);

    return {
      과세대상여부: true,
      증여의제이익: deemedGiftProfit,
      과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
      무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
      안내: (phase === 'initial'
        ? '개시사업연도 신고는 잠정치입니다 — 2년 경과 후 정산사업연도에 재계산·정산신고해야 합니다. '
        : '') + '증여재산공제는 적용되지 않습니다(증여의제이익 전액이 과세표준). 지배주주 판정, 법인세 납부세액 중 상당액 계산은 별도로 확인해서 정확한 값을 입력해야 합니다.',
      납부세액: r.finalTax
    };
  };

  // 상속세(증여세) 연부연납 회차별 납부예정세액 계산 ([별지 제11호서식]) — Code.js toolCalculateInstallmentPaymentSchedule와 동일 로직.
  window.calculateInstallmentPaymentScheduleJS = function (p) {
    p = p || {};
    const taxType = p.taxType;
    if (['inheritance', 'gift'].indexOf(taxType) === -1) {
      return { error: '세목을 상속세 또는 증여세 중에서 선택하세요.' };
    }
    const totalTaxAmount = Number(p.totalTaxAmount);
    if (!totalTaxAmount || totalTaxAmount <= 0) return { error: '총 납부세액이 필요합니다.' };
    if (totalTaxAmount <= 20000000) {
      return { error: '상속세·증여세 납부세액이 2천만원 이하이면 연부연납을 신청할 수 없습니다(상증세법 §71①).' };
    }
    const installmentPeriodYears = Number(p.installmentPeriodYears);
    if (!installmentPeriodYears || installmentPeriodYears <= 0) return { error: '연부연납기간(년)이 필요합니다.' };
    const annualInterestRatePercent = Number(p.annualInterestRatePercent);
    if (!(annualInterestRatePercent >= 0)) return { error: '연부연납 가산금 연이자율(%)이 필요합니다 — 신고 시점 기준 이자율을 직접 확인해서 넣어야 합니다.' };
    const initialPaymentAmount = Math.min(Number(p.initialPaymentAmount) || 0, totalTaxAmount);

    const installmentTaxAmount = totalTaxAmount - initialPaymentAmount;
    const count = installmentPeriodYears + 1;
    const basePrincipal = Math.floor(installmentTaxAmount / count);

    let remaining = installmentTaxAmount;
    const schedule = [];
    for (let i = 1; i <= count; i++) {
      const principal = (i === count) ? remaining : basePrincipal;
      // 1회차(신고시 최초 납부분)는 아직 유예받은 기간이 없으므로 가산금이 붙지 않는다. 2회차부터는
      // 그 이전 잔액에 대해 1년치 가산금이 붙는다(직전 회차 납부 후 남은 잔액 기준).
      const interest = (i === 1) ? 0 : Math.round(remaining * annualInterestRatePercent / 100);
      schedule.push({ 회차: i, 원금: principal, 가산금: interest, 납부예정세액: principal + interest });
      remaining -= principal;
    }
    const totalInterest = schedule.reduce(function (s, r) { return s + r.가산금; }, 0);
    const belowMinimumWarning = basePrincipal > 0 && basePrincipal < 10000000;

    return {
      세목: taxType === 'inheritance' ? '상속세' : '증여세', 총납부세액: totalTaxAmount, 최초납부세액: initialPaymentAmount,
      연부연납대상금액: installmentTaxAmount,
      회차별_납부예정세액: schedule,
      가산금_합계: totalInterest,
      총납부액_최초포함: initialPaymentAmount + installmentTaxAmount + totalInterest,
      각회분_1천만원미만_경고: belowMinimumWarning
    };
  };

  // 국세기본법시행규칙§19조의3(국세환급가산금의 이율, 영§43조의3② 위임) 개정이력 — 상증세법시행령
  // §18조의2⑯3호(가업상속공제)·§18조의3⑧⑩(영농상속공제)·§72조의2⑦⑨(납부유예) 등 사후관리위반
  // 추징세액의 이자상당액은 모두 "부과 당시의 이 이율을 365로 나눈 율"을 일수만큼 곱해서 계산한다.
  // 2013.2.23 이전 이력은 이 계산기가 다루는 사후관리 기간(보통 5년 내외) 밖이라 반영하지 않았다.
  const REFUND_INTEREST_RATE_HISTORY = [
    { from: '2013-02-23', rate: 0.040 }, { from: '2014-03-14', rate: 0.029 }, { from: '2015-03-06', rate: 0.025 },
    { from: '2016-03-07', rate: 0.018 }, { from: '2017-03-15', rate: 0.016 }, { from: '2018-03-19', rate: 0.018 },
    { from: '2019-03-20', rate: 0.021 }, { from: '2020-03-13', rate: 0.018 }, { from: '2021-03-16', rate: 0.012 },
    { from: '2023-03-20', rate: 0.029 }, { from: '2024-03-22', rate: 0.035 }, { from: '2025-03-21', rate: 0.031 }
  ];
  function refundInterestRateAt_(dateStr) {
    let rate = REFUND_INTEREST_RATE_HISTORY[0].rate;
    for (let i = 0; i < REFUND_INTEREST_RATE_HISTORY.length; i++) {
      if (dateStr >= REFUND_INTEREST_RATE_HISTORY[i].from) rate = REFUND_INTEREST_RATE_HISTORY[i].rate; else break;
    }
    return rate;
  }
  // [startDate, endDate) 구간을 이율 변경일 기준으로 잘라 각 구간의 일수와 그 구간에 적용되는
  // 연이율을 반환한다.
  function splitDateRangeByRate_(startDateStr, endDateStr) {
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return [];
    const boundaries = REFUND_INTEREST_RATE_HISTORY.map(function (e) { return e.from; })
      .filter(function (d) { return d > startDateStr && d < endDateStr; });
    const cutPoints = [startDateStr].concat(boundaries).concat([endDateStr]);
    const segments = [];
    for (let i = 0; i < cutPoints.length - 1; i++) {
      const segStart = new Date(cutPoints[i] + 'T00:00:00');
      const segEnd = new Date(cutPoints[i + 1] + 'T00:00:00');
      const days = Math.round((segEnd.getTime() - segStart.getTime()) / 86400000);
      if (days > 0) segments.push({ from: cutPoints[i], to: cutPoints[i + 1], days: days, rate: refundInterestRateAt_(cutPoints[i]) });
    }
    return segments;
  }

  // 사후관리 위반 시 추징세액에 붙는 이자상당액 계산 — Code.js toolCalculateClawbackInterest와 동일 로직.
  // 이자 기산일부터 추징사유 발생일까지를 이율 변경일 기준으로 나눠, 각 구간에 그 시점 국세환급가산금
  // 이율(365분의1)을 적용해 합산한다.
  window.calculateClawbackInterestJS = function (p) {
    p = p || {};
    const taxAmount = Number(p.clawedBackTaxAmount);
    if (!taxAmount || taxAmount <= 0) return { error: '사후관리 위반으로 결정된 추징세액이 필요합니다.' };
    if (!p.startDate || !p.endDate) return { error: '이자 기산일과 추징사유 발생일이 필요합니다.' };
    const segments = splitDateRangeByRate_(p.startDate, p.endDate);
    if (!segments.length) return { error: '추징사유 발생일이 이자 기산일보다 빠르거나 같습니다.' };
    let totalInterest = 0;
    const segmentDetail = segments.map(function (seg) {
      const interest = Math.round(taxAmount * seg.days * seg.rate / 365);
      totalInterest += interest;
      return { 시작일: seg.from, 종료일: seg.to, 일수: seg.days, 연이율: seg.rate, 이자상당액: interest };
    });

    return {
      추징세액: taxAmount, 이자기산일: p.startDate, 추징사유발생일: p.endDate,
      구간별_이자상당액: segmentDetail,
      이자상당액_합계: totalInterest,
      납부할세액: taxAmount + totalInterest,
      안내: '이자 기산일은 당초 감면·특례 적용받은 증여세(또는 상속세)의 과세표준 신고기한 다음 날, 추징사유 발생일은 사후관리 위반 사유가 발생한 날입니다. 이율은 국세기본법시행규칙§19조의3(국세환급가산금이율) 개정이력에 따라 구간별로 자동 적용됩니다.'
    };
  };

  // 저가양수·고가양도에 따른 이익의 증여의제 (상증세법 §35) — Code.js toolCalculateLowPriceTransferGiftAmount와 동일 로직.
  window.calculateLowPriceTransferGiftAmountJS = function (p) {
    p = p || {};
    const fairMarketValue = Number(p.fairMarketValue);
    const transferPrice = Number(p.transferPrice);
    if (!fairMarketValue || fairMarketValue <= 0) return { error: '시가가 필요합니다.' };
    if (!(transferPrice >= 0)) return { error: '실제 거래한 대가가 필요합니다.' };

    const diff = Math.abs(fairMarketValue - transferPrice);
    const threshold = Math.min(Math.round(fairMarketValue * 0.3), 300000000);
    const meetsGate = diff > threshold;
    const direction = transferPrice < fairMarketValue ? '저가양수(매수인이 이익을 얻음)' : (transferPrice > fairMarketValue ? '고가양도(매도인이 이익을 얻음)' : '차액없음');

    if (!meetsGate) {
      return {
        과세대상여부: false, 거래유형: direction,
        시가와대가의차액: diff, 차감기준액: threshold, 증여재산가액: 0,
        안내: '특수관계인 간 거래 기준으로, 차액이 차감기준액(min(시가×30%, 3억원))을 초과하지 않아 과세대상이 아닙니다. 비특수관계인 간 거래는 기준·계산식이 다릅니다.'
      };
    }

    const deemedGiftAmount = diff - threshold;
    return {
      과세대상여부: true, 거래유형: direction,
      시가와대가의차액: diff, 차감기준액: threshold, 증여재산가액: deemedGiftAmount,
      안내: '이 증여재산가액을 계산기 상단의 giftAmount에 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요. 특수관계인 간 거래를 전제로 계산했습니다.'
    };
  };

  // 금전 무상대출 등에 따른 이익의 증여의제 (상증세법 §41의4) — Code.js toolCalculateInterestFreeLoanGiftAmount와 동일 로직.
  window.calculateInterestFreeLoanGiftAmountJS = function (p) {
    p = p || {};
    const loanPrincipal = Number(p.loanPrincipal);
    if (!loanPrincipal || loanPrincipal <= 0) return { error: '대여원금이 필요합니다.' };
    const appropriateInterestRatePercent = (p.appropriateInterestRatePercent != null) ? Number(p.appropriateInterestRatePercent) : 4.6;
    const actualInterestPaid = Number(p.actualInterestPaid) || 0;
    const loanMonths = (p.loanMonths != null) ? Math.max(0, Number(p.loanMonths)) : 12;

    const appropriateInterestAmount = Math.round(loanPrincipal * appropriateInterestRatePercent / 100 * loanMonths / 12);
    const deemedGiftAmount = Math.max(0, appropriateInterestAmount - actualInterestPaid);
    const meetsGate = deemedGiftAmount >= 10000000;

    if (!meetsGate) {
      return {
        과세대상여부: false, 적정이자상당액: appropriateInterestAmount, 실제지급이자: actualInterestPaid,
        증여재산가액: 0,
        안내: '계산된 이익이 1천만원(연간 기준) 미만이어서 과세대상이 아닙니다.'
      };
    }

    return {
      과세대상여부: true, 적정이자상당액: appropriateInterestAmount, 실제지급이자: actualInterestPaid,
      증여재산가액: deemedGiftAmount,
      안내: '대출기간이 1년을 초과하면 매년 다시 계산해야 합니다. 이 증여재산가액을 계산기 상단의 giftAmount에 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요.'
    };
  };

  // 국내주식등 세율(대주주, 2020.1.1. 이후) — 3억 이하 20%, 3억 초과 25%(누진공제 1500만원)
  const DOMESTIC_STOCK_DAEJUJU_BRACKETS = [
    { max: 300000000, rate: 0.20, deduction: 0 },
    { max: Infinity, rate: 0.25, deduction: 15000000 }
  ];

  // 주식등 양도소득세 — Code.js toolCalculateStockTransferTax와 동일 로직. 부동산 양도세와 완전히 별도 세목.
  window.calculateStockTransferTaxJS = function (p) {
    p = p || {};
    const assetCategory = p.assetCategory;
    if (['domestic_stock', 'foreign_stock', 'derivative', 'other_asset', 'trust_beneficiary'].indexOf(assetCategory) === -1) {
      return { error: '자산구분을 국내주식/국외주식/파생상품/기타자산/신탁수익권 중에서 선택하세요.' };
    }
    const transferPrice = Number(p.transferPrice);
    if (!transferPrice || transferPrice <= 0) return { error: '양도가액이 필요합니다.' };
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const transferExpenses = Number(p.transferExpenses) || 0;

    const gain = transferPrice - acquisitionPrice - transferExpenses;
    const priorNetGainOrLoss = (assetCategory === 'domestic_stock' || assetCategory === 'foreign_stock') ? (Number(p.priorNetGainOrLoss) || 0) : 0;
    const combinedGain = gain + priorNetGainOrLoss;

    const basicDeductionAlreadyUsed = Number(p.basicDeductionAlreadyUsed) || 0;
    const basicDeduction = Math.max(0, Math.min(2500000, Math.max(0, combinedGain)) - basicDeductionAlreadyUsed);
    const taxBase = Math.max(0, combinedGain - basicDeduction);

    let calculatedTax, rateNote;
    if (assetCategory === 'domestic_stock') {
      const isDaejuju = !!p.isDaejuju;
      const isSmallMediumCompany = !!p.isSmallMediumCompany;
      const holdingMonths = Number(p.holdingMonths);
      if (isDaejuju && Number.isFinite(holdingMonths) && holdingMonths < 12) {
        calculatedTax = Math.round(taxBase * 0.30);
        rateNote = '대주주, 1년 미만 보유 — 30% 단일세율';
      } else if (isDaejuju) {
        calculatedTax = progressiveTax(taxBase, DOMESTIC_STOCK_DAEJUJU_BRACKETS);
        rateNote = '대주주, 1년 이상 보유(또는 보유기간 미상) — 3억 이하 20%, 3억 초과분 25%';
      } else {
        const rate = isSmallMediumCompany ? 0.10 : 0.20;
        calculatedTax = Math.round(taxBase * rate);
        rateNote = '소액주주(대주주 아님), ' + (isSmallMediumCompany ? '중소기업 10%' : '중소기업외 20%');
      }
    } else if (assetCategory === 'foreign_stock') {
      const rate = p.isSmallMediumCompany ? 0.10 : 0.20;
      calculatedTax = Math.round(taxBase * rate);
      rateNote = '국외주식등, ' + (p.isSmallMediumCompany ? '중소기업주식등 10%' : '그 밖의 주식등 20%');
    } else if (assetCategory === 'derivative') {
      calculatedTax = Math.round(taxBase * 0.10);
      rateNote = '파생상품등 — 10%(기본세율 20%에 대한 한시적 탄력세율)';
    } else if (assetCategory === 'trust_beneficiary') {
      // 소득세법§104①14호(§94①6호 신탁 수익권) — 3억 이하 20%, 3억 초과분 25%. 대주주·중소기업 구분 없음.
      calculatedTax = progressiveTax(taxBase, DOMESTIC_STOCK_DAEJUJU_BRACKETS);
      rateNote = '신탁 수익권(§94①6호) — 3억 이하 20%, 3억 초과분 25%';
    } else {
      calculatedTax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS);
      rateNote = '기타자산(특정주식·부동산과다보유법인 주식등) — 기본세율(누진 6~45%)';
    }

    const foreignTaxCredit = Math.min(Number(p.foreignTaxPaidAmount) || 0, calculatedTax);
    const taxAfterCredit = Math.max(0, calculatedTax - foreignTaxCredit);

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

    const localIncomeTax = Math.round(taxAfterCredit * 0.1);
    const totalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax);

    return {
      양도차익: Math.round(gain),
      손익통산_적용후_소득금액: Math.round(combinedGain),
      기본공제: basicDeduction,
      과세표준: taxBase,
      적용세율_설명: rateNote,
      산출세액: calculatedTax,
      외국납부세액공제: foreignTaxCredit,
      무신고가산세: penalties.unreportedPenalty,
      과소신고가산세: penalties.underreportedPenalty,
      납부지연가산세: penalties.latePenalty,
      지방소득세: localIncomeTax,
      납부세액_합계: totalTax
    };
  };

  // ============================================================
  // 상속증여재산 평가 (상속세및증여세법 §60~66, 보충적평가방법) — gs-backend와 동일 로직.
  // 증여세·상속세 화면의 "자산 목록"에서 자산별 평가액을 구할 때 이 함수들을 쓴다.
  // ============================================================

  // 비상장주식 1주당 평가액 (§63, 시행령 §54) — 순손익가치·순자산가치 가중평균(일반 3:2, 부동산과다보유법인 2:3), 순자산가치 80% 하한.
  function unlistedStockValuePerShare(netProfit1YearAgo, netProfit2YearsAgo, netProfit3YearsAgo, totalIssuedShares, netAssetValue, isRealEstateHeavy) {
    const shares = Number(totalIssuedShares) || 0;
    if (shares <= 0) return null;
    const weightedNetProfitSum = (Number(netProfit1YearAgo) || 0) * 3 + (Number(netProfit2YearsAgo) || 0) * 2 + (Number(netProfit3YearsAgo) || 0) * 1;
    const weightedNetProfitPerShare = (weightedNetProfitSum / 6) / shares;
    const profitValuePerShare = weightedNetProfitPerShare / 0.10;
    const netAssetValuePerShare = (Number(netAssetValue) || 0) / shares;
    const weights = isRealEstateHeavy ? [2, 3] : [3, 2];
    let valuePerShare = (profitValuePerShare * weights[0] + netAssetValuePerShare * weights[1]) / (weights[0] + weights[1]);
    const floor = netAssetValuePerShare * 0.8;
    const floorApplied = valuePerShare < floor;
    if (floorApplied) valuePerShare = floor;
    return { 순손익가치_1주당: Math.round(profitValuePerShare), 순자산가치_1주당: Math.round(netAssetValuePerShare), 평가액_1주당: Math.round(valuePerShare), 순자산가치80퍼센트_하한적용: floorApplied };
  }

  window.calculateUnlistedStockValueJS = function (p) {
    p = p || {};
    const totalIssuedShares = Number(p.totalIssuedShares);
    if (!totalIssuedShares || totalIssuedShares <= 0) return { error: '발행주식총수가 필요합니다.' };
    const ownedShares = Number(p.ownedShares) || 0;
    const result = unlistedStockValuePerShare(p.netProfit1YearAgo, p.netProfit2YearsAgo, p.netProfit3YearsAgo, totalIssuedShares, p.netAssetValue, !!p.isRealEstateHeavy);
    let totalValue = Math.round(result.평가액_1주당 * ownedShares);
    const isPremiumExempt = !!p.isSmallBusiness || !!p.isMediumBusinessUnder500B;
    const majorShareholderPremium = (p.isMajorShareholder && !isPremiumExempt) ? Math.round(totalValue * 0.2) : 0;
    totalValue += majorShareholderPremium;
    return Object.assign({
      발행주식총수: totalIssuedShares, 평가대상주식수: ownedShares, 최대주주할증액: majorShareholderPremium, 할증평가배제여부: isPremiumExempt, 평가총액: totalValue
    }, result);
  };

  // 토지 평가 (§61) — 개별공시지가 × 면적 × 지분율(%)
  window.calculateLandValueJS = function (officialPricePerSqm, areaSqm, shareRatioPercent) {
    const ratio = (Number(shareRatioPercent) || 100) / 100;
    return Math.round((Number(officialPricePerSqm) || 0) * (Number(areaSqm) || 0) * ratio);
  };

  // 주택(개별/공동주택) 평가 (§61) — 고시된 주택가격 × 지분율(%)
  window.calculateHouseValueJS = function (officialHousePrice, shareRatioPercent) {
    const ratio = (Number(shareRatioPercent) || 100) / 100;
    return Math.round((Number(officialHousePrice) || 0) * ratio);
  };

  // 상장주식 평가 (§63) — 평가기준일 전후 2개월 종가평균 × 주식수
  window.calculateListedStockValueJS = function (averageClosingPrice, shares) {
    return Math.round((Number(averageClosingPrice) || 0) * (Number(shares) || 0));
  };

  // 임대료 등의 환산가액 (§61⑤, 시행령 §50) — 임대 중인 부동산은 이 환산가액과 기준시가(보충적평가액)
  // 중 큰 금액을 그 자산의 가액으로 한다. 환산율은 12%(시행규칙 §15).
  window.calculateRentalConversionValueJS = function (annualRent, deposit) {
    return Math.round((Number(annualRent) || 0) / 0.12 + (Number(deposit) || 0));
  };

  // 영업권 평가 (§64, 시행령 §59②, 시행규칙 §17의3) — 최근 3년간 순손익액의 가중평균(1년전×3+2년전×2+3년전×1)/6의
  // 50%가 자기자본의 정상수익률(10%)을 초과하는 부분을, 영업권 지속연수 5년에 대한 10% 연금현가계수(3.79079)로 현재가치화한다.
  window.calculateGoodwillValueJS = function (netProfit1YearAgo, netProfit2YearsAgo, netProfit3YearsAgo, selfCapital) {
    const weightedNetProfit = ((Number(netProfit1YearAgo) || 0) * 3 + (Number(netProfit2YearsAgo) || 0) * 2 + (Number(netProfit3YearsAgo) || 0) * 1) / 6;
    const excessProfit = Math.max(0, weightedNetProfit * 0.5 - (Number(selfCapital) || 0) * 0.1);
    return Math.round(excessProfit * 3.79079);
  };
})();
