@echo off
setlocal
cd /d E:\VGO-CODE

if not exist "dist\win-unpacked\VGO CODE.exe" (
  echo Packaged app not found. Running npm run pack first...
  call npm run pack
)

if not exist "dist\win-unpacked\VGO CODE.exe" (
  echo Failed to build VGO CODE.
  pause
  exit /b 1
)

cd /d E:\VGO-CODE\dist\win-unpacked
echo Launching VGO CODE in debug mode...
"VGO CODE.exe"
echo.
echo VGO CODE exited. Press any key to close.
pause >nul
