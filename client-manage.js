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

const CLIENT_TIER_OPTIONS_ = ['로얄', '우수', '보통', '영세'];

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
    // 고객정보 빠른보기(팝업) 안에서 저장했을 때는 clientDetail이 그 팝업 안에 옮겨져 있는
    // 상태라, 여기서 안내문구로 덮어써버리면 팝업 내용이 사라져버린다 — 그 경우는 건너뛴다.
    const inQuickView = clientDetail && clientDetail.parentElement && clientDetail.parentElement.id === 'clientQuickViewMount';
    if (!clientShowingNewForm && clientDetail && !inQuickView){
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
    '<label>구분<br><select id="ccNewType" style="width:100%;">' + CLIENT_TIER_OPTIONS_.map(t => '<option value="' + t + '"' + (t === '보통' ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    '<label>납세번호<br><input type="text" id="ccNewBiz" style="width:100%;" placeholder="(선택)"></label>' +
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
    '<button type="button" id="ccDeleteClient" class="ghost-btn" title="삭제">🗑 삭제</button>' +
    '</div>' +
    '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:14px;">' +
    '<input type="text" id="ccEditPhone" placeholder="전화번호" value="' + escapeHtml(c.전화번호 || '') + '" style="width:130px;">' +
    '<select id="ccEditType" style="width:100px;">' + CLIENT_TIER_OPTIONS_.map(t => '<option value="' + t + '"' + (t === (c.구분 || '보통') ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
    '<input type="text" id="ccEditBiz" placeholder="납세번호" value="' + escapeHtml(c.사업자번호 || '') + '" style="width:130px;">' +
    '<button type="button" id="ccSaveClient" class="ghost-btn">저장</button>' +
    '</div>' +
    '<textarea id="ccEditMemo" placeholder="메모" style="width:100%; max-width:500px; min-height:50px; font-family:inherit; margin-bottom:16px;">' + escapeHtml(c.메모 || '') + '</textarea>' +
    '<h4 style="margin-bottom:6px;">서비스 이력</h4>' +
    '<div id="ccLogList" class="log-list"><div class="log-empty">불러오는 중…</div></div>' +
    '<h4 id="ccPaymentToggle" style="margin-bottom:6px; margin-top:18px; cursor:pointer; width:fit-content;" title="눌러서 수금 내역 추가">➕ 수금관리</h4>' +
    '<div id="ccPaymentList" class="log-list"><div class="log-empty">불러오는 중…</div></div>' +
    '<div id="ccNewPaymentFormWrap" style="display:none; margin-top:10px; gap:6px; flex-wrap:wrap; align-items:center;"></div>';

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
      // 빠르게보기 팝업 안에서 저장한 거라면, 방금 저장한 값을 기준으로 스냅샷을 갱신해서
      // 바로 닫아도 "저장 안 한 내용이 있다"는 경고가 잘못 뜨지 않게 한다.
      if (quickViewSnapshot_ !== null) quickViewSnapshot_ = quickViewCurrentSignature_();
    }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
  });

  document.getElementById('ccDeleteClient').addEventListener('click', async () => {
    if (!confirm('"' + c.성명 + '" 고객을 삭제할까요? 수금 내역은 남아있지만 이 고객과의 연결은 끊어집니다.')) return;
    try{
      const res = await callGas('client_delete_client', { id: c.id });
      if (res.error || res.success === false){ showToast(res.error || res.message || '삭제 실패', 'error'); return; }
      selectedClientId = null;
      showToast('삭제했습니다.', 'success');
      await loadClients();
    }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
  });

  // [2026.08] 작업관리의 "➕ 하위업무" 패턴과 통일 — 별도 버튼 없이 "수금관리" 표시 자체를
  // 누르면 입력칸이 나타난다.
  const newPaymentFormWrap = document.getElementById('ccNewPaymentFormWrap');
  document.getElementById('ccPaymentToggle').addEventListener('click', () => {
    if (newPaymentFormWrap.style.display === 'none'){
      newPaymentFormWrap.style.display = 'flex';
      newPaymentFormWrap.innerHTML =
        '<input type="date" id="ccNewPayDate" title="날짜(생략하면 오늘)">' +
        '<input type="number" id="ccNewPayAmount" placeholder="금액" style="width:110px;">' +
        '<select id="ccNewPayReceipt">' +
        '<option value="">수취증빙 선택</option>' +
        '<option value="현금영수증">현금영수증</option>' +
        '<option value="세금계산서">세금계산서</option>' +
        '<option value="신용카드">신용카드</option>' +
        '</select>' +
        '<button type="button" id="ccAddPayment" class="save-btn">추가</button>' +
        '<button type="button" id="ccAddPaymentCancel" class="ghost-btn">취소</button>';
      document.getElementById('ccAddPaymentCancel').addEventListener('click', () => { newPaymentFormWrap.style.display = 'none'; newPaymentFormWrap.innerHTML = ''; });
      document.getElementById('ccAddPayment').addEventListener('click', async () => {
        const amount = document.getElementById('ccNewPayAmount').value;
        if (!amount){ showToast('금액을 입력해주세요.', 'warning'); return; }
        try{
          const res = await callGas('client_add_consult_log', {
            고객ID: c.id, 고객명: c.성명,
            날짜: document.getElementById('ccNewPayDate').value,
            금액: amount,
            수취증빙: document.getElementById('ccNewPayReceipt').value
          });
          if (res.error || res.success === false){ showToast(res.error || res.message || '추가 실패', 'error'); return; }
          showToast('수금 내역을 추가했습니다.', 'success');
          newPaymentFormWrap.style.display = 'none';
          newPaymentFormWrap.innerHTML = '';
          loadClientPayments_(c);
        }catch(err){ showToast('추가 중 오류가 발생했습니다.', 'error'); }
      });
    } else {
      newPaymentFormWrap.style.display = 'none';
      newPaymentFormWrap.innerHTML = '';
    }
  });

  loadClientLogs_(c);
  loadClientPayments_(c);
}

// [2026.08] "상담·자문 이력"이라는 이름 때문에 실제 상담 기록만 남기는 곳으로 오해하기
// 쉬웠다 — 사용자 지적: "모든 서비스가 반영되고 연결되어야 하는 거지". 그래서 "서비스
// 이력"은 이 고객 명의로 작업관리에 등록된 사건들을 보여주는 것으로 정리했다(작업관리
// 사건 자체가 이미 "무슨 일을 했는지"를 다 담고 있으므로). 옛 자문내역(ConsultLog) 기록은
// "수금관리"(아래 loadClientPayments_)로 용도를 바꿨다 — 날짜·금액·수취증빙만 남기는
// 입금 기록용으로.
async function loadClientLogs_(c){
  const listEl = document.getElementById('ccLogList');
  if (!listEl) return;
  try{
    const res = await callGas('work_get_cases', {});
    if (res.error || res.success === false){
      listEl.innerHTML = '<div class="log-empty">' + escapeHtml(res.error || res.message || '불러오지 못했습니다.') + '</div>';
      return;
    }
    const cases = (res.cases || []).filter(wc => wc.고객ID === c.id);
    if (!cases.length){
      listEl.innerHTML = '<div class="log-empty">아직 이력이 없습니다.</div>';
      return;
    }
    cases.sort((a, b) => (b.의뢰일 || b.수정일 || '').localeCompare(a.의뢰일 || a.수정일 || ''));
    listEl.innerHTML = '';
    cases.forEach(wc => {
      const row = document.createElement('div');
      row.className = 'log-entry';
      renderCaseHistoryRow_(row, wc);
      listEl.appendChild(row);
    });
  }catch(err){
    listEl.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
  }
}

// 서비스 이력에 보여주는 작업관리 사건 한 줄.
function renderCaseHistoryRow_(row, wc){
  const semokLabel = (typeof WORK_SEMOK_LABELS !== 'undefined' && WORK_SEMOK_LABELS[wc.세목]) || wc.세목 || '';
  const deadlineLabel = typeof workDeadlineFieldLabel_ === 'function' ? workDeadlineFieldLabel_(wc.업무유형) : '법정일';
  row.innerHTML =
    '<div class="log-date">' + escapeHtml(wc.의뢰일 ? fmtDateShort_(wc.의뢰일) : '') + '</div>' +
    '<div class="log-text">' +
    '🗂 <b>' + escapeHtml(wc.사건명 || '') + '</b> · ' + escapeHtml(semokLabel) + (wc.업무유형 ? ' · ' + escapeHtml(wc.업무유형) : '') +
    ' · <span style="color:' + (wc.상태 === '완료' ? '#16a34a' : 'var(--sub)') + ';">' + escapeHtml(wc.상태 || '') + '</span>' +
    (wc.법정일 ? '<br>' + escapeHtml(deadlineLabel) + ': ' + escapeHtml(fmtDateShort_(wc.법정일)) : '') +
    '</div>';
}

// [2026.08] 수금관리 — 옛 자문내역(ConsultLog) 시트를 그대로 재사용하되, 화면에는 날짜·
// 금액·수취증빙(현금영수증/세금계산서/신용카드) 3가지만 남겼다(담당자·유형·내용·관계 필드는
// 시트에 남아있지만 이 화면에서는 더 이상 쓰지 않음 — 데이터 손실 없이 용도만 바꾼 것).
async function loadClientPayments_(c){
  const listEl = document.getElementById('ccPaymentList');
  if (!listEl) return;
  try{
    const res = await callGas('client_get_consult_logs', { 고객ID: c.id });
    if (res.error || res.success === false){
      listEl.innerHTML = '<div class="log-empty">' + escapeHtml(res.error || res.message || '불러오지 못했습니다.') + '</div>';
      return;
    }
    const payments = res.logs || [];
    if (!payments.length){
      listEl.innerHTML = '<div class="log-empty">아직 수금 내역이 없습니다.</div>';
      return;
    }
    listEl.innerHTML = '';
    payments.forEach(pay => {
      const row = document.createElement('div');
      row.className = 'log-entry';
      renderPaymentRowView_(row, c, pay);
      listEl.appendChild(row);
    });
  }catch(err){
    listEl.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
  }
}

function renderPaymentRowView_(row, c, pay){
  const amountText = pay.금액 ? Number(pay.금액).toLocaleString('ko-KR') + '원' : '';
  row.innerHTML =
    '<div class="log-date">' + escapeHtml(fmtDateShort_(pay.날짜)) + '</div>' +
    '<div class="log-text">' + escapeHtml(amountText) + (pay.수취증빙 ? ' · ' + escapeHtml(pay.수취증빙) : '') + '</div>' +
    '<span class="log-edit" title="수정" style="cursor:pointer; margin-right:6px;">✏️</span>' +
    '<span class="log-del" title="삭제">✕</span>';
  row.querySelector('.log-edit').addEventListener('click', () => renderPaymentRowEdit_(row, c, pay));
  row.querySelector('.log-del').addEventListener('click', async () => {
    if (!confirm('이 수금 내역을 삭제할까요?')) return;
    try{
      const delRes = await callGas('client_delete_consult_log', { id: pay.id });
      if (delRes.error || delRes.success === false){ showToast(delRes.error || delRes.message || '삭제 실패', 'error'); return; }
      loadClientPayments_(c);
    }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
  });
}

function renderPaymentRowEdit_(row, c, pay){
  const receiptOptions = ['', '현금영수증', '세금계산서', '신용카드'];
  row.innerHTML =
    '<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; width:100%;">' +
    '<input type="date" class="payEditDate" value="' + escapeHtml(pay.날짜 || '') + '" style="font-size:12px;">' +
    '<input type="number" class="payEditAmount" placeholder="금액" value="' + (pay.금액 || '') + '" style="width:110px; font-size:12px;">' +
    '<select class="payEditReceipt" style="font-size:12px;">' +
    receiptOptions.map(o => '<option value="' + o + '"' + (o === (pay.수취증빙 || '') ? ' selected' : '') + '>' + (o || '수취증빙 선택') + '</option>').join('') +
    '</select>' +
    '<button type="button" class="save-btn payEditSave" style="padding:3px 8px;">저장</button>' +
    '<button type="button" class="ghost-btn payEditCancel" style="padding:3px 8px;">취소</button>' +
    '</div>';
  row.querySelector('.payEditCancel').addEventListener('click', () => renderPaymentRowView_(row, c, pay));
  row.querySelector('.payEditSave').addEventListener('click', async () => {
    const amount = row.querySelector('.payEditAmount').value;
    if (!amount){ showToast('금액을 입력해주세요.', 'warning'); return; }
    try{
      const res = await callGas('client_update_consult_log', {
        id: pay.id,
        날짜: row.querySelector('.payEditDate').value,
        금액: amount,
        수취증빙: row.querySelector('.payEditReceipt').value
      });
      if (res.error || res.success === false){ showToast(res.error || res.message || '저장 실패', 'error'); return; }
      showToast('저장했습니다.', 'success');
      loadClientPayments_(c);
    }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
  });
}

// [2026.08] 작업관리와 같은 이유로 고객관리도 항상 새 창으로 연다(work-manage.js 쪽 주석
// 참고). 실제 창 열기는 core.js의 openStandaloneManageWindow_()로 통일했다.
document.getElementById('btnOpenClientManage').addEventListener('click', () => {
  openStandaloneManageWindow_('clientmanage');
});
document.getElementById('btnClientManageBack').addEventListener('click', closeClientManageView);
document.getElementById('btnClientNew').addEventListener('click', renderNewClientForm);
clientSearchInput.addEventListener('input', () => { loadClients(); });

// 작업관리(work-manage.js)의 "새 사건" 고객명 자동완성이 처음부터 채워져 있도록, 화면을
// 열지 않아도 미리 한 번 목록을 받아온다(customerListOptions을 loadCustomers()가 미리
// 채워두는 것과 같은 이유).
loadClients();

// [2026.08] 작업관리 사건 상세화면에서 의뢰인 이름 옆 👤 버튼을 누르면, 고객관리 전체를
// 열지 않고 그 고객 한 명의 정보만 빠르게 보고 고칠 수 있는 작은 팝업을 띄운다. renderClientDetail
// 함수를 그대로 재사용한다 — 다만 그 함수는 항상 #clientDetail에 그린다고 하드코딩돼 있으므로,
// #clientDetail 요소 자체를 팝업 안으로 옮겼다가(appendChild) 닫을 때 원래 자리로 되돌린다.
// (렌더 함수를 새로 만들지 않고 DOM 노드만 옮기므로, 저장·삭제·자문내역 추가 등 기존 로직이
// 그대로 다 동작한다.)
// 빠르게보기를 열 때의 입력값 스냅샷 — 닫으려 할 때 지금 값과 비교해서 저장 안 한 수정이
// 있으면 확인 없이 그냥 닫아버리지 않도록 한다(사용자 지적: 안전장치 필요).
let quickViewSnapshot_ = null;
function quickViewCurrentSignature_(){
  const ids = ['ccEditName', 'ccEditPhone', 'ccEditType', 'ccEditBiz', 'ccEditMemo'];
  return ids.map(id => { const el = document.getElementById(id); return el ? el.value : ''; }).join('');
}

async function openClientQuickView_(clientId){
  if (!clientId){ showToast('이 사건에 연결된 고객 정보가 없습니다.', 'warning'); return; }
  let found = clients.find(c => c.id === clientId);
  if (!found){
    try{
      const res = await callGas('client_get_clients', {});
      if (!res.error && res.clients) found = res.clients.find(c => c.id === clientId);
    }catch(err){ /* 아래 found 체크에서 처리 */ }
  }
  if (!found){ showToast('연결된 고객 정보를 찾을 수 없습니다.', 'error'); return; }
  const overlay = document.getElementById('clientQuickViewOverlay');
  document.getElementById('clientQuickViewMount').appendChild(clientDetail);
  overlay.style.display = 'flex';
  await renderClientDetail(found);
  quickViewSnapshot_ = quickViewCurrentSignature_();
}

function closeClientQuickView_(){
  if (quickViewSnapshot_ !== null && quickViewCurrentSignature_() !== quickViewSnapshot_){
    if (!confirm('저장하지 않은 수정 내용이 있습니다. 저장하지 않고 닫을까요?')) return;
  }
  quickViewSnapshot_ = null;
  document.getElementById('clientQuickViewOverlay').style.display = 'none';
  const clientDetailCol = document.getElementById('clientDetailCol');
  if (clientDetailCol) clientDetailCol.appendChild(clientDetail);
}

const btnCloseClientQuickView = document.getElementById('btnCloseClientQuickView');
if (btnCloseClientQuickView) btnCloseClientQuickView.addEventListener('click', closeClientQuickView_);
const clientQuickViewOverlay = document.getElementById('clientQuickViewOverlay');
if (clientQuickViewOverlay){
  clientQuickViewOverlay.addEventListener('click', (e) => { if (e.target === clientQuickViewOverlay) closeClientQuickView_(); });
}

// [2026.08] 새 창 부트스트랩 — 작업관리·고객관리 버튼이 이제 이 index.html을 통째로
// ?view=workmanage 또는 ?view=clientmanage를 붙여서 새 창으로 연다. 이 파일이 두 화면의
// open 함수를 모두 쓸 수 있는 마지막 시점(work-manage.js 다음에 로드됨)이라 여기서 처리한다.
// 채팅창까지 같이 뜨면 두 창을 나란히 놓고 쓰기엔 좁으므로, 새 창에서는 탐색작업창을
// 최대화(채팅 끔) 모드로 시작한다.
(function bootstrapStandaloneView_(){
  const view = new URLSearchParams(location.search).get('view');
  if (view !== 'workmanage' && view !== 'clientmanage') return;
  if (typeof setWorkspaceMode === 'function') setWorkspaceMode('max');
  document.title = (view === 'workmanage' ? '작업관리' : '고객관리') + ' - NX-Work';
  if (view === 'workmanage') openWorkManageView();
  else openClientManageView();
})();
