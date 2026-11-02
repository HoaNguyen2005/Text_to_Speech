param(
    [ValidateSet('all', 'prepare', 'build', 'up', 'tunnel', 'status', 'logs', 'stop')]
    [string]$Action = 'status',
    [ValidateSet('engine', 'vieneu', 'tunnel')]
    [string]$Service,
    [string]$Secret = ''
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

function Ensure-EnvFile {
    param([string]$ProvidedSecret)
    $currentSecret = Get-EngineSecret
    if (-not $currentSecret -or $ProvidedSecret) {
        if ($ProvidedSecret) {
            $currentSecret = $ProvidedSecret.Trim()
        } else {
            # Kiểm tra nếu có sẵn trong backend/.env.books.local thì dùng lại để đồng bộ với Render
            $localBooksEnv = Join-Path $taskRoot 'backend/.env.books.local'
            if (Test-Path -LiteralPath $localBooksEnv) {
                $line = Get-Content -LiteralPath $localBooksEnv | Where-Object { $_ -match '^BOOK_ENGINE_SECRET=(.+)$' } | Select-Object -First 1
                if ($line -match '^BOOK_ENGINE_SECRET=(.+)$') { $currentSecret = $Matches[1].Trim() }
            }
            if (-not $currentSecret) {
                $bytes = New-Object byte[] 32
                [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
                $currentSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
            }
        }
        $content = @(
            '# Cấu hình trạm tính toán GPU (RTX 4060) - Không commit file này',
            'ENGINE_HOST=0.0.0.0',
            "BOOK_ENGINE_SECRET=$currentSecret",
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
        Write-Host "[GPU NODE] Đã tạo/cập nhật file cấu hình: $envFile" -ForegroundColor Green
    } else {
        Write-Host "[GPU NODE] Giữ nguyên file cấu hình đã có: $envFile" -ForegroundColor Cyan
    }
    return $currentSecret
}

if ($Action -eq 'prepare') {
    $resolvedSecret = Ensure-EnvFile -ProvidedSecret $Secret
    Write-Host ""
    Write-Host "=== CẤU HÌNH KẾT NỐI TRÊN RENDER.COM / LAPTOP ===" -ForegroundColor Yellow
    Write-Host "BOOK_ENGINE_SECRET=$resolvedSecret"
    Write-Host "ENGINE_URL=https://<ten-mien-tunnel>"
    Write-Host "BOOK_ENGINE_URL=https://<ten-mien-tunnel>"
    exit 0
}

$taskDocker = Get-Command docker -ErrorAction SilentlyContinue
if ($taskDocker) { $taskDockerPath = $taskDocker.Source }
else {
    $taskDockerPath = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'
    if (-not (Test-Path -LiteralPath $taskDockerPath)) { throw 'Không tìm thấy Docker Desktop.' }
}

Ensure-EnvFile -ProvidedSecret $Secret | Out-Null
$baseCompose = @('compose', '-f', $composeFile)

function Start-TunnelAndPrint {
    $argsList = $baseCompose + @('--profile', 'tunnel', 'up', '-d', 'tunnel')
    & $taskDockerPath @argsList
    if ($LASTEXITCODE -ne 0) { throw 'Không bật được container Cloudflare Tunnel.' }

    $tunnelUrl = $null
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep -Seconds 2
        $logs = & $taskDockerPath @baseCompose logs --tail 100 tunnel 2>&1 | Out-String
        if ($logs -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            $tunnelUrl = $Matches[1]
            break
        }
    }
    $resolvedSecret = Get-EngineSecret
    if ($tunnelUrl) {
        Write-Host ""
        Write-Host "==================================================================" -ForegroundColor Green
        Write-Host "  CLOUDFLARE TUNNEL CHO ENGINE GPU (RTX 4060) ĐÃ SẴN SÀNG!        " -ForegroundColor Green
        Write-Host "==================================================================" -ForegroundColor Green
        Write-Host "Hãy cập nhật 3 biến môi trường sau trên Render.com (hoặc Laptop):" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "ENGINE_URL=$tunnelUrl" -ForegroundColor Cyan
        Write-Host "BOOK_ENGINE_URL=$tunnelUrl" -ForegroundColor Cyan
        Write-Host "BOOK_ENGINE_SECRET=$resolvedSecret" -ForegroundColor Cyan
        Write-Host "==================================================================" -ForegroundColor Green
    } else {
        Write-Host "[GPU NODE] Đang khởi tạo liên kết Cloudflare Tunnel. Xem lại bằng: .\deploy\gpu-node.ps1 logs -Service tunnel" -ForegroundColor Yellow
    }
}

switch ($Action) {
    'all' {
        Write-Host "[1/3] Đang build Docker image CUDA cho Engine và VieNeu..." -ForegroundColor Cyan
        $buildArgs = $baseCompose + @('build')
        & $taskDockerPath @buildArgs
        if ($LASTEXITCODE -ne 0) { throw 'Build image GPU thất bại.' }

        Write-Host "[2/3] Đang khởi chạy Engine và VieNeu trên GPU..." -ForegroundColor Cyan
        $upArgs = $baseCompose + @('up', '-d', '--wait', '--wait-timeout', '1800', 'engine', 'vieneu')
        & $taskDockerPath @upArgs
        if ($LASTEXITCODE -ne 0) { throw 'Khởi chạy Engine/VieNeu GPU thất bại.' }

        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 10
            Write-Host "[GPU HEALTH] $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
        } catch {
            Write-Warning "Engine đang khởi động thêm: $($_.Exception.Message)"
        }

        Write-Host "[3/3] Đang mở Cloudflare Tunnel cho Engine..." -ForegroundColor Cyan
        Start-TunnelAndPrint
        exit 0
    }
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
        Start-TunnelAndPrint
        exit 0
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
