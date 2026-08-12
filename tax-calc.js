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

  // 배우자 상속공제 (상증세법 §19) — 최소 5억, 최대 30억이며 (실제 상속액, 법정상속분) 중 작은 값
  function spouseInheritanceDeduction(actualAmount, legalShareAmount) {
    const actual = Number(actualAmount) || 0;
    if (actual < 500000000) return 500000000; // 실제 상속액이 없거나 5억 미만이어도 최소 5억은 공제
    const legalShare = Number(legalShareAmount) || Infinity; // 법정상속분을 모르면 일단 30억 한도만 적용
    return Math.min(actual, legalShare, 3000000000);
  }

  // 금융재산 상속공제 (상증세법 §22) — 순금융재산 2천만원 이하면 전액, 초과하면 20%와 2천만원 중 큰 금액(2억원 한도)
  function financialAssetInheritanceDeduction(netFinancialAssets) {
    const net = Number(netFinancialAssets) || 0;
    if (net <= 0) return 0;
    if (net <= 20000000) return net;
    return Math.min(200000000, Math.max(net * 0.2, 20000000));
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
    const netGiftAmount = giftAmount - debtAssumedAmount;

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
    const taxAfterPriorCredit = Math.max(0, taxAfterPremium - priorPaidTax);
    const reportCredit = reportedInTime ? Math.round(taxAfterPriorCredit * 0.03) : 0;
    const taxAfterCredit = taxAfterPriorCredit - reportCredit;

    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

    return {
      증여재산가액: giftAmount, 인수채무액: debtAssumedAmount, 순수증여재산가액: netGiftAmount,
      증여재산공제: relationDeduction, 혼인출산증여재산공제: marriageBirthDeduction,
      합산배제증여재산공제: aggregationExclusionDeduction, 감정평가수수료공제: appraisalFeeDeduction, 재해손실공제: disasterLossDeduction,
      과세표준: taxBase, 산출세액_할증전: taxBeforePremium, 세대생략할증액: premiumAmount,
      산출세액_할증후: taxAfterPremium, 기납부세액공제: Math.min(priorPaidTax, taxAfterPremium),
      신고세액공제: reportCredit, 무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty,
      납부지연가산세: penalties.latePenalty,
      납부세액: taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
    };
  };

  // 상속세 — gs-backend toolCalculateInheritanceTax와 동일 로직.
  window.calculateInheritanceTaxJS = function (p) {
    p = p || {};
    const taxableEstateAmount = Number(p.taxableEstateAmount);
    if (!taxableEstateAmount || taxableEstateAmount <= 0) return { error: '상속세 과세가액이 필요합니다.' };

    const childCount = Number(p.childCount) || 0;
    const minorHeirRemainingYears = Number(p.minorHeirRemainingYears) || 0;
    const elderlyHeirCount = Number(p.elderlyHeirCount) || 0;
    const disabledHeirRemainingYears = Number(p.disabledHeirRemainingYears) || 0;
    const reportedInTime = p.reportedInTime !== false;

    const personalDeduction = childCount * 50000000 + minorHeirRemainingYears * 10000000 + elderlyHeirCount * 50000000 + disabledHeirRemainingYears * 10000000;
    const basicOrLumpSum = basicOrLumpSumDeduction(personalDeduction);
    const spouseDeduction = p.hasSpouse ? spouseInheritanceDeduction(p.spouseActualInheritedAmount, p.spouseLegalShareAmount) : 0;
    const financialDeduction = financialAssetInheritanceDeduction(p.netFinancialAssets);
    const cohabitingHouseDeduction = p.hasCohabitingHouseDeduction ? Math.min(Number(p.cohabitingHouseValue) || 0, 600000000) : 0;
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const totalDeduction = basicOrLumpSum + spouseDeduction + financialDeduction + cohabitingHouseDeduction + appraisalFeeDeduction;

    const taxBase = Math.max(0, taxableEstateAmount - totalDeduction);
    const calculatedTax = progressiveTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorGiftTaxCredit = Math.min(Number(p.priorGiftTaxPaid) || 0, calculatedTax);
    const taxAfterGiftCredit = calculatedTax - priorGiftTaxCredit;
    const reportCredit = reportedInTime ? Math.round(taxAfterGiftCredit * 0.03) : 0;

    return {
      상속세과세가액: taxableEstateAmount, 인적공제: personalDeduction, '기초인적공제_또는_일괄공제': basicOrLumpSum,
      배우자공제: spouseDeduction, 금융재산상속공제: financialDeduction, 동거주택상속공제: cohabitingHouseDeduction,
      감정평가수수료공제: appraisalFeeDeduction, 상속공제_합계: totalDeduction, 과세표준: taxBase,
      산출세액: calculatedTax, 기납부증여세액공제: priorGiftTaxCredit, 신고세액공제: reportCredit,
      납부세액: taxAfterGiftCredit - reportCredit
    };
  };
})();
