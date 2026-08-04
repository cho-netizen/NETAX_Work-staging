  // ============================================================
  // GAS 호출 (listFolder)
  // ============================================================
  // [패치 2026.07] Apps Script 웹앱은 콜드스타트·순간적인 구글 인프라 지연 등으로
  // 가끔 일시적인 오류(404/429/5xx)를 던질 때가 있다. 예전엔 이 상태 하나만 보고
  // 바로 "네트워크 오류"를 던져버려서, 고객목록처럼 처음 화면을 여는 순간의 요청이
  // 이 일시적 딸꾹질에 걸리면 바로 실패로 보였다(버그#1). 최대 2번까지 짧게 쉬었다가
  // 자동으로 다시 시도하고, 그래도 안 되면 그때 진짜 오류로 던진다.
  async function callGas(action, payload, _retryCount){
    _retryCount = _retryCount || 0;
    let res;
    try{
      res = await fetch(GAS_URL, {
        method: 'POST',
        // GAS 웹앱의 CORS preflight 회피를 위해 text/plain으로 보냄 (서버에서 JSON.parse로 처리)
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, payload))
      });
    }catch(networkErr){
      // fetch 자체가 실패(오프라인, DNS 등) — 이것도 일시적일 수 있으니 재시도 대상에 포함
      if (_retryCount < 2){
        await new Promise(r => setTimeout(r, 600 + _retryCount * 700));
        return callGas(action, payload, _retryCount + 1);
      }
      throw networkErr;
    }
    if (!res.ok){
      if (_retryCount < 2){
        await new Promise(r => setTimeout(r, 600 + _retryCount * 700));
        return callGas(action, payload, _retryCount + 1);
      }
      throw new Error('네트워크 오류 (status ' + res.status + ') — GAS_URL이 최신 배포 주소인지(config.js), 혹은 Apps Script 배포가 최근에 새로 갱신됐는지 확인해보세요.');
    }
    return res.json();
  }

  async function listFolder(path){
    const data = await callGas('listFolder', { path });
    if (data.error) throw new Error(data.error);
    return data; // { path, folderId, folders:[{id,name}], files:[{id,name,mimeType,modifiedDate,url}] }
  }

  // ============================================================
  // 상태
  // ============================================================
  const customerSelect = document.getElementById('customerSelect');
  const customerDatalist = document.getElementById('customerListOptions');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const coverPathLabel = document.getElementById('coverPathLabel'); // 커버화면모드 전용 — customerSelect 옆 작업폴더 표시
  const explorerBody = document.getElementById('explorerBody');
  const explorerView = document.getElementById('explorerView');
  const explorerPanelHead = document.getElementById('explorerPanelHead');
  const openFileStatusBar = document.getElementById('openFileStatusBar');
  const openFileStatusName = document.getElementById('openFileStatusName');

  // 오른쪽 패널 안의 모든 하위 화면(탐색기/경과지/계산기/관계도/캡처확인)을 한 번에 숨김.
  // 각 화면을 열 때 이걸 먼저 호출한 뒤 자기 화면만 다시 보이게 해서, 뒤로가기 없이 다른 도구로
  // 바로 넘어가도 이전 화면이 안 겹쳐 보이게 한다. (logView 등은 아래에서 나중에 선언되지만
  // 함수 몸통 안 참조라 실행 시점엔 이미 선언이 끝나 있어 문제없음)
  // [패치 2026.07] 예전엔 편집기(editorView)도 이 안에서 숨김/표시 대상이었지만, 이제 문서·엑셀·
  // 기타 파일 모두 독립창으로 열려서 탐색기 자체를 가릴 필요가 없어졌다 — 그래서 editorView는
  // 아예 없앴고, 이 함수는 explorerView를 숨기는 게 아니라 "다른 전용 화면(경과지 등)으로
  // 전환할 때"만 쓰인다.
  function hideAllPanelViews(){
    explorerView.style.display = 'none';
    if (typeof logView !== 'undefined' && logView) logView.style.display = 'none';
    if (typeof calcView !== 'undefined' && calcView) calcView.style.display = 'none';
    if (typeof diagramView !== 'undefined' && diagramView) diagramView.style.display = 'none';
    if (typeof captureView !== 'undefined' && captureView) captureView.style.display = 'none';
    if (typeof trashView !== 'undefined' && trashView) trashView.style.display = 'none';
    if (typeof dashboardView !== 'undefined' && dashboardView) dashboardView.style.display = 'none';
    if (typeof searchView !== 'undefined' && searchView) searchView.style.display = 'none';
    explorerPanelHead.style.display = 'none';
  }

  // explorerPath: [고객명, 사건명, ...하위 폴더들] — 항상 최소 2단계(고객/사건) 유지
  let explorerPath = [];
  // 음성모드 상태 — 실제 로직(마이크 버튼 등)은 스크립트 뒤쪽 "음성모드" 섹션에 있지만,
  // 상단바 반응형 로직(커버화면모드 진입/이탈 판단)이 이 변수를 이 시점부터 참조할 수 있어야 해서
  // 변수 선언만 미리 여기로 끌어올려둔다(let은 함수선언과 달리 호이스팅되지 않아 먼저 선언 필요).
  let voiceModeOn = false;
  let voicePhase = 'idle'; // 'idle' | 'listening' | 'thinking' | 'speaking'
  // 디폴트(작업대상) 폴더의 실제 위치 — 참 루트(구글드라이브 전체) 기준. loadCustomers()에서 서버가 알려주는 값으로 채워짐.
  let basePath = [];
  // 체크박스로 선택된 항목들 (파일이든 폴더든) — 여러 개 골라서 한 번에 채팅에 첨부하기 위함
  // key: id, value: { id, name, type:'file'|'folder', mimeType?, path? }
  let selectedItems = new Map();
  let lastRenderedFiles = []; // 현재 화면에 그려진 파일 목록 (id로 다시 찾기 위함)
  let lastRenderedFolders = []; // 현재 화면에 그려진 하위 폴더 목록 (음성명령 "아래로" 판단용)
  const selectionInline = document.getElementById('selectionInline');
  const selectionCountText = document.getElementById('selectionCountText');
  const btnRenameSelected = document.getElementById('btnRenameSelected');
  const btnShareSelected = document.getElementById('btnShareSelected');

  let currentCustomerNames = []; // 지금 목록에 있는 유효한 고객명 (자유 타이핑 검증용)

  function setSelectOptions(selectEl, names, placeholderIfEmpty){
    currentCustomerNames = names.slice();
    customerDatalist.innerHTML = '';
    names.forEach(name=>{
      const opt = document.createElement('option');
      opt.value = name;
      customerDatalist.appendChild(opt);
    });
    if (!names.length){
      selectEl.value = '';
      selectEl.placeholder = placeholderIfEmpty;
    } else {
      selectEl.placeholder = '고객 검색/선택';
    }
  }

  function renderBreadcrumb(){
    breadcrumbEl.innerHTML = '';
    explorerPath.forEach((seg, i)=>{
      const b = document.createElement('b');
      b.textContent = seg;
      if (i < explorerPath.length - 1){
        b.style.cursor = 'pointer';
        b.addEventListener('click', ()=> navigateTo(explorerPath.slice(0, i + 1)));
      }
      breadcrumbEl.appendChild(b);
      if (i < explorerPath.length - 1){
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        breadcrumbEl.appendChild(sep);
      }
    });
    // 커버화면모드에서는 탐색기 패널(위 breadcrumb가 들어있는 곳) 자체가 안 보이므로,
    // customerSelect 옆의 이 라벨로 "지금 작업 중인 폴더"를 대신 보여준다.
    if (coverPathLabel) coverPathLabel.textContent = explorerPath.length ? explorerPath.join(' / ') : '';
  }

  function showExplorerStatus(text, isError){
    explorerBody.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'explorer-status' + (isError ? ' is-error' : '');
    div.textContent = text;
    explorerBody.appendChild(div);
  }

  function formatFileSize(bytes){
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  }
  function iconForFile(mimeType){
    if (mimeType && mimeType.indexOf('folder') !== -1) return '📁';
    if (mimeType && mimeType.indexOf('image/') === 0) return '🖼️';
    if (mimeType === 'application/pdf') return '📕';
    return '📄';
  }

  function renderSelectionBar(){
    if (!selectedItems.size){
      selectionInline.style.display = 'none';
      return;
    }
    selectionCountText.textContent = selectedItems.size + '개 선택됨';
    selectionInline.style.display = 'flex';

    const items = Array.from(selectedItems.values());
    const single = items.length === 1 ? items[0] : null;
    btnRenameSelected.disabled = !single; // 이름바꾸기는 한 개 선택했을 때만 의미 있음
    btnShareSelected.disabled = !single || single.type === 'folder'; // 공유는 파일 한 개일 때만 (폴더 공유는 미지원)
  }

  // 체크박스 상태와 선택바를 다시 그림 (파일 목록 자체를 새로 그리지 않고 표시만 갱신)
  function refreshSelectionUi(){
    explorerBody.querySelectorAll('.file-row, .folder-row[data-item-id]').forEach(row=>{
      const id = row.dataset.itemId;
      const checked = selectedItems.has(id);
      row.classList.toggle('is-selected', checked);
      const cb = row.querySelector('.file-check');
      if (cb) cb.checked = checked;
    });
    renderSelectionBar();
  }

  // 선택된 파일/폴더를 한 번에 채팅 첨부 목록으로 보냄
  function attachSelectedFiles(){
    selectedItems.forEach(item => addAttachment(item));
    selectedItems.clear();
    refreshSelectionUi();
  }

  function renderExplorer(data){
    explorerPath = data.path;
    renderBreadcrumb();
    explorerBody.innerHTML = '';
    selectedItems.clear(); // 새 폴더로 이동하면 이전 화면의 선택은 의미 없으므로 초기화
    lastRenderedFiles = data.files;
    lastRenderedFolders = data.folders;

    // 참 루트(구글드라이브 전체)에 도달하기 전까지는 ".." 상위 폴더 이동 허용
    if (explorerPath.length > 0){
      const up = document.createElement('div');
      up.className = 'folder-row';
      up.innerHTML = '<span class="icon">📁</span> .. (상위 폴더)';
      up.addEventListener('click', ()=> navigateTo(explorerPath.slice(0, -1)));
      explorerBody.appendChild(up);
    }

    data.folders.forEach(f=>{
      const folderPath = explorerPath.concat([f.name]);
      const row = document.createElement('div');
      row.className = 'folder-row';
      row.draggable = true;
      row.dataset.itemId = f.id;
      row.innerHTML = '<input type="checkbox" class="file-check" title="여러 개 선택해서 한 번에 첨부하려면 체크하세요">'
        + '<span class="icon">📁</span> ' + escapeHtml(f.name);

      row.addEventListener('click', ()=> navigateTo(folderPath));

      const checkbox = row.querySelector('.file-check');
      checkbox.addEventListener('click', (e)=>{ e.stopPropagation(); }); // 체크박스 클릭이 폴더 진입으로 이어지지 않게
      checkbox.addEventListener('change', ()=>{
        if (checkbox.checked) selectedItems.set(f.id, { id: f.id, name: f.name, type: 'folder', path: folderPath });
        else selectedItems.delete(f.id);
        refreshSelectionUi();
      });

      row.addEventListener('dragstart', (e)=>{
        const itemsToDrag = (selectedItems.has(f.id) && selectedItems.size > 1)
          ? Array.from(selectedItems.values())
          : [{ id: f.id, name: f.name, type: 'folder', path: folderPath }];
        e.dataTransfer.setData('application/json', JSON.stringify(itemsToDrag));
        e.dataTransfer.effectAllowed = 'copy';
      });

      explorerBody.appendChild(row);
    });

    data.files.forEach(f=>{
      const row = document.createElement('div');
      row.className = 'file-row';
      row.draggable = true;
      row.dataset.itemId = f.id;
      row.innerHTML = '<input type="checkbox" class="file-check" title="여러 개 선택해서 한 번에 첨부하려면 체크하세요">'
        + '<span class="icon">' + iconForFile(f.mimeType) + '</span> '
        + escapeHtml(f.name) + '<span class="meta">' + escapeHtml(f.modifiedDate || '') + (f.sizeBytes !== undefined ? ' · ' + formatFileSize(f.sizeBytes) : '') + '</span>';

      row.addEventListener('click', ()=> openEditor(f));

      const checkbox = row.querySelector('.file-check');
      checkbox.addEventListener('click', (e)=>{
        e.stopPropagation(); // 체크박스 클릭이 행 클릭(편집기 열기)으로 이어지지 않게
      });
      checkbox.addEventListener('change', ()=>{
        if (checkbox.checked) selectedItems.set(f.id, { id: f.id, name: f.name, type: 'file', mimeType: f.mimeType });
        else selectedItems.delete(f.id);
        refreshSelectionUi();
      });

      row.addEventListener('dragstart', (e)=>{
        // 지금 끄는 행이 "선택된 여러 항목" 중 하나면 선택된 항목 전부를, 아니면 이 파일 하나만 실어보냄
        const itemsToDrag = (selectedItems.has(f.id) && selectedItems.size > 1)
          ? Array.from(selectedItems.values())
          : [{ id: f.id, name: f.name, type: 'file', mimeType: f.mimeType }];
        e.dataTransfer.setData('application/json', JSON.stringify(itemsToDrag));
        e.dataTransfer.effectAllowed = 'copy';
      });

      explorerBody.appendChild(row);
    });

    if (!data.folders.length && !data.files.length){
      const empty = document.createElement('div');
      empty.className = 'explorer-empty';
      empty.textContent = '이 폴더는 비어 있습니다.';
      explorerBody.appendChild(empty);
    }

    renderSelectionBar(); // 폴더 이동으로 선택이 초기화됐으니 선택바도 숨김 처리
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function navigateTo(path){
    showExplorerStatus('불러오는 중…');
    try{
      const data = await listFolder(path);
      renderExplorer(data);
      if (typeof loadChatHistoryForCase === 'function') loadChatHistoryForCase(path);
    }catch(err){
      showExplorerStatus('폴더를 불러오지 못했습니다: ' + err.message, true);
    }
  }

  // 지금 편집기에 열려 있는 파일 (없으면 null) — 채팅으로 넘길 "현재 화면 상태" 컨텍스트에 사용
  let currentOpenFile = null;
  // report-writer(우리 렌더러)로 열려 있는지 — 이때만 postMessage로 실시간 내용 조회/적용 가능
  let isReportWriterOpen = false;

  // 텍스트 계열(우리 렌더러로 열 대상)인지 판별 — 그 외(이미지/PDF/기타)는 구글드라이브 자체 미리보기로 보냄
  function isTextRenderable(mimeType, name){
    if (mimeType === 'application/vnd.google-apps.document') return true;
    if (mimeType && mimeType.indexOf('text/') === 0) return true;
    if (/\.(md|txt|html?|htm)$/i.test(name || '')) return true;
    return false;
  }

  // 엑셀 파일(업로드된 실제 .xlsx/.xls/.csv 바이너리)인지 판별 — 구글시트 네이티브 문서
  // (application/vnd.google-apps.spreadsheet)는 제외한다. 구글시트는 readFile로 바이너리를
  // 그대로 받아올 수 없어서(내보내기가 따로 필요) 지금은 기존 구글드라이브 미리보기로 남겨둔다.
  function isSpreadsheetFile(mimeType, name){
    if (mimeType === 'application/vnd.google-apps.spreadsheet') return false;
    if (/\.(xlsx|xls|csv)$/i.test(name || '')) return true;
    if (mimeType && (mimeType.indexOf('spreadsheet') !== -1 || mimeType === 'application/vnd.ms-excel' || mimeType === 'text/csv')) return true;
    return false;
  }

  // 편집기 독립창(팝업) 참조 — 파일별로 하나씩 관리한다 (key: fileId, 파일 없는 새문서는 '__blank__').
  // 각 항목은 { win, file } — win은 window 참조, file은 그 창이 열고 있는 파일 메타데이터
  // (포커스 알림이 왔을 때 currentOpenFile을 복원하는 데 쓴다).
  // [패치 2026.07] 예전엔 창을 하나만 두고 재사용해서 두 문서를 동시에 띄울 수 없었다.
  // 메인검토서를 열어두고 쟁점별검토서 여러 개를 같이 펼쳐놓고 옮겨 적는 작업 방식이 많아서,
  // 파일마다 독립된 창을 갖도록 맵으로 바꿨다. 같은 파일을 또 클릭하면 새로 만들지 않고 그 창에
  // 포커스만 준다(창이 여러 개 있어도 중복 생성 방지).
  const editorPopupWins = {};
  function editorPopupKey(file){ return file ? ('f_' + file.id) : '__blank__'; }

  // report-writer(편집 대상) 문서를 독립창으로 연다. NX 탐색창은 전혀 건드리지 않으므로
  // 탐색기/채팅 등 원래 화면은 그대로 살아있는다. 이미 그 파일의 창이 열려 있으면 새로 만들지
  // 않고 포커스만 준다.
  function openEditorPopup(file){
    // 이 함수는 항상 report-writer만 여는 용도이므로(이미지·PDF는 openEditor의 다른 분기가 처리),
    // 파일 없이(새 빈 문서) 열 때도 isReportWriterOpen은 true로 둔다 — 그래야 그 상태에서도
    // 참조·AI적용이 정상 동작한다.
    const key = editorPopupKey(file);
    const url = file ? (REPORT_WRITER_URL + '?fileId=' + encodeURIComponent(file.id)) : REPORT_WRITER_URL;
    // "지금 편집 중인 문서"(채팅에 자동으로 실시간 반영되는 대상)는 일단 방금 연/포커스한 이
    // 창으로 잡아둔다. 이후 사용자가 다른 창을 클릭하면 report-writer의 focus 알림으로 갱신된다.
    currentOpenFile = file ? { id: file.id, name: file.name, mimeType: file.mimeType } : null;
    isReportWriterOpen = true;

    const existing = editorPopupWins[key];
    if (existing && existing.win && !existing.win.closed){
      existing.win.focus();
      return;
    }
    const w = Math.round(window.innerWidth * 0.75);
    const h = Math.round(window.innerHeight * 0.85);
    // 여러 창을 동시에 띄울 때 완전히 겹치지 않도록, 지금 열려있는 편집창 개수만큼 계단식으로 위치를 밀어준다.
    const openCount = Object.keys(editorPopupWins).filter(k => editorPopupWins[k] && editorPopupWins[k].win && !editorPopupWins[k].win.closed).length;
    const cascade = (openCount % 6) * 32;
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2) + cascade;
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2) + cascade;
    const win = window.open(url, 'nxEditorWindow_' + key, 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
    if (!win){
      showToast('새 창이 차단된 것 같습니다. 브라우저에서 이 사이트의 팝업 허용을 켜주세요.', 'warning');
      currentOpenFile = null;
      isReportWriterOpen = false;
    } else {
      editorPopupWins[key] = { win: win, file: currentOpenFile };
      win.focus();
    }
  }

  // 특정 파일의 편집창이 지금 열려 있으면(닫히지 않았으면) 그 window 참조를 돌려준다 — 없으면 null.
  // AI 적용처럼 "포커스와 무관하게 이 파일 창에 정확히 반영해야 하는" 경우에 쓴다.
  function getEditorWindowForFile(file){
    const entry = editorPopupWins[editorPopupKey(file)];
    return (entry && entry.win && !entry.win.closed) ? entry.win : null;
  }

  // fileId(문자열, 새문서 창이면 null)로 열려있는 편집창을 찾아 그 파일 메타데이터를 돌려준다.
  // report-writer의 포커스/닫힘 알림 메시지가 fileId만 갖고 오기 때문에 필요하다.
  function findEditorEntryByFileId(fileId){
    const key = fileId ? ('f_' + fileId) : '__blank__';
    return editorPopupWins[key] || null;
  }

  // 이미지・PDF・워드・파워포인트・한글 등(편집 대상이 아니라 보기・참조만 하면 되는 파일) 전용
  // 독립 팝업 관리 — report-writer/엑셀뷰어와 완전히 같은 파일별 재사용 패턴이다. 구글드라이브
  // 자체 미리보기 URL을 그대로 새 창으로 열 뿐이라 별도 뷰어 페이지를 만들 필요가 없다.
  const filePopupWins = {};
  function filePopupKey(file){ return 'f_' + file.id; }
  function driveFilePreviewUrl_(fileId, cacheBust){
    return 'https://drive.google.com/file/d/' + encodeURIComponent(fileId) + '/preview' + (cacheBust ? ('?_r=' + Date.now()) : '');
  }
  function openFilePopup(file){
    const key = filePopupKey(file);
    const existing = filePopupWins[key];
    if (existing && !existing.closed){ existing.focus(); return; }
    const url = driveFilePreviewUrl_(file.id);
    const w = Math.round(window.innerWidth * 0.85);
    const h = Math.round(window.innerHeight * 0.85);
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const win = window.open(url, 'nxFileWindow_' + key, 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
    if (!win){
      showToast('새 창이 차단된 것 같습니다. 브라우저에서 이 사이트의 팝업 허용을 켜주세요.', 'warning');
      return;
    }
    filePopupWins[key] = win;
    win.focus();
  }

  function openEditor(file){
    if (isTextRenderable(file.mimeType, file.name)){
      // 편집 대상 문서: 탐색창을 대체하지 않고 항상 독립창으로 연다.
      openEditorPopup(file);
      return;
    }
    if (isSpreadsheetFile(file.mimeType, file.name)){
      // 엑셀 파일: 구글드라이브 미리보기(긁어 복사가 안 됨) 대신, 이미 있는 엑셀뷰어로 연다.
      // 엑셀뷰어는 우리 페이지 안의 실제 <table> DOM이라 셀 범위를 드래그해서 복사할 수 있고,
      // report-writer 편집창에 붙여넣으면 마크다운 표로 바로 변환된다.
      if (typeof window.openExcelViewerFromDriveFile === 'function'){
        window.openExcelViewerFromDriveFile(file);
        return;
      }
      // 혹시라도 엑셀뷰어 초기화 전이면(스크립트 로드 순서 문제) 예전처럼 미리보기로 폴백.
    }
    // 이미지・PDF・워드・파워포인트・한글 등: 이제 좁고 고정된 패널 대신 독립 리사이즈 창으로 연다
    // ("작고 고정된 창으로 큰 PDF·이미지를 어떻게 보나" 지적 반영). 탐색창은 그대로 살아있고,
    // 얇은 상태바에 파일명 + 새로고침・참조・닫기 버튼만 남는다.
    currentOpenFile = { id: file.id, name: file.name, mimeType: file.mimeType };
    isReportWriterOpen = false;
    openFilePopup(file);
    openFileStatusName.textContent = file.name;
    openFileStatusBar.style.display = 'flex';
  }

  document.getElementById('btnOpenFileClose').addEventListener('click', ()=>{
    if (currentOpenFile){
      const win = filePopupWins[filePopupKey(currentOpenFile)];
      if (win && !win.closed) win.close();
      delete filePopupWins[filePopupKey(currentOpenFile)];
    }
    openFileStatusBar.style.display = 'none';
    currentOpenFile = null;
    isReportWriterOpen = false;
  });

  document.getElementById('btnOpenFileReload').addEventListener('click', ()=>{
    if (!currentOpenFile){ showToast('열려 있는 파일이 없습니다.', 'warning'); return; }
    const key = filePopupKey(currentOpenFile);
    const win = filePopupWins[key];
    const url = driveFilePreviewUrl_(currentOpenFile.id, true); // 캐시 방지용 타임스탬프 포함
    if (win && !win.closed){
      win.location.href = url;
      win.focus();
    } else {
      openFilePopup(currentOpenFile);
    }
    showToast('새로고침했습니다.', 'success');
  });

  document.getElementById('btnOpenFileRef').addEventListener('click', async ()=>{
    if (!currentOpenFile){ showToast('열려 있는 파일이 없습니다.', 'warning'); return; }
    // 이미지·PDF: 그 파일 자체를 이미지/문서 블록으로 가져와 AI 채팅에 첨부한다.
    // (워드·파워포인트·한글 등은 아직 미지원 — getOpenFileMediaBlock이 이미지·PDF만 처리)
    const block = await getOpenFileMediaBlock();
    if (!block){ showToast('이 파일 형식은 아직 참조를 지원하지 않습니다 (이미지·PDF만 가능).', 'error'); return; }
    if (pendingRefMedia.find(m => m.name === currentOpenFile.name)) return; // 중복 방지
    pendingRefMedia.push({ id: 'ref' + Date.now(), name: currentOpenFile.name, block });
    renderAttachBar();
  });

  // ---- 경과지 보드 ----
  const logView = document.getElementById('logView');
  const logFolderLabel = document.getElementById('logFolderLabel');
  const logDateInput = document.getElementById('logDateInput');
  const logTextInput = document.getElementById('logTextInput');
  const logDueInput = document.getElementById('logDueInput');
  const btnLogAdd = document.getElementById('btnLogAdd');
  const logList = document.getElementById('logList');
  const LOG_FILE_NAME = '경과지.json';

  let logCurrentPath = [];
  let logEntries = [];
  let logFileId = null;

  function utf8ToBase64(str){
    return btoa(unescape(encodeURIComponent(str)));
  }

  function renderLogList(){
    logList.innerHTML = '';
    if (!logEntries.length){
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = '아직 기록이 없습니다. 위에서 첫 항목을 추가해보세요.';
      logList.appendChild(empty);
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const sorted = logEntries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    sorted.forEach(entry=>{
      const row = document.createElement('div');
      row.className = 'log-entry';
      const dueBadge = entry.dueDate
        ? '<span class="due-badge' + (entry.dueDate < todayStr ? ' overdue' : (entry.dueDate === todayStr ? ' due-today' : '')) + '">📌 ' + escapeHtml(entry.dueDate) + '</span>'
        : '';
      row.innerHTML = '<div class="log-date">' + escapeHtml(entry.date || '') + dueBadge + '</div>'
        + '<div class="log-text">' + escapeHtml(entry.text || '') + '</div>'
        + '<button class="log-del" title="삭제">✕</button>';
      row.querySelector('.log-del').addEventListener('click', ()=>{
        logEntries = logEntries.filter(e => e.id !== entry.id);
        renderLogList();
        saveLog();
      });
      logList.appendChild(row);
    });
  }

  const logSaveStatusEl = document.getElementById('logSaveStatus');

  function setSaveStatus(el, state, text){
    if (!el) return;
    el.classList.remove('is-saving', 'is-error');
    if (state) el.classList.add(state);
    el.textContent = text || '';
  }

  async function saveLog(){
    setSaveStatus(logSaveStatusEl, 'is-saving', '저장 중…');
    try{
      const payload = {
        path: logCurrentPath,
        name: LOG_FILE_NAME,
        mimeType: 'application/json',
        base64Data: utf8ToBase64(JSON.stringify(logEntries))
      };
      if (logFileId) payload.fileId = logFileId;
      const res = await callGas('uploadFile', payload);
      if (res.error){
        setSaveStatus(logSaveStatusEl, 'is-error', '저장 실패');
        showToast('경과지 저장 실패: ' + res.error, 'error');
        return;
      }
      if (!logFileId) logFileId = res.id;
      setSaveStatus(logSaveStatusEl, '', '저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
      // 현황판(전체일지)에서 폴더를 일일이 뒤지지 않고도 모아볼 수 있도록 중앙 인덱스에도 반영
      // (실패해도 이 폴더 저장 자체는 이미 끝났으므로 조용히 무시 — 다음 저장 때 다시 시도됨)
      callGas('syncGlobalLog', { path: logCurrentPath, entries: logEntries }).catch(()=>{});
    }catch(err){
      setSaveStatus(logSaveStatusEl, 'is-error', '저장 실패');
      showToast('경과지 저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function openLogView(){
    ensureExplorerVisible();
    logCurrentPath = explorerPath.slice();
    hideAllPanelViews();
    logView.style.display = 'flex';
    logFolderLabel.textContent = logCurrentPath.join(' / ') + ' 의 경과지';
    logDateInput.value = new Date().toISOString().slice(0, 10);
    logList.innerHTML = '<div class="log-empty">불러오는 중…</div>';

    try{
      const data = await listFolder(logCurrentPath);
      const existing = data.files.find(f => f.name === LOG_FILE_NAME);
      if (existing){
        logFileId = existing.id;
        const fileData = await callGas('readFile', { fileId: existing.id });
        logEntries = fileData.content ? JSON.parse(fileData.content) : [];
      } else {
        logFileId = null;
        logEntries = [];
      }
    }catch(err){
      logFileId = null;
      logEntries = [];
      console.warn('경과지 로드 실패, 빈 상태로 시작', err);
    }
    renderLogList();
  }

  function closeLogView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(logCurrentPath); // 방금 저장한 경과지.json이 목록에 바로 보이도록 새로고침
  }

  document.getElementById('btnOpenLog').addEventListener('click', openLogView);
  document.getElementById('btnLogBack').addEventListener('click', closeLogView);
  document.getElementById('btnLogRef').addEventListener('click', ()=>{
    const sorted = logEntries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const text = sorted.map(e => (e.date || '') + ' — ' + (e.text || '')).join('\n');
    addTextAttachment('경과지 · ' + logCurrentPath.join('/'), text);
  });

  btnLogAdd.addEventListener('click', ()=>{
    const text = logTextInput.value.trim();
    if (!text) return;
    logEntries.push({
      id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6),
      date: logDateInput.value || new Date().toISOString().slice(0, 10),
      text: text,
      dueDate: logDueInput.value || ''
    });
    logTextInput.value = '';
    logDueInput.value = '';
    renderLogList();
    saveLog();
  });

  // ---- 계산기 워크시트 ----
  const calcView = document.getElementById('calcView');
  const calcFolderLabel = document.getElementById('calcFolderLabel');
  const calcRowsBody = document.getElementById('calcRowsBody');
  const btnCalcAddRow = document.getElementById('btnCalcAddRow');
  const CALC_FILE_NAME = '계산기.json';

  let calcCurrentPath = [];
  let calcRows = []; // [{id, label, formula}]
  let calcFileId = null;

  function evalCalcRows(){
    const results = {}; // 1, 2, 3... -> 숫자 결과 (참조 문법: [1], [2]...)
    calcRows.forEach((row, idx)=>{
      const ref = String(idx + 1);
      const raw = (row.formula || '').trim();
      let val = NaN;
      if (raw.startsWith('=')){
        // [1], [2]처럼 대괄호+숫자로 참조 — 영문자를 아예 안 써서 한영전환·대소문자 신경 쓸 필요가 없음
        let expr = raw.slice(1).replace(/\[(\d+)\]/g, (m, n) => {
          return (n in results) ? String(results[n]) : '0';
        }).replace(/%/g, '/100');
        if (/^[0-9+\-*/().\s]+$/.test(expr) && expr.trim()){
          try { val = Function('"use strict"; return (' + expr + ')')(); }
          catch(err){ val = NaN; }
        }
      } else if (raw !== ''){
        const n = Number(raw.replace(/,/g, ''));
        val = Number.isFinite(n) ? n : NaN;
      }
      results[ref] = Number.isFinite(val) ? val : 0;
      row.result = val;
    });
  }

  function renderCalcRows(){
    evalCalcRows();
    calcRowsBody.innerHTML = '';
    calcRows.forEach((row, idx)=>{
      const ref = '[' + (idx + 1) + ']';
      const tr = document.createElement('tr');
      tr.dataset.rowId = row.id;

      const tdRef = document.createElement('td');
      tdRef.className = 'calc-ref';
      tdRef.textContent = ref;

      const tdLabel = document.createElement('td');
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.placeholder = '항목명';
      labelInput.value = row.label || '';
      labelInput.addEventListener('input', ()=>{ row.label = labelInput.value; }); // 항목명은 계산에 안 쓰이므로 다시 그릴 필요 없음
      labelInput.addEventListener('change', saveCalc);
      labelInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); insertCalcRowAfter(row.id, 'label'); } });
      tdLabel.appendChild(labelInput);

      const tdFormula = document.createElement('td');
      const formulaInput = document.createElement('input');
      formulaInput.type = 'text';
      formulaInput.placeholder = '예: 500000000 또는 =[1]*0.06';
      formulaInput.value = row.formula || '';
      // 타이핑할 때마다 표 전체를 새로 그리면 입력창 자체가 교체되어 커서(포커스)가 날아가므로,
      // 결과 값만 가볍게 갱신하고 입력창(DOM)은 그대로 둔다.
      formulaInput.addEventListener('input', ()=>{ row.formula = formulaInput.value; updateCalcResults(); });
      formulaInput.addEventListener('change', saveCalc);
      formulaInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); insertCalcRowAfter(row.id, 'formula'); } });
      tdFormula.appendChild(formulaInput);

      const tdResult = document.createElement('td');
      tdResult.className = 'calc-result' + (Number.isFinite(row.result) ? '' : ' is-error');
      tdResult.textContent = Number.isFinite(row.result) ? row.result.toLocaleString('ko-KR') : '오류';

      const tdDel = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.className = 'calc-del';
      delBtn.textContent = '✕';
      delBtn.title = '이 행 삭제';
      delBtn.addEventListener('click', ()=>{
        calcRows = calcRows.filter(r => r.id !== row.id);
        renderCalcRows();
        saveCalc();
      });
      tdDel.appendChild(delBtn);

      tr.appendChild(tdRef); tr.appendChild(tdLabel); tr.appendChild(tdFormula); tr.appendChild(tdResult); tr.appendChild(tdDel);
      calcRowsBody.appendChild(tr);
    });
  }

  // 행 구조(입력창)는 그대로 두고, 계산 결과만 다시 계산해서 결과 칸만 갱신 (타이핑 중 커서 유지용)
  function updateCalcResults(){
    evalCalcRows();
    calcRows.forEach(row=>{
      const tr = calcRowsBody.querySelector('tr[data-row-id="' + row.id + '"]');
      if (!tr) return;
      const tdResult = tr.children[3];
      tdResult.className = 'calc-result' + (Number.isFinite(row.result) ? '' : ' is-error');
      tdResult.textContent = Number.isFinite(row.result) ? row.result.toLocaleString('ko-KR') : '오류';
    });
  }

  // 엔터 입력 시 그 행 바로 아래에 새 행을 끼워넣고, 엔터 누른 칸과 같은 종류(항목명/계산식) 칸으로 커서를 옮김
  function insertCalcRowAfter(afterRowId, field){
    const idx = calcRows.findIndex(r => r.id === afterRowId);
    const newRow = { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), label: '', formula: '' };
    calcRows.splice(idx + 1, 0, newRow);
    renderCalcRows();
    saveCalc();
    requestAnimationFrame(()=>{
      const newTr = calcRowsBody.querySelector('tr[data-row-id="' + newRow.id + '"]');
      if (!newTr) return;
      // 열 순서: [0]번호 [1]항목명 [2]계산식 [3]결과 [4]삭제
      const targetTd = field === 'formula' ? newTr.children[2] : newTr.children[1];
      const targetInput = targetTd && targetTd.querySelector('input');
      if (targetInput) targetInput.focus();
    });
  }

  function addCalcRow(){
    calcRows.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), label: '', formula: '' });
    renderCalcRows();
  }

  const calcSaveStatusEl = document.getElementById('calcSaveStatus');
  let calcSaveDebounceTimer = null;

  // 실제 저장(네트워크 호출)을 수행. 라벨/계산식 입력의 'change'(포커스를 벗어날 때)마다
  // 곧바로 호출되던 것을, 짧은 시간 안에 연달아 여러 필드를 옮겨다니며 편집할 때
  // 요청이 겹치지 않도록 살짝 묶어서(디바운스) 보낸다.
  async function saveCalcNow(){
    setSaveStatus(calcSaveStatusEl, 'is-saving', '저장 중…');
    try{
      const payload = {
        path: calcCurrentPath,
        name: CALC_FILE_NAME,
        mimeType: 'application/json',
        base64Data: utf8ToBase64(JSON.stringify(calcRows.map(r => ({ id: r.id, label: r.label, formula: r.formula }))))
      };
      if (calcFileId) payload.fileId = calcFileId;
      const res = await callGas('uploadFile', payload);
      if (res.error){
        setSaveStatus(calcSaveStatusEl, 'is-error', '저장 실패');
        showToast('계산기 저장 실패: ' + res.error, 'error');
        return;
      }
      if (!calcFileId) calcFileId = res.id;
      setSaveStatus(calcSaveStatusEl, '', '저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    }catch(err){
      setSaveStatus(calcSaveStatusEl, 'is-error', '저장 실패');
      showToast('계산기 저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  function saveCalc(){
    setSaveStatus(calcSaveStatusEl, 'is-saving', '저장 대기…');
    clearTimeout(calcSaveDebounceTimer);
    calcSaveDebounceTimer = setTimeout(saveCalcNow, 600);
  }

  // 탭을 다른 화면으로 전환하거나 화면을 끌 때(모바일 홈으로 나가기 등) 디바운스로
  // 미뤄둔 저장이 유실되지 않도록, 화면이 안 보이게 되는 순간 즉시 flush한다.
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden && calcSaveDebounceTimer){
      clearTimeout(calcSaveDebounceTimer);
      calcSaveDebounceTimer = null;
      saveCalcNow();
    }
  });

  async function openCalcView(){
    ensureExplorerVisible();
    calcCurrentPath = explorerPath.slice();
    hideAllPanelViews();
    calcView.style.display = 'flex';
    calcFolderLabel.textContent = calcCurrentPath.join(' / ') + ' 의 계산기';
    calcRowsBody.innerHTML = '<tr><td colspan="5" class="log-empty">불러오는 중…</td></tr>';

    try{
      const data = await listFolder(calcCurrentPath);
      const existing = data.files.find(f => f.name === CALC_FILE_NAME);
      if (existing){
        calcFileId = existing.id;
        const fileData = await callGas('readFile', { fileId: existing.id });
        calcRows = fileData.content ? JSON.parse(fileData.content) : [];
      } else {
        calcFileId = null;
        calcRows = [];
      }
    }catch(err){
      calcFileId = null;
      calcRows = [];
      console.warn('계산기 로드 실패, 빈 상태로 시작', err);
    }
    if (!calcRows.length) addCalcRow(); // 빈 상태면 바로 입력하시게 첫 행 하나 미리 준비
    renderCalcRows();
  }

  async function closeCalcView(){
    // 디바운스로 미뤄둔 저장이 남아있으면(예: 입력 직후 바로 닫기) 나가기 전에 즉시 반영
    if (calcSaveDebounceTimer){
      clearTimeout(calcSaveDebounceTimer);
      calcSaveDebounceTimer = null;
      await saveCalcNow();
    }
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(calcCurrentPath); // 방금 저장한 계산기.json이 목록에 바로 보이도록 새로고침
  }

  document.getElementById('btnOpenCalc').addEventListener('click', openCalcView);
  document.getElementById('btnCalcBack').addEventListener('click', closeCalcView);
  btnCalcAddRow.addEventListener('click', ()=>{ addCalcRow(); saveCalc(); });
  document.getElementById('btnCalcRef').addEventListener('click', ()=>{
    evalCalcRows();
    const text = calcRows.map((r, idx) => {
      const ref = '[' + (idx + 1) + ']';
      const result = Number.isFinite(r.result) ? r.result.toLocaleString('ko-KR') : '오류';
      return ref + ' ' + (r.label || '(이름없음)') + ': ' + (r.formula || '') + ' = ' + result;
    }).join('\n');
    addTextAttachment('계산기 · ' + calcCurrentPath.join('/'), text);
  });

  // ---- 계산기 템플릿 (자주 쓰는 세무 계산 패턴을 바로 불러오기) ----
  // formula가 숫자만 있는 건 "직접 입력하세요"용 자리표시 행, 실제 계산식(=[n]*...)이 있는 건 그대로 채움.
  const CALC_TEMPLATES = [
    {
      name: '양도소득세 개산(기본)',
      rows: [
        { label: '양도가액', formula: '' },
        { label: '취득가액', formula: '' },
        { label: '필요경비', formula: '' },
        { label: '양도차익', formula: '=[1]-[2]-[3]' },
        { label: '장기보유특별공제(직접 계산해 입력)', formula: '' },
        { label: '양도소득금액', formula: '=[4]-[5]' },
        { label: '기본공제', formula: '2500000' },
        { label: '과세표준', formula: '=[6]-[7]' }
      ]
    },
    {
      name: '취득세 개산(기본, 4주택 미만 기준율 예시)',
      rows: [
        { label: '취득가액(과세표준)', formula: '' },
        { label: '취득세율(%, 예: 1~3 또는 8/12 등 사안별 확인)', formula: '' },
        { label: '취득세', formula: '=[1]*([2]%)' },
        { label: '지방교육세(취득세의 10%, 통상)', formula: '=[3]*0.1' },
        { label: '농어촌특별세(해당 시)', formula: '' },
        { label: '합계', formula: '=[3]+[4]+[5]' }
      ]
    },
    {
      name: '증여세 개산(누진공제 방식)',
      rows: [
        { label: '증여재산가액', formula: '' },
        { label: '증여재산공제(배우자6억/직계존비속5천만 등 사안별)', formula: '' },
        { label: '과세표준', formula: '=[1]-[2]' },
        { label: '세율(%, 구간별 확인 후 입력)', formula: '' },
        { label: '누진공제액(구간표 확인 후 입력)', formula: '' },
        { label: '산출세액', formula: '=[3]*([4]%)-[5]' }
      ]
    },
    {
      name: '상속세 개산(누진공제 방식)',
      rows: [
        { label: '상속재산가액', formula: '' },
        { label: '상속공제(일괄공제 5억 등 사안별 확인)', formula: '' },
        { label: '과세표준', formula: '=[1]-[2]' },
        { label: '세율(%, 구간별 확인 후 입력)', formula: '' },
        { label: '누진공제액(구간표 확인 후 입력)', formula: '' },
        { label: '산출세액', formula: '=[3]*([4]%)-[5]' }
      ]
    }
  ];

  const calcTemplatePopup = document.getElementById('calcTemplatePopup');
  const btnCalcTemplate = document.getElementById('btnCalcTemplate');

  function renderCalcTemplateMenu(){
    calcTemplatePopup.innerHTML = '<div class="log-hint" style="padding:0 0 4px; font-size:11px;">기존 행 뒤에 이어서 추가됩니다. 세율·공제 구간은 사안별로 반드시 직접 확인해서 채워 넣으세요.</div>';
    CALC_TEMPLATES.forEach(tpl=>{
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-menu-item';
      btn.textContent = tpl.name;
      btn.addEventListener('click', ()=>{
        const offset = calcRows.length;
        tpl.rows.forEach(r=>{
          // 템플릿 안의 [n] 참조는 "템플릿 자체 기준 n번째 행"이므로, 실제로 뒤에 이어붙일 때는
          // 지금까지 쌓인 행 수(offset)만큼 참조번호를 밀어서 실제 위치와 맞춰준다.
          const shiftedFormula = (r.formula || '').replace(/\[(\d+)\]/g, (m, n) => '[' + (Number(n) + offset) + ']');
          calcRows.push({ id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), label: r.label, formula: shiftedFormula });
        });
        renderCalcRows();
        saveCalc();
        calcTemplatePopup.classList.remove('show');
      });
      calcTemplatePopup.appendChild(btn);
    });
  }

  btnCalcTemplate.addEventListener('click', (e)=>{
    e.stopPropagation();
    renderCalcTemplateMenu();
    calcTemplatePopup.classList.toggle('show');
  });
  document.addEventListener('click', (e)=>{
    if (calcTemplatePopup.classList.contains('show') && !calcTemplatePopup.contains(e.target) && e.target !== btnCalcTemplate){
      calcTemplatePopup.classList.remove('show');
    }
  });

  // ---- 📅 세법 기한계산 — date-fns로 "그 달 말일부터 N개월" 신고기한을 계산한다.
  // 실제 세법 문언과 100% 일치를 보장하는 건 아니라서(예: 말일이 공휴일인 경우 등은 반영 안 됨),
  // 팝업 안내문구로 "국세청 계산기로 한 번 더 확인"을 권한다 — 참고용 빠른 계산 목적.
  const btnCalcDeadline = document.getElementById('btnCalcDeadline');
  const calcDeadlinePopup = document.getElementById('calcDeadlinePopup');
  const calcDeadlineBaseDate = document.getElementById('calcDeadlineBaseDate');
  const calcDeadlineType = document.getElementById('calcDeadlineType');
  const calcDeadlineResult = document.getElementById('calcDeadlineResult');
  const CALC_DEADLINE_MONTHS_ = { transfer: 2, gift: 3, inheritance: 6, inheritance_overseas: 9 };

  if (btnCalcDeadline){
    btnCalcDeadline.addEventListener('click', (e)=>{
      e.stopPropagation();
      calcDeadlinePopup.classList.toggle('show');
    });
    document.addEventListener('click', (e)=>{
      if (calcDeadlinePopup.classList.contains('show') && !calcDeadlinePopup.contains(e.target) && e.target !== btnCalcDeadline){
        calcDeadlinePopup.classList.remove('show');
      }
    });
    document.getElementById('btnCalcDeadlineRun').addEventListener('click', ()=>{
      if (!calcDeadlineBaseDate.value){ showToast('기준일을 먼저 선택하세요.', 'warning'); return; }
      if (typeof dateFns === 'undefined'){ showToast('날짜 계산 라이브러리를 불러오지 못했습니다.', 'error'); return; }
      const base = new Date(calcDeadlineBaseDate.value + 'T00:00:00');
      const months = CALC_DEADLINE_MONTHS_[calcDeadlineType.value] || 0;
      const monthEnd = dateFns.endOfMonth(base);
      const deadline = dateFns.addMonths(monthEnd, months);
      const weekdayKo = ['일','월','화','수','목','금','토'][deadline.getDay()];
      calcDeadlineResult.textContent = '신고기한: ' + dateFns.format(deadline, 'yyyy-MM-dd') + ' (' + weekdayKo + ')';
    });
  }

  // ---- 계산기 → 마크다운 표로 복사 (보고서 md에 바로 붙여넣기용) ----
  document.getElementById('btnCalcCopyTable').addEventListener('click', async ()=>{
    evalCalcRows();
    const header = '| 항목 | 값/계산식 | 결과 |\n|---|---|---|';
    const lines = calcRows.map(r=>{
      const result = Number.isFinite(r.result) ? r.result.toLocaleString('ko-KR') : '오류';
      return '| ' + (r.label || '') + ' | ' + (r.formula || '') + ' | ' + result + ' |';
    });
    const md = [header].concat(lines).join('\n');
    try{
      await navigator.clipboard.writeText(md);
      const btn = document.getElementById('btnCalcCopyTable');
      const original = btn.textContent;
      btn.textContent = '✓ 복사됨';
      setTimeout(()=>{ btn.textContent = original; }, 1200);
    }catch(err){
      showToast('클립보드 복사에 실패했습니다. 브라우저 권한을 확인해주세요.', 'error');
    }
  });

  // ---- 휴지통 (현재 폴더에서 삭제한 항목 확인·복원) ----
  const trashView = document.getElementById('trashView');
  const trashFolderLabel = document.getElementById('trashFolderLabel');
  const trashList = document.getElementById('trashList');
  let trashCurrentPath = [];

  function iconForTrashItem(item){
    return item.type === 'folder' ? '📁' : '📄';
  }

  function renderTrashList(items){
    trashList.innerHTML = '';
    if (!items.length){
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = '최근 삭제한 항목이 없습니다.';
      trashList.appendChild(empty);
      return;
    }
    items.forEach(item=>{
      const row = document.createElement('div');
      row.className = 'log-entry';
      row.innerHTML = '<div class="log-date">' + iconForTrashItem(item) + '</div>'
        + '<div class="log-text">' + escapeHtml(item.name) + '</div>'
        + '<button class="log-del" title="복원">↩ 복원</button>';
      row.querySelector('.log-del').addEventListener('click', async ()=>{
        try{
          const res = await callGas('restoreItem', { id: item.id, type: item.type });
          if (res.error){ showToast('복원 실패: ' + res.error, 'error'); return; }
          openTrashView(); // 목록 새로고침
        }catch(err){
          showToast('복원 중 오류: ' + (err && err.message ? err.message : err), 'error');
        }
      });
      trashList.appendChild(row);
    });
  }

  async function openTrashView(){
    ensureExplorerVisible();
    trashCurrentPath = explorerPath.slice();
    hideAllPanelViews();
    trashView.style.display = 'flex';
    trashFolderLabel.textContent = trashCurrentPath.join(' / ') + ' 의 휴지통';
    trashList.innerHTML = '<div class="log-empty">불러오는 중…</div>';
    try{
      const res = await callGas('listTrash', { path: trashCurrentPath });
      if (res.error){
        trashList.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'log-empty';
        err.textContent = res.error;
        trashList.appendChild(err);
        return;
      }
      renderTrashList(res.items || []);
    }catch(err){
      trashList.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
    }
  }

  function closeTrashView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(trashCurrentPath); // 복원한 항목이 목록에 바로 보이도록 새로고침
  }

  document.getElementById('btnOpenTrash').addEventListener('click', openTrashView);
  document.getElementById('btnTrashBack').addEventListener('click', closeTrashView);

  // ---- 현황판 (모든 폴더의 처리일지를 한 곳에서, 마감일 기준 강조) ----
  const dashboardView = document.getElementById('dashboardView');
  const dashboardList = document.getElementById('dashboardList');

  async function openDashboardView(){
    ensureExplorerVisible();
    hideAllPanelViews();
    dashboardView.style.display = 'flex';
    dashboardList.innerHTML = '<div class="log-empty">불러오는 중…</div>';
    try{
      const res = await callGas('getGlobalLog', {});
      if (res.error){
        dashboardList.innerHTML = '<div class="log-empty">' + escapeHtml(res.error) + '</div>';
        return;
      }
      renderDashboard(res.entries || []);
    }catch(err){
      dashboardList.innerHTML = '<div class="log-empty">불러오지 못했습니다.</div>';
    }
  }

  function renderDashboard(entries){
    dashboardList.innerHTML = '';
    if (!entries.length){
      dashboardList.innerHTML = '<div class="log-empty">아직 어느 폴더에도 처리일지 기록이 없습니다.</div>';
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const withDue = entries.filter(e => e.dueDate);
    const overdue = withDue.filter(e => e.dueDate < todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const dueToday = withDue.filter(e => e.dueDate === todayStr);
    const upcoming = withDue.filter(e => e.dueDate > todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10);

    function addSection(title, list, isEmpty){
      if (!list.length && isEmpty) return;
      const head = document.createElement('div');
      head.className = 'dash-section-head';
      head.textContent = title;
      dashboardList.appendChild(head);
      if (!list.length){
        const e = document.createElement('div');
        e.className = 'log-empty';
        e.textContent = '없음';
        dashboardList.appendChild(e);
        return;
      }
      list.forEach(entry => dashboardList.appendChild(buildDashRow(entry, true)));
    }

    addSection('⏰ 기한 지남 (' + overdue.length + ')', overdue, false);
    addSection('📌 오늘 마감 (' + dueToday.length + ')', dueToday, false);
    if (upcoming.length) addSection('다가오는 마감', upcoming, false);

    const recentHead = document.createElement('div');
    recentHead.className = 'dash-section-head';
    recentHead.textContent = '최근 기록';
    dashboardList.appendChild(recentHead);
    const recent = entries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 40);
    recent.forEach(entry => dashboardList.appendChild(buildDashRow(entry, false)));
  }

  function buildDashRow(entry, showDue){
    const row = document.createElement('div');
    row.className = 'log-entry dash-row';
    const dueBadge = (showDue && entry.dueDate) ? '<span class="due-badge">📌 ' + escapeHtml(entry.dueDate) + '</span>' : '';
    row.innerHTML = '<div class="log-date">' + escapeHtml(entry.date || '') + dueBadge + '</div>'
      + '<div class="log-text"><span class="dash-path">' + escapeHtml((entry.path || []).join(' / ')) + '</span><br>' + escapeHtml(entry.text || '') + '</div>';
    row.style.cursor = 'pointer';
    row.title = '클릭하면 해당 폴더로 이동합니다';
    row.addEventListener('click', ()=>{
      closeDashboardView();
      navigateTo(entry.path || []);
    });
    return row;
  }

  function closeDashboardView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(explorerPath);
  }

  document.getElementById('btnOpenDashboard').addEventListener('click', openDashboardView);
  document.getElementById('btnDashboardBack').addEventListener('click', closeDashboardView);

  // ---- 파일·폴더 검색 (드라이브 전체, 이름 기준) ----
  const searchView = document.getElementById('searchView');
  const searchInput = document.getElementById('searchInput');
  const searchResultList = document.getElementById('searchResultList');

  function openSearchView(){
    ensureExplorerVisible();
    hideAllPanelViews();
    searchView.style.display = 'flex';
    searchResultList.innerHTML = '<div class="log-empty">검색어를 입력하고 엔터 또는 검색 버튼을 눌러주세요.</div>';
    setTimeout(()=> searchInput.focus(), 50);
  }

  async function runSearch(){
    const q = searchInput.value.trim();
    if (!q) return;
    searchResultList.innerHTML = '<div class="log-empty">검색 중…</div>';
    try{
      const res = await callGas('searchFiles', { query: q });
      if (res.error){
        searchResultList.innerHTML = '<div class="log-empty">' + escapeHtml(res.error) + '</div>';
        return;
      }
      renderSearchResults(res.items || []);
    }catch(err){
      searchResultList.innerHTML = '<div class="log-empty">검색 중 오류가 발생했습니다.</div>';
    }
  }

  function renderSearchResults(items){
    searchResultList.innerHTML = '';
    if (!items.length){
      searchResultList.innerHTML = '<div class="log-empty">일치하는 결과가 없습니다.</div>';
      return;
    }
    items.forEach(item=>{
      const row = document.createElement('div');
      row.className = 'log-entry';
      row.style.cursor = 'pointer';
      const icon = item.type === 'folder' ? '📁' : iconForFile(item.mimeType);
      row.innerHTML = '<div class="log-date">' + icon + '</div>'
        + '<div class="log-text"><span class="dash-path">' + escapeHtml((item.path || []).join(' / ')) + '</span><br>' + escapeHtml(item.name) + '</div>';
      row.addEventListener('click', async ()=>{
        if (item.type === 'folder'){
          closeSearchView();
          navigateTo((item.path || []).concat([item.name]));
        } else {
          closeSearchView();
          navigateTo(item.path || []);
          // 폴더로 이동한 뒤 목록에서 파일을 찾아 바로 열어줌
          setTimeout(()=>{
            const target = lastRenderedFiles.find(f => f.id === item.id);
            if (target) openEditor(target);
          }, 500);
        }
      });
      searchResultList.appendChild(row);
    });
  }

  function closeSearchView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(explorerPath);
  }

  document.getElementById('btnOpenSearch').addEventListener('click', openSearchView);
  document.getElementById('btnSearchBack').addEventListener('click', closeSearchView);
  document.getElementById('btnSearchGo').addEventListener('click', runSearch);
  searchInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); runSearch(); } });

  // ---- 관계도/구조도 캔버스 (mermaid 문법) ----
  if (window.mermaid) mermaid.initialize({ startOnLoad: false, theme: 'neutral' });

  const diagramView = document.getElementById('diagramView');
  const diagramFolderLabel = document.getElementById('diagramFolderLabel');
  const diagramInput = document.getElementById('diagramInput');
  const diagramPreview = document.getElementById('diagramPreview');
  const btnDiagramSave = document.getElementById('btnDiagramSave');
  const DIAGRAM_FILE_NAME = '관계도.mmd';
  const DIAGRAM_DEFAULT = 'graph TD\n  A[아버지] --> B[자녀1]\n  A --> C[자녀2]';

  let diagramCurrentPath = [];
  let diagramFileId = null;
  let diagramRenderTimer = null;
  let diagramRenderCounter = 0;

  async function renderDiagramPreview(){
    const code = diagramInput.value.trim();
    if (!code){
      diagramPreview.innerHTML = '<div class="diagram-error">왼쪽에 mermaid 문법으로 입력하면 여기에 그려집니다.</div>';
      return;
    }
    if (!window.mermaid){
      diagramPreview.innerHTML = '<div class="diagram-error">mermaid 라이브러리를 불러오지 못했습니다.</div>';
      return;
    }
    try{
      const id = 'nxDiagram' + (diagramRenderCounter++);
      const { svg } = await mermaid.render(id, code);
      // mermaid 자체도 어느 정도 안전장치가 있지만, 다이어그램 소스(사용자 입력 또는 AI 생성)에
      // 악성 스크립트가 섞여 들어올 가능성에 대비해 한 번 더 걸러낸다.
      diagramPreview.innerHTML = (typeof DOMPurify !== 'undefined')
        ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
        : svg;
    }catch(err){
      diagramPreview.innerHTML = '<div class="diagram-error">문법 오류:\n' + escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
    }
  }

  diagramInput.addEventListener('input', ()=>{
    clearTimeout(diagramRenderTimer);
    diagramRenderTimer = setTimeout(renderDiagramPreview, 500); // 타이핑 잠깐 멈추면 다시 그림
  });
  diagramInput.addEventListener('change', saveDiagram);

  async function saveDiagram(){
    try{
      const payload = {
        path: diagramCurrentPath,
        name: DIAGRAM_FILE_NAME,
        mimeType: 'text/plain',
        base64Data: utf8ToBase64(diagramInput.value)
      };
      if (diagramFileId) payload.fileId = diagramFileId;
      const res = await callGas('uploadFile', payload);
      if (res.error){ showToast('관계도 저장 실패: ' + res.error, 'error'); return; }
      if (!diagramFileId) diagramFileId = res.id;
      flashSavedLabel(btnDiagramSave, '저장');
    }catch(err){
      showToast('관계도 저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  // 저장 성공 시 버튼에 잠깐 "✓ 저장됨"을 보여줬다가 원래 글자로 되돌림 (조용해서 불안한 것 방지)
  function flashSavedLabel(btn, originalText){
    if (!btn) return;
    btn.textContent = '✓ 저장됨';
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(()=>{ btn.textContent = originalText; }, 1200);
  }

  async function openDiagramView(){
    ensureExplorerVisible();
    diagramCurrentPath = explorerPath.slice();
    hideAllPanelViews();
    diagramView.style.display = 'flex';
    diagramFolderLabel.textContent = diagramCurrentPath.join(' / ') + ' 의 관계도';

    try{
      const data = await listFolder(diagramCurrentPath);
      const existing = data.files.find(f => f.name === DIAGRAM_FILE_NAME);
      if (existing){
        diagramFileId = existing.id;
        const fileData = await callGas('readFile', { fileId: existing.id });
        diagramInput.value = fileData.content || '';
      } else {
        diagramFileId = null;
        diagramInput.value = DIAGRAM_DEFAULT; // 빈 상태면 예시로 시작해서 문법 감 잡기 쉽게
      }
    }catch(err){
      diagramFileId = null;
      diagramInput.value = DIAGRAM_DEFAULT;
      console.warn('관계도 로드 실패, 예시로 시작', err);
    }
    renderDiagramPreview();
  }

  function closeDiagramView(){
    hideAllPanelViews();
    explorerView.style.display = 'flex';
    explorerPanelHead.style.display = 'flex';
    navigateTo(diagramCurrentPath); // 방금 저장한 관계도.mmd가 목록에 바로 보이도록 새로고침
  }

  document.getElementById('btnOpenDiagram').addEventListener('click', openDiagramView);
  document.getElementById('btnDiagramBack').addEventListener('click', ()=>{ saveDiagram(); closeDiagramView(); });
  btnDiagramSave.addEventListener('click', saveDiagram);
  document.getElementById('btnDiagramRef').addEventListener('click', ()=>{
    addTextAttachment('관계도 · ' + diagramCurrentPath.join('/'), diagramInput.value);
  });

  // ---- report-writer(iframe)와의 실시간 통신 (postMessage) ----
  let msgReqCounter = 0;
  const pendingContentRequests = {};

  window.addEventListener('message', (event)=>{
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'nx-content-response' && pendingContentRequests[msg.requestId]){
      pendingContentRequests[msg.requestId](msg.content);
      delete pendingContentRequests[msg.requestId];
    }
    if (msg.type === 'nx-request-attach'){
      // report-writer 자체 툴바의 "📎 참조" 버튼에서 온 요청 — 좁은 편집창/전체화면 어느 쪽이든
      // 똑같이 여기서 처리된다(화면별로 따로 처리하지 않아도 됨).
      addTextAttachment(msg.name || (currentOpenFile && currentOpenFile.name) || '문서', msg.content || '');
    }
    if (msg.type === 'nx-editor-window-closed'){
      // 편집창 독립 팝업 중 하나가 (자체 닫기 버튼이든 OS 창닫기 버튼이든 어떤 방법으로든) 닫혔다는
      // 신호 — report-writer가 unload 시점에 opener에게 직접 보내온다. fileId로 정확히 그 창만
      // 목록에서 지운다(다른 편집창까지 같이 지우면 여러 창 동시 작업이 깨진다).
      const closedKey = msg.fileId ? ('f_' + msg.fileId) : '__blank__';
      delete editorPopupWins[closedKey];
      // 지금 "포커스 추적 중"이던 창이 닫힌 거라면 그 추적만 해제한다 — AI가 "지금 열려있는
      // 문서"로 착각해 죽은 창에 적용을 시도하는 일이 없게 한다. 다른 창이 아직 열려있어도
      // 자동으로 그쪽으로 넘기지 않는다(사용자가 그 창을 클릭하면 focus 알림으로 알아서 넘어감).
      if (isReportWriterOpen && editorPopupKey(currentOpenFile) === closedKey){
        isReportWriterOpen = false;
        currentOpenFile = null;
      }
    }
    if (msg.type === 'nx-editor-window-focused'){
      // 여러 편집창 중 사용자가 지금 클릭해서 활성화한 창 — "지금 편집 중인 문서"(채팅 보낼 때
      // 자동으로 AI에게 실시간 반영되는 대상)를 그 창으로 맞춘다. 메인검토서/쟁점별검토서를
      // 오가며 작업할 때, 방금 돌아온 창이 곧바로 AI 컨텍스트가 되게 하기 위함.
      const entry = findEditorEntryByFileId(msg.fileId);
      if (entry){
        currentOpenFile = entry.file; // 파일 없이 연 새 문서 창이면 null
        isReportWriterOpen = true;
      }
    }
  });

  // 지금 편집기(report-writer)에 실제로 타이핑되어 있는(저장 전 포함) 내용을 물어봄
  // PC・태블릿 독립창들(editorPopupWins) 중 지금 "포커스 추적 중인"(currentOpenFile에 해당하는)
  // 창을 골라주는 공통 헬퍼. 이걸 통해서 참조/새로고침/AI적용을 구현하면 어느 화면에서 열어도,
  // 여러 창이 열려있어도 항상 정확한 대상에 반영된다.
  function getActiveEditorTarget(){
    return getEditorWindowForFile(currentOpenFile);
  }

  function getEditorLiveContent(){
    return new Promise((resolve)=>{
      const target = getActiveEditorTarget();
      if (!isReportWriterOpen || !target){ resolve(null); return; }
      const requestId = 'req' + (++msgReqCounter);
      const timer = setTimeout(()=>{ delete pendingContentRequests[requestId]; resolve(null); }, 1500);
      pendingContentRequests[requestId] = (content)=>{ clearTimeout(timer); resolve(content); };
      target.postMessage({ type: 'nx-get-content', requestId }, '*');
    });
  }

  // AI가 제안한 새 문서 내용을 편집기에 실제로 적용
  function applyEditorContent(newContent){
    const target = getActiveEditorTarget();
    if (!isReportWriterOpen || !target) return;
    target.postMessage({ type: 'nx-set-content', content: newContent }, '*');
  }

  // report-writer가 아니라 구글드라이브 자체 미리보기(이미지·PDF)로 열려 있는 파일은
  // "실시간 타이핑 내용" 개념이 없으므로, 대신 파일 자체를 이미지/문서 블록으로 가져와 메시지에 실어보낸다.
  async function getOpenFileMediaBlock(){
    if (!currentOpenFile || isReportWriterOpen) return null;
    const mt = currentOpenFile.mimeType || '';
    const isImage = mt.indexOf('image/') === 0;
    const isPdf = mt === 'application/pdf';
    if (!isImage && !isPdf) return null; // 그 외 형식은 아직 미지원 (필요시 확장 가능)

    try{
      const data = await callGas('readFile', { fileId: currentOpenFile.id });
      if (data.error || !data.base64) return null;
      return {
        type: isImage ? 'image' : 'document',
        source: { type: 'base64', media_type: data.mimeType || mt, data: data.base64 }
      };
    }catch(err){
      console.warn('열려있는 파일을 첨부하지 못했습니다', err);
      return null;
    }
  }
