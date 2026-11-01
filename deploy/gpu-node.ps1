param(
    [ValidateSet('prepare', 'build', 'up', 'tunnel', 'status', 'logs', 'stop')]
    [string]$Action = 'status',
    [ValidateSet('engine', 'vieneu', 'tunnel')]
    [string]$Service
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $PSScriptRoot 'engine.gpu.env'
$composeFile = Join-Path $PSScriptRoot 'compose.gpu-node.yaml'

function Get-EngineSecret {
    if (Test-Path -LiteralPath $envFile) {
        $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^BOOK_ENGINE_SECRET=(.+)$' } | Select-Object -First 1
        if ($line -match '^BOOK_ENGINE_SECRET=(.+)$') { return $Matches[1].Trim() }
    }
    return $null
}

if ($Action -eq 'prepare') {
    $secret = Get-EngineSecret
    if (-not $secret) {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        $content = @(
            '# Cấu hình trạm tính toán GPU (RTX 4060) - Không commit file này',
            'ENGINE_HOST=0.0.0.0',
            "BOOK_ENGINE_SECRET=$secret",
            'BOOK_ARTIFACT_ROOT=/app/backend/data/book-audio',
            'AUDIO_ROOT=/app/backend/public/audio',
            'OPENVOICE_CHECKPOINT_DIR=/app/engine/checkpoints/converter',
            'OPENVOICE_MODEL_REVISION=ea66dc9353e660b1dbbe0bebebd4c2d8b105483c',
            'SILERO_VAD_BACKEND=package',
            'OPENVOICE_WATERMARK=0',
            'HF_HOME=/home/tts/.cache/huggingface',
            'TORCH_HOME=/home/tts/.cache/torch',
            'NUMBA_CACHE_DIR=/home/tts/.cache/numba',
            'XDG_CACHE_HOME=/home/tts/.cache',
            'VIENEU_URL=http://vieneu:8001',
            'EDGE_TTS_MAX_CONCURRENCY=4'
        ) -join "`n"
        [System.IO.File]::WriteAllText($envFile, $content + "`n")
        Write-Host "[GPU NODE] Đã tạo mới file cấu hình: $envFile" -ForegroundColor Green
    } else {
        Write-Host "[GPU NODE] Giữ nguyên file cấu hình đã có: $envFile" -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "=== DÁN 2 DÒNG NÀY VÀO backend/.env VÀ backend/.env.books.local TRÊN LAPTOP ===" -ForegroundColor Yellow
    Write-Host "BOOK_ENGINE_SECRET=$secret"
    Write-Host "ENGINE_URL=https://<ten-mien-tunnel-hoac-ip-tailscale>"
    Write-Host "BOOK_ENGINE_URL=https://<ten-mien-tunnel-hoac-ip-tailscale>"
    exit 0
}

$taskDocker = Get-Command docker -ErrorAction SilentlyContinue
if ($taskDocker) { $taskDockerPath = $taskDocker.Source }
else {
    $taskDockerPath = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
    if (-not (Test-Path -LiteralPath $taskDockerPath)) { throw 'Không tìm thấy Docker Desktop.' }
}

if (-not (Test-Path -LiteralPath $envFile)) {
    & $PSCommandPath -Action prepare
}

$baseCompose = @('compose', '-f', $composeFile)

switch ($Action) {
    'build' {
        $argsList = $baseCompose + @('build')
        if ($Service) { $argsList += $Service }
        & $taskDockerPath @argsList
    }
    'up' {
        $argsList = $baseCompose + @('up', '-d', '--wait', '--wait-timeout', '1800', 'engine', 'vieneu')
        & $taskDockerPath @argsList
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[GPU NODE] Kiểm tra trạng thái GPU tại http://127.0.0.1:8000/health/ready ..." -ForegroundColor Cyan
            try {
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 10
                Write-Host ($health | ConvertTo-Json -Depth 4) -ForegroundColor Green
            } catch {
                Write-Warning "Engine đang khởi động thêm: $($_.Exception.Message)"
            }
        }
    }
    'tunnel' {
        $argsList = $baseCompose + @('--profile', 'tunnel', 'up', '-d', 'tunnel')
        & $taskDockerPath @argsList
        Start-Sleep -Seconds 5
        $logs = & $taskDockerPath @baseCompose logs --tail 80 tunnel 2>&1 | Out-String
        $secret = Get-EngineSecret
        if ($logs -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $tunnelUrl = $Matches[1]
            Write-Host ""
            Write-Host "=== CLOUDFLARE TUNNEL ĐÃ SẴN SÀNG ===" -ForegroundColor Green
            Write-Host "Dán cấu hình sau vào backend/.env và backend/.env.books.local trên Laptop:" -ForegroundColor Yellow
            Write-Host "ENGINE_URL=$tunnelUrl"
            Write-Host "BOOK_ENGINE_URL=$tunnelUrl"
            Write-Host "BOOK_ENGINE_SECRET=$secret"
        } else {
            Write-Host "[GPU NODE] Đang khởi tạo liên kết Cloudflare Tunnel. Xem lại bằng: .\deploy\gpu-node.ps1 logs -Service tunnel" -ForegroundColor Yellow
            Write-Host $logs
        }
    }
    'status' {
        & $taskDockerPath @baseCompose --profile tunnel ps
    }
    'logs' {
        $argsList = $baseCompose + @('--profile', 'tunnel', 'logs', '--tail', '80')
        if ($Service) { $argsList += $Service }
        & $taskDockerPath @argsList
    }
    'stop' {
        $argsList = $baseCompose + @('--profile', 'tunnel', 'stop')
        if ($Service) { $argsList += $Service }
        & $taskDockerPath @argsList
    }
}
if ($LASTEXITCODE -ne 0) { throw 'Lệnh Docker Compose trên GPU Node chưa hoàn tất.' }

