param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$AppExePath
)

$ErrorActionPreference = "Stop"

function Wait-AppExit {
  param(
    [string]$ExePath,
    [int]$TimeoutSeconds = 90
  )

  $processName = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $running = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if (-not $running) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
}

try {
  Start-Sleep -Seconds 2
  Wait-AppExit -ExePath $AppExePath

  if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "Installer not found: $InstallerPath"
  }

  $installArgs = @("/S")
  Start-Process -FilePath $InstallerPath -ArgumentList $installArgs -Wait -WindowStyle Hidden
  Start-Sleep -Seconds 2

  if (Test-Path -LiteralPath $AppExePath) {
    Start-Process -FilePath $AppExePath -WindowStyle Normal
  }
} catch {
  $logDir = Join-Path $env:TEMP "vgo-code-updater"
  New-Item -Path $logDir -ItemType Directory -Force | Out-Null
  $logFile = Join-Path $logDir "install-update-error.log"
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) $($_.Exception.Message)"
}
