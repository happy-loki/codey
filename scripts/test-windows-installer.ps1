param([string]$Target = "")

$ErrorActionPreference = "Stop"
$bundleRoot = if ($Target) { "src-tauri/target/$Target/release/bundle/msi" } else { "src-tauri/target/release/bundle/msi" }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$installers = @(Get-ChildItem $bundleRoot -Filter "*_${version}_*.msi")
if ($installers.Count -ne 1) { throw "Expected exactly one MSI for version $version" }
$msiPath = $installers[0].FullName
$installDir = Join-Path $env:RUNNER_TEMP "codey-installer-test"
$installLog = Join-Path $env:RUNNER_TEMP "codey-install.log"
$uninstallLog = Join-Path $env:RUNNER_TEMP "codey-uninstall.log"

$install = Start-Process msiexec.exe -ArgumentList @("/i", "`"$msiPath`"", "/qn", "/norestart", "INSTALLDIR=`"$installDir`"", "/L*v", "`"$installLog`"") -Wait -PassThru
if ($install.ExitCode -notin @(0, 3010)) {
    Get-Content $installLog -Tail 100
    throw "MSI installation failed: $($install.ExitCode)"
}
try {
    $binary = Get-Item (Join-Path $installDir "codey.exe")
    if ($binary.VersionInfo.ProductVersion -notlike "$version*") { throw "Installed executable version does not match $version" }
    Write-Host "MSI installed codey.exe version $version successfully."
} finally {
    $uninstall = Start-Process msiexec.exe -ArgumentList @("/x", "`"$msiPath`"", "/qn", "/norestart", "/L*v", "`"$uninstallLog`"") -Wait -PassThru
    if ($uninstall.ExitCode -notin @(0, 3010)) {
        Get-Content $uninstallLog -Tail 100
        throw "MSI uninstall failed: $($uninstall.ExitCode)"
    }
}
if (Test-Path (Join-Path $installDir "codey.exe")) { throw "MSI uninstall left the application executable behind" }
Write-Host "MSI uninstall verified."
