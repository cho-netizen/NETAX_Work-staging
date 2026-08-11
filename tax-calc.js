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
    return Number.isFinite(n) ? n : s; // 숫자로 안 읽히면 그대로 문자열(관계 키워드 등)로 취급
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
})();
