param(
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$runDir = Join-Path $root '.run'
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$agentDir = Join-Path $root 'agent'

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Write-Status {
    param([string]$Message)
    Write-Host "[NodeFlux] $Message"
}

function Write-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Details
    )

    $state = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("[NodeFlux] [{0}] {1} - {2}" -f $state, $Name, $Details)
}

function Get-EnvMap {
    param([string]$Path)

    $map = @{}
    foreach ($line in Get-Content $Path) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) {
            continue
        }

        $parts = $line -split '=', 2
        if ($parts.Count -eq 2) {
            $map[$parts[0].Trim()] = $parts[1].Trim()
        }
    }

    return $map
}

function Test-ProcessAlive {
    param([string]$PidPath)

    if (-not (Test-Path $PidPath)) {
        return $false
    }

    $rawPid = (Get-Content $PidPath -Raw).Trim()
    if (-not $rawPid) {
        Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
        return $false
    }

    $proc = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        Remove-Item $PidPath -Force -ErrorAction SilentlyContinue
        return $false
    }

    return $true
}

function Get-ListeningPid {
    param([int]$Port)

    $lines = @(cmd /c "netstat -ano -p tcp | findstr LISTENING | findstr :$Port")
    foreach ($line in $lines) {
        if ($line -match 'LISTENING\s+(\d+)\s*$') {
            return [int]$matches[1]
        }
    }

    return $null
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$PidPath,
        [string]$WorkingDirectory,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$StdOutPath,
        [string]$StdErrPath,
        [Nullable[int]]$Port
    )

    if (Test-ProcessAlive -PidPath $PidPath) {
        $existingPid = (Get-Content $PidPath -Raw).Trim()
        Write-Status "$Name already running (PID $existingPid)."
        return
    }

    if ($null -ne $Port) {
        $portPid = Get-ListeningPid -Port $Port
        if ($null -ne $portPid) {
            Set-Content -Path $PidPath -Value $portPid
            Write-Status "$Name already available on port $Port (PID $portPid)."
            return
        }
    }

    if (Test-Path $StdOutPath) {
        try {
            Clear-Content $StdOutPath
        } catch {
            $StdOutPath = [System.IO.Path]::ChangeExtension($StdOutPath, "$([DateTime]::Now.ToString('yyyyMMdd-HHmmss')).log")
        }
    } else {
        New-Item -ItemType File -Path $StdOutPath | Out-Null
    }

    if (Test-Path $StdErrPath) {
        try {
            Clear-Content $StdErrPath
        } catch {
            $StdErrPath = [System.IO.Path]::ChangeExtension($StdErrPath, "$([DateTime]::Now.ToString('yyyyMMdd-HHmmss')).log")
        }
    } else {
        New-Item -ItemType File -Path $StdErrPath | Out-Null
    }

    $proc = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath `
        -PassThru

    Set-Content -Path $PidPath -Value $proc.Id
    Write-Status "$Name started (PID $($proc.Id))."
}

function Wait-HttpReady {
    param(
        [string]$Url,
        [string]$Name,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Status "$Name is ready at $Url."
                return
            }
        } catch {
            Start-Sleep -Milliseconds 750
        }
    }

    throw "$Name did not become ready at $Url within $TimeoutSeconds seconds."
}

function Wait-AgentReady {
    param(
        [string]$PidPath,
        [string]$LogPath,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-ProcessAlive -PidPath $PidPath)) {
            break
        }

        if (Test-Path $LogPath) {
            $log = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
            if ($log -match 'Discovered new MySQL node' -or $log -match 'CPU:') {
                Write-Status 'Agent is publishing metrics.'
                return
            }
        }

        Start-Sleep -Milliseconds 750
    }

    throw "Agent did not report healthy metrics activity within $TimeoutSeconds seconds."
}

function Ensure-InfluxSetup {
    param([hashtable]$BackendEnv)

    $setupUrl = 'http://127.0.0.1:8086/api/v2/setup'
    $deadline = (Get-Date).AddSeconds(30)

    while ((Get-Date) -lt $deadline) {
        try {
            $setupState = Invoke-RestMethod -Method Get -Uri $setupUrl -TimeoutSec 3
            if (-not $setupState.allowed) {
                Write-Check -Name 'InfluxDB' -Passed $true -Details 'Already initialized'
                return
            }

            Write-Status 'InfluxDB is uninitialized. Bootstrapping org, bucket, and token...'
            docker exec capstone_influxdb influx setup --force --username admin --password admin12345 --org $BackendEnv['INFLUX_ORG'] --bucket $BackendEnv['INFLUX_BUCKET'] --token $BackendEnv['INFLUX_TOKEN'] | Out-Host
            Write-Check -Name 'InfluxDB' -Passed $true -Details ("Initialized org '{0}' and bucket '{1}'" -f $BackendEnv['INFLUX_ORG'], $BackendEnv['INFLUX_BUCKET'])
            return
        } catch {
            Start-Sleep -Milliseconds 750
        }
    }

    throw 'InfluxDB did not become reachable for setup checks within 30 seconds.'
}

$backendEnv = Get-EnvMap -Path (Join-Path $backendDir '.env')
foreach ($requiredKey in @('INFLUX_URL', 'INFLUX_TOKEN', 'INFLUX_ORG', 'INFLUX_BUCKET')) {
    if (-not $backendEnv.ContainsKey($requiredKey) -or [string]::IsNullOrWhiteSpace($backendEnv[$requiredKey])) {
        throw "Missing required key '$requiredKey' in backend\.env."
    }
}

Write-Status 'Starting Docker services...'
docker compose up -d | Out-Host
Ensure-InfluxSetup -BackendEnv $backendEnv
$dockerPs = docker ps --format "{{.Names}}|{{.Status}}|{{.Ports}}"
$dockerLines = @($dockerPs | Where-Object { $_ })
Write-Check -Name 'Docker' -Passed ($dockerLines.Count -ge 3) -Details ("{0} containers running" -f $dockerLines.Count)
foreach ($line in $dockerLines) {
    $parts = $line -split '\|', 3
    if ($parts.Count -eq 3) {
        Write-Status ("Docker: {0} | {1} | {2}" -f $parts[0], $parts[1], $parts[2])
    }
}

Start-ManagedProcess `
    -Name 'Backend' `
    -PidPath (Join-Path $runDir 'backend.pid') `
    -WorkingDirectory $backendDir `
    -FilePath 'cmd.exe' `
    -ArgumentList @('/c', 'npm start') `
    -StdOutPath (Join-Path $backendDir 'backend.out.log') `
    -StdErrPath (Join-Path $backendDir 'backend.err.log') `
    -Port 4000

Start-ManagedProcess `
    -Name 'Frontend' `
    -PidPath (Join-Path $runDir 'frontend.pid') `
    -WorkingDirectory $frontendDir `
    -FilePath 'cmd.exe' `
    -ArgumentList @('/c', 'npm run dev -- --host 0.0.0.0') `
    -StdOutPath (Join-Path $frontendDir 'frontend.out.log') `
    -StdErrPath (Join-Path $frontendDir 'frontend.err.log') `
    -Port 3000

$agentCommand = @(
    "set INFLUX_URL=$($backendEnv['INFLUX_URL'])",
    "set INFLUX_TOKEN=$($backendEnv['INFLUX_TOKEN'])",
    "set INFLUX_ORG=$($backendEnv['INFLUX_ORG'])",
    "set INFLUX_BUCKET=$($backendEnv['INFLUX_BUCKET'])",
    'set MYSQL_USER=root',
    'set MYSQL_PASS=root',
    'agent.exe'
) -join '&& '

Start-ManagedProcess `
    -Name 'Agent' `
    -PidPath (Join-Path $runDir 'agent.pid') `
    -WorkingDirectory $agentDir `
    -FilePath 'cmd.exe' `
    -ArgumentList @('/c', $agentCommand) `
    -StdOutPath (Join-Path $agentDir 'agent.out.log') `
    -StdErrPath (Join-Path $agentDir 'agent.err.log') `
    -Port $null

Wait-HttpReady -Name 'Backend' -Url 'http://127.0.0.1:4000/health'
Write-Check -Name 'Backend' -Passed $true -Details 'Health endpoint responded on http://127.0.0.1:4000/health'
Wait-HttpReady -Name 'Frontend' -Url 'http://127.0.0.1:3000/'
Write-Check -Name 'Frontend' -Passed $true -Details 'Vite responded on http://127.0.0.1:3000/'
Wait-AgentReady -PidPath (Join-Path $runDir 'agent.pid') -LogPath (Join-Path $agentDir 'agent.out.log')
$discoveredNodes = @()
if (Test-Path (Join-Path $agentDir 'agent.out.log')) {
    $discoveredNodes = @(Get-Content (Join-Path $agentDir 'agent.out.log') | Select-String 'Discovered new MySQL node')
}
Write-Check -Name 'Agent' -Passed $true -Details ("Metrics active{0}" -f $(if ($discoveredNodes.Count -gt 0) { " for $($discoveredNodes.Count) node(s)" } else { '' }))

if (-not $NoBrowser) {
    Start-Process 'http://127.0.0.1:3000'
    Write-Status 'Opened dashboard in the default browser.'
}

Write-Status 'NodeFlux is running.'
