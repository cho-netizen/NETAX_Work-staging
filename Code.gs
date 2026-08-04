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
  medium: { thinking: true,  budgetTokens: 4000,  maxTokens: 12000 },
  high:   { thinking: true,  budgetTokens: 10000, maxTokens: 32000 }
};
const DEFAULT_EFFORT = 'medium';

const WEB_SEARCH_COST_PER_USE = 0.01;
const MAX_TOOL_LOOPS = 14;
const TOOL_LOOP_TIME_BUDGET_MS = 4 * 60 * 1000;

const DEFAULT_FOLDER_ID_PROPERTY = 'NX_DEFAULT_FOLDER_ID';

const LOG_SHEET_ID_PROPERTY = 'NX_LOG_SHEET_ID';
const LOG_SHEET_NAME = 'NX_요청로그';

function logNxInteraction_(entry) {
  try {
    const logSheetId = PropertiesService.getScriptProperties().getProperty(LOG_SHEET_ID_PROPERTY);
    if (!logSheetId) return;

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
    if (body.action === 'moveItem') {
      return jsonResponse(handleMoveItem(body));
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

function toolLookupStatuteArticle(lawName, articleNo) {
  if (!lawName || !String(lawName).trim()) return { error: '법령명이 없습니다.' };

  const ocKey = PropertiesService.getScriptProperties().getProperty('LAW_OC');
  if (!ocKey) return { error: 'LAW_OC(국가법령정보센터 인증키)가 스크립트 속성에 설정되어 있지 않습니다.' };

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
    const first = laws[0];
    mst = first.getChildText('법령일련번호');
    efYd = first.getChildText('시행일자');
    matchedName = first.getChildText('법령명한글');
  } catch (err) {
    return { error: '법령 검색 중 오류: ' + err.message };
  }

  let jo = null;
  if (articleNo) {
    const m = String(articleNo).match(/(\d+)\s*(?:조)?\s*(?:의\s*(\d+))?/);
    if (m) {
      const num = ('0000' + m[1]).slice(-4);
      const sub = ('00' + (m[2] || '0')).slice(-2);
      jo = num + sub;
    }
  }

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

function extractDriveFileId_(url) {
  if (!url) return null;
  const m1 = String(url).match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m1) return m1[1];
  const m2 = String(url).match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m2) return m2[1];
  return null;
}

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
      const MAX_BINARY_FILE_BYTES = 15 * 1024 * 1024;
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

  const MAX_BINARY_FILE_BYTES = 15 * 1024 * 1024;
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
  const ROW_PREVIEW_LIMIT = 50;
  const ROW_WARNING_THRESHOLD = 500;
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
    const formulas = range.getFormulas();
    values.forEach(function (row, r) {
      out += row.map(function (c, colIdx) {
        const val = (c === '' || c === null || c === undefined) ? '' : String(c);
        const formula = formulas[r][colIdx];
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

/**
 * [2026.08 추가] 파일/폴더를 다른 폴더로 이동한다. 기존 handleDeleteItem/handleRenameItem과
 * 완전히 같은 패턴(id+type, withLock_)이다. targetPath로 목적지 폴더를 찾은 뒤,
 * DriveApp의 File/Folder.moveTo()로 실제 이동시킨다(구글드라이브는 원래 파일 하나가 여러
 * 폴더에 동시에 속할 수 있는 구조라, moveTo는 내부적으로 "기존 부모에서 빼고 새 부모에 추가"
 * 하는 방식으로 동작 — 이 API가 그 과정을 대신 처리해준다).
 * 폴더를 자기 자신에게 이동하려는 경우만 방어한다(가장 흔한 실수 케이스). 폴더를 자신의
 * 하위 폴더로 이동하는, 더 깊은 순환 이동까지는 막지 않으니 — 프론트엔드 쪽에서 애초에
 * 그런 선택지를 고르기 어렵게(현재 열려있는 폴더로만 붙여넣기) 만드는 것으로 충분히 안전하다.
 */
function handleMoveItem(body) {
  if (!body.id) return { error: 'id가 없습니다.' };
  if (!Array.isArray(body.targetPath)) return { error: '이동할 대상 폴더 경로(targetPath)가 없습니다.' };

  return withLock_(8000, function () {
    let targetFolder;
    try {
      targetFolder = resolveFolderByPath(body.targetPath);
    } catch (err) {
      return { error: err.message };
    }
    try {
      if (body.type === 'folder') {
        const item = DriveApp.getFolderById(body.id);
        if (item.getId() === targetFolder.getId()) {
          return { error: '같은 폴더로는 이동할 수 없습니다.' };
        }
        item.moveTo(targetFolder);
      } else {
        const item = DriveApp.getFileById(body.id);
        item.moveTo(targetFolder);
      }
      return { success: true };
    } catch (err) {
      return { error: '이동 중 오류: ' + err.message };
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
      syncCalendarForPath_(pathKey, entries);
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

const TASK_PLAN_FILE_NAME = '_작업진행.json';

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

const LOG_FILE_NAME_FOR_AI = '경과지.json';

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

      try { handleSyncGlobalLog({ path: pathArr, entries: entries }); } catch (e) { }

      return { success: true, added: newEntry, 전체항목수: entries.length };
    } catch (err) {
      return { error: '경과지 기록 중 오류: ' + err.message };
    }
  });
}

const MASTER_PROFILE_AI_SECTION_MARKER = '## AI가 추가한 사실 (자동 기록 — 검토 후 자유롭게 수정·삭제 가능)';

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
    const nested = folder.getFoldersByName('업무관리자');
    return nested.hasNext() ? nested.next() : folder;
  } catch (err) {
    return null;
  }
}

const NETAX_ROOT_FOLDER_ID_PROPERTY = 'NETAX_ROOT_FOLDER_ID';

function getNetaxRootFolder_() {
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

const CASE_TEMPLATE_SUBFOLDER_NAME = '사건개시템플릿';
const TEXT_TEMPLATE_EXT_REGEX_ = /\.(md|txt)$/i;

function getCaseTemplateFolder_() {
  const folder = getBusinessManagerFolder_();
  if (!folder) return null;
  return getOrCreateSubfolder_(folder, CASE_TEMPLATE_SUBFOLDER_NAME);
}

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
        name: nameWithoutExt,
        ext: ext,
        mimeType: f.getMimeType(),
        isText: TEXT_TEMPLATE_EXT_REGEX_.test(rawName)
      });
    }
    templates.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    let folderPathText = '';
    try { folderPathText = getPathFromRoot(folder).join(' / '); } catch (e2) {}
    return { templates: templates, folderPath: folderPathText, codeVersion: 'caseTemplate-v5-2026-08-01-nested-confirmed' };
  } catch (err) {
    return { error: '사건개시템플릿 목록 조회 중 오류: ' + err.message };
  }
}

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

function readFileIfExists_(folder, name) {
  const iter = folder.getFilesByName(name);
  if (!iter.hasNext()) return null;
  return iter.next().getBlob().getDataAsString('UTF-8');
}

function writeFileOverwrite_(folder, name, content, mimeType) {
  const iter = folder.getFilesByName(name);
  if (iter.hasNext()) {
    const f = iter.next();
    f.setContent(content);
    return f;
  }
  return folder.createFile(Utilities.newBlob(content, mimeType || 'text/plain', name));
}

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

const OLD_TOOL_RESULT_TRIM_THRESHOLD = 800;

function trimOldToolResults_(messages) {
  const lastIndex = messages.length - 1;
  return messages.map(function (m, idx) {
    if (idx === lastIndex) return m;
    if (m.role !== 'user' || !Array.isArray(m.content)) return m;

    let changed = false;
    const newContent = m.content.map(function (block) {
      if (!block || block.type !== 'tool_result') return block;

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

function stripOlderBinaryInLoop_(messages) {
  const keepFromIndex = Math.max(0, messages.length - 2);
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
  let truncationRetries = 0;
  const loopStartTime = Date.now();
  const clientActions = [];

  while (loops < MAX_TOOL_LOOPS) {
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
    stripOlderBinaryInLoop_(messages);
  }

  if (status !== 200) {
    const errMsg = (result.error && result.error.message) ? result.error.message : ('Claude API 오류 (status ' + status + ')');
    return { error: errMsg };
  }

  let replyText = (result.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n');

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
  costUsd += (cacheWriteTokens / 1e6) * cfg.input * 1.25;
  costUsd += (cacheReadTokens / 1e6) * cfg.input * 0.1;
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

function sendDailyDeadlineDigest() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('SOLAPI_API_KEY');
  const apiSecret = props.getProperty('SOLAPI_API_SECRET');
  const senderPhone = props.getProperty('SOLAPI_SENDER_PHONE');
  const targetPhone = props.getProperty('NX_REMINDER_PHONE');
  if (!apiKey || !apiSecret || !senderPhone || !targetPhone) return;

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const entries = readGlobalLogEntries_().filter(function (e) { return e.dueDate; });
  const overdue = entries.filter(function (e) { return e.dueDate < todayStr; });
  const today = entries.filter(function (e) { return e.dueDate === todayStr; });
  if (!overdue.length && !today.length) return;

  let msg = '[NX 마감알림 ' + todayStr + ']\n';
  if (today.length) msg += '오늘 마감(' + today.length + '건):\n' + today.map(function (e) { return '· ' + e.pathKey + ' — ' + e.text; }).slice(0, 5).join('\n') + '\n';
  if (overdue.length) msg += '기한 지남(' + overdue.length + '건):\n' + overdue.map(function (e) { return '· ' + e.pathKey + ' — ' + e.text; }).slice(0, 5).join('\n');

  try {
    sendSolapiSms_(apiKey, apiSecret, senderPhone, targetPhone, msg.slice(0, 1900));
  } catch (err) {
    console.error('마감알림 SMS 발송 실패: ' + err.message);
  }
}

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

function installDailyReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDeadlineDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDeadlineDigest').timeBased().everyDays(1).atHour(9).create();
}

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
          .filter(function (t) { return t && t.length > 0 && t.length < 400; })
          .slice(-5);
        if (userTexts.length) samples.push(userTexts.join(' / '));
      } catch (e) { }
    });
    return samples;
  } catch (err) {
    return [];
  }
}

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

const IMPROVEMENT_TRACKING_FILE = '_개선요구사항_처리기록.json';

function processImprovementRequests() {
  const chiefFolder = getChiefManagerFolder_();
  if (!chiefFolder) return;

  const requestText = readFileIfExists_(chiefFolder, '개선요구사항.md');
  if (!requestText || !requestText.trim()) return;

  let tracking = { processedLength: 0 };
  const trackingRaw = readFileIfExists_(chiefFolder, IMPROVEMENT_TRACKING_FILE);
  if (trackingRaw) {
    try { tracking = JSON.parse(trackingRaw); } catch (e) { }
  }
  if (requestText.length <= (tracking.processedLength || 0)) return;

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
      const reportName = '점검리포트_' + todayStr + '.md';
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

function runNightlyChiefManager() {
  try { runNightlySystemAudit(); } catch (err) { console.error('야간 점검 실패: ' + err.message); }
  try { processImprovementRequests(); } catch (err) { console.error('개선요구사항 처리 실패: ' + err.message); }
  try { generateDailyBriefing_(); } catch (err) { console.error('오늘의 요약 생성 실패: ' + err.message); }
}

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
