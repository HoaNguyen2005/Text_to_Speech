param(
    [ValidateSet('prepare', 'up', 'build', 'status', 'logs', 'stop')]
    [string]$Action = 'up',
    [ValidateSet('frontend', 'backend', 'worker', 'engine', 'vieneu', 'postgres', 'keycloak', 'mailpit')]
    [string]$Service
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
