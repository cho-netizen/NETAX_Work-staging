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
    '<h3 style="margin-top:0;">' + escapeHtml(c.성명 || '') + '</h3>' +
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
    try{
      const res = await callGas('client_update_client', {
        id: c.id, 전화번호: document.getElementById('ccEditPhone').value.trim(),
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
      const amountText = log.금액 ? ' · ' + Number(log.금액).toLocaleString('ko-KR') + '원' : '';
      row.innerHTML =
        '<div class="log-date">' + escapeHtml(log.날짜 || '') + '</div>' +
        '<div class="log-text">' +
        (log.유형 ? '<b>' + escapeHtml(log.유형) + '</b> · ' : '') + escapeHtml(log.담당자 || '') + amountText +
        '<br>' + escapeHtml(log.내용 || '') +
        '</div>' +
        '<span class="log-del" title="삭제">✕</span>';
      row.querySelector('.log-del').addEventListener('click', async () => {
        if (!confirm('이 자문내역을 삭제할까요?')) return;
        try{
          const delRes = await callGas('client_delete_consult_log', { id: log.id });
          if (delRes.error || delRes.success === false){ showToast(delRes.error || delRes.message || '삭제 실패', 'error'); return; }
          loadClientLogs_(c);
        }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
      });
      listEl.appendChild(row);
    });
  }catch(err){
    listEl.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
  }
}

document.getElementById('btnOpenClientManage').addEventListener('click', openClientManageView);
document.getElementById('btnClientManageBack').addEventListener('click', closeClientManageView);
document.getElementById('btnClientNew').addEventListener('click', renderNewClientForm);
clientSearchInput.addEventListener('input', () => { loadClients(); });

// 작업관리(work-manage.js)의 "새 사건" 고객명 자동완성이 처음부터 채워져 있도록, 화면을
// 열지 않아도 미리 한 번 목록을 받아온다(customerListOptions을 loadCustomers()가 미리
// 채워두는 것과 같은 이유).
loadClients();
