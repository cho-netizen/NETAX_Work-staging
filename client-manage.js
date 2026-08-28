// ============================================================
// 고객관리 — 고객 명단 + 상담/자문 이력(예전 고객관리.xlsx의 자문일지 성격) (2026.08 신규)
// work-manage.js와 같은 패턴(전역 스코프 공유, callGas/showToast/escapeHtml 재사용).
// 작업관리(work-manage.js)의 "새 사건" 고객명 입력이 여기서 채우는 #clientNameOptions
// datalist로 자동완성된다 — 두 파일은 서로 몰라도 되고, 이 datalist 하나로만 연결된다.
// ============================================================
const clientManageView = document.getElementById('clientManageView');
const clientList = document.getElementById('clientList');
const clientDetail = document.getElementById('clientDetail');
const clientSearchInput = document.getElementById('clientSearchInput');
const clientNameOptions = document.getElementById('clientNameOptions');

let clients = [];
let selectedClientId = null;
let clientShowingNewForm = false;

async function openClientManageView(){
  ensureExplorerVisible();
  hideAllPanelViews();
  clientManageView.style.display = 'flex';
  clientList.innerHTML = '<div class="log-empty">불러오는 중…</div>';
  await loadClients();
}

function closeClientManageView(){
  hideAllPanelViews();
  explorerView.style.display = 'flex';
  explorerPanelHead.style.display = 'flex';
  navigateTo(explorerPath);
}

async function loadClients(){
  try{
    const res = await callGas('client_get_clients', { search: clientSearchInput ? clientSearchInput.value.trim() : '' });
    if (res.error || res.success === false){
      clientList.innerHTML = '<div class="log-empty">' + escapeHtml(res.error || res.message || '불러오지 못했습니다.') + '</div>';
      return;
    }
    clients = res.clients || [];
    renderClientList();
    updateClientNameOptions_();
    if (selectedClientId){
      const still = clients.find(c => c.id === selectedClientId);
      if (still) { renderClientDetail(still); return; }
    }
    if (!clientShowingNewForm && clientDetail){
      clientDetail.innerHTML = '<div class="explorer-status">왼쪽에서 고객을 선택하거나 "+ 새 고객"을 눌러주세요.</div>';
    }
  }catch(err){
    clientList.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
  }
}

// 검색과 무관하게(작업관리 자동완성용으로) 전체 고객명 목록을 따로 한 번 받아와 datalist를 채운다.
async function updateClientNameOptions_(){
  if (!clientNameOptions) return;
  try{
    const all = clientSearchInput && clientSearchInput.value.trim() ? (await callGas('client_get_clients', {})).clients || [] : clients;
    clientNameOptions.innerHTML = '';
    all.forEach(c => {
      if (!c.성명) return;
      const opt = document.createElement('option');
      opt.value = c.성명;
      clientNameOptions.appendChild(opt);
    });
  }catch(err){ /* 자동완성 목록 갱신 실패는 조용히 무시 */ }
}

function renderClientList(){
  clientList.innerHTML = '';
  if (!clients.length){
    clientList.innerHTML = '<div class="log-empty">등록된 고객이 없습니다.</div>';
    return;
  }
  clients.slice().sort((a, b) => (a.성명 || '').localeCompare(b.성명 || '', 'ko')).forEach(c => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.style.cursor = 'pointer';
    if (c.id === selectedClientId) row.style.outline = '2px solid var(--navy)';
    row.innerHTML =
      '<div class="log-text"><b>' + escapeHtml(c.성명 || '') + '</b>' +
      (c.전화번호 ? ' · ' + escapeHtml(c.전화번호) : '') +
      (c.구분 ? '<br><span style="color:var(--sub); font-size:12px;">' + escapeHtml(c.구분) + '</span>' : '') +
      '</div>';
    row.addEventListener('click', () => { clientShowingNewForm = false; selectedClientId = c.id; renderClientList(); renderClientDetail(c); });
    clientList.appendChild(row);
  });
}

function renderNewClientForm(){
  clientShowingNewForm = true;
  selectedClientId = null;
  renderClientList();
  clientDetail.innerHTML =
    '<h3 style="margin-top:0;">새 고객 등록</h3>' +
    '<div style="display:flex; flex-direction:column; gap:8px; max-width:380px;">' +
    '<label>성명<br><input type="text" id="ccNewName" style="width:100%;" placeholder="고객 성명"></label>' +
    '<label>전화번호<br><input type="text" id="ccNewPhone" style="width:100%;" placeholder="(선택)"></label>' +
    '<label>구분<br><input type="text" id="ccNewType" style="width:100%;" placeholder="예: 개인/법인 (선택)"></label>' +
    '<label>사업자번호<br><input type="text" id="ccNewBiz" style="width:100%;" placeholder="(선택)"></label>' +
    '<label>메모<br><textarea id="ccNewMemo" style="width:100%; min-height:60px; font-family:inherit;" placeholder="(선택)"></textarea></label>' +
    '<div style="display:flex; gap:8px; margin-top:8px;">' +
    '<button type="button" id="ccNewSave" class="save-btn">저장</button>' +
    '<button type="button" id="ccNewCancel" class="ghost-btn">취소</button>' +
    '</div></div>';

  document.getElementById('ccNewCancel').addEventListener('click', () => {
    clientShowingNewForm = false;
    clientDetail.innerHTML = '<div class="explorer-status">왼쪽에서 고객을 선택하거나 "+ 새 고객"을 눌러주세요.</div>';
  });
  document.getElementById('ccNewSave').addEventListener('click', async () => {
    const 성명 = document.getElementById('ccNewName').value.trim();
    if (!성명){ showToast('성명을 입력해주세요.', 'warning'); return; }
    try{
      const res = await callGas('client_create_client', {
        성명, 전화번호: document.getElementById('ccNewPhone').value.trim(),
        구분: document.getElementById('ccNewType').value.trim(),
        사업자번호: document.getElementById('ccNewBiz').value.trim(),
        메모: document.getElementById('ccNewMemo').value.trim()
      });
      if (res.error || res.success === false){ showToast(res.error || res.message || '저장 실패', 'error'); return; }
      showToast('고객을 등록했습니다.', 'success');
      clientShowingNewForm = false;
      selectedClientId = res.client.id;
      await loadClients();
    }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
  });
}

async function renderClientDetail(c){
  clientDetail.innerHTML =
    '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
    '<input type="text" id="ccEditName" placeholder="성명" value="' + escapeHtml(c.성명 || '') + '" style="font-weight:700; font-size:15px; flex:1; min-width:0; margin-right:8px;">' +
    '<button type="button" id="ccDeleteClient" class="ghost-btn" title="고객 삭제">🗑 고객삭제</button>' +
    '</div>' +
    '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:14px;">' +
    '<input type="text" id="ccEditPhone" placeholder="전화번호" value="' + escapeHtml(c.전화번호 || '') + '" style="width:130px;">' +
    '<input type="text" id="ccEditType" placeholder="구분" value="' + escapeHtml(c.구분 || '') + '" style="width:100px;">' +
    '<input type="text" id="ccEditBiz" placeholder="사업자번호" value="' + escapeHtml(c.사업자번호 || '') + '" style="width:130px;">' +
    '<button type="button" id="ccSaveClient" class="ghost-btn">저장</button>' +
    '</div>' +
    '<textarea id="ccEditMemo" placeholder="메모" style="width:100%; max-width:500px; min-height:50px; font-family:inherit; margin-bottom:16px;">' + escapeHtml(c.메모 || '') + '</textarea>' +
    '<h4 style="margin-bottom:6px;">상담·자문 이력</h4>' +
    '<div id="ccLogList" class="log-list"><div class="log-empty">불러오는 중…</div></div>' +
    '<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">' +
    '<input type="date" id="ccNewLogDate" title="날짜(생략하면 오늘)">' +
    '<input type="text" id="ccNewLogStaff" placeholder="담당자" style="width:80px;">' +
    '<input type="text" id="ccNewLogType" placeholder="유형(예: 수시자문)" style="width:120px;">' +
    '<input type="text" id="ccNewLogContent" placeholder="내용" style="flex:1; min-width:160px;">' +
    '<input type="number" id="ccNewLogAmount" placeholder="금액" style="width:100px;">' +
    '<button type="button" id="ccAddLog" class="ghost-btn">+ 자문내역 추가</button>' +
    '</div>';

  document.getElementById('ccSaveClient').addEventListener('click', async () => {
    const name = document.getElementById('ccEditName').value.trim();
    if (!name){ showToast('성명은 비워둘 수 없습니다.', 'warning'); return; }
    try{
      const res = await callGas('client_update_client', {
        id: c.id, 성명: name,
        전화번호: document.getElementById('ccEditPhone').value.trim(),
        구분: document.getElementById('ccEditType').value.trim(),
        사업자번호: document.getElementById('ccEditBiz').value.trim(),
        메모: document.getElementById('ccEditMemo').value.trim()
      });
      if (res.error || res.success === false){ showToast(res.error || res.message || '저장 실패', 'error'); return; }
      showToast('저장했습니다.', 'success');
      await loadClients();
    }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
  });

  document.getElementById('ccDeleteClient').addEventListener('click', async () => {
    if (!confirm('"' + c.성명 + '" 고객을 삭제할까요? 자문내역은 남아있지만 이 고객과의 연결은 끊어집니다.')) return;
    try{
      const res = await callGas('client_delete_client', { id: c.id });
      if (res.error || res.success === false){ showToast(res.error || res.message || '삭제 실패', 'error'); return; }
      selectedClientId = null;
      showToast('삭제했습니다.', 'success');
      await loadClients();
    }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
  });

  document.getElementById('ccAddLog').addEventListener('click', async () => {
    const content = document.getElementById('ccNewLogContent').value.trim();
    if (!content){ showToast('내용을 입력해주세요.', 'warning'); return; }
    try{
      const res = await callGas('client_add_consult_log', {
        고객ID: c.id, 고객명: c.성명,
        날짜: document.getElementById('ccNewLogDate').value,
        담당자: document.getElementById('ccNewLogStaff').value.trim(),
        유형: document.getElementById('ccNewLogType').value.trim(),
        내용: content,
        금액: document.getElementById('ccNewLogAmount').value
      });
      if (res.error || res.success === false){ showToast(res.error || res.message || '추가 실패', 'error'); return; }
      showToast('자문내역을 추가했습니다.', 'success');
      document.getElementById('ccNewLogContent').value = '';
      document.getElementById('ccNewLogAmount').value = '';
      loadClientLogs_(c);
    }catch(err){ showToast('추가 중 오류가 발생했습니다.', 'error'); }
  });

  loadClientLogs_(c);
}

async function loadClientLogs_(c){
  const listEl = document.getElementById('ccLogList');
  if (!listEl) return;
  try{
    const res = await callGas('client_get_consult_logs', { 고객ID: c.id });
    if (res.error || res.success === false){
      listEl.innerHTML = '<div class="log-empty">' + escapeHtml(res.error || res.message || '불러오지 못했습니다.') + '</div>';
      return;
    }
    const logs = res.logs || [];
    if (!logs.length){
      listEl.innerHTML = '<div class="log-empty">아직 자문내역이 없습니다.</div>';
      return;
    }
    listEl.innerHTML = '';
    logs.forEach(log => {
      const row = document.createElement('div');
      row.className = 'log-entry';
      renderLogRowView_(row, c, log);
      listEl.appendChild(row);
    });
  }catch(err){
    listEl.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
  }
}

// [2026.08] 자문내역도 등록 후에는 삭제만 되고 수정이 안 됐다(고객명·사건명과 같은 이유의
// 누락) — 각 항목에 "✏️ 수정" 버튼을 추가해서 눌렀을 때만 그 항목이 입력칸으로 바뀌고,
// 그 외에는 지금처럼 읽기전용 요약으로 보여준다(모든 항목이 항상 입력칸이면 목록이
// 길어졌을 때 너무 번잡해서).
function renderLogRowView_(row, c, log){
  const amountText = log.금액 ? ' · ' + Number(log.금액).toLocaleString('ko-KR') + '원' : '';
  row.innerHTML =
    '<div class="log-date">' + escapeHtml(log.날짜 || '') + '</div>' +
    '<div class="log-text">' +
    (log.유형 ? '<b>' + escapeHtml(log.유형) + '</b> · ' : '') + escapeHtml(log.담당자 || '') + amountText +
    (log.관계 ? ' · ' + escapeHtml(log.관계) : '') +
    '<br>' + escapeHtml(log.내용 || '') +
    '</div>' +
    '<span class="log-edit" title="수정" style="cursor:pointer; margin-right:6px;">✏️</span>' +
    '<span class="log-del" title="삭제">✕</span>';
  row.querySelector('.log-edit').addEventListener('click', () => renderLogRowEdit_(row, c, log));
  row.querySelector('.log-del').addEventListener('click', async () => {
    if (!confirm('이 자문내역을 삭제할까요?')) return;
    try{
      const delRes = await callGas('client_delete_consult_log', { id: log.id });
      if (delRes.error || delRes.success === false){ showToast(delRes.error || delRes.message || '삭제 실패', 'error'); return; }
      loadClientLogs_(c);
    }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
  });
}

function renderLogRowEdit_(row, c, log){
  row.innerHTML =
    '<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; width:100%;">' +
    '<input type="date" class="logEditDate" value="' + escapeHtml(log.날짜 || '') + '" style="font-size:12px;">' +
    '<input type="text" class="logEditStaff" placeholder="담당자" value="' + escapeHtml(log.담당자 || '') + '" style="width:70px; font-size:12px;">' +
    '<input type="text" class="logEditType" placeholder="유형" value="' + escapeHtml(log.유형 || '') + '" style="width:100px; font-size:12px;">' +
    '<input type="text" class="logEditRelation" placeholder="관계(선택)" value="' + escapeHtml(log.관계 || '') + '" style="width:80px; font-size:12px;">' +
    '<input type="number" class="logEditAmount" placeholder="금액" value="' + (log.금액 || '') + '" style="width:90px; font-size:12px;">' +
    '<input type="text" class="logEditContent" placeholder="내용" value="' + escapeHtml(log.내용 || '') + '" style="flex:1; min-width:160px; font-size:12.5px;">' +
    '<button type="button" class="save-btn logEditSave" style="padding:3px 8px;">저장</button>' +
    '<button type="button" class="ghost-btn logEditCancel" style="padding:3px 8px;">취소</button>' +
    '</div>';
  row.querySelector('.logEditCancel').addEventListener('click', () => renderLogRowView_(row, c, log));
  row.querySelector('.logEditSave').addEventListener('click', async () => {
    const content = row.querySelector('.logEditContent').value.trim();
    if (!content){ showToast('내용을 입력해주세요.', 'warning'); return; }
    try{
      const res = await callGas('client_update_consult_log', {
        id: log.id,
        날짜: row.querySelector('.logEditDate').value,
        담당자: row.querySelector('.logEditStaff').value.trim(),
        유형: row.querySelector('.logEditType').value.trim(),
        관계: row.querySelector('.logEditRelation').value.trim(),
        금액: row.querySelector('.logEditAmount').value,
        내용: content
      });
      if (res.error || res.success === false){ showToast(res.error || res.message || '저장 실패', 'error'); return; }
      showToast('저장했습니다.', 'success');
      loadClientLogs_(c);
    }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
  });
}

// [2026.08] 작업관리와 같은 이유로 고객관리도 항상 새 창으로 연다 — 부트스트랩은 이 파일
// 맨 아래에서 처리(work-manage.js 쪽 주석 참고). [실수 수정] features 문자열 없이 열면
// 탭으로 열려서 드래그로 못 옮긴다 — width/height를 줘서 진짜 독립 창으로 열리게 함.
// 화면 오른쪽 절반에 기본 배치(작업관리는 왼쪽 절반이라, 나란히 놓임).
document.getElementById('btnOpenClientManage').addEventListener('click', () => {
  const sw = screen.availWidth || 1600, sh = screen.availHeight || 900;
  const w = Math.round(sw / 2), h = sh;
  window.open(location.origin + location.pathname + '?view=clientmanage', '_blank',
    'width=' + w + ',height=' + h + ',left=' + w + ',top=0,resizable=yes,scrollbars=yes');
});
document.getElementById('btnClientManageBack').addEventListener('click', closeClientManageView);
document.getElementById('btnClientNew').addEventListener('click', renderNewClientForm);
clientSearchInput.addEventListener('input', () => { loadClients(); });

// 작업관리(work-manage.js)의 "새 사건" 고객명 자동완성이 처음부터 채워져 있도록, 화면을
// 열지 않아도 미리 한 번 목록을 받아온다(customerListOptions을 loadCustomers()가 미리
// 채워두는 것과 같은 이유).
loadClients();

// [2026.08] 새 창 부트스트랩 — 작업관리·고객관리 버튼이 이제 이 index.html을 통째로
// ?view=workmanage 또는 ?view=clientmanage를 붙여서 새 창으로 연다. 이 파일이 두 화면의
// open 함수를 모두 쓸 수 있는 마지막 시점(work-manage.js 다음에 로드됨)이라 여기서 처리한다.
// 채팅창까지 같이 뜨면 두 창을 나란히 놓고 쓰기엔 좁으므로, 새 창에서는 탐색작업창을
// 최대화(채팅 끔) 모드로 시작한다.
(function bootstrapStandaloneView_(){
  const view = new URLSearchParams(location.search).get('view');
  if (view !== 'workmanage' && view !== 'clientmanage') return;
  if (typeof setWorkspaceMode === 'function') setWorkspaceMode('max');
  if (view === 'workmanage') openWorkManageView();
  else openClientManageView();
})();
