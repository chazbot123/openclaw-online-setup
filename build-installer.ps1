$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

Write-Host "Root: $root"

$env:PATH = "$root;$env:PATH"

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm.cmd not found."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path $cargoBin)) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found. Install Rust first."
}

if (-not (Test-Path $vcvars)) {
  throw "vcvars64.bat not found. Install Visual Studio Build Tools with C++ workload."
}

Push-Location $root
try {
  $env:npm_config_cache = Join-Path $root ".npm-cache"

  $payloadManifest = Join-Path $root "payload\Cargo.toml"
  if (Test-Path $payloadManifest) {
    Write-Host "Building payload..."
    cargo build --release --manifest-path $payloadManifest
    if ($LASTEXITCODE -ne 0) {
      throw "Payload build failed with exit code $LASTEXITCODE"
    }
    $payloadExe = Join-Path $root "payload\target\release\openclaw.exe"
    if (-not (Test-Path $payloadExe)) {
      throw "Payload exe not found: $payloadExe"
    }
    $payloadOut = Join-Path $root "runtime\openclaw\openclaw.exe"
    Copy-Item $payloadExe $payloadOut -Force
    Write-Host "Payload copied to: $payloadOut"
  }

  $buildCmd = 'call "' + $vcvars + '" && set PATH=' + $cargoBin + ';%PATH% && cd /d "' + $root + '" && set npm_config_cache=' + $env:npm_config_cache + ' && npm.cmd run build:installer'
  cmd.exe /c $buildCmd
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE"
  }

  $bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
  if (-not (Test-Path $bundleDir)) {
    throw "NSIS bundle directory not found: $bundleDir"
  }

  $installer = Get-ChildItem $bundleDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $installer) {
    throw "Installer exe not found in: $bundleDir"
  }

  Copy-Item $installer.FullName (Join-Path $root $installer.Name) -Force
  Write-Host "Installer copied to: $(Join-Path $root $installer.Name)"
}
finally {
  Pop-Location
}
