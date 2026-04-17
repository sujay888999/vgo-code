$ErrorActionPreference = "Stop"

Write-Host "[release-check] 1/7 brand audit"
npm run audit:brand | Out-Host

Write-Host "[release-check] 2/7 generate next-version plan"
npm run plan:next | Out-Host

Write-Host "[release-check] 3/7 build web"
npm run build:web | Out-Host

Write-Host "[release-check] 4/7 smoke api"
npm run test:release-smoke | Out-Host

Write-Host "[release-check] 5/7 stop running app"
Get-Process | Where-Object { $_.Path -like "*\dist\win-unpacked\VGO CODE.exe" } | Stop-Process -Force

Write-Host "[release-check] 6/7 package smoke test"
npm run pack | Out-Host

Write-Host "[release-check] 7/7 basic artifact check"
if (!(Test-Path "dist\win-unpacked\VGO CODE.exe")) {
  throw "Expected artifact not found: dist\\win-unpacked\\VGO CODE.exe"
}

Write-Host "[release-check] PASS"
