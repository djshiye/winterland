# Winterland updater for Windows. It ships in every Windows release zip as updater\update.ps1 and is started by
# "Update Winterland.cmd" next to Winterland.exe; scripts/updater-files.mjs fills in the version and platform below
# when the zip is built. Plain ASCII and Windows PowerShell 5.1 compatible on purpose (that's what every PC has).
#
# What it does, and nothing else:
#   1. Reads SHA256SUMS.txt from the latest GitHub release of djshiye/winterland (HTTPS, TLS 1.2+).
#   2. If that release is newer than this copy, downloads the Windows zip from that exact release tag.
#   3. Checks the zip's SHA-256 against SHA256SUMS.txt. On any mismatch it stops and changes nothing.
#   4. Swaps the files in the Winterland folder that the new zip ships, keeping the old ones until the new ones are in
#      place, and puts them back if anything fails.
#   5. Starts the new version.
# It never reads, moves or deletes the save (%APPDATA%\Winterland): the save is not in the game folder.
#
# Options: -Yes (don't ask before updating), -NoLaunch (don't start the game afterwards), -NoPause (don't wait for a
# key at the end).

param([switch]$Yes, [switch]$NoLaunch, [switch]$NoPause)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest many times slower

$Repo = 'djshiye/winterland'
$BuiltVersion = '__WL_VERSION__'
$Target = '__WL_TARGET__'

function Say([string]$Text, [string]$Color = '') {
  if ($Color) { Write-Host $Text -ForegroundColor $Color } else { Write-Host $Text }
}
function Pause-End {
  if (-not $NoPause) { [void](Read-Host "`nPress Enter to close this window") }
}
function Stop-Update([string]$Why) {
  Say ''
  Say "Update stopped: $Why" 'Red'
  Say 'Your game and your save are exactly as they were.'
  Pause-End
  exit 1
}
function Get-Https([string]$Url, [string]$OutFile) {
  if (-not $Url.StartsWith("https://github.com/$Repo/releases/")) { throw "refusing to download $Url" }
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -MaximumRedirection 5 -TimeoutSec 120
}

Say ''
Say '  Winterland updater' 'Cyan'
Say ''

# HTTPS with TLS 1.2 or newer (Windows PowerShell 5.1 can default to older protocols).
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$Install = Split-Path -Parent $PSScriptRoot
$Exe = Join-Path $Install 'Winterland.exe'
$Stage = Join-Path $Install '.winterland-update-new'
$Old = Join-Path $Stage 'old'

# A previous update that was cut off mid-swap (power loss): put back any old file that has no replacement yet.
if (Test-Path -LiteralPath $Old) {
  foreach ($item in Get-ChildItem -LiteralPath $Old -Force) {
    $dest = Join-Path $Install $item.Name
    if (-not (Test-Path -LiteralPath $dest)) { Move-Item -LiteralPath $item.FullName -Destination $dest }
  }
}
if (-not ((Test-Path -LiteralPath $Exe) -and (Test-Path -LiteralPath (Join-Path $Install 'resources\app.asar')))) {
  Stop-Update 'run this from your unzipped Winterland folder (the one with Winterland.exe in it).'
}

$Current = $BuiltVersion
if ($Current -notmatch '^\d+\.\d+\.\d+$') { $Current = '0.0.0' }
Say "You have Winterland $Current. Looking for a newer version on GitHub..."

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('winterland-update-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Tmp | Out-Null
$Lock = Join-Path $Install '.winterland-update-lock'
$HaveLock = $false
$KeepStage = $false
try {
  $Sums = Join-Path $Tmp 'SHA256SUMS.txt'
  try { Get-Https "https://github.com/$Repo/releases/latest/download/SHA256SUMS.txt" $Sums }
  catch { Stop-Update "couldn't reach GitHub. Check your internet connection and try again." }

  # Exactly one line for this platform, in the strict "<64 hex>  Winterland-X.Y.Z-<target>.zip" form.
  $pattern = '^([0-9a-f]{64})  (Winterland-(\d+\.\d+\.\d+)-' + [regex]::Escape($Target) + '\.zip)$'
  $lines = @(Get-Content -LiteralPath $Sums | Where-Object { $_ -cmatch $pattern })
  if ($lines.Count -ne 1) { Stop-Update "the latest release has no download for this computer ($Target)." }
  [void]($lines[0] -cmatch $pattern)
  $WantSha = $Matches[1]
  $ZipName = $Matches[2]
  $Latest = $Matches[3]

  if ([version]$Latest -le [version]$Current) {
    Say ''
    Say "You already have the newest Winterland ($Current). Nothing to do." 'Green'
    Pause-End
    exit 0
  }

  Say ''
  Say "Winterland $Latest is out!" 'Cyan'
  Say "It will replace the game files in $Install."
  Say 'Your save stays where it is and is not touched.'
  if (-not $Yes) { [void](Read-Host "`nPress Enter to update, or close this window to keep $Current") }

  # One updater at a time, and never while the game is running.
  if (Test-Path -LiteralPath $Lock) {
    $other = Get-Content -LiteralPath (Join-Path $Lock 'pid') -ErrorAction SilentlyContinue
    if (-not ($other -and (Get-Process -Id $other -ErrorAction SilentlyContinue))) {
      Remove-Item -LiteralPath $Lock -Recurse -Force # left behind by an updater that was killed
    }
  }
  try { New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null; $HaveLock = $true }
  catch { Stop-Update "another update is already running (or $Install isn't writable)." }
  Set-Content -LiteralPath (Join-Path $Lock 'pid') -Value $PID

  while (Get-Process -Name 'Winterland' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe }) {
    if ($NoPause) { Stop-Update 'close Winterland first, then run the updater again.' }
    [void](Read-Host "`nWinterland is still open. Close the game (your progress saves), then press Enter")
  }

  Say ''
  Say "Downloading $ZipName..."
  $Zip = Join-Path $Tmp $ZipName
  try { Get-Https "https://github.com/$Repo/releases/download/v$Latest/$ZipName" $Zip }
  catch { Stop-Update "the download didn't finish. Check your internet connection and try again." }

  Write-Host 'Checking the download is genuine (SHA-256)... ' -NoNewline
  # Plain .NET rather than Get-FileHash / Expand-Archive: those live in modules that some setups fail to load.
  $hasher = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Zip)
  try { $GotSha = -join ($hasher.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($GotSha -ne $WantSha) {
    Say 'no match' 'Red'
    Stop-Update "the downloaded file doesn't match the release's checksum, so it was thrown away."
  }
  Say 'OK' 'Green'

  # Unpack next to the game (same disk, so the swap is a quick rename) and check it looks like Winterland.
  Say 'Installing...'
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force } # leftovers were put back above
  $Unpacked = Join-Path $Stage 'unpacked'
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Unpacked) # refuses entries that point outside $Unpacked
  }
  catch { Stop-Update "couldn't unpack the download." }
  $tops = @(Get-ChildItem -LiteralPath $Unpacked -Force)
  if ($tops.Count -ne 1 -or -not $tops[0].PSIsContainer) { Stop-Update "the download isn't laid out as expected." }
  $Top = $tops[0].FullName
  if (-not ((Test-Path -LiteralPath (Join-Path $Top 'Winterland.exe')) -and
      (Test-Path -LiteralPath (Join-Path $Top 'resources\app.asar')))) {
    Stop-Update "the download isn't laid out as expected."
  }

  # Swap only the files the new version ships; anything else in the folder stays. Ctrl+C can't cut it in half, and if
  # the swap is cut off anyway (power loss) the old files stay in .winterland-update-new\old for the next run.
  $KeepStage = $true
  try { [Console]::TreatControlCAsInput = $true } catch { }
  New-Item -ItemType Directory -Path $Old | Out-Null
  $moved = New-Object System.Collections.Generic.List[string]
  $placed = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($item in Get-ChildItem -LiteralPath $Top -Force) {
      $dest = Join-Path $Install $item.Name
      if (Test-Path -LiteralPath $dest) {
        Move-Item -LiteralPath $dest -Destination (Join-Path $Old $item.Name)
        $moved.Add($item.Name)
      }
      Move-Item -LiteralPath $item.FullName -Destination $dest
      $placed.Add($item.Name)
    }
  } catch {
    foreach ($name in $placed) { Remove-Item -LiteralPath (Join-Path $Install $name) -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($name in $moved) { Move-Item -LiteralPath (Join-Path $Old $name) -Destination (Join-Path $Install $name) }
    $KeepStage = $false
    Stop-Update "couldn't replace every file, so the old version was put back. Is the game closed?"
  }
  $KeepStage = $false
  try { [Console]::TreatControlCAsInput = $false } catch { }

  Say ''
  Say "Done! Winterland is now $Latest. Your save was not touched." 'Green'
  if (-not $NoLaunch) {
    Say 'Starting the game...'
    Start-Process -FilePath $Exe -WorkingDirectory $Install
  }
  Pause-End
  exit 0
} finally {
  if (-not $KeepStage) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  if ($HaveLock) { Remove-Item -LiteralPath $Lock -Recurse -Force -ErrorAction SilentlyContinue }
}
