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
  const WORK_STATUS_OPTIONS = ['진행', '보류', '완료'];
  // 하위업무(할일)는 "아직 시작 전"이 사건 상태보다 더 자주 필요해서 대기를 남겨둔다.
  const WORK_SUBTASK_STATUS_OPTIONS = ['대기', '진행', '보류', '완료'];
  // [2026.08] 신고 업무만 다루는 게 아니라 상담·불복도 다루므로, 세목 옆에 업무유형을 추가했다.
  // 세목이 양도/증여/상속이면 신고/상담 중 하나, 불복이면 그 세부유형(이의신청 등)을 고른다.
  // gs-backend/Code.js의 WORK_DEADLINE_DAYS_/YEARS_/MANUAL_DEADLINE_TYPES_와 항상 맞춰야 한다.
  const WORK_UPTYPE_OPTIONS_ = {
    transfer: ['신고', '상담'],
    gift: ['신고', '상담'],
    inheritance: ['신고', '상담'],
    objection: ['이의신청', '심사청구', '심판청구', '행정소송', '경정청구', '과세적부', '해명자료']
  };
  // 법정기한이 정해져 있지 않아 서버가 자동계산하지 않는 업무유형 — 사용자가 직접 처리시한을
  // 입력한다(기본값: 의뢰일 + 7일).
  const WORK_MANUAL_DEADLINE_TYPES_ = ['상담', '해명자료'];

  function workDeadlineFieldLabel_(upType){
    return WORK_MANUAL_DEADLINE_TYPES_.indexOf(upType) !== -1 ? '처리시한' : '법정일';
  }

  function workDefaultManualDeadline_(requestDateStr){
    const base = requestDateStr ? new Date(requestDateStr + 'T00:00:00') : new Date();
    if (isNaN(base.getTime())) return '';
    base.setDate(base.getDate() + 7);
    // [주의] toISOString()은 UTC로 바꿔서 자르므로 한국시간(UTC+9)에서는 하루 밀릴 수 있다
    // (이 세션에서 이미 한 번 겪은 실수) — 로컬 날짜 그대로 문자열을 만든다.
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

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
      const noDeadlineText = workDeadlineFieldLabel_(c.업무유형) === '처리시한' ? '시한없음' : '기한없음';
      row.innerHTML =
        '<div class="log-date">' + (overdue ? '<span style="color:#a83232;">⏰</span> ' : '') + escapeHtml(c.법정일 ? fmtDateShort_(c.법정일) : noDeadlineText) + '</div>' +
        '<div class="log-text"><b>' + escapeHtml(c.고객명 || '(고객명 없음)') + '</b> · ' + escapeHtml(c.사건명 || '') +
        '<br><span style="color:var(--sub); font-size:12px;">' + escapeHtml(WORK_SEMOK_LABELS[c.세목] || c.세목 || '') + (c.업무유형 ? ' · ' + escapeHtml(c.업무유형) : '') + ' · ' + escapeHtml(c.상태 || '') +
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
      '<label>고객명(의뢰인)<br><input type="text" id="wcNewCustomer" list="clientNameOptions" style="width:100%;" placeholder="고객명 (신규면 자동으로 고객관리에도 등록됩니다)"></label>' +
      '<label>납세자 <span style="color:var(--sub); font-weight:400;">(의뢰인과 다른 경우만 입력)</span><br><input type="text" id="wcNewTaxpayer" style="width:100%;" placeholder="(선택) 의뢰인과 같으면 비워두세요"></label>' +
      '<label>사건명<br><input type="text" id="wcNewCase" style="width:100%;" placeholder="예: 2026년 양도소득세 신고"></label>' +
      '<label>세목<br><select id="wcNewSemok" style="width:100%;">' +
        Object.keys(WORK_SEMOK_LABELS).map(k => '<option value="' + k + '">' + WORK_SEMOK_LABELS[k] + '</option>').join('') +
      '</select></label>' +
      '<label>업무유형<br><select id="wcNewUptype" style="width:100%;"></select></label>' +
      '<label>담당자<br><input type="text" id="wcNewAssignee" style="width:100%;" placeholder="(선택)"></label>' +
      '<label>의뢰일<br><input type="date" id="wcNewRequestDate" style="width:100%;"></label>' +
      '<label>기준일 <span id="wcNewBaseDateHint" style="color:var(--sub); font-weight:400;">(양도일·증여일·사망일 등)</span><br><input type="date" id="wcNewBaseDate" style="width:100%;"></label>' +
      '<label id="wcNewManualDeadlineLabel" style="display:none;"><span id="wcNewManualDeadlineText">처리시한</span><br><input type="date" id="wcNewManualDeadline" style="width:100%;"></label>' +
      '<div style="display:flex; gap:8px; margin-top:8px;">' +
      '<button type="button" id="wcNewSave" class="save-btn">저장</button>' +
      '<button type="button" id="wcNewCancel" class="ghost-btn">취소</button>' +
      '</div></div>';

    const newSemokSel = document.getElementById('wcNewSemok');
    const newUptypeSel = document.getElementById('wcNewUptype');

    function refillNewUptype(){
      const options = WORK_UPTYPE_OPTIONS_[newSemokSel.value] || [];
      newUptypeSel.innerHTML = options.map(u => '<option value="' + u + '">' + u + '</option>').join('');
      onNewUptypeChange();
    }
    function onNewUptypeChange(){
      const manual = WORK_MANUAL_DEADLINE_TYPES_.indexOf(newUptypeSel.value) !== -1;
      document.getElementById('wcNewBaseDateHint').textContent = newSemokSel.value === 'objection' ? '(고지서 수령일 등 기산일)' : '(양도일·증여일·사망일 등)';
      const manualLabel = document.getElementById('wcNewManualDeadlineLabel');
      manualLabel.style.display = manual ? '' : 'none';
      if (manual){
        document.getElementById('wcNewManualDeadlineText').textContent = workDeadlineFieldLabel_(newUptypeSel.value);
        const deadlineInput = document.getElementById('wcNewManualDeadline');
        if (!deadlineInput.value) deadlineInput.value = workDefaultManualDeadline_(document.getElementById('wcNewRequestDate').value);
      }
    }
    newSemokSel.addEventListener('change', refillNewUptype);
    newUptypeSel.addEventListener('change', onNewUptypeChange);
    refillNewUptype();

    document.getElementById('wcNewCancel').addEventListener('click', () => {
      workShowingNewForm = false;
      workCaseDetail.innerHTML = '<div class="explorer-status">왼쪽에서 사건을 선택하거나 "+ 새 사건"을 눌러주세요.</div>';
    });
    document.getElementById('wcNewSave').addEventListener('click', async () => {
      const 고객명 = document.getElementById('wcNewCustomer').value.trim();
      const 사건명 = document.getElementById('wcNewCase').value.trim();
      if (!고객명 || !사건명){ showToast('고객명과 사건명을 입력해주세요.', 'warning'); return; }
      const upType = newUptypeSel.value;
      const manual = WORK_MANUAL_DEADLINE_TYPES_.indexOf(upType) !== -1;
      const payload = {
        고객명, 사건명,
        납세자: document.getElementById('wcNewTaxpayer').value.trim(),
        세목: newSemokSel.value,
        업무유형: upType,
        담당자: document.getElementById('wcNewAssignee').value.trim(),
        의뢰일: document.getElementById('wcNewRequestDate').value,
        기준일: document.getElementById('wcNewBaseDate').value
      };
      if (manual) payload.법정일 = document.getElementById('wcNewManualDeadline').value;
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
    const isManual = WORK_MANUAL_DEADLINE_TYPES_.indexOf(c.업무유형) !== -1;
    workCaseDetail.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
      '<div style="display:flex; gap:6px; flex-wrap:wrap; flex:1; min-width:0;">' +
      '<input type="text" id="wcEditCustomerName" placeholder="고객명" value="' + escapeHtml(c.고객명 || '') + '" style="font-weight:700; font-size:15px; width:120px;">' +
      '<button type="button" id="wcViewCustomer" class="ghost-btn" title="이 고객 정보 빠르게 보기·수정" style="padding:4px 8px;">👤</button>' +
      '<input type="text" id="wcEditTaxpayer" placeholder="납세자(의뢰인과 다르면 입력)" value="' + escapeHtml(c.납세자 || '') + '" style="width:140px;">' +
      '<input type="text" id="wcEditCaseName" placeholder="사건명" value="' + escapeHtml(c.사건명 || '') + '" style="font-weight:700; font-size:15px; width:160px;">' +
      '</div>' +
      '<button type="button" id="wcDeleteCase" class="ghost-btn" title="삭제">🗑 삭제</button>' +
      '</div>' +
      '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:12px; margin-top:8px;">' +
      '<select id="wcEditSemok">' + Object.keys(WORK_SEMOK_LABELS).map(k => '<option value="' + k + '"' + (k === c.세목 ? ' selected' : '') + '>' + WORK_SEMOK_LABELS[k] + '</option>').join('') + '</select>' +
      '<select id="wcEditUptype"></select>' +
      '<input type="text" id="wcEditAssignee" placeholder="담당자" value="' + escapeHtml(c.담당자 || '') + '" style="width:100px;">' +
      '<label style="font-size:12px; color:var(--sub);">의뢰일 <input type="date" id="wcEditRequestDate" value="' + escapeHtml(c.의뢰일 || '') + '"></label>' +
      '<label style="font-size:12px; color:var(--sub);">기준일 <input type="date" id="wcEditBaseDate" value="' + escapeHtml(c.기준일 || '') + '"></label>' +
      '<select id="wcEditStatus">' + WORK_STATUS_OPTIONS.map(s => '<option value="' + s + '"' + (s === c.상태 ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
      '<button type="button" id="wcSaveCase" class="ghost-btn">저장</button>' +
      '</div>' +
      '<div style="margin-bottom:12px;">' +
      '<span id="wcEditDeadlineAuto" style="display:' + (isManual ? 'none' : 'inline-block') + '; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 10px; font-size:12.5px; color:var(--sub);">' + workDeadlineFieldLabel_(c.업무유형) + ': <b style="color:var(--navy);">' + (c.법정일 ? escapeHtml(fmtDateShort_(c.법정일)) : '(기준일을 입력하면 자동 계산)') + '</b></span>' +
      '<label id="wcEditManualDeadlineLabel" style="display:' + (isManual ? 'inline-block' : 'none') + '; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:4px 10px; font-size:12.5px; color:var(--sub);"><span id="wcEditManualDeadlineText">처리시한</span> <input type="date" id="wcEditManualDeadline" value="' + escapeHtml(c.법정일 || '') + '"></label>' +
      '</div>' +
      '<div id="wcAddRootToggle" style="font-size:12.5px; color:var(--sub); margin-bottom:8px; cursor:pointer; width:fit-content;" title="눌러서 새 하위업무 추가">➕ 하위업무 ' + prog.done + ' / ' + prog.total + '</div>' +
      '<div id="wcNewRootFormWrap" style="display:none; gap:6px; margin-bottom:10px; flex-wrap:wrap;"></div>' +
      '<div id="wcTree"></div>';

    renderWorkTree(c.하위업무 || [], document.getElementById('wcTree'), c.id, 0);

    // [2026.08] 예전엔 항상 빈 입력칸(제목·마감일)이 트리 밑에 미리 깔려 있었는데, 사건에
    // 하위업무가 아직 없을 때조차 늘 보여서 번잡했다 — 처음엔 별도 "+ 추가" 버튼을 눌러야
    // 나타나게 했다가, 그 버튼도 없애고 "하위업무" 표시 자체를 누르면 입력칸이 나타나게
    // 한 번 더 단순화했다(제목 표시와 추가 트리거를 하나로 통합).
    const newRootFormWrap = document.getElementById('wcNewRootFormWrap');
    document.getElementById('wcAddRootToggle').addEventListener('click', () => {
      if (newRootFormWrap.style.display === 'none'){
        newRootFormWrap.style.display = 'flex';
        newRootFormWrap.innerHTML =
          '<input type="text" id="wcNewRootTitle" placeholder="새 하위업무 (예: 자료수집)" style="flex:1; min-width:160px;">' +
          '<input type="date" id="wcNewRootDue" title="마감일(선택)">' +
          '<button type="button" id="wcAddRoot" class="save-btn">추가</button>' +
          '<button type="button" id="wcAddRootCancel" class="ghost-btn">취소</button>';
        document.getElementById('wcAddRootCancel').addEventListener('click', () => { newRootFormWrap.style.display = 'none'; newRootFormWrap.innerHTML = ''; });
        document.getElementById('wcAddRoot').addEventListener('click', () => {
          const t = document.getElementById('wcNewRootTitle').value.trim();
          if (!t){ showToast('항목 이름을 입력해주세요.', 'warning'); return; }
          addWorkSubtask(c.id, null, t, document.getElementById('wcNewRootDue').value);
        });
      } else {
        newRootFormWrap.style.display = 'none';
        newRootFormWrap.innerHTML = '';
      }
    });

    document.getElementById('wcViewCustomer').addEventListener('click', () => openClientQuickView_(c.고객ID));

    const editSemokSel = document.getElementById('wcEditSemok');
    const editUptypeSel = document.getElementById('wcEditUptype');

    // 신고처럼 자동계산되던 업무유형에서 상담·해명자료(수동입력)로 바꾸면, 처리시한 입력칸에
    // "그때 자동계산됐던 옛 법정일"이 이미 들어가 있어서(값이 비어있지 않으니) 새 기본값으로
    // 안 갈아끼워지고 그대로 고정돼 보이는 문제가 있었다. 그 값은 상담·해명자료와는 무관한
    // 옛 신고 법정일이므로, "자동계산 유형에서 방금 넘어온 경우"에만 새 기본값으로 갈아끼우고
    // (상담↔해명자료처럼 수동유형끼리 왔다갔다 할 때는 사용자가 손댄 값을 그대로 둔다).
    let editUptypePrevWasManual = WORK_MANUAL_DEADLINE_TYPES_.indexOf(c.업무유형) !== -1;
    function refillEditUptype(keepCurrent){
      const options = WORK_UPTYPE_OPTIONS_[editSemokSel.value] || [];
      const current = keepCurrent && options.indexOf(c.업무유형) !== -1 ? c.업무유형 : options[0];
      editUptypeSel.innerHTML = options.map(u => '<option value="' + u + '"' + (u === current ? ' selected' : '') + '>' + u + '</option>').join('');
      onEditUptypeChange();
    }
    function onEditUptypeChange(){
      const manual = WORK_MANUAL_DEADLINE_TYPES_.indexOf(editUptypeSel.value) !== -1;
      document.getElementById('wcEditDeadlineAuto').style.display = manual ? 'none' : 'inline-block';
      document.getElementById('wcEditManualDeadlineLabel').style.display = manual ? 'inline-block' : 'none';
      if (manual){
        document.getElementById('wcEditManualDeadlineText').textContent = workDeadlineFieldLabel_(editUptypeSel.value);
        const deadlineInput = document.getElementById('wcEditManualDeadline');
        if (!editUptypePrevWasManual || !deadlineInput.value) deadlineInput.value = workDefaultManualDeadline_(document.getElementById('wcEditRequestDate').value);
      }
      editUptypePrevWasManual = manual;
    }
    editSemokSel.addEventListener('change', () => refillEditUptype(false));
    editUptypeSel.addEventListener('change', onEditUptypeChange);
    refillEditUptype(true);

    document.getElementById('wcSaveCase').addEventListener('click', async () => {
      const customerName = document.getElementById('wcEditCustomerName').value.trim();
      const caseName = document.getElementById('wcEditCaseName').value.trim();
      if (!customerName || !caseName){ showToast('고객명과 사건명은 비워둘 수 없습니다.', 'warning'); return; }
      const upType = editUptypeSel.value;
      const manual = WORK_MANUAL_DEADLINE_TYPES_.indexOf(upType) !== -1;
      const payload = {
        id: c.id,
        고객명: customerName,
        사건명: caseName,
        납세자: document.getElementById('wcEditTaxpayer').value.trim(),
        세목: editSemokSel.value,
        업무유형: upType,
        담당자: document.getElementById('wcEditAssignee').value.trim(),
        의뢰일: document.getElementById('wcEditRequestDate').value,
        기준일: document.getElementById('wcEditBaseDate').value,
        상태: document.getElementById('wcEditStatus').value
      };
      if (manual) payload.법정일 = document.getElementById('wcEditManualDeadline').value;
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
  }

  function renderWorkTree(nodes, container, caseId, depth){
    container.innerHTML = '';
    if (!nodes.length && depth === 0) return;
    nodes.forEach(node => {
      const row = document.createElement('div');
      row.style.marginLeft = (depth * 20) + 'px';
      row.style.borderLeft = depth ? '2px solid var(--line)' : 'none';
      row.style.padding = '4px 0 4px 8px';
      const overdue = node.dueDate && node.dueDate < new Date().toISOString().slice(0, 10) && node.status !== '완료';
      row.innerHTML =
        '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px;">' +
        '<select class="wcNodeStatus" style="font-size:12px;">' + WORK_SUBTASK_STATUS_OPTIONS.map(s => '<option value="' + s + '"' + (s === node.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
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

  async function addWorkSubtask(caseId, parentId, title, dueDate){
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

// [2026.08] 지시: 작업관리는 탐색창(같은 화면 안 패널 전환) 대신 항상 새 창으로 연다 —
// 고객관리와 동시에 두 창을 띄워놓고 나란히 작업할 일이 있어서. 실제 창 열기는 core.js의
// openStandaloneManageWindow_()로 통일했다 — 채팅창의 "도구" 팝업 메뉴에서도 같은 화면을
// 여는데 그쪽은 안 고치고 여기만 고쳤다가 "여전히 안 된다"는 지적을 받은 적이 있다
// (chat.js의 WORK_TOOLS 참고). 고객 한 명만 빠르게 보고 싶을 땐 이 창을 새로 열 필요 없이
// 사건 상세화면의 고객명 옆 👤 버튼으로 바로 확인·수정할 수 있다(client-manage.js의
// openClientQuickView_ 참고).
document.getElementById('btnOpenWorkManage').addEventListener('click', () => {
  openStandaloneManageWindow_('workmanage');
});
document.getElementById('btnWorkManageBack').addEventListener('click', closeWorkManageView);
document.getElementById('btnWorkCaseNew').addEventListener('click', renderNewCaseForm);
workCaseFilterStatus.addEventListener('change', renderWorkCaseList);
