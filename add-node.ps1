param(
    [string]$NodeName = 'capstone_mysql_3',
    [int]$HostPort = 3308
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$networkName = 'mysql-monitoring-capstone_default'

Write-Host "[NodeFlux] Creating MySQL node '$NodeName' on port $HostPort..."

docker run -d `
  --name $NodeName `
  --network $networkName `
  -e MYSQL_ROOT_PASSWORD=root `
  -p "${HostPort}:3306" `
  mysql:8.0

Write-Host "[NodeFlux] Container started. The agent should discover it within about 10 seconds."
Write-Host "[NodeFlux] Open the dashboard and look for '$NodeName'."
