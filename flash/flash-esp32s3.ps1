[CmdletBinding()]
param(
    [string]$Port = "",
    [switch]$Menuconfig,
    [switch]$Erase,
    [switch]$Monitor
)

$ErrorActionPreference = "Stop"

function Invoke-Idf {
    param([string[]]$IdfArgs)
    & idf.py @IdfArgs
    if ($LASTEXITCODE -ne 0) {
        throw "idf.py failed: $($IdfArgs -join ' ')"
    }
}

if (-not (Get-Command idf.py -ErrorAction SilentlyContinue)) {
    throw "Khong tim thay idf.py. Hay mo ESP-IDF v5.4.2 terminal/environment truoc."
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$FirmwareDir = Join-Path $RepoRoot "firmware"

if (-not (Test-Path (Join-Path $FirmwareDir "CMakeLists.txt"))) {
    throw "Khong tim thay thu muc firmware."
}

Push-Location $FirmwareDir
try {
    $TargetReady = $false
    if (Test-Path "sdkconfig") {
        $TargetReady = [bool](Select-String -Path "sdkconfig" -Pattern '^CONFIG_IDF_TARGET="esp32s3"$' -Quiet)
    }

    if (-not $TargetReady) {
        Write-Host "==> Set target: esp32s3"
        Invoke-Idf @("set-target", "esp32s3")
    }

    if ($Menuconfig) {
        Write-Host "==> Open menuconfig"
        Invoke-Idf @("menuconfig")
    }

    Write-Host "==> Build firmware"
    Invoke-Idf @("build")

    $PortArgs = @()
    if ($Port) {
        $PortArgs = @("-p", $Port)
    }

    if ($Erase) {
        if (-not $Port) {
            throw "-Erase can chi dinh -Port de tranh xoa nham thiet bi."
        }
        Write-Host "==> Erase flash: $Port"
        Invoke-Idf ($PortArgs + @("erase-flash"))
    }

    Write-Host "==> Flash ESP32-S3"
    Invoke-Idf ($PortArgs + @("flash"))

    if ($Monitor) {
        Write-Host "==> Serial monitor (Ctrl+] de thoat)"
        Invoke-Idf ($PortArgs + @("monitor"))
    }
}
finally {
    Pop-Location
}
