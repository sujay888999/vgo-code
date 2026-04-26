$version = "1.2.9"
$body = @{
    version = $version
    tag = "v$version"
    download_url = "https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-$version.exe"
    downloadUrl = "https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-$version.exe"
    release_notes = "v$version`: Unified stream output, clean exec log, suppress retryable tool errors."
    published_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json

$body | Out-File -FilePath "dist-version.json" -Encoding UTF8
Write-Host "version.json written"
Write-Host $body
