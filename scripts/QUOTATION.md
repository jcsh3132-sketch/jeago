# 견적서 운영 연결

- 운영 주소: `/quotation` (로그인 필요). 담당자 이름·연락처·메일은 로그인 회원 정보로 서버에서 지정합니다.
- 원본 Excel PDF 및 SMTP 발송은 회사 PC의 `quote-preview/original-server.mjs`와 `scripts/quotation-pc.mjs`가 처리합니다.
- PC 재시작 후 `powershell -NoProfile -ExecutionPolicy Bypass -File C:\jeago\scripts\start-quotation-pc.ps1`로 연결합니다. PC 또는 연결 프로그램이 꺼져 있으면 웹에서 연결 안내가 표시됩니다.
- SMTP 앱 비밀번호는 기존 Windows 암호화 저장소만 사용합니다. 웹·Git·작업 큐에 비밀번호를 저장하지 않습니다.
- 작업은 회원별로 격리하며 완료된 요청 내용은 즉시 지웁니다. PDF 결과는 30분 후 정리됩니다.
- 메일 요청 ID는 중복 처리하지 않습니다. 발송 결과 확인이 실패한 경우 자동 재발송하지 않으며 보낸메일함을 먼저 확인합니다.
- 로컬 미리보기 자산을 수정해도 운영 화면에는 자동 반영되지 않습니다. `src/quotation/`에 동기화 후 다시 배포해야 합니다. 메일/Excel 처리 코드는 회사 PC에서 실행합니다.
