param(
    [ValidateSet('prepare', 'up', 'build', 'register', 'status', 'logs', 'stop')]
    [string]$Action = 'up',
    [ValidateSet('frontend', 'backend', 'worker', 'engine', 'vieneu', 'postgres', 'keycloak', 'mailpit', 'tunnel', 'engine-tunnel')]
    [string]$Service,
    [string]$BackendUrl = 'https://text2speech-backend.onrender.com'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
if ($Action -eq 'prepare') {
    & node (Join-Path $taskRoot 'backend/scripts/init_docker_local.js')
    if ($LASTEXITCODE -ne 0) { throw 'Không chuẩn bị được cấu hình Docker.' }
    exit 0
}
$taskDocker = Get-Command docker -ErrorAction SilentlyContinue
if ($taskDocker) { $taskDockerPath = $taskDocker.Source }
else {
    $taskDockerPath = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
    if (-not (Test-Path -LiteralPath $taskDockerPath)) { throw 'Không tìm thấy Docker Desktop.' }
}
$taskCompose = @('compose', '--env-file', (Join-Path $taskRoot 'keycloak/.env'),
    '-f', (Join-Path $taskRoot 'keycloak/compose.yaml'), '-f', (Join-Path $PSScriptRoot 'compose.app.yaml'))

function Get-LaptopEngineSecret {
    $candidates = @(
        (Join-Path $PSScriptRoot 'engine.env'),
        (Join-Path $PSScriptRoot 'backend.env'),
        (Join-Path $taskRoot 'backend/.env.books.local')
    )
    foreach ($file in $candidates) {
        if (Test-Path -LiteralPath $file) {
            $line = Get-Content -LiteralPath $file | Where-Object { $_ -match '^BOOK_ENGINE_SECRET=(.+)$' } | Select-Object -First 1
            if ($line -match '^BOOK_ENGINE_SECRET=(.+)$') { return $Matches[1].Trim() }
        }
    }
    return $null
}

function Register-CpuFallbackNode {
    $secret = Get-LaptopEngineSecret
    if (-not $secret) { return }
    $tunnelUrl = $null
    for ($i = 0; $i -lt 12; $i++) {
        $logs = & $taskDockerPath @taskCompose logs --tail 100 engine-tunnel 2>&1 | Out-String
        if ($logs -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $tunnelUrl = $Matches[1]
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $tunnelUrl) {
        Write-Warning "[CPU FALLBACK] Chưa lấy được URL từ engine-tunnel. Bạn có thể chạy lại: .\deploy\stack.ps1 -Action register"
        return
    }
    $body = @{
        role       = 'cpu'
        engine_url = $tunnelUrl
        label      = "Laptop-CPU-$($env:COMPUTERNAME)"
    } | ConvertTo-Json -Compress

    try {
        $resp = Invoke-RestMethod -Uri "$($BackendUrl.TrimEnd('/'))/api/speech/engine-register" -Method Post `
            -Headers @{ 'X-Book-Engine-Secret' = $secret; 'Content-Type' = 'application/json' } `
            -Body $body -TimeoutSec 20
        Write-Host "[AUTO-REGISTER CPU] Đã đăng ký Engine CPU dự phòng lên Cloud: $($resp.engine_url)" -ForegroundColor Green
    } catch {
        Write-Warning "[AUTO-REGISTER CPU] Chưa đăng ký được với $BackendUrl (có thể Render đang cập nhật): $($_.Exception.Message)"
    }
}

if ($Action -eq 'register') {
    & $taskDockerPath @taskCompose up -d engine-tunnel
    Register-CpuFallbackNode
    exit 0
}

switch ($Action) {
    'up' { $taskArgs = @('up', '-d', '--wait', '--wait-timeout', '1800') }
    'build' { $taskArgs = @('build') }
    'status' { $taskArgs = @('ps') }
    'logs' { $taskArgs = @('logs', '--tail', '60') }
    'stop' { $taskArgs = @('stop') }
}
if ($Service) { $taskArgs += $Service }
& $taskDockerPath @taskCompose @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose chưa hoàn tất. Xem status/logs; không xóa volume để xử lý lỗi.' }
if ($Action -eq 'up' -and (-not $Service -or $Service -eq 'engine-tunnel')) {
    Register-CpuFallbackNode
}
