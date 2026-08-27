  // ============================================================
  // 설정 — 아래 두 값만 채우면 실제 데이터로 동작합니다.
  // ============================================================
  // GAS_URL은 /config.js(window.NX_CONFIG) 하나로 통합 관리됩니다 — report-writer/index.html도 동일 파일을 참조.
  // config.js 로드 실패 시를 대비해 마지막에 쓰던 값을 폴백으로 남겨둡니다.
  const GAS_URL = (window.NX_CONFIG && window.NX_CONFIG.GAS_URL)
    || 'https://script.google.com/macros/s/AKfycbyFbvXiV6rSzCvhtc_T2WrzNF5ZxhOFWtSSsgzSavzPbjv4LBGhjXhu_Q2_8m-PDj8s/exec';
  // 예전에는 'https://work.netax.kr/report-writer/'로 도메인을 고정해뒀었는데,
  // 그러면 나중에 dev.netax.kr 같은 테스트용 사본 도메인에서 열어도 편집기는 항상
  // 진짜 실서비스(work.netax.kr) 쪽을 열어버리는 문제가 있었다. location.origin으로
  // "지금 이 페이지가 열려 있는 도메인"을 그대로 따라가게 하면, 사본 도메인에서 테스트할 때도
  // 그 사본의 report-writer가 열려서 진짜 쌍둥이 테스트가 가능해진다.
  const REPORT_WRITER_URL = location.origin + '/report-writer/';

  // ============================================================
  // 토스트 알림 (기존 alert 대체) — 앞으로 추가되는 기능도 이 함수 하나로 알림을 띄우면 됨.
  // type: 'info'(기본) | 'error' | 'warning' | 'success'
  // ============================================================
  function showToast(message, type){
    const host = document.getElementById('nxToastHost');
    if (!host){ console.warn('[toast]', type || 'info', message); return; }
    const el = document.createElement('div');
    el.className = 'nx-toast' + (type ? ' ' + type : '');
    el.textContent = message;
    const duration = type === 'error' ? 6000 : 4000;
    let dismissed = false;
    const dismiss = ()=>{
      if (dismissed) return;
      dismissed = true;
      el.classList.remove('show');
      setTimeout(()=>el.remove(), 200);
    };
    el.addEventListener('click', dismiss);
    host.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(dismiss, duration);
  }

  // ============================================================
  // 다크모드 (설정 모달 안 체크박스로 관리, 바꾸면 바로 적용)
  // ============================================================
  const DARK_MODE_KEY = 'nx_dark_mode';
  function applyDarkMode(on){
    document.body.classList.toggle('dark-mode', on);
  }
  const savedDark = localStorage.getItem(DARK_MODE_KEY);
  applyDarkMode(savedDark === null ? window.matchMedia('(prefers-color-scheme: dark)').matches : savedDark === '1');

  // ============================================================
  // 채팅창 글자 크기 조절 — 채팅패널 상단의 "가-/가+" 버튼으로 조절하며, 화면 크기·레이아웃과
  // 무관하게(좌우/상하/생략/커버화면 등 전부) 항상 적용되고 다음 방문에도 유지된다.
  // [2026.08] 태블릿에서 "최대"로 키워도 작다는 피드백이 있어 상한을 22→32로 크게 올렸고,
  // 터치기기(태블릿/폰으로 추정)에서 이 브라우저로 처음 접속하는 경우(저장된 값이 없을 때)엔
  // PC 기본값보다 몇 단계 큰 값을 기본으로 잡아준다 — 이후엔 여느 때처럼 사용자가 조절한 값이
  // 그대로 저장되어 우선한다.
  // ============================================================
  const CHAT_FONT_SIZE_KEY = 'nx_chat_font_size';
  const CHAT_FONT_MIN = 12, CHAT_FONT_MAX = 32, CHAT_FONT_DEFAULT = 13.5, CHAT_FONT_STEP = 1;
  // 터치 포인터(마우스 없음) + 화면폭 1366px 이하 정도면 태블릿/폰으로 간주 — 정밀한 기기 판별이
  // 목적이 아니라 "이 조합이면 글자가 작아 보일 가능성이 높다"는 실용적인 추정이라 이 정도로 충분함.
  const isLikelyTouchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const CHAT_FONT_DEFAULT_TOUCH = 18;
  function applyChatFontSize(px){
    document.documentElement.style.setProperty('--chat-font-size', px + 'px');
  }
  let chatFontSize = parseFloat(localStorage.getItem(CHAT_FONT_SIZE_KEY));
  if (!Number.isFinite(chatFontSize)){
    chatFontSize = (isLikelyTouchDevice && window.innerWidth <= 1366) ? CHAT_FONT_DEFAULT_TOUCH : CHAT_FONT_DEFAULT;
  }
  applyChatFontSize(chatFontSize);

  function changeChatFontSize(delta){
    chatFontSize = Math.min(CHAT_FONT_MAX, Math.max(CHAT_FONT_MIN, chatFontSize + delta));
    applyChatFontSize(chatFontSize);
    localStorage.setItem(CHAT_FONT_SIZE_KEY, String(chatFontSize));
  }
  document.getElementById('btnChatFontDown').addEventListener('click', ()=> changeChatFontSize(-CHAT_FONT_STEP));
  document.getElementById('btnChatFontUp').addEventListener('click', ()=> changeChatFontSize(CHAT_FONT_STEP));


  // ============================================================
  // 레이아웃 전환: 좌우배치 → 상하배치 → 탐색기 생략 → 탐색기 띄우기 — 버튼 하나로 순환
  // ============================================================
  const workspace = document.getElementById('workspace');
  const explorerPanelEl = document.querySelector('.panel.explorer');
  const btnWorkspaceMode = document.getElementById('btnWorkspaceMode');
  const workspaceModeIcon = document.getElementById('workspaceModeIcon');
  const workspaceModeLabel = document.getElementById('workspaceModeLabel');
  const WORKSPACE_MODE_KEY = 'nx_workspace_mode'; // 'row' | 'col' | 'hide' | 'float' | 'max'
  const WORKSPACE_MODES = ['row', 'col', 'hide', 'float', 'max'];
  // [2026.08] label은 grouped·compact 단계의 균등폭 버튼(#workspaceModeLabel)에도 그대로 쓰인다 —
  // full(넓은 PC)의 5개 개별 버튼(index.html에 직접 박힌 Row 등)과 항상 같은 풀네임으로 통일.
  const WORKSPACE_MODE_META = {
    row:   { icon: '⬓', label: 'Row', title: '좌우 배치 (클릭할 때마다 순환: 좌우 → 상하 → 생략 → 띄우기 → 최대)' },
    col:   { icon: '⬒', label: 'Col', title: '상하 배치 (클릭할 때마다 순환: 좌우 → 상하 → 생략 → 띄우기 → 최대)' },
    hide:  { icon: '💬', label: 'Hide', title: '탐색기 생략 · 채팅만 (클릭할 때마다 순환: 좌우 → 상하 → 생략 → 띄우기 → 최대)' },
    float: { icon: '🗗', label: 'Float', title: '탐색기 띄우기 · 채팅 위에 잠깐 보기 (클릭할 때마다 순환: 좌우 → 상하 → 생략 → 띄우기 → 최대)' },
    max:   { icon: '⛶', label: 'Max', title: '채팅 끄기 · 탐색작업창 최대화, 편집창을 크게 보는 용도 (클릭하면 다시 좌우 배치로)' }
  };
  // 넓은 화면에서 보이는 5개 버튼(직접 선택용) — 지금 모드에 해당하는 것만 강조 표시
  const layoutModeButtons = {
    row: document.getElementById('btnLayoutRow'),
    col: document.getElementById('btnLayoutCol'),
    hide: document.getElementById('btnLayoutHide'),
    float: document.getElementById('btnLayoutFloat'),
    max: document.getElementById('btnLayoutMax')
  };

  function applyWorkspaceMode(mode){
    workspace.classList.toggle('layout-row', mode === 'row' || mode === 'hide' || mode === 'float' || mode === 'max');
    workspace.classList.toggle('layout-col', mode === 'col');
    workspace.classList.toggle('explorer-collapsed', mode === 'hide' || mode === 'float');
    workspace.classList.toggle('explorer-floating', mode === 'float');
    // '최대'(채팅 끄고 탐색작업창을 꽉 채움)는 예전엔 별도의 독립된 스위치(chat-collapsed)였는데,
    // 그래서 분리대를 왼쪽 끝까지 밀면 이 스위치만 조용히 켜지고 창전환 버튼(⬓)은 그걸 모르는
    // 상태가 되어 "분리대가 죽은 것처럼" 보였다. 이제 이 모드 체계 안으로 완전히 합쳤다.
    workspace.classList.toggle('chat-collapsed', mode === 'max');
    // [2026.08] 띄우기 모드에서 드래그로 옮긴 위치는 그 모드 안에서만 의미가 있다 — 다른
    // 배치로 바뀌면 남아있는 인라인 위치값이 그쪽 레이아웃까지 망가뜨리므로 초기화한다.
    if (mode !== 'float'){
      explorerPanelEl.style.left = '';
      explorerPanelEl.style.top = '';
      explorerPanelEl.style.right = '';
      explorerPanelEl.style.bottom = '';
      explorerPanelEl.style.width = '';
      explorerPanelEl.style.height = '';
    }
    workspaceModeIcon.textContent = WORKSPACE_MODE_META[mode].icon;
    workspaceModeLabel.textContent = WORKSPACE_MODE_META[mode].label;
    btnWorkspaceMode.title = WORKSPACE_MODE_META[mode].title;
    Object.keys(layoutModeButtons).forEach(m => layoutModeButtons[m].classList.toggle('is-on', m === mode));
  }
  // 폰(compact 단계)에서는 화면 방향에 따라 실제로 못 쓰는 배치가 있다 —
  // 세로로 들면 좌우배치(row)는 각 창이 너무 좁아져 못 쓰고, 가로로 돌리면 상하배치(col)는
  // 각 창이 너무 낮아져 못 쓴다. PC/탭(compact 아님)에서는 화면이 넉넉하므로 늘 4개 다 쓸 수 있다.
  function isModeAvailable(mode){
    if (!document.body.classList.contains('stage-compact')) return true;
    const isPortrait = window.innerHeight > window.innerWidth;
    if (mode === 'row' && isPortrait) return false;
    if (mode === 'col' && !isPortrait) return false;
    return true;
  }
  // 화면 크기·방향에 맞춘 스마트 디폴트: 크거나 가로모드→우측, 작거나 세로모드→아래, 폰 크기→생략
  function detectDefaultMode(){
    const w = window.innerWidth, h = window.innerHeight;
    if (w < 640) return 'hide';   // 폰 크기 화면
    if (w >= h) return 'row';     // 가로모드거나 충분히 넓은 화면
    return 'col';                 // 세로모드의 작거나 중간 크기 화면(탭 등)
  }
  function setWorkspaceMode(mode){
    // 지금 방향에서 못 쓰는 배치를 요청받으면(음성명령 등 어디서 오든) "생략"으로 안전하게 대체
    const safeMode = isModeAvailable(mode) ? mode : 'hide';
    applyWorkspaceMode(safeMode); // chat-collapsed 등은 여기서 mode 기준으로 전부 선언적으로 정해지므로, 예전처럼 따로 되돌려줄 필요가 없어졌다.
    localStorage.setItem(WORKSPACE_MODE_KEY, safeMode);
    applySavedSplit();
  }

  // ---- 채팅창 끄기(= '최대' 모드)의 예전 이름 호환용 헬퍼 ----
  // 2026.07: 예전엔 이게 창전환(⬓) 체계와 완전히 분리된 독립 버튼·스위치였다. 그래서 분리대를
  // 왼쪽 끝까지 밀면 이 스위치만 조용히 켜지고 ⬓ 버튼은 그걸 몰라서, 분리대가 사라진 채
  // "죽은 것처럼" 보이는 문제가 있었다. 이제 '최대(max)' 모드로 완전히 합쳐서(전용 버튼은
  // ⛶ 최대 하나로 통일), 어느 경로로 들어오든(버튼 클릭이든 분리대를 끝까지 밀든) 항상 같은
  // 상태·같은 버튼 표시로 수렴한다. 예전 독립 버튼(💬 채팅 끄기)은 중복이라 제거했다.
  const CHAT_COLLAPSED_KEY = 'nx_chat_collapsed'; // 예전 버전 데이터 이전(마이그레이션) 용도로만 유지
  function setChatCollapsed(collapsed){
    setWorkspaceMode(collapsed ? 'max' : detectDefaultMode());
  }

  // ---- 탐색기 "띄우기" 모드 — 패널 헤더를 잡고 화면 아무 곳으로나 드래그 ----
  // [2026.08] 예전엔 "띄우기"가 화면 중앙에 고정된 위치로만 열렸다 — 진짜 떠 있는 창처럼
  // 자유롭게 옮길 수 있어야 한다는 지적으로 추가. 헤더(breadcrumb·버튼 제외 영역)를 잡고
  // 드래그하면 그 위치로 옮겨진다. 폭·높이는 드래그를 시작하는 순간의 실제 크기로 고정한다
  // (그전까지는 CSS의 left:5vw/right:5vw로 화면 크기에 따라 자동 계산되던 상태라, 그대로
  // 두면 위치를 옮기는 도중에도 폭이 계속 흔들린다).
  const floatDragHandleEl = document.getElementById('explorerPanelHead');
  let floatDragging = false, floatDragOffsetX = 0, floatDragOffsetY = 0;
  floatDragHandleEl.addEventListener('pointerdown', (e)=>{
    if (!workspace.classList.contains('explorer-floating')) return;
    if (e.target.closest('.breadcrumb, button, a, input')) return; // 폴더 이동 등 원래 클릭 동작은 그대로 둔다
    floatDragging = true;
    const rect = explorerPanelEl.getBoundingClientRect();
    explorerPanelEl.style.width = rect.width + 'px';
    explorerPanelEl.style.height = rect.height + 'px';
    explorerPanelEl.style.right = 'auto';
    explorerPanelEl.style.bottom = 'auto';
    explorerPanelEl.style.left = rect.left + 'px';
    explorerPanelEl.style.top = rect.top + 'px';
    floatDragOffsetX = e.clientX - rect.left;
    floatDragOffsetY = e.clientY - rect.top;
    floatDragHandleEl.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  });
  floatDragHandleEl.addEventListener('pointermove', (e)=>{
    if (!floatDragging) return;
    const w = explorerPanelEl.offsetWidth, h = explorerPanelEl.offsetHeight;
    const left = Math.max(0, Math.min(window.innerWidth - w, e.clientX - floatDragOffsetX));
    const top = Math.max(0, Math.min(window.innerHeight - h, e.clientY - floatDragOffsetY));
    explorerPanelEl.style.left = left + 'px';
    explorerPanelEl.style.top = top + 'px';
  });
  function endFloatDrag(){
    floatDragging = false;
    document.body.style.userSelect = '';
  }
  floatDragHandleEl.addEventListener('pointerup', endFloatDrag);
  floatDragHandleEl.addEventListener('pointercancel', endFloatDrag);
  // (예전 버전 데이터 마이그레이션은 아래 최종 초기화 지점에서 한 번에 처리한다 — 여기서
  // 클래스를 미리 건드리면 나중에 applyWorkspaceMode가 그대로 덮어써서 의미가 없어짐)

  // ---- 채팅↔도구화면 경계선 드래그로 크기 조절 (끝까지 밀면 그 쪽이 닫힘) ----
  const panelResizer = document.getElementById('panelResizer');
  const chatPanelEl = document.querySelector('.panel.chat');
  const RESIZE_MIN_PX = 60; // 이보다 좁아지면 "닫으려는 의도"로 보고 스냅
  const SPLIT_KEY_ROW = 'nx_split_row'; // 좌우 배치일 때 채팅 패널의 폭(%)
  const SPLIT_KEY_COL = 'nx_split_col'; // 상하 배치일 때 채팅 패널의 높이(%)

  function currentSplitKey(){
    return workspace.classList.contains('layout-col') ? SPLIT_KEY_COL : SPLIT_KEY_ROW;
  }
  // 저장된 비율이 있으면 그걸로, 없으면 CSS 기본값(40%, 상하는 auto+min/max-height)으로 되돌린다.
  // 단, 채팅·탐색기 둘 중 하나만 보이는 상태(생략/띄우기/채팅끄기)에서는 절대 적용하지 않는다 —
  // 인라인 flex 스타일이 CSS 클래스 규칙(flex:1 1 100%)보다 우선순위가 높아서, 그대로 두면
  // "한쪽만 보여야 하는데 예전 분할비율이 남아서 나머지가 빈 여백으로 남는" 문제가 생긴다.
  function applySavedSplit(){
    if (workspace.classList.contains('explorer-collapsed') || workspace.classList.contains('chat-collapsed')){
      chatPanelEl.style.flex = '';
      return;
    }
    const saved = localStorage.getItem(currentSplitKey());
    chatPanelEl.style.flex = saved ? ('0 0 ' + saved + '%') : '';
  }

  let resizing = false;
  panelResizer.addEventListener('pointerdown', (e)=>{
    if (workspace.classList.contains('explorer-collapsed') || workspace.classList.contains('chat-collapsed')) return;
    resizing = true;
    panelResizer.classList.add('dragging');
    panelResizer.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  });
  panelResizer.addEventListener('pointermove', (e)=>{
    if (!resizing) return;
    const rect = workspace.getBoundingClientRect();
    const isCol = workspace.classList.contains('layout-col');
    const totalPx = isCol ? rect.height : rect.width;
    let chatPx = isCol ? (e.clientY - rect.top) : (e.clientX - rect.left);
    chatPx = Math.max(0, Math.min(totalPx, chatPx));
    chatPanelEl.style.flex = '0 0 ' + ((chatPx / totalPx) * 100).toFixed(2) + '%';
    panelResizer.dataset.chatPx = chatPx;
    panelResizer.dataset.explorerPx = totalPx - chatPx;
  });
  function endResize(e){
    if (!resizing) return;
    resizing = false;
    panelResizer.classList.remove('dragging');
    document.body.style.userSelect = '';
    const chatPx = Number(panelResizer.dataset.chatPx || 0);
    const explorerPx = Number(panelResizer.dataset.explorerPx || 0);

    if (chatPx < RESIZE_MIN_PX){
      chatPanelEl.style.flex = ''; // 다음에 다시 켤 때는 기본 비율로 시작
      setChatCollapsed(true);
      return;
    }
    if (explorerPx < RESIZE_MIN_PX){
      chatPanelEl.style.flex = '';
      setWorkspaceMode('hide');
      return;
    }
    const rect = workspace.getBoundingClientRect();
    const totalPx = workspace.classList.contains('layout-col') ? rect.height : rect.width;
    localStorage.setItem(currentSplitKey(), ((chatPx / totalPx) * 100).toFixed(2));
  }
  panelResizer.addEventListener('pointerup', endResize);
  panelResizer.addEventListener('pointercancel', endResize);

  btnWorkspaceMode.addEventListener('click', ()=>{
    const current = localStorage.getItem(WORKSPACE_MODE_KEY) || detectDefaultMode();
    let idx = WORKSPACE_MODES.indexOf(current);
    for (let step = 1; step <= WORKSPACE_MODES.length; step++){
      const candidate = WORKSPACE_MODES[(idx + step) % WORKSPACE_MODES.length];
      if (isModeAvailable(candidate)){ setWorkspaceMode(candidate); return; }
    }
    setWorkspaceMode('hide'); // 이론상 도달 안 하지만 안전장치
  });
  // 넓은 화면의 5개 버튼은 순환이 아니라 각자 자기 모드로 바로 전환
  Object.keys(layoutModeButtons).forEach(mode=>{
    layoutModeButtons[mode].addEventListener('click', ()=> setWorkspaceMode(mode));
  });
  // 초기 모드 결정: 저장된 모드가 있으면 그걸, 없는데 예전 버전의 "채팅 끄기" 데이터만 남아있으면
  // 그걸 '최대' 모드로 이전(migration)해서 반영, 둘 다 없으면 화면 크기 기준 스마트 디폴트.
  let initialMode = localStorage.getItem(WORKSPACE_MODE_KEY);
  if (!initialMode) initialMode = (localStorage.getItem(CHAT_COLLAPSED_KEY) === '1') ? 'max' : detectDefaultMode();
  if (!isModeAvailable(initialMode)) initialMode = 'hide'; // 예: 세로로 든 폰에 좌우배치가 저장돼 있던 경우 등, 처음 로드 시에도 안전하게 보정
  applyWorkspaceMode(initialMode);
  // 새 모드 체계에서는 chat-collapsed(최대)와 explorer-collapsed(생략/띄우기)가 서로 다른
  // mode 값에서만 켜지도록 선언적으로 짜여 있어 두 상태가 동시에 켜지는 경우 자체가 구조적으로
  // 불가능해졌다(예전엔 별도 스위치라 꼬일 수 있었음) — 그래서 예전에 있던 "둘 다 접힌 경우"
  // 보정 코드는 더 이상 필요 없어 제거함.
  applySavedSplit(); // layout-row/col 클래스가 확정된 뒤에 호출해야 올바른 저장키를 참조함
  // 폰을 회전시켜서 지금 쓰던 배치가 못 쓰게 되면(예: 좌우배치 중 세로로 돌림) 자동으로 안전한
  // 배치로 바꿔준다.
  window.addEventListener('resize', ()=>{
    const current = localStorage.getItem(WORKSPACE_MODE_KEY) || detectDefaultMode();
    if (!isModeAvailable(current)) setWorkspaceMode('hide');
  });

  // 커버화면모드(플립폰을 접었을 때의 아주 작은 화면) 진입/이탈 — 큰 화면(펼쳤을 때)에서 저장해둔
  // 탐색작업창 배치(좌우/상하/띄우기/최대 등)가 뭐였든, 커버화면모드 동안에는 항상 "생략"
  // (채팅만)으로 강제 표시한다. 안 그러면 큰 화면에서 좌우배치 등으로 쓰다가 폰을 접었을 때
  // 그 배치가 그대로 남아 탐색작업창이 비좁게 끼어 나오는데, 커버화면모드에서는 배치를 바꿀
  // 버튼 자체가 화면이 좁아 다 숨겨져 있어서(#workspaceModeWrap 등) 사용자가 스스로 되돌릴
  // 방법이 없었다. applyWorkspaceMode만 호출하고 setWorkspaceMode(localStorage 저장)는 쓰지
  // 않으므로, 펼쳤을 때의 원래 배치 설정 자체는 그대로 보존되며 폰을 다시 펼치면 복원된다.
  document.addEventListener('nx:covermode', (e)=>{
    if (e.detail.on){
      applyWorkspaceMode('hide');
    } else {
      const restoredMode = localStorage.getItem(WORKSPACE_MODE_KEY) || detectDefaultMode();
      applyWorkspaceMode(isModeAvailable(restoredMode) ? restoredMode : 'hide');
    }
    applySavedSplit();
  });

  // 배경(어두운 바깥 부분) 클릭하면 "띄우기"를 닫고 "생략"으로 되돌아감
  const explorerFloatBackdrop = document.getElementById('explorerFloatBackdrop');
  if (explorerFloatBackdrop){
    explorerFloatBackdrop.addEventListener('click', ()=> setWorkspaceMode('hide'));
  }

  // 오른쪽 패널(탐색기 자리) 안에 뭔가를 보여줘야 하는데 지금 "생략" 모드라면,
  // 완전히 다른 배치로 바꾸지 않고 "띄우기"로 잠깐 보여준다 (기본값은 생략으로 유지됨)
  function ensureExplorerVisible(){
    if (workspace.classList.contains('explorer-collapsed')){
      setWorkspaceMode('float');
    }
  }

