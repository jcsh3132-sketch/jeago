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

부족 기준은 슬라이더/숫자 입력 후 **저장**을 눌러 반영합니다. DB의 기존 시간과 새 이력 시간은 UTC이며 이력 화면에도 기준을 표시합니다. 데이터 입력은 SQL 파라미터를 사용하고, 재고 수량 변경과 입출고 이력 저장은 하나의 쓰기 트랜잭션으로 처리합니다.

### 공용 운영 보강 (1.1.0)

- 저장 요청 번호를 DB에 함께 기록하여 통신 재시도로 같은 입출고가 중복 처리되지 않습니다. 연결이 끊기면 **저장 결과 확인**을 누르세요. 같은 탭을 새로고침해도 미확인 요청을 복구합니다. 확인 전에는 탭을 닫거나 브라우저 데이터를 지우지 마세요.
- 다른 사람이 먼저 수정한 항목은 저장을 막고 **최신 내용 불러오기**를 안내합니다. 최신 내용을 확인하고 다시 입력하세요.
- 화면은 15초 간격과 다시 활성화될 때 갱신합니다. 입력 중이거나 저장 결과 확인 중에는 입력 내용을 보존하기 위해 자동 갱신을 잠시 멈춥니다.
- 모델·카테고리·거래처 삭제는 **휴지통**으로 이동합니다. 모델 ID, 수량, 입출고 이력은 보존하며 복구 시 함께 돌아옵니다. 카테고리는 상위 항목을 먼저 복구해야 하고 같은 위치의 이름 충돌은 먼저 해결해야 합니다.
- 이전 버전에서 영구 삭제한 데이터는 휴지통으로 복구할 수 없습니다. 새 배포의 첫 DB 연결에서 기존 테이블에 필요한 열과 복구 테이블만 추가합니다.

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

테스트 실행기는 상속된 DB 주소·토큰을 제거합니다. `JEAGO_TEST_MODE=1`에서는 `work/` 아래의 명시적인 `JEAGO_TEST_DATABASE_URL=file:...`만 허용하고 Turso 환경변수는 사용하지 않습니다.

`GET /health`는 DB 연결까지 확인합니다. 변경 API는 `POST /api/inventory`이며 동일 출처 JSON 요청만 허용합니다.

모든 변경 요청에는 UUID `request_id`가 필요하며, 기존 항목 변경에는 화면에서 읽은 `expected_version`도 필요합니다. 동일 요청 번호는 동일한 본문으로만 재시도합니다. 충돌은 HTTP 409로 안내합니다.

## GitHub · Vercel 연결 시

GitHub 저장소는 `jcsh3132-sketch/jeago`, Vercel 프로젝트는 `jin-e756/jeago`입니다. Vercel에서는 로컬 SQLite 파일에 영구 저장할 수 없으므로 원격 libSQL/Turso 데이터베이스를 사용합니다.

1. 원격 DB를 만들고 실제 사용할 `inventory-next.db` 데이터를 가져옵니다. ID와 카테고리 키를 보존하세요.
2. Vercel Marketplace 연동이 제공하는 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`을 사용합니다. 직접 설정하는 `DATABASE_URL`, `DATABASE_AUTH_TOKEN`도 지원합니다. 토큰은 Git에 커밋하지 않습니다.
3. GitHub 저장소를 연결하고 Framework Preset을 Next.js로 선택합니다.
4. 2026-09-14 사용자 요청에 따라 공용 운영을 위해 Vercel Authentication을 해제했습니다. 현재 사이트와 APK는 로그인 없이 재고 조회·입출고·수정·삭제가 가능합니다. 앱 자체에는 별도 권한 관리가 없습니다. Origin 검사는 사용자 인증을 대신하지 않습니다.

`.env.example`에 연결 예시가 있습니다. Vercel에서 로컬 DB가 지정되면 실행을 중단해 임시 파일에 재고를 잘못 저장하지 않도록 했습니다.

`.gitignore`는 DB·환경 변수·빌드 결과를 제외합니다. 기존에 스테이징되었던 DB와 Python 캐시는 첫 커밋 전에 제외했으며 원본 파일은 PC에 보존했습니다.

### 최초 데이터 이전

대상 DB가 비어 있을 때만 실행합니다. 기존 테이블이 있으면 덮어쓰지 않고 중단합니다. 환경변수 파일은 Git에서 제외되는 `.env.migration.local` 등의 이름을 사용합니다.

```powershell
node scripts/migrate-database.mjs --env .env.migration.local
node scripts/migrate-database.mjs --env .env.migration.local --apply
```

첫 명령은 대상이 비어 있는지와 이전할 테이블별 행 수를 확인합니다. `--apply`는 SQLite 백업 API로 원본의 스냅샷을 `work/`에 만든 뒤 스키마와 모든 행을 한 트랜잭션으로 이전합니다. 모든 열의 값과 외래 키를 검증한 후에만 확정합니다. 이전 후 로컬 DB와 Turso는 자동 동기화되지 않으므로 운영 입력은 배포 사이트 한쪽에서 진행하세요.

공식 참고: [Next.js 설치](https://nextjs.org/docs/app/getting-started/installation), [Vercel의 SQLite 제한](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [libSQL TypeScript 클라이언트](https://tursodatabase.github.io/libsql-client-ts/).

## 운영 DB 백업과 복구

운영 DB 연결 정보가 들어 있는 `.env.migration.local`을 PC에 준비한 뒤 `05_backup_cloud_database.bat`을 실행하거나 다음 명령을 사용합니다.

```powershell
node scripts/backup-database.mjs --env .env.migration.local
```

`work/backups/inventory-날짜.db`에 일관된 읽기 트랜잭션의 스냅샷을 저장합니다. 모든 테이블의 값, 외래 키, SQLite 무결성을 확인한 후 `verified: true`를 출력합니다. 휴지통과 중복 처리 방지 기록도 포함합니다. 기존 백업 파일은 덮어쓰지 않습니다. 백업은 수동 실행이며 PC 외 별도 저장소에도 복사해 보관하세요.

장애 복구는 먼저 **비어 있는 별도 Turso DB**를 만들고 그 연결 정보를 `.env.restore.local`에 저장하여 실행합니다.

```powershell
node scripts/migrate-database.mjs --env .env.restore.local --source work/backups/복구할파일.db
node scripts/migrate-database.mjs --env .env.restore.local --source work/backups/복구할파일.db --apply
```

검증에 성공한 뒤 Vercel의 DB 환경변수를 복구한 DB로 변경하고 재배포합니다. 복구 중에는 입력을 중지하고, 전환 전 원래 DB도 백업하세요. 기존 테이블이 있는 대상에는 복원을 거부합니다. 데이터 백업과 토큰은 GitHub에 올리지 않습니다.

## Android APK

`android/`에 APK 소스와 재빌드 스크립트가 있습니다. 설치·서명키 복구 방법은 [Android 안내](android/README.md)를 참고하세요. APK 1.1.0은 기존 앱과 같은 키로 서명하며 배포 사이트를 엽니다. APK와 관리자용 서명키 백업은 별도로 제공합니다.
