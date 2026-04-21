param(
  [Parameter(Mandatory = $true)]
  [string]$CfApiToken,
  [string]$ZoneId = "4494936ec61e3da37615187189f99a57",
  [string]$TargetIp = "139.180.213.100"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$headers = @{
  Authorization = "Bearer $CfApiToken"
  "Content-Type" = "application/json"
}

$records = (Invoke-RestMethod -Method Get -Uri "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records?per_page=200" -Headers $headers).result
$targetNames = @("vgoai.cn", "www.vgoai.cn")

foreach ($name in $targetNames) {
  $record = $records | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $record) {
    Write-Warning "Record not found: $name"
    continue
  }

  $body = @{
    type = "A"
    name = $name
    content = $TargetIp
    ttl = 1
    proxied = $false
  } | ConvertTo-Json

  $result = Invoke-RestMethod -Method Put -Uri "https://api.cloudflare.com/client/v4/zones/$ZoneId/dns_records/$($record.id)" -Headers $headers -Body $body
  Write-Host "$($result.result.name) rolled back to A $($result.result.content)"
}

