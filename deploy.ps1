[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Setup,
    [switch]$ResetMint,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA 'ubumint')
)
$ErrorActionPreference = 'Stop'
if ($ResetMint -and ($Setup -or $DryRun)) { throw '-ResetMint cannot be combined with -Setup or -DryRun.' }
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Deployment stopped." }
}
Push-Location $PSScriptRoot
try {
    $wranglerPath = [regex]::Escape($PSScriptRoot + '\node_modules\wrangler\')
    $modulesPath = $PSScriptRoot + '\node_modules\'
    $busy = @(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='esbuild.exe' OR Name='workerd.exe'" | Where-Object {
        ($_.CommandLine -and $_.CommandLine.Replace('/', '\') -match $wranglerPath) -or
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($modulesPath, [StringComparison]::OrdinalIgnoreCase))
    })
    if ($busy.Count) { throw "Wrangler is already using this installation (process IDs: $($busy.ProcessId -join ', ')). Let that command finish or close its dev terminal, then retry." }
    $SettingsDirectory = [IO.Path]::GetFullPath($SettingsDirectory)
    New-Item -ItemType Directory -Force -Path $SettingsDirectory | Out-Null
    # Restrict saved production credentials, generated secret payloads and backups.
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Run icacls.exe @($SettingsDirectory, '/inheritance:r', '/grant:r', "*${sid}:(OI)(CI)F", '*S-1-5-18:(OI)(CI)F')
    if ($Setup) {
        if (Test-Path (Join-Path $SettingsDirectory 'settings.json')) { throw 'Settings already exist; refusing to replace them.' }
        if ((Test-Path 'wrangler.local.jsonc') -or (Test-Path '.dev.vars')) { throw 'Existing local settings found. Run deploy.ps1 without -Setup to recover them; do not create a replacement mint.' }
        $inputSettings = @{
            name = (Read-Host 'Cloudflare Worker name')
            origin = (Read-Host 'Website origin (https://..., no trailing slash)')
            clientId = (Read-Host 'Discord application ID')
        }
        $secure = Read-Host 'Discord application secret' -AsSecureString
        $inputSettings.clientSecret = [Net.NetworkCredential]::new('', $secure).Password
        $inputSettings | ConvertTo-Json -Compress | & node scripts/deploy-config.cjs setup $SettingsDirectory
        if ($LASTEXITCODE -ne 0) { throw 'First-time setup failed.' }
        $inputSettings.Clear()
    } else {
        Run node @('scripts/deploy-config.cjs', 'recover', $SettingsDirectory)
    }
    $backup = Join-Path $SettingsDirectory ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    Copy-Item -LiteralPath (Join-Path $SettingsDirectory 'settings.json') -Destination $backup
    foreach ($legacy in @('wrangler.jsonc', 'wrangler.local.jsonc', 'wrangler.deploy.jsonc', '.dev.vars')) {
        if (Test-Path -LiteralPath $legacy) { Copy-Item -LiteralPath $legacy -Destination $backup }
    }
    Run npm.cmd @('ci', '--no-audit', '--no-fund')
    Run npm.cmd @('test')
    Run npm.cmd @('run', 'test:worker')
    if ($ResetMint) {
        Run node @('scripts/deploy-config.cjs', 'reset', $SettingsDirectory)
        Write-Host 'Reset prepared. If upload fails, retry deploy.ps1 WITHOUT -ResetMint.'
    }
    $buildAction = 'build'
    if ($ResetMint) { $buildAction = 'build-reset' }
    Run node @('scripts/deploy-config.cjs', $buildAction, $SettingsDirectory)
    $wrangler = Join-Path $PSScriptRoot 'node_modules\wrangler\bin\wrangler.js'
    $arguments = @($wrangler, 'deploy', '--config', 'wrangler.deploy.jsonc', '--keep-vars', '--secrets-file', (Join-Path $SettingsDirectory 'deploy-secrets.json'))
    if ($DryRun) { $arguments += '--dry-run' }
    Run node $arguments
    if (!$DryRun) {
        $settings = Get-Content -LiteralPath (Join-Path $SettingsDirectory 'settings.json') -Raw | ConvertFrom-Json
        $verified = $false
        for ($attempt = 0; $attempt -lt 6; $attempt++) {
            try {
                $response = Invoke-RestMethod ($settings.vars.ORIGIN + '/api/config') -TimeoutSec 10
                $verified = $response.ready -and $response.login -and $response.mint -eq $settings.vars.MINT_ID
            } catch { $verified = $false }
            if ($verified) { break }
            if ($attempt -lt 5) { Start-Sleep -Seconds 2 }
        }
        if (!$verified) {
            $hostname = ([Uri]$settings.vars.ORIGIN).DnsSafeHost
            try { [Net.Dns]::GetHostAddresses($hostname) | Out-Null }
            catch {
                Write-Warning "Worker uploaded successfully, but this computer cannot resolve $hostname yet. Public verification is pending. After creating or recreating a custom domain, DNS caches can retain the old missing-domain response. Run ipconfig /flushdns, restart the browser, and allow your DNS resolver time to refresh. Do not run -Setup again."
                Write-Host "Settings and backups: $SettingsDirectory"
                return
            }
            throw 'Worker uploaded successfully and DNS resolves, but public configuration verification failed. Check the saved origin, domain certificate and /api/config response. Do not run -Setup again.'
        }
        Write-Host 'Deployment complete; public mint identity verified.'
    } else { Write-Host 'Dry run complete. Nothing was uploaded to Cloudflare.' }
    Write-Host "Settings and backups: $SettingsDirectory"
} finally {
    $payload = Join-Path $SettingsDirectory 'deploy-secrets.json'
    if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload }
    Pop-Location
}
