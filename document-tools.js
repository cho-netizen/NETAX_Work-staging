  // ============================================================
  // 문서 스캔 · PDF 조립
  // ============================================================
  const scanOverlay = document.getElementById('scanOverlay');
  const scanFileInput = document.getElementById('scanFileInput');
  const scanGalleryInput = document.getElementById('scanGalleryInput');
  const scanStageWrap = document.getElementById('scanStageWrap');
  const scanStage = document.getElementById('scanStage');
  const scanPreviewCanvas = document.getElementById('scanPreviewCanvas');
  const scanQuadPoly = document.getElementById('scanQuadPoly');
  const scanGrayscale = document.getElementById('scanGrayscale');
  const scanContrast = document.getElementById('scanContrast');
  const btnAutoDetect = document.getElementById('btnAutoDetect');
  const btnWarpAndAdd = document.getElementById('btnWarpAndAdd');
  const scanPdfInsertInput = document.getElementById('scanPdfInsertInput');
  const scanTray = document.getElementById('scanTray');
  const scanOutputName = document.getElementById('scanOutputName');
  const btnDownloadPdf = document.getElementById('btnDownloadPdf');
  const btnSaveToFolder = document.getElementById('btnSaveToFolder');

  let scanImageEl = null;      // 로드된 원본 이미지 (Image 객체, 원본 해상도)
  let scanDisplayScale = 1;    // 원본 해상도 대비 화면 표시 배율
  let scanDW = 0, scanDH = 0;  // 화면에 표시되는 캔버스 크기(px)
  let scanCorners = null;      // {tl,tr,br,bl} — 화면 표시 좌표계 기준
  let docPages = [];           // 페이지 모음: {type:'image', dataUrl, rotation, name} | {type:'pdf', name, bytes, pageCount}

  // 촬영하기·갤러리에서 불러오기 두 가지를 선택할 수 있으므로, 모달을 열 때 자동으로
  // 카메라부터 실행하던 방식은 그만둔다 — 사용자가 버튼으로 직접 고르게 한다.
  function updateScanTargetFolderLabel_(){
    const label = document.getElementById('scanTargetFolderLabel');
    if (!label) return;
    label.textContent = explorerPath.length
      ? '📁 저장 위치: ' + explorerPath.join(' / ')
      : '⚠️ 저장할 고객/사건 폴더가 아직 선택되지 않았습니다 — 탐색기에서 먼저 폴더를 여세요.';
  }

  function openScanModal(){
    scanOverlay.style.display = 'flex';
    scanOutputName.value = ''; // 이전 스캔 세션의 파일명이 그대로 남아있던 문제 — 새로 열 때마다 비움
    scanFileQueue = []; // 이전 세션에 남아있던 파일 대기열도 같이 비움
    const skipBtn = document.getElementById('btnSkipScanFile');
    if (skipBtn) skipBtn.style.display = 'none';
    updateScanExportFootVisibility();
    updateScanTargetFolderLabel_(); // [패치] 지금 저장될 폴더를 바로 보여줌(버그#7)
  }
  function closeScanModal(){ scanOverlay.style.display = 'none'; }
  document.getElementById('btnOpenScan').addEventListener('click', openScanModal);
  document.getElementById('btnScanCapture').addEventListener('click', ()=> scanFileInput.click());
  document.getElementById('btnScanGallery').addEventListener('click', ()=> scanGalleryInput.click());
  document.getElementById('btnScanPdfInsert').addEventListener('click', ()=> scanPdfInsertInput.click());

  // ---- 상담메모(필기) — S펜 등 필압 인식 포인터로 손글씨를 쓰고, 저장하면 이미지로
  // 드라이브에 올라가는 동시에 채팅 첨부로도 붙는다. AI에게 "이 메모 사건파일에 추가해줘"라고
  // 바로 요청할 수 있게 연결하는 게 목적이라, 그림 자체를 예쁘게 다듬는 기능(도형·텍스트 등)은
  // 없다 — 순수 자유 필기만 지원한다. ----
  (function setupNoteModal(){
    const noteOverlay = document.getElementById('noteOverlay');
    const noteCanvasWrap = document.getElementById('noteCanvasWrap');
    const noteZoomInner = document.getElementById('noteZoomInner');
    const noteBgCanvas = document.getElementById('noteBgCanvas');
    const bgCtx = noteBgCanvas.getContext('2d');
    const noteCanvas = document.getElementById('noteCanvas');
    const ctx = noteCanvas.getContext('2d');
    const notePenColor = document.getElementById('notePenColor');
    const notePenSize = document.getElementById('notePenSize');
    const btnNoteToolMode = document.getElementById('btnNoteToolMode');
    const btnNoteUndo = document.getElementById('btnNoteUndo');
    const btnNoteRedo = document.getElementById('btnNoteRedo');
    const btnNoteClear = document.getElementById('btnNoteClear');
    const btnNoteBgImage = document.getElementById('btnNoteBgImage');
    const noteBgFileInput = document.getElementById('noteBgFileInput');
    const btnNoteBgPattern = document.getElementById('btnNoteBgPattern');
    const btnNoteZoom = document.getElementById('btnNoteZoom');
    const btnNotePrevPage = document.getElementById('btnNotePrevPage');
    const btnNoteNextPage = document.getElementById('btnNoteNextPage');
    const notePageIndicator = document.getElementById('notePageIndicator');
    const btnNoteSave = document.getElementById('btnNoteSave');
    const btnCloseNote = document.getElementById('btnCloseNote');

    // ---- 도구 모드: 펜 → 형광펜 → 지우개 → 영역삭제 → 직선 → 사각형 순환(자리 절약을 위해 버튼 하나로 순환시킴) ----
    const TOOL_MODES = ['pen', 'highlight', 'eraser', 'select', 'line', 'rect'];
    const TOOL_MODE_ICON = { pen: '✏️', highlight: '🖍', eraser: '🧹', select: '✂️', line: '📏', rect: '▭' };
    const TOOL_MODE_LABEL = { pen: '펜', highlight: '형광펜', eraser: '지우개', select: '영역삭제', line: '직선', rect: '사각형' };
    let toolModeIndex = 0;
    let toolMode = TOOL_MODES[0];

    let drawing = false, lastX = 0, lastY = 0;
    let lastPenTime = 0; // 손바닥 오작동 방지용 — 최근에 펜을 썼으면 손가락 터치는 무시
    const PALM_REJECT_WINDOW_MS = 600;
    let undoStack = []; // 스냅샷(dataURL) 배열 — 페이지 전환 시 초기화됨
    let redoStack = [];
    let shapeSnapshotImageData = null; // 직선/사각형/영역삭제 미리보기용 — 획 시작 시점의 픽셀 스냅샷
    let shapeStartPoint = null;
    let shapeCurrentPoint = null; // 영역삭제 확정(포인터 뗄 때) 시 필요한 마지막 드래그 위치

    let notePages = [''];          // 페이지별 잉크 내용(dataURL, 투명배경)
    let notePageBackgrounds = [null]; // 페이지별 배경 이미지(dataURL) 또는 null
    let noteCurrentPageIndex = 0;

    let bgPatternMode = 'none'; // 'none' | 'ruled' | 'grid'
    let zoomLevel = 1; // 1 | 1.5 | 2

    function updatePageIndicator(){
      notePageIndicator.textContent = (noteCurrentPageIndex + 1) + '/' + notePages.length;
    }

    function saveCurrentPageSnapshot(){
      notePages[noteCurrentPageIndex] = noteCanvas.toDataURL('image/png');
    }

    function renderCurrentBackground(){
      bgCtx.clearRect(0, 0, noteBgCanvas.width, noteBgCanvas.height);
      const bg = notePageBackgrounds[noteCurrentPageIndex];
      if (bg){
        const img = new Image();
        img.onload = ()=> bgCtx.drawImage(img, 0, 0, noteCanvasWrap.clientWidth, noteCanvasWrap.clientHeight);
        img.src = bg;
      }
    }

    function loadPage(index){
      saveCurrentPageSnapshot();
      noteCurrentPageIndex = index;
      undoStack = [];
      redoStack = [];
      const w = noteCanvasWrap.clientWidth, h = noteCanvasWrap.clientHeight;
      ctx.clearRect(0, 0, noteCanvas.width, noteCanvas.height);
      const saved = notePages[noteCurrentPageIndex];
      if (saved && saved.length > 100){
        const img = new Image();
        img.onload = ()=> ctx.drawImage(img, 0, 0, w, h);
        img.src = saved;
      }
      renderCurrentBackground();
      updatePageIndicator();
    }

    function resizeCanvasToWrap(){
      // 지금까지 그린 내용을 유지한 채로 캔버스 실제 픽셀 해상도만 화면 크기에 맞춘다
      const prevInk = noteCanvas.toDataURL ? noteCanvas.toDataURL('image/png') : null;
      const dpr = window.devicePixelRatio || 1;
      const w = noteCanvasWrap.clientWidth, h = noteCanvasWrap.clientHeight;

      noteCanvas.width = Math.max(1, Math.round(w * dpr));
      noteCanvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (prevInk && prevInk.length > 100){
        const img = new Image();
        img.onload = ()=> ctx.drawImage(img, 0, 0, w, h);
        img.src = prevInk;
      }

      noteBgCanvas.width = Math.max(1, Math.round(w * dpr));
      noteBgCanvas.height = Math.max(1, Math.round(h * dpr));
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderCurrentBackground();
    }

    function getPoint(e){
      const rect = noteCanvas.getBoundingClientRect();
      const scaleX = rect.width ? (noteCanvasWrap.clientWidth / rect.width) : 1;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleX,
        pressure: (e.pressure && e.pressure > 0) ? e.pressure : 0.5
      };
    }

    function pushUndoSnapshot(){
      undoStack.push(noteCanvas.toDataURL('image/png'));
      if (undoStack.length > 30) undoStack.shift();
      redoStack = []; // 새 획을 그으면 지금까지의 redo 기록은 의미 없어지므로 비운다
    }

    function applyStrokeStyle(pressure){
      const baseSize = Number(notePenSize.value) || 3;
      if (toolMode === 'eraser'){
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.lineWidth = baseSize * 3;
      } else if (toolMode === 'highlight'){
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = notePenColor.value;
        ctx.lineWidth = baseSize * 4;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = notePenColor.value;
        ctx.lineWidth = Math.max(0.8, baseSize * (0.4 + (pressure || 0.5)));
      }
    }

    noteCanvas.addEventListener('pointerdown', (e)=>{
      // 손바닥 오작동 방지: 최근에 펜을 쓰고 있었는데 손가락(터치) 입력이 들어오면 무시한다.
      if (e.pointerType === 'touch' && (Date.now() - lastPenTime) < PALM_REJECT_WINDOW_MS) return;
      if (e.pointerType === 'pen') lastPenTime = Date.now();

      drawing = true;
      noteCanvas.setPointerCapture(e.pointerId);
      const p = getPoint(e);

      if (toolMode === 'line' || toolMode === 'rect' || toolMode === 'select'){
        pushUndoSnapshot();
        shapeSnapshotImageData = ctx.getImageData(0, 0, noteCanvas.width, noteCanvas.height);
        shapeStartPoint = p;
        shapeCurrentPoint = p;
        return;
      }

      pushUndoSnapshot();
      lastX = p.x; lastY = p.y;
    });

    noteCanvas.addEventListener('pointermove', (e)=>{
      if (!drawing) return;
      if (e.pointerType === 'touch' && (Date.now() - lastPenTime) < PALM_REJECT_WINDOW_MS) return;
      const p = getPoint(e);

      if (toolMode === 'select'){
        if (!shapeSnapshotImageData) return;
        shapeCurrentPoint = p;
        ctx.putImageData(shapeSnapshotImageData, 0, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 1.5;
        const rx = shapeStartPoint.x, ry = shapeStartPoint.y, rw = p.x - shapeStartPoint.x, rh = p.y - shapeStartPoint.y;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.fillStyle = 'rgba(225, 29, 72, 0.1)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
        return;
      }

      if (toolMode === 'line' || toolMode === 'rect'){
        if (!shapeSnapshotImageData) return;
        ctx.putImageData(shapeSnapshotImageData, 0, 0);
        applyStrokeStyle(p.pressure);
        ctx.beginPath();
        if (toolMode === 'line'){
          ctx.moveTo(shapeStartPoint.x, shapeStartPoint.y);
          ctx.lineTo(p.x, p.y);
        } else {
          ctx.rect(shapeStartPoint.x, shapeStartPoint.y, p.x - shapeStartPoint.x, p.y - shapeStartPoint.y);
        }
        ctx.stroke();
        return;
      }

      applyStrokeStyle(p.pressure);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x; lastY = p.y;
    });

    function endStroke(){
      // 영역삭제: 드래그로 그린 점선 미리보기를 지우고, 그 자리를 실제로 비운다(지우개와 달리
      // 손으로 문지를 필요 없이 사각형 범위 전체가 한 번에 삭제된다).
      if (toolMode === 'select' && shapeSnapshotImageData && shapeStartPoint && shapeCurrentPoint){
        ctx.putImageData(shapeSnapshotImageData, 0, 0);
        const x = Math.min(shapeStartPoint.x, shapeCurrentPoint.x);
        const y = Math.min(shapeStartPoint.y, shapeCurrentPoint.y);
        const w = Math.abs(shapeCurrentPoint.x - shapeStartPoint.x);
        const h = Math.abs(shapeCurrentPoint.y - shapeStartPoint.y);
        if (w > 2 && h > 2) ctx.clearRect(x, y, w, h);
      }
      drawing = false;
      shapeSnapshotImageData = null;
      shapeStartPoint = null;
      shapeCurrentPoint = null;
      ctx.globalAlpha = 1; // 형광펜 등으로 낮춰둔 투명도가 다음 프레임에 영향 안 주도록 복원
    }
    noteCanvas.addEventListener('pointerup', endStroke);
    noteCanvas.addEventListener('pointercancel', endStroke);
    noteCanvas.addEventListener('pointerleave', endStroke);

    btnNoteToolMode.addEventListener('click', ()=>{
      toolModeIndex = (toolModeIndex + 1) % TOOL_MODES.length;
      toolMode = TOOL_MODES[toolModeIndex];
      btnNoteToolMode.textContent = TOOL_MODE_ICON[toolMode];
      const nextMode = TOOL_MODES[(toolModeIndex + 1) % TOOL_MODES.length];
      btnNoteToolMode.title = TOOL_MODE_LABEL[toolMode] + ' (누르면 ' + TOOL_MODE_LABEL[nextMode] + '로 바뀝니다)';
    });

    btnNoteUndo.addEventListener('click', ()=>{
      if (!undoStack.length){ showToast('더 되돌릴 내용이 없습니다.', 'info'); return; }
      redoStack.push(noteCanvas.toDataURL('image/png'));
      const prev = undoStack.pop();
      const img = new Image();
      const w = noteCanvasWrap.clientWidth, h = noteCanvasWrap.clientHeight;
      img.onload = ()=>{ ctx.clearRect(0, 0, noteCanvas.width, noteCanvas.height); ctx.drawImage(img, 0, 0, w, h); };
      img.src = prev;
    });
    btnNoteRedo.addEventListener('click', ()=>{
      if (!redoStack.length){ showToast('다시 실행할 내용이 없습니다.', 'info'); return; }
      undoStack.push(noteCanvas.toDataURL('image/png'));
      const next = redoStack.pop();
      const img = new Image();
      const w = noteCanvasWrap.clientWidth, h = noteCanvasWrap.clientHeight;
      img.onload = ()=>{ ctx.clearRect(0, 0, noteCanvas.width, noteCanvas.height); ctx.drawImage(img, 0, 0, w, h); };
      img.src = next;
    });
    btnNoteClear.addEventListener('click', ()=>{
      if (!confirm('지금 페이지에 쓴 메모를 지웁니다. 계속할까요?')) return;
      pushUndoSnapshot();
      ctx.clearRect(0, 0, noteCanvas.width, noteCanvas.height);
    });

    // ---- 배경 이미지(기존 문서 위에 필기) ----
    btnNoteBgImage.addEventListener('click', ()=> noteBgFileInput.click());
    noteBgFileInput.addEventListener('change', (e)=>{
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ()=>{
        notePageBackgrounds[noteCurrentPageIndex] = reader.result;
        renderCurrentBackground();
        showToast('배경 이미지를 불러왔습니다. 그 위에 필기하세요.', 'success');
      };
      reader.readAsDataURL(file);
      noteBgFileInput.value = '';
    });

    // ---- 배경 무늬(없음/줄노트/모눈) ----
    btnNoteBgPattern.addEventListener('click', ()=>{
      const modes = ['none', 'ruled', 'grid'];
      bgPatternMode = modes[(modes.indexOf(bgPatternMode) + 1) % modes.length];
      noteCanvasWrap.classList.remove('note-bg-ruled', 'note-bg-grid');
      if (bgPatternMode === 'ruled') noteCanvasWrap.classList.add('note-bg-ruled');
      if (bgPatternMode === 'grid') noteCanvasWrap.classList.add('note-bg-grid');
      const icon = { none: '▦', ruled: '≡', grid: '⊞' }[bgPatternMode];
      const label = { none: '없음', ruled: '줄노트', grid: '모눈' }[bgPatternMode];
      const nextLabel = { none: '줄노트', ruled: '모눈', grid: '없음' }[bgPatternMode];
      btnNoteBgPattern.textContent = icon;
      btnNoteBgPattern.title = '배경 무늬 ' + label + ' (누르면 ' + nextLabel + '로 바뀝니다)';
    });

    // ---- 확대(100%→150%→200%) — 확대 중엔 손가락은 화면 이동, 정밀 필기는 S펜 권장 ----
    btnNoteZoom.addEventListener('click', ()=>{
      const levels = [1, 1.5, 2];
      zoomLevel = levels[(levels.indexOf(zoomLevel) + 1) % levels.length];
      noteZoomInner.style.transform = 'scale(' + zoomLevel + ')';
      noteZoomInner.style.width = (100 / zoomLevel) + '%';
      noteZoomInner.style.height = (100 / zoomLevel) + '%';
      noteCanvasWrap.classList.toggle('note-zoomed', zoomLevel > 1);
      // 확대 중엔 손가락 터치는 화면 이동(스크롤)에 쓰고, 필기는 펜으로만 정밀하게 하도록 안내
      noteCanvas.style.touchAction = zoomLevel > 1 ? 'pan-x pan-y' : 'none';
      const nextLevel = levels[(levels.indexOf(zoomLevel) + 1) % levels.length];
      btnNoteZoom.title = '확대 ' + Math.round(zoomLevel * 100) + '%(누르면 ' + Math.round(nextLevel * 100) + '%로 바뀝니다)';
      if (zoomLevel > 1) showToast('확대됨 — 손가락으로는 화면만 이동됩니다. 정밀한 필기는 S펜을 권장합니다.', 'info');
    });

    // 이전 페이지로. 다음 페이지는 "마지막 장에서 누르면 새 페이지 추가"로 동작(별도 + 버튼 없이 자리 절약).
    btnNotePrevPage.addEventListener('click', ()=>{
      if (noteCurrentPageIndex === 0) return;
      loadPage(noteCurrentPageIndex - 1);
    });
    btnNoteNextPage.addEventListener('click', ()=>{
      if (noteCurrentPageIndex < notePages.length - 1){
        loadPage(noteCurrentPageIndex + 1);
      } else {
        saveCurrentPageSnapshot();
        notePages.push('');
        notePageBackgrounds.push(null);
        loadPage(notePages.length - 1);
      }
    });

    function resetToolModeUi(){
      toolModeIndex = 0;
      toolMode = TOOL_MODES[0];
      btnNoteToolMode.textContent = TOOL_MODE_ICON[toolMode];
      btnNoteToolMode.title = TOOL_MODE_LABEL[toolMode] + ' (누르면 ' + TOOL_MODE_LABEL[TOOL_MODES[1]] + '로 바뀝니다)';
    }

    function resetZoomUi(){
      zoomLevel = 1;
      noteZoomInner.style.transform = 'scale(1)';
      noteZoomInner.style.width = '100%';
      noteZoomInner.style.height = '100%';
      noteCanvasWrap.classList.remove('note-zoomed');
      noteCanvas.style.touchAction = 'none';
      btnNoteZoom.textContent = '🔍';
      btnNoteZoom.title = '확대 100%(누르면 150%로 바뀝니다)';
    }

    function resetBgPatternUi(){
      bgPatternMode = 'none';
      noteCanvasWrap.classList.remove('note-bg-ruled', 'note-bg-grid');
      btnNoteBgPattern.textContent = '▦';
      btnNoteBgPattern.title = '배경 무늬 없음(누르면 줄노트→모눈 순서로 바뀝니다)';
    }

    function openNoteModalImpl(){
      if (!explorerPath.length){ showToast('먼저 탐색기에서 저장할 고객/사건 폴더를 열어두세요.', 'warning'); return; }
      noteOverlay.style.display = 'flex';
      notePages = [''];
      notePageBackgrounds = [null];
      noteCurrentPageIndex = 0;
      undoStack = [];
      redoStack = [];
      resetToolModeUi();
      resetZoomUi();
      resetBgPatternUi();
      updatePageIndicator();
      requestAnimationFrame(()=>{
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        noteCanvas.width = 0; noteCanvas.height = 0; // 강제로 완전히 새로 시작(이전 사건의 메모가 이어지지 않도록)
        resizeCanvasToWrap();
      });
    }
    window.openNoteModal = openNoteModalImpl; // 메모 화면(✍ 버튼)이 이 함수보다 먼저 정의되므로 전역에 걸어둔다
    window.addEventListener('resize', ()=>{ if (noteOverlay.style.display !== 'none') resizeCanvasToWrap(); });

    btnCloseNote.addEventListener('click', ()=>{ noteOverlay.style.display = 'none'; });
    document.getElementById('btnNoteToMemo').addEventListener('click', ()=>{
      noteOverlay.style.display = 'none';
      window.openQuickMemo();
    });

    // 잉크(투명배경)와 배경이미지를 한 장으로 합쳐서(PDF에는 레이어 개념이 없으므로) dataURL로 만든다.
    function flattenPage(inkDataUrl, bgDataUrl, w, h){
      return new Promise((resolve)=>{
        const dpr = window.devicePixelRatio || 1;
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(w * dpr));
        off.height = Math.max(1, Math.round(h * dpr));
        const octx = off.getContext('2d');
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.fillStyle = '#fff';
        octx.fillRect(0, 0, w, h);

        function drawInkThenResolve(){
          if (inkDataUrl && inkDataUrl.length > 100){
            const inkImg = new Image();
            inkImg.onload = ()=>{ octx.drawImage(inkImg, 0, 0, w, h); resolve(off.toDataURL('image/png')); };
            inkImg.src = inkDataUrl;
          } else {
            resolve(off.toDataURL('image/png'));
          }
        }
        if (bgDataUrl){
          const bgImg = new Image();
          bgImg.onload = ()=>{ octx.drawImage(bgImg, 0, 0, w, h); drawInkThenResolve(); };
          bgImg.src = bgDataUrl;
        } else {
          drawInkThenResolve();
        }
      });
    }

    btnNoteSave.addEventListener('click', async ()=>{
      btnNoteSave.disabled = true; btnNoteSave.textContent = '⏳';
      try{
        saveCurrentPageSnapshot(); // 지금 보고 있는 페이지도 포함시킨다
        const w = noteCanvasWrap.clientWidth, h = noteCanvasWrap.clientHeight;

        // 잉크가 없어도 배경 이미지가 있으면 그 페이지는 유효한 페이지로 친다.
        const pageIndexesToInclude = [];
        for (let i = 0; i < notePages.length; i++){
          const hasInk = notePages[i] && notePages[i].length > 100;
          const hasBg = !!notePageBackgrounds[i];
          if (hasInk || hasBg) pageIndexesToInclude.push(i);
        }
        if (!pageIndexesToInclude.length){ showToast('작성된 내용이 없습니다.', 'warning'); return; }

        const outDoc = await PDFLib.PDFDocument.create();
        const pageBase64Pngs = []; // 손글씨 자동 텍스트 변환에 그대로 쓸 페이지별 PNG(원본 보관용 PDF와는 별도)
        for (const i of pageIndexesToInclude){
          const flatDataUrl = await flattenPage(notePages[i], notePageBackgrounds[i], w, h);
          const base64Png = flatDataUrl.split(',')[1];
          pageBase64Pngs.push(base64Png);
          const pngBytes = Uint8Array.from(atob(base64Png), c => c.charCodeAt(0));
          const embedded = await outDoc.embedPng(pngBytes);
          const { width, height } = embedded;
          const page = outDoc.addPage([width, height]);
          page.drawImage(embedded, { x: 0, y: 0, width, height });
        }
        const pdfBytes = await outDoc.save();
        const base64Pdf = uint8ToBase64(pdfBytes);
        const pdfName = '필기상담_' + new Date().toISOString().slice(0,16).replace(/[-:T]/g, '') + '.pdf';

        // 저장 즉시 손글씨를 자동으로 텍스트화한다(예전엔 채팅에 첨부해서 따로 "읽어줘"라고
        // 요청해야 했음 — 그 수동 단계를 없앴다). 그 다음은 빠른메모와 완전히 같은 저장 절차
        // (고객명 입력 → 사건 폴더 확인/동명이인 처리, 또는 비워두면 일반메모)를 그대로 쓴다.
        btnNoteSave.textContent = '🔤';
        const transcribeRes = await callGas('transcribeHandwriting', { images: pageBase64Pngs });
        if (transcribeRes.error) throw new Error(transcribeRes.error);
        const transcribedText = (transcribeRes.text || '').trim();
        if (!transcribedText){ showToast('손글씨를 텍스트로 옮기지 못했습니다(내용을 알아볼 수 없는 것 같습니다).', 'warning'); return; }

        window.openMemoSaveDialog(transcribedText, ()=>{ noteOverlay.style.display = 'none'; }, {
          name: pdfName, mimeType: 'application/pdf', base64Data: base64Pdf
        });
      }catch(err){
        showToast('저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
      }finally{
        btnNoteSave.disabled = false; btnNoteSave.textContent = '💾';
      }
    });
  })();

  // ============================================================
  // 공용 저장 흐름 — 메모(빠른메모+사건개시 통합)와 필기상담(자동 텍스트 변환 후) 전부 이
  // 절차를 그대로 쓴다.
  //  - 고객명을 입력하면: "고객명" 또는 "고객명 사건분류"로 시작하는 기존 사건 폴더를 찾아
  //    그 폴더의 "폴더명사건.md"에 이어서 저장한다(사건분류를 아직 모르면 고객명만으로 새
  //    폴더가 만들어짐). 폴더가 하나 있어도 같은 고객이 맞는지 먼저 확인하고, 동명이인이면
  //    이름 뒤에 번호를 붙인 새 폴더를 만든다(기존 것을 1로 간주, 다음은 2부터).
  //  - 고객명을 비워두면: 일반메모로 분류해서 "0 NETAX/일반메모" 폴더에 파일명을 받아 저장한다.
  //  - 사건개시(템플릿) 모드일 때는 customSaveHandler로 이 기본 흐름을 대신하고, 고객명을
  //    반드시 받아서 saveCaseFromTemplate 액션으로 [고객명 사건분류] 폴더를 만든다.
  // ============================================================
  const quickMemoSaveStep = document.getElementById('quickMemoSaveStep');
  const quickMemoSaveStepTitle = document.getElementById('quickMemoSaveStepTitle');
  const quickMemoSaveStepDesc = document.getElementById('quickMemoSaveStepDesc');
  const quickMemoFolderInput = document.getElementById('quickMemoFolderInput');
  const btnQuickMemoSaveConfirm = document.getElementById('btnQuickMemoSaveConfirm');

  const SAVE_STEP_LABELS_DEFAULT_ = {
    title: '고객명을 입력하세요',
    desc: '이미 있는 사건 폴더(예: "홍길동 양도")가 있으면 그 사건파일에 이어서 저장되고, 없으면 고객명만으로 새 폴더가 만들어집니다. <b>비워두고 저장하면</b> 일반메모로 분류되어 파일명을 따로 입력받습니다.',
    placeholder: '예: 김철수 (비워두면 일반메모)'
  };

  let pendingSaveContent = '';   // 지금 저장하려는 내용(메모 텍스트 또는 필기상담 변환 결과)
  let pendingSaveExtraFile = null; // 내용과 별도로 같은 폴더에 같이 저장할 첨부(예: 필기상담 원본 PDF)
  let pendingSaveOnDone = null;  // 저장이 끝난 뒤 호출할 콜백(그 화면 닫기 등)
  let pendingSaveCustomHandler = null; // 설정돼 있으면 기본 저장 로직 대신 이 함수(customerName)=>boolean 를 쓴다(사건개시 등)

  // "일반메모" 폴더 위치 — <고객사건>(사건 파일 전용, basePath가 가리키는 곳)이 아니라
  // <0 NETAX>(넥스 시스템 환경설정 폴더) 바로 아래여야 한다. [패치 2026.07] 예전엔 이 함수가
  // basePath(=고객사건)를 "0 NETAX"인 것처럼 잘못 가정해서, 일반메모가 엉뚱하게
  // 고객사건/일반메모에 저장되고 있었다 — 서버의 getNetaxRootPath 액션으로 진짜 "0 NETAX"
  // 경로를 물어보도록 고쳤다. 한 번 받아오면 이 세션 동안은 캐시해서 재사용한다.
  let netaxRootPathCache = null;
  async function generalMemoParentPath_(){
    if (netaxRootPathCache && netaxRootPathCache.length) return netaxRootPathCache;
    try{
      const data = await callGas('getNetaxRootPath', {});
      if (data && !data.error && Array.isArray(data.path)){
        netaxRootPathCache = data.path;
        return netaxRootPathCache;
      }
      console.error('[일반메모] "0 NETAX" 경로 조회 실패:', data && data.error);
    }catch(err){
      console.error('[일반메모] "0 NETAX" 경로 조회 중 오류:', err);
    }
    // 서버가 "0 NETAX" 경로를 못 줄 때(스크립트 속성 미설정 등)는, 저장 자체가 아예 실패하는 것보다
    // 낫도록 예전처럼 기본 작업 폴더(고객사건) 아래로라도 폴백한다 — 다만 잘못된 위치이니 알린다.
    showToast('"0 NETAX" 폴더 위치를 확인하지 못해 임시로 기본 작업 폴더 아래에 저장합니다. Code.gs의 NETAX_ROOT_FOLDER_ID(또는 BUSINESS_MANAGER_FOLDER_ID) 설정을 확인해주세요.', 'warning');
    if (!basePath || !basePath.length) await loadCustomers();
    return basePath;
  }
  async function generalMemoPath_(){
    const parent = await generalMemoParentPath_();
    return parent.concat(['일반메모']);
  }

  function formatMemoTimestamp_(){
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // customerName과 같은 사람으로 볼 수 있는 폴더들을 찾는다 — "고객명"(일련번호 없음, 1번으로 간주),
  // "고객명2 양도", "고객명3" 처럼 이름 바로 뒤에 일련번호가 붙은 것까지 전부 후보로 잡는다.
  function findCustomerFolderMatches_(folders, customerName){
    const nameEscaped = customerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + nameEscaped + '(\\d*)(?:\\s|$)');
    const matches = [];
    folders.forEach(f => {
      const m = f.name.match(re);
      if (m) matches.push({ name: f.name, serial: m[1] ? parseInt(m[1], 10) : 1 });
    });
    return matches;
  }

  // 결정된 targetPath 안에 본문 파일(이어붙이기 포함)과, 있으면 extraFile(예: 필기상담 원본 PDF)까지 저장한다.
  async function writeMemoEntry_(targetFolderName, content, extraFile){
    const targetPath = basePath.concat([targetFolderName]);
    const fileName = targetFolderName + '사건.md';
    const folderListing = await listFolder(targetPath);
    const existingFile = folderListing.files.find(f => f.name === fileName);
    const entry = '## 상담기록 (' + formatMemoTimestamp_() + ')\n\n' + content.trim() + '\n';

    if (existingFile){
      const fileData = await callGas('readFile', { fileId: existingFile.id });
      const prevContent = (fileData && !fileData.error && typeof fileData.content === 'string') ? fileData.content : '';
      const newContent = (prevContent.trim() ? prevContent.trim() + '\n\n---\n\n' : '') + entry;
      const res = await callGas('uploadFile', {
        fileId: existingFile.id, name: fileName, mimeType: 'text/markdown',
        base64Data: utf8ToBase64(newContent)
      });
      if (res.error) throw new Error(res.error);
    } else {
      const res = await callGas('uploadFile', {
        path: targetPath, name: fileName, mimeType: 'text/markdown',
        base64Data: utf8ToBase64(entry)
      });
      if (res.error) throw new Error(res.error);
    }

    if (extraFile){
      const res2 = await callGas('uploadFile', {
        path: targetPath, name: extraFile.name, mimeType: extraFile.mimeType, base64Data: extraFile.base64Data
      });
      if (res2 && res2.error) showToast('본문은 저장됐지만, 첨부(' + extraFile.name + ') 저장은 실패했습니다: ' + res2.error, 'warning');
    }

    showToast('"' + targetFolderName + '" 폴더에 저장했습니다.', 'success');
    if (JSON.stringify(explorerPath) === JSON.stringify(targetPath)) navigateTo(explorerPath);
    if (!currentCustomerNames.includes(targetFolderName)) loadCustomers(); // 새 고객이면 상단 고객 목록도 함께 갱신
  }

  async function saveAsCustomerMemo_(content, customerName, extraFile){
    const listing = await listFolder(basePath);
    const matches = findCustomerFolderMatches_(listing.folders, customerName);

    let targetFolderName;
    if (matches.length === 1){
      // 폴더가 하나 있어도 그냥 이어붙이지 않고, 정말 같은 고객인지 먼저 확인한다.
      const only = matches[0];
      const same = confirm(
        '기존에 "' + only.name + '" 폴더가 있습니다.\n같은 고객이 맞습니까?\n\n' +
        '"취소"를 누르면 동명이인으로 보고 번호를 붙인 새 폴더를 만듭니다.'
      );
      if (same){
        targetFolderName = only.name;
      } else {
        const nextSerial = only.serial + 1; // 기존 것을 1로 간주 → 다음은 2부터
        const newName = customerName + nextSerial;
        const created = await callGas('createFolder', { path: basePath, name: newName });
        if (created.error) throw new Error(created.error);
        targetFolderName = newName;
      }
    } else if (matches.length > 1){
      const choice = prompt(
        '"' + customerName + '"로 시작하는 폴더가 여러 개 있습니다. 저장할 정확한 폴더명을 입력하세요\n' +
        '(동명이인 등 목록에 없는 새 사람이면, 새 이름을 그대로 입력하세요):\n' +
        matches.map(m => m.name).join('\n')
      );
      if (!choice || !choice.trim()) return false;
      const chosen = choice.trim();
      const alreadyExists = listing.folders.some(f => f.name === chosen);
      if (!alreadyExists){
        const created = await callGas('createFolder', { path: basePath, name: chosen });
        if (created.error) throw new Error(created.error);
      }
      targetFolderName = chosen;
    } else {
      // 일치하는 사건 폴더가 없으면(아직 사건분류가 정해지기 전) 고객명 그대로 새 폴더를 만든다.
      const created = await callGas('createFolder', { path: basePath, name: customerName });
      if (created.error) throw new Error(created.error);
      targetFolderName = customerName;
    }

    await writeMemoEntry_(targetFolderName, content, extraFile);
    return true;
  }

  // 고객명을 비워두고 저장했을 때: 일반메모로 분류해서 "0 NETAX/일반메모"에 파일명을 받아 저장한다.
  async function saveAsGeneralMemo_(content, extraFile){
    const fileNameRaw = prompt('일반메모로 저장합니다. 파일명을 입력하세요:');
    if (!fileNameRaw || !fileNameRaw.trim()) return false;
    let fileName = fileNameRaw.trim();
    if (!/\.md$/i.test(fileName)) fileName += '.md';

    const parentPath = await generalMemoParentPath_();
    const parentListing = await listFolder(parentPath);
    const hasGeneralFolder = parentListing.folders.some(f => f.name === '일반메모');
    if (!hasGeneralFolder){
      const created = await callGas('createFolder', { path: parentPath, name: '일반메모' });
      if (created.error) throw new Error(created.error);
    }

    const targetPath = parentPath.concat(['일반메모']);
    const res = await callGas('uploadFile', {
      path: targetPath, name: fileName, mimeType: 'text/markdown',
      base64Data: utf8ToBase64(content.trim() + '\n')
    });
    if (res.error) throw new Error(res.error);

    if (extraFile){
      const res2 = await callGas('uploadFile', {
        path: targetPath, name: extraFile.name, mimeType: extraFile.mimeType, base64Data: extraFile.base64Data
      });
      if (res2 && res2.error) showToast('본문은 저장됐지만, 첨부(' + extraFile.name + ') 저장은 실패했습니다: ' + res2.error, 'warning');
    }

    showToast('일반메모로 "' + fileName + '"에 저장했습니다.', 'success');
    if (typeof refreshGeneralMemoList === 'function') await refreshGeneralMemoList(); // 메모 화면이 열려 있으면 검색콤보도 갱신
    return true;
  }

  // 저장 대화상자를 연다 — content: 저장할 본문 텍스트, onDone: 저장 성공 시 호출할 콜백,
  // extraFile(선택): { name, mimeType, base64Data } 형태의 첨부(예: 필기상담 원본 PDF),
  // customHandler(선택): 있으면 기본 고객명/일반메모 분기 대신 이 함수(customerName)=>Promise<boolean>를 쓴다,
  // labels(선택): { title, desc, placeholder }로 대화상자 문구를 바꿀 수 있다(사건개시 모드 등).
  function openSaveDialog(content, onDone, extraFile, customHandler, labels){
    pendingSaveContent = content;
    pendingSaveOnDone = onDone || null;
    pendingSaveExtraFile = extraFile || null;
    pendingSaveCustomHandler = customHandler || null;
    const L = labels || SAVE_STEP_LABELS_DEFAULT_;
    quickMemoSaveStepTitle.textContent = L.title;
    quickMemoSaveStepDesc.innerHTML = L.desc;
    quickMemoFolderInput.placeholder = L.placeholder;
    quickMemoFolderInput.value = '';
    quickMemoSaveStep.style.display = 'flex';
    setTimeout(()=> quickMemoFolderInput.focus(), 50);
  }
  window.openMemoSaveDialog = openSaveDialog; // 필기상담(다른 IIFE)에서도 쓸 수 있도록 전역에 걸어둔다

  document.getElementById('btnQuickMemoSaveCancel').addEventListener('click', ()=>{
    quickMemoSaveStep.style.display = 'none';
  });

  btnQuickMemoSaveConfirm.addEventListener('click', async ()=>{
    const customerName = quickMemoFolderInput.value.trim();
    btnQuickMemoSaveConfirm.disabled = true;
    btnQuickMemoSaveConfirm.textContent = '저장 중…';
    try{
      const saved = pendingSaveCustomHandler
        ? await pendingSaveCustomHandler(customerName)
        : (customerName
            ? await saveAsCustomerMemo_(pendingSaveContent, customerName, pendingSaveExtraFile)
            : await saveAsGeneralMemo_(pendingSaveContent, pendingSaveExtraFile));
      if (saved){
        quickMemoSaveStep.style.display = 'none';
        if (pendingSaveOnDone) pendingSaveOnDone();
      }
    }catch(err){
      showToast('저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btnQuickMemoSaveConfirm.disabled = false;
      btnQuickMemoSaveConfirm.textContent = '저장';
    }
  });

  // ============================================================
  // 메모 — 빠른메모 + 사건개시를 합친 화면. 필기상담과는 ✍/⌨ 버튼으로 서로 전환한다. 지금
  // 탐색기가 어느 폴더를 보고 있는지와 완전히 무관하게 아무 때나 바로 열 수 있다.
  //  - 검색창에서 "메모"(저장된 일반메모)를 골라 열면: 그 내용을 불러와 이어서 쓰는 메모장이
  //    되고, 저장하면 원래 저장 절차(고객명 입력 또는 일반메모)를 그대로 따른다.
  //  - 검색창에서 "템플릿"(사건유형별 템플릿)을 골라 열면: 사건개시 모드로 바뀌어 템플릿 내용을
  //    채워 넣을 수 있고(텍스트 템플릿만), 저장하면 고객명을 반드시 받아 [고객명 사건분류]
  //    폴더를 만든다(엑셀 등은 그대로 복사).
  // ============================================================
  let refreshGeneralMemoList; // saveAsGeneralMemo_에서 참조하므로 미리 선언(호이스팅용 var 대신 let+아래서 할당)
  (function(){
    const quickMemoOverlay = document.getElementById('quickMemoOverlay');
    const quickMemoText = document.getElementById('quickMemoText');
    const quickMemoGeneralSearch = document.getElementById('quickMemoGeneralSearch');
    const quickMemoSearchDropdown = document.getElementById('quickMemoSearchDropdown');
    const btnQuickMemoSave = document.getElementById('btnQuickMemoSave');

    // 그냥 <textarea>는 Tab을 누르면 브라우저 기본 동작대로 다음 요소로 포커스가 넘어가버려서
    // 탭 문자가 안 찍힌다. 통화 중 표처럼 탭으로 줄맞춰 메모해두면(나중에 report-writer 편집창에
    // 붙여넣을 때 표로 자동 인식됨) 편하므로, Tab을 가로채 실제 탭 문자를 입력하게 한다.
    quickMemoText.addEventListener('keydown', (e) => {
      if (e.key === 'Tab'){
        e.preventDefault();
        document.execCommand('insertText', false, '\t'); // execCommand로 넣어야 실행취소(Ctrl+Z)가 정상 동작한다
      }
    });

    let editingGeneralMemoFile = null; // 검색콤보로 기존 일반메모를 열어서 편집 중이면 그 파일 정보
    let currentTemplateMode = null; // 검색콤보로 사건개시 템플릿을 골랐으면 그 템플릿 정보(사건개시 모드)
    let comboEntries = []; // [{label, type:'memo'|'template', file?, tpl?}] — Fuse.js 검색 대상
    let comboFuse = null; // Fuse.js 인스턴스(오타 허용 유사검색)

    refreshGeneralMemoList = async function(){
      comboEntries = [];

      try{
        const listing = await listFolder(await generalMemoPath_());
        (listing.files || []).forEach(f=>{
          comboEntries.push({ label: '📄 ' + f.name.replace(/\.md$/i, ''), type: 'memo', file: f });
        });
      }catch(err){ /* 폴더가 아직 없으면 그냥 빈 목록(오류 아님 — 첫 사용 전엔 당연히 없음) */ }

      try{
        const data = await callGas('listCaseTemplates', {});
        (data.templates || []).forEach(t=>{
          comboEntries.push({ label: '🗂 ' + t.name, type: 'template', tpl: t });
        });
      }catch(err){ /* 템플릿 목록 조회가 실패해도 일반메모 검색은 계속 되게 조용히 무시 */ }

      comboFuse = (typeof Fuse !== 'undefined')
        ? new Fuse(comboEntries, { keys: ['label'], threshold: 0.4, ignoreLocation: true })
        : null;
    };

    function renderSearchDropdown_(results){
      quickMemoSearchDropdown.innerHTML = '';
      if (!results.length){ quickMemoSearchDropdown.style.display = 'none'; return; }
      results.slice(0, 8).forEach(entry=>{
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:8px 10px; font-size:12.5px; cursor:pointer; color:var(--ink);';
        row.addEventListener('mouseenter', ()=> row.style.background = 'rgba(128,136,150,0.22)'); // 테마 무관 반투명 톤 — 라이트/다크 어디서도 글자와 항상 구분됨
        row.addEventListener('mouseleave', ()=> row.style.background = '');
        row.addEventListener('mousedown', (e)=>{ e.preventDefault(); }); // 입력창 blur로 드롭다운이 먼저 닫히는 것 방지

        const labelSpan = document.createElement('span');
        labelSpan.textContent = entry.label;
        labelSpan.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
        labelSpan.addEventListener('click', ()=> selectComboEntry_(entry));
        row.appendChild(labelSpan);

        // 삭제는 일반메모(📄)만 지원한다 — 템플릿(🗂)은 사건개시템플릿 폴더에서 직접 관리하는 게 맞다.
        if (entry.type === 'memo'){
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.textContent = '🗑';
          delBtn.title = '이 메모 삭제(휴지통으로 이동)';
          delBtn.style.cssText = 'flex-shrink:0; border:none; background:none; cursor:pointer; font-size:13px; padding:2px 4px; border-radius:4px; color:var(--sub);';
          delBtn.addEventListener('mousedown', (e)=> e.preventDefault());
          delBtn.addEventListener('click', async (e)=>{
            e.stopPropagation();
            if (!confirm('"' + entry.file.name + '" 메모를 삭제할까요?(휴지통으로 이동, 필요하면 복구 가능)')) return;
            try{
              const res = await callGas('deleteItem', { id: entry.file.id, type: 'file' });
              if (res && res.error) throw new Error(res.error);
              showToast('삭제했습니다.', 'success');
              await refreshGeneralMemoList();
              quickMemoGeneralSearch.dispatchEvent(new Event('input')); // 목록에서 방금 지운 항목이 바로 빠지도록 다시 검색
            }catch(err){
              showToast('삭제 실패: ' + (err && err.message ? err.message : err), 'error');
            }
          });
          row.appendChild(delBtn);
        }

        quickMemoSearchDropdown.appendChild(row);
      });
      quickMemoSearchDropdown.style.display = 'block';
    }

    // 검색어가 비어있으면 저장된 메모+템플릿 전체 목록을, 있으면 그 검색어로 걸러진 결과를 돌려준다.
    function comboResultsFor_(val){
      if (!val) return comboEntries;
      return comboFuse
        ? comboFuse.search(val).map(r => r.item)
        : comboEntries.filter(en => en.label.indexOf(val) !== -1); // Fuse 로드 실패 시 단순 포함검색으로 대체
    }
    quickMemoGeneralSearch.addEventListener('input', ()=>{
      renderSearchDropdown_(comboResultsFor_(quickMemoGeneralSearch.value.trim()));
    });
    // 클릭(포커스)만 해도 바로 전체 목록이 보이도록 — 타이핑을 해야만 목록이 뜨던 예전 방식은
    // "메모 열기·템플릿으로 사건개시를 그냥 클릭해서 봤었다"는 사용 방식과 안 맞았다.
    quickMemoGeneralSearch.addEventListener('focus', ()=>{
      renderSearchDropdown_(comboResultsFor_(quickMemoGeneralSearch.value.trim()));
    });
    document.addEventListener('click', (e)=>{
      if (!quickMemoSearchDropdown.contains(e.target) && e.target !== quickMemoGeneralSearch){
        quickMemoSearchDropdown.style.display = 'none';
      }
    });

    async function selectComboEntry_(entry){
      quickMemoGeneralSearch.value = '';
      quickMemoSearchDropdown.style.display = 'none';
      if (!entry) return;

      if (entry.type === 'memo'){
        currentTemplateMode = null;
        try{
          const data = await callGas('readFile', { fileId: entry.file.id });
          quickMemoText.value = (data && !data.error && typeof data.content === 'string') ? data.content : '';
          editingGeneralMemoFile = entry.file;
          showToast('"' + entry.file.name + '"을(를) 불러왔습니다. 수정 후 저장하면 이 파일에 덮어씁니다.', 'success');
        }catch(err){
          showToast('불러오기 실패: ' + (err && err.message ? err.message : err), 'error');
        }
      } else {
        editingGeneralMemoFile = null;
        currentTemplateMode = entry.tpl;
        if (entry.tpl.isText){
          quickMemoText.value = '불러오는 중…';
          try{
            const data = await callGas('getCaseTemplateContent', { fileId: entry.tpl.id });
            quickMemoText.value = (data && !data.error && typeof data.content === 'string') ? data.content : '';
          }catch(err){
            quickMemoText.value = '';
            showToast('템플릿 내용을 불러오지 못했습니다: ' + (err && err.message ? err.message : err), 'error');
          }
        } else {
          quickMemoText.value = '';
        }
        showToast('"' + entry.tpl.name + '" 사건개시 모드로 전환했습니다.' + (entry.tpl.isText ? ' 내용을 채워 넣고 저장하세요.' : ' 이 템플릿은 미리보기가 안 되는 형식(엑셀 등)이라, 고객명만 입력하면 그대로 복사됩니다.'), 'success');
      }
    }

    function openQuickMemoImpl(){
      quickMemoText.value = '';
      editingGeneralMemoFile = null;
      currentTemplateMode = null;
      quickMemoOverlay.style.display = 'flex';
      refreshGeneralMemoList();
      setTimeout(()=> quickMemoText.focus(), 50);
    }
    function closeQuickMemo(){ quickMemoOverlay.style.display = 'none'; }
    window.openQuickMemo = openQuickMemoImpl; // 도구 그룹 목록 등록 시점보다 이 함수가 나중에 정의되므로 전역에 걸어둔다

    document.getElementById('btnCloseQuickMemo').addEventListener('click', ()=>{
      if (quickMemoText.value.trim() && !confirm('저장하지 않은 내용이 있습니다. 그냥 닫을까요?')) return;
      closeQuickMemo();
    });

    // 새로 만들기 — 지금 메모를 불러온 상태에서 창을 닫았다가 다시 열 필요 없이, 바로 빈 메모로
    // 초기화한다. 저장 안 한 내용이 있으면 한 번 확인한다(닫기 버튼과 동일한 안전장치).
    document.getElementById('btnQuickMemoNew').addEventListener('click', ()=>{
      if (quickMemoText.value.trim() && !confirm('저장하지 않은 내용이 있습니다. 새 메모를 시작할까요?')) return;
      quickMemoText.value = '';
      editingGeneralMemoFile = null;
      currentTemplateMode = null;
      quickMemoGeneralSearch.value = '';
      quickMemoSearchDropdown.style.display = 'none';
      quickMemoText.focus();
      showToast('새 메모를 시작합니다.', 'success');
    });

    // 필기상담 화면으로 바로 전환 — 지금 메모 화면은 닫고 필기상담을 연다.
    document.getElementById('btnQuickMemoToNote').addEventListener('click', ()=>{
      if (quickMemoText.value.trim() && !confirm('저장하지 않은 내용이 있습니다. 그냥 필기로 전환할까요?')) return;
      closeQuickMemo();
      window.openNoteModal();
    });

    // 검색콤보로 열어놓은 기존 일반메모를 편집 중이면, 새 이름을 묻지 않고 바로 그 파일에 덮어쓴다.
    async function saveOverExistingGeneralMemo_(){
      btnQuickMemoSave.disabled = true;
      try{
        const res = await callGas('uploadFile', {
          fileId: editingGeneralMemoFile.id, name: editingGeneralMemoFile.name, mimeType: 'text/markdown',
          base64Data: utf8ToBase64(quickMemoText.value.trim() + '\n')
        });
        if (res.error) throw new Error(res.error);
        showToast('"' + editingGeneralMemoFile.name + '"에 저장했습니다.', 'success');
        closeQuickMemo();
      }catch(err){
        showToast('저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
      }finally{
        btnQuickMemoSave.disabled = false;
      }
    }

    // 사건개시(템플릿) 모드에서 저장: 고객명을 반드시 받아 saveCaseFromTemplate 액션으로 마무리한다.
    function openCaseOpenSaveDialog_(){
      openSaveDialog(quickMemoText.value, closeQuickMemo, null, async (customerName)=>{
        if (!customerName){ showToast('사건개시는 고객명이 필요합니다.', 'warning'); return false; }
        const caseType = currentTemplateMode.name;
        const folderName = customerName + ' ' + caseType;
        const fileName = folderName + '사건' + currentTemplateMode.ext;
        const payload = {
          templateFileId: currentTemplateMode.id,
          targetPath: basePath.concat([folderName]),
          fileName: fileName
        };
        if (currentTemplateMode.isText) payload.editedContent = quickMemoText.value;
        const res = await callGas('saveCaseFromTemplate', payload);
        if (res.error) throw new Error(res.error);
        showToast('"' + folderName + '" 사건을 만들었습니다.', 'success');
        loadCustomers();
        navigateTo(basePath.concat([folderName]));
        currentTemplateMode = null;
        return true;
      }, {
        title: '고객명을 입력하세요 (사건개시)',
        desc: '"' + currentTemplateMode.name + '" 템플릿으로 사건을 개시합니다. 폴더명은 "고객명 ' + currentTemplateMode.name + '" 규칙으로 자동으로 만들어집니다.',
        placeholder: '예: 홍길동'
      });
    }

    btnQuickMemoSave.addEventListener('click', ()=>{
      if (editingGeneralMemoFile){ saveOverExistingGeneralMemo_(); return; }
      if (currentTemplateMode){
        if (currentTemplateMode.isText && !quickMemoText.value.trim()){ showToast('입력한 내용이 없습니다.', 'warning'); return; }
        openCaseOpenSaveDialog_();
        return;
      }
      if (!quickMemoText.value.trim()){ showToast('입력한 내용이 없습니다.', 'warning'); return; }
      openSaveDialog(quickMemoText.value.trim(), closeQuickMemo);
    });
  })();
  document.getElementById('btnOpenMemo').addEventListener('click', ()=> window.openQuickMemo());

  document.getElementById('btnCloseScan').addEventListener('click', closeScanModal);
  // 바깥(어두운 배경) 클릭 시 자동으로 닫히는 동작은 일부러 안 넣는다 — 스캔 작업 중에는
  // 다른 화면과 번갈아 볼 일이 없고, 손가락으로 작업하다 화면 가장자리를 살짝 벗어나기만 해도
  // 여기 걸려서 작업 내용이 통째로 날아가는 사고가 있었다(2026.07). ✕ 버튼으로만 닫는다.

  // ---- 이미지 로드 (촬영·갤러리 둘 다 같은 처리 로직을 공유) ----
  // 갤러리에서 여러 파일을 한 번에 고르면, 첫 파일만 바로 작업창에 띄우고 나머지는
  // 대기열에 쌓아둔다 — "담기"를 누를 때마다 다음 파일이 자동으로 이어서 로딩된다
  // (파일 여러 개를 한 번에 확보해야 할 때, 매번 파일선택창을 다시 여는 번거로움을 없앰).
  let scanFileQueue = [];
  scanFileInput.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if (file) loadScanImage(file);
  });
  scanGalleryInput.addEventListener('change', (e)=>{
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    scanFileQueue = files.slice(1);
    loadScanImage(files[0]);
    updateSkipButtonVisibility();
    if (scanFileQueue.length){
      showToast('총 ' + files.length + '개 파일 — "담기"를 누를 때마다 다음 파일로 자동으로 넘어갑니다.', 'info');
    }
  });

  // 대기열에 남은 파일이 있으면 다음 파일을 이어서 불러온다. 없으면 아무 일도 하지 않는다
  // (촬영·캡처로 담은 경우처럼 대기열이 원래 비어있는 경우도 조용히 그냥 넘어감).
  function loadNextQueuedFileIfAny(){
    updateSkipButtonVisibility();
    if (!scanFileQueue.length) return;
    const next = scanFileQueue.shift();
    loadScanImage(next);
    if (scanFileQueue.length){
      showToast('다음 파일로 넘어갑니다 (남은 ' + scanFileQueue.length + '개)', 'info');
    } else {
      showToast('마지막 파일입니다.', 'info');
    }
    updateSkipButtonVisibility();
  }

  // "건너뛰기" — 여러 파일을 한 번에 골랐을 때만 의미가 있으므로, 대기열이 비어있으면(=한 장짜리
  // 작업이면) 숨긴다. 필요없는 파일을 억지로 담았다가 나중에 바구니에서 하나하나 지우는
  // 수고를 없애기 위한 버튼 — 그냥 지금 파일만 건너뛰고 다음 파일로 넘어간다.
  function updateSkipButtonVisibility(){
    const btn = document.getElementById('btnSkipScanFile');
    if (btn) btn.style.display = scanFileQueue.length ? '' : 'none';
  }
  document.getElementById('btnSkipScanFile').addEventListener('click', ()=>{
    loadNextQueuedFileIfAny();
  });

  function loadScanImage(file){
    // 이번 세션의 첫 파일이면(아직 이름 안 채워졌으면) 그 파일명을 확장자 없이 기본값으로 채운다.
    // 다만 카메라가 붙이는 "IMG_1785032891331773189..." 같은 의미없는 긴 숫자 파일명은
    // 그대로 쓰면 보기 흉하므로, 그런 경우엔 대신 날짜 기반 이름을 쓴다.
    if (!scanOutputName.value.trim() && file && file.name){
      const base = file.name.replace(/\.[^.]+$/, '');
      const digitsOnly = base.replace(/\D/g, '');
      const looksLikeMeaninglessNumber = digitsOnly.length >= 10 && digitsOnly.length >= base.length * 0.7;
      scanOutputName.value = looksLikeMeaninglessNumber
        ? ('스캔_' + new Date().toISOString().slice(0,16).replace(/[-:T]/g, ''))
        : base;
    }
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=> setupScanStage(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function setupScanStage(img){
    scanImageEl = img;
    scanStageWrap.style.display = 'flex';
    // 2026.07: 예전엔 480px로 고정해뒀는데, 그보다 화면이 좁은 폰에서는 우측이 화면 밖으로
    // 넘쳤다 — 실제 컨테이너 폭을 재서, 그 폭을 넘지 않게 고친다.
    // 높이는 더 이상 제한하지 않는다 — 폭에 맞춰 꽉 채우고, 그 결과 세로로 길어지면
    // 모달 자체(overflow-y:auto)를 아래로 스크롤해서 보면 된다.
    const containerW = scanStageWrap.clientWidth || 400;
    const maxW = containerW - 4; // 480 상한을 없애고 컨테이너 폭을 그대로 다 쓴다
    const iw = img.naturalWidth, ih = img.naturalHeight;
    scanDisplayScale = maxW / iw; // 1배로 제한하지 않는다 — 원본이 작아도 폭에 꽉 차게 확대해서 보여줘야 정밀 작업이 가능함
    scanDW = Math.max(1, Math.round(iw * scanDisplayScale));
    scanDH = Math.max(1, Math.round(ih * scanDisplayScale));
    scanPreviewCanvas.width = scanDW;
    scanPreviewCanvas.height = scanDH;
    scanStage.style.width = scanDW + 'px';
    scanStage.style.height = scanDH + 'px';
    document.getElementById('scanQuadSvg').setAttribute('viewBox', '0 0 ' + scanDW + ' ' + scanDH);
    const ctx = scanPreviewCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, scanDW, scanDH);
    autoDetectCorners();
  }

  // ---- 자동 인식 (가장자리 명암 차이 기반 대략적 사각형 추정) ----
  function toGrayscale(imageData){
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++){
      gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return gray;
  }

  function scanEdgeLine(getVal, length){
    const startSkip = Math.floor(length * 0.03);
    let maxDiff = 0, bestIdx = Math.floor(length * 0.06);
    for (let i = startSkip + 1; i < length * 0.5; i++){
      const diff = Math.abs(getVal(i) - getVal(i - 1));
      if (diff > maxDiff){ maxDiff = diff; bestIdx = i; }
    }
    return { idx: bestIdx, strength: maxDiff };
  }

  function detectEdgeInset(gray, width, height){
    const marginLimit = 0.35; // 이보다 안쪽으로 못 들어오면(35% 이상) 신뢰 안 함 → 기본값 대체
    const THRESH = 15;        // 그레이스케일 차이가 이 정도는 돼야 "진짜 경계"로 인정
    const fallback = { top: height * 0.06, bottom: height * 0.06, left: width * 0.06, right: width * 0.06 };
    const N_SAMPLES = 7; // 2026.07: 중앙선 1개만 보던 방식은 그 한 지점에 그림자·잡음이 있으면
    // 통째로 틀어졌다 — 변을 따라 여러 지점(20%~80% 구간에 고르게)을 훑어서 중앙값을 쓰도록
    // 바꿔서, 한두 지점이 흔들려도 전체 판단이 잘 안 틀어지게 했다.

    function sampleMedian(getVal, perpLength, alongLength){
      const hits = [];
      for (let s = 1; s <= N_SAMPLES; s++){
        const t = s / (N_SAMPLES + 1);
        const along = Math.round(t * (alongLength - 1));
        const { idx, strength } = scanEdgeLine(p => getVal(along, p), perpLength);
        if (strength > THRESH && idx < perpLength * marginLimit) hits.push(idx);
      }
      if (!hits.length) return null;
      hits.sort((a, b) => a - b);
      return hits[Math.floor(hits.length / 2)]; // 중앙값(가장 튀는 값의 영향을 덜 받음)
    }

    const top = sampleMedian((along, p) => gray[p * width + along], height, width);
    const bottom = sampleMedian((along, p) => gray[(height - 1 - p) * width + along], height, width);
    const left = sampleMedian((along, p) => gray[along * width + p], width, height);
    const right = sampleMedian((along, p) => gray[along * width + (width - 1 - p)], width, height);

    return {
      top: top !== null ? top : fallback.top,
      bottom: bottom !== null ? bottom : fallback.bottom,
      left: left !== null ? left : fallback.left,
      right: right !== null ? right : fallback.right
    };
  }

  function autoDetectCorners(){
    if (!scanImageEl) return;
    const ctx = scanPreviewCanvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, scanDW, scanDH);
    const gray = toGrayscale(imageData);
    const inset = detectEdgeInset(gray, scanDW, scanDH);
    scanCorners = {
      tl: { x: inset.left, y: inset.top },
      tr: { x: scanDW - inset.right, y: inset.top },
      br: { x: scanDW - inset.right, y: scanDH - inset.bottom },
      bl: { x: inset.left, y: scanDH - inset.bottom }
    };
    renderScanHandles();
  }
  btnAutoDetect.addEventListener('click', autoDetectCorners);

  // ---- 전체(자르지 않고 사진 전체를 그대로 씀) — 귀퉁이를 이미지 가장자리에 딱 맞춘다 ----
  function useWholeImage(){
    if (!scanImageEl) return;
    scanCorners = {
      tl: { x: 0, y: 0 },
      tr: { x: scanDW, y: 0 },
      br: { x: scanDW, y: scanDH },
      bl: { x: 0, y: scanDH }
    };
    renderScanHandles();
  }
  document.getElementById('btnUseWholeImage').addEventListener('click', useWholeImage);

  // ---- 보정 단계(귀퉁이 맞추기 전)에서 미리 돌리기 — 사진이 옆으로/거꾸로 찍혔을 때
  // 귀퉁이 조정 자체가 헷갈리므로, 인식 전에 먼저 방향을 바로잡을 수 있게 한다.
  // setupScanStage를 그대로 재사용하므로, 돌린 뒤 자동인식도 새 방향 기준으로 다시 돈다.
  document.getElementById('btnRotateScanSource').addEventListener('click', ()=>{
    if (!scanImageEl) return;
    const off = document.createElement('canvas');
    off.width = scanImageEl.naturalHeight;
    off.height = scanImageEl.naturalWidth;
    const octx = off.getContext('2d');
    octx.translate(off.width / 2, off.height / 2);
    octx.rotate(90 * Math.PI / 180);
    octx.drawImage(scanImageEl, -scanImageEl.naturalWidth / 2, -scanImageEl.naturalHeight / 2);
    const rotated = new Image();
    rotated.onload = () => setupScanStage(rotated);
    rotated.src = off.toDataURL('image/jpeg', 0.92);
  });

  function renderScanHandles(){
    ['tl', 'tr', 'br', 'bl'].forEach(key=>{
      const el = document.getElementById('handle-' + key);
      el.style.left = scanCorners[key].x + 'px';
      el.style.top = scanCorners[key].y + 'px';
    });
    scanQuadPoly.setAttribute('points', ['tl','tr','br','bl'].map(k => scanCorners[k].x + ',' + scanCorners[k].y).join(' '));
  }

  // 귀퉁이 드래그 (Pointer Events로 마우스·터치 동시 지원)
  document.querySelectorAll('.scan-handle').forEach(handle=>{
    handle.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const corner = handle.dataset.corner;

      function onMove(ev){
        const rect = scanStage.getBoundingClientRect();
        const scaleX = scanDW / rect.width, scaleY = scanDH / rect.height;
        let x = (ev.clientX - rect.left) * scaleX;
        let y = (ev.clientY - rect.top) * scaleY;
        x = Math.max(0, Math.min(scanDW, x));
        y = Math.max(0, Math.min(scanDH, y));
        scanCorners[corner] = { x, y };
        renderScanHandles();
      }
      function onUp(){
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });

  // ---- 원근보정(호모그래피) 수학 ----
  function solveLinearSystem(A, B){
    const n = B.length;
    for (let i = 0; i < n; i++) A[i] = A[i].concat([B[i]]);
    for (let col = 0; col < n; col++){
      let maxRow = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[maxRow][col])) maxRow = r;
      const tmp = A[col]; A[col] = A[maxRow]; A[maxRow] = tmp;
      const pivot = A[col][col];
      if (Math.abs(pivot) < 1e-12) continue; // 4점이 거의 일직선인 특이 케이스 방어
      for (let r = 0; r < n; r++){
        if (r === col) continue;
        const factor = A[r][col] / pivot;
        for (let c = col; c <= n; c++) A[r][c] -= factor * A[col][c];
      }
    }
    const x = new Array(n);
    for (let i = 0; i < n; i++) x[i] = A[i][n] / (A[i][i] || 1e-12);
    return x;
  }

  function computeHomography(srcPts, dstPts){
    const A = [], B = [];
    for (let i = 0; i < 4; i++){
      const { x, y } = srcPts[i];
      const { x: X, y: Y } = dstPts[i];
      A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); B.push(X);
      A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); B.push(Y);
    }
    const s = solveLinearSystem(A, B); // [a,b,c,d,e,f,g,h] (i=1 고정)
    return [s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], 1];
  }

  function invert3x3(m){
    const a=m[0],b=m[1],c=m[2], d=m[3],e=m[4],f=m[5], g=m[6],h=m[7],i=m[8];
    const C00=e*i-f*h, C01=-(d*i-f*g), C02=d*h-e*g;
    const C10=-(b*i-c*h), C11=a*i-c*g, C12=-(a*h-b*g);
    const C20=b*f-c*e, C21=-(a*f-c*d), C22=a*e-b*d;
    const det = a*C00 + b*C01 + c*C02;
    const invDet = 1 / (det || 1e-12);
    return [C00*invDet, C10*invDet, C20*invDet, C01*invDet, C11*invDet, C21*invDet, C02*invDet, C12*invDet, C22*invDet];
  }

  function bilinearSample(imgData, sx, sy){
    const w = imgData.width, h = imgData.height, data = imgData.data;
    if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) return [255, 255, 255];
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = sx - x0, fy = sy - y0;
    const i00 = (y0*w+x0)*4, i10 = (y0*w+x1)*4, i01 = (y1*w+x0)*4, i11 = (y1*w+x1)*4;
    const r = [];
    for (let k = 0; k < 3; k++){
      const top = data[i00+k]*(1-fx) + data[i10+k]*fx;
      const bottom = data[i01+k]*(1-fx) + data[i11+k]*fx;
      r.push(top*(1-fy) + bottom*fy);
    }
    return r;
  }

  function applyEnhance(ctx, w, h, grayscale, contrastPct){
    if (!grayscale && !contrastPct) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const c = (contrastPct / 100) * 80; // 0~80 스케일로 완만하게 매핑
    const factor = (259 * (c + 255)) / (255 * (259 - c));
    for (let p = 0; p < d.length; p += 4){
      let r = d[p], g = d[p+1], b = d[p+2];
      if (grayscale){
        const gray = 0.299*r + 0.587*g + 0.114*b;
        r = g = b = gray;
      }
      d[p]   = Math.max(0, Math.min(255, factor*(r-128)+128));
      d[p+1] = Math.max(0, Math.min(255, factor*(g-128)+128));
      d[p+2] = Math.max(0, Math.min(255, factor*(b-128)+128));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function warpAndAddPage(){
    const scale = 1 / scanDisplayScale;
    const srcPts = ['tl','tr','br','bl'].map(k => ({ x: scanCorners[k].x*scale, y: scanCorners[k].y*scale }));
    const dist = (a,b)=>Math.hypot(a.x-b.x, a.y-b.y);
    let outW = Math.round(Math.max(dist(srcPts[0],srcPts[1]), dist(srcPts[3],srcPts[2])));
    let outH = Math.round(Math.max(dist(srcPts[0],srcPts[3]), dist(srcPts[1],srcPts[2])));
    const MAX_DIM = 2000;
    if (outW > MAX_DIM || outH > MAX_DIM){
      const s = MAX_DIM / Math.max(outW, outH);
      outW = Math.round(outW*s); outH = Math.round(outH*s);
    }
    outW = Math.max(50, outW); outH = Math.max(50, outH);

    const dstPts = [{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}];
    const M = computeHomography(srcPts, dstPts);
    const Minv = invert3x3(M);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = scanImageEl.naturalWidth;
    srcCanvas.height = scanImageEl.naturalHeight;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(scanImageEl, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW; outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    const outData = outCtx.createImageData(outW, outH);

    for (let Y = 0; Y < outH; Y++){
      for (let X = 0; X < outW; X++){
        const w = Minv[6]*X + Minv[7]*Y + Minv[8];
        const sx = (Minv[0]*X + Minv[1]*Y + Minv[2]) / w;
        const sy = (Minv[3]*X + Minv[4]*Y + Minv[5]) / w;
        const rgb = bilinearSample(srcData, sx, sy);
        const di = (Y*outW+X)*4;
        outData.data[di]=rgb[0]; outData.data[di+1]=rgb[1]; outData.data[di+2]=rgb[2]; outData.data[di+3]=255;
      }
    }
    outCtx.putImageData(outData, 0, 0);
    applyEnhance(outCtx, outW, outH, scanGrayscale.checked, Number(scanContrast.value));

    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.88);
    docPages.push({ type:'image', dataUrl, rotation:0, name: String(docPages.length + 1).padStart(3, '0') });
    renderTray();

    scanFileInput.value = '';
    scanGalleryInput.value = '';
    scanStageWrap.style.display = 'none';
    scanImageEl = null;
  }

  btnWarpAndAdd.addEventListener('click', ()=>{
    if (!scanImageEl || !scanCorners){ showToast('먼저 이미지를 불러와주세요.', 'warning'); return; }
    btnWarpAndAdd.disabled = true; btnWarpAndAdd.textContent = '처리 중…';
    setTimeout(()=>{
      try{
        warpAndAddPage();
        loadNextQueuedFileIfAny(); // 갤러리에서 여러 파일을 골랐다면, 다음 파일로 자동 이어짐
      }
      catch(err){ showToast('처리 중 오류: ' + (err && err.message ? err.message : err), 'error'); }
      finally{ btnWarpAndAdd.disabled = false; btnWarpAndAdd.textContent = '담기'; }
    }, 20); // 버튼 라벨이 바뀐 걸 화면에 그리고 나서 무거운 연산 시작
  });

  // ---- 기존 PDF 삽입 ----
  scanPdfInsertInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    try{
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes);
      docPages.push({ type:'pdf', name:file.name, bytes, pageCount: doc.getPageCount() });
      renderTray();
    }catch(err){
      showToast('PDF를 읽는 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
    e.target.value = '';
  });

  // ---- 페이지 모음(트레이) 렌더 ----
  function updateScanExportFootVisibility(){
    const foot = document.getElementById('scanExportFoot');
    if (foot) foot.style.display = docPages.length ? 'flex' : 'none';
  }

  function renderTray(){
    updateScanExportFootVisibility();
    scanTray.innerHTML = '';
    docPages.forEach((item, idx)=>{
      const row = document.createElement('div');
      row.className = 'scan-tray-item';
      row.dataset.idx = idx;
      if (item.type === 'image'){
        row.innerHTML = '<div class="scan-tray-grip">'
          + '<img src="' + item.dataUrl + '" style="transform:rotate(' + item.rotation + 'deg)">'
          + '<span class="name">' + escapeHtml(item.name) + '</span>'
          + '</div>'
          + '<button data-act="rotate" title="90도 회전">↻</button>'
          + '<button data-act="del" title="삭제">✕</button>';
      } else {
        row.innerHTML = '<div class="scan-tray-grip">'
          + '<span class="pdf-chip-icon">📄</span>'
          + '<span class="name">' + escapeHtml(item.name) + ' (' + item.pageCount + 'p)</span>'
          + '</div>'
          + '<button data-act="del" title="삭제">✕</button>';
      }
      row.querySelectorAll('button').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const act = btn.dataset.act;
          if (act === 'del') docPages.splice(idx, 1);
          else if (act === 'rotate') item.rotation = (item.rotation + 90) % 360;
          renderTray();
        });
      });
      setupTrayDrag(row);
      scanTray.appendChild(row);
    });
  }

  // ---- 바구니 항목 순서 바꾸기 — 버튼 대신, 항목의 "버튼 없는 영역(사진+이름)"을 잡고
  // 끄는 방식. 끄는 도중 다른 항목 위로 넘어가면 그 자리로 실시간으로 옮겨진다. 손을 떼면
  // 그 시점의 화면 순서를 그대로 docPages 배열에 반영한다. ----
  function setupTrayDrag(row){
    const grip = row.querySelector('.scan-tray-grip');

    function onMove(e){
      const after = getTrayDragAfterElement(e.clientY);
      if (after == null) scanTray.appendChild(row);
      else if (after !== row) scanTray.insertBefore(row, after);
    }
    function onEnd(){
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      row.classList.remove('dragging');
      // 지금 화면에 보이는 순서 그대로 docPages 배열을 다시 만든다.
      const newOrder = Array.from(scanTray.children).map(el => Number(el.dataset.idx));
      docPages = newOrder.map(i => docPages[i]);
      renderTray();
    }
    grip.addEventListener('pointerdown', (e)=>{
      e.preventDefault(); // 이미지 기본 드래그 등 브라우저 기본 동작이 끼어들지 않게 함
      row.classList.add('dragging');
      // grip 하나에만 걸지 않고 document 전체에서 받는다 — 포인터가 손잡이 밖으로 빠르게
      // 벗어나도(빠르게 끌 때 자주 생김) 이동/종료 이벤트를 놓치지 않기 위함.
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    });
  }

  function getTrayDragAfterElement(y){
    const items = Array.from(scanTray.querySelectorAll('.scan-tray-item:not(.dragging)'));
    return items.reduce((closest, child)=>{
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: -Infinity, element: null }).element;
  }

  // ============================================================
  // PDF 관리 — 스캔과 별도 메뉴. 이미 저장된 PDF들을 페이지 단위로 불러와서
  // 합치기·발췌·순서변경을 할 수 있다. 오늘 만든 바구니(드래그 재정렬) UI를 그대로 재사용하되,
  // 페이지별 체크박스를 얹어서 "선택한 페이지만 따로 뽑아 저장"이 가능하게 한다.
  // ============================================================
  // pdf.js는 실제 렌더링을 별도 워커에서 돌리므로, 워커 스크립트 위치를 지정해줘야 한다.
  if (typeof pdfjsLib !== 'undefined'){
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
  }

  const pdfMgrOverlay = document.getElementById('pdfMgrOverlay');
  const pdfMgrList = document.getElementById('pdfMgrList');
  const pdfMgrFileInput = document.getElementById('pdfMgrFileInput');
  const pdfMgrExtractName = document.getElementById('pdfMgrExtractName');
  const pdfMgrSaveName = document.getElementById('pdfMgrSaveName');
  const pdfMgrWatermarkText = document.getElementById('pdfMgrWatermarkText');
  const pdfMgrSignatureInput = document.getElementById('pdfMgrSignatureInput');
  const pdfMgrSignatureStatus = document.getElementById('pdfMgrSignatureStatus');
  const pdfMgrSignaturePos = document.getElementById('pdfMgrSignaturePos');

  let pdfMgrEntries = []; // { id, doc(PDFLib 문서객체), sourceName, pageIndex, checked, rotation }
  let pdfMgrIdSeq = 1;
  let pdfMgrSignatureBytes = null; // 도장처럼 찍을 서명 이미지(선택 안 하면 null)

  // ---- 서명 관리(2026.07 추가) ----
  // 예전엔 서명을 쓸 때마다 매번 파일을 다시 찾아 선택해야 했다. 이제는 한 번 등록한 서명을
  // 브라우저(localStorage)에 저장해뒀다가 다음에 자동으로 다시 불러오고, 파일 업로드뿐 아니라
  // 화면(터치/마우스)에 직접 그려서 바로 등록할 수도 있다.
  const SIGNATURE_STORAGE_KEY = 'nx_saved_signature';

  function updateSignatureStatusUI(){
    pdfMgrSignatureStatus.textContent = pdfMgrSignatureBytes
      ? '서명 등록됨 — 저장 시 모든 페이지 우측 하단에 찍힙니다'
      : '';
  }

  function bytesToDataUrl_(bytes, mime){
    mime = mime || 'image/png';
    let binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return 'data:' + mime + ';base64,' + btoa(binary);
  }

  function dataUrlToBytes_(dataUrl){
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function saveSignatureBytes_(bytes){
    pdfMgrSignatureBytes = bytes;
    try { localStorage.setItem(SIGNATURE_STORAGE_KEY, bytesToDataUrl_(bytes)); }
    catch (e) { showToast('서명을 브라우저에 저장하지 못했습니다(용량 초과 가능) — 이번 화면에서는 계속 쓸 수 있습니다.', 'warning'); }
    updateSignatureStatusUI();
    refreshSigManagePreview();
  }

  function clearSignature_(){
    pdfMgrSignatureBytes = null;
    try { localStorage.removeItem(SIGNATURE_STORAGE_KEY); } catch (e) {}
    updateSignatureStatusUI();
    refreshSigManagePreview();
  }

  // 이전에 등록해둔 서명이 있으면 화면을 열 때 자동으로 불러온다 — 이제부터는 파일을 다시
  // 찾지 않아도 계속 같은 서명이 쓰인다.
  try {
    const savedSignatureDataUrl = localStorage.getItem(SIGNATURE_STORAGE_KEY);
    if (savedSignatureDataUrl) pdfMgrSignatureBytes = dataUrlToBytes_(savedSignatureDataUrl);
  } catch (e) {}
  updateSignatureStatusUI();

  // ---- 서명 관리 모달: 미리보기 · 파일교체 · 삭제 · 직접 그리기 ----
  const sigManageOverlay = document.getElementById('sigManageOverlay');
  const sigManagePreviewImg = document.getElementById('sigManagePreviewImg');
  const sigManageEmptyLabel = document.getElementById('sigManageEmptyLabel');
  const sigManagePreviewWrap = document.getElementById('sigManagePreviewWrap');
  const sigManageDrawWrap = document.getElementById('sigManageDrawWrap');
  const sigDrawCanvas = document.getElementById('sigDrawCanvas');

  function refreshSigManagePreview(){
    if (pdfMgrSignatureBytes){
      sigManagePreviewImg.src = bytesToDataUrl_(pdfMgrSignatureBytes);
      sigManagePreviewImg.style.display = '';
      sigManageEmptyLabel.style.display = 'none';
    } else {
      sigManagePreviewImg.style.display = 'none';
      sigManageEmptyLabel.style.display = '';
    }
  }

  function openSigManage(){
    sigManagePreviewWrap.style.display = 'flex';
    sigManageDrawWrap.style.display = 'none';
    refreshSigManagePreview();
    sigManageOverlay.style.display = 'flex';
  }
  function closeSigManage(){ sigManageOverlay.style.display = 'none'; }

  document.getElementById('btnPdfMgrSignature').addEventListener('click', openSigManage);
  document.getElementById('btnCloseSigManage').addEventListener('click', closeSigManage);

  document.getElementById('btnSigManageFromFile').addEventListener('click', ()=> pdfMgrSignatureInput.click());
  pdfMgrSignatureInput.addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    pdfMgrSignatureInput.value = '';
    if (!file) return;
    saveSignatureBytes_(new Uint8Array(await file.arrayBuffer()));
    showToast('서명이 등록됐습니다.', 'success');
  });

  document.getElementById('btnSigManageDelete').addEventListener('click', ()=>{
    if (!pdfMgrSignatureBytes) return;
    if (confirm('등록된 서명을 삭제할까요?')) clearSignature_();
  });

  // 화면(터치·마우스)에 직접 그려서 그 자리에서 바로 서명을 받는 서명패드.
  // 상담메모(노트필기)와 같은 pointer 이벤트 방식이지만, 여긴 훨씬 단순하게(펜 하나·되돌리기 없이) 구성했다.
  document.getElementById('btnSigManageDraw').addEventListener('click', ()=>{
    sigManagePreviewWrap.style.display = 'none';
    sigManageDrawWrap.style.display = 'flex';
    setupSigDrawCanvas_();
  });
  document.getElementById('btnSigDrawCancel').addEventListener('click', ()=>{
    sigManageDrawWrap.style.display = 'none';
    sigManagePreviewWrap.style.display = 'flex';
  });

  let sigDrawCtx = null;
  let sigDrawing = false;
  function setupSigDrawCanvas_(){
    // 화면에 보이는 CSS 크기 기준으로 캔버스 실제 픽셀 크기를 맞춘다(고해상도 화면에서도 선명하게).
    const rect = sigDrawCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    sigDrawCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    sigDrawCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    sigDrawCtx = sigDrawCanvas.getContext('2d');
    sigDrawCtx.scale(dpr, dpr);
    sigDrawCtx.fillStyle = '#fff';
    sigDrawCtx.fillRect(0, 0, rect.width, rect.height);
    sigDrawCtx.lineWidth = 2.5;
    sigDrawCtx.lineCap = 'round';
    sigDrawCtx.lineJoin = 'round';
    sigDrawCtx.strokeStyle = '#1a1a2e';
  }
  function sigDrawPos_(e){
    const rect = sigDrawCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  sigDrawCanvas.addEventListener('pointerdown', (e)=>{
    if (!sigDrawCtx) return;
    sigDrawing = true;
    sigDrawCanvas.setPointerCapture(e.pointerId);
    const p = sigDrawPos_(e);
    sigDrawCtx.beginPath();
    sigDrawCtx.moveTo(p.x, p.y);
  });
  sigDrawCanvas.addEventListener('pointermove', (e)=>{
    if (!sigDrawing || !sigDrawCtx) return;
    const p = sigDrawPos_(e);
    sigDrawCtx.lineTo(p.x, p.y);
    sigDrawCtx.stroke();
  });
  function endSigDraw_(){ sigDrawing = false; }
  sigDrawCanvas.addEventListener('pointerup', endSigDraw_);
  sigDrawCanvas.addEventListener('pointercancel', endSigDraw_);
  sigDrawCanvas.addEventListener('pointerleave', endSigDraw_);

  document.getElementById('btnSigDrawClear').addEventListener('click', ()=>{
    if (!sigDrawCtx) return;
    const rect = sigDrawCanvas.getBoundingClientRect();
    sigDrawCtx.fillStyle = '#fff';
    sigDrawCtx.fillRect(0, 0, rect.width, rect.height);
  });

  document.getElementById('btnSigDrawSave').addEventListener('click', ()=>{
    if (!sigDrawCtx) return;
    sigDrawCanvas.toBlob(async (blob)=>{
      if (!blob){ showToast('서명 이미지를 만들지 못했습니다.', 'error'); return; }
      saveSignatureBytes_(new Uint8Array(await blob.arrayBuffer()));
      sigManageDrawWrap.style.display = 'none';
      sigManagePreviewWrap.style.display = 'flex';
      showToast('서명이 등록됐습니다.', 'success');
    }, 'image/png');
  });

  function openPdfManager(){
    pdfMgrOverlay.style.display = 'flex';
  }
  function closePdfManager(){ pdfMgrOverlay.style.display = 'none'; }
  document.getElementById('btnOpenPdfManagerFromScan').addEventListener('click', openPdfManager);
  document.getElementById('btnClosePdfMgr').addEventListener('click', closePdfManager);

  // [2026.08] 탐색기에서 PDF 파일을 클릭했을 때 "PDF 관리로 열기"를 고르면 여기로 온다.
  // 지금까지 PDF관리는 컴퓨터에서 새로 고른 파일(pdfMgrFileInput)만 넣을 수 있었는데,
  // 폴더에 이미 있는 파일을 그대로 불러오는 길이 없어서 새로 만들었다 — 백엔드의
  // readFileBinary 액션(원본 바이트 그대로 반환)으로 받아와서, 로컬 업로드와 완전히 같은
  // 방식(PDFLib+pdf.js로 파싱해서 페이지 단위로 등록)으로 처리한다.
  window.openExistingFileInPdfManager = async function(file){
    showToast(file.name + ' 불러오는 중입니다…', 'info');
    try{
      const res = await callGas('readFileBinary', { fileId: file.id });
      if (res.error){ showToast('불러오기 실패: ' + res.error, 'error'); return; }
      const binary = atob(res.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const doc = await PDFLib.PDFDocument.load(bytes);
      const pdfjsDoc = (typeof pdfjsLib !== 'undefined') ? await pdfjsLib.getDocument({ data: bytes.slice() }).promise : null;
      const sourceName = file.name.replace(/\.pdf$/i, '');
      const pageCount = doc.getPageCount();
      for (let i = 0; i < pageCount; i++){
        pdfMgrEntries.push({ id: pdfMgrIdSeq++, type: 'pdfpage', doc, pdfjsDoc, sourceName, pageIndex: i, checked: false, rotation: 0 });
      }
      renderPdfMgrList();
      openPdfManager();
    }catch(err){
      showToast(file.name + ' 불러오기 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }
  };

  document.getElementById('btnPdfMgrAdd').addEventListener('click', ()=> pdfMgrFileInput.click());
  pdfMgrFileInput.addEventListener('change', async (e)=>{
    const files = Array.from(e.target.files || []);
    pdfMgrFileInput.value = '';
    for (const file of files){
      try{
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await PDFLib.PDFDocument.load(bytes);
        // pdf.js는 pdf-lib와 별개의 파서라, 렌더링(서명 배치용)을 위해 따로 한 번 더 읽어둔다.
        // 같은 배열을 그대로 넘기면 나중에 detach되는 문제가 있어 복사본을 넘긴다.
        const pdfjsDoc = (typeof pdfjsLib !== 'undefined') ? await pdfjsLib.getDocument({ data: bytes.slice() }).promise : null;
        const sourceName = file.name.replace(/\.pdf$/i, '');
        const pageCount = doc.getPageCount();
        for (let i = 0; i < pageCount; i++){
          pdfMgrEntries.push({ id: pdfMgrIdSeq++, type: 'pdfpage', doc, pdfjsDoc, sourceName, pageIndex: i, checked: false, rotation: 0 });
        }
      }catch(err){
        showToast(file.name + ' 불러오기 실패: ' + (err && err.message ? err.message : err), 'error');
      }
    }
    renderPdfMgrList();
  });

  function renderPdfMgrList(){
    pdfMgrList.innerHTML = '';
    pdfMgrEntries.forEach((entry, idx)=>{
      const row = document.createElement('div');
      row.className = 'scan-tray-item';
      row.dataset.idx = idx;
      const isImage = entry.type === 'image';
      const rotLabel = (!isImage && entry.rotation) ? (' (' + entry.rotation + '° 회전)') : '';
      const signedLabel = isImage ? ' (서명 적용됨 — 그림 페이지)' : '';
      const chipIcon = isImage ? '🖋' : '📄';
      // 서명 배치·회전은 원본 페이지 상태일 때만 의미가 있다 — 이미 그림으로 바뀐 페이지는
      // 다시 서명 위치를 잡거나 돌릴 필요가 없으므로(이미 그림에 고정됨) 버튼 자체를 안 보여준다.
      const signBtn = !isImage ? '<button data-act="sign" title="이 페이지에 서명 정밀 배치">✍</button>' : '';
      const rotateBtn = !isImage ? '<button data-act="rotate" title="90도 회전 — 원본이 옆으로/거꾸로 되어 있을 때">↻</button>' : '';
      row.innerHTML = '<label class="pdf-mgr-check"><input type="checkbox"' + (entry.checked ? ' checked' : '') + '></label>'
        + '<div class="scan-tray-grip"><span class="pdf-chip-icon">' + chipIcon + '</span>'
        + '<span class="name">' + escapeHtml(entry.sourceName) + ' - ' + (entry.pageIndex + 1) + '페이지' + rotLabel + signedLabel + '</span></div>'
        + signBtn + rotateBtn
        + '<button data-act="del" title="목록에서 빼기">✕</button>';
      row.querySelector('input[type="checkbox"]').addEventListener('change', (e)=>{
        entry.checked = e.target.checked;
      });
      row.querySelectorAll('button').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const act = btn.dataset.act;
          if (act === 'del'){ pdfMgrEntries.splice(idx, 1); renderPdfMgrList(); }
          else if (act === 'rotate'){ entry.rotation = (entry.rotation + 90) % 360; renderPdfMgrList(); }
          else if (act === 'sign'){ openSignaturePlacement(entry, idx); }
        });
      });
      setupPdfMgrDrag(row);
      pdfMgrList.appendChild(row);
    });
  }

  // 드래그 재정렬 — 스캔 바구니와 완전히 같은 방식(document 전체에서 이동/종료 신호를 받음).
  function setupPdfMgrDrag(row){
    const grip = row.querySelector('.scan-tray-grip');
    function onMove(e){
      const after = getPdfMgrDragAfterElement(e.clientY);
      if (after == null) pdfMgrList.appendChild(row);
      else if (after !== row) pdfMgrList.insertBefore(row, after);
    }
    function onEnd(){
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
      document.removeEventListener('pointercancel', onEnd);
      row.classList.remove('dragging');
      const newOrder = Array.from(pdfMgrList.children).map(el => Number(el.dataset.idx));
      pdfMgrEntries = newOrder.map(i => pdfMgrEntries[i]);
      renderPdfMgrList();
    }
    grip.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      row.classList.add('dragging');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    });
  }
  function getPdfMgrDragAfterElement(y){
    const items = Array.from(pdfMgrList.querySelectorAll('.scan-tray-item:not(.dragging)'));
    return items.reduce((closest, child)=>{
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: -Infinity, element: null }).element;
  }

  // ---- 🔤 텍스트 추출(OCR) — 체크한 페이지를 이미지로 그려서 Tesseract.js로 글자를 읽어낸다.
  // 전부 브라우저 안에서 처리되고 서버(Anthropic API 등)로는 아무것도 전송되지 않는다
  // (API 비용이 전혀 안 든다). 인쇄된 문서(등기부등본·세금계산서 등)에 적합하고,
  // 손글씨는 정확도가 낮으니 그런 경우는 필기상담(자동 텍스트 변환) 쪽을 쓰는 게 낫다.
  let tesseractWorker_ = null;
  async function getTesseractWorker_(){
    if (tesseractWorker_) return tesseractWorker_;
    tesseractWorker_ = await Tesseract.createWorker(['kor', 'eng']);
    return tesseractWorker_;
  }

  async function renderPdfMgrEntryToCanvas_(entry){
    if (!entry.pdfjsDoc) throw new Error('이 페이지는 미리보기용 문서가 없어 텍스트를 추출할 수 없습니다.');
    const page = await entry.pdfjsDoc.getPage(entry.pageIndex + 1);
    const viewport = page.getViewport({ scale: 2.5, rotation: entry.rotation || 0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }

  document.getElementById('btnPdfMgrOcr').addEventListener('click', async ()=>{
    const targets = pdfMgrEntries.filter(en => en.checked);
    if (!targets.length){ showToast('텍스트를 추출할 페이지를 먼저 체크하세요.', 'warning'); return; }
    const btn = document.getElementById('btnPdfMgrOcr');
    btn.disabled = true;
    try{
      const worker = await getTesseractWorker_();
      const parts = [];
      for (let i = 0; i < targets.length; i++){
        btn.textContent = '🔤 추출 중… (' + (i + 1) + '/' + targets.length + ')';
        const entry = targets[i];
        try{
          const canvas = await renderPdfMgrEntryToCanvas_(entry);
          const { data } = await worker.recognize(canvas);
          const label = entry.sourceName + ' - ' + (entry.pageIndex + 1) + '페이지';
          parts.push('[' + label + ']\n' + (data.text || '').trim());
        }catch(err){
          parts.push('[' + entry.sourceName + ' - ' + (entry.pageIndex + 1) + '페이지] 텍스트 추출 실패: ' + (err && err.message ? err.message : err));
        }
      }
      const combined = parts.join('\n\n---\n\n');
      chatInputEl.value = chatInputEl.value ? (chatInputEl.value + '\n\n' + combined) : combined;
      showToast(targets.length + '개 페이지에서 텍스트를 추출해 입력창에 넣었습니다.', 'success');
    }catch(err){
      showToast('텍스트 추출 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btn.disabled = false;
      btn.textContent = '🔤 텍스트 추출';
    }
  });

  // ---- 📊 엑셀 열기 — excel-viewer.html을 크기조절 가능한 독립창(window.open)으로 연다.
  // [패치 2026.07] 예전엔 페이지 안 고정크기(최대너비 820px, 높이 60vh) 모달이라 큰 시트를
  // 작업하기 어려웠다("작고 고정된 창으로 어떻게 작업하나" 지적) — report-writer 편집창과
  // 완전히 같은 방식(파일별 독립 팝업, OS 창닫기/크기조절/최대화 그대로 지원)으로 바꿨다.
  // 실제 렌더링·SheetJS 로직은 전부 excel-viewer.html로 옮겼고, 여기는 그 창을 열고
  // 파일별로 재사용하는 역할만 한다.
  const excelPopupWins = {};
  function excelPopupKey(file){ return file ? ('f_' + file.id) : '__blank__'; }
  function openExcelPopup(file){
    const key = excelPopupKey(file);
    const url = 'excel-viewer.html' + (file ? ('?fileId=' + encodeURIComponent(file.id) + '&name=' + encodeURIComponent(file.name)) : '');
    const existing = excelPopupWins[key];
    if (existing && !existing.closed){ existing.focus(); return; }
    const w = Math.round(window.innerWidth * 0.85);
    const h = Math.round(window.innerHeight * 0.85);
    const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
    const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
    const win = window.open(url, 'nxExcelWindow_' + key, 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
    if (!win){
      showToast('새 창이 차단된 것 같습니다. 브라우저에서 이 사이트의 팝업 허용을 켜주세요.', 'warning');
      return;
    }
    excelPopupWins[key] = win;
    win.focus();
  }
  window.openExcelViewer = function(){ openExcelPopup(null); }; // 도구 그룹 목록 등록 시점보다 나중에 정의되므로 전역에 걸어둠 (하단바 "📊 엑셀 열기" 버튼용)
  window.openExcelViewerFromDriveFile = function(file){ openExcelPopup(file); }; // 탐색창에서 엑셀 파일 클릭했을 때(openEditor)

  document.getElementById('btnPdfMgrCheckAll').addEventListener('click', ()=>{
    if (!pdfMgrEntries.length) return;
    const allChecked = pdfMgrEntries.every(en => en.checked);
    pdfMgrEntries.forEach(en => { en.checked = !allChecked; });
    renderPdfMgrList();
  });

  // 체크된(또는 전체) 항목들을 순서 그대로 하나의 새 PDF 바이트로 만든다.
  // ---- 서명 정밀 배치 ----
  const sigPlaceOverlay = document.getElementById('sigPlaceOverlay');
  const sigPlaceCanvas = document.getElementById('sigPlaceCanvas');
  const sigPlaceSigImg = document.getElementById('sigPlaceSigImg');
  const sigPlaceStage = document.getElementById('sigPlaceStage');
  let sigPlaceEntryIdx = -1;
  let sigPlaceOriginalEntry = null;
  let sigPlaceViewportScale = 1.5; // pdf.js 렌더링 배율(포인트 단위를 화면 px로 확대해서 그림)

  async function openSignaturePlacement(entry, idx){
    if (!pdfMgrSignatureBytes){ showToast('먼저 "🖋 서명 이미지"로 서명을 등록하세요.', 'warning'); return; }
    if (!entry.pdfjsDoc){ showToast('이 파일은 미리보기를 지원하지 않습니다.', 'error'); return; }
    sigPlaceEntryIdx = idx;
    sigPlaceOriginalEntry = entry;
    sigPlaceOverlay.style.display = 'flex';
    try{
      const page = await entry.pdfjsDoc.getPage(entry.pageIndex + 1); // pdf.js 페이지 번호는 1부터 시작
      const viewport = page.getViewport({ scale: sigPlaceViewportScale });
      sigPlaceCanvas.width = viewport.width;
      sigPlaceCanvas.height = viewport.height;
      sigPlaceStage.style.width = viewport.width + 'px';
      sigPlaceStage.style.height = viewport.height + 'px';
      await page.render({ canvasContext: sigPlaceCanvas.getContext('2d'), viewport }).promise;

      const sigBlobUrl = URL.createObjectURL(new Blob([pdfMgrSignatureBytes]));
      sigPlaceSigImg.src = sigBlobUrl;
      sigPlaceSigImg.style.width = '150px';
      sigPlaceSigImg.style.height = 'auto';
      sigPlaceSigImg.style.left = Math.max(0, viewport.width - 170) + 'px';
      sigPlaceSigImg.style.top = Math.max(0, viewport.height - 110) + 'px';
    }catch(err){
      showToast('페이지 미리보기 실패: ' + (err && err.message ? err.message : err), 'error');
      sigPlaceOverlay.style.display = 'none';
    }
  }
  function closeSignaturePlacement(){ sigPlaceOverlay.style.display = 'none'; }
  document.getElementById('btnCloseSigPlace').addEventListener('click', closeSignaturePlacement);

  // 서명 이미지를 손가락/마우스로 끌어서 원하는 자리로 옮기는 로직(오늘 만든 드래그와 같은 방식)
  (function setupSigDrag(){
    let dragging = false, offX = 0, offY = 0;
    sigPlaceSigImg.addEventListener('pointerdown', (e)=>{
      dragging = true;
      const rect = sigPlaceSigImg.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('pointermove', (e)=>{
      if (!dragging) return;
      const stageRect = sigPlaceStage.getBoundingClientRect();
      sigPlaceSigImg.style.left = (e.clientX - stageRect.left - offX) + 'px';
      sigPlaceSigImg.style.top = (e.clientY - stageRect.top - offY) + 'px';
    });
    document.addEventListener('pointerup', ()=>{ dragging = false; });
    document.addEventListener('pointercancel', ()=>{ dragging = false; });
  })();

  // "적용" — 지금 화면(페이지 그림 + 그 위 서명 위치)을 그대로 합쳐서 하나의 이미지로 굽고,
  // 그 페이지를 "그림 기반 페이지"로 바꿔치기한다.
  document.getElementById('btnSigPlaceConfirm').addEventListener('click', async ()=>{
    const ctx = sigPlaceCanvas.getContext('2d');
    const stageRect = sigPlaceStage.getBoundingClientRect();
    const imgRect = sigPlaceSigImg.getBoundingClientRect();
    const drawX = imgRect.left - stageRect.left;
    const drawY = imgRect.top - stageRect.top;
    ctx.drawImage(sigPlaceSigImg, drawX, drawY, sigPlaceSigImg.offsetWidth, sigPlaceSigImg.offsetHeight);
    const finalDataUrl = sigPlaceCanvas.toDataURL('image/png');

    // 나중에 PDF로 다시 넣을 때 원래 페이지와 같은 실제 크기(포인트 단위)가 되도록 미리 구해둔다.
    const originalPage = sigPlaceOriginalEntry.doc.getPage(sigPlaceOriginalEntry.pageIndex);
    const { width: ptW, height: ptH } = originalPage.getSize();

    pdfMgrEntries[sigPlaceEntryIdx] = {
      id: sigPlaceOriginalEntry.id,
      type: 'image',
      sourceName: sigPlaceOriginalEntry.sourceName,
      pageIndex: sigPlaceOriginalEntry.pageIndex,
      checked: sigPlaceOriginalEntry.checked,
      imageDataUrl: finalDataUrl,
      pagePtWidth: ptW,
      pagePtHeight: ptH
    };
    renderPdfMgrList();
    closeSignaturePlacement();
    showToast('서명을 적용했습니다. 이 페이지는 이제 그림 기반 페이지입니다.', 'success');
  });

  async function buildPdfFromPdfMgrEntries(entries){
    const outDoc = await PDFLib.PDFDocument.create();

    // 워터마크 — 문구가 있으면 모든 페이지에 대각선으로 반투명하게 깐다.
    // 주의: 기본 내장 폰트(Helvetica)는 영문/숫자만 정확히 나온다 — 한글은 깨지거나
    // 안 나올 수 있으니, 워터마크 문구는 영문 위주로 쓰는 걸 권장한다(예: DRAFT, CONFIDENTIAL).
    const watermarkText = pdfMgrWatermarkText.value.trim();
    const watermarkFont = watermarkText ? await outDoc.embedFont(PDFLib.StandardFonts.HelveticaBold) : null;

    // 서명(도장) — 등록되어 있으면 한 번만 삽입(embed)해두고 페이지마다 재사용한다.
    let signatureImage = null;
    if (pdfMgrSignatureBytes){
      try{ signatureImage = await outDoc.embedPng(pdfMgrSignatureBytes); }
      catch(e){
        try{ signatureImage = await outDoc.embedJpg(pdfMgrSignatureBytes); }
        catch(e2){ showToast('서명 이미지 형식을 읽지 못해 서명 없이 진행합니다.', 'warning'); }
      }
    }

    for (const entry of entries){
      if (entry.type === 'image'){
        // 서명 정밀배치로 이미 그림으로 확정된 페이지 — 원래 페이지와 같은 크기로 새 페이지를 만들고
        // 그 그림을 그대로 채운다(이미 서명은 그림 안에 포함되어 있음). 워터마크만 그 위에 추가로 얹을 수 있다.
        const pngBytes = dataUrlToUint8(entry.imageDataUrl);
        const embedded = await outDoc.embedPng(pngBytes);
        const page = outDoc.addPage([entry.pagePtWidth, entry.pagePtHeight]);
        page.drawImage(embedded, { x: 0, y: 0, width: entry.pagePtWidth, height: entry.pagePtHeight });
        if (watermarkText){
          page.drawText(watermarkText, {
            x: entry.pagePtWidth / 2 - watermarkText.length * 9,
            y: entry.pagePtHeight / 2,
            size: 40, font: watermarkFont, color: PDFLib.rgb(0.6, 0.6, 0.6), opacity: 0.28,
            rotate: PDFLib.degrees(45)
          });
        }
        continue;
      }

      const [copied] = await outDoc.copyPages(entry.doc, [entry.pageIndex]);
      if (entry.rotation){
        const currentAngle = copied.getRotation().angle || 0;
        copied.setRotation(PDFLib.degrees((currentAngle + entry.rotation) % 360));
      }
      const { width, height } = copied.getSize();

      if (watermarkText){
        copied.drawText(watermarkText, {
          x: width / 2 - watermarkText.length * 9,
          y: height / 2,
          size: 40,
          font: watermarkFont,
          color: PDFLib.rgb(0.6, 0.6, 0.6),
          opacity: 0.28,
          rotate: PDFLib.degrees(45)
        });
      }
      if (signatureImage){
        const sigW = 120, sigH = 120 * (signatureImage.height / signatureImage.width);
        const margin = 24;
        const pos = pdfMgrSignaturePos.value;
        let sx, sy;
        if (pos === 'bl'){ sx = margin; sy = margin; }
        else if (pos === 'tr'){ sx = width - sigW - margin; sy = height - sigH - margin; }
        else if (pos === 'tl'){ sx = margin; sy = height - sigH - margin; }
        else if (pos === 'center'){ sx = width / 2 - sigW / 2; sy = height / 2 - sigH / 2; }
        else { sx = width - sigW - margin; sy = margin; } // 기본값: 우측 하단(br)
        copied.drawImage(signatureImage, { x: sx, y: sy, width: sigW, height: sigH });
      }

      outDoc.addPage(copied);
    }
    return await outDoc.save();
  }

  document.getElementById('btnPdfMgrExtract').addEventListener('click', async ()=>{
    const checked = pdfMgrEntries.filter(en => en.checked);
    if (!checked.length){ showToast('추출할 페이지를 먼저 체크하세요.', 'warning'); return; }
    const name = (pdfMgrExtractName.value.trim() || '추출') + '.pdf';
    const btn = document.getElementById('btnPdfMgrExtract');
    btn.disabled = true; btn.textContent = '처리 중…';
    try{
      const bytes = await buildPdfFromPdfMgrEntries(checked);
      const base64 = uint8ToBase64(bytes);
      const res = await callGas('uploadFile', { path: explorerPath, name, mimeType: 'application/pdf', base64Data: base64 });
      if (res.error){ showToast('저장 실패: ' + res.error, 'error'); return; }
      showToast('추출해서 저장했습니다: ' + name, 'success');
      navigateTo(explorerPath);
      if (confirm('추출한 ' + checked.length + '개 페이지를 지금 목록에서 지울까요?\n(취소하면 그대로 남습니다)')){
        pdfMgrEntries = pdfMgrEntries.filter(en => !en.checked);
        renderPdfMgrList();
      }
    }catch(err){
      showToast('추출 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btn.disabled = false; btn.textContent = '✂ 선택 추출';
    }
  });

  document.getElementById('btnPdfMgrSaveAll').addEventListener('click', async ()=>{
    if (!pdfMgrEntries.length){ showToast('목록이 비어 있습니다.', 'warning'); return; }
    const name = (pdfMgrSaveName.value.trim() || '문서') + '.pdf';
    const btn = document.getElementById('btnPdfMgrSaveAll');
    btn.disabled = true; btn.textContent = '처리 중…';
    try{
      const bytes = await buildPdfFromPdfMgrEntries(pdfMgrEntries);
      const base64 = uint8ToBase64(bytes);
      const res = await callGas('uploadFile', { path: explorerPath, name, mimeType: 'application/pdf', base64Data: base64 });
      if (res.error){ showToast('저장 실패: ' + res.error, 'error'); return; }
      showToast('저장했습니다: ' + name, 'success');
      navigateTo(explorerPath);
    }catch(err){
      showToast('저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btn.disabled = false; btn.textContent = '💾 전체 저장';
    }
  });

  // ---- PDF 생성/내보내기/저장 ----
  function dataUrlToUint8(dataUrl){
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function uint8ToBase64(bytes){
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  function getRotatedJpegBytes(item){
    if (!item.rotation) return Promise.resolve(dataUrlToUint8(item.dataUrl));
    return new Promise((resolve)=>{
      const img = new Image();
      img.onload = ()=>{
        const swapped = item.rotation % 180 !== 0;
        const cw = swapped ? img.height : img.width;
        const ch = swapped ? img.width : img.height;
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.translate(cw/2, ch/2);
        ctx.rotate(item.rotation * Math.PI/180);
        ctx.drawImage(img, -img.width/2, -img.height/2);
        canvas.toBlob((blob)=>{
          blob.arrayBuffer().then((buf)=> resolve(new Uint8Array(buf)));
        }, 'image/jpeg', 0.9);
      };
      img.src = item.dataUrl;
    });
  }

  async function buildPdfBytes(){
    // ①단계(귀퉁이 조절)까지만 마치고 "담기"를 아직 안 눌렀어도,
    // 다운로드/저장/요약 버튼을 누르면 지금 조절해둔 영역을 자동으로 담아준다.
    if (scanImageEl && scanCorners && scanStageWrap.style.display !== 'none'){
      try{ warpAndAddPage(); }catch(err){ /* 여기서 실패해도 아래 담긴 페이지 여부로 정상 처리됨 */ }
    }
    if (!docPages.length) return null;
    const outDoc = await PDFLib.PDFDocument.create();
    for (const item of docPages){
      if (item.type === 'image'){
        const jpegBytes = await getRotatedJpegBytes(item);
        const embedded = await outDoc.embedJpg(jpegBytes);
        const { width, height } = embedded;
        const page = outDoc.addPage([width, height]);
        page.drawImage(embedded, { x:0, y:0, width, height });
      } else {
        const srcDoc = await PDFLib.PDFDocument.load(item.bytes);
        const copied = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        copied.forEach(p => outDoc.addPage(p));
      }
    }
    return await outDoc.save();
  }

  const btnScanSummarize = document.getElementById('btnScanSummarize');
  btnScanSummarize.addEventListener('click', async ()=>{
    btnScanSummarize.disabled = true; btnScanSummarize.textContent = '준비 중…';
    try{
      const bytes = await buildPdfBytes();
      if (!bytes){ showToast('담긴 페이지가 없습니다. 먼저 스캔하거나 페이지를 추가해주세요.', 'warning'); return; }
      const base64 = uint8ToBase64(bytes);
      const name = (scanOutputName.value.trim() || '스캔문서') + '.pdf';
      // 드라이브에 저장하지 않고, 지금 만든 PDF를 그대로 채팅에 첨부해서 바로 요약을 물어본다(원터치).
      pendingRefMedia.push({
        id: 'ref' + Date.now(),
        name: name,
        block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      });
      closeScanModal();
      chatInputEl.value = '방금 스캔한 문서 내용을 요약해줘.';
      sendChatMessage();
    }catch(err){
      showToast('요약 준비 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btnScanSummarize.disabled = false; btnScanSummarize.textContent = '🔎 AI 요약';
    }
  });

  btnDownloadPdf.addEventListener('click', async ()=>{
    btnDownloadPdf.disabled = true; btnDownloadPdf.textContent = '만드는 중…';
    try{
      const bytes = await buildPdfBytes();
      if (!bytes){ showToast('담긴 페이지가 없습니다.', 'warning'); return; }
      const blob = new Blob([bytes], { type:'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (scanOutputName.value.trim() || '문서') + '.pdf';
      a.click();
      URL.revokeObjectURL(url);
    }catch(err){
      showToast('PDF 생성 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btnDownloadPdf.disabled = false; btnDownloadPdf.textContent = 'PC에 다운로드';
    }
  });

  btnSaveToFolder.addEventListener('click', async ()=>{
    if (!explorerPath.length){ showToast('먼저 탐색기에서 저장할 고객/사건 폴더를 열어두세요.', 'warning'); return; }
    // [패치 2026.07 — 버그#7] 실제로 어느 폴더에 저장되는지 클릭 직전 값을 사용자에게
    // 한 번 더 확인시킨다(취소 가능) — 특히 탐색창이 안 보이는 화면 배치에서 유용.
    if (!confirm('"' + explorerPath.join(' / ') + '" 폴더에 저장합니다. 맞나요?')) return;
    btnSaveToFolder.disabled = true; btnSaveToFolder.textContent = '저장 중…';
    try{
      const bytes = await buildPdfBytes();
      if (!bytes){ showToast('담긴 페이지가 없습니다.', 'warning'); return; }
      const base64 = uint8ToBase64(bytes);
      const name = (scanOutputName.value.trim() || '문서') + '.pdf';
      const res = await callGas('uploadFile', { path: explorerPath, name: name, mimeType: 'application/pdf', base64Data: base64 });
      if (res.error){
        showToast('저장 실패: ' + res.error, 'error');
      } else {
        showToast('"' + explorerPath.join(' / ') + '" 폴더에 저장했습니다: ' + name, 'success');
        docPages = [];
        renderTray();
        // 저장했다고 모달을 자동으로 닫지 않는다 — 계속 스캔 작업을 이어갈 수 있어야 하므로,
        // 닫는 건 사용자가 직접 ✕ 버튼을 눌러서 하도록 남겨둔다.
        navigateTo(explorerPath); // 방금 저장한 파일이 탐색기에 바로 보이도록 새로고침
      }
    }catch(err){
      showToast('저장 중 오류: ' + (err && err.message ? err.message : err), 'error');
    }finally{
      btnSaveToFolder.disabled = false; btnSaveToFolder.textContent = '현재 폴더에 저장';
    }
  });

  // ---- 폰에서 열자마자 주소창이 접힌 채로 시작되도록 유도 ----
  // body 자체가 overflow:hidden 고정이라(내부 패널들이 각자 스크롤을 담당하는 구조라서)
  // 스크롤할 여백이 원래 없다 — 그래서 임시로 화면 아래에 살짝 여백을 만들어 스크롤 가능하게
  // 만든 다음, 1px만 스크롤을 시도하고, 끝나면 다시 원래대로(overflow:hidden) 되돌린다.
  // 다만 최신 브라우저 중에는 "사람이 직접 스크롤한 것"만 인정하고 이런 코드로 흉내낸 스크롤은
  // 무시하는 경우도 있어서, 기종에 따라 안 먹힐 수 있다는 점은 감안 부탁드린다.
  window.addEventListener('load', ()=>{
    const spacer = document.createElement('div');
    spacer.style.cssText = 'position:absolute; top:100%; left:0; width:1px; height:2px; pointer-events:none;';
    document.body.appendChild(spacer);
    document.body.style.overflow = 'auto';
    setTimeout(()=>{
      window.scrollTo(0, 1);
      setTimeout(()=>{
        document.body.style.overflow = 'hidden';
        spacer.remove();
      }, 300);
    }, 50);
  });
