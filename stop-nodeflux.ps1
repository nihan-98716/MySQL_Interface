Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$runDir = Join-Path $root '.run'

function Write-Status {
    param([string]$Message)
    Write-Host "[NodeFlux] $Message"
}

function Stop-ManagedProcess {
    param(
        [string]$Name,
        [string]$PidPath
    )

    if (-not (Test-Path $PidPath)) {
        Write-Status "$Name is not tracked."
        return
    }

    $rawPid = (Get-Content $PidPath -Raw).Trim()
    if (-not $rawPid) {
        Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
        Write-Status "$Name had a stale PID file."
        return
    }

    $proc = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
        Write-Status "$Name was already stopped."
        return
    }

    Stop-Process -Id $proc.Id -Force
    Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
    Write-Status "$Name stopped (PID $($proc.Id))."
}

Stop-ManagedProcess -Name 'Agent' -PidPath (Join-Path $runDir 'agent.pid')
Stop-ManagedProcess -Name 'Frontend' -PidPath (Join-Path $runDir 'frontend.pid')
Stop-ManagedProcess -Name 'Backend' -PidPath (Join-Path $runDir 'backend.pid')

Write-Status 'Stopping Docker services...'
docker compose down | Out-Host

Write-Status 'NodeFlux is stopped.'
