# 이 저장소 전용 규칙
# 전역 규칙(git 커밋/푸시, 운영 폴더 원칙 등)은 %USERPROFILE%\.claude\CLAUDE.md에서 항상 자동 적용되니
# 여기서는 이 저장소에만 해당하는 GS 배포 절차만 다룹니다.

## GS(Apps Script) 코드 수정 시 반드시 지킬 절차
`gs-backend` 폴더 안의 `.gs`/`appsscript.json` 파일을 수정했다면, 코드 수정만으로는 실제 서비스에 반영되지 않는다. 아래 순서를 매번 빠짐없이 실행한다 (사용자에게 각 단계를 할지 묻지 말고, 커밋/푸시 승인 규칙과 별개로 이 기술적 절차는 자동으로 진행한다 — 단, git commit/push 자체의 승인은 전역 규칙을 그대로 따른다):

1. `clasp push` — 로컬 수정사항을 Apps Script 서버로 올린다.
2. `clasp deploy -i <기존 배포 ID>` — **반드시 기존 배포 ID를 재사용**한다. 새 배포를 만들면 웹앱 URL이 바뀌어 `config.js` 등에 박힌 주소가 전부 깨지므로, `clasp deploy` (ID 옵션 없이)로 새 배포를 만드는 것은 금지.
3. 이 프로젝트의 배포 ID는 최초 1회 `clasp deployments`로 확인해서 아래에 기록해두고, 이후에는 매번 다시 찾지 말고 이 값을 사용한다.
4. 위 두 단계가 끝난 뒤에만 `git commit`/`git push` 진행 여부를 평소 규칙대로 묻는다 (이건 실제 반영과 무관한 기록/백업용이라 순서상 나중이어도 무방).

### 이 저장소의 배포 ID
배포 ID = AKfycbz9pam82WMSMKHYo6-6EtEguMbpZ0AaqHirVzwcW6ZFRsdq4WGluvhpPkYUoTE2l_bm
(config.js의 GAS_URL과 동일한 ID인지 항상 확인할 것 — 다르면 잘못된 배포에 올리는 것임)
