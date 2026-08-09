// [PWA] 안드로이드 크롬이 "설치 가능한 앱"으로 인식하려면 manifest.json 외에 서비스워커도
// 있어야 한다. 캐싱은 하지 않고 요청을 그대로 통과시키기만 한다 — GAS 백엔드에서 매번 최신
// 데이터를 받아와야 하는 앱 특성상, 캐시로 인해 오래된 데이터가 보이는 사고를 피하기 위함.
//
// 예외가 하나 있다 — manifest.json의 share_target(action: /index.html, POST)으로 들어오는
// 요청. 정적 호스팅(GitHub Pages)이라 서버가 POST를 받아 처리할 수 없으므로, 여기서
// 가로채서 공유된 텍스트/URL/파일을 꺼낸 뒤 Cache Storage에 잠깐 담아두고, index.html을
// 다시 GET으로 열도록 리다이렉트한다. index.html이 뜨면 pwa.js가 이 캐시를 읽어 처리한다.
const SHARE_CACHE = 'nx-share-target-v1';
const SHARE_KEY = '/__nx_share_payload__';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = [];
    for (const f of formData.getAll('files')) {
      if (f instanceof File) files.push({ name: f.name, type: f.type, base64: await blobToBase64(f) });
    }
    const payload = {
      title: formData.get('title') || '',
      text: formData.get('text') || '',
      url: formData.get('url') || '',
      files
    };
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(SHARE_KEY, new Response(JSON.stringify(payload)));
  } catch (e) {
    // 공유 데이터 처리에 실패해도 앱 자체는 정상적으로 열리게 한다(공유 반영만 조용히 무시).
  }
  return Response.redirect('/?open=share', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname === '/index.html') {
    e.respondWith(handleShareTarget(e.request));
    return;
  }
  e.respondWith(fetch(e.request));
});
