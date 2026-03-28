$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $root "dist-portable"
$portableRoot = Join-Path $distRoot "OpenClawPortable"
$releaseRoot = Join-Path $root "src-tauri\target\release"
$bundleRoot = Join-Path $releaseRoot "bundle"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

Write-Host "Root: $root"

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm.cmd not found."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path $cargoBin)) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found. Install Rust first."
}

Push-Location $root
try {
  if (Test-Path $distRoot) {
    Remove-Item -Recurse -Force $distRoot
  }

  $env:npm_config_cache = Join-Path $root ".npm-cache"

  npm.cmd install
  npm.cmd --prefix app install

  if (Test-Path $vcvars) {
    $buildCmd = 'call "' + $vcvars + '" && set PATH=' + $cargoBin + ';%PATH% && cd /d "' + $root + '" && set npm_config_cache=' + $env:npm_config_cache + ' && npm.cmd run build'
    cmd.exe /c $buildCmd
    if ($LASTEXITCODE -ne 0) {
      throw "Build failed with exit code $LASTEXITCODE"
    }
  } else {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
      throw "Build failed with exit code $LASTEXITCODE"
    }
  }

  New-Item -ItemType Directory -Force $portableRoot | Out-Null

  $exe = Join-Path $releaseRoot "openclaw-usb-portable.exe"
  if (-not (Test-Path $exe)) {
    throw "Built exe not found: $exe"
  }

  Copy-Item $exe $portableRoot -Force

  foreach ($name in @("runtime", "docs", "README.md", "dev-notes.md", "IMPLEMENTATION_PLAN.md")) {
    $source = Join-Path $root $name
    if (Test-Path $source) {
      Copy-Item $source $portableRoot -Recurse -Force
    }
  }

  if (Test-Path $bundleRoot) {
    Copy-Item $bundleRoot (Join-Path $portableRoot "bundle-artifacts") -Recurse -Force
  }

  Write-Host "Portable output ready: $portableRoot"
}
finally {
  Pop-Location
}
