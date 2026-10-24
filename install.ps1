[CmdletBinding()]
param(
    [string]$Destination,
    [switch]$DryRun,
    [switch]$InstallOnly,
    [switch]$Setup,
    [switch]$ResetMint,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA 'ubumint')
)
$ErrorActionPreference = 'Stop'
if ($ResetMint -and ($Setup -or $DryRun -or $InstallOnly)) { throw '-ResetMint requires deployment and cannot be combined with -Setup, -DryRun or -InstallOnly.' }
$source = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$SettingsDirectory = [IO.Path]::GetFullPath($SettingsDirectory)
$manifestPath = Join-Path $SettingsDirectory 'installation.json'
$installation = $null
if (Test-Path -LiteralPath $manifestPath) {
    $installation = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
}
# The installed copy is an entry point too. Always install from the source
# checkout rather than treating the deployment directory as another source.
if ($installation.destination -eq $source -or (Split-Path $source -Leaf) -eq 'ubumint-cloudflare') {
    $sourceDirectory = $installation.source
    if (!$sourceDirectory) { $sourceDirectory = Join-Path (Split-Path $source -Parent) 'ubumint' }
    $installer = Join-Path $sourceDirectory 'install.ps1'
    if ([IO.Path]::GetFullPath($installer) -eq $PSCommandPath -or !(Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Source installer not found at $installer. Run install.ps1 from your ubumint source checkout."
    }
    $forward = @{}
    foreach ($entry in $PSBoundParameters.GetEnumerator()) { $forward[$entry.Key] = $entry.Value }
    if (!$forward.ContainsKey('Destination')) { $forward.Destination = $source }
    $forward.SettingsDirectory = $SettingsDirectory
    & $installer @forward
    return
}
if (!$Destination) { $Destination = Join-Path (Split-Path $source -Parent) 'ubumint-cloudflare' }
$Destination = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if ($Destination -eq $source -or $Destination.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith($Destination + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The installation must be separate from the source checkout.'
}
$wranglerPath = [regex]::Escape($Destination + '\node_modules\wrangler\')
$modulesPath = $Destination + '\node_modules\'
$busy = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='esbuild.exe' OR Name='workerd.exe'" | Where-Object {
    ($_.CommandLine -and $_.CommandLine.Replace('/', '\') -match $wranglerPath) -or
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($modulesPath, [StringComparison]::OrdinalIgnoreCase))
})
if ($busy.Count) { throw "Wrangler is already using $Destination (process IDs: $($busy.ProcessId -join ', ')). Let that command finish or close its dev terminal, then retry. No installation files were changed." }
New-Item -ItemType Directory -Force -Path $SettingsDirectory | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $SettingsDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the settings directory.' }
# Copy only Git's source file list plus new deployment tooling before its first commit.
# Credentials, dependencies and runtime state are never copied from the source.
$files = @(& git -C $source ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Could not list source files.' }
$files = @($files + @('install.ps1', 'deploy.ps1', 'update.ps1', 'scripts/deploy-config.cjs', 'test/deploy-config.test.cjs') | Sort-Object -Unique)
$oldHashes = @{}
if (Test-Path -LiteralPath $manifestPath) {
    $previous = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($previous.destination -ne $Destination) { throw 'Settings belong to another installation. Use a separate -SettingsDirectory.' }
    foreach ($property in $previous.files.PSObject.Properties) { $oldHashes[$property.Name] = $property.Value }
}
$newHashes = @{}
$changed = @()
foreach ($file in $files) {
    $from = Join-Path $source $file
    if (!(Test-Path -LiteralPath $from -PathType Leaf)) { throw "Source file missing: $file" }
    $hash = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
    $newHashes[$file] = $hash
    $to = Join-Path $Destination $file
    if (!(Test-Path -LiteralPath $to)) { continue }
    $existing = (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash
    if ($existing -eq $hash) { continue }
    $changed += $file
    if ($file -in @('wrangler.jsonc', 'update.ps1') -or $oldHashes[$file] -eq $existing) { continue }
    $baseline = & git -C $Destination rev-parse "HEAD:$file" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $blob = & git -C $Destination hash-object --path=$file $to
        if ($LASTEXITCODE -eq 0 -and $baseline -eq $blob) { continue }
    }
    throw "Separate edit in $file. Preserve or reconcile it before updating; nothing has been copied."
}
$backup = Join-Path $SettingsDirectory ('backups\install-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
foreach ($file in $changed) {
    $saved = Join-Path $backup $file
    New-Item -ItemType Directory -Force -Path (Split-Path $saved -Parent) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Destination $file) -Destination $saved
}
# Recover private settings before replacing the tracked Wrangler configuration.
if (!(Test-Path (Join-Path $SettingsDirectory 'settings.json')) -and (Test-Path (Join-Path $Destination 'wrangler.local.jsonc'))) {
    Push-Location $Destination
    try {
        & node (Join-Path $source 'scripts\deploy-config.cjs') recover $SettingsDirectory
        if ($LASTEXITCODE -ne 0) { throw 'Could not recover deployment settings. Installation stopped.' }
    } finally { Pop-Location }
}
foreach ($file in $files) {
    $to = Join-Path $Destination $file
    New-Item -ItemType Directory -Force -Path (Split-Path $to -Parent) | Out-Null
    Copy-Item -LiteralPath (Join-Path $source $file) -Destination $to -Force
}
@{ source = $source; destination = $Destination; files = $newHashes } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "Installed into $Destination. Private settings: $SettingsDirectory"
if (!$InstallOnly) {
    & (Join-Path $Destination 'deploy.ps1') -DryRun:$DryRun -Setup:$Setup -ResetMint:$ResetMint -SettingsDirectory $SettingsDirectory
}
