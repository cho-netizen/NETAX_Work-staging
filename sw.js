// [PWA] 안드로이드 크롬이 "설치 가능한 앱"으로 인식하려면 manifest.json 외에 서비스워커도
// 있어야 한다. 캐싱은 하지 않고 요청을 그대로 통과시키기만 한다 — GAS 백엔드에서 매번 최신
// 데이터를 받아와야 하는 앱 특성상, 캐시로 인해 오래된 데이터가 보이는 사고를 피하기 위함.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
