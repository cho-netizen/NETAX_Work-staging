// [PWA] 홈 화면에 앱으로 설치한 뒤 아이콘을 길게 눌렀을 때 뜨는 바로가기 메뉴
// (새 메모/필기상담 — manifest.json의 shortcuts)를 쓰려면 서비스워커 등록이 install 조건 중 하나다.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// 바로가기 메뉴에서 "새 메모"/"필기상담"을 선택해 들어온 경우, 주소의 ?open= 값을 보고
// 해당 화면을 자동으로 연다. core.js~chat.js가 이 스크립트보다 먼저 로드되므로
// window.openQuickMemo / window.openNoteModal이 이 시점엔 이미 정의되어 있다.
(async function () {
  const openTarget = new URLSearchParams(location.search).get('open');
  if (!openTarget) return;
  history.replaceState(null, '', location.pathname);
  if (openTarget === 'memo' && typeof window.openQuickMemo === 'function') {
    window.openQuickMemo();
  } else if (openTarget === 'note' && typeof window.openNoteModal === 'function') {
    // 필기상담은 저장할 폴더(explorerPath)가 정해져 있어야 열리는데, 앱이 막 시작된 시점엔
    // 기본 고객 폴더 로딩(loadCustomers)이 아직 끝나지 않았을 수 있다 — 그 상태로 바로 열면
    // "폴더를 먼저 열어두세요" 경고만 뜨고 조용히 무시되므로, 로딩이 끝날 때까지 기다린다.
    if (window.__nxCustomersLoaded && typeof window.__nxCustomersLoaded.then === 'function') {
      await window.__nxCustomersLoaded.catch(() => {});
    }
    window.openNoteModal();
  }
})();
