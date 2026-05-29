$ErrorActionPreference = "Stop"

Write-Host "[release-check] 1/4 build web"
npm run build:web | Out-Host

Write-Host "[release-check] 2/4 stop running packaged app"
Get-Process |
  Where-Object { $_.Path -like "*\dist\win-unpacked\VGO CODE.exe" } |
  Stop-Process -Force

Write-Host "[release-check] 3/4 package smoke test"
npm run pack | Out-Host

Write-Host "[release-check] 4/4 basic artifact check"
if (!(Test-Path "dist\win-unpacked\VGO CODE.exe")) {
  throw "Expected artifact not found: dist\\win-unpacked\\VGO CODE.exe"
}

Write-Host "[release-check] PASS"
