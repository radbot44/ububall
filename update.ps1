# Compatibility entry point: updates come from the owner's local source checkout.
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$InstallOnly,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA 'ubumint')
)
$ErrorActionPreference = 'Stop'
$SettingsDirectory = [IO.Path]::GetFullPath($SettingsDirectory)
$manifestPath = Join-Path $SettingsDirectory 'installation.json'
$sourceDirectory = $null

if (Test-Path -LiteralPath $manifestPath) {
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest -and $manifest.source) {
            $candidate = $manifest.source
            if (Test-Path -LiteralPath (Join-Path $candidate 'install.ps1') -PathType Leaf) {
                $sourceDirectory = $candidate
            } elseif ((Split-Path $candidate -Leaf) -eq 'ubumint') {
                $renamed = Join-Path (Split-Path $candidate -Parent) 'ububall'
                if (Test-Path -LiteralPath (Join-Path $renamed 'install.ps1') -PathType Leaf) {
                    $sourceDirectory = $renamed
                }
            } elseif ((Split-Path $candidate -Leaf) -eq 'ububall') {
                $legacy = Join-Path (Split-Path $candidate -Parent) 'ubumint'
                if (Test-Path -LiteralPath (Join-Path $legacy 'install.ps1') -PathType Leaf) {
                    $sourceDirectory = $legacy
                }
            }
        }
    } catch { }
}

if (!$sourceDirectory) {
    $parent = Split-Path $PSScriptRoot -Parent
    foreach ($name in @('ububall', 'ubumint')) {
        $candidate = Join-Path $parent $name
        if (Test-Path -LiteralPath (Join-Path $candidate 'install.ps1') -PathType Leaf) {
            $sourceDirectory = $candidate
            break
        }
    }
}

if (!$sourceDirectory) {
    $sourceDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'ububall'
}

$installer = Join-Path $sourceDirectory 'install.ps1'
if (!(Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Source checkout not found at $installer. Run install.ps1 from your ububall or ubumint source checkout."
}

& $installer -Destination $PSScriptRoot -DryRun:$DryRun -InstallOnly:$InstallOnly -SettingsDirectory $SettingsDirectory
