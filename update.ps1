# Compatibility entry point: updates come from the owner's local source checkout.
param([switch]$DryRun, [switch]$InstallOnly)
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path $PSScriptRoot -Parent) 'ubumint\install.ps1'
if (!(Test-Path -LiteralPath $installer)) { throw 'Source checkout not found. Run install.ps1 from your ubumint source checkout.' }
& $installer -Destination $PSScriptRoot -DryRun:$DryRun -InstallOnly:$InstallOnly
