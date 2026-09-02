# 이 저장소 전용 규칙
# 전역 규칙(git 커밋/푸시, 운영 폴더 원칙 등)은 %USERPROFILE%\.claude\CLAUDE.md에서 항상 자동 적용됩니다.

## 2026-09-02: gs-backend 이전됨
이 저장소 안에 있던 `gs-backend/`(새 관리 앱 코드, `?app=manage`로 접속하던 것)는
`C:\GitHub\netax-job-redirect` 저장소로 옮겨갔다. 이 저장소는 원래 종전 채팅앱
(work.netax.kr)의 스테이징(dev.netax.kr)이라, 종전 시스템 폐기 시 함께 정리될 예정인데
그 안에 새 관리 앱 코드가 같이 있으면 위험해서 분리했다. GS(Apps Script) 코드 작업은
앞으로 `netax-job-redirect/gs-backend/` 및 그 저장소의 `CLAUDE.md`를 참고할 것 —
여기(NETAX_Work-staging)에는 더 이상 `.gs`/`appsscript.json` 파일이 없다.

이 저장소에 남아있는 건 종전 채팅앱의 정적 프론트엔드 코드(index.html/explorer.js/chat.js/
core.js/report-writer 등, dev.netax.kr로 서빙)뿐이다.
