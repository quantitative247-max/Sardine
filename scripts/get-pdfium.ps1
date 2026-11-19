# Downloads pdfium.dll (Windows x64) into src-tauri/pdfium/
# Pinned to the release that pdfium-render 0.9.5 targets (chromium/8125); falls back to the latest release.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'src-tauri\pdfium'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tmp = Join-Path $env:TEMP "pdfium-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$urls = @(
  'https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F8125/pdfium-win-x64.tgz',
  'https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-win-x64.tgz'
)
foreach ($u in $urls) {
  try {
    Write-Host "Downloading $u"
    Invoke-WebRequest -Uri $u -OutFile "$tmp\pdfium.tgz" -UseBasicParsing
    break
  } catch { Write-Host "  failed: $($_.Exception.Message)" }
}
if (-not (Test-Path "$tmp\pdfium.tgz")) { throw 'Could not download pdfium' }
tar -xzf "$tmp\pdfium.tgz" -C $tmp
Copy-Item "$tmp\bin\pdfium.dll" (Join-Path $dest 'pdfium.dll') -Force
Remove-Item $tmp -Recurse -Force
Write-Host "pdfium.dll -> $dest"
