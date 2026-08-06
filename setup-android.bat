@echo off
echo ============================================
echo  다모아 펜 Android 설정 스크립트
echo ============================================
echo.

echo [1/4] npm 패키지 설치 중...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [오류] npm install 실패
    pause
    exit /b 1
)

echo.
echo [2/4] React 앱 빌드 중...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [오류] 빌드 실패
    pause
    exit /b 1
)

echo.
echo [3/4] Android 플랫폼 추가 중...
call npx cap add android
if %ERRORLEVEL% neq 0 (
    echo [오류] Android 추가 실패 (이미 있을 경우 무시)
)

echo.
echo [4/4] Capacitor 동기화 중...
call npx cap sync android
if %ERRORLEVEL% neq 0 (
    echo [오류] 동기화 실패
    pause
    exit /b 1
)

echo.
echo ============================================
echo  설정 완료! GitHub에 코드를 올리면 됩니다.
echo ============================================
pause
