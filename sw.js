// [2026-10-20] work.netax.kr 은퇴.
// 예전에 설치된 앱(PWA)이 이 서비스워커를 새로 받으면, 저장 캐시(공유하기로 받은 파일 포함)를
// 모두 지우고 스스로 등록을 해제한 뒤 열린 창을 은퇴 안내 페이지로 옮긴다.
// 요청을 가로채지 않는다(fetch 처리기 없음). 서버를 부르지 않는다.
self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    } catch (err) {}
    let wins = [];
    try { wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch (err) {}
    try { await self.registration.unregister(); } catch (err) {}
    await Promise.all(wins.map(function (c) {
      try { return Promise.resolve(c.navigate('/?retired=20261020')).catch(function () {}); }
      catch (err) { return Promise.resolve(); }
    }));
  })());
});
