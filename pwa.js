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
    await waitForCustomers_();
    window.openNoteModal();
  } else if (openTarget === 'share') {
    // 안드로이드 "공유하기"로 다른 앱(브라우저 등)에서 텍스트/이미지/PDF를 보낸 경우 —
    // 서비스워커(sw.js)가 공유 데이터를 Cache Storage에 담아두고 여기로 리다이렉트했다.
    // 이미지/PDF 첨부는 explorerPath(작업 폴더)가 필요하므로 폴더 로딩을 먼저 기다린다.
    await waitForCustomers_();
    await handleSharedPayload_();
  }
})();

async function waitForCustomers_() {
  if (window.__nxCustomersLoaded && typeof window.__nxCustomersLoaded.then === 'function') {
    await window.__nxCustomersLoaded.catch(() => {});
  }
}

async function handleSharedPayload_() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('nx-share-target-v1');
    const res = await cache.match('/__nx_share_payload__');
    if (!res) return;
    await cache.delete('/__nx_share_payload__');
    const payload = await res.json();
    const meta = { title: payload.title, url: payload.url, mode: 'share' };

    if (payload.text && payload.text.trim() && typeof window.insertCapturedText === 'function') {
      window.insertCapturedText(payload.text, meta);
    } else if (payload.url && !payload.files.length && typeof window.insertCapturedText === 'function') {
      window.insertCapturedText(payload.url, meta);
    }

    for (const f of (payload.files || [])) {
      if (f.type.indexOf('image/') === 0 && typeof window.insertCapturedImage === 'function') {
        await window.insertCapturedImage('data:' + f.type + ';base64,' + f.base64, meta);
      } else if (f.type === 'application/pdf' && typeof window.insertCapturedPdf === 'function') {
        await window.insertCapturedPdf(f.base64, f.name, meta);
      } else if (typeof window.insertCapturedText === 'function') {
        // 이미지·PDF가 아닌 파일(예: 텍스트 파일)은 내용을 문자열로 복원해 캡처 텍스트로 취급한다.
        try { window.insertCapturedText(atob(f.base64), meta); } catch (e) { /* 바이너리라 텍스트로 못 바꾸면 조용히 무시 */ }
      }
    }
  } catch (e) {
    // 공유 데이터를 못 읽어도 앱 사용에는 지장 없게 조용히 무시한다.
  }
}
