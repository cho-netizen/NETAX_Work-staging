// ============================================================
// 작업관리 — 사건별 세부업무 트리 + 법정기한 자동계산 + 구글캘린더 연동 (2026.08 신규)
// explorer.js의 openDashboardView/hideAllPanelViews 패턴, callGas/showToast/escapeHtml을
// 그대로 재사용한다(이 파일은 explorer.js 다음에 로드되므로 같은 전역 스코프를 공유).
// ============================================================
const workManageView = document.getElementById('workManageView');
  const workCaseList = document.getElementById('workCaseList');
  const workCaseDetail = document.getElementById('workCaseDetail');
  const workCaseFilterStatus = document.getElementById('workCaseFilterStatus');

  const WORK_SEMOK_LABELS = { transfer: '양도', gift: '증여', inheritance: '상속', objection: '불복' };
  const WORK_STATUS_OPTIONS = ['대기', '진행중', '완료'];

  let workCases = [];
  let workSelectedCaseId = null;
  let workShowingNewForm = false;

  async function openWorkManageView(){
    ensureExplorerVisible();
    hideAllPanelViews();
    workManageView.style.display = 'flex';
    workCaseList.innerHTML = '<div class="log-empty">불러오는 중…</div>';
    await loadWorkCases();
  }

  function closeWorkManageView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(explorerPath);
  }

  async function loadWorkCases(){
    try{
      const res = await callGas('work_get_cases', {});
      if (res.error || res.success === false){
        workCaseList.innerHTML = '<div class="log-empty">' + escapeHtml(res.error || res.message || '불러오지 못했습니다.') + '</div>';
        return;
      }
      workCases = res.cases || [];
      renderWorkCaseList();
      if (workSelectedCaseId){
        const still = workCases.find(c => c.id === workSelectedCaseId);
        if (still) { renderWorkCaseDetail(still); return; }
      }
      if (!workShowingNewForm){
        workCaseDetail.innerHTML = '<div class="explorer-status">왼쪽에서 사건을 선택하거나 "+ 새 사건"을 눌러주세요.</div>';
      }
    }catch(err){
      workCaseList.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
    }
  }

  function workProgress(caseObj){
    let total = 0, done = 0;
    (function walk(nodes){
      (nodes || []).forEach(n => {
        total++;
        if (n.status === '완료') done++;
        walk(n.children);
      });
    })(caseObj.하위업무);
    return { total, done };
  }

  function renderWorkCaseList(){
    const filter = workCaseFilterStatus.value;
    const filtered = workCases.filter(c => !filter || c.상태 === filter);
    workCaseList.innerHTML = '';
    if (!filtered.length){
      workCaseList.innerHTML = '<div class="log-empty">등록된 사건이 없습니다.</div>';
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    filtered.slice().sort((a, b) => (a.법정일 || '9999').localeCompare(b.법정일 || '9999')).forEach(c => {
      const prog = workProgress(c);
      const overdue = c.법정일 && c.법정일 < todayStr && c.상태 !== '완료';
      const row = document.createElement('div');
      row.className = 'log-entry';
      row.style.cursor = 'pointer';
      if (c.id === workSelectedCaseId) row.style.outline = '2px solid var(--navy)';
      row.innerHTML =
        '<div class="log-date">' + (overdue ? '<span style="color:#a83232;">⏰</span> ' : '') + escapeHtml(c.법정일 || '기한없음') + '</div>' +
        '<div class="log-text"><b>' + escapeHtml(c.고객명 || '(고객명 없음)') + '</b> · ' + escapeHtml(c.사건명 || '') +
        '<br><span style="color:var(--sub); font-size:12px;">' + escapeHtml(WORK_SEMOK_LABELS[c.세목] || c.세목 || '') + ' · ' + escapeHtml(c.상태 || '') +
        (prog.total ? (' · 하위업무 ' + prog.done + '/' + prog.total) : '') + '</span></div>';
      row.addEventListener('click', () => { workShowingNewForm = false; workSelectedCaseId = c.id; renderWorkCaseList(); renderWorkCaseDetail(c); });
      workCaseList.appendChild(row);
    });
  }

  function renderNewCaseForm(){
    workShowingNewForm = true;
    workSelectedCaseId = null;
    renderWorkCaseList();
    workCaseDetail.innerHTML =
      '<h3 style="margin-top:0;">새 사건 등록</h3>' +
      '<div style="display:flex; flex-direction:column; gap:8px; max-width:420px;">' +
      '<label>고객명<br><input type="text" id="wcNewCustomer" list="clientNameOptions" style="width:100%;" placeholder="고객명 (신규면 자동으로 고객관리에도 등록됩니다)"></label>' +
      '<label>사건명<br><input type="text" id="wcNewCase" style="width:100%;" placeholder="예: 2026년 양도소득세 신고"></label>' +
      '<label>세목<br><select id="wcNewSemok" style="width:100%;">' +
        Object.keys(WORK_SEMOK_LABELS).map(k => '<option value="' + k + '">' + WORK_SEMOK_LABELS[k] + '</option>').join('') +
      '</select></label>' +
      '<label>담당자<br><input type="text" id="wcNewAssignee" style="width:100%;" placeholder="(선택)"></label>' +
      '<label>의뢰일<br><input type="date" id="wcNewRequestDate" style="width:100%;"></label>' +
      '<label>기준일 (양도일·증여일·사망일 등)<br><input type="date" id="wcNewBaseDate" style="width:100%;"></label>' +
      '<div style="display:flex; gap:8px; margin-top:8px;">' +
      '<button type="button" id="wcNewSave" class="save-btn">저장</button>' +
      '<button type="button" id="wcNewCancel" class="ghost-btn">취소</button>' +
      '</div></div>';

    document.getElementById('wcNewCancel').addEventListener('click', () => {
      workShowingNewForm = false;
      workCaseDetail.innerHTML = '<div class="explorer-status">왼쪽에서 사건을 선택하거나 "+ 새 사건"을 눌러주세요.</div>';
    });
    document.getElementById('wcNewSave').addEventListener('click', async () => {
      const 고객명 = document.getElementById('wcNewCustomer').value.trim();
      const 사건명 = document.getElementById('wcNewCase').value.trim();
      if (!고객명 || !사건명){ showToast('고객명과 사건명을 입력해주세요.', 'warning'); return; }
      const payload = {
        고객명, 사건명,
        세목: document.getElementById('wcNewSemok').value,
        담당자: document.getElementById('wcNewAssignee').value.trim(),
        의뢰일: document.getElementById('wcNewRequestDate').value,
        기준일: document.getElementById('wcNewBaseDate').value
      };
      try{
        const res = await callGas('work_create_case', payload);
        if (res.error || res.success === false){ showToast(res.error || res.message || '저장 실패', 'error'); return; }
        showToast('사건을 등록했습니다.', 'success');
        workShowingNewForm = false;
        workSelectedCaseId = res.case.id;
        await loadWorkCases();
      }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
    });
  }

  function renderWorkCaseDetail(c){
    const prog = workProgress(c);
    workCaseDetail.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
      '<h3 style="margin-top:0;">' + escapeHtml(c.고객명 || '') + ' · ' + escapeHtml(c.사건명 || '') + '</h3>' +
      '<button type="button" id="wcDeleteCase" class="ghost-btn" title="사건 삭제">🗑 사건삭제</button>' +
      '</div>' +
      '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px;">' +
      '<select id="wcEditSemok">' + Object.keys(WORK_SEMOK_LABELS).map(k => '<option value="' + k + '"' + (k === c.세목 ? ' selected' : '') + '>' + WORK_SEMOK_LABELS[k] + '</option>').join('') + '</select>' +
      '<input type="text" id="wcEditAssignee" placeholder="담당자" value="' + escapeHtml(c.담당자 || '') + '" style="width:100px;">' +
      '<label style="font-size:12px; color:var(--sub);">의뢰일 <input type="date" id="wcEditRequestDate" value="' + escapeHtml(c.의뢰일 || '') + '"></label>' +
      '<label style="font-size:12px; color:var(--sub);">기준일 <input type="date" id="wcEditBaseDate" value="' + escapeHtml(c.기준일 || '') + '"></label>' +
      '<select id="wcEditStatus">' + WORK_STATUS_OPTIONS.map(s => '<option value="' + s + '"' + (s === c.상태 ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
      '<button type="button" id="wcSaveCase" class="ghost-btn">저장</button>' +
      '<span style="font-size:12.5px; color:var(--sub);">법정일: <b style="color:var(--navy);">' + escapeHtml(c.법정일 || '(기준일을 입력하면 자동 계산)') + '</b></span>' +
      '</div>' +
      '<div style="font-size:12.5px; color:var(--sub); margin-bottom:8px;">하위업무 진행 ' + prog.done + ' / ' + prog.total + '</div>' +
      '<div id="wcTree"></div>' +
      '<div style="margin-top:10px; display:flex; gap:6px;">' +
      '<input type="text" id="wcNewRootTitle" placeholder="새 하위업무 (예: 자료수집)" style="flex:1; min-width:160px;">' +
      '<input type="date" id="wcNewRootDue" title="마감일(선택)">' +
      '<button type="button" id="wcAddRoot" class="ghost-btn">+ 추가</button>' +
      '</div>';

    renderWorkTree(c.하위업무 || [], document.getElementById('wcTree'), c.id, 0);

    document.getElementById('wcSaveCase').addEventListener('click', async () => {
      const payload = {
        id: c.id,
        세목: document.getElementById('wcEditSemok').value,
        담당자: document.getElementById('wcEditAssignee').value.trim(),
        의뢰일: document.getElementById('wcEditRequestDate').value,
        기준일: document.getElementById('wcEditBaseDate').value,
        상태: document.getElementById('wcEditStatus').value
      };
      try{
        const res = await callGas('work_update_case', payload);
        if (res.error || res.success === false){ showToast(res.error || res.message || '저장 실패', 'error'); return; }
        showToast('저장했습니다.', 'success');
        await loadWorkCases();
      }catch(err){ showToast('저장 중 오류가 발생했습니다.', 'error'); }
    });

    document.getElementById('wcDeleteCase').addEventListener('click', async () => {
      if (!confirm('"' + c.사건명 + '" 사건을 삭제할까요? 하위업무와 캘린더 일정도 함께 지워집니다.')) return;
      try{
        const res = await callGas('work_delete_case', { id: c.id });
        if (res.error || res.success === false){ showToast(res.error || res.message || '삭제 실패', 'error'); return; }
        workSelectedCaseId = null;
        showToast('삭제했습니다.', 'success');
        await loadWorkCases();
      }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
    });

    document.getElementById('wcAddRoot').addEventListener('click', () => addWorkSubtask(c.id, null));
  }

  function renderWorkTree(nodes, container, caseId, depth){
    container.innerHTML = '';
    if (!nodes.length && depth === 0){
      container.innerHTML = '<div class="log-empty" style="padding:8px 0;">아직 하위업무가 없습니다.</div>';
      return;
    }
    nodes.forEach(node => {
      const row = document.createElement('div');
      row.style.marginLeft = (depth * 20) + 'px';
      row.style.borderLeft = depth ? '2px solid var(--line)' : 'none';
      row.style.padding = '4px 0 4px 8px';
      const overdue = node.dueDate && node.dueDate < new Date().toISOString().slice(0, 10) && node.status !== '완료';
      row.innerHTML =
        '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px;">' +
        '<select class="wcNodeStatus" style="font-size:12px;">' + WORK_STATUS_OPTIONS.map(s => '<option value="' + s + '"' + (s === node.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
        '<input type="text" class="wcNodeTitle" value="' + escapeHtml(node.title || '') + '" style="flex:1; min-width:120px; font-size:13px;">' +
        '<input type="text" class="wcNodeAssignee" value="' + escapeHtml(node.assignee || '') + '" placeholder="담당자" style="width:70px; font-size:12px;">' +
        '<input type="date" class="wcNodeDue" value="' + escapeHtml(node.dueDate || '') + '" style="font-size:12px;' + (overdue ? ' color:#a83232;' : '') + '">' +
        '<button type="button" class="ghost-btn wcNodeAddChild" style="padding:3px 8px;">+ 하위</button>' +
        '<span class="log-del wcNodeDelete" title="삭제">✕</span>' +
        '</div>' +
        '<div class="wcChildFormWrap" style="display:none; margin-top:4px; margin-left:20px; gap:6px; flex-wrap:wrap;"></div>' +
        '<div class="wcChildren"></div>';
      container.appendChild(row);

      const statusSel = row.querySelector('.wcNodeStatus');
      const titleInput = row.querySelector('.wcNodeTitle');
      const assigneeInput = row.querySelector('.wcNodeAssignee');
      const dueInput = row.querySelector('.wcNodeDue');

      statusSel.addEventListener('change', () => updateWorkSubtask(caseId, node.id, { status: statusSel.value }));
      titleInput.addEventListener('change', () => updateWorkSubtask(caseId, node.id, { title: titleInput.value.trim() }));
      assigneeInput.addEventListener('change', () => updateWorkSubtask(caseId, node.id, { assignee: assigneeInput.value.trim() }));
      dueInput.addEventListener('change', () => updateWorkSubtask(caseId, node.id, { dueDate: dueInput.value }));

      row.querySelector('.wcNodeDelete').addEventListener('click', () => {
        if (!confirm('"' + (node.title || '') + '" 항목을 삭제할까요?' + (node.children && node.children.length ? ' 하위 항목도 함께 지워집니다.' : ''))) return;
        deleteWorkSubtask(caseId, node.id);
      });

      const addChildBtn = row.querySelector('.wcNodeAddChild');
      const childFormWrap = row.querySelector('.wcChildFormWrap');
      addChildBtn.addEventListener('click', () => {
        if (childFormWrap.style.display === 'none'){
          childFormWrap.style.display = 'flex';
          childFormWrap.innerHTML =
            '<input type="text" class="wcChildTitle" placeholder="세부항목 이름" style="flex:1; min-width:120px; font-size:12.5px;">' +
            '<input type="date" class="wcChildDue" style="font-size:12px;">' +
            '<button type="button" class="save-btn wcChildSave" style="padding:3px 8px;">추가</button>' +
            '<button type="button" class="ghost-btn wcChildCancel" style="padding:3px 8px;">취소</button>';
          childFormWrap.querySelector('.wcChildCancel').addEventListener('click', () => { childFormWrap.style.display = 'none'; childFormWrap.innerHTML = ''; });
          childFormWrap.querySelector('.wcChildSave').addEventListener('click', () => {
            const t = childFormWrap.querySelector('.wcChildTitle').value.trim();
            if (!t){ showToast('항목 이름을 입력해주세요.', 'warning'); return; }
            addWorkSubtask(caseId, node.id, t, childFormWrap.querySelector('.wcChildDue').value);
          });
        } else {
          childFormWrap.style.display = 'none';
          childFormWrap.innerHTML = '';
        }
      });

      renderWorkTree(node.children || [], row.querySelector('.wcChildren'), caseId, depth + 1);
    });
  }

  function applyUpdatedCase(caseObj){
    const idx = workCases.findIndex(c => c.id === caseObj.id);
    if (idx !== -1) workCases[idx] = caseObj; else workCases.push(caseObj);
    workSelectedCaseId = caseObj.id;
    renderWorkCaseList();
    renderWorkCaseDetail(caseObj);
  }

  async function addWorkSubtask(caseId, parentId, titleFromChildForm, dueFromChildForm){
    let title = titleFromChildForm, dueDate = dueFromChildForm;
    if (parentId === null && !titleFromChildForm){
      title = document.getElementById('wcNewRootTitle').value.trim();
      dueDate = document.getElementById('wcNewRootDue').value;
    }
    if (!title){ showToast('항목 이름을 입력해주세요.', 'warning'); return; }
    try{
      const res = await callGas('work_add_subtask', { id: caseId, parentId, title, dueDate });
      if (res.error || res.success === false){ showToast(res.error || res.message || '추가 실패', 'error'); return; }
      applyUpdatedCase(res.case);
    }catch(err){ showToast('추가 중 오류가 발생했습니다.', 'error'); }
  }

  async function updateWorkSubtask(caseId, nodeId, fields){
    try{
      const res = await callGas('work_update_subtask', Object.assign({ id: caseId, nodeId }, fields));
      if (res.error || res.success === false){ showToast(res.error || res.message || '수정 실패', 'error'); return; }
      applyUpdatedCase(res.case);
    }catch(err){ showToast('수정 중 오류가 발생했습니다.', 'error'); }
  }

  async function deleteWorkSubtask(caseId, nodeId){
    try{
      const res = await callGas('work_delete_subtask', { id: caseId, nodeId });
      if (res.error || res.success === false){ showToast(res.error || res.message || '삭제 실패', 'error'); return; }
      applyUpdatedCase(res.case);
    }catch(err){ showToast('삭제 중 오류가 발생했습니다.', 'error'); }
  }

document.getElementById('btnOpenWorkManage').addEventListener('click', openWorkManageView);
document.getElementById('btnWorkManageBack').addEventListener('click', closeWorkManageView);
document.getElementById('btnWorkCaseNew').addEventListener('click', renderNewCaseForm);
workCaseFilterStatus.addEventListener('change', renderWorkCaseList);
