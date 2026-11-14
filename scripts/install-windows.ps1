$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Join-Path $projectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
  throw "PAXI package.json was not found. Run this script from an extracted PAXI DevKit source folder."
}

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 20 or newer is required. Install Node.js, reopen PowerShell and run this script again.' }
if (-not $npm) { throw 'npm.cmd was not found. Repair the Node.js installation or add its directory to PATH.' }

$nodeVersion = (& node --version).Trim()
$nodeMajorMatch = [regex]::Match($nodeVersion, '^v?(\d+)\.')
if ($LASTEXITCODE -ne 0 -or -not $nodeMajorMatch.Success) {
  throw "Could not read the installed Node.js version: $nodeVersion"
}
if ([int]$nodeMajorMatch.Groups[1].Value -lt 20) { throw "Node.js 20 or newer is required; found $nodeVersion." }

Write-Host "Installing PAXI DevKit from: $projectRoot"
& $npm.Source install --global $projectRoot
if ($LASTEXITCODE -ne 0) { throw "npm global installation failed with exit code $LASTEXITCODE." }

$paxi = Get-Command paxi.cmd -ErrorAction SilentlyContinue
if ($paxi) {
  & $paxi.Source version
  if ($LASTEXITCODE -ne 0) { throw 'PAXI was installed, but its version command failed.' }
  Write-Host 'PAXI is installed. Run: paxi doctor --json'
} else {
  $prefix = (& $npm.Source config get prefix).Trim()
  Write-Warning 'PAXI was installed, but the npm global command directory is not on this PowerShell PATH.'
  Write-Host "Add this directory to your user PATH, then open a new terminal: $prefix"
  Write-Host 'After reopening PowerShell, run: paxi version; paxi doctor --json'
}
