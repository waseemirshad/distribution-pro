@echo off
rem ==========================================================================
rem  Distribution Pro - START.bat
rem  Ye file double-click karein aur app khud browser me khul jayegi.
rem  Zaroorat: Node.js 22.5+ (https://nodejs.org)  -- kuch install karne ki
rem  zaroorat nahi hai, saara data aap ke computer par hi rehta hai.
rem ==========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

title Distribution Pro - Server (is window ko band na karein)

if "%TZ%"=="" set "TZ=Asia/Karachi"
if "%PORT%"=="" set "PORT=3000"
if "%HOST%"=="" set "HOST=0.0.0.0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Node.js nahi mila.
  echo      Node.js 22 (LTS^) yahan se install karein:  https://nodejs.org
  echo      Install ke baad ye file dobara chalayein.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set "NODEV=%%v"
echo.
echo  ==========================================================
echo   DISTRIBUTION PRO  -  Wholesale / FMCG ERP
echo  ==========================================================
echo   Node version : %NODEV%
echo   Port         : %PORT%
echo   Data folder  : %~dp0data
echo.
echo   Login:  admin / admin123      (Admin / Malik)
echo           manager / manager123  (Manager)
echo           counter / counter123  (Billing Counter)
echo           godown / godown123    (Godown Keeper)
echo           accounts / accounts123(Accountant)
echo.
echo   Browser khud khul jayega. Is window ko band karne se
echo   server ruk jayega (data safe rehta hai).
echo  ==========================================================
echo.

start /b cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%"
node --no-warnings server/index.js
echo.
echo  Server band ho gaya.
pause
