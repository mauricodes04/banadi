# Build (if needed) and start the long-lived `banadi` kali container.
# PowerShell sibling of banadi-up.sh for Windows hosts running Docker Desktop.
# Idempotent: re-running while the container is up is a no-op.

$ErrorActionPreference = 'Stop'

$Image          = if ($env:BANADI_IMAGE)     { $env:BANADI_IMAGE }     else { 'banadi/banadi:latest' }
$Name           = if ($env:BANADI_CONTAINER) { $env:BANADI_CONTAINER } else { 'banadi' }
$DockerfileDir  = Join-Path (Split-Path -Parent $PSScriptRoot) 'docker\banadi'

$haveImage = (docker images -q $Image | Select-Object -First 1)
if (-not $haveImage) {
    [Console]::Error.WriteLine("build: $Image")
    docker build -t $Image $DockerfileDir
    if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
}

$state = (docker ps -a --filter "name=^/$Name$" --format '{{.State}}' | Select-Object -First 1)
if (-not $state) { $state = '' }

switch ($state) {
    'running' {
        [Console]::Error.WriteLine('banadi: already running')
    }
    { $_ -in 'exited','created' } {
        [Console]::Error.WriteLine('banadi: starting existing container')
        docker start $Name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "docker start failed" }
    }
    '' {
        [Console]::Error.WriteLine('banadi: creating container')
        docker run -d --name $Name --restart unless-stopped $Image | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "docker run failed" }
    }
    default {
        [Console]::Error.WriteLine("banadi: unexpected state '$state'")
        exit 1
    }
}

docker inspect -f '{{.State.Status}}' $Name
