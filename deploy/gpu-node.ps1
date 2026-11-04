param(
    [ValidateSet('all', 'prepare', 'build', 'up', 'tunnel', 'register', 'status', 'logs', 'stop')]
    [string]$Action = 'status',
    [ValidateSet('engine', 'vieneu', 'tunnel', 'worker')]
    [string]$Service,
    [string]$Secret = '',
    [string]$BackendUrl = 'https://text2speech-backend.onrender.com'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $PSScriptRoot 'engine.gpu.env'
$composeFile = Join-Path $PSScriptRoot 'compose.gpu-node.yaml'
$runtimeDir = Join-Path $taskRoot 'backend/data/gpu-node'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Get-EngineSecret {
    if (Test-Path -LiteralPath $envFile) {
        $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^BOOK_ENGINE_SECRET=(.+)$' } | Select-Object -First 1
        if ($line -match '^BOOK_ENGINE_SECRET=(.+)$') { return $Matches[1].Trim() }
    }
    return $null
}

function Get-ConfiguredDatabaseUrl {
    if ($env:DATABASE_URL) { return $env:DATABASE_URL.Trim() }
    $candidates = @(
        (Join-Path $taskRoot '.env.local'),
        (Join-Path $taskRoot '.env'),
        (Join-Path $taskRoot 'backend/.env.local'),
        (Join-Path $taskRoot 'backend/.env.postgres.local'),
        (Join-Path $taskRoot 'backend/.env'),
        $envFile
    )
    foreach ($f in $candidates) {
        if (Test-Path -LiteralPath $f) {
            $line = Get-Content -LiteralPath $f -ErrorAction SilentlyContinue | Where-Object { $_ -match '^DATABASE_URL=(.+)$' } | Select-Object -First 1
            if ($line -match '^DATABASE_URL=(.+)$') {
                $val = $Matches[1].Trim().Trim('"').Trim("'")
                if ($val) { return $val }
            }
        }
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
            '# Cau hinh tram tinh toan GPU (RTX 4060) - Khong commit file nay',
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
        Write-Host "[GPU NODE] Da tao/cap nhat file cau hinh: $envFile" -ForegroundColor Green
    } else {
        Write-Host "[GPU NODE] Giu nguyen file cau hinh da co: $envFile" -ForegroundColor Cyan
    }
    return $currentSecret
}

function Register-EngineNode {
    param([string]$TunnelUrl, [string]$EngineSecret)
    $targets = @($BackendUrl.TrimEnd('/'), 'http://127.0.0.1:3000') | Select-Object -Unique
    $body = @{
        role       = 'gpu'
        engine_url = $TunnelUrl
        label      = "PC-GPU-$($env:COMPUTERNAME)"
    } | ConvertTo-Json -Compress

    foreach ($target in $targets) {
        try {
            $resp = Invoke-RestMethod -Uri "$target/api/speech/engine-register" -Method Post `
                -Headers @{ 'X-Book-Engine-Secret' = $EngineSecret; 'Content-Type' = 'application/json' } `
                -Body $body -TimeoutSec 25
            Write-Host "[AUTO-REGISTER] Da dang ky node GPU voi $target -> $($resp.engine_url) (device=$($resp.device))" -ForegroundColor Green
        } catch {
            if ($target -notmatch '127\.0\.0\.1') {
                Write-Warning "[AUTO-REGISTER] Chua dang ky duoc voi $target : $($_.Exception.Message)"
            }
        }
    }
}

function Unregister-EngineNode {
    param([string]$EngineSecret)
    $targets = @($BackendUrl.TrimEnd('/'), 'http://127.0.0.1:3000') | Select-Object -Unique
    foreach ($target in $targets) {
        try {
            Invoke-RestMethod -Uri "$target/api/speech/engine-register/gpu" -Method Delete `
                -Headers @{ 'X-Book-Engine-Secret' = $EngineSecret } -TimeoutSec 10 | Out-Null
            Write-Host "[AUTO-UNREGISTER] Da bao tat node GPU voi $target (he thong tu chuyen ve CPU)" -ForegroundColor Yellow
        } catch {}
    }
}

Ensure-EnvFile -ProvidedSecret $Secret | Out-Null

if ($Action -eq 'prepare') {
    Write-Host ""
    Write-Host "=== CAU HINH KET NOI TREN RENDER.COM / LAPTOP ===" -ForegroundColor Yellow
    Write-Host "ENGINE_URL=https://<ten-mien-tunnel>"
    Write-Host "BOOK_ENGINE_URL=https://<ten-mien-tunnel>"
    exit 0
}

function Test-DockerAvailable {
    if (-not (Get-Process -Name 'vmmem*' -ErrorAction SilentlyContinue)) { return $false }
    $taskDocker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $taskDocker) { return $false }
    try {
        $ver = & $taskDocker.Source info --format "{{.ServerVersion}}" 2>$null
        if ($LASTEXITCODE -eq 0 -and $ver) { return $true }
    } catch {}
    return $false
}

function Get-ListenerPid {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { return [int]$conn.OwningProcess }
    } catch {}
    return $null
}

function Get-WorkerPid {
    $pidFile = Join-Path $runtimeDir 'worker.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $savedPid = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($savedPid -match '^\d+$') {
            $p = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
            if ($p) { return [int]$p.Id }
        }
    }
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
        foreach ($pr in $procs) {
            if ($pr.CommandLine -match 'book\.worker\.js') {
                return [int]$pr.ProcessId
            }
        }
    } catch {}
    return $null
}

function Start-DetachedService {
    param(
        [string]$Name,
        [string]$WorkingDir,
        [hashtable]$EnvVars,
        [string]$CommandLine
    )
    $cmdPath = Join-Path $runtimeDir "run-$Name.cmd"
    $outLog = Join-Path $runtimeDir "$Name.log"
    $errLog = Join-Path $runtimeDir "$Name.err.log"
    $lines = @('@echo off')
    foreach ($k in $EnvVars.Keys) {
        $lines += "set `"$k=$($EnvVars[$k])`""
    }
    $lines += "cd /d `"$WorkingDir`""
    $lines += "$CommandLine 1>>`"$outLog`" 2>>`"$errLog`""
    [System.IO.File]::WriteAllText($cmdPath, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)

    $startup = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine               = "cmd.exe /c `"$cmdPath`""
        CurrentDirectory          = $WorkingDir
        ProcessStartupInformation = $startup
    }
    if ($res.ReturnValue -ne 0) {
        throw "Khong the khoi chay dich vu $Name (Win32_Process ReturnValue=$($res.ReturnValue))"
    }
    Set-Content -Path (Join-Path $runtimeDir "$Name.pid") -Value $res.ProcessId -Encoding Ascii
}

function Stop-NativeService {
    param([string]$Name)
    $pidFile = Join-Path $runtimeDir "$Name.pid"
    if (Test-Path -LiteralPath $pidFile) {
        $savedPid = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($savedPid -match '^\d+$') {
            Stop-Process -Id ([int]$savedPid) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
    if ($Name -eq 'engine') {
        $p = Get-ListenerPid -Port 8000
        if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    } elseif ($Name -eq 'vieneu') {
        $p = Get-ListenerPid -Port 8001
        if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    } elseif ($Name -eq 'tunnel') {
        $p = Get-ListenerPid -Port 2000
        if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
        Get-Process -Name 'cloudflared' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } elseif ($Name -eq 'worker') {
        $wp = Get-WorkerPid
        if ($wp) { Stop-Process -Id $wp -Force -ErrorAction SilentlyContinue }
    }
}

function Get-NativeTunnelUrl {
    for ($i = 0; $i -lt 20; $i++) {
        foreach ($f in @((Join-Path $runtimeDir 'tunnel.err.log'), (Join-Path $runtimeDir 'tunnel.log'))) {
            if (Test-Path -LiteralPath $f) {
                $content = Get-Content -LiteralPath $f -Raw -ErrorAction SilentlyContinue
                if ($content) {
                    $matchesList = [regex]::Matches($content, 'https://[a-z0-9-]+\.trycloudflare\.com')
                    if ($matchesList.Count -gt 0) {
                        return $matchesList[$matchesList.Count - 1].Value
                    }
                }
            }
        }
        try {
            $metrics = Invoke-WebRequest -Uri 'http://127.0.0.1:2000/metrics' -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($metrics -and $metrics.Content) {
                $matchesList = [regex]::Matches($metrics.Content, 'https://[a-z0-9-]+\.trycloudflare\.com')
                if ($matchesList.Count -gt 0) {
                    return $matchesList[$matchesList.Count - 1].Value
                }
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return $null
}

function Invoke-NativeGpuNode {
    $resolvedSecret = Get-EngineSecret
    $engineDir = Join-Path $taskRoot 'engine'
    $vieneuDir = Join-Path $engineDir 'vieneu_service'
    $backendDir = Join-Path $taskRoot 'backend'
    $enginePy = Join-Path $engineDir 'venv/Scripts/python.exe'
    $vieneuPy = Join-Path $vieneuDir '.venv/Scripts/python.exe'
    $cloudflaredExe = Join-Path $runtimeDir 'cloudflared.exe'
    $bookAudioDir = Join-Path $taskRoot 'backend/data/book-audio'
    $publicAudioDir = Join-Path $taskRoot 'backend/public/audio'
    $checkpointDir = Join-Path $engineDir 'checkpoints/converter'

    New-Item -ItemType Directory -Force -Path $bookAudioDir, (Join-Path $publicAudioDir 'samples'), (Join-Path $publicAudioDir 'generated'), $checkpointDir | Out-Null

    switch ($Action) {
        'build' {
            Write-Host "[GPU NODE - NATIVE CUDA] Kiem tra moi truong Python CUDA (RTX 4060), Node Worker & Cloudflared..." -ForegroundColor Cyan
            if (-not (Test-Path -LiteralPath (Join-Path $backendDir 'node_modules/pg'))) {
                npm --prefix $backendDir install
            }
            if (-not (Test-Path -LiteralPath $enginePy)) { throw "Khong tim thay $enginePy" }
            & $enginePy -m pip install -q edge-tts==7.3.1 silero-vad==6.2.1
            if (-not (Test-Path -LiteralPath $vieneuPy)) {
                python -m venv (Join-Path $vieneuDir '.venv')
                & $vieneuPy -m pip install --no-deps vieneu==3.8.3 librosa==0.11.0 kaldi-native-fbank==1.22.5 sea-g2p==0.10.0
                $engineSite = (Resolve-Path (Join-Path $engineDir 'venv/Lib/site-packages')).Path
                $vieneuSite = (Resolve-Path (Join-Path $vieneuDir '.venv/Lib/site-packages')).Path
                Set-Content -Path (Join-Path $vieneuSite 'zz_engine_shared.pth') -Value $engineSite -Encoding Ascii
            }
            if (-not (Test-Path -LiteralPath $cloudflaredExe)) {
                Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflaredExe -UseBasicParsing
            }
            Write-Host "[GPU NODE - NATIVE CUDA] Moi truong Engine GPU + VieNeu GPU + Worker + Cloudflared da san sang." -ForegroundColor Green
            exit 0
        }
        { $_ -in @('all', 'up') } {
            if ($Action -eq 'all') {
                & $PSCommandPath -Action build -Secret $resolvedSecret -BackendUrl $BackendUrl
            }
            $commonEnv = @{
                PYTHONUTF8               = '1'
                PYTHONIOENCODING         = 'utf-8'
                BOOK_ENGINE_SECRET       = $resolvedSecret
                BOOK_ARTIFACT_ROOT       = $bookAudioDir
                AUDIO_ROOT               = $publicAudioDir
                OPENVOICE_CHECKPOINT_DIR = $checkpointDir
                OPENVOICE_MODEL_REVISION = 'ea66dc9353e660b1dbbe0bebebd4c2d8b105483c'
                SILERO_VAD_BACKEND       = 'package'
                OPENVOICE_WATERMARK      = '0'
                VIENEU_URL               = 'http://127.0.0.1:8001'
                VIENEU_DEVICE            = 'cuda'
                EDGE_TTS_MAX_CONCURRENCY = '4'
                ENGINE_HOST              = '0.0.0.0'
                ENGINE_NODE_ROLE         = 'gpu'
                TUNNEL_METRICS_URL       = 'http://127.0.0.1:2000/metrics'
                TUNNEL_LOG_FILE          = (Join-Path $runtimeDir 'tunnel.err.log')
                REMOTE_BACKEND_URLS      = $BackendUrl
            }

            if (-not (Get-ListenerPid -Port 8001)) {
                Write-Host "[GPU NODE] Dang khoi chay dich vu VieNeu-TTS tren GPU RTX 4060 (cong 8001)..." -ForegroundColor Cyan
                Start-DetachedService -Name 'vieneu' -WorkingDir $vieneuDir -EnvVars $commonEnv `
                    -CommandLine "`"$vieneuPy`" -X utf8 -m uvicorn app:app --host 127.0.0.1 --port 8001"
            }

            $engineHealthy = $false
            try {
                $eh = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 3
                if ($eh.status -eq 'ok') { $engineHealthy = $true }
            } catch {}

            if (-not $engineHealthy) {
                Stop-NativeService -Name 'engine'
                Write-Host "[GPU NODE] Dang khoi chay Engine OpenVoice V2 + Edge-TTS tren GPU RTX 4060 (cong 8000)..." -ForegroundColor Cyan
                Start-DetachedService -Name 'engine' -WorkingDir $engineDir -EnvVars $commonEnv `
                    -CommandLine "`"$enginePy`" -X utf8 -u main.py"

                for ($i = 0; $i -lt 45; $i++) {
                    Start-Sleep -Seconds 2
                    try {
                        $eh = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 5
                        if ($eh.status -eq 'ok') {
                            $engineHealthy = $true
                            Write-Host "[GPU HEALTH] $($eh | ConvertTo-Json -Compress)" -ForegroundColor Green
                            break
                        }
                    } catch {}
                }
                if (-not $engineHealthy) {
                    throw "Engine GPU chua san sang tren cong 8000. Xem log bang: .\deploy\gpu-node.ps1 -Action logs -Service engine"
                }
            } else {
                $eh = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 5
                Write-Host "[GPU HEALTH] $($eh | ConvertTo-Json -Compress)" -ForegroundColor Green
            }

            $dbUrl = Get-ConfiguredDatabaseUrl
            if ($dbUrl) {
                if (-not (Get-WorkerPid)) {
                    Write-Host "[GPU NODE] Dang khoi chay Book Worker (node workers/book.worker.js) tren PC..." -ForegroundColor Cyan
                    $nodeExe = (Get-Command node).Source
                    $workerEnv = @{
                        BOOK_ENGINE_SECRET  = $resolvedSecret
                        ENGINE_URL          = 'http://127.0.0.1:8000'
                        BOOK_ENGINE_URL     = 'http://127.0.0.1:8000'
                        BOOK_ARTIFACT_ROOT  = $bookAudioDir
                        BOOK_WORKER_ID_FILE = (Join-Path $runtimeDir 'worker.id')
                        DATABASE_URL        = $dbUrl
                    }
                    Start-DetachedService -Name 'worker' -WorkingDir $backendDir -EnvVars $workerEnv `
                        -CommandLine "`"$nodeExe`" workers/book.worker.js"
                    Start-Sleep -Seconds 2
                }
                $wp = Get-WorkerPid
                if ($wp) {
                    Write-Host "[GPU WORKER] Book Worker dang chay tren PC (PID=$wp, ket noi truc tiep Engine GPU 127.0.0.1:8000)." -ForegroundColor Green
                } else {
                    Write-Warning "[GPU WORKER] Book Worker chua khoi dong duoc. Xem log: .\deploy\gpu-node.ps1 -Action logs -Service worker"
                }
            } else {
                Write-Warning "[GPU WORKER] Chua tim thay DATABASE_URL (Neon PostgreSQL) trong .env.local / deploy/engine.gpu.env de chay Worker tren PC."
            }

            & $PSCommandPath -Action tunnel -Secret $resolvedSecret -BackendUrl $BackendUrl
            exit 0
        }
        { $_ -in @('tunnel', 'register') } {
            $tunnelPid = Get-ListenerPid -Port 2000
            if (-not $tunnelPid) {
                Stop-NativeService -Name 'tunnel'
                Write-Host "[GPU NODE] Dang mo Cloudflare Tunnel cho http://127.0.0.1:8000 ..." -ForegroundColor Cyan
                Remove-Item -LiteralPath (Join-Path $runtimeDir 'tunnel.log'), (Join-Path $runtimeDir 'tunnel.err.log') -Force -ErrorAction SilentlyContinue
                Start-DetachedService -Name 'tunnel' -WorkingDir $runtimeDir -EnvVars @{} `
                    -CommandLine "`"$cloudflaredExe`" tunnel --no-autoupdate --metrics 127.0.0.1:2000 --url http://127.0.0.1:8000"
            }
            $tunnelUrl = Get-NativeTunnelUrl
            if ($tunnelUrl) {
                Write-Host ""
                Write-Host "==================================================================" -ForegroundColor Green
                Write-Host "  CLOUDFLARE TUNNEL CHO ENGINE GPU (RTX 4060) DA SAN SANG!        " -ForegroundColor Green
                Write-Host "==================================================================" -ForegroundColor Green
                Write-Host "ENGINE_URL=$tunnelUrl" -ForegroundColor Cyan
                Write-Host "==================================================================" -ForegroundColor Green
                Register-EngineNode -TunnelUrl $tunnelUrl -EngineSecret $resolvedSecret
            } else {
                Write-Warning "[GPU NODE] Chua lay duoc URL Cloudflare Tunnel. Xem log: .\deploy\gpu-node.ps1 -Action logs -Service tunnel"
            }
            exit 0
        }
        'status' {
            $ePid = Get-ListenerPid -Port 8000
            $vPid = Get-ListenerPid -Port 8001
            $tPid = Get-ListenerPid -Port 2000
            $wPid = Get-WorkerPid
            $eHealth = 'stopped'
            $vHealth = 'stopped'
            if ($ePid) {
                try {
                    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 3
                    $eHealth = "healthy ($($r.device) - $($r.gpu_name))"
                } catch { $eHealth = 'starting/unhealthy' }
            }
            if ($vPid) {
                try {
                    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8001/health/ready' -TimeoutSec 3
                    $vHealth = "healthy ($($r.device))"
                } catch { $vHealth = 'starting/loading-model' }
            }
            $tUrl = if ($tPid) { Get-NativeTunnelUrl } else { $null }
            $wStatus = if ($wPid) { 'running (local-ssd + gpu)' } elseif (Get-ConfiguredDatabaseUrl) { 'stopped' } else { 'missing DATABASE_URL' }
            [PSCustomObject]@{ Service = 'engine'; Mode = 'native-cuda'; Port = 8000; PID = $ePid; Status = $eHealth }
            [PSCustomObject]@{ Service = 'vieneu'; Mode = 'native-cuda'; Port = 8001; PID = $vPid; Status = $vHealth }
            [PSCustomObject]@{ Service = 'worker'; Mode = 'native-node'; Port = '-';  PID = $wPid; Status = $wStatus }
            [PSCustomObject]@{ Service = 'tunnel'; Mode = 'cloudflared'; Port = 2000; PID = $tPid; Status = $(if ($tUrl) { "online ($tUrl)" } elseif ($tPid) { 'running' } else { 'stopped' }) }
            exit 0
        }
        'logs' {
            $targets = if ($Service) { @($Service) } else { @('engine', 'vieneu', 'worker', 'tunnel') }
            foreach ($svc in $targets) {
                Write-Host "=== LOGS: $svc ===" -ForegroundColor Cyan
                foreach ($suffix in @('log', 'err.log')) {
                    $lf = Join-Path $runtimeDir "$svc.$suffix"
                    if (Test-Path -LiteralPath $lf) {
                        Get-Content -LiteralPath $lf -Tail 50
                    }
                }
            }
            exit 0
        }
        'stop' {
            if ($resolvedSecret -and (-not $Service -or $Service -ne 'vieneu')) {
                Unregister-EngineNode -EngineSecret $resolvedSecret
            }
            $targets = if ($Service) { @($Service) } else { @('worker', 'tunnel', 'engine', 'vieneu') }
            foreach ($svc in $targets) {
                Stop-NativeService -Name $svc
                Write-Host "[GPU NODE] Da dung dich vu: $svc" -ForegroundColor Yellow
            }
            exit 0
        }
    }
}

if (-not (Test-DockerAvailable)) {
    Invoke-NativeGpuNode
    exit 0
}

$taskDockerPath = (Get-Command docker).Source
$baseCompose = @('compose', '-f', $composeFile)

function Start-TunnelAndPrint {
    $argsList = $baseCompose + @('up', '-d', 'tunnel')
    & $taskDockerPath @argsList
    if ($LASTEXITCODE -ne 0) { throw "Khong bat duoc container Cloudflare Tunnel." }

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
        Write-Host "  CLOUDFLARE TUNNEL CHO ENGINE GPU (RTX 4060) DA SAN SANG!        " -ForegroundColor Green
        Write-Host "==================================================================" -ForegroundColor Green
        Write-Host "ENGINE_URL=$tunnelUrl" -ForegroundColor Cyan
        Write-Host "==================================================================" -ForegroundColor Green
        Register-EngineNode -TunnelUrl $tunnelUrl -EngineSecret $resolvedSecret
    } else {
        Write-Host "[GPU NODE] Dang khoi tao lien ket Cloudflare Tunnel. Xem lai bang: .\deploy\gpu-node.ps1 -Action logs -Service tunnel" -ForegroundColor Yellow
    }
}

switch ($Action) {
    'all' {
        Write-Host "[1/3] Dang build Docker image CUDA cho Engine va VieNeu..." -ForegroundColor Cyan
        $buildArgs = $baseCompose + @('build')
        & $taskDockerPath @buildArgs
        if ($LASTEXITCODE -ne 0) { throw "Build image GPU that bai." }

        Write-Host "[2/3] Dang khoi chay Engine va VieNeu tren GPU..." -ForegroundColor Cyan
        $upArgs = $baseCompose + @('up', '-d', '--wait', '--wait-timeout', '1800', 'engine', 'vieneu')
        & $taskDockerPath @upArgs
        if ($LASTEXITCODE -ne 0) { throw "Khoi chay Engine/VieNeu GPU that bai." }

        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 10
            Write-Host "[GPU HEALTH] $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
        } catch {
            Write-Warning "Engine dang khoi dong them: $($_.Exception.Message)"
        }

        Write-Host "[3/3] Dang mo Cloudflare Tunnel va tu dong dang ky voi Backend..." -ForegroundColor Cyan
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
            Write-Host "[GPU NODE] Kiem tra trang thái GPU tai http://127.0.0.1:8000/health/ready ..." -ForegroundColor Cyan
            try {
                $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/ready' -TimeoutSec 10
                Write-Host ($health | ConvertTo-Json -Depth 4) -ForegroundColor Green
            } catch {
                Write-Warning "Engine dang khoi dong them: $($_.Exception.Message)"
            }
            Start-TunnelAndPrint
            exit 0
        }
    }
    'tunnel' {
        Start-TunnelAndPrint
        exit 0
    }
    'register' {
        Start-TunnelAndPrint
        exit 0
    }
    'status' {
        & $taskDockerPath @baseCompose ps
    }
    'logs' {
        $argsList = $baseCompose + @('logs', '--tail', '80')
        if ($Service) { $argsList += $Service }
        & $taskDockerPath @argsList
    }
    'stop' {
        $resolvedSecret = Get-EngineSecret
        if ($resolvedSecret -and (-not $Service -or $Service -ne 'vieneu')) {
            Unregister-EngineNode -EngineSecret $resolvedSecret
        }
        $argsList = $baseCompose + @('stop')
        if ($Service) { $argsList += $Service }
        & $taskDockerPath @argsList
    }
}
if ($LASTEXITCODE -ne 0) { throw "Lenh Docker Compose tren GPU Node chua hoan tat." }
