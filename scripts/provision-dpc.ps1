<#
.SYNOPSIS
  Aprovisiona un DPC (Device Owner o Profile Owner) por ADB en Windows.

.DESCRIPTION
  Requiere: platform-tools en PATH y el dispositivo con depuracion USB activa.

.EXAMPLE
  .\provision-dpc.ps1 -Apk .\dpc.apk -Component com.empresa.dpc/.AdminReceiver

.EXAMPLE
  .\provision-dpc.ps1 -Apk .\dpc.apk -Component com.empresa.dpc/.AdminReceiver -Mode profile
#>
param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$Component,
    [ValidateSet('device', 'profile')][string]$Mode = 'device',
    [string]$Serial = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$adb = if ($env:ADB) { $env:ADB } else { 'adb' }

if (-not (Test-Path $Apk)) { throw "APK no encontrado: $Apk" }

if (-not $Serial) {
    $Serial = (& $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' } |
        ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1)
}

if (-not $Serial) { throw 'No hay dispositivos conectados.' }

Write-Host '== Dispositivo ==' -ForegroundColor Cyan
Write-Host "serial: $Serial"
& $adb -s $Serial get-state

$sdkLine = (& $adb -s $Serial shell getprop ro.build.version.sdk) -join ''
$usersRaw = (& $adb -s $Serial shell pm list users) -join "`n"
$ownersRaw = (& $adb -s $Serial shell dpm list-owners) -join "`n"
$accountsRaw = (& $adb -s $Serial shell dumpsys account) -join "`n"

$users = ([regex]::Matches($usersRaw, 'UserInfo\{')).Count
$owners = ([regex]::Matches($ownersRaw, 'admin=')).Count
$accounts = ($accountsRaw -split "`n" | Where-Object { $_ -match 'Account \{' -and $_ -notmatch 'name=null' }).Count

Write-Host "`n== Preflight ==" -ForegroundColor Cyan
Write-Host "android sdk : $($sdkLine.Trim())"
Write-Host "usuarios    : $users"
Write-Host "owners      : $owners"
Write-Host "cuentas     : $accounts"

$blocked = $false
if ($owners -ne 0) { Write-Host '  x ya existe un Device/Profile Owner' -ForegroundColor Red; $blocked = $true }
if ($users -ne 1) { Write-Host '  x hay usuarios extra (Secure Folder, Dual Messenger, perfil)' -ForegroundColor Red; $blocked = $true }
if ($accounts -ne 0) { Write-Host '  x hay cuentas configuradas; se exige un dispositivo restaurado' -ForegroundColor Red; $blocked = $true }

if ($blocked -and -not $Force) {
    Write-Host "`nAbortado. Restaura de fabrica o limpia usuarios/cuentas. Usa -Force para insistir." -ForegroundColor Yellow
    exit 2
}

Write-Host "`n== Instalando APK ==" -ForegroundColor Cyan
$installOutput = (& $adb -s $Serial install -r -g $Apk) -join "`n"
Write-Host $installOutput
if ($installOutput -notmatch 'Success') { throw 'La instalacion fallo.' }

Write-Host "`n== Aprovisionando ($Mode) ==" -ForegroundColor Cyan
if ($Mode -eq 'profile') {
    & $adb -s $Serial shell dpm set-profile-owner --user 0 $Component
}
else {
    & $adb -s $Serial shell dpm set-device-owner --user 0 $Component
}

Write-Host "`n== Verificacion ==" -ForegroundColor Cyan
& $adb -s $Serial shell dpm list-owners
