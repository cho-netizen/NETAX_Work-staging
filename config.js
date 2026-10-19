// ============================================================
// NX 시스템 공용 설정
// index.html, report-writer/index.html 이 이 파일 하나를 같이 참조합니다.
// GAS를 재배포해서 URL이 바뀌면 여기 한 곳만 고치면 됩니다.
// (절대경로로 로드하므로 하위 폴더에서 로드해도 항상 이 파일을 가리킵니다.)
// ============================================================
window.NX_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyFbvXiV6rSzCvhtc_T2WrzNF5ZxhOFWtSSsgzSavzPbjv4LBGhjXhu_Q2_8m-PDj8s/exec',
  // [2026-10-20] work 은퇴로 값을 비움. 옛 값은 서버에서 이미 무효.
  // [2026.08] work.netax.kr 백엔드가 로그인 없이 아무나 접근 가능한 상태였던 걸 막기 위해 추가.
  // 서버(gs-backend)의 스크립트 속성 API_SECRET과 같은 값이어야 함. 재배포 시 URL만 바뀌므로
  // 이 값 자체는 바뀌지 않지만, 값을 바꿀 일이 생기면 서버 스크립트 속성도 같이 바꿔야 함.
  API_SECRET: '',
  // "NETAX 외부조회 커넥터" 크롬 확장프로그램 ID.
  // manifest.json에 key를 고정해 두었기 때문에, 확장프로그램을 다시 설치하거나 PC를 바꿔도
  // 이 값은 바뀌지 않습니다(재확인 불필요). 확장프로그램 자체를 새로 만들 때만 값을 바꾸면 됩니다.
  EXTENSION_ID: 'jgkaijbhmejckolbnjcaedfgobgcllfm'
};
// [2026-10-20] work.netax.kr 은퇴. 이 파일은 옛 화면만 불러온다(새 안내 페이지는 안 불러옴).
// 브라우저에 남은 옛 화면이 이 파일을 불러오면 바로 은퇴 안내로 보낸다(주소에 ?retired를 붙여 브라우저 캐시의 옛 화면을 피함).
try { location.replace('/?retired=20261020'); } catch (e) {}
