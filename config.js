// ============================================================
// NX 시스템 공용 설정
// index.html, report-writer/index.html 이 이 파일 하나를 같이 참조합니다.
// GAS를 재배포해서 URL이 바뀌면 여기 한 곳만 고치면 됩니다.
// (절대경로로 로드하므로 하위 폴더에서 로드해도 항상 이 파일을 가리킵니다.)
// ============================================================
window.NX_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyFbvXiV6rSzCvhtc_T2WrzNF5ZxhOFWtSSsgzSavzPbjv4LBGhjXhu_Q2_8m-PDj8s/exec',
  // "NETAX 외부조회 커넥터" 크롬 확장프로그램 ID.
  // manifest.json에 key를 고정해 두었기 때문에, 확장프로그램을 다시 설치하거나 PC를 바꿔도
  // 이 값은 바뀌지 않습니다(재확인 불필요). 확장프로그램 자체를 새로 만들 때만 값을 바꾸면 됩니다.
  EXTENSION_ID: 'jgkaijbhmejckolbnjcaedfgobgcllfm'
};
