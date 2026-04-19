param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$AppExePath,
  [Parameter(Mandatory = $false)]
  [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

function Write-UpdateLog {
  param([string]$Message)
  if (-not $LogPath) { return }
  try {
    $dir = Split-Path -Path $LogPath -Parent
    if ($dir) {
      New-Item -Path $dir -ItemType Directory -Force | Out-Null
    }
    Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format o) $Message"
  } catch {}
}

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
      Write-UpdateLog "app process exited: $processName"
      return
    }
    Start-Sleep -Milliseconds 500
  }
  Write-UpdateLog "wait timeout for process exit: $processName"
}

try {
  Write-UpdateLog "updater script started; installer=$InstallerPath appExe=$AppExePath"
  Start-Sleep -Seconds 2
  Wait-AppExit -ExePath $AppExePath

  if (-not (Test-Path -LiteralPath $InstallerPath)) {
    throw "Installer not found: $InstallerPath"
  }

  $installArgs = @("/S")
  Write-UpdateLog "installer launching with args: $($installArgs -join ' ')"
  $proc = Start-Process -FilePath $InstallerPath -ArgumentList $installArgs -Wait -WindowStyle Hidden -PassThru
  Write-UpdateLog "installer exited with code: $($proc.ExitCode)"
  if ($proc.ExitCode -ne 0) {
    throw "Installer exited with code $($proc.ExitCode)"
  }
  Start-Sleep -Seconds 2

  if (Test-Path -LiteralPath $AppExePath) {
    Write-UpdateLog "relaunching app via AppExePath"
    Start-Process -FilePath $AppExePath -WindowStyle Normal | Out-Null
  } else {
    $installDir = Split-Path -Path $AppExePath -Parent
    $candidateExe = Join-Path $installDir "VGO CODE.exe"
    if (Test-Path -LiteralPath $candidateExe) {
      Write-UpdateLog "relaunching app via candidate exe: $candidateExe"
      Start-Process -FilePath $candidateExe -WindowStyle Normal | Out-Null
    }
  }
  Write-UpdateLog "updater script completed"
} catch {
  Write-UpdateLog "updater script failed: $($_.Exception.Message)"
  $logDir = Join-Path $env:TEMP "vgo-code-updater"
  New-Item -Path $logDir -ItemType Directory -Force | Out-Null
  $logFile = Join-Path $logDir "install-update-error.log"
  Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) $($_.Exception.Message)"
  Add-Content -LiteralPath $logFile -Value "InstallerPath=$InstallerPath"
  Add-Content -LiteralPath $logFile -Value "AppExePath=$AppExePath"
}
