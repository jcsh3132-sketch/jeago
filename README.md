# 재고 관리 — Next.js

기존 Flask 재고 관리 프로그램을 Next.js App Router + React + TypeScript로 전환했습니다. Python 서버 없이 Node.js에서 화면과 재고 API를 함께 실행합니다.

## 실행

Node.js 22.13 이상(현재 설치된 24 버전 사용 가능)이 필요합니다.

```powershell
cd C:\jeago
npm.cmd ci
npm.cmd run db:prepare
npm.cmd run dev
```

브라우저에서 http://localhost:3000 을 엽니다. 처음 설치는 `03_install_nextjs.bat`, 이후 실행은 `04_start_nextjs.bat`을 더블클릭해도 됩니다. 기존 `01`, `02` 배치 파일은 Flask용입니다.

기본 바인딩은 로컬 PC입니다. 내부 네트워크 접속이 필요하면 `npm.cmd run dev -- --hostname 0.0.0.0`으로 실행하세요.

## 기존 데이터 보존

- 원본: `instance/inventory.db` — Flask 데이터로 그대로 보존합니다.
- Next.js: `instance/inventory-next.db` — `db:prepare`가 SQLite 백업 API로 최초 1회 복제합니다.
- 복제 파일이 이미 있으면 덮어쓰지 않습니다. 두 DB는 이후 자동 동기화되지 않으므로 운영 입력은 한쪽 프로그램에서만 하세요.
- 기존 Python 소스, 템플릿, 마이그레이션 파일은 비교와 복구를 위해 남겨 두었습니다.
- 이 프로젝트의 원본 DB는 카테고리 v3 구조입니다. 훨씬 오래된 DB를 교체해서 쓰려면 먼저 기존 Flask 마이그레이션을 완료해야 합니다.

## 전환한 기능

- 재고 요약, 보유/부족/품절 필터, 계층별 조회, 모델·장비·담당자 검색
- 모델 등록/수정/삭제, 카테고리 변경, 모델별 부족 기준 0~999 설정
- 입고/출고, 출고업체 선택 및 직접 입력, 음수·소수·초과 출고 방지
- 모델별 잔여 재고 이력, 전체 입출고 검색·유형 필터
- 대분류 → 장비 모델 → 품목 카테고리 추가/이름 변경/이동/삭제
- 거래처 등록/수정/검색/삭제
- 모바일 메뉴 및 반응형 화면, 목록 드래그 정렬(현재 화면에서만 유지)

부족 기준은 슬라이더/숫자 입력 후 **저장**을 눌러 반영합니다. DB의 기존 시간과 새 이력 시간은 UTC이며 이력 화면에도 기준을 표시합니다. 데이터 입력은 SQL 파라미터를 사용하고, 재고 수량 변경과 입출고 이력 저장은 하나의 쓰기 트랜잭션으로 처리합니다. 카테고리와 모델 삭제 시 관련 입출고 이력도 삭제되는 기존 동작을 유지합니다.

## 폴더

- `src/app` — 페이지, 공통 레이아웃, API, 오류 화면
- `src/components` — 재고 화면 및 관리 폼
- `src/lib` — DB 연결, 데이터 모델, 재고 검증과 트랜잭션
- `scripts/prepare-db.mjs` — 기존 SQLite 데이터 복제
- `tests` — 별도 임시 DB로 핵심 동작 검증

## 검증 / 운영 빌드

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd start
```

Chrome이 설치된 환경에서는 `npm.cmd run build` 후 `npm.cmd run test:browser`로 실제 화면 흐름도 검증할 수 있습니다. 브라우저 테스트는 현재 Next.js DB를 `work/`에 별도로 복제하여 3100 포트에서 실행합니다. 운영 DB에 테스트 입력을 쓰지 않습니다. 진단용 테스트 DB와 스크린샷은 Git에서 제외된 `work/`에 남습니다.

`GET /health`는 DB 연결까지 확인합니다. 변경 API는 `POST /api/inventory`이며 동일 출처 JSON 요청만 허용합니다.

## GitHub · Vercel 연결 시

현재 단계는 Next.js 전환이며 GitHub 업로드/배포는 하지 않았습니다. Vercel에서는 로컬 SQLite 파일에 영구 저장할 수 없으므로 원격 libSQL/Turso 데이터베이스를 연결하도록 준비했습니다.

1. 원격 DB를 만들고 실제 사용할 `inventory-next.db` 데이터를 가져옵니다. ID와 카테고리 키를 보존하세요.
2. Vercel 환경 변수에 `DATABASE_URL=libsql://...`, `DATABASE_AUTH_TOKEN=...`을 등록합니다. 토큰은 Git에 커밋하지 않습니다.
3. GitHub 저장소를 연결하고 Framework Preset을 Next.js로 선택합니다.
4. 배포 전에 사용자 인증 또는 배포 접근 제한을 추가해야 합니다. 기존 프로그램과 마찬가지로 현재 앱에는 로그인 기능이 없습니다. Origin 검사는 사용자 인증을 대신하지 않습니다.

`.env.example`에 연결 예시가 있습니다. Vercel에서 로컬 DB가 지정되면 실행을 중단해 임시 파일에 재고를 잘못 저장하지 않도록 했습니다. 원격 DB 연결과 실제 배포는 아직 검증하지 않았습니다.

`.gitignore`는 DB·환경 변수·빌드 결과를 제외합니다. 다만 전환 전에 이미 Git 스테이징되어 있던 `instance/inventory.db`, `__pycache__` 등은 ignore로 자동 해제되지 않으므로 **첫 업로드 전에 스테이징 목록을 정리**해야 합니다. 기존 Git 스테이징 상태는 이번 전환에서 변경하지 않았습니다.

공식 참고: [Next.js 설치](https://nextjs.org/docs/app/getting-started/installation), [Vercel의 SQLite 제한](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [libSQL TypeScript 클라이언트](https://tursodatabase.github.io/libsql-client-ts/).
