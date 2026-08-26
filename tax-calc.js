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

  // 초과배당 소득세상당액 최초신고시 추정율표 (상증세법시행령§31의2③2호, 시행규칙§10의3①) — 초과배당금액에
  // 이 표를 적용해 정산 전 잠정 소득세상당액을 추정한다.
  const EXCESS_DIVIDEND_INCOME_TAX_ESTIMATE_BRACKETS = [
    { max: 57600000, rate: 0.14, deduction: 0 },
    { max: 88000000, rate: 0.24, deduction: 5764000 },
    { max: 150000000, rate: 0.35, deduction: 15440000 },
    { max: 300000000, rate: 0.38, deduction: 19940000 },
    { max: 500000000, rate: 0.40, deduction: 25940000 },
    { max: 1000000000, rate: 0.42, deduction: 35940000 },
    { max: Infinity, rate: 0.45, deduction: 65940000 }
  ];

  // "취득일부터 5년간 발생한 양도소득금액" 산정 (조특법시행령§40①, §98의3③·§98의5③ 등에서 준용,
  // §99①1호·②2호, §99의3②2호 등) — 원칙은 기준시가 비율로 계산한다:
  //   5년간발생분 = 전체양도소득금액 × (5년시점기준시가－취득당시기준시가) ÷ (양도당시기준시가－취득당시기준시가)
  // 기준시가 3개 값이 모두 주어지면 이 원칙대로 계산하고, 주어지지 않으면 실거래가 기준 근사치로 대체한다
  // (5년시점 실거래평가액이 있으면 그 값－취득가액, 그마저 없으면 보유기간 선형안분).
  function fiveYearMarkGain(totalGain, acquisitionPrice, opts) {
    opts = opts || {};
    const acqStd = Number(opts.acquisitionStandardPrice) || 0;
    const fiveYrStd = Number(opts.fiveYearStandardPrice) || 0;
    const trfStd = Number(opts.transferStandardPrice) || 0;
    if (acqStd > 0 && fiveYrStd > 0 && trfStd > 0 && trfStd !== acqStd) {
      const gain = totalGain * (fiveYrStd - acqStd) / (trfStd - acqStd);
      return {
        gain: gain,
        note: '기준시가 비율로 정확히 계산했습니다: 전체양도소득금액 × (5년시점기준시가－취득당시기준시가) ÷ (양도당시기준시가－취득당시기준시가).'
      };
    }
    const fiveYearMarkValue = Number(opts.fiveYearMarkValue) || 0;
    if (fiveYearMarkValue > 0) {
      return {
        gain: fiveYearMarkValue - acquisitionPrice,
        note: '기준시가 3종(취득당시·5년시점·양도당시)이 모두 입력되지 않아, 입력하신 5년 시점 실거래평가액을 기준으로 근사 계산했습니다(정확한 산정은 4개 기준시가 값을 모두 입력하세요).'
      };
    }
    const yearsHeld = Number(opts.yearsHeld) || 0;
    const cappedYears = Math.min(yearsHeld, 5);
    return {
      gain: yearsHeld > 0 ? totalGain * cappedYears / Math.max(yearsHeld, cappedYears) : totalGain,
      note: '기준시가·5년시점 평가액이 모두 없어 전체 양도차익을 보유기간에 선형 안분한 근사치입니다(정확한 산정은 4개 기준시가 값을 모두 입력하세요).'
    };
  }
  // 과세최저한(상증세법§25②·§55②) — 상속세·증여세는 과세표준이 50만원 미만이면 세액을 부과하지
  // 않는다(양도소득세·주식양도세에는 이런 문턱이 없으므로 progressiveTax 자체에는 넣지 않는다).
  function progressiveGiftInheritTax(base, brackets) {
    return (Number(base) || 0) < 500000 ? 0 : progressiveTax(base, brackets);
  }

  // §47② — 증여일 전 10년 이내 동일인(직계존속 증여는 그 배우자 포함)으로부터 받은 증여재산가액을
  // 합친 금액이 1천만원 "이상"인 경우에만 이번 증여세 과세가액에 가산한다. 1천만원 미만이면 합산 자체를
  // 하지 않으므로(단서에 합산배제증여재산은 애초에 적용 제외), 과세표준 계산에서 통째로 빠져야 한다.
  function giftAggregationAmount(priorGiftAmount) {
    return priorGiftAmount >= 10000000 ? priorGiftAmount : 0;
  }

  // §43②·시행령§32의4 — 1년 이내 동일거래 합산용. Code.js sumPriorBenefitsWithinOneYear_와 동일 로직.
  function sumPriorBenefitsWithinOneYear(arr) {
    if (!Array.isArray(arr)) return 0;
    return arr.reduce(function (sum, v) { return sum + (Number(v) || 0); }, 0);
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

  // 배우자 상속공제 (상증세법 §19) — 최소 5억, 최대 30억이며 (실제 상속액, 한도액) 중 작은 값.
  // §19② — "①에 따른" 한도기준 공제(실제상속액까지 인정)는 배우자상속재산분할기한(신고기한 다음날부터
  // 9개월, ③의 부득이한 사유 연장 포함)까지 배우자의 상속재산을 분할(등기·등록·명의개서 등 포함)하고
  // 그 사실을 신고한 경우에만 적용된다. ④는 "제2항에도 불구하고"(=분할 여부와 무관하게) 실제상속액이
  // 없거나 5억원 미만이면 5억원을 공제한다고 규정 — 즉 5억원은 분할 여부와 무관한 최소보장이지만, 실제
  // 상속액이 5억원 이상인데 기한까지 미분할(신고도 안 함)이면 ①의 한도기준 공제 자체가 적용되지 않아
  // 최소보장액 5억원만 인정되는 것이 실무 해석이다. isDivided를 명시적으로 false로 넘기면 이를 반영해
  // 5억원으로 제한한다(미지정시 기존 동작대로 분할된 것으로 간주 — 하위호환).
  function spouseInheritanceDeduction(actualAmount, limitAmount, isDivided) {
    const actual = Number(actualAmount) || 0;
    if (actual < 500000000) return 500000000; // 실제 상속액이 없거나 5억 미만이어도 최소 5억은 공제
    if (isDivided === false) return 500000000; // §19②③ 분할기한까지 미분할·미신고 — 최소보장액만 인정
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
  // "상속인별 상속세과세가액상당액"(다목)이 정확히 무엇을 가리키는지는 법령 어디에도 명시적으로 정의돼
  // 있지 않다 — 시행령§3①1호 다목 자체가 "상속인별 상속세과세가액 상당액에서... 증여재산을 제외한 금액"
  // 이라고, 정의되지 않은 그 용어를 다시 언급할 뿐이다(§28②후단 "대통령령으로 정하는 바에 따라 계산한
  // 과세표준"이라는 위임 문구도 계산방법을 §3①에 다시 위임할 뿐 직접 정의하지 않는다). 그래서 이
  // 계산기는 그 상속인에게 실제 귀속되는 상속재산가액(=actualInheritedValue, 채무 차감 전, "상속재산"과
  // "순재산"을 구분한 문언에 따름)을 근사치로 쓴다 — 법령이 명시한 값이 아니라 실무적 근사임에 유의할 것.
  // §3조의2③의 "각자가 받았거나 받을 재산"(총자산-부채-상속세-증여세, 연대납부의무의 "한도"를 정하는
  // 별개 규정)과는 무관하다. "그 상속인이 납부할 상속세액"은
  // §3조의2①→시행령§3①이 정하는 "상속인별 상속세과세표준상당액(1호) ÷ 제2호 금액(전체상속세과세표준－
  // §13①2호 비수유자증여과세표준)" 비율을 전체 산출세액에 곱한 값이며, 이 계산기의 §3조의2① 안분 도구
  // (allocateInheritanceTaxByHeirJS)와 동일한 비율(실제상속재산가액 비율, 또는 사전증여 데이터가 있으면
  // 1호 산식의 상속인별 비중)로 근사한다 — 분모를 §3①2호 금액 그대로 쓰지 않고 상속인별 1호 합계로
  // 정규화하는 구조적 근사이니 유의할 것(1호 자체의 §13①1호·2호 반영은 nonHeirPriorGiftTaxableBaseTotal·
  // nonHeirPriorGiftAmountTotal 입력으로 정밀 반영됨).
  // nonHeirPriorGiftTaxableBaseTotal·nonHeirPriorGiftAmountTotal: 시행령§3①1호 가목·나목 원문이 각각
  // "법 제13조제1항 각호의 규정에 의하여 가산한 증여재산의 과세표준"/"동조제1항 각호의 금액"이라고 해서
  // §13①1호(상속인 증여)뿐 아니라 2호(상속인 아닌 자에 대한 증여)까지 포함하도록 요구한다. heirs 배열은
  // 상속인분(1호)만 담으므로, 수유자가 아닌 자에게 한 사전증여(2호)가 있으면 그 합계를 이 두 인자로
  // 별도로 넘겨야 가목·나목이 정확해진다(없으면 기존처럼 1호분만 반영 — §28②의 부정확한 근사가 될 수 있음).
  function priorGiftTaxCreditPrecise(overallCalculatedTax, overallTaxBase, overallTaxableAmount, heirs, nonHeirPriorGiftTaxableBaseTotal, nonHeirPriorGiftAmountTotal) {
    heirs = Array.isArray(heirs) ? heirs : [];
    if (overallTaxableAmount <= 500000000) {
      return { totalCredit: 0, excludedBySmallEstate: true, perHeir: [] };
    }
    const totalActualValue = heirs.reduce(function (s, h) { return s + (Number(h.actualInheritedValue) || 0); }, 0);
    const totalPriorGiftAmount = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftAmount) || 0); }, 0);
    const totalPriorGiftTaxableBase = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0);
    const 가목 = Math.max(0, overallTaxBase - totalPriorGiftTaxableBase - (Number(nonHeirPriorGiftTaxableBaseTotal) || 0));
    const 나목 = Math.max(0, overallTaxableAmount - totalPriorGiftAmount - (Number(nonHeirPriorGiftAmountTotal) || 0));
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
  //
  // 시행령§15③ — 가업상속은 "피상속인 및 상속인이 다음 각 호의 요건을 모두 갖춘 경우에만" 적용된다.
  // 이 계산기는 다음 6개 요건을 boolean으로 명시 확인받아 게이트로 적용한다(단 하나라도 false면 공제
  // 전액 배제). 값을 하나라도 넘기지 않으면(undefined) "요건 미확인" 상태로 표시해 반환하되, 하위호환을
  // 위해 계산 자체는 종전처럼 진행한다 — 다만 이 경우 결과에 requirementsUnverified:true가 붙으므로
  // 호출측(UI·AI)은 반드시 이 플래그를 사용자에게 노출해 요건을 실제로 확인하도록 안내해야 한다.
  //   1. decedentOwnershipRequirementMet — ③1호가목: 피상속인+특수관계인 지분 40%(상장 20%) 이상을
  //      10년 이상 계속 보유
  //   2. decedentCeoTenureRequirementMet — ③1호나목: 대표이사 재직기간이 (가업영위기간의 50%이상)
  //      또는 (10년이상, 상속인이 승계해 계속재직) 또는 (상속개시일 소급 10년중 5년이상) 중 하나
  //   3. heirAge18OrOlder — ③2호가목: 상속인이 상속개시일 현재 18세 이상(배우자로 대체 가능)
  //   4. heirEngagedInBusiness2YearsOrExempt — ③2호나목: 상속인이 2년 이상 직접 가업종사했거나,
  //      피상속인이 65세 이전 사망 또는 천재지변·인재 등 부득이한 사유로 사망해 이 요건 자체가 면제됨
  //   5. heirBecameOfficerByFilingDeadline — ③2호다목: 상속세과세표준 신고기한까지 임원 취임
  //   6. heirBecameCeoWithin2Years — ③2호라목: 신고기한부터 2년 이내 대표이사등 취임
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
    let deductionAmount = Math.min(targetAmount, limitAmount);

    const eligibilityFlags = {
      decedentOwnershipRequirementMet: p.decedentOwnershipRequirementMet,
      decedentCeoTenureRequirementMet: p.decedentCeoTenureRequirementMet,
      heirAge18OrOlder: p.heirAge18OrOlder,
      heirEngagedInBusiness2YearsOrExempt: p.heirEngagedInBusiness2YearsOrExempt,
      heirBecameOfficerByFilingDeadline: p.heirBecameOfficerByFilingDeadline,
      heirBecameCeoWithin2Years: p.heirBecameCeoWithin2Years
    };
    const keys = Object.keys(eligibilityFlags);
    const requirementsUnverified = keys.some(function (k) { return eligibilityFlags[k] !== true && eligibilityFlags[k] !== false; });
    const failedRequirements = keys.filter(function (k) { return eligibilityFlags[k] === false; });
    let eligibilityGateApplied = false;
    if (failedRequirements.length > 0) {
      eligibilityGateApplied = true;
      deductionAmount = 0;
    }

    // 중견기업 게이트(상증세법§18의2②, 시행령§15⑥⑦) — 가업이 중견기업이고, 가업상속인의
    // "가업상속재산 외의 상속재산의 가액"(=가업상속인이 받거나 받을 상속재산가액-그가 부담하는 증명된
    // 채무-가업상속재산가액, 시행령§15⑥)이 "가업상속공제를 받지 않았을 경우 그 상속인이 납부할
    // 상속세액×200%"(시행령§15⑦)를 초과하면, 그 상속인이 받는 가업상속재산에는 가업상속공제를
    // 전혀 적용하지 않는다. 이 두 금액은 전체 상속세 계산(§3조의2① 상속인별 안분 등) 이후에야
    // 확정되는 순환 종속 값이라 이 도구가 자동 산출하지 못하므로, 별도로 계산한 값을 직접 입력받는다.
    let mediumSizedGateApplied = false;
    if (p.isMediumSizedBusiness) {
      const nonBusinessAssetValue = Number(p.businessHeirNonBusinessAssetValue) || 0;
      const taxWithoutDeduction = Number(p.businessHeirTaxWithoutDeduction) || 0;
      if (nonBusinessAssetValue > taxWithoutDeduction * 2) {
        mediumSizedGateApplied = true;
        deductionAmount = 0;
      }
    }
    return {
      targetAmount, limitAmount, deductionAmount, targetIndividual, targetCorporate, ratioInfo, mediumSizedGateApplied,
      requirementsUnverified, eligibilityGateApplied, failedRequirements
    };
  }

  // 영농상속공제 ([별지 제2호서식] 기준) — 소득세법 적용영농(①합계) + 법인세법 적용영농(주식등가액×사업관련자산비율), 30억원 고정한도.
  //
  // 시행령§16②③ — 피상속인·상속인 모두 요건을 갖춘 경우에만 적용된다. 4개 요건을 boolean으로 명시
  // 확인받아 게이트로 적용한다(하나라도 false면 공제 전액 배제). 값을 하나라도 넘기지 않으면(undefined)
  // "요건 미확인" 상태로 표시해 반환하되, 하위호환을 위해 계산 자체는 종전처럼 진행한다.
  //   1. decedentFarmingRequirementMet — ②1호: 상속개시일 8년전부터 계속 직접 영농종사+거주요건, 또는
  //      ②2호: 8년전부터 계속 경영+본인·특수관계인 지분 50%이상 계속보유(법인세법 적용영농)
  //   2. heirAge18OrOlder — ③본문: 상속인이 상속개시일 현재 18세 이상
  //   3. heirFarmingRequirementMet — ③1호: 2년전부터 계속 직접 영농종사(피상속인 65세 이전 사망 또는
  //      부득이한 사유 사망시 면제)+거주요건, 또는 ③2호: 2년전부터 계속 종사+신고기한까지 임원취임+
  //      2년내 대표이사등 취임(법인세법 적용영농), 또는 영농·영어·임업후계자
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
    let deductionAmount = Math.min(targetAmount, limitAmount);

    const eligibilityFlags = {
      decedentFarmingRequirementMet: p.decedentFarmingRequirementMet,
      heirAge18OrOlder: p.heirAge18OrOlder,
      heirFarmingRequirementMet: p.heirFarmingRequirementMet
    };
    const keys = Object.keys(eligibilityFlags);
    const requirementsUnverified = keys.some(function (k) { return eligibilityFlags[k] !== true && eligibilityFlags[k] !== false; });
    const failedRequirements = keys.filter(function (k) { return eligibilityFlags[k] === false; });
    let eligibilityGateApplied = false;
    if (failedRequirements.length > 0) {
      eligibilityGateApplied = true;
      deductionAmount = 0;
    }
    return { targetAmount, limitAmount, deductionAmount, individualTotal, targetCorporate, ratioInfo, requirementsUnverified, eligibilityGateApplied, failedRequirements };
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
      // §97의3①본문·1호(현행, 2024.12.31 최종개정) — "10년 이상 계속하여 임대한 후 양도하는 경우"에만
      // 70% 공제율을 적용한다. "8년 이상 50%"는 2018.1.16 개정본까지 있었던 구법(§2조제6호 단기민간
      // 임대주택 관련) 조항으로, 2020년 임대주택 등록제도 개편으로 삭제되어 현행법상 근거가 없다
      // (2026-08-21 사용자 제공 개정연혁 원문으로 확인). 8년만 임대한 경우는 이 특례를 받지 못한다.
      // 요건 미달이면 null을 반환해 특례를 적용하지 않은 것으로 처리한다(0을 반환하면 호출부가 이미
      // 계산해 둔 정상적인 일반/1세대1주택 장특공제율까지 강제로 0으로 덮어써버리는 별개의 버그가 있어
      // 2026-08-21 함께 정정 — 특례 미충족은 "장특공제 전액 상실"이 아니라 "특례 미적용(일반율 유지)"이다).
      if (ry >= 10) return 0.70;
      return null;
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
  // §21② — "제1항을 적용할 때 피상속인의 배우자가 단독으로 상속받는 경우에는 제18조와 제20조제1항에
  // 따른 공제액을 합친 금액으로만 공제한다" — 이 경우 5억원 하한·무신고시 5억원 고정 모두 배제되고
  // (기초공제+그 밖의 인적공제) 실액만 공제된다.
  function basicOrLumpSumDeduction(personalDeductionSum, isUnreported, isSpouseOnlyHeir) {
    if (isSpouseOnlyHeir) return 200000000 + (Number(personalDeductionSum) || 0);
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
  // 다주택중과 한시배제(시행령§167조의3①12의2호·§167조의10①12의2호, 2026.1.1 개정) — Code.js의
  // computeMultiHouseSurchargeExclusion_와 1:1 대응.
  function computeMultiHouseSurchargeExclusion(t, holdingYears) {
    if (!(holdingYears >= 2) || !t.transferDate) return false;
    if (t.transferDate <= '2026-05-09') return true;
    if (!t.saleContractDate) return false;
    const months = t.isExtendedDeadlineRegion ? 6 : 4;
    const cd = new Date(t.saleContractDate + 'T00:00:00');
    if (isNaN(cd.getTime())) return false;
    cd.setMonth(cd.getMonth() + months);
    const contractPlusMonths = cd.getFullYear() + '-' + String(cd.getMonth() + 1).padStart(2, '0') + '-' + String(cd.getDate()).padStart(2, '0');
    if (t.isLandTransactionPermitArea) {
      if (!t.isPermitApplicationFiledByDeadline || !t.isPermitObtained) return false;
      const deadline = t.saleContractDate >= '2026-05-10' ? (t.isExtendedDeadlineRegion ? '2026-11-09' : '2026-09-09') : contractPlusMonths;
      return t.transferDate <= deadline;
    }
    if (t.saleContractDate > '2026-05-09') return false;
    return t.transferDate <= contractPlusMonths;
  }
  // 연금계좌세액공제 요건 게이트(조특법§99의14①, 시행령§99의14①) — Code.js의
  // isPensionAccountCreditEligible_와 1:1 대응.
  function isPensionAccountCreditEligible(t, holdingYears) {
    if (!(Number(t.pensionAccountContribution) > 0)) return false;
    if (t.isBasicPensionRecipient === false) return false;
    if (t.isOneHouseOrNoHouseHousehold === false) return false;
    if (Number.isFinite(holdingYears) && holdingYears < 10) return false;
    if (t.transferDate && t.transferDate > '2027-12-31') return false;
    if (t.pensionContributionDate && t.transferDate) {
      if (t.pensionContributionDate < t.transferDate) return false;
      const deadline = new Date(t.transferDate + 'T00:00:00');
      deadline.setMonth(deadline.getMonth() + 6);
      const deadlineStr = deadline.getFullYear() + '-' + String(deadline.getMonth() + 1).padStart(2, '0') + '-' + String(deadline.getDate()).padStart(2, '0');
      if (t.pensionContributionDate > deadlineStr) return false;
    }
    return true;
  }
  function transferAssetCore(t) {
    const transferPrice = Number(t.transferPrice);
    let necessaryExpenses = Number(t.necessaryExpenses) || 0;
    if (!transferPrice || transferPrice <= 0) return { error: '양도가액이 필요합니다.' };

    // 취득가액 결정 — 실지거래가액(acquisitionPrice 직접입력)이 최우선이다. 이를 확인할 수 없으면
    // 소득세법시행령§176의2③의 순차적용(1호 매매사례가액 → 2호 감정가액 → 3호 환산취득가액 → 4호
    // 취득당시 기준시가)에 따라 자동으로 결정한다. 환산취득가액(§176의2②2호, 토지·건물·부동산취득권리
    // 기준)은 [양도당시 실지거래가액 × (취득당시기준시가÷양도당시기준시가)]이다. acquisitionStandardPrice는
    // 이 환산취득가액 계산과 아래 필요경비 개산공제(§163⑥) 계산에 공통으로 쓰인다(기존
    // acquisitionStandardPriceForExpense 필드도 하위호환으로 계속 인식한다).
    let acquisitionPrice = Number(t.acquisitionPrice) || 0;
    let acquisitionPriceMethodNote = '';
    let acquisitionPriceUsedAppraisalOrConversion = false;
    // acquisitionStandardPriceForConversion/transferStandardPriceForConversion은 이 환산취득가액 계산
    // 전용 필드다 — rentalSpecialType=rental_general에서 쓰는 acquisitionStandardPrice·transferStandardPrice
    // (임대기간중 양도차익 안분용, 아래 별도 분기)와 이름이 겹치지 않도록 의도적으로 구분했다.
    const acquisitionStandardPriceForConversion = Number(t.acquisitionStandardPriceForConversion) || Number(t.acquisitionStandardPriceForExpense) || 0;
    if (!t.acquisitionPrice && !t.isReconstructionRights) {
      const comparableTransactionPrice = Number(t.comparableTransactionPrice) || 0;
      const appraisalValue = Number(t.appraisalValue) || 0;
      const transferStandardPriceForConversion = Number(t.transferStandardPriceForConversion) || 0;
      if (comparableTransactionPrice > 0) {
        acquisitionPrice = comparableTransactionPrice;
        acquisitionPriceMethodNote = '취득가액은 매매사례가액(' + comparableTransactionPrice + '원, 시행령§176의2③1호)을 적용했습니다.';
      } else if (appraisalValue > 0) {
        acquisitionPrice = appraisalValue;
        acquisitionPriceUsedAppraisalOrConversion = true;
        acquisitionPriceMethodNote = '취득가액은 감정가액(' + appraisalValue + '원, 시행령§176의2③2호)을 적용했습니다.';
      } else if (acquisitionStandardPriceForConversion > 0 && transferStandardPriceForConversion > 0) {
        acquisitionPriceUsedAppraisalOrConversion = true;
        acquisitionPrice = Math.round(transferPrice * acquisitionStandardPriceForConversion / transferStandardPriceForConversion);
        acquisitionPriceMethodNote = '취득가액은 환산취득가액(시행령§176의2②2호·③3호) = 양도가액(' + transferPrice + '원)×[취득당시기준시가(' + acquisitionStandardPriceForConversion + '원)÷양도당시기준시가(' + transferStandardPriceForConversion + '원)] = ' + acquisitionPrice + '원으로 자동계산했습니다.';
      } else if (acquisitionStandardPriceForConversion > 0) {
        acquisitionPrice = acquisitionStandardPriceForConversion;
        acquisitionPriceMethodNote = '취득가액은 취득당시 기준시가(' + acquisitionStandardPriceForConversion + '원, 시행령§176의2③4호)를 그대로 적용했습니다.';
      }
    }
    // §97③ — 보유기간 중 그 자산에 대한 감가상각비를 사업소득금액 계산시 필요경비에 산입했거나
    // 산입할 금액이 있으면, 그 금액을 취득가액에서 공제한다(사업경비로 이미 공제받은 감가상각비를
    // 취득가액에도 남겨두면 이중공제가 되기 때문). 실제 산입액은 과거 사업소득 신고내역에 따른
    // 사실관계라 자동계산할 수 없으므로 직접 입력을 받는다.
    const depreciationDeductedAsBusinessExpense = Number(t.depreciationDeductedAsBusinessExpense) || 0;
    if (depreciationDeductedAsBusinessExpense > 0) {
      acquisitionPrice = Math.max(0, acquisitionPrice - depreciationDeductedAsBusinessExpense);
      acquisitionPriceMethodNote += (acquisitionPriceMethodNote ? ' ' : '') + '사업소득 필요경비로 산입한 감가상각비(' + depreciationDeductedAsBusinessExpense + '원, §97③)를 취득가액에서 차감했습니다.';
    }
    // §97의2④ — 가업상속공제(상증세법§18의2)가 적용된 자산을 상속인이 양도하는 경우, 취득가액은
    // "피상속인의 취득가액 × 가업상속공제적용률"과 "상속개시일 현재 해당 자산가액 × (1-가업상속공제적용률)"을
    // 합한 금액이다(일반 상속재산처럼 상속개시일 현재가액 전액을 취득가액으로 보지 않는다). 이 취득가액
    // 조정은 businessSuccessionDeductionRatio·decedentAcquisitionValue를 입력했을 때만 적용된다.
    const bizSuccessionRatio = Math.max(0, Math.min(1, Number(t.businessSuccessionDeductionRatio) || 0));
    if (bizSuccessionRatio > 0 && t.decedentAcquisitionValue != null) {
      const decedentAcquisitionValue = Number(t.decedentAcquisitionValue) || 0;
      const blendedAcquisitionPrice = Math.round(decedentAcquisitionValue * bizSuccessionRatio + acquisitionPrice * (1 - bizSuccessionRatio));
      acquisitionPriceMethodNote += (acquisitionPriceMethodNote ? ' ' : '') + '가업상속공제 적용분(§97의2④, 적용률 ' + Math.round(bizSuccessionRatio * 100) + '%)을 반영해 취득가액을 피상속인 취득가액과 상속개시일 현재가액의 가중평균(' + blendedAcquisitionPrice + '원)으로 조정했습니다.';
      acquisitionPrice = blendedAcquisitionPrice;
    }
    // 재건축·재개발 특례는 취득가액 대신 종전자산 취득가액(originalAssetAcquisitionPrice)·권리가액(rightsValue)을
    // 별도로 쓰므로, 이 경우에는 일반 취득가액 필수 검증을 적용하지 않는다(아래 재건축 분기에서 별도 검증).
    if (!t.isReconstructionRights && (!acquisitionPrice || acquisitionPrice < 0)) return { error: '취득가액이 필요합니다(실지거래가액을 모르면 매매사례가액·감정가액·취득당시기준시가 중 하나 이상을 입력하면 자동으로 산정합니다).' };
    if (!t.acquisitionDate || !t.transferDate) return { error: '취득일과 양도일이 필요합니다.' };

    const holdingYears = fullYearsElapsed(deemedAcquisitionDate(t.acquisitionDate), t.transferDate);
    if (holdingYears < 0) return { error: '양도일이 취득일보다 빠릅니다.' };

    // 개산공제율(시행령§163⑥1호·2호) — 원칙 3/100(3%)이나, 미등기양도자산은 3/1000(0.3%)로 10분의 1이다.
    if (!t.necessaryExpenses && t.useEstimatedNecessaryExpense && acquisitionStandardPriceForConversion > 0) {
      const estimatedExpenseRate = t.isUnregisteredTransfer ? 0.003 : 0.03;
      necessaryExpenses = Math.round(acquisitionStandardPriceForConversion * estimatedExpenseRate);
    }

    const isReconstruction = !!t.isReconstructionRights;
    // §104①2호·3호 — 단기양도세율은 "주택·조합원입주권·분양권"을 한 그룹으로 묶으므로 조합원입주권
    // (isReconstructionRights)도 자동으로 'house'로 취급한다.
    const assetType = (t.assetType === 'house' || isReconstruction) ? 'house' : (t.assetType === 'presale_right' ? 'presale_right' : 'other');
    const isPresaleRight = assetType === 'presale_right';
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
    // 시행령§168①3호 — 조특법§69①(8년자경농지)·§70①(농지대토) 감면 대상 토지는 미등기양도자산의
    // 가혹한 취급(70% 단일세율·공제 전부 배제)에서 제외된다.
    const isUnregistered = !!t.isUnregisteredTransfer && !(t.isEightYearFarmland || t.isFarmlandSubstitutionExempt);
    const gainBeforeDeduction = transferPrice - acquisitionPrice - necessaryExpenses;

    if (isUnregistered) {
      return { holdingYears, isUnregistered: true, gainBeforeDeduction, transferPrice, acquisitionPrice, necessaryExpenses, assetType, acquisitionPriceMethodNote, raw: t };
    }

    if (isOneHouse && transferPrice <= 1200000000) {
      return { holdingYears, exempt: true, transferPrice, acquisitionPrice, necessaryExpenses, assetType, acquisitionPriceMethodNote, raw: t };
    }
    if (isOneMemberRightOnly && transferPrice <= 1200000000) {
      return { holdingYears, exempt: true, transferPrice, acquisitionPrice, necessaryExpenses, assetType, acquisitionPriceMethodNote, raw: t };
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

      // 소득세법시행령§166③ — 기존건물과 그 부수토지의 취득가액을 확인할 수 없는 경우의 환산(원문 확인 완료):
      // 평가액 × (취득일 현재 기존건물과 그 부수토지의 소득세법§99①1호에 따른 기준시가 ÷
      //           관리처분계획등인가일 현재 기존건물과 그 부수토지의 같은 호에 따른 기준시가)
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
        // §95②본문 괄호 — "조합원으로부터 취득한 것"(승계조합원)은 이 장특공제 대상에서 아예 제외된다.
        taxableGain = gainBeforeApproval + gainAfterApproval;
        const isOriginalMember = t.isOriginalMember !== false;
        const ltRateBefore = isOriginalMember ? longTermRate(holdingYearsBeforeApproval) : 0;
        longTermDeductionAmount = Math.round(Math.max(0, gainBeforeApproval) * ltRateBefore);
        incomeAmount = taxableGain - longTermDeductionAmount;
        reconstructionDetail = { 구분: '조합원입주권(준공전) 양도 — §166①1호', 관리처분계획등인가전양도차익: Math.round(gainBeforeApproval), 관리처분계획등인가후양도차익: Math.round(gainAfterApproval), 인가전_보유기간_년: holdingYearsBeforeApproval, 인가전_장특공제율: ltRateBefore };
        if (!isOriginalMember) reconstructionDetail.안내_승계조합원 = '조합원으로부터 취득한 조합원입주권은 §95②본문 괄호에 따라 장기보유특별공제 대상에서 제외되어 인가전 구간 공제율을 0으로 적용했습니다.';
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
    } else if (bizSuccessionRatio > 0 && t.decedentAcquisitionDate) {
      // §95④단서 — 가업상속공제가 적용된 비율에 해당하는 자산은 장기보유특별공제의 보유기간 기산일이
      // "피상속인이 해당 자산을 취득한 날"이다(나머지 비율은 상속개시일 기산인 일반 상속재산과 동일).
      // §104(세율판정용 holdingYears)에는 이런 예외가 없으므로 holdingYears는 상속개시일 기준 그대로 쓴다.
      const decedentHoldingYears = fullYearsElapsed(deemedAcquisitionDate(t.decedentAcquisitionDate), t.transferDate);
      ltRate = longTermRate(decedentHoldingYears) * bizSuccessionRatio + longTermRate(holdingYears) * (1 - bizSuccessionRatio);
    } else {
      ltRate = longTermRate(holdingYears);
    }

    if (!isReconstruction && !isPresaleRight) {
      const rentalRate = rentalLongTermRate(t.rentalSpecialType, holdingYears, t.rentalYears);
      isRentalSpecial = rentalRate !== null;
      if (isRentalSpecial) ltRate = rentalRate;

      // 소득세법시행령§167조의3①12호의2(및 §167조의4③6의2·§167조의10①12호의2·§167조의11①12호,
      // 부칙 제4조 — 2022.5.10 이후 양도분부터 적용) — 조정대상지역 다주택자라도 "보유기간 2년 이상"
      // 요건을 갖춘 "2026년 5월 9일까지 양도하는 주택"만 한시적으로 중과(세율가산+장특공제배제)를
      // 적용하지 않는다. 보유기간 2년 미만이면 이 한시배제 대상이 아니므로 중과 여부를 그대로 판정해야
      // 한다(양도일만 보고 보유기간을 확인하지 않으면 단기양도인데도 잘못 배제될 수 있음).
      const isMultiHouseSurchargeExcluded = computeMultiHouseSurchargeExclusion(t, holdingYears);
      isMultiHouseSurcharge = !isOneHouse && !isRentalSpecial && !!t.isAdjustedArea && multiHouseCount >= 2 && !isMultiHouseSurchargeExcluded;
      if (isMultiHouseSurcharge) ltRate = 0;
    }

    let rentalPeriodSplit = null;
    if (!isReconstruction) {
      // 조특법시행령§97의3⑤ — §97의3(rental_general, 10년이상임대 70%)은 "임대기간중 발생한 양도차익"에
      // 한정해 70%를 적용하고, 등록 전 기간분에는 일반 장특공제율(§95②표1)을 적용한다(전체가 아님).
      // §97의4(rental_long)는 법문상 전체 양도차익에 향상된 공제율을 적용하므로 분리하지 않는다(위 img
      // 대체시 이미 확인).
      const acqStd = Number(t.acquisitionStandardPrice) || 0;
      const regStd = Number(t.registrationStandardPrice) || 0;
      const trfStd = Number(t.transferStandardPrice) || 0;
      const rentalGeneralNeedsSplit = isRentalSpecial && t.rentalSpecialType === 'rental_general' && ltRate > 0;
      if (rentalGeneralNeedsSplit && !(acqStd > 0 && regStd > 0 && trfStd > 0 && trfStd !== acqStd)) {
        // 기준시가 3종이 없거나 취득당시=양도당시(분모 0)이면 안분이 불가능하다. 이 경우 전체
        // 양도차익에 70%/50%(rentalRate)를 그대로 적용하면 "임대기간중 발생분"이 아닌 임대개시전
        // 발생분까지 특례공제를 받아 과다공제가 되므로, §97의5 자매함수와 마찬가지로 안분에 필요한
        // 값을 반드시 요구한다(조특법시행령§97의3⑤).
        return { error: '등록임대주택 장특공제 특례(§97의3, 10년이상 70%)는 임대기간중 발생한 양도차익에만 적용되므로, 취득당시·등록일당시·양도당시 기준시가(acquisitionStandardPrice·registrationStandardPrice·transferStandardPrice) 3종을 모두 입력해야 합니다(취득당시=양도당시 기준시가는 안분 불가).' };
      }
      if (rentalGeneralNeedsSplit) {
        const rentalPeriodGain = taxableGain * (trfStd - regStd) / (trfStd - acqStd);
        const beforeRentalGain = taxableGain - rentalPeriodGain;
        const normalRate = longTermRate(holdingYears);
        longTermDeductionAmount = Math.round(Math.max(0, rentalPeriodGain) * ltRate + Math.max(0, beforeRentalGain) * normalRate);
        incomeAmount = taxableGain - longTermDeductionAmount;
        rentalPeriodSplit = { 임대기간중양도차익: Math.round(rentalPeriodGain), 임대전양도차익: Math.round(beforeRentalGain), 임대전적용공제율: normalRate };
      } else {
        longTermDeductionAmount = Math.round(taxableGain * ltRate);
        incomeAmount = taxableGain - longTermDeductionAmount;
      }
    }
    // 분양권(§104①1호·2호·3호)은 보유기간과 무관하게 항상 60%(1년미만 70%) 단일세율이고 기본세율
    // 누진과세 대상이 될 수 없으므로(1호가 별도로 분양권 60%를 정함), 합산(pooling) 대상에서 제외한다.
    const isPoolable = !isPresaleRight && holdingYears >= 2; // 2년 이상 보유 → 기본세율(누진) 대상, 합산 가능

    // 소득세법§114의2① — 신축 또는 증축(바닥면적합계 85㎡ 초과분만)한 건물을 취득일·증축일로부터 5년
    // 이내에 양도하면서 그 취득가액을 §97①1호나목에 따른 "감정가액 또는 환산취득가액"으로 한 경우,
    // 해당 건물분 감정가액(또는 환산취득가액)의 5%를 가산세로 더한다 — 두 방법 모두 세율·기간요건이
    // 동일하므로 하나의 입력값(감정가액이든 환산취득가액이든)으로 함께 받는다. §114의2②에 따라
    // 산출세액이 0이어도(비과세 등) 적용된다(아래 totalTax 계산에서 무조건 가산).
    // 건물분만 별도로 지정하려면 convertedBuildingAcquisitionValueForPenalty를 직접 입력하고, 없으면
    // 위에서 감정가액·환산취득가액으로 자동결정된 취득가액(acquisitionPrice, 토지·건물 합산분)을 그대로
    // 쓴다(건물·토지를 분리평가하지 않은 단일자산 양도를 가정한 근사 — 토지·건물을 구분평가했다면
    // convertedBuildingAcquisitionValueForPenalty에 건물분만 직접 입력하세요).
    const convertedBuildingAcquisitionValueForPenalty = Number(t.convertedBuildingAcquisitionValueForPenalty) ||
      (acquisitionPriceUsedAppraisalOrConversion ? acquisitionPrice : 0);
    const conversionValuePenalty = (t.isNewBuildingWithin5Years && convertedBuildingAcquisitionValueForPenalty > 0)
      ? Math.round(convertedBuildingAcquisitionValueForPenalty * 0.05) : 0;

    return {
      reconstructionDetail, rentalPeriodSplit, acquisitionPriceMethodNote,
      holdingYears, exempt: false, isUnregistered: false, isPoolable,
      transferPrice, acquisitionPrice, necessaryExpenses, assetType, isOneHouse, isRentalSpecial,
      gainBeforeDeduction, taxableGain, longTermRate: ltRate, longTermDeductionAmount, incomeAmount,
      isMultiHouseSurcharge, multiHouseCount, isNonBusinessLand: !!t.isNonBusinessLand, isEightYearFarmland: !!t.isEightYearFarmland,
      // 조특법§69의2(축사용지)·§69의3(어업용토지)·§70(농지대토) — §69(자경농지)와 마찬가지로 요건
      // 충족시 양도소득세 100%를 감면한다(다만 셋 다 §69와 달리 8년이 아니라 각각 별도 보유·종사기간
      // 요건이 있음 — 요건 자체는 이 도구가 검증하지 않는다). §133①1호·2호나목에 따라 §66~§70(§69의2~
      // 69의4 포함) 감면세액은 전부 합쳐 과세기간당 1억원·5개 과세기간 합산 2억원 한도를 공유한다.
      isLivestockLandExempt: !!t.isLivestockLandExempt, isFisheryLandExempt: !!t.isFisheryLandExempt, isFarmlandSubstitutionExempt: !!t.isFarmlandSubstitutionExempt,
      // 조특법§69의4(자경산지) — 10년 이상 직접 경영해야 하고, 경영기간 구간별로 감면율이 다르다(10년↑20년↓10%,
      // 20~30년 20%, 30~40년 30%, 40~50년 40%, 50년↑ 50%). §69~§70과 달리 100% 정액감면이 아니다.
      // "직접 경영한 기간"은 양도차익 계산용 의제취득일(1985.1.1) 의제를 적용하지 않는 실제 취득일 기준
      // 기간이므로 holdingYears와 별도로 계산한다.
      isForestManagementExempt: !!t.isForestManagementExempt,
      forestManagementYears: t.acquisitionDate ? fullYearsElapsed(t.acquisitionDate, t.transferDate) : 0,
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
        취득가액_산정방법: core.acquisitionPriceMethodNote || undefined,
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
          취득가액_산정방법: core.acquisitionPriceMethodNote || undefined,
          비과세여부: false, 다운계약서_비과세배제: true,
          비과세미적용시_산출세액: wouldBeTax, 계약서_실거래_차액: downContractDiff,
          납부세액: clawback, 납부세액_합계: clawback
        };
      }
      return {
        입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
        취득가액_산정방법: core.acquisitionPriceMethodNote || undefined,
        비과세여부: true, 납부세액: 0
      };
    }

    const basicDeduction = 2500000;
    const taxBase = Math.max(0, core.incomeAmount - basicDeduction);
    let calculatedTax, appliedRateNote;
    const surchargeNotes = [];
    // §104④후단·⑦후단 — 다주택중과·비사업용토지(지정지역) 가산 대상 부동산은 보유기간이 2년 미만이어도
    // "[기본세율(누진)+가산율]로 계산한 산출세액"과 "단기양도세율(§104①2호·3호)로 계산한 산출세액" 중
    // 큰 세액을 산출세액으로 한다 — 즉 단기세율이 무조건 적용되는 게 아니라 가산세율 쪽과 비교해야 한다.
    function surchargeBasedTax_() {
      let tax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS);
      const notes = [];
      if (core.isMultiHouseSurcharge) {
        const rate = core.multiHouseCount >= 3 ? 0.30 : 0.20;
        const amt = Math.round(taxBase * rate);
        tax += amt;
        notes.push('다주택자 중과(+' + (rate * 100) + '%p): +' + amt + '원');
      }
      if (core.isNonBusinessLand) {
        const amt = Math.round(taxBase * 0.10);
        tax += amt;
        notes.push('비사업용토지 가산(+10%p): +' + amt + '원');
      }
      return { tax: tax, notes: notes };
    }
    if (core.assetType === 'presale_right') {
      // §104①1호·2호·3호 — 분양권은 보유기간 1년 미만 70%, 1년 이상은 무조건 60%(기본세율 누진 적용 없음).
      const rate = core.holdingYears < 1 ? 0.70 : 0.60;
      calculatedTax = Math.round(taxBase * rate);
      appliedRateNote = '분양권 — ' + (core.holdingYears < 1 ? '보유기간 1년 미만 70%' : '60%') + ' 단일세율 적용(장기보유특별공제·기본세율누진 배제)';
    } else if (core.holdingYears < 2 && (core.isMultiHouseSurcharge || core.isNonBusinessLand)) {
      const rate = core.holdingYears < 1 ? (core.assetType === 'house' ? 0.70 : 0.50) : (core.assetType === 'house' ? 0.60 : 0.40);
      const shortTermTax = Math.round(taxBase * rate);
      const alt = surchargeBasedTax_();
      if (alt.tax > shortTermTax) {
        calculatedTax = alt.tax;
        surchargeNotes.push.apply(surchargeNotes, alt.notes);
        appliedRateNote = '보유기간 2년 미만이나 다주택중과·비사업용토지 가산세율 적용시 세액이 더 커서(§104④·⑦후단) 기본세율+가산율 적용 — 단기세율(' + (rate * 100) + '%) 적용시: ' + shortTermTax + '원';
      } else {
        calculatedTax = shortTermTax;
        appliedRateNote = '보유기간 ' + (core.holdingYears < 1 ? '1년 미만' : '1년 이상 2년 미만') + ' 단기세율 ' + (rate * 100) + '% 적용(§104④·⑦후단 비교 결과 기본세율+가산율보다 큼)';
      }
    } else if (core.holdingYears < 1) {
      const rate = core.assetType === 'house' ? 0.70 : 0.50;
      calculatedTax = Math.round(taxBase * rate);
      appliedRateNote = '보유기간 1년 미만 단기세율 ' + (rate * 100) + '% 적용';
    } else if (core.holdingYears < 2) {
      const rate = core.assetType === 'house' ? 0.60 : 0.40;
      calculatedTax = Math.round(taxBase * rate);
      appliedRateNote = '보유기간 1년 이상 2년 미만 단기세율 ' + (rate * 100) + '% 적용';
    } else {
      const r = surchargeBasedTax_();
      calculatedTax = r.tax;
      surchargeNotes.push.apply(surchargeNotes, r.notes);
      appliedRateNote = '보유기간 2년 이상 — 기본세율(누진 6~45%) 적용';
    }
    let farmlandReduction = 0;
    let farmlandReductionLabel = '';
    let farmlandGateNote = '';
    let farmlandClawback = 0;
    if (core.isEightYearFarmland || core.isLivestockLandExempt || core.isFisheryLandExempt || core.isFarmlandSubstitutionExempt) {
      farmlandReduction = Math.min(calculatedTax, 100000000);
      calculatedTax -= farmlandReduction;
      farmlandReductionLabel = core.isEightYearFarmland ? '8년 자경농지 감면(조특법§69)'
        : core.isLivestockLandExempt ? '축사용지 감면(조특법§69의2)'
        : core.isFisheryLandExempt ? '어업용토지 감면(조특법§69의3)'
        : '농지대토 감면(조특법§70)';
      if (core.isEightYearFarmland) {
        farmlandGateNote = '§69①은 "농지 소재지에 거주하는" 거주자의 8년 이상 직접경작만 감면 대상입니다(재촌+자경 요건을 모두 충족해야 함). 경영이양 직접지불보조금 대상 농지를 한국농어촌공사·농업법인에 2026.12.31까지 양도하는 경우는 예외적으로 3년 이상 경작만으로도 충족됩니다.';
      }
      if (core.isLivestockLandExempt && t.isLivestockRestartedWithin5Years && !t.isLivestockRestartException) {
        farmlandClawback = farmlandReduction;
        farmlandGateNote = (farmlandGateNote ? farmlandGateNote + ' ' : '') + '축사용지 양도 후 5년 이내에 축산업을 다시 하여(§69의2②) 감면세액 ' + farmlandClawback + '원을 추징합니다(이자상당액은 calculate_clawback_interest 도구로 별도 계산하세요).';
      }
      if (core.isFarmlandSubstitutionExempt && t.isFarmlandSubstitutionRequirementFailed) {
        farmlandClawback = farmlandReduction;
        farmlandGateNote = (farmlandGateNote ? farmlandGateNote + ' ' : '') + '농지대토 요건을 사후에 충족하지 못하여(§70④) 감면세액 ' + farmlandClawback + '원을 사유발생일이 속하는 달의 말일부터 2개월 이내 추징합니다(이자상당액 가산, §70⑤ — calculate_clawback_interest 도구로 별도 계산하세요).';
      }
      calculatedTax += farmlandClawback;
    } else if (core.isForestManagementExempt) {
      // 조특법§69의4① — 10년 이상 직접 경영해야 하며(미만이면 감면 없음), 경영기간 구간별로 감면율이
      // 다르다: 10~20년 10%, 20~30년 20%, 30~40년 30%, 40~50년 40%, 50년 이상 50%.
      const yrs = core.forestManagementYears;
      const forestRate = yrs >= 50 ? 0.50 : yrs >= 40 ? 0.40 : yrs >= 30 ? 0.30 : yrs >= 20 ? 0.20 : yrs >= 10 ? 0.10 : 0;
      if (forestRate > 0) {
        farmlandReduction = Math.min(Math.round(calculatedTax * forestRate), 100000000);
        calculatedTax -= farmlandReduction;
        farmlandReductionLabel = '자경산지 감면(조특법§69의4, 경영기간 ' + yrs + '년 — ' + Math.round(forestRate * 100) + '%)';
      }
    }
    // 조특법§77①(2025.3.14 개정) — 현금보상 15%, 채권보상 20%, 3년만기특약 35%, 5년만기특약 45%.
    // §77의2(대토보상, 2026.12.31까지 양도분) — 40% 감면(또는 과세이연 선택 가능하나, 과세이연은 향후
    // 재양도시까지 세액을 이연하는 별도 구조라 이 도구는 감면 선택만 계산한다).
    // §77의3(개발제한구역 매수, 2028.12.31까지 양도분) — 지정일 이전 취득분 40%, 매수청구·사업인정고시일로부터
    // 20년 이전 취득분 25%(①구역 지정 상태·②해제 후 협의매수·수용 모두 세율 동일).
    const COMPENSATION_REDUCTION_RATES = {
      cash: 0.15, bond: 0.20, bond_3y: 0.35, bond_5y: 0.45,
      land_replacement: 0.40,
      restricted_zone_40: 0.40, restricted_zone_25: 0.25
    };
    const COMPENSATION_SUNSET_DATE = {
      cash: '2026-12-31', bond: '2026-12-31', bond_3y: '2026-12-31', bond_5y: '2026-12-31',
      land_replacement: '2026-12-31',
      restricted_zone_40: '2028-12-31', restricted_zone_25: '2028-12-31'
    };
    let compensationReduction = 0;
    let compensationReductionLabel = '';
    let compensationGateNote = '';
    if (COMPENSATION_REDUCTION_RATES[t.compensationType] !== undefined) {
      const isEminentDomainOrReplacement = ['cash', 'bond', 'bond_3y', 'bond_5y', 'land_replacement'].indexOf(t.compensationType) !== -1;
      const pastSunset = t.transferDate > COMPENSATION_SUNSET_DATE[t.compensationType];
      let failsTwoYearGate = false;
      if (isEminentDomainOrReplacement && t.acquisitionDate && t.transferDate) {
        const referenceDate = (t.publicNoticeDate && t.publicNoticeDate <= t.transferDate) ? t.publicNoticeDate : t.transferDate;
        failsTwoYearGate = fullYearsElapsed(t.acquisitionDate, referenceDate) < 2;
      }
      if (pastSunset) {
        compensationGateNote = '양도일이 감면 적용기한(' + COMPENSATION_SUNSET_DATE[t.compensationType] + ')을 지나 조특법 감면 대상이 아닙니다.';
      } else if (failsTwoYearGate) {
        compensationGateNote = '사업인정고시일(또는 고시 전 양도시 양도일)로부터 소급 2년 이전에 취득한 토지등만 감면 대상인데(§77①·§77의2①), 보유기간이 이에 못 미쳐 감면 대상이 아닙니다. 사업인정고시일을 아신다면 publicNoticeDate로 입력해 다시 확인하세요.';
      } else {
        const compRaw = Math.round(calculatedTax * COMPENSATION_REDUCTION_RATES[t.compensationType]);
        // 조특법§133②(2025.3.14 신설) — §77·§77의2·§77의3 감면세액 합계가 과세기간별 2억원을 초과하는
        // 부분은 감면하지 아니한다(5개 과세기간 합산 3억원 한도는 여러 건에 걸친 것이라 이 도구가
        // 추적하지 않음).
        compensationReduction = Math.min(compRaw, 200000000);
        calculatedTax -= compensationReduction;
        compensationReductionLabel = (t.compensationType === 'land_replacement') ? '대토보상 감면(조특법§77의2)'
          : (t.compensationType === 'restricted_zone_40' || t.compensationType === 'restricted_zone_25') ? '개발제한구역 매수 감면(조특법§77의3)'
          : '공익사업용토지 수용감면(조특법§77①)';
      }
    }
    let bondBreachClawback = 0;
    if (t.isBondPledgeBreached && (t.compensationType === 'bond_3y' || t.compensationType === 'bond_5y') && compensationReduction > 0) {
      const baseRate = t.compensationType === 'bond_5y' ? 0.25 : 0.15;
      const keptReduction = Math.round((compensationReduction / COMPENSATION_REDUCTION_RATES[t.compensationType]) * baseRate);
      bondBreachClawback = compensationReduction - keptReduction;
      calculatedTax += bondBreachClawback;
      compensationGateNote = (compensationGateNote ? compensationGateNote + ' ' : '') + '채권 만기보유 특약을 위반해(§77④) 감면세액 중 ' + bondBreachClawback + '원을 추징합니다(특약 없었을 때 세율 ' + Math.round(baseRate * 100) + '%와의 차액).';
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
    const pensionEligible = isPensionAccountCreditEligible(t, core.holdingYears);
    const pensionAccountCredit = pensionEligible ? Math.min(pensionAccountCreditRaw, Math.max(0, calculatedTax)) : 0;
    const pensionAccountClawback = (t.isPensionWithdrawnWithin5Years && pensionAccountCredit > 0) ? pensionAccountCredit : 0;
    const eFilingCredit = t.isSelfElectronicFiling ? Math.min(20000, Math.max(0, calculatedTax - pensionAccountCredit)) : 0;

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(t.filingStatus) !== -1 ? t.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(calculatedTax, filingStatus, !!t.isFraudulent, t.underreportedTaxAmount, t.unpaidDays, Number(t.unpaidTaxForLatePenalty), !!t.isOffshoreTransaction, t.monthsAfterDesignatedDueDate, Number(t.unpaidTaxAtDesignatedDueDate), t.fraudulentUnderreportedTaxAmount);
    const localIncomeTax = Math.round(calculatedTax * 0.1);
    const totalTax = Math.max(0, calculatedTax - pensionAccountCredit - eFilingCredit + core.conversionValuePenalty
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax + pensionAccountClawback);
    return {
      입력값: { 양도가액: core.transferPrice, 취득가액: core.acquisitionPrice, 필요경비: core.necessaryExpenses, 보유기간_년: core.holdingYears },
      취득가액_산정방법: core.acquisitionPriceMethodNote || undefined,
      조합원입주권_재건축상세: core.reconstructionDetail,
      양도차익: Math.round(core.reconstructionDetail ? core.taxableGain : core.gainBeforeDeduction), 과세대상양도차익: Math.round(core.taxableGain),
      장기보유특별공제율: core.longTermRate, 장기보유특별공제액: core.longTermDeductionAmount,
      양도소득금액: Math.round(core.incomeAmount), 기본공제: basicDeduction, 과세표준: taxBase,
      적용세율_설명: appliedRateNote, 세율가산_내역: surchargeNotes, 자경농지감면액: farmlandReduction,
      자경농지감면_구분: farmlandReductionLabel, 자경농지감면_요건안내: farmlandGateNote || undefined, 자경농지감면_추징액: farmlandClawback,
      수용감면액: compensationReduction, 수용감면_구분: compensationReductionLabel, 수용감면_요건안내: compensationGateNote || undefined,
      채권만기특약위반_추징액: bondBreachClawback, 다운계약서_감면배제_추징액: downContractClawback,
      장기임대주택특례_적용여부: core.isRentalSpecial, 장기임대주택특례_임대기간중분리상세: core.rentalPeriodSplit,
      산출세액: calculatedTax, 연금계좌세액공제: pensionAccountCredit, 연금계좌세액공제_추징액: pensionAccountClawback, 전자신고세액공제: eFilingCredit,
      환산취득가액가산세: core.conversionValuePenalty,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      지방소득세: localIncomeTax, 납부세액_합계: totalTax
    };
  };

  // 이월과세 (소득세법§97의2, 시행령§163의2) — 거주자가 배우자 또는 직계존비속으로부터 증여받은
  // §94①1호(부동산)·§94①2호가목(부동산취득권리, 분양권)·§94①4호나목(부동산과다보유법인주식) 자산을
  // 증여일로부터 10년(§94①3호 주식등은 1년, 이 함수 범위 밖) 이내에 양도하면, 수증자 본인의 취득가액이
  // 아니라 증여자의 원취득가액·취득일·필요경비를 그대로 승계해서 양도차익을 계산하고, 수증자가 낸
  // 증여세 상당액(시행령§163의2②)을 필요경비에 추가로 얹는다. 다만 다음은 이월과세를 적용하지 않는다:
  // §97의2②2호 — 이월과세를 적용하면 §89①3호 주택(고가주택 포함) 비과세 대상이 되는 경우(비과세를
  //   얻기 위한 남용 방지 — 즉 증여자의 이른 취득일을 끌어써서 보유·거주요건을 채우는 것을 막는다)
  // §97의2②3호 — 이월과세 적용시 결정세액이 미적용시 결정세액보다 적은 경우(세액을 낮추는 용도로
  //   쓰는 것을 막는다 — 결과적으로 "적용/미적용 중 세액이 더 큰 쪽"이 채택된다)
  // 관계·기간 요건은 giftReceivedDate·donorRelation으로 직접 판정하고(요건 미충족이면 이월과세
  // 자체를 적용하지 않고 수증자 본인 값으로만 계산), 수용 특례(§97의2②1호)는 별도 입력으로 받는다.
  window.calculateTransferTaxWithCarryoverJS = function (t) {
    t = t || {};
    const giftReceivedDate = t.giftReceivedDate;
    const donorRelation = t.donorRelation; // 'spouse' | 'lineal'
    const isEligibleRelation = donorRelation === 'spouse' || donorRelation === 'lineal';
    const yearsSinceGift = (giftReceivedDate && t.transferDate) ? fullYearsElapsed(giftReceivedDate, t.transferDate) : Infinity;
    const isWithinWindow = yearsSinceGift < 10 || (yearsSinceGift === 10 && giftReceivedDate === t.transferDate);
    const isEminentDomainExcluded = !!t.isEminentDomainExcludedFromCarryover; // §97의2②1호

    // 수증자 본인 값으로 계산(이월과세 미적용 시나리오) — 증여 당시 평가액을 취득가액, 증여일을
    // 취득일로 삼는다(증여로 취득한 자산의 취득가액은 상증세법상 평가액이므로).
    const withoutCarryoverParams = Object.assign({}, t, {
      acquisitionPrice: Number(t.doneeOwnAcquisitionPrice) || 0,
      acquisitionDate: giftReceivedDate,
      necessaryExpenses: Number(t.doneeOwnNecessaryExpenses) || 0
    });
    const withoutResult = window.calculateTransferTaxSingleJS(withoutCarryoverParams);

    if (!isEligibleRelation || !isWithinWindow || isEminentDomainExcluded) {
      if (withoutResult && !withoutResult.error) withoutResult.이월과세_적용여부 = false;
      if (withoutResult && !withoutResult.error) {
        withoutResult.이월과세_미적용사유 = !isEligibleRelation ? '배우자·직계존비속으로부터의 증여가 아님'
          : (!isWithinWindow ? '증여일로부터 10년 경과' : '수용 특례(§97의2②1호) 해당');
      }
      return withoutResult;
    }

    // 증여세 상당액(시행령§163의2②) = 증여세산출세액 × 해당자산 증여세과세가액/전체 증여세과세가액,
    // 필요경비 산입 한도 = 양도가액 - (증여자 취득가액 + 증여자 필요경비)(§97①②금액).
    const donorAcqPrice = Number(t.donorAcquisitionPrice) || 0;
    const donorNecessaryExpenses = Number(t.donorNecessaryExpenses) || 0;
    const giftTaxPaid = Number(t.giftTaxPaid) || 0;
    const giftTaxableValue = Number(t.giftTaxableValue) || 0;
    const assetGiftTaxableValue = Number(t.doneeOwnAcquisitionPrice) || 0; // 이 자산의 증여세 과세가액(=증여 당시 평가액)
    const giftTaxEquivalent = giftTaxableValue > 0 ? Math.round(giftTaxPaid * assetGiftTaxableValue / giftTaxableValue) : 0;
    const necessaryExpenseCap = Math.max(0, (Number(t.transferPrice) || 0) - donorAcqPrice - donorNecessaryExpenses);
    const cappedGiftTaxEquivalent = Math.min(giftTaxEquivalent, necessaryExpenseCap);

    const withCarryoverParams = Object.assign({}, t, {
      acquisitionPrice: donorAcqPrice,
      acquisitionDate: t.donorAcquisitionDate,
      necessaryExpenses: donorNecessaryExpenses + cappedGiftTaxEquivalent
    });
    const withResult = window.calculateTransferTaxSingleJS(withCarryoverParams);

    // §97의2②2호 — 이월과세를 적용하면 §89①3호 비과세(1세대1주택 등)에 해당하게 되는 경우는 배제.
    const withBecomesExempt = !!(withResult && withResult.비과세여부);
    if (withBecomesExempt) {
      if (withoutResult && !withoutResult.error) { withoutResult.이월과세_적용여부 = false; withoutResult.이월과세_미적용사유 = '§97의2②2호 — 이월과세 적용시 1세대1주택 등 비과세 대상이 되어 배제'; }
      return withoutResult;
    }

    const withTax = (withResult && typeof withResult.납부세액_합계 === 'number') ? withResult.납부세액_합계 : (withResult && withResult.비과세여부 ? 0 : Infinity);
    const withoutTax = (withoutResult && typeof withoutResult.납부세액_합계 === 'number') ? withoutResult.납부세액_합계 : (withoutResult && withoutResult.비과세여부 ? 0 : Infinity);

    // §97의2②3호 — 적용시 세액이 미적용시 세액보다 적으면 미적용(둘 중 세액이 더 큰 쪽 채택).
    const chosen = withTax < withoutTax ? withoutResult : withResult;
    if (chosen && !chosen.error) {
      chosen.이월과세_적용여부 = chosen === withResult;
      if (chosen !== withResult) chosen.이월과세_미적용사유 = '§97의2②3호 — 이월과세를 적용한 세액(' + withTax + '원)이 미적용시 세액(' + withoutTax + '원)보다 적어 미적용';
      chosen.이월과세_비교 = { 적용시_세액: withTax, 미적용시_세액: withoutTax, 증여세상당액_필요경비산입: cappedGiftTaxEquivalent };
    }
    return chosen;
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
    cores.forEach(function (c) {
      if (c.acquisitionPriceMethodNote) assetNotes.push({ idx: c.idx, 구분: '취득가액산정', 특례: c.acquisitionPriceMethodNote });
    });
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
    let farmlandClawbackTotal = 0;
    const reductionByIdx_ = {};
    pooled.forEach(function (c) {
      const specialExemptLabel = c.isEightYearFarmland ? '8년자경농지감면(안분)'
        : c.isLivestockLandExempt ? '축사용지감면(안분)'
        : c.isFisheryLandExempt ? '어업용토지감면(안분)'
        : c.isFarmlandSubstitutionExempt ? '농지대토감면(안분)' : null;
      if (specialExemptLabel && poolIncomeSum > 0) {
        const share = Math.round(poolTaxWithSurcharge * (c.incomeAmount / poolIncomeSum));
        const reduction = Math.min(share, 100000000);
        farmlandReductionTotal += reduction;
        reductionByIdx_[c.idx] = (reductionByIdx_[c.idx] || 0) + reduction;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: specialExemptLabel, 감면액: reduction });
        if (c.isLivestockLandExempt && c.raw.isLivestockRestartedWithin5Years && !c.raw.isLivestockRestartException) {
          farmlandClawbackTotal += reduction;
          assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 특례: '축사용지 재축산 추징(§69의2②)', 감면액: -reduction });
        }
        if (c.isFarmlandSubstitutionExempt && c.raw.isFarmlandSubstitutionRequirementFailed) {
          farmlandClawbackTotal += reduction;
          assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 특례: '농지대토 요건미충족 추징(§70④)', 감면액: -reduction });
        }
      } else if (c.isForestManagementExempt && poolIncomeSum > 0) {
        const yrs = c.forestManagementYears;
        const forestRate = yrs >= 50 ? 0.50 : yrs >= 40 ? 0.40 : yrs >= 30 ? 0.30 : yrs >= 20 ? 0.20 : yrs >= 10 ? 0.10 : 0;
        if (forestRate > 0) {
          const share = Math.round(poolTaxWithSurcharge * (c.incomeAmount / poolIncomeSum));
          const reduction = Math.min(Math.round(share * forestRate), 100000000);
          farmlandReductionTotal += reduction;
          reductionByIdx_[c.idx] = (reductionByIdx_[c.idx] || 0) + reduction;
          assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: '자경산지감면(안분, ' + Math.round(forestRate * 100) + '%)', 감면액: reduction });
        }
      }
    });
    // §133①1호 — 위 개별 100000000 한도는 감면 "종류별 거래 1건" 기준이 아니라, 자경농지·축사용지·
    // 어업용토지·농지대토·자경산지 감면 "합계액"이 과세기간별 1억원을 넘는 부분을 감면하지 않는다는
    // 종합한도다. 같은 과세기간에 이런 거래가 여러 건이면 개별한도를 통과해도 합계가 1억원을 넘을 수
    // 있으므로 최종적으로 한 번 더 캡한다(개별 거래별 감면액 재배분은 하지 않음 — 다운계약 추징 비교용
    // reductionByIdx_는 이 캡 전 값을 유지한다).
    farmlandReductionTotal = Math.min(farmlandReductionTotal, 100000000);
    poolTaxWithSurcharge = Math.max(0, poolTaxWithSurcharge - farmlandReductionTotal + farmlandClawbackTotal);

    // 공익사업용 토지 등 수용감면(조특법§77①·§77의2·§77의3, 안분) — 소득금액 비중으로 배분한 세액에
    // 보상유형별 비율을 곱한다. §133②(2025.3.14 신설)에 따라 건별 감면액은 과세기간별 2억원을 한도로
    // 한다(5개 과세기간 합산 3억원 한도는 여러 건에 걸친 것이라 이 도구가 추적하지 않음).
    const COMPENSATION_REDUCTION_RATES_M = {
      cash: 0.15, bond: 0.20, bond_3y: 0.35, bond_5y: 0.45,
      land_replacement: 0.40,
      restricted_zone_40: 0.40, restricted_zone_25: 0.25
    };
    const COMPENSATION_SUNSET_DATE_M = {
      cash: '2026-12-31', bond: '2026-12-31', bond_3y: '2026-12-31', bond_5y: '2026-12-31',
      land_replacement: '2026-12-31',
      restricted_zone_40: '2028-12-31', restricted_zone_25: '2028-12-31'
    };
    let compensationReductionTotal = 0;
    let bondBreachClawbackTotal = 0;
    pooled.forEach(function (c) {
      const rate = COMPENSATION_REDUCTION_RATES_M[c.raw.compensationType];
      if (rate === undefined || poolIncomeSum <= 0) return;
      const isEminentDomainOrReplacement = ['cash', 'bond', 'bond_3y', 'bond_5y', 'land_replacement'].indexOf(c.raw.compensationType) !== -1;
      if (c.raw.transferDate > COMPENSATION_SUNSET_DATE_M[c.raw.compensationType]) return;
      if (isEminentDomainOrReplacement && c.raw.acquisitionDate && c.raw.transferDate) {
        const referenceDate = (c.raw.publicNoticeDate && c.raw.publicNoticeDate <= c.raw.transferDate) ? c.raw.publicNoticeDate : c.raw.transferDate;
        if (fullYearsElapsed(c.raw.acquisitionDate, referenceDate) < 2) return;
      }
      {
        const share = Math.round(poolTaxWithSurcharge * (c.incomeAmount / poolIncomeSum));
        const reduction = Math.min(Math.round(share * rate), 200000000);
        compensationReductionTotal += reduction;
        reductionByIdx_[c.idx] = (reductionByIdx_[c.idx] || 0) + reduction;
        assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 소득금액: Math.round(c.incomeAmount), 특례: '수용감면(안분)', 감면액: reduction });
        if (c.raw.isBondPledgeBreached && (c.raw.compensationType === 'bond_3y' || c.raw.compensationType === 'bond_5y') && reduction > 0) {
          const baseRate = c.raw.compensationType === 'bond_5y' ? 0.25 : 0.15;
          const clawback = reduction - Math.round((reduction / rate) * baseRate);
          bondBreachClawbackTotal += clawback;
          assetNotes.push({ idx: c.idx, 구분: '합산(장기)', 특례: '채권만기특약위반 추징(§77④)', 감면액: -clawback });
        }
      }
    });
    // §133②1호 — 개별 200000000 한도와 별개로, 수용감면 합계액이 과세기간별 2억원을 넘는 부분은
    // 감면하지 않는다(같은 과세기간 여러 건 합산 캡).
    compensationReductionTotal = Math.min(compensationReductionTotal, 200000000);
    poolTaxWithSurcharge = Math.max(0, poolTaxWithSurcharge - compensationReductionTotal + bondBreachClawbackTotal);

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
    // §104⑤2호 단서 — "둘 이상의 자산에 대하여... 세율 중 동일한 호의 세율이 적용되고, 그 적용세율이
    // 둘 이상인 경우 해당 자산에 대해서는 각 자산의 양도소득과세표준을 합산한 것에 대하여... 세율을
    // 적용하여 산출한 세액 중에서 큰 산출세액의 합계액으로 한다" — 다주택중과·비사업용토지로 단기세율과
    // [누진세율+가산율] 중 큰 세액을 적용해야 하는 자산이 2건 이상이면, 자산별로 각각 MAX비교하는 게
    // 아니라 그 자산들의 과세표준을 "가산율 조합이 같은 것끼리" 합산한 뒤 그 합산액에 MAX비교를 적용해야
    // 한다(누진세율은 볼록함수라 자산별 개별비교보다 세액이 커질 수 있음).
    const shortItems = shortTerm.map(function (c) {
      const bd = (!usedBasicOnShort) ? 2500000 : 0;
      if (bd) usedBasicOnShort = true;
      const base = Math.max(0, c.incomeAmount - bd);
      const rate = (c.assetType === 'house' || c.assetType === 'presale_right')
        ? (c.holdingYears < 1 ? 0.70 : 0.60) : (c.holdingYears < 1 ? 0.50 : 0.40);
      const shortTermTax = Math.round(base * rate);
      const dualRateEligible = c.assetType !== 'presale_right' && (c.isMultiHouseSurcharge || c.isNonBusinessLand);
      const surchargePct = dualRateEligible
        ? ((c.isMultiHouseSurcharge ? (c.multiHouseCount >= 3 ? 30 : 20) : 0) + (c.isNonBusinessLand ? 10 : 0))
        : null;
      return { c: c, bd: bd, base: base, rate: rate, shortTermTax: shortTermTax, dualRateEligible: dualRateEligible, surchargePct: surchargePct };
    });
    // 가산율 조합(surchargePct)이 같은 dualRateEligible 항목끼리 그룹화 — 그룹의 과세표준 합계로 MAX비교.
    const dualRateGroups = {};
    shortItems.forEach(function (it) {
      if (!it.dualRateEligible) return;
      const key = String(it.surchargePct);
      if (!dualRateGroups[key]) dualRateGroups[key] = { surchargePct: it.surchargePct, items: [] };
      dualRateGroups[key].items.push(it);
    });
    Object.keys(dualRateGroups).forEach(function (key) {
      const g = dualRateGroups[key];
      const groupBaseSum = g.items.reduce(function (s, it) { return s + it.base; }, 0);
      const groupShortTermTaxSum = g.items.reduce(function (s, it) { return s + it.shortTermTax; }, 0);
      const groupAltTax = progressiveTax(groupBaseSum, TRANSFER_TAX_BRACKETS) + Math.round(groupBaseSum * g.surchargePct / 100);
      const groupTax = Math.max(groupShortTermTaxSum, groupAltTax);
      // 합산 세액을 자산별 과세표준 비중으로 재배분한다(개별 세액은 참고용 표시일 뿐, 합계만 정확하면 됨).
      let allocated = 0;
      g.items.forEach(function (it, i) {
        const share = groupBaseSum > 0 ? it.base / groupBaseSum : 0;
        it.finalTax = (i === g.items.length - 1) ? (groupTax - allocated) : Math.round(groupTax * share);
        allocated += it.finalTax;
      });
    });
    const shortResults = shortItems.map(function (it) {
      const c = it.c;
      const tax = it.dualRateEligible ? it.finalTax : it.shortTermTax;
      assetNotes.push({ idx: c.idx, 구분: '단기양도(개별)', 소득금액: Math.round(c.incomeAmount), 기본공제적용: it.bd > 0, 세율: it.rate, 세액: tax });
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
    let pensionAccountCreditRaw = 0;
    let pensionAccountClawbackTotal = 0;
    active.forEach(function (c) {
      const raw = Math.round(Number(c.pensionAccountContribution) * 0.1) || 0;
      if (raw <= 0) return;
      const eligible = isPensionAccountCreditEligible(c.raw || {}, c.holdingYears);
      const credit = eligible ? raw : 0;
      pensionAccountCreditRaw += credit;
      if (c.raw && c.raw.isPensionWithdrawnWithin5Years && credit > 0) pensionAccountClawbackTotal += credit;
    });

    // exemptClawbackTotal(다운계약서 비과세배제 추징액)은 calculateTransferTaxSingleJS의 완전 계산 결과(지방소득세 포함)를
    // 상한으로 삼아 MIN한 값이라 이미 지방소득세가 녹아 있으므로, 아래 totalCalculatedTax에는 포함하지 않고
    // (그러면 다시 10% 지방소득세가 얹혀 이중계산된다) 최종 합계에만 그대로 더한다.
    const totalCalculatedTax = poolTaxWithSurcharge + shortTaxTotal + unregisteredTaxTotal;
    const pensionAccountCreditTotal = Math.min(pensionAccountCreditRaw, Math.max(0, totalCalculatedTax));
    const eFilingCredit = filingParams.isSelfElectronicFiling ? Math.min(20000, Math.max(0, totalCalculatedTax - pensionAccountCreditTotal)) : 0;
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(filingParams.filingStatus) !== -1 ? filingParams.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(totalCalculatedTax, filingStatus, !!filingParams.isFraudulent, filingParams.underreportedTaxAmount, filingParams.unpaidDays, Number(filingParams.unpaidTaxForLatePenalty), !!filingParams.isOffshoreTransaction, filingParams.monthsAfterDesignatedDueDate, Number(filingParams.unpaidTaxAtDesignatedDueDate), filingParams.fraudulentUnderreportedTaxAmount);
    const localIncomeTax = Math.round(totalCalculatedTax * 0.1);
    const grandTotal = Math.max(0, totalCalculatedTax - pensionAccountCreditTotal - eFilingCredit + conversionValuePenaltyTotal
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax + exemptClawbackTotal + pensionAccountClawbackTotal);

    return {
      거래건수: transactions.length, 비과세건수: exempt.length,
      합산대상_장기거래건수: pooled.length, 합산소득금액: Math.round(poolIncomeSum),
      기본공제: basicDeductionUsedInPool ? 2500000 : (usedBasicOnShort && shortTerm.length ? 2500000 : 0),
      합산과세표준: poolTaxBase, 합산기본세액: poolBaseTax, 합산가산액: poolSurchargeTotal, 합산자경감면액: farmlandReductionTotal, 합산자경감면_추징액: farmlandClawbackTotal,
      합산수용감면액: compensationReductionTotal, 합산채권만기특약위반_추징액: bondBreachClawbackTotal, 다운계약서_감면배제_추징액: downContractClawbackTotal, 비과세거래_다운계약서_추징액: exemptClawbackTotal,
      합산그룹_산출세액: poolTaxWithSurcharge,
      단기거래_산출세액_합계: shortTaxTotal, 미등기거래_산출세액_합계: unregisteredTaxTotal,
      산출세액_합계: totalCalculatedTax,
      연금계좌세액공제_합계: pensionAccountCreditTotal, 연금계좌세액공제_추징액: pensionAccountClawbackTotal, 전자신고세액공제: eFilingCredit,
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

  // 무신고·과소신고·납부지연가산세 (국세기본법 §47의2~§47의4) — 일반 20%/10%, 부정행위 40%.
  // 국세기본법§47의2①1호·§47의3①1호가목 — 부정행위로 인한 무신고·과소신고가산세는 원칙 40%이나,
  // "역외거래에서 발생한 부정행위"는 60%다. isOffshoreTransaction이 없으면(대부분의 국내 거래) 종전처럼 40%.
  // 납부지연가산세(§47의4①, 2026.7.1 시행 개정 반영)는 세 부분으로 구성된다 —
  // 1호: 법정납부기한 다음날~납부고지일(또는 그 전 납부일) 전날까지, 1일 10만분의22(시행령§27의4①).
  // 1의2호·⑦·⑧: 세무서가 고지(지정납부기한 지정)한 뒤에도 계속 체납되면, 지정납부기한 다음날부터
  //   매 1개월 경과시마다 월 1만분의67을 추가한다(시행령§27의4②). 5년(60개월) 상한(⑦), 체납세액이
  //   고지서별·세목별 150만원 미만이면 이 부분은 적용하지 않는다(⑧).
  // 3호: 지정납부기한까지 납부하지 않은 세액에 대해 정액 3%를 1회 추가한다(150만원 기준과 무관하게 적용).
  // monthsAfterDesignatedDueDate·unpaidTaxAtDesignatedDueDate를 생략하면(고지 전 자진납부만 하는 경우)
  // 1호만 적용되어 종전과 동일하게 동작한다.
  function giftFilingPenalties(taxAfterCredit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxOverride, isOffshoreTransaction, monthsAfterDesignatedDueDate, unpaidTaxAtDesignatedDueDate, fraudulentUnderreportedTaxAmount) {
    let unreportedPenalty = 0, underreportedPenalty = 0;
    const fraudRate = isOffshoreTransaction ? 0.60 : 0.40;
    if (filingStatus === 'unreported') {
      unreportedPenalty = Math.round(taxAfterCredit * (isFraudulent ? fraudRate : 0.20));
    } else if (filingStatus === 'underreported') {
      // 국세기본법§47의3①1호가목·나목 — 과소신고분 중 부정행위로 인한 부분은 40%(역외 60%), 그 나머지
      // (부정행위가 아닌 부분)는 10%로 각각 계산해 합산한다. fraudulentUnderreportedTaxAmount를 넣지
      // 않으면(구버전 호환) isFraudulent가 과소신고분 전체에 적용된 것으로 본다(전액 부정 또는 전액 일반).
      const total = Number(underreportedTaxAmount) || 0;
      if (isFraudulent) {
        const fraudPortion = fraudulentUnderreportedTaxAmount != null ? Math.min(Number(fraudulentUnderreportedTaxAmount) || 0, total) : total;
        const nonFraudPortion = total - fraudPortion;
        underreportedPenalty = Math.round(fraudPortion * fraudRate) + Math.round(nonFraudPortion * 0.10);
      } else {
        underreportedPenalty = Math.round(total * 0.10);
      }
    }
    const base = Number.isFinite(unpaidTaxOverride) ? unpaidTaxOverride : taxAfterCredit;
    const dailyInterestPenalty = Math.round(base * (Number(unpaidDays) || 0) * 0.00022);
    const unpaidAtDesignated = Number(unpaidTaxAtDesignatedDueDate) || 0;
    const cappedMonths = Math.min(Number(monthsAfterDesignatedDueDate) || 0, 60);
    const monthlyInterestPenalty = (unpaidAtDesignated >= 1500000 && cappedMonths > 0) ? Math.round(unpaidAtDesignated * cappedMonths * 0.0067) : 0;
    const designatedDueDatePenalty = unpaidAtDesignated > 0 ? Math.round(unpaidAtDesignated * 0.03) : 0;
    const latePenalty = dailyInterestPenalty + monthlyInterestPenalty + designatedDueDatePenalty;
    return {
      unreportedPenalty: unreportedPenalty, underreportedPenalty: underreportedPenalty, latePenalty: latePenalty,
      납부지연가산세_상세: { 사전이자분_1호: dailyInterestPenalty, 고지후월할이자분_1의2호: monthlyInterestPenalty, 고지후정액3퍼센트분_3호: designatedDueDatePenalty }
    };
  }

  // 증여세 — gs-backend toolCalculateGiftTax와 동일 로직([별지 제10호서식] 기준).
  window.calculateGiftTaxJS = function (p) {
    p = p || {};
    const giftAmount = Number(p.giftAmount);
    if (!giftAmount || giftAmount <= 0) return { error: '증여재산가액이 필요합니다.' };
    if (['배우자', '직계존속', '직계비속', '기타친족', '기타'].indexOf(p.relation) === -1) {
      return { error: '관계를 배우자/직계존속/직계비속/기타친족/기타 중에서 선택하세요.' };
    }
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
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

    // 시행령§46의2·§20의3③ — 비상장주식 신용평가전문기관 평가수수료(2호)는 일반 감정수수료(1호·3호,
    // 500만원 한도)와 별개로 평가대상 법인수×의뢰기관수별 1천만원 한도가 적용된다.
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000)
      + Math.min(Number(p.unlistedStockAppraisalFeeAmount) || 0, 10000000);

    // §55①3호 — 명의신탁재산 증여의제(1호)·일감몰아주기등 이익의 증여의제(2호)를 제외한
    // "합산배제증여재산"은 §53(관계별공제)·§53의2(혼인출산공제)·§54(재해손실공제)를 적용하지 않고
    // "증여재산가액 - 3천만원"만 과세표준으로 한다(감정평가수수료는 모든 호에 공통 적용). 4호(일반증여)와는
    // 완전히 별개 산식이므로 10년내 동일인 증여 합산(priorGiftAmount)도 적용하지 않는다(§47②단서).
    // §53 본문·§53의2①② — 둘 다 "거주자가... 증여를 받은 경우"로 한정되어 있어, 수증자가 비거주자이면
    // 관계별공제(§53)도 혼인출산공제(§53의2)도 받을 수 없다(과거 신고분 대량 케이스가 대부분 거주자라
    // 기본값은 거주자로 두되, 비거주자임을 명시하면 두 공제 모두 0으로 게이트한다).
    const isDoneeResident = p.isDoneeResident !== false;
    let relationDeduction = 0, marriageBirthDeduction = 0, disasterLossDeduction = 0, aggregationExclusionDeduction = 0, taxBase;
    if (p.isExcludedFromAggregation) {
      aggregationExclusionDeduction = 30000000;
      taxBase = Math.max(0, netGiftAmount - aggregationExclusionDeduction - appraisalFeeDeduction);
    } else {
      // §53 본문 — "그 증여세 과세가액에서 공제받을 금액과 수증자가 증여받기 전 10년 이내에 공제받은
      // 금액을 합한 금액이 [한도]를 초과하면 초과분은 공제하지 아니한다" — 관계별 한도는 "이번 한 번"이
      // 아니라 "10년 합산" 기준이므로, 그 기간 중 이미 쓴 공제액을 이번 한도에서 미리 차감해야 한다.
      relationDeduction = isDoneeResident
        ? Math.max(0, giftPropertyDeduction(p.relation, !!p.isMinor) - (Number(p.priorRelationDeductionUsed) || 0)) : 0;
      // §53의2①② — "거주자가 직계존속으로부터... 증여를 받는 경우"에만 적용되는 공제다. 배우자·직계비속·
      // 기타친족으로부터의 증여에는 적용되지 않는다.
      marriageBirthDeduction = (isDoneeResident && p.relation === '직계존속' && (p.isMarriageGift || p.isBirthGift))
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
    // §57① 괄호 — 40%는 "직계비속이면서 미성년자인 수증자가 20억원 초과분을 받은 경우"에 한정.
    // 미성년 요건 없이 20억 초과만으로 40%를 적용하면 과다할증이므로 반드시 isMinor를 함께 확인한다.
    // §57① 단서 — "증여자의 최근친인 직계비속이 사망하여 그 사망자의 최근친인 직계비속이 증여받은
    // 경우"(대습증여에 준하는 경우)는 할증을 적용하지 않는다.
    const premiumRate = (isGenerationSkip && !p.isSubstituteGiftDueToDeath) ? ((p.generationSkipOver2Billion && p.isMinor) ? 0.4 : 0.3) : 0;
    const priorPaidGenerationSkipPremium = Number(p.priorPaidGenerationSkipPremium) || 0;
    const premiumAmount = Math.max(0, Math.round(taxBeforePremium * generationSkipRatio * premiumRate) - priorPaidGenerationSkipPremium);
    const taxAfterPremium = taxBeforePremium + premiumAmount;

    // §58②·§59(시행령§48) — §69①②과 달리 "산출세액에 가산하는 금액을 포함한다"는 명문이 없으므로,
    // 이 세액공제들의 계산·한도 기준이 되는 "증여세산출세액"은 세대생략할증(§57) 가산 전(前)의
    // taxBeforePremium이다(할증 후 taxAfterPremium이 아님). §69②(신고세액공제)만 "가산하는 금액을
    // 포함한다"는 명문이 있어 taxAfterPremium을 쓴다(아래 taxAfterPriorCredit 계산 참고).
    // §58① — 기납부세액공제는 무제한이 아니라 "증여세산출세액 × (가산한 증여재산의 과세표준 ÷
    // 이번 증여세 과세표준)"을 한도로 한다. priorGiftTaxableBase는 그 사전증여 당시 산정된 과세표준(가산한
    // 증여재산의 과세표준)이며, 없으면(0) 한도가 사실상 적용되지 않는다(구 입력과의 호환).
    const priorGiftTaxableBase = Number(p.priorGiftTaxableBase) || 0;
    const priorGiftCreditLimit = (taxBase > 0 && priorGiftTaxableBase > 0)
      ? Math.round(taxBeforePremium * Math.min(1, priorGiftTaxableBase / taxBase))
      : taxBeforePremium;
    const priorGiftTaxCredit = Math.min(priorPaidTax, taxBeforePremium, priorGiftCreditLimit);
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액 × (외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준(해당 외국 법령 기준) ÷ 법§55①에 따른 증여세의 과세표준). 이 금액이 외국법령에
    // 따라 부과된 증여세액(실제 납부액)을 초과하면 그 증여세액을 한도로 한다. foreignGiftTaxBase(외국
    // 과세표준)를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을 잔여세액
    // 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(taxBeforePremium * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, taxBeforePremium - priorGiftTaxCredit));
    const otherCreditsAmount = Number(p.otherCreditsAmount) || 0;
    // §69②1호·2호 — 신고세액공제(3%) 기준액은 산출세액에서 §58·§59 세액공제 외에도 "§75에 따라
    // 징수를 유예받은 금액"(museumDeferredTaxAmount)과 "다른 법률에 따라 산출세액에서 감면되는 금액"
    // (farmlandGiftTaxExemptionAmount, 조특법§71)을 반드시 뺀 뒤 계산해야 한다 — 최종세액 단계에서만
    // 빼면 신고세액공제가 과다계산된다. businessSuccessionDeferredTaxAmount(가업승계 증여특례 납부유예,
    // 조특법§30의7)는 세액공제·감면이 아니라 납부시기 유예이므로 이 기준액에서 빼지 않는다.
    const museumDeferredTaxAmount = Number(p.museumDeferredTaxAmount) || 0;
    const farmlandGiftTaxExemptionAmount = Number(p.farmlandGiftTaxExemptionAmount) || 0;
    const taxAfterPriorCredit = Math.max(0, taxAfterPremium - priorGiftTaxCredit - foreignTaxCredit - otherCreditsAmount - museumDeferredTaxAmount - farmlandGiftTaxExemptionAmount);
    const reportCredit = reportedInTime ? Math.round(taxAfterPriorCredit * 0.03) : 0;
    const taxAfterCredit = taxAfterPriorCredit - reportCredit;

    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);

    const interestAmount = Number(p.interestAmount) || 0;
    const publicInterestOrgPenalty = Number(p.publicInterestOrgPenalty) || 0;
    const businessSuccessionDeferredTaxAmount = Number(p.businessSuccessionDeferredTaxAmount) || 0;

    const finalTax = Math.max(0, taxAfterCredit + interestAmount + publicInterestOrgPenalty
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
      - businessSuccessionDeferredTaxAmount);

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
      외국납부세액공제: foreignTaxCredit, 외국납부세액공제_비율한도: foreignTaxCreditByFormula, 그밖의공제감면세액: otherCreditsAmount,
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
    // §11 — 전쟁 또는 대통령령으로 정하는 공무의 수행 중 사망하거나 그로 인한 부상·질병으로 사망하여
    // 상속이 개시되는 경우에는 상속세를 전액 부과하지 않는다(다른 공제와 무관하게 전체 비과세).
    if (p.isWarOrDutyDeath) {
      return { 과세여부: false, 안내: '전사자 등에 대한 상속세 비과세(§11)에 해당하여 상속세를 부과하지 않습니다.' };
    }

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
    // §15② — 피상속인이 국가·지방자치단체·금융회사등이 아닌 자(개인 등)에게 부담한 채무로서 상속인이
    // 변제할 의무가 없는 것으로 추정되는(가공채무로 의심되는) 경우, 그 금액을 §13 과세가액에 다시
    // 산입한다. taxableEstateAmount 계산시 이미 채무로 공제됐다면 이 값으로 되돌려 넣어야 한다.
    const presumedFictitiousDebtAmount = Number(p.presumedFictitiousDebtAmount) || 0;
    const effectiveEstateAmount = Math.max(0, taxableEstateAmount - nonTaxableAmount - publicInterestOrgAmount - publicTrustAmount) + disposalPresumptionTotal + presumedFictitiousDebtAmount;

    const childCount = Number(p.childCount) || 0;
    // §20①2호·3호 — 미성년자공제·연로자공제는 "상속인(배우자는 제외한다) 및 동거가족"만 대상이므로
    // minorHeirRemainingYears·elderlyHeirCount에는 배우자를 포함하지 않은 값을 넣어야 한다(4호 장애인공제는
    // 배우자 제외 문구가 없어 disabledHeirRemainingYears는 배우자를 포함해도 된다).
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
    const basicOrLumpSum = isDecedentResident ? basicOrLumpSumDeduction(personalDeduction, filingStatus === 'unreported', !!p.isSpouseOnlyHeir) : 200000000;

    const estateValueForSpouseLimit = effectiveEstateAmount - (Number(p.priorGiftedAmountIncludedInEstate) || 0);
    const spouseLimit = spouseInheritanceLimit(estateValueForSpouseLimit, p.nonHeirBequestAmount, p.giftToHeirsWithin10Years, Number(p.spouseLegalShareRatio) || 0, p.spouseTaxableBaseOfPriorGift);
    const spouseDeduction = (isDecedentResident && p.hasSpouse) ? spouseInheritanceDeduction(p.spouseActualInheritedAmount, spouseLimit, p.isSpousePropertyDivided) : 0;

    const financialDeduction = isDecedentResident ? financialAssetInheritanceDeduction(p.netFinancialAssets) : 0;
    // §23의2①1~3호 — 동거주택상속공제는 3개 요건을 모두 갖춘 경우에만 적용된다. 세부요건 플래그를
    // 하나라도 제공하면 그 3개(AND)로 판정하고, 하나도 안 주면(구버전 호환) hasCohabitingHouseDeduction
    // 단일 플래그를 그대로 쓴다. 세부요건 중 일부만 지정되면 요건미확인으로 취급(안내에 반영).
    const cohabitReqFlags = {
      tenYearCohabitationMet: p.tenYearCohabitationRequirementMet, // 1호: 10년이상(미성년자기간 제외) 동거
      tenYearOneHouseholdMet: p.tenYearOneHouseholdRequirementMet, // 2호: 10년이상 1세대1주택
      noHouseOrJointHeirMet: p.noHouseOrJointHeirRequirementMet    // 3호: 무주택자 또는 피상속인과 공동1주택 보유 동거상속인
    };
    const cohabitKeys = Object.keys(cohabitReqFlags);
    const cohabitAnySpecified = cohabitKeys.some(function (k) { return cohabitReqFlags[k] === true || cohabitReqFlags[k] === false; });
    let cohabitEligible, cohabitRequirementsUnverified = false, cohabitFailedRequirements = [];
    if (cohabitAnySpecified) {
      cohabitRequirementsUnverified = cohabitKeys.some(function (k) { return cohabitReqFlags[k] !== true && cohabitReqFlags[k] !== false; });
      cohabitFailedRequirements = cohabitKeys.filter(function (k) { return cohabitReqFlags[k] === false; });
      cohabitEligible = cohabitFailedRequirements.length === 0;
    } else {
      cohabitEligible = !!p.hasCohabitingHouseDeduction;
    }
    const cohabitingHouseDeduction = (isDecedentResident && cohabitEligible) ? Math.min(Number(p.cohabitingHouseValue) || 0, 600000000) : 0;
    // 시행령§20의3③ — 일반 감정평가법인·유형재산 감정수수료(1호·3호)는 500만원 한도이나, 비상장주식
    // 신용평가전문기관 평가수수료(2호, §49의2⑨)는 평가대상 법인수×의뢰기관수별로 각각 1천만원 한도로
    // 별개 규정된다(단일 500만원 한도에 합산하면 안 됨). unlistedStockAppraisalFeeAmount는 그 합계액을
    // 1천만원 한도로 별도 공제한다(법인·기관이 여럿이면 한도도 그만큼 늘어나지만, 이 계산기는 가장
    // 흔한 단일 한도로 근사한다 — 법인·기관이 다수면 직접 합산해서 한도 초과분을 조정하세요).
    const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000)
      + Math.min(Number(p.unlistedStockAppraisalFeeAmount) || 0, 10000000);
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

    // §24 한도가 걸리는 항목은 제18조·18의2·18의3·19~23·23의2뿐이다(§25①1호). 감정평가수수료공제(§25①2호)와
    // 장례비용공제(§14①3호, 과세가액 산정단계에서 차감되는 항목)는 §24 열거에 없으므로 한도 계산에서 제외하고
    // 한도 적용 후 별도로 더한다.
    let limitedDeduction = basicOrLumpSum + spouseDeduction + financialDeduction + cohabitingHouseDeduction + disasterLossDeduction
      + businessInheritanceDeduction + farmingInheritanceDeduction;

    // 사전증여재산 상속인별 상세(§28②·시행령§3①1호 정밀계산 및 §24 종합한도 분모에 공통 사용) — 상속인
    // 명부에 상속인별로 입력된 사전증여 내역을 그대로 쓴다. 배우자분만이 아니라 전체 합계를 쓴다(§24).
    // §24 3호 "제13조에 따라 상속세 과세가액에 가산한 증여재산가액"은 §13①1호(상속인 사전증여)뿐 아니라
    // 2호(상속인이 아닌 자에 대한 사전증여, nonHeirPriorGiftTaxableBaseTotal)도 포함하므로 함께 합산한다.
    const priorGiftHeirs = Array.isArray(p.priorGiftHeirs) ? p.priorGiftHeirs : [];
    const priorGiftTaxableBaseTotal = priorGiftHeirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0)
      + (Number(p.nonHeirPriorGiftTaxableBaseTotal) || 0);

    // §24단서 — "제3호(사전증여재산 과세표준상당액)는 상속세 과세가액이 5억원을 초과하는 경우에만
    // 적용한다" — 5억 이하면 1호·2호만 차감하고 3호(사전증여분)는 차감하지 않는다.
    const overallDeductionLimit = Math.max(0, effectiveEstateAmount
      - (Number(p.nonHeirBequestAmount) || 0)
      - (effectiveEstateAmount > 500000000 ? priorGiftTaxableBaseTotal : 0)
      - (Number(p.disclaimedShareRedistributedAmount) || 0));
    const overallLimitApplied = limitedDeduction > overallDeductionLimit;
    if (overallLimitApplied) limitedDeduction = overallDeductionLimit;
    const totalDeduction = limitedDeduction + appraisalFeeDeduction + funeralDeduction;

    const taxBase = Math.max(0, effectiveEstateAmount - totalDeduction);
    let calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    // §28②·§29(시행령§21①)·§30 등 세액공제류는 §69①과 달리 "산출세액에 가산하는 금액을 포함한다"는
    // 명문이 없으므로, 이 공제들의 계산·한도 기준은 세대생략할증(§27) 가산 전(前)의 taxBeforePremium이다.
    // 할증액이 가산된 이후 금액(calculatedTax)은 §69①(신고세액공제, "가산액 포함" 명문 있음)과
    // 최종세액·가산세 계산에만 쓴다.
    const taxBeforePremium = calculatedTax;

    const generationSkipHeirRatio = Math.max(0, Math.min(1, Number(p.generationSkipHeirRatio) || 0));
    // §27① 괄호 — 40%는 "피상속인의 자녀를 제외한 직계비속이면서 미성년자인 상속인·수유자가 20억원
    // 초과분을 받은 경우"에 한정. 미성년 요건 없이 20억 초과만으로 40%를 적용하면 과다할증이 되므로
    // generationSkipMinorHeir(세대생략 상속인 중 미성년자 여부)도 함께 확인한다. 30%가 원칙(기본값)이고
    // 40%는 예외이므로, 20억 초과인데 미성년자 여부(generationSkipMinorHeir)를 명시하지 않으면 30%로
    // 계산한다 — 이는 "안전하게 보수적으로 잡은 것"이 아니라 "실제로 미성년자라면 세액이 과소계산될 수
    // 있는 미확인 상태"이므로 별도 경고 플래그(generationSkipMinorStatusUnverified)로 표시한다.
    // §27① 단서 — "「민법」제1001조에 따른 대습상속의 경우에는 그러하지 아니하다"(할증 배제).
    const generationSkipMinorStatusUnverified = generationSkipHeirRatio > 0 && !p.isSubstituteInheritance
      && !!p.generationSkipOver2Billion && p.generationSkipMinorHeir == null;
    const generationSkipPremiumRate = p.isSubstituteInheritance ? 0 : ((p.generationSkipOver2Billion && p.generationSkipMinorHeir) ? 0.4 : 0.3);
    const generationSkipPremium = Math.round(calculatedTax * generationSkipHeirRatio * generationSkipPremiumRate);
    calculatedTax += generationSkipPremium;

    // §28 증여세액공제 — 상속인별 정밀 계산(위 priorGiftTaxCreditPrecise 참고). nonHeirPriorGiftTaxableBaseTotal·
    // nonHeirPriorGiftAmountTotal(§13①2호, 수유자 아닌 자에 대한 사전증여 합계)을 입력하면 시행령§3①1호
    // 가목·나목 산식에 정확히 반영된다.
    const priorGiftCreditResult = priorGiftTaxCreditPrecise(taxBeforePremium, taxBase, effectiveEstateAmount, priorGiftHeirs,
      Number(p.nonHeirPriorGiftTaxableBaseTotal) || 0, Number(p.nonHeirPriorGiftAmountTotal) || 0);
    const priorGiftTaxCredit = priorGiftCreditResult.totalCredit;
    const giftCreditExcludedBySmallEstate = priorGiftCreditResult.excludedBySmallEstate;
    const specialGiftTaxCredit = Math.min(Number(p.specialGiftTaxCredit) || 0, Math.max(0, taxBeforePremium - priorGiftTaxCredit));
    // §29·시행령§21① — 외국납부세액공제 = 상속세산출세액 × (외국법령에 따라 상속세가 부과된 상속재산의
    // 과세표준(해당 외국 법령 기준) ÷ 법§25①에 따른 상속세의 과세표준). 다만 이 금액이 외국법령에 따라
    // 부과된 상속세액(실제 납부액)을 초과하면 그 상속세액을 한도로 한다. foreignEstateTaxBase(외국 과세표준)를
    // 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을 잔여세액 한도로 그대로 쓴다.
    const foreignEstateTaxBase = Number(p.foreignEstateTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignEstateTaxBase > 0 && taxBase > 0)
      ? Math.round(taxBeforePremium * Math.min(1, foreignEstateTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, taxBeforePremium - priorGiftTaxCredit - specialGiftTaxCredit));
    const shortTermCredit = Math.min(
      shortTermReinheritanceCredit(p.priorInheritanceTax, p.reinheritedPropertyValue, p.priorInheritanceTotalPropertyValue, p.priorInheritanceTaxableBase, p.yearsSincePriorInheritance),
      Math.max(0, taxBeforePremium - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit)
    );
    const otherCreditsAmount = Math.min(Number(p.otherCreditsAmount) || 0,
      Math.max(0, taxBeforePremium - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit - shortTermCredit));

    // §69①1호 — 신고세액공제(3%) 기준액은 "산출세액에서 제74조에 따라 징수를 유예받은 금액(1호)과
    // 그 밖의 세액공제·감면액(2호)을 뺀 금액"이다. 문화재등징수유예액(culturalPropertyDeferredTaxAmount,
    // §74)을 3% 기준액에서 빼지 않으면 신고세액공제가 과다계산된다(유예액만큼 3%를 더 많이 깎아주는 셈).
    // 가업상속납부유예(§72의2, businessInheritanceDeferredTaxAmount)는 §69①1호가 "제74조"만 명시하므로
    // 이 기준액 계산에는 포함하지 않고, 아래 최종 납부세액 단계에서만 차감한다.
    const culturalPropertyDeferredTaxAmount = Number(p.culturalPropertyDeferredTaxAmount) || 0;
    const businessInheritanceDeferredTaxAmount = Number(p.businessInheritanceDeferredTaxAmount) || 0;
    const taxAfterCredits = Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit - shortTermCredit - otherCreditsAmount - culturalPropertyDeferredTaxAmount);
    const reportCredit = reportedInTime ? Math.round(taxAfterCredits * 0.03) : 0;
    const taxAfterReportCredit = taxAfterCredits - reportCredit;

    const penalties = giftFilingPenalties(taxAfterReportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);

    const interestAmount = Number(p.interestAmount) || 0;
    const forProfitBequestAmount = Number(p.forProfitBequestAmount) || 0;
    const forProfitExemptedTaxAmount = Number(p.forProfitExemptedTaxAmount) || 0;
    const forProfitHeirShareRatio = Math.max(0, Math.min(1, Number(p.forProfitHeirShareRatio) || 0));
    const forProfitPayableByHeirs = Math.max(0, Math.round((forProfitExemptedTaxAmount - forProfitBequestAmount * 0.10) * forProfitHeirShareRatio));

    const totalGrossEstateValue = Number(p.totalGrossEstateValue) || 0;
    let businessInheritanceDeferralEligibleAmount = null;
    if (businessInheritanceDetail && totalGrossEstateValue > 0) {
      businessInheritanceDeferralEligibleAmount = Math.round(taxAfterReportCredit * businessInheritanceDetail.targetAmount / totalGrossEstateValue);
    }

    // culturalPropertyDeferredTaxAmount(§74)는 위 taxAfterCredits 단계에서 이미 뺐으므로 여기서 다시
    // 빼지 않는다(이중차감 방지) — businessInheritanceDeferredTaxAmount(§72의2)만 최종 단계에서 차감.
    const finalTax = Math.max(0, taxAfterReportCredit + interestAmount + forProfitPayableByHeirs
      + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
      - businessInheritanceDeferredTaxAmount);

    return {
      상속세과세가액_입력값: taxableEstateAmount,
      피상속인_거주구분: isDecedentResident ? '거주자' : '비거주자',
      비과세재산가액: nonTaxableAmount, 공익법인출연재산가액: publicInterestOrgAmount, 공익신탁재산가액: publicTrustAmount,
      상속개시전처분재산_추정내역: disposalPresumptionDetail,
      상속개시전처분재산_추정합계: disposalPresumptionTotal, 가공채무추정_재산입액: presumedFictitiousDebtAmount,
      상속세과세가액_적용값: effectiveEstateAmount,
      인적공제: personalDeduction, '기초인적공제_또는_일괄공제': basicOrLumpSum,
      배우자공제: spouseDeduction, 배우자공제한도액: Number.isFinite(spouseLimit) ? spouseLimit : null,
      금융재산상속공제: financialDeduction, 동거주택상속공제: cohabitingHouseDeduction,
      동거주택상속공제_요건미확인: cohabitRequirementsUnverified, 동거주택상속공제_미충족요건목록: cohabitFailedRequirements,
      감정평가수수료공제: appraisalFeeDeduction, 재해손실공제: disasterLossDeduction,
      장례비용공제: funeralDeduction, 장례비용공제_일반분: funeralGeneralDeduction, 장례비용공제_봉안시설분: funeralNicheDeduction,
      가업상속공제: businessInheritanceDeduction,
      가업상속공제_계산내역: businessInheritanceDetail ? {
        대상금액: businessInheritanceDetail.targetAmount, 한도액: businessInheritanceDetail.limitAmount,
        소득세법적용분: businessInheritanceDetail.targetIndividual, 법인세법적용분: businessInheritanceDetail.targetCorporate,
        사업관련자산가액비율: businessInheritanceDetail.ratioInfo ? businessInheritanceDetail.ratioInfo.ratio : null,
        중견기업게이트_적용여부: businessInheritanceDetail.mediumSizedGateApplied,
        요건미확인: businessInheritanceDetail.requirementsUnverified,
        요건미충족으로_공제배제: businessInheritanceDetail.eligibilityGateApplied,
        미충족요건목록: businessInheritanceDetail.failedRequirements
      } : null,
      영농상속공제: farmingInheritanceDeduction,
      영농상속공제_계산내역: farmingInheritanceDetail ? {
        대상금액: farmingInheritanceDetail.targetAmount, 한도액: farmingInheritanceDetail.limitAmount,
        소득세법적용분: farmingInheritanceDetail.individualTotal, 법인세법적용분: farmingInheritanceDetail.targetCorporate,
        사업관련자산가액비율: farmingInheritanceDetail.ratioInfo ? farmingInheritanceDetail.ratioInfo.ratio : null,
        요건미확인: farmingInheritanceDetail.requirementsUnverified,
        요건미충족으로_공제배제: farmingInheritanceDetail.eligibilityGateApplied,
        미충족요건목록: farmingInheritanceDetail.failedRequirements
      } : null,
      상속공제_합계: totalDeduction, 상속공제종합한도_적용여부: overallLimitApplied, 과세표준: taxBase,
      산출세액: calculatedTax, 세대생략가산액: generationSkipPremium,
      세대생략할증_미성년자여부확인필요: generationSkipMinorStatusUnverified,
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
  // nonHeirPriorGiftTaxableBaseTotal·nonHeirPriorGiftAmountTotal: priorGiftTaxCreditPrecise와 동일한 이유로
  // §13①2호(수유자 아닌 자에 대한 사전증여) 합계를 반영하려면 넘겨야 한다(시행령§3①1호 가목·나목).
  window.allocateInheritanceTaxByHeirJS = function (aggregateResult, heirs, nonHeirPriorGiftTaxableBaseTotal, nonHeirPriorGiftAmountTotal) {
    if (!aggregateResult || aggregateResult.error) return { error: '전체 상속세 계산 결과가 필요합니다.' };
    if (!Array.isArray(heirs) || heirs.length === 0) return { error: '상속인을 1명 이상 입력해야 합니다.' };
    const values = heirs.map(function (h) { return Number(h.actualInheritedValue) || 0; });
    const totalInherited = values.reduce(function (s, v) { return s + v; }, 0);
    if (totalInherited <= 0) return { error: '상속인별 실제상속재산가액 합계가 0보다 커야 합니다.' };

    // 시행령§3①1호 — "상속인별 상속세과세표준상당액"을 §28(증여세액공제)용으로 이미 구현한
    // priorGiftTaxCreditPrecise의 다목(상속인별과세표준상당액) 산식과 정확히 동일하다. 상속인마다
    // priorGiftTaxableBase(사전증여 과세표준)·priorGiftAmount(사전증여재산가액)가 주어지면 이 정밀
    // 비율을 쓰고, 없으면(대부분 사전증여가 없는 사안) 종전처럼 실제상속재산가액 비율로 근사한다.
    const hasPriorGiftData = heirs.some(function (h) { return (Number(h.priorGiftTaxableBase) || 0) > 0 || (Number(h.priorGiftAmount) || 0) > 0; });
    let preciseRatios = null;
    if (hasPriorGiftData) {
      const overallTaxBase = Number(aggregateResult.과세표준) || 0;
      const overallTaxableAmount = Number(aggregateResult.상속세과세가액_적용값) || totalInherited;
      const totalPriorGiftTaxableBase = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0);
      const totalPriorGiftAmount = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftAmount) || 0); }, 0);
      const 가목 = Math.max(0, overallTaxBase - totalPriorGiftTaxableBase - (Number(nonHeirPriorGiftTaxableBaseTotal) || 0));
      const 나목 = Math.max(0, overallTaxableAmount - totalPriorGiftAmount - (Number(nonHeirPriorGiftAmountTotal) || 0));
      const equivalents = heirs.map(function (h, i) {
        const giftTaxableBase = Number(h.priorGiftTaxableBase) || 0;
        const giftAmount = Number(h.priorGiftAmount) || 0;
        const actualValueRatio = values[i] / totalInherited;
        const heirTaxableAmountShare = overallTaxableAmount * actualValueRatio;
        const 다목 = heirTaxableAmountShare - giftAmount;
        const ratio다나 = 나목 > 0 ? (다목 / 나목) : 0;
        return Math.max(0, giftTaxableBase + 가목 * ratio다나);
      });
      const totalEquivalent = equivalents.reduce(function (s, v) { return s + v; }, 0);
      if (totalEquivalent > 0) preciseRatios = equivalents.map(function (v) { return v / totalEquivalent; });
    }

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
      const ratio = preciseRatios ? preciseRatios[i] : (values[i] / totalInherited);
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
      정밀비율_적용여부: !!preciseRatios,
      합계검증: { 실제상속재산가액_합계: totalInherited, 납부세액_합계: aggregateResult.납부세액 || 0 },
      안내: preciseRatios
        ? '상증세법§3조의2①·시행령§3①1호에 따라, 상속인별 사전증여(priorGiftTaxableBase·priorGiftAmount) 데이터로 "상속인별 상속세과세표준상당액" 비율을 정밀 계산해서 전체 산출세액·세액공제·가산세 등을 안분했습니다. 다만 시행령§3①2호(수유자 아닌 자에게 사전증여한 부분을 분모에서 제외하는 조정)까지는 반영하지 않았으니, 상속인이 아닌 자에게도 사전증여가 있었던 사안은 별도로 재검토하세요. 상속공제는 전체 1회만 적용되는 항목이라 인별로 나누지 않았습니다. 반올림 잔액은 실제상속재산가액이 가장 큰 상속인에게 몰아서 합계를 맞췄습니다.'
        : '상증세법 §3조의2①에 따라, 전체 산출세액·세액공제·가산세 등을 상속인별 실제상속재산가액 비율로 안분했습니다(유산세 방식). 정확한 법정 비율(시행령§3①1호의 상속인별 상속세과세표준상당액 비율)을 쓰려면 상속인별 사전증여 내역(priorGiftTaxableBase·priorGiftAmount)을 함께 입력하세요 — 사전증여가 없으면 이 실제상속재산가액 비율과 결과가 같습니다. 상속공제는 전체 1회만 적용되는 항목이라 인별로 나누지 않았습니다. 반올림 잔액은 실제상속재산가액이 가장 큰 상속인에게 몰아서 합계를 맞췄습니다.'
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

    // §30의5①·§30의6① — "18세 이상인 거주자가...60세 이상의 부모로부터" 증여받는 경우만 대상.
    const doneeAge = Number(p.doneeAge);
    const donorAge = Number(p.donorAge);
    if (Number.isFinite(doneeAge) && doneeAge < 18) {
      return { error: '수증자가 18세 미만이면 이 특례(조특법§30의5·§30의6)를 적용받을 수 없습니다.' };
    }
    if (Number.isFinite(donorAge) && donorAge < 60) {
      return { error: '증여자(부모)가 60세 미만이면 이 특례(조특법§30의5·§30의6)를 적용받을 수 없습니다.' };
    }
    if (specialType === 'business_succession' && p.isReceivedFromMajorShareholderAfterSuccession) {
      return { error: '조특법§30의6①단서 — 가업 승계 후 그 승계 당시 최대주주등에 해당하는 자(당초 증여자·수증자 제외)로부터 증여받는 경우에는 이 특례를 적용받을 수 없습니다.' };
    }

    // 조특법§30의5①후단·§30의6 — 같은 특례를 2회 이상(또는 부모 각각으로부터) 받으면 과세가액을
    // 합산한다(priorSpecialGiftAmount). priorPaidTax는 그 이전 특례증여분에 대해 이미 낸 산출세액을
    // 그대로 차감하는 것으로, 상증세법§58(§47②합산에 대한 기납부세액공제)과는 별개다 — §30의5⑪이
    // 일반 증여재산의 §47② 합산 자체를 이 특례 과세가액에서 배제하므로 §58이 적용될 여지가 없다.
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
      // 조특법§30의6①본문 — "가업"의 정의 자체가 "부모가 10년 이상 계속하여 경영한 기업"이다.
      // 10년 미만이면 애초에 "가업"에 해당하지 않아 이 특례를 전혀 적용받을 수 없다(1~3호도
      // 전부 "10년 이상"을 전제로 300억/400억/600억을 구분할 뿐, 10년 미만 구간 자체가 없음).
      const years = Number(p.businessOwnershipYearsOfParent) || 0;
      if (years < 10) {
        return { error: '부모의 가업 계속경영기간이 10년 미만이면 조특법§30의6상 "가업"에 해당하지 않아 이 특례를 적용받을 수 없습니다(businessOwnershipYearsOfParent를 10년 이상으로 입력하거나, 요건을 다시 확인하세요).' };
      }
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
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);

    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    // §30의5⑤ — 창업자금 사용명세 미제출·불분명분의 1천분의3 가산세(창업자금 특례에만 있음).
    const usageStatementPenalty = specialType === 'startup' ? Math.round((Number(p.unclearOrUnsubmittedUsageAmount) || 0) * 0.003) : 0;
    const finalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + usageStatementPenalty);

    return {
      특례종류: specialType === 'startup' ? '창업자금(조특법 §30의5)' : '가업승계주식등(조특법 §30의6)', 증여재산가액: giftAmount,
      인수채무액: debtAssumedAmount, 가업자산상당액: businessAssetAmount, 사업관련자산가액비율: ratioInfo ? ratioInfo.ratio : null,
      과세특례적용전_증여세과세가액_계: grossBase, 총한도액: totalLimit,
      과세특례적용대상_증여세과세가액: specialRateApplicableAmount, 기본세율적용대상_증여재산가액: baseRateApplicableAmount,
      증여재산공제: propertyDeduction, 재해손실공제: disasterLossDeduction, 감정평가수수료공제: appraisalFeeDeduction,
      과세표준: taxBase, 세율: specialType === 'startup' ? '10%' : '10%(120억 초과분 20%)', 산출세액: calculatedTax,
      납부세액공제: priorPaidTax, 외국납부세액공제: foreignTaxCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      창업자금사용명세미제출가산세: usageStatementPenalty,
      납부세액: finalTax
    };
  };

  // 창업자금·가업승계 증여세 과세특례 사후관리 위반 재과세 (조특법§30의5⑥·§30의6③) — Code.js
  // toolCalculateSpecialRateGiftTaxClawback와 1:1 대응.
  window.calculateSpecialRateGiftTaxClawbackJS = function (p) {
    p = p || {};
    const specialType = p.specialType;
    if (['startup', 'business_succession'].indexOf(specialType) === -1) {
      return { error: '특례 종류를 창업자금(startup) 또는 가업승계(business_succession) 중에서 선택하세요.' };
    }
    const clawbackAmount = Number(p.clawbackAmount);
    if (!(clawbackAmount > 0)) {
      return { error: '재과세 대상 금액(clawbackAmount)이 필요합니다.' };
    }

    const normalGiftParams = Object.assign({}, p.donorDoneeContext || {}, { giftAmount: clawbackAmount });
    const normalTaxResult = window.calculateGiftTaxJS(normalGiftParams);
    if (normalTaxResult.error) {
      return { error: '일반 증여세 재계산 실패: ' + normalTaxResult.error };
    }

    const alreadyPaidSpecialTax = Number(p.alreadyPaidSpecialTax) || 0;
    const additionalTax = Math.max(0, (normalTaxResult.납부세액 || 0) - alreadyPaidSpecialTax);

    return {
      specialType,
      재과세대상금액: clawbackAmount,
      일반증여세_재계산결과: normalTaxResult,
      기존납부한특례세액: alreadyPaidSpecialTax,
      추가납부할세액: additionalTax,
      안내: (specialType === 'startup'
        ? '조특법§30의5⑥ — 창업자금 특례 위반사유가 발생하여 특례세율(10%) 대신 일반 증여세율로 재과세합니다. '
        : '조특법§30의6③ — 가업승계 특례 위반사유가 발생하여 특례세율(10%/20%) 대신 일반 증여세율로 재과세합니다. ')
        + '여기에 이자상당액(당초 증여세 신고기한 다음날부터 추징사유 발생일까지)을 가산해야 합니다. 사유발생일이 속하는 달의 말일부터 3개월 이내 신고·납부해야 합니다(§30의5⑦).'
    };
  };

  // 주식의 포괄적 교환·이전에 대한 개인주주 과세특례 (조특법§38) — Code.js
  // toolCalculateShareSwapGainRecognition와 1:1 대응.
  window.calculateShareSwapGainRecognitionJS = function (p) {
    p = p || {};
    if (p.bothCompaniesOperated1YearOrMore === false) {
      return { 이연적용여부: false, 안내: '조특법§38①1호 — 양 법인이 1년 이상 계속 사업해야 합니다.' };
    }
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const stockConsiderationValue = Number(p.stockConsiderationValue) || 0;
    const otherConsiderationValue = Number(p.otherConsiderationValue) || 0;
    const totalConsideration = stockConsiderationValue + otherConsiderationValue;
    if (!(totalConsideration > 0)) return { error: '교환·이전대가가 필요합니다.' };
    const stockRatio = stockConsiderationValue / totalConsideration;
    if (stockRatio < 0.8) {
      return { 이연적용여부: false, 안내: '조특법§38①2호 — 교환·이전대가 중 완전모회사 주식가액이 80% 이상이어야 합니다(현재 ' + (Math.round(stockRatio * 10000) / 100) + '%).' };
    }
    if (p.willHoldUntilFiscalYearEnd === false) {
      return { 이연적용여부: false, 안내: '조특법§38①2호 — 사업연도 종료일까지 보유해야 합니다.' };
    }
    if (p.targetWillContinueBusiness === false) {
      return { 이연적용여부: false, 안내: '조특법§38①3호 — 완전자회사가 사업연도 종료일까지 사업을 계속해야 합니다.' };
    }
    const totalGain = totalConsideration - acquisitionPrice;
    const recognizedGainNow = Math.max(0, Math.min(totalGain, otherConsiderationValue));
    const deferredGain = Math.max(0, totalGain - recognizedGainNow);
    let clawback = 0;
    let clawbackNote = '';
    if (p.isClawbackTriggeredWithin2Years) {
      clawback = deferredGain;
      clawbackNote = '사업폐지·주식처분 사유가 2년 이내에 발생하여 이연되는_양도소득(' + deferredGain + '원)을 그 사유발생일이 속하는 반기의 말일부터 2개월 이내에 납부해야 합니다.';
    }
    return {
      이연적용여부: true,
      전체양도차익: Math.round(totalGain),
      이번에_과세되는_양도소득: Math.round(recognizedGainNow),
      이연되는_양도소득: Math.round(deferredGain),
      사후관리_추징액: clawback,
      안내: '이번에_과세되는_양도소득을 위 일반 양도세 계산기의 양도차익으로 넣어 세액을 계산하세요(시행령§35의2③ — MIN(전체양도차익, 주식외 재산가액)). 나머지는 완전모회사등주식 처분시 정산됩니다.' + (clawbackNote ? ' ' + clawbackNote : '')
    };
  };

  // 주식의 현물출자에 의한 지주회사 설립에 대한 개인주주 과세특례 (조특법§38의2) — Code.js
  // toolCalculateHoldingCompanyContributionDeferral와 1:1 대응.
  window.calculateHoldingCompanyContributionDeferralJS = function (p) {
    p = p || {};
    const contributionDate = p.contributionDate;
    if (contributionDate && contributionDate > '2026-12-31') {
      return { 이연적용여부: false, 안내: '조특법§38의2① — 2026.12.31까지 현물출자한 경우에만 적용됩니다.' };
    }
    if (p.willHoldUntilFiscalYearEnd === false) {
      return { 이연적용여부: false, 안내: '조특법§38의2①1호 — 사업연도 종료일까지 보유해야 합니다.' };
    }
    if (p.subsidiaryWillContinueBusiness === false) {
      return { 이연적용여부: false, 안내: '조특법§38의2①2호 — 자회사가 사업연도 종료일까지 사업을 계속해야 합니다.' };
    }
    const originalAcquisitionPrice = Number(p.originalAcquisitionPrice) || 0;
    const holdingCoStockValue = Number(p.holdingCoStockValue);
    if (!(holdingCoStockValue > 0)) return { error: '현물출자로 취득한 지주회사 주식가액이 필요합니다.' };
    const deferredGain = Math.max(0, holdingCoStockValue - originalAcquisitionPrice);
    const futureSaleBasis = Math.max(0, holdingCoStockValue - deferredGain);
    let clawback = 0;
    let clawbackNote = '';
    if (p.isClawbackTriggeredWithin2Years) {
      clawback = deferredGain;
      clawbackNote = '요건상실·사업폐지·주식처분 사유가 2년 이내에 발생하여 이연되는_양도소득(' + deferredGain + '원)을 그 사유발생일이 속하는 반기의 말일부터 2개월 이내에 납부해야 합니다.';
    }
    return {
      이연적용여부: true,
      이연되는_양도소득: Math.round(deferredGain),
      지주회사주식_취득가액_시가: holdingCoStockValue,
      장래처분시_적용할_취득가액: Math.round(futureSaleBasis),
      사후관리_추징액: clawback,
      안내: '지금은 과세하지 않습니다. 나중에 지주회사 주식을 처분할 때 장래처분시_적용할_취득가액을 취득가액으로 보아 양도소득세를 계산하세요.' + (clawbackNote ? ' ' + clawbackNote : '')
    };
  };

  // 프로젝트 부동산투자회사의 현물출자자에 대한 과세특례 (조특법§97의9) — Code.js
  // toolCalculateProjectReitContributionDeferral와 1:1 대응.
  window.calculateProjectReitContributionDeferralJS = function (p) {
    p = p || {};
    const contributionDate = p.contributionDate;
    if (contributionDate && contributionDate > '2028-12-31') {
      return { 이연적용여부: false, 안내: '조특법§97의9① — 2028.12.31까지 현물출자한 경우에만 적용됩니다.' };
    }
    if (p.isBeyond5YearsFromReitEstablishment) {
      return { 이연적용여부: false, 안내: '조특법§97의9① — 설립 신고가 수리된 날부터 5년 이내의 현물출자만 적용됩니다.' };
    }
    const isolatedTransferResult = window.calculateTransferTaxSingleJS({
      transferPrice: p.transferPrice, acquisitionPrice: p.acquisitionPrice, necessaryExpenses: p.necessaryExpenses,
      acquisitionDate: p.acquisitionDate, transferDate: contributionDate, assetType: p.assetType || 'other'
    });
    if (isolatedTransferResult.error) return isolatedTransferResult;
    const deferredTaxAmount = isolatedTransferResult.산출세액 || 0;

    let clawback = 0;
    let clawbackNote = '';
    const alreadyPaidAmount = Number(p.alreadyPaidAmount) || 0;
    if (p.triggerType) {
      const fullPayoutTypes = ['full_sale', 'reit_dissolved', 'undersubscribed', 'full_gift_or_inheritance'];
      if (fullPayoutTypes.indexOf(p.triggerType) !== -1) {
        clawback = Math.max(0, deferredTaxAmount - alreadyPaidAmount);
        clawbackNote = '전부처분·리츠해산·미공모·전부증여·상속에 해당해 이연세액 잔액 전부를 납부해야 합니다.';
      } else if (p.triggerType === 'partial_sale' || p.triggerType === 'partial_gift') {
        const cumulativeDisposalRatio = Number(p.cumulativeDisposalRatio) || 0;
        const thisYearDisposalRatio = Number(p.thisYearDisposalRatio) || 0;
        if (cumulativeDisposalRatio >= 0.5) {
          clawback = Math.max(0, deferredTaxAmount - alreadyPaidAmount);
          clawbackNote = '누적 처분(증여)비율이 50% 이상이 되어 이연세액 잔액 전부를 납부해야 합니다.';
        } else {
          clawback = Math.round(deferredTaxAmount * thisYearDisposalRatio);
          clawbackNote = '해당 연도 처분(증여)비율만큼만 납부합니다.';
        }
      }
    }

    return {
      이연적용여부: true,
      이연세액: deferredTaxAmount,
      계산근거: isolatedTransferResult,
      사후관리_추징액: clawback,
      안내: '이연세액은 이 현물출자 자산을 그 과세기간의 유일한 양도자산으로 가정해 계산한 양도소득 산출세액입니다.' + (clawbackNote ? ' ' + clawbackNote : '')
    };
  };

  // 영농자녀등 증여 농지등 감면 (조특법§71) — Code.js toolCalculateFarmlandGiftTaxReduction와 1:1 대응.
  const FARMLAND_GIFT_AREA_CAP_SQM = {
    farmland: 40000, pasture: 148500, fishing_right: 100000, fishing_land: 40000, salt_farm: 60000
  };
  window.calculateFarmlandGiftTaxReductionJS = function (p) {
    p = p || {};
    const assetType = p.assetType;
    const validTypes = ['farmland', 'pasture', 'forest_land', 'livestock_land', 'fishing_boat', 'fishing_right', 'fishing_land', 'salt_farm'];
    if (validTypes.indexOf(assetType) === -1) {
      return { error: '농지등 유형을 선택하세요.' };
    }
    if (p.isInZoningRestrictedArea) {
      return { 적용여부: false, 감면세액: 0, 안내: '§71①2호 — 주거지역·상업지역·공업지역에 소재하는 농지등은 감면 대상이 아닙니다.' };
    }
    if (p.isInDevelopmentRestrictedZone) {
      return { 적용여부: false, 감면세액: 0, 안내: '§71①3호 — 택지개발지구 등 개발사업지구로 지정된 지역 내 농지등은 감면 대상이 아닙니다.' };
    }
    const giftValue = Number(p.giftValue);
    if (!(giftValue > 0)) return { error: '농지등의 증여재산가액이 필요합니다.' };

    let qualifyingRatio = 1;
    let capNote = '';
    if (assetType === 'fishing_boat') {
      const tonnage = Number(p.tonnage);
      if (!(tonnage < 20)) {
        return { 적용여부: false, 감면세액: 0, 안내: '§71①1호마목 — 어선은 총톤수 20톤 미만인 것만 감면 대상입니다.' };
      }
      capNote = '어선(총톤수 20톤 미만 요건 충족)';
    } else if (assetType === 'livestock_land') {
      const buildingArea = Number(p.buildingArea) || 0;
      const buildingCoverageRatio = Number(p.buildingCoverageRatio) || 0;
      if (!(buildingArea > 0 && buildingCoverageRatio > 0)) {
        return { error: '축사용지는 건축면적과 건폐율이 필요합니다.' };
      }
      const cap = buildingArea / buildingCoverageRatio;
      const actualArea = Number(p.areaSqm) || cap;
      qualifyingRatio = Math.min(1, cap / actualArea);
      capNote = '축사용지 면적한도(건축면적÷건폐율) ' + Math.round(cap) + '㎡, 실제면적 ' + actualArea + '㎡';
    } else if (assetType === 'forest_land') {
      const afforestationYears = Number(p.afforestationYears) || 0;
      if (afforestationYears < 5) {
        return { 적용여부: false, 감면세액: 0, 안내: '§71①1호다목 — 조림한 기간이 5년 이상이어야 합니다.' };
      }
      const cap = afforestationYears >= 20 ? 990000 : 297000;
      const actualArea = Number(p.areaSqm) || cap;
      qualifyingRatio = Math.min(1, cap / actualArea);
      capNote = '산림지 면적한도(조림기간 ' + afforestationYears + '년) ' + cap + '㎡, 실제면적 ' + actualArea + '㎡';
    } else {
      const cap = FARMLAND_GIFT_AREA_CAP_SQM[assetType];
      const actualArea = Number(p.areaSqm) || cap;
      qualifyingRatio = Math.min(1, cap / actualArea);
      capNote = '면적한도 ' + cap + '㎡, 실제면적 ' + actualArea + '㎡';
    }

    const qualifyingGiftValue = Math.round(giftValue * qualifyingRatio);
    const totalGiftCalculatedTax = Number(p.totalGiftCalculatedTax);
    const totalGiftPropertyValue = Number(p.totalGiftPropertyValue);
    if (!(totalGiftCalculatedTax > 0) || !(totalGiftPropertyValue > 0)) {
      return { error: '전체 증여재산 기준 증여세 산출세액과 전체 증여재산가액이 필요합니다.' };
    }
    const rawReduction = Math.round(totalGiftCalculatedTax * (qualifyingGiftValue / totalGiftPropertyValue));

    const priorReductionWithinFiveYears = Number(p.priorReductionWithinFiveYears) || 0;
    const fiveYearLimitRemaining = Math.max(0, 100000000 - priorReductionWithinFiveYears);
    const reductionAmount = Math.min(rawReduction, fiveYearLimitRemaining);
    const limitExceededNote = rawReduction > fiveYearLimitRemaining
      ? ' §133④(5년간 1억원 한도)에 따라 계산상 감면세액(' + rawReduction + '원) 중 ' + (rawReduction - reductionAmount) + '원은 감면하지 못합니다.'
      : '';

    let clawback = 0;
    let clawbackNote = '';
    if ((p.isTransferredOrStoppedFarmingWithin5Years && !p.hasJustifiableReason) || p.isCriminalConvictionConfirmedAfterReduction) {
      clawback = reductionAmount;
      clawbackNote = (p.isCriminalConvictionConfirmedAfterReduction
        ? '영농자녀등 또는 자경농민등이 영농 관련 조세포탈·회계부정으로 형이 확정되어(§71③2호) '
        : '증여받은 날부터 5년 이내에 정당한 사유 없이 양도하거나 직접 영농에 종사하지 않게 되어(§71②) ')
        + '감면세액 ' + clawback + '원을 이자상당액과 함께 추징합니다(사유발생일이 속하는 달의 말일부터 3개월 이내 신고·납부, §71④).';
    }

    return {
      적용여부: true,
      농지등유형: assetType, 면적한도_안내: capNote,
      감면대상비율: Math.round(qualifyingRatio * 10000) / 10000,
      감면대상_농지등가액: qualifyingGiftValue,
      계산상_감면세액: rawReduction,
      최종_감면세액: reductionAmount,
      사후관리_추징액: clawback,
      안내: '이 감면세액을 증여세 계산기의 농지등 감면(farmlandGiftTaxExemptionAmount)에 넣어 최종 증여세를 계산하세요.' + limitExceededNote + (clawbackNote ? ' ' + clawbackNote : '')
    };
  };

  // 증여의제이익(일감몰아주기·일감떼어주기 등)에 대한 세액 계산 — 증여재산공제 없이 일반 누진세율+신고세액공제(3%)만 적용.
  // flatDeduction: §55①3호("제1호 및 제2호를 제외한 합산배제증여재산: 그 증여재산가액에서 3천만원을
  // 공제한 금액") 전용 — §45(재산취득자금 증여추정)처럼 §55①1호(§45의2)·2호(§45의3·45의4)에 속하지
  // 않는 합산배제증여재산에서만 30000000을 넘겨 쓴다. 1호·2호 해당분은 기존대로 0(미지정).
  function taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxForLatePenalty, reportedInTime, appraisalFeeAmount, isOffshoreTransaction, flatDeduction, monthsAfterDesignatedDueDate, unpaidTaxAtDesignatedDueDate, unlistedStockAppraisalFeeAmount, fraudulentUnderreportedTaxAmount) {
    // §55①1~3호 — 명의신탁재산 증여의제·§45의3·45의4 증여의제이익·기타 합산배제증여재산은 전부
    // "그 금액에서 대통령령으로 정하는 증여재산의 감정평가 수수료를 뺀 금액"이 과세표준이다(3호는 3천만원도 추가로 뺀다).
    // 시행령§46의2·§20의3③ — 일반 감정평가법인 등(1·3호) 수수료는 500만원, 비상장주식 신용평가전문기관
    // 평가수수료(2호)는 별도로 1천만원 한도가 적용된다(일반 증여세 함수들과 동일 한도 구조).
    const appraisalFeeDeduction = Math.min(Number(appraisalFeeAmount) || 0, 5000000) + Math.min(Number(unlistedStockAppraisalFeeAmount) || 0, 10000000);
    const taxBase = Math.max(0, Math.round(deemedGiftProfit) - appraisalFeeDeduction - (Number(flatDeduction) || 0));
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const reportCredit = reportedInTime ? Math.round(calculatedTax * 0.03) : 0;
    const taxAfterCredit = calculatedTax - reportCredit;
    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxForLatePenalty, isOffshoreTransaction, monthsAfterDesignatedDueDate, unpaidTaxAtDesignatedDueDate, fraudulentUnderreportedTaxAmount);
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
    // §45의3①2호가·나·다목 — 중소기업·중견기업·일반기업 모두 소득기준은 "수혜법인의 세후영업이익"으로
    // 동일하다(law.go.kr 원문 산식 이미지의 LaTeX 대체텍스트로 2026-08-25 직접 재검증 — 세 목 모두
    // "수혜법인의세후영업이익 × ..." 로 시작하며 "세후순이익"이라는 표현은 어디에도 없다. 과거에 중소기업만
    // "세후순이익"을 쓰는 것으로 잘못 구현되어 있었던 것을 이번에 바로잡음).
    const afterTaxOperatingIncome = Number(p.afterTaxOperatingIncome) || 0;
    const incomeBase = afterTaxOperatingIncome;
    const tradeRatio = Number(p.relatedPartyTransactionRatio) || 0;
    const shareRatio = Number(p.shareholderOwnershipRatio) || 0;

    const gateTradeThreshold = companySize === 'general' ? 30 : (companySize === 'medium' ? 40 : 50);
    const gateShareThreshold = companySize === 'general' ? 3 : 10;
    // §45의3①1호나목2) — 일반기업(중소·중견 아님)은 가목 사유(거래비율>정상거래비율) 외에, "거래비율이
    // 정상거래비율의 3분의 2 초과 + 특수관계법인 매출액이 시행령§34의3⑰의 1천억원 초과"인 경우도
    // 대체로 과세요건을 충족한다(시행령§34의3③④의 사업부문별 계산 특례는 미반영 — 그 경우 별도 계산식이 필요).
    const generalAltGateTradeThreshold = companySize === 'general' ? gateTradeThreshold * 2 / 3 : null;
    const relatedPartySalesAmount = Number(p.relatedPartySalesAmount) || 0;
    const meetsGeneralAltGate = companySize === 'general' && tradeRatio > generalAltGateTradeThreshold && relatedPartySalesAmount > 100000000000;
    const meetsTradeGate = tradeRatio > gateTradeThreshold || meetsGeneralAltGate;
    const meetsGate = incomeBase > 0 && meetsTradeGate && shareRatio > gateShareThreshold;

    if (!meetsGate) {
      return {
        과세대상여부: false,
        과세요건_거래비율기준: gateTradeThreshold, 과세요건_지분율기준: gateShareThreshold,
        과세요건_대체거래비율기준: generalAltGateTradeThreshold, 과세요건_대체매출액기준: companySize === 'general' ? 100000000000 : null,
        증여의제이익: 0, 납부세액: 0,
        안내: '과세요건(세후영업이익 존재, 거래비율 ' + gateTradeThreshold + '% 초과, 주식보유비율 ' + gateShareThreshold + '% 초과' +
          (companySize === 'general' ? ' — 또는 거래비율 ' + generalAltGateTradeThreshold.toFixed(1) + '% 초과+특수관계법인매출액 1천억원 초과(§45의3①1호나목2)' : '') +
          ')을 충족하지 못해 일감몰아주기 증여의제 과세대상이 아닙니다.'
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
    const r = taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount, !!p.isOffshoreTransaction, undefined, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.unlistedStockAppraisalFeeAmount, p.fraudulentUnderreportedTaxAmount);

    return {
      과세대상여부: true,
      적용소득기준: '세후영업이익', 적용소득금액: incomeBase,
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
    // 법인세 납부세액 중 상당액(시행령§34의4④) = [수혜법인 산출세액(법인세법§55, 토지등양도소득분 제외)에서
    // 공제·감면액을 뺀 세액] × [사업기회제공이익이 수혜법인 각사업연도소득금액에서 차지하는 비율(1초과시1)].
    // corporateTaxAfterCredit·corporateTaxableIncome을 입력하면 자동계산하며, corporateTaxPortion 직접입력이
    // 있으면 그 값을 우선한다(§45의5 특정법인 거래 함수의 동일 산식과 일관).
    const corporateTaxAfterCredit = Number(p.corporateTaxAfterCredit) || 0;
    const corporateTaxableIncome = Number(p.corporateTaxableIncome) || 0;
    const corporateTaxPortion = Number(p.corporateTaxPortion) > 0
      ? Number(p.corporateTaxPortion)
      : Math.round(corporateTaxAfterCredit * (corporateTaxableIncome > 0 ? Math.min(1, profitFromOpportunity / corporateTaxableIncome) : 0));

    const meetsGate = profitFromOpportunity > 0 && shareRatio >= 30;
    if (!meetsGate) {
      return {
        과세대상여부: false,
        증여의제이익: 0, 납부세액: 0,
        안내: '과세요건(사업기회로 인한 부문별 영업이익 존재, 지배주주+친족 주식보유비율 30% 이상)을 충족하지 못해 일감떼어주기 증여의제 과세대상이 아닙니다.'
      };
    }

    let deemedGiftProfit;
    // 시행령§34의4⑤ — 개시사업연도분(§45의4①)도 정산분(⑥, §45의4③)과 별개로 "지배주주등이 배당받은
    // 소득이 있는 경우... 금액을 증여의제이익에서 공제(공제 후의 금액이 음수인 경우에는 영으로 본다)"가
    // 적용된다. 두 항 모두 dividendDeduction 파라미터를 최종 증여의제이익에서 차감한다.
    const dividendDeduction = Number(p.dividendDeduction) || 0;
    if (phase === 'initial') {
      const monthsInInitialYear = Number(p.monthsInInitialYear) || 12;
      deemedGiftProfit = Math.max(0, Math.round(Math.max(0, (profitFromOpportunity * (shareRatio / 100) - corporateTaxPortion) / monthsInInitialYear * 12) * 3) - dividendDeduction);
    } else {
      deemedGiftProfit = Math.max(0, Math.round(profitFromOpportunity * (shareRatio / 100) - corporateTaxPortion) - dividendDeduction);
    }

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const r = taxOnDeemedGiftProfit(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount, !!p.isOffshoreTransaction, undefined, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.unlistedStockAppraisalFeeAmount, p.fraudulentUnderreportedTaxAmount);

    return {
      과세대상여부: true,
      증여의제이익: deemedGiftProfit,
      과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
      무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
      안내: (phase === 'initial'
        ? '개시사업연도 신고는 잠정치입니다 — 2년 경과 후 정산사업연도에 재계산·정산신고해야 합니다. '
        : '') + '증여재산공제는 적용되지 않습니다(증여의제이익 전액이 과세표준). 지배주주 판정은 다자간 지분구조 확인이 필요해 이 도구가 자동판정하지 않으니 별도로 확인하세요. 법인세 납부세액 중 상당액은 corporateTaxAfterCredit·corporateTaxableIncome을 넣으면 시행령§34의4④ 산식대로 자동계산되니(수혜법인의 실제 법인세 신고서상 값을 정확히 넣었는지만 확인하면 됩니다), corporateTaxPortion을 직접 계산해서 넣을 필요는 없습니다.',
      납부세액: r.finalTax
    };
  };

  // 명의신탁재산의 증여 의제 (상증세법§45의2) — 등기·등록·명의개서가 필요한 재산(토지·건물은 제외 —
  // 대표적으로 주식등) 중 실제소유자와 명의자가 다르면, 명의개서일(주식처럼 명의개서 대상 재산이면
  // 소유권취득일이 속한 해의 다음 해 말일의 다음 날)에 그 재산가액을 실제소유자가 명의자에게 증여한
  // 것으로 본다. §55①1호에 따라 과세표준 = 명의신탁재산의 금액(관계별 증여재산공제 없음, 감정평가
  // 수수료만 차감) — Code.js toolCalculateNomineeTrustGiftTax와 동일 로직.
  window.calculateNomineeTrustGiftTaxJS = function (p) {
    p = p || {};
    const propertyValue = Number(p.nomineeTrustPropertyValue) || 0;
    if (propertyValue <= 0) return { error: '명의신탁재산의 가액(nomineeTrustPropertyValue)이 필요합니다.' };

    // §45의2①단서 — 다음 중 하나에 해당하면 증여의제 적용 자체가 배제된다(과세대상 아님).
    // 1호: 조세회피 목적 없이 등기등을 하거나(또는 소유권취득 후 명의개서 미이행)
    // 3호: 자본시장법상 신탁재산인 사실의 등기등을 한 경우
    // 4호: 비거주자가 법정대리인·재산관리인 명의로 등기등을 한 경우
    // (2호는 삭제된 조항)
    const exclusionReasons = [];
    if (p.isNoTaxAvoidancePurpose) exclusionReasons.push('조세회피 목적 없음(§45의2①1호)');
    if (p.isTrustPropertyRegistration) exclusionReasons.push('자본시장법상 신탁재산 등기(§45의2①3호)');
    if (p.isNonResidentAgentRegistration) exclusionReasons.push('비거주자의 법정대리인·재산관리인 명의 등기(§45의2①4호)');

    // §45의2③ — "실제소유자 명의로 명의개서를 하지 아니한 경우"는 조세회피 목적이 있는 것으로 추정한다.
    // 매매취득+양도소득세(증권거래세)신고시 소유권변경신고, 또는 상속취득+상속세신고에 포함(사전에
    // 결정·경정을 알고 한 수정신고·기한후신고는 제외)이면 추정하지 않는다(세이프하버).
    let presumptionNote = '';
    if (p.isNameChangeNeglectCase && exclusionReasons.length === 0) {
      const safeHarborBySale = !!p.isSaleAcquisitionWithTransferReport;
      const safeHarborByInheritance = !!p.isInheritanceAcquisitionWithEstateReport && !p.isLateAmendedAfterAuditNotice;
      if (safeHarborBySale || safeHarborByInheritance) {
        exclusionReasons.push('명의개서 해태이나 §45의2③단서 세이프하버 충족(' + (safeHarborBySale ? '매매취득+양도소득세(증권거래세)신고시 소유권변경신고' : '상속취득+상속세신고에 포함') + ')로 조세회피목적 추정이 배제됨');
      } else {
        presumptionNote = ' 실제소유자 명의로 명의개서를 하지 않은 경우로서 매매취득+양도소득세신고 소유권변경신고, 상속취득+상속세신고포함 중 어느 세이프하버에도 해당하지 않아 조세회피 목적이 있는 것으로 추정됩니다(§45의2③). 이 추정은 다른 반증자료로 뒤집을 수 있으나 그 입증책임은 납세자에게 있습니다.';
      }
    }

    if (exclusionReasons.length > 0) {
      return {
        과세대상여부: false, 명의신탁재산가액: propertyValue, 납부세액: 0,
        안내: '§45의2①단서의 적용배제 사유(' + exclusionReasons.join(', ') + ')에 해당하여 명의신탁재산의 증여의제가 적용되지 않습니다.'
      };
    }

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const r = taxOnDeemedGiftProfit(propertyValue, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount, undefined, undefined, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.unlistedStockAppraisalFeeAmount, p.fraudulentUnderreportedTaxAmount);

    return {
      과세대상여부: true,
      명의신탁재산가액: propertyValue, 감정평가수수료공제: Math.min(Number(p.appraisalFeeAmount) || 0, 5000000) + Math.min(Number(p.unlistedStockAppraisalFeeAmount) || 0, 10000000),
      과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
      무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
      납부세액: r.finalTax,
      안내: '증여재산공제(§53)는 적용되지 않습니다(§55①1호 — 명의신탁재산의 금액 전액이 과세표준, 감정평가수수료만 차감). isNoTaxAvoidancePurpose·isTrustPropertyRegistration·isNonResidentAgentRegistration을 확인해서 명시적으로 넣지 않으면 이 배제사유를 검토하지 않은 채(과세대상으로 전제하고) 계산한 것이니 반드시 확인하세요. 실제소유자와 명의자 사이의 증여세는 실제소유자가 납부의무를 진다(§4의2②).' + presumptionNote
    };
  };

  // 재산 취득자금 등의 증여 추정 (상증세법§45, 시행령§34) — 자력취득 능력이 부족한 자가 재산을 취득(또는
  // 채무를 상환)했는데 그 자금출처를 입증하지 못하면, 미입증금액을 증여받은 것으로 추정한다. 다만
  // 미입증금액이 "취득재산가액(또는 상환금액)의 20%"와 "2억원" 중 적은 금액에 미달하면 추정 자체를
  // 배제한다(시행령§34①). §47①에 따라 합산배제증여재산이나, §45는 §55①1호(§45의2)·2호(§45의3·45의4)
  // 어디에도 해당하지 않아 3호("제1호 및 제2호를 제외한 합산배제증여재산")가 적용되어 3천만원 정액공제
  // 후의 금액이 과세표준이다(taxOnDeemedGiftProfit에 flatDeduction=30000000으로 반영). §45③ 단서의 "국세청장이 정하는 금액 이하"
  // 적용배제 기준(연령·직업·재산상태별 소액취득 기준, 국세청 고시)은 수시로 바뀌는 행정 고시라 이 도구가
  // 추적하지 않는다 — 통상적인 소액 취득(전세보증금 등)은 별도로 그 고시 기준을 확인해야 한다.
  window.calculatePropertyAcquisitionFundsGiftTaxJS = function (p) {
    p = p || {};
    const acquisitionValue = Number(p.acquisitionValue) || 0;
    if (acquisitionValue <= 0) return { error: '취득재산의 가액(또는 채무 상환금액)이 필요합니다.' };
    const provenAmount = Number(p.provenAmount) || 0;
    const unprovenAmount = Math.max(0, acquisitionValue - provenAmount);
    const gateThreshold = Math.min(Math.round(acquisitionValue * 0.2), 200000000);
    const meetsGate = unprovenAmount >= gateThreshold;

    if (!meetsGate) {
      return {
        과세대상여부: false, 취득재산가액: acquisitionValue, 입증된금액: provenAmount, 미입증금액: unprovenAmount,
        배제기준금액: gateThreshold, 증여의제이익: 0, 납부세액: 0,
        안내: '미입증금액(' + unprovenAmount + '원)이 배제기준금액(취득재산가액의 20%와 2억원 중 적은 금액, ' + gateThreshold + '원)에 미달해(시행령§34①단서) 증여추정 대상이 아닙니다.'
      };
    }

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const r = taxOnDeemedGiftProfit(unprovenAmount, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount, false, 30000000, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.unlistedStockAppraisalFeeAmount, p.fraudulentUnderreportedTaxAmount);

    return {
      과세대상여부: true, 취득재산가액: acquisitionValue, 입증된금액: provenAmount, 미입증금액: unprovenAmount, 배제기준금액: gateThreshold,
      증여의제이익: unprovenAmount, 정액공제_3천만원: Math.min(30000000, Math.max(0, unprovenAmount - (Number(p.appraisalFeeAmount) || 0))),
      과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
      무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
      납부세액: r.finalTax,
      안내: '일반 증여재산공제(§53)는 적용되지 않지만, §55①3호(1호·2호 제외 합산배제증여재산)에 따라 증여의제이익에서 3천만원을 정액공제한 금액이 과세표준입니다. 자금출처로 인정되는 항목(시행령§34①: 신고·과세된 소득금액, 신고·과세된 상속·수증재산가액, 재산처분대가·부담한 채무로 실제 그 취득·상환에 쓴 금액)을 정확히 소명했는지 다시 확인하세요. §45③ 단서의 국세청장 고시 소액기준 적용 여부는 이 도구가 판정하지 않습니다.'
    };
  };

  // 채무면제 등에 따른 증여 (상증세법§36) — 채권자로부터 채무를 면제받거나 제3자로부터 채무의 인수·변제를
  // 받으면, 그 면제·인수·변제로 얻은 이익(보상액을 지급했으면 그 보상액을 뺀 금액)이 증여재산가액이다.
  window.calculateDebtForgivenessGiftTaxJS = function (p) {
    p = p || {};
    const debtAmount = Number(p.debtAmount) || 0;
    if (debtAmount <= 0) return { error: '면제·인수·변제받은 채무액이 필요합니다.' };
    const compensationPaid = Number(p.compensationPaid) || 0;
    const giftAmount = Math.max(0, debtAmount - compensationPaid);
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      채무면제등이익: giftAmount, 증여재산공제: relationDeduction,
      감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount, 과세표준: taxBase,
      산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 면제·인수·변제를 받은 날입니다(§36②). 배우자·직계존비속 등 관계별 증여재산공제(§53) 한도는 10년간 합산 사용액을 감안해 직접 계산해서 넣어야 합니다.'
    };
  };

  // 부동산 무상사용·담보이용에 따른 이익의 증여 (상증세법§37, 시행령§27, 시행규칙§10) — 타인의 부동산(그
  // 소유자와 함께 거주하는 주택·부수토지는 제외)을 무상사용하면 연간 부동산가액×2%(시행규칙§10②)의
  // 이익을 5년간(무상사용기간은 5년 단위로 재산정) 매년 얻는 것으로 보아, 매 연도 이익을 10% 할인율로
  // 현재가치화해 합산한다(시행규칙§10③ — 5년 연금현가계수 3.79079, §59② 영업권평가와 동일한 방식).
  // 5년간 합계이익이 1억원 미만이면 과세 제외(§37①단서, 시행령§27④).
  // 부동산을 무상으로 담보로 제공받아 차입한 경우(§37②)는 별도로, 차입금×적정이자율(4.6%)-실제지급이자를
  // 1년 단위로 계산해 1천만원 미만이면 제외한다(시행령§27⑤⑥).
  window.calculateFreePropertyUseGiftTaxJS = function (p) {
    p = p || {};
    const useType = p.useType;
    if (['occupancy', 'collateral'].indexOf(useType) === -1) return { error: '무상사용 또는 담보이용 중에서 선택하세요.' };
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    let giftAmount, annualBenefit, thisTransactionGiftAmount;
    if (useType === 'occupancy') {
      const propertyValue = Number(p.propertyValue) || 0;
      annualBenefit = Math.round(propertyValue * 0.02);
      thisTransactionGiftAmount = Math.round(annualBenefit * 3.79079);
      giftAmount = thisTransactionGiftAmount + priorBenefitSum;
      if (giftAmount < 100000000) {
        return {
          과세대상여부: false, 연간이익: annualBenefit, 이번거래현재가치: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum,
          오년간현재가치합계: giftAmount, 기준금액: 100000000, 납부세액: 0,
          안내: '5년간 이익의 현재가치 합계(' + giftAmount + '원' + aggNote + ')가 기준금액(1억원, 시행령§27④)에 미달해 과세대상이 아닙니다.'
        };
      }
    } else {
      const loanAmount = Number(p.loanAmount) || 0;
      const appropriateInterestRate = 0.046;
      const actualInterestPaid = Number(p.actualInterestPaid) || 0;
      thisTransactionGiftAmount = Math.max(0, Math.round(loanAmount * appropriateInterestRate) - actualInterestPaid);
      giftAmount = thisTransactionGiftAmount + priorBenefitSum;
      if (giftAmount < 10000000) {
        return {
          과세대상여부: false, 이번거래담보이용이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum,
          담보이용이익: giftAmount, 기준금액: 10000000, 납부세액: 0,
          안내: '담보이용이익(' + giftAmount + '원' + aggNote + ')이 기준금액(1천만원, 시행령§27⑥)에 미달해 과세대상이 아닙니다.'
        };
      }
    }
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return Object.assign({
      과세대상여부: true,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: (useType === 'occupancy'
        ? '5년마다 증여시기가 재산정되므로(무상사용 개시일로부터 5년이 되는 날의 다음날에 새로 개시한 것으로 봄), 5년을 초과해 계속 무상사용하면 그 다음 5년분도 별도로 계산해서 신고해야 합니다. 특수관계인이 아닌 경우 거래관행상 정당한 사유가 없을 때만 과세됩니다(§37③).'
        : '차입기간을 정하지 않았으면 1년으로 보고, 1년 초과시 그 다음 1년분도 새로 계산합니다(시행령§27⑤). 적정이자율(4.6%)은 시행령§31의4①과 동일합니다.') + aggNote
    }, useType === 'occupancy' ? { 연간이익: annualBenefit, 이번거래현재가치: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 오년간현재가치합계: giftAmount } : { 이번거래담보이용이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 담보이용이익: giftAmount });
  };

  // 배우자 등에게 양도한 재산의 증여 추정 (상증세법§44) — 배우자·직계존비속에게 양도한 재산은 그 재산가액을
  // 양도자가 증여한 것으로 추정한다(①). 특수관계인에게 양도한 재산을 그 특수관계인이 3년 이내에 당초
  // 양도자의 배우자등에게 다시 양도하면, 재양도 당시 재산가액을 증여추정한다(②) — 다만 당초양도자·양수자가
  // 부담한 소득세 결정세액 합계가 재양도 재산가액을 증여추정할 경우의 증여세액보다 크면 배제한다(②단서 —
  // 그 비교대상 증여세액은 이 함수가 아래에서 어차피 계산하는 값과 동일해 자동으로 재사용한다).
  // ③ 각호(경매·파산선고·공매·증권시장처분·대가받고양도한사실이명백히인정) 중 하나에 해당하면 적용하지 않는다.
  window.calculateSpousePropertyTransferGiftTaxJS = function (p) {
    p = p || {};
    if (p.isExcluded) {
      return {
        과세대상여부: false, 납부세액: 0,
        안내: '적용배제 사유(§44③ — 경매·파산선고·공매·증권시장처분·대가받고 양도한 사실이 명백히 인정되는 경우)에 해당해 증여추정을 적용하지 않습니다.'
      };
    }
    const transferType = p.transferType;
    if (['direct', 'bypass'].indexOf(transferType) === -1) return { error: '직접양도 또는 우회양도(3년 이내 재양도) 중에서 선택하세요.' };
    const assetValue = Number(p.assetValue) || 0;
    if (assetValue <= 0) return { error: '증여추정 대상 재산가액이 필요합니다.' };

    const giftAmount = assetValue;
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);

    if (transferType === 'bypass') {
      // §44②단서 비교대상 증여세액 — "재양도 재산가액을 증여추정할 경우의 증여세액"은 바로 아래에서
      // 이 함수가 어차피 계산하는 값(assetValue를 증여재산가액으로, 같은 관계별공제 등을 적용한 산출세액)과
      // 동일하므로, comparisonGiftTax를 별도로 입력받는 대신 위에서 이미 계산한 calculatedTax를 그대로
      // 쓴다(직접 입력하면 그 값을 우선 사용, 하위호환 유지).
      const priorTaxesSum = Number(p.priorTaxesSum) || 0;
      const comparisonGiftTax = Number(p.comparisonGiftTax) > 0 ? Number(p.comparisonGiftTax) : calculatedTax;
      if (priorTaxesSum > comparisonGiftTax) {
        return {
          과세대상여부: false, 납부세액: 0,
          안내: '당초 양도자·양수자가 부담한 소득세 결정세액 합계(' + priorTaxesSum + '원)가 재양도 재산가액을 증여추정할 경우의 증여세액(' + comparisonGiftTax + '원)보다 커서(§44②단서) 증여추정을 적용하지 않습니다.'
        };
      }
    }

    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 증여추정재산가액: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: transferType === 'direct'
        ? '증여로 추정되어 배우자등에게 증여세가 부과되면, 당초 양도자·양수자에게는 그 양도에 대한 소득세를 부과하지 않습니다(§44④).'
        : '재양도 당시의 재산가액을 증여받은 것으로 추정합니다(§44②). 마찬가지로 소득세는 부과되지 않습니다(§44④).'
    };
  };

  // 양도소득의 부당행위계산 - 증여 후 우회양도 부인 (소득세법§101②③④) — 거주자가 특수관계인(§97의2①
  // 적용받는 배우자·직계존비속은 제외, 그쪽은 이월과세로 별도 처리)에게 자산을 증여한 후 수증자가 그
  // 증여일부터 10년 이내에 다시 타인에게 양도한 경우로서, (수증자의 증여세+양도소득세 합계)가 (증여자가
  // 직접 양도했다고 볼 경우의 양도소득세)보다 적으면 증여자가 직접 양도한 것으로 보아 증여자에게 양도소득세를
  // 과세하고, 당초 증여에 대해서는 증여세를 부과하지 않는다(§101③). 양도소득이 수증자에게 실질적으로
  // 귀속된 경우에는 적용하지 않는다(§101②단서).
  window.calculateDonorDirectTransferDeemedJS = function (p) {
    p = p || {};
    if (p.isSpouseOrLinealCarryoverApplies) {
      return {
        적용여부: false,
        안내: '배우자·직계존비속으로서 이월과세(소득세법§97의2)가 적용되는 대상이므로 이 조문(§101②)의 적용대상에서 제외됩니다.'
      };
    }
    const yearsSinceGift = Number(p.yearsSinceGift);
    if (!(yearsSinceGift >= 0)) return { error: '증여일로부터 재양도일까지의 경과연수가 필요합니다.' };
    if (yearsSinceGift > 10) {
      return {
        적용여부: false,
        안내: '증여일부터 10년을 초과하여 재양도하였으므로 §101② 요건(10년 이내 재양도)에 해당하지 않습니다.'
      };
    }
    if (p.isGainActuallyAttributedToDonee) {
      return {
        적용여부: false,
        안내: '양도소득이 수증자에게 실질적으로 귀속된 것으로 인정되어(§101②단서) 적용하지 않습니다.'
      };
    }
    const doneeGiftTax = Math.max(0, Number(p.doneeGiftTax) || 0);
    const doneeTransferTax = Math.max(0, Number(p.doneeTransferTax) || 0);
    const donorDirectTransferTax = Math.max(0, Number(p.donorDirectTransferTax) || 0);
    const combinedDoneeTax = doneeGiftTax + doneeTransferTax;
    if (combinedDoneeTax >= donorDirectTransferTax) {
      return {
        적용여부: false, 수증자부담세액합계: combinedDoneeTax, 증여자직접양도시양도세: donorDirectTransferTax,
        납부세액: combinedDoneeTax,
        안내: '수증자가 부담하는 증여세·양도소득세 합계(' + combinedDoneeTax + '원)가 증여자가 직접 양도했다고 볼 경우의 양도소득세(' + donorDirectTransferTax + '원) 이상이어서 §101②을 적용하지 않습니다. 수증자에게 증여세와 양도소득세가 각각 그대로 부과됩니다.'
      };
    }
    return {
      적용여부: true, 수증자부담세액합계: combinedDoneeTax, 증여자직접양도시양도세: donorDirectTransferTax,
      납부세액: donorDirectTransferTax,
      안내: '수증자 부담세액 합계(' + combinedDoneeTax + '원)가 증여자 직접양도시 양도소득세(' + donorDirectTransferTax + '원)보다 적어, 증여자가 그 자산을 직접 양도한 것으로 보아 증여자에게 양도소득세를 부과합니다(소득세법§101②). 당초 증여받은 자산에 대한 증여세는 부과하지 않습니다(소득세법§101③). 그 양도소득에 대해서는 증여자와 수증자가 연대하여 납세의무를 집니다(소득세법§2의2③).'
    };
  };

  // 신탁이익의 증여 (상증세법§33, 시행령§25) — 위탁자가 타인을 수익자로 지정한 신탁에서, 원본 또는
  // 수익이 (원칙적으로) 실제 지급되는 날을 증여일로 하여 그 신탁의 이익을 받을 권리의 가액을 증여재산가액으로
  // 한다. 원본·수익을 한번에 받으면 그 가액 그대로, 여러 차례 나눠 받으면 증여시기를 기준으로 시행령§61을
  // 준용해 평가한다(시행령§25②) — 후자는 "신탁의 이익을 받을 권리 평가" 계산기(재산평가 화면, §61)로
  // 먼저 평가액을 구한 뒤 그 결과를 giftAmount로 입력한다.
  window.calculateTrustIncomeGiftTaxJS = function (p) {
    p = p || {};
    const giftAmount = Number(p.giftAmount) || 0;
    if (giftAmount <= 0) return { error: '신탁이익(원본 또는 수익의 가액 — 여러 차례 나눠 받는 경우 재산평가 화면의 §61 신탁수익권 평가액)이 필요합니다.' };
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      신탁이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 원칙적으로 원본·수익이 실제 지급되는 날입니다(위탁자 사망시 사망일, 약정일까지 미지급시 약정일 등 예외는 시행령§25①). 수익자가 특정·존재하지 않으면 위탁자(또는 상속인)를 수익자로 보아 과세하고, 나중에 수익자가 특정되면 그때 새로운 신탁이 있는 것으로 봅니다(§33②).'
    };
  };

  // 보험금의 증여 (상증세법§34) — 보험사고(만기보험금 포함) 발생일을 증여일로 하여, ①보험금수령인이 아닌
  // 자가 낸 보험료 부분(1호)과 ②수령인이 증여받은 재산으로 낸 보험료 부분(2호, 그 보험료액은 다시 뺀다)에
  // 대응하는 보험금 상당액을 증여재산가액으로 한다. 두 유형을 동시에 적용해 일반화하면:
  // 증여재산가액 = 보험금×[(타인이낸보험료+증여받은재산으로낸보험료)÷총납부보험료] − 증여받은재산으로낸보험료.
  // §8에 따라 보험금을 상속재산으로 보는 경우(피상속인이 보험계약자인 경우 등)에는 이 조를 적용하지 않는다(§34②).
  window.calculateInsuranceProceedsGiftTaxJS = function (p) {
    p = p || {};
    const insuranceProceeds = Number(p.insuranceProceeds) || 0;
    if (insuranceProceeds <= 0) return { error: '보험금이 필요합니다.' };
    const totalPremiumPaid = Number(p.totalPremiumPaid) || 0;
    if (totalPremiumPaid <= 0) return { error: '총 납부보험료가 필요합니다.' };
    const premiumPaidByOthers = Number(p.premiumPaidByOthers) || 0;
    const premiumPaidFromGiftedAssets = Number(p.premiumPaidFromGiftedAssets) || 0;
    const attributedPremium = premiumPaidByOthers + premiumPaidFromGiftedAssets;
    const proceedsShare = Math.round(insuranceProceeds * attributedPremium / totalPremiumPaid);
    const giftAmount = Math.max(0, proceedsShare - premiumPaidFromGiftedAssets);

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      보험금상당액: proceedsShare, 증여받은재산으로낸보험료: premiumPaidFromGiftedAssets, 증여재산가액: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 보험사고(만기보험금 지급 포함)가 발생한 날입니다. 피상속인이 보험계약자로서 §8에 따라 이 보험금을 상속재산으로 보는 경우에는 이 조가 아니라 상속세로 과세됩니다(§34②).'
    };
  };

  // 상속세·증여세 자진납부시 분납 한도 (§70②, 시행령§66②) — 연부연납(§71)과는 별개 제도로, 신고기한까지
  // 전액을 내는 대신 일부를 "신고기한이 지난 후 2개월 이내"에 나눠 낼 수 있다. §70②단서 — 연부연납을
  // 허가받은 경우에는 이 분납을 적용하지 않는다(중복 불가). 시행령§66② — 납부할 세액이 2천만원 이하면
  // 1천만원 초과분까지, 2천만원 초과면 세액의 50% 이하까지 분납 가능.
  window.calculateInstallmentSplitPaymentLimitJS = function (p) {
    p = p || {};
    const totalTaxAmount = Number(p.totalTaxAmount);
    if (!totalTaxAmount || totalTaxAmount <= 0) return { error: '납부할 세액이 필요합니다.' };
    if (p.hasInstallmentPaymentApproval) {
      return { 분납가능여부: false, 안내: '연부연납(§71)을 허가받은 경우에는 분납(§70②)을 적용하지 않습니다(중복 불가).' };
    }
    if (totalTaxAmount <= 10000000) {
      return { 분납가능여부: false, 안내: '납부할 세액이 1천만원을 초과하지 않아 분납할 수 없습니다(§70②).' };
    }
    const maxSplitAmount = totalTaxAmount <= 20000000
      ? (totalTaxAmount - 10000000)
      : Math.floor(totalTaxAmount * 0.5);
    const immediateDueAmount = totalTaxAmount - maxSplitAmount;
    return {
      분납가능여부: true,
      신고기한까지_납부할금액: immediateDueAmount,
      분납가능_최대금액: maxSplitAmount,
      분납기한: '신고기한이 지난 후 2개월 이내',
      안내: (totalTaxAmount <= 20000000
        ? '세액이 2천만원 이하이므로 1천만원 초과분(' + maxSplitAmount.toLocaleString() + '원)까지 분납할 수 있습니다(시행령§66②1호).'
        : '세액이 2천만원을 초과하므로 세액의 50% 이하(' + maxSplitAmount.toLocaleString() + '원)까지 분납할 수 있습니다(시행령§66②2호).')
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
    // §71②1호 — 상속세는 가업상속재산 특례(가목, 최대 20년)를 받는 경우가 아니면 최대 10년(나목),
    // 증여세는 조특법§30의6 특례재산(가목, 최대 15년)이 아니면 최대 5년(나목)이다. 어느 쪽이든 이
    // 절대 상한(상속 20년/증여 15년)은 넘을 수 없으므로 최소한의 안전장치로 막는다 — 다만 일반재산인데
    // 특례 상한(20년/15년)까지 입력하는 경우는 이 도구가 구분하지 못하니 taxType에 맞는 정확한 한도인지
    // 별도로 확인해야 한다(가업상속재산 특례 대상 여부 판정은 시행령§68③의 복잡한 요건이라 이 도구가
    // 자동판정하지 않음).
    const absoluteMaxYears = taxType === 'inheritance' ? 20 : 15;
    if (installmentPeriodYears > absoluteMaxYears) {
      return { error: '연부연납기간(' + installmentPeriodYears + '년)이 ' + (taxType === 'inheritance' ? '상속세' : '증여세') + '의 절대 상한(' + absoluteMaxYears + '년, §71②1호)을 초과합니다. 일반재산이면 상속세 10년·증여세 5년이 한도이며, 가업상속재산·조특법§30의6 특례재산에 해당하는지는 별도로 확인하세요.' };
    }
    // §72①·시행령§69①·국세기본법시행령§43의3② — 각 회분 분할납부세액의 "납부일 현재" 이자율을 적용한다.
    // 향후 회차의 이자율은 아직 정해지지 않았으므로, referenceDate(기준일, 보통 연부연납 허가일·신고일 —
    // 없으면 오늘) 시점에 적용되는 최신 고시 이자율(REFUND_INTEREST_RATE_HISTORY, calculateClawbackInterestJS와
    // 동일 테이블)을 전체 회차에 공통 적용하는 것으로 자동계산한다(직접 입력하면 그 값이 우선).
    const referenceDate = p.referenceDate || new Date().toISOString().slice(0, 10);
    const annualInterestRatePercent = Number(p.annualInterestRatePercent) >= 0
      ? Number(p.annualInterestRatePercent)
      : Math.round(refundInterestRateAt_(referenceDate) * 100 * 1000) / 1000;
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
    { from: '2023-03-20', rate: 0.029 }, { from: '2024-03-22', rate: 0.035 }, { from: '2025-03-21', rate: 0.031 },
    // 2026.1.2 개정 — 국세기본법시행규칙§19조의3 개정이력에 포함되어 있으나 이율 값(연 1천분의31=3.1%)은
    // 2025.3.21분과 동일하게 유지됨(원문 확인 완료). 값은 안 바뀌지만 이력표를 공식 개정일과 정확히
    // 맞추기 위해 별도 항목으로 남겨둔다.
    { from: '2026-01-02', rate: 0.031 }
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

  function formatDateStr_(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addMonthsToDateStr_(dateStr, months) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + months);
    return formatDateStr_(d);
  }
  function addYearsToDateStr_(dateStr, years) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + years);
    return formatDateStr_(d);
  }

  // 가산세 감면 등 (국세기본법§48) — Code.js toolCalculateFilingPenaltyReduction과 동일 로직.
  function computeAmendmentPenaltyReductionRate_(months, filingType) {
    if (!(months >= 0)) return 0;
    if (filingType === 'revised') {
      if (months <= 1) return 0.90;
      if (months <= 3) return 0.75;
      if (months <= 6) return 0.50;
      if (months <= 12) return 0.30;
      if (months <= 18) return 0.20;
      if (months <= 24) return 0.10;
      return 0;
    }
    if (filingType === 'late_filing') {
      if (months <= 1) return 0.50;
      if (months <= 3) return 0.30;
      if (months <= 6) return 0.20;
      return 0;
    }
    return 0;
  }

  window.calculateFilingPenaltyReductionJS = function (p) {
    p = p || {};
    const originalPenaltyAmount = Number(p.originalPenaltyAmount);
    if (!(originalPenaltyAmount > 0)) return { error: 'originalPenaltyAmount(감면 전 가산세액, 무신고·과소신고가산세 등)이 필요합니다.' };

    if (p.hasJustifiableReason || p.hasDeadlineExtensionReason) {
      return {
        적용조문: p.hasDeadlineExtensionReason ? '국세기본법§48①1호(§6 기한연장사유)' : '국세기본법§48①2호(정당한 사유)',
        감면율: 1, 감면세액: originalPenaltyAmount, 최종가산세액: 0,
        안내: '기한 연장 사유 또는 의무 불이행에 정당한 사유가 있다고 인정되면 해당 가산세는 전혀 부과되지 않습니다(§48①). 다만 정당한 사유 인정 여부는 사실관계에 따라 과세관청 또는 불복절차에서 최종적으로 판단됩니다.'
      };
    }

    const filingType = p.filingType;
    if (['revised', 'late_filing'].indexOf(filingType) === -1) {
      return { error: "filingType은 'revised'(법정신고기한까지 신고 후 수정신고, §48②1호) 또는 'late_filing'(무신고 후 기한후신고, §48②2호) 중 하나여야 합니다." };
    }
    if (p.isAmendedAfterAuditNotice) {
      return {
        적용조문: filingType === 'revised' ? '국세기본법§48②1호 괄호(경정 예지 후 수정신고 — 감면 배제)' : '국세기본법§48②2호 괄호(결정 예지 후 기한후신고 — 감면 배제)',
        감면율: 0, 감면세액: 0, 최종가산세액: originalPenaltyAmount,
        안내: '과세표준과 세액을 경정(또는 결정)할 것을 미리 알고 수정신고(또는 기한후신고)를 한 경우로 보아 §48②의 가산세 감면이 적용되지 않습니다.'
      };
    }
    const months = Number(p.monthsAfterDeadline);
    if (!(months >= 0)) return { error: 'monthsAfterDeadline(법정신고기한이 지난 후 경과한 개월 수)이 필요합니다.' };
    const rate = computeAmendmentPenaltyReductionRate_(months, filingType);
    const reductionAmount = Math.round(originalPenaltyAmount * rate);
    const finalPenalty = originalPenaltyAmount - reductionAmount;
    return {
      적용조문: filingType === 'revised' ? '국세기본법§48②1호(수정신고 — 과소신고·초과환급신고가산세만 해당)' : '국세기본법§48②2호(기한후신고 — 무신고가산세만 해당)',
      경과개월수: months, 감면율: rate, 감면전가산세액: originalPenaltyAmount, 감면세액: reductionAmount, 최종가산세액: finalPenalty,
      안내: rate === 0
        ? ('법정신고기한이 지난 후 ' + (filingType === 'revised' ? '2년' : '6개월') + '을 초과하여 §48②에 따른 감면이 적용되지 않습니다.')
        : ('이 감면은 ' + (filingType === 'revised' ? '과소신고·초과환급신고가산세(§47의3)' : '무신고가산세(§47의2)') + '에만 적용되며, 납부지연가산세(§47의4)에는 적용되지 않습니다.')
    };
  };

  // 경정 등의 청구 (국세기본법§45의2) — Code.js toolCheckCorrectionClaimEligibility와 동일 로직.
  window.checkCorrectionClaimEligibilityJS = function (p) {
    p = p || {};
    if (!p.statutoryFilingDeadline) return { error: '법정신고기한(YYYY-MM-DD)이 필요합니다.' };
    const ordinaryDeadline = addYearsToDateStr_(p.statutoryFilingDeadline, 5);
    if (!ordinaryDeadline) return { error: '법정신고기한 형식이 올바르지 않습니다.' };
    const today = p.today || formatDateStr_(new Date());

    const result = {
      법정신고기한: p.statutoryFilingDeadline,
      통상경정청구기한_5년: ordinaryDeadline,
      통상청구가능여부: today <= ordinaryDeadline,
      안내: ['§45의2①본문 — 당초 신고(또는 수정신고)한 과세표준·세액이 과다하거나 결손금·세액공제·환급세액이 과소한 경우, ' + ordinaryDeadline + '까지 관할 세무서장에게 경정청구할 수 있습니다.']
    };

    if (p.wasIncreasedByCorrection && p.noticeReceivedDate) {
      const noticeWindowRaw = addMonthsToDateStr_(p.noticeReceivedDate, 3);
      const noticeWindow = (noticeWindowRaw && noticeWindowRaw <= ordinaryDeadline) ? noticeWindowRaw : ordinaryDeadline;
      result.증액경정분_통지일부터3개월 = noticeWindowRaw;
      result.증액경정분_청구기한_5년상한적용후 = noticeWindow;
      result.증액경정분_청구가능여부 = today <= noticeWindow;
      result.안내.push('§45의2①단서 — 결정·경정으로 증가된 과세표준·세액 부분은 처분을 안 날(통지받은 날 ' + p.noticeReceivedDate + ')부터 3개월 이내(' + noticeWindowRaw + ')에 청구할 수 있으나, 2024.12.31 개정으로 이 3개월 기한도 법정신고기한이 지난 후 5년(' + ordinaryDeadline + ') 이내로 한정되므로 실제 기한은 ' + noticeWindow + '입니다.');
    }

    const subsequentEventLabels = {
      litigation_result_different: '최초 신고·결정·경정의 계산근거 거래·행위가 그 후 심사청구·심판청구·소송(감사원 심사청구 포함) 결과 다른 것으로 확정된 경우(§45의2②1호)',
      income_attribution_changed: '소득이나 그 밖의 과세물건의 귀속을 제3자에게 변경시키는 결정·경정이 있는 경우(§45의2②2호)',
      mutual_agreement_different: '조세조약에 따른 상호합의가 최초 신고·결정·경정과 다르게 이루어진 경우(§45의2②3호)',
      linked_period_or_item_adjusted: '이 결정·경정과 연동된 다른 세목(같은 과세기간) 또는 다른 과세기간(같은 세목)의 과세표준·세액이 과다하게 된 경우(§45의2②4호)',
      other_presidential_decree: '위와 유사한 사유로서 대통령령으로 정하는 사유가 법정신고기한이 지난 후 발생한 경우(§45의2②5호)'
    };
    if (p.subsequentEventType && p.subsequentEventKnownDate) {
      if (!subsequentEventLabels[p.subsequentEventType]) {
        result.안내.push('subsequentEventType 값이 올바르지 않습니다: ' + Object.keys(subsequentEventLabels).join(', ') + ' 중 하나여야 합니다.');
      } else {
        const eventWindow = addMonthsToDateStr_(p.subsequentEventKnownDate, 3);
        result.후발적사유_유형 = subsequentEventLabels[p.subsequentEventType];
        result.후발적사유_안날 = p.subsequentEventKnownDate;
        result.후발적사유_청구기한_3개월 = eventWindow;
        result.후발적사유_청구가능여부 = today <= eventWindow;
        result.안내.push('§45의2② — ' + subsequentEventLabels[p.subsequentEventType] + '에 해당하면, 통상의 5년 제한과 무관하게 그 사유를 안 날(' + p.subsequentEventKnownDate + ')부터 3개월 이내(' + eventWindow + ')에 경정청구할 수 있습니다.');
      }
    }
    return result;
  };

  // 국세의 부과제척기간 (국세기본법§26의2) — Code.js toolCalculateTaxExclusionPeriod와 동일 로직.
  window.calculateTaxExclusionPeriodJS = function (p) {
    p = p || {};
    if (!p.exclusionPeriodStartDate) return { error: '부과제척기간 기산일(시행령§12의3에 따른 "국세를 부과할 수 있는 날")이 필요합니다.' };
    const isOffshore = !!p.isOffshoreTransaction;
    const isInheritanceOrGift = !!p.isInheritanceOrGiftTax;
    const isUnreported = !!p.isUnreported;
    const isFraudulent = !!p.isFraudulent;
    const isFalseOrOmittedReport = !!p.isFalseOrOmittedReport;

    let years, basis;
    if (isInheritanceOrGift) {
      if (isFraudulent || isUnreported || isFalseOrOmittedReport) {
        years = 15; basis = '§26의2④ — 상속세·증여세로서 부정행위 포탈, 무신고, 또는 거짓·누락신고에 해당(15년)';
      } else {
        years = 10; basis = '§26의2④ — 상속세·증여세 원칙(10년)';
      }
    } else if (isFraudulent) {
      years = isOffshore ? 15 : 10; basis = '§26의2②2호 — 부정행위로 포탈·환급·공제(' + years + '년, 역외거래 여부 반영)';
    } else if (isUnreported) {
      years = isOffshore ? 10 : 7; basis = '§26의2②1호 — 법정신고기한까지 무신고(' + years + '년, 역외거래 여부 반영)';
    } else {
      years = isOffshore ? 7 : 5; basis = '§26의2①본문/단서 — 원칙(' + years + '년, 역외거래 여부 반영)';
    }

    const exclusionDeadline = addYearsToDateStr_(p.exclusionPeriodStartDate, years);
    const result = {
      기산일: p.exclusionPeriodStartDate, 적용기간_년: years, 적용근거: basis,
      부과제척기간_만료일: exclusionDeadline,
      안내: ['제척기간이 지나면 그 국세는 더 이상 부과(증액경정 포함)할 수 없습니다. "국세를 부과할 수 있는 날"의 정확한 기산일은 국세기본법시행령§12의3에서 세목·상황별로 별도로 정하므로(예: 상속세는 상속세 과세표준 신고기한의 다음 날 등), 이 도구에는 정확한 기산일을 직접 계산해서 넣어야 합니다.']
    };

    if (isInheritanceOrGift && p.isSpecialOneYearCaseApplicable && p.knownDate && Number(p.fraudBasisPropertyValue) > 5000000000) {
      const specialDeadline = addYearsToDateStr_(p.knownDate, 1);
      result.특례_안날부터1년_적용대상재산가액50억초과 = true;
      result.특례_만료일 = specialDeadline;
      result.안내.push('§26의2⑤ — 부정행위로 상속세·증여세를 포탈하는 경우로서 명의신탁재산 취득 등 8가지 유형 중 하나에 해당하고 포탈세액 산출기준 재산가액이 50억원을 초과하며 상속인·증여자·수증자가 생존해 있으면, 과세관청은 해당 재산의 상속·증여가 있음을 안 날(' + p.knownDate + ')부터 1년(' + specialDeadline + ') 이내에 상속세·증여세를 부과할 수 있습니다(원칙적 제척기간이 이미 지났어도 적용).');
    } else if (isInheritanceOrGift && p.isFraudulent) {
      result.안내.push('§26의2⑤ — 부정행위로 포탈한 경우로서 명의신탁재산 취득 등 8가지 유형에 해당하고 재산가액이 50억원을 초과하며 관련자가 생존해 있으면, 원칙적 제척기간이 지났어도 그 사실을 안 날부터 1년 이내에 특례 부과가 가능합니다. 해당 여부를 판단하려면 isSpecialOneYearCaseApplicable·knownDate·fraudBasisPropertyValue를 함께 입력하세요.');
    }
    return result;
  };

  // 취득세 주택 유상거래 sliding 세율 (지방세법§11①8호) — Code.js acquisitionTaxHouseSlidingRate_와 동일 로직.
  function acquisitionTaxHouseSlidingRate_(value) {
    if (value <= 600000000) return 0.01;
    if (value > 900000000) return 0.03;
    return Math.round((((value * 2 / 300000000) - 3) / 100) * 10000) / 10000;
  }

  // 취득세(지방세법 — 부동산) — Code.js toolCalculateAcquisitionTax와 동일 로직.
  window.calculateAcquisitionTaxJS = function (p) {
    p = p || {};
    const acquisitionType = p.acquisitionType;
    if (['inheritance', 'gift', 'original', 'division', 'divorce_division', 'paid'].indexOf(acquisitionType) === -1) {
      return { error: 'acquisitionType을 inheritance/gift/original/division/divorce_division/paid 중에서 선택하세요.' };
    }
    const propertyType = p.propertyType;
    if (['house', 'farmland', 'other'].indexOf(propertyType) === -1) {
      return { error: 'propertyType을 house/farmland/other 중에서 선택하세요.' };
    }
    const acquisitionValue = Number(p.acquisitionValue);
    if (!(acquisitionValue >= 0)) return { error: 'acquisitionValue(취득세 과세표준, 취득당시가액)가 필요합니다.' };

    if (acquisitionValue <= 500000) {
      return { 적용세율: 0, 산출세액: 0, 안내: '§17①(면세점) — 취득가액이 50만원 이하여서 취득세를 부과하지 않습니다.' };
    }

    let rate, basis;
    if (acquisitionType === 'inheritance') {
      if (propertyType === 'house' && p.isOneHouseholdOneHouseInheritance) {
        rate = 0.008; basis = '§15①2호가목·시행령§29(1가구1주택자 상속) — 0.8%(§11①1호나목 2.8%에서 중과기준세율 2%를 뺀 세율)';
      } else if (propertyType === 'farmland') {
        rate = 0.023; basis = '§11①1호가목(상속, 농지) 2.3%';
      } else {
        rate = 0.028; basis = '§11①1호나목(상속, 농지외) 2.8%';
      }
    } else if (acquisitionType === 'divorce_division') {
      rate = 0.015; basis = '§15①6호(이혼에 따른 재산분할) — §11①2호 무상취득세율(3.5%)에서 중과기준세율(2%)을 뺀 1.5%';
    } else if (acquisitionType === 'gift') {
      if (propertyType === 'house' && p.isAdjustedAreaHighValueGift && !p.isExemptSpouseOrLinealGift) {
        rate = 0.12; basis = '§13의2②·시행령§28의6①(조정대상지역 내 시가표준액 3억원 이상 주택 무상취득 중과) — 4%+8%=12%';
      } else {
        rate = 0.035; basis = '§11①2호(무상취득, 상속외) 3.5%';
      }
    } else if (acquisitionType === 'original') {
      rate = 0.028; basis = '§11①3호(원시취득) 2.8%';
    } else if (acquisitionType === 'division') {
      rate = 0.023; basis = '§11①5호·6호(공유물·합유물 분할) 2.3%';
    } else { // paid
      if (propertyType === 'farmland') {
        rate = 0.03; basis = '§11①7호가목(유상취득, 농지) 3.0%';
      } else if (propertyType === 'other') {
        rate = 0.04; basis = '§11①7호나목(유상취득, 농지외) 4.0%';
      } else if (p.isCorporation) {
        rate = 0.12; basis = '§13의2①1호(법인의 주택 유상취득) — 4%+8%=12%';
      } else if (p.isTemporaryTwoHouse) {
        rate = acquisitionTaxHouseSlidingRate_(acquisitionValue); basis = '시행령§28의5(일시적 2주택, 중과 제외) — §11①8호 일반 세율 ' + (rate * 100) + '%';
      } else if (p.isLowValueExemptHousing) {
        rate = acquisitionTaxHouseSlidingRate_(acquisitionValue); basis = '시행령§28의2 1호(저가주택, 중과 제외) — §11①8호 일반 세율 ' + (rate * 100) + '%';
      } else {
        const n = Number(p.houseCountIncludingThis) || 1;
        const adj = !!p.isAdjustedArea;
        if (n <= 1) {
          rate = acquisitionTaxHouseSlidingRate_(acquisitionValue); basis = '§11①8호(1주택, 유상취득) sliding 세율 ' + (rate * 100) + '%';
        } else if (n === 2) {
          if (adj) { rate = 0.08; basis = '§13의2①2호(1세대2주택, 조정대상지역) — 4%+4%=8%'; }
          else { rate = acquisitionTaxHouseSlidingRate_(acquisitionValue); basis = '1세대2주택, 비조정대상지역 — 중과 없음, §11①8호 sliding 세율 ' + (rate * 100) + '%'; }
        } else if (n === 3) {
          if (adj) { rate = 0.12; basis = '§13의2①3호(1세대3주택이상, 조정대상지역) — 4%+8%=12%'; }
          else { rate = 0.08; basis = '§13의2①2호(1세대3주택, 비조정대상지역) — 4%+4%=8%'; }
        } else {
          rate = 0.12; basis = '§13의2①3호(1세대4주택이상, 또는 조정대상지역 3주택이상) — 4%+8%=12%';
        }
      }
    }

    const luxuryFlags = [];
    if (p.isLuxuryHouse) luxuryFlags.push('고급주택(§13⑤3호)');
    if (p.isGolfCourse) luxuryFlags.push('골프장(§13⑤2호)');
    if (p.isLuxuryEntertainmentVenue) luxuryFlags.push('고급오락장(§13⑤4호)');
    if (p.isLuxuryVessel) luxuryFlags.push('고급선박(§13⑤5호)');
    let luxuryNote = '';
    if (luxuryFlags.length > 0) {
      rate = rate + 0.08;
      luxuryNote = ' §13⑤·§13의2③(사치성재산: ' + luxuryFlags.join(', ') + ') — 위 세율에 중과기준세율(2%)의 100분의 400인 8%p를 가산했습니다.';
    }

    const tax = Math.round(acquisitionValue * rate);
    return {
      적용세율: Math.round(rate * 100000) / 1000, 적용근거: basis + luxuryNote,
      과세표준: acquisitionValue, 산출세액: tax,
      안내: '이 세액은 취득세 본세만 계산한 것입니다. 지방교육세(취득세액의 일부, 세율은 별도)와 농어촌특별세(전용면적 85㎡ 초과 주택 등 일부 과세대상)는 이 도구에 포함되지 않으며, 관련 법령 파일(지방교육세법·농어촌특별세법)이 확보되면 별도 반영될 예정입니다. 지방자치단체 조례로 세율의 100분의 50 범위에서 가감될 수 있고(§14), 취득 후 5년 이내 사업용도 변경·다주택 요건 미충족 등이 발생하면 추징될 수 있습니다(§16) — 이 도구는 이런 사실판단·사후관리는 반영하지 않습니다.'
    };
  };

  // 등록면허세(지방세법 — 부동산 등기분) — Code.js toolCalculateRegistrationLicenseTax와 동일 로직.
  window.calculateRegistrationLicenseTaxJS = function (p) {
    p = p || {};
    const type = p.registrationType;
    const validTypes = ['ownership_preservation', 'ownership_transfer_paid', 'ownership_transfer_free', 'ownership_transfer_inheritance', 'superficies', 'mortgage', 'easement', 'chonsegwon', 'lease_right', 'auction_or_provisional', 'other'];
    if (validTypes.indexOf(type) === -1) return { error: 'registrationType을 ' + validTypes.join('/') + ' 중에서 선택하세요.' };

    if (type === 'other') {
      return { 산출세액: 6000, 적용근거: '§28①1호마목(그 밖의 등기) — 건당 6,000원', 안내: '이 도구는 등록면허세 본세만 계산합니다. 지방교육세는 포함되지 않습니다.' };
    }

    const isOwnershipType = ['ownership_preservation', 'ownership_transfer_paid', 'ownership_transfer_free', 'ownership_transfer_inheritance'].indexOf(type) !== -1;
    if (isOwnershipType && !p.isAcquisitionTaxExemptCase) {
      return {
        적용여부: false,
        안내: '§23 1호 본문 — 취득을 원인으로 하는 등기(일반적인 매매·증여·상속으로 인한 소유권보존·이전등기)는 취득세만 부과되고 등록면허세는 부과되지 않습니다. calculate_acquisition_tax 도구로 취득세를 계산하세요. 이 소유권보존·이전등기 세율은 §23 1호 각 목의 예외(광업권등 취득등록, 외국인소유물건 연부취득등기, 취득세 부과제척기간이 지난 물건의 등기, §17 면세점 물건의 등기)에 해당하는 경우에만 적용되므로, 그 경우라면 isAcquisitionTaxExemptCase를 true로 넣어 다시 호출하세요.'
      };
    }

    const baseAmount = Number(p.baseAmount);
    if (!(baseAmount >= 0)) return { error: 'baseAmount(과세표준 — 유형별 부동산가액·채권금액·요역지가액·전세금액·월임대차금액)가 필요합니다.' };

    let rate, basis;
    if (type === 'ownership_preservation') {
      rate = 0.008; basis = '§28①1호가목(소유권보존등기) 0.8%';
    } else if (type === 'ownership_transfer_paid') {
      if (p.isHouseAcquisition && Number(p.houseAcquisitionTaxRate) > 0) {
        rate = Number(p.houseAcquisitionTaxRate) * 0.5;
        basis = '§28①1호나목1)단서(취득세§11①8호 적용 주택) — 해당 주택 취득세율(' + (Number(p.houseAcquisitionTaxRate) * 100) + '%)의 50%';
      } else {
        rate = 0.02; basis = '§28①1호나목1)본문(유상 소유권이전등기) 2.0%';
      }
    } else if (type === 'ownership_transfer_free') {
      rate = 0.015; basis = '§28①1호나목2)본문(무상 소유권이전등기, 상속외) 1.5%';
    } else if (type === 'ownership_transfer_inheritance') {
      rate = 0.008; basis = '§28①1호나목2)단서(상속으로 인한 소유권이전등기) 0.8%';
    } else if (type === 'superficies') {
      rate = 0.002; basis = '§28①1호다목1)(지상권) 0.2%';
    } else if (type === 'mortgage') {
      rate = 0.002; basis = '§28①1호다목2)(저당권, 지상권·전세권 목적 등기 포함) 0.2%';
    } else if (type === 'easement') {
      rate = 0.002; basis = '§28①1호다목3)(지역권) 0.2%';
    } else if (type === 'chonsegwon') {
      rate = 0.002; basis = '§28①1호다목4)(전세권) 0.2%';
    } else if (type === 'lease_right') {
      rate = 0.002; basis = '§28①1호다목5)(임차권, 월 임대차금액 기준) 0.2%';
    } else { // auction_or_provisional
      rate = 0.002; basis = '§28①1호라목(경매신청·가압류·가처분·가등기) 0.2%';
    }

    let tax = Math.round(baseAmount * rate);
    let minApplied = false;
    if (tax < 6000) { tax = 6000; minApplied = true; }

    return {
      과세표준: baseAmount, 적용세율: Math.round(rate * 100000) / 1000, 산출세액: tax,
      적용근거: basis + (minApplied ? ' (§28①단서 — 산출세액이 그 밖의 등기 세율인 건당 6,000원보다 적어 6,000원을 적용)' : ''),
      안내: '이 세액은 등록면허세 본세만 계산한 것입니다. 지방교육세(등록면허세액의 20%가 원칙, 법인등기분은 별도 세율)는 이 도구에 포함되지 않으며, 관련 법령 파일(지방교육세법)이 확보되면 별도 반영될 예정입니다.'
    };
  };

  const PROPERTY_TAX_LAND_COMPREHENSIVE_BRACKETS_ = [
    { max: 50000000, rate: 0.002, deduction: 0 },
    { max: 100000000, rate: 0.003, deduction: 50000 },
    { max: Infinity, rate: 0.005, deduction: 250000 }
  ];
  const PROPERTY_TAX_LAND_SEPARATE_BRACKETS_ = [
    { max: 200000000, rate: 0.002, deduction: 0 },
    { max: 1000000000, rate: 0.003, deduction: 200000 },
    { max: Infinity, rate: 0.004, deduction: 1200000 }
  ];
  const PROPERTY_TAX_HOUSE_GENERAL_BRACKETS_ = [
    { max: 60000000, rate: 0.001, deduction: 0 },
    { max: 150000000, rate: 0.0015, deduction: 30000 },
    { max: 300000000, rate: 0.0025, deduction: 180000 },
    { max: Infinity, rate: 0.004, deduction: 630000 }
  ];
  const PROPERTY_TAX_HOUSE_ONE_BRACKETS_ = [
    { max: 60000000, rate: 0.0005, deduction: 0 },
    { max: 150000000, rate: 0.001, deduction: 30000 },
    { max: 300000000, rate: 0.002, deduction: 180000 },
    { max: Infinity, rate: 0.0035, deduction: 630000 }
  ];

  // 재산세(지방세법) — Code.js toolCalculatePropertyTax와 동일 로직.
  window.calculatePropertyTaxJS = function (p) {
    p = p || {};
    const category = p.propertyCategory;
    const validCategories = ['house', 'land_comprehensive', 'land_separate', 'land_farmland_forest', 'land_golf_luxury', 'land_other_separate', 'building_general', 'building_factory_special', 'building_luxury', 'ship_general', 'ship_luxury', 'aircraft'];
    if (validCategories.indexOf(category) === -1) return { error: 'propertyCategory를 ' + validCategories.join('/') + ' 중에서 선택하세요.' };
    const standardPriceValue = Number(p.standardPriceValue);
    if (!(standardPriceValue > 0)) return { error: 'standardPriceValue(재산세 과세기준일 현재 시가표준액)가 필요합니다.' };

    const isShipOrAircraft = (category === 'ship_general' || category === 'ship_luxury' || category === 'aircraft');
    let taxBase, ratioNote;
    if (isShipOrAircraft) {
      taxBase = standardPriceValue; ratioNote = '§110②(선박·항공기는 시가표준액 자체가 과세표준)';
    } else if (category === 'house') {
      const isOneHouseEligible = !!p.isOneHouseholdOneHouse && standardPriceValue <= 900000000;
      let ratio;
      if (isOneHouseEligible) {
        ratio = standardPriceValue <= 300000000 ? 0.43 : (standardPriceValue <= 600000000 ? 0.44 : 0.45);
        ratioNote = '시행령§109①2호단서(2026년도 1세대1주택 특례, 시가표준액 9억원이하) — 공정시장가액비율 ' + (ratio * 100) + '%';
      } else {
        ratio = 0.60; ratioNote = '시행령§109①2호본문 — 공정시장가액비율 60%';
      }
      taxBase = Math.round(standardPriceValue * ratio);
    } else {
      taxBase = Math.round(standardPriceValue * 0.70); ratioNote = '시행령§109①1호(토지·건축물) — 공정시장가액비율 70%';
    }

    let tax, basis;
    if (category === 'land_comprehensive') {
      tax = progressiveTax(taxBase, PROPERTY_TAX_LAND_COMPREHENSIVE_BRACKETS_); basis = '§111①1호가목(토지 종합합산과세대상) 누진세율(0.2%~0.5%)';
    } else if (category === 'land_separate') {
      tax = progressiveTax(taxBase, PROPERTY_TAX_LAND_SEPARATE_BRACKETS_); basis = '§111①1호나목(토지 별도합산과세대상) 누진세율(0.2%~0.4%)';
    } else if (category === 'land_farmland_forest') {
      tax = Math.round(taxBase * 0.0007); basis = '§111①1호다목1)(분리과세 전ㆍ답ㆍ과수원ㆍ목장용지 및 임야) 0.07%';
    } else if (category === 'land_golf_luxury') {
      tax = Math.round(taxBase * 0.04); basis = '§111①1호다목2)(분리과세 골프장ㆍ고급오락장용 토지) 4%';
    } else if (category === 'land_other_separate') {
      tax = Math.round(taxBase * 0.002); basis = '§111①1호다목3)(분리과세 그 밖의 토지) 0.2%';
    } else if (category === 'building_factory_special') {
      tax = Math.round(taxBase * 0.005); basis = '§111①2호나목(특별시등 주거지역내 특정 공장용건축물) 0.5%';
    } else if (category === 'building_luxury') {
      tax = Math.round(taxBase * 0.04); basis = '§111①2호가목(골프장ㆍ고급오락장용 건축물) 4%';
    } else if (category === 'building_general') {
      tax = Math.round(taxBase * 0.0025); basis = '§111①2호다목(그 밖의 건축물) 0.25%';
    } else if (category === 'ship_luxury') {
      tax = Math.round(taxBase * 0.05); basis = '§111①4호가목(고급선박) 5%';
    } else if (category === 'ship_general') {
      tax = Math.round(taxBase * 0.003); basis = '§111①4호나목(그 밖의 선박) 0.3%';
    } else if (category === 'aircraft') {
      tax = Math.round(taxBase * 0.003); basis = '§111①5호(항공기) 0.3%';
    } else { // house
      const isOneHouseEligible = !!p.isOneHouseholdOneHouse && standardPriceValue <= 900000000;
      if (isOneHouseEligible) {
        tax = progressiveTax(taxBase, PROPERTY_TAX_HOUSE_ONE_BRACKETS_); basis = '§111의2①(1세대1주택 경감세율) 누진세율(0.05%~0.35%)';
      } else {
        tax = progressiveTax(taxBase, PROPERTY_TAX_HOUSE_GENERAL_BRACKETS_); basis = '§111①3호나목(그 밖의 주택) 누진세율(0.1%~0.4%)';
      }
    }

    let capNote = '';
    if (category !== 'house' && Number(p.priorYearTaxAmount) > 0) {
      const cap = Math.round(Number(p.priorYearTaxAmount) * 1.5);
      if (tax > cap) {
        capNote = ' §122(세부담상한) — 직전연도세액(' + p.priorYearTaxAmount + '원)의 150%인 ' + cap + '원을 초과해 ' + cap + '원으로 감액했습니다.';
        tax = cap;
      }
    }

    return {
      시가표준액: standardPriceValue, 과세표준: taxBase, 산출세액: tax,
      적용근거: ratioNote + ' / ' + basis + capNote,
      안내: '이 세액은 재산세 본세만 계산한 것입니다. 재산세 도시지역분(§112, 지방의회 의결로 고시한 지역에서 조례에 따라 과세표준×최대 0.23%를 추가 부과할 수 있음)과 지방교육세는 이 도구에 포함되지 않으며, 관련 법령 파일이 확보되면 별도 반영될 예정입니다. 토지가 종합합산·별도합산·분리과세 중 어디에 해당하는지는 실제 이용현황에 대한 사실판단이 필요하므로(§106①) 그 판정 자체는 이 도구가 대신하지 않습니다.'
    };
  };

  // 시가 인정범위 판정 (상증세법§60②, 시행령§49) — Code.js toolCalculateFairMarketValueRecognitionGate와 동일 로직.
  window.checkFairMarketValueRecognitionJS = function (p) {
    p = p || {};
    const taxType = ['inheritance', 'gift', 'transfer'].indexOf(p.taxType) !== -1 ? p.taxType : null;
    if (!taxType) return { error: 'taxType을 inheritance(상속)/gift(증여)/transfer(양도소득세 부당행위계산) 중에서 선택하세요.' };
    if (!p.valuationBaseDate) return { error: '평가기준일(상속개시일·증여일, 또는 양도소득세의 경우 양도일이나 취득일)이 필요합니다.' };
    const evidenceType = p.evidenceType;
    if (['sale', 'appraisal', 'expropriation_auction_public_sale'].indexOf(evidenceType) === -1) {
      return { error: '증거유형을 매매/감정/수용·경매·공매 중에서 선택하세요.' };
    }
    if (!p.evidenceDate) return { error: '증거일(매매계약일, 가격산정기준일·감정평가서작성일, 또는 보상가액·경매가액·공매가액 결정일)이 필요합니다.' };

    const baseDate = new Date(p.valuationBaseDate + 'T00:00:00');
    const evidDate = new Date(p.evidenceDate + 'T00:00:00');
    if (isNaN(baseDate.getTime()) || isNaN(evidDate.getTime())) return { error: '날짜 형식이 올바르지 않습니다(YYYY-MM-DD).' };

    const periodStart = new Date(baseDate.getTime());
    const periodEnd = new Date(baseDate.getTime());
    if (taxType === 'transfer') {
      periodStart.setMonth(periodStart.getMonth() - 3);
      periodEnd.setMonth(periodEnd.getMonth() + 3);
    } else {
      periodStart.setMonth(periodStart.getMonth() - 6);
      periodEnd.setMonth(periodEnd.getMonth() + (taxType === 'gift' ? 3 : 6));
    }
    const withinPeriod = evidDate >= periodStart && evidDate <= periodEnd;
    const fmt = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

    const gates = [];
    let recognized = withinPeriod;
    const periodNote = withinPeriod
      ? '평가기간(' + fmt(periodStart) + '~' + fmt(periodEnd) + ') 이내입니다.'
      : '평가기간(' + fmt(periodStart) + '~' + fmt(periodEnd) + ')을 벗어났습니다. 평가기준일 전 2년 이내이거나 평가기간 경과 후 신고기한까지의 매매등이라면, 가격변동의 특별한 사정이 없다는 전제로 평가심의위원회 심의를 신청해 인정받을 수 있습니다(시행령§49①단서) — 이 계산기는 그 심의결과를 판정하지 않습니다.';

    if (evidenceType === 'sale') {
      if (p.isRelatedPartyTransaction) {
        recognized = false;
        gates.push({ 항목: '특수관계인 거래', 통과: false, 사유: '특수관계인과의 거래로 거래가액이 객관적으로 부당하다고 인정되면 시가에서 제외됩니다(시행령§49①1호가목).' });
      } else {
        gates.push({ 항목: '특수관계인 거래', 통과: true });
      }
    }

    if ((evidenceType === 'sale' || evidenceType === 'expropriation_auction_public_sale') && p.isUnlistedStock) {
      const tradedFaceValue = Number(p.tradedStockFaceValueSum) || 0;
      const totalFaceValue = Number(p.totalIssuedStockFaceValue) || 0;
      const threshold = Math.min(totalFaceValue * 0.01, 300000000);
      const meets = tradedFaceValue >= threshold;
      if (!meets) recognized = false;
      gates.push({
        항목: '비상장주식 최소거래규모', 통과: meets,
        거래주식액면가액합계: tradedFaceValue, 기준금액: threshold,
        사유: meets ? undefined : ('거래(취득)된 비상장주식의 액면가액 합계가 발행주식총액의 1%와 3억원 중 적은 금액(' + threshold + '원) 미만이면 원칙적으로 시가로 인정되지 않습니다(시행령§49①1호나목·3호나목). 다만 평가심의위원회 심의를 거쳐 거래관행상 정당한 사유가 인정되면 예외적으로 인정될 수 있습니다.')
      });
    }

    if (evidenceType === 'appraisal') {
      const appraisalAvg = Number(p.appraisalValueAverage) || 0;
      if (!appraisalAvg) return { error: '감정가액 평균이 필요합니다.' };
      const supplementaryValue = Number(p.supplementaryValue) || 0;
      const similar90 = (p.similarAssetMarketValue90pct != null && p.similarAssetMarketValue90pct !== '') ? Number(p.similarAssetMarketValue90pct) : null;
      const candidates = [supplementaryValue > 0 ? supplementaryValue : Infinity, (similar90 != null && similar90 > 0) ? similar90 : Infinity];
      const thresholdBase = Math.min.apply(null, candidates);
      const hasThreshold = Number.isFinite(thresholdBase);
      const meets = !hasThreshold || appraisalAvg >= thresholdBase;
      if (!meets) recognized = false;
      gates.push({
        항목: '감정가액 기준금액', 통과: meets,
        감정가액평균: appraisalAvg, 기준금액: hasThreshold ? thresholdBase : null,
        사유: meets ? undefined : ('감정가액평균이 보충적평가액(§61·62·64·65)과 유사재산시가의 90% 중 적은 금액(기준금액, ' + thresholdBase + '원)에 미달합니다(시행령§49①2호 — 이 조항은 상장주식(§63①1호가목)·가상자산(§65②)에는 적용되지 않습니다). 세무서장등이 다른 감정기관에 재감정을 의뢰할 수 있으며, 그 재감정가액보다 납세자가 제시한 감정가액이 낮으면 원래 감정가액이 그대로 인정됩니다.')
      });
    }

    return {
      시가인정여부: recognized, 평가기간이내여부: withinPeriod,
      평가기간_시작: fmt(periodStart), 평가기간_종료: fmt(periodEnd),
      게이트별_판정: gates,
      안내: periodNote + (recognized ? '' : ' 위 게이트 중 하나라도 통과하지 못하면 이 증거가액은 §60②의 시가로 인정되지 않으므로, 다른 시가 증거를 찾거나 §61~65의 보충적 평가방법을 사용해야 합니다.')
    };
  };

  // 양도소득의 부당행위계산 — 특수관계인 간 시가재계산 (소득세법§101①, 시행령§167③④⑤) — Code.js
  // toolCalculateTransferRelatedPartyPriceAdjustment와 동일 로직.
  window.calculateTransferRelatedPartyPriceAdjustmentJS = function (p) {
    p = p || {};
    if (!p.isRelatedPartyTransaction) {
      return { 시가재계산적용여부: false, 안내: '특수관계인 간 거래가 아니므로 소득세법§101①(양도소득의 부당행위계산)이 적용되지 않습니다.' };
    }
    const role = p.transactionRole;
    if (['sale', 'purchase'].indexOf(role) === -1) {
      return { error: 'transactionRole을 sale(특수관계인에게 양도)/purchase(특수관계인으로부터 매입) 중에서 선택하세요.' };
    }
    const actualPrice = Number(p.actualPrice);
    const marketValue = Number(p.marketValue);
    if (!(actualPrice >= 0)) return { error: '실제 거래가액이 필요합니다.' };
    if (!(marketValue > 0)) return { error: '시가가 필요합니다.' };

    const diff = Math.abs(marketValue - actualPrice);
    const threshold = Math.min(300000000, Math.round(marketValue * 0.05));
    const meetsGate = diff >= threshold;
    const directionOk = (role === 'sale' && actualPrice < marketValue) || (role === 'purchase' && actualPrice > marketValue);

    if (!directionOk) {
      return {
        시가재계산적용여부: false, 시가와거래가액의차액: diff, 차감기준액: threshold,
        안내: role === 'sale'
          ? '실제 거래가액이 시가보다 낮지 않아(즉 저가양도가 아니어서) §101①이 적용되지 않습니다.'
          : '실제 거래가액이 시가보다 높지 않아(즉 고가매입이 아니어서) §101①이 적용되지 않습니다.'
      };
    }

    if (!meetsGate) {
      return {
        시가재계산적용여부: false, 시가와거래가액의차액: diff, 차감기준액: threshold,
        안내: '시가와 거래가액의 차액(' + diff + '원)이 기준금액(시가의 5%와 3억원 중 적은 금액, ' + threshold + '원) 미만이어서 §101①(시행령§167③단서)에 따라 부당행위계산부인 대상이 아닙니다.'
      };
    }

    return {
      시가재계산적용여부: true, 시가와거래가액의차액: diff, 차감기준액: threshold,
      실제거래가액: actualPrice, 시가: marketValue, 재계산가액: marketValue,
      안내: (role === 'sale'
        ? '시행령§167④에 따라 이번 거래의 양도가액을 실제 거래가액(' + actualPrice + '원) 대신 시가(' + marketValue + '원)로 계산해 양도차익을 산정하세요(위 일반 양도세 계산기의 양도가액에 이 시가를 넣을 것).'
        : '시행령§167④에 따라 이 자산을 나중에 다시 양도할 때 취득가액을 실제 지급액(' + actualPrice + '원) 대신 시가(' + marketValue + '원)로 계산해야 합니다(장래 재양도시 취득가액에 이 시가를 넣을 것 — 지금 당장 세액이 발생하는 것이 아니라 장래 취득가액이 조정되는 것입니다).')
        + ' 시가는 위 "시가 인정범위 판정" 계산기를 taxType=\'transfer\'로 먼저 확인해서 확정하세요.'
    };
  };

  // 저가양수·고가양도에 따른 이익의 증여의제 (상증세법 §35) — Code.js toolCalculateLowPriceTransferGiftAmount와 동일 로직.
  window.calculateLowPriceTransferGiftAmountJS = function (p) {
    p = p || {};
    const fairMarketValue = Number(p.fairMarketValue);
    const transferPrice = Number(p.transferPrice);
    if (!fairMarketValue || fairMarketValue <= 0) return { error: '시가가 필요합니다.' };
    if (!(transferPrice >= 0)) return { error: '실제 거래한 대가가 필요합니다.' };
    const isSpecialRelation = (p.isSpecialRelation !== false);

    const diff = Math.abs(fairMarketValue - transferPrice);
    const direction = transferPrice < fairMarketValue ? '저가양수(매수인이 이익을 얻음)' : (transferPrice > fairMarketValue ? '고가양도(매도인이 이익을 얻음)' : '차액없음');

    if (isSpecialRelation) {
      // §35①·시행령§26② — 기준금액(게이트=차감액) = min(시가×30%, 3억원). "이상"(경계값 포함).
      const threshold = Math.min(Math.round(fairMarketValue * 0.3), 300000000);
      const meetsGate = diff >= threshold;

      if (!meetsGate) {
        return {
          과세대상여부: false, 거래유형: direction, 특수관계여부: '특수관계인 간(§35①)',
          시가와대가의차액: diff, 차감기준액: threshold, 증여재산가액: 0,
          안내: '특수관계인 간 거래 기준으로, 차액이 차감기준액(min(시가×30%, 3억원))을 초과하지 않아 과세대상이 아닙니다.'
        };
      }

      const deemedGiftAmount = diff - threshold;
      return {
        과세대상여부: true, 거래유형: direction, 특수관계여부: '특수관계인 간(§35①)',
        시가와대가의차액: diff, 차감기준액: threshold, 증여재산가액: deemedGiftAmount,
        안내: '이 증여재산가액을 계산기 상단의 giftAmount에 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요.'
      };
    }

    // §35②·시행령§26③④ — 비특수관계인 간: 게이트=시가×30%(3억 상한 없음), 차감액은 3억원 정액.
    const gateThreshold = Math.round(fairMarketValue * 0.3);
    const meetsGate = diff >= gateThreshold;

    if (!meetsGate) {
      return {
        과세대상여부: false, 거래유형: direction, 특수관계여부: '비특수관계인 간(§35②)',
        시가와대가의차액: diff, 차감기준액_게이트: gateThreshold, 증여재산가액: 0,
        안내: '비특수관계인 간 거래 기준으로, 차액이 게이트 기준금액(시가×30%)을 초과하지 않아 과세대상이 아닙니다.'
      };
    }

    const FLAT_DEDUCTION = 300000000;
    const deemedGiftAmount = Math.max(0, diff - FLAT_DEDUCTION);
    return {
      과세대상여부: deemedGiftAmount > 0, 거래유형: direction, 특수관계여부: '비특수관계인 간(§35②)',
      시가와대가의차액: diff, 차감기준액_게이트: gateThreshold, 차감액_공제: FLAT_DEDUCTION, 증여재산가액: deemedGiftAmount,
      안내: (deemedGiftAmount > 0
        ? '이 증여재산가액을 계산기 상단의 giftAmount에 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요.'
        : '게이트(시가×30%)는 넘었지만 정액 차감액(3억원)을 빼면 0 이하가 되어 실제 과세대상은 아닙니다.')
        + ' "거래의 관행상 정당한 사유" 유무는 개별 사실관계로 별도 판단해야 합니다.'
    };
  };

  // 증여세 과세특례 — 조문 중복적용 배제 (상증세법 §43①) — Code.js toolCalculateGiftSpecialProvisionOverlap와 동일 로직.
  window.calculateGiftSpecialProvisionOverlapJS = function (p) {
    p = p || {};
    const candidates = Array.isArray(p.candidates) ? p.candidates : [];
    if (candidates.length < 2) return { error: '동시에 적용 검토 중인 조문의 계산결과를 2건 이상 넣어야 합니다.' };

    const parsed = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const giftAmount = Number(c && c.giftAmount);
      if (!(giftAmount >= 0)) return { error: 'candidates[' + i + '].giftAmount이 0 이상의 숫자가 아닙니다.' };
      parsed.push({ article: String((c && c.article) || ('후보' + (i + 1))), giftAmount: giftAmount });
    }

    let winner = parsed[0];
    for (let i = 1; i < parsed.length; i++) { if (parsed[i].giftAmount > winner.giftAmount) winner = parsed[i]; }
    const excluded = parsed.filter(function (c) { return c !== winner; });

    return {
      적용조문: winner.article, 적용증여재산가액: winner.giftAmount,
      배제된조문: excluded.map(function (c) { return { article: c.article, giftAmount: c.giftAmount }; }),
      안내: '§43①에 따라 이익이 가장 많은 것(' + winner.article + ', ' + winner.giftAmount + '원) 하나만 적용하고 나머지(' +
        excluded.map(function (c) { return c.article; }).join(', ') + ')는 적용하지 않습니다. 적용조문의 증여재산가액만 계산기 상단의 giftAmount에 넣어 세액을 계산하세요.'
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
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 동일한 대출등이 더 있으면 각 이익을 합산해 게이트를 계산.
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggDeemedGiftAmount = deemedGiftAmount + priorBenefitSum;
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전 대출등의 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    const meetsGate = aggDeemedGiftAmount >= 10000000;

    if (!meetsGate) {
      return {
        과세대상여부: false, 적정이자상당액: appropriateInterestAmount, 실제지급이자: actualInterestPaid,
        이번거래이익: deemedGiftAmount, 직전1년합산액: priorBenefitSum, 증여재산가액: 0,
        안내: '계산된 이익(' + aggDeemedGiftAmount + '원' + aggNote + ')이 1천만원(연간 기준) 미만이어서 과세대상이 아닙니다.'
      };
    }

    return {
      과세대상여부: true, 적정이자상당액: appropriateInterestAmount, 실제지급이자: actualInterestPaid,
      이번거래이익: deemedGiftAmount, 직전1년합산액: priorBenefitSum, 증여재산가액: aggDeemedGiftAmount,
      안내: '대출기간이 1년을 초과하면 매년 다시 계산해야 합니다. 특수관계인이 아닌 자 간의 거래는 거래관행상 정당한 사유가 없는 경우에만 적용됩니다(§41의4③). 이 증여재산가액을 계산기 상단의 giftAmount에 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요.' + aggNote
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
      // §104①11호가목1) — 30% 세율은 "1년 미만 보유한 주식등으로서 중소기업 외의 법인의 주식등"에만
      // 적용된다. 중소기업 주식은 1년 미만 보유해도 2)호(누진표)를 적용한다.
      if (isDaejuju && !isSmallMediumCompany && Number.isFinite(holdingMonths) && holdingMonths < 12) {
        calculatedTax = Math.round(taxBase * 0.30);
        rateNote = '대주주, 중소기업 외 법인, 1년 미만 보유 — 30% 단일세율';
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
    } else if (assetCategory === 'other_asset' && p.isMajorityNonBusinessLandCorp) {
      // 소득세법§104①9호(시행령§167조의7) — §94①4호다목·라목 주식등 중, 그 법인 자산총액에서
      // 법인세법§55조의2②에 따른 비사업용토지가 차지하는 비율이 50% 이상인 법인의 주식등은
      // 8호(비사업용토지) 세율표와 동일하게 기본세율에 10%p를 가산한다.
      calculatedTax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS) + Math.round(taxBase * 0.10);
      rateNote = '기타자산 중 비사업용토지 과다보유법인 주식등(§104①9호) — 기본세율(누진 6~45%)+10%p 가산';
    } else {
      calculatedTax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS);
      rateNote = '기타자산(특정주식·부동산과다보유법인 주식등) — 기본세율(누진 6~45%)';
    }

    const foreignTaxCredit = Math.min(Number(p.foreignTaxPaidAmount) || 0, calculatedTax);
    const taxAfterCredit = Math.max(0, calculatedTax - foreignTaxCredit);

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);

    // 주식등에 대한 장부의 비치·기록의무 및 기장불성실가산세 (소득세법§115) — 법인의 대주주가 양도하는
    // 주식등에 대해 거래명세 등을 기장하지 않았거나 누락한 경우, (누락소득금액/양도소득금액)×산출세액×10%를
    // 가산한다. 다만 산출세액이 없으면 그 거래금액의 1만분의 7을 가산세로 한다.
    let bookkeepingPenalty = 0;
    const unrecordedIncomeAmount = Math.max(0, Number(p.unrecordedIncomeAmount) || 0);
    if (assetCategory === 'domestic_stock' && p.isDaejuju && unrecordedIncomeAmount > 0) {
      if (calculatedTax > 0 && combinedGain > 0) {
        bookkeepingPenalty = Math.round((Math.min(unrecordedIncomeAmount, combinedGain) / combinedGain) * calculatedTax * 0.10);
      } else {
        const transactionAmountForPenalty = Math.max(0, Number(p.transactionAmountForBookkeepingPenalty) || 0);
        bookkeepingPenalty = Math.round(transactionAmountForPenalty * 0.0007);
      }
    }

    const localIncomeTax = Math.round(taxAfterCredit * 0.1);
    const totalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + bookkeepingPenalty + localIncomeTax);

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
      기장불성실가산세: bookkeepingPenalty,
      지방소득세: localIncomeTax,
      납부세액_합계: totalTax
    };
  };

  // 주식등 이월과세 (소득세법§97의2①, §94①3호 자산은 1년 이내 양도시 적용) — 부동산용
  // calculateTransferTaxWithCarryoverJS와 같은 원리이나 기간요건이 1년이고, 1세대1주택 비과세 배제·
  // 수용특례는 주식에 해당사항이 없어 적용하지 않는다.
  window.calculateStockTransferTaxWithCarryoverJS = function (p) {
    p = p || {};
    const giftReceivedDate = p.giftReceivedDate;
    const donorRelation = p.donorRelation;
    const isEligibleRelation = donorRelation === 'spouse' || donorRelation === 'lineal';
    const yearsSinceGift = (giftReceivedDate && p.transferDate) ? fullYearsElapsed(giftReceivedDate, p.transferDate) : Infinity;
    const isWithinWindow = yearsSinceGift < 1 || (yearsSinceGift === 1 && giftReceivedDate === p.transferDate);

    const withoutCarryoverParams = Object.assign({}, p, {
      acquisitionPrice: Number(p.doneeOwnAcquisitionPrice) || 0
    });
    const withoutResult = window.calculateStockTransferTaxJS(withoutCarryoverParams);

    if (!isEligibleRelation || !isWithinWindow) {
      if (withoutResult && !withoutResult.error) {
        withoutResult.이월과세_적용여부 = false;
        withoutResult.이월과세_미적용사유 = !isEligibleRelation ? '배우자·직계존비속으로부터의 증여가 아님' : '증여일로부터 1년 경과(§94①3호 주식등, §97의2①)';
      }
      return withoutResult;
    }

    const donorAcqPrice = Number(p.donorAcquisitionPrice) || 0;
    const giftTaxPaid = Number(p.giftTaxPaid) || 0;
    const giftTaxableValue = Number(p.giftTaxableValue) || 0;
    const assetGiftTaxableValue = Number(p.doneeOwnAcquisitionPrice) || 0;
    const giftTaxEquivalent = giftTaxableValue > 0 ? Math.round(giftTaxPaid * assetGiftTaxableValue / giftTaxableValue) : 0;
    const necessaryExpenseCap = Math.max(0, (Number(p.transferPrice) || 0) - donorAcqPrice);
    const cappedGiftTaxEquivalent = Math.min(giftTaxEquivalent, necessaryExpenseCap);

    const withCarryoverParams = Object.assign({}, p, {
      acquisitionPrice: donorAcqPrice,
      transferExpenses: (Number(p.transferExpenses) || 0) + cappedGiftTaxEquivalent
    });
    const withResult = window.calculateStockTransferTaxJS(withCarryoverParams);

    const withTax = (withResult && typeof withResult.납부세액_합계 === 'number') ? withResult.납부세액_합계 : Infinity;
    const withoutTax = (withoutResult && typeof withoutResult.납부세액_합계 === 'number') ? withoutResult.납부세액_합계 : Infinity;

    const chosen = withTax < withoutTax ? withoutResult : withResult;
    if (chosen && !chosen.error) {
      chosen.이월과세_적용여부 = chosen === withResult;
      if (chosen !== withResult) chosen.이월과세_미적용사유 = '§97의2②3호 — 이월과세를 적용한 세액(' + withTax + '원)이 미적용시 세액(' + withoutTax + '원)보다 적어 미적용';
      chosen.이월과세_비교 = { 적용시_세액: withTax, 미적용시_세액: withoutTax, 증여세상당액_필요경비산입: cappedGiftTaxEquivalent };
    }
    return chosen;
  };

  // 신축주택·미분양주택 취득자 양도소득세 감면(조특법§99,§99의2,§99의3) — 세 조문 모두 취득기간이
  // 정해진 특정 신축주택·미분양주택(§99: 1998.5.22~1999.6.30(국민주택 1999.12.31), §99의2:
  // 2013.4.1~2013.12.31, §99의3: 2001.5.23~2003.6.30)을 취득한 경우, 취득일부터 5년 이내 양도하면
  // 그 기간 발생한 양도소득금액 전액을 과세대상에서 제외하고(§99의2는 형식상 "세액 100% 감면"이지만
  // 결과는 동일), 5년이 지난 후 양도하면 취득일부터 5년간 발생한 양도소득금액만 과세대상에서 뺀다(나머지는
  // 정상 과세). 고가주택(§99,§99의3) 또는 6억원·85㎡ 요건 미충족(§99의2)이면 적용하지 않는다. 취득기간·
  // 지역요건(§99의2③)·감면신청(③) 등 게이트는 이 도구가 검증하지 않으므로 별도로 확인해야 한다.
  window.calculateNewHouseAcquisitionReductionJS = function (p) {
    p = p || {};
    const provision = p.provision;
    if (['sect99', 'sect99_2', 'sect99_3'].indexOf(provision) === -1) {
      return { error: 'provision을 sect99(1998~99년 취득)/sect99_2(2013년 취득)/sect99_3(2001~2003년 취득) 중에서 선택하세요.' };
    }
    if (p.isHighPriceHouseExcluded) {
      return {
        적용여부: false,
        안내: '고가주택(소득세법§89①3호 비과세 제외 대상)에 해당하여 이 감면(조특법' + (provision === 'sect99' ? '§99' : provision === 'sect99_2' ? '§99의2' : '§99의3') + ')을 적용하지 않습니다.'
      };
    }
    if (provision === 'sect99_2' && !p.isPriceOrAreaQualified) {
      return {
        적용여부: false,
        안내: '조특법§99의2는 취득가액 6억원 이하이거나 전용면적 85㎡ 이하인 주택만 적용됩니다(요건 미충족).'
      };
    }
    const acquisitionDate = p.acquisitionDate;
    const transferDate = p.transferDate;
    if (!acquisitionDate || !transferDate) return { error: '취득일과 양도일이 필요합니다.' };
    const acqTime = new Date(acquisitionDate).getTime();
    const trfTime = new Date(transferDate).getTime();
    if (!(trfTime > acqTime)) return { error: '양도일은 취득일 이후여야 합니다.' };
    const yearsHeld = (trfTime - acqTime) / (365.25 * 24 * 3600 * 1000);

    const transferPrice = Number(p.transferPrice) || 0;
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;
    const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;

    let exemptGain, note;
    if (yearsHeld <= 5) {
      exemptGain = totalGain;
      note = provision === 'sect99_2'
        ? '취득일로부터 5년 이내 양도이므로 그 양도소득세 전액(100%)을 감면합니다(조특법§99의2①).'
        : '취득일로부터 5년 이내 양도이므로 취득일부터 양도일까지 발생한 양도소득금액 전액을 과세대상소득금액에서 뺍니다.';
    } else {
      const fy = fiveYearMarkGain(totalGain, acquisitionPrice, {
        acquisitionStandardPrice: p.acquisitionStandardPrice, fiveYearStandardPrice: p.fiveYearStandardPrice, transferStandardPrice: p.transferStandardPrice,
        fiveYearMarkValue: p.fiveYearMarkValue, yearsHeld: yearsHeld
      });
      note = '취득일로부터 5년 초과 보유 후 양도 — ' + fy.note;
      exemptGain = Math.max(0, Math.min(fy.gain, totalGain));
    }
    const taxableGain = Math.max(0, totalGain - exemptGain);
    return {
      적용여부: true,
      보유기간_년: Math.round(yearsHeld * 100) / 100,
      전체양도차익: Math.round(totalGain),
      감면_비과세대상_양도소득금액: Math.round(exemptGain),
      과세대상양도소득금액: taxableGain,
      안내: note + ' 이 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 계산기에서 별도 적용됩니다).'
    };
  };

  // 미분양주택의 취득자에 대한 양도소득세 과세특례 (조특법§98의3,§98의4,§98의5,§98의6,§98의7,§98의8) — §99
  // 계열과 같은 "5년 이내 양도시 감면율만큼 세액감면(=소득금액 전액에 감면율 곱해 제외), 5년 초과 후
  // 양도시 5년간 발생분에 감면율을 곱한 금액만 소득금액에서 차감"구조를 공유하되, 조문별로 감면율이 다르다:
  // §98의3(100%, 수도권과밀억제권역은 60%), §98의5(분양가인하율 10%이하 60%·20%이하 80%·초과 100%),
  // §98의6(50%), §98의7(100%), §98의8(50%, 5년이상 임대 요건이 전제이므로 사실상 5년초과 산식만 적용).
  // §98의4(비거주자, 2009.3.16~2010.2.11 취득)만 예외적으로 보유기간 요건 없이 산출세액의 10%를 그대로
  // 감면한다.
  window.calculateUnsoldHouseAcquisitionReductionJS = function (p) {
    p = p || {};
    const provision = p.provision;
    const validProvisions = ['sect98_3', 'sect98_4', 'sect98_5', 'sect98_6', 'sect98_7', 'sect98_8'];
    if (validProvisions.indexOf(provision) === -1) {
      return { error: 'provision을 sect98_3/sect98_4/sect98_5/sect98_6/sect98_7/sect98_8 중에서 선택하세요.' };
    }

    if (provision === 'sect98_4') {
      const transferPrice = Number(p.transferPrice) || 0;
      const acquisitionPrice = Number(p.acquisitionPrice) || 0;
      const necessaryExpenses = Number(p.necessaryExpenses) || 0;
      const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;
      return {
        적용여부: true,
        전체양도차익: Math.round(totalGain),
        세액감면율: 10,
        안내: '조특법§98의4 — 비거주자가 2009.3.16~2010.2.11 취득한 주택(§98의3 미분양주택 외)을 양도할 때는 보유기간 요건 없이 그 양도소득세 산출세액의 100분의 10을 감면합니다. 위 일반 양도세 계산기로 전체 양도차익 기준 세액을 계산한 뒤, 그 산출세액에서 10%를 차감하세요.'
      };
    }

    let rate;
    if (provision === 'sect98_3') {
      rate = p.isOverconcentrationZone ? 60 : 100;
    } else if (provision === 'sect98_5') {
      const discountRate = Number(p.priceDiscountRate) || 0;
      rate = discountRate > 20 ? 100 : discountRate > 10 ? 80 : 60;
    } else if (provision === 'sect98_6') {
      rate = 50;
    } else if (provision === 'sect98_7') {
      rate = 100;
    } else { // sect98_8
      rate = 50;
    }

    if (provision === 'sect98_7' && Number(p.acquisitionPrice) > 900000000) {
      return { 적용여부: false, 감면율: 0, 감면소득금액: 0, 안내: '조특법§98의7① — 취득가액이 9억원을 초과하는 주택은 "미분양주택"의 정의에서 제외되어 이 특례를 적용받을 수 없습니다.' };
    }
    if (provision === 'sect98_8') {
      if (Number(p.acquisitionPrice) > 600000000) {
        return { 적용여부: false, 감면율: 0, 감면소득금액: 0, 안내: '조특법§98의8① — 취득 당시 취득가액이 6억원을 초과하는 주택은 이 특례를 적용받을 수 없습니다.' };
      }
      if (p.exclusiveAreaSqm !== undefined && p.exclusiveAreaSqm !== null && p.exclusiveAreaSqm !== '' && Number(p.exclusiveAreaSqm) > 135) {
        return { 적용여부: false, 감면율: 0, 감면소득금액: 0, 안내: '조특법§98의8① — 주택의 연면적(공동주택은 전용면적)이 135제곱미터를 초과하면 이 특례를 적용받을 수 없습니다.' };
      }
    }

    const acquisitionDate = p.acquisitionDate;
    const transferDate = p.transferDate;
    if (!acquisitionDate || !transferDate) return { error: '취득일과 양도일이 필요합니다.' };
    const acqTime = new Date(acquisitionDate).getTime();
    const trfTime = new Date(transferDate).getTime();
    if (!(trfTime > acqTime)) return { error: '양도일은 취득일 이후여야 합니다.' };
    const yearsHeld = (trfTime - acqTime) / (365.25 * 24 * 3600 * 1000);

    const transferPrice = Number(p.transferPrice) || 0;
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;
    const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;

    // §98의6① — "취득일부터 5년 이내 양도시 50% 세액감면"은 "제1호의 요건을 갖춘 주택에 한정한다"는
    // 단서가 있다. 1호(2011.12.31까지 임대계약체결+2년이상임대)만 5년이내 감면 대상이고, 2호(5년이상
    // 임대유형)는 5년이내 양도시 이 조문상 감면 자체가 없다(5년초과보유 후 양도한 경우의 소득공제만 적용).
    if (provision === 'sect98_6' && yearsHeld <= 5 && p.sect98_6ItemType === 'item2') {
      return {
        적용여부: false, 감면율: 0, 감면소득금액: 0,
        안내: '조특법§98의6① 단서 — 취득일로부터 5년 이내 양도시 50% 세액감면은 "제1호 요건을 갖춘 주택"(2011.12.31까지 임대계약체결+2년이상임대)에 한정됩니다. 2호 유형(5년이상임대)은 5년 이내 양도에 대한 감면이 없고, 취득일로부터 5년 초과 보유한 뒤 양도한 경우에만 그 5년간 발생한 양도소득금액의 50% 소득공제가 적용됩니다.'
      };
    }
    let exemptGain, note;
    if (yearsHeld <= 5 && provision !== 'sect98_8') {
      exemptGain = Math.round(totalGain * rate / 100);
      note = '취득일로부터 5년 이내 양도이므로 그 양도소득세의 ' + rate + '%에 상당하는 세액을 감면합니다(소득금액의 ' + rate + '%를 과세대상에서 제외한 것과 동일한 효과).';
    } else {
      const fy = fiveYearMarkGain(totalGain, acquisitionPrice, {
        acquisitionStandardPrice: p.acquisitionStandardPrice, fiveYearStandardPrice: p.fiveYearStandardPrice, transferStandardPrice: p.transferStandardPrice,
        fiveYearMarkValue: p.fiveYearMarkValue, yearsHeld: yearsHeld
      });
      note = (provision === 'sect98_8' ? '' : '취득일로부터 5년 초과 보유 후 양도 — ') + fy.note + ' (감면율 ' + rate + '% 적용)';
      exemptGain = Math.round(fy.gain * rate / 100);
    }
    exemptGain = Math.max(0, Math.min(exemptGain, totalGain));
    const taxableGain = Math.max(0, totalGain - exemptGain);
    return {
      적용여부: true,
      보유기간_년: Math.round(yearsHeld * 100) / 100,
      적용감면율: rate,
      전체양도차익: Math.round(totalGain),
      감면_비과세대상_양도소득금액: Math.round(exemptGain),
      과세대상양도소득금액: taxableGain,
      안내: note + ' 이 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 계산기에서 별도 적용됩니다).'
    };
  };

  // 수도권 밖의 지역에 있는 준공후미분양주택 취득자에 대한 1세대1주택 비과세 특례 (조특법§98의9,
  // 2024.1.10~2026.12.31 취득분) — 1주택을 보유한 1세대가 이 기간 중 수도권 밖 준공후미분양주택을
  // 취득한 후 종전주택을 양도하면, 그 준공후미분양주택은 1세대1주택 비과세(소득세법§89①3호) 판정시
  // 소유주택으로 보지 않는다. 세액 자체를 계산하지 않고 적용 가능 여부만 판정한다 — 적용되면 위 일반
  // 양도세 계산기에서 "1세대1주택 비과세 요건 충족 전제"를 체크하고 종전주택 기준으로 계산하면 된다.
  window.calculateUnsoldHouseOneHouseExclusionJS = function (p) {
    p = p || {};
    const acquisitionDate = p.acquisitionDate;
    if (!acquisitionDate) return { error: '준공후미분양주택의 취득일이 필요합니다.' };
    const acqTime = new Date(acquisitionDate).getTime();
    const windowStart = new Date('2024-01-10').getTime();
    const windowEnd = new Date('2026-12-31').getTime();
    if (!(acqTime >= windowStart && acqTime <= windowEnd)) {
      return {
        적용여부: false,
        안내: '취득일이 2024.1.10~2026.12.31 기간을 벗어나 조특법§98의9의 적용대상이 아닙니다.'
      };
    }
    if (!p.isOutsideMetropolitanArea) {
      return { 적용여부: false, 안내: '수도권 밖의 지역에 소재한 준공후미분양주택이 아니어서 적용대상이 아닙니다.' };
    }
    if (!p.wasOneHouseBeforeAcquisition) {
      return { 적용여부: false, 안내: '준공후미분양주택 취득 전 1주택을 보유한 1세대가 아니어서 적용대상이 아닙니다.' };
    }
    if (!p.meetsAreaAndPriceRequirements) {
      return { 적용여부: false, 안내: '전용면적·취득가액 등 대통령령으로 정하는 요건(시행령에서 확인 필요)을 충족하지 못해 적용대상이 아닙니다.' };
    }
    return {
      적용여부: true,
      안내: '요건을 충족하여 그 준공후미분양주택을 1세대1주택 비과세(소득세법§89①3호) 판정시 소유주택으로 보지 않습니다(조특법§98의9①). 위 일반 양도세 계산기에서 종전주택을 양도자산으로 놓고 "1세대1주택 비과세 요건 충족 전제"를 체크해 계산하세요. 종합부동산세 특례(§98의9②)는 9.16~9.30 별도 신청이 필요하며 이 도구의 범위 밖입니다.'
    };
  };

  // 비과세되는 상속재산 (상증세법§12) — §46(비과세되는 증여재산)의 상속세 버전. 열거된 항목에 해당하면
  // 그 금액에 대해 상속세를 부과하지 않는다.
  const NONTAXABLE_INHERITANCE_PROPERTY_LABELS = {
    government: { 근거호: '§12 1호', 설명: '국가·지방자치단체·공공단체에 유증등을 한 재산' },
    ancestral_property: { 근거호: '§12 3호', 설명: '민법§1008의3에 규정된 재산(제사를 주재하는 자가 승계하는 금양임야·묘토인 농지·족보·제구 등) 중 대통령령으로 정하는 범위의 재산' },
    political_party: { 근거호: '§12 4호', 설명: '「정당법」에 따른 정당에 유증등을 한 재산' },
    labor_welfare_fund: { 근거호: '§12 5호', 설명: '「근로복지기본법」에 따른 사내근로복지기금 등에 유증등을 한 재산' },
    disaster_relief: { 근거호: '§12 6호', 설명: '사회통념상 인정되는 이재구호금품·치료비 등' },
    post_inheritance_donation: { 근거호: '§12 7호', 설명: '상속재산 중 상속인이 §67 신고기한까지 국가·지방자치단체 또는 공공단체에 증여한 재산(1호의 유증과 달리, 일단 상속받은 후 신고기한 내 자발적으로 증여한 경우)' }
  };
  window.calculateNontaxableInheritancePropertyJS = function (p) {
    p = p || {};
    const itemType = p.itemType;
    const meta = NONTAXABLE_INHERITANCE_PROPERTY_LABELS[itemType];
    if (!meta) return { error: 'itemType을 government/ancestral_property/political_party/labor_welfare_fund/disaster_relief/post_inheritance_donation 중에서 선택하세요.' };
    if (itemType === 'ancestral_property') {
      // 시행령§8③ 단서 — 1호(금양임야, 9,900㎡ 이내)·2호(묘토인 농지, 1,980㎡ 이내) 재산가액 합계는
      // 2억원 한도, 3호(족보와 제구) 재산가액 합계는 별도로 1천만원 한도다(두 한도는 서로 합산하지 않는다).
      const graveyardAmount = Math.min(Math.max(0, Number(p.graveyardForestAndPaddyAmount) || 0), 200000000);
      const genealogyAmount = Math.min(Math.max(0, Number(p.genealogyAndRitualToolsAmount) || 0), 10000000);
      const total = graveyardAmount + genealogyAmount;
      if (total <= 0) return { error: '금양임야·묘토인농지 금액(graveyardForestAndPaddyAmount) 또는 족보·제구 금액(genealogyAndRitualToolsAmount) 중 하나 이상이 필요합니다.' };
      return {
        비과세여부: true, 근거호: meta.근거호,
        금양임야_묘토_비과세금액: graveyardAmount, 족보_제구_비과세금액: genealogyAmount, 비과세금액: total,
        안내: meta.설명 + ' — 시행령§8③ 단서에 따라 금양임야·묘토인농지는 합계 2억원, 족보·제구는 별도로 1천만원까지만 비과세됩니다(한도 초과분은 과세대상). 면적요건(금양임야 9,900㎡·묘토 1,980㎡ 이내)과 "제사를 주재하는 상속인" 요건은 별도로 확인하세요. 이 금액은 상속세 계산기의 상속재산가액에 포함하지 마세요.'
      };
    }
    const amount = Math.max(0, Number(p.amount) || 0);
    if (amount <= 0) return { error: '금액이 필요합니다.' };
    return {
      비과세여부: true, 근거호: meta.근거호, 비과세금액: amount,
      안내: meta.설명 + ' — ' + meta.근거호 + '에 따라 상속세를 부과하지 않습니다. 세부 요건(대통령령으로 정하는 범위·한도 등)은 별도로 확인하세요. 이 금액은 상속세 계산기의 상속재산가액에 포함하지 마세요.'
    };
  };

  // 초과배당에 따른 이익의 증여 (상증세법§41의2, 시행령§31의2) — 최대주주등이 배당을 포기하거나 불균등
  // 조건으로 배당받아 그 특수관계인이 본인 지분보다 많은 배당을 받으면, 그 초과배당금액에서 소득세상당액을
  // 뺀 금액을 증여재산가액으로 한다. 이후 실제 소득세 신고시 정산증여재산가액(=초과배당금액-실제소득세액)
  // 기준으로 재계산해 차액을 추가납부하거나 환급받는다(②③). 신고기한 전 소득세상당액은 시행규칙§10의3①의
  // 추정율표(EXCESS_DIVIDEND_INCOME_TAX_ESTIMATE_BRACKETS)로 자동계산하며, estimatedIncomeTaxEquivalent를
  // 직접 입력하면 그 값을 그대로 우선 사용한다. 정산시(isFinalSettlement) 종합과세되는 경우의 실제소득세액은
  // 시행규칙§10의3②3호(comprehensiveIncomeTaxBase 입력시 자동계산)로, 비과세·분리과세인 경우는
  // actualIncomeTax 직접 입력으로 처리한다.
  window.calculateExcessDividendGiftTaxJS = function (p) {
    p = p || {};
    const isFinalSettlement = !!p.isFinalSettlement;
    const excessDividendBaseAmount = Number(p.excessDividendBaseAmount) || 0;
    if (excessDividendBaseAmount <= 0) return { error: '최대주주등의 특수관계인이 보유주식등에 비례한 금액을 초과해 받은 배당등의 금액(초과배당금액 산정용)이 필요합니다.' };
    const disproportionateShortfallRatio = Math.min(1, Math.max(0, Number(p.disproportionateShortfallRatio) || 0));
    const thisTransactionExcessDividendAmount = Math.round(excessDividendBaseAmount * disproportionateShortfallRatio);
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 동일한 초과배당등이 더 있으면 각 초과배당금액을 합산해서 계산.
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전 초과배당금액 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    const excessDividendAmount = thisTransactionExcessDividendAmount + priorBenefitSum;

    // 시행령§31의2③1호(2026.2.27 개정) — "초과배당금액에 대한 §68①에 따른 증여세 과세표준 신고기한이
    // 해당 초과배당금액이 발생한 연도의 다음 연도 6월 1일(성실신고확인대상사업자는 7월 1일) 이후인
    // 경우"에는 최초신고 단계부터 추정율표(2호)가 아니라 제4항2호(정산과 동일한 실제소득세액 산정법)를
    // 적용한다. 이 경우 ⑥에 따라 §41의2②③(정산)이 아예 적용되지 않으므로 나중에 다시 정산신고할
    // 필요가 없다. giftTaxDeadlineOnOrAfterJune1을 true로 넘기면 이 분기를 적용한다.
    const usesActualIncomeTaxMethod = isFinalSettlement || !!p.giftTaxDeadlineOnOrAfterJune1;

    let incomeTaxEquivalent, note;
    if (usesActualIncomeTaxMethod) {
      // 시행규칙§10의3②3호(종합과세되는 경우) — 가목[초과배당금액이 발생한 연도의 종합소득과세표준에
      // 소득세법§55①세율(=TRANSFER_TAX_BRACKETS)을 적용한 세액－그 과세표준에서 초과배당금액을 뺀
      // 금액에 같은 세율을 적용한 세액(0미만이면0)]과 나목[초과배당금액×14%] 중 큰 금액이 실제소득세액이다.
      // 분리과세(2호)면 그 분리과세된 세액, 비과세·과세제외(1호)면 0이며, 둘 다 사용자가 actualIncomeTax로
      // 직접 입력해야 한다(분리과세·비과세 여부는 이 계산기가 판정하지 않음).
      const comprehensiveIncomeTaxBase = Number(p.comprehensiveIncomeTaxBase);
      if (Number.isFinite(comprehensiveIncomeTaxBase) && comprehensiveIncomeTaxBase > 0) {
        const taxWithExcess = progressiveTax(comprehensiveIncomeTaxBase, TRANSFER_TAX_BRACKETS);
        const taxWithoutExcess = progressiveTax(Math.max(0, comprehensiveIncomeTaxBase - excessDividendAmount), TRANSFER_TAX_BRACKETS);
        const incrementalTax = Math.max(0, taxWithExcess - taxWithoutExcess);
        const flatRateTax = Math.round(excessDividendAmount * 0.14);
        incomeTaxEquivalent = Math.max(incrementalTax, flatRateTax);
        note = '시행규칙§10의3②3호(종합과세되는 경우)에 따라 가목[종합소득과세표준(' + comprehensiveIncomeTaxBase + '원) 기준 세액(' + taxWithExcess + '원)－초과배당금액을 뺀 과세표준 기준 세액(' + taxWithoutExcess + '원)=' + incrementalTax + '원]과 나목[초과배당금액×14%=' + flatRateTax + '원] 중 큰 금액(' + incomeTaxEquivalent + '원)을 실제소득세액으로 계산했습니다. 초과배당금액이 비과세·과세제외(1호)이거나 분리과세(2호)된 경우에는 이 계산이 아니라 actualIncomeTax를 직접 입력하세요.';
      } else {
        incomeTaxEquivalent = Number(p.actualIncomeTax) || 0;
        note = (isFinalSettlement ? '정산증여재산가액' : '증여재산가액') + ' = 초과배당금액 - 실제소득세액(' + (isFinalSettlement ? '§41의2②·④' : '시행령§31의2③1호·④') + ')으로 계산했습니다. 종합과세되는 경우 종합소득과세표준(comprehensiveIncomeTaxBase)을 입력하면 시행규칙§10의3②3호 산식으로 자동계산합니다.';
      }
      note += isFinalSettlement
        ? ' 정산 신고기한은 초과배당금액이 발생한 연도의 다음 연도 5.1~5.31(성실신고확인대상사업자는 6.30)입니다.'
        : ' 증여세 신고기한이 초과배당금액 발생연도의 다음 연도 6.1(성실신고확인대상사업자는 7.1) 이후여서(시행령§31의2③1호) 최초신고부터 정산과 동일한 실제소득세액 산정법을 적용했습니다. 이 경우 §41의2②③(정산)이 적용되지 않으므로(시행령§31의2⑥) 이후 별도의 정산신고가 필요 없습니다.';
    } else if (Number(p.estimatedIncomeTaxEquivalent) > 0) {
      incomeTaxEquivalent = Number(p.estimatedIncomeTaxEquivalent);
      note = '직접 입력한 소득세상당액 추정치를 그대로 사용했습니다. 이후 실제 소득세를 납부할 때 정산증여재산가액(실제소득세액 기준)으로 다시 계산해 차액을 추가납부하거나 환급받아야 합니다(§41의2②).';
    } else {
      incomeTaxEquivalent = progressiveTax(excessDividendAmount, EXCESS_DIVIDEND_INCOME_TAX_ESTIMATE_BRACKETS);
      note = '최초 신고시 소득세상당액은 시행규칙§10의3①의 추정율표로 초과배당금액(' + excessDividendAmount + '원)에서 산정한 ' + incomeTaxEquivalent + '원입니다. 이후 실제 소득세를 납부할 때 정산증여재산가액(실제소득세액 기준)으로 다시 계산해 차액을 추가납부하거나 환급받아야 합니다(§41의2②).';
    }
    const giftAmount = Math.max(0, excessDividendAmount - incomeTaxEquivalent);

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 이번거래초과배당금액: thisTransactionExcessDividendAmount, 직전1년합산액: priorBenefitSum, 초과배당금액: excessDividendAmount, 소득세상당액: incomeTaxEquivalent, 증여의제이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: note + aggNote
    };
  };

  // 주식등의 상장 등에 따른 이익의 증여 / 합병에 따른 상장 등 이익의 증여 (상증세법§41의3,§41의5, 시행령
  // §31의3) — 최대주주등의 특수관계인이 그 최대주주등으로부터 주식등을 증여·유상취득(또는 증여받은 재산
  // 으로 취득)한 후 5년 이내에 상장(§41의3)되거나 특수관계 있는 상장법인과 합병(§41의5, §41의3③~⑨를
  // 준용해 "상장일"을 "합병등기일"로 봄)되어 그 가액이 증가하면, 정산기준일(상장·합병등기일부터 3개월
  // 되는 날, 그 전에 사망·증여·양도시 그 날) 기준 1주당 평가액에서 증여받은날 1주당 과세가액(또는
  // 취득가액)과 1주당 기업가치의 실질적인 증가로 인한 이익을 뺀 금액에 주식수를 곱해 이익을 계산한다.
  window.calculateStockListingGiftTaxJS = function (p) {
    p = p || {};
    const provision = p.provision === 'merger' ? 'merger' : 'listing';
    const settlementValuePerShare = Number(p.settlementValuePerShare) || 0;
    const originalValuePerShare = Number(p.originalValuePerShare) || 0;
    const realValueIncreasePerShare = Number(p.realValueIncreasePerShare) || 0;
    const shares = Number(p.shares) || 0;
    if (settlementValuePerShare <= 0 || shares <= 0) return { error: '정산기준일 1주당 평가액과 증여·취득한 주식수가 필요합니다.' };
    const giftAmount = Math.max(0, Math.round((settlementValuePerShare - originalValuePerShare - realValueIncreasePerShare) * shares));

    const gateThreshold = Math.min(Math.round((originalValuePerShare + realValueIncreasePerShare) * shares * 0.3), 300000000);
    if (giftAmount < gateThreshold) {
      // §41의3④단서(§41의5②가 준용) — 정산기준일 현재 주식등의 가액이 당초 증여세 과세가액보다 낮아진
      // 경우로서 그 차액이 기준금액(§31의3⑥ — ③과 동일한 기준금액) 이상이면, "그 차액에 상당하는
      // 증여세액(증여받은 때에 납부한 당초의 증여세액을 말한다)"을 환급받을 수 있다 — 괄호가 "차액에
      // 상당하는 증여세액"을 "당초의 증여세액"으로 직접 정의하므로, 기준을 충족하면 당초 납부세액
      // 전액을 환급액으로 계산한다(비례 안분이 아님). 시행령§31의3⑥은 "기준 이상인 경우"를 "①에 따라
      // 계산한 금액"(=(정산기준일가액－증여일과세가액－기업가치실질증가이익)×주식수)이 기준금액 이상인
      // 경우로 정의한다 — 하락 시에는 이 식이 음수가 되므로 그 절대값(=증여일과세가액＋기업가치실질
      // 증가이익－정산기준일가액)을 기준금액과 비교해야 한다. 기업가치실질증가이익을 빼지 않으면(=더하지
      // 않으면) 게이트가 과소평가되어 환급 대상이 아닌 사안까지 환급 대상으로 잘못 판정될 수 있다.
      const originalTaxableValue = originalValuePerShare * shares;
      const settlementTotalValue = settlementValuePerShare * shares;
      const decreaseAmount = Math.max(0, originalTaxableValue + realValueIncreasePerShare * shares - settlementTotalValue);
      if (decreaseAmount >= gateThreshold) {
        const originalGiftTaxPaid = Number(p.originalGiftTaxPaid) || 0;
        return {
          과세대상여부: false, 환급대상여부: true, 가액하락액: decreaseAmount, 환급세액: originalGiftTaxPaid, 납부세액: -originalGiftTaxPaid,
          안내: (provision === 'merger' ? '§41의5②(§41의3④단서 준용)' : '§41의3④단서') + '에 따라, 정산기준일 현재 주식등의 가액(' + settlementTotalValue + '원)이 당초 증여세 과세가액(' + originalTaxableValue + '원)보다 ' + decreaseAmount + '원 낮아졌고 그 차액이 기준금액(' + gateThreshold + '원) 이상이어서, 증여받은 때 납부한 당초의 증여세액(originalGiftTaxPaid로 입력, ' + originalGiftTaxPaid + '원)을 전액 환급받을 수 있습니다.'
        };
      }
      return {
        과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0,
        안내: '이익(' + giftAmount + '원)이 기준금액 미만이어서 과세하지 않습니다(' + (provision === 'merger' ? '§41의5①단서' : '§41의3①단서') + ', 시행령§31의3③). 정산기준일 현재 가액 하락분(' + decreaseAmount + '원)도 기준금액 미만이어서 환급 대상도 아닙니다.'
      };
    }

    // §47①·§55①3호 — §41의3·§41의5(상장 등에 따른 이익의 증여)는 §47①이 열거하는 "합산배제증여재산"이므로
    // §53(관계별공제)·§53의2(혼인출산공제)·§54(재해손실공제)를 적용하지 않고 10년내 재차증여 합산(§47②단서로
    // 배제)도 하지 않는다 — "그 증여재산가액에서 3천만원을 공제한 금액"만이 과세표준이다(감정평가수수료는
    // §55①본문에 따라 모든 호에 공통 적용).
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const taxBase = Math.max(0, giftAmount - 30000000 - appraisalFeeAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 증여의제이익: giftAmount,
      합산배제증여재산공제: 30000000, 감정평가수수료공제: appraisalFeeAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: (provision === 'merger'
        ? '증여일은 합병등기일부터 3개월이 되는 날(정산기준일)입니다(§41의5②가 §41의3③을 준용, "상장일"을 "합병등기일"로 봄).'
        : '증여일은 상장일부터 3개월이 되는 날(정산기준일)입니다(§41의3③). 그 전에 사망·증여·양도하면 그 날이 정산기준일이 됩니다.')
        + ' 당초 증여세 과세가액에 이 이익을 가산해 정산합니다(§41의3④). 정산기준일 현재 가액이 당초 과세가액보다 낮아졌다면 이 도구를 같은 입력값으로 다시 호출했을 때(이 결과가 과세대상이 아니라면) 환급 여부·환급액을 함께 안내합니다.'
    };
  };

  // 농어촌주택등 취득자에 대한 양도소득세 과세특례 (조특법§99의4, 2003.8.1~2028.12.31 취득분, 현재
  // 시행중) — 1세대가 농어촌주택등(농어촌주택 또는 고향주택, 3억원 이하 등 요건)을 취득해 3년 이상
  // 보유하고 그 취득 전 보유하던 일반주택을 양도하면, 그 농어촌주택등을 소유주택으로 보지 않아 일반주택의
  // 1세대1주택 비과세(소득세법§89①3호) 판정에서 제외한다(§98의9·§71의2와 같은 구조). 취득한 농어촌
  // 주택등과 일반주택이 같은(연접) 읍·면·동(고향주택은 시)에 있으면 적용배제(③). 3년 보유요건 충족 전에
  // 일반주택을 양도해도 적용되나(④), 이후 3년 미만 보유로 끝나면 사후관리로 그 감면세액상당액을 추징
  // 한다(⑥, 수용 등 부득이한 사유는 예외). 세액 자체는 계산하지 않고 적용 가능 여부·사후관리 추징대상
  // 여부만 판정한다.
  window.calculateRuralHouseOneHouseExclusionJS = function (p) {
    p = p || {};
    const acquisitionDate = p.acquisitionDate;
    if (!acquisitionDate) return { error: '농어촌주택등의 취득일이 필요합니다.' };
    const acqTime = new Date(acquisitionDate).getTime();
    const houseType = p.houseType === 'hometown' ? 'hometown' : 'rural';
    const windowStart = new Date(houseType === 'hometown' ? '2009-01-01' : '2003-08-01').getTime();
    const windowEnd = new Date('2028-12-31').getTime();
    if (!(acqTime >= windowStart && acqTime <= windowEnd)) {
      return { 적용여부: false, 안내: '취득일이 취득기간(농어촌주택 2003.8.1~2028.12.31, 고향주택 2009.1.1~2028.12.31)을 벗어나 조특법§99의4의 적용대상이 아닙니다.' };
    }
    if (!p.meetsLocationAndPriceRequirements) {
      return { 적용여부: false, 안내: '소재지·가액(3억원, 한옥은 4억원) 등 시행령이 정하는 농어촌주택·고향주택 요건을 충족하지 못해 적용대상이 아닙니다.' };
    }
    if (p.isSameOrAdjacentDistrict) {
      return { 적용여부: false, 안내: '취득한 농어촌주택등과 보유하던 일반주택이 행정구역상 같은(또는 연접한) ' + (houseType === 'hometown' ? '시' : '읍·면·동') + '에 있어 적용배제됩니다(§99의4③).' };
    }
    if (p.holdingYears !== undefined && Number(p.holdingYears) < 3 && !p.isPendingHoldingPeriod) {
      return { 적용여부: false, 안내: '농어촌주택등을 3년 이상 보유하지 않아(또는 3년 보유요건 충족 전 일반주택 양도가 아니어서) 적용대상이 아닙니다(§99의4①④).' };
    }
    if (p.triggerClawback && !p.isExemptedReason) {
      return {
        적용여부: true, 사후관리추징대상: true,
        안내: '3년 이상 보유 요건을 충족하기 전에 일반주택을 양도해 특례를 적용받은 후, 농어촌주택등을 3년 이상 보유하지 않게 되었습니다. 그 보유하지 않게 된 날이 속하는 달의 말일부터 2개월 이내에, 특례를 적용받지 않았을 경우 납부했을 세액상당액을 양도소득세로 납부해야 합니다(§99의4⑥, 수용 등 부득이한 사유가 있으면 제외).'
      };
    }
    return {
      적용여부: true, 사후관리추징대상: false,
      안내: '요건을 충족하여 그 ' + (houseType === 'hometown' ? '고향주택' : '농어촌주택') + '을 1세대1주택 비과세(소득세법§89①3호) 판정시 소유주택으로 보지 않습니다(조특법§99의4①). 위 일반 양도세 계산기에서 일반주택을 양도자산으로 놓고 "1세대1주택 비과세 요건 충족 전제"를 체크해 계산하세요.'
    };
  };

  // 전환사채등의 주식전환등에 따른 이익의 증여 (상증세법§40, 시행령§30) — 4가지 세부 케이스로 나뉜다.
  // acquisition(법§40①1호, 취득시 — 특수관계인 저가취득/최대주주등 초과배정저가취득/그 특수관계인 초과배정
  //   저가취득): 이익 = 전환사채등의 시가 - 인수취득가액. 게이트: min(시가30%, 1억).
  // conversion(법§40①2호가~다목, 전환시 — 특수관계인취득자·최대주주등·그특수관계인의 전환이익): 이익 =
  //   (교부받은주식가액-전환가액등)×교부받은주식수-이자손실분-acquisition이익(있으면). 전환사채등을
  //   양도한 경우 이익은 양도가액-취득가액을 초과할 수 없다. 게이트: 1억원(고정).
  //   교부받은주식가액 = [(전환등전1주당평가액×전환등전발행주식총수)+(전환가액등×전환등으로증가한주식수)]
  //     ÷(전환등전발행주식총수+증가한주식수) — §39①1호가목과 동일 형태(사용자가 시행령§30⑤ 원문을 직접
  //     제공해 확인).
  // conversion_reverse(법§40①2호라목, 반대편 — 교부받은주식가액이 낮아짐으로써 그 주식을 교부받은 자의
  //   특수관계인이 얻은 이익): 이익 = (전환가액등-교부받은주식가액)×증가한주식수×그특수관계인이전환등전에
  //   보유한지분비율. 게이트: 0원(무조건 과세).
  // transfer(법§40①3호, 양도시 — 특수관계인에게 시가보다 높은 가액으로 양도): 이익 = 양도가액-시가.
  //   게이트: min(시가30%, 1억).
  // 이자손실분(시행규칙§10의2) = [만기상환금액을 사채발행이율로 취득당시 현재가치할인한 금액] － [만기
  // 상환금액을 적정할인율(시행규칙§18의3 — 연 8%)로 취득당시 현재가치할인한 금액]. bondFaceValueAtMaturity·
  // bondIssueRate·yearsToMaturityAtAcquisition을 입력하면 자동계산하며, interestLossAmount 직접입력이
  // 있으면 그 값을 우선한다. conversion·conversion_reverse·transfer(법§40①2·3호)는 §47①에 열거된 합산배제
  // 증여재산이므로 §55①3호에 따라 이익에서 3천만원을 공제한 금액이 과세표준이며(관계별공제 미적용),
  // acquisition(법§40①1호)은 열거되지 않아 일반 증여세 산식(관계별공제 등)을 따른다.
  window.calculateConvertibleBondGiftTaxJS = function (p) {
    p = p || {};
    const caseType = p.caseType;
    const validCases = ['acquisition', 'conversion', 'conversion_reverse', 'transfer'];
    if (validCases.indexOf(caseType) === -1) {
      return { error: 'caseType을 acquisition(취득시)/conversion(전환시)/conversion_reverse(전환시 반대편)/transfer(양도시) 중에서 선택하세요.' };
    }

    let giftAmount, gateThreshold;
    if (caseType === 'acquisition') {
      const fairValue = Number(p.fairValue) || 0;
      const acquisitionCost = Number(p.acquisitionCost) || 0;
      if (fairValue <= 0) return { error: '전환사채등의 시가가 필요합니다.' };
      giftAmount = Math.max(0, Math.round(fairValue - acquisitionCost));
      gateThreshold = Math.min(fairValue * 0.3, 100000000);
    } else if (caseType === 'transfer') {
      const fairValue = Number(p.fairValue) || 0;
      const transferPrice = Number(p.transferPrice) || 0;
      if (fairValue <= 0) return { error: '전환사채등의 시가가 필요합니다.' };
      giftAmount = Math.max(0, Math.round(transferPrice - fairValue));
      gateThreshold = Math.min(fairValue * 0.3, 100000000);
    } else {
      const preConversionValuePerShare = Number(p.preConversionValuePerShare) || 0;
      const preConversionShares = Number(p.preConversionShares) || 0;
      const conversionPricePerShare = Number(p.conversionPricePerShare) || 0;
      const increasedShares = Number(p.increasedShares) || 0;
      if (preConversionShares <= 0 || increasedShares <= 0) return { error: '전환등 전 발행주식총수와 전환등으로 증가한 주식수가 필요합니다.' };
      const receivedSharesValue = (preConversionValuePerShare * preConversionShares + conversionPricePerShare * increasedShares) / (preConversionShares + increasedShares);

      if (caseType === 'conversion') {
        // 이자손실분(시행규칙§10의2) — 직접입력이 없으면 [1호: 만기상환금액을 사채발행이율로 취득당시
        // 현재가치할인한 금액] － [2호: 만기상환금액을 적정할인율(시행규칙§18의3 — 연 100분의 8)로
        // 취득당시 현재가치할인한 금액]으로 자동계산한다(원문 확인).
        let interestLossAmount = Number(p.interestLossAmount) || 0;
        if (!p.interestLossAmount) {
          const bondFaceValueAtMaturity = Number(p.bondFaceValueAtMaturity) || 0;
          const bondIssueRate = Number(p.bondIssueRate);
          const yearsToMaturityAtAcquisition = Number(p.yearsToMaturityAtAcquisition);
          if (bondFaceValueAtMaturity > 0 && Number.isFinite(bondIssueRate) && bondIssueRate >= 0 && Number.isFinite(yearsToMaturityAtAcquisition) && yearsToMaturityAtAcquisition > 0) {
            const pvAtBondRate = bondFaceValueAtMaturity / Math.pow(1 + bondIssueRate, yearsToMaturityAtAcquisition);
            const pvAtAppropriateRate = bondFaceValueAtMaturity / Math.pow(1.08, yearsToMaturityAtAcquisition);
            interestLossAmount = Math.max(0, Math.round(pvAtBondRate - pvAtAppropriateRate));
          }
        }
        const priorAcquisitionGiftAmount = Number(p.priorAcquisitionGiftAmount) || 0;
        giftAmount = Math.max(0, Math.round((receivedSharesValue - conversionPricePerShare) * increasedShares - interestLossAmount - priorAcquisitionGiftAmount));
        if (p.isBondTransferred) {
          const cap = Math.max(0, (Number(p.bondTransferPrice) || 0) - (Number(p.bondAcquisitionCost) || 0));
          giftAmount = Math.min(giftAmount, cap);
        }
        gateThreshold = 100000000;
      } else { // conversion_reverse
        const relatedPriorOwnershipRatio = Number(p.relatedPriorOwnershipRatio) || 0;
        giftAmount = Math.max(0, Math.round((conversionPricePerShare - receivedSharesValue) * increasedShares * relatedPriorOwnershipRatio));
        gateThreshold = 0;
      }
    }

    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 같은 호(caseType)의 이익이 더 있으면 합산해 기준금액을 계산.
    const thisTransactionGiftAmount = giftAmount;
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    giftAmount = thisTransactionGiftAmount + priorBenefitSum;

    if (giftAmount < gateThreshold) {
      return { 과세대상여부: false, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount, 납부세액: 0, 안내: '이익(' + giftAmount + '원' + aggNote + ')이 기준금액(' + gateThreshold + '원) 미만이어서 과세하지 않습니다(시행령§30②).' };
    }

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;

    let taxBase, isAggregationExcluded;
    if (caseType === 'acquisition') {
      isAggregationExcluded = false;
      const disasterLossAmount = Number(p.disasterLossAmount) || 0;
      const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
      const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
      taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
      var relationDeductionOut = relationDeduction, disasterLossAmountOut = disasterLossAmount;
    } else {
      isAggregationExcluded = true;
      taxBase = Math.max(0, giftAmount - 30000000 - appraisalFeeAmount);
    }
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    // §59·시행령§48(§21 준용) — 외국납부세액공제 비례산식(foreignGiftTaxBase 입력시 자동계산).
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);

    const result = {
      과세대상여부: true, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount,
      감정평가수수료공제: appraisalFeeAmount,
      외국납부세액공제: foreignTaxCredit,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: (isAggregationExcluded
        ? '합산배제증여재산이므로(§47①) 관계별 증여재산공제(§53)는 적용하지 않고 이익에서 3천만원을 공제해 과세표준을 계산합니다(§55①3호).'
        : '증여일은 전환사채등을 인수·취득한 날입니다(시행령§30①1호).') + aggNote
    };
    if (!isAggregationExcluded) {
      result.증여재산공제 = relationDeductionOut; result.재해손실공제 = disasterLossAmountOut;
    }
    return result;
  };

  // 현물출자에 따른 이익의 증여 (상증세법§39의3, 시행령§29의3) — §39(증자)의 이미 확립된 공식을
  // "증자"를 "현물출자"로 치환해 그대로 준용한다(시행령§29의3①). low_price(1호, 저가발행+현물출자자가
  // 배정받은 신주 — §39의 low_allocated와 동일 산식, 게이트 없음): 이익 = (현물출자후1주당평가액-신주
  // 1주당인수가액)×현물출자자가배정받은신주수. high_price(2호, 고가발행 — 현물출자자가 인수한 신주수와
  // 특수관계인 주주등의 지분비율을 곱하는 점이 §39의 high_allocated와 다름): 이익 = (신주1주당인수가액-
  // 현물출자후1주당평가액)×현물출자자가인수한신주수×현물출자자외특수관계인주주등의지분비율. 게이트(2호만):
  // 차액비율 30%이상이거나 이익 3억원이상.
  window.calculateInKindContributionGiftTaxJS = function (p) {
    p = p || {};
    const caseType = p.caseType;
    if (['low_price', 'high_price'].indexOf(caseType) === -1) {
      return { error: 'caseType을 low_price(저가발행)/high_price(고가발행) 중에서 선택하세요.' };
    }
    const preValuePerShare = Number(p.preValuePerShare) || 0;
    const preShares = Number(p.preShares) || 0;
    const issuePricePerShare = Number(p.issuePricePerShare) || 0;
    const increasedShares = Number(p.increasedShares) || 0;
    if (preShares <= 0 || increasedShares <= 0) return { error: '현물출자전 발행주식총수와 현물출자로 증가한 주식수가 필요합니다.' };
    const postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);

    let giftAmount;
    if (caseType === 'low_price') {
      const allocatedShares = Number(p.allocatedShares) || 0;
      giftAmount = Math.max(0, Math.round((postValuePerShare - issuePricePerShare) * allocatedShares));
    } else {
      const acquiredShares = Number(p.acquiredShares) || 0;
      const relatedShareholderRatio = Number(p.relatedShareholderRatio) || 0;
      giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * acquiredShares * relatedShareholderRatio));
    }
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 같은 호(caseType)의 이익이 더 있으면 합산해 기준금액을 계산.
    const thisTransactionGiftAmount = giftAmount;
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    giftAmount = thisTransactionGiftAmount + priorBenefitSum;
    if (caseType === 'high_price') {
      const diffRatio = postValuePerShare > 0 ? (issuePricePerShare - postValuePerShare) / postValuePerShare : 0;
      if (!(diffRatio >= 0.3 || giftAmount >= 300000000)) {
        return { 과세대상여부: false, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount, 납부세액: 0, 안내: '차액비율이 30% 미만이고 이익도 3억원 미만이어서 과세하지 않습니다(시행령§29의3②).' + aggNote };
      }
    }

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 현물출자후1주당평가액: Math.round(postValuePerShare), 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 현물출자 납입일 등입니다(시행령§29①을 준용). §39(증자에 따른 이익의 증여)와 계산구조가 같습니다.'
        + (caseType === 'low_price'
          ? ' §39의3②·시행령§29⑤ — 현물출자자가 아닌 주주등 중 소액주주(지분 1% 미만이면서 액면가액 합계 3억원 미만)가 2명 이상이면, 그 소액주주들을 1명으로 보고 특수관계 여부 등을 판단해야 합니다.'
          : '') + aggNote
    };
  };

  // 국외자산 양도소득세 (소득세법§118의2~§118의8) — 국내자산 양도세와 완전히 별도로 계산한다. 양도일까지
  // 계속 5년 이상 국내에 주소·거소를 둔 거주자가 국외 토지·건물·부동산에관한권리·기타자산을 양도할 때
  // 적용된다. 세율은 §55①(국내양도세와 같은 기본누진세율표)을 그대로 쓰되 장기보유특별공제는 적용하지
  // 않는다(§118의8단서). 기본공제는 국내양도세와 별개로 연250만원(§118의7①). 외국납부세액공제 한도는
  // §118의6①·시행령§178의7: 산출세액 × (국외자산양도소득금액 ÷ 해당 과세기간 양도소득금액 합계액) —
  // 같은 과세기간에 국내자산 양도소득금액이 함께 있으면 domesticTransferIncomeAmount로 입력하면 정확한
  // 비율로 한도를 계산하고, 입력하지 않으면(국외자산양도소득만 있는 경우) 비율이 1이 되어 한도=산출세액과
  // 같아진다. 또는 필요경비산입 방법을 선택할 수 있다(필요경비산입 방법을 쓰려면 이미 필요경비에 포함해
  // 입력하고 세액공제는 0으로 둔다).
  window.calculateOverseasAssetTransferTaxJS = function (p) {
    p = p || {};
    if (!p.wasResidentFiveYearsContinuously) {
      return { 적용여부: false, 안내: '양도일까지 계속 5년 이상 국내에 주소 또는 거소를 둔 거주자가 아니어서 국외자산 양도소득세(§118의2) 적용대상이 아닙니다.' };
    }
    const transferPrice = Number(p.transferPrice) || 0;
    if (transferPrice <= 0) return { error: '양도가액이 필요합니다.' };
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const capitalExpenditure = Number(p.capitalExpenditure) || 0;
    const transferExpenses = Number(p.transferExpenses) || 0;
    const gain = transferPrice - acquisitionPrice - capitalExpenditure - transferExpenses;

    const basicDeduction = Math.min(2500000, Math.max(0, gain));
    const taxBase = Math.max(0, gain - basicDeduction);
    const calculatedTax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS);

    const foreignTaxCreditMethod = p.foreignTaxCreditMethod === 'expense' ? 'expense' : 'credit';
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const domesticTransferIncomeAmount = Math.max(0, Number(p.domesticTransferIncomeAmount) || 0);
    const totalIncomeAmountForRatio = Math.max(0, gain) + domesticTransferIncomeAmount;
    const creditRatio = totalIncomeAmountForRatio > 0 ? Math.max(0, gain) / totalIncomeAmountForRatio : 1;
    const foreignTaxCreditLimit = Math.round(calculatedTax * creditRatio);
    const foreignTaxCredit = foreignTaxCreditMethod === 'credit' ? Math.min(foreignTaxPaidAmount, foreignTaxCreditLimit) : 0;
    const taxAfterCredit = Math.max(0, calculatedTax - foreignTaxCredit);

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const localIncomeTax = Math.round(taxAfterCredit * 0.1);
    const totalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax);

    return {
      적용여부: true,
      양도차익: Math.round(gain), 기본공제: basicDeduction, 과세표준: taxBase,
      산출세액: calculatedTax, 외국납부세액공제한도: foreignTaxCreditLimit, 외국납부세액공제: foreignTaxCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      지방소득세: localIncomeTax, 납부세액_합계: totalTax,
      안내: '장기보유특별공제는 국외자산에는 적용되지 않습니다(§118의8단서). 기본공제(연250만원)는 국내자산 양도소득과 별도로 적용됩니다(§118의7). 양도가액·취득가액은 원칙적으로 실지거래가액이며, 확인 안 되면 소재국 시가(그래도 안되면 대통령령이 정하는 방법)를 씁니다. 국외전출자 국내주식등 출국세(§118의9~118의18)는 2027.1.1 시행 예정이라 아직 시행 전이며 핵심 세율표도 확인되지 않아 이 계산기가 다루지 않습니다. 같은 과세기간에 국외자산을 2건 이상 양도했다면 이 함수 대신 calculateOverseasAssetTransferTaxMultiJS로 합산 계산해야 기본공제(§118의7①) 중복적용을 막을 수 있습니다.'
    };
  };

  // 국외자산 양도소득세 다건 합산 (소득세법§118의7①) — calculateOverseasAssetTransferTaxJS(단일거래)는
  // 거래마다 기본공제(연250만원)를 각각 적용해버리므로, 같은 과세기간에 국외자산을 2건 이상 양도하면
  // 이 함수로 합산해야 §118의7①(전체 통틀어 1회)을 정확히 반영한다.
  window.calculateOverseasAssetTransferTaxMultiJS = function (transactions, filingParams) {
    filingParams = filingParams || {};
    if (!Array.isArray(transactions) || !transactions.length) return { error: '거래 목록(transactions)이 1건 이상 필요합니다.' };

    let totalGain = 0;
    let totalForeignTaxPaid = 0;
    const perTxn = [];
    for (let i = 0; i < transactions.length; i++) {
      const t = transactions[i] || {};
      if (!t.wasResidentFiveYearsContinuously) {
        return { error: (i + 1) + '번째 거래: 양도일까지 계속 5년 이상 국내에 주소·거소를 둔 거주자가 아니어서 §118의2 적용대상이 아닙니다.' };
      }
      const transferPrice = Number(t.transferPrice) || 0;
      if (transferPrice <= 0) return { error: (i + 1) + '번째 거래: 양도가액이 필요합니다.' };
      const acquisitionPrice = Number(t.acquisitionPrice) || 0;
      const capitalExpenditure = Number(t.capitalExpenditure) || 0;
      const transferExpenses = Number(t.transferExpenses) || 0;
      const gain = transferPrice - acquisitionPrice - capitalExpenditure - transferExpenses;
      totalGain += gain;
      const method = t.foreignTaxCreditMethod === 'expense' ? 'expense' : 'credit';
      const paid = method === 'credit' ? (Number(t.foreignTaxPaidAmount) || 0) : 0;
      totalForeignTaxPaid += paid;
      perTxn.push({ idx: i, 양도차익: Math.round(gain), 외국납부세액_공제신청액: paid });
    }

    const basicDeduction = Math.min(2500000, Math.max(0, totalGain));
    const taxBase = Math.max(0, totalGain - basicDeduction);
    const calculatedTax = progressiveTax(taxBase, TRANSFER_TAX_BRACKETS);

    const domesticTransferIncomeAmount = Math.max(0, Number(filingParams.domesticTransferIncomeAmount) || 0);
    const totalIncomeAmountForRatio = Math.max(0, totalGain) + domesticTransferIncomeAmount;
    const creditRatio = totalIncomeAmountForRatio > 0 ? Math.max(0, totalGain) / totalIncomeAmountForRatio : 1;
    const foreignTaxCreditLimit = Math.round(calculatedTax * creditRatio);
    const foreignTaxCredit = Math.min(totalForeignTaxPaid, foreignTaxCreditLimit);
    const taxAfterCredit = Math.max(0, calculatedTax - foreignTaxCredit);

    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(filingParams.filingStatus) !== -1 ? filingParams.filingStatus : 'ontime';
    const penalties = giftFilingPenalties(taxAfterCredit, filingStatus, !!filingParams.isFraudulent, filingParams.underreportedTaxAmount, filingParams.unpaidDays, Number(filingParams.unpaidTaxForLatePenalty), !!filingParams.isOffshoreTransaction, filingParams.monthsAfterDesignatedDueDate, Number(filingParams.unpaidTaxAtDesignatedDueDate), filingParams.fraudulentUnderreportedTaxAmount);
    const localIncomeTax = Math.round(taxAfterCredit * 0.1);
    const totalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax);

    return {
      거래건수: transactions.length,
      거래별_내역: perTxn,
      합산양도차익: Math.round(totalGain), 기본공제: basicDeduction, 과세표준: taxBase,
      산출세액: calculatedTax, 외국납부세액공제한도: foreignTaxCreditLimit, 외국납부세액공제: foreignTaxCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      지방소득세: localIncomeTax, 납부세액_합계: totalTax,
      안내: '국외자산은 §118의7①에 따라 여러 건을 양도해도 기본공제(연250만원)를 통틀어 1회만 적용합니다(국내자산처럼 자산 종류별로 나누지 않음). 장기보유특별공제는 국외자산에 적용되지 않습니다. foreignTaxCreditMethod가 expense인 거래는 이미 필요경비에 포함해 입력했다고 보아 세액공제 대상에서 제외했습니다.'
    };
  };

  // 감자에 따른 이익의 증여 (상증세법§39의2, 시행령§29의2) — 대주주등이 소유주식등을 시가보다 낮은
  // 대가로 소각당하면(다른 주주가 상대적으로 이익을 얻음, 1호), 반대로 소액주주 등이 시가보다 높은 대가로
  // 소각되면(소각된 주주 본인이 이익을 얻음, 2호, 1주당평가액이 액면가에 미달하는 경우만) 각각 그 차액
  // 상당의 이익을 증여의제한다. 게이트: 기준금액 3억원, 다만 1주당평가액-지급액의 차액비율이 30%이상이면
  // 기준금액은 0(무조건 과세). §39의2는 합산배제증여재산이 아니므로 일반 증여세 산식을 따른다.
  // 1호(저가소각) = (1주당평가액-지급액) × 총감자주식수 × 대주주등의감자후지분비율 × (특수관계인감자
  //   주식수 ÷ 총감자주식수) — 사용자가 시행령§29의2①1호를 직접 타이핑해 제공했고, 마지막 항의 "+"는
  //   문맥상(다른 모든 항이 분수형태) "÷"의 오타로 확인해(사용자 확인) "÷"로 구현했다.
  // 2호(고가소각) = (지급액-1주당평가액) × 해당주주등의감자주식수
  window.calculateCapitalReductionGiftTaxJS = function (p) {
    p = p || {};
    const caseType = p.caseType;
    if (['low_price', 'high_price'].indexOf(caseType) === -1) {
      return { error: 'caseType을 low_price(저가소각)/high_price(고가소각) 중에서 선택하세요.' };
    }
    const valuePerShare = Number(p.valuePerShare) || 0;
    const paymentPerShare = Number(p.paymentPerShare) || 0;
    if (valuePerShare <= 0) return { error: '감자한 주식등의 1주당 평가액이 필요합니다.' };

    let giftAmount;
    if (caseType === 'low_price') {
      const totalReducedShares = Number(p.totalReducedShares) || 0;
      const postReductionOwnershipRatio = Number(p.postReductionOwnershipRatio) || 0;
      const relatedReducedShares = Number(p.relatedReducedShares) || 0;
      if (totalReducedShares <= 0) return { error: '총 감자 주식등의 수가 필요합니다.' };
      giftAmount = Math.max(0, Math.round((valuePerShare - paymentPerShare) * totalReducedShares * postReductionOwnershipRatio * (relatedReducedShares / totalReducedShares)));
    } else {
      // 시행령§29의2①2호 — 고가소각 과세는 "주식등의 1주당 평가액이 액면가액(대가가 액면가액에 미달하는
      // 경우에는 그 대가)에 미달하는 경우로 한정한다." 액면가 이상인 주식을 고가소각한 경우까지 과세하면
      // 안 되므로 이 전제조건을 확인해야 한다.
      const faceValuePerShare = Number(p.faceValuePerShare);
      if (!(faceValuePerShare > 0)) return { error: '고가소각(high_price)은 액면가액(faceValuePerShare)이 필요합니다(§29의2①2호 — 1주당평가액이 액면가 미달일 때만 과세).' };
      const effectiveFaceValue = Math.min(faceValuePerShare, paymentPerShare);
      if (!(valuePerShare < effectiveFaceValue)) {
        return { 과세대상여부: false, 증여의제이익: 0, 납부세액: 0, 안내: '1주당 평가액이 액면가액(대가가 액면가 미만이면 그 대가) 이상이어서 고가소각 증여의제 요건에 해당하지 않습니다(시행령§29의2①2호).' };
      }
      const ownReducedShares = Number(p.ownReducedShares) || 0;
      giftAmount = Math.max(0, Math.round((paymentPerShare - valuePerShare) * ownReducedShares));
    }

    const diffRatio = Math.abs(valuePerShare - paymentPerShare) / valuePerShare;
    const gateThreshold = diffRatio >= 0.3 ? 0 : 300000000;
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 같은 호(caseType)의 이익이 더 있으면 합산해 기준금액을 계산.
    const thisTransactionGiftAmount = giftAmount;
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    giftAmount = thisTransactionGiftAmount + priorBenefitSum;
    if (giftAmount < gateThreshold) {
      return {
        과세대상여부: false, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount, 납부세액: 0,
        안내: '이익(' + giftAmount + '원' + aggNote + ')이 기준금액(' + gateThreshold + '원) 미만이어서 과세하지 않습니다(시행령§29의2②).'
      };
    }

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 감자를 위한 주주총회결의일 등입니다(시행령§29의2①). 대주주등의 판정기준은 §38·§39의2와 동일합니다.' + aggNote
    };
  };

  // 장애인이 증여받은 재산의 과세가액 불산입 (상속세및증여세법§52의2) — 장애인이 재산을 증여받아 본인을
  // 수익자로 신탁(자익신탁)하거나 타인이 장애인을 수익자로 신탁(타익신탁)한 경우, 요건을 충족하면 그
  // 증여재산가액(자익) 또는 신탁수익(타익)을 증여세 과세가액에 산입하지 않는다. 장애인 생애 동안 자익
  // 신탁 증여재산가액과 타익신탁 설정당시 원본가액을 합산해 5억원이 한도다(§52의2③). 신탁 해지·만료
  // (1개월내 재가입 제외)·수익자변경·이익 타인귀속·원본감소 등 사후관리 위반시 즉시 증여세를 부과한다
  // (부득이한 사유·의료비 등 인출은 예외).
  window.calculateDisabledPersonTrustExclusionJS = function (p) {
    p = p || {};
    if (!p.meetsRequirements) {
      return { 적용여부: false, 안내: '신탁업자에게 신탁, 장애인이 신탁이익 전부를 받는 수익자일 것 등 §52의2①·②의 요건을 충족하지 못해 적용대상이 아닙니다.' };
    }
    const amount = Number(p.amount) || 0;
    if (amount <= 0) return { error: '증여받은 재산가액(자익신탁) 또는 신탁원본가액(타익신탁)이 필요합니다.' };
    const priorCumulativeAmount = Math.max(0, Number(p.priorCumulativeAmount) || 0);

    const triggerEvent = p.triggerEvent;
    if (triggerEvent && triggerEvent !== 'none' && !p.isExemptedReason) {
      return {
        적용여부: true, 즉시과세대상: true, 납부세액대상금액: amount,
        안내: '신탁 해지·만료(1개월 이내 재가입 제외)·수익자변경·이익의 타인귀속·신탁원본감소 등 사후관리 위반 사유가 발생해(§52의2④), 부득이한 사유나 의료비 등 인출에 해당하지 않는 한 그 재산가액을 증여받은 것으로 보아 즉시 증여세를 부과합니다.'
      };
    }

    const remainingLimit = Math.max(0, 500000000 - priorCumulativeAmount);
    const exclusionAmount = Math.min(amount, remainingLimit);
    const taxableAmount = amount - exclusionAmount;
    return {
      적용여부: true, 즉시과세대상: false,
      생애누적한도: 500000000, 기존누적활용액: priorCumulativeAmount, 이번한도잔액: remainingLimit,
      과세가액불산입액: exclusionAmount, 과세가액산입액: taxableAmount,
      안내: taxableAmount > 0
        ? '장애인이 살아있는 동안 자익신탁 증여재산가액과 타익신탁 원본가액을 합산한 5억원 한도(§52의2③)를 초과해, 초과분(' + taxableAmount + '원)은 과세가액에 산입합니다.'
        : '5억원 한도 이내여서 전액 증여세 과세가액에 산입하지 않습니다.'
    };
  };

  // 공익법인등에 출연한(출연받은) 재산에 대한 상속세·증여세 과세가액 불산입 (상속세및증여세법§16,§48①) —
  // 원칙적으로 공익법인등에 출연한 재산의 가액은 상속세(§16)·증여세(§48①) 과세가액에 산입하지 않는다.
  // 다만 내국법인의 의결권 있는 주식등을 출연하는 경우, 이번 출연분+합산대상 기존 보유분(§16②1호 가~다목/
  // §48①1~3호)의 합계가 발행주식총수등의 일정비율(원칙10%, 의결권미행사·자선장학사회복지목적 공익법인
  // 20%, 상호출자제한기업집단 특수관계 공익법인 5%, §48⑪요건미충족 공익법인 5%)을 초과하면 그 초과하는
  // 가액을 과세가액에 산입한다. §48②의 사후관리(용도외사용·3년내미사용·초과주식취득·운용소득미사용 등
  // 8개 사유에 따른 즉시증여세 부과)는 각 사유별 "대통령령으로 정하는 가액" 산정방법이 시행령별로 달라
  // 이 계산기가 다루지 않는다.
  window.calculateCharityDonationTaxExclusionJS = function (p) {
    p = p || {};
    const taxType = p.taxType;
    if (['inheritance', 'gift'].indexOf(taxType) === -1) return { error: 'taxType을 inheritance(상속세, §16)/gift(증여세, §48①) 중에서 선택하세요.' };
    const donatedAmount = Number(p.donatedAmount) || 0;
    if (donatedAmount <= 0) return { error: '출연재산가액이 필요합니다.' };
    const assetType = p.assetType;
    if (['general', 'stock'].indexOf(assetType) === -1) return { error: 'assetType을 general(일반재산)/stock(내국법인 의결권있는 주식등) 중에서 선택하세요.' };

    if (assetType === 'general') {
      return {
        과세가액불산입액: donatedAmount, 과세가액산입액: 0,
        안내: (taxType === 'inheritance' ? '상속세및증여세법§16①' : '상속세및증여세법§48①본문') + '에 따라 출연한 재산의 가액 전액을 과세가액에 산입하지 않습니다.'
      };
    }

    const ratioType = p.ratioType;
    const ratioMap = { general: 0.10, nonvoting_charity: 0.20, conglomerate_related: 0.05, noncompliant: 0.05 };
    if (!Object.prototype.hasOwnProperty.call(ratioMap, ratioType)) {
      return { error: 'ratioType을 general(원칙10%)/nonvoting_charity(의결권미행사+자선장학사회복지목적20%)/conglomerate_related(상호출자제한기업집단특수관계5%)/noncompliant(§48⑪요건미충족5%) 중에서 선택하세요.' };
    }
    const totalIssuedShares = Number(p.totalIssuedShares) || 0;
    const donatedShares = Number(p.donatedShares) || 0;
    if (totalIssuedShares <= 0 || donatedShares <= 0) return { error: '발행주식총수등과 출연하는 주식수가 필요합니다.' };
    const priorRelatedShares = Number(p.priorRelatedShares) || 0;

    const ratio = ratioMap[ratioType];
    const limitShares = totalIssuedShares * ratio;
    const combinedShares = donatedShares + priorRelatedShares;
    const excessShares = Math.max(0, combinedShares - limitShares);
    const excessSharesFromThisDonation = Math.min(excessShares, donatedShares);
    const valuePerShare = donatedAmount / donatedShares;
    const taxableInclusionAmount = Math.round(valuePerShare * excessSharesFromThisDonation);
    const exclusionAmount = donatedAmount - taxableInclusionAmount;

    return {
      한도비율: Math.round(ratio * 100), 한도주식수: Math.round(limitShares),
      합산주식수: combinedShares, 초과주식수: excessShares,
      과세가액불산입액: exclusionAmount, 과세가액산입액: taxableInclusionAmount,
      안내: (excessSharesFromThisDonation > 0
        ? '이번 출연분을 포함한 합산 주식수(' + combinedShares + '주)가 발행주식총수등의 ' + Math.round(ratio * 100) + '%(' + Math.round(limitShares) + '주)를 초과해, 그 초과분에 상당하는 가액(' + taxableInclusionAmount + '원)을 과세가액에 산입합니다(' + (taxType === 'inheritance' ? '§16②' : '§48①단서') + ').'
        : '합산 주식수가 한도(' + Math.round(ratio * 100) + '%, ' + Math.round(limitShares) + '주) 이내여서 전액 과세가액에 산입하지 않습니다.')
        + ' §48②의 8가지 사후관리 위반 사유(용도외사용·3년내미사용·초과주식취득·운용소득미사용 등)에 따른 즉시증여세 부과는 이 계산기가 다루지 않으니 해당 사안이면 별도로 확인하세요.'
    };
  };

  // 공익법인등에 대한 가산세 등 (상속세및증여세법§78) — §48②5호·7호 미달사용 기준금액은 §38⑤(운용소득)·
  // §38⑦(매각대금)·§38⑱(7호)의 산식으로 자동계산하거나, 이미 산정된 미달사용액을 직접 입력받는다.
  window.calculatePublicInterestOrgPenaltyJS = function (p) {
    p = p || {};
    const penaltyType = p.penaltyType;
    const validTypes = ['report_not_filed', 'stock_holding_exceeded_5pct', 'management_violation', 'director_excess',
      'stock_holding_exceeded_related', 'advertising', 'income_underused', 'dedicated_account_not_opened', 'dedicated_account_unused',
      'disclosure_violation', 'report_not_filed_5pct', 'cultural_heritage_status_not_filed', 'cultural_heritage_transfer_not_filed'];
    if (validTypes.indexOf(penaltyType) === -1) return { error: 'penaltyType을 ' + validTypes.join('/') + ' 중에서 선택하세요.' };

    let penaltyAmount, note;
    if (penaltyType === 'report_not_filed') {
      // §78③ — §48⑤ 출연재산 사용계획·진도 보고서 미제출·불분명
      const baseTaxAmount = Number(p.baseTaxAmount) || 0;
      if (baseTaxAmount <= 0) return { error: '미제출분 또는 불분명한 부분의 금액에 상당하는 상속세액(증여세액)이 필요합니다.' };
      penaltyAmount = Math.round(baseTaxAmount * 0.01);
      note = '§48⑤에 따른 출연재산 사용계획·진도 보고서를 미제출하거나 그 내용이 불분명하여 §78③에 따라 해당 금액에 상당하는 세액의 100분의 1을 가산세로 징수합니다.';
    } else if (penaltyType === 'stock_holding_exceeded_5pct') {
      // §78④ — §49① 주식등 보유기준(5%) 초과
      const excessStockValue = Number(p.excessStockValue) || 0;
      if (excessStockValue <= 0) return { error: '§49① 보유기준(5%)을 초과하는 주식등의 시가가 필요합니다.' };
      penaltyAmount = Math.round(excessStockValue * 0.05);
      note = '§49① 주식등 보유기준(5%)을 초과 보유해 §78④에 따라 그 초과분 시가의 100분의 5를 매년 말 현재 기준으로 가산세로 부과합니다(부과기간 최대 10년 — 매년 별도로 계산해야 합니다).';
    } else if (penaltyType === 'management_violation') {
      // §78⑤ — 세무확인 보고의무·장부작성비치의무(§51)·회계감사(§50③④) 불이행
      const revenueAndDonationAmount = Number(p.revenueAndDonationAmount) || 0;
      if (revenueAndDonationAmount <= 0) return { error: '해당 과세기간(사업연도)의 수입금액과 그 기간에 출연받은 재산가액의 합계가 필요합니다.' };
      const violationSubType = p.violationSubType;
      let raw = Math.round(revenueAndDonationAmount * 0.0007);
      if (violationSubType === 'tax_confirmation') raw = Math.max(raw, 1000000);
      penaltyAmount = raw;
      note = '§78⑤에 따라 (해당 과세기간·사업연도의 수입금액+그 기간에 출연받은 재산가액)×1만분의7을 상속세(증여세)로 징수합니다' + (violationSubType === 'tax_confirmation' ? '(세무확인 보고의무 불이행의 경우 계산된 금액이 100만원 미만이면 100만원으로 합니다).' : '(장부작성·비치의무 또는 회계감사의무 불이행).');
    } else if (penaltyType === 'director_excess') {
      // §78⑥ — §48⑧ 이사 정원(5분의1, 최소5명 기준) 초과 이사·특수관계인 임직원
      const relatedExpenseAmount = Number(p.relatedExpenseAmount) || 0;
      if (relatedExpenseAmount <= 0) return { error: '§48⑧을 초과하는 이사·임직원과 관련하여 지출된 직접경비·간접경비 금액이 필요합니다.' };
      penaltyAmount = relatedExpenseAmount;
      note = '§48⑧에 따른 이사 정원(현재 이사 수의 5분의 1, 이사 수가 5명 미만이면 5명 기준)을 초과하는 이사가 있거나 출연자·특수관계인이 임직원이 되어, §78⑥에 따라 그와 관련해 지출된 직접·간접경비 전액을 매년 가산세로 부과합니다.';
    } else if (penaltyType === 'stock_holding_exceeded_related') {
      // §78⑦ — §48⑨ 특수관계 내국법인 주식등 보유한도(총재산가액의 30%, 요건충족시 50%) 초과
      const stockValue = Number(p.stockValue) || 0;
      const totalAssetValue = Number(p.totalAssetValue) || 0;
      if (stockValue <= 0 || totalAssetValue <= 0) return { error: '보유 중인 특수관계 내국법인 주식등의 가액과 공익법인등의 총재산가액이 필요합니다.' };
      const limitRatio = p.meetsComplianceRequirements ? 0.5 : 0.3;
      const limitValue = totalAssetValue * limitRatio;
      const excessValue = Math.max(0, stockValue - limitValue);
      penaltyAmount = Math.round(excessValue * 0.05);
      note = '§48⑨에 따른 특수관계 내국법인 주식등 보유한도(총재산가액의 ' + Math.round(limitRatio * 100) + '% — 회계감사·전용계좌·결산공시 의무를 모두 이행하면 50%, 아니면 30%)를 초과 보유해 §78⑦에 따라 그 초과분(' + excessValue + '원) 시가의 100분의 5를 매 사업연도 말 기준으로 가산세로 부과합니다.';
    } else if (penaltyType === 'advertising') {
      // §78⑧ — §48⑩ 특수관계 내국법인을 위한 무상 광고·홍보
      const directExpenseAmount = Number(p.directExpenseAmount) || 0;
      if (directExpenseAmount <= 0) return { error: '특수관계 내국법인의 이익 증가를 위해 정당한 대가 없이 지출한 광고·홍보 직접경비가 필요합니다.' };
      penaltyAmount = directExpenseAmount;
      note = '§48⑩에 따라 특수관계에 있는 내국법인의 이익을 증가시키기 위해 정당한 대가를 받지 않고 광고·홍보를 하여, §78⑧에 따라 그 행위와 관련해 직접 지출된 경비 상당액을 가산세로 부과합니다.';
    } else if (penaltyType === 'income_underused') {
      // §78⑨ — 1호(운용소득 기준금액 미달), 2호(매각대금 기준금액 미달), 3호(§48②7호 기준금액 미달) 중
      // 해당하는 것마다 각각 가산세를 계산하되, "제1호와 제3호에 동시에 해당하는 경우에는 더 큰 금액으로
      // 한다"(1호·3호 중 큰 쪽 하나만 적용, 둘을 더하지 않음). 200% 세율은 3호(§48②7호가목 유형 법인)에만
      // 적용되고 1호·2호는 항상 10%다 — 이전 코드는 세 가지 중 먼저 계산되는 값 하나만 채택하고, 그 값이
      // 1호·2호에서 나왔어도 isHighRateType이면 200%를 적용하는 오류가 있었다.
      const isHighRateType = !!p.isSect48_2_7HighHoldingType;
      let baseNote = '';

      // 1호 — 운용소득 기준금액 미달(시행령§38⑤), 항상 10%
      const operatingIncomeAmount = Number(p.operatingIncomeAmount) || 0;
      const taxAndCarryforwardLossAmount = Number(p.taxAndCarryforwardLossAmount) || 0;
      let operatingIncomeUnderused = Number(p.operatingIncomeUnderusedAmount) || 0;
      if (operatingIncomeUnderused <= 0 && operatingIncomeAmount > 0) {
        const operatingIncome = Math.max(0, operatingIncomeAmount - taxAndCarryforwardLossAmount);
        const usageStandardAmount = Math.round(operatingIncome * 0.8);
        const actualOperatingIncomeUsedAmount = Number(p.actualOperatingIncomeUsedAmount) || 0;
        operatingIncomeUnderused = Math.max(0, usageStandardAmount - actualOperatingIncomeUsedAmount);
        if (operatingIncomeUnderused > 0) baseNote += '[1호] 시행령§38⑤에 따라 [수익사업 소득금액 등 합계(' + operatingIncomeAmount + '원)－법인세등 및 이월결손금(' + taxAndCarryforwardLossAmount + '원)]의 80%인 사용기준금액에서 실제 사용액을 차감한 운용소득 미달사용액=' + operatingIncomeUnderused + '원. ';
      }
      const amount1Penalty = Math.round(operatingIncomeUnderused * 0.10);

      // 2호 — 매각대금 기준금액 미달(시행령§38⑦), 항상 10%(1호·3호와 "더 큰 금액" 비교 대상 아님, 별개 산정)
      const saleProceedsAmount = Number(p.saleProceedsAmount) || 0;
      const saleCheckpointYear = Number(p.saleCheckpointYear);
      let saleUnderused = 0;
      if (saleProceedsAmount > 0 && (saleCheckpointYear === 1 || saleCheckpointYear === 2)) {
        const requiredRatio = saleCheckpointYear === 2 ? 0.60 : 0.30;
        const requiredAmount = Math.round(saleProceedsAmount * requiredRatio);
        const cumulativeActualUsedAmount = Number(p.cumulativeActualUsedAmount) || 0;
        saleUnderused = Math.max(0, requiredAmount - cumulativeActualUsedAmount);
        if (saleUnderused > 0) baseNote += '[2호] 시행령§38⑦에 따라 매각대금(' + saleProceedsAmount + '원)의 ' + (saleCheckpointYear === 2 ? '2년 이내 60%' : '1년 이내 30%') + '(' + requiredAmount + '원)에서 누적 실제사용액(' + cumulativeActualUsedAmount + '원)을 차감한 매각대금 미달사용액=' + saleUnderused + '원. ';
      }
      const amount2Penalty = Math.round(saleUnderused * 0.10);

      // 3호 — §48②7호 기준금액 미달(시행령§38⑱), 10% 또는 200%(isHighRateType)
      const totalAssetValue = Number(p.totalAssetValue) || 0;
      const liabilityValue = Number(p.liabilityValue);
      const netIncomeValue = Number(p.netIncomeValue);
      let directUseUnderused = Number(p.directUseUnderusedAmount) || 0;
      if (directUseUnderused <= 0 && totalAssetValue > 0 && Number.isFinite(liabilityValue) && Number.isFinite(netIncomeValue)) {
        // 시행령§38⑱ — §48②7호의 "대통령령으로 정하는 출연받은 재산의 가액"(수익용·수익사업용으로 운용하는
        // 재산, 직접공익목적사업용 재산 제외)은 [총자산가액－(부채가액＋당기순이익)]으로 계산하고, 여기에
        // 1%(또는 3%)를 곱한 금액이 "기준금액"이다. 3년~5년 미만/5년 이상 보유한 상장주식의 가액은 각각
        // 직전 3개/5개 과세기간(사업연도) 평균액을 쓰도록 정하나, 그 세부 산정은 이 계산기가 다루지 않는다
        // (totalAssetValue에 이미 반영된 값을 입력해야 함). 재무상태표상 자산가액이 상증세법상 평가액의
        // 70% 이하인 특정 공익법인등(§41의2⑥ 또는 §43③단서 해당 공익법인등)은 평가액을 기준으로 이 산식을
        // 적용하므로, 그 경우 totalAssetValue에 상증세법상 평가액을 넣고 useAssessedValueBasis를 true로
        // 표시하면 된다(계산식 자체는 동일).
        const operatingAssetValue = Math.max(0, totalAssetValue - (liabilityValue + netIncomeValue));
        const standardAmount = Math.round(operatingAssetValue * (isHighRateType ? 0.03 : 0.01));
        const actualDirectUseAmount = Number(p.actualDirectUseAmount) || 0;
        directUseUnderused = Math.max(0, standardAmount - actualDirectUseAmount);
        if (directUseUnderused > 0) baseNote += '[3호] 시행령§38⑱에 따라 [총자산가액(' + totalAssetValue + '원)－(부채가액(' + liabilityValue + '원)＋당기순이익(' + netIncomeValue + '원))]=' + operatingAssetValue + '원(수익용·수익사업용 운용재산가액)에 ' + (isHighRateType ? '3%' : '1%') + '를 곱한 기준금액(' + standardAmount + '원)에서 실제 직접공익목적사업 사용액(' + actualDirectUseAmount + '원)을 차감한 미달사용액=' + directUseUnderused + '원' + (p.useAssessedValueBasis ? '(평가액 기준)' : '') + '. ';
      }
      const amount3Penalty = Math.round(directUseUnderused * (isHighRateType ? 2.0 : 0.10));

      // legacy 직접입력(underusedAmount)은 어느 호인지 알 수 없어 기존처럼 isHighRateType 하나로만 계산.
      const legacyUnderused = Number(p.underusedAmount) || 0;
      const legacyPenalty = legacyUnderused > 0 ? Math.round(legacyUnderused * (isHighRateType ? 2.0 : 0.10)) : 0;

      penaltyAmount = Math.max(Math.max(amount1Penalty, amount3Penalty) + amount2Penalty, legacyPenalty);
      if (penaltyAmount <= 0) return { error: '기준금액에 미달하여 사용하지 않은 금액을 직접 입력하거나(underusedAmount), §48②7호 기준금액을 계산하려면 총자산가액·부채가액·당기순이익·실제직접사용액을, §48②5호 매각대금 기준금액을 계산하려면 매각대금·확인시점(1년/2년)·누적실제사용액을, §48②5호 운용소득 기준금액을 계산하려면 수익사업소득금액등합계·법인세등및이월결손금·실제사용액을 입력하세요.' };
      note = baseNote + '§78⑨에 따라 1호(운용소득 미달, 10%)·3호(§48②7호 미달, ' + (isHighRateType ? '200%' : '10%') + ') 중 큰 금액과 2호(매각대금 미달, 10%, 별개 가산)를 더해 가산세를 계산했습니다(1호·3호 동시해당시 더 큰 쪽만 적용).';
    } else if (penaltyType === 'dedicated_account_not_opened') {
      // §78⑩2호 — §50의2③ 전용계좌 개설·신고를 하지 않은 경우: 가목·나목 금액 중 큰 금액
      const directBusinessRevenueAmount = Number(p.directBusinessRevenueAmount) || 0;
      const unregisteredDays = Number(p.unregisteredDays) || 0;
      const totalPeriodDays = Number(p.totalPeriodDays) || 0;
      const totalRelevantTransactionAmount = Number(p.totalRelevantTransactionAmount) || 0;
      if ((directBusinessRevenueAmount <= 0 || unregisteredDays <= 0 || totalPeriodDays <= 0) && totalRelevantTransactionAmount <= 0) return { error: '가목 계산을 위한 직접 공익목적사업 관련 수입금액 총액·전용계좌 미개설·미신고 일수(신고기한 다음날부터 신고일 전날까지)·해당 과세기간(사업연도) 총 일수, 또는 나목 계산을 위한 §50의2①1~4호 거래금액 합계액 중 최소 하나는 입력해야 합니다.' };
      const amountA = (directBusinessRevenueAmount > 0 && unregisteredDays > 0 && totalPeriodDays > 0)
        ? Math.round(directBusinessRevenueAmount * (unregisteredDays / totalPeriodDays) * 0.005) : 0;
      const amountB = Math.round(totalRelevantTransactionAmount * 0.005);
      penaltyAmount = Math.max(amountA, amountB);
      note = '§50의2③을 위반해 전용계좌를 개설·신고하지 않아, §78⑩2호에 따라 가목[직접 공익목적사업 관련 수입금액 총액(' + directBusinessRevenueAmount + '원) × (미개설·미신고 일수(' + unregisteredDays + '일) / 해당 과세기간(사업연도) 일수(' + totalPeriodDays + '일)) × 1000분의 5 = ' + amountA + '원]과 나목[§50의2①1~4호 거래금액 합계(' + totalRelevantTransactionAmount + '원) × 1000분의 5 = ' + amountB + '원] 중 큰 금액을 가산세로 부과합니다.';
    } else if (penaltyType === 'dedicated_account_unused') {
      // §78⑩1호 — §50의2① 전용계좌 사용의무 위반
      const unusedTransactionAmount = Number(p.unusedTransactionAmount) || 0;
      if (unusedTransactionAmount <= 0) return { error: '전용계좌를 사용하지 않은 거래금액이 필요합니다.' };
      penaltyAmount = Math.round(unusedTransactionAmount * 0.005);
      note = '§50의2①에 해당하는 거래를 전용계좌로 하지 않아 §78⑩1호에 따라 그 미사용 거래금액의 1000분의 5를 가산세로 부과합니다. (전용계좌를 아예 개설·신고하지 않은 경우의 가산세는 §78⑩2호로 별도이며, penaltyType을 dedicated_account_not_opened로 선택하면 계산할 수 있습니다.)';
    } else if (penaltyType === 'disclosure_violation') {
      // §78⑪ — §50의3 결산서류등 공시의무 위반(시정요구 불이행). 단서: §50의3①단서에 따른 공익법인등
      // (소규모 등 간이공시 대상)의 2022.12.31 이전에 개시하는 과세기간·사업연도분 공시는 가산세를 부과하지 않는다.
      if (p.isExemptSmallOrgPreFY2023) {
        return { 가산세액: 0, 안내: '§78⑪단서 — §50의3①단서에 따른 공익법인등(소규모 등 간이공시 대상)의 2022.12.31 이전에 개시하는 과세기간·사업연도분 공시에는 가산세를 부과하지 않습니다.' };
      }
      const totalAssetValue = Number(p.totalAssetValue) || 0;
      if (totalAssetValue <= 0) return { error: '공시하여야 할 과세기간(사업연도) 종료일 현재 공익법인등의 자산총액이 필요합니다.' };
      penaltyAmount = Math.round(totalAssetValue * 0.005);
      note = '§50의3에 따른 결산서류등을 공시하지 않거나 공시 내용에 오류가 있는데도 공시·시정 요구를 지정기한까지 이행하지 않아, §78⑪에 따라 그 과세기간(사업연도) 종료일 현재 자산총액의 1000분의 5를 가산세로 부과합니다.';
    } else if (penaltyType === 'report_not_filed_5pct') {
      // §78⑭ — §48⑬ 의무이행 여부 신고 미이행
      const totalAssetValue = Number(p.totalAssetValue) || 0;
      if (totalAssetValue <= 0) return { error: '신고해야 할 과세기간(사업연도) 종료일 현재 공익법인등의 자산총액이 필요합니다.' };
      penaltyAmount = Math.round(totalAssetValue * 0.005);
      note = '§48⑬에 따라 내국법인 발행주식총수등의 5%를 초과해 주식등을 출연받은 공익법인등 등이 의무이행 여부를 신고하지 않아, §78⑭에 따라 그 과세기간(사업연도) 종료일 현재 자산총액의 1000분의 5(대통령령으로 정하는 한도 내)를 가산세로 부과합니다.';
    } else if (penaltyType === 'cultural_heritage_status_not_filed') {
      // §78⑮1호 — §74⑤ 납세담보 미제공자가 §74⑥ 보유현황 자료를 미제출
      const deferredTaxAmount = Number(p.deferredTaxAmount) || 0;
      if (deferredTaxAmount <= 0) return { error: '징수유예 받은 상속세액이 필요합니다.' };
      penaltyAmount = Math.round(deferredTaxAmount * 0.01);
      note = '§74⑤에 따라 납세담보를 제공하지 않은 자가 §74⑥의 국가지정문화유산등·천연기념물등 보유현황 자료를 제출하지 않아, §78⑮1호에 따라 징수유예 받은 상속세액의 100분의 1을 징수합니다.';
    } else { // cultural_heritage_transfer_not_filed
      // §78⑮2호 — §74⑤ 납세담보 미제공자가 §74⑦ 양도 사실을 미신고
      const deferredTaxAmount = Number(p.deferredTaxAmount) || 0;
      if (deferredTaxAmount <= 0) return { error: '징수유예 받은 상속세액이 필요합니다.' };
      penaltyAmount = Math.round(deferredTaxAmount * 0.20);
      note = '§74⑤에 따라 납세담보를 제공하지 않은 자가 §74⑦에 따른 국가지정문화유산등·천연기념물등의 양도 사실을 신고하지 않아, §78⑮2호에 따라 징수유예 받은 상속세액의 100분의 20을 징수합니다.';
    }

    // 국세기본법§49①4호 — §78③·⑤(제50조①②의무 위반만 해당)·⑭에 따른 가산세는 의무위반 종류별로
    // 5천만원(중소기업이 아닌 기업은 1억원)을 한도로 하며, 고의적으로 위반한 경우에는 한도가 적용되지 않는다.
    const cappedTypes = ['report_not_filed', 'management_violation', 'report_not_filed_5pct'];
    if (cappedTypes.indexOf(penaltyType) !== -1 && !(penaltyType === 'management_violation' && p.violationSubType === 'tax_confirmation') && !p.isIntentionalViolation) {
      const limit = p.isNonSmeEnterprise ? 100000000 : 50000000;
      if (penaltyAmount > limit) {
        note += ' 국세기본법§49①4호에 따라 이 가산세는 의무위반 종류별로 ' + (p.isNonSmeEnterprise ? '1억원(중소기업이 아닌 기업)' : '5천만원(중소기업)') + '을 한도로 하므로, 산출된 ' + penaltyAmount + '원 대신 ' + limit + '원을 가산세액으로 합니다.';
        penaltyAmount = limit;
      }
    }

    return { 가산세액: penaltyAmount, 안내: note };
  };

  // 국가에 양도하는 산지에 대한 양도소득세의 감면 (조특법§85의10) — 2년 이상 보유한 산지(도시지역
  // 소재 제외)를 2022.12.31 이전에 국유림법§18에 따라 국가에 양도하면 그 양도소득세의 10%를 감면한다.
  window.calculateNationalForestLandReductionJS = function (p) {
    p = p || {};
    const transferDate = p.transferDate;
    if (!transferDate) return { error: '양도일이 필요합니다.' };
    if (new Date(transferDate).getTime() > new Date('2022-12-31').getTime()) {
      return { 적용여부: false, 안내: '양도일이 2022.12.31을 초과하여 조특법§85의10의 적용대상이 아닙니다(신청기한 만료).' };
    }
    const holdingYears = Number(p.holdingYears) || 0;
    if (holdingYears < 2) {
      return { 적용여부: false, 안내: '2년 이상 보유한 산지가 아니어서 적용대상이 아닙니다.' };
    }
    // §85의10① — "「산지관리법」에 따른 산지(「국토의 계획 및 이용에 관한 법률」에 따른 도시지역에
    // 소재하는 산지를 제외하며...)" — 도시지역 소재 산지는 감면 대상에서 명시적으로 제외된다.
    if (p.isUrbanArea) {
      return { 적용여부: false, 안내: '「국토의 계획 및 이용에 관한 법률」에 따른 도시지역에 소재하는 산지는 조특법§85의10 감면 대상에서 제외됩니다.' };
    }
    const transferPrice = Number(p.transferPrice) || 0;
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;
    const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;
    return {
      적용여부: true,
      전체양도차익: Math.round(totalGain),
      세액감면율: 10,
      안내: '조특법§85의10 — 2년 이상 보유한 산지(도시지역 소재 제외)를 국유림의 경영 및 관리에 관한 법률§18에 따라 국가에 양도할 때는 그 양도소득세 산출세액의 100분의 10을 감면합니다. 위 일반 양도세 계산기로 전체 양도차익 기준 세액을 계산한 뒤, 그 산출세액에서 10%를 차감하세요. 이 감면세액은 조특법§133①1호에 따라 같은 과세기간 중 §43·§69·§69의2~4·§70 감면세액과 합산해 1억원을 넘으면 그 초과분을 감면받지 못합니다.'
    };
  };

  // 공공매입임대주택 건설을 목적으로 양도한 토지에 대한 과세특례 (조특법§97의10, 2027.12.31까지
  // 양도분) — Code.js toolCalculatePublicRentalHousingLandReduction와 1:1 대응.
  window.calculatePublicRentalHousingLandReductionJS = function (p) {
    p = p || {};
    const transferDate = p.transferDate;
    if (!transferDate) return { error: '양도일이 필요합니다.' };
    if (transferDate > '2027-12-31') {
      return { 적용여부: false, 안내: '양도일이 2027.12.31을 초과하여 조특법§97의10의 적용대상이 아닙니다(적용기한 만료).' };
    }
    if (p.isNotBuiltWithin3Years && !p.hasJustifiableDelayReason) {
      const originalReductionAmount = Number(p.originalReductionAmount) || 0;
      return {
        적용여부: false, 감면유지여부: false, 추징액: originalReductionAmount,
        안내: '주택건설사업자가 토지를 양도받은 날부터 3년 이내에 공공매입임대주택을 건설하여 공공주택사업자에게 양도하지 않아(조특법§97의10③) 감면세액 ' + originalReductionAmount + '원을 이자상당액과 함께 추징합니다(제63조③ 준용).'
      };
    }
    const transferPrice = Number(p.transferPrice) || 0;
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;
    const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;
    return {
      적용여부: true,
      전체양도차익: Math.round(totalGain),
      세액감면율: 10,
      안내: '조특법§97의10 — 공공매입임대주택을 건설할 주택건설사업자(공공주택사업자와 건설·양도 약정을 체결한 자)에게 2027.12.31까지 주택건설용 토지를 양도하면 그 양도소득세 산출세액의 100분의 10을 감면합니다. 위 일반 양도세 계산기로 전체 양도차익 기준 세액을 계산한 뒤 그 산출세액에서 10%를 차감하세요. 토지를 양도받은 날부터 3년 이내에 공공매입임대주택을 건설해 공공주택사업자에게 양도하지 않으면(인허가 지연 등 부득이한 사유 제외) 감면세액과 이자상당액을 추징합니다.'
    };
  };

  // 산업단지 개발사업 시행에 따른 이주택지 양도소득세 세율특례 (조특법§104의20) — 산업단지 이주자가
  // 분양받은 이주택지(분양가 1억원 이하)를 2012.12.31까지 양도하면, 다주택중과세율(소득세법§104①2·3호)
  // 대신 기본세율(같은 항 1호)을 적용한다. 세액 자체는 위 일반 양도세 계산기에서 다주택 중과 옵션을
  // 끄고(조정대상지역 아님·소유주택수 무관) 계산하면 되므로 이 함수는 적용 가능 여부만 판정한다.
  window.calculateIndustrialComplexRelocationLotRateJS = function (p) {
    p = p || {};
    const transferDate = p.transferDate;
    if (!transferDate) return { error: '양도일이 필요합니다.' };
    if (new Date(transferDate).getTime() > new Date('2012-12-31').getTime()) {
      return { 적용여부: false, 안내: '양도일이 2012.12.31을 초과하여 조특법§104의20의 적용대상이 아닙니다(적용기한 만료).' };
    }
    const salePrice = Number(p.salePrice) || 0;
    if (salePrice > 100000000) {
      return { 적용여부: false, 안내: '분양가격이 1억원을 초과하여 적용대상이 아닙니다.' };
    }
    if (!p.wasResidentForTwoYears) {
      return { 적용여부: false, 안내: '실시계획승인일부터 소급 2년 이상 그 사업을 위해 제공된 주거용 건축물에서 거주한 이주자가 아니어서 적용대상이 아닙니다.' };
    }
    return {
      적용여부: true,
      안내: '조특법§104의20에 따라 다주택중과세율(소득세법§104①2·3호) 대신 기본세율(같은 항 1호)을 적용합니다. 위 일반 양도세 계산기에서 "조정대상지역 소재"를 체크 해제하고 "소유 주택 수"를 0으로 두어(중과 미적용) 계산하세요.'
    };
  };

  // 박물관 등의 이전에 대한 양도소득세의 과세특례 (조특법§83) — 3년 이상 운영한 박물관등의 종전시설을
  // 2022.12.31까지 양도하면, 그 양도소득세를 양도소득세 과세표준 확정신고기한 종료일 이후 3년이 되는
  // 날부터 5년의 기간 동안 균분한 금액 이상씩 분할납부할 수 있다(이자상당가산액 없음, 다만 3년이내
  // 미이전·처분·폐관시 §33③후단 준용 이자상당가산액 추징).
  window.calculateMuseumRelocationInstallmentJS = function (p) {
    p = p || {};
    const transferDate = p.transferDate;
    if (!transferDate) return { error: '양도일이 필요합니다.' };
    if (new Date(transferDate).getTime() > new Date('2022-12-31').getTime()) {
      return { error: '양도일이 2022.12.31을 초과하여 조특법§83의 적용대상이 아닙니다(적용기한 만료).' };
    }
    const totalTaxAmount = Number(p.totalTaxAmount) || 0;
    if (totalTaxAmount <= 0) return { error: '분할납부할 양도소득세액(종전시설 양도차익에 대한 산출세액)이 필요합니다.' };
    const installments = 5;
    const perInstallment = Math.round(totalTaxAmount / installments);
    const schedule = [];
    let remaining = totalTaxAmount;
    for (let i = 1; i <= installments; i++) {
      const amount = i === installments ? remaining : perInstallment;
      schedule.push({ 회차: i, 납부액: amount });
      remaining -= amount;
    }
    return {
      분할납부대상세액: totalTaxAmount,
      회차별_납부예정세액: schedule,
      안내: '신고기한 종료일 이후 3년이 되는 날부터 매년 균분(최소 1/5)해 5년간 분할납부합니다. 개관 후 3년 이내에 처분하거나 폐관하면(또는 애초에 이전하지 않으면) 남은 세액을 즉시 납부해야 하며 §33③후단을 준용한 이자상당가산액이 붙습니다(calculate_clawback_interest 도구로 별도 계산).'
    };
  };

  // 경영회생 지원을 위한 농지 매매 등에 대한 양도소득세 과세특례 (조특법§70의2) — 농업인이 한국농어촌
  // 공사에 양도한 농지등을 임차기간 내에 환매하면 당초 납부한 양도소득세를 환급받을 수 있고, 이후 그
  // 환매농지를 다시 양도할 때는 한국농어촌공사에 양도하기 전 원래의 취득가액·취득시기를 그대로 적용한다.
  window.calculateFarmlandRepurchaseRefundJS = function (p) {
    p = p || {};
    if (!p.wasRepurchasedWithinLeaseTerm) {
      return { 환급가능여부: false, 안내: '한국농어촌공사와의 임차기간 내에 해당 농지등을 환매하지 않아 조특법§70의2①의 환급대상이 아닙니다.' };
    }
    const originalTaxPaid = Number(p.originalTaxPaid) || 0;
    return {
      환급가능여부: true, 환급대상세액: originalTaxPaid,
      안내: '한국농어촌공사에 양도했던 농지등을 임차기간 내에 환매했으므로, 당초 그 농지등의 양도소득에 대해 납부한 양도소득세를 환급받을 수 있습니다(§70의2①, 환급신청 필요). 이후 이 환매농지를 다시 양도할 때는 한국농어촌공사에 양도하기 전 원래의 취득가액·취득시기를 그대로 적용해 양도세를 계산하세요(§70의2②) — 위 일반 양도세 계산기에 그 원래의 취득가액·취득일을 입력하면 됩니다.'
    };
  };

  // 장기임대주택 등에 대한 양도소득세 감면 (조특법§97,§97의2,§97의5, §97의4와는 별개 조문) — 모두 "양도
  // 소득세의 일정 비율을 세액감면"하는 정액감면 구조를 공유한다.
  // §97(2000.12.31 이전 임대개시 국민주택): 원칙 50% 감면, 건설임대주택 5년이상 임대 또는 매입임대주택
  //   (1995.1.1이후 취득, 무입주, 5년이상) 또는 10년이상 임대는 전액(100%) 면제 — 감면율이 양도소득
  //   "전체"에 적용된다(임대기간중 발생분만이 아님).
  // §97의2(1999.8.20~2001.12.31 신축임대주택): 5년이상 임대 후 양도시 전액(100%) 면제, 역시 전체 양도
  //   소득에 적용.
  // §97의5(2018.12.31까지 취득+3개월내 등록, 10년이상 계속임대 장기일반민간임대주택등): 임대기간 중
  //   발생한 양도소득에 대해서만 100% 감면(§97의3·§97의4와 중복적용 배제) — 등록일 평가액이 필요하다.
  window.calculateLongTermRentalHouseReductionJS = function (p) {
    p = p || {};
    const provision = p.provision;
    if (['sect97', 'sect97_2', 'sect97_5'].indexOf(provision) === -1) {
      return { error: 'provision을 sect97/sect97_2/sect97_5 중에서 선택하세요.' };
    }
    const transferPrice = Number(p.transferPrice) || 0;
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;
    const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;

    let rate, note;
    if (provision === 'sect97') {
      const subType = p.subType;
      if (subType === 'construction_5yr' || subType === 'purchase_5yr_novacancy' || subType === 'rental_10yr') {
        rate = 100;
        note = subType === 'construction_5yr' ? '건설임대주택으로서 5년 이상 임대한 임대주택이므로 양도소득세를 전액 면제합니다(§97①단서).'
          : subType === 'purchase_5yr_novacancy' ? '매입임대주택(1995.1.1 이후 취득, 취득당시 무입주)으로서 5년 이상 임대했으므로 양도소득세를 전액 면제합니다(§97①단서).'
          : '10년 이상 임대한 임대주택이므로 양도소득세를 전액 면제합니다(§97①단서).';
      } else {
        // §97①본문 원문: "...양도소득세의 100분의 50에 상당하는 세액을 감면한다" — 이는 소득금액을
        // 축소하는 방식(소득공제)이 아니라 산출세액 자체를 50% 차감하는 세액감면이다. 소득을 먼저
        // 축소해 일반계산기에 넣으면 정액 기본공제(250만원)·누진세율 구조 때문에 결과가 달라지므로
        // (100% 면제는 0=0이라 무관하지만 50%는 그렇지 않다), 아래에서 별도 처리한다.
        return {
          적용여부: true, 적용감면율: 50, 세액감면방식: true,
          전체양도차익: Math.round(totalGain),
          안내: '2000.12.31 이전 임대를 개시해 5년 이상 임대한 국민주택이므로 양도소득세의 50%를 감면합니다(§97①본문, 세액감면). 위 일반 양도세 계산기에 원래 양도차익(전체양도차익, 이 감면 미반영)을 그대로 입력해 감면 적용 전 산출세액을 구한 뒤, 그 산출세액(가산세·다른 세액공제 반영 전 본세)의 50%를 차감한 금액을 최종 납부세액으로 하세요.'
        };
      }
    } else if (provision === 'sect97_2') {
      rate = 100;
      note = '1999.8.20~2001.12.31 신축된(또는 그 이전 신축·무입주) 국민주택을 5년 이상 임대했으므로 양도소득세를 전액 면제합니다(§97의2①).';
    } else { // sect97_5
      rate = 100;
      note = '장기일반민간임대주택등으로 10년 이상 계속 임대 후 양도했으므로 임대기간 중 발생한 양도소득에 대한 양도소득세를 전액 감면합니다(§97의5①). §97의3·§97의4와 중복 적용되지 않습니다(§97의5②).';
    }

    let exemptGain;
    if (provision === 'sect97_5') {
      // 시행령§97의5② — 임대기간중 양도소득금액 = 전체양도소득금액 × (양도당시기준시가－등록일당시기준시가)
      // ÷ (양도당시기준시가－취득당시기준시가). 기준시가 3종이 모두 있으면 원문대로 계산하고, 없으면
      // "등록일 현재 평가액(실거래가 상당)"을 이용한 근사치로 대체한다.
      const acqStd = Number(p.acquisitionStandardPrice) || 0;
      const regStd = Number(p.registrationStandardPrice) || 0;
      const trfStd = Number(p.transferStandardPrice) || 0;
      let rentalPeriodGain, gainNote;
      if (acqStd > 0 && regStd > 0 && trfStd > 0 && trfStd !== acqStd) {
        rentalPeriodGain = totalGain * (trfStd - regStd) / (trfStd - acqStd);
        gainNote = ' 기준시가 비율로 정확히 계산했습니다: 전체양도소득금액 × (양도당시기준시가－등록일당시기준시가) ÷ (양도당시기준시가－취득당시기준시가).';
      } else {
        const registrationDateValue = Number(p.registrationDateValue) || 0;
        if (registrationDateValue <= 0) return { error: '기준시가 3종(취득당시·등록일당시·양도당시)을 모두 입력하거나, 그것이 없으면 최소한 등록일 현재의 평가액을 입력하세요(임대기간중 발생분 산정용).' };
        rentalPeriodGain = Math.max(0, transferPrice - registrationDateValue);
        gainNote = ' 기준시가 3종이 입력되지 않아, 입력하신 등록일 현재 평가액을 기준으로 근사 계산했습니다(정확한 산정은 기준시가 3종을 모두 입력하세요).';
      }
      note += gainNote;
      exemptGain = Math.round(Math.max(0, Math.min(rentalPeriodGain, totalGain)) * rate / 100);
    } else {
      exemptGain = Math.round(totalGain * rate / 100);
    }
    exemptGain = Math.max(0, Math.min(exemptGain, totalGain));
    const taxableGain = Math.max(0, totalGain - exemptGain);
    return {
      적용여부: true,
      적용감면율: rate,
      전체양도차익: Math.round(totalGain),
      감면대상_양도소득금액: Math.round(exemptGain),
      과세대상양도소득금액: taxableGain,
      안내: note + ' 이 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 계산기에서 별도 적용됩니다).'
    };
  };

  // 증자에 따른 이익의 증여 (상증세법§39, 시행령§29②) — 신주를 시가보다 낮거나 높은 가액으로 발행할 때
  // 실권주 배정 여부·저가/고가 여부에 따라 5가지 세부 케이스로 나뉜다. caseType으로 케이스를 선택한다.
  // low_allocated(시행령1호, 법§39①1호가·다·라목 — 저가발행, 실권주를 배정받거나 비주주가 직접배정
  //   받거나 균등초과배정받아 이익을 얻은 경우): 게이트 없음.
  //   이익 = (증자후1주당평가액 - 신주1주당인수가액) × 배정받은실권주수(또는 신주수)
  //   증자후1주당평가액 = [(증자전1주당평가액×증자전발행주식총수)+(신주1주당인수가액×증자로증가한주식수)]
  //     ÷ (증자전발행주식총수+증자로증가한주식수)
  // low_unallocated(시행령2호, 법§39①1호나목 — 저가발행, 실권주 미배정, 포기자의 특수관계인이 신주인수):
  //   게이트: (증자후1주당평가액-신주1주당인수가액)이 증자후1주당평가액의 30%이상, 또는 이익이 3억원이상.
  //   증자후1주당평가액(균등증자기준) = [(증자전1주당평가액×증자전발행주식총수)+(신주1주당인수가액×균등증자시증가주식수)]
  //     ÷ (증자전발행주식총수+균등증자시증가주식수)
  //   배정간주실권주수 = 실권주총수×증자후신주인수자의지분비율×(신주인수자의특수관계인의실권주수/실권주총수)
  //   이익 = (증자후1주당평가액 - 신주1주당인수가액) × 배정간주실권주수
  // high_allocated(시행령3호, 법§39①2호가목 — 고가발행, 실권주 배정): 게이트 없음.
  //   이익 = (신주1주당인수가액 - 증자후1주당평가액) × 배정간주실권주수(포기주주실권주수×(포기주주의특수관계인이인수한실권주수/실권주총수))
  //   증자후1주당평가액은 low_allocated와 동일 산식(실제 증가주식수 기준).
  // high_unallocated(시행령4호, 법§39①2호나목 — 고가발행, 실권주 미배정): 게이트: 이익이 3억원이상 또는
  //   (신주1주당인수가액-증자후1주당평가액)이 증자후1주당평가액(postValuePerShare)의 30%이상 — "제3호
  //   나목"(=증자후1주당평가액)이 분모이며, low_unallocated의 게이트 분모(증자후1주당평가액)와 동일한
  //   구조다(시행령§29② 원문 직접 재확인, 2026-08-21).
  //   이익 = (신주1주당인수가액-증자후1주당평가액) × 포기주주의실권주수 × (포기주주의특수관계인이인수한신주수/균등증자시주식총수)
  // high_nonshareholder(시행령5호, 법§39①2호다·라목 — 고가발행, 비주주직접배정 또는 균등초과배정):
  //   게이트 없음(시행령§29②5호 원문 확인 — 2·4호와 달리 "3억원 이상 또는 30%이상" 문턱 조항이 없다).
  //   이익 = (신주1주당인수가액-증자후1주당평가액) × 미달배정주주의그신주수 × (그특수관계인이인수한신주수/(비주주배정신주+균등초과인수신주총수))
  window.calculateCapitalIncreaseGiftTaxJS = function (p) {
    p = p || {};
    const caseType = p.caseType;
    const validCases = ['low_allocated', 'low_unallocated', 'high_allocated', 'high_unallocated', 'high_nonshareholder'];
    if (validCases.indexOf(caseType) === -1) {
      return { error: 'caseType을 low_allocated/low_unallocated/high_allocated/high_unallocated/high_nonshareholder 중에서 선택하세요.' };
    }
    const preValuePerShare = Number(p.preValuePerShare) || 0;
    const preShares = Number(p.preShares) || 0;
    const issuePricePerShare = Number(p.issuePricePerShare) || 0;
    if (preShares <= 0) return { error: '증자전 발행주식총수가 필요합니다.' };

    let giftAmount, gateApplies, gateThreshold, postValuePerShare;

    if (caseType === 'low_allocated' || caseType === 'high_allocated') {
      const increasedShares = Number(p.increasedShares) || 0;
      postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);
      const allocatedShares = Number(p.allocatedShares) || 0;
      if (caseType === 'low_allocated') {
        giftAmount = Math.max(0, Math.round((postValuePerShare - issuePricePerShare) * allocatedShares));
      } else {
        giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * allocatedShares));
      }
      gateApplies = false; gateThreshold = 0;
    } else if (caseType === 'low_unallocated') {
      const equalIncreaseShares = Number(p.equalIncreaseShares) || 0;
      postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * equalIncreaseShares) / (preShares + equalIncreaseShares);
      const deemedAllocatedShares = Number(p.deemedAllocatedShares) || 0;
      giftAmount = Math.max(0, Math.round((postValuePerShare - issuePricePerShare) * deemedAllocatedShares));
      gateApplies = true;
      gateThreshold = Math.min(postValuePerShare * 0.3 * deemedAllocatedShares, Infinity);
    } else if (caseType === 'high_unallocated') {
      const increasedShares = Number(p.increasedShares) || 0;
      postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);
      const forfeitedShares = Number(p.forfeitedShares) || 0;
      const relatedAcquiredShares = Number(p.relatedAcquiredShares) || 0;
      const equalIncreaseTotalShares = Number(p.equalIncreaseTotalShares) || 0;
      if (equalIncreaseTotalShares <= 0) return { error: '균등증자시 증가주식수 총수가 필요합니다.' };
      giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * forfeitedShares * (relatedAcquiredShares / equalIncreaseTotalShares)));
      gateApplies = true;
      gateThreshold = 0; // 3억 또는 30% 비율, 아래에서 별도 판정
    } else { // high_nonshareholder
      const increasedShares = Number(p.increasedShares) || 0;
      postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);
      const underAllocatedShares = Number(p.underAllocatedShares) || 0;
      const relatedAcquiredShares = Number(p.relatedAcquiredShares) || 0;
      const nonShareholderAndExcessTotalShares = Number(p.nonShareholderAndExcessTotalShares) || 0;
      if (nonShareholderAndExcessTotalShares <= 0) return { error: '비주주배정신주+균등초과인수신주의 총수가 필요합니다.' };
      giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * underAllocatedShares * (relatedAcquiredShares / nonShareholderAndExcessTotalShares)));
      gateApplies = false; gateThreshold = 0;
    }

    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 같은 호(caseType)의 이익이 더 있으면 합산해 기준금액을 계산.
    const thisTransactionGiftAmount = giftAmount;
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    giftAmount = thisTransactionGiftAmount + priorBenefitSum;

    // 게이트 판정 — low_unallocated·high_unallocated는 "이익 3억원 이상 또는 차액비율 30%이상" 중 하나만 충족해도 과세.
    if (caseType === 'low_unallocated') {
      const diffRatio = postValuePerShare > 0 ? (postValuePerShare - issuePricePerShare) / postValuePerShare : 0;
      if (!(diffRatio >= 0.3 || giftAmount >= 300000000)) {
        return { 과세대상여부: false, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount, 납부세액: 0, 안내: '차액비율이 30% 미만이고 이익도 3억원 미만이어서 과세하지 않습니다(시행령§29②2호).' + aggNote };
      }
    } else if (caseType === 'high_unallocated') {
      // 시행령§29②(법§39①2호나목 게이트): "제3호 가목의 가액에서 제3호 나목의 가액을 차감한 금액이
      // 제3호 나목의 가액의 100분의 30 이상"— "제3호"(=high_allocated, 법§39①2호가목)의 가목은 "신주
      // 1주당 인수가액"(issuePricePerShare), 나목은 "증자후 1주당 평가가액"(postValuePerShare) 산식이다
      // (시행령§29②, 제3호 항목의 가/나 정의 원문 직접 확인, 2026-08-21 재검증). 따라서 게이트 분모는
      // 나목=postValuePerShare이다. 과거(커밋 451d510)에 반대로(issuePricePerShare 분모) "수정"한 것은
      // 가/나 라벨을 뒤바꿔 읽은 오류였다 — 이번 재검증으로 원상태를 다시 정정한다.
      const diffRatio = postValuePerShare > 0 ? (issuePricePerShare - postValuePerShare) / postValuePerShare : 0;
      if (!(diffRatio >= 0.3 || giftAmount >= 300000000)) {
        return { 과세대상여부: false, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount, 납부세액: 0, 안내: '차액비율이 30% 미만이고 이익도 3억원 미만이어서 과세하지 않습니다(시행령§29②4호).' + aggNote };
      }
    }

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 증자후1주당평가액: Math.round(postValuePerShare), 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 주식대금 납입일 등입니다(§39①, 시행령§29①). high_nonshareholder(시행령5호, 법§39①2호다·라목)는 시행령§29②5호 원문상 별도의 게이트(문턱금액) 조항이 없어 게이트 없이 계산합니다.'
        + ((caseType === 'low_allocated' || caseType === 'low_unallocated')
          ? ' §39②·시행령§29⑤ — 신주인수권을 포기해 이익을 준 자가 소액주주(지분 1% 미만이면서 액면가액 합계 3억원 미만)로서 2명 이상이면, 그 소액주주들을 1명으로 보고 특수관계 여부 등을 판단해야 합니다.'
          : '') + aggNote
    };
  };

  // 구조조정대상 부동산 취득자에 대한 양도소득세의 감면 (조특법§43) — 1999.12.31 이전 취득분에 한해,
  // §99/§98 계열과 같은 "5년 이내 양도시 50% 세액감면, 5년 초과 후 양도시 5년간발생분의 50% 소득공제"
  // 구조를 적용한다.
  window.calculateRestructuringPropertyReductionJS = function (p) {
    p = p || {};
    const acquisitionDate = p.acquisitionDate;
    const transferDate = p.transferDate;
    if (!acquisitionDate || !transferDate) return { error: '취득일과 양도일이 필요합니다.' };
    const acqTime = new Date(acquisitionDate).getTime();
    const trfTime = new Date(transferDate).getTime();
    if (!(trfTime > acqTime)) return { error: '양도일은 취득일 이후여야 합니다.' };
    const yearsHeld = (trfTime - acqTime) / (365.25 * 24 * 3600 * 1000);

    const transferPrice = Number(p.transferPrice) || 0;
    const acquisitionPrice = Number(p.acquisitionPrice) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;
    const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;

    // §43① 5년 이내 양도분은 "그 양도소득세의 100분의 50에 상당하는 세액을 감면"하는 세액감면이다.
    // 소득금액을 먼저 축소해 일반계산기에 넣으면 정액 기본공제·누진세율 구조 때문에 결과가 달라지므로,
    // 산출세액 자체에 50%를 적용하도록 별도 처리한다(5년초과분은 원문상 소득금액공제 방식이 맞아 그대로 둠).
    if (yearsHeld <= 5) {
      return {
        적용여부: true, 적용감면율: 50, 세액감면방식: true,
        전체양도차익: Math.round(totalGain),
        안내: '취득일로부터 5년 이내 양도이므로 그 양도소득세의 50%에 상당하는 세액을 감면합니다(세액감면). 위 일반 양도세 계산기에 원래 양도차익(전체양도차익, 이 감면 미반영)을 그대로 입력해 감면 적용 전 산출세액을 구한 뒤, 그 산출세액(가산세·다른 세액공제 반영 전 본세)의 50%를 차감한 금액을 최종 납부세액으로 하세요. 이 감면세액은 조특법§133①1호에 따라 같은 과세기간 중 §69·§69의2~4·§70·§85의10 감면세액과 합산해 1억원을 넘으면 그 초과분을 감면받지 못합니다 — 다른 감면을 함께 적용받는다면 합계액을 직접 확인하세요.'
      };
    }
    let exemptGain, note;
    {
      const fy = fiveYearMarkGain(totalGain, acquisitionPrice, {
        acquisitionStandardPrice: p.acquisitionStandardPrice, fiveYearStandardPrice: p.fiveYearStandardPrice, transferStandardPrice: p.transferStandardPrice,
        fiveYearMarkValue: p.fiveYearMarkValue, yearsHeld: yearsHeld
      });
      note = '취득일로부터 5년 초과 보유 후 양도 — ' + fy.note + ' (50% 적용)';
      exemptGain = Math.round(fy.gain * 0.5);
    }
    exemptGain = Math.max(0, Math.min(exemptGain, totalGain));
    const taxableGain = Math.max(0, totalGain - exemptGain);
    return {
      적용여부: true,
      보유기간_년: Math.round(yearsHeld * 100) / 100,
      전체양도차익: Math.round(totalGain),
      감면_비과세대상_양도소득금액: Math.round(exemptGain),
      과세대상양도소득금액: taxableGain,
      안내: note + ' 이 결과의 "과세대상양도소득금액"을 위 일반 양도세 계산기에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 계산기에서 별도 적용됩니다). 1999.12.31 이전 취득분만 적용됩니다(§43①). 이 감면세액은 조특법§133①1호에 따라 같은 과세기간 중 §69·§69의2~4·§70·§85의10 감면세액과 합산해 1억원을 넘으면 그 초과분을 감면받지 못합니다.'
    };
  };

  // 인구감소지역 주택 취득자에 대한 1세대1주택 비과세 특례 (조특법§71의2, 2024.1.4~2026.12.31 취득분,
  // 현재 시행중) — §98의9와 같은 구조. 1채를 보유한 1세대가 이 기간 중 인구감소지역·인구감소관심지역
  // 주택을 취득한 후 종전주택을 양도하면, 그 주택은 1세대1주택 비과세(소득세법§89①3호·4호) 판정시
  // 소유주택으로 보지 않는다. 세액을 계산하지 않고 적용 가능 여부만 판정한다.
  window.calculatePopulationDeclineAreaHouseExclusionJS = function (p) {
    p = p || {};
    const acquisitionDate = p.acquisitionDate;
    if (!acquisitionDate) return { error: '인구감소지역주택의 취득일이 필요합니다.' };
    const acqTime = new Date(acquisitionDate).getTime();
    const windowStart = new Date('2024-01-04').getTime();
    const windowEnd = new Date('2026-12-31').getTime();
    if (!(acqTime >= windowStart && acqTime <= windowEnd)) {
      return {
        적용여부: false,
        안내: '취득일이 2024.1.4~2026.12.31 기간을 벗어나 조특법§71의2의 적용대상이 아닙니다.'
      };
    }
    if (!p.isPopulationDeclineArea) {
      return { 적용여부: false, 안내: '인구감소지역 또는 수도권 밖 인구감소관심지역에 소재한 주택이 아니어서 적용대상이 아닙니다.' };
    }
    if (!p.wasOneOrFewerBeforeAcquisition) {
      return { 적용여부: false, 안내: '취득 전 주택·조합원입주권·분양권 중 1채(1개)를 보유한 1세대가 아니어서 적용대상이 아닙니다.' };
    }
    if (!p.meetsAreaAndPriceRequirements) {
      return { 적용여부: false, 안내: '주택 소재지·가액 등 대통령령으로 정하는 요건(시행령에서 확인 필요)을 충족하지 못해 적용대상이 아닙니다.' };
    }
    return {
      적용여부: true,
      안내: '요건을 충족하여 그 인구감소지역주택을 1세대1주택 비과세(소득세법§89①3호·4호) 판정시 소유주택으로 보지 않습니다(조특법§71의2①). 위 일반 양도세 계산기에서 종전주택을 양도자산으로 놓고 "1세대1주택 비과세 요건 충족 전제"를 체크해 계산하세요. 종합부동산세 특례(§71의2②)는 9.16~9.30 별도 신청이 필요하며 이 도구의 범위 밖입니다.'
    };
  };

  // 중소기업간 통합·법인전환에 대한 양도소득세 이월과세 (조특법§31,§32) — 사업용고정자산을 통합법인(§31)에
  // 양도하거나 현물출자·사업양수도로 법인전환(§32)하면, 그 시점에는 양도소득세를 과세하지 않고 통합법인·
  // 전환법인이 나중에 그 자산을 양도할 때 정산한다(이월과세액 자체는 일반 양도세 계산기로 별도 계산).
  // 다만 이월과세 적용일(§31은 사업용고정자산 양도일, §32는 법인 설립등기일)부터 5년 이내에 승계받은
  // 사업을 폐지하거나 통합·전환으로 취득한 주식등의 50% 이상을 처분하면, 그 사유발생일이 속하는 달의
  // 말일부터 2개월 이내에 이월과세액(법인이 이미 납부한 세액 제외)을 양도소득세로 납부해야 한다(§31⑦,
  // §32⑤) — 다른 사후관리 위반과 달리 이자상당가산액은 법문에 없다.
  window.calculateBusinessTransferCarryoverJS = function (p) {
    p = p || {};
    const provision = p.provision;
    if (['sect31', 'sect32'].indexOf(provision) === -1) return { error: 'provision을 sect31(중소기업간 통합)/sect32(법인전환) 중에서 선택하세요.' };
    const deferredTaxAmount = Number(p.deferredTaxAmount) || 0;
    if (deferredTaxAmount <= 0) return { error: '이월과세액(일반 양도세 계산기로 별도 계산한 양도소득세)이 필요합니다.' };
    const triggerEvent = p.triggerEvent;
    if (['none', 'business_discontinued', 'shares_disposed_50pct_plus'].indexOf(triggerEvent) === -1) {
      return { error: 'triggerEvent을 none(사후관리 위반 없음)/business_discontinued(승계사업 폐지)/shares_disposed_50pct_plus(취득주식 50%이상 처분) 중에서 선택하세요.' };
    }
    const provisionLabel = provision === 'sect31' ? '조특법§31(중소기업간 통합)' : '조특법§32(법인전환)';
    if (triggerEvent === 'none') {
      return {
        상태: '이월과세_적용중', 이월과세액: deferredTaxAmount, 납부세액: 0,
        안내: provisionLabel + '에 따라 이월과세를 적용받아 현재는 양도소득세를 납부하지 않습니다. ' + (provision === 'sect31' ? '통합법인' : '전환법인') + '이 나중에 이 자산을 양도할 때 이월과세액이 정산됩니다.'
      };
    }
    const yearsSinceTransfer = Number(p.yearsSinceTransfer);
    if (!(yearsSinceTransfer >= 0)) return { error: (provision === 'sect31' ? '사업용고정자산 양도일' : '법인 설립등기일') + '부터 사유발생일까지의 경과연수가 필요합니다.' };
    if (yearsSinceTransfer > 5) {
      return {
        상태: '사후관리기간_경과', 이월과세액: deferredTaxAmount, 납부세액: 0,
        안내: (provision === 'sect31' ? '사업용고정자산 양도일' : '법인 설립등기일') + '부터 5년이 지나 사후관리 추징의무가 소멸했습니다(' + provisionLabel + '). 다만 이월과세 자체는 계속 유지되며, 법인이 그 자산을 양도할 때 정산됩니다.'
      };
    }
    const alreadyPaidByCorp = Number(p.alreadyPaidByCorp) || 0;
    const clawbackAmount = Math.max(0, deferredTaxAmount - alreadyPaidByCorp);
    return {
      상태: '추징대상', 이월과세액: deferredTaxAmount, 법인기납부세액: alreadyPaidByCorp,
      납부세액: clawbackAmount,
      안내: (triggerEvent === 'business_discontinued' ? '승계받은 사업을 폐지하여' : '통합·전환으로 취득한 주식등의 50% 이상을 처분하여') + ' ' + provisionLabel + '의 사후관리 위반 사유가 발생했습니다. 사유발생일이 속하는 달의 말일부터 2개월 이내에 이월과세액(법인이 이미 납부한 세액 제외)을 양도소득세로 납부해야 합니다. 이 사후관리 위반에는 별도 이자상당가산액이 법문에 없습니다.'
    };
  };

  // 부담부증여시 양도로 보는 부분의 취득가액·양도가액 (소득세법시행령§159) — 부담부증여로 수증자가 인수한
  // 채무액에 상당하는 부분은 양도로 본다(소득세법§88①1호 각목외 부분 후단). 취득가액·양도가액 모두
  // "자산가액×(채무액÷증여가액)" 비율을 적용해 안분한다(양도가액 계산식은 결과적으로 채무액과 같아진다).
  // §159②는 양도소득세 과세대상 자산과 비과세대상 자산을 함께 부담부증여하는 경우, 전체 증여재산가액 중
  // 과세대상 자산가액이 차지하는 비율로 총채무액을 먼저 안분한 뒤 위 계산식을 적용하도록 한다.
  window.calculateBurdenedGiftTransferJS = function (p) {
    p = p || {};
    const assetAcquisitionPrice = Number(p.assetAcquisitionPrice) || 0;
    const assetGiftValue = Number(p.assetGiftValue) || 0;
    if (assetGiftValue <= 0) return { error: '양도세 과세대상 자산의 증여재산가액(상증세법상 평가액)이 필요합니다.' };
    const totalDebtAmount = Number(p.totalDebtAmount) || 0;
    if (totalDebtAmount <= 0) return { error: '수증자가 인수한 채무액이 필요합니다.' };
    const otherAssetsGiftValueSum = Number(p.otherAssetsGiftValueSum) || 0;
    const necessaryExpenses = Number(p.necessaryExpenses) || 0;

    let allocatedDebtToAsset;
    let note;
    if (otherAssetsGiftValueSum > 0) {
      // §159② — 양도세 과세대상 자산과 비과세대상 자산을 함께 부담부증여하는 경우의 채무액 안분
      const totalGiftValue = assetGiftValue + otherAssetsGiftValueSum;
      allocatedDebtToAsset = Math.min(totalDebtAmount, Math.round(totalDebtAmount * assetGiftValue / totalGiftValue));
      note = '§159②에 따라 총채무액을 양도세 과세대상 자산가액 비율로 먼저 안분한 채무액(' + allocatedDebtToAsset + '원)을 기준으로 계산했습니다. ';
    } else {
      allocatedDebtToAsset = Math.min(totalDebtAmount, assetGiftValue);
      note = '';
    }

    const debtRatio = assetGiftValue > 0 ? allocatedDebtToAsset / assetGiftValue : 0;
    const transferPortionAcquisitionPrice = Math.round(assetAcquisitionPrice * debtRatio);
    const transferPortionTransferPrice = Math.round(assetGiftValue * debtRatio);
    const gain = transferPortionTransferPrice - transferPortionAcquisitionPrice - necessaryExpenses;

    return {
      안분채무액: allocatedDebtToAsset, 채무액비율: debtRatio,
      양도로보는부분_양도가액: transferPortionTransferPrice, 양도로보는부분_취득가액: transferPortionAcquisitionPrice,
      필요경비: necessaryExpenses, 양도차익: Math.round(gain),
      안내: note + '이 양도가액(' + transferPortionTransferPrice + '원)·취득가액(' + transferPortionAcquisitionPrice + '원)·필요경비를 위 일반 양도세 계산기에 그대로 넣어 나머지 세액(장기보유특별공제·기본공제·세율 등)을 계산하세요. 배우자·직계존비속간 부담부증여는 채무 인수를 객관적으로 입증하지 못하면 양도로 보지 않습니다(소득세법§101②·상증세법§47③과 같은 취지 — 이 계산기는 인수 사실이 입증됐다는 전제입니다).'
    };
  };

  // 가업상속·가업승계 납부유예금액 계산 — inheritance(상증세법§72의2①, 시행령§69의3①): 납부유예금액 =
  // 상속세납부세액×(가업상속재산가액÷총상속재산가액), 가업상속재산가액은 시행령§15⑤ 기준(가업상속공제
  // 대상 재산가액). gift(조특법§30의7①, 조특법시행령§27의7④): 납부유예금액 = 증여세납부세액×
  // (가업자산상당액÷총증여재산가액), 가업자산상당액은 상증세법시행령§15⑤2호를 준용(같은 호 중
  // "상속개시일"은 "증여일"로 봄)해 계산한다.
  window.calculateBusinessSuccessionDeferralAmountJS = function (p) {
    p = p || {};
    const provision = p.provision === 'gift' ? 'gift' : 'inheritance';
    const taxPayable = Number(p.taxPayable) || 0;
    const businessValue = Number(p.businessSuccessionPropertyValue) || 0;
    const totalValue = Number(p.totalPropertyValue);
    if (!totalValue || totalValue <= 0) return { error: (provision === 'gift' ? '총 증여재산가액' : '총 상속재산가액') + '이 필요합니다.' };
    const deferralAmount = Math.round(taxPayable * businessValue / totalValue);
    const note = provision === 'gift'
      ? '조특법시행령§27의7④에 따라 증여세 납부세액(' + taxPayable + '원)×(가업자산상당액(' + businessValue + '원)÷총증여재산가액(' + totalValue + '원))로 계산했습니다. 가업자산상당액은 상증세법시행령§15⑤2호를 준용(같은 호 중 "상속개시일"은 "증여일"로 봄)해 계산합니다.'
      : '시행령§69의3①에 따라 상속세 납부세액(' + taxPayable + '원)×(가업상속재산가액(' + businessValue + '원)÷총상속재산가액(' + totalValue + '원))로 계산했습니다. 가업상속재산가액은 시행령§15⑤ 기준(가업상속공제 대상 재산가액)입니다.';
    return { 납부유예금액: deferralAmount, 안내: note };
  };

  // 물납충당재산(주식)의 수납가액 — 상속개시일부터 수납할 때까지 신주발행·감자가 있었던 경우
  // (시행령§75①1호, 시행규칙§20의2) — 신주발행·감자 전 구주 1주당 과세가액을, 신주배정수 또는
  // 감자주식수를 반영해 조정한 값이 구주 1주당 수납가액이 된다.
  window.calculatePropertyInKindStockReceiptValueJS = function (p) {
    p = p || {};
    const changeType = p.changeType;
    const validTypes = ['free_increase', 'paid_increase', 'free_decrease', 'paid_decrease'];
    if (validTypes.indexOf(changeType) === -1) return { error: 'changeType을 free_increase(무상증자)/paid_increase(유상증자)/free_decrease(무상감자)/paid_decrease(유상감자) 중에서 선택하세요.' };
    const oldSharePreChangeValue = Number(p.oldSharePreChangeValue);
    if (!oldSharePreChangeValue) return { error: '구주 1주당 과세가액(oldSharePreChangeValue)이 필요합니다.' };
    let receiptValuePerShare, formulaNote;
    if (changeType === 'free_increase') {
      const newSharesPerOldShare = Number(p.newSharesPerOldShare) || 0;
      receiptValuePerShare = oldSharePreChangeValue / (1 + newSharesPerOldShare);
      formulaNote = '구주1주당과세가액÷(1+구주1주당신주배정수)';
    } else if (changeType === 'paid_increase') {
      const newSharesPerOldShare = Number(p.newSharesPerOldShare) || 0;
      const paymentPerNewShare = Number(p.paymentPerNewShare) || 0;
      receiptValuePerShare = (oldSharePreChangeValue + paymentPerNewShare * newSharesPerOldShare) / (1 + newSharesPerOldShare);
      formulaNote = '[구주1주당과세가액+(신주1주당주금납입액×구주1주당신주배정수)]÷(1+구주1주당신주배정수)';
    } else if (changeType === 'free_decrease') {
      const decreasedSharesPerOldShare = Number(p.decreasedSharesPerOldShare) || 0;
      if (decreasedSharesPerOldShare >= 1) return { error: '구주 1주당 감자주식수는 1 미만이어야 합니다.' };
      receiptValuePerShare = oldSharePreChangeValue / (1 - decreasedSharesPerOldShare);
      formulaNote = '구주1주당과세가액÷(1-구주1주당감자주식수)';
    } else {
      const decreasedSharesPerOldShare = Number(p.decreasedSharesPerOldShare) || 0;
      if (decreasedSharesPerOldShare >= 1) return { error: '구주 1주당 감자주식수는 1 미만이어야 합니다.' };
      const paymentPerDecreasedShare = Number(p.paymentPerDecreasedShare) || 0;
      receiptValuePerShare = (oldSharePreChangeValue - paymentPerDecreasedShare * decreasedSharesPerOldShare) / (1 - decreasedSharesPerOldShare);
      formulaNote = '[구주1주당과세가액-(1주당지급금액×구주1주당감자주식수)]÷(1-구주1주당감자주식수)';
    }
    return {
      구주1주당수납가액: Math.round(receiptValuePerShare),
      안내: '시행규칙§20의2에 따라 [' + formulaNote + ']로 계산했습니다.'
    };
  };

  // 가업상속납부유예(상증세법§72의2)·가업승계증여세납부유예(조특법§30의7) 사후관리 위반시 추징 판정 —
  // 두 조문 모두 "정당한 사유 없이" 다음 사유가 생기면 허가를 취소하고 대통령령으로 정하는 이자상당액과
  // 함께 징수한다(이자상당액은 calculateClawbackInterestJS로 별도 계산 — 두 조문 모두 그 함수 주석에
  // 명시된 "국세환급가산금 이율 365분의1" 방식을 적용한다).
  // §72의2③: 1호 가업용자산 40%이상처분(소득세법적용 가업만, 처분비율 고려 계산) 2호 가업미종사(전부)
  //   3호 지분감소(5년내 전부, 5년후 비율계산) 4호 §18조의2⑤4호 고용유지요건(70%기준) 미달(전부) 5호 상속인사망(전부)
  // 조특법§30의7③: 1호 가업미종사(전부) 2호 지분감소(5년내 전부, 5년후 비율계산) 3호 고용유지요건(전부) 4호 수증자사망(전부)
  //   — §72의2의 "가업용자산40%처분" 사유(개인가업만 해당)가 없다(§30의7은 법인 주식등 증여만 다루므로).
  // "처분비율을 고려하여 계산한 세액"(시행령§69의3③, 상속만)은 [납부유예세액×가업용자산의처분비율]이고,
  // "지분감소비율을 고려하여 계산한 세액"(시행령§69의3⑥ 상속·조특법시행령§27의7⑩ 증여)은
  // [납부유예세액×(감소한지분율÷기준일(상속개시일·증여일)현재지분율)]이다(둘 다 원문 확인).
  window.calculateBusinessSuccessionDeferralClawbackJS = function (p) {
    p = p || {};
    const provision = p.provision;
    if (['inheritance', 'gift'].indexOf(provision) === -1) return { error: 'provision을 inheritance(§72의2, 가업상속납부유예)/gift(조특법§30의7, 가업승계증여세납부유예) 중에서 선택하세요.' };
    const deferredTaxAmount = Number(p.deferredTaxAmount) || 0;
    if (deferredTaxAmount <= 0) return { error: '납부유예된 세액이 필요합니다.' };

    const validEvents = provision === 'inheritance'
      ? ['none', 'asset_disposed_40pct', 'not_engaged', 'equity_decreased', 'employment_failed', 'heir_death']
      : ['none', 'not_engaged', 'equity_decreased', 'employment_failed', 'donee_death'];
    const triggerEvent = p.triggerEvent;
    if (validEvents.indexOf(triggerEvent) === -1) {
      return { error: 'triggerEvent을 ' + validEvents.join('/') + ' 중에서 선택하세요.' };
    }
    const provisionLabel = provision === 'inheritance' ? '상증세법§72의2(가업상속납부유예)' : '조특법§30의7(가업승계증여세납부유예)';
    const baseDateLabel = provision === 'inheritance' ? '상속개시일' : '증여일';
    const personSubj = provision === 'inheritance' ? '상속인이' : '수증자가';

    if (triggerEvent === 'none') {
      return {
        상태: '납부유예_적용중', 납부유예세액: deferredTaxAmount, 추징세액: 0,
        안내: provisionLabel + '에 따라 상속세(또는 증여세)의 납부를 유예받아 현재는 납부하지 않습니다. 사후관리 위반 사유가 없는 한 계속 유지됩니다.'
      };
    }

    let clawbackAmount, note, ratioUsed = null;
    if (triggerEvent === 'asset_disposed_40pct') {
      const disposalRatio = Math.max(0, Math.min(1, Number(p.disposalRatio) || 0));
      if (disposalRatio <= 0) return { error: '가업용자산 처분비율(0~1)이 필요합니다.' };
      ratioUsed = disposalRatio;
      clawbackAmount = Math.round(deferredTaxAmount * disposalRatio);
      note = '「소득세법」을 적용받는 가업의 가업용 자산을 100분의 40 이상 처분하여 ' + provisionLabel + '③1호 사유가 발생했습니다. 시행령§69의3③에 따라 납부유예세액×처분비율(' + Math.round(disposalRatio * 100) + '%)로 추징세액을 계산했습니다.';
    } else if (triggerEvent === 'not_engaged') {
      clawbackAmount = deferredTaxAmount;
      note = personSubj + ' 가업에 종사하지 아니하게 되어 ' + provisionLabel + '③ 사유가 발생했습니다. 납부유예된 세액 전부를 추징합니다.';
    } else if (triggerEvent === 'equity_decreased') {
      const yearsSinceBase = Number(p.yearsSinceBase);
      if (!(yearsSinceBase >= 0)) return { error: baseDateLabel + '부터 지분 감소일까지의 경과연수가 필요합니다.' };
      if (yearsSinceBase <= 5) {
        clawbackAmount = deferredTaxAmount;
        note = baseDateLabel + '부터 5년 이내에 지분이 감소하여 ' + provisionLabel + '③ 사유가 발생했습니다. 납부유예된 세액 전부를 추징합니다.';
      } else {
        // 시행령§69의3⑥(상속)·조특법시행령§27의7⑩(증여) — 세액 = A×(B÷C), A=납부유예세액,
        // B=감소한 지분율, C=기준일(상속개시일·증여일) 현재 지분율.
        const provisionCite = provision === 'inheritance' ? '시행령§69의3⑥' : '조특법시행령§27의7⑩';
        const equityRatioAtBase = Number(p.equityRatioAtBase);
        const currentEquityRatio = Number(p.currentEquityRatio);
        let ratioBC = null;
        let baseNote = '';
        if (Number.isFinite(equityRatioAtBase) && equityRatioAtBase > 0 && Number.isFinite(currentEquityRatio) && currentEquityRatio >= 0 && currentEquityRatio < equityRatioAtBase) {
          const decreasedRatio = equityRatioAtBase - currentEquityRatio;
          ratioBC = decreasedRatio / equityRatioAtBase;
          baseNote = provisionCite + '에 따라 [감소한 지분율(' + (decreasedRatio * 100).toFixed(2) + '%p) ÷ ' + baseDateLabel + ' 현재 지분율(' + (equityRatioAtBase * 100).toFixed(2) + '%)]=' + (ratioBC * 100).toFixed(2) + '%로 계산했습니다. ';
        } else {
          const directRatio = Number(p.equityDecreaseRatio);
          if (Number.isFinite(directRatio) && directRatio > 0) {
            ratioBC = Math.min(1, directRatio);
            baseNote = '직접 입력한 지분감소비율(B÷C)을 그대로 사용했습니다. ';
          }
        }
        if (!ratioBC || ratioBC <= 0) return { error: baseDateLabel + '부터 5년 후 지분감소이므로 ' + baseDateLabel + ' 현재 지분율(equityRatioAtBase)과 감소 후 현재 지분율(currentEquityRatio)을 입력하거나, 이미 계산된 지분감소비율(equityDecreaseRatio, B÷C)을 직접 입력하세요.' };
        ratioUsed = ratioBC;
        clawbackAmount = Math.round(deferredTaxAmount * ratioBC);
        note = baseNote + baseDateLabel + '부터 5년 후에 지분이 감소하여 ' + provisionLabel + '③ 사유가 발생했습니다. ' + provisionCite + '에 따라 납부유예세액×(감소한지분율÷' + baseDateLabel + '현재지분율)로 추징세액을 계산했습니다.';
      }
    } else if (triggerEvent === 'employment_failed') {
      clawbackAmount = deferredTaxAmount;
      note = baseDateLabel + '부터 5년간의 정규직 근로자 수 평균 및 총급여액 평균이 모두 직전 2개 사업연도 평균의 100분의 70에 미달하여 ' + provisionLabel + '③ 사유가 발생했습니다. 납부유예된 세액 전부를 추징합니다.';
    } else { // heir_death / donee_death
      clawbackAmount = deferredTaxAmount;
      note = personSubj + ' 사망하여 상속이 개시되어 ' + provisionLabel + '③ 사유가 발생했습니다. 납부유예된 세액 전부를 추징합니다.';
    }

    return {
      상태: '추징대상', 납부유예세액: deferredTaxAmount, 추징세액: clawbackAmount, 사용비율: ratioUsed,
      안내: note + ' 사유발생일이 속하는 달의 말일부터 ' + (provision === 'inheritance' ? '6개월' : '3개월') + ' 이내에 신고하고 이 추징세액과 이자상당액을 납부해야 합니다(' + provisionLabel + '④). 이자상당액은 calculateClawbackInterestJS(위 "사후관리 위반 이자상당액 계산" 도구)에 이 추징세액과 납부유예 허가일(이자 기산일)·사유발생일을 넣어 별도로 계산하세요. "정당한 사유"가 있는 경우(수용, 폐업 후 사업전환 등 시행령이 정하는 사유)에는 추징하지 않으니 해당 여부를 먼저 확인하세요.'
    };
  };

  // 물납 적용 가능 여부 판정 (상속세및증여세법§73 일반물납, §73의2 문화유산등물납) — 세액 자체가 아니라
  // 요건 충족 여부를 판정한다. 물납충당재산의 "수납가액"은 원칙적으로 상속재산의 가액(이미 상속세
  // 과세가액 산정에 쓴 평가액)과 같다(시행령§75①본문, §75의5제1호외의경우) — 별도 계산이 필요 없다.
  // 예외 3가지(§75①):
  //   1호(주식 신주발행·감자, 상속개시일부터 수납할 때까지): calculatePropertyInKindStockReceiptValueJS
  //     (시행규칙§20의2)로 계산한다.
  //   2호(연부연납 분납세액에 대한 물납): 새로운 산식이 아니라, 원래 상속세 과세가액 산정에 썼던 평가
  //     방법(법§60②시가 또는 §60③보충적평가방법)을 그대로 물납허가통지서 발송일 전일 기준으로
  //     "다시 평가"한 값이다 — 즉 이 계산기의 해당 자산유형 평가함수(calculateLandValueJS 등)를
  //     물납허가통지서 발송일 전일 시점 데이터로 다시 호출하면 된다.
  //   3호(유가증권이 물납기간 중 정당한 사유 없이 30%이상 하락, 시행령§75③각목 사유): 위 2호와
  //     동일한 재평가값을 쓴다(2호를 그대로 준용). 물납신청 유가증권 전체평가액이 물납신청세액에
  //     미달하면 그 부족분을 물납신청 유가증권 전체평가액에 가산한다.
  // §73①은 3요건 모두 충족해야 하고(관리·처분부적당시
  // 그래도 불허가 가능), §73의2①은 2요건만 있으며 부동산·유가증권 비율 요건이 없다. §73의2⑤(물납신청
  // 가능세액 한도="문화유산등의 가액에 대한 상속세 납부세액"을 초과할 수 없음)은 상속세납부세액×
  // (문화유산등가액÷상속재산가액) 비율로 계산한다. 상속개시일 이후 물납신청 전까지 정당한 사유 없이
  // 훼손·멸실 등(시행령§75의4①)에 해당하게 된 문화유산등이 있으면 그 가액은 한도 계산에서 제외한다
  // (시행령§75의2⑤).
  window.calculatePropertyInKindPaymentEligibilityJS = function (p) {
    p = p || {};
    const provision = p.provision;
    if (['general', 'cultural_heritage'].indexOf(provision) === -1) return { error: 'provision을 general(§73 일반물납)/cultural_heritage(§73의2 문화유산등물납) 중에서 선택하세요.' };
    const inheritanceTaxPayable = Number(p.inheritanceTaxPayable) || 0;
    const financialAssetValue = Number(p.financialAssetValue) || 0;
    if (inheritanceTaxPayable <= 0) return { error: '상속세 납부세액이 필요합니다.' };

    const reasons = [];
    let eligible = true;
    if (inheritanceTaxPayable <= 20000000) { eligible = false; reasons.push('상속세 납부세액(' + inheritanceTaxPayable + '원)이 2천만원을 초과하지 않습니다.'); }
    if (inheritanceTaxPayable <= financialAssetValue) { eligible = false; reasons.push('상속세 납부세액이 금융재산가액(' + financialAssetValue + '원)을 초과하지 않습니다.'); }

    let ratioDetail = null;
    if (provision === 'general') {
      const realEstateSecuritiesValue = Number(p.realEstateSecuritiesValue) || 0;
      const totalInheritanceValue = Number(p.totalInheritanceValue) || 0;
      if (totalInheritanceValue <= 0) return { error: 'provision이 general일 때는 상속재산가액(§13 가산 증여재산 포함)이 필요합니다.' };
      const ratio = realEstateSecuritiesValue / totalInheritanceValue;
      ratioDetail = ratio;
      if (ratio <= 0.5) { eligible = false; reasons.push('부동산·유가증권 가액 비율(' + (ratio * 100).toFixed(1) + '%)이 상속재산가액의 2분의 1을 초과하지 않습니다.'); }
    }

    const result = {
      적용가능여부: eligible,
      부동산유가증권비율: ratioDetail,
      미충족사유: reasons,
      안내: eligible
        ? (provision === 'general' ? '§73①의 3가지 요건을 모두 충족합니다. 다만 물납을 신청한 재산의 관리·처분이 적당하지 않다고 인정되면 세무서장이 불허가할 수 있습니다(§73①단서). 물납충당재산의 수납가액은 원칙적으로 상속재산의 가액과 같습니다(시행령§75①본문). 예외로 (1)신주발행·감자가 있었던 주식은 calculatePropertyInKindStockReceiptValueJS(시행규칙§20의2)로 계산하고, (2)연부연납분납분·(3)유가증권 30%이상 하락분은 원래 상속세 과세가액 산정에 썼던 평가방법을 물납허가통지서 발송일 전일 기준으로 다시 적용한 값을 씁니다(§75①2·3호).' : '§73의2①의 2가지 요건을 모두 충족해 문화유산등에 대한 물납을 신청할 수 있습니다. 다만 문화체육관광부장관의 물납 필요성 인정(③) 및 국고손실위험 판단(④)을 거쳐야 최종 허가됩니다. 물납충당재산의 수납가액은 원칙적으로 상속재산의 가액과 같습니다(시행령§75의5제1호외의경우).')
        : '요건을 충족하지 못해 ' + (provision === 'general' ? '§73' : '§73의2') + ' 물납을 신청할 수 없습니다.'
    };

    if (provision === 'cultural_heritage' && eligible) {
      const culturalHeritageValue = Number(p.culturalHeritageValue) || 0;
      const totalInheritanceValue = Number(p.totalInheritanceValue) || 0;
      const excludedDamagedValue = Math.min(culturalHeritageValue, Number(p.excludedDamagedCulturalHeritageValue) || 0);
      const eligibleCulturalHeritageValue = culturalHeritageValue - excludedDamagedValue;
      if (culturalHeritageValue > 0 && totalInheritanceValue > 0) {
        const maxRequestable = Math.round(inheritanceTaxPayable * eligibleCulturalHeritageValue / totalInheritanceValue);
        result.물납신청가능세액_한도 = maxRequestable;
        result.안내 += ' 물납신청가능세액 한도는 "문화유산등의 가액에 대한 상속세 납부세액"(§73의2⑤)을 상속세납부세액×(문화유산등가액÷상속재산가액) 비율로 계산해 ' + maxRequestable + '원입니다' +
          (excludedDamagedValue > 0 ? ' (정당한 사유 없이 훼손·멸실 등에 해당하게 된 문화유산등 가액 ' + excludedDamagedValue + '원은 시행령§75의2⑤에 따라 제외했습니다).' : '.');
      }
    }
    return result;
  };

  // 지정문화유산 등에 대한 상속세 징수유예 (상속세및증여세법§74, 증여세는 §75가 준용) — 문화유산자료등·
  // 박물관자료등·국가지정문화유산등·천연기념물등에 상당하는 상속세(증여세)액의 징수를 유예한다.
  // 원문 확인 결과 증여세 징수유예는 §75(§74①중 1·3·4호는 제외한다)에 따라 박물관자료등(2호)에만
  // 적용된다 — 문화유산자료등·국가지정문화유산등·천연기념물등은 증여세 징수유예 대상이 아니다.
  // "그 재산가액에 상당하는 세액"은 시행령§76①(상속)·§77(증여, 위 §76①을 준용)에 따라
  // [산출세액×(해당재산가액÷전체재산가액)]로 계산한다(원문 확인). 유상양도 또는 인출(박물관자료등만)시
  // 즉시 징수하며(②), 이 징수에는 법문상 별도 이자상당가산액 규정이 없다(§74②는 "즉시 그 징수유예한
  // 상속세를 징수" 라고만 함).
  window.calculateCulturalHeritageTaxDeferralJS = function (p) {
    p = p || {};
    const taxType = p.taxType === 'gift' ? 'gift' : 'inheritance';
    const itemType = p.itemType;
    const validItemTypes = ['cultural_property', 'museum_material', 'national_heritage', 'natural_monument'];
    if (validItemTypes.indexOf(itemType) === -1) return { error: 'itemType을 cultural_property(문화유산자료등)/museum_material(박물관자료등)/national_heritage(국가지정문화유산등)/natural_monument(천연기념물등) 중에서 선택하세요.' };
    if (taxType === 'gift' && itemType !== 'museum_material') {
      return { error: '증여세 징수유예(§75)는 박물관자료등(museum_material)에만 적용됩니다 — §74①1·3·4호(문화유산자료등·국가지정문화유산등·천연기념물등)는 증여세 징수유예 대상에서 제외됩니다(법§75).' };
    }
    const totalTaxPayable = Number(p.totalTaxPayable) || 0;
    const totalPropertyValue = Number(p.totalPropertyValue) || 0;
    const eligiblePropertyValue = Number(p.eligiblePropertyValue) || 0;
    if (totalTaxPayable <= 0 || totalPropertyValue <= 0 || eligiblePropertyValue <= 0) {
      return { error: (taxType === 'gift' ? '증여세' : '상속세') + ' 산출세액, ' + (taxType === 'gift' ? '증여재산가액' : '상속재산가액') + ', 징수유예대상 재산가액이 필요합니다.' };
    }
    const deferredTaxAmount = Math.round(totalTaxPayable * eligiblePropertyValue / totalPropertyValue);

    const triggerEvent = p.triggerEvent;
    if (triggerEvent === 'transferred_or_withdrawn') {
      return {
        상태: '즉시징수대상', 징수유예세액: deferredTaxAmount, 납부세액: deferredTaxAmount,
        안내: '해당 재산을 유상으로 양도하거나(박물관자료등의 경우 대통령령으로 정하는 사유로 인출하여) ' + (taxType === 'gift' ? '§75(§74②준용)' : '§74②') + ' 사유가 발생해, 징수유예했던 세액 전부를 즉시 징수합니다. 이 징수에는 법문상 별도 이자상당가산액 규정이 없습니다.'
      };
    }
    if (triggerEvent === 'reinheritance_death') {
      if (taxType === 'gift') return { error: '재상속으로 인한 징수유예세액 철회(§74③)는 상속세(taxType=inheritance)에만 적용됩니다.' };
      return {
        상태: '부과철회', 징수유예세액: deferredTaxAmount, 납부세액: 0,
        안내: '징수유예 기간 중 상속인·수유자가 사망하여 다시 상속이 개시되어, 징수유예한 상속세액의 부과 결정을 철회하고 다시 부과하지 않습니다(§74③).'
      };
    }
    return {
      상태: '징수유예_적용중', 징수유예세액: deferredTaxAmount, 납부세액: 0,
      안내: (taxType === 'gift' ? '시행령§77(§76①준용)' : '시행령§76①') + '에 따라 해당 재산가액에 상당하는 ' + (taxType === 'gift' ? '증여세' : '상속세') + '액(' + deferredTaxAmount + '원 = 산출세액×해당재산가액÷' + (taxType === 'gift' ? '증여재산가액' : '상속재산가액') + ')의 징수를 유예합니다. 유상양도·인출시 즉시 징수되고(사유 transferred_or_withdrawn), 상속의 경우 소유자 사망으로 재상속되면 부과가 철회됩니다(사유 reinheritance_death, 상속세만). 징수유예를 받으려면 그 세액에 상당하는 담보를 제공해야 합니다(§74④, 국가지정문화유산등·천연기념물등은 담보 면제 가능 — ⑤).'
    };
  };

  // 합병에 따른 이익의 증여 (상증세법§38, 시행령§28) — 특수관계 법인간 합병에서 대주주등이 합병대가를
  // 주식등으로 교부받는 경우(가장 흔한 유형만 구현, 주식등 외 재산으로 받는 경우는 별도 계산 필요),
  // (합병후 신설·존속법인 1주당평가액 - 과대평가법인 1주당평가액×(과대평가법인 합병전주식수÷과대평가법인
  // 주주가 교부받은 신설법인주식수)) × 대주주등이 교부받은 신설법인주식수가 이익이다. §38은 합산배제
  // 증여재산이 아니므로 일반 증여세 산식(관계별공제 등)을 따른다.
  window.calculateMergerBenefitGiftTaxJS = function (p) {
    p = p || {};
    const postMergerValuePerShare = Number(p.postMergerValuePerShare) || 0;
    const overvaluedPreMergerValuePerShare = Number(p.overvaluedPreMergerValuePerShare) || 0;
    const overvaluedPreMergerShareCount = Number(p.overvaluedPreMergerShareCount) || 0;
    const sharesReceivedByOvervaluedShareholders = Number(p.sharesReceivedByOvervaluedShareholders) || 0;
    const largeShareholderSharesReceived = Number(p.largeShareholderSharesReceived) || 0;
    if (postMergerValuePerShare <= 0 || sharesReceivedByOvervaluedShareholders <= 0 || largeShareholderSharesReceived <= 0) {
      return { error: '합병후 1주당평가액, 과대평가법인 주주등이 교부받은 신설법인 주식수, 대주주등이 교부받은 주식수가 필요합니다.' };
    }
    const 나 = overvaluedPreMergerValuePerShare * (overvaluedPreMergerShareCount / sharesReceivedByOvervaluedShareholders);
    const thisTransactionGiftAmount = Math.max(0, Math.round((postMergerValuePerShare - 나) * largeShareholderSharesReceived));
    const totalReceivedValue = postMergerValuePerShare * largeShareholderSharesReceived;
    const gateThreshold = Math.min(totalReceivedValue * 0.3, 300000000);
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 동일한 합병등 거래가 더 있으면 각 이익을 합산해 기준금액을 계산.
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    const giftAmount = thisTransactionGiftAmount + priorBenefitSum;
    if (giftAmount < gateThreshold) {
      return { 과세대상여부: false, 이번거래합병이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 합병이익: giftAmount, 납부세액: 0, 안내: '합병이익(' + giftAmount + '원' + aggNote + ')이 기준금액(합병후 교부받은 주식가액의 30%와 3억원 중 적은 금액, ' + Math.round(gateThreshold) + '원) 미만이어서 과세하지 않습니다(§38①단서, 시행령§28④1호).' };
    }
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 이번거래합병이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 합병이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '증여일은 합병등기일입니다(§38①). 대주주등이 2인 이상인 경우 각자 계산하며, 합병대가를 주식등 외 재산으로 받는 경우(1주당평가액이 액면가액에 미달하는 경우)는 이 계산기가 다루지 않으니 별도로 계산하세요.' + aggNote
    };
  };

  // 재산사용 및 용역제공 등에 따른 이익의 증여 (상증세법§42, 시행령§32) — 무상으로 재산을 사용하거나
  // 용역을 제공받으면 그 시가상당액(담보제공 차입은 차입금×적정이자율4.6%-실제이자)이, 저가/고가로
  // 사용·제공하면 시가와 대가의 차액이 증여재산가액이다. 무상은 1천만원, 저가·고가는 시가의 30% 미만이면
  // 과세 제외한다(시행령§32②). §42는 합산배제증여재산이 아니므로 일반 증여세 산식을 따른다.
  window.calculatePropertyUseServiceGiftTaxJS = function (p) {
    p = p || {};
    const useType = p.useType;
    if (['free', 'low_or_high'].indexOf(useType) === -1) return { error: 'useType을 free(무상사용·무상용역·무상담보차입)/low_or_high(저가 또는 고가 사용·제공) 중에서 선택하세요.' };
    let giftAmount, gateThreshold, gateNote;
    if (useType === 'free') {
      if (p.isCollateralLoan) {
        const loanAmount = Number(p.loanAmount) || 0;
        const actualInterestPaid = Number(p.actualInterestPaid) || 0;
        giftAmount = Math.max(0, Math.round(loanAmount * 0.046) - actualInterestPaid);
      } else {
        giftAmount = Math.max(0, Number(p.marketValueEquivalent) || 0);
      }
      gateThreshold = 10000000;
      gateNote = '기준금액(1천만원)';
    } else {
      const marketValue = Number(p.marketValue) || 0;
      const considerationPaid = Number(p.considerationPaid) || 0;
      if (marketValue <= 0) return { error: '시가가 필요합니다.' };
      giftAmount = Math.round(Math.abs(marketValue - considerationPaid));
      gateThreshold = marketValue * 0.3;
      gateNote = '기준금액(시가의 30%, ' + Math.round(gateThreshold) + '원)';
    }
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 동일한 거래등이 더 있으면 각 이익(같은 호의 이익별로 구분)을 합산해 기준금액을 계산.
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    const thisTransactionGiftAmount = giftAmount;
    giftAmount = thisTransactionGiftAmount + priorBenefitSum;
    if (giftAmount < gateThreshold) {
      return { 과세대상여부: false, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 이익: giftAmount, 납부세액: 0, 안내: '이익(' + giftAmount + '원' + aggNote + ')이 ' + gateNote + ' 미만이어서 과세하지 않습니다(§42①단서, 시행령§32②).' };
    }
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 이번거래이익: thisTransactionGiftAmount, 직전1년합산액: priorBenefitSum, 이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '재산사용·용역제공 기간이 1년 이상이면 1년이 되는 날의 다음 날마다 새로 증여받은 것으로 봅니다(§42②). 특수관계인이 아닌 자 간의 거래는 거래관행상 정당한 사유가 없는 경우에만 적용됩니다(§42③).' + aggNote
    };
  };

  // 법인의 조직 변경 등에 따른 이익의 증여 (상증세법§42의2, 시행령§32의2) — 주식의 포괄적 교환·이전,
  // 사업양수도, 사업교환, 조직변경 등으로 소유지분이나 그 가액이 변동되어 이익을 얻으면, 지분이 변동된
  // 경우 (변동후지분-변동전지분)×변동후1주당가액을, 평가액이 변동된 경우 변동후가액-변동전가액을 증여
  // 재산가액으로 한다. 변동전 재산가액의 30%와 3억원 중 적은 금액 미만이면 과세 제외한다. 합산배제증여
  // 재산이 아니므로 일반 증여세 산식을 따른다.
  window.calculateOrgChangeGiftTaxJS = function (p) {
    p = p || {};
    const subType = p.subType;
    if (['share_change', 'value_change'].indexOf(subType) === -1) return { error: 'subType을 share_change(소유지분 변동)/value_change(평가액 변동) 중에서 선택하세요.' };
    let giftAmount, beforeValueForGate;
    if (subType === 'share_change') {
      const beforeShares = Number(p.beforeShares) || 0;
      const afterShares = Number(p.afterShares) || 0;
      const afterValuePerShare = Number(p.afterValuePerShare) || 0;
      giftAmount = Math.max(0, Math.round((afterShares - beforeShares) * afterValuePerShare));
      // 시행령§32의2②의 게이트 기준("변동 전 해당 재산가액의 100분의 30")은 변동 "전" 지분수 ×
      // 변동 "전" 1주당가액이어야 한다 — 변동후1주당가액(giftAmount 계산에만 쓰는 값)으로 근사하면
      // 조직변경으로 주당가액이 오르내린 만큼 게이트 자체가 왜곡되어 과세대상여부 판정이 틀릴 수 있다.
      // 직접입력(beforePropertyValue) 또는 변동전1주당가액(beforeValuePerShare) 중 하나가 반드시 필요하다.
      const beforeValuePerShare = Number(p.beforeValuePerShare) || 0;
      if (!(Number(p.beforePropertyValue) > 0) && !(beforeValuePerShare > 0)) {
        return { error: 'beforePropertyValue(변동 전 재산가액) 또는 beforeValuePerShare(변동 전 1주당가액) 중 하나를 입력하세요 — 게이트 기준금액(시행령§32의2②) 산정에 필요합니다.' };
      }
      beforeValueForGate = Number(p.beforePropertyValue) || (beforeShares * beforeValuePerShare);
    } else {
      const beforeValue = Number(p.beforeValue) || 0;
      const afterValue = Number(p.afterValue) || 0;
      giftAmount = Math.max(0, Math.round(afterValue - beforeValue));
      beforeValueForGate = beforeValue;
    }
    const gateThreshold = Math.min(beforeValueForGate * 0.3, 300000000);
    if (giftAmount < gateThreshold) {
      return { 과세대상여부: false, 이익: giftAmount, 납부세액: 0, 안내: '이익(' + giftAmount + '원)이 기준금액(변동전 재산가액의 30%와 3억원 중 적은 금액, ' + Math.round(gateThreshold) + '원) 미만이어서 과세하지 않습니다(§42의2①단서, 시행령§32의2②).' };
    }
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 이익: giftAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '특수관계인이 아닌 자 간의 거래는 거래관행상 정당한 사유가 없는 경우에만 적용됩니다(§42의2②).'
    };
  };

  // 재산 취득 후 재산가치 증가에 따른 이익의 증여 (상증세법§42의3, 시행령§32의3) — 자력없는 자가
  // 증여·차입 등으로 재산을 취득한 후 5년 이내 개발사업·형질변경·비상장주식 등록 등으로 재산가치가
  // 증가하면, (사유발생일 현재가액-취득가액-통상적가치상승분-가치상승기여분)이 이익이다. (취득가액+통상적
  // 가치상승분+가치상승기여분)의 30%와 3억원 중 적은 금액 미만이면 과세 제외한다. §42의3은 §47①에 열거된
  // 합산배제증여재산이므로 §55①3호에 따라 그 이익에서 3천만원을 공제한 금액이 과세표준이며(관계별
  // 증여재산공제 등은 적용하지 않음), 10년 합산에서도 제외된다.
  window.calculatePropertyValueIncreaseGiftTaxJS = function (p) {
    p = p || {};
    const propertyValueAtIncreaseEvent = Number(p.propertyValueAtIncreaseEvent) || 0;
    const acquisitionCost = Number(p.acquisitionCost) || 0;
    const normalAppreciationAmount = Number(p.normalAppreciationAmount) || 0;
    const valueIncreaseContributionAmount = Number(p.valueIncreaseContributionAmount) || 0;
    if (propertyValueAtIncreaseEvent <= 0) return { error: '재산가치증가사유 발생일 현재의 재산가액이 필요합니다.' };
    const giftAmount = Math.max(0, Math.round(propertyValueAtIncreaseEvent - acquisitionCost - normalAppreciationAmount - valueIncreaseContributionAmount));
    const gateBase = acquisitionCost + normalAppreciationAmount + valueIncreaseContributionAmount;
    const gateThreshold = Math.min(gateBase * 0.3, 300000000);
    if (giftAmount < gateThreshold) {
      return { 과세대상여부: false, 재산가치증가이익: giftAmount, 납부세액: 0, 안내: '이익(' + giftAmount + '원)이 기준금액((취득가액+통상적가치상승분+가치상승기여분)의 30%와 3억원 중 적은 금액, ' + Math.round(gateThreshold) + '원) 미만이어서 과세하지 않습니다(§42의3①단서, 시행령§32의3②).' };
    }
    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const taxBase = Math.max(0, giftAmount - 30000000 - appraisalFeeAmount);
    const calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);
    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true, 재산가치증가이익: giftAmount,
      과세표준_3천만원공제후: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: '합산배제증여재산이므로(§47①) 관계별 증여재산공제(§53)는 적용하지 않고 이익에서 3천만원을 공제해 과세표준을 계산합니다(§55①3호). 재산가치증가사유 발생 전에 그 재산을 양도한 경우에는 양도한 날을 재산가치증가사유 발생일로 봅니다(§42의3②후단). 거짓·부정한 방법으로 증여세를 감소시킨 경우에는 특수관계인이 아닌 자 간에도 적용되며 5년 기간 제한이 없습니다(§42의3③).'
    };
  };

  // 비과세되는 증여재산 (상증세법§46) — 열거된 항목에 해당하면 그 금액에 대해 증여세를 부과하지 않는다.
  // 시행령이 정하는 세부요건(우리사주조합원 소액주주기준, 사내근로복지기금 유사단체 범위, 이재구호금품 등의
  // 구체적 한도 등)은 이 도구가 검증하지 않으므로 별도로 확인해야 한다.
  const NONTAXABLE_GIFT_PROPERTY_LABELS = {
    government: { 근거호: '§46 1호', 설명: '국가나 지방자치단체로부터 증여받은 재산의 가액' },
    esop: { 근거호: '§46 2호', 설명: '우리사주조합원(소액주주 기준 충족)이 우리사주조합을 통해 취득한 주식의 취득가액과 시가의 차액 상당 이익' },
    political_party: { 근거호: '§46 3호', 설명: '「정당법」에 따른 정당이 증여받은 재산의 가액' },
    labor_welfare_fund: { 근거호: '§46 4호', 설명: '「근로복지기본법」에 따른 사내근로복지기금 등이 증여받은 재산의 가액' },
    disaster_relief: { 근거호: '§46 5호', 설명: '사회통념상 인정되는 이재구호금품·치료비·피부양자의 생활비·교육비 등' },
    credit_guarantee_fund: { 근거호: '§46 6호', 설명: '「신용보증기금법」에 따른 신용보증기금 등 유사단체가 증여받은 재산의 가액' },
    public_entity: { 근거호: '§46 7호', 설명: '국가·지방자치단체 또는 공공단체가 증여받은 재산의 가액' },
    disabled_insurance: { 근거호: '§46 8호', 설명: '장애인을 보험금 수령인으로 하는 대통령령이 정하는 보험의 보험금' },
    veteran_bereaved: { 근거호: '§46 9호', 설명: '국가유공자의 유족이나 의사자의 유족이 증여받은 성금 및 물품 등 재산의 가액' },
    npo_succession: { 근거호: '§46 10호', 설명: '비영리법인 해산·업무변경으로 다른 비영리법인이 승계받은 재산의 가액' }
  };
  window.calculateNontaxableGiftPropertyJS = function (p) {
    p = p || {};
    const itemType = p.itemType;
    const meta = NONTAXABLE_GIFT_PROPERTY_LABELS[itemType];
    if (!meta) return { error: 'itemType을 government/esop/political_party/labor_welfare_fund/disaster_relief/credit_guarantee_fund/public_entity/disabled_insurance/veteran_bereaved/npo_succession 중에서 선택하세요.' };
    const amount = Math.max(0, Number(p.amount) || 0);
    if (amount <= 0) return { error: '금액이 필요합니다.' };
    return {
      비과세여부: true, 근거호: meta.근거호, 비과세금액: amount,
      안내: meta.설명 + ' — ' + meta.근거호 + '에 따라 증여세를 부과하지 않습니다. 세부 요건(대통령령으로 정하는 범위·한도 등)은 별도로 확인하세요. 이 금액은 증여세 계산기의 증여재산가액에 포함하지 마세요.'
    };
  };

  // 특정법인과의 거래를 통한 이익의 증여 의제 (상증세법§45의5, 시행령§34의5) — 지배주주등의 주식보유비율이
  // 30% 이상인 특정법인이 지배주주의 특수관계인과 무상제공·저가양도·고가양수·불균등 자본거래 등을 하면,
  // 특정법인의 이익 × 지배주주등의 주식보유비율을 그 지배주주등이 증여받은 것으로 본다. §47①에 §45의5가
  // 열거되어 있지 않아 합산배제증여재산이 "아니므로" 일반 증여세 산식(관계별공제 등)을 따르되(다만 증여자가
  // 특정법인이므로 통상 관계별공제 한도는 0으로 처리한다), §45의5②의 "직접증여시 증여세상당액-법인세상당액"
  // 캡이 적용되고, 지배주주등별 증여의제이익이 1억원 미만이면 과세하지 않는다(시행령§34의5⑤).
  window.calculateSpecificCorporationGiftTaxJS = function (p) {
    p = p || {};
    const benefitToCorpAmount = Number(p.benefitToCorpAmount) || 0;
    if (benefitToCorpAmount <= 0) return { error: '특정법인이 얻는 이익(증여재산가액·채무면제이익·자본거래이익·시가차액 등)이 필요합니다.' };
    const corporateTaxAfterCredit = Math.max(0, Number(p.corporateTaxAfterCredit) || 0);
    const corporateTaxableIncome = Number(p.corporateTaxableIncome) || 0;
    const shareholderOwnershipRatio = Math.min(1, Math.max(0, Number(p.shareholderOwnershipRatio) || 0));
    if (shareholderOwnershipRatio <= 0) return { error: '지배주주등의 주식보유비율이 필요합니다.' };
    // §45의5① — 지배주주등의 주식보유비율이 100분의 30 이상인 법인만 "특정법인"에 해당해 과세대상이 된다.
    // 30% 미만이면 애초에 이 조문의 적용대상 법인이 아니므로 이하 계산을 진행하지 않는다.
    if (shareholderOwnershipRatio < 0.3) {
      return {
        과세대상여부: false, 지배주주등주식보유비율: shareholderOwnershipRatio, 증여의제이익: 0, 납부세액: 0,
        안내: '지배주주등의 주식보유비율(' + (shareholderOwnershipRatio * 100).toFixed(1) + '%)이 100분의 30 미만이어서 §45의5의 "특정법인"에 해당하지 않아 과세대상이 아닙니다(§45의5①).'
      };
    }

    const incomeRatio = corporateTaxableIncome > 0 ? Math.min(1, benefitToCorpAmount / corporateTaxableIncome) : 0;
    const corporateTaxEquivalentTotal = Math.round(corporateTaxAfterCredit * incomeRatio);
    const specificCorpNetBenefit = Math.max(0, benefitToCorpAmount - corporateTaxEquivalentTotal);
    const thisTransactionGiftDeemedAmount = Math.round(specificCorpNetBenefit * shareholderOwnershipRatio);
    // §43②·시행령§32의4 — 증여일부터 소급 1년 이내 동일한 거래등이 더 있으면 각 이익을 합산해 기준금액을 계산.
    const priorBenefitSum = sumPriorBenefitsWithinOneYear(p.priorBenefitsWithinOneYear);
    const aggNote = priorBenefitSum > 0 ? (' (§43②에 따라 1년 이내 이전거래 이익 ' + priorBenefitSum + '원을 합산한 금액입니다.)') : '';
    const giftDeemedAmount = thisTransactionGiftDeemedAmount + priorBenefitSum;

    if (giftDeemedAmount < 100000000) {
      return {
        과세대상여부: false, 이번거래증여의제이익: thisTransactionGiftDeemedAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftDeemedAmount, 납부세액: 0,
        안내: '증여의제이익(' + giftDeemedAmount + '원' + aggNote + ')이 1억원 미만이어서 과세하지 않습니다(시행령§34의5⑤).'
      };
    }

    const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftDeemedAmount));
    const priorGiftAmount = giftAggregationAmount(Number(p.priorGiftAmount) || 0);
    const taxBase = Math.max(0, giftDeemedAmount + priorGiftAmount - relationDeduction - appraisalFeeAmount - disasterLossAmount);
    let calculatedTax = progressiveGiftInheritTax(taxBase, GIFT_INHERIT_TAX_BRACKETS);

    // §45의5②·시행령§34의5⑨ — 산출세액이 "지배주주등이 직접 증여받은 경우의 증여세 상당액 - 법인세상당액"을
    // 초과하면 그 초과액은 없는 것으로 본다. "직접 증여받은 경우의 증여세 상당액"은 시행령이 별도 공제 없이
    // [특정법인의 이익(법인세공제전, 4항1호금액)×지분율]에 누진세율만 적용한 금액으로 정의하므로, 이미 갖고
    // 있는 값(benefitToCorpAmount·shareholderOwnershipRatio)으로 자동계산한다(직접입력하면 그 값이 우선).
    const corporateTaxEquivalentForShareholder = Math.round(corporateTaxEquivalentTotal * shareholderOwnershipRatio);
    const directGiftTaxEquivalent = Number(p.directGiftTaxEquivalent) > 0
      ? Number(p.directGiftTaxEquivalent)
      : progressiveGiftInheritTax(Math.round(benefitToCorpAmount * shareholderOwnershipRatio), GIFT_INHERIT_TAX_BRACKETS);
    let capApplied = false;
    {
      const capLimit = Math.max(0, directGiftTaxEquivalent - corporateTaxEquivalentForShareholder);
      if (calculatedTax > capLimit) { calculatedTax = capLimit; capApplied = true; }
    }

    const priorPaidTax = Number(p.priorPaidTax) || 0;
    // §59·시행령§48(§21 준용) — 외국납부세액공제 = 증여세산출세액×(외국법령에 따라 증여세가 부과된
    // 증여재산의 과세표준÷법§55①에 따른 증여세의 과세표준), 실제 납부한 외국증여세액 한도.
    // foreignGiftTaxBase를 입력하면 이 비례산식으로 자동계산하고, 없으면(구버전 호환) 실제 납부액을
    // 잔여세액 한도로 그대로 쓴다.
    const foreignGiftTaxBase = Number(p.foreignGiftTaxBase) || 0;
    const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
    const foreignTaxCreditByFormula = (foreignGiftTaxBase > 0 && taxBase > 0)
      ? Math.round(calculatedTax * Math.min(1, foreignGiftTaxBase / taxBase))
      : foreignTaxPaidAmount;
    const foreignTaxCredit = Math.min(foreignTaxPaidAmount, foreignTaxCreditByFormula, Math.max(0, calculatedTax - priorPaidTax));
    const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxCredit);
    const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
    const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
    const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
    const penalties = giftFilingPenalties(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), !!p.isOffshoreTransaction, p.monthsAfterDesignatedDueDate, Number(p.unpaidTaxAtDesignatedDueDate), p.fraudulentUnderreportedTaxAmount);
    const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
    return {
      과세대상여부: true,
      특정법인의이익: specificCorpNetBenefit, 법인세상당액_전체: corporateTaxEquivalentTotal,
      이번거래증여의제이익: thisTransactionGiftDeemedAmount, 직전1년합산액: priorBenefitSum, 증여의제이익: giftDeemedAmount,
      증여재산공제: relationDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
      과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
      무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
      납부세액: finalTax,
      안내: (capApplied ? '산출세액이 §45의5② 한도(직접증여시 증여세상당액-법인세상당액)를 초과해 그 한도로 낮췄습니다. ' : '') + '증여자가 지배주주의 친족이 아닌 특정법인 자체이므로 증여재산공제(§53)는 통상 적용되지 않습니다(위 관계별공제 한도는 0으로 입력하는 것이 원칙입니다). 증여세 과세표준 신고기한은 특정법인의 법인세 과세표준 신고기한이 속하는 달의 말일부터 3개월입니다(§68①).' + aggNote
    };
  };

  // 상속재산으로 보는 보험금·신탁재산·퇴직금 등(간주상속재산, 상증세법§8,§9,§10) — 민법상 상속재산은
  // 아니지만 상속세법이 상속재산으로 의제하는 항목들. 각 항목의 포함 여부·포함액을 판정해, 그 결과를
  // 위 상속세 계산기의 "상속재산가액"에 합산해 넣는 용도다.
  // §8(보험금): 피상속인이 보험계약자이거나(①), 계약자가 다르더라도 피상속인이 실질적으로 보험료를
  //   납부한 경우(②, 그 납부비율만큼) 사망보험금을 상속재산으로 본다.
  // §9(신탁재산): 피상속인이 신탁한 재산은 원칙적으로 상속재산으로 보되(①본문), §33①에 따라 이미
  //   수익자의 증여재산가액으로 처리된 신탁수익권 가액은 제외한다(①단서). 반대로 피상속인이 타인이
  //   설정한 신탁의 이익을 받을 권리를 갖고 있었다면 그 가액도 상속재산에 포함한다(②).
  // §10(퇴직금 등): 피상속인의 사망으로 지급되는 퇴직금·퇴직수당·공로금·연금 등은 원칙적으로 상속재산
  //   으로 보되, 국민연금법·공무원연금법 등 열거된 유족연금·유족보상금류는 제외한다.
  window.calculateDeemedInheritancePropertyJS = function (p) {
    p = p || {};
    const itemType = p.itemType;
    const validTypes = ['insurance', 'trust_settled', 'trust_benefit_from_others', 'successive_trust_beneficiary', 'retirement'];
    if (validTypes.indexOf(itemType) === -1) {
      return { error: 'itemType을 insurance(보험금)/trust_settled(피상속인이 신탁한 재산)/trust_benefit_from_others(피상속인이 타인신탁의 수익권 보유)/successive_trust_beneficiary(수익자연속신탁의 수익자 사망)/retirement(퇴직금등) 중에서 선택하세요.' };
    }
    const amount = Math.max(0, Number(p.amount) || 0);
    let includedAmount, note;
    if (itemType === 'insurance') {
      if (p.wasPolicyholderDecedent) {
        includedAmount = amount;
        note = '피상속인이 보험계약자인 보험계약에서 받는 사망보험금이므로 전액 상속재산으로 봅니다(§8①).';
      } else {
        const ratio = Math.min(1, Math.max(0, Number(p.premiumPaidByDecedentRatio) || 0));
        includedAmount = Math.round(amount * ratio);
        note = ratio > 0
          ? '보험계약자는 피상속인이 아니지만 피상속인이 실질적으로 보험료의 ' + Math.round(ratio * 100) + '%를 납부한 것으로 보아 그 비율만큼 상속재산으로 봅니다(§8②).'
          : '보험계약자가 피상속인이 아니고 피상속인이 실질적으로 보험료를 납부한 사실도 없어 상속재산으로 보지 않습니다.';
      }
    } else if (itemType === 'trust_settled') {
      if (p.isAlreadyGiftTaxedUnder33_1) {
        includedAmount = 0;
        note = '§33①에 따라 이미 수익자의 증여재산가액으로 처리된 신탁의 이익을 받을 권리이므로 상속재산으로 보지 않습니다(§9①단서).';
      } else {
        includedAmount = amount;
        note = '피상속인이 신탁한 재산이므로 상속재산으로 봅니다(§9①본문).';
      }
    } else if (itemType === 'trust_benefit_from_others') {
      includedAmount = amount;
      note = '피상속인이 신탁으로 인하여 타인으로부터 신탁의 이익을 받을 권리를 소유하고 있었으므로 그 이익에 상당하는 가액을 상속재산에 포함합니다(§9②).';
    } else if (itemType === 'successive_trust_beneficiary') {
      includedAmount = amount;
      note = '수익자연속신탁의 수익자(피상속인)가 사망함으로써 타인이 새로 취득한 신탁의 이익을 받을 권리의 가액이므로, 사망한 수익자(피상속인)의 상속재산에 포함합니다(§9③).';
    } else { // retirement
      if (p.isExcludedSurvivorPension) {
        includedAmount = 0;
        note = '국민연금법·공무원연금법 등이 정하는 유족연금·유족보상금류 등 §10 단서의 열거 항목에 해당하여 상속재산으로 보지 않습니다.';
      } else {
        includedAmount = amount;
        note = '피상속인의 사망으로 지급되는 퇴직금·퇴직수당·공로금·연금 등이므로 상속재산으로 봅니다(§10본문).';
      }
    }
    return {
      원금액: amount,
      간주상속재산포함액: includedAmount,
      안내: note + ' 이 금액을 상속세 계산기의 상속재산가액에 합산해 넣으세요.'
    };
  };

  // ============================================================
  // 상속증여재산 평가 (상속세및증여세법 §60~66, 보충적평가방법) — gs-backend와 동일 로직.
  // 증여세·상속세 화면의 "자산 목록"에서 자산별 평가액을 구할 때 이 함수들을 쓴다.
  // ============================================================

  // 비상장주식 1주당 평가액 (§63, 시행령 §54) — 순손익가치·순자산가치 가중평균(일반 3:2, 부동산과다보유법인 2:3), 순자산가치 80% 하한.
  // §54④ — 아래 사유(1·2·6호는 무조건, 3·5호는 가중평균한 가액이 순자산가치보다 낮은 경우로 한정)에
  // 해당하면 순손익가치·순자산가치 가중평균을 쓰지 않고 순자산가치 그대로를 1주당 평가액으로 한다.
  // shares1/2/3YearsAgo(각 사업연도 종료일 현재 발행주식총수, 시행령§56③ — 증자·감자가 있었으면
  // 시행령§56③단서·calculateAdjustedShareCountJS로 환산한 값)를 생략하면 totalIssuedShares(평가기준일
  // 현재, §54⑤)를 그대로 쓴다(직전 3년 내 증자·감자가 없었던 통상적인 경우와 동일한 결과 — 하위호환).
  function unlistedStockValuePerShare(netProfit1YearAgo, netProfit2YearsAgo, netProfit3YearsAgo, totalIssuedShares, netAssetValue, isRealEstateHeavy, netAssetOnlyFlags, shares1YearAgo, shares2YearsAgo, shares3YearsAgo) {
    const shares = Number(totalIssuedShares) || 0;
    if (shares <= 0) return null;
    const s1 = Number(shares1YearAgo) || shares;
    const s2 = Number(shares2YearsAgo) || shares;
    const s3 = Number(shares3YearsAgo) || shares;
    // 시행령§56② — "1주당 최근 3년간의 순손익액의 가중평균액"은 각 사업연도의 "1주당" 순손익액(그 해
    // 발행주식총수 기준)을 먼저 구한 뒤 3:2:1로 가중평균한다 — 3개년 순손익액을 먼저 가중합산한 뒤
    // 하나의(평가기준일 현재) 발행주식총수로 나누면, 그 사이 증자·감자가 있었을 때 왜곡된다.
    const weightedNetProfitPerShare = ((Number(netProfit1YearAgo) || 0) / s1 * 3 + (Number(netProfit2YearsAgo) || 0) / s2 * 2 + (Number(netProfit3YearsAgo) || 0) / s3 * 1) / 6;
    const profitValuePerShare = weightedNetProfitPerShare / 0.10;
    const netAssetValuePerShare = (Number(netAssetValue) || 0) / shares;
    const weights = isRealEstateHeavy ? [2, 3] : [3, 2];
    let valuePerShare = (profitValuePerShare * weights[0] + netAssetValuePerShare * weights[1]) / (weights[0] + weights[1]);

    const f = netAssetOnlyFlags || {};
    const unconditionalForce = !!f.isLiquidationOrBusinessDifficult || !!f.isNewOrDormantOrClosedBusiness || !!f.hasFixedDissolutionWithin3Years;
    const conditionalForce = (!!f.isRealEstateAssetRatio80Plus || !!f.isStockAssetRatio80Plus) && valuePerShare < netAssetValuePerShare;
    const netAssetOnlyApplied = unconditionalForce || conditionalForce;
    if (netAssetOnlyApplied) {
      valuePerShare = netAssetValuePerShare;
      return { 순손익가치_1주당: Math.round(profitValuePerShare), 순자산가치_1주당: Math.round(netAssetValuePerShare), 평가액_1주당: Math.round(valuePerShare), 순자산가치100퍼센트_적용: true, 순자산가치80퍼센트_하한적용: false };
    }
    const floor = netAssetValuePerShare * 0.8;
    const floorApplied = valuePerShare < floor;
    if (floorApplied) valuePerShare = floor;
    return { 순손익가치_1주당: Math.round(profitValuePerShare), 순자산가치_1주당: Math.round(netAssetValuePerShare), 평가액_1주당: Math.round(valuePerShare), 순자산가치100퍼센트_적용: false, 순자산가치80퍼센트_하한적용: floorApplied };
  }

  window.calculateUnlistedStockValueJS = function (p) {
    p = p || {};
    const totalIssuedShares = Number(p.totalIssuedShares);
    if (!totalIssuedShares || totalIssuedShares <= 0) return { error: '발행주식총수가 필요합니다.' };
    const ownedShares = Number(p.ownedShares) || 0;
    const netAssetOnlyFlags = {
      isLiquidationOrBusinessDifficult: p.isLiquidationOrBusinessDifficult,
      isNewOrDormantOrClosedBusiness: p.isNewOrDormantOrClosedBusiness,
      isRealEstateAssetRatio80Plus: p.isRealEstateAssetRatio80Plus,
      isStockAssetRatio80Plus: p.isStockAssetRatio80Plus,
      hasFixedDissolutionWithin3Years: p.hasFixedDissolutionWithin3Years
    };
    const result = unlistedStockValuePerShare(p.netProfit1YearAgo, p.netProfit2YearsAgo, p.netProfit3YearsAgo, totalIssuedShares, p.netAssetValue, !!p.isRealEstateHeavy, netAssetOnlyFlags, p.totalIssuedShares1YearAgo, p.totalIssuedShares2YearsAgo, p.totalIssuedShares3YearsAgo);
    let totalValue = Math.round(result.평가액_1주당 * ownedShares);
    // §53⑧ — 최대주주등 할증평가(20%) 배제사유 9개. 9호(중소·중견기업)만 구현돼 있던 것을
    // 나머지 8개(1~8호)까지 전부 반영한다.
    const isPremiumExempt = !!p.hasContinuousLossFor3Years // 1호
      || !!p.allMajorShareholderSharesSoldWithin6Months // 2호
      || !!p.isDeemedProfitCalculationArticle28to30 // 3호(§28~§30 이익 계산시)
      || !!p.isParentCompanyOfAnotherMajorShareholderValuation // 4호
      || !!p.newBusinessOperatingLossAllYears // 5호
      || !!p.isLiquidationConfirmedByFilingDeadline // 6호
      || !!p.lostMajorShareholderStatusByInheritanceOrGift // 7호
      || !!p.isNomineeTrustDeemedGift // 8호(§45의2)
      || !!p.isSmallBusiness || !!p.isMediumBusinessUnder500B; // 9호
    const majorShareholderPremium = (p.isMajorShareholder && !isPremiumExempt) ? Math.round(totalValue * 0.2) : 0;
    totalValue += majorShareholderPremium;
    return Object.assign({
      발행주식총수: totalIssuedShares, 평가대상주식수: ownedShares, 최대주주할증액: majorShareholderPremium, 할증평가배제여부: isPremiumExempt, 평가총액: totalValue
    }, result, {
      안내: 'isMajorShareholder(최대주주등 해당 여부)와 ownedShares(보유주식수)를 판정할 때는 시행령§53⑤에 따라 평가기준일부터 소급 1년 이내에 최대주주등이 양도하거나 증여한 주식등도 그 보유주식등에 합산해서 판단해야 합니다(이 계산기는 그 합산을 자동으로 반영하지 않으므로 입력 전에 직접 확인하세요).'
    });
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

  // 상장주식 평가 (§63①1호가목) — 평가기준일 전후 2개월 종가평균 × 주식수.
  // §63③ — "제1항제1호"(가목 상장주식·나목 비상장주식 모두 포함)에 최대주주등 할증평가(20%)가 적용되므로
  // 상장주식도 예외가 아니다(§53⑧ 배제사유 9개는 비상장주식용 calculateUnlistedStockValueJS와 동일).
  // p 객체로 호출하면 할증까지 반영하고, 구버전 호환을 위해 (averageClosingPrice, shares) 위치인자
  // 호출도 계속 지원한다(이 경우 할증 없이 §63①1호가목 금액만 반환).
  window.calculateListedStockValueJS = function (p, sharesArg) {
    let averageClosingPrice, shares, premiumParams;
    if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
      averageClosingPrice = Number(p.averageClosingPrice) || 0;
      shares = Number(p.shares) || 0;
      premiumParams = p;
    } else {
      averageClosingPrice = Number(p) || 0;
      shares = Number(sharesArg) || 0;
      premiumParams = {};
    }
    let totalValue = Math.round(averageClosingPrice * shares);
    // §53⑧ — 최대주주등 할증평가(20%) 배제사유 9개(비상장주식과 동일 조문을 준용).
    const isPremiumExempt = !!premiumParams.hasContinuousLossFor3Years // 1호
      || !!premiumParams.allMajorShareholderSharesSoldWithin6Months // 2호
      || !!premiumParams.isDeemedProfitCalculationArticle28to30 // 3호
      || !!premiumParams.isParentCompanyOfAnotherMajorShareholderValuation // 4호
      || !!premiumParams.newBusinessOperatingLossAllYears // 5호
      || !!premiumParams.isLiquidationConfirmedByFilingDeadline // 6호
      || !!premiumParams.lostMajorShareholderStatusByInheritanceOrGift // 7호
      || !!premiumParams.isNomineeTrustDeemedGift // 8호
      || !!premiumParams.isSmallBusiness || !!premiumParams.isMediumBusinessUnder500B; // 9호
    const majorShareholderPremium = (premiumParams.isMajorShareholder && !isPremiumExempt) ? Math.round(totalValue * 0.2) : 0;
    totalValue += majorShareholderPremium;
    if (premiumParams.isMajorShareholder === undefined) {
      return totalValue; // 구버전 호환: isMajorShareholder를 아예 지정하지 않은 위치인자 호출은 숫자만 반환
    }
    return {
      평가액_할증전: Math.round(averageClosingPrice * shares), 최대주주할증액: majorShareholderPremium, 할증평가배제여부: isPremiumExempt, 상장주식가액: totalValue,
      안내: 'isMajorShareholder(최대주주등 해당 여부)와 shares(보유주식수)를 판정할 때는 시행령§53⑤에 따라 평가기준일부터 소급 1년 이내에 최대주주등이 양도하거나 증여한 주식등도 그 보유주식등에 합산해서 판단해야 합니다(이 계산기는 그 합산을 자동으로 반영하지 않으므로 입력 전에 직접 확인하세요).'
    };
  };

  // 임대료 등의 환산가액 (§61⑤, 시행령 §50) — 임대 중인 부동산은 이 환산가액과 기준시가(보충적평가액)
  // 중 큰 금액을 그 자산의 가액으로 한다. 환산율은 12%(시행규칙 §15).
  window.calculateRentalConversionValueJS = function (annualRent, deposit) {
    return Math.round((Number(annualRent) || 0) / 0.12 + (Number(deposit) || 0));
  };

  // 저당권·질권 등이 설정된 재산 및 임대차계약이 체결된 재산의 평가특례(상증세법§66, 시행령§63①1호) —
  // 시가·보충적평가액(baseValue, 지분 적용 전 재산 전체 기준), 그 재산이 담보하는 채권액(또는 등기된
  // 전세금), 임대보증금 환산가액(임대보증금+연간임대료÷12%) 중 가장 큰 금액으로 평가한다. 담보채권액·
  // 임대보증금은 등기부·임대차계약상 재산 "전체" 기준이므로, 지분(ownershipRatio)은 셋 중 최댓값을 정한
  // "다음"에 그 결과 전체에 한 번만 곱해야 한다(먼저 곱하면 지분이 작을수록 담보채권액이 부당하게 이겨버림).
  // 주식 등 이미 보유수량 기준으로 산출된 평가액(ownershipRatio를 적용할 대상이 아닌 경우)은 ownershipRatio를
  // 생략하거나 1로 두면 된다.
  window.calculateMortgagedOrLeasedPropertyValueJS = function (p) {
    p = p || {};
    const baseValue = Number(p.baseValue) || 0;
    const securedDebtAmount = Number(p.securedDebtAmount) || 0;
    const rentalConversionValue = (Number(p.annualRent) || 0) > 0 || (Number(p.deposit) || 0) > 0
      ? window.calculateRentalConversionValueJS(p.annualRent, p.deposit) : 0;
    const valueBeforeRatio = Math.max(baseValue, securedDebtAmount, rentalConversionValue);
    const ratio = p.ownershipRatio == null ? 1 : Math.max(0, Number(p.ownershipRatio) || 0);
    return {
      기준가액_시가또는보충적평가액: baseValue,
      담보채권액: securedDebtAmount,
      임대보증금환산가액: rentalConversionValue,
      평가액_지분적용전: valueBeforeRatio,
      지분율: ratio,
      최종평가액: Math.round(valueBeforeRatio * ratio)
    };
  };

  // 영업권 평가 (§64, 시행령 §59②, 시행규칙 §17의3) — 최근 3년간 순손익액의 가중평균(1년전×3+2년전×2+3년전×1)/6의
  // 50%가 자기자본의 정상수익률(10%)을 초과하는 부분을, 영업권 지속연수 5년에 대한 10% 연금현가계수(3.79079)로 현재가치화한다.
  // §59②단서 — 매입한 무체재산권으로서 그 성질상 영업권에 포함시켜 평가되는 것은 별도 평가하지 않되,
  // 그 무체재산권의 평가액(보통 매입가액)이 위 환산가액보다 크면 그 값을 영업권 평가액으로 한다.
  window.calculateGoodwillValueJS = function (netProfit1YearAgo, netProfit2YearsAgo, netProfit3YearsAgo, selfCapital, purchasedIntangibleAssetValue) {
    const weightedNetProfit = ((Number(netProfit1YearAgo) || 0) * 3 + (Number(netProfit2YearsAgo) || 0) * 2 + (Number(netProfit3YearsAgo) || 0) * 1) / 6;
    const excessProfit = Math.max(0, weightedNetProfit * 0.5 - (Number(selfCapital) || 0) * 0.1);
    const computed = Math.round(excessProfit * 3.79079);
    return Math.max(computed, Number(purchasedIntangibleAssetValue) || 0);
  };

  // 연 10% 할인율의 n년 연금현가계수 — 영업권(§59②, n=5 고정 3.79079)과 같은 방식을
  // 지상권·특허권·광업권 등 n이 자산마다 달라지는 항목에 공통으로 쓴다.
  function annuityPresentValueFactor10_(years) {
    const n = Number(years) || 0;
    if (n <= 0) return 0;
    return (1 - Math.pow(1.1, -n)) / 0.1;
  }

  // 지상권의 평가 (§61③, 시행령§51①, 시행규칙§16①②) — 지상권이 설정된 토지가액의 연 2%를
  // 매년의 수입금액으로 보고, 잔존연수(민법§280·281 준용)에 대한 10% 연금현가계수로 환산한다.
  window.calculateGroundRightValueJS = function (landValue, remainingYears) {
    const annualIncome = Math.round((Number(landValue) || 0) * 0.02);
    const value = Math.round(annualIncome * annuityPresentValueFactor10_(remainingYears));
    return { 연간수입금액: annualIncome, 지상권가액: value };
  };

  // §64 1호(취득가액에서 감가상각비를 뺀 금액)와 2호(장래경제적이익 환산가액) 중 큰 금액으로 한다.
  function applyAcquisitionCostFloor_(convertedValue, acquisitionCost, depreciationSinceAcquisition) {
    const cost = Number(acquisitionCost) || 0;
    if (cost <= 0) return { finalValue: convertedValue, acquisitionValueLessDepreciation: null };
    const dep = Number(depreciationSinceAcquisition) || 0;
    const acquisitionValueLessDepreciation = Math.max(0, cost - dep);
    return { finalValue: Math.max(convertedValue, acquisitionValueLessDepreciation), acquisitionValueLessDepreciation: acquisitionValueLessDepreciation };
  }

  // 특허권·실용신안권·상표권·디자인권·저작권 등 무체재산권의 평가 (§64, 시행령§59⑤, 시행규칙§19②③) — 권리로
  // 장래에 받을 각 연도 수입금액을, 평가기준일부터의 잔존(경과)연수(최대 20년)에 대한 10% 연금현가계수로
  // 환산한 가액(2호)과, 매입한 것이라면 취득가액에서 감가상각비를 뺀 금액(1호) 중 큰 금액으로 한다(§64).
  // 각 연도 수입금액이 확정되지 않은 경우 평가기준일 전 3년간 평균 수입금액을 쓴다(시행규칙§19④).
  window.calculatePatentRightValueJS = function (annualIncomeAmount, remainingYears, acquisitionCost, depreciationSinceAcquisition) {
    const years = Math.min(Number(remainingYears) || 0, 20);
    const convertedValue = Math.round((Number(annualIncomeAmount) || 0) * annuityPresentValueFactor10_(years));
    const floored = applyAcquisitionCostFloor_(convertedValue, acquisitionCost, depreciationSinceAcquisition);
    const result = { 환산가액: convertedValue, 특허권등가액: floored.finalValue };
    if (floored.acquisitionValueLessDepreciation != null) result.취득가액_감가상각후 = floored.acquisitionValueLessDepreciation;
    return result;
  };

  // 광업권·채석권등의 평가 (§64, 시행령§59⑥, 시행규칙§19⑤) — 평가기준일 전 3년간 평균소득(실적이
  // 없으면 예상순소득)을, 평가기준일 이후의 채굴가능연수에 대한 10% 연금현가계수로 환산한 가액(2호)과,
  // 매입한 것이라면 취득가액에서 감가상각비를 뺀 금액(1호) 중 큰 금액으로 한다(§64).
  window.calculateMiningRightValueJS = function (average3YearIncome, miningPossibleYears, acquisitionCost, depreciationSinceAcquisition) {
    const convertedValue = Math.round((Number(average3YearIncome) || 0) * annuityPresentValueFactor10_(miningPossibleYears));
    const floored = applyAcquisitionCostFloor_(convertedValue, acquisitionCost, depreciationSinceAcquisition);
    const result = { 환산가액: convertedValue, 광업권등가액: floored.finalValue };
    if (floored.acquisitionValueLessDepreciation != null) result.취득가액_감가상각후 = floored.acquisitionValueLessDepreciation;
    return result;
  };

  // 조합원입주권 등 부동산을 취득할 수 있는 권리의 평가 (§61③, 시행령§51②, 시행규칙§16③) — 재개발·
  // 재건축 조합원권리가액은 분양대상자의 종전 토지·건축물 가격에 (정비사업완료후 대지·건축물의 총
  // 수입추산액－총소요사업비)÷종전토지·건축물의 총가액 비율을 곱해 계산하며(도시및주거환경정비법§74①
  // 관리처분계획 기준), 여기에 평가기준일까지 납입한 계약금·중도금 등과 프리미엄상당액을 더하면
  // 부동산취득권리 전체의 평가액이 된다(시행령§51②본문).
  window.calculateMemberRightValueJS = function (p) {
    p = p || {};
    const formerValue = Number(p.formerLandBuildingValue) || 0;
    const expectedRevenue = Number(p.expectedRevenueAfterCompletion) || 0;
    const projectCost = Number(p.totalProjectCost) || 0;
    const totalFormerValue = Number(p.totalFormerValue);
    if (!totalFormerValue || totalFormerValue <= 0) return { error: '종전 토지 및 건축물의 총 가액(totalFormerValue)이 필요합니다.' };
    const memberRightValue = Math.round(formerValue * (expectedRevenue - projectCost) / totalFormerValue);
    const paidInstallments = Number(p.paidInstallments) || 0;
    const premium = Number(p.premium) || 0;
    const totalValue = memberRightValue + paidInstallments + premium;
    return { 조합원권리가액: memberRightValue, 부동산취득권리_평가액: totalValue };
  };

  // 배당차액 (시행령§57③, 시행규칙§18②) — 기업공개 준비중인 주식등(거래소 상장법인이 유가증권신고
  // 직전 6개월(증여세는 3개월)부터 상장 전까지 발행한 신주) 평가시, 상장주식 평가액에서 이 배당차액을
  // 뺀다. 신주발행일이 속하는 사업연도 개시일부터 배당기산일 전일까지의 일수만큼 직전기 배당률을
  // 일할 계산한 금액이다.
  window.calculateDividendDifferenceJS = function (parValuePerShare, priorFiscalYearDividendRate, daysFromFiscalYearStartToRecordDate) {
    const value = Math.round((Number(parValuePerShare) || 0) * (Number(priorFiscalYearDividendRate) || 0) * ((Number(daysFromFiscalYearStartToRecordDate) || 0) / 365));
    return { 배당차액: value };
  };

  // 증자·감자 전 사업연도의 발행주식총수 환산 (시행령§56③단서, 시행규칙§17의3⑤) — 비상장주식의
  // 순손익가치를 계산할 때, 평가기준일이 속하는 사업연도 이전 3년 이내에 증자·감자가 있었으면
  // 그 이전 각 사업연도의 발행주식총수를 이 비율로 환산해서 써야 한다(단순히 현재 발행주식총수를
  // 그대로 3개년에 적용하면 안 됨). changeType이 'capital_increase'(증자)면 (기준시점직전주식수+
  // 증자주식수)/기준시점직전주식수를, 'capital_decrease'(감자)면 (기준시점직전주식수－감자주식수)/
  // 기준시점직전주식수를 비율로 곱한다.
  window.calculateAdjustedShareCountJS = function (changeType, sharesAtHistoricalFiscalYearEnd, sharesJustBeforeChange, changedShares) {
    const base = Number(sharesJustBeforeChange);
    if (!base || base <= 0) return null;
    const changed = Number(changedShares) || 0;
    const ratio = changeType === 'capital_decrease' ? (base - changed) / base : (base + changed) / base;
    return Math.round((Number(sharesAtHistoricalFiscalYearEnd) || 0) * ratio);
  };

  // 선박 등 그 밖의 유형재산의 평가 (상증세법§62, 시행령§52) — 선박·항공기·차량·기계장비·입목은
  // 처분시 재취득예상가액 → (확인 안 되면) 장부가액(취득가액-감가상각비) → (그래도 없으면) 지방세법
  // 시행령상 시가표준액을 순차 적용한다(§62①). 상품·제품 등 동산은 처분예상가액 → 장부가액 순으로
  // 적용한다(§62②1호). 서화·골동품 등 예술적 가치가 있는 유형재산은 전문감정기관 감정가액이 필요해 이
  // 계산기가 다루지 않는다. 사실상 임대차계약이 체결된 경우 임대료환산가액과 비교해 큰 금액을 쓰는
  // 특례(§62③)는, 이 함수를 호출하는 재산평가 화면이 모든 자산유형에 공통으로 적용하는 §66 평가특례
  // (임대료환산가액·담보채권액과의 Max 비교) 로직이 이미 처리하므로 여기서는 중복 계산하지 않는다.
  window.calculateOtherTangiblePropertyValueJS = function (p) {
    p = p || {};
    const itemType = p.itemType;
    if (['vessel_etc', 'commodity', 'art_antique'].indexOf(itemType) === -1) {
      return { error: 'itemType을 vessel_etc(선박·항공기·차량·기계장비·입목)/commodity(상품·제품 등 동산)/art_antique(서화·골동품 등) 중에서 선택하세요.' };
    }
    if (itemType === 'art_antique') {
      return { error: '서화·골동품 등 예술적 가치가 있는 유형재산은 전문분야별 2개 이상 전문감정기관의 감정가액 평균액(시행령§52②2호)이 필요해 이 계산기로 산정할 수 없습니다. 감정평가를 받아 직접 입력하세요.' };
    }
    let value, note;
    if (itemType === 'vessel_etc') {
      const reacquisitionValue = Number(p.reacquisitionValue) || 0;
      const bookValue = Number(p.bookValue) || 0;
      const standardTaxValue = Number(p.standardTaxValue) || 0;
      if (reacquisitionValue > 0) { value = reacquisitionValue; note = '처분할 경우 다시 취득할 수 있다고 예상되는 가액(재취득예상가액)을 적용했습니다.'; }
      else if (bookValue > 0) { value = bookValue; note = '재취득예상가액이 확인되지 않아 장부가액(취득가액-감가상각비)을 적용했습니다.'; }
      else { value = standardTaxValue; note = '재취득예상가액·장부가액이 모두 확인되지 않아 지방세법시행령§4①의 시가표준액을 적용했습니다.'; }
    } else { // commodity
      const disposalValue = Number(p.disposalValue) || 0;
      const bookValue = Number(p.bookValue) || 0;
      if (disposalValue > 0) { value = disposalValue; note = '처분할 때에 취득할 수 있다고 예상되는 가액(처분예상가액)을 적용했습니다.'; }
      else { value = bookValue; note = '처분예상가액이 확인되지 않아 장부가액을 적용했습니다.'; }
    }
    return { 평가액: Math.round(value), 안내: note };
  };

  // 신탁의 이익을 받을 권리 평가 (상속세및증여세법§65①, 상속세및증여세법시행령§61①, 상속세및증여세법시행규칙§14①②)
  // — 원본을 받을 권리와 수익을 받을 권리의 수익자가 같으면 신탁재산가액 그대로. 다르면, 수익을 받을 권리는
  // "각 연도에 받을 수익의 이익 - 원천징수세액상당액"을 연 1,000분의 30(3%)로 할인한 현재가치의 합계액(시행령
  // §61①2호나목, 시행규칙§14①), 원본을 받을 권리는 신탁재산가액에서 그 합계액을 뺀 금액(시행령§61①2호가목).
  // 신탁계약의 철회·해지·취소 등으로 받을 수 있는 일시금이 이보다 크면 그 일시금 가액을 적용한다(§61① 단서).
  // 수익률이 확정되지 않은 연도는 시행규칙§14②에 따라 원본가액×3%를 그 연도 수익금으로 추산한다.
  window.calculateTrustBenefitValueJS = function (p) {
    p = p || {};
    const trustPropertyValue = Number(p.trustPropertyValue) || 0;
    const cancellationValue = Number(p.cancellationValue) || 0;
    if (p.sameBeneficiary) {
      const value = Math.max(trustPropertyValue, cancellationValue);
      return { 평가방법: '원본·수익 수익자 동일(§61①1호)', 신탁재산가액: trustPropertyValue, 해지시일시금: cancellationValue, 평가액: value };
    }
    const beneficiaryType = p.beneficiaryType;
    if (['principal', 'income'].indexOf(beneficiaryType) === -1) {
      return { error: '원본을 받을 권리 또는 수익을 받을 권리 중에서 선택하세요.' };
    }
    const RATE = 0.03;
    const annualBenefits = Array.isArray(p.annualBenefits) ? p.annualBenefits : [];
    let incomeInterestValue = 0;
    const yearlyDetail = annualBenefits.map(function (item) {
      const n = Number(item.yearsFromValuation) || 0;
      const benefit = item.isRateUndetermined ? trustPropertyValue * RATE : (Number(item.annualBenefit) || 0);
      const withholding = Number(item.withholdingTaxEquivalent) || 0;
      const pv = (benefit - withholding) / Math.pow(1 + RATE, n);
      incomeInterestValue += pv;
      return { 연수: n, 수익금: Math.round(benefit), 원천징수세액상당액: withholding, 현재가치: Math.round(pv) };
    });
    incomeInterestValue = Math.round(incomeInterestValue);
    const principalInterestValue = Math.max(0, trustPropertyValue - incomeInterestValue);
    const beforeCancellation = beneficiaryType === 'income' ? incomeInterestValue : principalInterestValue;
    const value = Math.max(beforeCancellation, cancellationValue);
    return {
      평가방법: beneficiaryType === 'income' ? '수익을 받을 권리(§61①2호나목)' : '원본을 받을 권리(§61①2호가목)',
      적용이자율: RATE, 연도별_현재가치_내역: yearlyDetail,
      수익권_평가액: incomeInterestValue, 원본권_평가액: principalInterestValue,
      해지시일시금: cancellationValue, 평가액: value
    };
  };

  // 정기금을 받을 권리의 평가 (상증세법§65①, 시행령§62, 시행규칙§19의2③ 이자율 연3%) — Code.js
  // toolCalculatePeriodicPaymentRightValue와 동일 로직.
  window.calculatePeriodicPaymentRightValueJS = function (p) {
    p = p || {};
    const annuityType = p.annuityType;
    if (['fixed_term', 'perpetual', 'lifetime'].indexOf(annuityType) === -1) {
      return { error: 'annuityType을 fixed_term(유기정기금)/perpetual(무기정기금)/lifetime(종신정기금) 중에서 선택하세요.' };
    }
    const annualAmount = Number(p.annualAmount) || 0;
    if (annualAmount <= 0) return { error: '1년분 정기금액(annualAmount)이 필요합니다.' };
    const RATE = 0.03;
    const cancellationValue = Number(p.cancellationValue) || 0;

    if (annuityType === 'perpetual') {
      const perpetualValue = annualAmount * 20;
      return {
        평가방법: '무기정기금(시행령§62 2호)', 정기금가액: perpetualValue, 해지시일시금: cancellationValue,
        평가액: Math.max(perpetualValue, cancellationValue),
        안내: '무기정기금은 1년분 정기금액의 20배가 정액으로 평가액입니다(연도별 현재가치 계산 불필요).'
      };
    }

    let years;
    if (annuityType === 'fixed_term') {
      years = Math.max(0, Math.round(Number(p.remainingYears) || 0));
      if (years <= 0) return { error: 'fixed_term(유기정기금)일 때 잔존기간(remainingYears, 년)이 필요합니다.' };
    } else {
      years = Math.max(0, Math.floor(Number(p.lifeExpectancyYears) || 0));
      if (years <= 0) return { error: 'lifetime(종신정기금)일 때 기대여명 연수(lifeExpectancyYears, 소수점 이하 버림)가 필요합니다.' };
    }

    let presentValueSum = 0;
    const yearlyDetail = [];
    for (let n = 1; n <= years; n++) {
      const pv = annualAmount / Math.pow(1 + RATE, n);
      presentValueSum += pv;
      yearlyDetail.push({ 연차: n, 정기금액: annualAmount, 현재가치: Math.round(pv) });
    }
    presentValueSum = Math.round(presentValueSum);

    let periodicValue = presentValueSum;
    let capNote = '';
    if (annuityType === 'fixed_term') {
      const cap = annualAmount * 20;
      if (presentValueSum > cap) { periodicValue = cap; capNote = ' 계산된 현재가치 합계(' + presentValueSum + '원)가 1년분 정기금액의 20배(' + cap + '원)를 초과해 그 한도를 적용했습니다.'; }
    }
    const finalValue = Math.max(periodicValue, cancellationValue);

    return {
      평가방법: annuityType === 'fixed_term' ? '유기정기금(시행령§62 1호)' : '종신정기금(시행령§62 3호)',
      적용이자율: RATE, 연도별_현재가치_내역: yearlyDetail,
      현재가치합계: presentValueSum, 정기금가액: periodicValue, 해지시일시금: cancellationValue, 평가액: finalValue,
      안내: '연도별 정기금액이 매년 동일하다는 전제로 계산했습니다. 계약상 매년 금액이 다르면 각 연도별로 따로 현재가치를 계산해 합산해야 합니다.'
        + capNote + (annuityType === 'lifetime' ? ' 기대여명 연수는 통계청(국가데이터처) 고시 성별·연령별 기대여명 통계표를 기준으로 소수점 이하를 버린 값을 입력하세요.' : '')
    };
  };

  // 조건부 권리·존속기간이 확정되지 않은 권리·소송 중인 권리의 고려요소 안내 (상증세법§65①, 시행령§60①) —
  // Code.js toolExplainConditionalRightValuationFactors와 동일 로직(계산 없이 법령상 고려요소만 안내).
  const CONDITIONAL_RIGHT_VALUATION_FACTORS_JS_ = {
    conditional: { 근거: '시행령§60①1호', 유형: '조건부 권리', 고려요소: '본래의 권리의 가액을 기초로, 평가기준일 현재의 조건내용을 구성하는 사실, 조건성취의 확실성, 그 밖의 모든 사정' },
    undetermined_duration: { 근거: '시행령§60①2호', 유형: '존속기간이 확정되지 않은 권리', 고려요소: '평가기준일 현재의 권리의 성질, 목적물의 내용연수, 그 밖의 모든 사정' },
    litigation: { 근거: '시행령§60①3호', 유형: '소송 중인 권리', 고려요소: '평가기준일 현재의 분쟁관계의 진상, 소송진행의 상황' }
  };
  window.explainConditionalRightValuationFactorsJS = function (p) {
    p = p || {};
    const meta = CONDITIONAL_RIGHT_VALUATION_FACTORS_JS_[p.rightType];
    if (!meta) return { error: 'rightType을 conditional(조건부 권리)/undetermined_duration(존속기간 미확정 권리)/litigation(소송 중인 권리) 중에서 선택하세요.' };
    return {
      유형: meta.유형, 근거조문: meta.근거, 고려요소: meta.고려요소,
      안내: '§65①·' + meta.근거 + '는 이 권리의 평가에 객관적 계산식을 두지 않고 "' + meta.고려요소 + '"을 고려한 적정가액으로만 정합니다. 이 계산기는 그 적정가액 자체를 계산하지 않으므로, 위 고려요소를 근거로 감정평가법인 등 전문가의 평가나 사실관계 조사를 통해 별도로 금액을 확정해서 위 재산평가 금액란에 직접 입력하세요.'
    };
  };
})();
