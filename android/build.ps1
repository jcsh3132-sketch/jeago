param([string]$ToolsRoot = (Join-Path $PSScriptRoot '..\work\android-tools'))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$tools = [System.IO.Path]::GetFullPath($ToolsRoot)
$jdk = (Get-ChildItem (Join-Path $tools 'jdk') -Directory | Select-Object -First 1).FullName
$platform = (Get-ChildItem (Join-Path $tools 'platform') -Filter android.jar -Recurse | Select-Object -First 1).FullName
$buildTools = Split-Path (Get-ChildItem (Join-Path $tools 'build-tools') -Filter aapt2.exe -Recurse | Select-Object -First 1).FullName
if (!$jdk -or !$platform -or !$buildTools) { throw 'Java and Android SDK build tools are required.' }
$build = Join-Path $projectRoot ('work\android-build-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$classes = Join-Path $build 'classes'
$generated = Join-Path $build 'generated'
$dex = Join-Path $build 'dex'
$signing = Join-Path $projectRoot 'work\android-signing'
$output = Join-Path $projectRoot 'work\android-output'
New-Item -ItemType Directory -Force $classes,$generated,$dex,$signing,$output | Out-Null
function Run-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
Run-Checked (Join-Path $buildTools 'aapt2.exe') @('compile','--dir',(Join-Path $PSScriptRoot 'res'),'-o',(Join-Path $build 'resources.zip'))
Run-Checked (Join-Path $buildTools 'aapt2.exe') @('link','-o',(Join-Path $build 'unsigned.apk'),'-I',$platform,'--manifest',(Join-Path $PSScriptRoot 'AndroidManifest.xml'),'--java',$generated,'--min-sdk-version','23','--target-sdk-version','35',(Join-Path $build 'resources.zip'))
$javaFiles = @(Get-ChildItem (Join-Path $PSScriptRoot 'src'),$generated -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
Run-Checked (Join-Path $jdk 'bin\javac.exe') (@('-encoding','UTF-8','--release','8','-classpath',$platform,'-d',$classes) + $javaFiles)
Run-Checked (Join-Path $jdk 'bin\jar.exe') @('cf',(Join-Path $build 'classes.jar'),'-C',$classes,'.')
Run-Checked (Join-Path $jdk 'bin\java.exe') @('-cp',(Join-Path $buildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--release','--min-api','23','--lib',$platform,'--output',$dex,(Join-Path $build 'classes.jar'))
Run-Checked (Join-Path $jdk 'bin\jar.exe') @('uf',(Join-Path $build 'unsigned.apk'),'-C',$dex,'classes.dex')
Run-Checked (Join-Path $buildTools 'zipalign.exe') @('-f','-p','4',(Join-Path $build 'unsigned.apk'),(Join-Path $build 'aligned.apk'))
$keyStore = Join-Path $signing 'jeago-release.p12'
$passwordFile = Join-Path $signing 'keystore-password.txt'
if (!(Test-Path $keyStore)) {
    if (Test-Path $passwordFile) { throw 'Signing key is missing; recover the original key before building an update.' }
    $random = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($random)
    $rng.Dispose()
    [Convert]::ToBase64String($random) | Set-Content -LiteralPath $passwordFile -Encoding ascii
    $env:JEAGO_SIGNING_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
    Run-Checked (Join-Path $jdk 'bin\keytool.exe') @('-genkeypair','-keystore',$keyStore,'-storetype','PKCS12','-storepass:env','JEAGO_SIGNING_PASSWORD','-keypass:env','JEAGO_SIGNING_PASSWORD','-alias','jeago','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Jeago Inventory, OU=Mobile, O=Jeago, C=KR')
}
$env:JEAGO_SIGNING_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
$apk = Join-Path $output 'jeago-1.1.0.apk'
try {
    Run-Checked (Join-Path $jdk 'bin\java.exe') @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'sign','--ks',$keyStore,'--ks-key-alias','jeago','--ks-pass','env:JEAGO_SIGNING_PASSWORD','--key-pass','env:JEAGO_SIGNING_PASSWORD','--out',$apk,(Join-Path $build 'aligned.apk'))
} finally { Remove-Item Env:\JEAGO_SIGNING_PASSWORD -ErrorAction SilentlyContinue }
Run-Checked (Join-Path $jdk 'bin\java.exe') @('-jar',(Join-Path $buildTools 'lib\apksigner.jar'),'verify','--verbose','--print-certs',$apk)
Run-Checked (Join-Path $buildTools 'zipalign.exe') @('-c','-p','4',$apk)
Run-Checked (Join-Path $buildTools 'aapt2.exe') @('dump','badging',$apk)
(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash | Set-Content (Join-Path $output 'jeago-1.1.0.apk.sha256') -Encoding ascii
Write-Output "APK: $apk"
