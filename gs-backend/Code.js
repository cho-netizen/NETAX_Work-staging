/**
 * NX Assistant — Anthropic(Claude) + Google(Gemini) 멀티 AI 프록시 (Apps Script)
 * 완전체 버전 — 2026.07 (MS오피스 전체 + 구글시트/슬라이드 읽기 지원 추가)
 * ⚠️ 이 버전은 "Drive API" 고급 서비스를 켜야 합니다: 왼쪽 서비스 옆 + → Drive API 추가
 *
 * 포함 기능:
 *  [범용] 파일탐색기(listFolder/readFile/uploadFile/deleteItem/renameItem, MS오피스 전체 포함),
 *         AI 자동참조 도구(list_drive_folder/read_drive_file),
 *         폴더이동 신호(NAVIGATE_TO), 텍스트 참조 첨부(attachedTexts)
 *  [세무특화] 부동산 실거래가(9개 유형), 건축물대장(10종),
 *         사업자등록 상태조회/진위확인, 건물기준시가 계산(2026.1.1 시행 고시)
 */

const DEFAULT_SYSTEM_PROMPT = '너는 "넥스"라는 이름의, 이음세무컨설팅 개인 업무 보조 AI다. 사용자를 부를 때는 이름 대신 "세무사님"이라고 불러라. 실무적이고 정확하게, 간결한 존댓말로 답한다.';

// 마스터 프로필(_NX_마스터프로필.md) — 기본 작업 폴더에 저장해둔 이 파일을 매 요청마다 새로
// 읽어와서 DEFAULT_SYSTEM_PROMPT 뒤에 붙인다. 내용을 고칠 땐 이 파일만 드라이브에서 수정하면
// 되고, 코드 재배포는 필요 없다(파일ID가 바뀌지 않는 한).
const MASTER_PROFILE_FILE_ID = '1rL0-EhNYzeacN_oGpDGjAGXWcikI2cYP';

function getMasterProfileText_() {
  try {
    return DriveApp.getFileById(MASTER_PROFILE_FILE_ID).getBlob().getDataAsString('UTF-8');
  } catch (err) {
    // 파일ID가 잘못됐거나 삭제됐어도 채팅 자체는 계속 되게, 조용히 빈 값으로 처리한다.
    return '';
  }
}

const MODEL_CONFIG = {
  'claude-sonnet-5':            { provider: 'claude', input: 2.00,  output: 10.00, temp: false, codeExec: true,  thinkingMode: 'adaptive' },
  'claude-opus-4-8':            { provider: 'claude', input: 5.00,  output: 25.00, temp: false, codeExec: true,  thinkingMode: 'adaptive' },
  'claude-haiku-4-5-20251001':  { provider: 'claude', input: 1.00,  output: 5.00,  temp: true,  codeExec: false, thinkingMode: 'budget'   },
  'claude-fable-5':             { provider: 'claude', input: 10.00, output: 50.00, temp: false, codeExec: true,  thinkingMode: 'adaptive' },
  'gemini-3.1-pro-preview':     { provider: 'gemini', input: 2.00,  output: 12.00, temp: true,  codeExec: true  },
  'gemini-3.5-flash':           { provider: 'gemini', input: 1.50,  output: 9.00,  temp: true,  codeExec: true  },
  'gemini-3.1-flash-lite':      { provider: 'gemini', input: 0.25,  output: 1.50,  temp: true,  codeExec: true  }
};
const DEFAULT_MODEL = 'claude-sonnet-5';

const EFFORT_MAP = {
  low:    { thinking: false, maxTokens: 1536 },
  // medium/high 모두 상향 (2026.07): "content 파라미터가 누락되어 저장이 실패했습니다"가 자주
  // 발생한 원인을 분석해보니, 보고서처럼 긴 문서를 save_file_to_folder/export_to_google_doc/
  // apply_document_edit 도구로 저장할 때 그 안에 들어갈 content(문서 전체 내용)를 다 쓰기도
  // 전에 max_tokens 한도에 걸려 응답이 끊기는 경우가 많았다. 그러면 이미 다 쓴 name/path 같은
  // 필드는 남아있어도 맨 마지막에 쓰던 content 필드는 통째로 비거나 누락된 채로 도구가 호출돼서
  // "내용이 없습니다" 오류가 반복됐다. 예산을 넉넉히 늘리고, 그래도 잘리면 아래
  // callClaude()의 자동 재시도 로직(더 큰 예산으로 다시 시도)이 한 번 더 보완한다.
  medium: { thinking: true,  budgetTokens: 4000,  maxTokens: 12000 },
  high:   { thinking: true,  budgetTokens: 10000, maxTokens: 32000 }
};
const DEFAULT_EFFORT = 'medium';

const WEB_SEARCH_COST_PER_USE = 0.01;
const MAX_TOOL_LOOPS = 14; // 8 → 14: 복잡한 세무구조 진단처럼 도구를 여러 번 연쇄호출해야 하는
                            // 요청이 8회 안에 안 끝나서 "생각중만 하다가 빈 응답"으로 끝나는 문제 완화.
// Apps Script 웹앱은 실행시간 상한(보통 6분)을 넘기면 응답 없이 그냥 죽는다. 그 전에 우리가
// 먼저 도구 루프를 안전하게 접고 "지금까지의 답변 + 안내 메시지"를 돌려주기 위한 시간 예산(4분).
const TOOL_LOOP_TIME_BUDGET_MS = 4 * 60 * 1000;

const DEFAULT_FOLDER_ID_PROPERTY = 'NX_DEFAULT_FOLDER_ID';

// 로그 시트 — 스크립트 속성에 NX_LOG_SHEET_ID를 설정해두면 모든 Claude/Gemini 요청의
// 요청 요약·결과 요약·오류·소요시간·도구호출 횟수가 이 시트에 한 줄씩 자동 기록된다.
// 설정 안 해도 나머지 기능은 그대로 동작한다(로그만 조용히 생략됨).
const LOG_SHEET_ID_PROPERTY = 'NX_LOG_SHEET_ID';
const LOG_SHEET_NAME = 'NX_요청로그';

function logNxInteraction_(entry) {
  try {
    const logSheetId = PropertiesService.getScriptProperties().getProperty(LOG_SHEET_ID_PROPERTY);
    if (!logSheetId) return; // 로그 시트를 아직 설정 안 했으면 조용히 건너뜀

    const ss = SpreadsheetApp.openById(logSheetId);
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(['시간', '모델', '요청요약', '결과요약', '오류', '도구호출횟수', '소요시간(ms)', '시간예산초과', '루프한계도달', '내용잘림_자동재시도횟수']);
    }
    sheet.appendRow([
      new Date(),
      entry.model || '',
      (entry.requestSummary || '').slice(0, 300),
      (entry.resultSummary || '').slice(0, 300),
      entry.error || '',
      entry.loops || 0,
      entry.durationMs || '',
      entry.timeBudgetExceeded ? 'Y' : '',
      entry.maxLoopsHit ? 'Y' : '',
      entry.truncationRetries || 0
    ]);
  } catch (err) {
    // 로그 기록 자체가 실패해도 본 응답에는 영향 주지 않는다.
  }
}

const DRIVE_TOOLS = [
  {
    name: 'list_drive_folder',
    description: '구글드라이브 폴더 안의 하위 폴더·파일 목록을 확인한다. path는 최상위(구글드라이브 전체)부터의 폴더명 배열이다. 예: ["고객사건","고광민","법인전환"]. path를 생략하면 지금 사용자가 작업 중인 기본 폴더(고객사건)를 보여준다. 이름이 "_"로 시작하는 폴더(예: "_백업")는 자동참조 제외 폴더라서 결과에 "자동참조제외": true로 표시된다 — 자동참조 모드(ON)라도 스스로 판단해서 그 폴더 안으로 들어가 보지 말고, 사용자가 그 폴더를 이름으로 콕 집어 요청했거나 명시적으로 채팅에 첨부한 경우에만 확인하라.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'array', items: { type: 'string' }, description: '최상위(구글드라이브 전체)부터의 폴더명 배열. 생략하면 기본 작업 폴더.' } }
    }
  },
  {
    name: 'read_drive_file',
    description: '드라이브 파일 하나의 내용을 읽는다. 워드·한글제외 오피스(엑셀·파워포인트 포함, 신구버전 모두)·구글문서/시트/슬라이드·일반텍스트는 텍스트로, 이미지·PDF는 실제로 보고 판단할 수 있게 첨부된다. list_drive_folder로 얻은 파일의 fileId를 넣는다.',
    input_schema: {
      type: 'object',
      properties: { fileId: { type: 'string', description: '읽을 파일의 구글드라이브 파일 ID' } },
      required: ['fileId']
    }
  },
  {
    name: 'save_file_to_folder',
    description: '드라이브에 실제로 파일을 만들거나 저장한다. 사용자가 "이거 파일로 저장해줘", "보고서 만들어줘", "이 폴더에 저장해줘"처럼 결과물을 실제 파일로 남겨달라고 요청하면, 채팅 답변 텍스트로만 주지 말고 반드시 이 도구를 써서 실제 파일을 만들어라. path를 생략하면 사용자가 지금 화면에서 보고 있는 폴더에 저장된다. 같은 폴더에 이미 같은 이름의 파일이 있으면 덮어쓴다(새 버전으로 교체). 마크다운(.md)·일반 텍스트(.txt) 등 텍스트 기반 파일만 만들 수 있다(오피스 문서·PDF 등 바이너리 파일은 못 만듦). "워드처럼 받고 싶다", "구글독스로 내보내줘"처럼 서식 있는 문서를 원하면 이 도구 대신 export_to_google_doc을 써라 — 둘 중 뭘 원하는지 애매하면 사용자에게 물어봐라.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'array', items: { type: 'string' }, description: '저장할 폴더의 경로(최상위부터). 생략하면 지금 사용자가 보고 있는 폴더에 저장된다.' },
        name: { type: 'string', description: '파일 이름(확장자 포함, 예: "검토보고서.md")' },
        content: { type: 'string', description: '파일에 저장할 내용 전체(마크다운 또는 일반 텍스트). 일부만 주지 말고 완성된 전체 내용을 줘야 한다.' }
      },
      required: ['name', 'content']
    }
  },
  {
    name: 'export_to_google_doc',
    description: '마크다운/텍스트 내용을 실제 구글독스 파일로 만든다(제목·부제목·굵게·목록 서식 적용됨). 사용자가 "구글독스로 내보내줘", "워드처럼 받고 싶다", "독스로 만들어줘"처럼 요청하면 이 도구를 써라. path를 생략하면 지금 사용자가 보고 있는 폴더에 저장된다. save_file_to_folder(마크다운 원문 텍스트 파일)와는 결과물이 다르니, 어느 쪽을 원하는지 애매하면 사용자에게 물어봐라.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'array', items: { type: 'string' }, description: '저장할 폴더의 경로(최상위부터). 생략하면 지금 사용자가 보고 있는 폴더.' },
        title: { type: 'string', description: '문서 제목' },
        content: { type: 'string', description: '마크다운 형식 내용 전체(# 제목, ## 소제목, **굵게**, - 목록 지원)' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'send_email',
    description: '이메일을 발송한다. 사용자가 "이거 메일로 보내줘", "고객한테 발송해줘"처럼 명확히 요청했을 때만 써라. 받는사람 주소를 사용자가 알려주지 않았으면 절대 지어내지 말고 먼저 물어봐라. 발신자는 항상 이 시스템 소유자(조종호)의 구글계정이다.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '받는 사람 이메일 주소' },
        subject: { type: 'string', description: '제목' },
        body: { type: 'string', description: '본문(일반 텍스트)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'lookup_statute_article',
    description: '국가법령정보센터에서 특정 법령의 특정 조문 원문을 실시간으로 가져온다. "상증세법 §45", "소득세법 제94조" 같은 조문을 인용하거나 정확한 원문 확인이 필요할 때 써라. articleNo를 생략하면 그 법령의 조문 전체를 가져오니, 특정 조문만 필요하면 반드시 articleNo를 지정해라(전체를 가져오면 응답이 너무 길어질 수 있음).',
    input_schema: {
      type: 'object',
      properties: {
        lawName: { type: 'string', description: '법령명(정식 명칭에 가깝게, 예: "상속세및증여세법", "소득세법")' },
        articleNo: { type: 'string', description: '조번호. 예: "45", "45조의2". 생략하면 조문 전체를 가져온다.' }
      },
      required: ['lawName']
    }
  },
  {
    name: 'register_report_to_rpt',
    description: '완성된 보고서를 rpt.netax.kr(고객 열람 시스템)에 등록해서 열람번호를 발급한다. 사용자가 "이거 rpt에 등록해줘", "고객이 볼 수 있게 올려줘"처럼 요청했을 때만 써라. link는 이미 완성해서 저장해둔 보고서 파일(구글독스/드라이브 파일)의 URL이어야 한다 — 아직 파일이 없으면 먼저 save_file_to_folder나 export_to_google_doc으로 만들고 나서 그 결과의 url을 여기에 넣어라. 등록 직전에 그 파일의 공유설정을 "링크가 있는 모든 사용자·보기"로 자동으로 바꿔준다(안 그러면 고객이 열람번호로 들어와도 파일을 못 엶) — 별도로 공유설정을 미리 바꿔둘 필요 없다.',
    input_schema: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: '고객명(또는 사건명) — rpt.netax.kr 고객 목록에 표시될 이름' },
        title: { type: 'string', description: '보고서 제목(선택)' },
        docType: { type: 'string', description: '문서 유형(선택, 예: "검토보고서", "자문보고서")' },
        link: { type: 'string', description: '등록할 보고서 파일의 URL(구글독스/드라이브 링크)' },
        permission: { type: 'string', description: '열람 권한. 생략하면 "허용"' }
      },
      required: ['customerName', 'link']
    }
  },
  {
    name: 'lookup_real_estate_price',
    description: '국토교통부 실거래가 공공데이터로 부동산 매매 실거래 내역을 조회한다. 법정동코드(5자리)와 계약년월(6자리, YYYYMM)이 필요하다. 법정동코드를 정확히 모르면 사용자에게 물어보거나, 확실한 지역만 알고 있는 걸로 답하고 불확실하면 그렇다고 밝혀라.',
    input_schema: {
      type: 'object',
      properties: {
        propertyType: {
          type: 'string',
          enum: ['apt_basic', 'apt_detail', 'officetel', 'row_house', 'detached_house', 'land', 'commercial', 'presale_right', 'factory_warehouse'],
          description: 'apt_basic=아파트(기본), apt_detail=아파트(상세, 건축년도 등), officetel=오피스텔, row_house=연립다세대, detached_house=단독/다가구, land=토지, commercial=상업업무용, presale_right=아파트 분양권전매, factory_warehouse=공장 및 창고'
        },
        lawdCode: { type: 'string', description: '법정동코드 5자리 (예: 서울 종로구 = 11110)' },
        dealYearMonth: { type: 'string', description: '계약년월 6자리 YYYYMM (예: 202601)' }
      },
      required: ['propertyType', 'lawdCode', 'dealYearMonth']
    }
  },
  {
    name: 'lookup_building_register',
    description: '국토교통부 건축HUB 건축물대장정보로 특정 건축물의 대장 정보를 조회한다. 시군구코드·법정동코드·번지가 정확해야 조회된다. 정확한 번지를 모르면 사용자에게 확인을 요청하라.',
    input_schema: {
      type: 'object',
      properties: {
        ledgerType: {
          type: 'string',
          enum: ['titleInfo', 'recapTitleInfo', 'basisInfo', 'floorInfo', 'areaInfo', 'priceInfo', 'exposInfo', 'wclfInfo', 'atchJibunInfo', 'jijiguInfo'],
          description: 'titleInfo=표제부(대지면적·건축면적·건폐율·용적률·구조·용도 등, 가장 기본), recapTitleInfo=총괄표제부(여러 동 있는 경우), basisInfo=기본개요, floorInfo=층별개요, areaInfo=전유공용면적, priceInfo=주택가격, exposInfo=전유부, wclfInfo=오수정화시설, atchJibunInfo=부속지번, jijiguInfo=지역지구구역'
        },
        sigunguCd: { type: 'string', description: '시군구코드 5자리' },
        bjdongCd: { type: 'string', description: '법정동코드 5자리' },
        platGbCd: { type: 'string', description: '대지구분코드 (0=대지, 1=산, 2=블록). 모르면 "0"으로 시도.' },
        bun: { type: 'string', description: '번지 "번" (4자리, 예: 0001)' },
        ji: { type: 'string', description: '번지 "지" (4자리, 예: 0000)' }
      },
      required: ['ledgerType', 'sigunguCd', 'bjdongCd', 'bun', 'ji']
    }
  },
  {
    name: 'lookup_business_status',
    description: '국세청 사업자등록 상태조회로 사업자등록번호의 현재 상태(계속사업자/휴업자/폐업자)와 과세유형(일반과세자/간이과세자/면세사업자 등)을 확인한다. 거래상대방·매도인 등의 사업자 상태를 빠르게 확인할 때 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        businessNumbers: { type: 'array', items: { type: 'string' }, description: '조회할 사업자등록번호 목록 (하이픈 없이 10자리씩, 최대 100개)' }
      },
      required: ['businessNumbers']
    }
  },
  {
    name: 'verify_business_registration',
    description: '국세청 사업자등록정보 진위확인으로 사업자등록번호·개업일·대표자명 등이 실제 국세청 등록정보와 일치하는지 확인한다. 대표자명·개업일 등 정확한 정보가 필요하며, 사용자가 확실히 알려준 게 아니면 지어내지 말고 확인을 요청하라.',
    input_schema: {
      type: 'object',
      properties: {
        businesses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              b_no: { type: 'string', description: '사업자등록번호 10자리(하이픈 없이)' },
              start_dt: { type: 'string', description: '개업일자 8자리(YYYYMMDD)' },
              p_nm: { type: 'string', description: '대표자성명' },
              p_nm2: { type: 'string', description: '대표자성명2 (외국인 등 표기, 없으면 생략)' },
              b_nm: { type: 'string', description: '상호명 (선택)' },
              corp_no: { type: 'string', description: '법인등록번호 (개인사업자는 생략)' },
              b_sector: { type: 'string', description: '주업태명 (선택)' },
              b_type: { type: 'string', description: '주종목명 (선택)' },
              b_adr: { type: 'string', description: '사업장주소 (선택)' }
            },
            required: ['b_no', 'start_dt', 'p_nm']
          }
        }
      },
      required: ['businesses']
    }
  },
  {
    name: 'get_building_price_index_tables',
    description: '건물 기준시가 계산에 필요한 구조지수·용도지수·개별건물 특성 조정률의 전체 목록을 가져온다. calculate_building_standard_price를 쓰기 전에, 이 도구로 목록을 확인해서 실제 건물의 구조·용도에 맞는 번호를 먼저 찾아야 한다.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'calculate_building_standard_price',
    description: '2026년 국세청 건물 기준시가를 정확히 계산한다. 공동주택·상업용건물·오피스텔은 이 계산 대상이 아니다(그건 별도 고시가액이 있음 — 일반 단독건물·공장·창고 등에만 적용). structureName과 useNo는 반드시 get_building_price_index_tables로 확인한 정확한 값을 써야 하며, 임의로 추측하지 마라.',
    input_schema: {
      type: 'object',
      properties: {
        structureName: { type: 'string', description: 'get_building_price_index_tables에서 확인한 정확한 구조명 (예: "철근콘크리트조", "목구조" 등)' },
        useNo: { type: 'integer', description: 'get_building_price_index_tables에서 확인한 정확한 용도번호 (1~61)' },
        officialLandPricePerSqm: { type: 'number', description: '건물 부속토지의 ㎡당 개별공시지가(원). 양도·상속·증여일과 가장 가까운 시점에 공시된 값.' },
        builtYear: { type: 'integer', description: '신축연도 (사용검사일 기준 연도)' },
        floorAreaSqm: { type: 'number', description: '건물 면적(㎡) — 연면적(집합건물은 전유+공용면적 합계)' },
        taxType: { type: 'string', enum: ['transfer', 'inheritance_gift'], description: 'transfer=양도소득세(조정률 미적용), inheritance_gift=상속·증여세(조정률 적용 가능)' },
        adjustmentNos: { type: 'array', items: { type: 'integer' }, description: 'inheritance_gift일 때만, get_building_price_index_tables의 조정률 목록에서 해당되는 번호들 (없으면 생략)' }
      },
      required: ['structureName', 'useNo', 'officialLandPricePerSqm', 'builtYear', 'floorAreaSqm', 'taxType']
    }
  },
  {
    name: 'calculate_building_standard_price_multi',
    description: '하나의 건물이 층마다(또는 본채와 주차장·지하실·옥탑·대피소 등 부속시설이) 구조·용도·신축(증축)연도가 다른 경우, 각 층/부속시설을 행으로 나눠 개별 계산한 뒤 합산한 건물 기준시가를 구한다. 단일 구조·단일 용도 건물이면 calculate_building_standard_price를 바로 쓰는 게 더 간단하다. structureName·useNo는 반드시 get_building_price_index_tables로 확인한 정확한 값을 써야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: '층 또는 부속시설별 행. 부속 주차장·기계실·보일러실·대피소 등은 용도번호 57(주차장) 등 실제에 맞는 용도로 별도 행을 추가한다.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '행 구분(예: "1층", "2층", "지하주차장")' },
              structureName: { type: 'string', description: 'get_building_price_index_tables에서 확인한 정확한 구조명' },
              useNo: { type: 'integer', description: 'get_building_price_index_tables에서 확인한 정확한 용도번호 (1~61)' },
              builtYear: { type: 'integer', description: '이 행(층/부속시설)의 신축 또는 증축연도' },
              floorAreaSqm: { type: 'number', description: '이 행의 면적(㎡)' },
              adjustmentNos: { type: 'array', items: { type: 'integer' }, description: 'taxType이 inheritance_gift일 때만, 이 행에 적용할 조정률 번호들' }
            },
            required: ['structureName', 'useNo', 'builtYear', 'floorAreaSqm']
          }
        },
        officialLandPricePerSqm: { type: 'number', description: '건물 부속토지의 ㎡당 개별공시지가(원) — 건물 전체에 공통 적용.' },
        taxType: { type: 'string', enum: ['transfer', 'inheritance_gift'], description: 'transfer=양도소득세(조정률 미적용), inheritance_gift=상속·증여세(조정률 적용 가능)' }
      },
      required: ['rows', 'officialLandPricePerSqm', 'taxType']
    }
  },
  {
    name: 'calculate_transfer_tax',
    description: '양도소득세를 정확히 계산한다(기본세율 누진구조, 단기양도세율, 장기보유특별공제 — 일반 및 1세대1주택 특례, 1세대1주택 12억 비과세, 다주택자 중과, 비사업용토지 가산, 미등기양도 70%, 8년자경농지 감면, 필요경비 개산공제, 환산취득가액 가산세, 무신고·과소신고·납부지연가산세, 지방소득세 포함). 가업상속공제 관련 특례·수용/환지 등 조특법상 개별 감면은 포함되지 않는다. 주식등 양도는 이 도구가 아니라 calculate_stock_transfer_tax를 써야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        transferPrice: { type: 'number', description: '양도가액(원)' },
        acquisitionPrice: { type: 'number', description: '취득가액(원)' },
        necessaryExpenses: { type: 'number', description: '필요경비(원, 중개보수·취득세·자본적지출 등). 생략 시 0(단, useEstimatedNecessaryExpense가 true면 개산공제로 자동 계산됨).' },
        useEstimatedNecessaryExpense: { type: 'boolean', description: '실제 취득가액 증빙이 없어 필요경비를 개산공제(취득 당시 기준시가×3%, 미등기양도자산은 0.3%)로 대체할지' },
        acquisitionStandardPriceForExpense: { type: 'number', description: 'useEstimatedNecessaryExpense가 true일 때, 취득 당시 기준시가(원)' },
        acquisitionDate: { type: 'string', description: '취득일 YYYY-MM-DD' },
        transferDate: { type: 'string', description: '양도일 YYYY-MM-DD' },
        assetType: { type: 'string', enum: ['house', 'presale_right', 'other'], description: 'house=주택·조합원입주권(단기세율 70%/60%, 2년이상 기본세율누진), presale_right=분양권(§104①1·2·3호 — 1년미만 70%/1년이상 60% 단일세율, 보유기간 불문 장기보유특별공제·기본세율누진 배제), other=그 외 부동산(단기세율 50%/40%)' },
        isOneHouseOneFamily: { type: 'boolean', description: '1세대1주택 비과세 요건을 충족한다고 전제할지 여부(요건 자체는 이 도구가 검증하지 않음)' },
        residenceYears: { type: 'number', description: '1세대1주택(고가주택) 장기보유특별공제 계산용 거주기간(년). isOneHouseOneFamily일 때만 사용.' },
        multiHouseCount: { type: 'integer', description: '조정대상지역 다주택 중과 판정용 소유 주택 수(2 또는 3 이상). isOneHouseOneFamily가 아닐 때만 의미가 있다.' },
        isAdjustedArea: { type: 'boolean', description: '양도 주택이 조정대상지역에 있는지 — true이고 multiHouseCount>=2이면 중과세율(+20%p/+30%p)이 적용되고 장기보유특별공제가 배제된다. 조정대상지역 지정·중과 한시배제 현황은 수시로 바뀌므로 반드시 최신 여부를 확인하고 넣어라(다주택자 중과 한시배제가 여러 차례 연장돼왔으니 신고 시점 기준으로 재확인).' },
        isNonBusinessLand: { type: 'boolean', description: '비사업용 토지인지 (기본세율+10%p 가산)' },
        isUnregisteredTransfer: { type: 'boolean', description: '미등기양도자산인지 — true면 다른 옵션과 무관하게 70% 단일세율, 장특공제·기본공제 전부 배제' },
        isEightYearFarmland: { type: 'boolean', description: '8년 이상 자경농지 감면(조특법 §69) 대상인지 — 산출세액 전액 감면(연간 1억원, 5년 합산 2억원 한도. §133①1호·2호나목에 따라 §69의2~70 등 아래 다른 감면과 한도를 공유하며, 5년 합산 한도는 이 도구가 추적하지 않으므로 다른 감면 이력과 합산 확인 필요)' },
        isLivestockLandExempt: { type: 'boolean', description: '8년 이상 자경 축사용지 폐업 감면(조특법§69의2) 대상인지 — 산출세액 전액 감면. isEightYearFarmland와 한도(연1억/5년합산2억)를 공유한다.' },
        isFisheryLandExempt: { type: 'boolean', description: '8년 이상 자영 어업용 토지등 감면(조특법§69의3) 대상인지 — 산출세액 전액 감면. isEightYearFarmland와 한도를 공유한다.' },
        isFarmlandSubstitutionExempt: { type: 'boolean', description: '농지대토 감면(조특법§70) 대상인지 — 산출세액 전액 감면. isEightYearFarmland와 한도를 공유한다.' },
        isForestManagementExempt: { type: 'boolean', description: '자경산지 감면(조특법§69의4) 대상인지 — 10년 이상 산림경영계획인가받아 직접 경영해야 하며(미만이면 감면 없음), 직접 경영한 기간(취득일~양도일, 의제취득일 의제 미적용) 구간별로 감면율이 다르다: 10~20년 10%, 20~30년 20%, 30~40년 30%, 40~50년 40%, 50년 이상 50%. isEightYearFarmland 등과 한도를 공유한다(단, 이들과 동시에 적용될 수는 없으므로 isEightYearFarmland 등이 true면 이 필드는 무시된다).' },
        isNewBuildingWithin5Years: { type: 'boolean', description: '건물을 신축 또는 증축(증축은 바닥면적합계 85㎡ 초과분만 해당)하고 그 취득일·증축일로부터 5년 이내에 양도하면서, 그 취득가액을 감정가액 또는 환산취득가액으로 적용했는지(소득세법§97①1호나목) — true면 해당 건물분(증축이면 증축부분만) 감정가액 또는 환산취득가액의 5% 가산세(소득세법§114의2, 산출세액이 0이어도 부과)가 부과된다.' },
        convertedBuildingAcquisitionValueForPenalty: { type: 'number', description: 'isNewBuildingWithin5Years가 true일 때, 취득가액으로 사용한 감정가액 또는 환산취득가액 중 건물분 가액(원, 증축이면 증축부분만). 가산세 = 이 금액×5%.' },
        rentalSpecialType: { type: 'string', enum: ['rental_general', 'rental_long'], description: '등록임대주택 장기보유특별공제 특례([별지 제84호서식] 코드04·05) — rental_general=장기일반민간임대주택(조특법§97의3, 10년이상임대 70%/8년이상 50% 정액), rental_long=장기임대주택(조특법§97의4, 일반 장특공제율에 임대기간별 2~10%p 추가). 지정하면 위 일반/1세대1주택 장특공제율을 대체하고, 다주택중과도 배제된다. 등록임대주택 요건(국민주택규모·임대료5%상한준수 등) 자체는 검증하지 않는다.' },
        rentalYears: { type: 'number', description: 'rentalSpecialType 지정 시 임대기간(년).' },
        acquisitionStandardPrice: { type: 'number', description: 'rentalSpecialType=rental_general일 때만 — 취득 당시 기준시가(원). registrationStandardPrice·transferStandardPrice와 함께 셋 다 입력하면 조특법시행령§97의3⑤ 원문대로 "임대기간중 발생한 양도차익"을 기준시가 비율로 정확히 안분해 70%를 그 부분에만 적용한다(없으면 70%를 전체 양도차익에 적용하는 근사치를 씀).' },
        registrationStandardPrice: { type: 'number', description: 'rentalSpecialType=rental_general일 때만 — 장기일반민간임대주택등 등록일 현재 기준시가(원).' },
        transferStandardPrice: { type: 'number', description: 'rentalSpecialType=rental_general일 때만 — 양도 당시 기준시가(원).' },
        pensionAccountContribution: { type: 'number', description: '이번 양도대금 중 연금계좌에 납입한 금액(원) — 조특법§99의13 연금계좌세액공제. MIN(납입액, 양도차익, 1억원)×10%를 세액공제한다(양도일로부터 6개월 이내 납입 요건 등은 검증하지 않음). 없으면 생략.' },
        isSelfElectronicFiling: { type: 'boolean', description: '납세자 본인이 직접 전자신고했는지 — true면 전자신고세액공제 2만원(조특법§104의8) 적용. 세무대리인이 대리신고하면 적용되지 않으므로 false/생략.' },
        compensationType: { type: 'string', enum: ['cash', 'bond', 'bond_3y', 'bond_5y', 'land_replacement', 'restricted_zone_40', 'restricted_zone_25'], description: '공익사업용 토지 등 수용감면 — cash=현금보상(조특법§77①, 15%), bond=채권보상 만기특약 없음(20%), bond_3y=3년만기특약(35%), bond_5y=5년만기특약(45%), land_replacement=대토보상(조특법§77의2, 40% — 과세이연 선택지는 별도 구조라 계산하지 않음), restricted_zone_40=개발제한구역 매수·지정일 이전 취득분(조특법§77의3, 40%), restricted_zone_25=개발제한구역 매수·매수청구일(또는 사업인정고시일)로부터 20년 이전 취득분(조특법§77의3, 25%). 산출세액에서 이 비율만큼 감면하되, 조특법§133②(2025.3.14 신설)에 따라 §77·§77의2·§77의3 감면세액 합계가 과세기간별 2억원을 넘는 부분은 감면하지 않는다(5개 과세기간 합산 3억원 한도는 이 도구가 추적하지 않는다). 해당 없으면 생략.' },
        downContractPriceDifference: { type: 'number', description: '다운계약서(업계약서) 등 거짓 계약으로 비과세·감면을 적용받은 경우(소득세법§91②), 계약서상 거래가액과 실지거래가액의 차액(원). 1세대1주택 비과세라면 MIN(비과세 미적용시 산출세액, 이 차액)을, 8년자경농지·수용감면 등을 받았다면 MIN(감면세액, 이 차액)을 배제·추징한다. 정상신고 사안이면 생략.' },
        isReconstructionRights: { type: 'boolean', description: '재개발·재건축 조합원이 기존건물과 그 부수토지를 제공하고 취득한 조합원입주권 또는 신축주택을 청산금 납부하고 양도하는 경우(소득세법시행령§166①②③)인지. true면 acquisitionPrice는 무시되고, rightsValue·settlementPaid·managementDispositionDate·originalAssetAcquisitionPrice로 별도 산정한다(acquisitionDate는 기존건물 취득일 그대로, acquisitionPrice는 생략 가능).' },
        isCompletedNewHousing: { type: 'boolean', description: 'isReconstructionRights가 true일 때만 의미 있음 — false(기본값)면 조합원입주권 자체를 준공 전에 양도(§166①1호, 인가전양도차익에만 장특공제), true면 준공된 신축주택을 양도(§166②1호, 인가후양도차익을 청산금납부분·기존건물분으로 재분배해 각각 다른 보유기간으로 장특공제).' },
        isOneMemberRightOneFamily: { type: 'boolean', description: 'isReconstructionRights가 true이고 isCompletedNewHousing이 false(준공 전 조합원입주권 자체 양도)일 때만 의미 있음 — 1세대1조합원입주권 비과세 요건(소득세법§89①4호)을 충족한다는 전제. true면 양도가액 12억 이하는 전액 비과세, 12억 초과분은 고가조합원입주권 비율안분(§95③ 후단, 시행령§160①②를 유추적용)을 적용한다.' },
        managementDispositionDate: { type: 'string', description: 'isReconstructionRights가 true일 때 필수 — 관리처분계획등 인가일 YYYY-MM-DD.' },
        rightsValue: { type: 'number', description: 'isReconstructionRights가 true일 때 필수 — 기존건물과 그 부수토지의 평가액(권리가액, 관리처분계획등에 따라 정해진 가격, 원).' },
        settlementPaid: { type: 'number', description: 'isReconstructionRights가 true일 때 — 납부한 청산금(분담금, 원). 청산금을 받은 경우(환급)는 이 도구가 다루지 않으므로 별도 계산이 필요하다.' },
        originalAssetAcquisitionPrice: { type: 'number', description: 'isReconstructionRights가 true일 때 — 기존건물과 그 부수토지의 취득가액(원). 확인할 수 없으면 useConvertedRightsBaseAcquisitionPrice로 환산가액을 쓸 수 있다.' },
        useConvertedRightsBaseAcquisitionPrice: { type: 'boolean', description: 'isReconstructionRights가 true이고 기존건물 취득가액을 확인할 수 없을 때(§166③) — 평가액×(취득일 현재 기준시가÷관리처분계획등인가일 현재 기준시가)로 환산해서 originalAssetAcquisitionPrice 대신 쓴다. originalAcquisitionStandardPrice·approvalDateStandardPrice가 함께 필요하다.' },
        originalAcquisitionStandardPrice: { type: 'number', description: 'useConvertedRightsBaseAcquisitionPrice가 true일 때 — 기존건물과 그 부수토지의 취득일 현재 기준시가(원).' },
        approvalDateStandardPrice: { type: 'number', description: 'useConvertedRightsBaseAcquisitionPrice가 true일 때 — 관리처분계획등인가일 현재 기존건물과 그 부수토지의 기준시가(원).' },
        originalNecessaryExpenses: { type: 'number', description: 'isReconstructionRights가 true일 때 — 기존건물분 필요경비(§97①2·3호 또는 §163⑥, 원. 취득세 등 취득 관련 비용). necessaryExpenses는 최종 양도분(청산금납부분) 필요경비로 별도로 쓰인다.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원).' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 산출세액(가산세 제외분)을 그대로 쓴다.' }
      },
      required: ['transferPrice', 'acquisitionPrice', 'acquisitionDate', 'transferDate']
    }
  },
  {
    name: 'calculate_transfer_tax_with_carryover',
    description: '이월과세(소득세법§97의2, 시행령§163의2) 적용 대상 양도소득세를 계산한다. 거주자가 배우자·직계존비속으로부터 증여받은 부동산·분양권·부동산과다보유법인주식을 증여일로부터 10년 이내에 양도하면, 수증자 본인의 취득가액이 아니라 증여자의 원취득가액·취득일·필요경비를 승계하고 수증자가 낸 증여세 상당액을 필요경비에 더한다. 다만 요건(관계·기간)을 충족 못하거나, 이월과세 적용시 1세대1주택 비과세가 되거나, 적용시 세액이 미적용시보다 적으면 이월과세를 적용하지 않고 수증자 본인 값(doneeOwnAcquisitionPrice 등)으로 계산한다 — 이 판정과 두 시나리오 비교를 이 도구가 전부 자동으로 한다. calculate_transfer_tax의 모든 입력 필드(assetType·isOneHouseOneFamily 등)를 그대로 받으며, 여기 추가되는 필드만 별도로 설명한다.',
    input_schema: {
      type: 'object',
      properties: {
        transferPrice: { type: 'number', description: '양도가액(원)' },
        transferDate: { type: 'string', description: '양도일 YYYY-MM-DD' },
        assetType: { type: 'string', enum: ['house', 'presale_right', 'other'], description: 'calculate_transfer_tax와 동일.' },
        necessaryExpenses: { type: 'number', description: '이번 양도 시 수증자가 추가로 지출한 필요경비(원, 중개보수 등). 증여자분 필요경비는 donorNecessaryExpenses로 별도 입력.' },
        isOneHouseOneFamily: { type: 'boolean', description: 'calculate_transfer_tax와 동일 — 1세대1주택 비과세 요건 충족 전제 여부.' },
        residenceYears: { type: 'number', description: 'calculate_transfer_tax와 동일.' },
        multiHouseCount: { type: 'integer', description: 'calculate_transfer_tax와 동일.' },
        isAdjustedArea: { type: 'boolean', description: 'calculate_transfer_tax와 동일.' },
        isNonBusinessLand: { type: 'boolean', description: 'calculate_transfer_tax와 동일.' },
        giftReceivedDate: { type: 'string', description: '증여받은 날 YYYY-MM-DD — 이 날짜와 양도일 사이가 10년을 넘으면 이월과세를 적용하지 않는다.' },
        donorRelation: { type: 'string', enum: ['spouse', 'lineal'], description: '증여자와의 관계. spouse=배우자, lineal=직계존속 또는 직계비속. 이 둘이 아니면(예: 형제자매) 이월과세를 적용하지 않는다.' },
        donorAcquisitionPrice: { type: 'number', description: '증여자가 해당 자산을 취득할 당시의 실지거래가액(원) — 이월과세 적용시 취득가액으로 쓰인다.' },
        donorAcquisitionDate: { type: 'string', description: '증여자의 취득일 YYYY-MM-DD — 이월과세 적용시 취득일(보유기간 기산일)로 쓰인다.' },
        donorNecessaryExpenses: { type: 'number', description: '증여자가 해당 자산에 지출한 필요경비(원, 취득세 등) — 이월과세 적용시 필요경비에 포함된다.' },
        doneeOwnAcquisitionPrice: { type: 'number', description: '수증자 본인 기준 취득가액(원) — 증여 당시 상증세법상 평가액(=증여세 과세가액 산정 기초)을 넣는다. 이월과세 미적용 시나리오의 취득가액이자, 증여세상당액 계산의 분자(해당 자산의 증여세 과세가액)로도 쓰인다.' },
        doneeOwnNecessaryExpenses: { type: 'number', description: '수증자가 증여받은 후 지출한 필요경비(원). 이월과세 미적용 시나리오에서만 쓰인다.' },
        giftTaxPaid: { type: 'number', description: '수증자가 이 자산에 대해 납부했거나 납부할 증여세 산출세액(원, 상증세법§56에 따른 금액) — 시행령§163의2②1호. 증여세상당액 계산에 쓰인다.' },
        giftTaxableValue: { type: 'number', description: '수증자의 전체 증여세 과세가액(상증세법§47, 원) — 시행령§163의2②3호. 이 자산 외에 함께 증여받은 재산이 있으면 그 합계까지 포함한 전체 금액이다(이 자산만 증여받았다면 doneeOwnAcquisitionPrice와 같은 값).' },
        isEminentDomainExcludedFromCarryover: { type: 'boolean', description: '§97의2②1호 — 사업인정고시일로부터 소급 2년 이전에 증여받은 자산이 수용·협의매수된 경우인지. true면 이월과세를 적용하지 않는다.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'calculate_transfer_tax와 동일.' }
      },
      required: ['transferPrice', 'transferDate', 'giftReceivedDate', 'donorRelation', 'doneeOwnAcquisitionPrice']
    }
  },
  {
    name: 'calculate_gift_tax',
    description: '증여세를 정확히 계산한다([별지 제10호서식] 증여세과세표준신고 및 자진납부계산서 기준 — 비과세·과세가액불산입, 증여재산공제, 혼인·출산증여재산공제, 합산배제증여재산공제, 감정평가수수료공제, 재해손실공제, 누진세율, 세대생략할증, 부담부증여 채무차감, 외국납부세액공제, 신고세액공제, 이자상당액, 각종 징수유예·납부유예, 무신고·과소신고·납부지연가산세, 수증자·증여자 인적사항 포함). 창업자금·가업승계 증여세 과세특례의 세액 자체는 포함되지 않는다(해당 유예세액만 입력받는다).',
    input_schema: {
      type: 'object',
      properties: {
        giftAmount: { type: 'number', description: '이번 증여재산가액(원, 채무인수분 포함 총액 — 부담부증여면 debtAssumedAmount로 채무액을 따로 알려줄 것). 이 금액을 정할 때는 반드시 다음 순서로 확인하라: ① list_drive_folder/read_drive_file로 지금 사건 폴더 안에 계약서·감정평가서 등 시가를 알 수 있는 문서가 있는지 먼저 찾는다 ② 없으면 lookup_real_estate_price로 유사 매매사례가 있는지 조회한다 ③ 그래도 없으면 부동산은 토지=개별공시지가×면적, 건물=calculate_building_standard_price(보충적평가방법)로 계산하고, 비상장주식은 calculate_unlisted_stock_value로 계산한다 ④ 이 중 어느 것도 확인할 수 없는 값(공시지가 자체, 감정평가액 등)은 사용자에게 직접 물어봐라. 각 단계를 시도했는지, 어느 단계에서 값을 확정했는지 답변에서 밝혀라.' },
        relation: { type: 'string', enum: ['배우자', '직계존속', '직계비속', '기타친족', '기타'], description: '증여자와 수증자의 관계 (수증자 기준)' },
        isMinor: { type: 'boolean', description: '수증자가 미성년자인지 (relation이 직계존속일 때 공제액에 영향)' },
        debtAssumedAmount: { type: 'number', description: '부담부증여로 수증자가 인수한 채무액(원). 증여재산가액에서 제외되어 증여세만 줄어들고, 그만큼은 증여자에게 별도로 양도소득세가 과세되므로 calculate_transfer_tax를 함께 호출해야 한다. 단 relation이 배우자·직계존속·직계비속이면 §47③에 따라 isDebtObjectivelyProven이 true가 아닌 한 이 금액은 공제되지 않는다(인수 안 된 것으로 추정).' },
        isDebtObjectivelyProven: { type: 'boolean', description: 'relation이 배우자·직계존속·직계비속일 때만 의미 있음 — 인수한 채무가 국가·지방자치단체에 대한 채무 등 객관적으로 인수 사실이 인정되는지(§47③ 단서). true가 아니면 debtAssumedAmount는 공제되지 않는다.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인(직계존속 증여는 그 배우자 포함)으로부터 받은 기증여재산 합산액(원). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '위 기증여분에 대해 이미 납부한 증여세액(원). 없으면 생략.' },
        isGenerationSkip: { type: 'boolean', description: '세대를 건너뛴 증여(예: 조부모→손자녀)인지 여부' },
        generationSkipOver2Billion: { type: 'boolean', description: '세대생략 증여이면서 미성년자가 20억원을 초과해서 증여받는 경우(할증률 40%). 아니면 30%.' },
        generationSkipGiftAmount: { type: 'number', description: '시행령§46의3② — 수증자의 부모를 제외한 직계존속(조부모 등 세대생략 증여자)으로부터 증여받은 재산가액(원). giftAmount·priorGiftAmount에 부모분과 조부모분이 섞여 있을 때, 할증세액을 (이 값/총증여재산가액) 비율만큼만 매기기 위한 값이다. 생략하면 증여재산 전액이 세대생략분이라고 보아 비율 100%로 계산한다.' },
        priorPaidGenerationSkipPremium: { type: 'number', description: '시행령§46의3② — 10년 합산 대상 기증여분에 대해 이미 납부한 세대생략 할증과세액(원). 이번 할증세액에서 차감한다. 없으면 생략.' },
        isMarriageGift: { type: 'boolean', description: '혼인일 전후 2년 이내의 증여(혼인증여재산공제 대상)인지' },
        isBirthGift: { type: 'boolean', description: '자녀 출생일·입양일부터 2년 이내의 증여(출산증여재산공제 대상)인지' },
        priorMarriageOrBirthDeductionUsed: { type: 'number', description: '이 수증자가 과거에 이미 받은 혼인·출산증여재산공제 누적액(원). 혼인+출산 합쳐 평생통산 1억원 한도이므로, 이미 쓴 만큼 이번 공제 한도가 줄어든다.' },
        priorRelationDeductionUsed: { type: 'number', description: '동일인(직계존속 증여는 그 배우자 포함)으로부터 증여받기 전 10년 이내에 이미 받은 증여재산공제(§53, 배우자6억/직계존속·직계비속5천만·기타친족1천만) 누적액(원). 관계별 한도도 10년 합산 기준이라 이미 쓴 만큼 이번 공제 한도가 줄어든다. 없으면 생략.' },
        isExcludedFromAggregation: { type: 'boolean', description: '상증세법 §55①3호에 따른 합산배제증여재산(명의신탁·일감몰아주기 등 의제이익 제외)인지 — 해당하면 §53·§53의2·§54을 전혀 적용하지 않고 "증여재산가액-3천만원"만으로 과세표준을 계산하는 별개 산식이 적용되며(10년 합산도 하지 않는다), priorGiftAmount·relationDeduction 등 다른 공제 입력은 모두 무시된다.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가수수료(원). 500만원 한도로 공제.' },
        disasterLossAmount: { type: 'number', description: '신고기한 이내 재난으로 멸실·훼손된 증여재산가액(원, 재해손실공제 §54). 없으면 생략.' },
        nonTaxableAmount: { type: 'number', description: '비과세되는 증여재산가액(원, §46 — 사회통념상 인정되는 축의금·학자금 등). 없으면 생략.' },
        publicInterestOrgAmount: { type: 'number', description: '공익법인등에 출연한 재산가액(원, §48 — 과세가액 불산입). 없으면 생략.' },
        publicTrustAmount: { type: 'number', description: '공익신탁을 통해 공익법인등에 출연한 재산가액(원, §52 — 과세가액 불산입). 없으면 생략.' },
        disabledTrustAmount: { type: 'number', description: '장애인이 증여받아 신탁한 재산가액(원, §52의2 — 과세가액 불산입, 5억원 한도). 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '국외재산에 대해 외국에서 이미 납부한 증여세액(원, 외국납부세액공제 §59). 없으면 생략.' },
        otherCreditsAmount: { type: 'number', description: '그 밖에 별도로 계산한 공제·감면세액(원). 이 도구는 세액 자체를 계산하지 않으므로 미리 계산해서 넣어야 한다. 없으면 생략.' },
        interestAmount: { type: 'number', description: '각종 사후관리 위반에 따른 추징 시 붙는 이자상당액(원). 해당 사안일 때만 별도로 계산해서 입력. 없으면 생략.' },
        publicInterestOrgPenalty: { type: 'number', description: '공익법인등 관련 가산세(§78, 출연재산 미사용 등). 해당 사안일 때만 별도로 계산해서 입력. 없으면 생략.' },
        museumDeferredTaxAmount: { type: 'number', description: '박물관자료·미술관자료 징수유예세액(원) — 이번 신고 시 납부할 세액에서 차감(유예)된다. 없으면 생략.' },
        businessSuccessionDeferredTaxAmount: { type: 'number', description: '가업승계 증여세 납부유예세액(조특법§30의6, 원) — 이번 신고 시 납부할 세액에서 차감(유예)된다. 없으면 생략.' },
        farmlandGiftTaxExemptionAmount: { type: 'number', description: '영농자녀 증여농지등 세액감면(조특법§71, [별지 제52호서식], 원) — 자경농민이 8년 이상 자경한 농지·초지·산림지를 영농자녀에게 증여할 때 증여세를 감면. 감면요건 판정과 한도액 산정은 이 도구가 하지 않으므로 관할세무서에 확인했거나 별도로 계산한 감면세액을 그대로 입력한다. 없으면 생략.' },
        doneeName: { type: 'string', description: '수증자 성명. list_drive_folder/read_drive_file로 사건 폴더의 가족관계증명서·신분증 사본 등을 먼저 찾아보고, 없으면 사용자에게 직접 물어봐라.' },
        doneeRegNo: { type: 'string', description: '수증자 주민등록번호. 위와 같은 방식으로 확인.' },
        doneeAddress: { type: 'string', description: '수증자 주소. 위와 같은 방식으로 확인.' },
        donorName: { type: 'string', description: '증여자 성명. 위와 같은 방식으로 확인.' },
        donorRegNo: { type: 'string', description: '증여자 주민등록번호. 위와 같은 방식으로 확인.' },
        donorAddress: { type: 'string', description: '증여자 주소. 위와 같은 방식으로 확인.' },
        giftDate: { type: 'string', description: '증여일자(YYYY-MM-DD). 위와 같은 방식으로 확인.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부담부증여 은폐 등 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원). 과소신고가산세 계산 기준.' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 납부지연가산세(1일 10만분의22) 계산에 사용, 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(filingStatus가 ontime일 때만 적용) 법정신고기한 내 신고를 가정할지 — 기본 true, 신고세액공제 3% 적용' }
      },
      required: ['giftAmount', 'relation']
    }
  },
  {
    name: 'calculate_inheritance_tax',
    description: '상속세를 정확히 계산한다([별지 제9호서식] 상속세과세표준신고 및 자진납부계산서 기준 — 기초공제·인적공제·일괄공제 중 유리한 선택, 배우자공제 한도액 정밀공식, 금융재산·동거주택·감정평가수수료·재해손실·가업상속·영농상속공제, 상속공제 종합한도, 세대생략가산액, 기납부증여세액·특례증여세액·외국납부세액·단기재상속세액공제, 누진세율, 신고세액공제, 이자상당액, 영리법인 상속세 면제, 각종 징수유예·납부유예, 무신고·과소신고·납부지연가산세, 신고인·피상속인 인적사항 포함). 가업상속공제·영농상속공제·특례증여세액공제·영리법인 면제세액의 자격요건 판정과 세액 산출 자체는 이 도구가 하지 않으므로 별도로 계산한 값을 입력받는다.',
    input_schema: {
      type: 'object',
      properties: {
        taxableEstateAmount: { type: 'number', description: '상속세 과세가액(원) — 총상속재산가액에서 공과금·장례비용·채무를 빼고 10년 이내 사전증여재산 등을 가산해 이미 계산된 금액이어야 한다(조특법§30의5·6 특례증여재산은 증여시기와 무관하게 항상 가산해야 함에 유의). 비과세재산가액·과세가액불산입재산가액은 여기 포함하지 말 것(nonTaxableAmount 등으로 별도 입력하면 자동으로 차감된다). 상속개시전 처분재산 추정액(disposalPresumptionItems)도 여기 포함하지 말 것 — 자동으로 더해진다. 그 총상속재산가액을 구성하는 개별 자산의 가액은 반드시 다음 순서로 확인하라: ① list_drive_folder/read_drive_file로 사건 폴더 안에 계약서·감정평가서 등 시가를 알 수 있는 문서가 있는지 먼저 찾는다 ② 없으면 lookup_real_estate_price로 유사 매매사례가 있는지 조회한다 ③ 그래도 없으면 부동산은 토지=개별공시지가×면적, 건물=calculate_building_standard_price(보충적평가방법)로 계산하고, 비상장주식은 calculate_unlisted_stock_value로 계산한다 ④ 그래도 확인할 수 없는 값은 사용자에게 직접 물어봐라. 각 단계를 시도했는지, 어느 단계에서 값을 확정했는지 답변에서 밝혀라.' },
        nonTaxableAmount: { type: 'number', description: '비과세되는 상속재산가액(원, §12) — 국가·지방자치단체·공공단체 유증재산, 문화재보호구역 토지, 금양임야·묘토인 농지(한도 2억원), 족보·제구(한도 1천만원), 정당 유증재산, 사내근로복지기금 등 유증재산, 이재구호금품 등. 없으면 생략.' },
        publicInterestOrgAmount: { type: 'number', description: '상속세 과세표준 신고기한 이내에 공익법인등에 출연한 재산가액(원, §16 — 과세가액 불산입). 없으면 생략.' },
        publicTrustAmount: { type: 'number', description: '상속세 과세표준 신고기한 이내에 공익신탁을 통해 공익법인등에 출연한 재산가액(원, §17 — 과세가액 불산입). 없으면 생략.' },
        disposalPresumptionItems: {
          type: 'array',
          description: '상속개시전 처분재산 등 산입액(§15, 시행령§11, [별지 제9호서식] 부표4) — 재산종류별로 1년 이내·2년 이내 요건을 각각 별도로 계산해 이 도구가 자동으로 더 큰 금액을 채택한다(1년/2년 데이터를 각각 총인출액·내돈입금액(재입금 등)·소명액으로 나눠 넣으면, 순인출액=총인출-내돈입금액, 미소명액=순인출액-소명액을 구한 뒤, 미소명액이 MIN(순인출액×20%, 2억원) 이상일 때만 그 미소명액 전액을 산입한다). 해당사항 없으면 생략.',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', description: '재산종류 (예: "현금·예금·유가증권", "부동산", "기타재산", "부담채무I", "부담채무II")' },
              oneYearAmount: { type: 'number', description: '상속개시 전 1년 이내 총인출(처분·차입)액 합계(원)' },
              oneYearSelfDeposit: { type: 'number', description: '위 1년 이내 인출액 중 본인계좌 재입금 등 실질적으로 인출이 아닌 금액(원, 없으면 0)' },
              oneYearExplained: { type: 'number', description: '1년 이내 순인출액 중 용도가 객관적으로 소명된 금액(원, 없으면 0)' },
              twoYearAmount: { type: 'number', description: '상속개시 전 2년 이내(1년 이내 포함 누계) 총인출(처분·차입)액 합계(원)' },
              twoYearSelfDeposit: { type: 'number', description: '위 2년 이내 인출액 중 본인계좌 재입금 등 실질적으로 인출이 아닌 금액(원, 없으면 0)' },
              twoYearExplained: { type: 'number', description: '2년 이내 순인출액 중 용도가 객관적으로 소명된 금액(원, 없으면 0)' }
            },
            required: ['category']
          }
        },
        isDecedentResident: { type: 'boolean', description: '피상속인이 상속개시 당시 거주자(국내에 주소를 두거나 183일 이상 거소를 둔 사람)였는지 — 기본값 true(거주자). false(비거주자)로 넣으면 §18 기초공제(2억원)만 적용되고, §18의2 가업상속공제·§18의3 영농상속공제·§19 배우자공제·§20 그 밖의 인적공제·§21 일괄공제·§22 금융재산상속공제·§23 재해손실공제·§23의2 동거주택상속공제·장례비용공제는 모두 "거주자의 사망" 요건이라 자동으로 0원 처리된다(감정평가수수료공제만 예외로 그대로 적용).' },
        hasSpouse: { type: 'boolean', description: '배우자가 상속인에 포함되는지' },
        spouseActualInheritedAmount: { type: 'number', description: '배우자가 실제 상속받은 금액(원). 생략하거나 5억 미만이면 자동으로 최소 5억이 공제된다.' },
        spouseLegalShareRatio: { type: 'number', description: '배우자의 법정상속분 비율(0~1, 예: 배우자+자녀2명이면 1.5/3.5≈0.4286). 이 값과 taxableEstateAmount 등으로 배우자공제 한도액을 정밀 계산한다. 생략하면 30억 한도만 적용된다.' },
        nonHeirBequestAmount: { type: 'number', description: '상속인이 아닌 자(수유자)가 유증 등으로 받은 재산가액(원). 배우자공제 한도액과 상속공제 종합한도 계산에 쓰인다.' },
        giftToHeirsWithin10Years: { type: 'number', description: '상속개시일 전 10년 이내에 피상속인이 상속인에게 증여한 재산가액 합계(원). 배우자공제 한도액 계산에 쓰인다.' },
        priorGiftedAmountIncludedInEstate: { type: 'number', description: 'taxableEstateAmount에 가산된 10년 이내 사전증여재산가액의 원본(재산가액 자체, 과세표준 아님). 배우자공제 한도액 계산의 "상속재산의 가액" 산출에 쓰인다.' },
        spouseTaxableBaseOfPriorGift: { type: 'number', description: '상속재산에 가산한 증여재산 중 배우자가 사전증여받은 부분의 증여세 과세표준(원). 배우자공제 한도액에서 차감된다.' },
        childCount: { type: 'integer', description: '자녀 수 (1인당 5천만원 공제)' },
        minorHeirRemainingYears: { type: 'number', description: '미성년 상속인들의 19세까지 남은 잔여연수 합계 (1년당 1천만원 공제)' },
        elderlyHeirCount: { type: 'integer', description: '65세 이상 상속인 수 (1인당 5천만원 공제)' },
        disabledHeirRemainingYears: { type: 'number', description: '장애인 상속인들의 기대여명 잔여연수 합계 (1년당 1천만원 공제)' },
        netFinancialAssets: { type: 'number', description: '순금융재산가액(금융재산-금융채무, 원). 2천만원 이하면 전액, 초과하면 20%와 2천만원 중 큰 금액(2억원 한도)이 공제된다.' },
        hasCohabitingHouseDeduction: { type: 'boolean', description: '동거주택상속공제(10년 이상 동거·무주택 등 요건 충족 전제, 요건 자체는 검증하지 않음) 대상인지' },
        cohabitingHouseValue: { type: 'number', description: 'hasCohabitingHouseDeduction이 true일 때, 상속주택가액(원). 6억원 한도로 전액 공제.' },
        appraisalFeeAmount: { type: 'number', description: '상속재산 감정평가수수료(원). 500만원 한도로 공제.' },
        disasterLossAmount: { type: 'number', description: '신고기한 이내 재난으로 멸실·훼손된 상속재산가액(원, 재해손실공제 §23). 없으면 생략.' },
        funeralCostAmount: { type: 'number', description: '장례비용 실제 지출액(원, §14①3호). 없거나 증빙이 없으면 생략(자동으로 500만원 공제). 있으면 500만~1000만원 범위에서 실제 금액이 공제된다.' },
        funeralNicheCostAmount: { type: 'number', description: '봉안시설·자연장지 사용금액(원). 위 장례비용공제와 별도로 500만원 한도까지 추가 공제. 없으면 생략.' },
        businessInheritanceDeduction: { type: 'number', description: '가업상속공제 최종 공제액(§18의2, 원) — 아래 상세 자산내역([별지 제1호서식] 기준) 파라미터를 채우면 이 도구가 직접 계산하므로 이 값은 생략해도 된다. 상세 내역을 모르거나 이미 계산이 끝난 경우에만 최종 공제액을 직접 입력한다. 자격요건(가업 종사기간·최대주주 여부·중소/중견기업 여부 등) 판정은 이 도구가 하지 않는다.' },
        businessOwnershipYears: { type: 'number', description: '가업상속공제용 — 피상속인의 가업영위기간(년). 10년 미만이면 공제 불가, 10~20년 300억/20~30년 400억/30년이상 600억원 한도가 자동 적용된다.' },
        businessInheritanceIndividualNetAssetValue: { type: 'number', description: '가업상속공제용 — 소득세법을 적용받는 가업(개인사업)인 경우, 가업에 직접 사용되는 토지(비사업용 토지 제외)·건축물·기계장치 등 사업용자산가액에서 담보채무액을 뺀 순액의 합계([별지 제1호서식 부표1] ①계). 법인세법 적용가업이면 생략.' },
        businessInheritanceStockValue: { type: 'number', description: '가업상속공제용 — 법인세법을 적용받는 가업(법인)인 경우, 상속재산 중 가업에 해당하는 법인의 주식등 가액([별지 제1호서식 부표1] ②). 개인사업이면 생략.' },
        businessInheritanceTotalAssetValue: { type: 'number', description: '가업상속공제용(법인) — 상속개시일 현재 해당 법인의 총자산가액(상증세법 제4장 평가액, [별지 제1호서식 부표1] ③).' },
        businessInheritanceNonBizAsset55: { type: 'number', description: '가업상속공제용(법인) — 사업무관자산 중 법인세법§55의2 해당자산(비사업용 부동산 등)가액.' },
        businessInheritanceNonBizAsset49: { type: 'number', description: '가업상속공제용(법인) — 사업무관자산 중 법인세법시행령§49 해당자산 및 임대용부동산가액.' },
        businessInheritanceNonBizAsset61: { type: 'number', description: '가업상속공제용(법인) — 사업무관자산 중 법인세법시행령§61①2호 해당자산(대여금)가액.' },
        businessInheritanceExcessCash: { type: 'number', description: '가업상속공제용(법인) — 과다보유현금(직전 5개 사업연도말 평균 현금성자산 보유액의 200% 초과분, 상증령§15⑤2호라목). 이미 계산된 금액을 입력한다.' },
        businessInheritanceNonBizStock: { type: 'number', description: '가업상속공제용(법인) — 영업활동과 직접 관련없이 보유하는 주식·채권 및 금융상품 가액(과다보유현금 제외분).' },
        isMediumSizedBusiness: { type: 'boolean', description: '가업상속공제용 — 가업이 중견기업에 해당하는지(§18의2②, 시행령§15②). true면 businessHeirNonBusinessAssetValue·businessHeirTaxWithoutDeduction을 함께 넣어 중견기업 게이트를 판정한다.' },
        businessHeirNonBusinessAssetValue: { type: 'number', description: 'isMediumSizedBusiness가 true일 때 — 가업상속인의 "가업상속재산 외의 상속재산의 가액"(원, 시행령§15⑥ = 그 상속인이 받거나 받을 상속재산가액-그가 부담하는 증명된 채무-가업상속재산가액). 이 값이 businessHeirTaxWithoutDeduction×200%를 초과하면 가업상속공제가 전액 배제된다.' },
        businessHeirTaxWithoutDeduction: { type: 'number', description: 'isMediumSizedBusiness가 true일 때 — 가업상속인이 가업상속공제를 받지 않았을 경우 상증세법§3조의2①②에 따라 계산한 그 상속인이 납부할 의무가 있는 상속세액(원, 시행령§15⑦). 전체 상속세를 가업상속공제 없이 계산한 뒤 상속인별로 안분해서 별도로 구해야 한다.' },
        farmingInheritanceDeduction: { type: 'number', description: '영농상속공제 최종 공제액(§18의3, 원, 30억한도) — 아래 상세 자산내역([별지 제2호서식] 기준) 파라미터를 채우면 이 도구가 직접 계산하므로 이 값은 생략해도 된다. 자격요건(8년 이상 영농 등) 판정은 이 도구가 하지 않는다.' },
        farmingIndividualAssetValue: { type: 'number', description: '영농상속공제용 — 소득세법을 적용받는 영농재산(농지·초지·산림지·어선·어업권 등)가액 합계([별지 제2호서식] ①합계).' },
        farmingStockValue: { type: 'number', description: '영농상속공제용 — 법인세법을 적용받는 영농(영농법인)인 경우, 상속재산 중 해당 법인 주식등 가액([별지 제2호서식] ③=②합계).' },
        farmingTotalAssetValue: { type: 'number', description: '영농상속공제용(법인) — 상속개시일 현재 해당 법인의 총자산가액.' },
        farmingNonBizAsset55: { type: 'number', description: '영농상속공제용(법인) — 사업무관자산 중 법인세법§55의2 해당자산가액.' },
        farmingNonBizAsset49: { type: 'number', description: '영농상속공제용(법인) — 사업무관자산 중 법인세법시행령§49 해당자산 및 임대용부동산가액.' },
        farmingNonBizAsset61: { type: 'number', description: '영농상속공제용(법인) — 사업무관자산 중 법인세법시행령§61①2호 해당자산(대여금)가액.' },
        farmingExcessCash: { type: 'number', description: '영농상속공제용(법인) — 과다보유현금(직전 5개 사업연도말 평균 현금성자산 보유액의 200% 초과분, 상증령§15⑤2호라목).' },
        farmingNonBizStock: { type: 'number', description: '영농상속공제용(법인) — 영업활동과 직접 관련없이 보유하는 주식·채권 및 금융상품 가액.' },
        priorGiftHeirs: {
          type: 'array', description: '상속인별 실제상속재산가액 및 10년 이내 사전증여(§13 가산분) 상세 — 상속공제 종합한도(§24)와 증여세액공제(§28②, 시행령§3①1호 상속인별 과세표준상당액 정밀계산)에 공통으로 쓰인다. 사전증여가 없는 상속인도 실제상속재산가액 비율 산정을 위해 반드시 포함해야 하며, 배열 자체를 생략하면 §24 한도·§28 공제 모두 적용되지 않는다.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '상속인 성명' },
              actualInheritedValue: { type: 'number', description: '이 상속인이 실제 상속받는(협의분할·유언 등에 따른) 재산가액(원, 사전증여 가산분 제외한 순수 상속분).' },
              priorGiftAmount: { type: 'number', description: '이 상속인이 10년 이내 사전증여로 받아 taxableEstateAmount에 가산된 증여재산가액(원, 증여 당시 원본 가액 — 증여세 과세표준이 아니다). 없으면 0.' },
              priorGiftTaxableBase: { type: 'number', description: '위 사전증여재산의 증여세 과세표준(원, 증여자 관계별공제 등을 뺀 후의 금액). 없으면 0.' },
              priorGiftTaxPaid: { type: 'number', description: '위 사전증여 당시 이미 납부한 증여세산출세액(원). 없으면 0.' }
            }
          }
        },
        disclaimedShareRedistributedAmount: { type: 'number', description: '상속공제 종합한도(§24) 계산용 — 선순위 상속인의 상속포기로 다음 순위 상속인이 받은 재산가액(원). 없으면 생략.' },
        specialGiftTaxCredit: { type: 'number', description: '조특법§30의5·6(창업자금·가업승계 증여세 과세특례)에 따라 이미 납부한 증여세액공제(원). 세액 자체는 이 도구가 계산하지 않으므로 별도로 계산해서 입력한다. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '국외재산에 대해 외국에서 이미 납부한 상속세액(원, 외국납부세액공제 §29).' },
        priorInheritanceTax: { type: 'number', description: '단기재상속세액공제(§30②)용 — 전의 상속세 산출세액(원, 재상속되는 재산이 포함된 전의 상속 전체에 대한 산출세액).' },
        reinheritedPropertyValue: { type: 'number', description: '단기재상속세액공제용 — 재상속분의 재산가액(원, 전의 상속재산 중 이번에 다시 상속되는 부분의 가액).' },
        priorInheritanceTotalPropertyValue: { type: 'number', description: '단기재상속세액공제용 — 전의 상속재산가액(원, 전의 상속 전체 재산가액).' },
        priorInheritanceTaxableBase: { type: 'number', description: '단기재상속세액공제용 — 전의 상속세 과세가액(원). §30②1호 산식에 그대로 쓰인다(분자·분모에서 상쇄되지만 법문대로 입력받는다).' },
        yearsSincePriorInheritance: { type: 'integer', description: '단기재상속세액공제용 — 전의 상속개시일로부터 이번 상속개시일까지 경과연수(1~10, 1년마다 공제율 10%p씩 감소).' },
        otherCreditsAmount: { type: 'number', description: '그 밖에 별도로 계산한 세액공제(원). 이 도구는 세액 자체를 계산하지 않으므로 미리 계산해서 넣어야 한다. 없으면 생략.' },
        generationSkipHeirRatio: { type: 'number', description: '세대생략가산액(§27)용 — 상속인이 아닌 직계비속(예: 손자녀, 대습상속 제외)이 받는 상속재산이 전체에서 차지하는 비율(0~1). 없으면 세대생략가산액은 0.' },
        generationSkipOver2Billion: { type: 'boolean', description: '세대생략 상속이면서 미성년자가 20억원을 초과해서 상속받는 경우(할증률 40%). 아니면 30%.' },
        interestAmount: { type: 'number', description: '각종 사후관리 위반에 따른 추징 시 붙는 이자상당액(원). 해당 사안일 때만 별도로 계산해서 입력. 없으면 생략.' },
        forProfitBequestAmount: { type: 'number', description: '영리법인 상속세 면제(§3의2)용 — 영리법인이 유증받은 재산가액(원). 영리법인 자체의 상속세는 면제되지만, 상속인·직계비속이 그 법인의 최대주주 등인 경우 지분 상당액만큼 상속인에게 별도 납부의무가 생긴다. 없으면 생략.' },
        forProfitExemptedTaxAmount: { type: 'number', description: '영리법인이 유증받아 면제된 상속세액(원). (면제세액 - 유증재산가액×10%)×상속인 지분비율만큼을 상속인이 납부해야 한다. 없으면 생략.' },
        forProfitHeirShareRatio: { type: 'number', description: '영리법인 최대주주 등에 해당하는 상속인·직계비속의 지분 상당 비율(0~1). 없으면 생략(0).' },
        culturalPropertyDeferredTaxAmount: { type: 'number', description: '문화재자료·박물관자료등 징수유예세액(원) — 이번 신고 시 납부할 세액에서 차감(유예)된다. 없으면 생략.' },
        businessInheritanceDeferredTaxAmount: { type: 'number', description: '가업상속 상속세 납부유예세액(원, §72의2, [별지 제12호의2서식]) — 이번 신고 시 납부할 세액에서 차감(유예)된다. 정확한 금액을 모르면 totalGrossEstateValue와 businessInheritanceIndividualNetAssetValue/businessInheritanceStockValue 등을 넣어 이 도구가 계산한 가업상속납부유예_가능세액(참고용)을 확인한 뒤 그 금액을 여기 넣어라. 없으면 생략.' },
        totalGrossEstateValue: { type: 'number', description: '가업상속납부유예 가능세액 계산용 — 총 상속재산가액(원, 상속으로 얻은 자산에 §13에 따라 가산하는 증여재산 포함, 공과금·채무 차감 전 총액). 가업상속공제용 상세 자산내역과 함께 주면 §72의2에 따른 납부유예 가능세액(참고용, 자동 적용되지는 않음)을 계산해준다.' },
        reporterName: { type: 'string', description: '신고인(상속인) 성명. list_drive_folder/read_drive_file로 사건 폴더의 가족관계증명서·신분증 사본 등을 먼저 찾아보고, 없으면 사용자에게 직접 물어봐라.' },
        reporterRegNo: { type: 'string', description: '신고인 주민등록번호. 위와 같은 방식으로 확인.' },
        reporterRelationToDeceased: { type: 'string', description: '신고인의 피상속인과의 관계(예: 자녀, 배우자). 위와 같은 방식으로 확인.' },
        deceasedName: { type: 'string', description: '피상속인 성명. 위와 같은 방식으로 확인.' },
        deceasedRegNo: { type: 'string', description: '피상속인 주민등록번호. 위와 같은 방식으로 확인.' },
        dateOfDeath: { type: 'string', description: '상속개시일(사망일, YYYY-MM-DD). 위와 같은 방식으로 확인.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 재산은닉 등 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원). 과소신고가산세 계산 기준.' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 납부지연가산세(1일 10만분의22) 계산에 사용, 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(filingStatus가 ontime일 때만 적용) 법정신고기한 내 신고를 가정할지 — 기본 true, 신고세액공제 3% 적용' }
      },
      required: ['taxableEstateAmount']
    }
  },
  {
    name: 'allocate_inheritance_tax_by_heir',
    description: '상속인이 여러 명일 때, calculate_inheritance_tax로 계산한 전체 상속세(산출세액·세액공제·가산세·납부세액)를 각 상속인이 실제 받았거나 받을 재산 비율로 안분해 상속인별 납부세액을 계산한다(상증세법 §3조의2②, 유산세 방식). calculate_inheritance_tax를 먼저 호출해 그 결과를 aggregateResult로 그대로 넘겨야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        aggregateResult: { type: 'object', description: 'calculate_inheritance_tax의 반환값(JSON) 전체를 그대로 넣는다.' },
        heirs: {
          type: 'array',
          description: '상속인별 명세',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '상속인 성명' },
              relation: { type: 'string', description: '피상속인과의 관계(예: 자, 배우자, 대습상속/손)' },
              actualInheritedValue: { type: 'number', description: '이 상속인이 실제로 받았거나 받을 상속재산가액(원) — 채무 등을 부담한다면 그만큼 차감한 순액을 넣는 것이 원칙이다.' }
            },
            required: ['name', 'actualInheritedValue']
          }
        }
      },
      required: ['aggregateResult', 'heirs']
    }
  },
  {
    name: 'calculate_special_rate_gift_tax',
    description: '조세특례제한법 §30의5(창업자금) 또는 §30의6(가업승계 주식등) 증여세 과세특례를 계산한다([별지 제10호의2서식] 기준 — 일반 증여세 누진세율이 아니라 10%(가업승계는 120억 초과분 20%) 특례세율, 증여재산공제(창업자금 5억/가업승계 10억), 별도 총한도(창업자금 50억~신규고용10명이상 100억/가업승계 가업영위기간별 300~600억)를 적용하고 신고세액공제는 적용하지 않는다. 거주자는 이 특례를 §30의5·§30의6·§30의7 중 하나만 적용받을 수 있다. 한도를 초과하는 금액은 기본세율 적용대상이므로 반드시 calculate_gift_tax로 별도 신고해야 한다(이 도구가 baseRateApplicableAmount로 그 금액을 알려준다).',
    input_schema: {
      type: 'object',
      properties: {
        specialType: { type: 'string', enum: ['startup', 'business_succession'], description: 'startup=조특법§30의5 창업자금 특례, business_succession=조특법§30의6 가업승계 주식등 특례.' },
        giftAmount: { type: 'number', description: '해당 증여재산가액(원) — 창업자금이면 증여받은 현금·자산 총액, 가업승계면 증여받은 가업법인 주식등의 가액(시가). 시가 확인은 calculate_gift_tax와 동일한 순서(사건폴더 문서→매매실례가→공시가격→보충적평가)로 먼저 확정할 것.' },
        debtAssumedAmount: { type: 'number', description: '부담부증여로 수증자가 인수한 채무액(원, 창업자금 특례에서만 의미가 있음). 없으면 생략.' },
        priorSpecialGiftAmount: { type: 'number', description: '이전에 이미 같은 특례(§30의5 또는 §30의6)를 적용받은 증여재산에 대한 과세가액(원, 동일인 합산). 없으면 생략.' },
        jobsCreated10Plus: { type: 'boolean', description: 'specialType이 startup일 때만 — 창업을 통하여 10명 이상을 신규 고용했는지. true면 총한도 100억원, 아니면 50억원.' },
        businessOwnershipYearsOfParent: { type: 'number', description: 'specialType이 business_succession일 때만 — 증여자(부모)의 가업영위기간(년). 20년미만 300억/20~30년 400억/30년이상 600억원 한도가 자동 적용된다.' },
        totalAssetValue: { type: 'number', description: 'specialType이 business_succession이고 법인 자산내역으로 가업자산상당액을 계산하려는 경우 — 증여일 현재 해당 법인의 총자산가액. 생략하면 주식등 가액 전체를 가업자산으로 간주한다.' },
        nonBizAsset55: { type: 'number', description: '사업무관자산 중 법인세법§55의2 해당자산가액.' },
        nonBizAsset49: { type: 'number', description: '사업무관자산 중 법인세법시행령§49 해당자산 및 임대용부동산가액.' },
        nonBizAsset61: { type: 'number', description: '사업무관자산 중 법인세법시행령§61①2호 해당자산(대여금)가액.' },
        excessCash: { type: 'number', description: '과다보유현금(직전 5개 사업연도말 평균 현금성자산 보유액의 200% 초과분, 상증령§15⑤2호라목).' },
        nonBizStock: { type: 'number', description: '영업활동과 직접 관련없이 보유하는 주식·채권 및 금융상품 가액.' },
        disasterLossAmount: { type: 'number', description: '신고기한 이내 재난으로 멸실·훼손된 증여재산가액(원, 재해손실공제 §54). 없으면 생략.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가수수료(원). 500만원 한도로 공제.' },
        priorPaidTax: { type: 'number', description: '조특법§30의5①후단(§30의6도 동일하게 적용)에 따라 priorSpecialGiftAmount로 합산한 이전 특례증여분에 대해 그 당시 실제 납부한 산출세액(원). 상증세법§58 납부세액공제와는 무관하다 — §58은 §47조②(10년 내 일반 증여재산 합산)에 따라 합산된 경우에만 적용되는데, §30의5⑪(§30의6⑤이 준용)이 일반 증여재산의 §47조② 합산 자체를 배제하므로 §58이 적용될 여지가 없다. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '국외재산에 대해 외국에서 이미 납부한 증여세액(원, 외국납부세액공제 §59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원). 과소신고가산세 계산 기준.' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 납부지연가산세(1일 10만분의22) 계산에 사용, 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        doneeName: { type: 'string', description: '수증자 성명. list_drive_folder/read_drive_file로 사건 폴더의 가족관계증명서·신분증 사본 등을 먼저 찾아보고, 없으면 사용자에게 직접 물어봐라.' },
        doneeRegNo: { type: 'string', description: '수증자 주민등록번호. 위와 같은 방식으로 확인.' },
        donorName: { type: 'string', description: '증여자 성명. 위와 같은 방식으로 확인.' },
        donorRegNo: { type: 'string', description: '증여자 주민등록번호. 위와 같은 방식으로 확인.' },
        giftDate: { type: 'string', description: '증여일자(YYYY-MM-DD). 위와 같은 방식으로 확인.' }
      },
      required: ['specialType', 'giftAmount']
    }
  },
  {
    name: 'calculate_related_party_transaction_gift_tax',
    description: '일감몰아주기 증여의제(상증세법 §45의3, 특수관계법인과의 거래를 통한 이익의 증여의제, [별지 제10호의3서식])를 계산한다. 지배주주와 그 친족이 지분을 보유한 법인(수혜법인)이 특수관계법인에 대한 매출비중이 높고 그 지분율도 높으면, 수혜법인의 소득(중소기업은 세후순이익, 중견·일반기업은 세후영업이익) 중 일부(배당소득공제 반영)를 지배주주등이 증여받은 것으로 간주해 과세한다. 증여재산공제는 적용되지 않고 일반 누진세율과 신고세액공제만 적용된다. 직접출자관계와 간접출자관계가 함께 있으면 각각 별도로 계산해서 합산해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        companySize: { type: 'string', enum: ['general', 'medium', 'small'], description: '수혜법인의 기업규모. general=일반(중견·중소기업 아님), medium=중견기업, small=중소기업(조특법§6① 각 호 외 부분에 따른 중소기업).' },
        afterTaxOperatingIncome: { type: 'number', description: '수혜법인의 세후영업이익(원) — companySize가 medium(중견) 또는 general(일반)일 때 사용된다(§45의3①2호나·다목). small(중소기업)이면 이 값 대신 afterTaxNetIncome이 사용된다.' },
        afterTaxNetIncome: { type: 'number', description: '수혜법인의 세후순이익(원) — companySize가 small(중소기업)일 때만 사용된다(§45의3①2호가목). 중견·일반기업이면 무시된다.' },
        relatedPartyTransactionRatio: { type: 'number', description: '특수관계법인거래비율(%, 0~100) — (특수관계법인 매출액-과세제외매출액)/(수혜법인 총매출액-과세제외매출액)×100. 과세제외매출액(중소기업간 거래, 수출관련 거래 등 8개 항목) 반영이 끝난 최종 비율을 입력해야 한다.' },
        relatedPartySalesAmount: { type: 'number', description: '수혜법인이 companySize가 general(일반기업)일 때만 — 특수관계법인에 대한 매출액(원, 과세제외매출액 반영 후). 거래비율이 정상거래비율(30%)의 3분의2인 20%를 초과하면서 이 금액이 1천억원을 초과하면, 거래비율이 30%를 넘지 않아도 §45의3①1호나목2)의 대체 과세요건을 충족한다.' },
        shareholderOwnershipRatio: { type: 'number', description: '지배주주와 그 친족(배우자, 6촌 이내 혈족, 4촌 이내 인척)의 수혜법인에 대한 직접 또는 간접 주식보유비율(%, 0~100). 직접출자와 간접출자를 모두 하고 있는 경우, 출자관계별로 세후영업이익·거래비율이 달라질 수 있으므로 이 도구를 출자관계별로 각각 호출해 증여의제이익을 따로 계산한 뒤 합산해야 한다(하나의 합계 비율로 한 번에 계산하지 말 것).' },
        dividendDeduction: { type: 'number', description: '지배주주등이 수혜법인의 직전 사업연도 증여세 과세표준 신고기한 다음날부터 이번 사업연도 신고기한까지 수혜법인(또는 간접출자법인)으로부터 받은 배당소득에 대한 공제액(원). 별도로 계산해서 입력한다. 없으면 생략.' },
        doneeName: { type: 'string', description: '수증자(지배주주 또는 그 친족) 성명. list_drive_folder/read_drive_file로 사건 폴더 문서를 먼저 찾아보고, 없으면 사용자에게 직접 물어봐라.' },
        doneeRegNo: { type: 'string', description: '수증자 주민등록번호. 위와 같은 방식으로 확인.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime. 법정신고기한은 수혜법인의 법인세 과세표준 신고기한이 속하는 달의 말일부터 3개월이 되는 날.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원).' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(filingStatus가 ontime일 때만 적용) 법정신고기한 내 신고를 가정할지 — 기본 true, 신고세액공제 3% 적용' }
      },
      required: ['companySize', 'relatedPartyTransactionRatio', 'shareholderOwnershipRatio']
    }
  },
  {
    name: 'calculate_business_opportunity_gift_tax',
    description: '일감떼어주기 증여의제(상증세법 §45의4, 특수관계법인으로부터 제공받은 사업기회로 발생한 이익의 증여의제, [별지 제10호의4서식])를 계산한다. 특수관계법인이 직접 하던(또는 다른 사업자가 하던) 사업기회를 지배주주등이 지분 30% 이상 보유한 법인에 제공해 그 법인의 영업이익이 늘면, 지배주주등이 증여받은 것으로 간주해 과세한다. 개시사업연도에 잠정 신고하고, 사업기회제공일로부터 2년 경과한 사업연도(정산사업연도)에 반드시 재계산해서 정산신고해야 한다. 증여재산공제는 적용되지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        phase: { type: 'string', enum: ['initial', 'settlement'], description: 'initial=개시사업연도(사업기회를 제공받은 날이 속하는 사업연도 종료일 이후 신고), settlement=정산사업연도(사업기회제공일로부터 2년이 경과한 날이 속하는 사업연도 종료일 이후 신고, 반드시 필요).' },
        profitFromOpportunity: { type: 'number', description: 'initial이면 제공받은 사업기회로 인하여 발생한 개시사업연도 수혜법인의 이익(원), settlement이면 개시사업연도부터 정산사업연도까지 발생한 수혜법인의 이익 합계액(원).' },
        shareholderOwnershipRatio: { type: 'number', description: '지배주주와 그 친족의 수혜법인에 대한 직·간접 주식보유비율(%, 0~100). 30% 이상이어야 과세대상이다.' },
        corporateTaxPortion: { type: 'number', description: 'initial이면 개시사업연도분의 법인세 납부세액 중 상당액(원), settlement이면 개시사업연도부터 정산사업연도분까지의 법인세 납부세액 중 상당액 합계(원).' },
        monthsInInitialYear: { type: 'integer', description: 'phase가 initial일 때만 — 개시사업연도의 월수(보통 12, 사업연도가 짧으면 그 미만).' },
        dividendDeduction: { type: 'number', description: 'phase가 settlement일 때만 — 신고기한까지 수혜법인으로부터 받은 배당소득에 대한 공제액(원). 별도로 계산해서 입력한다. 없으면 생략.' },
        doneeName: { type: 'string', description: '수증자(지배주주 또는 그 친족) 성명. list_drive_folder/read_drive_file로 사건 폴더 문서를 먼저 찾아보고, 없으면 사용자에게 직접 물어봐라.' },
        doneeRegNo: { type: 'string', description: '수증자 주민등록번호. 위와 같은 방식으로 확인.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원).' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(filingStatus가 ontime일 때만 적용) 법정신고기한 내 신고를 가정할지 — 기본 true, 신고세액공제 3% 적용' }
      },
      required: ['phase', 'profitFromOpportunity', 'shareholderOwnershipRatio']
    }
  },
  {
    name: 'calculate_nominee_trust_gift_tax',
    description: '명의신탁재산의 증여 의제(상증세법§45의2)를 계산한다. 등기·등록·명의개서가 필요한 재산(토지·건물은 제외 — 대표적으로 비상장·상장주식등)의 실제소유자와 명의자가 다르면, 명의개서일(또는 소유권취득일이 속한 해의 다음 해 말일의 다음 날)에 그 재산가액을 실제소유자가 명의자에게 증여한 것으로 본다. §55①1호에 따라 증여재산공제(§53) 없이 명의신탁재산의 금액 전액(감정평가수수료만 차감)이 과세표준이 된다. 조세회피 목적 유무·적용 제외 사유(§45의2①각호)·추정 번복 사유(§45의2③단서) 판정은 이 도구가 하지 않으므로 별도로 확인해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        nomineeTrustPropertyValue: { type: 'number', description: '명의신탁재산의 가액(원) — 명의개서일(또는 소유권취득일이 속한 해의 다음 해 말일의 다음 날) 현재 평가액.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산의 감정평가 수수료(원, §55①). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원).' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(filingStatus가 ontime일 때만 적용) 법정신고기한 내 신고를 가정할지 — 기본 true, 신고세액공제 3% 적용' }
      },
      required: ['nomineeTrustPropertyValue']
    }
  },
  {
    name: 'calculate_property_acquisition_funds_gift_tax',
    description: '재산 취득자금 등의 증여 추정(상증세법§45, 시행령§34)을 계산한다. 자력취득 능력이 부족한 자가 재산을 취득(또는 채무를 상환)했는데 그 자금출처(신고·과세된 소득금액, 신고·과세된 상속·수증재산가액, 재산처분대가·부담한 채무로 실제 그 취득·상환에 쓴 금액)를 입증하지 못하면, 미입증금액을 증여받은 것으로 추정한다. 다만 미입증금액이 "취득재산가액(또는 상환금액)의 20%"와 "2억원" 중 적은 금액에 미달하면 추정 자체를 배제한다. 합산배제증여재산이므로(§47①) 증여재산공제(§53) 없이 미입증금액 전액이 과세표준이 된다(§55①). §45③ 단서의 국세청장 고시 소액취득 기준 적용 여부는 이 도구가 판정하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        acquisitionValue: { type: 'number', description: '취득한 재산의 가액 또는 상환한 채무금액(원).' },
        provenAmount: { type: 'number', description: '자금출처로 입증된 금액의 합계(원) — 신고·과세된 소득금액, 신고·과세된 상속·수증재산가액, 재산처분대가나 부채부담으로 받은 돈 중 실제 그 취득·상환에 쓴 금액. 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산의 감정평가 수수료(원, §55①). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원).' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 최종세액(가산세 제외분)을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(filingStatus가 ontime일 때만 적용) 법정신고기한 내 신고를 가정할지 — 기본 true, 신고세액공제 3% 적용' }
      },
      required: ['acquisitionValue']
    }
  },
  {
    name: 'calculate_debt_forgiveness_gift_tax',
    description: '채무면제 등에 따른 증여(상증세법§36)를 계산한다. 채권자로부터 채무를 면제받거나 제3자로부터 채무의 인수·변제를 받으면, 그 이익(보상액을 지급했으면 뺀 금액)이 증여재산가액이 된다. 증여일은 면제·인수·변제를 받은 날이다.',
    input_schema: {
      type: 'object',
      properties: {
        debtAmount: { type: 'number', description: '면제·인수·변제받은 채무액(원).' },
        compensationPaid: { type: 'number', description: '그 대가로 지급한 보상액(원). 없으면 0.' },
        relationDeductionLimit: { type: 'number', description: '증여자와의 관계별 증여재산공제(§53) 남은 한도액(원) — 10년간 합산 사용액을 감안해 직접 계산해서 넣는다.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2, 최대 1억원). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인으로부터 받은 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(원, 500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '신고기한 이내 재난으로 멸실·훼손된 증여재산가액(원, §54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제 — §47② 합산시 이미 납부한 증여세액. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때 과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액. 생략하면 이번 계산의 최종세액을 그대로 쓴다.' },
        reportedInTime: { type: 'boolean', description: '(ontime일 때만) 법정신고기한 내 신고 가정 여부 — 기본 true, 신고세액공제 3% 적용.' }
      },
      required: ['debtAmount']
    }
  },
  {
    name: 'calculate_free_property_use_gift_tax',
    description: '부동산 무상사용·담보이용에 따른 이익의 증여(상증세법§37, 시행령§27)를 계산한다. 타인의 부동산을 무상사용하면 연간 부동산가액의 2%를 이익으로 보아 5년간(연금현가계수 3.79079로 할인) 합계가 1억원 이상이면 과세하고, 부동산을 무상담보로 차입한 경우는 차입금×적정이자율(4.6%)-실제지급이자가 1천만원 이상이면 과세한다.',
    input_schema: {
      type: 'object',
      properties: {
        useType: { type: 'string', enum: ['occupancy', 'collateral'], description: 'occupancy=부동산 무상사용(§37①), collateral=부동산 무상담보 이용(§37②).' },
        propertyValue: { type: 'number', description: 'useType이 occupancy일 때 필수 — 무상사용하는 부동산의 가액(원).' },
        loanAmount: { type: 'number', description: 'useType이 collateral일 때 필수 — 담보를 이용해 차입한 금전 등의 금액(원).' },
        actualInterestPaid: { type: 'number', description: 'useType이 collateral일 때 — 실제로 지급했거나 지급할 이자(원). 없으면 0.' },
        relationDeductionLimit: { type: 'number', description: '증여자와의 관계별 증여재산공제(§53) 남은 한도액(원).' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['useType']
    }
  },
  {
    name: 'calculate_spouse_property_transfer_gift_tax',
    description: '배우자 등에게 양도한 재산의 증여 추정(상증세법§44)을 계산한다. 배우자·직계존비속에게 양도한 재산은 그 재산가액을 증여받은 것으로 추정하며(①), 경매·파산선고·공매·증권시장처분·대가받고양도한사실이 명백히 인정되는 경우(③)에는 적용하지 않는다. 특수관계인을 거쳐 3년 이내 재양도(②)한 경우도 계산 가능하다.',
    input_schema: {
      type: 'object',
      properties: {
        transferType: { type: 'string', enum: ['direct', 'bypass'], description: 'direct=배우자·직계존비속에게 직접 양도(§44①), bypass=특수관계인에게 양도 후 3년 이내 배우자등에게 재양도(§44②).' },
        assetValue: { type: 'number', description: '증여추정 대상 재산가액(direct는 최초 양도가액, bypass는 재양도 당시 재산가액).' },
        isExcluded: { type: 'boolean', description: '§44③ 적용배제 사유(경매·파산선고·공매·증권시장을 통한 처분·대가받고 양도한 사실이 명백히 인정되는 경우) 중 하나에 해당하는지.' },
        priorTaxesSum: { type: 'number', description: 'transferType이 bypass일 때 — 당초 양도자 및 양수자가 부담한 소득세 결정세액 합계(원).' },
        comparisonGiftTax: { type: 'number', description: 'transferType이 bypass일 때 — 재양도 재산가액을 증여추정할 경우의 증여세액(원). 관계별 공제를 반영해 별도로 계산해서 넣어야 한다. priorTaxesSum이 이보다 크면 §44②단서에 따라 과세 제외된다.' },
        relationDeductionLimit: { type: 'number', description: '증여자와의 관계별 증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['transferType', 'assetValue']
    }
  },
  {
    name: 'calculate_insurance_proceeds_gift_tax',
    description: '보험금의 증여(상증세법§34)를 계산한다. 보험사고(만기보험금 포함) 발생일을 증여일로 하여, 보험금 수령인이 아닌 자가 낸 보험료 부분과 수령인이 증여받은 재산으로 낸 보험료 부분에 대응하는 보험금 상당액이 증여재산가액이 된다(후자는 그 보험료액을 다시 뺀다). §8에 따라 이 보험금을 상속재산으로 보는 경우(피상속인이 보험계약자인 경우 등)에는 적용하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        insuranceProceeds: { type: 'number', description: '수령한 보험금(원).' },
        totalPremiumPaid: { type: 'number', description: '납부된 총 보험료(원).' },
        premiumPaidByOthers: { type: 'number', description: '보험금 수령인이 아닌 자가 납부한 보험료(원, §34①1호). 없으면 0.' },
        premiumPaidFromGiftedAssets: { type: 'number', description: '수령인이 증여받은 재산으로 납부한 보험료(원, §34①2호). 없으면 0.' },
        relationDeductionLimit: { type: 'number', description: '증여자와의 관계별 증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['insuranceProceeds', 'totalPremiumPaid']
    }
  },
  {
    name: 'calculate_donor_direct_transfer_deemed',
    description: '양도소득의 부당행위계산 - 증여 후 우회양도 부인(소득세법§101②③④)을 판정한다. 거주자가 특수관계인(§97의2① 이월과세가 적용되는 배우자·직계존비속은 제외)에게 자산을 증여한 후 그 증여일부터 10년 이내에 수증자가 다시 타인에게 양도한 경우로서, (수증자의 증여세+양도소득세 합계)가 (증여자가 직접 양도했다고 볼 경우의 양도소득세)보다 적으면 증여자가 직접 양도한 것으로 보아 증여자에게 양도소득세를 과세하고 당초 증여에 대한 증여세는 부과하지 않는다. 양도소득이 수증자에게 실질적으로 귀속된 경우에는 적용하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        isSpouseOrLinealCarryoverApplies: { type: 'boolean', description: '수증자가 배우자·직계존비속으로서 이월과세(§97의2)가 적용되는 경우 true — 이 경우 §101②은 적용대상에서 제외된다.' },
        yearsSinceGift: { type: 'number', description: '증여일부터 재양도일까지의 경과연수.' },
        isGainActuallyAttributedToDonee: { type: 'boolean', description: '양도소득이 수증자에게 실질적으로 귀속된 것으로 인정되는 경우 true(§101②단서 적용배제).' },
        doneeGiftTax: { type: 'number', description: '수증자가 부담한 증여세(산출세액에서 공제·감면세액을 뺀 세액).' },
        doneeTransferTax: { type: 'number', description: '수증자가 그 자산을 양도할 때 부담하는 양도소득세(수증자의 취득가액=증여받은 가액 기준 결정세액).' },
        donorDirectTransferTax: { type: 'number', description: '증여자가 직접 양도했다고 볼 경우의 양도소득세(증여자의 원취득가액 기준).' }
      },
      required: ['yearsSinceGift']
    }
  },
  {
    name: 'calculate_new_house_acquisition_reduction',
    description: '신축주택·미분양주택 취득자 양도소득세 감면(조특법§99,§99의2,§99의3)을 계산한다. 세 조문 모두 취득기간이 정해진 특정 신축주택·미분양주택을 취득한 경우, 취득일부터 5년 이내 양도하면 그 기간 발생한 양도소득금액 전액을 과세대상에서 제외하고(§99의2는 형식상 세액 100% 감면이나 결과는 동일), 5년이 지난 후 양도하면 취득일부터 5년간 발생한 양도소득금액만 과세대상에서 뺀다(나머지는 정상 과세). §99는 1998.5.22~1999.6.30(국민주택 1999.12.31) 취득분, §99의2는 2013.4.1~2013.12.31 취득분(6억원 또는 85㎡ 요건), §99의3은 2001.5.23~2003.6.30 취득분에 적용된다. 취득기간·지역요건·감면신청 등 게이트는 이 도구가 검증하지 않으므로 별도로 확인해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['sect99', 'sect99_2', 'sect99_3'], description: 'sect99=조특법§99(1998~99년 취득), sect99_2=조특법§99의2(2013년 취득), sect99_3=조특법§99의3(2001~2003년 취득).' },
        isHighPriceHouseExcluded: { type: 'boolean', description: '소득세법§89①3호에 따라 양도소득세 비과세대상에서 제외되는 고가주택에 해당하면 true(적용배제).' },
        isPriceOrAreaQualified: { type: 'boolean', description: 'provision이 sect99_2일 때만 — 취득가액 6억원 이하이거나 전용면적 85㎡ 이하 요건을 충족하는지.' },
        acquisitionDate: { type: 'string', description: '취득일(YYYY-MM-DD).' },
        transferDate: { type: 'string', description: '양도일(YYYY-MM-DD).' },
        transferPrice: { type: 'number', description: '양도가액(원).' },
        acquisitionPrice: { type: 'number', description: '취득가액(원).' },
        necessaryExpenses: { type: 'number', description: '필요경비(원). 없으면 생략.' },
        fiveYearMarkValue: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득일로부터 5년이 되는 시점의 평가액(감정가액 등, 원). acquisitionStandardPrice·fiveYearStandardPrice·transferStandardPrice가 없을 때의 근사치 계산에만 쓰인다.' },
        acquisitionStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득 당시 기준시가(원). fiveYearStandardPrice·transferStandardPrice와 함께 셋 다 입력하면 원문대로(기준시가 비율) 5년간 발생분을 정확히 계산한다(없으면 fiveYearMarkValue 등으로 근사치 계산).' },
        fiveYearStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득일로부터 5년이 되는 시점의 기준시가(원).' },
        transferStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 양도 당시 기준시가(원).' }
      },
      required: ['provision']
    }
  },
  {
    name: 'calculate_unsold_house_acquisition_reduction',
    description: '미분양주택의 취득자에 대한 양도소득세 과세특례(조특법§98의3,§98의4,§98의5,§98의6,§98의7,§98의8)를 계산한다. §98의3(2009.2~2010.2 취득, 5년이내 100%·수도권과밀 60% 감면, 5년초과시 5년간발생분에 같은 비율), §98의5(2010.2~2011.4 취득, 분양가인하율 10%이하 60%·20%이하 80%·초과 100%), §98의6(2011.5 이전 준공후미분양, 50%), §98의7(2012.9~12 취득, 100%), §98의8(2015년 취득 5년이상임대, 5년간발생분의 50%)은 모두 취득일부터 5년 이내 양도시 그 비율만큼 세액감면(=소득금액에서 제외), 5년 초과 후 양도시 5년간 발생분에 그 비율을 곱한 금액만 과세대상에서 제외하는 공통구조다. §98의4(비거주자, 2009.3.16~2010.2.11 취득한 §98의3 미분양주택 외 주택)만 예외로 보유기간 요건 없이 산출세액의 10%를 그대로 감면한다.',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['sect98_3', 'sect98_4', 'sect98_5', 'sect98_6', 'sect98_7', 'sect98_8'], description: '적용할 조문.' },
        isOverconcentrationZone: { type: 'boolean', description: 'provision이 sect98_3일 때만 — 수도권과밀억제권역 소재 여부(true면 감면율 60%, false면 100%).' },
        priceDiscountRate: { type: 'number', description: 'provision이 sect98_5일 때만 — 분양가격 인하율(%, 입주자모집공고안 공시 분양가격 대비).' },
        acquisitionDate: { type: 'string', description: '취득일(YYYY-MM-DD). sect98_4는 불필요.' },
        transferDate: { type: 'string', description: '양도일(YYYY-MM-DD). sect98_4는 불필요.' },
        transferPrice: { type: 'number', description: '양도가액(원).' },
        acquisitionPrice: { type: 'number', description: '취득가액(원).' },
        necessaryExpenses: { type: 'number', description: '필요경비(원). 없으면 생략.' },
        fiveYearMarkValue: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득일로부터 5년이 되는 시점의 평가액(원). acquisitionStandardPrice·fiveYearStandardPrice·transferStandardPrice가 없을 때의 근사치 계산에만 쓰인다.' },
        acquisitionStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득 당시 기준시가(원). fiveYearStandardPrice·transferStandardPrice와 함께 셋 다 입력하면 원문대로(기준시가 비율) 5년간 발생분을 정확히 계산한다(없으면 fiveYearMarkValue 등으로 근사치 계산).' },
        fiveYearStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득일로부터 5년이 되는 시점의 기준시가(원).' },
        transferStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 양도 당시 기준시가(원).' }
      },
      required: ['provision']
    }
  },
  {
    name: 'calculate_unsold_house_one_house_exclusion',
    description: '수도권 밖 준공후미분양주택 취득자에 대한 1세대1주택 비과세 특례(조특법§98의9, 2024.1.10~2026.12.31 취득분, 현재 시행중)를 판정한다. 1주택을 보유한 1세대가 이 기간 중 수도권 밖 준공후미분양주택을 취득한 후 종전주택을 양도하면, 그 준공후미분양주택은 1세대1주택 비과세(소득세법§89①3호) 판정시 소유주택으로 보지 않는다. 세액을 계산하지 않고 적용 가능 여부만 판정한다.',
    input_schema: {
      type: 'object',
      properties: {
        acquisitionDate: { type: 'string', description: '준공후미분양주택의 취득일(YYYY-MM-DD).' },
        isOutsideMetropolitanArea: { type: 'boolean', description: '수도권 밖의 지역에 소재하는지.' },
        wasOneHouseBeforeAcquisition: { type: 'boolean', description: '이 준공후미분양주택 취득 전 1주택을 보유한 1세대였는지.' },
        meetsAreaAndPriceRequirements: { type: 'boolean', description: '전용면적·취득가액 등 시행령이 정하는 요건을 충족하는지.' }
      },
      required: ['acquisitionDate']
    }
  },
  {
    name: 'calculate_specific_corporation_gift_tax',
    description: '특정법인과의 거래를 통한 이익의 증여 의제(상증세법§45의5)를 계산한다. 지배주주등의 주식보유비율이 30% 이상인 특정법인이 지배주주의 특수관계인과 무상제공·저가양도·고가양수·불균등 자본거래 등을 하면, (특정법인의 이익 - 그 이익에 대응하는 법인세상당액) × 지배주주등의 주식보유비율을 그 지배주주등이 증여받은 것으로 본다. 증여의제이익이 1억원 미만이면 과세하지 않는다. §45의5는 합산배제증여재산이 아니므로 일반 증여세 산식을 따르되(증여자가 법인이므로 증여재산공제는 통상 0), 직접증여시 증여세상당액에서 법인세상당액을 뺀 금액을 초과하는 산출세액은 그 초과분이 없는 것으로 본다.',
    input_schema: {
      type: 'object',
      properties: {
        benefitToCorpAmount: { type: 'number', description: '특정법인이 얻는 이익(원) — 증여재산가액, 채무면제·인수·변제로 인한 이익, 자본거래(§38·39·39의2·39의3·40·41의2·42의2 준용) 이익, 또는 시가와 대가의 차액 등 거래유형별로 계산한 금액.' },
        corporateTaxAfterCredit: { type: 'number', description: '특정법인의 법인세법§55① 산출세액에서 공제·감면세액을 뺀 금액(원, 토지등양도소득 법인세는 제외).' },
        corporateTaxableIncome: { type: 'number', description: '특정법인의 법인세법§14에 따른 해당 사업연도 각 사업연도의 소득금액(원).' },
        shareholderOwnershipRatio: { type: 'number', description: '증여의제이익을 계산할 그 지배주주등의 주식보유비율(0~1).' },
        directGiftTaxEquivalent: { type: 'number', description: '§45의5② 한도 계산용 — 그 지배주주등이 특정법인의 이익 중 자기 지분에 해당하는 금액을 직접 증여받았다고 볼 경우의 증여세 상당액(원, 관계별 공제 반영해 별도 계산). 없으면 한도를 적용하지 않는다.' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액 — 증여자가 법인이므로 통상 0.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['benefitToCorpAmount', 'shareholderOwnershipRatio']
    }
  },
  {
    name: 'calculate_nontaxable_inheritance_property',
    description: '비과세되는 상속재산(상증세법§12)에 해당하는지 판정한다. 국가·지자체·공공단체 유증등, 민법§1008의3에 규정된 제사용재산(금양임야·묘토·족보·제구 등), 정당 유증등, 사내근로복지기금 등 유증등, 사회통념상 이재구호금품·치료비 등 5가지 열거항목 중 하나에 해당하면 상속세를 부과하지 않는다. §46(비과세되는 증여재산)의 상속세 버전.',
    input_schema: {
      type: 'object',
      properties: {
        itemType: { type: 'string', enum: ['government', 'ancestral_property', 'political_party', 'labor_welfare_fund', 'disaster_relief'], description: 'government=국가·지자체·공공단체 유증등(1호), ancestral_property=민법§1008의3 제사용재산(3호), political_party=정당 유증등(4호), labor_welfare_fund=사내근로복지기금 등(5호), disaster_relief=이재구호금품·치료비 등(6호).' },
        amount: { type: 'number', description: '해당 항목의 금액(원).' }
      },
      required: ['itemType', 'amount']
    }
  },
  {
    name: 'calculate_excess_dividend_gift_tax',
    description: '초과배당에 따른 이익의 증여(상증세법§41의2)를 계산한다. 최대주주등이 배당을 포기하거나 불균등 조건으로 배당받아 그 특수관계인이 본인 지분보다 많은 배당을 받으면, 그 초과배당금액에서 소득세상당액을 뺀 금액을 증여재산가액으로 한다. 최초 신고(isFinalSettlement=false)시에는 소득세상당액을 추정치로 입력하고, 이후 정산(isFinalSettlement=true, 다음연도 5.1~5.31 또는 성실신고확인대상자는 6.30까지)시에는 실제 소득세액으로 재계산한다.',
    input_schema: {
      type: 'object',
      properties: {
        isFinalSettlement: { type: 'boolean', description: 'false=최초 신고(추정 소득세상당액 사용), true=정산 신고(실제 소득세액 사용).' },
        excessDividendBaseAmount: { type: 'number', description: '최대주주등의 특수관계인이 실제 받은 배당등의 금액(원, 초과배당금액 산정의 기초).' },
        disproportionateShortfallRatio: { type: 'number', description: '과소배당금액 중 최대주주등의 과소배당금액이 차지하는 비율(0~1) — 시행령§31의2②2호.' },
        estimatedIncomeTaxEquivalent: { type: 'number', description: 'isFinalSettlement가 false일 때 — 초과배당금액에 대한 소득세상당액 추정치(원). 비워두면 시행규칙§10의3①의 추정율표로 자동계산하며, 입력하면 그 값을 그대로 우선 사용한다.' },
        actualIncomeTax: { type: 'number', description: 'isFinalSettlement가 true일 때 — 초과배당금액에 대해 실제 납부한(또는 납부할) 소득세액(원).' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['excessDividendBaseAmount']
    }
  },
  {
    name: 'calculate_stock_listing_gift_tax',
    description: '주식등의 상장 등에 따른 이익의 증여(상증세법§41의3) 또는 합병에 따른 상장 등 이익의 증여(§41의5)를 계산한다. 최대주주등의 특수관계인이 그 최대주주등으로부터 주식등을 증여·유상취득한 후 5년 이내에 상장(§41의3)되거나 특수관계 있는 상장법인과 합병(§41의5, "상장일"을 "합병등기일"로 봄)되어 가액이 증가하면, 정산기준일(상장·합병등기일부터 3개월 되는 날, 그 전에 사망·증여·양도시 그 날) 1주당 평가액에서 당초 1주당 과세가액(또는 취득가액)과 1주당 기업가치의 실질적인 증가로 인한 이익을 뺀 금액에 주식수를 곱해 이익을 계산한다. 게이트: min((당초가액+실질증가이익)×주식수×30%, 3억원).',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['listing', 'merger'], description: 'listing=§41의3(상장), merger=§41의5(합병). 기본값 listing.' },
        settlementValuePerShare: { type: 'number', description: '정산기준일 현재 1주당 평가가액(원, §63에 따라 평가).' },
        originalValuePerShare: { type: 'number', description: '주식등을 증여받은 날 현재의 1주당 증여세 과세가액(취득의 경우 취득일 현재 1주당 취득가액, 원).' },
        realValueIncreasePerShare: { type: 'number', description: '1주당 기업가치의 실질적인 증가로 인한 이익(원, 시행령§31의3⑤에 따라 별도 계산).' },
        shares: { type: 'number', description: '증여받거나 유상으로 취득한 주식등의 수.' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['settlementValuePerShare', 'shares']
    }
  },
  {
    name: 'calculate_rural_house_one_house_exclusion',
    description: '농어촌주택등 취득자에 대한 양도소득세 과세특례(조특법§99의4, 2003.8.1~2028.12.31 취득분, 현재 시행중)를 판정한다. 1세대가 농어촌주택등(농어촌주택 또는 고향주택, 3억원 이하 등 요건)을 취득해 3년 이상 보유하고 그 취득 전 보유하던 일반주택을 양도하면, 그 농어촌주택등은 1세대1주택 비과세(소득세법§89①3호) 판정시 소유주택으로 보지 않는다. 취득한 농어촌주택등과 일반주택이 같은(연접) 읍·면·동(고향주택은 시)에 있으면 적용배제된다. 3년 보유요건 충족 전에 일반주택을 양도해도 적용되나, 이후 3년 미만 보유로 끝나면 사후관리로 추징한다. 세액은 계산하지 않고 적용 가능 여부·사후관리 추징대상 여부만 판정한다.',
    input_schema: {
      type: 'object',
      properties: {
        acquisitionDate: { type: 'string', description: '농어촌주택등의 취득일(YYYY-MM-DD).' },
        houseType: { type: 'string', enum: ['rural', 'hometown'], description: 'rural=농어촌주택(2003.8.1~), hometown=고향주택(2009.1.1~). 기본값 rural.' },
        meetsLocationAndPriceRequirements: { type: 'boolean', description: '소재지·가액(3억원, 한옥은 4억원) 등 시행령이 정하는 농어촌주택·고향주택 요건을 충족하는지.' },
        isSameOrAdjacentDistrict: { type: 'boolean', description: '취득한 농어촌주택등과 보유하던 일반주택이 행정구역상 같은(또는 연접한) 읍·면·동(고향주택은 시)에 있는지(true면 적용배제).' },
        holdingYears: { type: 'number', description: '농어촌주택등의 보유기간(년). 3년 미만이고 isPendingHoldingPeriod가 아니면 적용대상 아님.' },
        isPendingHoldingPeriod: { type: 'boolean', description: '아직 3년 보유요건을 채우지 못한 상태에서 일반주택을 먼저 양도하는 경우인지(§99의4④, 이 경우도 특례 적용 가능하나 이후 사후관리 대상).' },
        triggerClawback: { type: 'boolean', description: '특례 적용 후 농어촌주택등을 3년 이상 보유하지 않게 된 사후관리 위반 사유가 발생했는지.' },
        isExemptedReason: { type: 'boolean', description: 'triggerClawback이 true일 때 — 수용 등 대통령령이 정하는 부득이한 사유에 해당하는지(true면 추징 예외).' }
      },
      required: ['acquisitionDate']
    }
  },
  {
    name: 'calculate_convertible_bond_gift_tax',
    description: '전환사채등의 주식전환등에 따른 이익의 증여(상증세법§40)를 계산한다. acquisition(법§40①1호, 취득시): 이익=전환사채등의 시가-인수취득가액, 게이트 min(시가30%,1억). conversion(법§40①2호가~다목, 전환시): 이익=(교부받은주식가액-전환가액등)×교부받은주식수-이자손실분-acquisition이익, 게이트 1억원, 전환사채등 양도시 이익상한은 양도가액-취득가액. conversion_reverse(법§40①2호라목, 반대편): 이익=(전환가액등-교부받은주식가액)×증가주식수×그특수관계인의전환등전보유지분비율, 게이트 0원(무조건과세). transfer(법§40①3호, 양도시): 이익=양도가액-시가, 게이트 min(시가30%,1억). conversion·conversion_reverse·transfer는 합산배제증여재산(§47①)이라 3천만원 공제만 적용하고 관계별공제는 없다.',
    input_schema: {
      type: 'object',
      properties: {
        caseType: { type: 'string', enum: ['acquisition', 'conversion', 'conversion_reverse', 'transfer'], description: '4가지 세부 케이스 중 하나.' },
        fairValue: { type: 'number', description: 'acquisition/transfer일 때 — 전환사채등의 시가(원).' },
        acquisitionCost: { type: 'number', description: 'acquisition일 때 — 전환사채등의 인수·취득가액(원).' },
        transferPrice: { type: 'number', description: 'transfer일 때 — 전환사채등의 양도가액(원).' },
        preConversionValuePerShare: { type: 'number', description: 'conversion/conversion_reverse일 때 — 전환등 전 1주당 평가가액(원).' },
        preConversionShares: { type: 'number', description: 'conversion/conversion_reverse일 때 — 전환등 전 발행주식총수.' },
        conversionPricePerShare: { type: 'number', description: 'conversion/conversion_reverse일 때 — 주식 1주당 전환·교환 또는 인수 가액(전환가액등, 원).' },
        increasedShares: { type: 'number', description: 'conversion/conversion_reverse일 때 — 전환등에 의하여 증가한(교부받은) 주식수.' },
        interestLossAmount: { type: 'number', description: 'conversion일 때 — 이자손실분(원, 시행규칙§10의2, 사채발행이율 기준 현재가치-적정할인율 기준 현재가치의 차액을 별도로 계산해서 입력). 없으면 0.' },
        priorAcquisitionGiftAmount: { type: 'number', description: 'conversion일 때 — 같은 전환사채등에 대해 이미 acquisition(법§40①1호)으로 과세된 증여의제이익(원, 중복과세 방지용 차감). 없으면 0.' },
        isBondTransferred: { type: 'boolean', description: 'conversion일 때 — 전환사채등을 양도한 경우인지(이 경우 이익 상한이 적용됨).' },
        bondTransferPrice: { type: 'number', description: 'isBondTransferred가 true일 때 — 전환사채등의 양도가액(원).' },
        bondAcquisitionCost: { type: 'number', description: 'isBondTransferred가 true일 때 — 전환사채등의 취득가액(원).' },
        relatedPriorOwnershipRatio: { type: 'number', description: 'conversion_reverse일 때 — 주식을 교부받은 자의 특수관계인이 전환등을 하기 전에 보유한 지분비율(0~1).' },
        relationDeductionLimit: { type: 'number', description: 'caseType이 acquisition일 때만 — 증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: 'caseType이 acquisition일 때만 — 혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: 'caseType이 acquisition일 때만 — 10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        disasterLossAmount: { type: 'number', description: 'caseType이 acquisition일 때만 — 재해손실공제(§54). 없으면 생략.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['caseType']
    }
  },
  {
    name: 'calculate_in_kind_contribution_gift_tax',
    description: '현물출자에 따른 이익의 증여(상증세법§39의3)를 계산한다. §39(증자에 따른 이익의 증여)의 산식을 "증자"를 "현물출자"로 치환해 그대로 준용한다. low_price(1호, 저가발행): 이익=(현물출자후1주당평가액-신주1주당인수가액)×현물출자자가배정받은신주수, 게이트 없음. high_price(2호, 고가발행): 이익=(신주1주당인수가액-현물출자후1주당평가액)×현물출자자가인수한신주수×현물출자자외특수관계인주주등의지분비율, 게이트: 차액비율 30%이상 또는 이익 3억원이상.',
    input_schema: {
      type: 'object',
      properties: {
        caseType: { type: 'string', enum: ['low_price', 'high_price'], description: 'low_price=저가발행, high_price=고가발행.' },
        preValuePerShare: { type: 'number', description: '현물출자전 1주당 평가가액(원).' },
        preShares: { type: 'number', description: '현물출자전 발행주식총수.' },
        issuePricePerShare: { type: 'number', description: '신주 1주당 인수가액(원).' },
        increasedShares: { type: 'number', description: '현물출자로 증가한 주식수(전체).' },
        allocatedShares: { type: 'number', description: 'low_price일 때 — 현물출자자가 배정받은 신주수.' },
        acquiredShares: { type: 'number', description: 'high_price일 때 — 현물출자자가 인수한 신주수.' },
        relatedShareholderRatio: { type: 'number', description: 'high_price일 때 — 현물출자자 외 주주등(현물출자 전에 현물출자자의 특수관계인인 경우 한정)의 지분비율(0~1).' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['caseType', 'preShares', 'increasedShares']
    }
  },
  {
    name: 'calculate_overseas_asset_transfer_tax',
    description: '국외자산 양도소득세(소득세법§118의2~§118의8)를 계산한다. 양도일까지 계속 5년 이상 국내에 주소·거소를 둔 거주자가 국외 토지·건물·부동산에관한권리·기타자산을 양도할 때 국내자산 양도세와 완전히 별도로 계산한다. 세율은 §55①(국내 양도세와 같은 기본누진세율표) 그대로 쓰되 장기보유특별공제는 적용하지 않는다. 기본공제는 국내양도세와 별개로 연250만원. 외국납부세액은 세액공제(한도=산출세액) 또는 필요경비산입 중 선택한다(필요경비산입 방법을 쓰려면 이미 필요경비에 포함해 입력하고 세액공제 방법은 선택하지 않는다). 국외전출자 국내주식등 출국세(§118의9~118의18)는 2027.1.1 시행 예정으로 아직 시행 전이고 핵심 세율표도 원문에서 확인되지 않아 다루지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        wasResidentFiveYearsContinuously: { type: 'boolean', description: '양도일까지 계속 5년 이상 국내에 주소 또는 거소를 둔 거주자인지(§118의2 적용요건).' },
        transferPrice: { type: 'number', description: '양도가액(원, 실지거래가액 원칙).' },
        acquisitionPrice: { type: 'number', description: '취득가액(원, 실지거래가액 원칙).' },
        capitalExpenditure: { type: 'number', description: '자본적지출액(원). 없으면 생략.' },
        transferExpenses: { type: 'number', description: '양도비(원). 없으면 생략.' },
        foreignTaxCreditMethod: { type: 'string', enum: ['credit', 'expense'], description: 'credit=외국납부세액공제(산출세액 한도로 세액공제, 기본값), expense=필요경비산입방법(이미 필요경비에 포함해 입력했다면 이 값을 선택).' },
        foreignTaxPaidAmount: { type: 'number', description: 'foreignTaxCreditMethod가 credit일 때 — 해당 양도소득에 대해 외국에 납부한 세액(원). 없으면 생략.' },
        domesticTransferIncomeAmount: { type: 'number', description: '같은 과세기간에 국내자산 양도소득금액도 함께 있는 경우 그 금액(원, §118의6① 세액공제한도 계산용). 외국납부세액공제 한도 = 산출세액 × (국외자산양도소득금액÷해당과세기간양도소득금액합계액)인데, 이 계산기가 다루는 국외자산양도소득 외에 같은 과세기간 국내 양도소득이 없다면 생략(비율=1로 계산).' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' }
      },
      required: ['wasResidentFiveYearsContinuously', 'transferPrice']
    }
  },
  {
    name: 'calculate_capital_reduction_gift_tax',
    description: '감자에 따른 이익의 증여(상증세법§39의2, 시행령§29의2)를 계산한다. low_price(저가소각 — 시가보다 낮은 대가로 소각, 다른 대주주등이 이익을 얻음): (1주당평가액-지급액)×총감자주식수×대주주등의감자후지분비율×(특수관계인감자주식수÷총감자주식수). high_price(고가소각 — 시가보다 높은 대가로 소각, 1주당평가액이 액면가에 미달하는 경우만, 소각된 주주 본인이 이익을 얻음): (지급액-1주당평가액)×해당주주등의감자주식수. 게이트: 기준금액 3억원, 다만 차액비율이 30%이상이면 기준금액은 0(무조건 과세).',
    input_schema: {
      type: 'object',
      properties: {
        caseType: { type: 'string', enum: ['low_price', 'high_price'], description: 'low_price=저가소각, high_price=고가소각.' },
        valuePerShare: { type: 'number', description: '감자한 주식등의 1주당 평가액(원).' },
        paymentPerShare: { type: 'number', description: '주식등 소각시 지급한 1주당 금액(원).' },
        totalReducedShares: { type: 'number', description: 'caseType이 low_price일 때 — 총 감자 주식등의 수.' },
        postReductionOwnershipRatio: { type: 'number', description: 'caseType이 low_price일 때 — 대주주등의 감자후 지분비율(0~1).' },
        relatedReducedShares: { type: 'number', description: 'caseType이 low_price일 때 — 대주주등과 특수관계인의 감자 주식등의 수.' },
        ownReducedShares: { type: 'number', description: 'caseType이 high_price일 때 — 해당 주주등의 감자한 주식등의 수.' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['caseType', 'valuePerShare']
    }
  },
  {
    name: 'calculate_disabled_person_trust_exclusion',
    description: '장애인이 증여받은 재산의 과세가액 불산입(상속세및증여세법§52의2)을 계산한다. 장애인이 재산을 증여받아 본인을 수익자로 신탁(자익신탁)하거나 타인이 장애인을 수익자로 신탁(타익신탁)한 경우, 요건을 충족하면 그 증여재산가액(자익) 또는 신탁수익(타익)을 증여세 과세가액에 산입하지 않는다. 장애인 생애 동안 자익신탁 증여재산가액과 타익신탁 원본가액을 합산해 5억원이 한도다. 신탁 해지·만료(1개월내 재가입 제외)·수익자변경·이익 타인귀속·원본감소 등 사후관리 위반시 즉시 증여세를 부과한다(부득이한 사유·의료비 등 인출은 예외).',
    input_schema: {
      type: 'object',
      properties: {
        meetsRequirements: { type: 'boolean', description: '신탁업자에게 신탁, 장애인이 신탁이익 전부를 받는 수익자일 것 등 §52의2①·②의 요건을 모두 충족하는지.' },
        amount: { type: 'number', description: '증여받은 재산가액(자익신탁) 또는 신탁원본가액(타익신탁 설정 당시, 원).' },
        priorCumulativeAmount: { type: 'number', description: '이 장애인이 생애 동안 이미 이 특례로 과세가액불산입 받은 자익신탁+타익신탁 누적액(원). 없으면 0.' },
        triggerEvent: { type: 'string', enum: ['none', 'terminated_not_rejoined', 'beneficiary_changed', 'benefit_diverted', 'principal_decreased'], description: 'none=사후관리 위반 없음, terminated_not_rejoined=신탁 해지·만료(1개월내 재가입 안함), beneficiary_changed=수익자 변경, benefit_diverted=신탁이익이 타인에게 귀속, principal_decreased=신탁원본 감소.' },
        isExemptedReason: { type: 'boolean', description: 'triggerEvent이 사후관리 위반일 때 — 부득이한 사유이거나 장애인 본인 의료비 등 정해진 용도의 인출로 인한 것인지(true면 즉시과세 예외).' }
      },
      required: ['meetsRequirements', 'amount']
    }
  },
  {
    name: 'calculate_charity_donation_tax_exclusion',
    description: '공익법인등에 출연한(출연받은) 재산에 대한 상속세·증여세 과세가액 불산입(상속세및증여세법§16,§48①)을 계산한다. 원칙적으로 공익법인등에 출연한 재산의 가액은 상속세(§16)·증여세(§48①) 과세가액에 산입하지 않는다. 다만 내국법인의 의결권 있는 주식등을 출연하는 경우, 이번 출연분과 합산대상 기존 보유분의 합계가 발행주식총수등의 일정비율(원칙10%, 의결권미행사+자선장학사회복지목적 공익법인 20%, 상호출자제한기업집단 특수관계 공익법인 5%, 요건미충족 공익법인 5%)을 초과하면 그 초과분만 과세가액에 산입한다. §48②의 사후관리(용도외사용·3년내미사용 등)에 따른 즉시증여세 부과는 다루지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        taxType: { type: 'string', enum: ['inheritance', 'gift'], description: 'inheritance=상속세(§16), gift=증여세(§48①).' },
        assetType: { type: 'string', enum: ['general', 'stock'], description: 'general=일반재산(전액 불산입), stock=내국법인의 의결권 있는 주식등(한도비율 적용).' },
        donatedAmount: { type: 'number', description: '출연재산가액(원, 주식등이면 그 출연주식의 평가액).' },
        ratioType: { type: 'string', enum: ['general', 'nonvoting_charity', 'conglomerate_related', 'noncompliant'], description: 'assetType이 stock일 때 필수 — general=원칙(10%), nonvoting_charity=의결권미행사+자선장학사회복지목적 공익법인(20%), conglomerate_related=상호출자제한기업집단과 특수관계있는 공익법인(5%), noncompliant=§48⑪요건 미충족 공익법인(5%).' },
        totalIssuedShares: { type: 'number', description: 'assetType이 stock일 때 필수 — 그 내국법인의 발행주식총수등(자기주식 제외).' },
        donatedShares: { type: 'number', description: 'assetType이 stock일 때 필수 — 이번에 출연하는 주식수.' },
        priorRelatedShares: { type: 'number', description: 'assetType이 stock일 때 — 합산대상 기존 보유 동일법인 주식수 합계(출연당시 그 공익법인등 보유분+출연자 및 특수관계인이 다른 공익법인등에 출연한 분+상속인 등이 출연한 다른 공익법인등 보유분). 없으면 0.' }
      },
      required: ['taxType', 'assetType', 'donatedAmount']
    }
  },
  {
    name: 'calculate_public_interest_org_penalty',
    description: '공익법인등에 대한 가산세 등(상속세및증여세법§78)을 계산한다. 13가지 penaltyType: report_not_filed(§78③ 출연재산 사용계획보고서 미제출·불분명, 세액×1%), stock_holding_exceeded_5pct(§78④·§49① 5%보유기준 초과, 초과분시가×5%/년·10년한도), management_violation(§78⑤ 세무확인·장부작성비치·회계감사 의무 불이행, (수입금액+출연재산가액)×0.07%, 세무확인유형은 최소100만원), director_excess(§78⑥ 이사정원초과, 관련경비 전액), stock_holding_exceeded_related(§78⑦·§48⑨ 특수관계법인주식 30%/50%한도초과, 초과분시가×5%), advertising(§78⑧·§48⑩ 무상광고홍보, 직접경비 전액), income_underused(§78⑨·§48②5호·7호 운용소득·매각대금·기준금액 미달사용, 미달액×10%(또는 특정유형 200%)), dedicated_account_not_opened(§78⑩2호 전용계좌 개설·신고 미이행, 가목[수입금액총액×미개설일수/총일수×0.5%]과 나목[거래금액합계×0.5%] 중 큰 금액), dedicated_account_unused(§78⑩1호 전용계좌미사용, 미사용거래금액×0.5%), disclosure_violation(§78⑪ 결산공시의무위반, 자산총액×0.5%), report_not_filed_5pct(§78⑭·§48⑬ 의무이행신고 미이행, 자산총액×0.5%), cultural_heritage_status_not_filed(§78⑮1호·§74⑤⑥ 문화유산등 징수유예 담보미제공자의 보유현황자료 미제출, 징수유예세액×1%), cultural_heritage_transfer_not_filed(§78⑮2호·§74⑤⑦ 담보미제공자의 양도사실 미신고, 징수유예세액×20%).',
    input_schema: {
      type: 'object',
      properties: {
        penaltyType: { type: 'string', enum: ['report_not_filed', 'stock_holding_exceeded_5pct', 'management_violation', 'director_excess', 'stock_holding_exceeded_related', 'advertising', 'income_underused', 'dedicated_account_not_opened', 'dedicated_account_unused', 'disclosure_violation', 'report_not_filed_5pct', 'cultural_heritage_status_not_filed', 'cultural_heritage_transfer_not_filed'], description: '가산세 유형.' },
        deferredTaxAmount: { type: 'number', description: 'penaltyType이 cultural_heritage_status_not_filed/cultural_heritage_transfer_not_filed일 때 필수 — §74에 따라 징수유예 받은 상속세액(원).' },
        baseTaxAmount: { type: 'number', description: 'penaltyType이 report_not_filed일 때 필수 — 미제출분·불분명분에 상당하는 상속세액(증여세액, 원).' },
        excessStockValue: { type: 'number', description: 'penaltyType이 stock_holding_exceeded_5pct일 때 필수 — §49①의 5% 보유기준을 초과하는 주식등의 시가(원).' },
        revenueAndDonationAmount: { type: 'number', description: 'penaltyType이 management_violation일 때 필수 — 해당 과세기간(사업연도)의 수입금액과 그 기간에 출연받은 재산가액의 합계(원).' },
        violationSubType: { type: 'string', enum: ['tax_confirmation', 'bookkeeping', 'audit'], description: 'penaltyType이 management_violation일 때 — tax_confirmation=세무확인 보고의무 불이행(최소100만원 적용), bookkeeping=장부작성·비치의무 불이행, audit=회계감사의무 불이행.' },
        relatedExpenseAmount: { type: 'number', description: 'penaltyType이 director_excess일 때 필수 — §48⑧을 초과하는 이사·임직원과 관련해 지출된 직접·간접경비 금액(원).' },
        stockValue: { type: 'number', description: 'penaltyType이 stock_holding_exceeded_related일 때 필수 — 보유 중인 특수관계 내국법인 주식등의 가액(원).' },
        totalAssetValue: { type: 'number', description: 'penaltyType이 stock_holding_exceeded_related/disclosure_violation/report_not_filed_5pct일 때 필수 — 공익법인등의 총재산가액 또는 자산총액(원).' },
        meetsComplianceRequirements: { type: 'boolean', description: 'penaltyType이 stock_holding_exceeded_related일 때 — 회계감사·전용계좌개설사용·결산서류공시 의무를 모두 이행하면 true(한도50%), 아니면 false(한도30%).' },
        directExpenseAmount: { type: 'number', description: 'penaltyType이 advertising일 때 필수 — 특수관계 내국법인 이익증가를 위해 정당한 대가 없이 지출한 광고·홍보 직접경비(원).' },
        underusedAmount: { type: 'number', description: 'penaltyType이 income_underused일 때 — 기준금액에 미달하여 사용하지 않은 금액(원)을 이미 알고 있으면 직접 입력(§48②5호 운용소득·매각대금 미달사용액은 이 도구가 기준금액을 계산하지 않으므로 이 값을 반드시 직접 입력). §48②7호의 경우 이 값 대신 totalAssetValue·liabilityValue·netIncomeValue·actualDirectUseAmount를 입력하면 시행령§38⑱ 산식으로 자동 계산한다.' },
        liabilityValue: { type: 'number', description: 'penaltyType이 income_underused이고 §48②7호 기준금액을 자동계산할 때 — 부채가액(원, 직전 과세기간·사업연도 종료일 재무상태표 기준).' },
        netIncomeValue: { type: 'number', description: 'penaltyType이 income_underused이고 §48②7호 기준금액을 자동계산할 때 — 당기순이익(원, 같은 기준일 운영성과표).' },
        actualDirectUseAmount: { type: 'number', description: 'penaltyType이 income_underused이고 §48②7호 기준금액을 자동계산할 때 — 실제로 직접 공익목적사업에 사용한 금액(원). 없으면 0.' },
        useAssessedValueBasis: { type: 'boolean', description: 'penaltyType이 income_underused이고 §48②7호 기준금액을 자동계산할 때 — 재무상태표상 자산가액이 상증세법상 평가액의 70% 이하인 특정 공익법인등(§41의2⑥ 또는 §43③단서 해당)이라 totalAssetValue에 평가액을 넣은 경우 true(안내문구만 달라짐, 계산식은 동일).' },
        isSect48_2_7HighHoldingType: { type: 'boolean', description: 'penaltyType이 income_underused일 때 — §48②7호가목 유형(발행주식총수등의 5%초과 보유)의 공익법인등이 10%초과 보유중인 경우 true(가산율 200%), 아니면 false(10%).' },
        saleProceedsAmount: { type: 'number', description: 'penaltyType이 income_underused이고 §48②5호 매각대금 기준금액을 자동계산할 때 — 기본재산 매각대금(원).' },
        saleCheckpointYear: { type: 'integer', enum: [1, 2], description: 'penaltyType이 income_underused이고 §48②5호 매각대금 기준금액을 자동계산할 때 — 매각일이 속하는 과세기간(사업연도) 종료일부터 확인시점(1년=30%기준, 2년=60%기준).' },
        cumulativeActualUsedAmount: { type: 'number', description: 'penaltyType이 income_underused이고 §48②5호 매각대금 기준금액을 자동계산할 때 — 매각일이 속하는 과세기간(사업연도) 종료일부터 확인시점까지 누적 실제 직접공익목적사업 사용액(원).' },
        operatingIncomeAmount: { type: 'number', description: 'penaltyType이 income_underused이고 §48②5호 운용소득 기준금액을 자동계산할 때 — 해당 과세기간(사업연도) 수익사업 소득금액 등 합계(시행령§38⑤1호, 원).' },
        taxAndCarryforwardLossAmount: { type: 'number', description: 'penaltyType이 income_underused이고 §48②5호 운용소득 기준금액을 자동계산할 때 — 해당 소득에 대한 법인세·소득세·농어촌특별세·주민세 및 이월결손금(시행령§38⑤2호, 원).' },
        actualOperatingIncomeUsedAmount: { type: 'number', description: 'penaltyType이 income_underused이고 §48②5호 운용소득 기준금액을 자동계산할 때 — 운용소득을 실제로 직접공익목적사업에 사용한 금액(원). 없으면 0.' },
        unusedTransactionAmount: { type: 'number', description: 'penaltyType이 dedicated_account_unused일 때 필수 — 전용계좌를 사용하지 않은 거래금액(원).' },
        directBusinessRevenueAmount: { type: 'number', description: 'penaltyType이 dedicated_account_not_opened이고 가목 금액을 계산할 때 — 해당 과세기간(사업연도)의 직접 공익목적사업과 관련한 수입금액의 총액(원).' },
        unregisteredDays: { type: 'number', description: 'penaltyType이 dedicated_account_not_opened이고 가목 금액을 계산할 때 — 전용계좌를 개설·신고하지 않은 기간의 일수(신고기한 다음날부터 신고일 전날까지).' },
        totalPeriodDays: { type: 'number', description: 'penaltyType이 dedicated_account_not_opened이고 가목 금액을 계산할 때 — 해당 과세기간(사업연도)의 총 일수.' },
        totalRelevantTransactionAmount: { type: 'number', description: 'penaltyType이 dedicated_account_not_opened이고 나목 금액을 계산할 때 — §50의2①1~4호에 따른 거래금액을 합친 금액(원). 가목·나목 중 큰 금액이 적용되므로 둘 다 입력 가능.' }
      },
      required: ['penaltyType']
    }
  },
  {
    name: 'calculate_national_forest_land_reduction',
    description: '국가에 양도하는 산지에 대한 양도소득세의 감면(조특법§85의10)을 계산한다. 2년 이상 보유한 산지(도시지역 소재 제외)를 2022.12.31 이전에 국유림의 경영 및 관리에 관한 법률§18에 따라 국가에 양도하면 그 양도소득세의 10%를 감면한다(신청기한 만료로 과거 거래에만 적용 가능).',
    input_schema: {
      type: 'object',
      properties: {
        transferDate: { type: 'string', description: '양도일(YYYY-MM-DD, 2022.12.31 이전).' },
        holdingYears: { type: 'number', description: '산지 보유기간(년).' },
        transferPrice: { type: 'number', description: '양도가액(원).' },
        acquisitionPrice: { type: 'number', description: '취득가액(원).' },
        necessaryExpenses: { type: 'number', description: '필요경비(원). 없으면 생략.' }
      },
      required: ['transferDate']
    }
  },
  {
    name: 'calculate_industrial_complex_relocation_lot_rate',
    description: '산업단지 개발사업 시행에 따른 이주택지 양도소득세 세율특례(조특법§104의20)를 판정한다. 산업단지 이주자가 분양받은 이주택지(분양가 1억원 이하)를 2012.12.31까지 양도하면 다주택중과세율 대신 기본세율을 적용한다(적용기한 만료로 과거 거래에만 적용 가능). 세액 자체는 계산하지 않고 적용 가능 여부만 판정한다.',
    input_schema: {
      type: 'object',
      properties: {
        transferDate: { type: 'string', description: '양도일(YYYY-MM-DD, 2012.12.31 이전).' },
        salePrice: { type: 'number', description: '이주택지 분양가격(원, 1억원 이하여야 함).' },
        wasResidentForTwoYears: { type: 'boolean', description: '실시계획승인일부터 소급 2년 이상 그 사업을 위해 제공된 주거용 건축물에서 거주한 이주자인지.' }
      },
      required: ['transferDate']
    }
  },
  {
    name: 'calculate_museum_relocation_installment',
    description: '박물관 등의 이전에 대한 양도소득세의 과세특례(조특법§83)에 따른 분할납부 스케줄을 계산한다. 3년 이상 운영한 박물관·미술관·과학관·공공도서관의 종전시설을 2022.12.31까지 양도하면, 그 양도소득세를 신고기한 종료일 이후 3년이 되는 날부터 5년간 균분(최소 1/5씩)해 분할납부할 수 있다(적용기한 만료로 과거 거래에만 적용 가능).',
    input_schema: {
      type: 'object',
      properties: {
        transferDate: { type: 'string', description: '종전시설 양도일(YYYY-MM-DD, 2022.12.31 이전).' },
        totalTaxAmount: { type: 'number', description: '분할납부할 양도소득세액(종전시설 양도차익에 대한 산출세액, 원).' }
      },
      required: ['transferDate', 'totalTaxAmount']
    }
  },
  {
    name: 'calculate_farmland_repurchase_refund',
    description: '경영회생 지원을 위한 농지 매매 등에 대한 양도소득세 과세특례(조특법§70의2)를 판정한다. 농업인이 한국농어촌공사에 양도한 농지등을 임차기간 내에 환매하면 당초 납부한 양도소득세를 환급받을 수 있고, 이후 그 환매농지를 다시 양도할 때는 한국농어촌공사에 양도하기 전 원래의 취득가액·취득시기를 그대로 적용한다.',
    input_schema: {
      type: 'object',
      properties: {
        wasRepurchasedWithinLeaseTerm: { type: 'boolean', description: '한국농어촌공사와의 임차기간 내에 해당 농지등을 환매했는지.' },
        originalTaxPaid: { type: 'number', description: '한국농어촌공사에 양도할 당시 납부한 양도소득세(원, 환급대상액).' }
      },
      required: ['wasRepurchasedWithinLeaseTerm']
    }
  },
  {
    name: 'calculate_long_term_rental_house_reduction',
    description: '장기임대주택 등에 대한 양도소득세 감면(조특법§97,§97의2,§97의5)을 계산한다. §97(2000.12.31 이전 임대개시 국민주택): 원칙 50% 감면, 건설임대주택 5년이상·매입임대주택(1995.1.1이후취득,무입주) 5년이상·10년이상임대 중 하나면 전액(100%) 면제(양도소득 전체에 적용). §97의2(1999.8.20~2001.12.31 신축임대주택): 5년이상 임대 후 양도시 전액 면제(양도소득 전체). §97의5(2018.12.31까지 취득+3개월내 등록, 10년이상 계속임대 장기일반민간임대주택등): 임대기간 중 발생한 양도소득에 대해서만 100% 감면(등록일 평가액 필요, §97의3·§97의4와 중복적용 배제).',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['sect97', 'sect97_2', 'sect97_5'], description: '적용할 조문.' },
        subType: { type: 'string', enum: ['construction_5yr', 'purchase_5yr_novacancy', 'rental_10yr', 'baseline'], description: 'provision이 sect97일 때만 — construction_5yr=건설임대주택 5년이상(100%), purchase_5yr_novacancy=매입임대주택 1995.1.1이후취득·무입주·5년이상(100%), rental_10yr=10년이상임대(100%), baseline=그 외 5년이상임대(50%).' },
        transferPrice: { type: 'number', description: '양도가액(원).' },
        acquisitionPrice: { type: 'number', description: '취득가액(원).' },
        necessaryExpenses: { type: 'number', description: '필요경비(원). 없으면 생략.' },
        registrationDateValue: { type: 'number', description: 'provision이 sect97_5일 때 — 장기일반민간임대주택등 등록일 현재의 평가액(원). acquisitionStandardPrice·registrationStandardPrice·transferStandardPrice가 없을 때의 근사치 계산에만 쓰인다.' },
        acquisitionStandardPrice: { type: 'number', description: 'provision이 sect97_5일 때만 — 취득 당시 기준시가(원). registrationStandardPrice·transferStandardPrice와 함께 셋 다 입력하면 시행령§97의5② 원문대로 "임대기간중 발생한 양도소득금액"을 기준시가 비율로 정확히 계산한다(없으면 registrationDateValue로 근사치 계산).' },
        registrationStandardPrice: { type: 'number', description: 'provision이 sect97_5일 때만 — 장기일반민간임대주택등 등록일 현재 기준시가(원).' },
        transferStandardPrice: { type: 'number', description: 'provision이 sect97_5일 때만 — 양도 당시 기준시가(원).' }
      },
      required: ['provision']
    }
  },
  {
    name: 'calculate_capital_increase_gift_tax',
    description: '증자에 따른 이익의 증여(상증세법§39, 시행령§29②)를 계산한다. 신주를 시가보다 낮거나 높은 가액으로 발행할 때 실권주 배정 여부·저가/고가 여부에 따라 5가지 세부 케이스로 나뉜다. low_allocated(법§39①1호가·다·라목 — 저가발행, 실권주 배정/비주주직접배정/균등초과배정, 게이트 없음), low_unallocated(법§39①1호나목 — 저가발행, 실권주 미배정, 게이트: 차액비율30%이상 또는 이익3억이상), high_allocated(법§39①2호가목 — 고가발행, 실권주 배정, 게이트 없음), high_unallocated(법§39①2호나목 — 고가발행, 실권주 미배정, 게이트: 차액비율30%이상 또는 이익3억이상), high_nonshareholder(법§39①2호다·라목 — 고가발행, 비주주직접배정 또는 균등초과배정, 게이트 없음).',
    input_schema: {
      type: 'object',
      properties: {
        caseType: { type: 'string', enum: ['low_allocated', 'low_unallocated', 'high_allocated', 'high_unallocated', 'high_nonshareholder'], description: '5가지 세부 케이스 중 하나.' },
        preValuePerShare: { type: 'number', description: '증자전 1주당 평가가액(원).' },
        preShares: { type: 'number', description: '증자전 발행주식총수.' },
        issuePricePerShare: { type: 'number', description: '신주 1주당 인수가액(원).' },
        increasedShares: { type: 'number', description: 'low_allocated/high_allocated/high_unallocated/high_nonshareholder일 때 — 증자로 실제 증가한 주식수.' },
        allocatedShares: { type: 'number', description: 'low_allocated/high_allocated일 때 — 배정받은 실권주수(또는 신주수, 균등조건 초과분 포함).' },
        equalIncreaseShares: { type: 'number', description: 'low_unallocated일 때 — 증자전 지분비율대로 균등하게 증자할 경우의 증가주식수.' },
        deemedAllocatedShares: { type: 'number', description: 'low_unallocated일 때 — 실권주총수×증자후신주인수자의지분비율×(신주인수자의특수관계인의실권주수/실권주총수)로 계산한 배정간주실권주수.' },
        forfeitedShares: { type: 'number', description: 'high_unallocated일 때 — 신주인수를 포기한 주주의 실권주수.' },
        relatedAcquiredShares: { type: 'number', description: 'high_unallocated/high_nonshareholder일 때 — 포기·미달배정 주주의 특수관계인이 인수한 실권주수(또는 신주수).' },
        equalIncreaseTotalShares: { type: 'number', description: 'high_unallocated일 때 — 증자전 지분비율대로 균등하게 증자하는 경우의 주식총수.' },
        underAllocatedShares: { type: 'number', description: 'high_nonshareholder일 때 — 신주를 배정받지 아니하거나 균등조건에 미달되게 배정받은 주주의 그 신주수.' },
        nonShareholderAndExcessTotalShares: { type: 'number', description: 'high_nonshareholder일 때 — 주주가 아닌 자에게 배정된 신주 및 균등조건을 초과해 인수한 신주의 총수.' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['caseType', 'preShares']
    }
  },
  {
    name: 'calculate_restructuring_property_reduction',
    description: '구조조정대상 부동산 취득자에 대한 양도소득세의 감면(조특법§43)을 계산한다. 1999.12.31 이전 취득분에 한해, 취득일부터 5년 이내 양도하면 그 양도소득세의 50%를 감면하고, 5년이 지난 후 양도하면 취득일부터 5년간 발생한 양도소득금액의 50%를 과세대상소득금액에서 뺀다.',
    input_schema: {
      type: 'object',
      properties: {
        acquisitionDate: { type: 'string', description: '취득일(YYYY-MM-DD, 1999.12.31 이전).' },
        transferDate: { type: 'string', description: '양도일(YYYY-MM-DD).' },
        transferPrice: { type: 'number', description: '양도가액(원).' },
        acquisitionPrice: { type: 'number', description: '취득가액(원).' },
        necessaryExpenses: { type: 'number', description: '필요경비(원). 없으면 생략.' },
        fiveYearMarkValue: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득일로부터 5년이 되는 시점의 평가액(원). acquisitionStandardPrice·fiveYearStandardPrice·transferStandardPrice가 없을 때의 근사치 계산에만 쓰인다.' },
        acquisitionStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득 당시 기준시가(원). fiveYearStandardPrice·transferStandardPrice와 함께 셋 다 입력하면 원문대로(기준시가 비율) 5년간 발생분을 정확히 계산한다(없으면 fiveYearMarkValue 등으로 근사치 계산).' },
        fiveYearStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 취득일로부터 5년이 되는 시점의 기준시가(원).' },
        transferStandardPrice: { type: 'number', description: '보유기간이 5년을 초과할 때만 — 양도 당시 기준시가(원).' }
      },
      required: ['acquisitionDate', 'transferDate']
    }
  },
  {
    name: 'calculate_population_decline_area_house_exclusion',
    description: '인구감소지역 주택 취득자에 대한 1세대1주택 비과세 특례(조특법§71의2, 2024.1.4~2026.12.31 취득분, 현재 시행중)를 판정한다. 주택·조합원입주권·분양권 중 1채(1개)를 보유한 1세대가 이 기간 중 인구감소지역 또는 수도권 밖 인구감소관심지역 주택을 취득한 후 종전주택을 양도하면, 그 주택은 1세대1주택 비과세(소득세법§89①3호·4호) 판정시 소유주택으로 보지 않는다. 세액을 계산하지 않고 적용 가능 여부만 판정한다.',
    input_schema: {
      type: 'object',
      properties: {
        acquisitionDate: { type: 'string', description: '인구감소지역주택의 취득일(YYYY-MM-DD).' },
        isPopulationDeclineArea: { type: 'boolean', description: '인구감소지역 또는 수도권 밖 인구감소관심지역에 소재하는지.' },
        wasOneOrFewerBeforeAcquisition: { type: 'boolean', description: '이 주택 취득 전 주택·조합원입주권·분양권 중 1채(1개)를 보유한 1세대였는지.' },
        meetsAreaAndPriceRequirements: { type: 'boolean', description: '주택 소재지·가액 등 시행령이 정하는 요건을 충족하는지.' }
      },
      required: ['acquisitionDate']
    }
  },
  {
    name: 'calculate_business_transfer_carryover',
    description: '중소기업간 통합(조특법§31)·법인전환(조특법§32)에 대한 양도소득세 이월과세를 판정한다. 사업용고정자산을 통합법인에 양도하거나 현물출자·사업양수도로 법인전환하면 그 시점에는 양도소득세를 과세하지 않고 나중에 법인이 그 자산을 양도할 때 정산한다. 이월과세 적용일부터 5년 이내에 승계사업을 폐지하거나 취득주식의 50% 이상을 처분하면, 사유발생일이 속하는 달의 말일부터 2개월 이내에 이월과세액(법인 기납부세액 제외)을 양도소득세로 납부해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['sect31', 'sect32'], description: 'sect31=중소기업간 통합, sect32=법인전환.' },
        deferredTaxAmount: { type: 'number', description: '이월과세액(원) — calculate_transfer_tax 등 일반 양도세 계산기로 별도 계산한 양도소득세.' },
        triggerEvent: { type: 'string', enum: ['none', 'business_discontinued', 'shares_disposed_50pct_plus'], description: 'none=사후관리 위반 없음(이월과세 계속 유지), business_discontinued=승계받은 사업을 폐지, shares_disposed_50pct_plus=취득한 주식·출자지분의 50% 이상을 처분.' },
        yearsSinceTransfer: { type: 'number', description: 'triggerEvent이 none이 아닐 때 — sect31은 사업용고정자산 양도일, sect32는 법인 설립등기일부터 사유발생일까지의 경과연수.' },
        alreadyPaidByCorp: { type: 'number', description: 'triggerEvent이 사후관리 위반일 때 — 통합법인·전환법인이 이미 납부한 세액(원). 없으면 0.' }
      },
      required: ['provision', 'deferredTaxAmount', 'triggerEvent']
    }
  },
  {
    name: 'calculate_burdened_gift_transfer',
    description: '부담부증여시 양도로 보는 부분의 취득가액·양도가액을 계산한다(소득세법시행령§159). 부담부증여로 수증자가 인수한 채무액에 상당하는 부분은 양도로 보며, 취득가액·양도가액 모두 "자산가액×(채무액÷증여가액)" 비율로 안분한다. 양도세 과세대상 자산과 비과세대상 자산을 함께 부담부증여하는 경우에는 먼저 총채무액을 과세대상 자산가액 비율로 안분한다(§159②). 결과의 양도가액·취득가액·필요경비를 calculate_transfer_tax 등 일반 양도세 계산기에 넣어 나머지 세액을 계산한다.',
    input_schema: {
      type: 'object',
      properties: {
        assetAcquisitionPrice: { type: 'number', description: '양도세 과세대상 자산의 취득가액(원, 실지거래가액).' },
        assetGiftValue: { type: 'number', description: '양도세 과세대상 자산의 증여재산가액(원, 상증세법상 평가액 — 부담부증여 전체 자산가액).' },
        totalDebtAmount: { type: 'number', description: '수증자가 인수한 채무액(원).' },
        otherAssetsGiftValueSum: { type: 'number', description: '이 자산과 함께 부담부증여한 다른 재산(양도세 과세대상이 아닌 재산)의 증여재산가액 합계(원). 있으면 §159②에 따라 총채무액을 먼저 안분한다. 없으면 생략.' },
        necessaryExpenses: { type: 'number', description: '자본적지출액·양도비 등 필요경비(원). 없으면 생략.' }
      },
      required: ['assetGiftValue', 'totalDebtAmount']
    }
  },
  {
    name: 'calculate_business_succession_deferral_amount',
    description: '가업상속납부유예금액(상증세법§72의2①, 시행령§69의3①)을 계산한다. 납부유예금액 = 상속세납부세액×(가업상속재산가액÷총상속재산가액).',
    input_schema: {
      type: 'object',
      properties: {
        inheritanceTaxPayable: { type: 'number', description: '상속세 납부세액(원).' },
        businessSuccessionPropertyValue: { type: 'number', description: '가업상속재산가액(원, 시행령§15⑤ 기준 — 가업상속공제 대상 재산가액).' },
        totalInheritanceValue: { type: 'number', description: '총 상속재산가액(원).' }
      },
      required: ['inheritanceTaxPayable', 'businessSuccessionPropertyValue', 'totalInheritanceValue']
    }
  },
  {
    name: 'calculate_property_in_kind_stock_receipt_value',
    description: '물납충당재산(주식)의 수납가액을, 상속개시일부터 수납할 때까지 신주발행·감자가 있었던 경우(시행령§75①1호, 시행규칙§20의2)의 산식으로 계산한다.',
    input_schema: {
      type: 'object',
      properties: {
        changeType: { type: 'string', enum: ['free_increase', 'paid_increase', 'free_decrease', 'paid_decrease'], description: 'free_increase=무상증자, paid_increase=유상증자, free_decrease=무상감자, paid_decrease=유상감자.' },
        oldSharePreChangeValue: { type: 'number', description: '신주발행·감자 전 구주 1주당 과세가액(원).' },
        newSharesPerOldShare: { type: 'number', description: 'changeType이 free_increase/paid_increase일 때 필수 — 구주 1주당 신주배정수.' },
        paymentPerNewShare: { type: 'number', description: 'changeType이 paid_increase일 때 — 신주 1주당 주금납입액(원). 없으면 0.' },
        decreasedSharesPerOldShare: { type: 'number', description: 'changeType이 free_decrease/paid_decrease일 때 필수 — 구주 1주당 감자주식수(1 미만).' },
        paymentPerDecreasedShare: { type: 'number', description: 'changeType이 paid_decrease일 때 — 감자시 1주당 지급금액(원). 없으면 0.' }
      },
      required: ['changeType', 'oldSharePreChangeValue']
    }
  },
  {
    name: 'calculate_business_succession_deferral_clawback',
    description: '가업상속납부유예(상증세법§72의2)·가업승계증여세납부유예(조특법§30의7)의 사후관리 위반시 추징세액을 판정한다. 두 조문 모두 정당한 사유 없이 사후관리 위반 사유가 생기면 허가를 취소하고 추징세액과 이자상당액을 징수한다. inheritance(§72의2)는 가업용자산40%이상처분/가업미종사/지분감소/고용유지요건미달/상속인사망 5가지, gift(§30의7)는 가업미종사/지분감소/고용유지요건미달/수증자사망 4가지 사유가 있다(§30의7은 자산처분 사유가 없음). 가업미종사·고용유지요건미달·사망과 5년이내 지분감소는 유예세액 전부를 추징하고, 자산처분비율(시행령§69의3③)·5년후 지분감소비율(시행령§69의3⑥·조특법시행령§27의7⑩)은 각 산식으로 정확히 계산한다. 추징세액이 확정되면 calculate_clawback_interest 도구로 이자상당액을 별도 계산해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['inheritance', 'gift'], description: 'inheritance=상증세법§72의2(가업상속납부유예), gift=조특법§30의7(가업승계증여세납부유예).' },
        deferredTaxAmount: { type: 'number', description: '납부유예된 세액(원).' },
        triggerEvent: { type: 'string', enum: ['none', 'asset_disposed_40pct', 'not_engaged', 'equity_decreased', 'employment_failed', 'heir_death', 'donee_death'], description: 'none=사후관리 위반 없음, asset_disposed_40pct=가업용자산 40%이상 처분(inheritance만), not_engaged=가업 미종사, equity_decreased=지분 감소, employment_failed=고용유지요건(70%기준) 미달, heir_death=상속인 사망(inheritance만), donee_death=수증자 사망(gift만).' },
        disposalRatio: { type: 'number', description: 'triggerEvent가 asset_disposed_40pct일 때 필수 — 가업용자산 처분비율(0~1).' },
        yearsSinceBase: { type: 'number', description: 'triggerEvent가 equity_decreased일 때 필수 — 상속개시일(inheritance) 또는 증여일(gift)부터 지분 감소일까지의 경과연수.' },
        equityDecreaseRatio: { type: 'number', description: 'triggerEvent가 equity_decreased이고 yearsSinceBase가 5 초과일 때 — 이미 계산된 지분감소비율(B÷C, 0~1)을 직접 입력. equityRatioAtBase·currentEquityRatio를 입력하면 자동계산되므로 그 경우 생략 가능.' },
        equityRatioAtBase: { type: 'number', description: 'triggerEvent가 equity_decreased이고 yearsSinceBase가 5 초과일 때 — 기준일(상속개시일·증여일) 현재 지분율(0~1). currentEquityRatio와 함께 입력하면 시행령§69의3⑥·조특법시행령§27의7⑩ 산식으로 자동계산.' },
        currentEquityRatio: { type: 'number', description: 'triggerEvent가 equity_decreased이고 yearsSinceBase가 5 초과일 때 — 지분감소사유 발생일 현재(감소 후) 지분율(0~1).' }
      },
      required: ['provision', 'deferredTaxAmount', 'triggerEvent']
    }
  },
  {
    name: 'calculate_property_in_kind_payment_eligibility',
    description: '물납(상속세) 적용 가능 여부를 판정한다. general(상증세법§73 일반물납)은 부동산·유가증권가액이 상속재산가액의 1/2 초과, 상속세납부세액 2천만원 초과, 상속세납부세액이 금융재산가액 초과의 3요건을 모두 충족해야 하며, cultural_heritage(§73의2 문화유산등물납)는 뒤의 2요건만 있다(부동산비율 요건 없음). cultural_heritage이고 요건충족시 문화유산등가액·상속재산가액을 입력하면 물납신청가능세액 한도(§73의2⑤)를 근사 계산한다. 물납충당재산의 구체적 범위·수납가액 산정(시행령 사항)은 다루지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        provision: { type: 'string', enum: ['general', 'cultural_heritage'], description: 'general=§73 일반물납, cultural_heritage=§73의2 문화유산등물납.' },
        inheritanceTaxPayable: { type: 'number', description: '상속세 납부세액(원).' },
        financialAssetValue: { type: 'number', description: '상속재산가액 중 금융재산가액(원, §13 가산 증여재산가액 제외). 없으면 0.' },
        realEstateSecuritiesValue: { type: 'number', description: 'provision이 general일 때 — 상속재산 중 부동산과 유가증권(물납충당가능재산으로 한정)의 가액(원).' },
        totalInheritanceValue: { type: 'number', description: '상속재산가액(원, §13 가산 증여재산 포함). provision이 general이면 필수이고, cultural_heritage에서 물납한도 계산시에도 필요.' },
        culturalHeritageValue: { type: 'number', description: 'provision이 cultural_heritage일 때 — 물납 신청하려는 문화유산등의 가액(원). 물납신청가능세액 한도 계산용.' },
        excludedDamagedCulturalHeritageValue: { type: 'number', description: 'provision이 cultural_heritage일 때 — 상속개시일 이후 물납신청 전까지 정당한 사유 없이 훼손·멸실 등(시행령§75의4①)에 해당하게 된 문화유산등의 가액(원). 있으면 물납신청가능세액 한도 계산에서 제외한다(시행령§75의2⑤). 없으면 0.' }
      },
      required: ['provision', 'inheritanceTaxPayable']
    }
  },
  {
    name: 'calculate_cultural_heritage_tax_deferral',
    description: '지정문화유산 등에 대한 상속세(§74)·증여세(§75가 준용) 징수유예를 계산한다. 문화유산자료등·박물관자료등·국가지정문화유산등·천연기념물등에 상당하는 세액의 징수를 유예하며, "해당 재산가액에 상당하는 세액"은 납부세액×(해당재산가액÷전체재산가액) 비율로 근사 계산한다(정확한 시행령 산식 미확인). triggerEvent=transferred_or_withdrawn(유상양도 또는 인출)이면 유예세액 전부를 즉시 징수(이자상당가산액 없음), reinheritance_death(상속만)이면 소유자 사망으로 재상속되어 부과 결정을 철회한다.',
    input_schema: {
      type: 'object',
      properties: {
        taxType: { type: 'string', enum: ['inheritance', 'gift'], description: 'inheritance=상속세(§74), gift=증여세(§75가 §74를 준용). 기본값 inheritance.' },
        totalTaxPayable: { type: 'number', description: '상속세(또는 증여세) 납부세액(원, 징수유예 적용 전 전체 세액).' },
        totalPropertyValue: { type: 'number', description: '상속재산가액(또는 증여재산가액)(원).' },
        eligiblePropertyValue: { type: 'number', description: '징수유예 대상 재산(문화유산자료등·박물관자료등·국가지정문화유산등·천연기념물등)의 가액(원).' },
        triggerEvent: { type: 'string', enum: ['none', 'transferred_or_withdrawn', 'reinheritance_death'], description: 'none=사후관리 사유 없음(계속 유예), transferred_or_withdrawn=유상양도 또는 인출(즉시징수), reinheritance_death=소유자 사망으로 재상속(부과철회, taxType=inheritance만 해당).' }
      },
      required: ['totalTaxPayable', 'totalPropertyValue', 'eligiblePropertyValue']
    }
  },
  {
    name: 'calculate_merger_benefit_gift_tax',
    description: '합병에 따른 이익의 증여(상증세법§38)를 계산한다. 특수관계 법인간 합병에서 대주주등이 합병대가를 주식등으로 교부받는 경우(가장 흔한 유형), (합병후 신설·존속법인 1주당평가액-과대평가법인 1주당평가액×(과대평가법인 합병전주식수÷과대평가법인 주주등이 교부받은 신설법인주식수))×대주주등이 교부받은 신설법인주식수가 이익이다. 기준금액(교부받은 주식가액의 30%와 3억원 중 적은 금액) 미만이면 과세하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        postMergerValuePerShare: { type: 'number', description: '합병 후 신설 또는 존속하는 법인의 1주당 평가가액(원).' },
        overvaluedPreMergerValuePerShare: { type: 'number', description: '주가가 과대평가된 합병당사법인의 합병 전 1주당 평가가액(원).' },
        overvaluedPreMergerShareCount: { type: 'number', description: '주가가 과대평가된 합병당사법인의 합병 전 주식등의 수.' },
        sharesReceivedByOvervaluedShareholders: { type: 'number', description: '과대평가법인의 주주등이 합병으로 인하여 교부받은 신설 또는 존속법인 주식등의 수(전체).' },
        largeShareholderSharesReceived: { type: 'number', description: '이익을 계산할 대주주등이 합병으로 교부받은 신설 또는 존속법인 주식등의 수.' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['postMergerValuePerShare', 'sharesReceivedByOvervaluedShareholders', 'largeShareholderSharesReceived']
    }
  },
  {
    name: 'calculate_property_use_service_gift_tax',
    description: '재산사용 및 용역제공 등에 따른 이익의 증여(상증세법§42)를 계산한다. 무상으로 재산을 사용하거나 용역을 제공받으면 그 시가상당액(타인의 재산을 무상담보로 제공받아 차입한 경우는 차입금×적정이자율4.6%-실제지급이자)이, 저가 또는 고가로 사용·제공하면 시가와 대가의 차액이 증여재산가액이다. 무상은 1천만원, 저가·고가는 시가의 30% 미만이면 과세하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        useType: { type: 'string', enum: ['free', 'low_or_high'], description: 'free=무상사용·무상용역제공·무상담보차입, low_or_high=시가보다 낮거나 높은 대가로 사용·제공.' },
        isCollateralLoan: { type: 'boolean', description: 'useType이 free일 때만 — 타인의 재산을 무상으로 담보제공받아 금전을 차입한 경우인지.' },
        loanAmount: { type: 'number', description: 'isCollateralLoan이 true일 때 — 차입금(원).' },
        actualInterestPaid: { type: 'number', description: 'isCollateralLoan이 true일 때 — 실제로 지급한 이자(원). 없으면 0.' },
        marketValueEquivalent: { type: 'number', description: 'useType이 free이고 isCollateralLoan이 false일 때 — 무상으로 사용하거나 제공받음에 따라 지급해야 할 시가 상당액(원).' },
        marketValue: { type: 'number', description: 'useType이 low_or_high일 때 — 재산·용역의 시가(원).' },
        considerationPaid: { type: 'number', description: 'useType이 low_or_high일 때 — 실제 지급하거나 받은 대가(원).' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['useType']
    }
  },
  {
    name: 'calculate_org_change_gift_tax',
    description: '법인의 조직 변경 등에 따른 이익의 증여(상증세법§42의2)를 계산한다. 주식의 포괄적 교환·이전, 사업양수도, 사업교환, 조직변경 등으로 소유지분이 변동된 경우 (변동후지분-변동전지분)×변동후1주당가액이, 평가액이 변동된 경우 변동후가액-변동전가액이 이익이다. 변동전 재산가액의 30%와 3억원 중 적은 금액 미만이면 과세하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        subType: { type: 'string', enum: ['share_change', 'value_change'], description: 'share_change=소유지분이 변동된 경우, value_change=평가액이 변동된 경우.' },
        beforeShares: { type: 'number', description: 'subType이 share_change일 때 — 변동 전 지분(주식수 등).' },
        afterShares: { type: 'number', description: 'subType이 share_change일 때 — 변동 후 지분(주식수 등).' },
        afterValuePerShare: { type: 'number', description: 'subType이 share_change일 때 — 지분 변동 후 1주당 가액(원).' },
        beforePropertyValue: { type: 'number', description: 'subType이 share_change일 때 게이트 계산용 — 변동 전 재산가액(원). 없으면 변동전지분×변동후1주당가액으로 대체.' },
        beforeValue: { type: 'number', description: 'subType이 value_change일 때 — 변동 전 가액(원).' },
        afterValue: { type: 'number', description: 'subType이 value_change일 때 — 변동 후 가액(원).' },
        relationDeductionLimit: { type: 'number', description: '증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['subType']
    }
  },
  {
    name: 'calculate_property_value_increase_gift_tax',
    description: '재산 취득 후 재산가치 증가에 따른 이익의 증여(상증세법§42의3)를 계산한다. 자력이 없는 자가 증여·차입 등으로 재산을 취득한 후 5년 이내 개발사업·형질변경·비상장주식 등록 등으로 재산가치가 증가하면, (사유발생일 현재가액-취득가액-통상적가치상승분-가치상승기여분)이 이익이다. (취득가액+통상적가치상승분+가치상승기여분)의 30%와 3억원 중 적은 금액 미만이면 과세하지 않는다. §47①에 열거된 합산배제증여재산이므로 관계별 증여재산공제는 적용하지 않고 §55①3호에 따라 이익에서 3천만원을 공제한 금액이 과세표준이다.',
    input_schema: {
      type: 'object',
      properties: {
        propertyValueAtIncreaseEvent: { type: 'number', description: '재산가치증가사유 발생일 현재의 재산가액(원).' },
        acquisitionCost: { type: 'number', description: '해당 재산의 취득가액(원, 증여받은 재산이면 그 증여세 과세가액).' },
        normalAppreciationAmount: { type: 'number', description: '통상적인 가치상승분(원) — 기업가치 실질증가·지가상승률 등을 고려한 정상적인 가치상승분.' },
        valueIncreaseContributionAmount: { type: 'number', description: '가치상승기여분(원) — 개발사업·형질변경·인허가 등을 위해 지출한 자본적지출액 등.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['propertyValueAtIncreaseEvent']
    }
  },
  {
    name: 'calculate_nontaxable_gift_property',
    description: '비과세되는 증여재산(상증세법§46)에 해당하는지 판정한다. 국가·지자체 증여, 우리사주조합원 취득이익, 정당·사내근로복지기금·신용보증기금 등 단체 증여, 사회통념상 이재구호금품·치료비·생활비·교육비, 장애인 보험금, 국가유공자·의사자 유족의 성금, 비영리법인 승계재산 등 10가지 열거항목 중 하나에 해당하면 그 금액에 증여세를 부과하지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        itemType: { type: 'string', enum: ['government', 'esop', 'political_party', 'labor_welfare_fund', 'disaster_relief', 'credit_guarantee_fund', 'public_entity', 'disabled_insurance', 'veteran_bereaved', 'npo_succession'], description: 'government=국가·지자체 증여(1호), esop=우리사주조합 취득이익(2호), political_party=정당 증여(3호), labor_welfare_fund=사내근로복지기금 등(4호), disaster_relief=이재구호금품·치료비·생활비·교육비(5호), credit_guarantee_fund=신용보증기금 등(6호), public_entity=국가·지자체·공공단체(7호), disabled_insurance=장애인 보험금(8호), veteran_bereaved=국가유공자·의사자 유족 성금(9호), npo_succession=비영리법인 승계재산(10호).' },
        amount: { type: 'number', description: '해당 항목의 금액(원).' }
      },
      required: ['itemType', 'amount']
    }
  },
  {
    name: 'calculate_deemed_inheritance_property',
    description: '상속재산으로 보는 보험금·신탁재산·퇴직금 등(간주상속재산, 상증세법§8,§9,§10)의 포함 여부와 포함액을 판정한다. 보험금(§8): 피상속인이 보험계약자이거나, 계약자가 다르더라도 피상속인이 실질적으로 보험료를 납부한 경우 그 비율만큼 상속재산으로 본다. 신탁재산(§9): 피상속인이 신탁한 재산은 원칙적으로 상속재산이나 §33①로 이미 증여재산가액 처리된 신탁수익권은 제외하고, 반대로 피상속인이 타인신탁의 수익권을 갖고 있었다면 그 가액도 포함한다. 퇴직금등(§10): 원칙적으로 상속재산이나 국민연금법 등이 정하는 유족연금류는 제외한다.',
    input_schema: {
      type: 'object',
      properties: {
        itemType: { type: 'string', enum: ['insurance', 'trust_settled', 'trust_benefit_from_others', 'retirement'], description: 'insurance=보험금(§8), trust_settled=피상속인이 신탁한 재산(§9①), trust_benefit_from_others=피상속인이 타인신탁의 수익권 보유(§9②), retirement=퇴직금·퇴직수당·공로금·연금 등(§10).' },
        amount: { type: 'number', description: '해당 항목의 금액(원) — 보험금은 수령한 보험금 전액, 신탁재산은 신탁재산 평가액, 퇴직금등은 지급액.' },
        wasPolicyholderDecedent: { type: 'boolean', description: 'itemType이 insurance일 때만 — 피상속인이 보험계약자였는지.' },
        premiumPaidByDecedentRatio: { type: 'number', description: 'itemType이 insurance이고 wasPolicyholderDecedent가 false일 때만 — 피상속인이 실질적으로 부담한 보험료 비율(0~1).' },
        isAlreadyGiftTaxedUnder33_1: { type: 'boolean', description: 'itemType이 trust_settled일 때만 — 이 신탁수익권이 이미 §33①에 따라 수익자의 증여재산가액으로 처리되었는지(true면 상속재산 제외).' },
        isExcludedSurvivorPension: { type: 'boolean', description: 'itemType이 retirement일 때만 — 국민연금법·공무원연금법 등이 정하는 유족연금·유족보상금류 등 §10 단서의 열거 항목에 해당하는지(true면 상속재산 제외).' }
      },
      required: ['itemType', 'amount']
    }
  },
  {
    name: 'calculate_trust_income_gift_tax',
    description: '신탁이익의 증여(상증세법§33)를 계산한다. 위탁자가 타인을 수익자로 지정한 신탁에서 원본 또는 수익을 받을 권리를 갖게 하는 경우, 원칙적으로 그 원본·수익이 실제 지급되는 날(위탁자 사망시 사망일, 약정일까지 미지급시 약정일 등 예외는 시행령§25①)을 증여일로 하여 과세한다. 원본·수익을 한번에 받으면 그 가액 그대로가 증여재산가액이고, 여러 차례 나눠 받는 경우에는 증여시기를 기준으로 시행령§61(신탁수익권 평가)을 준용해 평가한 가액을 사용한다(시행령§25②) — 후자는 calculate_trust_benefit_value 도구로 먼저 평가액을 구한 뒤 그 결과를 giftAmount로 입력해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        giftAmount: { type: 'number', description: '신탁이익(원본 또는 수익의 가액, 원). 여러 차례 나눠 받는 경우 calculate_trust_benefit_value 도구의 평가액을 사용.' },
        relationDeductionLimit: { type: 'number', description: '증여자와의 관계별 증여재산공제(§53) 남은 한도액.' },
        marriageBirthDeduction: { type: 'number', description: '혼인·출산 증여재산공제(§53의2). 없으면 0.' },
        priorGiftAmount: { type: 'number', description: '10년 이내 동일인 기증여재산가액(§47②). 없으면 0.' },
        appraisalFeeAmount: { type: 'number', description: '증여재산 감정평가 수수료(500만원 한도). 없으면 생략.' },
        disasterLossAmount: { type: 'number', description: '재해손실공제(§54). 없으면 생략.' },
        priorPaidTax: { type: 'number', description: '§58 납부세액공제. 없으면 생략.' },
        foreignTaxPaidAmount: { type: 'number', description: '외국납부세액공제(§59). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지.' },
        underreportedTaxAmount: { type: 'number', description: '과소신고분 세액.' },
        unpaidDays: { type: 'integer', description: '납부지연일수. 없으면 0.' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준 미납세액.' },
        reportedInTime: { type: 'boolean', description: '법정신고기한 내 신고 가정 여부 — 기본 true.' }
      },
      required: ['giftAmount']
    }
  },
  {
    name: 'calculate_installment_payment_schedule',
    description: '상속세·증여세 연부연납(다년 분할납부) 회차별 납부예정세액을 계산한다([별지 제11호서식]). 연부연납대상금액을 (연부연납기간+1)회로 균등분할하고, 각 회분마다 그 시점의 잔여 미납액에 연이자율을 적용한 가산금을 더한다. 연이자율은 국세기본법 시행령 §43의3②에 따라 수시로 바뀌므로 이 도구가 자동으로 채우지 않으니 신고 시점 기준 이자율을 반드시 확인해서 넣어야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        taxType: { type: 'string', enum: ['inheritance', 'gift'], description: 'inheritance=상속세, gift=증여세.' },
        totalTaxAmount: { type: 'number', description: '연부연납 전 총 납부세액(원). 2천만원 이하면 연부연납 자체가 불가능하다.' },
        initialPaymentAmount: { type: 'number', description: '신고·납부기한까지 먼저 납부하는 금액(원, 최초납부세액). 생략하면 0(전액을 연부연납대상금액으로 처리).' },
        installmentPeriodYears: { type: 'integer', description: '연부연납기간(년). 한도: 상속세 일반재산 10년, 가업상속재산은 가업상속재산 비율 50% 미만이면 10년(3년 거치 가능)·50% 이상이면 20년(5년 거치 가능), 증여세 일반재산 5년, 조특법§30의6 특례재산 15년(한도 준수 여부는 검증하지 않으며, 거치기간이 있는 경우 이 도구의 균등분할 모델과는 상환구조가 다르다).' },
        annualInterestRatePercent: { type: 'number', description: '연부연납 가산금 연이자율(%, 예: 3.5). 국세기본법 시행령§43의3②에 따른 현재 이자율을 반드시 확인해서 넣어야 한다.' }
      },
      required: ['taxType', 'totalTaxAmount', 'installmentPeriodYears', 'annualInterestRatePercent']
    }
  },
  {
    name: 'calculate_clawback_interest',
    description: '증여세·상속세 각종 특례(영농자녀 증여농지 감면 §71, 창업자금 증여세 과세특례 §30의5, 가업승계 주식등 증여세 과세특례 §30의6 등)의 사후관리 요건을 위반해 추징되는 경우, 추징세액에 붙는 이자상당액을 계산한다([별지 제52호의2서식]/[별지 제11호의7서식]/[별지 제11호의10서식] 등 공통 계산식). 이자상당액 = 추징세액 × 일수 × 국세환급가산금이율(국세기본법시행규칙§19조의3, 구간별로 자동 적용).',
    input_schema: {
      type: 'object',
      properties: {
        clawedBackTaxAmount: { type: 'number', description: '사후관리 위반으로 결정된 추징세액(원) — 당초 감면·특례로 줄어들었던 세액. 세액 자체의 산정은 이 도구가 하지 않으므로 별도로 계산해서 입력한다.' },
        startDate: { type: 'string', description: '이자 기산일(YYYY-MM-DD) — 당초 감면·특례 적용받은 증여세(또는 상속세)의 과세표준 신고기한 다음 날.' },
        endDate: { type: 'string', description: '추징사유 발생일(YYYY-MM-DD) — 사후관리 위반 사유가 발생한 날.' }
      },
      required: ['clawedBackTaxAmount', 'startDate', 'endDate']
    }
  },
  {
    name: 'calculate_low_price_transfer_gift_amount',
    description: '저가양수·고가양도에 따른 이익의 증여의제(상증세법 §35)의 증여재산가액을 계산한다. 특수관계인 간 재산을 시가보다 현저히 낮은(또는 높은) 가액으로 거래하면, 그 차액에서 min(시가×30%, 3억원)을 뺀 금액이 증여재산가액이 된다. 이 도구는 세액이 아니라 증여재산가액만 계산하므로, 결과값을 calculate_gift_tax의 giftAmount로 넣어 정상적으로 증여재산공제·누진세율·신고세액공제를 적용해 세액을 계산해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        fairMarketValue: { type: 'number', description: '거래재산의 시가(원) — calculate_gift_tax와 동일한 순서(사건폴더 문서→매매실례가→공시가격→보충적평가)로 먼저 확정할 것.' },
        transferPrice: { type: 'number', description: '실제 거래한 대가(원) — 매매대금 등.' }
      },
      required: ['fairMarketValue', 'transferPrice']
    }
  },
  {
    name: 'calculate_interest_free_loan_gift_amount',
    description: '금전 무상대출 등에 따른 이익의 증여의제(상증세법 §41의4)의 증여재산가액을 계산한다. 특수관계인 간 금전을 무상 또는 적정이자율(현재 연 4.6%)보다 낮은 이자로 빌려주면 그 차액이 증여재산가액이 되며, 연간 계산액이 1천만원 미만이면 과세하지 않는다. 이 도구는 세액이 아니라 증여재산가액만 계산하므로, 결과값을 calculate_gift_tax의 giftAmount로 넣어 정상적으로 증여재산공제·누진세율·신고세액공제를 적용해 세액을 계산해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        loanPrincipal: { type: 'number', description: '대여원금(원).' },
        actualInterestPaid: { type: 'number', description: '실제 지급(약정)한 이자 총액(원) — 무이자면 생략(0).' },
        appropriateInterestRatePercent: { type: 'number', description: '적정이자율(%, 연). 상증세법 시행규칙에 따른 현재 이자율은 연 4.6%이나 수시로 바뀔 수 있으니 대출 시점 기준으로 확인해서 넣는다. 생략하면 4.6을 기본값으로 쓴다.' },
        loanMonths: { type: 'integer', description: '대출기간(개월). 1년 이상 계속되는 대출은 매년 다시 계산해야 하며, 1년 미만이면 월할계산에 쓰인다. 생략하면 12(1년)로 계산한다.' }
      },
      required: ['loanPrincipal']
    }
  },
  {
    name: 'calculate_stock_transfer_tax',
    description: '주식등 양도소득세를 계산한다(소득세법 §94·§104①11,12,13, [별지 제62호서식] 등 기준) — 부동산 양도세(calculate_transfer_tax)와는 완전히 별도 세목으로, 장기보유특별공제가 없고 대주주/소액주주·국내/국외·중소기업 여부에 따라 세율이 다르다. 국내주식(대주주 1년미만30%, 대주주 3억이하20%·초과25%, 소액주주 중소기업10%/그외20%), 국외주식(중소기업10%/그외20%), 파생상품(10%), 기타자산(특정주식·부동산과다보유법인, 누진세율 6~45%)로 구분한다. 기본공제(연250만원)는 국내·국외주식 손익통산 후 1회만 적용된다.',
    input_schema: {
      type: 'object',
      properties: {
        assetCategory: { type: 'string', enum: ['domestic_stock', 'foreign_stock', 'derivative', 'other_asset', 'trust_beneficiary'], description: 'domestic_stock=국내 상장·비상장주식등, foreign_stock=국외주식등(5년 이상 계속 거주자만 과세대상), derivative=파생상품등, other_asset=특정주식·부동산과다보유법인 주식등(기타자산 취급, 소득세법 §94①4), trust_beneficiary=신탁 수익권(소득세법 §94①6, §104①14 — 3억 이하 20%·3억 초과분 25%).' },
        isMajorityNonBusinessLandCorp: { type: 'boolean', description: 'assetCategory가 other_asset(§94①4호다목·라목 주식등)일 때만 — 그 법인의 자산총액 중 법인세법§55조의2②에 따른 비사업용토지가 차지하는 비율이 100분의 50 이상인지(소득세법§104①9호, 시행령§167조의7). true면 기본세율(누진 6~45%)에 10%p를 가산한다(8호 비사업용토지 세율표와 동일 구조).' },
        transferPrice: { type: 'number', description: '양도가액(원). 상장주식은 원칙적으로 실제 거래가액.' },
        acquisitionPrice: { type: 'number', description: '취득가액(원).' },
        transferExpenses: { type: 'number', description: '양도비용(원, 증권거래세·양도소득세 신고서 작성비용 등). 없으면 생략(0).' },
        isDaejuju: { type: 'boolean', description: 'assetCategory가 domestic_stock일 때만 — 대주주(코스피 지분1%또는시가총액50억, 코스닥2%또는50억, 코넥스4%또는50억, 비상장4%또는10억, K-OTC벤처기업4%또는40억 — 기준은 신고 시점 기준으로 재확인)에 해당하는지. false면 소액주주로 처리한다.' },
        isSmallMediumCompany: { type: 'boolean', description: '발행법인이 중소기업(조특법§5① 요건)인지. 국내주식(소액주주)·국외주식 세율 판정에 쓰인다.' },
        holdingMonths: { type: 'integer', description: 'assetCategory가 domestic_stock이고 isDaejuju가 true일 때만 — 보유기간(개월). 12개월 미만이면 30% 단일세율이 적용된다.' },
        priorNetGainOrLoss: { type: 'number', description: '같은 과세기간 중 다른 국내·국외주식 양도에서 발생한 순손익(원, 이익은 양수/손실은 음수) — 2020.1.1. 이후 양도분부터 국내·국외주식 손익통산이 허용되므로 이 값과 합산해서 과세표준을 계산한다. 없으면 생략.' },
        basicDeductionAlreadyUsed: { type: 'number', description: '같은 과세기간에 이미 다른 주식 양도에서 사용한 기본공제액(원) — 기본공제(연 250만원)는 국내·국외주식 합산 1회만 적용되므로 중복 적용을 막기 위해 넣는다. 없으면 생략(0).' },
        foreignTaxPaidAmount: { type: 'number', description: '국외주식등 양도소득에 대해 외국에서 이미 납부한 세액(원, 외국납부세액공제). 없으면 생략.' },
        filingStatus: { type: 'string', enum: ['ontime', 'unreported', 'underreported'], description: 'ontime=정상(기한내 또는 사후 자진)신고, unreported=무신고, underreported=과소신고. 기본값 ontime.' },
        isFraudulent: { type: 'boolean', description: '무신고·과소신고가 부정행위에 해당하는지 — 가산세율이 일반(20%/10%)보다 높은 40%로 적용된다.' },
        underreportedTaxAmount: { type: 'number', description: 'filingStatus가 underreported일 때, 과소신고로 인해 부족하게 신고된 세액(원).' },
        unpaidDays: { type: 'integer', description: '법정납부기한 다음날부터 실제 납부일까지의 미납일수. 없으면 생략(0).' },
        unpaidTaxForLatePenalty: { type: 'number', description: '납부지연가산세 계산 기준이 되는 미납세액(원). 생략하면 이번 계산의 산출세액(가산세 제외분)을 그대로 쓴다.' },
        unrecordedIncomeAmount: { type: 'number', description: '주식등에 대한 장부의 비치·기록의무 및 기장불성실가산세(소득세법§115) — assetCategory가 domestic_stock이고 isDaejuju가 true일 때만 의미가 있다. 법인의 대주주가 양도하는 주식등에 대해 거래명세 등을 기장하지 않았거나 누락한 소득금액(원). 없으면 생략.' },
        transactionAmountForBookkeepingPenalty: { type: 'number', description: '§115 기장불성실가산세 계산용 — 산출세액이 0원일 때만 쓰인다. 그 거래금액(원)에 1만분의 7을 곱해 가산세로 한다. 없으면 생략.' }
      },
      required: ['assetCategory', 'transferPrice']
    }
  },
  {
    name: 'calculate_unlisted_stock_value',
    description: '비상장주식을 상증세법 §63·시행령 §54 보충적평가방법(순손익가치·순자산가치 가중평균)으로 평가한다. 증여재산가액·상속재산가액에 비상장주식이 포함될 때 그 평가액을 구하는 용도다.',
    input_schema: {
      type: 'object',
      properties: {
        totalIssuedShares: { type: 'number', description: '평가대상 법인의 발행주식총수' },
        ownedShares: { type: 'number', description: '실제 증여·상속받는(평가할) 주식수' },
        netProfit1YearAgo: { type: 'number', description: '평가기준일 직전 사업연도의 법인 전체 순손익액(원, 세무조정 반영 후). 1주당 값이 아니라 법인 전체 금액.' },
        netProfit2YearsAgo: { type: 'number', description: '평가기준일 2년 전 사업연도의 법인 전체 순손익액(원)' },
        netProfit3YearsAgo: { type: 'number', description: '평가기준일 3년 전 사업연도의 법인 전체 순손익액(원)' },
        netAssetValue: { type: 'number', description: '평가기준일 현재 법인의 순자산가액(자산총액-부채총액, 상증세법 기준 재평가액, 원)' },
        isRealEstateHeavy: { type: 'boolean', description: '자산총액 중 부동산 등의 비율이 50% 이상인 부동산과다보유법인인지 (가중치가 순손익2:순자산3으로 바뀜, 기본은 순손익3:순자산2)' },
        isMajorShareholder: { type: 'boolean', description: '최대주주 및 특수관계인에 해당하는지 (원칙적으로 20% 할증평가, 아래 배제 사유가 있으면 자동으로 배제됨)' },
        isSmallBusiness: { type: 'boolean', description: '평가대상 법인이 중소기업기본법상 중소기업인지 — true면 최대주주 할증평가가 항상 배제된다(상증세법§63③, 시행령§53⑥9호).' },
        isMediumBusinessUnder500B: { type: 'boolean', description: '평가대상 법인이 중견기업이면서 직전 3개 사업연도 매출액 평균이 5천억원 미만인지 — true면 최대주주 할증평가가 배제된다(상증세법§63③).' }
      },
      required: ['totalIssuedShares', 'ownedShares']
    }
  },
  {
    name: 'manage_task_plan',
    description: '여러 단계로 나눠서 진행해야 하는 복잡한 작업(예: 세무구조 3축 분석, 여러 날에 걸친 보고서 작성)을 시작할 때, 계획을 세워 저장하고 진행 상황을 기록·갱신하는 도구다. 지금 사용자가 보고 있는 폴더 안에 "_작업진행.json" 파일로 저장되어, 대화가 끊기거나 나중에 다시 열어도 어디까지 했는지 이어서 확인할 수 있다. ' +
      '사용 방법: (1) 복잡한 요청을 받으면 먼저 action="create"로 하위작업 목록(steps)을 만들어 저장하라. (2) 각 하위작업을 실제로 진행할 때마다 action="update"로 그 단계의 status를 pending→in_progress→done으로 바꾸고 note에 결과 요약을 적어 다시 저장하라(steps는 매번 전체 목록을 다시 줘야 한다, 일부만 주면 안 됨). (3) 사용자가 "지난번 그 작업 어디까지 했지?"처럼 물으면 action="read"로 확인하라. ' +
      '간단한 단일 질문·짧은 답변으로 끝나는 요청에는 이 도구를 쓰지 마라 — 진짜로 여러 단계·여러 턴에 걸칠 만큼 복잡한 작업에만 사용하라.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'read'], description: 'create=새 계획 생성(기존 계획 있으면 덮어씀), update=기존 계획의 진행상태 갱신, read=지금 저장된 계획 확인' },
        taskName: { type: 'string', description: '작업 전체 이름 (예: "고광민 원장님 세무구조 3축 분석"). create/update일 때 필요.' },
        steps: {
          type: 'array',
          description: 'create/update일 때 하위작업 전체 목록 (일부만 주지 말고 항상 전체를 다시 줄 것)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '단계 식별자 (예: "1", "mso" 등 짧은 값)' },
              title: { type: 'string', description: '그 단계가 무엇인지' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
              note: { type: 'string', description: '그 단계의 결과 요약이나 메모 (선택)' }
            },
            required: ['id', 'title', 'status']
          }
        }
      },
      required: ['action']
    }
  },
  {
    name: 'lookup_calendar_events',
    description: '구글캘린더(기본 캘린더, 조종호님 계정)에서 특정 기간의 일정을 조회한다. "이번주 뭐 있어?", "이 날 일정 있어?", "다음달 마감 뭐 있어?"처럼 캘린더 내용을 물어보면 이 도구로 확인하라. startDate/endDate를 생략하면 오늘부터 7일간을 기본으로 조회한다.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: '조회 시작일 YYYY-MM-DD (생략하면 오늘)' },
        endDate: { type: 'string', description: '조회 종료일 YYYY-MM-DD (생략하면 시작일로부터 7일 후)' }
      }
    }
  },
  {
    name: 'search_emails',
    description: '조종호님의 Gmail 받은편지함을 검색해서 최근 메일 목록(제목·보낸사람·날짜·미리보기)을 확인한다. "메일 왔어?", "그 사람한테 답장 왔나 확인해줘"처럼 물으면 이 도구로 확인하라. query는 Gmail 검색연산자를 그대로 쓸 수 있다(예: "from:hometax.go.kr", "is:unread", "subject:계약서"). query를 생략하면 받은편지함 최근 메일을 그대로 가져온다. 읽기 전용 도구다 — 실제로 답장을 보내려면 send_email 도구를 별도로 써라.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail 검색어(생략 가능). Gmail 검색연산자 그대로 사용 가능.' },
        maxResults: { type: 'integer', description: '가져올 최대 메일 개수 (기본 10, 최대 30)' }
      }
    }
  },
  {
    name: 'lookup_google_tasks',
    description: '구글 태스크(할일 목록)를 조회한다. "오늘 할일 뭐 있어?", "밀린 할일 있어?"처럼 물으면 이 도구로 확인하라. includeCompleted를 true로 주지 않으면 완료된 항목은 안 보여준다.',
    input_schema: {
      type: 'object',
      properties: {
        includeCompleted: { type: 'boolean', description: '완료된 할일까지 포함할지 (기본 false)' },
        taskListId: { type: 'string', description: '특정 할일목록 ID(선택). 생략하면 기본 목록(@default)을 조회한다.' }
      }
    }
  },
  {
    name: 'add_google_task',
    description: '구글 태스크에 새 할일을 추가한다. "이거 할일로 등록해줘"처럼 요청했을 때만 써라.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '할일 제목' },
        notes: { type: 'string', description: '메모(선택)' },
        dueDate: { type: 'string', description: '마감일 YYYY-MM-DD (선택)' },
        taskListId: { type: 'string', description: '특정 할일목록 ID(선택). 생략하면 기본 목록(@default)에 추가한다.' }
      },
      required: ['title']
    }
  },
  {
    name: 'add_log_entry',
    description: '지금 사용자가 보고 있는 폴더(사건)의 경과지에 새 기록을 추가한다. 사용자가 "경과지에 적어줘", "오늘 한 거 기록해줘"처럼 요청했을 때, 또는 사건 검토·분석을 마친 뒤 그 진행상황을 스스로 남기는 게 자연스러울 때 사용하라. dueDate를 넣으면 화면의 처리일지 기능과 동일하게 구글캘린더 일정으로도 자동 등록된다. 남발하지 말고 실제로 기록할 만한 진행상황이 있을 때만 써라.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '기록할 내용' },
        date: { type: 'string', description: '기록 날짜 YYYY-MM-DD (생략하면 오늘)' },
        dueDate: { type: 'string', description: '마감일 YYYY-MM-DD (있으면 캘린더에도 자동 등록됨, 없으면 생략)' }
      },
      required: ['text']
    }
  },
  {
    name: 'remember_fact',
    description: '조종호님에 대한 지속적으로 유효한 사실이나 지침(예: 선호하는 보고서 형식, 앞으로 항상 지켜야 할 규칙, 새로 알게 된 사무실 운영방침)을 마스터 프로필에 추가해서, 이후 모든 대화·모든 사건 폴더에서 항상 참고되게 만든다. ' +
      '사용자가 "기억해줘", "앞으로 항상 이렇게 해줘"처럼 명시적으로 요청했을 때, 또는 스스로 판단하기에도 이건 이번 대화 한정이 아니라 앞으로 계속 적용돼야 할 규칙이 명확할 때만 사용하라. ' +
      '이번 대화·이번 사건에만 해당하는 임시 정보는 절대 여기 넣지 마라(그런 건 그 사건의 대화기록에 자연히 남는다). 기존 마스터 프로필 내용을 지우거나 고치지 않고, 새 항목만 추가한다. ' +
      '사용한 뒤에는 "마스터 프로필에 기억해두었습니다"라고 사용자에게 알려줘라.',
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: '기억해둘 사실/지침 한 줄 (간결하게)' }
      },
      required: ['fact']
    }
  },
  {
    name: 'list_business_managers',
    description: '분야별 업무관리자(부동산세무·상속증여·법인전환 등 각 세무 분야별 절차·체크리스트·판단기준, 그리고 사건처리내용 정리·검토 같은 업무 프로세스 절차서까지 포함) 목록을 확인한다. 이름과 한 줄 설명만 가져오므로 가볍다. ' +
      '사용자의 질문이 특정 세무 분야에 해당할 가능성이 있을 때뿐 아니라, 지금 보고 있는 사건 폴더의 진행상황·처리방향·확인사항·증빙 등을 검토·정리해달라는 취지의 요청(표현이 정확히 일치하지 않아도 됨)일 때도 먼저 이 도구로 관련 업무관리자가 있는지 확인하라. 관련 있어 보이는 게 있으면 load_business_manager로 실제 내용을 불러와라. 관련 있는 게 없으면 그냥 넘어가라.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'load_business_manager',
    description: 'list_business_managers로 확인한 분야별 업무관리자 중 하나를 실제로 불러와서, 그 분야의 절차·체크리스트·판단기준을 이번 답변에 반영한다. name은 list_business_managers 결과에 나온 파일명(확장자 제외 가능)을 그대로 써라.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '불러올 업무관리자 이름 (예: "부동산세무")' }
      },
      required: ['name']
    }
  },
  {
    name: 'audit_business_managers',
    description: '지금 있는 모든 분야별 업무관리자 파일과 마스터 프로필의 전체 내용을 한 번에 불러와서, 서로 모순되거나 겹치는 지침이 없는지 스스로 검토(감사)한다. 사용자가 "관리자들끼리 충돌하는 거 없나 확인해줘", "전체 지침 점검해줘"처럼 요청했을 때 사용하라. 읽기 전용이며 아무것도 수정하지 않는다 — 도구 자체는 원문만 가져오고, 실제 비교·판단은 이 결과를 보고 네가 직접 해서 답변으로 보고하라.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'propose_new_business_manager',
    description: '아직 다뤄지지 않은 세무 분야에 대해 새 업무관리자 초안을 작성해서 "_제안함" 하위폴더에 제안으로 저장한다. 바로 활성화되지 않는다 — 사용자가 검토 후 업무관리자 폴더로 직접 옮겨야 실제로 적용된다. 반복적으로 같은 유형의 질문이 들어오는데 관련 관리자가 없다고 판단될 때, 또는 사용자가 "이 분야 관리자 하나 만들어줘"처럼 요청했을 때 사용하라. content는 다른 업무관리자 파일들과 비슷한 형식(마크다운, 절차·체크리스트)으로 충실하게 작성하라. 저장한 뒤에는 "_제안함 폴더에 초안으로 저장했습니다, 검토 후 옮기시면 활성화됩니다"라고 사용자에게 알려줘라.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '새 업무관리자 이름 (예: "상속증여")' },
        content: { type: 'string', description: '마크다운 형식의 관리자 내용 전체' }
      },
      required: ['name', 'content']
    }
  }
];

/**
 * 문서수정·관계도수정·폴더이동 — 지금까지 <<<EDIT_DOCUMENT>>> 같은 텍스트 마커로 처리하던
 * 세 가지를, 다른 12개 도구와 동일한 방식(tool_use)으로 통일한 것.
 * 문서 편집기/관계도 도구는 지금 화면에 실제로 열려 있을 때만 도구 자체를 제공한다
 * (안 열려 있는데 모델이 이 도구를 호출하는 상황 자체를 원천적으로 막기 위함).
 */
function getClientActionTools_(ctx) {
  const tools = [];
  if (ctx && ctx.openFile && typeof ctx.openFile.liveContent === 'string') {
    tools.push({
      name: 'apply_document_edit',
      description: '지금 편집기에 열려 있는 문서 전체를 새 버전으로 교체하는 수정안을 사용자에게 제시한다. 사용자가 "이 문서 고쳐줘"처럼 명확히 문서 수정을 요청했을 때만 호출하라. 호출해도 즉시 저장되지 않는다 — 사용자가 화면에서 "적용하기" 버튼을 직접 눌러야 실제로 반영된다(되돌리기 어려운 작업이라 반드시 사용자 확인을 거치도록 설계됨). content는 부분 수정이 아니라 문서 전체의 새 내용이어야 한다.',
      input_schema: {
        type: 'object',
        properties: { content: { type: 'string', description: '수정된 문서 전체 내용' } },
        required: ['content']
      }
    });
  }
  if (ctx && ctx.openDiagram) {
    tools.push({
      name: 'apply_diagram_edit',
      description: '지금 화면에 열려 있는 관계도(mermaid) 도구에 새 관계도 초안을 제시한다. 사용자가 가계도·지분관계·거래흐름 등을 그려달라고 요청했을 때만 호출하라. 호출해도 즉시 적용되지 않는다 — 사용자가 "적용하기" 버튼을 눌러야 반영된다. mermaidCode는 "graph TD" 등으로 시작하는 완성된 mermaid 코드 전체여야 한다(이어붙이는 일부가 아니라 전체).',
      input_schema: {
        type: 'object',
        properties: { mermaidCode: { type: 'string', description: 'mermaid 코드 전체' } },
        required: ['mermaidCode']
      }
    });
  }
  tools.push({
    name: 'navigate_to_folder',
    description: '사용자 화면을 다른 고객/사건 폴더로 이동시킨다. 정확한 폴더명을 모르겠으면 먼저 list_drive_folder로 확인하라(사용자가 말한 이름과 정확히 같지 않을 수 있다). 찾는 폴더가 여러 개라 애매하면 이 도구를 부르지 말고 사용자에게 되물어라. 고객 목록 최상위로 이동하려면 path를 빈 배열([])로, "위로"는 지금 위치에서 마지막 한 단계를 뺀 배열로 호출하라. 이동은 즉시 적용된다(문서 수정과 달리 되돌리기 쉬움).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'array', items: { type: 'string' }, description: '최상위부터의 폴더명 배열. 최상위 목록은 빈 배열([]).' } },
      required: ['path']
    }
  });
  return tools;
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (body.action === 'listFolder') {
      return jsonResponse(handleListFolder(body));
    }
    if (body.action === 'readFile') {
      return jsonResponse(handleReadFile(body));
    }
    if (body.action === 'readFileBinary') {
      return jsonResponse(handleReadFileBinary(body));
    }
    if (body.action === 'getNetaxRootPath') {
      return jsonResponse(handleGetNetaxRootPath(body));
    }
    if (body.action === 'uploadFile') {
      return jsonResponse(handleUploadFile(body));
    }
    if (body.action === 'deleteItem') {
      return jsonResponse(handleDeleteItem(body));
    }
    if (body.action === 'renameItem') {
      return jsonResponse(handleRenameItem(body));
    }
    if (body.action === 'createFolder') {
      return jsonResponse(handleCreateFolder(body));
    }
    if (body.action === 'listTrash') {
      return jsonResponse(handleListTrash(body));
    }
    if (body.action === 'restoreItem') {
      return jsonResponse(handleRestoreItem(body));
    }
    if (body.action === 'syncGlobalLog') {
      return jsonResponse(handleSyncGlobalLog(body));
    }
    if (body.action === 'getGlobalLog') {
      return jsonResponse(handleGetGlobalLog(body));
    }
    if (body.action === 'searchFiles') {
      return jsonResponse(handleSearchFiles(body));
    }
    if (body.action === 'listCaseTemplates') {
      return jsonResponse(handleListCaseTemplates(body));
    }
    if (body.action === 'getCaseTemplateContent') {
      return jsonResponse(handleGetCaseTemplateContent(body));
    }
    if (body.action === 'saveCaseFromTemplate') {
      return jsonResponse(handleSaveCaseFromTemplate(body));
    }
    if (body.action === 'searchAddress') {
      return jsonResponse(handleSearchAddress(body));
    }
    if (body.action === 'lookupRealPrice') {
      return jsonResponse(handleLookupRealPrice(body));
    }
    if (body.action === 'lookupOfficialPrice') {
      return jsonResponse(handleLookupOfficialPrice(body));
    }
    if (body.action === 'checkBusinessNumber') {
      return jsonResponse(handleCheckBusinessNumber(body));
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonResponse({ error: '메시지가 비어 있습니다.' });
    }

    let model = body.model;
    if (!MODEL_CONFIG[model]) model = DEFAULT_MODEL;
    const cfg = MODEL_CONFIG[model];

    const effortKey = EFFORT_MAP[body.effort] ? body.effort : DEFAULT_EFFORT;
    const effort = EFFORT_MAP[effortKey];
    effort.key = effortKey;

    let maxTokens = effort.maxTokens;
    const requestedMax = Number(body.maxTokens);
    if (Number.isFinite(requestedMax) && requestedMax > 0) {
      const minAllowed = effort.thinking ? (effort.budgetTokens + 256) : 256;
      maxTokens = Math.max(minAllowed, Math.min(Math.floor(requestedMax), 64000));
    }

    const baseSystemPrompt = (body.systemPrompt && body.systemPrompt.trim())
      ? body.systemPrompt.trim()
      : (DEFAULT_SYSTEM_PROMPT + '\n\n' + getMasterProfileText_());
    const systemPrompt = buildContextSystemPrompt(baseSystemPrompt, body);

    const requestStartTime = Date.now();
    const lastUserMsg = messages[messages.length - 1];
    const requestSummary = (typeof lastUserMsg.content === 'string')
      ? lastUserMsg.content
      : (Array.isArray(lastUserMsg.content) ? lastUserMsg.content.map(function (b) { return b.text || ''; }).join(' ') : '');

    let result;
    if (cfg.provider === 'gemini') {
      const geminiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
      if (!geminiKey) return jsonResponse({ error: 'GEMINI_API_KEY가 스크립트 속성에 설정되어 있지 않습니다.' });
      result = callGemini(body, model, cfg, effort, maxTokens, systemPrompt, geminiKey);
    } else {
      const claudeKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
      if (!claudeKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY가 스크립트 속성에 설정되어 있지 않습니다.' });
      result = callClaude(body, model, cfg, effort, maxTokens, systemPrompt, claudeKey);
    }

    logNxInteraction_({
      model: model,
      requestSummary: requestSummary,
      resultSummary: result.reply || '',
      error: result.error || '',
      loops: result.debugLoops || 0,
      durationMs: Date.now() - requestStartTime,
      timeBudgetExceeded: !!result.timeBudgetExceeded,
      maxLoopsHit: !!result.maxLoopsHit,
      truncationRetries: result.truncationRetries || 0
    });

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: '서버 처리 중 오류: ' + err.message });
  }
}

function buildContextSystemPrompt(basePrompt, body) {
  let extra = '';
  const ctx = body.context || {};

  if (Array.isArray(ctx.currentPath) && ctx.currentPath.length) {
    extra += '\n\n[현재 화면 상태] 사용자는 지금 파일탐색기에서 "' + ctx.currentPath.join(' / ') + '" 위치를 보고 있다.';
  }

  if (ctx.openFile && ctx.openFile.name) {
    extra += '\n현재 편집기/뷰어에 열려 있는 파일: "' + ctx.openFile.name + '" (fileId: ' + ctx.openFile.id + ')';

    if (typeof ctx.openFile.liveContent === 'string') {
      extra += '\n\n[지금 편집기에 실시간으로 열려 있는 문서 내용 — 저장 여부와 무관하게 이게 최신 상태다. read_drive_file로 다시 읽을 필요 없음]\n'
        + '-----\n' + ctx.openFile.liveContent + '\n-----';
      extra += '\n\n[중요] 지금 편집기에 열려 있는 바로 이 문서를 고치거나, 이 문서를 바탕으로 새로 정리해달라는 요청이면 — save_file_to_folder로 조용히 덮어쓰지 말고 반드시 apply_document_edit 도구를 사용하라(도구 설명 참고). save_file_to_folder를 쓰면 사용자가 "편집기에 적용하기" 버튼을 못 받아서 편집기 화면이 갱신 안 된 채로 남는다. 완전히 다른 새 파일을 만드는 경우(지금 열려있는 문서와 무관한 별도 파일)에만 save_file_to_folder를 써라. 문서 수정을 요청한 게 아니라면 둘 다 쓰지 마라.';
    } else if (ctx.openFile.mimeType && (ctx.openFile.mimeType.indexOf('image/') === 0 || ctx.openFile.mimeType === 'application/pdf')) {
      extra += '\n이 파일은 이미지 또는 PDF 뷰어로 열려 있다. 사용자 메시지에 이 파일 자체가 이미지/문서 블록으로 이미 첨부되어 있을 수 있으니, 그 내용을 직접 보고 판단해서 답하라.';
    }
  }

  if (ctx.openDiagram) {
    extra += '\n\n[지금 화면에 관계도(mermaid 문법) 도구가 열려 있다. 현재 내용: ]\n'
      + '-----\n' + (ctx.openDiagram.liveContent || '(비어 있음)') + '\n-----';
    extra += '\n가계도·지분관계·거래흐름 등을 관계도로 그려달라는 요청이면 apply_diagram_edit 도구를 사용하라(도구 설명 참고). 관계도 요청이 아니면 이 도구를 쓰지 마라.';
  }

  // ---- 아래부터는 각 도구 자신의 description에 이미 담겨있는 "언제 어떻게 쓰는지" 설명은
  // 여기서 반복하지 않는다. 여기 남기는 건 도구 하나의 설명만으로는 알기 어려운,
  // 여러 도구·여러 시스템을 넘나드는 판단기준뿐이다. ----

  extra += '\n\n[일정·할일 관련 3가지 시스템 구분] 처리일지(마감일을 입력하면 화면 쪽에서 자동으로 캘린더에 등록됨, AI가 부를 별도 도구 없음) / '
    + 'lookup_calendar_events(캘린더 조회 전용) / lookup_google_tasks·add_google_task(할일 목록, 캘린더와 별개)는 서로 다른 시스템이다. '
    + '"마감일 캘린더에 등록해줘"라고 하면 처리일지에 그 날짜로 적으라고 안내하고, "이번주 일정 뭐 있어?"는 lookup_calendar_events로, '
    + '"할일로 등록해줘"는 add_google_task로 처리하되 서로 혼동하지 마라.';

  extra += '\n\n[부동산·사업자 데이터 조회 시 공통 원칙] 필요한 코드·번호를 확실히 아는 경우에만 조회·계산하고, 모르면 절대 지어내지 말고 사용자에게 물어봐라. '
    + '결과를 답변에 쓸 때는 데이터 출처(국토교통부/건축HUB/국세청)와 기준일자를 명시하라.';

  extra += '\n\n[결과 검증] 여러 단계·여러 도구의 결과를 종합해서 최종 결론을 내기 직전에는, 그 사이에 숫자나 사실관계가 서로 어긋나는 부분이 없는지 한 번 더 스스로 점검하고 나서 답하라.';

  extra += '\n\n[문서 저장 도구의 content 파라미터 — 절대 생략·축약 금지] save_file_to_folder·export_to_google_doc·apply_document_edit·apply_diagram_edit처럼 문서 전체 내용을 담는 도구를 호출할 때는, '
    + '그 내용을 반드시 매번 새로 온전히 다 써서 채워야 한다. 앞서 채팅에서 이미 그 내용을 이야기했더라도 "위 내용과 동일", "(생략)", "앞서 작성한 내용 참고" 같은 식으로 줄이거나 비워두면 절대 안 된다 — '
    + '그 도구는 대화 맥락을 못 보고 오직 이번에 준 내용만 그대로 파일에 저장하므로, 생략하면 빈 파일이 되거나 저장 자체가 실패한다. '
    + '작성할 문서가 매우 길어서 한 번에 다 쓰기 버거우면, 저장 도구부터 섣불리 부르지 말고 먼저 답변으로 개요/목차를 보여준 뒤 저장 여부를 확인받거나, 스스로 판단해서 문서를 절 단위로 나눠 완성한 다음 마지막에 전체를 합쳐 한 번에 저장하라.';

  extra += '\n\n[기억 저장소 구분] 정보를 어디에 남길지는 다음 기준으로 판단하라 — (1) 이번 대화·이번 사건에만 해당하는 내용은 아무 도구도 쓸 필요 없다(대화기록에 자연히 남는다). '
    + '(2) 이번 사건 안에서 여러 단계로 진행 중인 작업의 진행상태는 manage_task_plan에 남긴다. '
    + '(3) 특정 사건과 무관하게 앞으로도 계속 적용돼야 할 사실·지침은 remember_fact로 마스터 프로필에 남긴다. '
    + '헷갈리면 (1)로 취급하라 — 잘못 승격시키는 것보다 그냥 넘어가는 게 안전하다.';

  extra += '\n\n[분야별 업무관리자 우선순위] load_business_manager로 불러온 분야별 지침이 다른 일반 지침과 충돌하면, 그 분야에 한해서는 분야별 지침을 우선하라.';

  extra += '\n\n[총괄관리자 — 시스템 자기점검] audit_business_managers(관리자들끼리 모순·중복 점검) / propose_new_business_manager(새 분야 관리자 초안 제안) 도구가 있다. ' +
    'propose_new_business_manager로 만든 초안은 "_제안함" 폴더에만 저장되고 자동으로 활성화되지 않는다 — 이건 의도된 안전장치이니, 마치 이미 적용된 것처럼 착각하지 말고 사용자에게 검토가 필요하다고 명확히 알려라.';

  extra += '\n\n[화제 전환 처리] 이 대화에 사건·검토 관련 이전 내용이 쌓여 있더라도, 사용자의 새 메시지가 그 내용과 명백히 무관한 별개의 질문(예: 날씨, 간단한 계산, 일반 상식 등)이면 이전 화제(예: "~건 검토를 진행할까요?" 같은 직전 제안)를 다시 꺼내거나 그쪽으로 답을 끌고 가지 마라. 새 질문에만 집중해서 답하고, 답변이 끝난 뒤에도 먼저 이전 화제로 돌아가자고 제안하지 마라 — 사용자가 먼저 그 화제를 다시 꺼내면 그때 이어가라.';

  if (Array.isArray(ctx.attachedTexts) && ctx.attachedTexts.length) {
    ctx.attachedTexts.forEach(function (t) {
      extra += '\n\n[명시적으로 참조 첨부된 내용: "' + t.name + '" — 지금 화면에 있는 그대로이며, 다시 읽을 필요 없음]\n'
        + '-----\n' + (t.text || '(비어 있음)') + '\n-----';
    });
  }

  if (Array.isArray(ctx.attachedItems) && ctx.attachedItems.length) {
    const attachedFiles = ctx.attachedItems.filter(function (a) { return a.type !== 'folder'; });
    const attachedFolders = ctx.attachedItems.filter(function (a) { return a.type === 'folder'; });

    if (attachedFiles.length) {
      const fileList = attachedFiles.map(function (f) { return '"' + f.name + '"(fileId: ' + f.id + ')'; }).join(', ');
      extra += '\n\n[명시적으로 첨부된 파일] 사용자가 채팅에 다음 파일을 직접 첨부했다: ' + fileList
        + '. 자동참조 모드와 무관하게, 이 파일들은 반드시 read_drive_file로 읽고 답변에 활용하라.';
    }
    if (attachedFolders.length) {
      const folderList = attachedFolders.map(function (f) {
        return '"' + f.name + '"(path: [' + (f.path || []).map(function (p) { return '"' + p + '"'; }).join(',') + '])';
      }).join(', ');
      extra += '\n\n[명시적으로 첨부된 폴더] 사용자가 채팅에 다음 폴더를 직접 첨부했다: ' + folderList
        + '. 자동참조 모드와 무관하게, list_drive_folder로 그 폴더의 path를 넣어 먼저 목록을 확인하고, 질문에 답하는 데 필요해 보이는 파일들을 read_drive_file로 이어서 읽어라. 폴더 안 파일이 많으면 전부 다 읽지 말고 관련성 높은 것부터 판단해서 골라 읽어라.';
    }
  }

  if (body.autoRef) {
    extra += '\n\n[자동참조 모드: ON] list_drive_folder / read_drive_file 도구가 있다. 답변에 필요하다고 판단되면 사용자에게 묻지 않고 알아서 그 도구로 폴더나 파일을 확인한 뒤 답하라. 관련 없어 보이는 질문(잡담 등)에는 굳이 도구를 쓰지 마라. '
      + '단, 이름이 "_"로 시작하는 폴더(자동참조 제외 폴더 — list_drive_folder 결과에 "자동참조제외": true로 표시됨)는 자동참조 모드라도 스스로 판단해서 그 안으로 들어가 보지 마라. 사용자가 그 폴더를 이름으로 콕 집어 요청했거나 채팅에 명시적으로 첨부한 경우에만 확인하라.';
  } else {
    extra += '\n\n[자동참조 모드: OFF] 위에서 명시적으로 첨부된 파일/폴더/텍스트가 없는 한, list_drive_folder / read_drive_file 도구는 사용자가 "이 파일 참고해서", "이거 봐줘"처럼 말로 요청했을 때만 사용하라. 그런 요청이 없으면 도구를 쓰지 말고 아는 선에서 답하라.';
  }

  return (basePrompt || DEFAULT_SYSTEM_PROMPT) + extra;
}

/**
 * 스크립트 속성에 폴더/파일 ID를 넣을 때, 구글드라이브 "링크 복사"로 얻은 전체 주소를
 * 그대로 붙여넣어서 끝에 "?usp=drive_link" 같은 꼬리표가 같이 들어가는 실수가 흔하다
 * (실제로 이 문제 때문에 업무관리자 폴더 연결이 계속 조용히 실패하고 있었다 — DriveApp.
 * getFolderById()는 순수 ID만 받아들이고, 꼬리표가 붙어 있으면 그냥 오류를 내며 null로
 * 처리돼버려서 겉으로는 "설정 안 한 것"과 똑같아 보였다). 전체 링크가 들어와도, 순수 ID만
 * 들어와도 항상 깨끗한 ID 하나만 뽑아내서 이런 실수를 자동으로 허용한다.
 */
function sanitizeDriveId_(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return s.split('?')[0].split('#')[0].split('/')[0].trim();
}

function getDefaultFolder() {
  const defId = sanitizeDriveId_(PropertiesService.getScriptProperties().getProperty(DEFAULT_FOLDER_ID_PROPERTY));
  if (defId) {
    try {
      return DriveApp.getFolderById(defId);
    } catch (err) {
    }
  }
  return DriveApp.getRootFolder();
}

function getPathFromRoot(folder) {
  const rootId = DriveApp.getRootFolder().getId();
  const names = [];
  let current = folder;
  let guard = 0;
  while (current.getId() !== rootId && guard < 50) {
    names.unshift(current.getName());
    const parents = current.getParents();
    if (!parents.hasNext()) break;
    current = parents.next();
    guard++;
  }
  return names;
}

function handleListFolder(body) {
  let folder;
  let pathArr;

  if (body.path === undefined || body.path === null) {
    folder = getDefaultFolder();
    pathArr = getPathFromRoot(folder);
  } else {
    folder = DriveApp.getRootFolder();
    pathArr = Array.isArray(body.path) ? body.path.map(String) : [];
    for (let i = 0; i < pathArr.length; i++) {
      const name = pathArr[i];
      const subIter = folder.getFoldersByName(name);
      if (!subIter.hasNext()) {
        return { error: '폴더를 찾을 수 없습니다: ' + pathArr.slice(0, i + 1).join(' / ') };
      }
      folder = subIter.next();
    }
  }

  const folders = [];
  const folderIter = folder.getFolders();
  while (folderIter.hasNext()) {
    const f = folderIter.next();
    folders.push({ id: f.getId(), name: f.getName(), type: 'folder' });
  }
  folders.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });

  const files = [];
  const fileIter = folder.getFiles();
  while (fileIter.hasNext()) {
    const f = fileIter.next();
    files.push({
      id: f.getId(),
      name: f.getName(),
      type: 'file',
      mimeType: f.getMimeType(),
      modifiedDate: Utilities.formatDate(f.getLastUpdated(), 'Asia/Seoul', 'yyyy.MM.dd HH:mm:ss'),
      sizeBytes: f.getSize(),
      url: f.getUrl()
    });
  }
  files.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });

  return { path: pathArr, folderId: folder.getId(), folders: folders, files: files };
}

function resolveFolderByPath(pathArr) {
  let folder = DriveApp.getRootFolder();
  const arr = Array.isArray(pathArr) ? pathArr.map(String) : [];
  for (let i = 0; i < arr.length; i++) {
    const subIter = folder.getFoldersByName(arr[i]);
    if (!subIter.hasNext()) {
      throw new Error('폴더를 찾을 수 없습니다: ' + arr.slice(0, i + 1).join(' / '));
    }
    folder = subIter.next();
  }
  return folder;
}

/**
 * resolveFolderByPath와 같지만, 경로 중간에 없는 폴더가 있으면 오류 대신 그 자리에서 만들고
 * 계속 내려간다. 사건개시(새 고객 폴더를 그 자리에서 바로 만들어야 하는 상황)처럼, 없으면
 * 실패가 아니라 "새로 만들어서라도 성공"해야 하는 경우에 쓴다.
 */
function resolveOrCreateFolderByPath_(pathArr) {
  let folder = DriveApp.getRootFolder();
  const arr = Array.isArray(pathArr) ? pathArr.map(String) : [];
  for (let i = 0; i < arr.length; i++) {
    const name = arr[i];
    const subIter = folder.getFoldersByName(name);
    folder = subIter.hasNext() ? subIter.next() : folder.createFolder(name);
  }
  return folder;
}

// 폴더명이 이 문자로 시작하면 "자동참조 제외 폴더"로 취급한다(2026.07 추가) — 세무사님이 폴더
// 이름 앞에 "_"만 붙이면(예: "_백업"), 자동참조 모드가 켜져 있어도 AI가 스스로 판단해서 그
// 폴더 안까지 들어가 뒤지지는 않는다. 사용자가 그 폴더를 이름으로 콕 집어 요청하거나 채팅에
// 명시적으로 첨부한 경우에는 여전히 정상적으로 확인할 수 있다(도구 자체가 막는 게 아니라,
// 아래에서 표시만 붙이고 실제 "들어가지 않기"는 도구 설명·시스템프롬프트의 지침이 담당한다).
const AUTO_REF_EXCLUDE_PREFIX = '_';

function toolListDriveFolder(pathArr) {
  const result = (pathArr === undefined || pathArr === null)
    ? handleListFolder({})
    : handleListFolder({ path: pathArr });

  if (result && Array.isArray(result.folders)) {
    result.folders.forEach(function (f) {
      if (f.name && f.name.indexOf(AUTO_REF_EXCLUDE_PREFIX) === 0) {
        f.자동참조제외 = true;
      }
    });
  }
  return result;
}

/**
 * AI가 실제로 파일을 만들어 저장할 때 쓰는 도구. resolveFolderByPath로 폴더를 찾고,
 * 같은 이름의 파일이 이미 있으면 내용만 덮어쓰고(setContent), 없으면 새로 만든다.
 * 동시에 여러 저장이 겹치는 경우를 대비해 withLock_으로 감싼다(다른 저장 액션들과 동일 패턴).
 */
function toolSaveFileToFolder(pathArr, name, content) {
  if (!name || !String(name).trim()) return { error: '파일 이름이 없습니다.' };
  if (content === undefined || content === null) return { error: '저장할 내용이 없습니다.' };

  let folder;
  try {
    folder = resolveFolderByPath(Array.isArray(pathArr) ? pathArr : []);
  } catch (err) {
    return { error: err.message };
  }

  return withLock_(8000, function () {
    try {
      const fileName = String(name).trim();
      const mimeType = /\.md$/i.test(fileName) ? 'text/markdown' : 'text/plain';
      const existingIter = folder.getFilesByName(fileName);
      let file, updated;
      if (existingIter.hasNext()) {
        file = existingIter.next();
        file.setContent(String(content));
        updated = true;
      } else {
        file = folder.createFile(Utilities.newBlob(String(content), mimeType, fileName));
        updated = false;
      }
      return { id: file.getId(), name: file.getName(), url: file.getUrl(), updated: updated, folderPath: pathArr || [] };
    } catch (err) {
      return { error: '파일 저장 중 오류: ' + err.message };
    }
  });
}

/**
 * 마크다운을 실제 구글독스로 변환한다. DocumentApp은 별도 고급서비스 활성화 없이
 * 기본 내장돼 있어서 바로 쓸 수 있다. **굵게**만 실제 볼드 서식으로 바꾸고,
 * #/##/###는 제목 스타일로, -/* 로 시작하는 줄은 글머리표 목록으로 바꾼다.
 */
function toolExportToGoogleDoc(pathArr, title, content) {
  if (!title || !String(title).trim()) return { error: '문서 제목이 없습니다.' };
  if (!content) return { error: '내용이 없습니다.' };

  let folder;
  try {
    folder = resolveFolderByPath(Array.isArray(pathArr) ? pathArr : []);
  } catch (err) {
    return { error: err.message };
  }

  function appendInlineBold(para, text) {
    const boldRegex = /\*\*(.+?)\*\*/g;
    let plain = '';
    const ranges = [];
    let lastIndex = 0, match;
    while ((match = boldRegex.exec(text)) !== null) {
      plain += text.slice(lastIndex, match.index);
      const start = plain.length;
      plain += match[1];
      ranges.push([start, plain.length]);
      lastIndex = match.index + match[0].length;
    }
    plain += text.slice(lastIndex);
    para.setText(plain);
    if (plain.length) {
      ranges.forEach(function (r) {
        if (r[1] > r[0]) para.editAsText().setBold(r[0], r[1] - 1, true);
      });
    }
    return para;
  }

  return withLock_(15000, function () {
    let doc;
    try {
      doc = DocumentApp.create(String(title).trim());
      const body = doc.getBody();
      body.clear();

      String(content).split('\n').forEach(function (line) {
        if (/^### /.test(line)) {
          appendInlineBold(body.appendParagraph(''), line.replace(/^### /, '')).setHeading(DocumentApp.ParagraphHeading.HEADING3);
        } else if (/^## /.test(line)) {
          appendInlineBold(body.appendParagraph(''), line.replace(/^## /, '')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        } else if (/^# /.test(line)) {
          appendInlineBold(body.appendParagraph(''), line.replace(/^# /, '')).setHeading(DocumentApp.ParagraphHeading.HEADING1);
        } else if (/^[-*] /.test(line)) {
          appendInlineBold(body.appendListItem(''), line.replace(/^[-*] /, '')).setGlyphType(DocumentApp.GlyphType.BULLET);
        } else if (line.trim() === '') {
          body.appendParagraph('');
        } else {
          appendInlineBold(body.appendParagraph(''), line);
        }
      });

      doc.saveAndClose();
      const file = DriveApp.getFileById(doc.getId());
      file.moveTo(folder);
      return { id: doc.getId(), name: file.getName(), url: doc.getUrl() };
    } catch (err) {
      return { error: '구글독스 변환 중 오류: ' + err.message };
    }
  });
}

/**
 * 이메일 발송. MailApp도 DocumentApp처럼 기본 내장 서비스라 별도 활성화가 필요 없다.
 * 발신자는 항상 이 스크립트를 소유한 구글계정(조종호님 본인)이 된다.
 * 일반 계정은 하루 발송량 제한(보통 100통/일)이 있으니 대량 발송 용도로는 안 맞는다.
 */
function toolSendEmail(to, subject, body) {
  if (!to || !String(to).trim()) return { error: '받는 사람 주소가 없습니다.' };
  if (!subject) return { error: '제목이 없습니다.' };
  if (!body) return { error: '본문이 없습니다.' };
  try {
    MailApp.sendEmail({ to: String(to).trim(), subject: String(subject), body: String(body) });
    return { success: true, to: to, subject: subject };
  } catch (err) {
    return { error: '이메일 발송 중 오류: ' + err.message };
  }
}

/**
 * 국가법령정보센터(law.go.kr) Open API로 조문 원문을 실시간 조회한다.
 * 1단계: lawSearch.do(target=eflaw)로 법령명을 검색해서 법령일련번호(MST)·시행일자(efYd)를 찾는다.
 * 2단계: lawService.do(target=eflaw)에 MST·efYd·JO(조번호)를 넣어 그 조문 원문만 가져온다.
 *   JO는 "조번호 4자리 + 조가지번호 2자리"인 6자리 숫자다(예: 45조 → 004500, 10조의2 → 001002).
 * OC(인증키)는 스크립트 속성 LAW_OC에 저장해둔 값을 쓴다.
 */
function toolLookupStatuteArticle(lawName, articleNo) {
  if (!lawName || !String(lawName).trim()) return { error: '법령명이 없습니다.' };

  const ocKey = PropertiesService.getScriptProperties().getProperty('LAW_OC');
  if (!ocKey) return { error: 'LAW_OC(국가법령정보센터 인증키)가 스크립트 속성에 설정되어 있지 않습니다.' };

  // 1단계: 법령명 검색
  let mst, efYd, matchedName;
  try {
    const searchUrl = 'https://www.law.go.kr/DRF/lawSearch.do?OC=' + encodeURIComponent(ocKey)
      + '&target=eflaw&type=XML&query=' + encodeURIComponent(String(lawName).trim());
    const res = UrlFetchApp.fetch(searchUrl, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { error: '법령 검색 API 호출 실패 (status ' + res.getResponseCode() + ')' };
    }
    const doc = XmlService.parse(res.getContentText('UTF-8'));
    const root = doc.getRootElement();
    const laws = root.getChildren('law');
    if (!laws.length) {
      return { error: '"' + lawName + '"으로 검색된 법령이 없습니다. 정확한 법령명(정식 명칭)인지 확인해주세요.' };
    }
    const first = laws[0]; // 첫 검색결과(보통 가장 정확히 일치하는 현행법령)를 사용
    mst = first.getChildText('법령일련번호');
    efYd = first.getChildText('시행일자');
    matchedName = first.getChildText('법령명한글');
  } catch (err) {
    return { error: '법령 검색 중 오류: ' + err.message };
  }

  // 조번호를 "4자리+2자리" 6자리 코드로 변환 (예: "45" → 004500, "10조의2" → 001002)
  let jo = null;
  if (articleNo) {
    const m = String(articleNo).match(/(\d+)\s*(?:조)?\s*(?:의\s*(\d+))?/);
    if (m) {
      const num = ('0000' + m[1]).slice(-4);
      const sub = ('00' + (m[2] || '0')).slice(-2);
      jo = num + sub;
    }
  }

  // 2단계: 조문 본문 조회
  try {
    let bodyUrl = 'https://www.law.go.kr/DRF/lawService.do?OC=' + encodeURIComponent(ocKey)
      + '&target=eflaw&MST=' + encodeURIComponent(mst) + '&efYd=' + encodeURIComponent(efYd) + '&type=XML';
    if (jo) bodyUrl += '&JO=' + jo;

    const res2 = UrlFetchApp.fetch(bodyUrl, { muteHttpExceptions: true });
    if (res2.getResponseCode() !== 200) {
      return { error: '조문 조회 API 호출 실패 (status ' + res2.getResponseCode() + ')' };
    }
    const doc2 = XmlService.parse(res2.getContentText('UTF-8'));
    const root2 = doc2.getRootElement();
    const joMok = root2.getChild('조문');
    const articleUnits = joMok ? joMok.getChildren('조문단위') : [];

    if (!articleUnits.length) {
      return { error: '해당 조문을 찾을 수 없습니다(법령명 또는 조번호를 다시 확인해주세요).', 법령명: matchedName };
    }

    const items = articleUnits.map(function (unit) {
      const hangList = unit.getChildren('항').map(function (hang) {
        const hoList = hang.getChildren('호').map(function (ho) {
          return (ho.getChildText('호내용') || '').trim();
        });
        return { 항내용: (hang.getChildText('항내용') || '').trim(), 호: hoList };
      });
      return {
        조문번호: unit.getChildText('조문번호'),
        조문제목: unit.getChildText('조문제목'),
        조문내용: (unit.getChildText('조문내용') || '').trim(),
        항: hangList
      };
    });

    return {
      법령명: matchedName,
      시행일자: efYd,
      조문: items,
      원문링크: 'https://www.law.go.kr/DRF/lawService.do?OC=' + ocKey + '&target=eflaw&MST=' + mst
        + '&efYd=' + efYd + (jo ? '&JO=' + jo : '') + '&type=HTML'
    };
  } catch (err) {
    return { error: '조문 조회 중 오류: ' + err.message };
  }
}

/**
 * rpt.netax.kr(고객 열람 시스템)과 admin.netax.kr(관리자 페이지)은 같은 GAS 백엔드를 공유한다.
 * admin.netax.kr이 "새 보고서 등록" 폼에서 실제로 호출하는 것과 완전히 동일한 API를
 * 여기서도 그대로 호출해서 등록한다(action: 'create_report'). admin_code는 그 백엔드의
 * 관리자 비밀번호이고, RPT_API_URL은 그 백엔드의 웹앱 URL이다 — 둘 다 스크립트 속성에서 읽는다.
 */

/**
 * 구글 드라이브/독스 링크에서 파일 ID만 뽑아낸다.
 * 지원 형태: .../d/<ID>/..., ?id=<ID>, /file/d/<ID>
 */
function extractDriveFileId_(url) {
  if (!url) return null;
  const m1 = String(url).match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m1) return m1[1];
  const m2 = String(url).match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m2) return m2[1];
  return null;
}

/**
 * save_file_to_folder·export_to_google_doc으로 만든 파일은 기본적으로 소유자(조종호님)만
 * 볼 수 있는 비공개 상태다. rpt.netax.kr은 그 파일을 iframe으로 그대로 열어서 고객에게
 * 보여주는 구조라, 링크만 등록해봐야 고객 쪽에서는 "권한이 없습니다" 화면만 보게 된다.
 * 그래서 등록 직전에 자동으로 "링크가 있는 모든 사용자 · 보기 가능"으로 공유설정을 바꿔준다.
 * (이미 그렇게 공유돼 있어도 다시 걸어도 문제없음 — 멱등)
 */
function ensureLinkShareable_(url) {
  const fileId = extractDriveFileId_(url);
  if (!fileId) return { warning: '링크에서 파일 ID를 알아내지 못해 공유설정을 자동으로 바꾸지 못했습니다. 직접 "링크가 있는 모든 사용자"로 공유설정을 확인해주세요.' };
  try {
    DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { shared: true };
  } catch (err) {
    return { warning: '공유설정을 자동으로 바꾸는 중 오류(' + err.message + ') — 직접 "링크가 있는 모든 사용자"로 공유설정을 확인해주세요.' };
  }
}

function toolRegisterReportToRpt(customerName, title, docType, link, permission) {
  if (!customerName || !String(customerName).trim()) return { error: '고객명이 없습니다.' };
  if (!link || !String(link).trim()) return { error: '등록할 파일 링크가 없습니다.' };

  const props = PropertiesService.getScriptProperties();
  const adminCode = props.getProperty('RPT_ADMIN_CODE');
  const apiUrl = props.getProperty('RPT_API_URL') || 'https://script.google.com/macros/s/AKfycbyg0gDbzPPkpZs2Gnsuw7Qh_qszYy1_8f2Q-SN7Ffreoc3GfHzIZ7B5UXNidT5ale_b/exec';
  if (!adminCode) return { error: 'RPT_ADMIN_CODE(rpt.netax.kr 관리자 비밀번호)가 스크립트 속성에 설정되어 있지 않습니다.' };

  // 등록 전에 먼저 "링크가 있는 모든 사용자·보기"로 공유설정을 걸어둔다 — 이걸 안 하면
  // 열람번호는 발급돼도 고객이 실제로 그 파일을 못 여는 상황이 생긴다.
  const shareResult = ensureLinkShareable_(link);

  try {
    const res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'create_report',
        admin_code: adminCode,
        name: String(customerName).trim(),
        title: title || '',
        type: docType || '',
        link: String(link).trim(),
        permission: permission || '허용'
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      return { error: 'rpt.netax.kr 등록 API 호출 실패 (status ' + res.getResponseCode() + ')' };
    }
    const data = JSON.parse(res.getContentText('UTF-8'));
    if (!data.success) {
      return { error: data.message || '등록에 실패했습니다.' };
    }
    return {
      success: true,
      report_id: data.report_id,
      고객명: data.name,
      열람링크: 'https://rpt.netax.kr/?report_id=' + data.report_id,
      공유설정: shareResult.shared ? '링크가 있는 모든 사용자·보기로 자동 설정됨' : (shareResult.warning || '')
    };
  } catch (err) {
    return { error: 'rpt.netax.kr 등록 중 오류: ' + err.message };
  }
}

const OFFICE_MIME_TO_GOOGLE = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/msword': 'application/vnd.google-apps.document',
  'application/rtf': 'application/vnd.google-apps.document',
  'text/rtf': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
  'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation'
};

function handleReadFile(body) {
  const fileId = body.fileId;
  if (!fileId) return { error: 'fileId가 없습니다.' };

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return { error: '파일을 찾을 수 없습니다: ' + err.message };
  }

  const mimeType = file.getMimeType();
  const lowerName = (file.getName() || '').toLowerCase();

  if (lowerName.endsWith('.hwp') || lowerName.endsWith('.hwpx') || mimeType.indexOf('hwp') !== -1) {
    return {
      error: '한글(HWP/HWPX) 파일은 구글이 자체 변환을 지원하지 않아 읽을 수 없습니다. ' +
        '한글 프로그램이나 뷰어에서 "다른 이름으로 저장 → PDF"로 변환한 뒤 그 PDF를 다시 올려주세요.'
    };
  }

  try {
    if (mimeType === MimeType.GOOGLE_DOCS) {
      return { name: file.getName(), mimeType: mimeType, content: exportGoogleDocText(fileId), kind: 'text' };
    }
    if (mimeType === MimeType.GOOGLE_SHEETS) {
      return { name: file.getName(), mimeType: mimeType, content: extractSpreadsheetText(fileId), kind: 'text' };
    }
    if (mimeType === MimeType.GOOGLE_SLIDES) {
      return { name: file.getName(), mimeType: mimeType, content: extractSlidesText(fileId), kind: 'text' };
    }

    if (mimeType.indexOf('image/') === 0 || mimeType === 'application/pdf') {
      const MAX_BINARY_FILE_BYTES = 15 * 1024 * 1024; // 15MB — 이보다 크면 URLFetch 전송한도(약 50MB)에 걸릴 위험이 있음
      const sizeBytes = file.getSize();
      if (sizeBytes > MAX_BINARY_FILE_BYTES) {
        return {
          error: '파일이 너무 큽니다(' + (sizeBytes / 1024 / 1024).toFixed(1) + 'MB, 제한 15MB). '
            + 'PDF라면 스캔 해상도를 낮추거나 페이지를 나눠서, 또는 구글드라이브의 PDF 압축 기능으로 줄인 뒤 다시 시도해주세요.'
        };
      }
      const bytes = file.getBlob().getBytes();
      const base64 = Utilities.base64Encode(bytes);
      return { name: file.getName(), mimeType: mimeType, base64: base64, kind: 'binary' };
    }

    if (OFFICE_MIME_TO_GOOGLE[mimeType]) {
      const officeText = convertAndExtractOfficeFile(fileId, mimeType);
      return { name: file.getName(), mimeType: mimeType, content: officeText, kind: 'text' };
    }

    const content = file.getBlob().getDataAsString('UTF-8');
    return { name: file.getName(), mimeType: mimeType, content: content, kind: 'text' };
  } catch (err) {
    return { error: '파일 내용을 읽는 중 오류: ' + err.message };
  }
}

/**
 * handleReadFile과 별개로, "원본 바이너리를 있는 그대로" 돌려주는 전용 액션.
 * [패치 2026.07 추가] NX 작업실의 엑셀뷰어(SheetJS)가 탐색창에서 xlsx/xls/csv 파일을 열 때
 * 이 액션을 쓴다. handleReadFile은 AI(read_drive_file)가 엑셀 내용을 "이해"하도록 텍스트로
 * 변환해서 주는 게 목적이라 base64를 안 준다(그래서 엑셀뷰어가 base64를 못 받아 실패했었다) —
 * 그 동작은 그대로 두고, 원본 그대로가 필요한 화면 기능을 위해 이 액션을 새로 분리했다.
 * 구글시트 네이티브 문서는 애초에 원본 바이너리가 없으므로(구글 자체 포맷) 지원하지 않는다.
 */
function handleReadFileBinary(body) {
  const fileId = body.fileId;
  if (!fileId) return { error: 'fileId가 없습니다.' };

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return { error: '파일을 찾을 수 없습니다: ' + err.message };
  }

  const mimeType = file.getMimeType();
  if (mimeType === MimeType.GOOGLE_SHEETS || mimeType === MimeType.GOOGLE_DOCS || mimeType === MimeType.GOOGLE_SLIDES) {
    return { error: '구글 네이티브 문서(구글시트/문서/슬라이드)는 원본 바이너리가 없어 이 방식으로 열 수 없습니다.' };
  }

  const MAX_BINARY_FILE_BYTES = 15 * 1024 * 1024; // 15MB — handleReadFile의 이미지/PDF 제한과 동일 기준
  try {
    const sizeBytes = file.getSize();
    if (sizeBytes > MAX_BINARY_FILE_BYTES) {
      return { error: '파일이 너무 큽니다(' + (sizeBytes / 1024 / 1024).toFixed(1) + 'MB, 제한 15MB).' };
    }
    const bytes = file.getBlob().getBytes();
    const base64 = Utilities.base64Encode(bytes);
    return { name: file.getName(), mimeType: mimeType, base64: base64 };
  } catch (err) {
    return { error: '파일 내용을 읽는 중 오류: ' + err.message };
  }
}

function exportGoogleDocText(docFileId) {
  const url = 'https://docs.google.com/document/d/' + docFileId + '/export?format=txt';
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('구글 문서 내보내기 실패 (status ' + res.getResponseCode() + ')');
  return res.getContentText('UTF-8');
}

function extractSpreadsheetText(sheetFileId) {
  const ROW_PREVIEW_LIMIT = 50; // 이 줄 수까지만 미리보기로 텍스트에 포함
  const ROW_WARNING_THRESHOLD = 500; // 이보다 많으면 "전체 안 읽었다"고 명시적으로 경고
  const ss = SpreadsheetApp.openById(sheetFileId);
  let out = '';
  ss.getSheets().forEach(function (sheet) {
    out += '[시트: ' + sheet.getName() + ']\n';
    const totalRows = sheet.getLastRow();
    const isHuge = totalRows > ROW_WARNING_THRESHOLD;
    const range = isHuge
      ? sheet.getRange(1, 1, Math.min(totalRows, ROW_PREVIEW_LIMIT), Math.max(1, sheet.getLastColumn()))
      : sheet.getDataRange();
    const values = range.getValues();
    const formulas = range.getFormulas(); // 값과 같은 크기의 배열 — 수식 없는 셀은 빈 문자열
    values.forEach(function (row, r) {
      out += row.map(function (c, colIdx) {
        const val = (c === '' || c === null || c === undefined) ? '' : String(c);
        const formula = formulas[r][colIdx];
        // 수식이 있는 셀만 "값 (=수식)" 형태로 — 수식 없는 일반 값은 예전처럼 값만 표시
        return (formula && formula.trim()) ? (val + ' (' + formula + ')') : val;
      }).join('\t') + '\n';
    });
    if (isHuge) {
      out += '\n⚠️ 이 시트는 총 ' + totalRows + '행입니다 — 위 내용은 앞부분 ' + ROW_PREVIEW_LIMIT + '행만 보여주는 미리보기이며, '
        + '전체를 다 읽은 게 아닙니다. 합계·집계·전수 검토가 필요하면 이 미리보기만 보고 판단하지 말고, '
        + '반드시 code_execution 도구로 이 파일을 직접 열어서 전체 데이터를 계산하라.\n';
    }
    out += '\n';
  });
  return out || '(빈 스프레드시트)';
}

function extractSlidesText(slidesFileId) {
  const pres = SlidesApp.openById(slidesFileId);
  let out = '';
  pres.getSlides().forEach(function (slide, idx) {
    out += '[슬라이드 ' + (idx + 1) + ']\n';
    slide.getShapes().forEach(function (shape) {
      try {
        if (shape.getText) {
          const t = shape.getText().asString().trim();
          if (t) out += t + '\n';
        }
      } catch (e2) { }
    });
    out += '\n';
  });
  return out || '(빈 프레젠테이션)';
}

function convertAndExtractOfficeFile(fileId, mimeType) {
  const targetMime = OFFICE_MIME_TO_GOOGLE[mimeType];
  if (!targetMime) return null;

  let tempFileId = null;
  try {
    const copied = Drive.Files.copy({ mimeType: targetMime, name: 'nx_temp_convert_' + Date.now() }, fileId);
    tempFileId = copied.id;

    if (targetMime === 'application/vnd.google-apps.document') return exportGoogleDocText(tempFileId);
    if (targetMime === 'application/vnd.google-apps.spreadsheet') return extractSpreadsheetText(tempFileId);
    if (targetMime === 'application/vnd.google-apps.presentation') return extractSlidesText(tempFileId);
    return null;
  } catch (err) {
    throw new Error('MS오피스 파일 변환 중 오류 — "Drive API" 고급서비스가 켜져 있는지 확인하세요 (왼쪽 서비스 옆 + 클릭): ' + err.message);
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch (e3) { }
    }
  }
}

/**
 * 같은 파일(fileId)을 여러 기기·탭에서 거의 동시에 저장할 때 뒤에 쓰는 쪽이
 * 앞선 내용을 통째로 덮어써버리는 문제(레이스컨디션)를 막기 위한 잠금 헬퍼.
 * 최대 waitMs만큼 대기하다가 잠금을 못 얻으면 { error: ... } 를 돌려주고,
 * 잠그는 데 성공하면 fn()을 실행한 뒤 반드시 잠금을 해제한다.
 */
function withLock_(waitMs, fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(waitMs || 8000);
  } catch (err) {
    return { error: '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function handleUploadFile(body) {
  if (!body.name) return { error: '파일명이 없습니다.' };
  if (!body.base64Data) return { error: '업로드할 파일 내용이 없습니다.' };

  if (body.fileId) {
    return withLock_(8000, function () {
      try {
        const file = DriveApp.getFileById(body.fileId);
        const bytes = Utilities.base64Decode(body.base64Data);
        const text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
        file.setContent(text);
        return { id: file.getId(), name: file.getName(), url: file.getUrl(), updated: true };
      } catch (err) {
        return { error: '파일 갱신 중 오류: ' + err.message };
      }
    });
  }

  let folder;
  try {
    folder = resolveFolderByPath(body.path);
  } catch (err) {
    return { error: err.message };
  }

  try {
    const mimeType = body.mimeType || 'application/octet-stream';
    const bytes = Utilities.base64Decode(body.base64Data);
    const blob = Utilities.newBlob(bytes, mimeType, body.name);
    const file = folder.createFile(blob);
    return { id: file.getId(), name: file.getName(), url: file.getUrl() };
  } catch (err) {
    return { error: '파일 업로드 중 오류: ' + err.message };
  }
}

function handleDeleteItem(body) {
  if (!body.id) return { error: 'id가 없습니다.' };
  return withLock_(8000, function () {
    try {
      if (body.type === 'folder') {
        DriveApp.getFolderById(body.id).setTrashed(true);
      } else {
        DriveApp.getFileById(body.id).setTrashed(true);
      }
      return { success: true };
    } catch (err) {
      return { error: '삭제 중 오류: ' + err.message };
    }
  });
}

function handleRenameItem(body) {
  if (!body.id || !body.newName) return { error: 'id 또는 새 이름이 없습니다.' };
  return withLock_(8000, function () {
    try {
      if (body.type === 'folder') {
        DriveApp.getFolderById(body.id).setName(body.newName);
      } else {
        DriveApp.getFileById(body.id).setName(body.newName);
      }
      return { success: true };
    } catch (err) {
      return { error: '이름 변경 중 오류: ' + err.message };
    }
  });
}

function handleCreateFolder(body) {
  if (!body.name || !body.name.trim()) return { error: '폴더 이름이 없습니다.' };
  return withLock_(8000, function () {
    let parentFolder;
    try {
      parentFolder = resolveFolderByPath(body.path);
    } catch (err) {
      return { error: err.message };
    }
    try {
      const newFolder = parentFolder.createFolder(body.name.trim());
      return { id: newFolder.getId(), name: newFolder.getName() };
    } catch (err) {
      return { error: '폴더 만들기 중 오류: ' + err.message };
    }
  });
}

/**
 * 휴지통 복원 기능. 지정한 폴더(path) 바로 아래에 있는, 휴지통으로 이동된
 * 파일·폴더 목록을 보여준다. Drive 고급서비스(Drive API)의 파일 목록 쿼리를 사용한다
 * (이미 MS오피스 읽기 기능 때문에 켜져 있어야 하는 서비스와 동일).
 */
function handleListTrash(body) {
  let folder;
  try {
    folder = (body.path === undefined || body.path === null) ? getDefaultFolder() : resolveFolderByPath(body.path);
  } catch (err) {
    return { error: err.message };
  }
  try {
    const folderId = folder.getId();
    const res = Drive.Files.list({
      q: "'" + folderId + "' in parents and trashed = true",
      fields: 'files(id,name,mimeType,trashedTime)',
      pageSize: 50,
      orderBy: 'trashed desc'
    });
    const items = (res.files || []).map(function (f) {
      return {
        id: f.id,
        name: f.name,
        type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
        trashedTime: f.trashedTime || null
      };
    });
    return { items: items };
  } catch (err) {
    return { error: '휴지통 목록 조회 중 오류(Drive API 고급서비스가 켜져 있는지 확인하세요): ' + err.message };
  }
}

function handleRestoreItem(body) {
  if (!body.id) return { error: 'id가 없습니다.' };
  return withLock_(8000, function () {
    try {
      if (body.type === 'folder') {
        DriveApp.getFolderById(body.id).setTrashed(false);
      } else {
        DriveApp.getFileById(body.id).setTrashed(false);
      }
      return { success: true };
    } catch (err) {
      return { error: '복원 중 오류: ' + err.message };
    }
  });
}

const GLOBAL_LOG_INDEX_NAME = '_NX_전체일지.json';

/**
 * 폴더별 처리일지(경과지)를 한 곳에 모아두는 인덱스 파일을 가져오거나 새로 만든다.
 * 기본 작업 폴더(getDefaultFolder) 바로 아래에 둔다 — 특정 사건 폴더에 섞이지 않도록.
 */
function getOrCreateGlobalLogFile_() {
  const parent = getDefaultFolder();
  const iter = parent.getFilesByName(GLOBAL_LOG_INDEX_NAME);
  if (iter.hasNext()) return iter.next();
  return parent.createFile(Utilities.newBlob('[]', 'application/json', GLOBAL_LOG_INDEX_NAME));
}

function readGlobalLogEntries_() {
  try {
    const file = getOrCreateGlobalLogFile_();
    const text = file.getBlob().getDataAsString('UTF-8');
    const arr = JSON.parse(text || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

/**
 * 특정 폴더(path)의 처리일지 항목들을 전체일지 인덱스에 반영한다.
 * 그 폴더의 기존 항목은 전부 지우고(경과지.json은 매번 전체를 다시 써서 저장하는 방식이므로)
 * 방금 넘어온 entries로 통째로 교체한다 — 개별 항목 diff 없이 폴더 단위로 동기화.
 * entries 각 항목: { id, date, text, dueDate? }
 */
/**
 * 이 폴더(pathKey)의 마감일 있는 처리일지 항목들을 구글캘린더 일정으로 반영한다.
 * CalendarApp도 기본 내장 서비스라 별도 활성화가 필요 없다(스크립트 소유자=조종호님의
 * 기본 캘린더에 등록됨). 매번 "이 폴더 태그가 붙은 기존 일정을 전부 지우고 지금 목록으로
 * 다시 만드는" 방식이라 — 항목을 지우거나 날짜를 바꿔도 캘린더가 항상 정확히 따라온다.
 * 캘린더 권한 문제 등으로 실패해도 처리일지 저장 자체에는 영향 주지 않도록 조용히 무시한다.
 */
function syncCalendarForPath_(pathKey, entries) {
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const tag = '[NX:' + pathKey + ']';
    const searchStart = new Date(); searchStart.setFullYear(searchStart.getFullYear() - 1);
    const searchEnd = new Date(); searchEnd.setFullYear(searchEnd.getFullYear() + 2);
    cal.getEvents(searchStart, searchEnd, { search: tag }).forEach(function (ev) {
      try { ev.deleteEvent(); } catch (e) { }
    });
    entries.filter(function (e) { return e.dueDate; }).forEach(function (e) {
      try {
        const d = new Date(e.dueDate + 'T00:00:00');
        if (isNaN(d.getTime())) return;
        cal.createAllDayEvent(
          '[NX] ' + pathKey + ' — ' + String(e.text || '').slice(0, 60),
          d,
          { description: tag + '\n' + (e.text || '') }
        );
      } catch (e2) { }
    });
  } catch (err) {
    // 캘린더 접근 권한이 없거나 오류가 나도 처리일지 저장은 계속 진행돼야 함
  }
}

function handleSyncGlobalLog(body) {
  const pathArr = Array.isArray(body.path) ? body.path.map(String) : [];
  const pathKey = pathArr.join(' / ');
  const entries = Array.isArray(body.entries) ? body.entries : [];

  return withLock_(8000, function () {
    try {
      const file = getOrCreateGlobalLogFile_();
      let all = [];
      try { all = JSON.parse(file.getBlob().getDataAsString('UTF-8') || '[]'); } catch (e) { all = []; }
      if (!Array.isArray(all)) all = [];

      const kept = all.filter(function (e) { return (e.pathKey || '') !== pathKey; });
      const added = entries.map(function (e) {
        return {
          id: e.id, date: e.date || '', text: e.text || '', dueDate: e.dueDate || '',
          path: pathArr, pathKey: pathKey
        };
      });
      const merged = kept.concat(added);
      file.setContent(JSON.stringify(merged));
      syncCalendarForPath_(pathKey, entries); // 마감일이 있는 항목을 실제 구글캘린더 일정으로 반영
      return { success: true };
    } catch (err) {
      return { error: '전체일지 동기화 중 오류: ' + err.message };
    }
  });
}

function handleGetGlobalLog(body) {
  try {
    return { entries: readGlobalLogEntries_() };
  } catch (err) {
    return { error: '전체일지 조회 중 오류: ' + err.message };
  }
}

/**
 * 파일명으로 드라이브 전체에서 검색한다(휴지통 제외). 결과마다 부모 폴더를 최대 4단계까지
 * 거슬러 올라가며 위치 경로를 함께 반환해서, 사용자가 어느 사건 폴더의 파일인지 알 수 있게 한다.
 */
function handleSearchFiles(body) {
  const query = (body.query || '').trim();
  if (!query) return { error: '검색어가 없습니다.' };
  try {
    const safe = query.replace(/'/g, "\\'");
    const res = Drive.Files.list({
      q: "name contains '" + safe + "' and trashed = false",
      fields: 'files(id,name,mimeType,parents,modifiedTime)',
      pageSize: 30,
      orderBy: 'modifiedTime desc'
    });
    const rootId = DriveApp.getRootFolder().getId();
    const items = (res.files || []).map(function (f) {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      let pathNames = [];
      try {
        let curId = (f.parents || [])[0];
        let guard = 0;
        while (curId && curId !== rootId && guard < 4) {
          const curFolder = DriveApp.getFolderById(curId);
          pathNames.unshift(curFolder.getName());
          const parents = curFolder.getParents();
          curId = parents.hasNext() ? parents.next().getId() : null;
          guard++;
        }
      } catch (e) { }
      return {
        id: f.id, name: f.name, type: isFolder ? 'folder' : 'file',
        mimeType: f.mimeType, path: pathNames,
        modifiedDate: f.modifiedTime ? Utilities.formatDate(new Date(f.modifiedTime), 'Asia/Seoul', 'yyyy.MM.dd') : ''
      };
    });
    return { items: items };
  } catch (err) {
    return { error: '검색 중 오류(Drive API 고급서비스가 켜져 있는지 확인하세요): ' + err.message };
  }
}

const REAL_ESTATE_ENDPOINTS = {
  apt_basic: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
  apt_detail: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  officetel: 'https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
  row_house: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
  detached_house: 'https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade',
  land: 'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
  commercial: 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade',
  presale_right: 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade',
  factory_warehouse: 'https://apis.data.go.kr/1613000/RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade'
};

function toolLookupRealEstatePrice(propertyType, lawdCode, dealYearMonth) {
  const endpoint = REAL_ESTATE_ENDPOINTS[propertyType];
  if (!endpoint) {
    return { error: '아직 지원하지 않는 부동산 유형입니다: ' + propertyType + ' (지원: ' + Object.keys(REAL_ESTATE_ENDPOINTS).join(', ') + ')' };
  }
  if (!/^\d{5}$/.test(lawdCode)) return { error: '법정동코드(lawdCode)는 5자리 숫자여야 합니다.' };
  if (!/^\d{6}$/.test(dealYearMonth)) return { error: '계약년월(dealYearMonth)은 6자리(YYYYMM)여야 합니다.' };

  const apiKey = PropertiesService.getScriptProperties().getProperty('MOLIT_API_KEY');
  if (!apiKey) return { error: 'MOLIT_API_KEY가 스크립트 속성에 설정되어 있지 않습니다.' };

  const url = endpoint
    + '?serviceKey=' + apiKey
    + '&LAWD_CD=' + lawdCode
    + '&DEAL_YMD=' + dealYearMonth
    + '&numOfRows=100&pageNo=1';

  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { error: 'API 호출 실패 (status ' + res.getResponseCode() + ')' };
    }
    const xml = res.getContentText('UTF-8');
    return { propertyType: propertyType, lawdCode: lawdCode, dealYearMonth: dealYearMonth, items: parseXmlItems(xml) };
  } catch (err) {
    return { error: '실거래가 조회 중 오류: ' + err.message };
  }
}

const BUILDING_HUB_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService';
const BUILDING_LEDGER_OPERATIONS = {
  titleInfo: 'getBrTitleInfo',
  recapTitleInfo: 'getBrRecapTitleInfo',
  basisInfo: 'getBrBasisOulnInfo',
  floorInfo: 'getBrFlrOulnInfo',
  areaInfo: 'getBrExposPubuseAreaInfo',
  priceInfo: 'getBrHsprcInfo',
  exposInfo: 'getBrExposInfo',
  wclfInfo: 'getBrWclfInfo',
  atchJibunInfo: 'getBrAtchJibunInfo',
  jijiguInfo: 'getBrJijiguInfo'
};

function toolLookupBuildingRegister(ledgerType, sigunguCd, bjdongCd, platGbCd, bun, ji) {
  const operation = BUILDING_LEDGER_OPERATIONS[ledgerType];
  if (!operation) {
    return { error: '아직 지원하지 않는 건축물대장 유형입니다: ' + ledgerType + ' (지원: ' + Object.keys(BUILDING_LEDGER_OPERATIONS).join(', ') + ')' };
  }
  if (!sigunguCd || !bjdongCd || !bun || !ji) {
    return { error: '시군구코드·법정동코드·번·지가 모두 필요합니다.' };
  }

  const apiKey = PropertiesService.getScriptProperties().getProperty('BUILDING_HUB_API_KEY');
  if (!apiKey) return { error: 'BUILDING_HUB_API_KEY가 스크립트 속성에 설정되어 있지 않습니다.' };

  const url = BUILDING_HUB_BASE + '/' + operation
    + '?serviceKey=' + apiKey
    + '&sigunguCd=' + sigunguCd
    + '&bjdongCd=' + bjdongCd
    + '&platGbCd=' + (platGbCd || '0')
    + '&bun=' + bun
    + '&ji=' + ji
    + '&numOfRows=20&pageNo=1&_type=xml';

  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { error: 'API 호출 실패 (status ' + res.getResponseCode() + ')' };
    }
    const xml = res.getContentText('UTF-8');
    return { ledgerType: ledgerType, items: parseXmlItems(xml) };
  } catch (err) {
    return { error: '건축물대장 조회 중 오류: ' + err.message };
  }
}

function parseXmlItems(xmlText) {
  try {
    const doc = XmlService.parse(xmlText);
    const root = doc.getRootElement();
    const header = root.getChild('header');
    if (header) {
      const resultCode = header.getChildText('resultCode');
      if (resultCode && resultCode !== '00' && resultCode !== '000') {
        return { error: 'API 오류 응답: ' + header.getChildText('resultMsg') };
      }
    }
    const body = root.getChild('body');
    const itemsEl = body && body.getChild('items');
    const items = itemsEl ? itemsEl.getChildren('item') : [];
    return items.map(function (item) {
      const obj = {};
      item.getChildren().forEach(function (field) {
        obj[field.getName()] = field.getText().trim();
      });
      return obj;
    });
  } catch (err) {
    return { error: 'XML 파싱 실패: ' + err.message };
  }
}

const NTS_BASE_URL = 'https://api.odcloud.kr/api/nts-businessman/v1';

function toolLookupBusinessStatus(businessNumbers) {
  if (!Array.isArray(businessNumbers) || !businessNumbers.length) {
    return { error: '조회할 사업자등록번호가 없습니다.' };
  }
  const cleaned = businessNumbers.map(function (n) { return String(n).replace(/-/g, ''); });

  const apiKey = PropertiesService.getScriptProperties().getProperty('NTS_API_KEY');
  if (!apiKey) return { error: 'NTS_API_KEY가 스크립트 속성에 설정되어 있지 않습니다.' };

  const url = NTS_BASE_URL + '/status?serviceKey=' + apiKey;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ b_no: cleaned }),
    muteHttpExceptions: true
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      if (code === 200) {
        return JSON.parse(res.getContentText('UTF-8'));
      }
      lastError = 'API 호출 실패 (status ' + code + '): ' + res.getContentText('UTF-8');
      if (code === 504 && attempt === 1) {
        Utilities.sleep(1500);
        continue;
      }
      break;
    } catch (err) {
      lastError = '사업자 상태조회 중 오류: ' + err.message;
      break;
    }
  }
  return { error: lastError };
}

function toolVerifyBusinessRegistration(businesses) {
  if (!Array.isArray(businesses) || !businesses.length) {
    return { error: '조회할 사업자 정보가 없습니다.' };
  }
  const cleaned = businesses.map(function (b) {
    return Object.assign({}, b, { b_no: String(b.b_no || '').replace(/-/g, '') });
  });

  const apiKey = PropertiesService.getScriptProperties().getProperty('NTS_API_KEY');
  if (!apiKey) return { error: 'NTS_API_KEY가 스크립트 속성에 설정되어 있지 않습니다.' };

  const url = NTS_BASE_URL + '/validate?serviceKey=' + apiKey;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ businesses: cleaned }),
    muteHttpExceptions: true
  };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(url, options);
      const code = res.getResponseCode();
      if (code === 200) {
        return JSON.parse(res.getContentText('UTF-8'));
      }
      lastError = 'API 호출 실패 (status ' + code + '): ' + res.getContentText('UTF-8');
      if (code === 504 && attempt === 1) {
        Utilities.sleep(1500);
        continue;
      }
      break;
    } catch (err) {
      lastError = '사업자등록정보 진위확인 중 오류: ' + err.message;
      break;
    }
  }
  return { error: lastError };
}

const BUILDING_BASE_PRICE_2026 = 860000;

const STRUCTURE_TABLE = [
  { name: '통나무조', index: 135, group: 'I' },
  { name: '목구조', index: 115, group: 'I' },
  { name: '철골(철골철근)콘크리트조', index: 110, group: 'I' },
  { name: '철근콘크리트조', index: 100, group: 'I' },
  { name: '석조', index: 100, group: 'I' },
  { name: '프리캐스트 콘크리트조', index: 100, group: 'I' },
  { name: '라멘조', index: 100, group: 'I' },
  { name: '목조', index: 100, group: 'II' },
  { name: 'ALC조', index: 100, group: 'II' },
  { name: '스틸하우스조', index: 100, group: 'II' },
  { name: '연와조', index: 95, group: 'II' },
  { name: '철골조', index: 95, group: 'II' },
  { name: '보강콘크리트조', index: 95, group: 'II' },
  { name: '보강블록조', index: 95, group: 'II' },
  { name: '시멘트벽돌조', index: 90, group: 'II' },
  { name: '와이어패널조', index: 90, group: 'II' },
  { name: '황토조', index: 90, group: 'III' },
  { name: '시멘트블록조', index: 90, group: 'III' },
  { name: '철골조 중 조립식패널(EPS패널)', index: 85, group: 'II' },
  { name: '조립식패널조', index: 80, group: 'III' },
  { name: '경량철골조', index: 79, group: 'III' },
  { name: '석회 및 흙벽돌조', index: 60, group: 'III' },
  { name: '돌담 및 토담조', index: 60, group: 'III' },
  { name: '철파이프조', index: 59, group: 'IV' },
  { name: '컨테이너건물', index: 59, group: 'IV' }
];

const USE_TABLE = [
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

const ADJUSTMENT_TABLE = [
  { no: 1, desc: '지붕: 슬래브·기와·아스팔트슁글 등 (구조지수 100미만일 때만)', index: 100 },
  { no: 2, desc: '지붕: 패널·유리·슬레이트', index: 80 },
  { no: 3, desc: '지붕: 함석·자연석·천막·초가 등', index: 60 },
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

const DEPRECIATION_TABLE = {
  I:  { 2026:1.000,2025:0.982,2024:0.964,2023:0.946,2022:0.928,2021:0.910,2020:0.892,2019:0.874,2018:0.856,2017:0.838,2016:0.820,2015:0.802,2014:0.784,2013:0.766,2012:0.748,2011:0.730,2010:0.712,2009:0.694,2008:0.676,2007:0.658,2006:0.640,2005:0.622,2004:0.604,2003:0.586,2002:0.568,2001:0.550,2000:0.532,1999:0.514,1998:0.496,1997:0.478,1996:0.460,1995:0.442,1994:0.424,1993:0.406,1992:0.388,1991:0.370,1990:0.352,1989:0.334,1988:0.316,1987:0.298,1986:0.280,1985:0.262,1984:0.244,1983:0.226,1982:0.208,1981:0.190,1980:0.172,1979:0.154,1978:0.136,1977:0.118 },
  II: { 2026:1.0000,2025:0.9775,2024:0.9550,2023:0.9325,2022:0.9100,2021:0.8875,2020:0.8650,2019:0.8425,2018:0.8200,2017:0.7975,2016:0.7750,2015:0.7525,2014:0.7300,2013:0.7075,2012:0.6850,2011:0.6625,2010:0.6400,2009:0.6175,2008:0.5950,2007:0.5725,2006:0.5500,2005:0.5275,2004:0.5050,2003:0.4825,2002:0.4600,2001:0.4375,2000:0.4150,1999:0.3925,1998:0.3700,1997:0.3475,1996:0.3250,1995:0.3025,1994:0.2800,1993:0.2575,1992:0.2350,1991:0.2125,1990:0.1900,1989:0.1675,1988:0.1450,1987:0.1225,1986:0.1000 },
  III:{ 2026:1.000,2025:0.970,2024:0.940,2023:0.910,2022:0.880,2021:0.850,2020:0.820,2019:0.790,2018:0.760,2017:0.730,2016:0.700,2015:0.670,2014:0.640,2013:0.610,2012:0.580,2011:0.550,2010:0.520,2009:0.490,2008:0.460,2007:0.430,2006:0.400,2005:0.370,2004:0.340,2003:0.310,2002:0.280,2001:0.250,2000:0.220,1999:0.190,1998:0.160,1997:0.130,1996:0.100 },
  IV: { 2026:1.000,2025:0.955,2024:0.910,2023:0.865,2022:0.820,2021:0.775,2020:0.730,2019:0.685,2018:0.640,2017:0.595,2016:0.550,2015:0.505,2014:0.460,2013:0.415,2012:0.370,2011:0.325,2010:0.280,2009:0.235,2008:0.190,2007:0.145,2006:0.100 }
};
const DEPRECIATION_MIN_YEAR = { I: 1976, II: 1986, III: 1996, IV: 2006 };

const LOCATION_TABLE = [
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

function toolGetBuildingPriceIndexTables() {
  return {
    건물신축가격기준액_2026: BUILDING_BASE_PRICE_2026,
    구조지수: STRUCTURE_TABLE.map(s => ({ 구조명: s.name, 지수: s.index })),
    용도지수: USE_TABLE.map(u => ({ 번호: u.no, 대상건물: u.desc, 지수: u.index })),
    조정률_상속증여전용: ADJUSTMENT_TABLE.map(a => ({ 번호: a.no, 적용대상: a.desc, 지수: a.index })),
    안내: '구조·용도는 건축물대장 또는 등기부등본상 기재를 우선하되, 사실상 현황이 다르면 사실상 현황을 따른다. 조정률은 상속세및증여세법 적용시에만 사용하고 양도소득세에는 적용하지 않는다. (계수표 기준: 2026.1.1. 시행 국세청 고시 제2025-39호 — 매년 1월 갱신되므로 신고 시점에 최신 고시 여부를 확인할 것)'
  };
}

function lookupLocationIndex(pricePerSqm) {
  for (const row of LOCATION_TABLE) {
    if (pricePerSqm < row.max) return row.index;
  }
  return LOCATION_TABLE[LOCATION_TABLE.length - 1].index;
}

function lookupDepreciationRate(group, builtYear) {
  const table = DEPRECIATION_TABLE[group];
  if (!table) return null;
  if (builtYear >= 2026) return table[2026];
  if (table[builtYear] !== undefined) return table[builtYear];
  if (builtYear < DEPRECIATION_MIN_YEAR[group]) return table[DEPRECIATION_MIN_YEAR[group]];
  return null;
}

function toolCalculateBuildingStandardPrice(structureName, useNo, officialLandPricePerSqm, builtYear, floorAreaSqm, taxType, adjustmentNos) {
  const structure = STRUCTURE_TABLE.find(s => s.name === structureName);
  if (!structure) return { error: '구조명을 찾을 수 없습니다: ' + structureName + ' — get_building_price_index_tables로 정확한 구조명을 먼저 확인하세요.' };

  const use = USE_TABLE.find(u => u.no === useNo);
  if (!use) return { error: '용도번호를 찾을 수 없습니다: ' + useNo };
  if (use.index === null) return { error: '용도번호 61(기계식주차전용빌딩)은 별도 계산식이 필요합니다: 기준시가 = 6,000,000원 × 경과연수별잔가율(내용연수 30년) × 주차대수. 이 도구로는 계산할 수 없습니다.' };

  if (!officialLandPricePerSqm || officialLandPricePerSqm <= 0) return { error: '건물 부속토지의 ㎡당 개별공시지가가 필요합니다.' };
  if (!builtYear) return { error: '신축연도가 필요합니다.' };
  if (!floorAreaSqm || floorAreaSqm <= 0) return { error: '건물 면적(㎡)이 필요합니다.' };
  if (taxType !== 'transfer' && taxType !== 'inheritance_gift') return { error: 'taxType은 transfer 또는 inheritance_gift여야 합니다.' };

  const locationIndex = lookupLocationIndex(officialLandPricePerSqm);
  const depreciationRate = lookupDepreciationRate(structure.group, builtYear);
  if (depreciationRate === null) return { error: '해당 신축연도의 경과연수별잔가율을 찾을 수 없습니다.' };

  let adjustmentMultiplier = 1;
  const appliedAdjustments = [];
  if (taxType === 'inheritance_gift' && Array.isArray(adjustmentNos)) {
    for (const no of adjustmentNos) {
      const adj = ADJUSTMENT_TABLE.find(a => a.no === no);
      if (!adj) return { error: '조정률 번호를 찾을 수 없습니다: ' + no };
      adjustmentMultiplier *= (adj.index / 100);
      appliedAdjustments.push({ 번호: adj.no, 내용: adj.desc, 지수: adj.index });
    }
  }

  let pricePerSqm = BUILDING_BASE_PRICE_2026
    * (structure.index / 100)
    * (use.index / 100)
    * (locationIndex / 100)
    * depreciationRate
    * adjustmentMultiplier;
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
    '㎡당_금액': pricePerSqm,
    '건물면적_㎡': floorAreaSqm,
    건물기준시가: totalPrice,
    안내: '이 값은 건물가격만 포함하며, 부속토지가격은 별도입니다. 2026.1.1. 시행 국세청 고시 기준(국세청 고시 제2025-39호)이며, 통상 매년 1월 새 고시로 갱신되므로 신고 시점의 최신 고시 여부를 반드시 확인하고 홈택스 공식 계산기로 검산하시길 권합니다.'
  };
}

// 건물기준시가 — 층별/부속시설별 상세 계산. 하나의 건물이라도 층(또는 부속시설)마다 구조·용도·신축(증축)연도가
// 다를 수 있으므로, 각 행을 toolCalculateBuildingStandardPrice로 개별 계산한 뒤 합산한다.
// rows: [{ label, structureName, useNo, builtYear, floorAreaSqm, adjustmentNos }, ...] (officialLandPricePerSqm·taxType은 건물 전체 공통)
function toolCalculateBuildingStandardPriceMulti(rows, officialLandPricePerSqm, taxType) {
  if (!Array.isArray(rows) || rows.length === 0) return { error: '층 또는 부속시설을 1개 이상 입력해야 합니다.' };
  const rowResults = [];
  let totalPrice = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const r = toolCalculateBuildingStandardPrice(row.structureName, row.useNo, officialLandPricePerSqm, row.builtYear, row.floorAreaSqm, taxType, row.adjustmentNos);
    if (r.error) return { error: (i + 1) + '번째 행(' + (row.label || '') + '): ' + r.error };
    totalPrice += r.건물기준시가;
    rowResults.push(Object.assign({ 순번: i + 1, 구분: row.label || ('행' + (i + 1)) }, r));
  }
  return {
    행별_결과: rowResults,
    건물기준시가_합계: totalPrice,
    안내: '각 층(또는 부속시설)을 개별 계산해 합산한 값입니다. 부속토지 공시지가는 건물 전체에 공통으로 적용했습니다. 부속 주차장·기계실·보일러실·대피소 등은 용도번호를 그에 맞는 용도(예: 57.주차장)로 선택해 별도 행으로 추가하세요. 2026.1.1. 시행 국세청 고시 기준이며 매년 1월 갱신되므로 최신 고시 여부를 반드시 확인하세요.'
  };
}

// ============================================================
// 양도소득세 · 증여세 · 상속세 세액계산
// 세율·공제 구간은 이 코드 작성 시점 기준 현행법이며, 매년 개정될 수 있으므로
// 실제 신고 전에는 반드시 홈택스 모의계산 등으로 재검증할 것.
//
// 아래 세 함수는 각각의 "안내" 필드에 이번 계산이 포함/배제한 특례를 명시한다.
// 의도적으로 배제한 항목(요건 판정 자체가 매우 개별적이거나, 적용대상이 극히 드물어
// 잘못 넣으면 오히려 위험한 것들): 가업상속공제·창업자금 및 가업승계 증여세 과세특례
// (지분율·사후관리 등 요건이 사안마다 달라 이 도구로 자동판정하면 위험),
// 재해손실공제(발생 자체가 드묾), 조세특례제한법상 각종 감면(수용·환지·대토 등,
// 자경농지 감면 외에는 개별 요건이 너무 다양함). 이 항목들이 필요하면 별도로 계산할 것.
// ============================================================

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

function calcProgressiveTax_(base, brackets) {
  if (!base || base <= 0) return 0;
  const bracket = brackets.find(function (b) { return base <= b.max; }) || brackets[brackets.length - 1];
  return Math.max(0, Math.round(base * bracket.rate - bracket.deduction));
}

// 만 나이 계산과 동일한 방식의 정확한 경과연수(달력 기준 만년수). 365.25일 평균으로 나누면
// 5년처럼 딱 떨어지는 기간이 소수점 오차로 4년까지 내려가 세율구간이 한 단계 틀어질 수 있어
// 반드시 이 방식을 써야 한다.
function fullYearsElapsed_(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  const monthDiff = end.getUTCMonth() - start.getUTCMonth();
  const dayDiff = end.getUTCDate() - start.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years--;
  return years;
}
// 의제취득일(소득세법 시행령§162④) — 1985.1.1. 전에 취득한 자산은 1985.1.1.에 취득한 것으로 보아
// 보유기간(장기보유특별공제·단기양도세율 판정)을 계산한다. 취득가액 산정에는 영향을 주지 않는다.
function deemedAcquisitionDate_(dateStr) {
  return dateStr && dateStr < '1985-01-01' ? '1985-01-01' : dateStr;
}

// "취득일부터 5년간 발생한 양도소득금액" 산정 (조특법시행령§40①, §98의3③·§98의5③ 등에서 준용,
// §99①1호·②2호, §99의3②2호 등) — 원칙은 기준시가 비율로 계산한다:
//   5년간발생분 = 전체양도소득금액 × (5년시점기준시가－취득당시기준시가) ÷ (양도당시기준시가－취득당시기준시가)
// 기준시가 3개 값이 모두 주어지면 이 원칙대로 계산하고, 주어지지 않으면 실거래가 기준 근사치로 대체한다.
function fiveYearMarkGain_(totalGain, acquisitionPrice, opts) {
  opts = opts || {};
  const acqStd = Number(opts.acquisitionStandardPrice) || 0;
  const fiveYrStd = Number(opts.fiveYearStandardPrice) || 0;
  const trfStd = Number(opts.transferStandardPrice) || 0;
  if (acqStd > 0 && fiveYrStd > 0 && trfStd > 0 && trfStd !== acqStd) {
    return {
      gain: totalGain * (fiveYrStd - acqStd) / (trfStd - acqStd),
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

// 장기보유특별공제율 — 일반 자산 (소득세법 §95, 3년 이상 보유 시 연 2%, 최대 30%)
function longTermHoldingDeductionRate_(years) {
  if (years < 3) return 0;
  return Math.min(0.30, years * 0.02);
}

// 장기보유특별공제율 — 1세대1주택(고가주택) 특례: 보유기간·거주기간 각각 연 4%, 각 최대 40%(합산 최대 80%)
function longTermHoldingDeductionRate1House_(ownYears, liveYears) {
  const ownRate = ownYears >= 3 ? Math.min(0.40, ownYears * 0.04) : 0;
  const liveRate = liveYears >= 2 ? Math.min(0.40, liveYears * 0.04) : 0;
  return ownRate + liveRate;
}

// 장기임대주택 등 장기보유특별공제 특례 ([별지 제84호서식] 코드04·05, 조특법 §97의3·§97의4)
// rental_general(장기일반민간임대주택, §97의3): 10년 이상 임대 70%, 8년 이상 임대 50% — 정액(다른 공제율과 합산하지 않음)
// rental_long(장기임대주택, §97의4): 일반 장기보유특별공제율(연 2%, 최대 30%)에 임대기간별 추가공제(6년↑2%~10년↑10%)를 더함
function rentalLongTermHoldingDeductionRate_(type, holdingYears, rentalYears) {
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
    return longTermHoldingDeductionRate_(holdingYears) + addRate;
  }
  return null;
}

// 증여재산공제 (상증세법 §53, 10년간 합산 한도액 기준)
function giftPropertyDeduction_(relation, isMinor) {
  switch (relation) {
    case '배우자': return 600000000;
    case '직계존속': return isMinor ? 20000000 : 50000000;
    case '직계비속': return 50000000;
    case '기타친족': return 10000000;
    default: return 0;
  }
}

// 배우자 상속공제 한도액 (상증세법 §19, [별지 제9호서식] 부표3의2 계산식)
// 한도액 = {(상속재산의 가액 - 상속인 아닌 자 유증재산가액 + 10년내 상속인에게 증여한 재산가액) × 배우자 법정상속분 비율} - 배우자가 사전증여받은 재산의 과세표준
// spouseLegalShareRatio(0~1)를 모르면 한도를 계산할 수 없으므로 Infinity를 반환해 30억 한도만 적용한다(예전 방식과 동일하게 안전 폴백).
function spouseInheritanceLimit_(estateValueForLimit, nonHeirBequestAmount, giftToHeirsWithin10Years, spouseLegalShareRatio, spouseTaxableBaseOfPriorGift) {
  if (!(spouseLegalShareRatio > 0)) return Infinity;
  const base = (Number(estateValueForLimit) || 0) - (Number(nonHeirBequestAmount) || 0) + (Number(giftToHeirsWithin10Years) || 0);
  return Math.max(0, base * spouseLegalShareRatio - (Number(spouseTaxableBaseOfPriorGift) || 0));
}

// 배우자 상속공제 (상증세법 §19) — 최소 5억, 최대 30억이며 (실제 상속액, 한도액) 중 작은 값
function spouseInheritanceDeduction_(actualAmount, limitAmount) {
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
const SHORT_TERM_REINHERITANCE_RATES_ = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
function shortTermReinheritanceCredit_(priorInheritanceTax, reinheritedPropertyValue, priorInheritanceTotalPropertyValue, priorInheritanceTaxableBase, yearsSincePriorInheritance) {
  const y = Math.ceil(Number(yearsSincePriorInheritance) || 0);
  if (y < 1 || y > 10) return 0;
  const totalProperty = Number(priorInheritanceTotalPropertyValue) || 0;
  const taxableBase = Number(priorInheritanceTaxableBase) || 0;
  if (totalProperty <= 0 || taxableBase <= 0) return 0;
  const portion = (Number(priorInheritanceTax) || 0) * ((Number(reinheritedPropertyValue) || 0) * (taxableBase / totalProperty)) / taxableBase;
  return Math.round(portion * SHORT_TERM_REINHERITANCE_RATES_[y - 1]);
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
// "상속인별 상속세과세가액상당액"과 "그 상속인이 납부할 상속세액"은 이 시행령 조문 자체에는 별도 산식이
// 없으나, 상증세법§3조의2②(상속세 납부의무 안분)이 이미 "각자가 받았거나 받을 재산" 비율로 안분하도록
// 정하고 있고 이 도구의 §3조의2② 안분 도구(toolAllocateInheritanceTaxByHeir)도 실무관행에 따라 "실제
// 상속재산가액 비율"로 그 비율을 조작적으로 정의하고 있으므로, 여기서도 동일한 비율을 그대로 적용해
// 두 조문의 해석을 일관되게 유지한다.
function priorGiftTaxCreditPrecise_(overallCalculatedTax, overallTaxBase, overallTaxableAmount, heirs) {
  heirs = Array.isArray(heirs) ? heirs : [];
  if (overallTaxableAmount <= 500000000) {
    return { totalCredit: 0, excludedBySmallEstate: true, perHeir: [] };
  }
  const totalActualValue = heirs.reduce(function (s, h) { return s + (Number(h.actualInheritedValue) || 0); }, 0);
  const totalPriorGiftAmount = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftAmount) || 0); }, 0);
  const totalPriorGiftTaxableBase = heirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0);
  const gaMok = Math.max(0, overallTaxBase - totalPriorGiftTaxableBase);
  const naMok = Math.max(0, overallTaxableAmount - totalPriorGiftAmount);
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
    const daMok = heirTaxableAmountShare - giftAmount;
    const ratioDaNa = naMok > 0 ? (daMok / naMok) : 0;
    const taxableBaseEquivalent = giftTaxableBase + gaMok * ratioDaNa; // 상속인별 상속세과세표준상당액
    const grossTaxShare = overallCalculatedTax * actualValueRatio; // 그 상속인이 납부할 상속세액(§3조의2②)
    const limit = taxableBaseEquivalent > 0 ? Math.round(grossTaxShare * Math.min(1, giftTaxableBase / taxableBaseEquivalent)) : 0;
    const credit = Math.min(giftTaxPaid, Math.round(grossTaxShare), limit);
    totalCredit += credit;
    return { 성명: h.name || '', 공제액: credit, 한도: limit, 상속인별과세표준상당액: Math.round(taxableBaseEquivalent), 안분산출세액: Math.round(grossTaxShare) };
  });
  return { totalCredit: Math.round(totalCredit), excludedBySmallEstate: false, perHeir: perHeir };
}

// 상속개시전 처분재산 등 산입액 (상증세법 §15, 시행령§11④, [별지 제9호서식] 부표4) — 재산종류별로
// 1년 이내 2억원 이상 또는 2년 이내 5억원 이상 처분·인출(순인출=총인출-내돈입금액 기준)했는데
// 그 용도가 불분명하면 산입 대상이 된다. 시행령§11④ 원문: "…입증되지 아니한 금액이
// [MIN(순인출액×20%, 2억원)]에 미달하는 경우에는 용도가 명백하지 아니한 것으로 추정하지 아니하며,
// 그 금액 이상인 경우에는 [MIN(순인출액×20%, 2억원)]을 "차감한 금액"을 용도가 명백하지 아니한
// 것으로 추정한다" — 미달이면 0, 이상이면 미소명금액에서 그 문턱금액을 뺀 "차액"만 산입한다
// (문턱을 넘었다고 미소명금액 전액이 산입되는 게 아니다). 1년 기준·2년 기준은 서로 다른 별도
// 요건이므로 각각 독립적으로 계산해 더 큰 금액을 채택한다(2년 누계에는 1년분이 이미 포함되어
// 있으므로 중복산입 방지).
function computeDisposalBasisPresumed_(amount, selfDeposit, explained, thresholdAmount) {
  const net = Math.max(0, (Number(amount) || 0) - (Number(selfDeposit) || 0));
  if (net < thresholdAmount) return 0;
  const unexplained = Math.max(0, net - (Number(explained) || 0));
  const cutoff = Math.min(net * 0.2, 200000000);
  return unexplained >= cutoff ? unexplained - cutoff : 0;
}
function presumedInheritedFromDisposal_(item) {
  item = item || {};
  const oneYear = computeDisposalBasisPresumed_(item.oneYearAmount, item.oneYearSelfDeposit, item.oneYearExplained, 200000000);
  const twoYear = computeDisposalBasisPresumed_(item.twoYearAmount, item.twoYearSelfDeposit, item.twoYearExplained, 500000000);
  return Math.max(oneYear, twoYear);
}

// 상속공제 — 기초공제(2억)+인적공제 합계와 일괄공제(5억) 중 큰 금액 선택 (상증세법 §21)
// 주의: 배우자 단독상속인 경우 일괄공제를 선택할 수 없고 기초공제+인적공제만 가능(법 §21③) — 이 함수는 그 예외를 판별하지 않으므로 해당 사안이면 결과를 그대로 쓰지 말 것.
// §21① — 원칙은 max(기초공제+그밖의인적공제, 5억원)이나, "다만, 제67조 또는 국세기본법§45의3에
// 따른 신고가 없는 경우에는 5억원을 공제한다"는 단서가 있다 — 무신고시 인적공제 합계가 5억을
// 넘더라도 일괄공제(5억원)만 적용한다.
function basicOrLumpSumInheritanceDeduction_(personalDeductionSum, isUnreported) {
  if (isUnreported) return 500000000;
  return Math.max(500000000, 200000000 + (Number(personalDeductionSum) || 0));
}

// 금융재산 상속공제 (상증세법 §22) — 순금융재산가액(금융재산-금융채무) 2천만원 이하면 전액,
// 초과하면 순금융재산가액의 20%와 2천만원 중 큰 금액(2억원 한도)
function financialAssetInheritanceDeduction_(netFinancialAssets) {
  const net = Number(netFinancialAssets) || 0;
  if (net <= 0) return 0;
  if (net <= 20000000) return net;
  return Math.min(200000000, Math.max(net * 0.2, 20000000));
}

// 사업관련자산가액 비율 (상증세법 시행령 §15⑤2호가목~마목 — 가업상속공제·영농상속공제·조특법 가업승계 증여세 특례에 공통 사용)
// 사업무관자산 = 법인세법§55의2 해당자산 + 법인세법시행령§49 해당자산및임대용부동산 + 법인세법시행령§61①2호 해당자산(대여금)
//              + 과다보유현금 + 영업무관 보유 주식·채권·금융상품
function businessRelatedAssetRatio_(totalAssetValue, nonBiz) {
  const total = Number(totalAssetValue) || 0;
  const n = nonBiz || {};
  const nonBizTotal = (Number(n.asset55) || 0) + (Number(n.asset49) || 0) + (Number(n.asset61) || 0)
    + (Number(n.excessCash) || 0) + (Number(n.nonBizStock) || 0);
  const businessRelatedAssetValue = Math.max(0, total - nonBizTotal);
  const ratio = total > 0 ? businessRelatedAssetValue / total : 0;
  return { nonBizTotal, businessRelatedAssetValue, ratio };
}

// 가업상속공제 (§18의2, [별지 제1호서식]) — 소득세법 적용가업(순자산액 합계) 또는 법인세법 적용가업(주식등가액×사업관련자산비율) 중
// 해당하는 방식으로 대상금액을 계산하고, 가업영위기간별 한도(10~20년 300억/20~30년 400억/30년이상 600억)를 적용한다.
// 상세 입력(법인 자산내역 등)이 없으면 businessInheritanceDeduction(직접 입력한 최종 공제액)을 그대로 쓴다.
function businessInheritanceDeductionDetailed_(p) {
  const years = Number(p.businessOwnershipYears) || 0;
  const individualNet = Number(p.businessInheritanceIndividualNetAssetValue) || 0;
  const stockValue = Number(p.businessInheritanceStockValue) || 0;
  if (years <= 0 || (individualNet <= 0 && stockValue <= 0)) return null;

  const targetIndividual = individualNet;
  const ratioInfo = stockValue > 0 ? businessRelatedAssetRatio_(p.businessInheritanceTotalAssetValue, {
    asset55: p.businessInheritanceNonBizAsset55, asset49: p.businessInheritanceNonBizAsset49,
    asset61: p.businessInheritanceNonBizAsset61, excessCash: p.businessInheritanceExcessCash, nonBizStock: p.businessInheritanceNonBizStock
  }) : null;
  const targetCorporate = ratioInfo ? Math.round(stockValue * ratioInfo.ratio) : 0;
  const targetAmount = targetIndividual + targetCorporate;

  const limitAmount = years < 10 ? 0 : (years < 20 ? 30000000000 : (years < 30 ? 40000000000 : 60000000000));
  let deductionAmount = Math.min(targetAmount, limitAmount);

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
  return { targetAmount, limitAmount, deductionAmount, targetIndividual, targetCorporate, ratioInfo, mediumSizedGateApplied };
}

// 영농상속공제 (§18의3, [별지 제2호서식]) — 소득세법 적용영농(①합계) + 법인세법 적용영농(주식등가액×사업관련자산비율), 30억원 고정한도.
function farmingInheritanceDeductionDetailed_(p) {
  const individualTotal = Number(p.farmingIndividualAssetValue) || 0;
  const stockValue = Number(p.farmingStockValue) || 0;
  if (individualTotal <= 0 && stockValue <= 0) return null;

  const ratioInfo = stockValue > 0 ? businessRelatedAssetRatio_(p.farmingTotalAssetValue, {
    asset55: p.farmingNonBizAsset55, asset49: p.farmingNonBizAsset49,
    asset61: p.farmingNonBizAsset61, excessCash: p.farmingExcessCash, nonBizStock: p.farmingNonBizStock
  }) : null;
  const targetCorporate = ratioInfo ? Math.round(stockValue * ratioInfo.ratio) : 0;
  const targetAmount = individualTotal + targetCorporate;

  const limitAmount = 3000000000;
  const deductionAmount = Math.min(targetAmount, limitAmount);
  return { targetAmount, limitAmount, deductionAmount, individualTotal, targetCorporate, ratioInfo };
}

// ============================================================
// 상속증여재산 평가 (상속세및증여세법 §60~66, 보충적평가방법)
// 양도소득세·증여세·상속세 계산에 들어가는 "증여재산가액"·"상속세과세가액"은
// 결국 이 아래 방식으로 자산 하나하나를 평가해서 합산한 값이다 — 이 계산을
// 사람이 전부 손으로 해서 최종 숫자 하나만 넣게 하면 그 앞단이 통째로 빠지는
// 것이므로, 증여세·상속세 공통으로 쓰는 평가 함수를 별도로 둔다.
// ============================================================

// 비상장주식 평가 (상증세법 §63, 시행령 §54) — 1주당 순손익가치와 순자산가치의 가중평균
// (일반법인 순손익3:순자산2, 부동산 등 보유비율 50% 이상인 부동산과다보유법인은 순손익2:순자산3).
// 계산값이 순자산가치의 80%보다 작으면 순자산가치의 80%를 하한으로 한다.
function unlistedStockValuePerShare_(netProfit1YearAgo, netProfit2YearsAgo, netProfit3YearsAgo, totalIssuedShares, netAssetValue, isRealEstateHeavy) {
  const shares = Number(totalIssuedShares) || 0;
  if (shares <= 0) return null;
  const weightedNetProfitSum = (Number(netProfit1YearAgo) || 0) * 3 + (Number(netProfit2YearsAgo) || 0) * 2 + (Number(netProfit3YearsAgo) || 0) * 1;
  const weightedNetProfitPerShare = (weightedNetProfitSum / 6) / shares;
  const profitValuePerShare = weightedNetProfitPerShare / 0.10; // 순손익가치환원율 10%(상증세법 시행규칙 §17의3)
  const netAssetValuePerShare = (Number(netAssetValue) || 0) / shares;
  const weights = isRealEstateHeavy ? [2, 3] : [3, 2];
  let valuePerShare = (profitValuePerShare * weights[0] + netAssetValuePerShare * weights[1]) / (weights[0] + weights[1]);
  const floor = netAssetValuePerShare * 0.8;
  const floorApplied = valuePerShare < floor;
  if (floorApplied) valuePerShare = floor;
  return { 순손익가치_1주당: Math.round(profitValuePerShare), 순자산가치_1주당: Math.round(netAssetValuePerShare), 평가액_1주당: Math.round(valuePerShare), 순자산가치80퍼센트_하한적용: floorApplied };
}

function toolCalculateUnlistedStockValue(p) {
  p = p || {};
  const totalIssuedShares = Number(p.totalIssuedShares);
  if (!totalIssuedShares || totalIssuedShares <= 0) return { error: '발행주식총수(totalIssuedShares)가 필요합니다.' };
  const ownedShares = Number(p.ownedShares) || 0;
  const result = unlistedStockValuePerShare_(p.netProfit1YearAgo, p.netProfit2YearsAgo, p.netProfit3YearsAgo, totalIssuedShares, p.netAssetValue, !!p.isRealEstateHeavy);
  let totalValue = Math.round(result.평가액_1주당 * ownedShares);
  // 최대주주 등 할증평가(§63③, 원칙 20%) — 중소기업이 발행한 주식이거나, 직전 3개년 매출액 평균 5천억원 미만인 중견기업이 발행한 주식이면 할증평가를 배제한다.
  const isPremiumExempt = !!p.isSmallBusiness || (!!p.isMediumBusinessUnder500B);
  const majorShareholderPremium = (p.isMajorShareholder && !isPremiumExempt) ? Math.round(totalValue * 0.2) : 0;
  totalValue += majorShareholderPremium;
  return Object.assign({
    발행주식총수: totalIssuedShares, 평가대상주식수: ownedShares, 최대주주할증액: majorShareholderPremium, 할증평가배제여부: isPremiumExempt, 평가총액: totalValue
  }, result, {
    안내: '순손익가치·순자산가치 가중평균(일반법인 3:2, 부동산과다보유법인 2:3) 방식입니다. netProfit1~3YearsAgo는 이미 1주당으로 나눈 값이 아니라 법인 전체의 각 사업연도 순손익액(세무조정 반영 후) 합계를 넣으면 발행주식총수로 나눠 계산합니다. 최대주주 등 할증평가(20%)는 중소기업기본법상 중소기업이 발행한 주식이거나 직전 3개년 매출액 평균 5천억원 미만인 중견기업이 발행한 주식이면 배제되며(isSmallBusiness/isMediumBusinessUnder500B로 표시), 결손금 있는 법인·전부매각·신설법인 등 그 밖의 배제사유(상증령 §53⑥)는 이 도구가 검증하지 않으니 별도로 확인하세요.'
  });
}

function toolCalculateTransferTax(p) {
  p = p || {};
  const transferPrice = Number(p.transferPrice);
  let necessaryExpenses = Number(p.necessaryExpenses) || 0;
  const acquisitionPrice = Number(p.acquisitionPrice);
  const isReconstruction = !!p.isReconstructionRights;
  if (!transferPrice || transferPrice <= 0) return { error: '양도가액(transferPrice)이 필요합니다.' };
  // 재건축·재개발 특례는 취득가액 대신 종전자산 취득가액(originalAssetAcquisitionPrice)·권리가액(rightsValue)을
  // 별도로 쓰므로, 이 경우에는 일반 취득가액 필수 검증을 적용하지 않는다(아래 재건축 분기에서 별도 검증).
  if (!isReconstruction && (!acquisitionPrice || acquisitionPrice < 0)) return { error: '취득가액(acquisitionPrice)이 필요합니다.' };
  if (!p.acquisitionDate || !p.transferDate) return { error: '취득일(acquisitionDate)과 양도일(transferDate)이 YYYY-MM-DD 형식으로 필요합니다.' };

  const holdingYears = fullYearsElapsed_(deemedAcquisitionDate_(p.acquisitionDate), p.transferDate);
  if (holdingYears < 0) return { error: '양도일이 취득일보다 빠릅니다. 날짜를 확인하세요.' };
  // 조특법§69의4 "직접 경영한 기간"은 양도차익 계산용 의제취득일(1985.1.1) 의제를 적용하지 않는
  // 실제 취득일 기준 기간이므로 holdingYears와 별도로 계산한다.
  const forestManagementYears = fullYearsElapsed_(p.acquisitionDate, p.transferDate);

  // 실제 취득가액을 확인할 수 없을 때(매매계약서 분실 등)의 필요경비 개산공제(시행령§163⑥1호·2호):
  // 취득 당시 기준시가 × 3%(토지·건물 일반 기준)를 필요경비로 대체 인정하되, 미등기양도자산은 3/1000(0.3%).
  if (!p.necessaryExpenses && p.useEstimatedNecessaryExpense && Number(p.acquisitionStandardPriceForExpense) > 0) {
    const estimatedExpenseRate = p.isUnregisteredTransfer ? 0.003 : 0.03;
    necessaryExpenses = Math.round(Number(p.acquisitionStandardPriceForExpense) * estimatedExpenseRate);
  }

  const assetType = p.assetType === 'house' ? 'house' : (p.assetType === 'presale_right' ? 'presale_right' : 'other');
  const isPresaleRight = assetType === 'presale_right';
  const isOneHouse = !isPresaleRight && !isReconstruction && !!p.isOneHouseOneFamily;
  // 소득세법§95③은 §89①3호 단서의 고가주택뿐 아니라 §89①4호 각목외 단서의 "고가조합원입주권"
  // (1세대가 1조합원입주권만 보유하는 등 원래는 전액 비과세 요건을 충족하나 양도가액이 12억원을 초과하는
  // 경우)도 함께 "대통령령으로 정하는 바에 따라 계산"하도록 위임한다. 소득세법시행령§160①②는 문언상
  // "고가주택"만 명시하고 조합원입주권을 별도로 규정하지 않는데, 이는 입법미비로 보이며 §160①②의
  // 12억초과 비율안분 산식을 고가조합원입주권에도 유추적용하는 것이 §95③의 위임 취지에 맞다(준공 전
  // 조합원입주권 자체 양도, 즉 아래 §166①1호 분기에만 해당 — 준공 후 신축주택은 이미 "주택" 자체이므로
  // §160① 문언 그대로 적용된다). 다른 비과세 요건 없이 무조건 적용하면 정책 취지에 반하므로, 원래
  // §89①4호 요건(1세대1조합원입주권)을 충족한다는 전제가 있을 때만(isOneMemberRightOneFamily) 적용한다.
  const isOneMemberRightOnly = isReconstruction && !p.isCompletedNewHousing && !!p.isOneMemberRightOneFamily;
  const isUnregistered = !!p.isUnregisteredTransfer;
  const gainBeforeDeduction = transferPrice - acquisitionPrice - necessaryExpenses;

  // 미등기양도자산(소득세법 §104③) — 장기보유특별공제·기본공제·1세대1주택 특례 전부 배제,
  // 양도차익 전액에 70% 단일세율. 다른 특례와 절대 함께 적용되지 않으므로 여기서 바로 반환.
  if (isUnregistered) {
    const uCalculatedTax = Math.max(0, Math.round(gainBeforeDeduction * 0.7));
    const uLocalTax = Math.round(uCalculatedTax * 0.1);
    return {
      입력값: { 양도가액: transferPrice, 취득가액: acquisitionPrice, 필요경비: necessaryExpenses, 미등기양도: true },
      양도차익: Math.round(gainBeforeDeduction),
      과세표준: Math.max(0, Math.round(gainBeforeDeduction)),
      적용세율_설명: '미등기양도자산 — 장기보유특별공제·기본공제 배제, 70% 단일세율',
      산출세액: uCalculatedTax,
      지방소득세: uLocalTax,
      납부세액_합계: uCalculatedTax + uLocalTax,
      안내: '미등기양도로 전제하고 계산했습니다. 미등기 제외 대상(법령상 열거된 예외 사유)에 해당하는지는 별도로 확인하세요.'
    };
  }

  // 1세대1조합원입주권(§89①4호, 준공 전 조합원입주권 자체 양도) 비과세 요건 충족을 전제로, 양도가액이
  // 12억원 이하이면 전액 비과세(§89①4호 각목외 단서 반대해석). 12억 초과분은 아래 §166①1호 분기에서
  // 고가조합원입주권 비율안분을 적용한다.
  if (isOneMemberRightOnly && transferPrice <= 1200000000) {
    return {
      입력값: { 양도가액: transferPrice, 취득가액: acquisitionPrice, 필요경비: necessaryExpenses, 보유기간_년: holdingYears },
      비과세여부: true,
      납부세액: 0,
      안내: '1세대1조합원입주권 비과세 요건 충족을 전제로, 양도가액이 12억원 이하이므로 전액 비과세입니다(§89①4호). 요건 자체는 이 도구가 검증하지 않으므로 별도로 반드시 확인하세요.'
    };
  }

  let taxableGain = gainBeforeDeduction;
  let longTermRate = 0;
  let isRentalSpecial = false;
  let isMultiHouseSurcharge = false;
  const multiHouseCount = Number(p.multiHouseCount) || 0;
  let incomeAmount, longTermDeductionAmount, reconstructionDetail = null;

  if (isReconstruction) {
    // 소득세법시행령§166①②③ — 재개발·재건축 조합원이 기존건물과 그 부수토지를 제공하고 취득한
    // 조합원입주권(준공 전) 또는 신축주택(준공 후)을 청산금 납부하고 양도하는 경우의 양도차익 계산.
    const rightsValue = Number(p.rightsValue) || 0;
    const settlementPaid = Number(p.settlementPaid) || 0;
    const managementDispositionDate = p.managementDispositionDate;
    if (!rightsValue) return { error: '재건축·재개발 특례: 권리가액(종전자산평가액, rightsValue)이 필요합니다.' };
    if (!managementDispositionDate) return { error: '재건축·재개발 특례: 관리처분계획인가일(managementDispositionDate)이 필요합니다.' };

    // 소득세법시행령§166③ — 기존건물과 그 부수토지의 취득가액을 확인할 수 없는 경우의 환산(원문 확인 완료):
    // 평가액 × (취득일 현재 기존건물과 그 부수토지의 소득세법§99①1호에 따른 기준시가 ÷
    //           관리처분계획등인가일 현재 기존건물과 그 부수토지의 같은 호에 따른 기준시가)
    let originalAcqPrice = Number(p.originalAssetAcquisitionPrice) || 0;
    if (p.useConvertedRightsBaseAcquisitionPrice) {
      const acqStd = Number(p.originalAcquisitionStandardPrice) || 0;
      const apprStd = Number(p.approvalDateStandardPrice) || 0;
      if (acqStd > 0 && apprStd > 0) originalAcqPrice = Math.round(rightsValue * acqStd / apprStd);
    }
    const originalNecessaryExpenses = Number(p.originalNecessaryExpenses) || 0;

    // 관리처분계획등인가전양도차익 = (평가액-기존건물취득가액)-필요경비(§97①2·3호 또는 §163⑥)
    const gainBeforeApproval = (rightsValue - originalAcqPrice) - originalNecessaryExpenses;
    // 관리처분계획등인가후양도차익 = 양도가액-(평가액+납부한청산금)-필요경비(§97①2·3호)
    const gainAfterApproval = transferPrice - (rightsValue + settlementPaid) - necessaryExpenses;

    const holdingYearsBeforeApproval = fullYearsElapsed_(deemedAcquisitionDate_(p.acquisitionDate), managementDispositionDate);
    const holdingYearsSinceApproval = fullYearsElapsed_(managementDispositionDate, p.transferDate);

    if (!p.isCompletedNewHousing) {
      // ①1호 — 조합원입주권 자체를 준공 전 양도. §95②단서 "관리처분계획인가...전 토지분 또는 건물분의
      // 양도차익으로 한정"에 따라 장기보유특별공제는 인가전양도차익에만 적용되고, 인가후양도차익에는 전혀 적용되지 않는다.
      taxableGain = gainBeforeApproval + gainAfterApproval;
      const ltRateBefore = longTermHoldingDeductionRate_(holdingYearsBeforeApproval);
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
      const ltRateSettlement = longTermHoldingDeductionRate_(holdingYearsSinceApproval);
      const ltRateExisting = longTermHoldingDeductionRate_(holdingYears);
      longTermDeductionAmount = Math.round(Math.max(0, settlementPortionGain) * ltRateSettlement) + Math.round(Math.max(0, existingPortionGain) * ltRateExisting);
      incomeAmount = taxableGain - longTermDeductionAmount;
      reconstructionDetail = {
        구분: '신축주택(준공후) 양도 — §166②1호', 청산금납부분양도차익: Math.round(settlementPortionGain), 기존건물분양도차익: Math.round(existingPortionGain),
        청산금분_보유기간_년: holdingYearsSinceApproval, 청산금분_장특공제율: ltRateSettlement, 기존건물분_보유기간_년: holdingYears, 기존건물분_장특공제율: ltRateExisting
      };
      // §95③·시행령§160① — 신축주택은 문언상 "주택"이므로 고가주택(12억 초과)이면 §95①에 따른
      // 양도차익·§95②에 따른 장기보유특별공제액 모두에 "(양도가액-12억)/양도가액" 비율을 곱해
      // 12억 초과분에 해당하는 부분만 과세한다. 조합원입주권 자체(준공 전, 위 ①분기)의 고가조합원입주권
      // 특례는 위 isOneMemberRightOnly 분기에서 별도로 적용했다.
      if (transferPrice > 1200000000) {
        const highValueRatio = (transferPrice - 1200000000) / transferPrice;
        taxableGain = taxableGain * highValueRatio;
        longTermDeductionAmount = Math.round(longTermDeductionAmount * highValueRatio);
        incomeAmount = taxableGain - longTermDeductionAmount;
        reconstructionDetail.고가주택_12억초과비율 = highValueRatio;
      }
    }
    longTermRate = taxableGain !== 0 ? longTermDeductionAmount / taxableGain : 0;
  } else if (isPresaleRight) {
    // 소득세법§95②은 장기보유특별공제를 §94①1호 자산(부동산)과 조합원입주권에만 인정하고
    // 분양권은 열거하지 않으므로, 분양권은 보유기간과 무관하게 장특공제를 전혀 받지 못한다.
    longTermRate = 0;
  } else if (isOneHouse) {
    if (transferPrice <= 1200000000) {
      // 다운계약서(업계약서) 등 거짓 계약으로 비과세를 적용받은 경우(소득세법 §91②) —
      // MIN(비과세를 적용받지 않았다면 부과됐을 산출세액, 계약서 거래가액과 실지거래가액의 차액)만큼 비과세를 배제하고 추징한다.
      const downContractDiff = Number(p.downContractPriceDifference) || 0;
      if (downContractDiff > 0) {
        const wouldBeTaxResult = toolCalculateTransferTax(Object.assign({}, p, { isOneHouseOneFamily: false, downContractPriceDifference: 0 }));
        const wouldBeTax = (wouldBeTaxResult && typeof wouldBeTaxResult.납부세액_합계 === 'number') ? wouldBeTaxResult.납부세액_합계 : 0;
        const clawback = Math.min(wouldBeTax, downContractDiff);
        return {
          입력값: { 양도가액: transferPrice, 취득가액: acquisitionPrice, 필요경비: necessaryExpenses, 보유기간_년: holdingYears },
          비과세여부: false,
          다운계약서_비과세배제: true,
          비과세미적용시_산출세액: wouldBeTax,
          계약서_실거래_차액: downContractDiff,
          납부세액: clawback,
          납부세액_합계: clawback,
          안내: '다운계약서(업계약서) 등 거짓 계약으로 1세대1주택 비과세를 적용받은 것으로 전제했습니다(소득세법 §91②). 비과세를 적용받지 않았다면 부과됐을 세액(지방소득세 포함)과 계약서상 거래가액·실지거래가액 차액 중 작은 금액을 추징세액으로 계산했으며, 별도의 가산세·과태료는 포함하지 않았습니다.'
        };
      }
      return {
        입력값: { 양도가액: transferPrice, 취득가액: acquisitionPrice, 필요경비: necessaryExpenses, 보유기간_년: holdingYears },
        비과세여부: true,
        납부세액: 0,
        안내: '1세대1주택 비과세 요건 충족을 전제로, 양도가액이 12억원 이하이므로 전액 비과세입니다. 2년 이상 보유(조정대상지역은 거주요건 포함) 등 비과세 요건 자체는 이 도구가 검증하지 않으므로 별도로 반드시 확인하세요.'
      };
    }
    // 고가주택(12억 초과분)만 안분해서 과세
    taxableGain = gainBeforeDeduction * (transferPrice - 1200000000) / transferPrice;
    longTermRate = longTermHoldingDeductionRate1House_(holdingYears, Number(p.residenceYears) || 0);
  } else {
    longTermRate = longTermHoldingDeductionRate_(holdingYears);
  }

  if (!isReconstruction && !isPresaleRight) {
    // 장기임대주택 등 특례([별지 제84호서식] 코드04·05, 조특법 §97의3·§97의4) — 신청한 경우 위에서 계산한 일반/1세대1주택 공제율을 대체한다.
    const rentalRate = rentalLongTermHoldingDeductionRate_(p.rentalSpecialType, holdingYears, p.rentalYears);
    isRentalSpecial = rentalRate !== null;
    if (isRentalSpecial) longTermRate = rentalRate;

    // 다주택자 중과(소득세법 §104⑦, 조정대상지역 2주택 이상) — 적용되면 장기보유특별공제 자체가 배제된다.
    // (등록임대주택 장특공제 특례를 적용받는 주택은 다주택 수 계산에서 제외되는 것이 원칙이라 여기서는 중과 대상에서 제외한다.)
    isMultiHouseSurcharge = !isOneHouse && !isRentalSpecial && !!p.isAdjustedArea && multiHouseCount >= 2;
    if (isMultiHouseSurcharge) longTermRate = 0;
  }

  let rentalPeriodSplit = null;
  if (!isReconstruction) {
    // 조특법시행령§97의3⑤ — rental_general(§97의3)은 "임대기간중 발생한 양도차익"에 한정해 70%를 적용하고
    // 등록 전 기간분에는 일반 장특공제율을 적용한다(rental_long/§97의4는 법문상 전체 양도차익에 적용하므로 분리 안 함).
    const acqStd = Number(p.acquisitionStandardPrice) || 0;
    const regStd = Number(p.registrationStandardPrice) || 0;
    const trfStd = Number(p.transferStandardPrice) || 0;
    if (isRentalSpecial && p.rentalSpecialType === 'rental_general' && longTermRate > 0 && acqStd > 0 && regStd > 0 && trfStd > 0 && trfStd !== acqStd) {
      const rentalPeriodGain = taxableGain * (trfStd - regStd) / (trfStd - acqStd);
      const beforeRentalGain = taxableGain - rentalPeriodGain;
      const normalRate = longTermHoldingDeductionRate_(holdingYears);
      longTermDeductionAmount = Math.round(Math.max(0, rentalPeriodGain) * longTermRate + Math.max(0, beforeRentalGain) * normalRate);
      incomeAmount = taxableGain - longTermDeductionAmount;
      rentalPeriodSplit = { 임대기간중양도차익: Math.round(rentalPeriodGain), 임대전양도차익: Math.round(beforeRentalGain), 임대전적용공제율: normalRate };
    } else {
      longTermDeductionAmount = Math.round(taxableGain * longTermRate);
      incomeAmount = taxableGain - longTermDeductionAmount;
    }
  }
  const basicDeduction = 2500000;
  const taxBase = Math.max(0, incomeAmount - basicDeduction);

  let calculatedTax, appliedRateNote;
  const surchargeNotes = [];
  if (isPresaleRight) {
    // 소득세법§104①1호·2호·3호 — 분양권은 보유기간 1년 미만 70%, 1년 이상은 무조건 60%(기본세율 누진 적용 없음).
    const rate = holdingYears < 1 ? 0.70 : 0.60;
    calculatedTax = Math.round(taxBase * rate);
    appliedRateNote = '분양권 — ' + (holdingYears < 1 ? '보유기간 1년 미만 70%' : '60%') + ' 단일세율 적용(장기보유특별공제·기본세율누진 배제)';
  } else if (holdingYears < 1) {
    const shortRate = assetType === 'house' ? 0.70 : 0.50;
    calculatedTax = Math.round(taxBase * shortRate);
    appliedRateNote = '보유기간 1년 미만 단기세율 ' + (shortRate * 100) + '% 적용';
  } else if (holdingYears < 2) {
    const shortRate = assetType === 'house' ? 0.60 : 0.40;
    calculatedTax = Math.round(taxBase * shortRate);
    appliedRateNote = '보유기간 1년 이상 2년 미만 단기세율 ' + (shortRate * 100) + '% 적용';
  } else {
    calculatedTax = calcProgressiveTax_(taxBase, TRANSFER_TAX_BRACKETS);
    appliedRateNote = '보유기간 2년 이상 — 기본세율(누진 6~45%) 적용';
    // 세율가산 특례는 "기본세율+n%p" 구조라서, 과세표준×가산율을 그대로 더하면 결과가 같다
    // (구간마다 세율만 균일하게 오르면 누진공제 차이 없이 자동으로 이어짐). 단기세율 구간은
    // 이미 단기세율 자체가 가산 후 세율보다 크므로 가산을 생략하고 안내만 남긴다.
    if (isMultiHouseSurcharge) {
      const surchargeRate = multiHouseCount >= 3 ? 0.30 : 0.20;
      const surchargeAmount = Math.round(taxBase * surchargeRate);
      calculatedTax += surchargeAmount;
      surchargeNotes.push('다주택자 중과(+' + (surchargeRate * 100) + '%p): +' + surchargeAmount + '원');
    }
    if (p.isNonBusinessLand) {
      const surchargeAmount = Math.round(taxBase * 0.10);
      calculatedTax += surchargeAmount;
      surchargeNotes.push('비사업용토지 가산(+10%p): +' + surchargeAmount + '원');
    }
  }

  // 8년 자경농지(§69)·축사용지(§69의2)·어업용토지(§69의3)·농지대토(§70) 감면 — 전부 요건 충족시
  // 산출세액 100% 감면이다. §133①1호·2호나목에 따라 §66~§70(§69의2~69의4 포함) 감면세액은 전부
  // 합쳐 과세기간당 1억원·5개 과세기간 합산 2억원 한도를 공유한다(5년 합산은 여러 건에 걸친 것이라
  // 이 도구가 추적하지 않음).
  let farmlandReduction = 0;
  let farmlandReductionLabel = '';
  if (p.isEightYearFarmland || p.isLivestockLandExempt || p.isFisheryLandExempt || p.isFarmlandSubstitutionExempt) {
    farmlandReduction = Math.min(calculatedTax, 100000000);
    calculatedTax -= farmlandReduction;
    farmlandReductionLabel = p.isEightYearFarmland ? '8년 자경농지 감면(조특법§69)'
      : p.isLivestockLandExempt ? '축사용지 감면(조특법§69의2)'
      : p.isFisheryLandExempt ? '어업용토지 감면(조특법§69의3)'
      : '농지대토 감면(조특법§70)';
  } else if (p.isForestManagementExempt) {
    // 조특법§69의4① — 10년 이상 직접 경영해야 하며(미만이면 감면 없음), 경영기간 구간별로 감면율이
    // 다르다: 10~20년 10%, 20~30년 20%, 30~40년 30%, 40~50년 40%, 50년 이상 50%.
    const forestRate_ = forestManagementYears >= 50 ? 0.50 : forestManagementYears >= 40 ? 0.40
      : forestManagementYears >= 30 ? 0.30 : forestManagementYears >= 20 ? 0.20
      : forestManagementYears >= 10 ? 0.10 : 0;
    if (forestRate_ > 0) {
      farmlandReduction = Math.min(Math.round(calculatedTax * forestRate_), 100000000);
      calculatedTax -= farmlandReduction;
      farmlandReductionLabel = '자경산지 감면(조특법§69의4, 경영기간 ' + forestManagementYears + '년 — ' + Math.round(forestRate_ * 100) + '%)';
    }
  }

  // 공익사업용 토지 등 수용감면(조특법 §77①, 2025.3.14 개정) — 현금보상 15%, 채권보상 20%(3년만기특약 35%, 5년만기특약 45%).
  // §77의2(대토보상, 2026.12.31까지 양도분) — 40% 감면(과세이연 선택지는 향후 재양도시까지 세액을
  // 이연하는 별도 구조라 이 도구는 감면 선택만 계산한다).
  // §77의3(개발제한구역 매수, 2028.12.31까지 양도분) — 지정일 이전 취득분 40%, 매수청구·사업인정고시일로부터
  // 20년 이전 취득분 25%.
  const COMPENSATION_REDUCTION_RATES_ = {
    cash: 0.15, bond: 0.20, bond_3y: 0.35, bond_5y: 0.45,
    land_replacement: 0.40,
    restricted_zone_40: 0.40, restricted_zone_25: 0.25
  };
  let compensationReduction = 0;
  let compensationReductionLabel = '';
  if (COMPENSATION_REDUCTION_RATES_[p.compensationType] !== undefined) {
    const compRaw_ = Math.round(calculatedTax * COMPENSATION_REDUCTION_RATES_[p.compensationType]);
    // 조특법§133②(2025.3.14 신설) — §77·§77의2·§77의3 감면세액 합계가 과세기간별 2억원을 초과하는
    // 부분은 감면하지 아니한다(5개 과세기간 합산 3억원 한도는 여러 건에 걸친 것이라 이 도구가
    // 추적하지 않음).
    compensationReduction = Math.min(compRaw_, 200000000);
    calculatedTax -= compensationReduction;
    compensationReductionLabel = (p.compensationType === 'land_replacement') ? '대토보상 감면(조특법§77의2)'
      : (p.compensationType === 'restricted_zone_40' || p.compensationType === 'restricted_zone_25') ? '개발제한구역 매수 감면(조특법§77의3)'
      : '공익사업용토지 수용감면(조특법§77①)';
  }

  // 다운계약서(업계약서) 등 거짓 계약으로 위 감면을 적용받은 경우(소득세법 §91②) —
  // MIN(감면세액 합계, 계약서 거래가액과 실지거래가액의 차액)만큼 감면을 배제하고 추징한다.
  const downContractDiff = Number(p.downContractPriceDifference) || 0;
  let downContractClawback = 0;
  if (downContractDiff > 0 && (farmlandReduction + compensationReduction) > 0) {
    downContractClawback = Math.min(farmlandReduction + compensationReduction, downContractDiff);
    calculatedTax += downContractClawback;
  }

  // 감정가액·환산취득가액 가산세(소득세법§114의2①) — 신축 또는 증축(85㎡ 초과분만)한 건물을 취득일·
  // 증축일로부터 5년 이내에 양도하면서 그 취득가액을 감정가액 또는 환산취득가액으로 한 경우, 두 방법
  // 모두 동일하게 해당 건물분 가액의 5%를 가산세로 부과한다(§114의2②에 따라 산출세액이 0이어도 적용).
  const convertedBuildingAcquisitionValueForPenalty = Number(p.convertedBuildingAcquisitionValueForPenalty) || 0;
  const conversionValuePenalty = (p.isNewBuildingWithin5Years && convertedBuildingAcquisitionValueForPenalty > 0)
    ? Math.round(convertedBuildingAcquisitionValueForPenalty * 0.05) : 0;

  // 연금계좌세액공제(조특법 §99의13, [별지 제63호의32서식]) — 부동산 양도대금을 양도일로부터 6개월 이내
  // 연금계좌에 납입하면 MIN(연금계좌납입액, 양도차익, 1억원)×10%를 세액공제한다.
  const pensionContribution = Number(p.pensionAccountContribution) || 0;
  const pensionCreditBase = Math.min(pensionContribution, Math.max(0, Math.round(gainBeforeDeduction)), 100000000);
  const pensionAccountCredit = pensionContribution > 0 ? Math.round(pensionCreditBase * 0.1) : 0;

  // 전자신고세액공제(조특법 §104의8①) — 납세자 본인이 직접 전자신고하면 2만원 정액공제(세무대리인 대리신고 시 미적용)
  const eFilingCredit = p.isSelfElectronicFiling ? Math.min(20000, Math.max(0, calculatedTax - pensionAccountCredit)) : 0;

  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const penalties = giftFilingPenalties_(calculatedTax, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

  // 지방소득세(개인지방소득세, 지방세법)는 국세 산출세액(가산세 제외)의 10%가 원칙이며, 가산세에는 부가되지 않는다.
  const localIncomeTax = Math.round(calculatedTax * 0.1);
  const totalTax = Math.max(0, calculatedTax - pensionAccountCredit - eFilingCredit + conversionValuePenalty
    + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax);

  return {
    입력값: {
      양도가액: transferPrice, 취득가액: acquisitionPrice, 필요경비: necessaryExpenses,
      보유기간_년: holdingYears, 자산종류: assetType === 'house' ? '주택·조합원입주권' : '그 외',
      '1세대1주택_전제': isOneHouse, 다주택중과_전제: isMultiHouseSurcharge, 비사업용토지_전제: !!p.isNonBusinessLand, '8년자경농지감면_전제': !!p.isEightYearFarmland,
      신고상태: filingStatus
    },
    조합원입주권_재건축상세: reconstructionDetail,
    양도차익: Math.round(reconstructionDetail ? taxableGain : gainBeforeDeduction),
    과세대상양도차익: Math.round(taxableGain),
    장기보유특별공제율: longTermRate,
    장기보유특별공제액: longTermDeductionAmount,
    양도소득금액: Math.round(incomeAmount),
    기본공제: basicDeduction,
    과세표준: taxBase,
    적용세율_설명: appliedRateNote,
    세율가산_내역: surchargeNotes,
    자경농지감면액: farmlandReduction,
    자경농지감면_구분: farmlandReductionLabel,
    수용감면액: compensationReduction,
    수용감면_구분: compensationReductionLabel,
    다운계약서_감면배제_추징액: downContractClawback,
    장기임대주택특례_적용여부: isRentalSpecial, 장기임대주택특례_임대기간중분리상세: rentalPeriodSplit,
    산출세액: calculatedTax,
    연금계좌세액공제: pensionAccountCredit,
    전자신고세액공제: eFilingCredit,
    환산취득가액가산세: conversionValuePenalty,
    무신고가산세: penalties.unreportedPenalty,
    과소신고가산세: penalties.underreportedPenalty,
    납부지연가산세: penalties.latePenalty,
    지방소득세: localIncomeTax,
    납부세액_합계: totalTax,
    안내: '배우자·직계존비속에게 증여받은 자산을 10년 이내 양도하는 경우(이월과세, 소득세법§97의2)는 이 도구가 아니라 calculate_transfer_tax_with_carryover을 써야 합니다. ' +
      '기본공제 250만원은 해당 과세기간 중 다른 양도가 없다고 가정한 값입니다. 다주택자 중과는 조정대상지역 지정 현황·한시 배제 여부가 시행령으로 수시로 바뀌므로 반드시 최신 여부를 확인하고 isAdjustedArea를 넣으세요. 8년자경농지 감면은 5년 합산 2억원 한도를 이 도구가 추적하지 않으니 다른 감면 이력과 합산해서 확인하세요. 부담부증여로 취득한 자산의 양도, 가업상속공제 관련 특례 등은 포함되지 않았습니다. 지방소득세(10%)는 가산세를 제외한 산출세액을 기준으로 계산했습니다 — 지방세 자체의 가산세는 별도이니 이 도구가 계산하지 않습니다.'
  };
}

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
function toolCalculateTransferTaxWithCarryover(p) {
  p = p || {};
  const giftReceivedDate = p.giftReceivedDate;
  const donorRelation = p.donorRelation; // 'spouse' | 'lineal'
  const isEligibleRelation = donorRelation === 'spouse' || donorRelation === 'lineal';
  const yearsSinceGift = (giftReceivedDate && p.transferDate) ? fullYearsElapsed_(giftReceivedDate, p.transferDate) : Infinity;
  const isWithinWindow = yearsSinceGift < 10 || (yearsSinceGift === 10 && giftReceivedDate === p.transferDate);
  const isEminentDomainExcluded = !!p.isEminentDomainExcludedFromCarryover; // §97의2②1호

  const withoutCarryoverParams = Object.assign({}, p, {
    acquisitionPrice: Number(p.doneeOwnAcquisitionPrice) || 0,
    acquisitionDate: giftReceivedDate,
    necessaryExpenses: Number(p.doneeOwnNecessaryExpenses) || 0
  });
  const withoutResult = toolCalculateTransferTax(withoutCarryoverParams);

  if (!isEligibleRelation || !isWithinWindow || isEminentDomainExcluded) {
    if (withoutResult && !withoutResult.error) {
      withoutResult.이월과세_적용여부 = false;
      withoutResult.이월과세_미적용사유 = !isEligibleRelation ? '배우자·직계존비속으로부터의 증여가 아님'
        : (!isWithinWindow ? '증여일로부터 10년 경과' : '수용 특례(§97의2②1호) 해당');
    }
    return withoutResult;
  }

  const donorAcqPrice = Number(p.donorAcquisitionPrice) || 0;
  const donorNecessaryExpenses = Number(p.donorNecessaryExpenses) || 0;
  const giftTaxPaid = Number(p.giftTaxPaid) || 0;
  const giftTaxableValue = Number(p.giftTaxableValue) || 0;
  const assetGiftTaxableValue = Number(p.doneeOwnAcquisitionPrice) || 0;
  const giftTaxEquivalent = giftTaxableValue > 0 ? Math.round(giftTaxPaid * assetGiftTaxableValue / giftTaxableValue) : 0;
  const necessaryExpenseCap = Math.max(0, (Number(p.transferPrice) || 0) - donorAcqPrice - donorNecessaryExpenses);
  const cappedGiftTaxEquivalent = Math.min(giftTaxEquivalent, necessaryExpenseCap);

  const withCarryoverParams = Object.assign({}, p, {
    acquisitionPrice: donorAcqPrice,
    acquisitionDate: p.donorAcquisitionDate,
    necessaryExpenses: donorNecessaryExpenses + cappedGiftTaxEquivalent
  });
  const withResult = toolCalculateTransferTax(withCarryoverParams);

  const withBecomesExempt = !!(withResult && withResult.비과세여부);
  if (withBecomesExempt) {
    if (withoutResult && !withoutResult.error) { withoutResult.이월과세_적용여부 = false; withoutResult.이월과세_미적용사유 = '§97의2②2호 — 이월과세 적용시 1세대1주택 등 비과세 대상이 되어 배제'; }
    return withoutResult;
  }

  const withTax = (withResult && typeof withResult.납부세액_합계 === 'number') ? withResult.납부세액_합계 : (withResult && withResult.비과세여부 ? 0 : Infinity);
  const withoutTax = (withoutResult && typeof withoutResult.납부세액_합계 === 'number') ? withoutResult.납부세액_합계 : (withoutResult && withoutResult.비과세여부 ? 0 : Infinity);

  const chosen = withTax < withoutTax ? withoutResult : withResult;
  if (chosen && !chosen.error) {
    chosen.이월과세_적용여부 = chosen === withResult;
    if (chosen !== withResult) chosen.이월과세_미적용사유 = '§97의2②3호 — 이월과세를 적용한 세액(' + withTax + '원)이 미적용시 세액(' + withoutTax + '원)보다 적어 미적용';
    chosen.이월과세_비교 = { 적용시_세액: withTax, 미적용시_세액: withoutTax, 증여세상당액_필요경비산입: cappedGiftTaxEquivalent };
  }
  return chosen;
}

// 혼인·출산 증여재산공제 (상증세법 §53의2, 2024.1.1. 이후 증여분부터) — 혼인일 전후 2년(또는
// 출생일·입양일부터 2년) 이내 증여받은 재산에 대해 혼인·출산을 합쳐 평생통산 1억원 한도로 공제.
// 10년마다 리셋되는 일반 증여재산공제와 달리 한 번 쓰면 끝나는 한도라, 이미 쓴 금액을 그대로 차감한다.
function marriageOrBirthGiftDeduction_(eligibleGiftAmount, priorUsedAmount) {
  const remaining = Math.max(0, 100000000 - (Number(priorUsedAmount) || 0));
  return Math.min(Math.max(0, Number(eligibleGiftAmount) || 0), remaining);
}

// 무신고·과소신고·납부지연가산세 (국세기본법 §47의2~§47의4) — 일반 20%/10%, 부정행위 40%,
// 납부지연은 1일 10만분의22(2022.2.15. 이후 세율 기준, 시행령 개정 시 바뀔 수 있으니 확인 필요).
function giftFilingPenalties_(taxAfterCredit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxOverride) {
  let unreportedPenalty = 0, underreportedPenalty = 0;
  if (filingStatus === 'unreported') {
    unreportedPenalty = Math.round(taxAfterCredit * (isFraudulent ? 0.40 : 0.20));
  } else if (filingStatus === 'underreported') {
    underreportedPenalty = Math.round((Number(underreportedTaxAmount) || 0) * (isFraudulent ? 0.40 : 0.10));
  }
  const base = Number.isFinite(unpaidTaxOverride) ? unpaidTaxOverride : taxAfterCredit;
  const latePenalty = Math.round(base * (Number(unpaidDays) || 0) * 0.00022);
  return { unreportedPenalty, underreportedPenalty, latePenalty };
}

function toolCalculateGiftTax(p) {
  p = p || {};
  const giftAmount = Number(p.giftAmount);
  if (!giftAmount || giftAmount <= 0) return { error: '증여재산가액(giftAmount)이 필요합니다.' };
  const relation = p.relation;
  if (['배우자', '직계존속', '직계비속', '기타친족', '기타'].indexOf(relation) === -1) {
    return { error: 'relation은 "배우자", "직계존속", "직계비속", "기타친족", "기타" 중 하나여야 합니다.' };
  }
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const isGenerationSkip = !!p.isGenerationSkip;
  const generationSkipOver2Billion = !!p.generationSkipOver2Billion;
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;

  // 부담부증여(수증자가 증여자의 채무를 인수) — 인수한 채무액은 증여세 과세가액에서 제외된다.
  // 대신 그 채무액에 상당하는 부분은 증여자에게 "양도"로 과세되므로, 필요하면 calculate_transfer_tax를
  // (양도가액 = 증여재산가액×채무액/증여재산가액, 취득가액도 같은 비율로 안분해서) 별도로 호출해야 한다.
  // §47③ — 배우자간 또는 직계존비속간 부담부증여는 채무를 인수했더라도 "인수되지 않은 것"으로
  // 추정한다(원칙적으로 채무 공제 불가). 국가·지자체 채무 등 객관적으로 인수 사실이 인정되는
  // 채무만 예외적으로 공제 가능(isDebtObjectivelyProven).
  const isCloseRelationBurdenGift = (relation === '배우자' || relation === '직계존속' || relation === '직계비속');
  const debtDeductionDenied = isCloseRelationBurdenGift && !p.isDebtObjectivelyProven;
  const debtAssumedAmount = debtDeductionDenied ? 0 : Math.min(Number(p.debtAssumedAmount) || 0, giftAmount);
  // 비과세재산가액(§46)·공익법인등출연재산가액(§48)·공익신탁재산가액(§52)·장애인신탁재산가액(§52의2) — 모두 과세가액 불산입.
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
    relationDeduction = Math.max(0, giftPropertyDeduction_(relation, !!p.isMinor) - (Number(p.priorRelationDeductionUsed) || 0));
    marriageBirthDeduction = (p.isMarriageGift || p.isBirthGift)
      ? marriageOrBirthGiftDeduction_(netGiftAmount, p.priorMarriageOrBirthDeductionUsed) : 0;
    disasterLossDeduction = Number(p.disasterLossAmount) || 0;
    const totalDeduction = relationDeduction + marriageBirthDeduction + appraisalFeeDeduction + disasterLossDeduction;
    taxBase = Math.max(0, netGiftAmount + priorGiftAmount - totalDeduction);
  }
  const taxBeforePremium = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);

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
  const premiumRate = isGenerationSkip ? (generationSkipOver2Billion ? 0.4 : 0.3) : 0;
  const priorPaidGenerationSkipPremium = Number(p.priorPaidGenerationSkipPremium) || 0;
  const premiumAmount = Math.max(0, Math.round(taxBeforePremium * generationSkipRatio * premiumRate) - priorPaidGenerationSkipPremium);
  const taxAfterPremium = taxBeforePremium + premiumAmount;

  // 외국납부세액공제(§59), 그 밖의 공제·감면세액(조특법상 각종 감면 등 — 세액 산출 자체는 별도로 계산해서 이 값에 넣어야 한다).
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const otherCreditsAmount = Number(p.otherCreditsAmount) || 0;
  const taxAfterPriorCredit = Math.max(0, taxAfterPremium - priorPaidTax - foreignTaxPaidAmount - otherCreditsAmount);
  const reportCredit = reportedInTime ? Math.round(taxAfterPriorCredit * 0.03) : 0;
  const taxAfterCredit = taxAfterPriorCredit - reportCredit;

  const penalties = giftFilingPenalties_(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

  // 이자상당액(각종 사후관리 위반 시 추징세액에 붙는 이자), 공익법인등관련가산세(§78) — 해당 사안일 때만 별도로 계산해서 더한다.
  const interestAmount = Number(p.interestAmount) || 0;
  const publicInterestOrgPenalty = Number(p.publicInterestOrgPenalty) || 0;
  // 박물관자료등징수유예세액, 가업승계납부유예세액(조특법§30의6) — 유예된 세액은 이번 신고 시 납부할 세액에서 뺀다.
  const museumDeferredTaxAmount = Number(p.museumDeferredTaxAmount) || 0;
  const businessSuccessionDeferredTaxAmount = Number(p.businessSuccessionDeferredTaxAmount) || 0;
  // 영농자녀 증여농지등 세액감면(조특법§71, [별지 제52호서식]) — 자경농민이 8년 이상 자경한 농지·초지·산림지를 영농자녀에게 증여할 때 감면.
  // 감면요건(자경기간·계속영농 등)과 한도액 산정은 이 도구가 하지 않으므로, 관할세무서에 신청해 확정된(또는 별도로 계산한) 감면세액을 그대로 입력해야 한다.
  const farmlandGiftTaxExemptionAmount = Number(p.farmlandGiftTaxExemptionAmount) || 0;

  const finalTax = Math.max(0, taxAfterCredit + interestAmount + publicInterestOrgPenalty
    + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
    - museumDeferredTaxAmount - businessSuccessionDeferredTaxAmount - farmlandGiftTaxExemptionAmount);

  return {
    입력값: {
      증여재산가액: giftAmount, 인수채무액: debtAssumedAmount, 관계: relation, 미성년자여부: !!p.isMinor, '10년내_동일인_기증여합산액': priorGiftAmount, 세대생략여부: isGenerationSkip, 신고상태: filingStatus,
      채무공제_배제여부: debtDeductionDenied,
      채무공제_배제사유: debtDeductionDenied ? '§47③ 배우자·직계존비속간 부담부증여는 채무 인수를 객관적으로 입증(국가·지자체 채무 등)하지 못하면 인수되지 않은 것으로 추정 — 채무액이 공제에서 제외됨' : '',
      수증자: { 성명: p.doneeName || '', 주민등록번호: p.doneeRegNo || '', 주소: p.doneeAddress || '' },
      증여자: { 성명: p.donorName || '', 주민등록번호: p.donorRegNo || '', 주소: p.donorAddress || '', 증여일자: p.giftDate || '' }
    },
    비과세재산가액: nonTaxableAmount,
    공익법인출연재산가액: publicInterestOrgAmount,
    공익신탁재산가액: publicTrustAmount,
    장애인신탁재산가액: disabledTrustAmount,
    순수증여재산가액: netGiftAmount,
    증여재산공제: relationDeduction,
    혼인출산증여재산공제: marriageBirthDeduction,
    합산배제증여재산공제: aggregationExclusionDeduction,
    감정평가수수료공제: appraisalFeeDeduction,
    재해손실공제: disasterLossDeduction,
    과세표준: taxBase,
    산출세액_할증전: taxBeforePremium,
    세대생략할증_적용비율: isGenerationSkip ? generationSkipRatio : null,
    세대생략할증액: premiumAmount,
    산출세액_할증후: taxAfterPremium,
    기납부세액공제: Math.min(priorPaidTax, taxAfterPremium),
    외국납부세액공제: foreignTaxPaidAmount,
    그밖의공제감면세액: otherCreditsAmount,
    신고세액공제: reportCredit,
    이자상당액: interestAmount,
    공익법인등관련가산세: publicInterestOrgPenalty,
    무신고가산세: penalties.unreportedPenalty,
    과소신고가산세: penalties.underreportedPenalty,
    납부지연가산세: penalties.latePenalty,
    박물관자료등징수유예세액: museumDeferredTaxAmount,
    가업승계납부유예세액: businessSuccessionDeferredTaxAmount,
    영농자녀증여농지세액감면: farmlandGiftTaxExemptionAmount,
    납부세액: finalTax,
    안내: (debtAssumedAmount > 0
      ? '부담부증여로 전제해 인수채무액 ' + debtAssumedAmount + '원을 증여재산가액에서 제외했습니다 — 이 채무액에 상당하는 부분은 증여자에게 별도로 양도소득세가 과세되니 calculate_transfer_tax로 반드시 함께 계산하세요. '
      : '') +
      '10년 이내 동일인(직계존속 증여는 그 배우자 포함)으로부터 받은 기증여재산은 합산과세 대상입니다. priorGiftAmount·priorPaidTax를 정확히 넣지 않으면 결과가 부정확할 수 있으니 사안별로 재확인하세요. ' +
      '혼인·출산 증여재산공제는 혼인일 전후 2년(출산은 출생·입양일부터 2년) 이내 증여인지 사안별로 확인하세요. 납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있으니 신고 시점 기준으로 재확인하세요. ' +
      '가업승계납부유예세액·박물관자료등징수유예세액·이자상당액·공익법인등관련가산세는 해당 사안일 때만 직접 계산해서 넣어야 하는 값이며, 창업자금·가업승계 증여세 과세특례(조특법 §30의5·6)의 세액 자체는 이 도구가 계산하지 않는다 — 해당 특례를 적용받는 경우 그 부분은 별도로 계산해서 이 결과와 합산하세요.'
  };
}

function toolCalculateInheritanceTax(p) {
  p = p || {};
  const taxableEstateAmount = Number(p.taxableEstateAmount);
  if (!taxableEstateAmount || taxableEstateAmount <= 0) return { error: '상속세 과세가액(taxableEstateAmount — 총상속재산가액에서 공과금·장례비용·채무를 빼고 10년 이내 사전증여재산을 가산해 이미 반영한 금액. 상속개시전 처분재산 추정액은 포함하지 말 것 — disposalPresumptionItems로 넣으면 자동으로 더해진다)이 필요합니다.' };

  // 상속개시전 처분재산 등 산입액(§15) — 재산종류별(현금·예금·유가증권/부동산/기타재산, 부담채무)로 각각 계산해 합산한다.
  const disposalItems = Array.isArray(p.disposalPresumptionItems) ? p.disposalPresumptionItems : [];
  const disposalPresumptionDetail = disposalItems.map(function (item) {
    return {
      구분: item.category || '',
      '1년이내_인출액': Number(item.oneYearAmount) || 0, '2년이내_인출액': Number(item.twoYearAmount) || 0,
      추정상속재산가액: presumedInheritedFromDisposal_(item)
    };
  });
  const disposalPresumptionTotal = disposalPresumptionDetail.reduce(function (s, d) { return s + d.추정상속재산가액; }, 0);
  // 비과세되는 상속재산(§12 — 국가등 유증재산, 금양임야·묘토, 족보·제구 등)·과세가액 불산입재산(§16 — 공익법인 출연재산, 공익신탁재산)은
  // taxableEstateAmount에 아직 반영되지 않은 금액을 여기서 입력받아 차감한다.
  const nonTaxableAmount = Number(p.nonTaxableAmount) || 0;
  const publicInterestOrgAmount = Number(p.publicInterestOrgAmount) || 0;
  const publicTrustAmount = Number(p.publicTrustAmount) || 0;
  const effectiveEstateAmount = Math.max(0, taxableEstateAmount - nonTaxableAmount - publicInterestOrgAmount - publicTrustAmount) + disposalPresumptionTotal;

  const hasSpouse = !!p.hasSpouse;
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
  const basicOrLumpSum = isDecedentResident ? basicOrLumpSumInheritanceDeduction_(personalDeduction, filingStatus === 'unreported') : 200000000;

  // 배우자상속공제 한도액 ([별지 제9호서식] 부표3의2): {(상속재산의 가액-유증재산가액+10년내 상속인증여재산)×배우자법정상속분비율} - 배우자의 사전증여 과세표준
  const estateValueForSpouseLimit = effectiveEstateAmount - (Number(p.priorGiftedAmountIncludedInEstate) || 0);
  const spouseLimit = spouseInheritanceLimit_(estateValueForSpouseLimit, p.nonHeirBequestAmount, p.giftToHeirsWithin10Years, Number(p.spouseLegalShareRatio) || 0, p.spouseTaxableBaseOfPriorGift);
  const spouseDeduction = (isDecedentResident && hasSpouse) ? spouseInheritanceDeduction_(p.spouseActualInheritedAmount, spouseLimit) : 0;

  // 금융재산상속공제 (상증세법 §22)
  const financialDeduction = isDecedentResident ? financialAssetInheritanceDeduction_(p.netFinancialAssets) : 0;

  // 동거주택상속공제 (상증세법 §23-2) — 10년 이상 동거·무주택 등 요건 충족을 전제(요건 자체는 이 도구가 검증하지 않음). 상속주택가액의 100%, 6억원 한도.
  const cohabitingHouseDeduction = (isDecedentResident && p.hasCohabitingHouseDeduction) ? Math.min(Number(p.cohabitingHouseValue) || 0, 600000000) : 0;

  // 감정평가수수료공제 (상증세법 §25) — 부동산 감정평가수수료 등, 500만원 한도(원칙, 유형별 세부한도는 별도)
  const appraisalFeeDeduction = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);

  // 재해손실공제 (상증세법 §23) — 신고기한 이내 재난으로 멸실·훼손된 상속재산가액
  const disasterLossDeduction = isDecedentResident ? (Number(p.disasterLossAmount) || 0) : 0;

  // 가업상속공제(§18의2, 최대 600억)·영농상속공제(§18의3, 최대 30억) — 상세 자산내역([별지 제1호서식]/[별지 제2호서식] 기준)이 있으면 자동계산하고,
  // 없으면 별도로 계산한 최종 공제액(businessInheritanceDeduction/farmingInheritanceDeduction)을 그대로 쓴다. 자격요건(가업 종사기간·최대주주 여부 등) 판정은 이 도구가 하지 않는다.
  const businessInheritanceDetail_ = isDecedentResident ? businessInheritanceDeductionDetailed_(p) : null;
  const businessInheritanceDeduction = isDecedentResident ? (businessInheritanceDetail_ ? businessInheritanceDetail_.deductionAmount : (Number(p.businessInheritanceDeduction) || 0)) : 0;
  const farmingInheritanceDetail_ = isDecedentResident ? farmingInheritanceDeductionDetailed_(p) : null;
  const farmingInheritanceDeduction = isDecedentResident ? (farmingInheritanceDetail_ ? farmingInheritanceDetail_.deductionAmount : (Number(p.farmingInheritanceDeduction) || 0)) : 0;

  // 장례비용공제(§14①3호) — 실제 지출액 증빙이 없으면 500만원, 있으면 500만~1000만원 범위에서 인정.
  // 봉안시설·자연장지 사용금액은 별도로 500만원 한도까지 추가 공제. (비거주자는 위 안내대로 전액 불가)
  const funeralCostInput = Number(p.funeralCostAmount) || 0;
  const funeralGeneralDeduction = !isDecedentResident ? 0 : (funeralCostInput > 0 ? Math.min(Math.max(funeralCostInput, 5000000), 10000000) : 5000000);
  const funeralNicheDeduction = isDecedentResident ? Math.min(Number(p.funeralNicheCostAmount) || 0, 5000000) : 0;
  const funeralDeduction = funeralGeneralDeduction + funeralNicheDeduction;

  let totalDeduction = basicOrLumpSum + spouseDeduction + financialDeduction + cohabitingHouseDeduction + appraisalFeeDeduction + disasterLossDeduction
    + funeralDeduction + businessInheritanceDeduction + farmingInheritanceDeduction;

  // 사전증여재산 상속인별 상세(§28②·시행령§3①1호 정밀계산 및 §24 종합한도 분모에 공통 사용) — 상속인별로
  // 입력된 사전증여 내역을 그대로 쓴다(배우자분만이 아니라 전체 합계를 쓴다, §24).
  const priorGiftHeirs = Array.isArray(p.priorGiftHeirs) ? p.priorGiftHeirs : [];
  const priorGiftTaxableBaseTotal = priorGiftHeirs.reduce(function (s, h) { return s + (Number(h.priorGiftTaxableBase) || 0); }, 0);

  // 상속공제 종합한도액 (상증세법 §24) — 공제 총액은 무제한이 아니라
  // "상속세과세가액 - 상속인 아닌 자 유증재산가액 - 상속인의 사전증여재산 과세표준상당액 - 상속포기로 다음 순위가 받은 재산가액" 한도 내에서만 인정된다.
  // 해당 입력을 생략하면(모두 0) 사실상 과세가액 전체가 한도가 되어 예전처럼 제한 없이 동작한다.
  const overallDeductionLimit = Math.max(0, effectiveEstateAmount
    - (Number(p.nonHeirBequestAmount) || 0)
    - priorGiftTaxableBaseTotal
    - (Number(p.disclaimedShareRedistributedAmount) || 0));
  const overallLimitApplied = totalDeduction > overallDeductionLimit;
  if (overallLimitApplied) totalDeduction = overallDeductionLimit;

  const taxBase = Math.max(0, effectiveEstateAmount - totalDeduction);
  let calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);

  // 세대생략가산액 (상증세법 §27) — 상속인이 아닌 직계비속(예: 손자녀)이 상속·유증받는 경우,
  // 그 상속인이 받는 재산 비율에 해당하는 산출세액에 할증(30%, 미성년자 20억 초과분은 40%)한다.
  const generationSkipHeirRatio = Math.max(0, Math.min(1, Number(p.generationSkipHeirRatio) || 0));
  const generationSkipPremiumRate = p.generationSkipOver2Billion ? 0.4 : 0.3;
  const generationSkipPremium = Math.round(calculatedTax * generationSkipHeirRatio * generationSkipPremiumRate);
  calculatedTax += generationSkipPremium;

  // §28 증여세액공제 — 상속인별 정밀 계산(위 priorGiftTaxCreditPrecise_ 참고).
  const priorGiftCreditResult = priorGiftTaxCreditPrecise_(calculatedTax, taxBase, effectiveEstateAmount, priorGiftHeirs);
  const priorGiftTaxCredit = priorGiftCreditResult.totalCredit;
  const giftCreditExcludedBySmallEstate = priorGiftCreditResult.excludedBySmallEstate;
  // 특례증여세액공제(조특법§30의5·6, 창업자금·가업승계 증여세 과세특례분) — 세액 자체는 이 도구가 계산하지 않으므로 별도로 계산한 값을 입력한다.
  const specialGiftTaxCredit = Math.min(Number(p.specialGiftTaxCredit) || 0, Math.max(0, calculatedTax - priorGiftTaxCredit));
  // 외국납부세액공제 (상증세법 §29) — 국외재산에 대해 외국에서 이미 낸 상속세.
  const foreignTaxCredit = Math.min(Number(p.foreignTaxPaidAmount) || 0, Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit));
  // 단기재상속세액공제 (상증세법 §30) — 10년 이내 재상속 시 전의 상속세 중 이번 상속재산 해당분에 경과연수별 공제율 적용.
  const shortTermReinheritanceCredit = Math.min(
    shortTermReinheritanceCredit_(p.priorInheritanceTax, p.reinheritedPropertyValue, p.priorInheritanceTotalPropertyValue, p.priorInheritanceTaxableBase, p.yearsSincePriorInheritance),
    Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit)
  );
  const otherCreditsAmount = Math.min(Number(p.otherCreditsAmount) || 0,
    Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit - shortTermReinheritanceCredit));

  const taxAfterCredits = Math.max(0, calculatedTax - priorGiftTaxCredit - specialGiftTaxCredit - foreignTaxCredit - shortTermReinheritanceCredit - otherCreditsAmount);
  const reportCredit = reportedInTime ? Math.round(taxAfterCredits * 0.03) : 0;
  const taxAfterReportCredit = taxAfterCredits - reportCredit;

  const penalties = giftFilingPenalties_(taxAfterReportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

  // 이자상당액(사후관리 위반 추징 시), 영리법인 상속세 면제(상증세법 §3의2) — 영리법인이 유증받으면 그 법인의 상속세는 면제되지만,
  // 상속인 및 직계비속이 최대주주 등인 경우 그 지분 상당액만큼은 상속인이 납부할 의무를 진다: (면제세액 - 유증재산가액×10%) × 지분비율.
  const interestAmount = Number(p.interestAmount) || 0;
  const forProfitBequestAmount = Number(p.forProfitBequestAmount) || 0;
  const forProfitExemptedTaxAmount = Number(p.forProfitExemptedTaxAmount) || 0;
  const forProfitHeirShareRatio = Math.max(0, Math.min(1, Number(p.forProfitHeirShareRatio) || 0));
  const forProfitPayableByHeirs = Math.max(0, Math.round((forProfitExemptedTaxAmount - forProfitBequestAmount * 0.10) * forProfitHeirShareRatio));
  // 문화재등징수유예세액, 가업상속납부유예세액 — 유예된 세액은 이번 신고 시 납부할 세액에서 뺀다.
  const culturalPropertyDeferredTaxAmount = Number(p.culturalPropertyDeferredTaxAmount) || 0;
  const businessInheritanceDeferredTaxAmount = Number(p.businessInheritanceDeferredTaxAmount) || 0;

  // 가업상속 납부유예(§72의2, [별지 제12호의2서식]) — 가업상속공제와 별개로 선택 가능한 제도로, 납부유예 가능세액을 참고용으로 계산한다.
  // 실제로 유예받으려면 그 금액을 businessInheritanceDeferredTaxAmount에 별도로 입력해야 최종세액에서 차감된다(이 도구가 자동으로 적용하지 않음).
  const totalGrossEstateValue = Number(p.totalGrossEstateValue) || 0;
  let businessInheritanceDeferralEligibleAmount = null;
  if (businessInheritanceDetail_ && totalGrossEstateValue > 0) {
    businessInheritanceDeferralEligibleAmount = Math.round(taxAfterReportCredit * businessInheritanceDetail_.targetAmount / totalGrossEstateValue);
  }

  const finalTax = Math.max(0, taxAfterReportCredit + interestAmount + forProfitPayableByHeirs
    + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty
    - culturalPropertyDeferredTaxAmount - businessInheritanceDeferredTaxAmount);

  return {
    입력값: {
      상속세과세가액_입력값: taxableEstateAmount, 배우자유무: hasSpouse, 자녀수: childCount, 연로자65세이상: elderlyHeirCount, 신고상태: filingStatus,
      신고인: { 성명: p.reporterName || '', 주민등록번호: p.reporterRegNo || '', 피상속인과의관계: p.reporterRelationToDeceased || '' },
      피상속인: { 성명: p.deceasedName || '', 주민등록번호: p.deceasedRegNo || '', 상속개시일: p.dateOfDeath || '' }
    },
    피상속인_거주구분: isDecedentResident ? '거주자' : '비거주자',
    비과세재산가액: nonTaxableAmount, 공익법인출연재산가액: publicInterestOrgAmount, 공익신탁재산가액: publicTrustAmount,
    상속개시전처분재산_추정내역: disposalPresumptionDetail,
    상속개시전처분재산_추정합계: disposalPresumptionTotal,
    상속세과세가액_적용값: effectiveEstateAmount,
    인적공제: personalDeduction,
    '기초공제+인적공제_또는_일괄공제5억_중_큰값': basicOrLumpSum,
    배우자공제: spouseDeduction,
    배우자공제한도액: Number.isFinite(spouseLimit) ? spouseLimit : null,
    금융재산상속공제: financialDeduction,
    동거주택상속공제: cohabitingHouseDeduction,
    감정평가수수료공제: appraisalFeeDeduction,
    재해손실공제: disasterLossDeduction,
    장례비용공제: funeralDeduction,
    장례비용공제_일반분: funeralGeneralDeduction,
    장례비용공제_봉안시설분: funeralNicheDeduction,
    가업상속공제: businessInheritanceDeduction,
    가업상속공제_계산내역: businessInheritanceDetail_ ? {
      대상금액: businessInheritanceDetail_.targetAmount, 한도액: businessInheritanceDetail_.limitAmount,
      소득세법적용분: businessInheritanceDetail_.targetIndividual, 법인세법적용분: businessInheritanceDetail_.targetCorporate,
      사업관련자산가액비율: businessInheritanceDetail_.ratioInfo ? businessInheritanceDetail_.ratioInfo.ratio : null,
      중견기업게이트_적용여부: businessInheritanceDetail_.mediumSizedGateApplied
    } : null,
    영농상속공제: farmingInheritanceDeduction,
    영농상속공제_계산내역: farmingInheritanceDetail_ ? {
      대상금액: farmingInheritanceDetail_.targetAmount, 한도액: farmingInheritanceDetail_.limitAmount,
      소득세법적용분: farmingInheritanceDetail_.individualTotal, 법인세법적용분: farmingInheritanceDetail_.targetCorporate,
      사업관련자산가액비율: farmingInheritanceDetail_.ratioInfo ? farmingInheritanceDetail_.ratioInfo.ratio : null
    } : null,
    상속공제_합계: totalDeduction,
    상속공제종합한도_적용여부: overallLimitApplied,
    과세표준: taxBase,
    산출세액: calculatedTax,
    세대생략가산액: generationSkipPremium,
    기납부증여세액공제: priorGiftTaxCredit,
    증여세액공제_5억이하배제: giftCreditExcludedBySmallEstate,
    증여세액공제_상속인별내역: priorGiftCreditResult.perHeir,
    특례증여세액공제: specialGiftTaxCredit,
    외국납부세액공제: foreignTaxCredit,
    단기재상속세액공제: shortTermReinheritanceCredit,
    그밖의공제: otherCreditsAmount,
    신고세액공제: reportCredit,
    이자상당액: interestAmount,
    영리법인면제분납부세액: forProfitPayableByHeirs,
    무신고가산세: penalties.unreportedPenalty,
    과소신고가산세: penalties.underreportedPenalty,
    납부지연가산세: penalties.latePenalty,
    문화재등징수유예세액: culturalPropertyDeferredTaxAmount,
    가업상속납부유예세액: businessInheritanceDeferredTaxAmount,
    가업상속납부유예_가능세액: businessInheritanceDeferralEligibleAmount,
    납부세액: finalTax,
    안내: '배우자가 단독상속인인 경우 일괄공제(5억)를 선택할 수 없고 기초공제+인적공제만 적용됩니다 — 해당되면 이 결과를 그대로 쓰지 말고 재계산하세요. spouseLegalShareRatio(배우자 법정상속분 비율)를 넣지 않으면 배우자공제에 30억 한도만 적용되고 정확한 한도액이 반영되지 않습니다. 가업상속공제·영농상속공제·특례증여세액공제는 자격요건 판정과 세액 자체를 이 도구가 계산하지 않으므로 별도로 계산해서 그 결과값만 입력해야 합니다. 동거주택상속공제는 10년 동거·무주택 등 요건 충족을 전제로 한 것이니 별도로 검증하세요. 납부지연가산세율(1일 10만분의22)은 시행령 개정으로 바뀔 수 있으니 신고 시점 기준으로 재확인하세요.' +
      (businessInheritanceDeferralEligibleAmount != null
        ? ' 가업상속납부유예_가능세액은 §72의2에 따라 유예 신청 가능한 최대 금액(참고용)이며, 가업상속공제와는 별개로 선택 가능한 제도입니다 — 실제로 유예받으려면 이 금액(또는 그 이하)을 businessInheritanceDeferredTaxAmount에 넣어야 최종 납부세액에서 차감됩니다.'
        : '')
  };
}

// 상속인별 납부세액 안분 (상증세법 §3조의2②) — 우리나라 상속세는 유산세 방식이라 상속재산 전체에 대해
// 하나의 세액을 계산한 뒤, 각 상속인은 "자신이 받았거나 받을 재산이 전체 상속재산에서 차지하는 비율"만큼만
// 납세의무를 진다. toolCalculateInheritanceTax의 결과(전체 세액)와 상속인별 실제상속재산가액만 있으면 계산되며,
// 반올림 잔액은 실제상속재산가액이 가장 큰 상속인에게 몰아서 합계가 전체 금액과 정확히 일치하게 한다.
function toolAllocateInheritanceTaxByHeir(aggregateResult, heirs) {
  if (!aggregateResult || aggregateResult.error) return { error: '전체 상속세 계산 결과(toolCalculateInheritanceTax의 반환값)가 필요합니다.' };
  if (!Array.isArray(heirs) || heirs.length === 0) return { error: '상속인을 1명 이상 입력해야 합니다.' };
  const values = heirs.map(function (h) { return Number(h.actualInheritedValue) || 0; });
  const totalInherited = values.reduce(function (s, v) { return s + v; }, 0);
  if (totalInherited <= 0) return { error: '상속인별 실제상속재산가액(actualInheritedValue) 합계가 0보다 커야 합니다.' };

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
  // 반올림으로 합계가 어긋나면 실제상속재산가액이 가장 큰 상속인에게 잔액을 몰아 전체 합계와 정확히 맞춘다.
  fields.forEach(function (f) {
    const sumAllocated = rows.reduce(function (s, r) { return s + r[f.key]; }, 0);
    rows[maxIdx][f.key] += (f.total - sumAllocated);
  });

  return {
    상속인별_내역: rows,
    합계검증: { 실제상속재산가액_합계: totalInherited, 납부세액_합계: aggregateResult.납부세액 || 0 },
    안내: '상증세법 §3조의2②에 따라, 전체 산출세액·세액공제·가산세 등을 상속인별 실제상속재산가액 비율로 안분했습니다(유산세 방식). 상속공제는 전체 1회만 적용되는 항목이라 인별로 나누지 않았습니다. 반올림 잔액은 실제상속재산가액이 가장 큰 상속인에게 몰아서 합계를 맞췄습니다. 각 상속인은 자신이 받았거나 받을 재산을 한도로 연대납부의무를 지므로, 실제 배분·납부는 상속인 간 협의나 유언에 따른 실제 취득재산 기준으로 재확인하세요.'
  };
}

// 조특법§30의5(창업자금)·§30의6(가업승계 주식등) 증여세 과세특례 ([별지 제10호의2서식]) —
// 일반 증여세 누진세율이 아니라 10%(가업승계 120억 초과분 20%) 특례세율, 별도 증여재산공제, 별도 총한도를 적용하며 신고세액공제는 적용하지 않는다.
function toolCalculateSpecialRateGiftTax(p) {
  p = p || {};
  const specialType = p.specialType;
  if (['startup', 'business_succession'].indexOf(specialType) === -1) {
    return { error: 'specialType은 "startup"(창업자금) 또는 "business_succession"(가업승계 주식등) 중 하나여야 합니다.' };
  }
  const giftAmount = Number(p.giftAmount);
  if (!giftAmount || giftAmount <= 0) return { error: '증여재산가액(giftAmount)이 필요합니다.' };

  // 조특법§30의5①후단·§30의6 — 같은 특례를 2회 이상(또는 부모 각각으로부터) 받으면 과세가액을
  // 합산한다(priorSpecialGiftAmount). priorPaidTax는 그 이전 특례증여분에 대해 이미 낸 산출세액을
  // 그대로 차감하는 것으로, 상증세법§58(§47②합산에 대한 기납부세액공제)과는 별개다 — §30의5⑪이
  // 일반 증여재산의 §47② 합산 자체를 이 특례 과세가액에서 배제하므로 §58이 적용될 여지가 없다.
  const priorSpecialGiftAmount = Number(p.priorSpecialGiftAmount) || 0;
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';

  let grossBase, ratioInfo = null, businessAssetAmount = null, debtAssumedAmount = 0;
  if (specialType === 'business_succession') {
    const hasAssetDetail = (Number(p.totalAssetValue) || 0) > 0;
    ratioInfo = hasAssetDetail ? businessRelatedAssetRatio_(p.totalAssetValue, {
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

  const penalties = giftFilingPenalties_(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);

  return {
    입력값: {
      특례종류: specialType === 'startup' ? '창업자금(조특법 §30의5)' : '가업승계주식등(조특법 §30의6)', 증여재산가액: giftAmount,
      수증자: { 성명: p.doneeName || '', 주민등록번호: p.doneeRegNo || '' },
      증여자: { 성명: p.donorName || '', 주민등록번호: p.donorRegNo || '', 증여일자: p.giftDate || '' }
    },
    인수채무액: debtAssumedAmount,
    가업자산상당액: businessAssetAmount,
    사업관련자산가액비율: ratioInfo ? ratioInfo.ratio : null,
    과세특례적용전_증여세과세가액_계: grossBase,
    총한도액: totalLimit,
    과세특례적용대상_증여세과세가액: specialRateApplicableAmount,
    기본세율적용대상_증여재산가액: baseRateApplicableAmount,
    증여재산공제: propertyDeduction,
    재해손실공제: disasterLossDeduction,
    감정평가수수료공제: appraisalFeeDeduction,
    과세표준: taxBase,
    세율: specialType === 'startup' ? '10%' : '10%(120억 초과분 20%)',
    산출세액: calculatedTax,
    납부세액공제: priorPaidTax,
    외국납부세액공제: foreignTaxPaidAmount,
    무신고가산세: penalties.unreportedPenalty,
    과소신고가산세: penalties.underreportedPenalty,
    납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '이 특례에는 상증세법 §69②의 신고세액공제(3%)가 적용되지 않습니다. ' +
      (baseRateApplicableAmount > 0
        ? '한도(' + totalLimit + '원)를 초과하는 기본세율적용대상_증여재산가액 ' + baseRateApplicableAmount + '원은 이 결과와 별개로 calculate_gift_tax(일반 증여세, [별지 제10호서식])로 반드시 신고해야 합니다. '
        : '') +
      '거주자는 조특법 §30의5(창업자금)·§30의6(가업승계 주식등)·§30의7 중 어느 하나만 적용받을 수 있습니다. ' +
      (specialType === 'business_succession' && !(Number(p.totalAssetValue) > 0)
        ? '법인 자산내역(totalAssetValue 등)을 넣지 않아 주식등 가액 전체를 가업자산으로 간주했습니다 — 사업무관자산이 있다면 정확한 값을 넣어 재계산하세요. '
        : '') +
      '가업영위기간·중소/중견기업 여부 등 자격요건 자체는 이 도구가 검증하지 않으니 별도로 확인하세요.'
  };
}

// 증여의제이익(일감몰아주기·일감떼어주기 등)에 대한 세액 계산 — 상증세법 §45의3·§45의4는 증여재산공제가 적용되지 않고
// (과세표준 = 증여의제이익 그대로), 일반 누진세율과 신고세액공제(3%)만 적용된다.
function taxOnDeemedGiftProfit_(deemedGiftProfit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxForLatePenalty, reportedInTime, appraisalFeeAmount) {
  // §55①1~3호 — 명의신탁재산 증여의제·§45의3·45의4 증여의제이익·기타 합산배제증여재산은 전부
  // "그 금액에서 대통령령으로 정하는 증여재산의 감정평가 수수료를 뺀 금액"이 과세표준이다.
  const taxBase = Math.max(0, Math.round(deemedGiftProfit) - (Number(appraisalFeeAmount) || 0));
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const reportCredit = reportedInTime ? Math.round(calculatedTax * 0.03) : 0;
  const taxAfterCredit = calculatedTax - reportCredit;
  const penalties = giftFilingPenalties_(taxAfterCredit, filingStatus, isFraudulent, underreportedTaxAmount, unpaidDays, unpaidTaxForLatePenalty);
  const finalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return { taxBase, calculatedTax, reportCredit, penalties, finalTax };
}

// 일감몰아주기 증여의제 (상증세법 §45의3, 특수관계법인과의 거래를 통한 이익의 증여의제) — [별지 제10호의3서식]
function toolCalculateRelatedPartyTransactionGiftTax(p) {
  p = p || {};
  const companySize = p.companySize;
  if (['general', 'medium', 'small'].indexOf(companySize) === -1) {
    return { error: 'companySize는 "general"(일반), "medium"(중견기업), "small"(중소기업) 중 하나여야 합니다.' };
  }
  // §45의3①2호가목(중소기업)은 "세후순이익"을, 나목(중견기업)·다목(그 외)은 "세후영업이익"을 쓴다 —
  // 두 값이 서로 다른 개념이므로 별도로 입력받는다.
  const afterTaxOperatingIncome = Number(p.afterTaxOperatingIncome) || 0;
  const afterTaxNetIncome = Number(p.afterTaxNetIncome) || 0;
  const incomeBase = companySize === 'small' ? afterTaxNetIncome : afterTaxOperatingIncome;
  const tradeRatio = Number(p.relatedPartyTransactionRatio) || 0; // %
  const shareRatio = Number(p.shareholderOwnershipRatio) || 0; // %

  // 과세요건(게이트): 소득(세후영업이익 또는 세후순이익)>0, 거래비율이 정상거래비율(30%/중견40%/중소50%) 초과, 지분율이 한계보유비율(3%/중견중소10%) 초과.
  const gateTradeThreshold = companySize === 'general' ? 30 : (companySize === 'medium' ? 40 : 50);
  const gateShareThreshold = companySize === 'general' ? 3 : 10;
  // §45의3①1호나목2) — 일반기업(중소·중견 아님)은 가목 사유(거래비율>정상거래비율) 외에, "거래비율이
  // 정상거래비율의 3분의 2 초과 + 특수관계법인 매출액이 시행령§34의3⑰의 1천억원 초과"인 경우도
  // 대체로 과세요건을 충족한다(사업부문별 계산 특례는 미반영 — 그 경우 별도 계산식이 필요).
  const generalAltGateTradeThreshold = companySize === 'general' ? gateTradeThreshold * 2 / 3 : null;
  const relatedPartySalesAmount = Number(p.relatedPartySalesAmount) || 0;
  const meetsGeneralAltGate = companySize === 'general' && tradeRatio > generalAltGateTradeThreshold && relatedPartySalesAmount > 100000000000;
  const meetsTradeGate = tradeRatio > gateTradeThreshold || meetsGeneralAltGate;
  const meetsGate = incomeBase > 0 && meetsTradeGate && shareRatio > gateShareThreshold;

  if (!meetsGate) {
    return {
      과세대상여부: false,
      입력값: { 기업규모: companySize, 적용소득기준: companySize === 'small' ? '세후순이익' : '세후영업이익', 적용소득금액: incomeBase, 특수관계법인거래비율: tradeRatio, 주식보유비율: shareRatio },
      과세요건_거래비율기준: gateTradeThreshold, 과세요건_지분율기준: gateShareThreshold,
      과세요건_대체거래비율기준: generalAltGateTradeThreshold, 과세요건_대체매출액기준: companySize === 'general' ? 100000000000 : null,
      증여의제이익: 0, 납부세액: 0,
      안내: '과세요건(소득 존재, 거래비율 ' + gateTradeThreshold + '% 초과, 주식보유비율 ' + gateShareThreshold + '% 초과' +
        (companySize === 'general' ? ' — 또는 거래비율 ' + generalAltGateTradeThreshold.toFixed(1) + '% 초과+특수관계법인매출액 1천억원 초과(§45의3①1호나목2)' : '') +
        ')을 충족하지 못해 일감몰아주기 증여의제 과세대상이 아닙니다.'
    };
  }

  // 증여의제이익 계산식의 차감비율은 위 과세요건 게이트 비율과 다르다(법정 구조): 일반 5%/0%, 중견 20%/5%, 중소 50%/10%.
  const formulaTradeSubtract = companySize === 'general' ? 5 : (companySize === 'medium' ? 20 : 50);
  const formulaShareSubtract = companySize === 'general' ? 0 : (companySize === 'medium' ? 5 : 10);
  const netTradeRatio = Math.max(0, (tradeRatio - formulaTradeSubtract) / 100);
  const netShareRatio = Math.max(0, (shareRatio - formulaShareSubtract) / 100);
  // 신고기한 내 수혜법인(또는 간접출자법인)으로부터 받은 배당소득에 대한 공제액 — 별도로 계산해서 입력해야 한다.
  const dividendDeduction = Number(p.dividendDeduction) || 0;
  const deemedGiftProfit = Math.max(0, Math.round(incomeBase * netTradeRatio * netShareRatio) - dividendDeduction);

  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const r = taxOnDeemedGiftProfit_(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount);

  return {
    과세대상여부: true,
    입력값: {
      기업규모: companySize, 적용소득기준: companySize === 'small' ? '세후순이익' : '세후영업이익', 적용소득금액: incomeBase, 특수관계법인거래비율: tradeRatio, 주식보유비율: shareRatio,
      수증자: { 성명: p.doneeName || '', 주민등록번호: p.doneeRegNo || '' }
    },
    증여의제이익_계산식차감비율_거래: formulaTradeSubtract, 증여의제이익_계산식차감비율_지분: formulaShareSubtract,
    배당소득공제: dividendDeduction,
    증여의제이익: deemedGiftProfit,
    과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
    무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
    납부세액: r.finalTax,
    안내: '증여재산공제는 적용되지 않습니다(증여의제이익 전액이 과세표준). 특수관계법인거래비율·주식보유비율은 과세제외매출액을 반영해 이미 계산된 최종 비율을 입력해야 하며, 이 도구는 매출액 세부내역으로부터의 비율 산출 자체는 하지 않습니다. 지배주주 판정, 다수 특수관계법인이 있는 경우의 증여자별 안분 등은 별도로 확인하세요. 지배주주가 수혜법인에 직접출자와 간접출자를 모두 하고 있는 경우에는 출자관계별로 세후영업이익·거래비율·과세제외매출액이 달라질 수 있어 직접출자관계와 간접출자관계를 각각 이 도구로 따로 계산한 뒤 증여의제이익을 합산해야 합니다.'
  };
}

// 일감떼어주기 증여의제 (상증세법 §45의4, 특수관계법인으로부터 제공받은 사업기회로 발생한 이익의 증여의제) — [별지 제10호의4서식]
function toolCalculateBusinessOpportunityGiftTax(p) {
  p = p || {};
  const phase = p.phase;
  if (['initial', 'settlement'].indexOf(phase) === -1) {
    return { error: 'phase는 "initial"(개시사업연도) 또는 "settlement"(정산사업연도, 사업기회제공일 이후 2년 경과) 중 하나여야 합니다.' };
  }
  const profitFromOpportunity = Number(p.profitFromOpportunity) || 0;
  const shareRatio = Number(p.shareholderOwnershipRatio) || 0; // %
  const corporateTaxPortion = Number(p.corporateTaxPortion) || 0;

  const meetsGate = profitFromOpportunity > 0 && shareRatio >= 30;
  if (!meetsGate) {
    return {
      과세대상여부: false,
      입력값: { 단계: phase, 사업기회로인한이익: profitFromOpportunity, 주식보유비율: shareRatio },
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
  const r = taxOnDeemedGiftProfit_(deemedGiftProfit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount);

  return {
    과세대상여부: true,
    입력값: {
      단계: phase === 'initial' ? '개시사업연도' : '정산사업연도', 사업기회로인한이익: profitFromOpportunity, 주식보유비율: shareRatio,
      수증자: { 성명: p.doneeName || '', 주민등록번호: p.doneeRegNo || '' }
    },
    증여의제이익: deemedGiftProfit,
    과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
    무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
    납부세액: r.finalTax,
    안내: (phase === 'initial'
      ? '개시사업연도 신고는 잠정치입니다 — 2년 경과 후 정산사업연도에 phase="settlement"로 반드시 재계산·정산신고해야 합니다. '
      : '') +
      '증여재산공제는 적용되지 않습니다(증여의제이익 전액이 과세표준). 지배주주 판정, 법인세 납부세액 중 상당액 계산은 별도로 확인해서 정확한 값을 입력해야 합니다.'
  };
}

// 명의신탁재산의 증여 의제 (상증세법§45의2) — 등기·등록·명의개서가 필요한 재산(토지·건물은 제외 —
// 대표적으로 주식등) 중 실제소유자와 명의자가 다르면, 명의개서일(주식처럼 명의개서 대상 재산이면
// 소유권취득일이 속한 해의 다음 해 말일의 다음 날)에 그 재산가액을 실제소유자가 명의자에게 증여한
// 것으로 본다. §55①1호에 따라 과세표준 = 명의신탁재산의 금액(관계별 증여재산공제 없음, 감정평가
// 수수료만 차감).
function toolCalculateNomineeTrustGiftTax(p) {
  p = p || {};
  const propertyValue = Number(p.nomineeTrustPropertyValue) || 0;
  if (propertyValue <= 0) return { error: '명의신탁재산의 가액(nomineeTrustPropertyValue)이 필요합니다.' };

  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const r = taxOnDeemedGiftProfit_(propertyValue, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount);

  return {
    명의신탁재산가액: propertyValue, 감정평가수수료공제: Math.min(Number(p.appraisalFeeAmount) || 0, propertyValue),
    과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
    무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
    납부세액: r.finalTax,
    안내: '증여재산공제(§53)는 적용되지 않습니다(§55①1호 — 명의신탁재산의 금액 전액이 과세표준, 감정평가수수료만 차감). 조세회피 목적이 없었음(§45의2①1호) 등 적용 제외 사유에 해당하는지, 조세회피목적 추정을 뒤집을 사유(§45의2③단서)가 있는지는 이 도구가 판정하지 않으므로 별도로 확인해야 합니다. 실제소유자와 명의자 사이의 증여세는 실제소유자가 납부의무를 진다(§4의2②).'
  };
}

// 재산 취득자금 등의 증여 추정 (상증세법§45, 시행령§34) — 자력취득 능력이 부족한 자가 재산을 취득(또는
// 채무를 상환)했는데 그 자금출처를 입증하지 못하면, 미입증금액을 증여받은 것으로 추정한다. 다만
// 미입증금액이 "취득재산가액(또는 상환금액)의 20%"와 "2억원" 중 적은 금액에 미달하면 추정 자체를
// 배제한다(시행령§34①). §47①에 따라 합산배제증여재산이므로 §55①에 따라 증여재산공제 없이 미입증금액
// 그대로가 과세표준이다(taxOnDeemedGiftProfit_ 재사용).
function toolCalculatePropertyAcquisitionFundsGiftTax(p) {
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
  const r = taxOnDeemedGiftProfit_(unprovenAmount, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty), reportedInTime, p.appraisalFeeAmount);

  return {
    과세대상여부: true, 취득재산가액: acquisitionValue, 입증된금액: provenAmount, 미입증금액: unprovenAmount, 배제기준금액: gateThreshold,
    증여의제이익: unprovenAmount,
    과세표준: r.taxBase, 산출세액: r.calculatedTax, 신고세액공제: r.reportCredit,
    무신고가산세: r.penalties.unreportedPenalty, 과소신고가산세: r.penalties.underreportedPenalty, 납부지연가산세: r.penalties.latePenalty,
    납부세액: r.finalTax,
    안내: '증여재산공제(§53)는 적용되지 않습니다(합산배제증여재산 — §47①·§55①). 자금출처로 인정되는 항목(시행령§34①: 신고·과세된 소득금액, 신고·과세된 상속·수증재산가액, 재산처분대가·부담한 채무로 실제 그 취득·상환에 쓴 금액)을 정확히 소명했는지 다시 확인하세요. §45③ 단서의 국세청장 고시 소액기준 적용 여부는 이 도구가 판정하지 않습니다.'
  };
}

// 채무면제 등에 따른 증여 (상증세법§36) — 채권자로부터 채무를 면제받거나 제3자로부터 채무의 인수·변제를
// 받으면, 그 면제·인수·변제로 얻은 이익(보상액을 지급했으면 그 보상액을 뺀 금액)이 증여재산가액이다.
function toolCalculateDebtForgivenessGiftTax(p) {
  p = p || {};
  const debtAmount = Number(p.debtAmount) || 0;
  if (debtAmount <= 0) return { error: '면제·인수·변제받은 채무액이 필요합니다.' };
  const compensationPaid = Number(p.compensationPaid) || 0;
  const giftAmount = Math.max(0, debtAmount - compensationPaid);
  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    채무면제등이익: giftAmount, 증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction,
    감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount, 과세표준: taxBase,
    산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 면제·인수·변제를 받은 날입니다(§36②). 배우자·직계존비속 등 관계별 증여재산공제(§53) 한도는 10년간 합산 사용액을 감안해 직접 계산해서 넣어야 합니다.'
  };
}

// 부동산 무상사용·담보이용에 따른 이익의 증여 (상증세법§37, 시행령§27, 시행규칙§10) — 타인의 부동산(그
// 소유자와 함께 거주하는 주택·부수토지는 제외)을 무상사용하면 연간 부동산가액×2%(시행규칙§10②)의
// 이익을 5년간(무상사용기간은 5년 단위로 재산정) 매년 얻는 것으로 보아, 10% 할인율 5년 연금현가계수
// 3.79079로 현재가치화한 금액이 증여재산가액이다(§59② 영업권평가와 동일한 현가환산 방식). 5년간
// 합계이익이 1억원 미만이면 과세 제외(§37①단서, 시행령§27④). 부동산을 무상으로 담보로 제공받아
// 차입한 경우(§37②)는 별도로, 차입금×적정이자율(4.6%)-실제지급이자를 1년 단위로 계산해 1천만원
// 미만이면 제외한다(시행령§27⑤⑥).
function toolCalculateFreePropertyUseGiftTax(p) {
  p = p || {};
  const useType = p.useType;
  if (['occupancy', 'collateral'].indexOf(useType) === -1) return { error: '무상사용 또는 담보이용 중에서 선택하세요.' };
  let giftAmount, annualBenefit;
  if (useType === 'occupancy') {
    const propertyValue = Number(p.propertyValue) || 0;
    annualBenefit = Math.round(propertyValue * 0.02);
    giftAmount = Math.round(annualBenefit * 3.79079);
    if (giftAmount < 100000000) {
      return {
        과세대상여부: false, 연간이익: annualBenefit, 오년간현재가치합계: giftAmount, 기준금액: 100000000, 납부세액: 0,
        안내: '5년간 이익의 현재가치 합계(' + giftAmount + '원)가 기준금액(1억원, 시행령§27④)에 미달해 과세대상이 아닙니다.'
      };
    }
  } else {
    const loanAmount = Number(p.loanAmount) || 0;
    const appropriateInterestRate = 0.046;
    const actualInterestPaid = Number(p.actualInterestPaid) || 0;
    giftAmount = Math.max(0, Math.round(loanAmount * appropriateInterestRate) - actualInterestPaid);
    if (giftAmount < 10000000) {
      return {
        과세대상여부: false, 담보이용이익: giftAmount, 기준금액: 10000000, 납부세액: 0,
        안내: '담보이용이익(' + giftAmount + '원)이 기준금액(1천만원, 시행령§27⑥)에 미달해 과세대상이 아닙니다.'
      };
    }
  }
  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  const base = {
    과세대상여부: true,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: useType === 'occupancy'
      ? '5년마다 증여시기가 재산정되므로(무상사용 개시일로부터 5년이 되는 날의 다음날에 새로 개시한 것으로 봄), 5년을 초과해 계속 무상사용하면 그 다음 5년분도 별도로 계산해서 신고해야 합니다. 특수관계인이 아닌 경우 거래관행상 정당한 사유가 없을 때만 과세됩니다(§37③).'
      : '차입기간을 정하지 않았으면 1년으로 보고, 1년 초과시 그 다음 1년분도 새로 계산합니다(시행령§27⑤). 적정이자율(4.6%)은 시행령§31의4①과 동일합니다.'
  };
  if (useType === 'occupancy') { base.연간이익 = annualBenefit; base.오년간현재가치합계 = giftAmount; }
  else { base.담보이용이익 = giftAmount; }
  return base;
}

// 배우자 등에게 양도한 재산의 증여 추정 (상증세법§44) — 배우자·직계존비속에게 양도한 재산은 그 재산가액을
// 양도자가 증여한 것으로 추정한다(①). 특수관계인에게 양도한 재산을 그 특수관계인이 3년 이내에 당초
// 양도자의 배우자등에게 다시 양도하면, 재양도 당시 재산가액을 증여추정한다(②) — 다만 당초양도자·양수자가
// 부담한 소득세 결정세액 합계가 재양도 재산가액을 증여추정할 경우의 증여세액보다 크면 배제한다(②단서,
// 그 비교대상 증여세액은 관계별 공제가 적용되는 일반 증여세 계산이 필요하므로 별도로 계산해서 입력받는다).
// ③ 각호(경매·파산선고·공매·증권시장처분·대가받고양도한사실이명백히인정) 중 하나에 해당하면 적용하지 않는다.
function toolCalculateSpousePropertyTransferGiftTax(p) {
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

  if (transferType === 'bypass') {
    const priorTaxesSum = Number(p.priorTaxesSum) || 0;
    const comparisonGiftTax = Number(p.comparisonGiftTax) || 0;
    if (priorTaxesSum > comparisonGiftTax) {
      return {
        과세대상여부: false, 납부세액: 0,
        안내: '당초 양도자·양수자가 부담한 소득세 결정세액 합계(' + priorTaxesSum + '원)가 재양도 재산가액을 증여추정할 경우의 증여세액(' + comparisonGiftTax + '원)보다 커서(§44②단서) 증여추정을 적용하지 않습니다.'
      };
    }
  }

  const giftAmount = assetValue;
  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 증여추정재산가액: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: transferType === 'direct'
      ? '증여로 추정되어 배우자등에게 증여세가 부과되면, 당초 양도자·양수자에게는 그 양도에 대한 소득세를 부과하지 않습니다(§44④).'
      : '재양도 당시의 재산가액을 증여받은 것으로 추정합니다(§44②). 마찬가지로 소득세는 부과되지 않습니다(§44④).'
  };
}

// 보험금의 증여 (상증세법§34) — 보험사고(만기보험금 포함) 발생일을 증여일로 하여, ①보험금수령인이 아닌
// 자가 낸 보험료 부분(1호)과 ②수령인이 증여받은 재산으로 낸 보험료 부분(2호, 그 보험료액은 다시 뺀다)에
// 대응하는 보험금 상당액을 증여재산가액으로 한다. §8에 따라 보험금을 상속재산으로 보는 경우에는 적용하지
// 않는다(§34②).
function toolCalculateInsuranceProceedsGiftTax(p) {
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
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    보험금상당액: proceedsShare, 증여받은재산으로낸보험료: premiumPaidFromGiftedAssets, 증여재산가액: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 보험사고(만기보험금 지급 포함)가 발생한 날입니다. 피상속인이 보험계약자로서 §8에 따라 이 보험금을 상속재산으로 보는 경우에는 이 조가 아니라 상속세로 과세됩니다(§34②).'
  };
}

// 양도소득의 부당행위계산 - 증여 후 우회양도 부인 (소득세법§101②③④) — 특수관계인(배우자·직계존비속으로서
// §97의2 이월과세 적용대상은 제외)에게 증여 후 10년 이내 재양도시, (수증자 증여세+양도세)가 (증여자 직접
// 양도시 양도세)보다 적으면 증여자 직접양도로 의제해 증여자에게 양도세를 과세하고 증여세는 부과하지 않는다.
function toolCalculateDonorDirectTransferDeemed(p) {
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
}

// 신탁이익의 증여 (상증세법§33, 시행령§25) — 원본 또는 수익을 한번에 받으면 그 가액 그대로, 여러 차례
// 나눠 받으면 증여시기를 기준으로 시행령§61을 준용해 평가한 가액(§25②)을 giftAmount로 입력받는다.
function toolCalculateTrustIncomeGiftTax(p) {
  p = p || {};
  const giftAmount = Number(p.giftAmount) || 0;
  if (giftAmount <= 0) return { error: '신탁이익(원본 또는 수익의 가액 — 여러 차례 나눠 받는 경우 §61 신탁수익권 평가액)이 필요합니다.' };
  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    신탁이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 원칙적으로 원본·수익이 실제 지급되는 날입니다(위탁자 사망시 사망일, 약정일까지 미지급시 약정일 등 예외는 시행령§25①). 수익자가 특정·존재하지 않으면 위탁자(또는 상속인)를 수익자로 보아 과세하고, 나중에 수익자가 특정되면 그때 새로운 신탁이 있는 것으로 봅니다(§33②).'
  };
}

// 상속세(증여세) 연부연납 회차별 납부예정세액 계산 ([별지 제11호서식]) — 원금은 연부연납대상금액을 (기간+1)회로 균등분할,
// 각 회분의 가산금은 그 시점 잔여 미납액에 연이자율을 적용해 계산한다(잔액 감소식, declining balance).
// 정확한 가산금 이자율은 국세기본법 시행령 §43의3②에 따라 수시로 바뀌므로 이 도구가 자동으로 채우지 않고 반드시 입력받는다.
function toolCalculateInstallmentPaymentSchedule(p) {
  p = p || {};
  const taxType = p.taxType;
  if (['inheritance', 'gift'].indexOf(taxType) === -1) {
    return { error: 'taxType은 "inheritance"(상속세) 또는 "gift"(증여세) 중 하나여야 합니다.' };
  }
  const totalTaxAmount = Number(p.totalTaxAmount);
  if (!totalTaxAmount || totalTaxAmount <= 0) return { error: '총 납부세액(totalTaxAmount)이 필요합니다.' };
  if (totalTaxAmount <= 20000000) {
    return { error: '상속세·증여세 납부세액이 2천만원 이하이면 연부연납을 신청할 수 없습니다(상증세법 §71①).' };
  }
  const installmentPeriodYears = Number(p.installmentPeriodYears);
  if (!installmentPeriodYears || installmentPeriodYears <= 0) return { error: '연부연납기간(installmentPeriodYears, 년)이 필요합니다.' };
  const annualInterestRatePercent = Number(p.annualInterestRatePercent);
  if (!(annualInterestRatePercent >= 0)) return { error: '연부연납 가산금 연이자율(annualInterestRatePercent, %)이 필요합니다 — 국세기본법 시행령 §43의3②에 따라 수시로 바뀌므로 신고 시점 기준 이자율을 직접 확인해서 넣어야 한다.' };
  const initialPaymentAmount = Math.min(Number(p.initialPaymentAmount) || 0, totalTaxAmount);

  const installmentTaxAmount = totalTaxAmount - initialPaymentAmount; // 연부연납대상금액
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
    입력값: { 세목: taxType === 'inheritance' ? '상속세' : '증여세', 총납부세액: totalTaxAmount, 최초납부세액: initialPaymentAmount, 연부연납기간: installmentPeriodYears, 연이자율퍼센트: annualInterestRatePercent },
    연부연납대상금액: installmentTaxAmount,
    회차별_납부예정세액: schedule,
    가산금_합계: totalInterest,
    총납부액_최초포함: initialPaymentAmount + installmentTaxAmount + totalInterest,
    각회분_1천만원미만_경고: belowMinimumWarning,
    안내: '각 회분의 납부예정 세액(가산금 제외한 원금)은 1천만원을 초과해야 합니다 — 미만이면 연부연납기간을 줄이세요. ' +
      (belowMinimumWarning ? '⚠ 현재 입력으로는 회당 원금이 1천만원 미만입니다. ' : '') +
      '연부연납기간 한도: 상속세 일반재산은 10년(거치기간 없음), 가업상속재산은 상속재산 중 가업상속재산 비율이 50% 미만이면 10년(3년까지 거치 가능)·50% 이상이면 20년(5년까지 거치 가능), 증여세는 일반재산 5년(거치기간 없음)·조특법§30의6 특례를 적용받은 증여재산은 15년입니다(거치기간 동안은 이자상당액만 내고 원금 상환은 미루는 방식이라 이 도구의 균등분할 모델과 다르며, 거치기간을 쓸 경우 홈택스 모의계산으로 별도 재계산하세요. 기간 한도 준수 여부는 이 도구가 검증하지 않음). ' +
      '가산금 계산은 잔여 미납액에 연이자율을 적용하는 근사 모델입니다 — 정확한 이자율(국세기본법 시행령§43의3②, 수시 변경)과 실제 납부예정일을 반영해 홈택스 모의계산으로 재검증하세요. 가업상속재산에 해당하는 부분과 그 외 부분의 연부연납기간이 다른 경우(예: 상속세) 각 부분을 별도로 이 도구를 호출해 계산한 뒤 합산하세요.'
  };
}

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

// 사후관리 위반 시 추징세액에 붙는 이자상당액 계산 (영농자녀 증여세 감면 위반 [별지 제52호의2서식], 창업자금 증여세 과세특례 위반
// [별지 제11호의7서식], 가업승계 주식등 증여세 과세특례 추징 [별지 제11호의10서식] 등에 공통되는 계산식).
// 이자 기산일부터 추징사유 발생일까지를 이율 변경일 기준으로 나눠, 각 구간에 그 시점 국세환급가산금
// 이율(365분의1)을 적용해 합산한다. tax-calc.js calculateClawbackInterestJS와 동일 로직.
function toolCalculateClawbackInterest(p) {
  p = p || {};
  const taxAmount = Number(p.clawedBackTaxAmount);
  if (!taxAmount || taxAmount <= 0) return { error: '사후관리 위반으로 결정된 추징세액(clawedBackTaxAmount)이 필요합니다.' };
  if (!p.startDate || !p.endDate) return { error: '이자 기산일(startDate)과 추징사유 발생일(endDate)이 필요합니다.' };
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
}

// 저가양수·고가양도에 따른 이익의 증여의제 (상증세법 §35) — 특수관계인 간 재산을 시가보다 현저히 낮은(또는 높은) 가액으로
// 거래하면 그 차액에서 일정 기준액을 뺀 금액을 증여받은(또는 증여한) 것으로 본다. 이 결과의 증여재산가액을 그대로
// calculate_gift_tax의 giftAmount로 넣으면 정상적으로 증여재산공제·누진세율·신고세액공제가 적용된다(§35 자체는 별도 세율이 없음).
function toolCalculateLowPriceTransferGiftAmount(p) {
  p = p || {};
  const fairMarketValue = Number(p.fairMarketValue);
  const transferPrice = Number(p.transferPrice);
  if (!fairMarketValue || fairMarketValue <= 0) return { error: '시가(fairMarketValue)가 필요합니다.' };
  if (!(transferPrice >= 0)) return { error: '실제 거래한 대가(transferPrice)가 필요합니다.' };

  const diff = Math.abs(fairMarketValue - transferPrice);
  const threshold = Math.min(Math.round(fairMarketValue * 0.3), 300000000);
  const meetsGate = diff > threshold;
  const direction = transferPrice < fairMarketValue ? '저가양수(매수인이 이익을 얻음)' : (transferPrice > fairMarketValue ? '고가양도(매도인이 이익을 얻음)' : '차액없음');

  if (!meetsGate) {
    return {
      과세대상여부: false, 거래유형: direction,
      시가와대가의차액: diff, 차감기준액: threshold, 증여재산가액: 0,
      안내: '특수관계인 간 거래 기준으로, 차액(' + diff + '원)이 차감기준액(min(시가×30%, 3억원) = ' + threshold + '원)을 초과하지 않아 과세대상이 아닙니다. 비특수관계인 간 거래는 기준·계산식이 다르고(거래관행상 정당한 사유 유무 판단 필요) 이 도구는 특수관계인 간 거래를 전제로 계산합니다.'
    };
  }

  const deemedGiftAmount = diff - threshold;
  return {
    과세대상여부: true, 거래유형: direction,
    시가와대가의차액: diff, 차감기준액: threshold, 증여재산가액: deemedGiftAmount,
    안내: '이익을 얻은 쪽(저가양수면 매수인, 고가양도면 매도인)이 수증자입니다. 이 증여재산가액을 calculate_gift_tax의 giftAmount로 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요. 특수관계인 간 거래를 전제로 계산했으며, 비특수관계인 간 거래는 "거래의 관행상 정당한 사유" 판단과 다른 기준금액(시가의 30%만 사용, 3억 상한 없음)이 적용될 수 있어 별도로 확인해야 합니다. 시가는 반드시 상증세법상 평가방법(감정가액·매매사례가액·보충적평가 등)에 따라 확정해야 합니다.'
  };
}

// 금전 무상대출 등에 따른 이익의 증여의제 (상증세법 §41의4) — 특수관계인에게(또는으로부터) 금전을 무상 또는 적정이자율보다
// 낮은 이자로 빌려주면(빌리면) 그 차액을 증여받은 것으로 본다. 연간 계산액이 1천만원 미만이면 과세하지 않는다.
function toolCalculateInterestFreeLoanGiftAmount(p) {
  p = p || {};
  const loanPrincipal = Number(p.loanPrincipal);
  if (!loanPrincipal || loanPrincipal <= 0) return { error: '대여원금(loanPrincipal)이 필요합니다.' };
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
      안내: '계산된 이익(' + deemedGiftAmount + '원)이 1천만원(연간 기준) 미만이어서 과세대상이 아닙니다. 대출기간이 1년 미만이면 loanMonths로 월수를 넣어 일할(월할) 계산하세요.'
    };
  }

  return {
    과세대상여부: true, 적정이자상당액: appropriateInterestAmount, 실제지급이자: actualInterestPaid,
    증여재산가액: deemedGiftAmount,
    안내: '대출기간이 1년을 초과하면 매년(또는 대출조건 변경 시마다) 새로 증여의제이익이 발생하는 것으로 보아 각 연도별로 다시 계산해야 합니다. 적정이자율(현재 연 4.6%)은 상증세법 시행규칙에 따라 수시로 바뀔 수 있으니 대출 시점 기준으로 재확인하세요. 이 증여재산가액을 calculate_gift_tax의 giftAmount로 넣어 증여재산공제·누진세율을 정상 적용해 세액을 계산하세요.'
  };
}

// 국내주식등 세율(대주주, 2020.1.1. 이후) — 3억 이하 20%, 3억 초과 25%(누진공제 1500만원)
const DOMESTIC_STOCK_DAEJUJU_BRACKETS = [
  { max: 300000000, rate: 0.20, deduction: 0 },
  { max: Infinity, rate: 0.25, deduction: 15000000 }
];

// 주식등 양도소득세 (소득세법 §94①3,4,11,12,13, §104①11,12,13, [별지 제62호서식] 등 기준) —
// 부동산 양도세(calculate_transfer_tax)와 완전히 별도 세목. 장기보유특별공제는 적용되지 않는다.
function toolCalculateStockTransferTax(p) {
  p = p || {};
  const assetCategory = p.assetCategory;
  if (['domestic_stock', 'foreign_stock', 'derivative', 'other_asset', 'trust_beneficiary'].indexOf(assetCategory) === -1) {
    return { error: 'assetCategory는 "domestic_stock"(국내주식등), "foreign_stock"(국외주식등), "derivative"(파생상품등), "other_asset"(특정주식·부동산과다보유법인 등 기타자산), "trust_beneficiary"(신탁 수익권) 중 하나여야 합니다.' };
  }
  const transferPrice = Number(p.transferPrice);
  if (!transferPrice || transferPrice <= 0) return { error: '양도가액(transferPrice)이 필요합니다.' };
  const acquisitionPrice = Number(p.acquisitionPrice) || 0;
  const transferExpenses = Number(p.transferExpenses) || 0;

  const gain = transferPrice - acquisitionPrice - transferExpenses;
  // 국내·국외주식 손익통산(2020.1.1. 이후 양도분부터, 파생상품·기타자산은 통산대상 아님) — 다른 국내외 주식양도의 순손익을 더한다.
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
      calculatedTax = calcProgressiveTax_(taxBase, DOMESTIC_STOCK_DAEJUJU_BRACKETS);
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
    calculatedTax = calcProgressiveTax_(taxBase, DOMESTIC_STOCK_DAEJUJU_BRACKETS);
    rateNote = '신탁 수익권(§94①6호) — 3억 이하 20%, 3억 초과분 25%';
  } else if (assetCategory === 'other_asset' && p.isMajorityNonBusinessLandCorp) {
    // 소득세법§104①9호(시행령§167조의7) — §94①4호다목·라목 주식등 중, 그 법인 자산총액에서
    // 법인세법§55조의2②에 따른 비사업용토지가 차지하는 비율이 50% 이상인 법인의 주식등은
    // 8호(비사업용토지) 세율표와 동일하게 기본세율에 10%p를 가산한다.
    calculatedTax = calcProgressiveTax_(taxBase, TRANSFER_TAX_BRACKETS) + Math.round(taxBase * 0.10);
    rateNote = '기타자산 중 비사업용토지 과다보유법인 주식등(§104①9호) — 기본세율(누진 6~45%)+10%p 가산';
  } else {
    calculatedTax = calcProgressiveTax_(taxBase, TRANSFER_TAX_BRACKETS);
    rateNote = '기타자산(특정주식·부동산과다보유법인 주식등) — 기본세율(누진 6~45%)';
  }

  const foreignTaxCredit = Math.min(Number(p.foreignTaxPaidAmount) || 0, calculatedTax);
  const taxAfterCredit = Math.max(0, calculatedTax - foreignTaxCredit);

  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const penalties = giftFilingPenalties_(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));

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
    입력값: { 자산구분: assetCategory, 양도가액: transferPrice, 취득가액: acquisitionPrice, 양도비용: transferExpenses, 신고상태: filingStatus },
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
    납부세액_합계: totalTax,
    안내: '장기보유특별공제는 주식등에는 적용되지 않습니다. 기본공제(연 250만원)는 국내·국외주식 합산 1회이며, 같은 과세기간에 이미 다른 주식양도에서 기본공제를 썼다면 basicDeductionAlreadyUsed에 넣어야 중복 적용을 막을 수 있습니다. 대주주 판정기준(지분율·시가총액)은 이 도구가 검증하지 않으므로 별도로 확인한 뒤 isDaejuju를 넣으세요. 예정신고(반기별, 파생상품은 생략)와 확정신고(다음해 5월) 의무는 자산 종류별로 다르니 별도로 확인하세요.'
  };
}

// 신축주택·미분양주택 취득자 양도소득세 감면(조특법§99,§99의2,§99의3) — 세 조문 모두 취득기간이
// 정해진 특정 신축주택·미분양주택(§99: 1998.5.22~1999.6.30(국민주택 1999.12.31), §99의2:
// 2013.4.1~2013.12.31, §99의3: 2001.5.23~2003.6.30)을 취득한 경우, 취득일부터 5년 이내 양도하면
// 그 기간 발생한 양도소득금액 전액을 과세대상에서 제외하고(§99의2는 형식상 "세액 100% 감면"이지만
// 결과는 동일), 5년이 지난 후 양도하면 취득일부터 5년간 발생한 양도소득금액만 과세대상에서 뺀다.
function toolCalculateNewHouseAcquisitionReduction(p) {
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
    const fy = fiveYearMarkGain_(totalGain, acquisitionPrice, {
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
    안내: note + ' 이 결과의 "과세대상양도소득금액"을 calculate_transfer_tax 도구에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 도구에서 별도 적용됩니다).'
  };
}

// 미분양주택의 취득자에 대한 양도소득세 과세특례 (조특법§98의3,§98의4,§98의5,§98의6,§98의7,§98의8) — §99
// 계열과 같은 "5년 이내 양도시 감면율만큼 세액감면(=소득금액 전액에 감면율 곱해 제외), 5년 초과 후
// 양도시 5년간 발생분에 감면율을 곱한 금액만 소득금액에서 차감"구조를 공유하되, 조문별로 감면율이 다르다.
function toolCalculateUnsoldHouseAcquisitionReduction(p) {
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
      안내: '조특법§98의4 — 비거주자가 2009.3.16~2010.2.11 취득한 주택(§98의3 미분양주택 외)을 양도할 때는 보유기간 요건 없이 그 양도소득세 산출세액의 100분의 10을 감면합니다. calculate_transfer_tax로 전체 양도차익 기준 세액을 계산한 뒤, 그 산출세액에서 10%를 차감하세요.'
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
  if (yearsHeld <= 5 && provision !== 'sect98_8') {
    exemptGain = Math.round(totalGain * rate / 100);
    note = '취득일로부터 5년 이내 양도이므로 그 양도소득세의 ' + rate + '%에 상당하는 세액을 감면합니다(소득금액의 ' + rate + '%를 과세대상에서 제외한 것과 동일한 효과).';
  } else {
    const fy = fiveYearMarkGain_(totalGain, acquisitionPrice, {
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
    안내: note + ' 이 결과의 "과세대상양도소득금액"을 calculate_transfer_tax 도구에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 도구에서 별도 적용됩니다).'
  };
}

// 수도권 밖의 지역에 있는 준공후미분양주택 취득자에 대한 1세대1주택 비과세 특례 (조특법§98의9,
// 2024.1.10~2026.12.31 취득분) — 1주택을 보유한 1세대가 이 기간 중 수도권 밖 준공후미분양주택을
// 취득한 후 종전주택을 양도하면, 그 준공후미분양주택은 1세대1주택 비과세(소득세법§89①3호) 판정시
// 소유주택으로 보지 않는다. 세액 자체를 계산하지 않고 적용 가능 여부만 판정한다.
function toolCalculateUnsoldHouseOneHouseExclusion(p) {
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
    안내: '요건을 충족하여 그 준공후미분양주택을 1세대1주택 비과세(소득세법§89①3호) 판정시 소유주택으로 보지 않습니다(조특법§98의9①). calculate_transfer_tax에서 종전주택을 양도자산으로 놓고 "1세대1주택 비과세 요건 충족 전제"를 체크해 계산하세요. 종합부동산세 특례(§98의9②)는 9.16~9.30 별도 신청이 필요하며 이 도구의 범위 밖입니다.'
  };
}

// 상속재산으로 보는 보험금·신탁재산·퇴직금 등(간주상속재산, 상증세법§8,§9,§10) — 각 항목의 포함 여부·
// 포함액을 판정해, 그 결과를 상속세 계산기의 "상속재산가액"에 합산해 넣는 용도다.
function toolCalculateDeemedInheritanceProperty(p) {
  p = p || {};
  const itemType = p.itemType;
  const validTypes = ['insurance', 'trust_settled', 'trust_benefit_from_others', 'retirement'];
  if (validTypes.indexOf(itemType) === -1) {
    return { error: 'itemType을 insurance(보험금)/trust_settled(피상속인이 신탁한 재산)/trust_benefit_from_others(피상속인이 타인신탁의 수익권 보유)/retirement(퇴직금등) 중에서 선택하세요.' };
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
    안내: note + ' 이 금액을 calculate_inheritance_tax 도구의 상속재산가액에 합산해 넣으세요.'
  };
}

// 특정법인과의 거래를 통한 이익의 증여 의제 (상증세법§45의5, 시행령§34의5) — §47①에 §45의5가 열거되어
// 있지 않아 합산배제증여재산이 아니므로 일반 증여세 산식(관계별공제 등)을 따르되, ②의 "직접증여시
// 증여세상당액-법인세상당액" 캡이 적용되고, 지배주주등별 증여의제이익이 1억원 미만이면 과세하지 않는다.
function toolCalculateSpecificCorporationGiftTax(p) {
  p = p || {};
  const benefitToCorpAmount = Number(p.benefitToCorpAmount) || 0;
  if (benefitToCorpAmount <= 0) return { error: '특정법인이 얻는 이익(증여재산가액·채무면제이익·자본거래이익·시가차액 등)이 필요합니다.' };
  const corporateTaxAfterCredit = Math.max(0, Number(p.corporateTaxAfterCredit) || 0);
  const corporateTaxableIncome = Number(p.corporateTaxableIncome) || 0;
  const shareholderOwnershipRatio = Math.min(1, Math.max(0, Number(p.shareholderOwnershipRatio) || 0));
  if (shareholderOwnershipRatio <= 0) return { error: '지배주주등의 주식보유비율이 필요합니다.' };

  const incomeRatio = corporateTaxableIncome > 0 ? Math.min(1, benefitToCorpAmount / corporateTaxableIncome) : 0;
  const corporateTaxEquivalentTotal = Math.round(corporateTaxAfterCredit * incomeRatio);
  const specificCorpNetBenefit = Math.max(0, benefitToCorpAmount - corporateTaxEquivalentTotal);
  const giftDeemedAmount = Math.round(specificCorpNetBenefit * shareholderOwnershipRatio);

  if (giftDeemedAmount < 100000000) {
    return {
      과세대상여부: false, 증여의제이익: giftDeemedAmount, 납부세액: 0,
      안내: '증여의제이익(' + giftDeemedAmount + '원)이 1억원 미만이어서 과세하지 않습니다(시행령§34의5⑤).'
    };
  }

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftDeemedAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftDeemedAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  let calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);

  const corporateTaxEquivalentForShareholder = Math.round(corporateTaxEquivalentTotal * shareholderOwnershipRatio);
  const directGiftTaxEquivalent = Number(p.directGiftTaxEquivalent);
  let capApplied = false;
  if (Number.isFinite(directGiftTaxEquivalent) && directGiftTaxEquivalent > 0) {
    const capLimit = Math.max(0, directGiftTaxEquivalent - corporateTaxEquivalentForShareholder);
    if (calculatedTax > capLimit) { calculatedTax = capLimit; capApplied = true; }
  }

  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true,
    특정법인의이익: specificCorpNetBenefit, 법인세상당액_전체: corporateTaxEquivalentTotal,
    증여의제이익: giftDeemedAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: (capApplied ? '산출세액이 §45의5② 한도(직접증여시 증여세상당액-법인세상당액)를 초과해 그 한도로 낮췄습니다. ' : '') + '증여자가 지배주주의 친족이 아닌 특정법인 자체이므로 증여재산공제(§53)는 통상 적용되지 않습니다(위 관계별공제 한도는 0으로 입력하는 것이 원칙입니다). 증여세 과세표준 신고기한은 특정법인의 법인세 과세표준 신고기한이 속하는 달의 말일부터 3개월입니다(§68①).'
  };
}

// 비과세되는 증여재산 (상증세법§46) — 열거된 항목에 해당하면 그 금액에 대해 증여세를 부과하지 않는다.
const NONTAXABLE_GIFT_PROPERTY_LABELS_ = {
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
function toolCalculateNontaxableGiftProperty(p) {
  p = p || {};
  const itemType = p.itemType;
  const meta = NONTAXABLE_GIFT_PROPERTY_LABELS_[itemType];
  if (!meta) return { error: 'itemType을 government/esop/political_party/labor_welfare_fund/disaster_relief/credit_guarantee_fund/public_entity/disabled_insurance/veteran_bereaved/npo_succession 중에서 선택하세요.' };
  const amount = Math.max(0, Number(p.amount) || 0);
  if (amount <= 0) return { error: '금액이 필요합니다.' };
  return {
    비과세여부: true, 근거호: meta.근거호, 비과세금액: amount,
    안내: meta.설명 + ' — ' + meta.근거호 + '에 따라 증여세를 부과하지 않습니다. 세부 요건(대통령령으로 정하는 범위·한도 등)은 별도로 확인하세요. 이 금액은 calculate_gift_tax 도구의 증여재산가액에 포함하지 마세요.'
  };
}

// 합병에 따른 이익의 증여 (상증세법§38, 시행령§28) — 특수관계 법인간 합병에서 대주주등이 합병대가를
// 주식등으로 교부받는 경우(가장 흔한 유형만 구현), (합병후 1주당평가액-과대평가법인1주당평가액×(과대평가
// 법인 합병전주식수÷과대평가법인주주가 교부받은 신설법인주식수))×대주주등이 교부받은 신설법인주식수가 이익이다.
function toolCalculateMergerBenefitGiftTax(p) {
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
  const giftAmount = Math.max(0, Math.round((postMergerValuePerShare - 나) * largeShareholderSharesReceived));
  const totalReceivedValue = postMergerValuePerShare * largeShareholderSharesReceived;
  const gateThreshold = Math.min(totalReceivedValue * 0.3, 300000000);
  if (giftAmount < gateThreshold) {
    return { 과세대상여부: false, 합병이익: giftAmount, 납부세액: 0, 안내: '합병이익(' + giftAmount + '원)이 기준금액(합병후 교부받은 주식가액의 30%와 3억원 중 적은 금액, ' + Math.round(gateThreshold) + '원) 미만이어서 과세하지 않습니다(§38①단서, 시행령§28④1호).' };
  }
  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 합병이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 합병등기일입니다(§38①). 대주주등이 2인 이상인 경우 각자 계산하며, 합병대가를 주식등 외 재산으로 받는 경우(1주당평가액이 액면가액에 미달하는 경우)는 이 계산기가 다루지 않으니 별도로 계산하세요.'
  };
}

// 재산사용 및 용역제공 등에 따른 이익의 증여 (상증세법§42, 시행령§32) — 무상은 시가상당액(담보제공차입은
// 차입금×적정이자율4.6%-실제이자), 저가·고가는 시가와 대가의 차액이 이익이다. 무상은 1천만원, 저가·고가는
// 시가의 30% 미만이면 과세 제외한다.
function toolCalculatePropertyUseServiceGiftTax(p) {
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
  if (giftAmount < gateThreshold) {
    return { 과세대상여부: false, 이익: giftAmount, 납부세액: 0, 안내: '이익(' + giftAmount + '원)이 ' + gateNote + ' 미만이어서 과세하지 않습니다(§42①단서, 시행령§32②).' };
  }
  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '재산사용·용역제공 기간이 1년 이상이면 1년이 되는 날의 다음 날마다 새로 증여받은 것으로 봅니다(§42②). 특수관계인이 아닌 자 간의 거래는 거래관행상 정당한 사유가 없는 경우에만 적용됩니다(§42③).'
  };
}

// 법인의 조직 변경 등에 따른 이익의 증여 (상증세법§42의2, 시행령§32의2) — 지분변동시 (변동후지분-변동전
// 지분)×변동후1주당가액, 평가액변동시 변동후가액-변동전가액이 이익이다. 변동전 재산가액의 30%와 3억원 중
// 적은 금액 미만이면 과세 제외한다.
function toolCalculateOrgChangeGiftTax(p) {
  p = p || {};
  const subType = p.subType;
  if (['share_change', 'value_change'].indexOf(subType) === -1) return { error: 'subType을 share_change(소유지분 변동)/value_change(평가액 변동) 중에서 선택하세요.' };
  let giftAmount, beforeValueForGate;
  if (subType === 'share_change') {
    const beforeShares = Number(p.beforeShares) || 0;
    const afterShares = Number(p.afterShares) || 0;
    const afterValuePerShare = Number(p.afterValuePerShare) || 0;
    giftAmount = Math.max(0, Math.round((afterShares - beforeShares) * afterValuePerShare));
    beforeValueForGate = Number(p.beforePropertyValue) || (beforeShares * afterValuePerShare);
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
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '특수관계인이 아닌 자 간의 거래는 거래관행상 정당한 사유가 없는 경우에만 적용됩니다(§42의2②).'
  };
}

// 재산 취득 후 재산가치 증가에 따른 이익의 증여 (상증세법§42의3, 시행령§32의3) — (사유발생일현재가액-
// 취득가액-통상적가치상승분-가치상승기여분)이 이익이다. (취득가액+통상적가치상승분+가치상승기여분)의
// 30%와 3억원 중 적은 금액 미만이면 과세 제외한다. §47①에 열거된 합산배제증여재산이므로 §55①3호에 따라
// 그 이익에서 3천만원을 공제한 금액이 과세표준이며(관계별 증여재산공제 등은 적용하지 않음), 10년 합산에서도 제외된다.
function toolCalculatePropertyValueIncreaseGiftTax(p) {
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
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 재산가치증가이익: giftAmount,
    과세표준_3천만원공제후: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '합산배제증여재산이므로(§47①) 관계별 증여재산공제(§53)는 적용하지 않고 이익에서 3천만원을 공제해 과세표준을 계산합니다(§55①3호). 재산가치증가사유 발생 전에 그 재산을 양도한 경우에는 양도한 날을 재산가치증가사유 발생일로 봅니다(§42의3②후단). 거짓·부정한 방법으로 증여세를 감소시킨 경우에는 특수관계인이 아닌 자 간에도 적용되며 5년 기간 제한이 없습니다(§42의3③).'
  };
}

// 중소기업간 통합·법인전환에 대한 양도소득세 이월과세 (조특법§31,§32) — 사업용고정자산을 통합법인(§31)에
// 양도하거나 현물출자·사업양수도로 법인전환(§32)하면 그 시점에는 양도소득세를 과세하지 않고 나중에
// 법인이 그 자산을 양도할 때 정산한다. 이월과세 적용일부터 5년 이내에 승계사업을 폐지하거나 취득주식의
// 50% 이상을 처분하면, 사유발생일이 속하는 달의 말일부터 2개월 이내에 이월과세액(법인 기납부세액 제외)을
// 양도소득세로 납부해야 한다(이자상당가산액은 법문에 없음).
function toolCalculateBusinessTransferCarryover(p) {
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
}

// 부담부증여시 양도로 보는 부분의 취득가액·양도가액 (소득세법시행령§159) — 부담부증여로 수증자가 인수한
// 채무액에 상당하는 부분은 양도로 본다(소득세법§88①1호 각목외 부분 후단). 취득가액·양도가액 모두
// "자산가액×(채무액÷증여가액)" 비율을 적용해 안분한다(양도가액 계산식은 결과적으로 채무액과 같아진다).
// §159②는 양도소득세 과세대상 자산과 비과세대상 자산을 함께 부담부증여하는 경우, 전체 증여재산가액 중
// 과세대상 자산가액이 차지하는 비율로 총채무액을 먼저 안분한 뒤 위 계산식을 적용하도록 한다.
function toolCalculateBurdenedGiftTransfer(p) {
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
    안내: note + '이 양도가액(' + transferPortionTransferPrice + '원)·취득가액(' + transferPortionAcquisitionPrice + '원)·필요경비를 calculate_transfer_tax 도구에 그대로 넣어 나머지 세액(장기보유특별공제·기본공제·세율 등)을 계산하세요. 배우자·직계존비속간 부담부증여는 채무 인수를 객관적으로 입증하지 못하면 양도로 보지 않습니다(소득세법§101②·상증세법§47③과 같은 취지 — 이 계산기는 인수 사실이 입증됐다는 전제입니다).'
  };
}

// 가업상속납부유예금액 계산 (상증세법§72의2①, 시행령§69의3①) — 납부유예금액 = 상속세납부세액×
// (가업상속재산가액÷총상속재산가액). 가업상속재산가액은 시행령§15⑤ 기준(가업상속공제 대상 재산가액)이다.
function toolCalculateBusinessSuccessionDeferralAmount(p) {
  p = p || {};
  const taxPayable = Number(p.inheritanceTaxPayable) || 0;
  const businessValue = Number(p.businessSuccessionPropertyValue) || 0;
  const totalValue = Number(p.totalInheritanceValue);
  if (!totalValue || totalValue <= 0) return { error: '총 상속재산가액이 필요합니다.' };
  const deferralAmount = Math.round(taxPayable * businessValue / totalValue);
  return {
    납부유예금액: deferralAmount,
    안내: '시행령§69의3①에 따라 상속세 납부세액(' + taxPayable + '원)×(가업상속재산가액(' + businessValue + '원)÷총상속재산가액(' + totalValue + '원))로 계산했습니다. 가업상속재산가액은 시행령§15⑤ 기준(가업상속공제 대상 재산가액)입니다.'
  };
}

// 물납충당재산(주식)의 수납가액 — 상속개시일부터 수납할 때까지 신주발행·감자가 있었던 경우
// (시행령§75①1호, 시행규칙§20의2) — 신주발행·감자 전 구주 1주당 과세가액을, 신주배정수 또는
// 감자주식수를 반영해 조정한 값이 구주 1주당 수납가액이 된다.
function toolCalculatePropertyInKindStockReceiptValue(p) {
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
}

// 가업상속납부유예(상증세법§72의2)·가업승계증여세납부유예(조특법§30의7) 사후관리 위반시 추징 판정 —
// 두 조문 모두 "정당한 사유 없이" 다음 사유가 생기면 허가를 취소하고 대통령령으로 정하는 이자상당액과
// 함께 징수한다(이자상당액은 calculate_clawback_interest 도구로 별도 계산 — 두 조문 모두 그 도구가
// 쓰는 "국세환급가산금 이율 365분의1" 방식을 적용한다).
// §72의2③: 1호 가업용자산 40%이상처분(소득세법적용 가업만, 처분비율 고려 계산) 2호 가업미종사(전부)
//   3호 지분감소(5년내 전부, 5년후 비율계산) 4호 §18조의2⑤4호 고용유지요건(70%기준) 미달(전부) 5호 상속인사망(전부)
// 조특법§30의7③: 1호 가업미종사(전부) 2호 지분감소(5년내 전부, 5년후 비율계산) 3호 고용유지요건(전부) 4호 수증자사망(전부)
//   — §72의2의 "가업용자산40%처분" 사유(개인가업만 해당)가 없다(§30의7은 법인 주식등 증여만 다루므로).
// "처분비율을 고려하여 계산한 세액"(시행령§69의3③, 상속만)은 [납부유예세액×가업용자산의처분비율]이고,
// "지분감소비율을 고려하여 계산한 세액"(시행령§69의3⑥ 상속·조특법시행령§27의7⑩ 증여)은
// [납부유예세액×(감소한지분율÷기준일(상속개시일·증여일)현재지분율)]이다(둘 다 원문 확인).
function toolCalculateBusinessSuccessionDeferralClawback(p) {
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
  } else {
    clawbackAmount = deferredTaxAmount;
    note = personSubj + ' 사망하여 상속이 개시되어 ' + provisionLabel + '③ 사유가 발생했습니다. 납부유예된 세액 전부를 추징합니다.';
  }

  return {
    상태: '추징대상', 납부유예세액: deferredTaxAmount, 추징세액: clawbackAmount, 사용비율: ratioUsed,
    안내: note + ' 사유발생일이 속하는 달의 말일부터 ' + (provision === 'inheritance' ? '6개월' : '3개월') + ' 이내에 신고하고 이 추징세액과 이자상당액을 납부해야 합니다(' + provisionLabel + '④). 이자상당액은 calculate_clawback_interest 도구에 이 추징세액과 납부유예 허가일(이자 기산일)·사유발생일을 넣어 별도로 계산하세요. "정당한 사유"가 있는 경우(수용, 폐업 후 사업전환 등 시행령이 정하는 사유)에는 추징하지 않으니 해당 여부를 먼저 확인하세요.'
  };
}

// 물납 적용 가능 여부 판정 (상속세및증여세법§73 일반물납, §73의2 문화유산등물납) — 세액 자체가 아니라
// 요건 충족 여부를 판정한다. 물납충당재산의 "수납가액"은 원칙적으로 상속재산의 가액(이미 상속세
// 과세가액 산정에 쓴 평가액)과 같다(시행령§75①본문, §75의5제1호외의경우) — 별도 계산이 필요 없다.
// 다만 (a)주식을 발행한 법인이 상속개시일부터 물납수납일 사이에 신주발행·감자를 한 경우(§75①1호),
// (b)연부연납 분납세액에 대한 물납의 경우(§75①2호, §75의5제1호), (c)유가증권가액이 물납기간 중
// 정당한 사유 없이 30%이상 하락한 경우(§75①3호)는 예외적으로 재정경제부령이 정하는 별도 산식을
// 쓰는데, 그 산식 자체는 시행규칙 원문 이미지로 확인되지 않아 이 도구가 다루지 않는다(해당하면
// 수납가액을 별도로 계산해서 활용해야 한다). §73①은 3요건 모두 충족해야 하고(관리·처분부적당시
// 그래도 불허가 가능), §73의2①은 2요건만 있으며 부동산·유가증권 비율 요건이 없다. §73의2⑤(물납신청
// 가능세액 한도="문화유산등의 가액에 대한 상속세 납부세액"을 초과할 수 없음)은 상속세납부세액×
// (문화유산등가액÷상속재산가액) 비율로 계산한다. 상속개시일 이후 물납신청 전까지 정당한 사유 없이
// 훼손·멸실 등(시행령§75의4①)에 해당하게 된 문화유산등이 있으면 그 가액은 한도 계산에서 제외한다
// (시행령§75의2⑤).
function toolCalculatePropertyInKindPaymentEligibility(p) {
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
      ? (provision === 'general' ? '§73①의 3가지 요건을 모두 충족합니다. 다만 물납을 신청한 재산의 관리·처분이 적당하지 않다고 인정되면 세무서장이 불허가할 수 있습니다(§73①단서). 물납충당재산의 수납가액은 원칙적으로 상속재산의 가액과 같으며(시행령§75①본문), 신주발행·감자가 있었던 주식·연부연납분납·유가증권 30%이상 하락 등 예외 사유가 있으면 별도 산식(시행규칙, 이 도구는 다루지 않음)을 확인하세요.' : '§73의2①의 2가지 요건을 모두 충족해 문화유산등에 대한 물납을 신청할 수 있습니다. 다만 문화체육관광부장관의 물납 필요성 인정(③) 및 국고손실위험 판단(④)을 거쳐야 최종 허가됩니다. 물납충당재산의 수납가액은 원칙적으로 상속재산의 가액과 같습니다(시행령§75의5제1호외의경우).')
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
}

// 지정문화유산 등에 대한 상속세 징수유예 (상속세및증여세법§74, 증여세는 §75가 준용) — 문화유산자료등·
// 박물관자료등·국가지정문화유산등·천연기념물등에 상당하는 상속세(증여세)액의 징수를 유예한다.
// "그 재산가액에 상당하는 상속세액"을 상속세납부세액×(해당재산가액÷상속재산가액) 비율로 근사 계산한다
// (정확한 시행령 산식 미확인). 유상양도 또는 인출(박물관자료등만)시 즉시 징수하며(②), 이 징수에는
// 법문상 별도 이자상당가산액 규정이 없다(§74②는 "즉시 그 징수유예한 상속세를 징수" 라고만 함).
function toolCalculateCulturalHeritageTaxDeferral(p) {
  p = p || {};
  const taxType = p.taxType === 'gift' ? 'gift' : 'inheritance';
  const totalTaxPayable = Number(p.totalTaxPayable) || 0;
  const totalPropertyValue = Number(p.totalPropertyValue) || 0;
  const eligiblePropertyValue = Number(p.eligiblePropertyValue) || 0;
  if (totalTaxPayable <= 0 || totalPropertyValue <= 0 || eligiblePropertyValue <= 0) {
    return { error: (taxType === 'gift' ? '증여세' : '상속세') + ' 납부세액, ' + (taxType === 'gift' ? '증여재산가액' : '상속재산가액') + ', 징수유예대상 재산가액이 필요합니다.' };
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
    안내: '해당 재산가액에 상당하는 ' + (taxType === 'gift' ? '증여세' : '상속세') + '액(' + deferredTaxAmount + '원 — 납부세액×해당재산가액÷' + (taxType === 'gift' ? '증여재산가액' : '상속재산가액') + ' 비율 근사치, 정확한 시행령 산식은 별도 확인 필요)의 징수를 유예합니다. 유상양도·인출시 즉시 징수되고(사유 transferred_or_withdrawn), 상속의 경우 소유자 사망으로 재상속되면 부과가 철회됩니다(사유 reinheritance_death, 상속세만). 징수유예를 받으려면 그 세액에 상당하는 담보를 제공해야 합니다(§74④, 국가지정문화유산등·천연기념물등은 담보 면제 가능 — ⑤).'
  };
}

// 구조조정대상 부동산 취득자에 대한 양도소득세의 감면 (조특법§43) — 1999.12.31 이전 취득분에 한해 5년
// 이내 양도시 50% 세액감면, 5년 초과 후 양도시 5년간발생분의 50% 소득공제.
function toolCalculateRestructuringPropertyReduction(p) {
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

  let exemptGain, note;
  if (yearsHeld <= 5) {
    exemptGain = Math.round(totalGain * 0.5);
    note = '취득일로부터 5년 이내 양도이므로 그 양도소득세의 50%에 상당하는 세액을 감면합니다.';
  } else {
    const fy = fiveYearMarkGain_(totalGain, acquisitionPrice, {
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
    안내: note + ' 이 결과의 "과세대상양도소득금액"을 calculate_transfer_tax 도구에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 도구에서 별도 적용됩니다). 1999.12.31 이전 취득분만 적용됩니다(§43①).'
  };
}

// 인구감소지역 주택 취득자에 대한 1세대1주택 비과세 특례 (조특법§71의2, 2024.1.4~2026.12.31 취득분,
// 현재 시행중) — §98의9와 같은 구조. 세액을 계산하지 않고 적용 가능 여부만 판정한다.
function toolCalculatePopulationDeclineAreaHouseExclusion(p) {
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
    안내: '요건을 충족하여 그 인구감소지역주택을 1세대1주택 비과세(소득세법§89①3호·4호) 판정시 소유주택으로 보지 않습니다(조특법§71의2①). calculate_transfer_tax에서 종전주택을 양도자산으로 놓고 "1세대1주택 비과세 요건 충족 전제"를 체크해 계산하세요. 종합부동산세 특례(§71의2②)는 9.16~9.30 별도 신청이 필요하며 이 도구의 범위 밖입니다.'
  };
}

// 증자에 따른 이익의 증여 (상증세법§39, 시행령§29②) — caseType으로 5가지 세부 케이스 중 선택.
function toolCalculateCapitalIncreaseGiftTax(p) {
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

  let giftAmount, postValuePerShare;

  if (caseType === 'low_allocated' || caseType === 'high_allocated') {
    const increasedShares = Number(p.increasedShares) || 0;
    postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);
    const allocatedShares = Number(p.allocatedShares) || 0;
    if (caseType === 'low_allocated') {
      giftAmount = Math.max(0, Math.round((postValuePerShare - issuePricePerShare) * allocatedShares));
    } else {
      giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * allocatedShares));
    }
  } else if (caseType === 'low_unallocated') {
    const equalIncreaseShares = Number(p.equalIncreaseShares) || 0;
    postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * equalIncreaseShares) / (preShares + equalIncreaseShares);
    const deemedAllocatedShares = Number(p.deemedAllocatedShares) || 0;
    giftAmount = Math.max(0, Math.round((postValuePerShare - issuePricePerShare) * deemedAllocatedShares));
  } else if (caseType === 'high_unallocated') {
    const increasedShares = Number(p.increasedShares) || 0;
    postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);
    const forfeitedShares = Number(p.forfeitedShares) || 0;
    const relatedAcquiredShares = Number(p.relatedAcquiredShares) || 0;
    const equalIncreaseTotalShares = Number(p.equalIncreaseTotalShares) || 0;
    if (equalIncreaseTotalShares <= 0) return { error: '균등증자시 증가주식수 총수가 필요합니다.' };
    giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * forfeitedShares * (relatedAcquiredShares / equalIncreaseTotalShares)));
  } else { // high_nonshareholder
    const increasedShares = Number(p.increasedShares) || 0;
    postValuePerShare = (preValuePerShare * preShares + issuePricePerShare * increasedShares) / (preShares + increasedShares);
    const underAllocatedShares = Number(p.underAllocatedShares) || 0;
    const relatedAcquiredShares = Number(p.relatedAcquiredShares) || 0;
    const nonShareholderAndExcessTotalShares = Number(p.nonShareholderAndExcessTotalShares) || 0;
    if (nonShareholderAndExcessTotalShares <= 0) return { error: '비주주배정신주+균등초과인수신주의 총수가 필요합니다.' };
    giftAmount = Math.max(0, Math.round((issuePricePerShare - postValuePerShare) * underAllocatedShares * (relatedAcquiredShares / nonShareholderAndExcessTotalShares)));
  }

  if (caseType === 'low_unallocated') {
    const diffRatio = postValuePerShare > 0 ? (postValuePerShare - issuePricePerShare) / postValuePerShare : 0;
    if (!(diffRatio >= 0.3 || giftAmount >= 300000000)) {
      return { 과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0, 안내: '차액비율이 30% 미만이고 이익도 3억원 미만이어서 과세하지 않습니다(시행령§29②2호).' };
    }
  } else if (caseType === 'high_unallocated') {
    const diffRatio = issuePricePerShare > 0 ? (issuePricePerShare - postValuePerShare) / issuePricePerShare : 0;
    if (!(diffRatio >= 0.3 || giftAmount >= 300000000)) {
      return { 과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0, 안내: '차액비율이 30% 미만이고 이익도 3억원 미만이어서 과세하지 않습니다(시행령§29②4호).' };
    }
  }

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 증자후1주당평가액: Math.round(postValuePerShare), 증여의제이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 주식대금 납입일 등입니다(§39①, 시행령§29①). high_nonshareholder(시행령5호, 법§39①2호다·라목)는 시행령§29②5호 원문상 별도의 게이트(문턱금액) 조항이 없어 게이트 없이 계산합니다.'
  };
}

// 장기임대주택 등에 대한 양도소득세 감면 (조특법§97,§97의2,§97의5, §97의4와는 별개 조문) — 모두 "양도
// 소득세의 일정 비율을 세액감면"하는 정액감면 구조를 공유한다.
function toolCalculateLongTermRentalHouseReduction(p) {
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
      rate = 50;
      note = '2000.12.31 이전 임대를 개시해 5년 이상 임대한 국민주택이므로 양도소득세의 50%를 감면합니다(§97①본문).';
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
    let rentalPeriodGain;
    if (acqStd > 0 && regStd > 0 && trfStd > 0 && trfStd !== acqStd) {
      rentalPeriodGain = totalGain * (trfStd - regStd) / (trfStd - acqStd);
      note += ' 기준시가 비율로 정확히 계산했습니다: 전체양도소득금액 × (양도당시기준시가－등록일당시기준시가) ÷ (양도당시기준시가－취득당시기준시가).';
    } else {
      const registrationDateValue = Number(p.registrationDateValue) || 0;
      if (registrationDateValue <= 0) return { error: '기준시가 3종(취득당시·등록일당시·양도당시)을 모두 입력하거나, 그것이 없으면 최소한 등록일 현재의 평가액을 입력하세요(임대기간중 발생분 산정용).' };
      rentalPeriodGain = Math.max(0, transferPrice - registrationDateValue);
      note += ' 기준시가 3종이 입력되지 않아, 입력하신 등록일 현재 평가액을 기준으로 근사 계산했습니다(정확한 산정은 기준시가 3종을 모두 입력하세요).';
    }
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
    안내: note + ' 이 결과의 "과세대상양도소득금액"을 calculate_transfer_tax 도구에 그 자산의 양도차익으로 대신 넣어 나머지 세액을 계산하세요(장기보유특별공제·기본공제 등은 그 도구에서 별도 적용됩니다).'
  };
}

// 비과세되는 상속재산 (상증세법§12) — §46의 상속세 버전.
const NONTAXABLE_INHERITANCE_PROPERTY_LABELS_ = {
  government: { 근거호: '§12 1호', 설명: '국가·지방자치단체·공공단체에 유증등을 한 재산' },
  ancestral_property: { 근거호: '§12 3호', 설명: '민법§1008의3에 규정된 재산(제사를 주재하는 자가 승계하는 금양임야·묘토인 농지·족보·제구 등) 중 대통령령으로 정하는 범위의 재산' },
  political_party: { 근거호: '§12 4호', 설명: '「정당법」에 따른 정당에 유증등을 한 재산' },
  labor_welfare_fund: { 근거호: '§12 5호', 설명: '「근로복지기본법」에 따른 사내근로복지기금 등에 유증등을 한 재산' },
  disaster_relief: { 근거호: '§12 6호', 설명: '사회통념상 인정되는 이재구호금품·치료비 등' }
};
function toolCalculateNontaxableInheritanceProperty(p) {
  p = p || {};
  const itemType = p.itemType;
  const meta = NONTAXABLE_INHERITANCE_PROPERTY_LABELS_[itemType];
  if (!meta) return { error: 'itemType을 government/ancestral_property/political_party/labor_welfare_fund/disaster_relief 중에서 선택하세요.' };
  const amount = Math.max(0, Number(p.amount) || 0);
  if (amount <= 0) return { error: '금액이 필요합니다.' };
  return {
    비과세여부: true, 근거호: meta.근거호, 비과세금액: amount,
    안내: meta.설명 + ' — ' + meta.근거호 + '에 따라 상속세를 부과하지 않습니다. 세부 요건(대통령령으로 정하는 범위·한도 등)은 별도로 확인하세요. 이 금액은 calculate_inheritance_tax 도구의 상속재산가액에 포함하지 마세요.'
  };
}

// 초과배당에 따른 이익의 증여 (상증세법§41의2, 시행령§31의2) — 초과배당금액에서 소득세상당액을 뺀
// 금액을 증여재산가액으로 한다. 신고기한전 소득세상당액은 시행규칙§10의3①의 추정율표
// (EXCESS_DIVIDEND_INCOME_TAX_ESTIMATE_BRACKETS)로 자동계산하며, estimatedIncomeTaxEquivalent를
// 직접 입력하면 그 값을 그대로 우선 사용한다.
function toolCalculateExcessDividendGiftTax(p) {
  p = p || {};
  const isFinalSettlement = !!p.isFinalSettlement;
  const excessDividendBaseAmount = Number(p.excessDividendBaseAmount) || 0;
  if (excessDividendBaseAmount <= 0) return { error: '최대주주등의 특수관계인이 보유주식등에 비례한 금액을 초과해 받은 배당등의 금액(초과배당금액 산정용)이 필요합니다.' };
  const disproportionateShortfallRatio = Math.min(1, Math.max(0, Number(p.disproportionateShortfallRatio) || 0));
  const excessDividendAmount = Math.round(excessDividendBaseAmount * disproportionateShortfallRatio);

  let incomeTaxEquivalent, note;
  if (isFinalSettlement) {
    incomeTaxEquivalent = Number(p.actualIncomeTax) || 0;
    note = '정산증여재산가액 = 초과배당금액 - 실제소득세액(§41의2②·④)으로 계산했습니다. 정산 신고기한은 초과배당금액이 발생한 연도의 다음 연도 5.1~5.31(성실신고확인대상사업자는 6.30)입니다.';
  } else if (Number(p.estimatedIncomeTaxEquivalent) > 0) {
    incomeTaxEquivalent = Number(p.estimatedIncomeTaxEquivalent);
    note = '직접 입력한 소득세상당액 추정치를 그대로 사용했습니다. 이후 실제 소득세를 납부할 때 정산증여재산가액(실제소득세액 기준)으로 다시 계산해 차액을 추가납부하거나 환급받아야 합니다(§41의2②).';
  } else {
    incomeTaxEquivalent = calcProgressiveTax_(excessDividendAmount, EXCESS_DIVIDEND_INCOME_TAX_ESTIMATE_BRACKETS);
    note = '최초 신고시 소득세상당액은 시행규칙§10의3①의 추정율표로 초과배당금액(' + excessDividendAmount + '원)에서 산정한 ' + incomeTaxEquivalent + '원입니다. 이후 실제 소득세를 납부할 때 정산증여재산가액(실제소득세액 기준)으로 다시 계산해 차액을 추가납부하거나 환급받아야 합니다(§41의2②).';
  }
  const giftAmount = Math.max(0, excessDividendAmount - incomeTaxEquivalent);

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 초과배당금액: excessDividendAmount, 소득세상당액: incomeTaxEquivalent, 증여의제이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: note
  };
}

// 주식등의 상장 등에 따른 이익의 증여 / 합병에 따른 상장 등 이익의 증여 (상증세법§41의3,§41의5, 시행령
// §31의3) — 정산기준일 1주당평가액에서 당초1주당과세가액(또는취득가액)과 1주당기업가치실질증가이익을
// 뺀 금액에 주식수를 곱한다. 게이트: min((당초가액+실질증가이익)×주식수×30%, 3억원).
function toolCalculateStockListingGiftTax(p) {
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
    return {
      과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0,
      안내: '이익(' + giftAmount + '원)이 기준금액 미만이어서 과세하지 않습니다(' + (provision === 'merger' ? '§41의5①단서' : '§41의3①단서') + ', 시행령§31의3③).'
    };
  }

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 증여의제이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: (provision === 'merger'
      ? '증여일은 합병등기일부터 3개월이 되는 날(정산기준일)입니다(§41의5②가 §41의3③을 준용, "상장일"을 "합병등기일"로 봄).'
      : '증여일은 상장일부터 3개월이 되는 날(정산기준일)입니다(§41의3③). 그 전에 사망·증여·양도하면 그 날이 정산기준일이 됩니다.')
      + ' 당초 증여세 과세가액에 이 이익을 가산해 정산하며, 정산기준일 현재 주식가액이 당초 과세가액보다 적어졌고 그 차액이 기준 이상이면 차액분 세액을 환급받을 수 있습니다(§41의3④, 시행령 기준 별도 확인).'
  };
}

// 농어촌주택등 취득자에 대한 양도소득세 과세특례 (조특법§99의4, 2003.8.1~2028.12.31 취득분, 현재
// 시행중) — §98의9·§71의2와 같은 구조. 세액을 계산하지 않고 적용 가능 여부·사후관리 추징대상 여부만 판정.
function toolCalculateRuralHouseOneHouseExclusion(p) {
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
    안내: '요건을 충족하여 그 ' + (houseType === 'hometown' ? '고향주택' : '농어촌주택') + '을 1세대1주택 비과세(소득세법§89①3호) 판정시 소유주택으로 보지 않습니다(조특법§99의4①). calculate_transfer_tax에서 일반주택을 양도자산으로 놓고 "1세대1주택 비과세 요건 충족 전제"를 체크해 계산하세요.'
  };
}

// 전환사채등의 주식전환등에 따른 이익의 증여 (상증세법§40, 시행령§30) — 4가지 세부 케이스.
// conversion·conversion_reverse·transfer(법§40①2·3호)는 §47①에 열거된 합산배제증여재산이므로 §55①3호에
// 따라 이익에서 3천만원을 공제한 금액이 과세표준이며, acquisition(법§40①1호)은 일반 증여세 산식을 따른다.
function toolCalculateConvertibleBondGiftTax(p) {
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
      const interestLossAmount = Number(p.interestLossAmount) || 0;
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

  if (giftAmount < gateThreshold) {
    return { 과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0, 안내: '이익(' + giftAmount + '원)이 기준금액(' + gateThreshold + '원) 미만이어서 과세하지 않습니다(시행령§30②).' };
  }

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;

  let taxBase, isAggregationExcluded;
  let relationDeductionOut = 0, marriageBirthDeductionOut = 0, disasterLossAmountOut = 0;
  if (caseType === 'acquisition') {
    isAggregationExcluded = false;
    const disasterLossAmount = Number(p.disasterLossAmount) || 0;
    const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
    const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
    const priorGiftAmount = Number(p.priorGiftAmount) || 0;
    taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
    relationDeductionOut = relationDeduction; marriageBirthDeductionOut = marriageBirthDeduction; disasterLossAmountOut = disasterLossAmount;
  } else {
    isAggregationExcluded = true;
    taxBase = Math.max(0, giftAmount - 30000000 - appraisalFeeAmount);
  }
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);

  const result = {
    과세대상여부: true, 증여의제이익: giftAmount,
    감정평가수수료공제: appraisalFeeAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: isAggregationExcluded
      ? '합산배제증여재산이므로(§47①) 관계별 증여재산공제(§53)는 적용하지 않고 이익에서 3천만원을 공제해 과세표준을 계산합니다(§55①3호). 이자손실분·조정공제 등 세부 계산은 시행규칙§10의2를 별도로 확인해서 반영하세요.'
      : '증여일은 전환사채등을 인수·취득한 날입니다(시행령§30①1호).'
  };
  if (!isAggregationExcluded) {
    result.증여재산공제 = relationDeductionOut; result.혼인출산공제 = marriageBirthDeductionOut; result.재해손실공제 = disasterLossAmountOut;
  }
  return result;
}

// 현물출자에 따른 이익의 증여 (상증세법§39의3, 시행령§29의3) — §39(증자)의 이미 확립된 공식을 "증자"를
// "현물출자"로 치환해 그대로 준용한다. low_price(1호, §39의 low_allocated와 동일 산식, 게이트 없음),
// high_price(2호, §39의 high_allocated에 특수관계인 지분비율 곱셈이 추가됨, 게이트 있음).
function toolCalculateInKindContributionGiftTax(p) {
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
    const diffRatio = postValuePerShare > 0 ? (issuePricePerShare - postValuePerShare) / postValuePerShare : 0;
    if (!(diffRatio >= 0.3 || giftAmount >= 300000000)) {
      return { 과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0, 안내: '차액비율이 30% 미만이고 이익도 3억원 미만이어서 과세하지 않습니다(시행령§29의3②).' };
    }
  }

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 현물출자후1주당평가액: Math.round(postValuePerShare), 증여의제이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 현물출자 납입일 등입니다(시행령§29①을 준용). §39(증자에 따른 이익의 증여)와 계산구조가 같습니다.'
  };
}

// 국외자산 양도소득세 (소득세법§118의2~§118의8) — 국내자산 양도세와 완전히 별도로 계산한다. 세율은
// §55①(국내양도세와 같은 기본누진세율표) 그대로, 장기보유특별공제는 미적용, 기본공제는 국내와 별도
// 연250만원. 외국납부세액은 세액공제(한도=산출세액) 또는 필요경비산입 중 선택.
function toolCalculateOverseasAssetTransferTax(p) {
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
  const calculatedTax = calcProgressiveTax_(taxBase, TRANSFER_TAX_BRACKETS);

  const foreignTaxCreditMethod = p.foreignTaxCreditMethod === 'expense' ? 'expense' : 'credit';
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  // §118의6①·시행령§178의7 — 공제한도 = 산출세액 × (국외자산양도소득금액 ÷ 해당 과세기간 양도소득금액 합계액).
  // domesticTransferIncomeAmount(같은 과세기간 국내자산 양도소득금액)를 입력하면 정확한 비율로 한도를 계산하고,
  // 입력하지 않으면(국외자산양도소득만 있는 경우) 비율이 1이 되어 한도=산출세액이 된다.
  const domesticTransferIncomeAmount = Math.max(0, Number(p.domesticTransferIncomeAmount) || 0);
  const totalIncomeAmountForRatio = Math.max(0, gain) + domesticTransferIncomeAmount;
  const creditRatio = totalIncomeAmountForRatio > 0 ? Math.max(0, gain) / totalIncomeAmountForRatio : 1;
  const foreignTaxCreditLimit = Math.round(calculatedTax * creditRatio);
  const foreignTaxCredit = foreignTaxCreditMethod === 'credit' ? Math.min(foreignTaxPaidAmount, foreignTaxCreditLimit) : 0;
  const taxAfterCredit = Math.max(0, calculatedTax - foreignTaxCredit);

  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const penalties = giftFilingPenalties_(taxAfterCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const localIncomeTax = Math.round(taxAfterCredit * 0.1);
  const totalTax = Math.max(0, taxAfterCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty + localIncomeTax);

  return {
    적용여부: true,
    양도차익: Math.round(gain), 기본공제: basicDeduction, 과세표준: taxBase,
    산출세액: calculatedTax, 외국납부세액공제한도: foreignTaxCreditLimit, 외국납부세액공제: foreignTaxCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    지방소득세: localIncomeTax, 납부세액_합계: totalTax,
    안내: '장기보유특별공제는 국외자산에는 적용되지 않습니다(§118의8단서). 기본공제(연250만원)는 국내자산 양도소득과 별도로 적용됩니다(§118의7). 양도가액·취득가액은 원칙적으로 실지거래가액이며, 확인 안 되면 소재국 시가(그래도 안되면 대통령령이 정하는 방법)를 씁니다. 국외전출자 국내주식등 출국세(§118의9~118의18)는 2027.1.1 시행 예정이라 아직 시행 전이며 핵심 세율표도 확인되지 않아 이 계산기가 다루지 않습니다.'
  };
}

// 감자에 따른 이익의 증여 (상증세법§39의2, 시행령§29의2) — 1호(저가소각) = (1주당평가액-지급액)×
// 총감자주식수×대주주등의감자후지분비율×(특수관계인감자주식수÷총감자주식수), 2호(고가소각) = (지급액-
// 1주당평가액)×해당주주등의감자주식수. 게이트: 기준금액 3억원, 차액비율 30%이상이면 기준금액 0.
function toolCalculateCapitalReductionGiftTax(p) {
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
    const ownReducedShares = Number(p.ownReducedShares) || 0;
    giftAmount = Math.max(0, Math.round((paymentPerShare - valuePerShare) * ownReducedShares));
  }

  const diffRatio = Math.abs(valuePerShare - paymentPerShare) / valuePerShare;
  const gateThreshold = diffRatio >= 0.3 ? 0 : 300000000;
  if (giftAmount < gateThreshold) {
    return {
      과세대상여부: false, 증여의제이익: giftAmount, 납부세액: 0,
      안내: '이익(' + giftAmount + '원)이 기준금액(' + gateThreshold + '원) 미만이어서 과세하지 않습니다(시행령§29의2②).'
    };
  }

  const appraisalFeeAmount = Math.min(Number(p.appraisalFeeAmount) || 0, 5000000);
  const disasterLossAmount = Number(p.disasterLossAmount) || 0;
  const marriageBirthDeduction = Number(p.marriageBirthDeduction) || 0;
  const relationDeduction = Math.min(Number(p.relationDeductionLimit) || 0, Math.max(0, giftAmount));
  const priorGiftAmount = Number(p.priorGiftAmount) || 0;
  const taxBase = Math.max(0, giftAmount + priorGiftAmount - relationDeduction - marriageBirthDeduction - appraisalFeeAmount - disasterLossAmount);
  const calculatedTax = calcProgressiveTax_(taxBase, GIFT_INHERIT_TAX_BRACKETS);
  const priorPaidTax = Number(p.priorPaidTax) || 0;
  const foreignTaxPaidAmount = Number(p.foreignTaxPaidAmount) || 0;
  const taxAfterCredit = Math.max(0, calculatedTax - priorPaidTax - foreignTaxPaidAmount);
  const filingStatus = ['ontime', 'unreported', 'underreported'].indexOf(p.filingStatus) !== -1 ? p.filingStatus : 'ontime';
  const reportedInTime = filingStatus === 'ontime' && p.reportedInTime !== false;
  const reportCredit = reportedInTime ? Math.round(taxAfterCredit * 0.03) : 0;
  const penalties = giftFilingPenalties_(taxAfterCredit - reportCredit, filingStatus, !!p.isFraudulent, p.underreportedTaxAmount, p.unpaidDays, Number(p.unpaidTaxForLatePenalty));
  const finalTax = Math.max(0, taxAfterCredit - reportCredit + penalties.unreportedPenalty + penalties.underreportedPenalty + penalties.latePenalty);
  return {
    과세대상여부: true, 증여의제이익: giftAmount,
    증여재산공제: relationDeduction, 혼인출산공제: marriageBirthDeduction, 감정평가수수료공제: appraisalFeeAmount, 재해손실공제: disasterLossAmount,
    과세표준: taxBase, 산출세액: calculatedTax, 신고세액공제: reportCredit,
    무신고가산세: penalties.unreportedPenalty, 과소신고가산세: penalties.underreportedPenalty, 납부지연가산세: penalties.latePenalty,
    납부세액: finalTax,
    안내: '증여일은 감자를 위한 주주총회결의일 등입니다(시행령§29의2①). 대주주등의 판정기준은 §38·§39의2와 동일합니다.'
  };
}

// 장애인이 증여받은 재산의 과세가액 불산입 (상속세및증여세법§52의2) — 요건 충족시 자익신탁 증여재산가액
// 또는 타익신탁 신탁수익을 증여세 과세가액에 산입하지 않는다. 장애인 생애 5억원 한도(§52의2③), 신탁
// 해지·만료·수익자변경·이익타인귀속·원본감소 등 사후관리 위반시 즉시 증여세 부과(부득이한사유 예외).
function toolCalculateDisabledPersonTrustExclusion(p) {
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
}

// 공익법인등에 출연한(출연받은) 재산에 대한 상속세·증여세 과세가액 불산입 (상속세및증여세법§16,§48①) —
// 원칙 전액 불산입, 내국법인 주식등은 합산주식수가 한도비율 초과시 그 초과분만 과세가액 산입.
function toolCalculateCharityDonationTaxExclusion(p) {
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
}

// 공익법인등에 대한 가산세 등 (상속세및증여세법§78) — §48②5호·7호 미달사용 기준금액은 §38⑤(운용소득)·
// §38⑦(매각대금)·§38⑱(7호)의 산식으로 자동계산하거나, 이미 산정된 미달사용액을 직접 입력받는다.
function toolCalculatePublicInterestOrgPenalty(p) {
  p = p || {};
  const penaltyType = p.penaltyType;
  const validTypes = ['report_not_filed', 'stock_holding_exceeded_5pct', 'management_violation', 'director_excess',
    'stock_holding_exceeded_related', 'advertising', 'income_underused', 'dedicated_account_not_opened', 'dedicated_account_unused',
    'disclosure_violation', 'report_not_filed_5pct', 'cultural_heritage_status_not_filed', 'cultural_heritage_transfer_not_filed'];
  if (validTypes.indexOf(penaltyType) === -1) return { error: 'penaltyType을 ' + validTypes.join('/') + ' 중에서 선택하세요.' };

  let penaltyAmount, note;
  if (penaltyType === 'report_not_filed') {
    const baseTaxAmount = Number(p.baseTaxAmount) || 0;
    if (baseTaxAmount <= 0) return { error: '미제출분 또는 불분명한 부분의 금액에 상당하는 상속세액(증여세액)이 필요합니다.' };
    penaltyAmount = Math.round(baseTaxAmount * 0.01);
    note = '§48⑤에 따른 출연재산 사용계획·진도 보고서를 미제출하거나 그 내용이 불분명하여 §78③에 따라 해당 금액에 상당하는 세액의 100분의 1을 가산세로 징수합니다.';
  } else if (penaltyType === 'stock_holding_exceeded_5pct') {
    const excessStockValue = Number(p.excessStockValue) || 0;
    if (excessStockValue <= 0) return { error: '§49① 보유기준(5%)을 초과하는 주식등의 시가가 필요합니다.' };
    penaltyAmount = Math.round(excessStockValue * 0.05);
    note = '§49① 주식등 보유기준(5%)을 초과 보유해 §78④에 따라 그 초과분 시가의 100분의 5를 매년 말 현재 기준으로 가산세로 부과합니다(부과기간 최대 10년 — 매년 별도로 계산해야 합니다).';
  } else if (penaltyType === 'management_violation') {
    const revenueAndDonationAmount = Number(p.revenueAndDonationAmount) || 0;
    if (revenueAndDonationAmount <= 0) return { error: '해당 과세기간(사업연도)의 수입금액과 그 기간에 출연받은 재산가액의 합계가 필요합니다.' };
    const violationSubType = p.violationSubType;
    let raw = Math.round(revenueAndDonationAmount * 0.0007);
    if (violationSubType === 'tax_confirmation') raw = Math.max(raw, 1000000);
    penaltyAmount = raw;
    note = '§78⑤에 따라 (해당 과세기간·사업연도의 수입금액+그 기간에 출연받은 재산가액)×1만분의7을 상속세(증여세)로 징수합니다' + (violationSubType === 'tax_confirmation' ? '(세무확인 보고의무 불이행의 경우 계산된 금액이 100만원 미만이면 100만원으로 합니다).' : '(장부작성·비치의무 또는 회계감사의무 불이행).');
  } else if (penaltyType === 'director_excess') {
    const relatedExpenseAmount = Number(p.relatedExpenseAmount) || 0;
    if (relatedExpenseAmount <= 0) return { error: '§48⑧을 초과하는 이사·임직원과 관련하여 지출된 직접경비·간접경비 금액이 필요합니다.' };
    penaltyAmount = relatedExpenseAmount;
    note = '§48⑧에 따른 이사 정원(현재 이사 수의 5분의 1, 이사 수가 5명 미만이면 5명 기준)을 초과하는 이사가 있거나 출연자·특수관계인이 임직원이 되어, §78⑥에 따라 그와 관련해 지출된 직접·간접경비 전액을 매년 가산세로 부과합니다.';
  } else if (penaltyType === 'stock_holding_exceeded_related') {
    const stockValue = Number(p.stockValue) || 0;
    const totalAssetValue = Number(p.totalAssetValue) || 0;
    if (stockValue <= 0 || totalAssetValue <= 0) return { error: '보유 중인 특수관계 내국법인 주식등의 가액과 공익법인등의 총재산가액이 필요합니다.' };
    const limitRatio = p.meetsComplianceRequirements ? 0.5 : 0.3;
    const limitValue = totalAssetValue * limitRatio;
    const excessValue = Math.max(0, stockValue - limitValue);
    penaltyAmount = Math.round(excessValue * 0.05);
    note = '§48⑨에 따른 특수관계 내국법인 주식등 보유한도(총재산가액의 ' + Math.round(limitRatio * 100) + '% — 회계감사·전용계좌·결산공시 의무를 모두 이행하면 50%, 아니면 30%)를 초과 보유해 §78⑦에 따라 그 초과분(' + excessValue + '원) 시가의 100분의 5를 매 사업연도 말 기준으로 가산세로 부과합니다.';
  } else if (penaltyType === 'advertising') {
    const directExpenseAmount = Number(p.directExpenseAmount) || 0;
    if (directExpenseAmount <= 0) return { error: '특수관계 내국법인의 이익 증가를 위해 정당한 대가 없이 지출한 광고·홍보 직접경비가 필요합니다.' };
    penaltyAmount = directExpenseAmount;
    note = '§48⑩에 따라 특수관계에 있는 내국법인의 이익을 증가시키기 위해 정당한 대가를 받지 않고 광고·홍보를 하여, §78⑧에 따라 그 행위와 관련해 직접 지출된 경비 상당액을 가산세로 부과합니다.';
  } else if (penaltyType === 'income_underused') {
    const isHighRateType = !!p.isSect48_2_7HighHoldingType;
    const rate = isHighRateType ? 2.0 : 0.10;
    let underusedAmount = Number(p.underusedAmount) || 0;
    let baseNote = '';
    const totalAssetValue = Number(p.totalAssetValue) || 0;
    const liabilityValue = Number(p.liabilityValue);
    const netIncomeValue = Number(p.netIncomeValue);
    if (underusedAmount <= 0 && totalAssetValue > 0 && Number.isFinite(liabilityValue) && Number.isFinite(netIncomeValue)) {
      // 시행령§38⑱ — §48②7호의 "대통령령으로 정하는 출연받은 재산의 가액"(수익용·수익사업용으로 운용하는
      // 재산, 직접공익목적사업용 재산 제외)은 [총자산가액－(부채가액＋당기순이익)]으로 계산하고, 여기에
      // 1%(또는 3%)를 곱한 금액이 "기준금액"이다.
      const operatingAssetValue = Math.max(0, totalAssetValue - (liabilityValue + netIncomeValue));
      const standardAmount = Math.round(operatingAssetValue * (isHighRateType ? 0.03 : 0.01));
      const actualDirectUseAmount = Number(p.actualDirectUseAmount) || 0;
      underusedAmount = Math.max(0, standardAmount - actualDirectUseAmount);
      baseNote = '시행령§38⑱에 따라 [총자산가액(' + totalAssetValue + '원)－(부채가액(' + liabilityValue + '원)＋당기순이익(' + netIncomeValue + '원))]=' + operatingAssetValue + '원(수익용·수익사업용 운용재산가액)에 ' + (isHighRateType ? '3%' : '1%') + '를 곱한 기준금액(' + standardAmount + '원)에서 실제 직접공익목적사업 사용액(' + actualDirectUseAmount + '원)을 차감해 미달사용액을 계산했습니다' + (p.useAssessedValueBasis ? '(재무상태표상 자산가액이 상증세법상 평가액의 70% 이하인 공익법인등이라 평가액 기준으로 계산).' : '.') + ' ';
    }
    const saleProceedsAmount = Number(p.saleProceedsAmount) || 0;
    const saleCheckpointYear = Number(p.saleCheckpointYear);
    if (underusedAmount <= 0 && saleProceedsAmount > 0 && (saleCheckpointYear === 1 || saleCheckpointYear === 2)) {
      const requiredRatio = saleCheckpointYear === 2 ? 0.60 : 0.30;
      const requiredAmount = Math.round(saleProceedsAmount * requiredRatio);
      const cumulativeActualUsedAmount = Number(p.cumulativeActualUsedAmount) || 0;
      underusedAmount = Math.max(0, requiredAmount - cumulativeActualUsedAmount);
      baseNote = '시행령§38⑦에 따라 매각대금(' + saleProceedsAmount + '원)의 ' + (saleCheckpointYear === 2 ? '2년 이내 60%' : '1년 이내 30%') + '(' + requiredAmount + '원)를 직접공익목적사업에 사용해야 하는데, 매각일이 속하는 과세기간(사업연도) 종료일부터 ' + saleCheckpointYear + '년 이내 누적 실제사용액(' + cumulativeActualUsedAmount + '원)이 이에 미달해 그 차액을 미달사용액으로 계산했습니다. ';
    }
    const operatingIncomeAmount = Number(p.operatingIncomeAmount) || 0;
    const taxAndCarryforwardLossAmount = Number(p.taxAndCarryforwardLossAmount) || 0;
    if (underusedAmount <= 0 && operatingIncomeAmount > 0) {
      const operatingIncome = Math.max(0, operatingIncomeAmount - taxAndCarryforwardLossAmount);
      const usageStandardAmount = Math.round(operatingIncome * 0.8);
      const actualOperatingIncomeUsedAmount = Number(p.actualOperatingIncomeUsedAmount) || 0;
      underusedAmount = Math.max(0, usageStandardAmount - actualOperatingIncomeUsedAmount);
      baseNote = '시행령§38⑤에 따라 [수익사업 소득금액 등 합계(' + operatingIncomeAmount + '원)－법인세등 및 이월결손금(' + taxAndCarryforwardLossAmount + '원)]=' + operatingIncome + '원(운용소득)의 80%인 사용기준금액(' + usageStandardAmount + '원)에서 실제 사용액(' + actualOperatingIncomeUsedAmount + '원)을 차감해 미달사용액을 계산했습니다. ';
    }
    if (underusedAmount <= 0) return { error: '기준금액에 미달하여 사용하지 않은 금액을 직접 입력하거나(underusedAmount), §48②7호 기준금액을 계산하려면 총자산가액·부채가액·당기순이익·실제직접사용액을, §48②5호 매각대금 기준금액을 계산하려면 매각대금·확인시점(1년/2년)·누적실제사용액을, §48②5호 운용소득 기준금액을 계산하려면 수익사업소득금액등합계·법인세등및이월결손금·실제사용액을 입력하세요.' };
    penaltyAmount = Math.round(underusedAmount * rate);
    note = baseNote + '§48②5호(운용소득·매각대금을 기준금액에 미달해 사용) 또는 §48②7호(직접공익목적사업에 기준금액 미달 사용)에 해당해, §78⑨에 따라 미달사용액의 100분의 ' + (isHighRateType ? '200(§48②7호가목 유형의 공익법인등이 발행주식총수등의 10%를 초과해 주식을 보유하는 경우)' : '10') + '을 가산세로 부과합니다. §48②5호와 7호에 동시 해당하면 더 큰 금액을 적용합니다.';
  } else if (penaltyType === 'dedicated_account_not_opened') {
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
    const unusedTransactionAmount = Number(p.unusedTransactionAmount) || 0;
    if (unusedTransactionAmount <= 0) return { error: '전용계좌를 사용하지 않은 거래금액이 필요합니다.' };
    penaltyAmount = Math.round(unusedTransactionAmount * 0.005);
    note = '§50의2①에 해당하는 거래를 전용계좌로 하지 않아 §78⑩1호에 따라 그 미사용 거래금액의 1000분의 5를 가산세로 부과합니다. (전용계좌를 아예 개설·신고하지 않은 경우의 가산세는 §78⑩2호로 별도이며, penaltyType을 dedicated_account_not_opened로 선택하면 계산할 수 있습니다.)';
  } else if (penaltyType === 'disclosure_violation') {
    const totalAssetValue = Number(p.totalAssetValue) || 0;
    if (totalAssetValue <= 0) return { error: '공시하여야 할 과세기간(사업연도) 종료일 현재 공익법인등의 자산총액이 필요합니다.' };
    penaltyAmount = Math.round(totalAssetValue * 0.005);
    note = '§50의3에 따른 결산서류등을 공시하지 않거나 공시 내용에 오류가 있는데도 공시·시정 요구를 지정기한까지 이행하지 않아, §78⑪에 따라 그 과세기간(사업연도) 종료일 현재 자산총액의 1000분의 5를 가산세로 부과합니다.';
  } else if (penaltyType === 'report_not_filed_5pct') {
    const totalAssetValue = Number(p.totalAssetValue) || 0;
    if (totalAssetValue <= 0) return { error: '신고해야 할 과세기간(사업연도) 종료일 현재 공익법인등의 자산총액이 필요합니다.' };
    penaltyAmount = Math.round(totalAssetValue * 0.005);
    note = '§48⑬에 따라 내국법인 발행주식총수등의 5%를 초과해 주식등을 출연받은 공익법인등 등이 의무이행 여부를 신고하지 않아, §78⑭에 따라 그 과세기간(사업연도) 종료일 현재 자산총액의 1000분의 5(대통령령으로 정하는 한도 내)를 가산세로 부과합니다.';
  } else if (penaltyType === 'cultural_heritage_status_not_filed') {
    const deferredTaxAmount = Number(p.deferredTaxAmount) || 0;
    if (deferredTaxAmount <= 0) return { error: '징수유예 받은 상속세액이 필요합니다.' };
    penaltyAmount = Math.round(deferredTaxAmount * 0.01);
    note = '§74⑤에 따라 납세담보를 제공하지 않은 자가 §74⑥의 국가지정문화유산등·천연기념물등 보유현황 자료를 제출하지 않아, §78⑮1호에 따라 징수유예 받은 상속세액의 100분의 1을 징수합니다.';
  } else {
    const deferredTaxAmount = Number(p.deferredTaxAmount) || 0;
    if (deferredTaxAmount <= 0) return { error: '징수유예 받은 상속세액이 필요합니다.' };
    penaltyAmount = Math.round(deferredTaxAmount * 0.20);
    note = '§74⑤에 따라 납세담보를 제공하지 않은 자가 §74⑦에 따른 국가지정문화유산등·천연기념물등의 양도 사실을 신고하지 않아, §78⑮2호에 따라 징수유예 받은 상속세액의 100분의 20을 징수합니다.';
  }

  return { 가산세액: penaltyAmount, 안내: note };
}

// 국가에 양도하는 산지에 대한 양도소득세의 감면 (조특법§85의10) — 2년 이상 보유한 산지를 2022.12.31
// 이전에 국유림법§18에 따라 국가에 양도하면 그 양도소득세의 10%를 감면한다.
function toolCalculateNationalForestLandReduction(p) {
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
  const transferPrice = Number(p.transferPrice) || 0;
  const acquisitionPrice = Number(p.acquisitionPrice) || 0;
  const necessaryExpenses = Number(p.necessaryExpenses) || 0;
  const totalGain = transferPrice - acquisitionPrice - necessaryExpenses;
  return {
    적용여부: true,
    전체양도차익: Math.round(totalGain),
    세액감면율: 10,
    안내: '조특법§85의10 — 2년 이상 보유한 산지(도시지역 소재 제외)를 국유림의 경영 및 관리에 관한 법률§18에 따라 국가에 양도할 때는 그 양도소득세 산출세액의 100분의 10을 감면합니다. calculate_transfer_tax로 전체 양도차익 기준 세액을 계산한 뒤, 그 산출세액에서 10%를 차감하세요.'
  };
}

// 산업단지 개발사업 시행에 따른 이주택지 양도소득세 세율특례 (조특법§104의20) — 세액 자체는 일반 양도세
// 계산기에서 다주택 중과 옵션을 끄고 계산하면 되므로, 이 함수는 적용 가능 여부만 판정한다.
function toolCalculateIndustrialComplexRelocationLotRate(p) {
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
    안내: '조특법§104의20에 따라 다주택중과세율(소득세법§104①2·3호) 대신 기본세율(같은 항 1호)을 적용합니다. calculate_transfer_tax에서 "조정대상지역 소재"를 체크 해제하고 "소유 주택 수"를 0으로 두어(중과 미적용) 계산하세요.'
  };
}

// 박물관 등의 이전에 대한 양도소득세의 과세특례 (조특법§83) — 3년 이상 운영한 박물관등의 종전시설을
// 2022.12.31까지 양도하면, 그 양도소득세를 신고기한 종료일 이후 3년이 되는 날부터 5년간 균분납부할 수 있다.
function toolCalculateMuseumRelocationInstallment(p) {
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
}

// 경영회생 지원을 위한 농지 매매 등에 대한 양도소득세 과세특례 (조특법§70의2) — 한국농어촌공사에 양도한
// 농지등을 임차기간 내에 환매하면 당초 납부한 양도소득세를 환급받을 수 있고, 재양도시 원취득가액·시기를
// 그대로 적용한다.
function toolCalculateFarmlandRepurchaseRefund(p) {
  p = p || {};
  if (!p.wasRepurchasedWithinLeaseTerm) {
    return { 환급가능여부: false, 안내: '한국농어촌공사와의 임차기간 내에 해당 농지등을 환매하지 않아 조특법§70의2①의 환급대상이 아닙니다.' };
  }
  const originalTaxPaid = Number(p.originalTaxPaid) || 0;
  return {
    환급가능여부: true, 환급대상세액: originalTaxPaid,
    안내: '한국농어촌공사에 양도했던 농지등을 임차기간 내에 환매했으므로, 당초 그 농지등의 양도소득에 대해 납부한 양도소득세를 환급받을 수 있습니다(§70의2①, 환급신청 필요). 이후 이 환매농지를 다시 양도할 때는 한국농어촌공사에 양도하기 전 원래의 취득가액·취득시기를 그대로 적용해 양도세를 계산하세요(§70의2②) — calculate_transfer_tax에 그 원래의 취득가액·취득일을 입력하면 됩니다.'
  };
}

const TASK_PLAN_FILE_NAME = '_작업진행.json';

/**
 * 복잡한 다단계 작업의 계획·진행상태를 지금 사용자가 보고 있는 폴더에 JSON 파일로 저장/조회한다.
 * save_file_to_folder와 같은 패턴(withLock_으로 동시저장 충돌 방지, 같은 이름 파일 있으면 덮어씀).
 */
function toolManageTaskPlan(action, taskName, steps, currentPathArr) {
  let folder;
  try {
    folder = resolveFolderByPath(Array.isArray(currentPathArr) ? currentPathArr : []);
  } catch (err) {
    return { error: err.message };
  }

  function readExisting() {
    const iter = folder.getFilesByName(TASK_PLAN_FILE_NAME);
    if (!iter.hasNext()) return null;
    const file = iter.next();
    try {
      return { file: file, data: JSON.parse(file.getBlob().getDataAsString('UTF-8') || '{}') };
    } catch (err) {
      return { file: file, data: {} };
    }
  }

  if (action === 'read') {
    const existing = readExisting();
    if (!existing) return { found: false, message: '이 폴더에 저장된 작업 계획이 없습니다.' };
    return { found: true, plan: existing.data };
  }

  if (action === 'create' || action === 'update') {
    if (!taskName && action === 'create') return { error: 'create일 때는 taskName이 필요합니다.' };
    if (!Array.isArray(steps) || !steps.length) return { error: 'steps(하위작업 목록)가 필요합니다.' };

    return withLock_(8000, function () {
      try {
        const existing = readExisting();
        const now = new Date().toISOString();
        const data = {
          taskName: taskName || (existing && existing.data && existing.data.taskName) || '(이름 없음)',
          createdAt: (existing && existing.data && existing.data.createdAt) || now,
          updatedAt: now,
          steps: steps
        };
        const content = JSON.stringify(data, null, 2);
        let file;
        if (existing) {
          file = existing.file;
          file.setContent(content);
        } else {
          file = folder.createFile(Utilities.newBlob(content, 'application/json', TASK_PLAN_FILE_NAME));
        }
        const doneCount = steps.filter(function (s) { return s.status === 'done'; }).length;
        return {
          success: true,
          taskName: data.taskName,
          진행상황: doneCount + ' / ' + steps.length + ' 단계 완료',
          fileUrl: file.getUrl()
        };
      } catch (err) {
        return { error: '작업 계획 저장 중 오류: ' + err.message };
      }
    });
  }

  return { error: '알 수 없는 action: ' + action };
}

/**
 * 기본 캘린더(스크립트 소유자=조종호님)에서 지정 기간의 일정을 조회한다.
 * CalendarApp은 기본 내장 서비스라 별도 활성화가 필요 없다.
 */
function toolLookupCalendarEvents(startDate, endDate) {
  try {
    const cal = CalendarApp.getDefaultCalendar();

    let start;
    if (startDate) {
      start = new Date(startDate + 'T00:00:00');
      if (isNaN(start.getTime())) return { error: 'startDate 형식이 올바르지 않습니다 (YYYY-MM-DD).' };
    } else {
      start = new Date();
    }
    start.setHours(0, 0, 0, 0);

    let end;
    if (endDate) {
      end = new Date(endDate + 'T23:59:59');
      if (isNaN(end.getTime())) return { error: 'endDate 형식이 올바르지 않습니다 (YYYY-MM-DD).' };
    } else {
      end = new Date(start.getTime());
      end.setDate(end.getDate() + 7);
    }

    const events = cal.getEvents(start, end);
    const items = events.map(function (ev) {
      return {
        제목: ev.getTitle(),
        시작: Utilities.formatDate(ev.getStartTime(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
        종료: Utilities.formatDate(ev.getEndTime(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
        종일일정: ev.isAllDayEvent(),
        설명: ev.getDescription() || ''
      };
    });

    return {
      조회기간: Utilities.formatDate(start, 'Asia/Seoul', 'yyyy-MM-dd') + ' ~ ' + Utilities.formatDate(end, 'Asia/Seoul', 'yyyy-MM-dd'),
      일정개수: items.length,
      일정: items
    };
  } catch (err) {
    return { error: '캘린더 조회 중 오류: ' + err.message };
  }
}

/**
 * Gmail 받은편지함을 검색한다(읽기 전용). GmailApp도 기본 내장 서비스라 별도 활성화는
 * 필요 없지만, 처음 실제로 쓰일 때 Gmail 접근 권한 재승인 화면이 뜰 수 있다
 * (Apps Script 편집기에서 이 함수를 한 번 직접 실행해서 미리 승인해두면 좋다).
 */
function toolSearchEmails(query, maxResults) {
  try {
    const limit = Math.min(Math.max(Number(maxResults) || 10, 1), 30);
    const threads = GmailApp.search(query || 'in:inbox', 0, limit);
    const items = threads.map(function (thread) {
      const msgs = thread.getMessages();
      const last = msgs[msgs.length - 1];
      return {
        제목: thread.getFirstMessageSubject(),
        보낸사람: last.getFrom(),
        받은날짜: Utilities.formatDate(last.getDate(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'),
        안읽음: thread.isUnread(),
        미리보기: (last.getPlainBody() || '').slice(0, 200).replace(/\s+/g, ' ')
      };
    });
    return { 검색어: query || '(받은편지함 최근순)', 결과개수: items.length, 메일: items };
  } catch (err) {
    return { error: '이메일 검색 중 오류: ' + err.message };
  }
}

/**
 * 구글 태스크(할일). Drive API처럼 "고급 서비스"로 별도 활성화가 필요하다:
 * Apps Script 편집기 왼쪽 "서비스" 옆 + 클릭 → Tasks API 추가. 활성화 안 하면 아래
 * Tasks.Tasklists / Tasks.Tasks 호출 시 "Tasks is not defined" 오류가 난다.
 */
function toolLookupGoogleTasks(includeCompleted, taskListId) {
  try {
    const listId = taskListId || '@default';
    const optionalArgs = { showCompleted: !!includeCompleted, showHidden: !!includeCompleted, maxResults: 50 };
    const result = Tasks.Tasks.list(listId, optionalArgs);
    const items = (result.items || []).map(function (t) {
      return {
        id: t.id,
        제목: t.title,
        메모: t.notes || '',
        마감일: t.due ? Utilities.formatDate(new Date(t.due), 'Asia/Seoul', 'yyyy-MM-dd') : '',
        상태: t.status
      };
    });
    return { 목록ID: listId, 할일개수: items.length, 할일: items };
  } catch (err) {
    return { error: '구글 태스크 조회 중 오류(Tasks API 고급서비스가 켜져 있는지 확인하세요 — Apps Script 편집기 왼쪽 "서비스" 옆 + 클릭 → Tasks API 추가): ' + err.message };
  }
}

function toolAddGoogleTask(title, notes, dueDate, taskListId) {
  if (!title || !String(title).trim()) return { error: '할일 제목이 없습니다.' };
  try {
    const listId = taskListId || '@default';
    const task = { title: String(title).trim() };
    if (notes) task.notes = String(notes);
    if (dueDate) {
      const d = new Date(dueDate + 'T00:00:00');
      if (!isNaN(d.getTime())) task.due = d.toISOString();
    }
    const created = Tasks.Tasks.insert(task, listId);
    return { success: true, id: created.id, 제목: created.title, 마감일: created.due || '' };
  } catch (err) {
    return { error: '구글 태스크 추가 중 오류(Tasks API 고급서비스가 켜져 있는지 확인하세요 — Apps Script 편집기 왼쪽 "서비스" 옆 + 클릭 → Tasks API 추가): ' + err.message };
  }
}

const LOG_FILE_NAME_FOR_AI = '경과지.json'; // 화면(index.html)의 경과지 기능과 정확히 같은 파일명·형식을 써야 서로 호환됨

/**
 * 경과지에 새 항목을 추가한다. 화면(index.html)이 쓰는 것과 완전히 같은 파일(경과지.json,
 * [{id,date,text,dueDate}] 배열)에 그대로 이어서 쓰므로, 사람이 화면에서 적든 AI가 적든
 * 서로 안 꼬이고 같은 목록에 합쳐진다. 저장 후 handleSyncGlobalLog를 그대로 재사용해서
 * 현황판(전체일지) 반영과 마감일 캘린더 자동등록까지 화면 기능과 똑같이 처리한다.
 */
function toolAddLogEntry(text, dateOverride, dueDate, currentPathArr) {
  if (!text || !String(text).trim()) return { error: '기록할 내용이 없습니다.' };
  const pathArr = Array.isArray(currentPathArr) ? currentPathArr : [];

  let folder;
  try {
    folder = resolveFolderByPath(pathArr);
  } catch (err) {
    return { error: err.message };
  }

  return withLock_(8000, function () {
    try {
      const iter = folder.getFilesByName(LOG_FILE_NAME_FOR_AI);
      let file = null;
      let entries = [];
      if (iter.hasNext()) {
        file = iter.next();
        try { entries = JSON.parse(file.getBlob().getDataAsString('UTF-8') || '[]'); } catch (e) { entries = []; }
        if (!Array.isArray(entries)) entries = [];
      }

      const newEntry = {
        id: Utilities.getUuid(),
        date: dateOverride || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'),
        text: String(text).trim(),
        dueDate: dueDate || ''
      };
      entries.push(newEntry);

      const content = JSON.stringify(entries);
      if (file) {
        file.setContent(content);
      } else {
        folder.createFile(Utilities.newBlob(content, 'application/json', LOG_FILE_NAME_FOR_AI));
      }

      // 현황판 반영 + 마감일 있으면 캘린더 자동 등록까지 — 화면 기능과 동일한 함수를 그대로 재사용
      try { handleSyncGlobalLog({ path: pathArr, entries: entries }); } catch (e) { }

      return { success: true, added: newEntry, 전체항목수: entries.length };
    } catch (err) {
      return { error: '경과지 기록 중 오류: ' + err.message };
    }
  });
}

const MASTER_PROFILE_AI_SECTION_MARKER = '## AI가 추가한 사실 (자동 기록 — 검토 후 자유롭게 수정·삭제 가능)';

/**
 * 마스터 프로필(_NX_마스터프로필.md)에 새 사실을 추가한다. 기존 내용은 절대 건드리지 않고
 * 파일 맨 끝에만 덧붙인다(withLock_으로 동시수정 충돌 방지). 이 섹션 표시가 아직 없으면
 * 처음 한 번 만들어서 붙이고, 이미 있으면 그 아래에 새 줄만 추가한다.
 */
function toolRememberFact(fact) {
  if (!fact || !String(fact).trim()) return { error: '기억할 내용이 없습니다.' };
  return withLock_(8000, function () {
    try {
      const file = DriveApp.getFileById(MASTER_PROFILE_FILE_ID);
      const existing = file.getBlob().getDataAsString('UTF-8');
      const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
      const line = '- [' + today + '] ' + String(fact).trim();
      let updated;
      if (existing.indexOf(MASTER_PROFILE_AI_SECTION_MARKER) === -1) {
        updated = existing.replace(/\s+$/, '') + '\n\n' + MASTER_PROFILE_AI_SECTION_MARKER + '\n' + line + '\n';
      } else {
        updated = existing.replace(/\s+$/, '') + '\n' + line + '\n';
      }
      file.setContent(updated);
      return { success: true, added: fact };
    } catch (err) {
      return { error: '마스터 프로필 갱신 중 오류: ' + err.message };
    }
  });
}

const BUSINESS_MANAGER_FOLDER_ID_PROPERTY = 'BUSINESS_MANAGER_FOLDER_ID';

function getBusinessManagerFolder_() {
  const id = sanitizeDriveId_(PropertiesService.getScriptProperties().getProperty(BUSINESS_MANAGER_FOLDER_ID_PROPERTY));
  if (!id) return null;
  try {
    const folder = DriveApp.getFolderById(id);
    // [2026-08-01 정비] BUSINESS_MANAGER_FOLDER_ID는 "업무관리자" 폴더 자체가 아니라 그
    // 한 단계 위("0 NETAX")를 가리키도록 설정돼 있다(세무사님 확인, 2026.07 — 아래
    // getNetaxRootFolder_ 주석 참고). 그런데 이 사실을 반영한 보정 로직이 getCaseTemplateFolder_
    // 에만 있고, 정작 이 함수를 직접 쓰는 toolListBusinessManagers/toolLoadBusinessManager/
    // toolAuditBusinessManagers(야간점검)/toolProposeNewBusinessManager 4곳은 "0 NETAX"
    // 바로 밑에서 .md 파일을 찾고 있었다 — 실제 파일은 그 안의 "업무관리자" 하위폴더에 있어서
    // 에러 없이 그냥 항상 "없음"으로만 나오는 상태였다. 여기서 한 번에 보정해서 4곳 모두 고친다.
    const nested = folder.getFoldersByName('업무관리자');
    return nested.hasNext() ? nested.next() : folder;
  } catch (err) {
    return null;
  }
}

// "0 NETAX" — 넥스 시스템 운영을 위한 환경설정값들이 들어있는 폴더로, <고객사건>(기본 작업
// 폴더, NX_DEFAULT_FOLDER_ID가 가리키는 곳 — 사건만 다루는 폴더)과는 완전히 별개의 최상위
// 폴더다. [패치 2026.07] 예전엔 프론트엔드가 이 둘을 같은 것으로 잘못 취급해서(일반메모가
// <고객사건>/일반메모에 저장되던 버그), "0 NETAX"의 진짜 경로를 알려주는 전용 액션을 추가했다.
const NETAX_ROOT_FOLDER_ID_PROPERTY = 'NETAX_ROOT_FOLDER_ID';

function getNetaxRootFolder_() {
  // 확인된 사실: <0 NETAX> = BUSINESS_MANAGER_FOLDER_ID가 가리키는 바로 그 폴더(세무사님 확인,
  // 2026.07). 별도 속성을 새로 만들 필요 없이 이미 있는 값을 그대로 쓴다. NETAX_ROOT_FOLDER_ID를
  // 굳이 따로 설정해두셨다면 그쪽을 우선한다(예: 나중에 폴더 구조가 바뀌는 경우 대비).
  //
  // [2026-08-01 주의] getBusinessManagerFolder_()를 그대로 재활용하지 않는다 — 그 함수는
  // 이제 "업무관리자" 하위폴더까지 한 단계 더 들어간 값을 돌려주도록 고쳤기 때문에(바로 위
  // 함수 참고), 여기서는 BUSINESS_MANAGER_FOLDER_ID 원본 값을 직접 다시 읽어서 "0 NETAX"
  // 자체를 돌려준다.
  const explicitId = sanitizeDriveId_(PropertiesService.getScriptProperties().getProperty(NETAX_ROOT_FOLDER_ID_PROPERTY));
  if (explicitId) {
    try { return DriveApp.getFolderById(explicitId); } catch (err) { }
  }
  const businessManagerRawId = sanitizeDriveId_(PropertiesService.getScriptProperties().getProperty(BUSINESS_MANAGER_FOLDER_ID_PROPERTY));
  if (businessManagerRawId) {
    try { return DriveApp.getFolderById(businessManagerRawId); } catch (err) { }
  }
  return null;
}

function handleGetNetaxRootPath(body) {
  const folder = getNetaxRootFolder_();
  if (!folder) {
    return { error: '"0 NETAX" 폴더를 찾을 수 없습니다. BUSINESS_MANAGER_FOLDER_ID(또는 NETAX_ROOT_FOLDER_ID)가 스크립트 속성에 올바르게 설정되어 있는지 확인해주세요.' };
  }
  try {
    return { path: getPathFromRoot(folder), folderId: folder.getId() };
  } catch (err) {
    return { error: '"0 NETAX" 폴더 경로 확인 중 오류: ' + err.message };
  }
}

// ===== 총괄관리자 폴더 (체크리스트·개선요구사항·점검리포트·생성파일을 여기서 다 주고받는다) =====
const CHIEF_MANAGER_FOLDER_ID_PROPERTY = 'CHIEF_MANAGER_FOLDER_ID';

function getChiefManagerFolder_() {
  const id = sanitizeDriveId_(PropertiesService.getScriptProperties().getProperty(CHIEF_MANAGER_FOLDER_ID_PROPERTY));
  if (!id) return null;
  try {
    return DriveApp.getFolderById(id);
  } catch (err) {
    return null;
  }
}

function getOrCreateSubfolder_(parent, name) {
  const iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

// ===== 사건개시 템플릿(2026.07 추가) =====
// 업무관리자 폴더 안의 "사건개시템플릿" 하위폴더에 사건유형별(양도·상속·증여 등) 템플릿
// 파일(엑셀 또는 텍스트/마크다운)을 미리 넣어두면, 화면의 "🗂 사건개시" 버튼에서 그 목록을
// 그대로 골라 쓸 수 있다. 텍스트/마크다운 템플릿은 화면에서 바로 내용을 채워 넣고, 엑셀처럼
// 미리보기·편집이 안 되는 형식은 그대로 복사만 해서 새 사건 폴더에 넣는다.
const CASE_TEMPLATE_SUBFOLDER_NAME = '사건개시템플릿';
const TEXT_TEMPLATE_EXT_REGEX_ = /\.(md|txt)$/i;

/**
 * 사건개시템플릿 폴더 = 업무관리자 폴더(getBusinessManagerFolder_) 안의 "사건개시템플릿"
 * 하위폴더. getBusinessManagerFolder_ 자체가 이제 "0 NETAX vs 업무관리자" 한 단계 보정을
 * 전담하므로, 여기서는 그 결과를 그대로 믿고 하위폴더만 하나 더 내려가면 된다.
 * (2026-08-01: 예전에 이 함수 안에서 같은 보정을 중복으로 하다가 여러 번 고치면서 서로
 * 모순되는 주석 세 겹이 쌓였던 걸 정리 — 보정 로직은 getBusinessManagerFolder_ 한 곳에만
 * 있고, 이 함수는 그걸 그대로 쓰기만 한다.)
 */
function getCaseTemplateFolder_() {
  // [2026-08-01 정비] "업무관리자" 하위폴더 보정 로직을 getBusinessManagerFolder_ 쪽으로
  // 옮겼으므로(그 함수를 쓰는 다른 도구들도 다 같은 문제였음), 여기서는 더 이상 따로
  // getFoldersByName('업무관리자')를 반복할 필요가 없다. 이미 보정된 폴더를 그대로 쓴다.
  const folder = getBusinessManagerFolder_();
  if (!folder) return null;
  return getOrCreateSubfolder_(folder, CASE_TEMPLATE_SUBFOLDER_NAME);
}

/** 사건개시템플릿 폴더 안의 파일 목록을, 화면에서 바로 고를 수 있게 정리해서 돌려준다. */
function handleListCaseTemplates(body) {
  const folder = getCaseTemplateFolder_();
  if (!folder) {
    return { error: '"0 NETAX" 폴더를 찾을 수 없습니다. BUSINESS_MANAGER_FOLDER_ID가 스크립트 속성에 올바르게 설정되어 있는지 확인해주세요.' };
  }
  try {
    const templates = [];
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const f = iter.next();
      const rawName = f.getName();
      const extMatch = rawName.match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '';
      const nameWithoutExt = ext ? rawName.slice(0, -ext.length) : rawName;
      templates.push({
        id: f.getId(),
        name: nameWithoutExt, // 사건분류로 그대로 쓰임 (예: "양도")
        ext: ext,
        mimeType: f.getMimeType(),
        isText: TEXT_TEMPLATE_EXT_REGEX_.test(rawName)
      });
    }
    templates.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    // 문제가 생겼을 때 "지금 실제로 어느 폴더를 보고 있는지" 바로 확인할 수 있도록,
    // 목록이 비어 있을 때는 특히 실제 조회 경로를 함께 돌려준다.
    let folderPathText = '';
    try { folderPathText = getPathFromRoot(folder).join(' / '); } catch (e2) {}
    // 배포가 제대로 갱신됐는지 바로 확인할 수 있도록 코드 버전 표시를 함께 돌려준다
    // (이 값이 바뀌지 않으면 Apps Script 배포가 아직 최신 코드로 갱신되지 않은 것).
    return { templates: templates, folderPath: folderPathText, codeVersion: 'caseTemplate-v5-2026-08-01-nested-confirmed' };
  } catch (err) {
    return { error: '사건개시템플릿 목록 조회 중 오류: ' + err.message };
  }
}

/** 텍스트/마크다운 템플릿 하나의 원문 내용을 가져온다(화면에서 채워 넣을 수 있도록). */
function handleGetCaseTemplateContent(body) {
  if (!body.fileId) return { error: 'fileId가 없습니다.' };
  try {
    const file = DriveApp.getFileById(body.fileId);
    if (!TEXT_TEMPLATE_EXT_REGEX_.test(file.getName())) {
      return { error: '텍스트로 미리보기할 수 없는 파일 형식입니다(엑셀 등은 그대로 복사됩니다).' };
    }
    return { content: file.getBlob().getDataAsString('UTF-8') };
  } catch (err) {
    return { error: '템플릿 내용을 읽는 중 오류: ' + err.message };
  }
}

/**
 * 새 사건 폴더를 만들고(이미 있으면 그대로 재사용), 그 안에 템플릿에서 시작한 파일을 저장한다.
 * editedContent가 문자열로 오면(텍스트/마크다운 템플릿을 화면에서 채워 넣은 경우) 그 내용으로
 * 새 텍스트 파일을 만들고, 없으면(엑셀처럼 미리보기·편집이 안 되는 템플릿) 원본 템플릿
 * 파일(templateFileId)을 그대로 복사해서 새 사건 폴더에 넣는다. targetPath는 최상위(고객사건
 * 최상위)부터 새 폴더명까지의 경로 배열이며, 중간 폴더가 없어도 자동으로 만들어진다.
 */
function handleSaveCaseFromTemplate(body) {
  if (!body.fileName || !String(body.fileName).trim()) return { error: '파일명이 없습니다.' };
  if (!Array.isArray(body.targetPath) || !body.targetPath.length) return { error: '저장할 폴더 경로가 없습니다.' };

  return withLock_(15000, function () {
    let folder;
    try {
      folder = resolveOrCreateFolderByPath_(body.targetPath);
    } catch (err) {
      return { error: err.message };
    }

    const fileName = String(body.fileName).trim();

    try {
      if (typeof body.editedContent === 'string') {
        const mimeType = /\.md$/i.test(fileName) ? 'text/markdown' : 'text/plain';
        const existingIter = folder.getFilesByName(fileName);
        let file;
        if (existingIter.hasNext()) {
          file = existingIter.next();
          file.setContent(body.editedContent);
        } else {
          file = folder.createFile(Utilities.newBlob(body.editedContent, mimeType, fileName));
        }
        return { id: file.getId(), name: file.getName(), url: file.getUrl(), folderPath: body.targetPath };
      }

      if (!body.templateFileId) return { error: '복사할 템플릿 파일이 지정되지 않았습니다.' };
      const templateFile = DriveApp.getFileById(body.templateFileId);
      const copied = templateFile.makeCopy(fileName, folder);
      return { id: copied.getId(), name: copied.getName(), url: copied.getUrl(), folderPath: body.targetPath };
    } catch (err) {
      return { error: '사건 파일 저장 중 오류: ' + err.message };
    }
  });
}

// 도로명주소 검색(행정안전부 juso.go.kr 도로명주소 API) — 건물명(아파트명 등)으로 검색하면 도로명·지번
// 주소 후보를 돌려준다. addInfoYn=Y로 상세조회하면 공동주택의 동(棟) 목록(detBdNmList)도 함께 온다
// (예: "101동,102동,103동") — 호수는 공공데이터로 확인되지 않는 개인정보라 여기서 얻을 수 없으므로
// 사용자가 직접 입력해야 한다. API 키는 juso.go.kr에서 무료로 발급받아 이 스크립트의
// "프로젝트 설정 > 스크립트 속성"에 JUSO_API_KEY로 등록하면 바로 작동한다(코드 수정 불필요).
function handleSearchAddress(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('JUSO_API_KEY');
  if (!apiKey) {
    return { error: '주소검색 API 키가 아직 등록되지 않았습니다. juso.go.kr(도로명주소 안내시스템)에서 오픈API 승인키를 무료로 발급받은 뒤, 이 Apps Script 프로젝트의 "프로젝트 설정 > 스크립트 속성"에 키 이름 JUSO_API_KEY로 등록하세요. 등록하면 코드 수정 없이 바로 작동합니다.' };
  }
  const keyword = String(body.keyword || '').trim();
  if (!keyword) return { error: '검색어(건물명·도로명·지번 등)가 필요합니다.' };
  const url = 'https://business.juso.go.kr/addrlink/addrLinkApi.do'
    + '?confmKey=' + encodeURIComponent(apiKey)
    + '&currentPage=1&countPerPage=20'
    + '&keyword=' + encodeURIComponent(keyword)
    + '&addInfoYn=Y&resultType=json';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    const common = data.results && data.results.common;
    if (!common) return { error: '주소 검색 API 응답 형식을 해석할 수 없습니다.' };
    if (common.errorCode !== '0') return { error: '주소 검색 오류(' + common.errorCode + '): ' + common.errorMessage };
    const juso = (data.results.juso || []).map(function (j) {
      // detBdNmList가 동 목록을 담고 있다(예: "101동,102동"). 필드가 비어있으면 단독 건물이라 동 구분이 없는 것.
      const dongList = j.detBdNmList ? String(j.detBdNmList).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
      // admCd(법정동코드10)·mtYn(산여부)·lnbrMnnm/lnbrSlno(지번 본번·부번)는 화면 표시용이 아니라,
      // 개별공시지가·공동주택가격 자동조회(PNU 조립)와 관할세무서 매칭(시군구명)에 쓰인다.
      return {
        roadAddr: j.roadAddr, jibunAddr: j.jibunAddr, zipNo: j.zipNo, bdNm: j.bdNm, dongList: dongList,
        admCd: j.admCd || '', mtYn: j.mtYn || '0', lnbrMnnm: j.lnbrMnnm || '', lnbrSlno: j.lnbrSlno || '',
        siNm: j.siNm || '', sggNm: j.sggNm || '', emdNm: j.emdNm || ''
      };
    });
    return { juso: juso, totalCount: Number(common.totalCount) || juso.length };
  } catch (e) {
    return { error: '주소 검색 API 호출 실패: ' + e.message };
  }
}

// 매매사례가액(아파트 실거래가) 자동조회 — 국토교통부_아파트매매 실거래 상세자료 API(공공데이터포털).
// 법정동코드 앞 5자리(LAWD_CD)와 계약년월(YYYYMM)로 조회한다. LAWD_CD는 주소검색이 돌려준
// admCd(10자리)의 앞 5자리를 그대로 쓰면 된다. 결과는 "참고용 실거래 목록"일 뿐 — 실제 시가로
// 쓸지는 사용자가 매매사례의 유사성(면적·층·거래시점)을 보고 직접 판단해서 골라야 한다.
// 이 계정은 이미 실거래가 조회용 MOLIT_API_KEY를 갖고 있고(toolLookupRealEstatePrice가 씀),
// 같은 API를 다시 직접 호출하는 대신 그 함수를 그대로 재사용해서 응답만 화면이 기대하는 모양으로 바꾼다.
function handleLookupRealPrice(body) {
  const lawdCd = String(body.lawdCd || '').trim();
  const dealYm = String(body.dealYm || '').trim();
  if (!/^\d{5}$/.test(lawdCd)) return { error: '지역코드(법정동코드 앞 5자리)가 필요합니다. 먼저 주소 검색으로 소재지를 선택하세요.' };
  if (!/^\d{6}$/.test(dealYm)) return { error: '계약년월(YYYYMM, 6자리)이 필요합니다.' };
  const result = toolLookupRealEstatePrice('apt_detail', lawdCd, dealYm);
  if (result.error) return result;
  const list = (Array.isArray(result.items) ? result.items : []).map(function (it) {
    const amountRaw = String(it.dealAmount || '').replace(/,/g, '').trim();
    return {
      aptNm: it.aptNm || '', dong: it.umdNm || '', jibun: it.jibun || '',
      area: Number(it.excluUseAr) || 0, floor: it.floor || '', buildYear: it.buildYear || '',
      dealDate: (it.dealYear || '') + '-' + ('0' + (it.dealMonth || '')).slice(-2) + '-' + ('0' + (it.dealDay || '')).slice(-2),
      dealAmount: (Number(amountRaw) || 0) * 10000
    };
  });
  return { items: list };
}

// 개별공시지가·공동주택가격·개별주택가격 자동조회(브이월드/공간정보 오픈플랫폼, vworld.kr — data.go.kr과는
// 별도 계정·별도 키). 19자리 PNU(법정동코드10 + 산여부1[1=일반,2=산] + 지번본번4 + 지번부번4)로 조회한다.
// PNU는 화면에서 admCd·mtYn·lnbrMnnm·lnbrSlno로 조립한다.
// 요청주소는 실제 호출로 확인했다 — 문서에 적힌 req/data가 아니라 ned/data였고(예:
// https://api.vworld.kr/ned/data/getIndvdLandPriceAttr), domain 파라미터는 "옵션"이라고 적혀있지만
// 서버-서버 호출(Apps Script)에서는 없으면 INCORRECT_KEY로 거부되어 사실상 필수였다. 3개 오퍼레이션명
// (getIndvdLandPriceAttr/getApartHousingPriceAttr/getIndvdHousingPriceAttr) 모두 실제 값으로 확인됨.
// ⚠ 공동주택가격·개별주택가격은 "PNU(지번) 하나"에 그 필지 위 건물의 세대 수만큼(예: 반포자이 한 필지에
// 3,410건) 여러 행이 함께 돌아온다 — 동·호수를 지정하지 않고 아무 행이나 골라 쓰면 완전히 다른 세대의
// 가격이 조용히 섞여 들어갈 수 있다. 그래서 이 두 종류는 동·호수가 정확히 일치하는 행만 골라 쓰고,
// 못 찾으면 절대 추측하지 않고 에러만 반환한다.
const OFFICIAL_PRICE_OPERATIONS_ = {
  land: 'getIndvdLandPriceAttr',
  apartment: 'getApartHousingPriceAttr',
  house: 'getIndvdHousingPriceAttr'
};
// <fields><field>...</field><field>...</field></fields> 형태의 XML을, field 하나당 하나의
// {태그명: 텍스트} 객체로 변환해 배열로 돌려준다(행끼리 섞이지 않게 — 동·호수로 정확한 행을 골라야 해서).
function xmlFieldsToRows_(fieldsElement) {
  if (!fieldsElement) return [];
  return fieldsElement.getChildren('field').map(function (fieldEl) {
    const row = {};
    fieldEl.getChildren().forEach(function (child) { row[child.getName()] = (child.getText() || '').trim(); });
    return row;
  });
}
function handleLookupOfficialPrice(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('VWORLD_API_KEY');
  if (!apiKey) {
    return { error: '공시가격 조회 API 키가 아직 등록되지 않았습니다. vworld.kr(브이월드/공간정보 오픈플랫폼)에서 인증키를 신청(활용API: 2D데이터 API)한 뒤 발급받은 키를 스크립트 속성에 VWORLD_API_KEY로 등록하세요. data.go.kr 인증키(MOLIT_API_KEY)와는 다른 별도 키입니다.' };
  }
  const pnu = String(body.pnu || '').trim();
  if (!/^\d{19}$/.test(pnu)) return { error: 'PNU(19자리 고유번호)가 필요합니다. 먼저 주소 검색으로 소재지(지번)를 선택하세요.' };
  const kind = body.priceKind === 'apartment' ? 'apartment' : body.priceKind === 'house' ? 'house' : 'land';
  const kindLabel = kind === 'apartment' ? '공동주택가격' : kind === 'house' ? '개별주택가격' : '개별공시지가';
  const stdrYear = String(body.stdrYear || new Date().getFullYear());
  const needsUnit = kind === 'apartment' || kind === 'house';
  const dong = String(body.dong || '').replace(/동\s*$/, '').trim();
  const ho = String(body.ho || '').replace(/호\s*$/, '').trim();
  if (needsUnit && !ho) {
    return { error: kindLabel + '는 한 지번(필지) 안에 여러 세대가 함께 있어 동·호수를 알아야 정확한 세대를 찾을 수 있습니다. 자산행의 "동"·"호" 칸을 채운 뒤 다시 시도하세요.' };
  }
  const url = 'https://api.vworld.kr/ned/data/' + OFFICIAL_PRICE_OPERATIONS_[kind]
    + '?key=' + encodeURIComponent(apiKey)
    + '&domain=script.google.com'
    + '&pnu=' + pnu + '&stdrYear=' + stdrYear + '&format=xml&numOfRows=' + (needsUnit ? 1000 : 1) + '&pageNo=1';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const doc = XmlService.parse(res.getContentText());
    const root = doc.getRootElement();
    const errCode = root.getChildText('resultCode') || root.getChildText('code');
    if (errCode) {
      return { error: kindLabel + ' 조회 오류(' + errCode + '): ' + (root.getChildText('resultMsg') || root.getChildText('message') || '') };
    }
    const rows = xmlFieldsToRows_(root.getChild('fields'));
    let row = rows[0];
    if (needsUnit) {
      row = rows.filter(function (r) {
        return (!dong || (r.dongNm || '') === dong) && (r.hoNm || '') === ho;
      })[0];
      if (!row) {
        return { error: '입력한 동(' + (dong || '-') + ')·호(' + ho + ')와 일치하는 ' + kindLabel + ' 자료를 찾지 못했습니다(같은 필지 내 세대가 많아 최대 1000건까지만 조회했습니다 — 동·호수 표기를 다시 확인해주세요). 국토교통부 부동산공시가격 알리미(realtyprice.kr)에서 직접 확인해 입력해주세요.' };
      }
    }
    if (!row) {
      return { error: '해당 필지의 ' + kindLabel + ' 자료를 찾지 못했습니다(기준연도 미고시일 수 있습니다). 국토교통부 부동산공시가격 알리미(realtyprice.kr)에서 직접 확인해 입력해주세요.' };
    }
    const priceKey = Object.keys(row).filter(function (k) { return /^pblntfPc/i.test(k); })[0];
    const price = priceKey ? Number(row[priceKey]) : 0;
    if (!price) {
      return { error: '조회는 됐으나 가격 필드를 해석하지 못했습니다. 알리미 사이트에서 직접 확인해주세요.' };
    }
    return { price: price, stdrYear: row.stdrYear || stdrYear };
  } catch (e) {
    return { error: kindLabel + ' 조회 API 호출/응답 해석 실패: ' + e.message };
  }
}

// 사업자번호 진위확인·상태조회(국세청, 공공데이터포털 odcloud 경유) — 사업자등록번호가 실제 존재하고
// 계속사업자 상태인지 확인한다. 대표자성명·개업일자를 함께 주면 "진위확인"(그 사업자번호가 정말 그
// 대표자·개업일과 일치하는지)까지 확인하고, 없으면 "상태조회"(폐업 여부)만 확인한다.
// ※ 반대 방향(상호명으로 사업자번호를 검색)은 국세청이 공개 제공하지 않는다 — 상호는 유일하지 않고
// 사업자번호는 개인식별정보에 준해 검색 디렉토리가 없다. 사업자등록증 사본을 첨부해 AI로 자동추출하는
// 기존 기능(증빙→자동입력)이 이 방향의 사실상 대안이다.
// 이 계정은 이미 NTS_API_KEY로 사업자상태조회·진위확인을 하는 함수(toolLookupBusinessStatus·
// toolVerifyBusinessRegistration)를 갖고 있다 — 같은 odcloud 엔드포인트를 또 직접 호출하지 않고
// 그 함수를 재사용해서 응답만 화면이 기대하는 모양으로 바꾼다.
function handleCheckBusinessNumber(body) {
  const bNo = String(body.bNo || '').replace(/\D/g, '');
  if (bNo.length !== 10) return { error: '사업자등록번호(10자리 숫자)가 필요합니다.' };
  const repName = String(body.repName || '').trim();
  const startDt = String(body.startDt || '').replace(/\D/g, '');
  const statusData = toolLookupBusinessStatus([bNo]);
  if (statusData.error) return statusData;
  const statusItem = statusData && statusData.data && statusData.data[0];
  if (!statusItem) return { error: '사업자번호 상태조회 응답 형식을 해석할 수 없습니다.' };
  const result = {
    bNo: bNo,
    status: statusItem.b_stt || (statusItem.tax_type === '국세청에 등록되지 않은 사업자등록번호입니다.' ? '미등록' : ''),
    statusCode: statusItem.b_stt_cd || '',
    taxType: statusItem.tax_type || '',
    closeDate: statusItem.end_dt || ''
  };
  if (repName && startDt.length === 8) {
    const validateData = toolVerifyBusinessRegistration([{ b_no: bNo, start_dt: startDt, p_nm: repName }]);
    const vItem = validateData && validateData.data && validateData.data[0];
    if (vItem) {
      result.validCode = vItem.valid;
      result.validMessage = vItem.valid_msg || (vItem.valid === '01' ? '일치' : '불일치');
    }
  }
  return result;
}

// 파일이 있으면 내용을 그대로, 없으면 null을 돌려준다(오류로 취급하지 않음 — 아직 안 만든 파일일 수 있어서).
function readFileIfExists_(folder, name) {
  const iter = folder.getFilesByName(name);
  if (!iter.hasNext()) return null;
  return iter.next().getBlob().getDataAsString('UTF-8');
}

// 같은 이름 파일 있으면 덮어쓰고, 없으면 새로 만든다.
function writeFileOverwrite_(folder, name, content, mimeType) {
  const iter = folder.getFilesByName(name);
  if (iter.hasNext()) {
    const f = iter.next();
    f.setContent(content);
    return f;
  }
  return folder.createFile(Utilities.newBlob(content, mimeType || 'text/plain', name));
}

/**
 * 분야별 업무관리자 파일들이 들어있는 폴더의 목록만 가볍게 확인한다(파일명 + 첫 줄만).
 * 폴더 자체가 아직 설정 안 됐으면 안내 메시지만 준다(오류로 취급하지 않음).
 */
function toolListBusinessManagers() {
  const folder = getBusinessManagerFolder_();
  if (!folder) {
    return { 설정됨: false, 안내: '아직 업무관리자 폴더가 설정되지 않았습니다(스크립트 속성 BUSINESS_MANAGER_FOLDER_ID 미설정). 사용자에게 안내할 필요는 없고, 그냥 이 도구를 안 쓴 것처럼 넘어가라.' };
  }
  try {
    const items = [];
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const f = iter.next();
      if (!/\.(md|txt)$/i.test(f.getName())) continue;
      const firstLine = f.getBlob().getDataAsString('UTF-8').split('\n')[0].replace(/^#+\s*/, '').trim();
      items.push({ name: f.getName().replace(/\.(md|txt)$/i, ''), 설명: firstLine.slice(0, 80) });
    }
    return { 설정됨: true, 관리자목록: items };
  } catch (err) {
    return { error: '업무관리자 목록 조회 중 오류: ' + err.message };
  }
}

/**
 * 특정 업무관리자 파일 하나의 전체 내용을 불러온다. name은 확장자 없이 와도, 있어도 매칭한다.
 */
function toolLoadBusinessManager(name) {
  if (!name || !String(name).trim()) return { error: '불러올 업무관리자 이름이 없습니다.' };
  const folder = getBusinessManagerFolder_();
  if (!folder) return { error: '업무관리자 폴더가 설정되지 않았습니다.' };

  const target = String(name).trim();
  try {
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const f = iter.next();
      const base = f.getName().replace(/\.(md|txt)$/i, '');
      if (base === target || f.getName() === target) {
        return { name: base, content: f.getBlob().getDataAsString('UTF-8') };
      }
    }
    return { error: '"' + target + '"라는 업무관리자를 찾을 수 없습니다. list_business_managers로 정확한 이름을 다시 확인하세요.' };
  } catch (err) {
    return { error: '업무관리자 불러오기 중 오류: ' + err.message };
  }
}

/**
 * 모든 업무관리자 파일 + 마스터 프로필의 전체 원문을 한 번에 모아서 돌려준다.
 * 실제 "충돌 여부 판단"은 이 도구가 하는 게 아니라, 이 결과를 받은 AI 자신이 한다.
 * "_제안함" 하위폴더는 folder.getFiles()가 하위폴더까지 순회하지 않으므로 자동으로 제외된다
 * (아직 검토 전인 제안을 감사 대상에 넣지 않기 위함).
 */
function toolAuditBusinessManagers() {
  const folder = getBusinessManagerFolder_();
  if (!folder) {
    return { 설정됨: false, 안내: '업무관리자 폴더가 아직 설정되지 않았습니다(BUSINESS_MANAGER_FOLDER_ID 미설정).' };
  }
  try {
    const sections = [];
    try {
      const master = getMasterProfileText_();
      if (master) sections.push('=== 마스터 프로필 ===\n' + master);
    } catch (e) { }

    // 총괄관리자 폴더의 체크리스트·장기개발계획(조종호님이 직접 관리)이 있으면 점검 기준으로 같이 포함한다.
    try {
      const chiefFolder = getChiefManagerFolder_();
      if (chiefFolder) {
        const checklist = readFileIfExists_(chiefFolder, '체크리스트.md');
        if (checklist) sections.push('=== 점검 체크리스트(조종호님 작성) ===\n' + checklist);
        const longTermPlan = readFileIfExists_(chiefFolder, 'NX_장기개발계획.md');
        if (longTermPlan) sections.push('=== NX 시스템 장기개발계획/지향점(조종호님 작성) ===\n' + longTermPlan);
      }
    } catch (e) { }

    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const f = iter.next();
      if (!/\.(md|txt)$/i.test(f.getName())) continue;
      sections.push('=== ' + f.getName() + ' ===\n' + f.getBlob().getDataAsString('UTF-8'));
    }

    if (!sections.length) return { 파일개수: 0, 안내: '아직 감사할 업무관리자 파일이 없습니다.' };
    return { 파일개수: sections.length, 전체내용: sections.join('\n\n') };
  } catch (err) {
    return { error: '업무관리자 감사용 자료 수집 중 오류: ' + err.message };
  }
}

/**
 * 새 업무관리자 초안을 "_제안함" 하위폴더에 저장한다(정식 업무관리자 폴더가 아니라 그 안의
 * 하위폴더). 사용자가 검토 후 상위 폴더로 직접 옮겨야 실제로 활성화되는 구조 — AI가 스스로
 * 만들고 스스로 활성화까지 하는 것은 막아둔 안전장치다.
 */
function toolProposeNewBusinessManager(name, content) {
  if (!name || !String(name).trim()) return { error: '제안할 관리자 이름이 없습니다.' };
  if (!content) return { error: '제안할 내용이 없습니다.' };
  const folder = getBusinessManagerFolder_();
  if (!folder) return { error: '업무관리자 폴더가 아직 설정되지 않았습니다.' };

  return withLock_(8000, function () {
    try {
      let proposalFolder;
      const subIter = folder.getFoldersByName('_제안함');
      if (subIter.hasNext()) {
        proposalFolder = subIter.next();
      } else {
        proposalFolder = folder.createFolder('_제안함');
      }

      const fileName = String(name).trim().replace(/\.(md|txt)$/i, '') + '.md';
      const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
      const header = '<!-- AI가 ' + today + '에 제안한 업무관리자 초안입니다. 검토 후 마음에 들면 이 파일을 상위 폴더(업무관리자 폴더)로 옮기면 활성화됩니다. -->\n\n';
      const fullContent = header + String(content);

      const existingIter = proposalFolder.getFilesByName(fileName);
      let file;
      if (existingIter.hasNext()) {
        file = existingIter.next();
        file.setContent(fullContent);
      } else {
        file = proposalFolder.createFile(Utilities.newBlob(fullContent, 'text/markdown', fileName));
      }
      return {
        success: true,
        name: fileName,
        안내: '"_제안함" 폴더에 초안으로 저장했습니다. 검토 후 마음에 들면 업무관리자 폴더로 옮겨야 실제로 활성화됩니다.',
        fileUrl: file.getUrl()
      };
    } catch (err) {
      return { error: '업무관리자 제안 저장 중 오류: ' + err.message };
    }
  });
}

// 대화가 길어지면 이전 턴에 읽었던 파일 원문·검색결과 같은 무거운 tool_result가 그대로 쌓여서,
// 전혀 무관한 새 질문(예: 날씨)에도 그 내용이 자꾸 끌려나오는 문제가 있었다(예: "박길서 건" 사례).
// 그래서 "이번 턴의 새 질문"만 빼고, 그 이전 턴들에 있는 tool_result 중 내용이 일정 길이를
// 넘는 것만 짧은 안내문으로 축약한다. AI 자신의 답변 텍스트(그때 뭘 논의했는지)는 그대로
// 남아있으니 "이전에 무슨 얘기를 했는지" 자체는 여전히 기억하되, 그 원문이 새 질문까지
// 끌어당기는 힘만 줄어든다. 필요하면 같은 도구를 다시 호출해서 원문을 다시 가져오면 된다.
const OLD_TOOL_RESULT_TRIM_THRESHOLD = 800;

function trimOldToolResults_(messages) {
  const lastIndex = messages.length - 1;
  return messages.map(function (m, idx) {
    if (idx === lastIndex) return m; // 이번 턴의 새 질문은 절대 건드리지 않음
    if (m.role !== 'user' || !Array.isArray(m.content)) return m;

    let changed = false;
    const newContent = m.content.map(function (block) {
      if (!block || block.type !== 'tool_result') return block;

      // 이미지·PDF 등 바이너리가 섞인 tool_result는 글자수와 무관하게 항상 축약한다.
      // (예전엔 block.content 배열 안의 text 부분만 길이를 재서, 정작 용량을 많이 차지하는
      // image/document의 base64 원본은 아무리 커도 전혀 못 잡아내는 허점이 있었음)
      if (Array.isArray(block.content)) {
        const hasBinary = block.content.some(function (c) { return c && (c.type === 'image' || c.type === 'document'); });
        if (hasBinary) {
          changed = true;
          return Object.assign({}, block, {
            content: '[이전 턴에서 첨부했던 이미지/PDF 원본 — 대화가 길어져 이후 요청에서는 생략됨. 다시 필요하면 read_drive_file로 재조회하세요.]'
          });
        }
      }

      const text = (typeof block.content === 'string') ? block.content
        : (Array.isArray(block.content) ? block.content.map(function (c) { return c.text || ''; }).join('') : '');
      if (text.length <= OLD_TOOL_RESULT_TRIM_THRESHOLD) return block;
      changed = true;
      return Object.assign({}, block, {
        content: '[이전 턴에서 도구 실행 결과 — 대화가 길어져 원문(' + text.length + '자)은 생략됨. ' +
          '지금 질문과 관련 있고 다시 필요하면 같은 도구를 재호출해서 원문을 다시 가져오세요.]'
      });
    });
    return changed ? Object.assign({}, m, { content: newContent }) : m;
  });
}

/**
 * 한 번의 요청 안에서 도구를 여러 번 반복 호출하는 동안(예: 파일읽기 → 파일목록조회 → 저장),
 * 이미지·PDF 같은 무거운 바이너리 결과가 매 왕복마다 그대로 다시 통째로 전송되는 것을 막는다.
 * 방금 막 추가된 마지막 라운드(assistant+tool_result 한 쌍)는 그대로 두고, 그보다 이전 라운드에
 * 있던 바이너리만 짧은 안내문으로 축약한다 — Code.gs를 직접 수정한다(반환값이 아니라 in-place).
 * 이걸 안 하면 큰 PDF 하나만 있어도 도구가 여러 번 오갈 때 요청 용량이 계속 불어나서
 * URLFetch 전송한도(게시 크기 제한)에 걸릴 수 있다.
 */
function stripOlderBinaryInLoop_(messages) {
  const keepFromIndex = Math.max(0, messages.length - 2); // 마지막 라운드(assistant+user)는 그대로 보존
  for (let i = 0; i < keepFromIndex; i++) {
    const m = messages[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    m.content.forEach(function (block) {
      if (block && block.type === 'tool_result' && Array.isArray(block.content)) {
        const hasBinary = block.content.some(function (c) { return c && (c.type === 'image' || c.type === 'document'); });
        if (hasBinary) {
          block.content = [{ type: 'text', text: '[이 대화 안에서 이미 확인한 이미지/문서 원본 — 용량 절약을 위해 이후 요청에서는 생략됨. 다시 필요하면 read_drive_file로 재조회하세요.]' }];
        }
      }
    });
  }
}

// "content 파라미터가 누락되어 저장이 실패했습니다" 문제의 근본 원인 — 문서 전체 내용처럼 긴
// 문자열을 담는 도구(save_file_to_folder/export_to_google_doc/apply_document_edit/
// apply_diagram_edit)를 호출할 때, 모델이 그 긴 내용을 다 쓰기 전에 max_tokens 한도에 걸려
// 응답이 중간에 끊기는 경우가 있다. 이럴 때 앤트로픽 API는 stop_reason을 'max_tokens'로 주고,
// 마지막에 쓰고 있던 필드(대개 스키마상 맨 뒤에 오는 content/mermaidCode)는 아예 못 쓰고
// 끊겨서 tool_use 블록에 그 필드 자체가 통째로 빠진 채로 온다. 이 상태를 그대로 실행하면
// "내용이 없습니다" 오류만 반복되니, 아래에서 이 패턴을 감지해서 더 큰 예산으로 자동 재시도한다.
const CONTENT_BEARING_TOOL_FIELDS_ = {
  save_file_to_folder: 'content',
  export_to_google_doc: 'content',
  apply_document_edit: 'content',
  apply_diagram_edit: 'mermaidCode'
};

function isLikelyTruncatedContentToolCall_(result) {
  if (!result || result.stop_reason !== 'max_tokens') return false;
  const blocks = result.content || [];
  return blocks.some(function (b) {
    if (!b || b.type !== 'tool_use') return false;
    const field = CONTENT_BEARING_TOOL_FIELDS_[b.name];
    if (!field) return false;
    const val = b.input && b.input[field];
    return typeof val !== 'string' || val.length === 0;
  });
}

function callClaude(body, model, cfg, effort, maxTokens, systemPrompt, apiKey) {
  const payload = {
    model: model,
    max_tokens: maxTokens,
    system: systemPrompt,
    // 자동 프롬프트 캐싱 — 도구 정의 + 시스템 프롬프트(마스터 프로필 포함) + 대화 이력 중
    // 반복되는 앞부분을 자동으로 캐시해서, 다음 턴부터는 그 부분을 정상가의 10%만 청구되게 한다.
    // 화면 상태(열린 파일 등)가 바뀌어 캐시가 깨져도 에러 없이 조용히 새로 캐시될 뿐이라 안전하다.
    cache_control: { type: 'ephemeral' }
  };

  if (cfg.thinkingMode === 'adaptive') {
    payload.thinking = { type: 'adaptive' };
    payload.output_config = { effort: effort.key };
  } else if (effort.thinking) {
    payload.thinking = { type: 'enabled', budget_tokens: effort.budgetTokens };
  }

  if (cfg.temp && !effort.thinking) {
    const temp = Number(body.temperature);
    if (Number.isFinite(temp) && temp >= 0 && temp <= 1) payload.temperature = temp;
  }

  if (Array.isArray(body.stopSequences) && body.stopSequences.length > 0) {
    payload.stop_sequences = body.stopSequences.slice(0, 4);
  }

  const tools = DRIVE_TOOLS.slice();
  const betaFlags = [];

  if (body.enableWebSearch !== false) {
    // 예전엔 body.enableWebSearch === true 일 때만 켰다 — 화면(프론트엔드)에서 이 값을
    // 안 보내면 그냥 꺼진 채로 요청이 나가서, 날씨처럼 실시간 정보가 필요한 질문에
    // Claude가 도구 자체가 없어 "모른다"고 답했다. 이제는 화면에서 명시적으로
    // enableWebSearch: false를 보낸 경우에만 끄고, 그 외(안 보내는 경우 포함)엔 기본으로 켠다.
    tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
  }
  if (body.enableCodeExecution && cfg.codeExec) {
    tools.push({ type: 'code_execution_20260120', name: 'code_execution' });
  }
  if (body.enableWebFetch) {
    tools.push({ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 });
    betaFlags.push('web-fetch-2025-09-10');
  }
  let advisorModel = null;
  if (body.enableAdvisor) {
    advisorModel = MODEL_CONFIG[body.advisorModel] ? body.advisorModel : 'claude-opus-4-8';
    tools.push({ type: 'advisor_20260301', name: 'advisor', model: advisorModel, max_uses: 3 });
    betaFlags.push('advisor-tool-2026-03-01');
  }

  // 문서수정·관계도수정·폴더이동 도구 — 열려 있는 화면 상태(body.context)에 맞춰서만 추가된다.
  getClientActionTools_(body.context).forEach(function (t) { tools.push(t); });

  payload.tools = tools;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true
  };
  if (betaFlags.length > 0) options.headers['anthropic-beta'] = betaFlags.join(',');

  let messages = trimOldToolResults_(body.messages.slice());
  let result = null, status = null;
  let loops = 0;
  let maxLoopsHit = false;
  let timeBudgetExceeded = false;
  let truncationRetries = 0; // content 파라미터가 토큰한도로 잘린 걸 감지했을 때 자동 재시도 횟수(최대 2회)
  const loopStartTime = Date.now();
  const clientActions = []; // 문서수정/관계도수정/폴더이동 요청을 모아뒀다가 최종 응답에 함께 실어보낸다.

  while (loops < MAX_TOOL_LOOPS) {
    // Apps Script 실행시간 상한(보통 6분)에 걸려 응답 없이 죽어버리는 것을 막기 위해,
    // 도구 호출이 계속 이어지고 있어도 시간 예산을 넘기면 여기서 루프를 접는다.
    // (Claude API 자체 호출이 아니라 "다음 도구 왕복을 또 시작할지"를 판단하는 지점이라
    //  이미 진행 중인 API 호출이 끊기지는 않는다.)
    if (Date.now() - loopStartTime > TOOL_LOOP_TIME_BUDGET_MS) {
      timeBudgetExceeded = true;
      break;
    }

    payload.messages = messages;
    options.payload = JSON.stringify(payload);

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    status = response.getResponseCode();
    result = JSON.parse(response.getContentText());
    loops++;

    if (loops >= MAX_TOOL_LOOPS) maxLoopsHit = true;

    if (status !== 200) break;
    if (result.stop_reason === 'pause_turn') continue;

    // content 파라미터가 토큰한도에 걸려 잘린 것으로 보이면(위 isLikelyTruncatedContentToolCall_
    // 참고), 이번 응답은 버리고(messages에 아무것도 추가하지 않음) max_tokens를 2배로 늘려
    // 같은 요청을 다시 시도한다. 최대 2회까지만 — 그래도 계속 잘리면 정말로 한 번에 담기엔
    // 너무 긴 것이므로, 아래 정상 흐름대로 진행해서 도구 자신의 오류 메시지("내용이 없습니다")를
    // 모델이 보고 스스로 대응(예: 내용을 나눠서 저장)하게 둔다.
    if (isLikelyTruncatedContentToolCall_(result) && truncationRetries < 2) {
      truncationRetries++;
      payload.max_tokens = Math.min(payload.max_tokens * 2, 64000);
      continue;
    }

    const toolUseBlocks = (result.content || []).filter(function (b) {
      return b.type === 'tool_use' && (
        b.name === 'list_drive_folder' ||
        b.name === 'read_drive_file' ||
        b.name === 'save_file_to_folder' ||
        b.name === 'export_to_google_doc' ||
        b.name === 'send_email' ||
        b.name === 'lookup_statute_article' ||
        b.name === 'register_report_to_rpt' ||
        b.name === 'lookup_real_estate_price' ||
        b.name === 'lookup_building_register' ||
        b.name === 'lookup_business_status' ||
        b.name === 'verify_business_registration' ||
        b.name === 'get_building_price_index_tables' ||
        b.name === 'calculate_building_standard_price' ||
        b.name === 'calculate_building_standard_price_multi' ||
        b.name === 'calculate_transfer_tax' ||
        b.name === 'calculate_transfer_tax_with_carryover' ||
        b.name === 'calculate_gift_tax' ||
        b.name === 'calculate_inheritance_tax' ||
        b.name === 'allocate_inheritance_tax_by_heir' ||
        b.name === 'calculate_special_rate_gift_tax' ||
        b.name === 'calculate_related_party_transaction_gift_tax' ||
        b.name === 'calculate_business_opportunity_gift_tax' ||
        b.name === 'calculate_nominee_trust_gift_tax' ||
        b.name === 'calculate_property_acquisition_funds_gift_tax' ||
        b.name === 'calculate_debt_forgiveness_gift_tax' ||
        b.name === 'calculate_free_property_use_gift_tax' ||
        b.name === 'calculate_spouse_property_transfer_gift_tax' ||
        b.name === 'calculate_insurance_proceeds_gift_tax' ||
        b.name === 'calculate_trust_income_gift_tax' ||
        b.name === 'calculate_donor_direct_transfer_deemed' ||
        b.name === 'calculate_new_house_acquisition_reduction' ||
        b.name === 'calculate_unsold_house_acquisition_reduction' ||
        b.name === 'calculate_unsold_house_one_house_exclusion' ||
        b.name === 'calculate_deemed_inheritance_property' ||
        b.name === 'calculate_specific_corporation_gift_tax' ||
        b.name === 'calculate_nontaxable_gift_property' ||
        b.name === 'calculate_nontaxable_inheritance_property' ||
        b.name === 'calculate_excess_dividend_gift_tax' ||
        b.name === 'calculate_stock_listing_gift_tax' ||
        b.name === 'calculate_rural_house_one_house_exclusion' ||
        b.name === 'calculate_convertible_bond_gift_tax' ||
        b.name === 'calculate_in_kind_contribution_gift_tax' ||
        b.name === 'calculate_overseas_asset_transfer_tax' ||
        b.name === 'calculate_capital_reduction_gift_tax' ||
        b.name === 'calculate_disabled_person_trust_exclusion' ||
        b.name === 'calculate_charity_donation_tax_exclusion' ||
        b.name === 'calculate_public_interest_org_penalty' ||
        b.name === 'calculate_national_forest_land_reduction' ||
        b.name === 'calculate_industrial_complex_relocation_lot_rate' ||
        b.name === 'calculate_museum_relocation_installment' ||
        b.name === 'calculate_farmland_repurchase_refund' ||
        b.name === 'calculate_long_term_rental_house_reduction' ||
        b.name === 'calculate_capital_increase_gift_tax' ||
        b.name === 'calculate_restructuring_property_reduction' ||
        b.name === 'calculate_population_decline_area_house_exclusion' ||
        b.name === 'calculate_business_transfer_carryover' ||
        b.name === 'calculate_burdened_gift_transfer' ||
        b.name === 'calculate_business_succession_deferral_amount' ||
        b.name === 'calculate_property_in_kind_stock_receipt_value' ||
        b.name === 'calculate_business_succession_deferral_clawback' ||
        b.name === 'calculate_property_in_kind_payment_eligibility' ||
        b.name === 'calculate_cultural_heritage_tax_deferral' ||
        b.name === 'calculate_merger_benefit_gift_tax' ||
        b.name === 'calculate_property_use_service_gift_tax' ||
        b.name === 'calculate_org_change_gift_tax' ||
        b.name === 'calculate_property_value_increase_gift_tax' ||
        b.name === 'calculate_installment_payment_schedule' ||
        b.name === 'calculate_clawback_interest' ||
        b.name === 'calculate_low_price_transfer_gift_amount' ||
        b.name === 'calculate_interest_free_loan_gift_amount' ||
        b.name === 'calculate_stock_transfer_tax' ||
        b.name === 'calculate_unlisted_stock_value' ||
        b.name === 'manage_task_plan' ||
        b.name === 'lookup_calendar_events' ||
        b.name === 'search_emails' ||
        b.name === 'lookup_google_tasks' ||
        b.name === 'add_google_task' ||
        b.name === 'add_log_entry' ||
        b.name === 'remember_fact' ||
        b.name === 'list_business_managers' ||
        b.name === 'load_business_manager' ||
        b.name === 'audit_business_managers' ||
        b.name === 'propose_new_business_manager' ||
        b.name === 'apply_document_edit' ||
        b.name === 'apply_diagram_edit' ||
        b.name === 'navigate_to_folder'
      );
    });

    if (toolUseBlocks.length === 0) break;

    const toolResults = toolUseBlocks.map(function (block) {
      if (block.name === 'list_drive_folder') {
        const resultObj = toolListDriveFolder(block.input && block.input.path);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'save_file_to_folder') {
        const input = block.input || {};
        // path를 모델이 생략했으면, 지금 사용자가 화면에서 보고 있는 폴더(요청에 실려온 currentPath)로 대신한다.
        const targetPath = (Array.isArray(input.path) && input.path.length) ? input.path
          : ((body.context && Array.isArray(body.context.currentPath)) ? body.context.currentPath : []);
        const resultObj = toolSaveFileToFolder(targetPath, input.name, input.content);
        if (resultObj && !resultObj.error) clientActions.push({ type: 'explorer_changed', path: targetPath });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'export_to_google_doc') {
        const input = block.input || {};
        const targetPath = (Array.isArray(input.path) && input.path.length) ? input.path
          : ((body.context && Array.isArray(body.context.currentPath)) ? body.context.currentPath : []);
        const resultObj = toolExportToGoogleDoc(targetPath, input.title, input.content);
        if (resultObj && !resultObj.error) clientActions.push({ type: 'explorer_changed', path: targetPath });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'send_email') {
        const input = block.input || {};
        const resultObj = toolSendEmail(input.to, input.subject, input.body);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'lookup_statute_article') {
        const input = block.input || {};
        const resultObj = toolLookupStatuteArticle(input.lawName, input.articleNo);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'register_report_to_rpt') {
        const input = block.input || {};
        const resultObj = toolRegisterReportToRpt(input.customerName, input.title, input.docType, input.link, input.permission);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'lookup_real_estate_price') {
        const input = block.input || {};
        const resultObj = toolLookupRealEstatePrice(input.propertyType, input.lawdCode, input.dealYearMonth);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'lookup_building_register') {
        const input = block.input || {};
        const resultObj = toolLookupBuildingRegister(input.ledgerType, input.sigunguCd, input.bjdongCd, input.platGbCd, input.bun, input.ji);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'lookup_business_status') {
        const input = block.input || {};
        const resultObj = toolLookupBusinessStatus(input.businessNumbers);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'verify_business_registration') {
        const input = block.input || {};
        const resultObj = toolVerifyBusinessRegistration(input.businesses);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'get_building_price_index_tables') {
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolGetBuildingPriceIndexTables()) };
      }

      if (block.name === 'calculate_building_standard_price') {
        const input = block.input || {};
        const resultObj = toolCalculateBuildingStandardPrice(input.structureName, input.useNo, input.officialLandPricePerSqm, input.builtYear, input.floorAreaSqm, input.taxType, input.adjustmentNos);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_building_standard_price_multi') {
        const input = block.input || {};
        const resultObj = toolCalculateBuildingStandardPriceMulti(input.rows, input.officialLandPricePerSqm, input.taxType);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_transfer_tax') {
        const resultObj = toolCalculateTransferTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_transfer_tax_with_carryover') {
        const resultObj = toolCalculateTransferTaxWithCarryover(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_gift_tax') {
        const resultObj = toolCalculateGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_inheritance_tax') {
        const resultObj = toolCalculateInheritanceTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'allocate_inheritance_tax_by_heir') {
        const input = block.input || {};
        const resultObj = toolAllocateInheritanceTaxByHeir(input.aggregateResult, input.heirs);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_special_rate_gift_tax') {
        const resultObj = toolCalculateSpecialRateGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_related_party_transaction_gift_tax') {
        const resultObj = toolCalculateRelatedPartyTransactionGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_business_opportunity_gift_tax') {
        const resultObj = toolCalculateBusinessOpportunityGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_nominee_trust_gift_tax') {
        const resultObj = toolCalculateNomineeTrustGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_property_acquisition_funds_gift_tax') {
        const resultObj = toolCalculatePropertyAcquisitionFundsGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_debt_forgiveness_gift_tax') {
        const resultObj = toolCalculateDebtForgivenessGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_free_property_use_gift_tax') {
        const resultObj = toolCalculateFreePropertyUseGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_spouse_property_transfer_gift_tax') {
        const resultObj = toolCalculateSpousePropertyTransferGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_insurance_proceeds_gift_tax') {
        const resultObj = toolCalculateInsuranceProceedsGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_trust_income_gift_tax') {
        const resultObj = toolCalculateTrustIncomeGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_donor_direct_transfer_deemed') {
        const resultObj = toolCalculateDonorDirectTransferDeemed(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_new_house_acquisition_reduction') {
        const resultObj = toolCalculateNewHouseAcquisitionReduction(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_unsold_house_acquisition_reduction') {
        const resultObj = toolCalculateUnsoldHouseAcquisitionReduction(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_unsold_house_one_house_exclusion') {
        const resultObj = toolCalculateUnsoldHouseOneHouseExclusion(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_deemed_inheritance_property') {
        const resultObj = toolCalculateDeemedInheritanceProperty(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_specific_corporation_gift_tax') {
        const resultObj = toolCalculateSpecificCorporationGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_nontaxable_gift_property') {
        const resultObj = toolCalculateNontaxableGiftProperty(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_nontaxable_inheritance_property') {
        const resultObj = toolCalculateNontaxableInheritanceProperty(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_excess_dividend_gift_tax') {
        const resultObj = toolCalculateExcessDividendGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_stock_listing_gift_tax') {
        const resultObj = toolCalculateStockListingGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_rural_house_one_house_exclusion') {
        const resultObj = toolCalculateRuralHouseOneHouseExclusion(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_convertible_bond_gift_tax') {
        const resultObj = toolCalculateConvertibleBondGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_in_kind_contribution_gift_tax') {
        const resultObj = toolCalculateInKindContributionGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_overseas_asset_transfer_tax') {
        const resultObj = toolCalculateOverseasAssetTransferTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_capital_reduction_gift_tax') {
        const resultObj = toolCalculateCapitalReductionGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_disabled_person_trust_exclusion') {
        const resultObj = toolCalculateDisabledPersonTrustExclusion(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_charity_donation_tax_exclusion') {
        const resultObj = toolCalculateCharityDonationTaxExclusion(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_public_interest_org_penalty') {
        const resultObj = toolCalculatePublicInterestOrgPenalty(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_national_forest_land_reduction') {
        const resultObj = toolCalculateNationalForestLandReduction(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_industrial_complex_relocation_lot_rate') {
        const resultObj = toolCalculateIndustrialComplexRelocationLotRate(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_museum_relocation_installment') {
        const resultObj = toolCalculateMuseumRelocationInstallment(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_farmland_repurchase_refund') {
        const resultObj = toolCalculateFarmlandRepurchaseRefund(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_long_term_rental_house_reduction') {
        const resultObj = toolCalculateLongTermRentalHouseReduction(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_capital_increase_gift_tax') {
        const resultObj = toolCalculateCapitalIncreaseGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_restructuring_property_reduction') {
        const resultObj = toolCalculateRestructuringPropertyReduction(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_population_decline_area_house_exclusion') {
        const resultObj = toolCalculatePopulationDeclineAreaHouseExclusion(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_business_transfer_carryover') {
        const resultObj = toolCalculateBusinessTransferCarryover(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_burdened_gift_transfer') {
        const resultObj = toolCalculateBurdenedGiftTransfer(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_business_succession_deferral_amount') {
        const resultObj = toolCalculateBusinessSuccessionDeferralAmount(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_property_in_kind_stock_receipt_value') {
        const resultObj = toolCalculatePropertyInKindStockReceiptValue(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_business_succession_deferral_clawback') {
        const resultObj = toolCalculateBusinessSuccessionDeferralClawback(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_property_in_kind_payment_eligibility') {
        const resultObj = toolCalculatePropertyInKindPaymentEligibility(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_cultural_heritage_tax_deferral') {
        const resultObj = toolCalculateCulturalHeritageTaxDeferral(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_merger_benefit_gift_tax') {
        const resultObj = toolCalculateMergerBenefitGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_property_use_service_gift_tax') {
        const resultObj = toolCalculatePropertyUseServiceGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_org_change_gift_tax') {
        const resultObj = toolCalculateOrgChangeGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_property_value_increase_gift_tax') {
        const resultObj = toolCalculatePropertyValueIncreaseGiftTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_installment_payment_schedule') {
        const resultObj = toolCalculateInstallmentPaymentSchedule(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_clawback_interest') {
        const resultObj = toolCalculateClawbackInterest(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_low_price_transfer_gift_amount') {
        const resultObj = toolCalculateLowPriceTransferGiftAmount(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_interest_free_loan_gift_amount') {
        const resultObj = toolCalculateInterestFreeLoanGiftAmount(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_stock_transfer_tax') {
        const resultObj = toolCalculateStockTransferTax(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'calculate_unlisted_stock_value') {
        const resultObj = toolCalculateUnlistedStockValue(block.input || {});
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'manage_task_plan') {
        const input = block.input || {};
        const targetPath = (body.context && Array.isArray(body.context.currentPath)) ? body.context.currentPath : [];
        const resultObj = toolManageTaskPlan(input.action, input.taskName, input.steps, targetPath);
        if (resultObj && resultObj.success) clientActions.push({ type: 'explorer_changed', path: targetPath });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'lookup_calendar_events') {
        const input = block.input || {};
        const resultObj = toolLookupCalendarEvents(input.startDate, input.endDate);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'search_emails') {
        const input = block.input || {};
        const resultObj = toolSearchEmails(input.query, input.maxResults);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'lookup_google_tasks') {
        const input = block.input || {};
        const resultObj = toolLookupGoogleTasks(input.includeCompleted, input.taskListId);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'add_google_task') {
        const input = block.input || {};
        const resultObj = toolAddGoogleTask(input.title, input.notes, input.dueDate, input.taskListId);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'add_log_entry') {
        const input = block.input || {};
        const targetPath = (body.context && Array.isArray(body.context.currentPath)) ? body.context.currentPath : [];
        const resultObj = toolAddLogEntry(input.text, input.date, input.dueDate, targetPath);
        if (resultObj && resultObj.success) clientActions.push({ type: 'explorer_changed', path: targetPath });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'remember_fact') {
        const input = block.input || {};
        const resultObj = toolRememberFact(input.fact);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'list_business_managers') {
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolListBusinessManagers()) };
      }

      if (block.name === 'load_business_manager') {
        const input = block.input || {};
        const resultObj = toolLoadBusinessManager(input.name);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      if (block.name === 'audit_business_managers') {
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolAuditBusinessManagers()) };
      }

      if (block.name === 'propose_new_business_manager') {
        const input = block.input || {};
        const resultObj = toolProposeNewBusinessManager(input.name, input.content);
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
      }

      // ---- 여기서부터 3개는 서버가 "실제로 실행"하는 도구가 아니라, 클라이언트(브라우저) 화면에
      // 전달해서 사용자 확인/화면갱신을 거치게 하는 도구다. 서버는 그 요청을 clientActions에
      // 쌓아두기만 하고, Claude에게는 "요청이 접수됐다"는 합성 결과만 돌려줘서 대화를 이어가게 한다. ----
      if (block.name === 'apply_document_edit') {
        const input = block.input || {};
        clientActions.push({ type: 'edit_document', content: input.content || '' });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'prepared', note: '사용자 화면에 적용 버튼과 함께 제시되었습니다. 실제 반영은 사용자가 버튼을 눌러야 이루어집니다.' }) };
      }

      if (block.name === 'apply_diagram_edit') {
        const input = block.input || {};
        clientActions.push({ type: 'diagram_mermaid', mermaidCode: input.mermaidCode || '' });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'prepared', note: '사용자 화면에 적용 버튼과 함께 제시되었습니다. 실제 반영은 사용자가 버튼을 눌러야 이루어집니다.' }) };
      }

      if (block.name === 'navigate_to_folder') {
        const input = block.input || {};
        clientActions.push({ type: 'navigate_to', path: Array.isArray(input.path) ? input.path : [] });
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ status: 'ok', navigated: true }) };
      }

      let resultObj;
      try {
        resultObj = handleReadFile({ fileId: block.input && block.input.fileId });
      } catch (err) {
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: String(err) }), is_error: true };
      }

      if (resultObj.error) {
        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj), is_error: true };
      }

      if (resultObj.kind === 'binary') {
        const blockType = resultObj.mimeType.indexOf('image/') === 0 ? 'image' : 'document';
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: [
            { type: 'text', text: '파일 "' + resultObj.name + '"(' + resultObj.mimeType + ')을 첨부합니다.' },
            { type: blockType, source: { type: 'base64', media_type: resultObj.mimeType, data: resultObj.base64 } }
          ]
        };
      }

      return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultObj) };
    });

    messages.push({ role: 'assistant', content: result.content });
    messages.push({ role: 'user', content: toolResults });
    stripOlderBinaryInLoop_(messages); // 방금 추가한 이번 라운드는 그대로 두고, 그보다 이전 라운드의 이미지/PDF 원본만 축약
  }

  if (status !== 200) {
    const errMsg = (result.error && result.error.message) ? result.error.message : ('Claude API 오류 (status ' + status + ')');
    return { error: errMsg };
  }

  let replyText = (result.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n');

  // 시간예산 초과 또는 루프한계 도달로 도구 호출이 채 안 끝났는데 텍스트가 하나도 없으면,
  // 예전에는 그대로 빈 응답이 나갔다. 대신 도구 없이 한 번 더 불러서 "지금까지 모은 정보로
  // 일단 마무리해달라"고 요청해 최소한 뭔가 답을 받는다.
  if (!replyText && (maxLoopsHit || timeBudgetExceeded)) {
    try {
      const wrapUpMessages = messages.concat([{
        role: 'user',
        content: '(시스템 안내: 도구 호출 시간·횟수 제한에 도달했습니다. 지금까지 확인한 정보만으로 지금 답변을 마무리하세요. ' +
          '추가로 확인이 더 필요한 부분이 있다면 어떤 정보가 더 필요한지도 함께 알려주세요. 도구를 더 호출하지 말고 텍스트로만 답하세요.)'
      }]);
      const wrapUpPayload = Object.assign({}, payload, { messages: wrapUpMessages, tools: [] });
      delete wrapUpPayload.tool_choice;
      const wrapUpOptions = Object.assign({}, options, { payload: JSON.stringify(wrapUpPayload) });
      const wrapUpResponse = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', wrapUpOptions);
      if (wrapUpResponse.getResponseCode() === 200) {
        const wrapUpResult = JSON.parse(wrapUpResponse.getContentText());
        replyText = (wrapUpResult.content || [])
          .filter(function (b) { return b.type === 'text'; })
          .map(function (b) { return b.text; })
          .join('\n');
      }
    } catch (err) {
      // 마무리 요청까지 실패하면 아래 안내문으로 대체된다.
    }
    if (!replyText) {
      replyText = timeBudgetExceeded
        ? '요청이 예상보다 오래 걸려 시간 제한(약 4분) 안에 마무리하지 못했습니다. 요청을 더 작은 단위로 나눠서 다시 시도해주세요.'
        : '요청이 너무 많은 단계(도구 호출 ' + MAX_TOOL_LOOPS + '회)를 필요로 해서 끝까지 마무리하지 못했습니다. 요청을 더 작은 단위로 나눠서 다시 시도해주세요.';
    }
  }

  const webSearchUses = (result.content || [])
    .filter(function (b) { return b.type === 'server_tool_use' && b.name === 'web_search'; })
    .length;

  const usage = result.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;

  let costUsd = (inputTokens / 1e6) * cfg.input + (outputTokens / 1e6) * cfg.output;
  costUsd += (cacheWriteTokens / 1e6) * cfg.input * 1.25; // 캐시 새로 쓰기: 정상 입력단가의 1.25배
  costUsd += (cacheReadTokens / 1e6) * cfg.input * 0.1;   // 캐시 읽기(캐시 히트): 정상 입력단가의 10%
  costUsd += webSearchUses * WEB_SEARCH_COST_PER_USE;
  if (advisorModel && usage.advisor_usage) {
    const advCfg = MODEL_CONFIG[advisorModel] || cfg;
    costUsd += ((usage.advisor_usage.input_tokens || 0) / 1e6) * advCfg.input
             + ((usage.advisor_usage.output_tokens || 0) / 1e6) * advCfg.output;
  }

  return {
    reply: replyText,
    clientActions: clientActions,
    usage: { inputTokens: inputTokens, outputTokens: outputTokens, costUsd: costUsd, model: model, webSearchUses: webSearchUses, advisorModel: advisorModel, cacheWriteTokens: cacheWriteTokens, cacheReadTokens: cacheReadTokens },
    debugLoops: loops,
    maxLoopsHit: maxLoopsHit,
    timeBudgetExceeded: timeBudgetExceeded,
    truncationRetries: truncationRetries
  };
}

function callGemini(body, model, cfg, effort, maxTokens, systemPrompt, apiKey) {
  const generationConfig = { maxOutputTokens: maxTokens };

  if (cfg.temp) {
    const temp = Number(body.temperature);
    if (Number.isFinite(temp) && temp >= 0 && temp <= 1) generationConfig.temperature = temp;
  }
  if (Array.isArray(body.stopSequences) && body.stopSequences.length > 0) {
    generationConfig.stopSequences = body.stopSequences.slice(0, 5);
  }
  generationConfig.thinkingConfig = { thinkingBudget: effort.thinking ? effort.budgetTokens : 0 };

  const tools = [];
  if (body.enableWebSearch) tools.push({ googleSearch: {} });
  if (body.enableCodeExecution && cfg.codeExec) tools.push({ codeExecution: {} });
  if (body.enableWebFetch) tools.push({ urlContext: {} });

  const payload = {
    contents: toGeminiContents(body.messages),
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: generationConfig
  };
  if (tools.length > 0) payload.tools = tools;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const result = JSON.parse(response.getContentText());

  if (status !== 200) {
    const errMsg = (result.error && result.error.message) ? result.error.message : ('Gemini API 오류 (status ' + status + ')');
    return { error: errMsg };
  }

  const candidate = (result.candidates || [])[0] || {};
  const parts = (candidate.content && candidate.content.parts) || [];
  const replyText = parts.filter(function (p) { return p.text; }).map(function (p) { return p.text; }).join('\n');

  const usageMeta = result.usageMetadata || {};
  const inputTokens = usageMeta.promptTokenCount || 0;
  const thoughtsTokens = usageMeta.thoughtsTokenCount || 0;
  const outputTokens = (usageMeta.candidatesTokenCount || 0) + thoughtsTokens;

  const costUsd = (inputTokens / 1e6) * cfg.input + (outputTokens / 1e6) * cfg.output;

  return {
    reply: replyText || ('(응답이 비어 있습니다 — finishReason: ' + (candidate.finishReason || '알수없음') + ')'),
    clientActions: [],
    usage: { inputTokens: inputTokens, outputTokens: outputTokens, costUsd: costUsd, model: model }
  };
}

function toGeminiContents(messages) {
  return messages.map(function (m) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    let parts;
    if (typeof m.content === 'string') {
      parts = [{ text: m.content }];
    } else if (Array.isArray(m.content)) {
      parts = m.content.map(function (block) {
        if (block.type === 'text') return { text: block.text };
        if (block.type === 'image') {
          return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
        }
        if (block.type === 'document') {
          return { inlineData: { mimeType: 'application/pdf', data: block.source.data } };
        }
        return { text: '' };
      });
    } else {
      parts = [{ text: '' }];
    }
    return { role: role, parts: parts };
  });
}

/**
 * (선택기능) 오늘이 마감/기한인 처리일지 항목과 이미 지난 항목을 모아 문자로 보내는 일일 요약.
 * 스크립트 속성에 SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER_PHONE / NX_REMINDER_PHONE
 * 4개가 모두 설정돼 있어야 실제로 발송된다(하나라도 없으면 조용히 아무 것도 안 함).
 * ⚠️ 이 함수 자체는 매일 자동으로 실행되지 않는다 — 아래 installDailyReminderTrigger()를
 * Apps Script 편집기에서 "실행" 버튼으로 한 번 눌러줘야 매일 오전 9시 트리거가 걸린다.
 */
function sendDailyDeadlineDigest() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('SOLAPI_API_KEY');
  const apiSecret = props.getProperty('SOLAPI_API_SECRET');
  const senderPhone = props.getProperty('SOLAPI_SENDER_PHONE');
  const targetPhone = props.getProperty('NX_REMINDER_PHONE');
  if (!apiKey || !apiSecret || !senderPhone || !targetPhone) return; // 설정 안 돼 있으면 조용히 스킵

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const entries = readGlobalLogEntries_().filter(function (e) { return e.dueDate; });
  const overdue = entries.filter(function (e) { return e.dueDate < todayStr; });
  const today = entries.filter(function (e) { return e.dueDate === todayStr; });
  if (!overdue.length && !today.length) return; // 알릴 게 없으면 문자 안 보냄

  let msg = '[NX 마감알림 ' + todayStr + ']\n';
  if (today.length) msg += '오늘 마감(' + today.length + '건):\n' + today.map(function (e) { return '· ' + e.pathKey + ' — ' + e.text; }).slice(0, 5).join('\n') + '\n';
  if (overdue.length) msg += '기한 지남(' + overdue.length + '건):\n' + overdue.map(function (e) { return '· ' + e.pathKey + ' — ' + e.text; }).slice(0, 5).join('\n');

  try {
    sendSolapiSms_(apiKey, apiSecret, senderPhone, targetPhone, msg.slice(0, 1900));
  } catch (err) {
    // 문자 발송 실패는 조용히 로그만 남김(트리거 실행이라 사용자에게 바로 안 보임)
    console.error('마감알림 SMS 발송 실패: ' + err.message);
  }
}

/** SOLAPI REST API v4 표준 서명 방식(HMAC-SHA256)으로 문자 1건을 보낸다. */
function sendSolapiSms_(apiKey, apiSecret, from, to, text) {
  const date = new Date().toISOString();
  const salt = Utilities.getUuid();
  const rawSig = Utilities.computeHmacSha256Signature(date + salt, apiSecret);
  const signature = rawSig.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  const authHeader = 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date + ', salt=' + salt + ', signature=' + signature;

  const payload = { message: { to: to, from: from, text: text } };
  const res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: authHeader },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('SOLAPI 응답 오류(' + res.getResponseCode() + '): ' + res.getContentText());
  }
}

/**
 * 최초 1회만: Apps Script 편집기에서 이 함수를 선택하고 "실행" 버튼을 눌러주세요.
 * 이후 매일 오전 9시에 sendDailyDeadlineDigest()가 자동으로 실행됩니다.
 * (같은 이름의 트리거가 이미 있으면 중복 설치되지 않도록 먼저 지우고 새로 만듭니다.)
 */
/**
 * 최초 1회만: Apps Script 편집기에서 이 함수를 선택하고 "실행" 버튼을 눌러주세요.
 * 이후 매일 오전 9시에 sendDailyDeadlineDigest()가 자동으로 실행됩니다.
 * (같은 이름의 트리거가 이미 있으면 중복 설치되지 않도록 먼저 지우고 새로 만듭니다.)
 */
function installDailyReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDeadlineDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDeadlineDigest').timeBased().everyDays(1).atHour(9).create();
}

/**
 * 최근 N일 안에 수정된 "_대화기록.json" 파일들을 드라이브 전체에서 찾아, 각 사건별로
 * 사용자가 실제로 했던 질문(짧은 것 위주, 첨부파일 등 긴 내용 제외) 최근 몇 개씩만 뽑아온다.
 * "반복적으로 사용자를 귀찮게 하는 패턴"을 점검하기 위한 재료 — 정확한 판단은 이 자료를
 * 받은 AI가 한다. Drive.Files.list는 Drive API 고급서비스가 필요하다(이미 켜져 있음).
 */
function collectRecentUserQuestionsSample_(daysBack, maxFiles) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const res = Drive.Files.list({
      q: "name = '_대화기록.json' and trashed = false and modifiedTime > '" + cutoff.toISOString() + "'",
      fields: 'files(id,name,modifiedTime)',
      pageSize: maxFiles,
      orderBy: 'modifiedTime desc'
    });
    const files = res.files || [];
    const samples = [];
    files.forEach(function (f) {
      try {
        const arr = JSON.parse(DriveApp.getFileById(f.id).getBlob().getDataAsString('UTF-8'));
        if (!Array.isArray(arr)) return;
        const userTexts = arr
          .filter(function (m) { return m.role === 'user'; })
          .map(function (m) {
            if (typeof m.content === 'string') return m.content;
            if (Array.isArray(m.content)) return m.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join(' ');
            return '';
          })
          .filter(function (t) { return t && t.length > 0 && t.length < 400; }) // 파일원문 등 긴 첨부는 제외
          .slice(-5); // 사건당 최근 사용자 발화 5개만
        if (userTexts.length) samples.push(userTexts.join(' / '));
      } catch (e) { }
    });
    return samples;
  } catch (err) {
    return [];
  }
}

/**
 * 매일 새벽 2시, 마스터 프로필 + 모든 업무관리자 파일(+체크리스트)을 훑어서 서로 모순되는
 * 지침이 없는지 점검하고, 결과를 이메일이 아니라 총괄관리자 폴더의 "_점검리포트" 하위폴더에
 * 날짜별 파일로 남긴다(파일이라 조종호님이 원할 때 아무 때나 확인 가능 — 이메일처럼 어딘가로
 * 사라지는 통로에 의존하지 않는다). 문제가 없어도 "문제없음" 리포트를 남긴다(파일은 조용히
 * 사라지지 않으니, 매일 뭔가 남는 게 오히려 "정상적으로 점검이 돌았다"는 증거가 된다).
 *
 * 단순 모순 점검을 넘어서, 최근 여러 사건의 실제 질문 샘플도 같이 보고 "반복적으로 사용자를
 * 귀찮게 하는 패턴"이 있는지까지 판단하며, 새 업무관리자가 필요하다고 판단되면 그 자리에서
 * "_제안함"에 초안까지 자동으로 만들어둔다(활성화는 여전히 사람이 직접 해야 함).
 */
function runNightlySystemAudit() {
  const chiefFolder = getChiefManagerFolder_();
  if (!chiefFolder) {
    console.error('총괄관리자 폴더가 설정되지 않아 야간점검을 건너뜁니다(CHIEF_MANAGER_FOLDER_ID 미설정).');
    return;
  }
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const reportFolder = getOrCreateSubfolder_(chiefFolder, '_점검리포트');

  function saveReport(text) {
    writeFileOverwrite_(reportFolder, '점검리포트_' + today + '.md', text, 'text/markdown');
  }

  try {
    const auditData = toolAuditBusinessManagers();
    if (!auditData || !auditData.파일개수) {
      saveReport('# 점검리포트 ' + today + '\n\n업무관리자 파일이 아직 없어서 점검할 대상이 없습니다.');
      return;
    }

    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) {
      saveReport('# 점검리포트 ' + today + '\n\nANTHROPIC_API_KEY가 설정되어 있지 않아 점검을 진행하지 못했습니다.');
      return;
    }

    const recentQuestions = collectRecentUserQuestionsSample_(14, 20);
    const recentSection = recentQuestions.length
      ? '\n\n=== 최근 14일간 여러 사건에서 사용자가 실제로 물어본 질문 샘플(사건별로 섞여있음) ===\n' + recentQuestions.join('\n')
      : '';

    const prompt = '너는 이 세무 자문 시스템의 총괄관리자다. 다음 두 가지를 점검하라:\n\n'
      + '(A) 지금 시스템에 등록된 마스터 프로필과 분야별 업무관리자들(그리고 있다면 점검 체크리스트, NX 시스템 장기개발계획)의 전체 원문을 보고, '
      + '서로 모순되거나 겹치거나 애매하게 충돌하는 지침이 있는지, 체크리스트에 있는데 아직 반영 안 된 항목이 있는지, 지금 하고 있는 일들이 장기개발계획의 지향점(Speed·Smart·Simple, 잡일 제로화 등)에 부합하는지 찾아라.\n\n'
      + '(B) 최근 여러 사건에서 사용자가 실제로 물어본 질문 샘플을 보고, 반복적으로 같은 유형의 요청이 나오는데 '
      + '그걸 처리할 전용 업무관리자나 도구가 마땅치 않아 보이는 패턴이 있는지 찾아라(즉 "사용자를 반복적으로 귀찮게 하는 지점"이 있는지).\n\n'
      + '(A)(B) 둘 다 문제가 전혀 없으면 정확히 이 한 단어만 답하라: NO_ISSUES (그 외에는 아무것도 쓰지 마라).\n\n'
      + '(A)에서 문제를 찾았으면 "- [파일명1 vs 파일명2] 어떤 부분이 왜 충돌하는지"의 짧은 목록으로 나열하라.\n\n'
      + '(B)에서 새 업무관리자가 필요하다고 판단되면, 보고 마지막에 정확히 아래 형식으로 제안을 하나 추가하라 '
      + '(필요 없으면 이 블록 자체를 아예 쓰지 마라. 여러 개 필요하면 블록을 여러 번 반복해라):\n'
      + '---PROPOSAL_START---\n이름: (업무관리자 이름, 예: 상속증여)\n내용:\n(다른 업무관리자 파일들과 같은 형식의 마크다운 전체 내용, 절차·체크리스트 형태로 충실하게)\n---PROPOSAL_END---\n\n'
      + '=== (A) 마스터 프로필 + 업무관리자 + 체크리스트 ===\n' + auditData.전체내용
      + recentSection;

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      saveReport('# 점검리포트 ' + today + '\n\nClaude API 오류 (status ' + response.getResponseCode() + ')\n\n' + response.getContentText().slice(0, 1000));
      return;
    }

    const result = JSON.parse(response.getContentText());
    let text = (result.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();

    // 제안 블록이 있으면 뽑아내서 자동으로 "_제안함"에 초안을 저장하고, 보고문에서는 그 블록을 제거한다.
    const proposalRegex = /---PROPOSAL_START---\s*이름:\s*(.+?)\s*\n\s*내용:\s*([\s\S]*?)---PROPOSAL_END---/g;
    const proposedNames = [];
    let match;
    while ((match = proposalRegex.exec(text)) !== null) {
      const proposedName = match[1].trim();
      const proposedContent = match[2].trim();
      const saveResult = toolProposeNewBusinessManager(proposedName, proposedContent);
      if (saveResult && saveResult.success) proposedNames.push(proposedName);
    }
    text = text.replace(proposalRegex, '').trim();

    let body = '# 점검리포트 ' + today + '\n\n'
      + '검토한 업무관리자 파일 수: ' + auditData.파일개수 + '\n'
      + '참고한 최근 사건 대화 샘플 수: ' + recentQuestions.length + '\n\n';

    if (proposedNames.length) {
      body += '## 새 업무관리자 자동 제안됨\n"_제안함" 폴더에 아래 항목의 초안이 저장되었습니다 — 검토 후 마음에 들면 직접 정식 폴더로 옮겨주세요.\n'
        + proposedNames.map(function (n) { return '- ' + n; }).join('\n') + '\n\n';
    }

    body += (!text || text === 'NO_ISSUES')
      ? '## 결과: 문제없음\n\n오늘은 모순·중복된 지침이나 반복적인 처리 공백을 발견하지 못했습니다.'
      : '## 결과: 확인 필요\n\n' + text;

    saveReport(body);
  } catch (err) {
    saveReport('# 점검리포트 ' + today + '\n\n점검 중 오류 발생: ' + err.message);
  }
}

/**
 * "개선요구사항.md"에 조종호님이 새로 적어둔 내용을 읽어서, 각 항목별로 어느 파일을 건드려야
 * 하는지 · 무엇을 어떻게 고치면 되는지 실행 지침을 정리해 총괄관리자/"_생성파일"에 저장한다.
 * 실제 코드 수정은 하지 않는다 — 방향을 잡아주는 메모만 만든다. 진짜 수정은 이 메모를 들고
 * 대화 세션에서(예: 오늘 report-writer 법령링크 사고를 고친 방식) 하는 게 원칙이다.
 *
 * [2026-08-01 정비 — 두 번째] 처음엔 파일 전체를 통째로 다시 써서 내놓게 시켰는데(주석 아래
 * CURRENT_SOURCE_FILES 잔재 참고), 실제로 돌려보니 대상 파일이 190~410KB나 되는데
 * max_tokens 한도(32000) 안에서는 절대 끝까지 못 써서 결과물이 원본의 14%만 나오고 잘리는
 * 사고가 실사용으로 확인됐다(2026-08-01, 세무사님 직접 실행해서 발견). max_tokens를 더
 * 올린다고 해결될 문제가 아니라(이 정도 크기의 파일을 매번 통째로 재출력하는 것 자체가 API
 * 응답 한도에 안 맞는 설계), "파일을 다시 쓰게 하는" 접근 자체를 버리고 "무엇을 어떻게
 * 고치면 되는지 사람이 읽고 판단할 지침만 만드는" 훨씬 가벼운 방식으로 바꿨다. 이러면
 * 큰 파일을 프롬프트에 넣어 매번 다시 읽힐 필요도 없어서 속도도 훨씬 빠르다.
 */
const IMPROVEMENT_TRACKING_FILE = '_개선요구사항_처리기록.json';

function processImprovementRequests() {
  const chiefFolder = getChiefManagerFolder_();
  if (!chiefFolder) return;

  const requestText = readFileIfExists_(chiefFolder, '개선요구사항.md');
  if (!requestText || !requestText.trim()) return; // 요구사항 파일 자체가 없으면 할 일 없음

  // 지난번까지 처리한 길이를 기록해뒀다가, 그보다 늘어난 부분(=새로 추가된 요구사항)만 처리한다.
  let tracking = { processedLength: 0 };
  const trackingRaw = readFileIfExists_(chiefFolder, IMPROVEMENT_TRACKING_FILE);
  if (trackingRaw) {
    try { tracking = JSON.parse(trackingRaw); } catch (e) { }
  }
  if (requestText.length <= (tracking.processedLength || 0)) return; // 새로 추가된 내용 없음

  const newRequestText = requestText.slice(tracking.processedLength || 0).trim();
  if (!newRequestText) return;

  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) return;

  const outputFolder = getOrCreateSubfolder_(chiefFolder, '_생성파일');
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');

  try {
    const prompt = '너는 이 NX 시스템(세무자문 1인 사무실용 AI 비서)의 총괄관리자다. '
      + '아래는 조종호님이 개선요구사항.md에 새로 적은 항목들이다. 각 항목마다:\n'
      + '1) 어느 파일을 건드려야 하는지 짐작해서 밝혀라 — 후보는 Code.js(Apps Script 백엔드), '
      + 'NX-Work 메인 index.html(프론트엔드), report-writer/index.html(내부 보고서 편집기), '
      + '또는 "코드가 아니라 운영 방식/판단의 문제"일 수도 있다.\n'
      + '2) 원인으로 짐작되는 부분과, 어떻게 고치면 될지 방향을 구체적으로 적어라. 실제 코드를 '
      + '작성하지는 마라 — 방향과 체크리스트만 제시한다.\n'
      + '3) 이 시스템의 실제 코드 내용은 이 프롬프트에 포함돼 있지 않으니, 지금 아는 사실(예: '
      + '업무관리자 도구들이 폴더 참조 문제로 항상 빈손이었던 사례처럼)을 근거로 삼되, 확실하지 '
      + '않은 부분은 "확인 필요"라고 솔직히 표시해라.\n'
      + '4) 이미 해결된 것으로 보이거나 정보가 부족해 판단이 안 서는 항목은 그렇다고 명시해라.\n\n'
      + '=== 새로 추가된 개선요구사항 ===\n' + newRequestText;

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
      muteHttpExceptions: true
    });

    let memoBody;
    if (response.getResponseCode() !== 200) {
      memoBody = '# 개선요구사항 처리메모 (' + today + ')\n\nClaude API 오류(status ' + response.getResponseCode() + ')로 처리 실패했습니다.\n\n## 이번에 새로 추가된 요구사항\n' + newRequestText;
    } else {
      const result = JSON.parse(response.getContentText());
      const text = (result.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
      memoBody = '# 개선요구사항 처리메모 (' + today + ')\n\n'
        + '이 메모는 실제 코드를 자동으로 고친 게 아니라, 무엇을 어떻게 고치면 될지 방향만 정리한 것입니다. '
        + '실제 반영은 대화 세션에서 직접 확인하며 진행하세요.\n\n'
        + '## 이번에 새로 추가된 요구사항\n' + newRequestText + '\n\n## 검토 메모\n' + (text || '(빈 응답)');
    }

    writeFileOverwrite_(outputFolder, '개선요구사항_처리메모_' + today + '.md', memoBody, 'text/markdown');
  } catch (err) {
    writeFileOverwrite_(outputFolder, '개선요구사항_처리메모_' + today + '.md',
      '# 개선요구사항 처리메모 (' + today + ')\n\n처리 중 오류 발생: ' + err.message + '\n\n## 이번에 새로 추가된 요구사항\n' + newRequestText,
      'text/markdown');
  }

  tracking.processedLength = requestText.length;
  writeFileOverwrite_(chiefFolder, IMPROVEMENT_TRACKING_FILE, JSON.stringify(tracking), 'application/json');
}

/**
 * 매일 새벽, "0 빈폴더"(기본 작업폴더 — NX_DEFAULT_FOLDER_ID)에 "오늘의 요약.md"를 만들어둔다.
 * NX-Work를 켜면 항상 이 폴더가 맨 처음 열리는 것을 역이용해서, 마감 현황·어젯밤 자기점검
 * 결과를 한눈에 보는 홈 화면처럼 쓰기 위함. 예약신청 현황은 별도 Apps Script 프로젝트
 * 소관이라 여기서는 다루지 않는다(안내 문구만 남김).
 */
function generateDailyBriefing_() {
  const defaultFolder = getDefaultFolder();
  if (!defaultFolder) return;

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const in3Days = Utilities.formatDate(new Date(Date.now() + 3 * 86400000), 'Asia/Seoul', 'yyyy-MM-dd');

  const entries = readGlobalLogEntries_().filter(function (e) { return e.dueDate; });
  const overdue = entries.filter(function (e) { return e.dueDate < todayStr; });
  const dueToday = entries.filter(function (e) { return e.dueDate === todayStr; });
  const dueSoon = entries.filter(function (e) { return e.dueDate > todayStr && e.dueDate <= in3Days; });

  let body = '# 오늘의 요약 (' + todayStr + ')\n\n';

  body += '## 마감 현황\n';
  if (!overdue.length && !dueToday.length && !dueSoon.length) {
    body += '임박한 마감이 없습니다.\n\n';
  } else {
    if (overdue.length) {
      body += '### ⚠️ 기한 지남 (' + overdue.length + '건)\n';
      overdue.forEach(function (e) { body += '- ' + e.pathKey + ' — ' + e.text + ' (마감 ' + e.dueDate + ')\n'; });
      body += '\n';
    }
    if (dueToday.length) {
      body += '### 오늘 마감 (' + dueToday.length + '건)\n';
      dueToday.forEach(function (e) { body += '- ' + e.pathKey + ' — ' + e.text + '\n'; });
      body += '\n';
    }
    if (dueSoon.length) {
      body += '### 3일 내 마감 예정 (' + dueSoon.length + '건)\n';
      dueSoon.forEach(function (e) { body += '- ' + e.pathKey + ' — ' + e.text + ' (마감 ' + e.dueDate + ')\n'; });
      body += '\n';
    }
  }

  body += '## 어젯밤 시스템 자기점검\n';
  try {
    const chiefFolder = getChiefManagerFolder_();
    if (chiefFolder) {
      const reportFolder = getOrCreateSubfolder_(chiefFolder, '_점검리포트');
      const reportName = '점검리포트_' + todayStr + '.md'; // runNightlySystemAudit이 먼저 실행되어 오늘자 리포트가 이미 있음
      const content = readFileIfExists_(reportFolder, reportName);
      if (content) {
        body += (content.indexOf('문제없음') !== -1)
          ? '오늘은 특별한 문제가 발견되지 않았습니다.\n\n'
          : '확인이 필요한 내용이 있습니다 — 총괄관리자 폴더의 `_점검리포트/' + reportName + '` 파일을 확인해주세요.\n\n';
      } else {
        body += '점검리포트를 아직 찾지 못했습니다.\n\n';
      }
    }
  } catch (e) { }

  body += '## 참고\n예약신청 현황은 이 요약에 아직 포함되지 않습니다(admin.netax.kr의 별도 시스템) — 직접 확인해주세요.\n';

  writeFileOverwrite_(defaultFolder, '오늘의 요약.md', body, 'text/markdown');
}

/**
 * 새벽 트리거가 실제로 부르는 진입함수 — 점검, 개선요구사항 처리, 오늘의 요약 생성을 순서대로 실행한다.
 */
function runNightlyChiefManager() {
  try { runNightlySystemAudit(); } catch (err) { console.error('야간 점검 실패: ' + err.message); }
  try { processImprovementRequests(); } catch (err) { console.error('개선요구사항 처리 실패: ' + err.message); }
  try { generateDailyBriefing_(); } catch (err) { console.error('오늘의 요약 생성 실패: ' + err.message); }
}

/**
 * 최초 1회만: Apps Script 편집기에서 이 함수를 선택하고 "실행" 버튼을 눌러주세요.
 * 이후 매일 새벽 2시에 runNightlyChiefManager()가 자동으로 실행됩니다.
 */
function installNightlySystemAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runNightlySystemAudit' || t.getHandlerFunction() === 'runNightlyChiefManager') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runNightlyChiefManager').timeBased().everyDays(1).atHour(2).create();
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'NX Assistant 프록시가 정상 동작 중입니다.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
