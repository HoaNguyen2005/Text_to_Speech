$ErrorActionPreference = 'Stop'
$taskBackupDir = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Force -Path $taskBackupDir | Out-Null
$taskDumpName = 'keycloak-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.dump'
$taskDumpPath = Join-Path $taskBackupDir $taskDumpName
$taskComposeArgs = @('compose', '--env-file', (Join-Path $PSScriptRoot '.env'), '-f', (Join-Path $PSScriptRoot 'compose.yaml'))

# Create the binary archive inside the container; PowerShell redirection can corrupt binary output.
& docker @taskComposeArgs exec -T postgres pg_dump -U keycloak -d keycloak -Fc -f "/tmp/$taskDumpName"
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL backup failed.' }
& docker @taskComposeArgs exec -T postgres pg_restore --list "/tmp/$taskDumpName" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL archive validation failed.' }
& docker @taskComposeArgs cp "postgres:/tmp/$taskDumpName" $taskDumpPath
if ($LASTEXITCODE -ne 0) { throw 'Could not copy PostgreSQL backup to the host.' }
Write-Output "PostgreSQL backup: $taskDumpPath"
