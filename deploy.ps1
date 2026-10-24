[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Setup,
    [string]$SettingsDirectory = (Join-Path $env:LOCALAPPDATA 'ubumint')
)
$ErrorActionPreference = 'Stop'
function Run([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Deployment stopped." }
}
Push-Location $PSScriptRoot
try {
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
    Run node @('scripts/deploy-config.cjs', 'build', $SettingsDirectory)
    Run npm.cmd @('ci', '--no-audit', '--no-fund')
    Run npm.cmd @('test')
    Run npm.cmd @('run', 'test:worker')
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
        if (!$verified) { throw 'Deployment uploaded, but public configuration verification failed. Check the saved origin/domain route.' }
        Write-Host 'Deployment complete; public mint identity verified.'
    } else { Write-Host 'Dry run complete. Nothing was uploaded to Cloudflare.' }
    Write-Host "Settings and backups: $SettingsDirectory"
} finally {
    $payload = Join-Path $SettingsDirectory 'deploy-secrets.json'
    if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload }
    Pop-Location
}
