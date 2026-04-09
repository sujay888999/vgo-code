$ErrorActionPreference = "Continue"

function Get-CdpErrors($port, $sec) {
    $err = @()
    try {
        $ws = New-Object System.Net.WebSockets.ClientWebSocket
        $ct = [Threading.CancellationToken]::None
        $ws.ConnectAsync((Invoke-RestMethod "http://localhost:$port/json" -TimeoutSec 3)[0].webSocketDebuggerUrl, $ct).Wait()
        '{"id":1,"method":"Runtime.enable"}','{"id":2,"method":"Log.enable"}' | % { $ws.SendAsync([ArraySegment[byte]][Text.Encoding]::UTF8.GetBytes($_), 'Text', $true, $ct).Wait() }
        $buf = [byte[]]::new(32768); $end = (Get-Date).AddSeconds($sec)
        while ((Get-Date) -lt $end -and $ws.State -eq 'Open') {
            $r = $ws.ReceiveAsync([ArraySegment[byte]]$buf, $ct)
            if ($r.Wait(500) -and $r.Result.Count -gt 0) {
                $j = [Text.Encoding]::UTF8.GetString($buf,0,$r.Result.Count) | ConvertFrom-Json -EA SilentlyContinue
                if ($j.method -match "exceptionThrown|consoleAPICalled|entryAdded" -and ($j.method -eq "Runtime.exceptionThrown" -or $j.params.type -eq "error" -or $j.params.entry.level -eq "error")) { $err += $j }
            }
        }
        $ws.CloseAsync('NormalClosure', "", $ct).Wait()
    } catch {}
    $err
}

$appPath = "E:\VGO-CODE\dist\win-unpacked\VGO CODE.exe"
$port = 9222
$wait = 8

$start = Get-Date
$errLog = "$env:TEMP\electron_err_$PID.log"

Write-Host "Starting VGO CODE..."
$proc = Start-Process $appPath -ArgumentList "--disable-gpu","--no-sandbox","--remote-debugging-port=$port" -PassThru -RedirectStandardError $errLog

Start-Sleep 3

Write-Host "Checking for CDP errors..."
$cdpErrors = Get-CdpErrors $port $wait

Write-Host "`n=== Test Results ===" -ForegroundColor Cyan

if ($proc.HasExited) {
    Write-Host "[CRASH] Exit code: $($proc.ExitCode)" -ForegroundColor Red
} else {
    Write-Host "[OK] App is running" -ForegroundColor Green
}

if ((Test-Path $errLog) -and (Get-Content $errLog -Raw)) {
    Write-Host "[MAIN ERROR]" -ForegroundColor Yellow
    Get-Content $errLog | Select-Object -First 5
}

if ($cdpErrors) {
    Write-Host "[JS ERRORS FOUND]" -ForegroundColor Yellow
    $cdpErrors | ForEach-Object { Write-Host $_.params }
} else {
    Write-Host "[OK] No JS errors" -ForegroundColor Green
}

Write-Host "Waiting for app to fully load..."
Start-Sleep 5

if (!$proc.HasExited) {
    Write-Host "Stopping app..."
    Stop-Process $proc.Id -Force -ErrorAction SilentlyContinue
}

Remove-Item $errLog -ErrorAction SilentlyContinue

Write-Host "`nTest complete."
