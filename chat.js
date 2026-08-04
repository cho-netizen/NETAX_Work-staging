
  // ============================================================
  // 고객/사건 선택 로딩
  // ============================================================
  async function loadCustomers(){
    setSelectOptions(customerSelect, [], '고객 불러오는 중…');
    try{
      const data = await listFolder(); // 인자 없이 호출 = "디폴트(현재 작업대상) 폴더를 열어줘"
      basePath = data.path; // 디폴트 폴더의 실제 위치 (참 루트 기준)
      const names = data.folders.map(f => f.name);
      setSelectOptions(customerSelect, names, '고객 폴더 없음');
      if (names.length){
        customerSelect.value = names[0];
        await navigateTo(basePath.concat([names[0]]));
      } else {
        showExplorerStatus('고객 폴더가 없습니다.');
      }
    }catch(err){
      setSelectOptions(customerSelect, [], '불러오기 실패');
      showExplorerStatus('고객 목록을 불러오지 못했습니다: ' + err.message, true);
    }
  }

  customerSelect.addEventListener('change', ()=>{
    const val = customerSelect.value.trim();
    if (val && currentCustomerNames.includes(val)) navigateTo(basePath.concat([val]));
  });

  loadCustomers();


  // ---- 좁은 화면(PC/탭, grouped 단계)용 도구 그룹 팝업 — 도구1/도구2 2그룹 ----
  const TOOL_GROUP_1 = [
    { icon: '🔍', label: '검색', handler: openSearchView },
    { icon: '🗑', label: '휴지통', handler: openTrashView },
    { icon: '📊', label: '현황판', handler: openDashboardView }
  ];
  const TOOL_GROUP_2 = [
    { icon: '📝', label: '경과지', handler: openLogView },
    { icon: '🧮', label: '계산기', handler: openCalcView },
    { icon: '🕸', label: '관계도', handler: openDiagramView },
    { icon: '📷', label: '스캔', handler: openScanModal },
    { icon: '📊', label: '엑셀 열기', handler: () => window.openExcelViewer() }
  ];

  // ---- 폰(compact 단계) 전용 하단 도구 5그룹 — 기능이 비슷한 것끼리 2개씩 묶음 ----
  const MOBILE_GROUP_FILES = [
    { icon: '🔍', label: '검색', handler: openSearchView },
    { icon: '🗑', label: '휴지통', handler: openTrashView }
  ];
  const MOBILE_GROUP_RECORDS = [
    { icon: '📊', label: '현황판', handler: openDashboardView },
    { icon: '📝', label: '경과지', handler: openLogView }
  ];
  const MOBILE_GROUP_ANALYSIS = [
    { icon: '🧮', label: '계산기', handler: openCalcView },
    { icon: '🕸', label: '관계도', handler: openDiagramView }
  ];
  const MOBILE_GROUP_CONFIG = [
    { icon: '📷', label: '스캔', handler: openScanModal },
    { icon: '📊', label: '엑셀 열기', handler: () => window.openExcelViewer() }
  ];

  function fillToolPopup(popupEl, items){
    popupEl.innerHTML = '';
    items.forEach(item=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-menu-item';
      btn.textContent = item.icon + ' ' + item.label;
      btn.addEventListener('click', ()=>{
        popupEl.classList.remove('show');
        item.handler();
      });
      popupEl.appendChild(btn);
    });
  }

  const toolGroup1Wrap = document.getElementById('toolGroup1Wrap');
  const toolGroup2Wrap = document.getElementById('toolGroup2Wrap');
  const btnToolGroup1 = document.getElementById('btnToolGroup1');
  const btnToolGroup2 = document.getElementById('btnToolGroup2');
  const toolGroup1Popup = document.getElementById('toolGroup1Popup');
  const toolGroup2Popup = document.getElementById('toolGroup2Popup');

  const mgFilesBtn = document.getElementById('btnMgFiles');
  const mgRecordsBtn = document.getElementById('btnMgRecords');
  const mgAnalysisBtn = document.getElementById('btnMgAnalysis');
  const mgConfigBtn = document.getElementById('btnMgConfig');
  const mgFilesPopup = document.getElementById('mgFilesPopup');
  const mgRecordsPopup = document.getElementById('mgRecordsPopup');
  const mgAnalysisPopup = document.getElementById('mgAnalysisPopup');
  const mgConfigPopup = document.getElementById('mgConfigPopup');

  fillToolPopup(toolGroup1Popup, TOOL_GROUP_1);
  fillToolPopup(toolGroup2Popup, TOOL_GROUP_2);
  fillToolPopup(mgFilesPopup, MOBILE_GROUP_FILES);
  fillToolPopup(mgRecordsPopup, MOBILE_GROUP_RECORDS);
  fillToolPopup(mgAnalysisPopup, MOBILE_GROUP_ANALYSIS);
  fillToolPopup(mgConfigPopup, MOBILE_GROUP_CONFIG);

  const ALL_GROUP_POPUPS = [
    [toolGroup1Popup, btnToolGroup1], [toolGroup2Popup, btnToolGroup2],
    [mgFilesPopup, mgFilesBtn], [mgRecordsPopup, mgRecordsBtn], [mgAnalysisPopup, mgAnalysisBtn],
    [mgConfigPopup, mgConfigBtn]
  ];

  function wireGroupToggle(btn, popup){
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      ALL_GROUP_POPUPS.forEach(([p]) => { if (p !== popup) p.classList.remove('show'); });
      popup.classList.toggle('show');
    });
  }
  ALL_GROUP_POPUPS.forEach(([popup, btn]) => wireGroupToggle(btn, popup));
  document.addEventListener('click', (e)=>{
    ALL_GROUP_POPUPS.forEach(([popup, btn])=>{
      if (popup.classList.contains('show') && !popup.contains(e.target) && e.target !== btn) popup.classList.remove('show');
    });
  });

  // ============================================================
  // 상단바 반응형 — "화면폭이 몇 px면"이 아니라 "지금 이 내용이 실제로 한 줄에 들어가는가"를
  // 재서 단계를 정한다. 순서: ① 다 펼친 상태(full)가 들어가면 그대로 ② 안 들어가면 그룹으로
  // 접은 상태(grouped)를 재본다 ③ 그것도 안 들어가면 라벨 없애고 균등폭으로 압축(compact).
  // compact 안에서는 버튼이 그래도 너무 좁아지면(높이의 1.3배 미만) 도구1+도구2를 합치고,
  // compact로 판정된 순간에만 이 버튼들을 화면 하단으로 옮긴다(폰에서 엄지로 누르기 편하게).
  // ============================================================
  // 자동 감지가 잘 안 맞는 기기를 위한 수동 지정(설정 모달의 "화면 배치 기준") — 'auto'면 예전처럼
  // 실측해서 정하고, 그 외에는 무조건 그 단계로 고정한다.
  let deviceOverride = localStorage.getItem('nx_device_override') || 'auto';

  (function setupTopbarResponsive(){
    const topbarEl = document.querySelector('.topbar');
    const bodyEl = document.body;
    const cluster = document.getElementById('topbarActionCluster');
    // 플립폰 커버화면처럼 아주 작은 폰 판정 기준(가로 px). 실기기 실측 결과 커버화면 352px,
    // 펼친 상태 세로모드 360px로 확인되어(2026.07), 그 사이 값인 356으로 조정함.
    const COVER_MODE_MAX_WIDTH = 356;
    let wasCover = false; // 커버화면모드 여부가 "바뀔 때만" 이벤트를 쏘기 위한 이전 상태 기억
    // max-height 트랜지션이 끝나는 순간에도 한 번 더 정확히 재서, setTimeout 타이밍이
    // 살짝 어긋나는 경우(기기 성능 편차 등)까지 이중으로 보정한다.
    cluster.addEventListener('transitionend', (e)=>{
      if (e.propertyName === 'max-height') updateBottombarHeightVar();
    });

    // 지금 stage를 candidateStage로 잠깐 바꿔서(화면엔 안 그려짐 — 아래 설명 참고) 그 상태로
    // 한 줄로 쭉 펼쳤을 때 실제로 몇 px가 필요한지(scrollWidth)를 재고 원래 상태로 되돌린다.
    // 2026.07: 되돌리는 줄이 try/finally 밖에 있으면, 이 사이에서 예외가 나거나(측정 도중 DOM이
    // 바뀌는 등) 화면분할처럼 리사이즈가 짧은 시간에 몰아치는 상황에서 "원상복구가 스킵된 채
    // 남는" 사고가 날 수 있다고 보고 finally로 감쌌다(화면분할 중 버튼이 잠깐 살아나 보이던
    // 문제의 유력한 원인).
    function measureRequiredWidth(candidateStage){
      const prevBodyClass = bodyEl.className;
      try {
        bodyEl.className = prevBodyClass.replace(/\bstage-\S+/g, '').trim() + ' stage-' + candidateStage;
        topbarEl.classList.add('measuring'); // 이 순간만 줄바꿈을 강제로 꺼서 "진짜 필요한 폭"을 잼
        return topbarEl.scrollWidth;
      } finally {
        topbarEl.classList.remove('measuring');
        bodyEl.className = prevBodyClass; // 예외가 나든 안 나든 반드시 원상복구
      }
    }

    function resolveStage(){
      if (deviceOverride === 'pc') return 'full';
      if (deviceOverride === 'tablet') return 'grouped';
      if (deviceOverride === 'phone') return 'compact';
      const available = topbarEl.clientWidth - 4; // 스크롤바 등 오차 여유
      if (measureRequiredWidth('full') <= available) return 'full';
      if (measureRequiredWidth('grouped') <= available) return 'grouped';
      return 'compact'; // 마지막 단계는 flex:1이 알아서 맞춰주므로 항상 채택
    }

    // compact(폰) 단계에서, 상단 모드버튼 4개(탐색작업창·자동참조·웹서치·가져오기)에 글자
    // 라벨을 붙일 여유가 있는지 실측한다 — 화면이 넓은 폰(가로모드 등)이면 라벨을 보여주고,
    // 좁으면 아이콘만 남긴다. 고정폭 기준이 아니라 "customerSelect+이 4버튼이 실제로 한 줄에
    // 들어가는지"를 매번 재서 판단하므로, 항상 지금 화면에 맞는 가장 넉넉한 크기가 나온다.
    let modeButtonsLabeled = false;
    function updateModeButtonsLabeled(){
      if (currentStage !== 'compact'){
        if (modeButtonsLabeled){ modeButtonsLabeled = false; bodyEl.classList.remove('mode-buttons-labeled'); }
        return;
      }
      const prevBodyClass = bodyEl.className;
      let required;
      try {
        bodyEl.className = prevBodyClass.includes('mode-buttons-labeled')
          ? prevBodyClass
          : prevBodyClass + ' mode-buttons-labeled';
        topbarEl.classList.add('measuring');
        required = topbarEl.scrollWidth;
      } finally {
        topbarEl.classList.remove('measuring');
        bodyEl.className = prevBodyClass; // 예외가 나든 안 나든 반드시 원상복구
      }

      const fits = required <= topbarEl.clientWidth - 4;
      if (fits !== modeButtonsLabeled){
        modeButtonsLabeled = fits;
        bodyEl.classList.toggle('mode-buttons-labeled', fits);
      }
    }

    // compact일 때 #topbarActionCluster가 화면 아래 고정으로 떠 있는 만큼, 그 높이를 실측해서
    // .workspace의 padding-bottom으로 넣어준다. 버퍼를 아예 없앴더니(0) 이번엔 너무 붙어
    // 보인다는 피드백이 있어서, 살짝만(4px) 여유를 둔다 — 이전(8px)보다는 좁고 0보다는 넓게.
    function updateBottombarHeightVar(){
      if (bodyEl.classList.contains('stage-compact') && !bodyEl.classList.contains('bottombar-hidden')){
        document.documentElement.style.setProperty('--bottombar-h', (cluster.getBoundingClientRect().height + 4) + 'px');
      } else {
        document.documentElement.style.setProperty('--bottombar-h', '0px');
      }
    }

    // 상단바 실제 높이도 실측해서 --topbar-h로 넣어준다 — "띄우기" 모드의 탐색기 패널처럼
    // position:fixed로 뜨는 것들이 막연히 "화면의 6%" 같은 값 대신 실제 상단바 높이만큼
    // 정확히 비켜서 그려지도록 하기 위함 (안 그러면 버튼이 상단바 뒤에 가려질 수 있음).
    function updateTopbarHeightVar(){
      document.documentElement.style.setProperty('--topbar-h', topbarEl.getBoundingClientRect().height + 'px');
    }

    let currentStage = null;
    function update(){
      const stage = resolveStage();
      if (stage !== currentStage){
        currentStage = stage;
        bodyEl.className = bodyEl.className.replace(/\bstage-\S+/g, '').trim() + ' stage-' + stage;
      }
      updateModeButtonsLabeled();
      updateBottombarHeightVar();
      updateTopbarHeightVar();

      // 커버화면모드(아주 작은 폰) 판정 — compact 단계 안에서, 그보다도 더 좁을 때만.
      // 순수 CSS 클래스 토글이라 다른 변수에 의존하지 않는다(음성모드 쪽은 아직 스크립트
      // 뒤쪽에서 초기화되기 전일 수 있어서, 직접 호출하지 않고 상태가 "바뀔 때만" 커스텀
      // 이벤트로 알려준다 — 음성모드 섹션이 자기 준비가 끝난 뒤 그 이벤트를 받아 처리함).
      const cover = (stage === 'compact') && window.innerWidth <= COVER_MODE_MAX_WIDTH;
      bodyEl.classList.toggle('cover-mode', cover);
      if (cover !== wasCover){
        wasCover = cover;
        document.dispatchEvent(new CustomEvent('nx:covermode', { detail: { on: cover } }));
      }
    }

    let rafPending = false;
    let debounceTimer = null;
    let __updateCallCount = 0;
    // 2026.07: 예전엔 리사이즈가 일어날 때마다 곧바로(rAF 한 프레임 뒤) 측정했는데, 화면분할처럼
    // 리사이즈 이벤트가 아주 짧은 시간에 여러 번 몰아치는 상황에서는 측정(임시 클래스 교체)이
    // 서로 겹칠 위험이 있었다(화면분할 중 버튼이 잠깐 살아나 보이던 문제의 유력한 원인 중 하나).
    // 그래서 리사이즈가 잠깐이라도 멈출 때까지(120ms) 기다렸다가 딱 한 번만 재도록 바꿨다.
    function scheduleUpdate(){
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(()=>{
        debounceTimer = null;
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(()=>{ rafPending = false; __updateCallCount++; update(); });
      }, 120);
    }

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleUpdate).observe(topbarEl);
    window.addEventListener('resize', scheduleUpdate);
    update(); // 초기 1회

    // 설정 모달의 "화면 배치 기준"에서 값을 바꾸면 이 함수로 즉시 재평가한다
    // (scheduleUpdate/update는 이 IIFE 안에 갇혀 있어서, 밖에서 부를 수 있게 전역에 걸어둔다).
    window.nxApplyDeviceOverride = function(value){
      deviceOverride = value;
      localStorage.setItem('nx_device_override', value);
      scheduleUpdate();
    };

    // (2026.07) 예전엔 메시지 입력창에 포커스가 가 있는 동안 하단 고정바를 접어서 공간을
    // 채팅에 돌려주려 했는데, 그 접혔다 펴지는 전환 자체가 하단바 버튼(🔮·⚖·➤ 등) 클릭을
    // 자꾸 씹어먹는 문제(포커스 이탈 → 하단바 재전개 → 그 사이 첫 클릭 무반응)를 일으켜서,
    // 이 동작 자체를 없앴다 — 이제 하단바는 입력창 포커스 여부와 무관하게 항상 고정된 자리에 있다.

  })();


  // ============================================================
  // 자동참조 (ON: AI가 알아서 판단해 폴더/파일을 읽음 / OFF: 명시적으로 요청했을 때만) — 상단 🔗자동참조 버튼으로 관리
  // ============================================================
  const AUTOREF_KEY = 'nx_autoref_mode';
  let autoRefMode = localStorage.getItem(AUTOREF_KEY) === '1';

  // 다크모드 체크박스 — 저장 버튼 안 기다리고 체크하는 즉시 바로 적용
  const settingsDarkMode = document.getElementById('settingsDarkMode');
  settingsDarkMode.addEventListener('change', ()=>{
    applyDarkMode(settingsDarkMode.checked);
    localStorage.setItem(DARK_MODE_KEY, settingsDarkMode.checked ? '1' : '0');
  });

  // 화면 배치 기준(자동/PC/태블릿/폰 수동 지정) — 반응형 자동판정이 기기와 안 맞을 때 직접 고정.
  const settingsDeviceOverride = document.getElementById('settingsDeviceOverride');
  if (settingsDeviceOverride){
    settingsDeviceOverride.value = localStorage.getItem('nx_device_override') || 'auto';
    settingsDeviceOverride.addEventListener('change', ()=>{
      if (window.nxApplyDeviceOverride) window.nxApplyDeviceOverride(settingsDeviceOverride.value);
    });
  }

  // [2026.08] 파일/폴더 이동 — "이동" 버튼으로 선택 항목을 클립보드에 담아두고,
  // 원하는 폴더로 이동한 뒤 빈 공간 우클릭 메뉴의 "여기에 붙여넣기"로 실제 이동을 마무리한다.
  let nxMoveClipboard = null; // { items: [{id,type,name}], sourceLabel: string } | null
  document.getElementById('btnMoveSelected').addEventListener('click', ()=>{
    const items = Array.from(selectedItems.values());
    if (!items.length) return;
    nxMoveClipboard = { items: items, sourceLabel: explorerPath.join(' / ') || '최상위' };
    selectedItems.clear();
    refreshSelectionUi();
    showToast(items.length + '개 항목을 이동 대기 중입니다 — 원하는 폴더로 이동한 뒤, 빈 공간에서 우클릭 → "여기에 붙여넣기"를 눌러주세요.', 'info');
  });

  function pasteMoveClipboard(){
    if (!nxMoveClipboard || !nxMoveClipboard.items.length) return;
    const clip = nxMoveClipboard;
    nxMoveClipboard = null; // 먼저 비워서, 중간에 실패해도 같은 항목을 두 번 붙여넣는 사고를 막음
    (async () => {
      showToast(clip.items.length + '개 항목을 이동하는 중입니다…', 'info');
      const failed = [];
      for (const item of clip.items){
        try{
          const res = await callGas('moveItem', { id: item.id, type: item.type, targetPath: explorerPath });
          if (res.error) failed.push(item.name + ' (' + res.error + ')');
        }catch(err){
          failed.push(item.name + ' (' + (err && err.message ? err.message : err) + ')');
        }
      }
      navigateTo(explorerPath); // 이동 결과가 바로 반영되도록 새로고침
      if (failed.length) showToast('일부 이동 실패:\n' + failed.join('\n'), 'error');
      else showToast(clip.items.length + '개 항목을 이동했습니다.', 'success');
    })();
  }

  document.getElementById('btnAttachSelected').addEventListener('click', attachSelectedFiles);
  document.getElementById('btnClearSelected').addEventListener('click', ()=>{
    selectedItems.clear();
    refreshSelectionUi();
  });
  document.getElementById('btnDeleteSelected').addEventListener('click', async ()=>{
    const items = Array.from(selectedItems.values());
    if (!items.length) return;
    const names = items.map(i => (i.type === 'folder' ? '📁 ' : '📄 ') + i.name).join('\n');
    const ok = confirm('다음 ' + items.length + '개 항목을 휴지통으로 이동할까요? (구글드라이브 휴지통에서 복구 가능)\n\n' + names);
    if (!ok) return;

    const failed = [];
    for (const item of items){
      try{
        const res = await callGas('deleteItem', { id: item.id, type: item.type });
        if (res.error) failed.push(item.name + ' (' + res.error + ')');
      }catch(err){
        failed.push(item.name + ' (' + (err && err.message ? err.message : err) + ')');
      }
    }
    selectedItems.clear();
    refreshSelectionUi();
    navigateTo(explorerPath); // 삭제 결과가 바로 반영되도록 목록 새로고침
    if (failed.length) showToast('일부 삭제 실패:\n' + failed.join('\n'), 'error');
  });

  btnRenameSelected.addEventListener('click', async ()=>{
    const items = Array.from(selectedItems.values());
    if (items.length !== 1) return;
    const item = items[0];
    const newName = prompt('새 이름을 입력하세요', item.name);
    if (!newName || newName.trim() === '' || newName.trim() === item.name) return;
    try{
      const res = await callGas('renameItem', { id: item.id, type: item.type, newName: newName.trim() });
      if (res.error){ showToast('이름 변경 실패: ' + res.error, 'error'); return; }
      selectedItems.clear();
      refreshSelectionUi();
      navigateTo(explorerPath); // 바뀐 이름이 목록에 바로 보이도록 새로고침
    }catch(err){
      showToast('이름 변경 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  });

  // ---- 새 폴더 / 새 문서 만들기 (탐색기 상단, 경로표시줄 오른쪽 버튼 + 빈 공간 우클릭 메뉴에서 공용으로 씀) ----
  async function createNewFolder(){
    const name = prompt('새 폴더 이름을 입력하세요:');
    if (!name || !name.trim()) return;
    try{
      const res = await callGas('createFolder', { path: explorerPath, name: name.trim() });
      if (res.error){ showToast('폴더 만들기 실패: ' + res.error, 'error'); return; }
      navigateTo(explorerPath); // 새 폴더가 목록에 바로 보이도록 새로고침
    }catch(err){
      showToast('폴더 만들기 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }
  // [2026.08] 버튼(btnNewFolder)은 없앴고, 우클릭 메뉴(setupExplorerEmptyContextMenu)에서
  // 이 함수를 그대로 재사용한다.

  async function createNewDoc(){
    let name = prompt('새 문서 이름을 입력하세요 (확장자는 자동으로 .md가 붙습니다):');
    if (!name || !name.trim()) return;
    name = name.trim();
    if (!/\.md$/i.test(name)) name += '.md';
    try{
      const res = await callGas('uploadFile', {
        path: explorerPath, name: name, mimeType: 'text/markdown',
        base64Data: utf8ToBase64('# ' + name.replace(/\.md$/i, '') + '\n\n')
      });
      if (res.error){ showToast('문서 만들기 실패: ' + res.error, 'error'); return; }
      openEditor({ id: res.id, name: name, mimeType: 'text/markdown' }); // 만들자마자 바로 편집기로 열기
    }catch(err){
      showToast('문서 만들기 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }
  // [2026.08] 버튼(btnNewDoc)은 없앴고, 우클릭 메뉴에서 이 함수를 그대로 재사용한다.

  // ---- [2026.08] 탐색기 빈 공간 우클릭 → 브라우저 기본 메뉴 대신 새폴더/새문서 메뉴 ----
  // 파일/폴더 행(.file-row, .folder-row) 위에서 우클릭하면 브라우저 기본 메뉴 대신
  // 왼쪽 체크박스를 클릭한 것과 똑같이 선택/해제된다. 태블릿처럼 우클릭 자체가 없는
  // 기기에서도 그대로 쓸 수 있도록, 체크박스도 그대로 남겨둔다(우클릭은 데스크톱용 지름길).
  explorerBody.addEventListener('contextmenu', (e)=>{
    const onItem = e.target.closest('.file-row, .folder-row[data-item-id]');
    if (!onItem) return;
    e.preventDefault();
    const cb = onItem.querySelector('.file-check');
    if (cb){ cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  });

  // 컴퓨터에서 파일을 골라 지금 보고 있는 폴더에 그대로 올리는 숨김 입력 — 우클릭 메뉴의
  // "파일 업로드"에서 씀 (여러 개 한 번에 선택 가능).
  const nxUploadPickerInput = document.createElement('input');
  nxUploadPickerInput.type = 'file';
  nxUploadPickerInput.multiple = true;
  nxUploadPickerInput.style.display = 'none';
  document.body.appendChild(nxUploadPickerInput);
  nxUploadPickerInput.addEventListener('change', async ()=>{
    const files = Array.from(nxUploadPickerInput.files || []);
    nxUploadPickerInput.value = ''; // 같은 파일을 연달아 다시 선택해도 change가 또 뜨도록 초기화
    if (!files.length) return;
    showToast(files.length + '개 파일을 업로드하는 중입니다…', 'info');
    let okCount = 0, failCount = 0;
    for (const file of files){
      try{
        const buf = await file.arrayBuffer();
        const base64 = uint8ToBase64(new Uint8Array(buf));
        const res = await callGas('uploadFile', {
          path: explorerPath, name: file.name, mimeType: file.type || 'application/octet-stream',
          base64Data: base64
        });
        if (res.error) failCount++; else okCount++;
      }catch(err){ failCount++; }
    }
    navigateTo(explorerPath);
    if (failCount) showToast(okCount + '개 업로드 완료, ' + failCount + '개 실패했습니다.', failCount ? 'warning' : 'success');
    else showToast(okCount + '개 파일을 업로드했습니다.', 'success');
  });
  function triggerFileUpload(){ nxUploadPickerInput.click(); }

  // 정말 "빈 공간"에서 우클릭했을 때만 메뉴를 띄운다.
  (function setupExplorerEmptyContextMenu(){
    let menuEl = null;
    function closeMenu(){
      if (menuEl){ menuEl.remove(); menuEl = null; }
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    }
    explorerBody.addEventListener('contextmenu', (e)=>{
      const onItem = e.target.closest('.file-row, .folder-row');
      if (onItem) return; // 항목 위 우클릭은 위쪽의 별도 리스너가 체크박스 토글로 처리함
      e.preventDefault();
      closeMenu();

      menuEl = document.createElement('div');
      menuEl.style.cssText = 'position:fixed; z-index:5000; background:var(--panel); color:var(--ink);'
        + 'border:1px solid var(--line);'
        + 'border-radius:6px; box-shadow:0 4px 16px rgba(0,0,0,0.28); padding:4px; min-width:150px;'
        + 'font-size:13.5px; font-family:inherit;';
      const items = [
        { label: '📁 새 폴더 만들기', action: createNewFolder },
        { label: '📝 새 문서 만들기', action: createNewDoc },
        { label: '📤 파일 업로드', action: triggerFileUpload },
        { label: '🗑 휴지통 열기', action: openTrashView },
        { label: '🔄 새로고침', action: ()=>{ navigateTo(explorerPath); showToast('새로고침했습니다.', 'info'); } }
      ];
      if (nxMoveClipboard && nxMoveClipboard.items.length){
        items.push({ label: '📋 여기에 붙여넣기 (' + nxMoveClipboard.items.length + '개)', action: pasteMoveClipboard });
      }
      items.forEach(it=>{
        const row = document.createElement('div');
        row.textContent = it.label;
        row.style.cssText = 'padding:8px 12px; border-radius:4px; cursor:pointer; white-space:nowrap; color:var(--ink);';
        row.addEventListener('mouseenter', ()=> row.style.background = 'var(--bg)');
        row.addEventListener('mouseleave', ()=> row.style.background = '');
        row.addEventListener('click', ()=>{ closeMenu(); it.action(); });
        menuEl.appendChild(row);
      });
      document.body.appendChild(menuEl);

      // 메뉴가 화면 밖으로 안 나가도록 위치 보정
      const menuW = menuEl.offsetWidth, menuH = menuEl.offsetHeight;
      const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
      const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
      menuEl.style.left = x + 'px';
      menuEl.style.top = y + 'px';

      setTimeout(()=>{ // 지금 이 클릭(우클릭) 자체로 즉시 닫히지 않도록 한 틱 늦춰서 등록
        document.addEventListener('click', closeMenu);
        document.addEventListener('scroll', closeMenu, true);
      }, 0);
    });
  })();

  // [2026.08] 이 새로고침 버튼은 없앴다 — 같은 동작이 우클릭 메뉴의 "🔄 새로고침" 항목으로
  // 대체되었다(드라이브에서 직접 파일을 추가/삭제했거나 AI가 스스로 파일을 갱신했을 때 등,
  // 탐색기가 자동으로 알 수 없는 경우 수동으로 다시 불러오는 용도는 동일).

  // 공유 — 퀵쉐어(윈도우/안드로이드 OS 기능)는 웹사이트가 직접 지정할 수 없어서,
  // 대신 브라우저 표준 "공유하기"(Web Share API)를 띄운다. OS/기기가 지원하면 그 공유창 안에
  // 퀵쉐어·에어드롭 등이 옵션으로 나타날 수 있음 (지원 여부는 기기·브라우저에 따라 다름).
  btnShareSelected.addEventListener('click', async ()=>{
    const items = Array.from(selectedItems.values());
    if (items.length !== 1 || items[0].type === 'folder') return;
    const item = items[0];

    try{
      const data = await callGas('readFile', { fileId: item.id });
      if (data.error){ showToast('공유용으로 파일을 불러오지 못했습니다: ' + data.error, 'error'); return; }

      let blob;
      if (data.kind === 'binary' && data.base64){
        const bin = atob(data.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: data.mimeType || 'application/octet-stream' });
      } else {
        blob = new Blob([data.content || ''], { type: data.mimeType || 'text/plain' });
      }
      const file = new File([blob], data.name || item.name, { type: blob.type });

      if (navigator.canShare && navigator.canShare({ files: [file] })){
        await navigator.share({ files: [file], title: file.name });
      } else if (navigator.share){
        // 파일 공유 미지원 브라우저: 최소한 이름/링크라도 공유 시도
        await navigator.share({ title: item.name, text: item.name });
      } else {
        showToast('이 브라우저/기기는 공유 기능을 지원하지 않습니다. 대신 파일을 다운로드해서 직접 퀵쉐어로 보내주세요.', 'error');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = data.name || item.name; a.click();
        URL.revokeObjectURL(url);
      }
    }catch(err){
      if (err && err.name !== 'AbortError'){ // 사용자가 공유창을 그냥 닫은 경우는 에러로 안 띄움
        showToast('공유 중 오류: ' + (err && err.message ? err.message : err), 'error');
      }
    }
  });

  // ============================================================
  // AI 설정 (모델/강도/도구 등 — 예전 NX Assistant 화면에 있던 설정들을 여기로 이전)
  // ============================================================
  const AI_SETTINGS_KEY = 'nx_ai_settings';
  const DEFAULT_AI_SETTINGS = {
    model: 'claude-sonnet-5',
    effort: 'medium',
    temperature: null,          // null이면 요청에 아예 안 실어서 모델 기본값 사용
    maxTokens: null,            // null이면 강도(effort)별 기본 상한 사용
    enableWebSearch: true,  // 서버가 명시적으로 false를 안 보내면 항상 웹검색을 켜므로, 화면 기본 표시도 "켜짐"에 맞춘다.
                             // 이 버튼은 이제 "켜는 버튼"이 아니라 "끄는 버튼"이다 — 기본은 항상 노랗게(켜짐), 눌러야 회색(꺼짐)이 된다.
    enableWebFetch: false,
    enableCodeExecution: false,
    enableAdvisor: false,
    advisorModel: 'claude-opus-4-8',
    systemPrompt: ''            // 비어있으면 GAS의 DEFAULT_SYSTEM_PROMPT 사용
  };

  function loadAiSettings(){
    try{
      const raw = localStorage.getItem(AI_SETTINGS_KEY);
      if (raw){
        const parsed = JSON.parse(raw);
        // 웹서치 기본값이 false→true로 바뀌면서, 예전에 저장해둔 enableWebSearch:false가
        // 새 기본값(true)을 덮어써 버리면 오히려 "항상 꺼짐"으로 굳어버린다. 이걸 막기 위해
        // 딱 한 번, 예전 설정을 새 기본값으로 밀어준다(사용자가 이후에 버튼을 직접 눌러 끄면
        // 그 뒤로는 정상적으로 그 선택이 유지된다).
        const MIGRATION_FLAG = 'nx_websearch_default_migrated_v1';
        if (!localStorage.getItem(MIGRATION_FLAG)){
          delete parsed.enableWebSearch; // 있던 값 버리고 DEFAULT_AI_SETTINGS의 새 기본값(true)을 따르게 함
          localStorage.setItem(MIGRATION_FLAG, '1');
        }
        return Object.assign({}, DEFAULT_AI_SETTINGS, parsed);
      }
    }catch(err){ console.warn('AI 설정 로드 실패, 기본값 사용', err); }
    return Object.assign({}, DEFAULT_AI_SETTINGS);
  }

  let aiSettings = loadAiSettings();

  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsModel = document.getElementById('settingsModel');
  const settingsEffort = document.getElementById('settingsEffort');
  const settingsTemperature = document.getElementById('settingsTemperature');
  const settingsMaxTokens = document.getElementById('settingsMaxTokens');
  const settingsCodeExec = document.getElementById('settingsCodeExec');
  const settingsAdvisor = document.getElementById('settingsAdvisor');
  const advisorModelRow = document.getElementById('advisorModelRow');
  const settingsAdvisorModel = document.getElementById('settingsAdvisorModel');
  const settingsSystemPrompt = document.getElementById('settingsSystemPrompt');

  function populateSettingsForm(s){
    settingsModel.value = s.model;
    settingsEffort.value = s.effort;
    settingsTemperature.value = (s.temperature === null || s.temperature === undefined) ? '' : s.temperature;
    settingsMaxTokens.value = (s.maxTokens === null || s.maxTokens === undefined) ? '' : s.maxTokens;
    settingsCodeExec.checked = !!s.enableCodeExecution;
    settingsAdvisor.checked = !!s.enableAdvisor;
    settingsAdvisorModel.value = s.advisorModel;
    advisorModelRow.style.display = s.enableAdvisor ? 'block' : 'none';
    settingsSystemPrompt.value = s.systemPrompt || '';
  }

  function readSettingsForm(){
    const tempRaw = settingsTemperature.value.trim();
    const maxTokRaw = settingsMaxTokens.value.trim();
    return {
      model: settingsModel.value,
      effort: settingsEffort.value,
      temperature: tempRaw === '' ? null : Math.max(0, Math.min(1, Number(tempRaw))),
      maxTokens: maxTokRaw === '' ? null : Math.max(256, Math.min(64000, Math.floor(Number(maxTokRaw)))),
      // 웹서치·웹페이지가져오기는 이 폼이 아니라 상단 모드버튼(🌐🔗)이 직접 관리한다 —
      // 저장 시 이 폼이 덮어쓰지 않도록 지금 값을 그대로 유지한다.
      enableWebSearch: aiSettings.enableWebSearch,
      enableWebFetch: aiSettings.enableWebFetch,
      enableCodeExecution: settingsCodeExec.checked,
      enableAdvisor: settingsAdvisor.checked,
      advisorModel: settingsAdvisorModel.value,
      systemPrompt: settingsSystemPrompt.value.trim()
    };
  }


  function openSettingsModal(){
    populateSettingsForm(aiSettings);
    settingsDarkMode.checked = document.body.classList.contains('dark-mode');
    if (settingsDeviceOverride) settingsDeviceOverride.value = localStorage.getItem('nx_device_override') || 'auto';
    renderVoiceCommandSettings();
    settingsOverlay.style.display = 'flex';
  }
  // 닫는 방법(저장 버튼 / X 버튼 / 바깥 클릭)과 무관하게 항상 지금 폼 내용을 저장한다.
  // 예전엔 "저장" 버튼을 직접 눌러야만 저장되고, X나 바깥 클릭으로 닫으면 조용히 사라져서
  // "체크했는데 다시 들어가보면 꺼져있다"는 문제가 있었다 — 닫는 것 자체를 저장으로 취급한다.
  function saveSettingsAndClose(){
    aiSettings = readSettingsForm();
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
    readVoiceCommandSettingsFromUi();
    localStorage.setItem(VOICE_COMMANDS_KEY, JSON.stringify(voiceCommands));
    settingsOverlay.style.display = 'none';
    updateChatModelBadge();
  }

  document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettings').addEventListener('click', saveSettingsAndClose);
  settingsOverlay.addEventListener('click', (e)=>{
    if (e.target === settingsOverlay) saveSettingsAndClose(); // 바깥(어두운 영역) 클릭 시에도 저장 후 닫기
  });
  settingsAdvisor.addEventListener('change', ()=>{
    advisorModelRow.style.display = settingsAdvisor.checked ? 'block' : 'none';
  });
  document.getElementById('btnResetSettings').addEventListener('click', ()=>{
    populateSettingsForm(DEFAULT_AI_SETTINGS);
  });
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettingsAndClose);

  // ---- 폰 상단 모드버튼 4개(탐색작업창은 위에서 별도 처리 / 자동참조·웹서치·웹페이지가져오기는
  // 여기서) — 설정모달을 안 열어도 바로 켜고 끌 수 있고, 켜져 있으면 금색으로 표시된다. ----
  const btnModeAutoRef = document.getElementById('btnModeAutoRef');
  const btnModeWebSearch = document.getElementById('btnModeWebSearch');
  const btnModeWebFetch = document.getElementById('btnModeWebFetch');
  function refreshModeButtonStates(){
    btnModeAutoRef.classList.toggle('is-on', autoRefMode);
    // 웹서치는 기본이 "켜짐"이라 다른 버튼과 반대로 표시한다: 켜져 있을 땐 특별한 색 없이
    // 다른 버튼들과 똑같이 두고, 꺼졌을 때만 회색으로 흐리게 표시한다.
    btnModeWebSearch.classList.toggle('is-off', aiSettings.enableWebSearch === false);
    btnModeWebFetch.classList.toggle('is-on', !!aiSettings.enableWebFetch);
  }
  btnModeAutoRef.addEventListener('click', ()=>{
    autoRefMode = !autoRefMode;
    localStorage.setItem(AUTOREF_KEY, autoRefMode ? '1' : '0');
    refreshModeButtonStates();
  });
  btnModeWebSearch.addEventListener('click', ()=>{
    aiSettings.enableWebSearch = !aiSettings.enableWebSearch;
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
    refreshModeButtonStates();
  });
  btnModeWebFetch.addEventListener('click', ()=>{
    aiSettings.enableWebFetch = !aiSettings.enableWebFetch;
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
    refreshModeButtonStates();
  });
  refreshModeButtonStates();

  // 입력창 아래 "모델 · 강도" 뱃지 표시 갱신
  const MODEL_LABELS = {
    'claude-sonnet-5': 'Sonnet 5',
    'claude-opus-4-8': 'Opus 4.8',
    'claude-haiku-4-5-20251001': 'Haiku 4.5',
    'claude-fable-5': 'Fable 5',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite'
  };
  const EFFORT_LABELS = { low: '빠름', medium: '보통', high: '신중' };
  const btnOpenSettingsEl = document.getElementById('btnOpenSettings');
  // 버튼 글자는 항상 "설정"으로 고정(폭이 늘어나 상단바가 줄바꿈되던 문제 방지) —
  // 대신 지금 모델·강도는 마우스를 올렸을 때 보이는 title(툴팁)로 옮겨서 정보는 유지한다.
  function updateChatModelBadge(){
    const modelName = MODEL_LABELS[aiSettings.model] || aiSettings.model;
    const effortName = EFFORT_LABELS[aiSettings.effort] || aiSettings.effort;
    btnOpenSettingsEl.title = 'AI 설정 · 현재: ' + modelName + ' · ' + effortName;
  }
  updateChatModelBadge();

  // 채팅 전송 시 GAS로 실어보낼 AI 설정 payload 조립 (값이 기본값/공백이면 아예 안 실어서 서버 기본값이 적용되게 함)
  // 메시지 안에 URL이 있는지 감지 — 사용자가 매번 "가져오기" 버튼을 켰다 껐다 하지 않아도,
  // URL을 붙여넣은 순간에는 이번 요청 한정으로 자동으로 웹페이지 가져오기 도구를 켜준다.
  // (평소엔 꺼둔 채로 두고, 필요할 때만 켜지는 게 자연스럽다는 판단)
  const URL_DETECT_RE = /https?:\/\/[^\s]+/i;
  function messageContainsUrl(text){
    return URL_DETECT_RE.test(text || '');
  }

  function buildAiSettingsPayload(forceWebFetch){
    const payload = { model: aiSettings.model, effort: aiSettings.effort };
    if (aiSettings.temperature !== null && aiSettings.temperature !== undefined) payload.temperature = aiSettings.temperature;
    if (aiSettings.maxTokens !== null && aiSettings.maxTokens !== undefined) payload.maxTokens = aiSettings.maxTokens;
    // 웹서치는 이제 서버 기본값이 "항상 켜짐"이라, 켜진 상태(true)는 굳이 안 보내도 되지만
    // 꺼진 상태(false)는 반드시 명시적으로 보내야 서버가 진짜로 꺼준다(값을 아예 안 보내면
    // 서버는 "명시적으로 끄지 않았다"고 판단해서 계속 켠 채로 처리하기 때문).
    if (aiSettings.enableWebSearch === false) payload.enableWebSearch = false;
    if (aiSettings.enableWebFetch || forceWebFetch) payload.enableWebFetch = true;
    if (aiSettings.enableCodeExecution) payload.enableCodeExecution = true;
    if (aiSettings.enableAdvisor){
      payload.enableAdvisor = true;
      payload.advisorModel = aiSettings.advisorModel;
    }
    if (aiSettings.systemPrompt) payload.systemPrompt = aiSettings.systemPrompt;
    return payload;
  }

  // ============================================================
  // AI 채팅 — 실제 GAS 연결
  // ============================================================
  const chatBody = document.getElementById('chatBody');
  const chatInputEl = document.getElementById('chatInputEl');
  const btnChatSend = document.getElementById('btnChatSend');
  const attachBar = document.getElementById('attachBar');

  // ============================================================
  // NX 외부조회 커넥터(크롬 확장프로그램) 연동
  // ------------------------------------------------------------
  // 외부조회 사이트(등기부·실거래가 등)에서 확장프로그램 아이콘을 클릭하면,
  // 그 페이지의 선택영역(없으면 전체 텍스트)이 여기로 자동 전송되어 입력창에 채워진다.
  // 클립보드 복사→전환→붙여넣기 3단계를 거치던 기존 방식(📋 버튼)을 대체하되,
  // 확장프로그램이 없거나 다른 브라우저를 쓰는 경우를 위해 📋 버튼은 그대로 남겨둔다.
  // ============================================================
  const btnExtStatus = document.getElementById('btnExtStatus');
  let nxExtPort = null;
  let nxExtConnected = false;
  let nxCaptureCounter = 0; // 이번 입력창 세션에서 몇 번째 캡처인지 — 여러 건 순서대로 캡처할 때 구분용

  function insertCapturedText(text, meta){
    if (!text || !text.trim()) return;
    nxCaptureCounter++;
    const header = '[' + nxCaptureCounter + '] ' + ((meta && meta.title) ? (meta.title + ' ' + (meta.url || '')) : '') + '\n';
    const chunk = header + text.trim();
    chatInputEl.value = chatInputEl.value ? (chatInputEl.value + '\n\n' + chunk) : chunk;
    chatInputEl.focus();
    const modeLabel = meta && meta.mode === 'selection' ? '선택영역' : '전체 페이지';
    showToast('확장프로그램에서 가져왔습니다 (#' + nxCaptureCounter + ' · ' + modeLabel + (meta && meta.title ? (' · ' + meta.title) : '') + ')', 'success');
  }

  // 화면 캡처(스크린샷) 수신 — 이미지를 드라이브에 저장한 뒤 채팅 첨부로 붙인다(상담메모 기능과 동일한 방식).
  async function insertCapturedImage(dataUrl, meta){
    if (!dataUrl) return;
    if (!explorerPath.length){ showToast('먼저 탐색기에서 저장할 고객/사건 폴더를 열어두세요.', 'warning'); return; }
    try{
      const base64 = dataUrl.split(',')[1];
      const name = '화면캡처_' + new Date().toISOString().slice(0,16).replace(/[-:T]/g, '') + '.png';
      const res = await callGas('uploadFile', { path: explorerPath, name: name, mimeType: 'image/png', base64Data: base64 });
      if (res.error){ showToast('화면 캡처 저장 실패: ' + res.error, 'error'); return; }
      addAttachment({ id: res.id, name: res.name, type: 'file', mimeType: 'image/png' });
      showToast('화면 캡처를 저장하고 첨부했습니다' + (meta && meta.title ? (' · ' + meta.title) : ''), 'success');
      navigateTo(explorerPath);
    }catch(err){
      showToast('화면 캡처 처리 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  // PDF 다운로드 자동전송 수신 — PDF를 드라이브에 저장한 뒤 채팅 첨부로 붙인다.
  async function insertCapturedPdf(base64, filename, meta){
    if (!base64) return;
    if (!explorerPath.length){ showToast('먼저 탐색기에서 저장할 고객/사건 폴더를 열어두세요.', 'warning'); return; }
    try{
      const name = filename || ('다운로드_' + new Date().toISOString().slice(0,16).replace(/[-:T]/g, '') + '.pdf');
      const res = await callGas('uploadFile', { path: explorerPath, name: name, mimeType: 'application/pdf', base64Data: base64 });
      if (res.error){ showToast('PDF 저장 실패: ' + res.error, 'error'); return; }
      addAttachment({ id: res.id, name: res.name, type: 'file', mimeType: 'application/pdf' });
      showToast('PDF를 자동으로 저장하고 첨부했습니다: ' + name, 'success');
      navigateTo(explorerPath);
    }catch(err){
      showToast('PDF 처리 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  function updateExtStatusUi(){
    if (!btnExtStatus) return;
    if (nxExtConnected){
      btnExtStatus.textContent = '🟢';
      btnExtStatus.title = 'NX 외부조회 커넥터 연결됨 — 다른 탭에서 캡처하면 여기로 자동 전송됩니다';
    } else {
      btnExtStatus.textContent = '🔌';
      btnExtStatus.title = 'NX 외부조회 커넥터 미연결(확장프로그램 미설치 또는 연결 대기 중) — 클릭 시 재연결 시도';
    }
  }

  function connectNxExtension(){
    const extId = (window.NX_CONFIG && window.NX_CONFIG.EXTENSION_ID) || '';

    // 1) 크롬·엣지·웨일 등 크로미움 계열: externally_connectable로 확장프로그램에 직접 연결
    if (extId && window.chrome && chrome.runtime && chrome.runtime.connect){
      try{
        nxExtPort = chrome.runtime.connect(extId, { name: 'nx-work' });
        nxExtPort.onMessage.addListener((msg)=>{
          if (!msg || !msg.type) return;
          if (handleGemMessage(msg)) return;
          if (msg.type === 'NX_HELLO_ACK'){
            nxExtConnected = true;
            updateExtStatusUi();
          } else if (msg.type === 'NX_CAPTURE'){
            insertCapturedText(msg.text, msg);
          } else if (msg.type === 'NX_CAPTURE_IMAGE'){
            insertCapturedImage(msg.dataUrl, msg);
          } else if (msg.type === 'NX_CAPTURE_PDF'){
            insertCapturedPdf(msg.base64, msg.filename, msg);
          }
        });
        nxExtPort.onDisconnect.addListener(()=>{
          nxExtConnected = false;
          nxExtPort = null;
          updateExtStatusUi();
          // 확장프로그램이 나중에 설치/갱신되는 경우를 대비해 잠시 후 재시도
          // (MV3 서비스워커는 idle 상태가 지속되면 자동으로 잠들면서 이 연결도 같이 끊기는데,
          // 그 경우 최대한 빨리 다시 이어지도록 대기시간을 짧게 잡는다.)
          setTimeout(connectNxExtension, 1500);
        });
        nxExtPort.postMessage({ type: 'NX_HELLO' });
        return;
      }catch(e){
        nxExtConnected = false;
      }
    }

    // 2) 파이어폭스 등 externally_connectable이 없는 브라우저: 확장프로그램이 심어둔
    // 콘텐츠스크립트(bridge-firefox.js)가 있으면 window.postMessage로 같은 핸드셰이크를 시도한다.
    // 브리지가 없으면(그 확장프로그램 자체가 미설치) 그냥 응답이 안 올 뿐 다른 부작용은 없다.
    window.postMessage({ source: 'nx-page', type: 'NX_HELLO' }, '*');
    updateExtStatusUi();
  }
  // 파이어폭스 브리지(bridge-firefox.js)가 window.postMessage로 보내주는 응답을 받는다.
  window.addEventListener('message', (event)=>{
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'nx-bridge' || !data.type) return;
    if (handleGemMessage(data)) return;
    if (data.type === 'NX_HELLO_ACK'){
      nxExtConnected = true;
      updateExtStatusUi();
    } else if (data.type === 'NX_CAPTURE'){
      insertCapturedText(data.text, data);
    } else if (data.type === 'NX_CAPTURE_IMAGE'){
      insertCapturedImage(data.dataUrl, data);
    } else if (data.type === 'NX_CAPTURE_PDF'){
      insertCapturedPdf(data.base64, data.filename, data);
    }
  });
  if (btnExtStatus){
    btnExtStatus.addEventListener('click', ()=>{
      if (!nxExtConnected) connectNxExtension();
      else showToast('이미 연결되어 있습니다. 외부조회 사이트에서 확장프로그램 아이콘을 클릭하면 이 입력창으로 전송됩니다.', 'info');
    });
  }
  updateExtStatusUi();
  connectNxExtension();

  // 외부조회(새 탭)에서 복사해온 값을 입력창에 바로 넣기 위한 버튼.
  // 커서 위치에 끼워넣는 게 아니라 이 값 자체로 메시지를 시작하는 경우가 많다고 보고,
  // 이미 입력된 내용이 있으면 뒤에 이어붙인다(완전히 새로 시작하고 싶으면 먼저 지우면 됨).
  const btnPasteClipboard = document.getElementById('btnPasteClipboard');
  if (btnPasteClipboard){
    btnPasteClipboard.addEventListener('click', async ()=>{
      try{
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()){ showToast('클립보드에 텍스트가 없습니다.', 'warning'); return; }
        chatInputEl.value = chatInputEl.value ? (chatInputEl.value + ' ' + text.trim()) : text.trim();
        chatInputEl.focus();
      }catch(err){
        // 클립보드 읽기 권한이 없거나 브라우저가 막은 경우 — 직접 Ctrl+V로 붙여넣도록 안내
        showToast('클립보드를 읽을 수 없습니다. 입력창을 클릭한 뒤 Ctrl+V로 직접 붙여넣어 주세요.', 'warning');
      }
    });
  }

  // ============================================================
  // Gem — 채팅창에서 지금 검토 중인 쟁점을 제미니 웹(gemini.google.com)에게 그대로 물어보고
  // 의견을 받아온다. NX(넥스)의 답변과는 별개로 참고용으로만 쓰기 위해, 답변은 보라색
  // 말풍선(.msg.gem)으로 구분해서 채팅에 붙는다 — NX 자신의 분석과 섞이지 않는다.
  // "NETAX 외부조회 커넥터" 확장프로그램의 기존 연결(nxExtPort)을 그대로 재사용한다
  // (확장프로그램 쪽에는 NX_GEM_ASK를 받아 제미니 탭에 자동 입력·전송하고, 응답을
  // NX_GEM_ANSWER/NX_GEM_ERROR로 돌려주는 처리가 추가로 필요하다).
  // ============================================================
  const btnAskGem = document.getElementById('btnAskGem');
  const gemContextCountSelect = document.getElementById('gemContextCount');
  const pendingGemBubbles = {}; // requestId -> 그 질문에 대한 "대기 중" 말풍선 DOM 엘리먼트
  const pendingGemAnswerPrefix = {}; // requestId -> 답변에 붙일 라벨(🔮 단독인지 ⚖ 동시비교인지 구분)

  // 선택한 "직전 대화 몇 개"를 기억해뒀다가 다음에 열 때도 그대로 유지한다.
  const GEM_CONTEXT_COUNT_KEY = 'nx_gem_context_count';
  if (gemContextCountSelect){
    const saved = localStorage.getItem(GEM_CONTEXT_COUNT_KEY);
    if (saved !== null) gemContextCountSelect.value = saved;
    gemContextCountSelect.addEventListener('change', ()=>{
      localStorage.setItem(GEM_CONTEXT_COUNT_KEY, gemContextCountSelect.value);
    });
  }

  // 선택된 개수(N)만큼, chatMessages(NX와 실제로 나눈 대화기록)에서 가장 최근의 "나/NX" 교환을
  // 골라 텍스트로 엮는다. N=0이면 아무것도 붙이지 않는다(입력창 내용만 그대로 전송).
  // 내용이 비어있거나("빈 응답") 오류·중단으로 끝난 턴은 Gem에게 참고자료로 넘길 가치가 없으니
  // 미리 걸러내고 나서 최근 N턴을 고른다(예전 저장분에 이런 항목이 섞여 있을 가능성까지 대비).
  const CONTEXT_EXCLUDE_PATTERN_ = /^(오류|네트워크 오류|⏹ 중단됨)/;
  function buildRecentContextText_(turnCount){
    if (!turnCount) return '';
    const cleaned = chatMessages.filter(m=>{
      if (!m || !m.content) return false;
      const c = String(m.content).trim();
      if (!c) return false;
      if (CONTEXT_EXCLUDE_PATTERN_.test(c)) return false;
      return true;
    });
    const recent = cleaned.slice(-(turnCount * 2)); // 대략 "나 1개 + NX 1개"를 한 턴으로 계산
    if (!recent.length) return '';
    const lines = recent.map(m => (m.role === 'user' ? '나: ' : 'NX: ') + String(m.content).trim());
    return '[참고 — 직전 대화 ' + turnCount + '개]\n' + lines.join('\n') + '\n\n[실제 질문]\n';
  }

  function handleGemMessage(msg){
    if (!msg || !msg.type) return false;
    if (msg.type === 'NX_GEM_PROGRESS'){
      const bubble = pendingGemBubbles[msg.requestId];
      if (bubble) bubble.textContent = '🔮 ' + (msg.note || '진행 중…');
      return true;
    }
    if (msg.type === 'NX_GEM_ANSWER'){
      const bubble = pendingGemBubbles[msg.requestId];
      if (bubble){
        const prefix = pendingGemAnswerPrefix[msg.requestId] || '🔮 Gem';
        bubble.classList.remove('gem-pending');
        bubble.classList.add('gem');
        bubble.textContent = prefix + ': ' + (msg.answer || '(빈 응답)');
        delete pendingGemBubbles[msg.requestId];
        delete pendingGemAnswerPrefix[msg.requestId];
      }
      return true;
    }
    if (msg.type === 'NX_GEM_ERROR'){
      const bubble = pendingGemBubbles[msg.requestId];
      if (bubble){
        const prefix = pendingGemAnswerPrefix[msg.requestId] || '🔮 Gem';
        bubble.classList.remove('gem-pending');
        bubble.classList.add('gem');
        bubble.textContent = prefix + ' 자문 실패: ' + (msg.error || '알 수 없는 오류');
        delete pendingGemBubbles[msg.requestId];
        delete pendingGemAnswerPrefix[msg.requestId];
      }
      return true;
    }
    return false;
  }

  // rawQuestion을 Gem(제미니 웹)에게 물어본다 — 입력창을 직접 건드리지 않으므로, NX에게도 같은
  // 질문을 동시에 보내는 "동시비교" 흐름에서도 그대로 재사용할 수 있다.
  // opts.label을 주면 채팅에 뜨는 "누가 물어본 것인지" 문구를 바꿀 수 있다(동시비교 구분용).
  // 연결이 끊긴 상태(nxExtConnected===false)면 즉시 재연결을 시도하고, 핸드셰이크
  // (NX_HELLO → NX_HELLO_ACK)가 끝날 때까지 최대 2초 정도 짧게 기다려본다.
  // (MV3 서비스워커가 idle 상태로 잠들면서 연결이 끊겼다가, 다음 이벤트가 와야 다시 깨어나는
  // 경우가 있어서 — 그냥 실패 처리하지 않고 이 자리에서 한 번 더 살려본다.)
  async function ensureExtConnected_(){
    if (nxExtConnected && nxExtPort) return true;
    connectNxExtension();
    for (let i = 0; i < 20; i++){
      if (nxExtConnected && nxExtPort) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return nxExtConnected && !!nxExtPort;
  }

  async function askGem(rawQuestion, opts){
    opts = opts || {};
    if (!rawQuestion){ showToast('제미니에게 물어볼 내용이 없습니다.', 'warning'); return; }

    // 말풍선부터 무조건 먼저(연결 여부와 무관하게) 만든다 — 연결 확인이 실패해도 작은 토스트만
    // 뜨고 사라져서 "완전 먹통"처럼 보이는 문제가 있었다. 이제는 항상 뭔가 눈에 보이고,
    // 실패해도 그 말풍선 안에 이유가 남는다.
    const turnCount = gemContextCountSelect ? parseInt(gemContextCountSelect.value, 10) || 0 : 0;
    const contextNote = turnCount ? (' (직전 대화 ' + turnCount + '개 포함)') : '';
    const label = opts.label || '🔮 Gem에게 물어봄';
    const answerPrefix = opts.label ? opts.label.replace(/에게 물어봄$/, '') : '🔮 Gem';
    const requestId = 'gem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    appendBubble('user', label + contextNote + ': ' + rawQuestion);
    const pendingBubble = appendBubble('assistant', '🔮 확장프로그램 연결 확인 중…');
    pendingBubble.classList.remove('ai');
    pendingBubble.classList.add('gem-pending');
    pendingGemBubbles[requestId] = pendingBubble;
    pendingGemAnswerPrefix[requestId] = answerPrefix;

    function fail(text){
      pendingBubble.classList.remove('gem-pending');
      pendingBubble.classList.add('gem');
      pendingBubble.textContent = answerPrefix + ' 자문 실패: ' + text;
      delete pendingGemBubbles[requestId];
      delete pendingGemAnswerPrefix[requestId];
    }

    const connected = await ensureExtConnected_();
    if (!connected){
      fail('외부조회 커넥터 확장프로그램과 연결하지 못했습니다. 🔌 버튼으로 다시 연결해보세요.');
      return;
    }

    pendingBubble.textContent = '🔮 Gem에게 물어보는 중… (제미니 탭에서 답변이 끝날 때까지 잠시 기다려주세요)';
    const contextText = buildRecentContextText_(turnCount);
    const fullQuestion = contextText + rawQuestion;

    try{
      nxExtPort.postMessage({ type: 'NX_GEM_ASK', requestId: requestId, question: fullQuestion });
    }catch(err){
      fail('확장프로그램과 통신하지 못했습니다.');
    }
  }

  if (btnAskGem){
    btnAskGem.addEventListener('click', ()=>{
      const rawQuestion = chatInputEl.value.trim();
      askGem(rawQuestion);
      if (rawQuestion) chatInputEl.value = ''; // NX에게 보내는 채팅과 섞이지 않도록 입력창은 비운다
    });
  }

  // ---- ⚖ 동시비교 — 같은 질문을 NX와 Gem에게 "동시에" 보낸다 ----
  // 순서대로 물어보면(NX 답을 먼저 읽고 나서 Gem에게 묻는 식) 세무사님이 이미 NX의 관점에
  // 영향을 받은 채로 Gem에게 질문을 다듬어 던지게 되고, 반대로 해도 마찬가지다 — "누구한테
  // 먼저 물어보느냐에 따라 판이 바뀌는" 문제. 이걸 줄이려고, 입력창 내용 그대로를 두 곳에
  // 동시에 쏴서 서로의 답을 안 본 채(만들어지는 동안은 서로 참조가 물리적으로 불가능하다)
  // 독립적인 의견을 받도록 했다.
  const btnAskBoth = document.getElementById('btnAskBoth');
  if (btnAskBoth){
    btnAskBoth.addEventListener('click', ()=>{
      const question = chatInputEl.value.trim();
      if (!question){ showToast('NX와 Gem에게 동시에 물어볼 내용을 입력창에 먼저 입력하세요.', 'warning'); return; }
      askGem(question, { label: '⚖ 동시비교 — Gem에게 물어봄' });
      // askGem 호출 이후 무슨 이유로든 입력창 내용이 흔들렸을 가능성에 대비해, sendChatMessage
      // 직전에 다시 한번 명시적으로 채워 넣는다 — NX 전송이 빠지는 일이 없도록 하는 안전장치.
      chatInputEl.value = question;
      sendChatMessage(); // NX에게도 같은 질문을 그대로 전송(입력창은 이 함수가 알아서 비운다)
    });
  }


  let chatMessages = []; // Claude API 형식: [{role:'user'|'assistant', content:'...'}]
  let pendingAttachments = []; // [{id,name,type:'file'|'folder',mimeType?,path?}] — 채팅에 끌어다 놓거나 첨부한 항목들 (다음 전송에 무조건 반영)
  let pendingCaptures = []; // [{id,name,dataUrl}] — 화면캡처로 즉석에서 찍은 이미지 (드라이브에 저장 안 하고 바로 첨부)
  let pendingTextAttachments = []; // [{id,name,text}] — 경과지/계산기/관계도 등에서 "지금 화면 그대로" 참조 버튼으로 넘긴 것 (저장 전 상태 포함)
  let pendingRefMedia = []; // [{id,name,block}] — 편집기에 열린 이미지·PDF를 "참조" 버튼으로 명시적으로 넘긴 것 (block은 이미 Claude API 형식)

  // ---- 사건별 대화기록 저장/복원 ----
  // "고객/사건" 2단계 경로를 기준으로 대화를 한 파일(_대화기록.json)에 저장해뒀다가,
  // 같은 사건 폴더로 돌아오면 이어서 물어볼 수 있게 자동으로 불러온다.
  const CHAT_HISTORY_FILE_NAME = '_대화기록.json';
  const CHAT_HISTORY_MAX_MESSAGES = 60; // 너무 길어지면 토큰비용이 누적되므로 최근 것만 보관
  let chatHistoryCaseKey = null; // 지금 로드되어 있는 사건의 "고객 / 사건" 키 (null = 최상위 등, 대화기록 미사용)
  let chatHistoryFileId = null;
  let chatHistorySaveTimer = null;

  function caseRootPath(path){
    return (Array.isArray(path) && path.length >= 2) ? path.slice(0, 2) : null;
  }

  // 지난 대화를 다시 보여줄 때, EDIT_DOCUMENT/NAVIGATE_TO/DIAGRAM_MERMAID 같은 내부 신호는
  // 이미 적용됐거나 그 시점의 화면 상태에서만 의미가 있으므로 원문 그대로 노출하지 않는다.
  function stripSignalMarkersForDisplay(text){
    return String(text || '')
      .replace(/<<<NAVIGATE_TO>>>[\s\S]*?<<<END_NAVIGATE_TO>>>/g, '')
      .replace(/<<<EDIT_DOCUMENT>>>[\s\S]*?<<<END_EDIT_DOCUMENT>>>/g, '(문서 수정 제안 — 지난 대화라 다시 적용할 수 없습니다)')
      .replace(/<<<DIAGRAM_MERMAID>>>[\s\S]*?<<<END_DIAGRAM_MERMAID>>>/g, '(관계도 제안 — 지난 대화라 다시 적용할 수 없습니다)')
      .trim();
  }

  async function saveChatHistoryNow(){
    if (!chatHistoryCaseKey) return;
    const rootPath = chatHistoryCaseKey.split(' / ');
    try{
      const trimmed = chatMessages.slice(-CHAT_HISTORY_MAX_MESSAGES);
      const payload = {
        path: rootPath, name: CHAT_HISTORY_FILE_NAME, mimeType: 'application/json',
        base64Data: utf8ToBase64(JSON.stringify(trimmed))
      };
      if (chatHistoryFileId) payload.fileId = chatHistoryFileId;
      const res = await callGas('uploadFile', payload);
      if (!res.error && !chatHistoryFileId) chatHistoryFileId = res.id;
    }catch(err){
      console.warn('대화기록 저장 실패', err);
    }
  }

  function scheduleChatHistorySave(){
    clearTimeout(chatHistorySaveTimer);
    chatHistorySaveTimer = setTimeout(saveChatHistoryNow, 1000);
  }

  // 다른 사건 폴더로 이동할 때 호출 — 이전 사건 대화를 flush 저장하고, 새 사건의 저장된 대화를 불러온다.
  // 같은 사건 안에서 하위 폴더만 오갈 때는(caseRootPath가 그대로) 아무 것도 하지 않는다.
  async function loadChatHistoryForCase(pathArr){
    const root = caseRootPath(pathArr);
    const newKey = root ? root.join(' / ') : null;
    if (newKey === chatHistoryCaseKey) return;

    if (chatHistorySaveTimer){
      clearTimeout(chatHistorySaveTimer);
      chatHistorySaveTimer = null;
      await saveChatHistoryNow();
    }

    chatHistoryCaseKey = newKey;
    chatHistoryFileId = null;
    chatMessages = [];
    chatBody.innerHTML = '';

    if (!newKey) return; // 고객목록 등 최상위에서는 대화기록을 쓰지 않음

    try{
      const data = await listFolder(root);
      const existing = data.files.find(f => f.name === CHAT_HISTORY_FILE_NAME);
      if (existing){
        chatHistoryFileId = existing.id;
        const fileData = await callGas('readFile', { fileId: existing.id });
        const loaded = fileData.content ? JSON.parse(fileData.content) : [];
        if (Array.isArray(loaded) && loaded.length){
          chatMessages = loaded;
          const hint = document.createElement('div');
          hint.className = 'chat-history-hint';
          hint.textContent = '— 이 사건의 지난 대화를 이어서 보여드립니다 —';
          chatBody.appendChild(hint);
          loaded.forEach(m => appendBubble(m.role === 'assistant' ? 'assistant' : 'user', stripSignalMarkersForDisplay(m.content)));
        }
      }
    }catch(err){
      console.warn('대화기록 불러오기 실패', err);
    }
  }

  // 탭 전환/화면꺼짐 시 대기 중인 대화기록 저장도 유실되지 않도록 flush
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden && chatHistorySaveTimer){
      clearTimeout(chatHistorySaveTimer);
      chatHistorySaveTimer = null;
      saveChatHistoryNow();
    }
  });

  // "새 대화" 버튼 — 지금 이 사건의 대화기록을 화면에서도, 드라이브에 저장된
  // _대화기록.json 파일에서도 함께 지운다. 사건 폴더가 아닌 곳(고객목록 최상위 등)에서는
  // 애초에 저장되는 대화기록이 없으므로 화면만 비운다.
  async function startNewConversation(){
    if (!chatMessages.length){ showToast('이미 대화가 비어 있습니다.', 'info'); return; }
    if (!confirm('지금 이 사건의 대화 기록을 전부 지우고 새로 시작합니다.\n되돌릴 수 없습니다. 계속할까요?')) return;
    if (chatHistorySaveTimer){ clearTimeout(chatHistorySaveTimer); chatHistorySaveTimer = null; }
    chatMessages = [];
    chatBody.innerHTML = '';
    if (chatHistoryCaseKey){
      await saveChatHistoryNow(); // 빈 배열로 덮어써서 드라이브의 _대화기록.json도 함께 비움
    }
    showToast('새 대화를 시작합니다.', 'success');
  }
  document.getElementById('btnNewChat').addEventListener('click', startNewConversation);

  function renderAttachBar(){
    attachBar.innerHTML = '';
    if (!pendingAttachments.length && !pendingCaptures.length && !pendingTextAttachments.length && !pendingRefMedia.length){
      attachBar.style.display = 'none';
      return;
    }
    attachBar.style.display = 'flex';
    pendingAttachments.forEach(item=>{
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      const icon = item.type === 'folder' ? '📁' : '📎';
      chip.innerHTML = icon + ' ' + escapeHtml(item.name) + ' <span class="x" title="첨부 취소">✕</span>';
      chip.querySelector('.x').addEventListener('click', ()=>{
        pendingAttachments = pendingAttachments.filter(a => a.id !== item.id);
        renderAttachBar();
      });
      attachBar.appendChild(chip);
    });
    pendingTextAttachments.forEach(item=>{
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      chip.innerHTML = '🧾 ' + escapeHtml(item.name) + ' <span class="x" title="첨부 취소">✕</span>';
      chip.querySelector('.x').addEventListener('click', ()=>{
        pendingTextAttachments = pendingTextAttachments.filter(a => a.id !== item.id);
        renderAttachBar();
      });
      attachBar.appendChild(chip);
    });
    pendingRefMedia.forEach(item=>{
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      const icon = item.block.type === 'document' ? '📕' : '🖼️';
      chip.innerHTML = icon + ' ' + escapeHtml(item.name) + ' <span class="x" title="첨부 취소">✕</span>';
      chip.querySelector('.x').addEventListener('click', ()=>{
        pendingRefMedia = pendingRefMedia.filter(a => a.id !== item.id);
        renderAttachBar();
      });
      attachBar.appendChild(chip);
    });
    pendingCaptures.forEach(cap=>{
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      chip.innerHTML = '📸 ' + escapeHtml(cap.name) + ' <span class="x" title="첨부 취소">✕</span>';
      chip.querySelector('.x').addEventListener('click', ()=>{
        pendingCaptures = pendingCaptures.filter(c => c.id !== cap.id);
        renderAttachBar();
      });
      attachBar.appendChild(chip);
    });
  }

  // 경과지/계산기/관계도 등에서 "지금 이 내용 그대로" 버튼을 눌렀을 때 쓰는 공용 함수
  function addTextAttachment(name, text){
    if (!text || !text.trim()) { showToast('참조할 내용이 비어 있습니다.', 'warning'); return; }
    pendingTextAttachments.push({ id: 'txt' + Date.now(), name, text });
    renderAttachBar();
  }

  function addAttachment(item){
    if (!item || !item.id) return;
    if (pendingAttachments.find(a => a.id === item.id)) return; // 중복 방지
    pendingAttachments.push({
      id: item.id,
      name: item.name,
      type: item.type === 'folder' ? 'folder' : 'file',
      mimeType: item.mimeType,
      path: item.path // 폴더인 경우에만 있음
    });
    renderAttachBar();
  }

  // dataURL("data:image/png;base64,...")을 mimeType/base64로 분리
  function parseDataUrl(dataUrl){
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
    if (!m) return null;
    return { mimeType: m[1], base64: m[2] };
  }

  // ---- 화면 캡처: 다른 창(홈택스 등)을 한 장 찍기 — 이제 스캔창 안에서만 진입한다 ----

  async function captureScreen(mode){
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia){
      showToast('이 브라우저는 화면 캡처를 지원하지 않습니다.', 'error');
      return;
    }
    let stream = null;
    try{
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];

      let bitmapSource, width, height;
      if ('ImageCapture' in window){
        const capture = new ImageCapture(track);
        const bitmap = await capture.grabFrame();
        bitmapSource = bitmap; width = bitmap.width; height = bitmap.height;
      } else {
        // ImageCapture 미지원 브라우저용 대체 경로: 비디오 프레임을 잠깐 그려서 캡처
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        await new Promise(r => setTimeout(r, 200)); // 첫 프레임 안정화 대기
        bitmapSource = video; width = video.videoWidth; height = video.videoHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(bitmapSource, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/png');

      if (mode === 'scan'){
        // 스캔창 안에서 눌렀을 때는 "채팅에 붙일지 확인" 절차 없이, 곧바로 귀퉁이 보정 단계로
        // 이어준다 — 이미 스캔 작업 중이라는 맥락 자체가 확인을 대신한다.
        const img = new Image();
        img.onload = () => setupScanStage(img);
        img.src = dataUrl;
      } else {
        openCaptureView(dataUrl); // 바로 첨부하지 않고, 오른쪽에 크게 보여줘서 뭘 찍었는지 확인부터
      }
    }catch(err){
      if (err && err.name !== 'NotAllowedError'){
        showToast('화면 캡처 중 오류: ' + (err && err.message ? err.message : err), 'error');
      }
    }finally{
      if (stream) stream.getTracks().forEach(t => t.stop()); // 찍자마자 공유 즉시 종료 (계속 지켜보지 않음)
    }
  }

  const btnScanScreenCapture = document.getElementById('btnScanScreenCapture');
  if (btnScanScreenCapture) btnScanScreenCapture.addEventListener('click', () => captureScreen('scan'));

  // ---- 화면캡처 확인 뷰 (오른쪽 패널에 크게 보여주고 첨부/재촬영/취소/스캔연결 선택) ----
  const captureView = document.getElementById('captureView');
  const capturePreviewImg = document.getElementById('capturePreviewImg');
  const btnCaptureCancel = document.getElementById('btnCaptureCancel');
  const btnCaptureUndo = document.getElementById('btnCaptureUndo');
  const btnCaptureToScan = document.getElementById('btnCaptureToScan');
  const btnCaptureRetake = document.getElementById('btnCaptureRetake');
  const btnCaptureConfirm = document.getElementById('btnCaptureConfirm');

  let pendingCaptureDataUrl = null;
  let pendingCaptureAutoId = null; // 자동참조 ON이라 즉시 첨부해뒀을 때, 그 pendingCaptures 항목의 id (취소 시 되돌리기용)

  function openCaptureView(dataUrl){
    ensureExplorerVisible();
    pendingCaptureDataUrl = dataUrl;
    capturePreviewImg.src = dataUrl;
    hideAllPanelViews();
    captureView.style.display = 'flex';

    if (autoRefMode){
      // 자동참조 ON: 확인 절차 없이 바로 첨부해두고, 미리보기는 "확인용"으로만 보여줌
      pendingCaptureAutoId = 'cap' + Date.now();
      pendingCaptures.push({ id: pendingCaptureAutoId, name: '화면캡처_' + pendingCaptures.length, dataUrl });
      renderAttachBar();
      btnCaptureCancel.textContent = '✓ 확인';
      btnCaptureUndo.style.display = '';
      btnCaptureConfirm.style.display = 'none';
    } else {
      pendingCaptureAutoId = null;
      btnCaptureCancel.textContent = '‹ 취소';
      btnCaptureUndo.style.display = 'none';
      btnCaptureConfirm.style.display = '';
    }
  }

  function removeAutoAddedCapture(){
    if (pendingCaptureAutoId){
      pendingCaptures = pendingCaptures.filter(c => c.id !== pendingCaptureAutoId);
      renderAttachBar();
      pendingCaptureAutoId = null;
    }
  }

  function closeCaptureView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    pendingCaptureDataUrl = null;
    closeCropMode(); // 자르기 모드를 열어둔 채 닫았으면 정리
  }

  btnCaptureCancel.addEventListener('click', closeCaptureView); // 자동첨부 모드에선 "확인"이라 그냥 닫기만, 수동 모드에선 첨부 안 하고 닫기(원래 첨부 안 된 상태이므로 별도 취소 불필요)
  btnCaptureUndo.addEventListener('click', ()=>{ removeAutoAddedCapture(); closeCaptureView(); });
  btnCaptureRetake.addEventListener('click', ()=>{
    removeAutoAddedCapture(); // 다시 찍기 전에, 자동으로 첨부됐던 이전 캡처는 제거
    closeCaptureView();
    captureScreen();
  });
  btnCaptureConfirm.addEventListener('click', ()=>{
    if (pendingCaptureDataUrl){
      pendingCaptures.push({ id: 'cap' + Date.now(), name: '화면캡처_' + (pendingCaptures.length + 1), dataUrl: pendingCaptureDataUrl });
      renderAttachBar();
    }
    closeCaptureView();
  });
  btnCaptureToScan.addEventListener('click', ()=>{
    if (!pendingCaptureDataUrl) return;
    removeAutoAddedCapture(); // 채팅 첨부가 아니라 스캔 도구로 보내는 거라, 자동으로 붙었던 첨부는 제거
    const img = new Image();
    img.onload = ()=>{
      closeCaptureView();
      openScanModal();
      setupScanStage(img); // 스캔 도구의 "귀퉁이 잡아서 펴기" 단계로 바로 이어짐
    };
    img.src = pendingCaptureDataUrl;
  });

  // ---- 캡처 미리보기: 범위 선택(자르기) ----
  // 탭/창/전체화면 통째로 캡처한 뒤, 필요한 부분만 남기고 싶을 때를 위한 기능.
  // 모서리 손잡이 2개(좌상단·우하단)로 사각형을 잡고, "이 범위로 자르기"를 누르면
  // 그 부분만 새 이미지로 교체된다(자동참조로 이미 채팅에 첨부돼 있었다면 그것도 같이 갱신).
  const captureMainToolbar = document.getElementById('captureMainToolbar');
  const cropToolbar = document.getElementById('cropToolbar');
  const capturePreviewWrap = document.getElementById('capturePreviewWrap');
  const captureCropBox = document.getElementById('captureCropBox');
  const btnCaptureCrop = document.getElementById('btnCaptureCrop');
  const btnCropApply = document.getElementById('btnCropApply');
  const btnCropCancel = document.getElementById('btnCropCancel');

  let cropRect = null; // capturePreviewWrap 기준 상대좌표(css px): {left, top, width, height}

  function renderCropBox(){
    captureCropBox.style.left = cropRect.left + 'px';
    captureCropBox.style.top = cropRect.top + 'px';
    captureCropBox.style.width = cropRect.width + 'px';
    captureCropBox.style.height = cropRect.height + 'px';
  }

  function openCropMode(){
    const imgRect = capturePreviewImg.getBoundingClientRect();
    const wrapRect = capturePreviewWrap.getBoundingClientRect();
    const left = imgRect.left - wrapRect.left, top = imgRect.top - wrapRect.top;
    // 기본값: 이미지 가운데 80% 영역부터 시작(귀퉁이를 끌어서 조절)
    cropRect = { left: left + imgRect.width * 0.1, top: top + imgRect.height * 0.1, width: imgRect.width * 0.8, height: imgRect.height * 0.8 };
    renderCropBox();
    captureCropBox.style.display = 'block';
    cropToolbar.style.display = 'flex';
    captureMainToolbar.style.display = 'none';
  }
  function closeCropMode(){
    captureCropBox.style.display = 'none';
    cropToolbar.style.display = 'none';
    captureMainToolbar.style.display = 'flex';
  }
  btnCaptureCrop.addEventListener('click', openCropMode);
  btnCropCancel.addEventListener('click', closeCropMode);

  document.querySelectorAll('.crop-handle').forEach(handle=>{
    handle.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const corner = handle.dataset.corner;

      function onMove(ev){
        const wrapRect = capturePreviewWrap.getBoundingClientRect();
        const imgRect = capturePreviewImg.getBoundingClientRect();
        const minX = imgRect.left - wrapRect.left, minY = imgRect.top - wrapRect.top;
        const maxX = minX + imgRect.width, maxY = minY + imgRect.height;
        const x = Math.max(minX, Math.min(maxX, ev.clientX - wrapRect.left));
        const y = Math.max(minY, Math.min(maxY, ev.clientY - wrapRect.top));

        if (corner === 'tl'){
          cropRect.width += cropRect.left - x;
          cropRect.height += cropRect.top - y;
          cropRect.left = x; cropRect.top = y;
        } else { // br
          cropRect.width = x - cropRect.left;
          cropRect.height = y - cropRect.top;
        }
        cropRect.width = Math.max(20, cropRect.width);
        cropRect.height = Math.max(20, cropRect.height);
        renderCropBox();
      }
      function onUp(){
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });

  btnCropApply.addEventListener('click', ()=>{
    const imgRect = capturePreviewImg.getBoundingClientRect();
    const wrapRect = capturePreviewWrap.getBoundingClientRect();
    const imgLeft = imgRect.left - wrapRect.left, imgTop = imgRect.top - wrapRect.top;
    // 화면에 표시된 크기(css px) → 원본 이미지 픽셀 크기로 환산
    const scaleX = capturePreviewImg.naturalWidth / imgRect.width;
    const scaleY = capturePreviewImg.naturalHeight / imgRect.height;
    const sx = (cropRect.left - imgLeft) * scaleX;
    const sy = (cropRect.top - imgTop) * scaleY;
    const sw = cropRect.width * scaleX;
    const sh = cropRect.height * scaleY;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    canvas.getContext('2d').drawImage(capturePreviewImg, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const newDataUrl = canvas.toDataURL('image/png');

    pendingCaptureDataUrl = newDataUrl;
    capturePreviewImg.src = newDataUrl;
    if (pendingCaptureAutoId){
      const item = pendingCaptures.find(p => p.id === pendingCaptureAutoId);
      if (item) item.dataUrl = newDataUrl;
      renderAttachBar();
    }
    closeCropMode();
  });


  // 파일탐색기에서 채팅창으로 드래그&드롭
  chatBody.addEventListener('dragover', (e)=>{
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    chatBody.classList.add('drag-over');
  });
  chatBody.addEventListener('dragleave', ()=>{
    chatBody.classList.remove('drag-over');
  });
  chatBody.addEventListener('drop', (e)=>{
    e.preventDefault();
    chatBody.classList.remove('drag-over');
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try{
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed]; // 항상 배열로 옴 (단일 파일도 1개짜리 배열)
      list.forEach(addAttachment);
    }catch(err){ console.warn('첨부 데이터 파싱 실패', err); }
  });

  // ============================================================
  // 채팅창 자동 스크롤 — 새 말풍선("생각 중…" 포함)이 생기거나 내용이 바뀔 때 항상 맨 아래로
  // 따라가도록 한다. 예전엔 말풍선을 추가하는 그 순간의 scrollHeight로 딱 한 번만 스크롤해서,
  // 그 직후에(모바일 키보드가 닫히는 애니메이션·attach-bar 접힘·이미지 로딩 등으로) 화면 높이가
  // 다시 바뀌면 방금 추가한 "생각 중…" 말풍선이 화면 아래로 밀려 안 보이는 문제가 있었다(수동으로
  // 스크롤해야만 보임). 이제는 (1) 새 말풍선이 생기는 순간엔 무조건(강제로) 맨 아래로 붙이고,
  // (2) 사용자가 지금 맨 아래 근처를 보고 있을 때만 이후의 변화(스트리밍·이미지 로딩·키보드
  // 애니메이션 등)에도 계속 자동으로 따라가며, (3) 사용자가 일부러 위로 스크롤해서 옛 대화를
  // 읽고 있으면 그건 방해하지 않는다.
  let chatPinnedToBottom = true;
  const CHAT_BOTTOM_THRESHOLD_PX = 80;

  function isChatNearBottom_(){
    return (chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight) < CHAT_BOTTOM_THRESHOLD_PX;
  }
  chatBody.addEventListener('scroll', ()=>{ chatPinnedToBottom = isChatNearBottom_(); });

  function scrollChatToBottom(force){
    if (!force && !chatPinnedToBottom) return;
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // 한 번만 스크롤하면 그 직후의 뒤늦은 레이아웃 변화(키보드 닫힘 애니메이션 등)를 놓칠 수 있어서,
  // 지금 당장·다음 프레임·약간의 시간 뒤(키보드 애니메이션이 보통 끝나는 시점) 이렇게 세 번 맞춘다.
  function scrollChatToBottomInsistently_(force){
    scrollChatToBottom(force);
    requestAnimationFrame(()=> scrollChatToBottom(force));
    setTimeout(()=> scrollChatToBottom(force), 350);
  }

  // 말풍선 안의 내용이 나중에 바뀌거나(답변 렌더링·이미지 로드 등) 높이가 늘어나는 경우까지
  // 계속 따라가도록 채팅창 DOM 변화를 관찰한다(사용자가 일부러 위로 스크롤해 옛 대화를 보고
  // 있을 때는 chatPinnedToBottom이 false가 되어 방해하지 않는다).
  new MutationObserver(()=>{ scrollChatToBottom(false); })
    .observe(chatBody, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['src'] });

  // 모바일 키보드가 열리고/닫힐 때도 화면(뷰포트) 높이가 바뀌므로 다시 맞춰준다.
  window.addEventListener('resize', ()=> scrollChatToBottomInsistently_(false));
  if (window.visualViewport){
    window.visualViewport.addEventListener('resize', ()=> scrollChatToBottomInsistently_(false));
  }

  function appendBubble(role, text){
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
    div.textContent = text;
    chatBody.appendChild(div);
    scrollChatToBottomInsistently_(true); // 새 말풍선은 항상 강제로 맨 아래까지 붙인다
    return div;
  }

  // AI 응답 안에 <<<EDIT_DOCUMENT>>>...<<<END_EDIT_DOCUMENT>>> 구간이 있으면
  // "편집기에 적용하기" 버튼을 붙여서 렌더링 (없으면 그냥 평범한 텍스트)
  // ※ 신규 응답은 이제 이 마커 대신 clientActions(구조화된 tool_use 결과)로 온다.
  //   이 상수들은 과거에 저장된 대화기록(_대화기록.json)을 다시 보여줄 때(stripSignalMarkersForDisplay)와
  //   음성 낭독(speakReply)에서만 하위호환 목적으로 계속 쓰인다.
  const EDIT_START = '<<<EDIT_DOCUMENT>>>';
  const EDIT_END = '<<<END_EDIT_DOCUMENT>>>';
  const NAV_START = '<<<NAVIGATE_TO>>>';
  const NAV_END = '<<<END_NAVIGATE_TO>>>';

  // clientActions는 서버(GAS)가 tool_use로 구조화해서 보내주는 배열이다.
  // 과거에는 응답 텍스트 안의 <<<EDIT_DOCUMENT>>> 같은 마커를 정규식으로 찾아냈는데,
  // 코드펜스 안에 마커가 나와도 명령으로 오인하는 등 취약한 지점이 있었다 —
  // 구조화된 데이터로 받으면 이런 문제 자체가 없어진다.
  // [패치 2026.07 — 버그#3 근본 원인]
  // AI 응답이 오기까지 시간이 걸리는 동안(도구 여러 번 호출 등으로 수십 초씩 걸리는 경우가 흔함)
  // 사용자가 다른 폴더를 보거나 다른 파일을 열면 isReportWriterOpen/currentOpenFile이 바뀐다.
  // 예전 코드는 응답이 "도착한 시점"의 이 값들을 기준으로 버튼을 보여줄지 결정했기 때문에,
  // AI가 apply_document_edit을 정상적으로 호출해서 clientActions에 수정안이 실제로 들어있는데도
  // 화면에는 버튼이 아예 렌더링되지 않고 조용히 사라지는 경우가 매우 잦았다(사용자가 "버튼을
  // 준다고 해놓고 안 준다"고 느낀 사고의 실제 원인). 이제 "요청을 보낸 시점"에 열려 있던 파일을
  // 별도로 기억해뒀다가, 응답이 왔을 때 그 파일이 지금 안 열려 있어도 버튼은 항상 보여주고,
  // 클릭하면 그 파일을 다시 열어서 적용한다.
  function applyEditToTargetFile_(editTargetFile, content, applyBtn){
    if (!editTargetFile){
      showToast('적용할 문서 정보를 찾을 수 없습니다 — 문서를 다시 열고 요청해주세요.', 'error');
      return;
    }
    // 이미 그 파일의 독립창이 열려있으면 — 지금 그 창이 포커스되어 있지 않아도(예: 다른 문서를
    // 보고 있는 중이어도) 곧바로 그 창에 반영한다. 여러 편집창을 동시에 띄워놓고 작업할 때,
    // AI 적용은 "지금 보고 있는 창"이 아니라 "AI가 지목한 그 문서"로 정확히 가야 하기 때문이다.
    const already = getEditorWindowForFile(editTargetFile);
    if (already){
      already.postMessage({ type: 'nx-set-content', content: content }, '*');
      applyBtn.textContent = '✓ 적용됨';
      applyBtn.disabled = true;
      return;
    }
    applyBtn.textContent = '문서 여는 중…';
    applyBtn.disabled = true;
    openEditor(editTargetFile); // 그 파일 전용 독립창을 새로 연다(다른 편집창들은 그대로 유지됨)
    const target = getEditorWindowForFile(editTargetFile);
    if (!target){
      // 독립창이 팝업 차단 등으로 열리지 못한 경우 — iframe과 달리 이 경우는 실제로 일어날 수 있어서
      // (예전 iframe 방식은 차단될 일이 없었음) 조용히 실패하지 않고 안내한다.
      showToast('편집창을 열지 못했습니다. 브라우저에서 이 사이트의 팝업 허용을 켜고 다시 시도해주세요.', 'error');
      applyBtn.textContent = '문서 열기 실패';
      return;
    }
    const onLoad = ()=>{
      target.removeEventListener('load', onLoad);
      // report-writer 내부 스크립트가 파일을 fetch해서 완전히 준비되기까지 약간의 여유를 둔다.
      setTimeout(()=>{
        target.postMessage({ type: 'nx-set-content', content: content }, '*');
        applyBtn.textContent = '✓ 적용됨';
      }, 500);
    };
    target.addEventListener('load', onLoad);
  }

  function renderAssistantReply(bubbleEl, replyText, clientActions, editTargetFile){
    const actions = Array.isArray(clientActions) ? clientActions : [];
    const diagramOpen = (typeof diagramView !== 'undefined' && diagramView.style.display !== 'none');

    // 이동은 예전과 동일하게 확인 없이 즉시 적용(되돌리기 쉬운 작업이라 판단).
    const navAction = actions.find(a => a && a.type === 'navigate_to');
    if (navAction && Array.isArray(navAction.path)) navigateTo(navAction.path);

    // AI가 파일을 저장/생성했을 때(save_file_to_folder, export_to_google_doc, manage_task_plan),
    // 지금 탐색기가 그 폴더를 보고 있으면 자동으로 새로고침해서 새 파일이 바로 보이게 한다.
    // (예전엔 이 신호 자체가 없어서, 다른 폴더로 나갔다가 다시 들어와야만 새 파일이 보였음)
    const explorerChangedAction = actions.find(a => a && a.type === 'explorer_changed');
    if (explorerChangedAction && explorerView.style.display !== 'none'
        && JSON.stringify(explorerPath) === JSON.stringify(explorerChangedAction.path || [])) {
      navigateTo(explorerPath);
    }

    // [패치] isReportWriterOpen(지금 이 순간의 화면 상태)로 게이트하지 않는다 — clientActions에
    // 실제로 들어있으면 무조건 버튼을 보여준다. diagramOpen도 마찬가지로 완화.
    const editAction = actions.find(a => a && a.type === 'edit_document');
    const diagramAction = actions.find(a => a && a.type === 'diagram_mermaid');

    bubbleEl.innerHTML = '';

    if (editAction){
      const textPart = document.createElement('div');
      textPart.textContent = replyText.trim() || '문서에 대한 수정안을 준비했습니다.';
      bubbleEl.appendChild(textPart);

      const applyBtn = document.createElement('button');
      applyBtn.className = 'apply-edit-btn';
      applyBtn.textContent = '📝 편집기에 적용하기';
      applyBtn.addEventListener('click', ()=>{
        applyEditToTargetFile_(editTargetFile, editAction.content || '', applyBtn);
      });
      bubbleEl.appendChild(applyBtn);
    } else if (diagramAction){
      const textPart = document.createElement('div');
      textPart.textContent = replyText.trim() || '관계도 초안을 준비했습니다.';
      bubbleEl.appendChild(textPart);

      const applyBtn = document.createElement('button');
      applyBtn.className = 'apply-edit-btn';
      applyBtn.textContent = '🕸 관계도에 적용하기';
      applyBtn.addEventListener('click', ()=>{
        diagramInput.value = diagramAction.mermaidCode || '';
        renderDiagramPreview();
        saveDiagram();
        applyBtn.textContent = '✓ 적용됨';
        applyBtn.disabled = true;
      });
      bubbleEl.appendChild(applyBtn);
    } else {
      bubbleEl.textContent = replyText;
    }
  }

  let currentChatAbortController = null; // 요청 중 '중지' 버튼으로 취소하기 위한 컨트롤러

  async function sendChatMessage(){
    const text = chatInputEl.value.trim();
    if (!text) return;

    const isVoiceTurn = voiceTriggeredSend; // 이번 전송이 음성으로 시작됐는지 (답변을 소리로 읽어줄지 결정)
    voiceTriggeredSend = false;

    const attachmentsForThisMessage = pendingAttachments.slice();
    const attachNote = attachmentsForThisMessage.length
      ? ' ' + attachmentsForThisMessage.map(a => (a.type === 'folder' ? '📁' : '📎') + a.name).join(', ')
      : '';
    const capturesForThisMessage = pendingCaptures.slice();
    const captureNote = capturesForThisMessage.length ? ' ' + capturesForThisMessage.map(() => '📸').join('') : '';
    const textAttachmentsForThisMessage = pendingTextAttachments.slice();
    const textAttachNote = textAttachmentsForThisMessage.length
      ? ' ' + textAttachmentsForThisMessage.map(t => '🧾' + t.name).join(', ')
      : '';
    const refMediaForThisMessage = pendingRefMedia.slice();
    const refMediaNote = refMediaForThisMessage.length
      ? ' ' + refMediaForThisMessage.map(m => (m.block.type === 'document' ? '📕' : '🖼️') + m.name).join(', ')
      : '';

    appendBubble('user', text + attachNote + captureNote + textAttachNote + refMediaNote);
    chatInputEl.value = '';
    nxCaptureCounter = 0; // 이번 메시지를 보냈으니, 다음 캡처는 다시 1번부터
    chatInputEl.disabled = true;
    btnChatSend.textContent = '⏹'; // 요청 중엔 전송 버튼이 중지 버튼 역할을 함
    btnChatSend.title = '중지';
    btnChatSend.classList.add('stop-mode');
    pendingAttachments = [];
    pendingCaptures = [];
    pendingTextAttachments = [];
    pendingRefMedia = [];
    renderAttachBar();

    const thinkingBubble = appendBubble('assistant', '생각 중…');

    // report-writer가 열려있으면 "지금 타이핑 중인(저장 전) 내용"까지 실시간으로 받아온다.
    // 이건 자동참조(여러 폴더/파일을 알아서 뒤지는 기능) 설정과는 별개다 — 지금 사용자가 화면에
    // 펼쳐놓고 보고 있는 문서 하나일 뿐이라 비용도 적고, "편집기 열어두면 AI가 내용을 알아서
    // 인지하고 수정 제안도 해준다"는 게 이 도구의 핵심 기능이라 자동참조 OFF여도 항상 켜둔다.
    const liveContent = await getEditorLiveContent();
    // report-writer가 아니라 이미지·PDF 뷰어로 열려 있으면, 자동참조가 ON일 때만 그 파일을 이번 요청에 실어보냄.
    // (이미지·PDF는 용량이 있어 매턴 자동전송하면 낭비이므로, 명시적으로 열어보고 싶으면 첨부 기능을 쓰거나 자동참조를 켜야 함)
    const openFileMediaBlock = autoRefMode ? await getOpenFileMediaBlock() : null;
    // 화면캡처·명시적 참조 첨부는 사용자가 직접 붙인 것이므로 자동참조 여부와 무관하게 항상 포함
    const captureBlocks = capturesForThisMessage
      .map(cap => parseDataUrl(cap.dataUrl))
      .filter(Boolean)
      .map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } }));
    const refMediaBlocks = refMediaForThisMessage.map(m => m.block);

    const openFileCtx = currentOpenFile
      ? Object.assign({}, currentOpenFile, (liveContent !== null ? { liveContent } : {}))
      : null;
    // [패치 2026.07 — 버그#3] 응답이 오는 동안 사용자가 다른 파일/폴더로 이동해도
    // "이 요청을 보낼 때 편집 중이던 파일"을 잃어버리지 않도록 별도로 스냅샷을 떠둔다.
    const editTargetFileSnapshot = (isReportWriterOpen && currentOpenFile)
      ? Object.assign({}, currentOpenFile) : null;

    // 관계도 도구가 열려 있으면, AI가 mermaid 코드를 만들어 바로 반영할 수 있도록 지금 내용을 함께 보낸다.
    const openDiagramCtx = (typeof diagramView !== 'undefined' && diagramView.style.display !== 'none')
      ? { liveContent: diagramInput.value }
      : null;

    // 대화 기록(chatMessages)에는 가벼운 텍스트만 남긴다 — 이미지를 기록에 박아두면
    // 다음 턴부터 대화 전체를 다시 보낼 때마다 그 이미지까지 매번 반복 전송되어 낭비가 누적된다.
    chatMessages.push({ role: 'user', content: text });

    // 실제 API 요청에는(이번 한 턴에 한해서만) 이미지/문서 블록을 살짝 끼워 보낸다.
    const requestMessages = chatMessages.slice();
    const extraBlocks = [].concat(openFileMediaBlock || [], captureBlocks, refMediaBlocks);
    if (extraBlocks.length){
      requestMessages[requestMessages.length - 1] = {
        role: 'user',
        content: [{ type: 'text', text: text }].concat(extraBlocks)
      };
    }

    const autoWebFetch = messageContainsUrl(text) && !aiSettings.enableWebFetch;
    if (autoWebFetch) showToast('메시지에 URL이 있어 이번 요청만 웹페이지 가져오기를 자동으로 켰습니다.', 'info');

    try{
      currentChatAbortController = new AbortController();
      const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        signal: currentChatAbortController.signal,
        body: JSON.stringify(Object.assign({
          messages: requestMessages,
          context: {
            currentPath: explorerPath,
            openFile: openFileCtx,
            openDiagram: openDiagramCtx,
            attachedItems: attachmentsForThisMessage,
            attachedTexts: textAttachmentsForThisMessage,
            // [패치 2026.07 — 버그#6] 이번 턴이 음성으로 시작됐는지 서버에 알려준다.
            // 예전엔 이 정보가 프론트엔드에만 있어서(isVoiceTurn), AI는 지금 자기 답이
            // 소리로 읽힐지 화면에 표시될지 전혀 모른 채 항상 문자채팅 방식(마크다운·표·
            // 굵게 등)으로만 답했다. 그래서 음성모드에서도 "**이렇게** 하시면 됩니다"처럼
            // 기호까지 그대로 다 읽어버리는 문제가 생겼다.
            voiceTurn: isVoiceTurn
          },
          autoRef: autoRefMode
        }, buildAiSettingsPayload(messageContainsUrl(text))))
      });
      const data = await res.json();
      if (data.error){
        thinkingBubble.textContent = '오류: ' + data.error;
        chatMessages.pop(); // 답을 못 받았으니 방금 push한 사용자 메시지도 취소된 걸로 취급(짝 없는 질문이 대화기록에 남지 않게)
      } else {
        renderAssistantReply(thinkingBubble, data.reply || '(빈 응답)', data.clientActions, editTargetFileSnapshot);
        chatMessages.push({ role: 'assistant', content: data.reply || '' });
        scheduleChatHistorySave();
        if (isVoiceTurn) speakReply(data.reply || '');
      }
    }catch(err){
      if (err && err.name === 'AbortError'){
        thinkingBubble.textContent = '⏹ 중단됨';
        chatMessages.pop(); // 방금 push한 사용자 메시지도 취소된 걸로 취급 (응답 없이 기록만 남으면 다음 턴에 어색해짐)
      } else {
        thinkingBubble.textContent = '네트워크 오류: ' + (err && err.message ? err.message : err);
        chatMessages.pop(); // 답을 못 받았으니 방금 push한 사용자 메시지도 취소된 걸로 취급(짝 없는 질문이 대화기록에 남지 않게)
      }
    }finally{
      currentChatAbortController = null;
      chatInputEl.disabled = false;
      btnChatSend.textContent = '➤';
      btnChatSend.title = '보내기';
      btnChatSend.classList.remove('stop-mode');
      if (voiceModeOn) {
        // speakReply가 아예 안 불린 경로(API 오류·네트워크 오류·중단)라면 voicePhase가 아직
        // 'thinking'에 머물러 있다 — 그대로 두면 음성모드가 거기서 멈춰버리므로 직접 정리하고 재시작.
        if (isVoiceTurn && voicePhase === 'thinking'){
          voicePhase = 'idle';
          updateVoiceUi();
          startVoiceRecognition();
        }
        // 음성모드 중엔 입력창에 강제로 포커스를 주지 않는다 — 포커스를 주면 폰에서 키보드가
        // 튀어나와 방해가 된다(어차피 음성으로만 주고받는 흐름이라 입력창 포커스가 필요 없음).
      } else {
        chatInputEl.focus();
      }
    }
  }

  btnChatSend.addEventListener('click', ()=>{
    if (currentChatAbortController){
      currentChatAbortController.abort(); // 요청 중이면 전송이 아니라 중지
    } else {
      sendChatMessage();
    }
  });
  // Shift 키의 눌림 상태를 직접 추적 — beforeinput의 InputEvent에는 shiftKey가 신뢰성 있게
  // 담기지 않는 브라우저가 있어서, keydown/keyup으로 직접 추적한 값을 대신 사용한다.
  let shiftKeyHeld = false;
  chatInputEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Shift') shiftKeyHeld = true;
    // [2026.08] 한글 등 IME로 글자를 조합하는 중에 눌린 엔터는 "글자 확정"용이지 "전송"용이
    // 아니다. 이 구분이 없으면 특히 태블릿 가상자판에서 한글 입력 후 엔터가 먹통처럼 느껴지는
    // 현상이 생긴다(isComposing이 true이거나, 구형 브라우저는 keyCode 229로 알려줌).
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendChatMessage();
    }
  });
  chatInputEl.addEventListener('keyup', (e)=>{
    if (e.key === 'Shift') shiftKeyHeld = false;
  });
  // [2026.08] 일부 태블릿 가상자판(특히 한글 자판)은 Enter를 눌러도 keydown에서 e.key가
  // 'Enter'로 안 잡히고, 대신 textarea에 실제 줄바꿈을 넣는 insertLineBreak 이벤트만 발생시키는
  // 경우가 있다. keydown이 못 잡는 경우를 위한 보강 경로 — 물리 키보드 Shift+Enter의 줄바꿈은
  // shiftKeyHeld로 구분해서 그대로 살려둔다(가상자판엔 물리 Shift가 없어 항상 false이므로
  // 자연히 전송 쪽으로 판정됨).
  chatInputEl.addEventListener('beforeinput', (e)=>{
    if (e.inputType === 'insertLineBreak' && !shiftKeyHeld){
      e.preventDefault();
      sendChatMessage();
    }
  });

  // ---- 즉석 음성명령: 흔한 패턴이면 AI를 거치지 않고 바로 처리 (빠르고 비용도 안 듦) ----
  // 문구(phrases)와 켜짐여부(enabled)는 설정 모달에서 사용자가 직접 확인·추가·제거할 수 있다.
  const VOICE_COMMANDS_KEY = 'nx_voice_commands';
  const DEFAULT_VOICE_COMMANDS = [
    { id: 'up', label: '상위 폴더로', action: 'up', enabled: true, phrases: ['위로', '뒤로', '뒤로가기', '상위폴더로'] },
    { id: 'down', label: '하위 폴더로 (1개뿐일 때만)', action: 'down', enabled: true, phrases: ['아래로', '들어가', '하위폴더로'] },
    { id: 'home', label: '고객 목록으로', action: 'home', enabled: true, phrases: ['처음으로', '고객목록', '고객목록으로'] },
    { id: 'openLog', label: '경과지 열기', action: 'openLog', enabled: true, phrases: ['경과지열어', '경과지켜', '경과지보여'] },
    { id: 'openCalc', label: '계산기 열기', action: 'openCalc', enabled: true, phrases: ['계산기열어', '계산기켜', '계산기보여'] },
    { id: 'openDiagram', label: '관계도 열기', action: 'openDiagram', enabled: true, phrases: ['관계도열어', '관계도켜', '관계도보여'] },
    { id: 'openScan', label: '스캔 열기', action: 'openScan', enabled: true, phrases: ['스캔열어', '스캔켜', '스캔시작'] },
    { id: 'capture', label: '화면 캡처', action: 'capture', enabled: true, phrases: ['화면캡처', '캡처해줘', '캡처시작'] },
    { id: 'openSettings', label: '설정 열기', action: 'openSettings', enabled: true, phrases: ['설정열어', '설정보여'] },
    { id: 'hideExplorer', label: '탐색창 접기', action: 'hideExplorer', enabled: true, phrases: ['탐색창접어', '탐색창숨겨', '탐색창생략'] },
    { id: 'showExplorer', label: '탐색창 펼치기', action: 'showExplorer', enabled: true, phrases: ['탐색창보여', '탐색창펼쳐'] },
    { id: 'darkOn', label: '다크모드 켜기', action: 'darkOn', enabled: true, phrases: ['다크모드켜', '다크모드시작'] },
    { id: 'darkOff', label: '다크모드 끄기', action: 'darkOff', enabled: true, phrases: ['다크모드꺼', '다크모드해제'] },
    { id: 'save', label: '저장', action: 'save', enabled: true, phrases: ['저장해줘', '저장해'] }
  ];

  function loadVoiceCommands(){
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(VOICE_COMMANDS_KEY) || 'null'); }catch(err){ saved = null; }
    if (!Array.isArray(saved)) return DEFAULT_VOICE_COMMANDS.map(c => Object.assign({}, c));
    // 저장된 목록을 기본으로 하되, 새 버전에서 추가된 기본 명령이 있으면 뒤에 채워넣음(id 기준)
    const savedIds = new Set(saved.map(c => c.id));
    const merged = saved.slice();
    DEFAULT_VOICE_COMMANDS.forEach(def => { if (!savedIds.has(def.id)) merged.push(Object.assign({}, def)); });
    return merged;
  }
  let voiceCommands = loadVoiceCommands();

  function renderVoiceCommandSettings(){
    const wrap = document.getElementById('voiceCommandList');
    wrap.innerHTML = '';
    voiceCommands.forEach((cmd, idx)=>{
      const row = document.createElement('div');
      row.className = 'voice-command-row';
      row.innerHTML =
        '<input type="checkbox" data-idx="' + idx + '" class="vc-enabled"' + (cmd.enabled ? ' checked' : '') + '>' +
        '<span class="vc-label">' + escapeHtml(cmd.label) + '</span>' +
        '<input type="text" data-idx="' + idx + '" class="vc-phrases" value="' + escapeHtml(cmd.phrases.join(', ')) + '">';
      wrap.appendChild(row);
    });
  }

  function readVoiceCommandSettingsFromUi(){
    document.querySelectorAll('.vc-enabled').forEach(el=>{
      voiceCommands[Number(el.dataset.idx)].enabled = el.checked;
    });
    document.querySelectorAll('.vc-phrases').forEach(el=>{
      voiceCommands[Number(el.dataset.idx)].phrases = el.value.split(',').map(s => s.trim()).filter(Boolean);
    });
  }

  document.getElementById('btnResetVoiceCommands').addEventListener('click', ()=>{
    voiceCommands = DEFAULT_VOICE_COMMANDS.map(c => Object.assign({}, c));
    renderVoiceCommandSettings();
  });

  // 명령별 실제 동작 — 처리했으면 확인 메시지를, 애매해서 AI에게 넘겨야 하면 null을 반환
  function runVoiceAction(action){
    switch(action){
      case 'up':
        if (explorerPath.length > 0){ navigateTo(explorerPath.slice(0, -1)); return '상위 폴더로 이동했습니다.'; }
        return '이미 최상위 폴더입니다.';
      case 'down':
        if (lastRenderedFolders.length === 1){
          navigateTo(explorerPath.concat([lastRenderedFolders[0].name]));
          return lastRenderedFolders[0].name + ' 폴더로 이동했습니다.';
        }
        return null; // 여러 개거나 없으면 애매하니 AI에게
      case 'home':
        navigateTo(basePath);
        return '고객 목록으로 이동했습니다.';
      case 'openLog': openLogView(); return '경과지 열었습니다.';
      case 'openCalc': openCalcView(); return '계산기 열었습니다.';
      case 'openDiagram': openDiagramView(); return '관계도 열었습니다.';
      case 'openScan': openScanModal(); return '스캔 열었습니다.';
      case 'capture': captureScreen(); return '화면 캡처를 시작합니다.';
      case 'openSettings': openSettingsModal(); return '설정 열었습니다.';
      case 'hideExplorer': setWorkspaceMode('hide'); return '탐색창을 접었습니다.';
      case 'showExplorer': setWorkspaceMode('row'); return '탐색창을 펼쳤습니다.';
      case 'darkOn': applyDarkMode(true); localStorage.setItem(DARK_MODE_KEY, '1'); return '다크모드를 켰습니다.';
      case 'darkOff': applyDarkMode(false); localStorage.setItem(DARK_MODE_KEY, '0'); return '다크모드를 껐습니다.';
      case 'save':
        if (calcView.style.display !== 'none'){ saveCalc(); return '계산기를 저장했습니다.'; }
        if (diagramView.style.display !== 'none'){ saveDiagram(); return '관계도를 저장했습니다.'; }
        if (logView.style.display !== 'none'){ return '경과지는 추가할 때 자동으로 저장됩니다.'; }
        return null;
      default:
        return null;
    }
  }

  // 처리했으면 확인 메시지(문자열)를, 애매해서 AI에게 넘겨야 하면 null을 반환한다.
  function tryInstantVoiceCommand(text){
    const t = text.replace(/\s+/g, ''); // 음성인식이 띄어쓰기를 제멋대로 넣는 경우가 많아 비교 전 제거

    for (const cmd of voiceCommands){
      if (!cmd.enabled) continue;
      const hit = cmd.phrases.some(p => p && t.includes(p.replace(/\s+/g, '')));
      if (hit){
        const result = runVoiceAction(cmd.action);
        if (result !== null) return result; // null이면(애매함) 다른 후보나 AI로 계속 넘어감
      }
    }

    // 지금 화면에 보이는 하위 폴더 이름이 언급되면 그 폴더로 바로 이동 (동적으로 결정되므로 목록 편집 대상이 아님)
    if (/열어|가줘|이동|들어가/.test(t)){
      const matched = lastRenderedFolders.find(f => t.includes(f.name.replace(/\s+/g, '')));
      if (matched){
        navigateTo(explorerPath.concat([matched.name]));
        return matched.name + ' 폴더로 이동했습니다.';
      }
    }

    return null; // 못 알아들은 패턴은 그대로 AI에게 넘김
  }

  // ---- 음성모드 (마이크 버튼) — 한 번 켜면 계속 유지되는 대화형. 끄거나(다시 클릭)
  // 메시지창에 직접 타이핑을 시작하면 자동으로 꺼진다. "한 번 듣고 끝"이 아니다. ----
  const btnVoiceInput = document.getElementById('btnVoiceInput');
  const btnVoiceInputFlip = document.getElementById('btnVoiceInputFlip');
  const flipVoiceStatus = document.getElementById('flipVoiceStatus');
  const flipVoiceIcon = document.getElementById('flipVoiceIcon');
  const flipVoiceText = document.getElementById('flipVoiceText');
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSpeechSynthesis = 'speechSynthesis' in window;
  let voiceRecognition = null;
  let isVoiceRecording = false;
  let voiceTriggeredSend = false; // 이번 전송이 음성으로 시작됐는지 — sendChatMessage에서 답변을 읽어줄지 판단
  // voiceModeOn·voicePhase('idle'|'listening'|'thinking'|'speaking')는 스크립트 앞쪽에서 이미 선언됨
  // (상단바 반응형의 커버화면모드 판단 로직이 더 일찍 참조해야 해서 그쪽으로 끌어올려둠).

  // ---- "생각 중" 살아있음 표시(하트비트) ----
  // 예전엔 voicePhase가 'thinking'인 동안 "AI 응답 준비 중…" 문구만 고정으로 떠 있어서, 답변이
  // 오래 걸릴 때 멈춘 건지 아직 생각 중인지 구분할 수 없었다. 이제 (1) 점을 천천히 늘렸다
  // 줄였다 하는 문구, (2) 아이콘이 은은하게 커졌다 작아지는 펄스 애니메이션, (3) 몇 초 간격으로
  // 아주 작은 소리로 "틱" 소리를 내는 3가지 신호로 "아직 살아서 생각 중"임을 알린다(너무 요란하지
  // 않게 — 소리는 짧고 작게, 간격도 4초로 넉넉하게 뒀다).
  let voiceThinkingDotsTimer = null;
  let voiceThinkingTickTimer = null;
  let voiceThinkingDotsCount = 0;
  let voiceThinkingAudioCtx = null;

  function getVoiceThinkingAudioCtx_(){
    if (!voiceThinkingAudioCtx){
      try { voiceThinkingAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e){ return null; }
    }
    return voiceThinkingAudioCtx;
  }

  // 아주 짧고(0.15초) 작은 볼륨의 "틱" — 알림음이라기보다 "심장박동"에 가깝게, 거슬리지 않도록 설계.
  function playVoiceThinkingTick_(){
    const ctx = getVoiceThinkingAudioCtx_();
    if (!ctx) return;
    try{
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.02); // 작은 볼륨
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    }catch(e){}
  }

  function startVoiceThinkingIndicator_(){
    if (voiceThinkingDotsTimer) return; // 이미 켜져 있으면 다시 시작하지 않음(문구 깜빡임 방지)
    flipVoiceIcon.classList.add('thinking');
    voiceThinkingDotsCount = 0;
    flipVoiceText.textContent = 'AI 응답 준비 중';
    voiceThinkingDotsTimer = setInterval(()=>{
      voiceThinkingDotsCount = (voiceThinkingDotsCount + 1) % 4;
      flipVoiceText.textContent = 'AI 응답 준비 중' + '.'.repeat(voiceThinkingDotsCount);
    }, 550);
    voiceThinkingTickTimer = setInterval(playVoiceThinkingTick_, 4000);
  }

  function stopVoiceThinkingIndicator_(){
    if (voiceThinkingDotsTimer){ clearInterval(voiceThinkingDotsTimer); voiceThinkingDotsTimer = null; }
    if (voiceThinkingTickTimer){ clearInterval(voiceThinkingTickTimer); voiceThinkingTickTimer = null; }
    flipVoiceIcon.classList.remove('thinking');
  }

  // 마이크 버튼 2개(입력창 옆 · 커버화면모드용) + 커버화면모드 상태문구까지 한 번에 지금 상태로 맞춘다.
  function updateVoiceUi(){
    [btnVoiceInput, btnVoiceInputFlip].forEach(btn=>{
      btn.classList.remove('recording', 'voice-mode-on');
      if (isVoiceRecording) btn.classList.add('recording');
      else if (voiceModeOn) btn.classList.add('voice-mode-on');
      btn.textContent = isVoiceRecording ? '●' : '🎤';
    });
    flipVoiceIcon.classList.remove('listening', 'speaking');
    if (isVoiceRecording){
      stopVoiceThinkingIndicator_();
      flipVoiceIcon.classList.add('listening');
      flipVoiceText.textContent = '듣는 중…';
    } else if (voicePhase === 'thinking'){
      startVoiceThinkingIndicator_();
    } else if (voicePhase === 'speaking'){
      stopVoiceThinkingIndicator_();
      flipVoiceIcon.classList.add('speaking');
      flipVoiceText.textContent = '말하는 중…';
    } else if (voiceModeOn){
      stopVoiceThinkingIndicator_();
      flipVoiceText.textContent = '다시 듣기 준비 중…';
    } else {
      stopVoiceThinkingIndicator_();
      flipVoiceText.textContent = '마이크를 눌러 음성모드를 시작하세요';
    }
  }

  // [패치 2026.07 — 버그#6] 마크다운 기호를 그대로 읽어버리는 문제 대응.
  // 백엔드(Code.gs)가 음성턴에는 마크다운을 안 쓰도록 이미 지시받지만, AI가 실수로
  // 섞어 쓰는 경우에 대비해 클라이언트에서도 한 번 더 걸러낸다(이중 안전망).
  function stripMarkdownForSpeech_(s){
    return s
      .replace(/```[\s\S]*?```/g, '') // 코드블록 통째로 제거(읽어봐야 의미 없음)
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')     // 헤더 #
      .replace(/\*\*([^*]+)\*\*/g, '$1') // **굵게**
      .replace(/\*([^*]+)\*/g, '$1')     // *기울임*
      .replace(/^\s*[-*+]\s+/gm, '')     // 목록 기호
      .replace(/^\s*\d+\.\s+/gm, '')     // 번호목록
      .replace(/^>\s?/gm, '')            // blockquote 기호
      .replace(/\|/g, ' ')               // 표 구분선
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 링크 [글자](url) → 글자만
      .replace(/[⚠️✅❌ℹ️◇■□●○▸]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
  }

  // AI 응답 텍스트를 소리로 읽어줌 (문서수정 제안의 <<<EDIT_DOCUMENT>>> 원문 덩어리는 읽지 않고, 앞뒤 설명만 읽음)
  function speakReply(text){
    let spoken = (text || '');

    const ns = spoken.indexOf(NAV_START), ne = spoken.indexOf(NAV_END);
    if (ns !== -1 && ne !== -1 && ne > ns){
      spoken = (spoken.slice(0, ns) + spoken.slice(ne + NAV_END.length)).trim();
    }
    const s = spoken.indexOf(EDIT_START), en = spoken.indexOf(EDIT_END);
    if (s !== -1 && en !== -1 && en > s){
      const before = spoken.slice(0, s).trim();
      const after = spoken.slice(en + EDIT_END.length).trim();
      spoken = [before, after].filter(Boolean).join(' ') || '문서 수정안을 준비했습니다. 편집기에 적용하기 버튼을 눌러주세요.';
    }
    spoken = stripMarkdownForSpeech_(spoken);

    if (!hasSpeechSynthesis || !spoken){
      voicePhase = 'idle';
      updateVoiceUi();
      if (voiceModeOn) startVoiceRecognition(); // 읽을 내용이 없어도 음성모드면 곧바로 다시 듣기 시작
      return;
    }

    // [패치 2026.07 — 버그#6] "마이크는 켜져 있는데 AI가 동시에 말하는" 상황을 막기 위한
    // 안전장치. 정상 흐름이면 이 시점엔 이미 recognition이 꺼져 있어야 하지만, 모바일
    // 브라우저에서 onend가 늦게/안 불리는 경우를 대비해 말하기 시작 직전에 한 번 더
    // 확실히 끈다(abort는 onresult를 발생시키지 않고 즉시 멈춘다 — stop과 달리 안전).
    if (voiceRecognition && isVoiceRecording){
      try{ voiceRecognition.abort(); }catch(e){}
    }

    voicePhase = 'speaking';
    window.speechSynthesis.cancel(); // 이전에 읽던 게 남아있으면 끊고 새로 읽기
    const utter = new SpeechSynthesisUtterance(spoken);
    utter.lang = 'ko-KR';
    utter.onstart = ()=>{
      btnVoiceInput.disabled = true; btnVoiceInputFlip.disabled = true; // AI가 말하는 동안 마이크가 그 소리를 다시 듣지 않게 잠금
      updateVoiceUi();
    };
    const afterSpeak = ()=>{
      btnVoiceInput.disabled = false; btnVoiceInputFlip.disabled = false;
      voicePhase = 'idle';
      updateVoiceUi();
      if (voiceModeOn) startVoiceRecognition(); // 음성모드가 계속 켜져있으면, 다 읽자마자 곧바로 다음 질문을 듣기 시작
    };
    utter.onend = afterSpeak;
    utter.onerror = afterSpeak;
    window.speechSynthesis.speak(utter);
  }

  function startVoiceRecognition(){
    if (!SpeechRecognitionCtor || isVoiceRecording) return;
    if (hasSpeechSynthesis) window.speechSynthesis.cancel();
    voicePhase = 'listening';

    voiceRecognition = new SpeechRecognitionCtor();
    voiceRecognition.lang = 'ko-KR';
    // [패치 2026.07 — 버그#6: "말이 끝나지도 않았는데 마이크가 꺼진다"]
    // 예전엔 interimResults:false + continuous 미지정(기본값 false)이었다. 이 조합이면
    // 브라우저 내장 엔드포인터가 문장 중간의 짧은 호흡·쉼만 감지해도 "발화 종료"로 판단해
    // 버려서, 사용자가 말을 채 끝내기도 전에 마이크가 꺼지곤 했다. continuous:true +
    // interimResults:true로 바꾸고, 대신 "마지막 소리 이후 1.1초 동안 조용하면 그때
    // 진짜로 말이 끝난 것"으로 우리가 직접 판단하는 무음 타이머를 둔다 — 말하는 도중에는
    // 계속 타이머가 리셋되므로 문장 중간에 끊기지 않는다.
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 1;

    let accumulatedFinal = '';
    let silenceTimer = null;
    const SILENCE_MS = 1100;

    function finalizeUtterance(){
      const transcript = accumulatedFinal.trim();
      accumulatedFinal = '';
      if (silenceTimer){ clearTimeout(silenceTimer); silenceTimer = null; }
      try{ voiceRecognition.stop(); }catch(e){}
      if (!transcript) return;

      const instantReply = tryInstantVoiceCommand(transcript);
      if (instantReply !== null){
        voicePhase = 'thinking'; // onend가 이 상태를 보고 "결과 없이 끝난 것"과 구분해서 중복 재시작하지 않음
        appendBubble('user', transcript);
        appendBubble('assistant', '⚡ ' + instantReply);
        speakReply(instantReply); // 다 읽고 나면 음성모드가 켜져 있는 한 speakReply가 알아서 다시 듣기 시작함
        return; // 흔한 패턴이면 AI 호출 없이 여기서 끝
      }

      voicePhase = 'thinking';
      chatInputEl.value = transcript;
      voiceTriggeredSend = true;
      sendChatMessage(); // 말이 끝나면 바로 전송 (엔터/버튼 없이) — 응답 후 speakReply에서 이어서 다시 듣기 시작
    }

    voiceRecognition.onstart = ()=>{
      isVoiceRecording = true;
      chatInputEl.disabled = true; // 음성 인식 중엔 타이핑과 섞여서 덮어써지는 사고를 막기 위해 잠금
      chatInputEl.placeholder = '음성 인식 중…';
      updateVoiceUi();
    };
    voiceRecognition.onresult = (e)=>{
      // continuous 모드라 결과가 여러 번에 걸쳐 누적된다. 이번 이벤트에 새로 들어온
      // 부분(resultIndex부터)만 훑어서 확정(final)된 조각은 누적하고, 아직 확정 안 된
      // interim 조각까지 포함해서 "지금 소리가 감지되고 있다"고 보고 무음 타이머를 리셋한다.
      if (silenceTimer) clearTimeout(silenceTimer);
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++){
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) accumulatedFinal += chunk;
        else interim += chunk;
      }
      if (!accumulatedFinal.trim() && !interim.trim()) return;
      silenceTimer = setTimeout(finalizeUtterance, SILENCE_MS);
    };
    voiceRecognition.onerror = (e)=>{
      if (e.error !== 'no-speech' && e.error !== 'aborted'){
        showToast('음성 인식 중 오류: ' + e.error, 'error');
        voiceModeOn = false; // 실제 오류(권한 거부 등)면 무한히 재시도하지 않도록 음성모드 자체를 끔
      }
      // no-speech(그냥 아무 말도 안 들린 경우)는 흔하니 무시하고 onend에서 이어서 재시작됨
    };
    voiceRecognition.onend = ()=>{
      isVoiceRecording = false;
      chatInputEl.placeholder = '메시지 입력';
      if (!currentChatAbortController) chatInputEl.disabled = false;
      if (silenceTimer){ clearTimeout(silenceTimer); silenceTimer = null; }
      // voicePhase가 아직 'listening'이면 onresult가 한 번도 확정되지 않은 채 끝났다는 뜻이다.
      // (예: 브라우저가 continuous 모드를 일정 시간 뒤 자체 종료한 경우) — 그래도 그때까지
      // 모아둔 확정 텍스트가 있으면 그걸로 마무리 처리하고, 전혀 없으면 그냥 다시 듣기 시작한다.
      if (voicePhase === 'listening'){
        if (accumulatedFinal.trim()){ finalizeUtterance(); return; }
        voicePhase = 'idle';
        updateVoiceUi();
        if (voiceModeOn) startVoiceRecognition();
      } else {
        updateVoiceUi();
      }
    };
    voiceRecognition.start();
  }

  function stopVoiceMode(){
    voiceModeOn = false;
    voicePhase = 'idle';
    if (voiceRecognition) voiceRecognition.stop();
    if (hasSpeechSynthesis) window.speechSynthesis.cancel();
    updateVoiceUi();
  }

  function toggleVoiceMode(){
    if (voiceModeOn){
      stopVoiceMode();
      return;
    }
    voiceModeOn = true;
    updateVoiceUi();
    startVoiceRecognition();
  }

  // ---- 토킹모드(커버화면모드 전용 2번째 화면) 진입/이탈 ----
  // 커버화면모드(플립폰 커버처럼 아주 작은 폰)에 들어가면 기본은 "채팅모드"(평소와 같은 채팅화면 +
  // 하단에 마이크 버튼 하나)이고, 그 마이크를 누르면 "토킹모드"(body.talking-mode, 음성전용 큰 화면)로
  // 전환된다. 커버화면모드가 아닐 때는 이 함수들을 쓰지 않는다(일반 폰·PC의 마이크는 그냥 음성모드
  // on/off만 함 — toggleVoiceMode 그대로).
  const btnExitTalkingMode = document.getElementById('btnExitTalkingMode');

  function enterTalkingMode(){
    if (!document.body.classList.contains('cover-mode')) return;
    document.body.classList.add('talking-mode');
    if (!voiceModeOn) toggleVoiceMode(); // 토킹모드로 들어가는 순간 바로 듣기 시작
    else updateVoiceUi();
  }

  function exitTalkingMode(){
    document.body.classList.remove('talking-mode');
    if (voiceModeOn) stopVoiceMode();
  }

  if (!SpeechRecognitionCtor){
    btnVoiceInput.title = '이 브라우저는 음성 입력을 지원하지 않습니다 (크롬 권장)';
    btnVoiceInput.style.opacity = '0.4';
    btnVoiceInputFlip.style.opacity = '0.4';
    flipVoiceText.textContent = '이 브라우저는 음성 입력을 지원하지 않습니다 (크롬 권장)';
  } else {
    // 커버화면모드에서는 마이크를 누르면 토킹모드로 전환(+ 곧바로 듣기 시작), 그 외(일반 폰·PC)에서는
    // 예전처럼 화면 전환 없이 음성모드만 켜고 끈다.
    function handleMicClick(){
      if (document.body.classList.contains('cover-mode') && !document.body.classList.contains('talking-mode')){
        enterTalkingMode();
      } else {
        toggleVoiceMode();
      }
    }
    btnVoiceInput.addEventListener('click', handleMicClick);
    btnVoiceInputFlip.addEventListener('click', handleMicClick);

    // 토킹모드 화면 안의 "채팅모드로" 버튼 — 누르면 음성모드를 끄고 채팅모드로 돌아간다.
    // 이 버튼도 .panel.chat 안에 있으므로, 아래 "화면 전체 클릭" 리스너까지 같이 반응해서
    // 끄자마자 다시 켜지는 걸 막기 위해 클릭 전파를 막는다.
    btnExitTalkingMode.addEventListener('click', (e)=>{
      e.stopPropagation();
      exitTalkingMode();
    });

    // 토킹모드에서는 화면(채팅패널) 어디를 눌러도 음성모드가 켜지고 꺼진다 — 작은 아이콘만
    // 정확히 눌러야 하는 부담을 없애기 위해 탭 영역을 화면 전체로 넓혔다. 채팅모드(기본 상태)에서는
    // 평소처럼 채팅을 그대로 눌러야 하므로 이 동작을 적용하지 않는다.
    chatPanelEl.addEventListener('click', ()=>{
      if (document.body.classList.contains('cover-mode') && document.body.classList.contains('talking-mode')) toggleVoiceMode();
    });
    // 메시지창에 직접 타이핑을 시작하면 음성모드를 자동으로 끈다 — 켜진 채로 타이핑하면
    // 다음 인식 재시작 때 타이핑한 걸 지워버릴 수 있어서 그 사고를 막는다.
    chatInputEl.addEventListener('input', ()=>{ if (voiceModeOn) stopVoiceMode(); });

    // 커버화면모드(아주 작은 폰) 이탈 — 상단바 반응형 로직이 쏘는 이벤트를 받아서 처리.
    // 화면이 커져서 커버화면모드를 벗어나면, 음성모드가 켜져있었다면 꺼주고(화면이 커졌는데
    // 마이크가 계속 켜진 채로 남는 놀람 방지) 토킹모드도 함께 해제해서, 나중에 다시 좁아져
    // 커버화면모드로 들어올 때는 항상 기본값인 채팅모드부터 다시 시작하게 한다.
    document.addEventListener('nx:covermode', (e)=>{
      if (!e.detail.on){
        if (voiceModeOn) stopVoiceMode();
        document.body.classList.remove('talking-mode');
      }
    });
  }

