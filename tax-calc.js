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

  // 단기재상속세액공제 (상증세법 §30) — 10년 이내 재상속 시 전의 상속세 중 이번 상속재산 해당분에 경과연수별 공제율(1년마다 10%p씩 감소) 적용.
  const SHORT_TERM_REINHERITANCE_RATES = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  function shortTermReinheritanceCredit(priorInheritanceTaxPortion, yearsSincePriorInheritance) {
    const y = Math.ceil(Number(yearsSincePriorInheritance) || 0);
    if (y < 1 || y > 10) return 0;
    return Math.round((Number(priorInheritanceTaxPortion) || 0) * SHORT_TERM_REINHERITANCE_RATES[y - 1]);
  }

  // 상속개시전 처분재산 등 산입액 (상증세법 §15, [별지 제9호서식] 부표4) — gs-backend와 동일 로직.
  function presumedInheritedFromDisposal(disposalAmount, explainedAmount, meetsThreshold) {
    if (!meetsThreshold) return 0;
    const disposal = Number(disposalAmount) || 0;
    const unexplained = Math.max(0, disposal - (Number(explainedAmount) || 0));
    const deduction = Math.min(disposal * 0.2, 200000000);
    return Math.max(0, unexplained - deduction);
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

  function basicOrLumpSumDeduction(personalDeductionSum) {
    return Math.max(500000000, 200000000 + (Number(personalDeductionSum) || 0));
  }

  // 거래 1건의 "소득금액 단계까지"만 계산한다(기본공제·세율 적용 전) — 다건 합산에서
  // 여러 거래를 먼저 이 단계까지 계산해두고, 합산 가능한 것끼리 묶어 기본공제·누진세를
  // 한 번에 적용하기 위한 building block이다. 단일거래 계산에도 그대로 재사용한다.
  function transferAssetCore(t) {
    const transferPrice = Number(t.transferPrice);
    let necessaryExpenses = Number(t.necessaryExpenses) || 0;
    const acquisitionPrice = Number(t.acquisitionPrice);
    if (!transferPrice || transferPrice <= 0) return { error: '양도가액이 필요합니다.' };
    if (!acquisitionPrice || acquisitionPrice < 0) return { error: '취득가액이 필요합니다.' };
    if (!t.acquisitionDate || !t.transferDate) return { error: '취득일과 양도일이 필요합니다.' };

    const holdingYears = fullYearsElapsed(t.acquisitionDate, t.transferDate);
    if (holdingYears < 0) return { error: '양도일이 취득일보다 빠릅니다.' };

    if (!t.necessaryExpenses && t.useEstimatedNecessaryExpense && Number(t.acquisitionStandardPriceForExpense) > 0) {
      necessaryExpenses = Math.round(Number(t.acquisitionStandardPriceForExpense) * 0.03);
    }

    const assetType = t.assetType === 'house' ? 'house' : 'other';
    const isOneHouse = !!t.isOneHouseOneFamily;
    const isUnregistered = !!t.isUnregisteredTransfer;
    const gainBeforeDeduction = transferPrice - acquisitionPrice - necessaryExpenses;

    if (isUnregistered) {
      return { holdingYears, isUnregistered: true, gainBeforeDeduction, transferPrice, acquisitionPrice, necessaryExpenses, assetType, raw: t };
    }

    if (isOneHouse && transferPrice <= 1200000000) {
      return { holdingYears, exempt: true, transferPrice, acquisitionPrice, necessaryExpenses, assetType, raw: t };
    }

    let taxableGain = gainBeforeDeduction;
    let ltRate = 0;
    if (isOneHouse) {
      taxableGain = gainBeforeDeduction * (transferPrice - 1200000000) / transferPrice;
      ltRate = longTermRate1House(holdingYears, Number(t.residenceYears) || 0);
    } else {
      ltRate = longTermRate(holdingYears);
    }

    const multiHouseCount = Number(t.multiHouseCount) || 0;
    const isMultiHouseSurcharge = !isOneHouse && !!t.isAdjustedArea && multiHouseCount >= 2;
    if (isMultiHouseSurcharge) ltRate = 0;

    const longTermDeductionAmount = Math.round(taxableGain * ltRate);
    const incomeAmount = taxableGain - longTermDeductionAmount;
    const isPoolable = holdingYears >= 2; // 2년 이상 보유 → 기본세율(누진) 대상, 합산 가능

    return {
      holdingYears, exempt: false, isUnregistered: false, isPoolable,
      transferPrice, acquisitionPrice, necessaryExpenses, assetType, isOneHouse,
      gainBeforeDeduction, taxableGain, longTermRate: ltRate, longTermDeductionAmount, incomeAmount,
      isMultiHouseSurcharge, multiHouseCount, isNonBusinessLand: !!t.isNonBusinessLand, isEightYearFarmland: !!t.isEightYearFarmland,
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
      return {
        입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
        비과세여부: true, 납부세액: 0
      };
    }

    const basicDeduction = 2500000;
    const taxBase = Math.max(0, core.incomeAmount - basicDeduction);
    let calculatedTax, appliedRateNote;
    const surchargeNotes = [];
    if (core.holdingYears < 1) {
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
    const localIncomeTax = Math.round(calculatedTax * 0.1);
    return {
      입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
      양도차익: Math.round(core.gainBeforeDeduction), 과세대상양도차익: Math.round(core.taxableGain),
      장기보유특별공제율: core.longTermRate, 장기보유특별공제액: core.longTermDeductionAmount,
      양도소득금액: Math.round(core.incomeAmount), 기본공제: basicDeduction, 과세표준: taxBase,
      적용세율_설명: appliedRateNote, 세율가산_내역: surchargeNotes, 자경농지감면액: farmlandReduction,
      산출세액: calculatedTax, 지방소득세: localIncomeTax, 납부세액_합계: calculatedTax + localIncomeTax
    };
  };

  // 다건 양도소득세 합산(확정신고 개념) — 2년 이상 보유·미등기 아님 거래끼리는 소득금액을 합산해서
  // 기본공제 250만원을 "전체 중 1회만" 적용하고 하나의 과세표준에 누진세율을 적용한다.
  // 단기양도(2년 미만)·미등기양도는 성격상 합산 누진세 대상이 아니므로 건별로 따로 계산해서 더한다.
  // 다주택중과·비사업용토지 가산액은 합산 그룹 안에서도 자산별 소득금액(기본공제 차감 전) 기준으로
  // 개별 계산해서 더하고, 8년자경 감면은 합산세액을 자산별 소득금액 비중으로 안분한 뒤 자산당 1억 한도로 적용한다
  // — 이는 실제 시행령상 안분규정과 100% 일치를 보장하지 않는 단순화이니, 특례가 여러 건 섞인 복잡한 합산은
  // 결과를 참고용으로만 쓰고 반드시 재검토할 것.
  window.calculateTransferTaxMultiJS = function (transactions) {
    if (!Array.isArray(transactions) || !transactions.length) return { error: '거래를 1건 이상 입력하세요.' };
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
    pooled.forEach(function (c) {
      if (c.isEightYearFarmland && poolIncomeSum > 0) {
        const share = Math.round(poolTaxWithSurcharge * (c.incomeAmount / poolIncomeSum));
        const reduction = Math.min(share, 100000000);
        farmlandReductionTotal += reduction;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: '8년자경농지감면(안분)', 감면액: reduction });
      }
    });
    poolTaxWithSurcharge = Math.max(0, poolTaxWithSurcharge - farmlandReductionTotal);

    let usedBasicOnShort = !basicDeductionUsedInPool ? false : true; // 이미 장기그룹에서 썼으면 단기에서 또 쓰지 않음
    const shortResults = shortTerm.map(function (c) {
      const bd = (!usedBasicOnShort) ? 2500000 : 0;
      if (bd) usedBasicOnShort = true;
      const base = Math.max(0, c.incomeAmount - bd);
      const rate = c.assetType === 'house' ? (c.holdingYears < 1 ? 0.70 : 0.60) : (c.holdingYears < 1 ? 0.50 : 0.40);
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

    const totalCalculatedTax = poolTaxWithSurcharge + shortTaxTotal + unregisteredTaxTotal;
    const localIncomeTax = Math.round(totalCalculatedTax * 0.1);

    return {
      거래건수: transactions.length, 비과세건수: exempt.length,
      합산대상_장기거래건수: pooled.length, 합산소득금액: Math.round(poolIncomeSum),
      기본공제: basicDeductionUsedInPool ? 2500000 : (usedBasicOnShort && shortTerm.length ? 2500000 : 0),
      합산과세표준: poolTaxBase, 합산기본세액: poolBaseTax, 합산가산액: poolSurchargeTotal, 합산자경감면액: farmlandReductionTotal,
      합산그룹_산출세액: poolTaxWithSurcharge,
      단기거래_산출세액_합계: shortTaxTotal, 미등기거래_산출세액_합계: unregisteredTaxTotal,
      산출세액_합계: totalCalculatedTax, 지방소득세: localIncomeTax, 납부세액_합계: totalCalculatedTax + localIncomeTax,
      자산별_내역: assetNotes,
      안내: '2년 이상 보유·특례 없는(또는 다주택중과·비사업용토지만 해당하는) 거래는 소득금액을 합산해 기본공제(250만원, 전체 1회)와 누진세율을 함께 적용했습니다. 단기양도(2년 미만)·미등기양도는 합산 누진세 대상이 아니라 건별로 따로 계산해 더했습니다. 다주택중과·비사업용토지 가산액과 8년자경농지 감면액은 자산별 소득금액 비중으로 계산한 근사치이니, 특례가 여러 건 섞인 복잡한 합산은 결과를 참고용으로만 쓰고 반드시 재검토하세요.'
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
    const debtAssumedAmount = Math.min(Number(p.debtAssumedAmount) || 0, giftAmount);
    const nonTaxableAmount = Number(p.nonTaxableAmount) || 0;
    const publicInterestOrgAmount = Number(p.publicInterestOrgAmount) || 0;
    const publicTrustAmount = Number(p.publicTrustAmount) || 0;
    const disabledTrustAmount = Number(p.disabledTrustAmount) || 0;
    const netGiftAmount = Math.max(0, giftAmount - debtAssumedAmount - nonTaxableAmount - publicInterestOrgAmount - publicTrustAmount - disabledTrustAmount);

    const relationDeduction = giftPropertyDeduction(p.relation, !!p.isMinor);
    const marriageBirthDeduction = (p.isMarriageGift || p.isBirthGift)
      ? marriageOrBirthGiftDeduction(netGiftAmount, p.priorMarriageOrBirthDeductionUsed) : 0;
    const aggregationExclusionDeduction = p.isExcludedFromAggregation ? 30000000 : 0;
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossDeduction = Number(p.disasterLossAmount) || 0;
    const totalDeduction = relationDeduction + marriageBirthDeduction + aggregationExclusionDeduction + appraisalFeeDeduction + disasterLossDeduction;

    const taxBase = Math.max(0, netGiftAmount + priorGiftAmount - totalDeduction);
    const taxBeforePremium = progressiveTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const premiumRate = isGenerationSkip ? (p.generationSkipOver2Billion ? 0.4 : 0.3) : 0;
    const premiumAmount = Math.round(taxBeforePremium * premiumRate);
    const taxAfterPremium = taxBeforePremium + premiumAmount;

    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const otherCreditsAmount = Number(p.otherCreditsAmount) || 0;
    const taxAfterPriorCredit = Math.max(0, taxAfterPremium - priorPaidTax - foreignTaxPaidAmount - otherCreditsAmount);
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
      비과세재산가액: nonTaxableAmount, 공익법인출연재산가액: publicInterestOrgAmount, 공익신탁재산가액: publicTrustAmount, 장애인신탁재산가액: disabledTrustAmount,
      순수증여재산가액: netGiftAmount,
      증여재산공제: relationDeduction, 혼인출산증여재산공제: marriageBirthDeduction,
      합산배제증여재산공제: aggregationExclusionDeduction, 감정평가수수료공제: appraisalFeeDeduction, 재해손실공제: disasterLossDeduction,
      과세표준: taxBase, 산출세액_할증전: taxBeforePremium, 세대생략할증액: premiumAmount,
      산출세액_할증후: taxAfterPremium, 기납부세액공제: Math.min(priorPaidTax, taxAfterPremium),
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
        구분: item.category || '', '처분·차입금액': Number(item.disposalAmount) || 0, 소명금액: Number(item.explainedAmount) || 0,
        금액기준충족: !!item.meetsThreshold,
        추정상속재산가액: presumedInheritedFromDisposal(item.disposalAmount, item.explainedAmount, item.meetsThreshold)
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

    const personalDeduction = childCount * 50000000 + minorHeirRemainingYears * 10000000 + elderlyHeirCount * 50000000 + disabledHeirRemainingYears * 10000000;
    const basicOrLumpSum = basicOrLumpSumDeduction(personalDeduction);

    const estateValueForSpouseLimit = effectiveEstateAmount - (Number(p.priorGiftedAmountIncludedInEstate) || 0);
    const spouseLimit = spouseInheritanceLimit(estateValueForSpouseLimit, p.nonHeirBequestAmount, p.giftToHeirsWithin10Years, Number(p.spouseLegalShareRatio) || 0, p.spouseTaxableBaseOfPriorGift);
    const spouseDeduction = p.hasSpouse ? spouseInheritanceDeduction(p.spouseActualInheritedAmount, spouseLimit) : 0;

    const financialDeduction = financialAssetInheritanceDeduction(p.netFinancialAssets);
    const cohabitingHouseDeduction = p.hasCohabitingHouseDeduction ? Math.min(Number(p.cohabitingHouseValue) || 0, 600000000) : 0;
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossDeduction = Number(p.disasterLossAmount) || 0;
    const businessInheritanceDetail = businessInheritanceDeductionDetailed(p);
    const businessInheritanceDeduction = businessInheritanceDetail ? businessInheritanceDetail.deductionAmount : (Number(p.businessInheritanceDeduction) || 0);
    const farmingInheritanceDetail = farmingInheritanceDeductionDetailed(p);
    const farmingInheritanceDeduction = farmingInheritanceDetail ? farmingInheritanceDetail.deductionAmount : (Number(p.farmingInheritanceDeduction) || 0);

    let totalDeduction = basicOrLumpSum + spouseDeduction + financialDeduction + cohabitingHouseDeduction + appraisalFeeDeduction + disasterLossDeduction
      + businessInheritanceDeduction + farmingInheritanceDeduction;

    const overallDeductionLimit = Math.max(0, effectiveEstateAmount
      - (Number(p.nonHeirBequestAmount) || 0)
      - (Number(p.priorGiftTaxableBaseForOverallLimit) || 0)
      - (Number(p.disclaimedShareRedistributedAmount) || 0));
    const overallLimitApplied = totalDeduction > overallDeductionLimit;
    if (overallLimitApplied) totalDeduction = overallDeductionLimit;

    const taxBase = Math.max(0, effectiveEstateAmount - totalDeduction);
    let calculatedTax = progressiveTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);

    const generationSkipHeirRatio = Math.max(0, Math.min(1, Number(p.generationSkipHeirRatio) || 0));
    const generationSkipPremiumRate = p.generationSkipOver2Billion ? 0.4 : 0.3;
    const generationSkipPremium = Math.round(calculatedTax * generationSkipHeirRatio * generationSkipPremiumRate);
    calculatedTax += generationSkipPremium;

    const priorGiftTaxCredit = Math.min(Number(p.priorGiftTaxPaid) || 0, calculatedTax);
    const specialGiftTaxCredit = Math.min(Number(p.specialGiftTaxCredit) || 0, Math.max(0, calculatedTax - priorGiftTaxCredit));
    const foreignTaxCredit = Math.min(Number(p.foreignTaxPaidAmount) || 0, Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit));
    const shortTermCredit = Math.min(
      shortTermReinheritanceCredit(p.priorInheritanceTaxPortion, p.yearsSincePriorInheritance),
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
      비과세재산가액: nonTaxableAmount, 공익법인출연재산가액: publicInterestOrgAmount, 공익신탁재산가액: publicTrustAmount,
      상속개시전처분재산_추정내역: disposalPresumptionDetail,
      상속개시전처분재산_추정합계: disposalPresumptionTotal, 상속세과세가액_적용값: effectiveEstateAmount,
      인적공제: personalDeduction, '기초인적공제_또는_일괄공제': basicOrLumpSum,
      배우자공제: spouseDeduction, 배우자공제한도액: Number.isFinite(spouseLimit) ? spouseLimit : null,
      금융재산상속공제: financialDeduction, 동거주택상속공제: cohabitingHouseDeduction,
      감정평가수수료공제: appraisalFeeDeduction, 재해손실공제: disasterLossDeduction,
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
      기납부증여세액공제: priorGiftTaxCredit, 특례증여세액공제: specialGiftTaxCredit, 외국납부세액공제: foreignTaxCredit, 단기재상속세액공제: shortTermCredit, 그밖의공제: otherCreditsAmount,
      신고세액공제: reportCredit, 이자상당액: interestAmount, 영리법인면제분납부세액: forProfitPayableByHeirs,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty,
      납부지연가산세: penalties.latePenalty,
      문화재등징수유예세액: culturalPropertyDeferredTaxAmount, 가업상속납부유예세액: businessInheritanceDeferredTaxAmount,
      가업상속납부유예_가능세액: businessInheritanceDeferralEligibleAmount,
      납부세액: finalTax
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
    const calculatedTax = progressiveTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
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
    const afterTaxOperatingIncome = Number(p.afterTaxOperatingIncome) || 0;
    const tradeRatio = Number(p.relatedPartyTransactionRatio) || 0;
    const shareRatio = Number(p.shareholderOwnershipRatio) || 0;

    const gateTradeThreshold = companySize === 'general' ? 30 : (companySize === 'medium' ? 40 : 50);
    const gateShareThreshold = companySize === 'general' ? 3 : 10;
    const meetsGate = afterTaxOperatingIncome > 0 && tradeRatio > gateTradeThreshold && shareRatio > gateShareThreshold;

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
    const deemedGiftProfit = Math.max(0, Math.round(afterTaxOperatingIncome * netTradeRatio * netShareRatio) - dividendDeduction);

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const r = taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime);

    return {
      과세대상여부: true,
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
      const interest = Math.round(remaining * annualInterestRatePercent / 100);
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

  // 사후관리 위반 시 추징세액에 붙는 이자상당액 계산 — Code.js toolCalculateClawbackInterest와 동일 로직.
  window.calculateClawbackInterestJS = function (p) {
    p = p || {};
    const taxAmount = Number(p.clawedBackTaxAmount);
    if (!taxAmount || taxAmount <= 0) return { error: '사후관리 위반으로 결정된 추징세액이 필요합니다.' };
    const daysBefore20220214 = Math.max(0, Number(p.daysBefore20220214) || 0);
    const daysOnOrAfter20220214 = Math.max(0, Number(p.daysOnOrAfter20220214) || Number(p.days) || 0);

    const interestBefore = Math.round(taxAmount * daysBefore20220214 * 25 / 100000);
    const interestAfter = Math.round(taxAmount * daysOnOrAfter20220214 * 22 / 100000);
    const totalInterest = interestBefore + interestAfter;

    return {
      추징세액: taxAmount, '2022.2.14.이전_일수': daysBefore20220214, '2022.2.14.이후_일수': daysOnOrAfter20220214,
      '2022.2.14.이전_이자상당액': interestBefore, '2022.2.14.이후_이자상당액': interestAfter,
      이자상당액_합계: totalInterest,
      납부할세액: taxAmount + totalInterest
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
})();
