# 재고 관리 Android

`https://jeago.vercel.app/`를 여는 설치형 Android 앱입니다. Android 6.0 이상에서 사용하며, 인터넷 연결과 최신 브라우저가 필요합니다. 휴대폰의 기본 브라우저가 Custom Tabs를 지원하면 앱 안의 브라우저 화면으로 표시하고, 지원하지 않으면 일반 브라우저로 엽니다.

운영 사이트의 자체 회원가입·ID/PW 로그인을 사용합니다. Vercel 계정은 필요하지 않습니다. 자동로그인을 선택하면 해당 기기의 브라우저에서 30일간 유지됩니다. APK에 DB 주소, DB 토큰, Vercel 인증 우회 키 또는 사용자 로그인 정보를 포함하지 않습니다. 재고 데이터는 웹사이트에서 처리합니다. 웹사이트의 수정은 별도 APK 업데이트 없이 반영됩니다. 1.1.0 앱 시작 화면의 이전 안내와 달리 현재는 회원 로그인이 필요합니다.

APK를 휴대폰으로 옮겨 열고, 파일을 여는 앱의 '이 출처 허용'을 켜 설치하세요. Google Play 등록본이 아닌 직접 설치용 파일입니다. Android 또는 Play Protect가 확인을 요청할 수 있습니다. 회사에서 관리하는 휴대폰은 외부 APK 설치가 제한될 수 있습니다.

## 빌드

Java 17, Android Platform 35, Android Build Tools 35.0.0을 `work/android-tools` 아래 준비한 후 다음 명령을 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File android/build.ps1
```

결과는 `work/android-output/jeago-1.1.0.apk`입니다. 1.0.0 및 1.0.1과 같은 서명 키를 사용하므로 기존 앱 위에 업데이트로 설치할 수 있습니다. APK 서명, 정렬, 패키지·버전·SDK 메타데이터를 빌드 스크립트에서 검증합니다. 실제 휴대폰 설치·실행 확인은 별도로 필요합니다.

업데이트를 만들 때 AndroidManifest.xml의 versionCode/versionName과 build.ps1의 출력 파일명을 올립니다. **`work/android-signing`의 서명 키와 비밀번호를 안전하게 백업하세요.** 동일한 키가 있어야 기존 앱에 업데이트를 설치할 수 있습니다. 이 폴더는 Git에서 제외되며 APK와 함께 배포하지 않습니다.

기존 키를 복원할 때는 `jeago-release.p12`, `keystore-password.txt`를 `work/android-signing`에 함께 복사합니다. 키 별칭은 `jeago`입니다. 서명 인증서 SHA-256은 `90e3aad0c00b64559a0ab5603f5934fafd7439e11ba2b1762eee378375730833`입니다. 키 백업 ZIP은 관리자만 보관하고 APK 사용자에게 공유하지 마세요.

브라우저 호출 방식: [Google Custom Tabs 공식 문서](https://developer.chrome.com/docs/android/custom-tabs/howto-custom-tab-low-level-api).
