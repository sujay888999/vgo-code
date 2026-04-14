$ErrorActionPreference = "Stop"

$pythonRoot = "E:\Python312"
$installRoot = "E:\VGO-Local-Executor"
$venvRoot = Join-Path $installRoot "oi312-env"
$launcherPath = Join-Path $installRoot "launch-open-interpreter.bat"
$readmePath = Join-Path $installRoot "README.txt"

Write-Host ""
Write-Host "== VGO AGENT Local Executor Installer ==" -ForegroundColor Cyan
Write-Host "Target Python: $pythonRoot"
Write-Host "Target install root: $installRoot"
Write-Host ""

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

if (-not (Test-Path (Join-Path $pythonRoot "python.exe"))) {
  Write-Host "Installing Python 3.12 to $pythonRoot ..." -ForegroundColor Yellow
  winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements --scope machine --location $pythonRoot
}

$pythonExe = Join-Path $pythonRoot "python.exe"
if (-not (Test-Path $pythonExe)) {
  throw "Python 3.12 was not found at $pythonExe"
}

Write-Host "Creating virtual environment ..." -ForegroundColor Yellow
& $pythonExe -m venv $venvRoot

$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$venvInterpreter = Join-Path $venvRoot "Scripts\interpreter.exe"

Write-Host "Upgrading pip and base tooling ..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip wheel

Write-Host "Installing Open Interpreter ..." -ForegroundColor Yellow
& $venvPython -m pip install open-interpreter

Write-Host "Pinning setuptools for current Open Interpreter compatibility ..." -ForegroundColor Yellow
& $venvPython -m pip install setuptools==80.9.0

@"
@echo off
cd /d E:\VGO-Local-Executor
call E:\VGO-Local-Executor\oi312-env\Scripts\activate.bat
interpreter
"@ | Set-Content -Path $launcherPath -Encoding ASCII

@"
VGO AGENT Local Executor

Open Interpreter path:
E:\VGO-Local-Executor\oi312-env\Scripts\interpreter.exe

Quick launch:
E:\VGO-Local-Executor\launch-open-interpreter.bat

Suggested next step:
1. Configure your model/API environment variables.
2. Keep local execution limited to approved folders and scripts.
3. Use this runtime as the local executor behind VGO AGENT digital teams.
"@ | Set-Content -Path $readmePath -Encoding UTF8

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Interpreter: $venvInterpreter"
Write-Host "Launcher: $launcherPath"
Write-Host ""
