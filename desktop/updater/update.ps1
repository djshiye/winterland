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
#
# In-game updates (0.9.8, desktop/updater.cjs): when the player picks "Update now", the game downloads and checks the
# zip itself, then runs a copy of this script (hidden) with:
#   -FromGame      no questions; waits (up to 10 minutes) for the game to close; if anything goes wrong it starts the
#                  old game again with --update-failed=<reason>, so the player just keeps playing. That restart also
#                  waits for the old game to be gone first: started any sooner, the new copy would hand over to the
#                  closing one and quit (one copy at a time), leaving the player with no game.
#   -Zip PATH      use this already-downloaded zip instead of downloading it. It is still checked against the
#                  SHA256SUMS.txt this script fetches itself, so the game's word is never taken for it.
#   -Install DIR   the Winterland folder to update, instead of the folder above this script.

param([switch]$Yes, [switch]$NoLaunch, [switch]$NoPause, [switch]$FromGame, [string]$Zip = '', [string]$Install = '')

if ($FromGame) { $Yes = $true; $NoPause = $true }
# What the step that can fail is doing (the reason an in-game update reports back): see Stop-Update.
$script:Step = 'other'
# In-game updates: how long, in half seconds, the script waits in all for the game to finish closing (10 minutes).
$script:CloseWait = 1200
# $false when a failed in-game update must not restart the game (another update is running and will start it).
$script:Relaunch = $true

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
function Start-Game([string[]]$GameArgs = @()) {
  if ($script:Exe -and (Test-Path -LiteralPath $script:Exe)) {
    if ($GameArgs.Count -gt 0) { Start-Process -FilePath $script:Exe -WorkingDirectory $script:Install -ArgumentList $GameArgs }
    else { Start-Process -FilePath $script:Exe -WorkingDirectory $script:Install }
  }
}
# True while this copy of the game is open.
function Test-GameRunning {
  if (-not $script:Exe) { return $false }
  return [bool](Get-Process -Name 'Winterland' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $script:Exe })
}
# True once the game has closed; false if it is still open when the in-game wait ($script:CloseWait, shared) runs out.
function Wait-GameClosed {
  while (Test-GameRunning) {
    if ($script:CloseWait -le 0) { return $false }
    Start-Sleep -Milliseconds 500
    $script:CloseWait--
  }
  return $true
}
function Stop-Update([string]$Why) {
  Say ''
  Say "Update stopped: $Why" 'Red'
  Say 'Your game and your save are exactly as they were.'
  # Start the old game again once it has finished closing. If it never closes, it is still open: nothing to start.
  if ($FromGame -and $script:Relaunch) {
    try { if (Wait-GameClosed) { Start-Game @("--update-failed=$($script:Step)") } } catch { }
  }
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

if ($Install) {
  if (-not (Test-Path -LiteralPath $Install -PathType Container)) { Stop-Update "couldn't find the game folder $Install." }
  $Install = (Resolve-Path -LiteralPath $Install).ProviderPath
} else { $Install = Split-Path -Parent $PSScriptRoot }
$Exe = Join-Path $Install 'Winterland.exe'
$Stage = Join-Path $Install '.winterland-update-new'
$Old = Join-Path $Stage 'old'

$Done = Join-Path $Install '.winterland-update-done'

# Put back an update that was cut off mid-swap (power cut, killed script): the layout of .winterland-update-new is
# shared with update.sh and desktop/swap-recover.cjs, which explains it. swap.txt lists each name the new version
# ships, "1 <name>" when the folder had it before and "0 <name>" when not; every old copy comes back and every
# name only the new version has goes. $true when the folder is whole again (the leftovers are then removed).
function Restore-Swap([switch]$Mine) {
  if (-not $Mine) {
    $lockPid = Get-Content -LiteralPath (Join-Path $Install '.winterland-update-lock\pid') -ErrorAction SilentlyContinue
    if ($lockPid -and (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)) { return $true } # another updater is at work
  }
  if (Test-Path -LiteralPath $Done) { Remove-Item -LiteralPath $Done -Recurse -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path -LiteralPath $Stage)) { return $true }
  $journal = Join-Path $Stage 'swap.txt'
  $bad = $false
  if (Test-Path -LiteralPath $journal) {
    foreach ($line in @(Get-Content -LiteralPath $journal)) {
      if (-not $line) { continue }
      $m = [regex]::Match($line, '^([01]) (.+)$')
      if (-not $m.Success) { return $false }
      $had = $m.Groups[1].Value
      $name = $m.Groups[2].Value
      if ($name -eq '.' -or $name -eq '..' -or $name -match '[\\/]') { return $false }
      $live = Join-Path $Install $name
      $kept = Join-Path $Old $name
      try {
        if ($had -eq '1') {
          if (Test-Path -LiteralPath $kept) {
            if (Test-Path -LiteralPath $live) { Remove-Item -LiteralPath $live -Recurse -Force }
            Move-Item -LiteralPath $kept -Destination $live
          }
        } elseif (Test-Path -LiteralPath $live) {
          Remove-Item -LiteralPath $live -Recurse -Force
        }
      } catch { $bad = $true }
    }
    if ($bad) { return $false }
  } elseif (Test-Path -LiteralPath $Old) {
    # Left by a 0.9.8 / 0.9.9 updater (no swap.txt): put back each old file that has no replacement.
    foreach ($item in @(Get-ChildItem -LiteralPath $Old -Force)) {
      $dest = Join-Path $Install $item.Name
      if (-not (Test-Path -LiteralPath $dest)) {
        try { Move-Item -LiteralPath $item.FullName -Destination $dest } catch { $bad = $true }
      }
    }
    if ($bad -or @(Get-ChildItem -LiteralPath $Old -Force).Count -gt 0) { return $false }
  }
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
  return $true
}

if (-not (Restore-Swap)) {
  Stop-Update "an earlier update was cut off and its files couldn't all be put back. They are kept in $Old."
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
  $script:Step = 'offline'
  $Sums = Join-Path $Tmp 'SHA256SUMS.txt'
  try { Get-Https "https://github.com/$Repo/releases/latest/download/SHA256SUMS.txt" $Sums }
  catch { Stop-Update "couldn't reach GitHub. Check your internet connection and try again." }

  $script:Step = 'nodownload'
  # Exactly one line for this platform, in the strict "<64 hex>  Winterland-X.Y.Z-<target>.zip" form.
  $pattern = '^([0-9a-f]{64})  (Winterland-(\d+\.\d+\.\d+)-' + [regex]::Escape($Target) + '\.zip)$'
  $lines = @(Get-Content -LiteralPath $Sums | Where-Object { $_ -cmatch $pattern })
  if ($lines.Count -ne 1) { Stop-Update "the latest release has no download for this computer ($Target)." }
  [void]($lines[0] -cmatch $pattern)
  $WantSha = $Matches[1]
  $ZipName = $Matches[2]
  $Latest = $Matches[3]

  if ([version]$Latest -le [version]$Current) {
    $script:Step = 'current'
    if ($FromGame) { Stop-Update "this copy is already the newest ($Current)." }
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
  $script:Step = 'running'
  if (Test-Path -LiteralPath $Lock) {
    $other = Get-Content -LiteralPath (Join-Path $Lock 'pid') -ErrorAction SilentlyContinue
    if (-not ($other -and (Get-Process -Id $other -ErrorAction SilentlyContinue))) {
      Remove-Item -LiteralPath $Lock -Recurse -Force # left behind by an updater that was killed
    }
  }
  try { New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null; $HaveLock = $true }
  catch { $script:Relaunch = $false; Stop-Update "another update is already running (or $Install isn't writable)." }
  Set-Content -LiteralPath (Join-Path $Lock 'pid') -Value $PID

  if ($FromGame) {
    # The game is closing itself; a slow close (a big save, a busy disk) just means a longer wait.
    if (-not (Wait-GameClosed)) { Stop-Update "Winterland didn't close in time, so nothing was changed." }
  } else {
    while (Test-GameRunning) {
      if ($NoPause) { Stop-Update 'close Winterland first, then run the updater again.' }
      [void](Read-Host "`nWinterland is still open. Close the game (your progress saves), then press Enter")
    }
  }

  Say ''
  $script:Step = 'offline'
  $Given = $Zip
  $Zip = Join-Path $Tmp $ZipName
  if ($Given) {
    # The game's download: copied in first, so the file that is checked is the file that is unpacked.
    if ((Split-Path -Leaf $Given) -cne $ZipName) { $script:Step = 'checksum'; Stop-Update 'the game downloaded a different version than the latest release.' }
    try { Copy-Item -LiteralPath $Given -Destination $Zip } catch { Stop-Update "couldn't read the downloaded update." }
  } else {
    Say "Downloading $ZipName..."
    try { Get-Https "https://github.com/$Repo/releases/download/v$Latest/$ZipName" $Zip }
    catch { Stop-Update "the download didn't finish. Check your internet connection and try again." }
  }

  $script:Step = 'checksum'
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
  $script:Step = 'files'
  if (-not (Restore-Swap -Mine)) {
    $KeepStage = $true
    Stop-Update "an earlier update's files couldn't all be put back. They are kept in $Old."
  }
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
  # 0.9.10: swap.txt first lists every name the new version ships (and whether the folder had it), so a swap cut off
  # half way can be put back exactly (Restore-Swap, here or when the game starts).
  $KeepStage = $true
  try { [Console]::TreatControlCAsInput = $true } catch { }
  New-Item -ItemType Directory -Path $Old | Out-Null
  $items = @(Get-ChildItem -LiteralPath $Top -Force)
  $entries = foreach ($item in $items) { if (Test-Path -LiteralPath (Join-Path $Install $item.Name)) { "1 $($item.Name)" } else { "0 $($item.Name)" } }
  $journalTmp = Join-Path $Stage 'swap.tmp'
  [IO.File]::WriteAllLines($journalTmp, [string[]]@($entries))
  Move-Item -LiteralPath $journalTmp -Destination (Join-Path $Stage 'swap.txt')
  try {
    foreach ($item in $items) {
      $dest = Join-Path $Install $item.Name
      if (Test-Path -LiteralPath $dest) { Move-Item -LiteralPath $dest -Destination (Join-Path $Old $item.Name) }
      Move-Item -LiteralPath $item.FullName -Destination $dest
    }
  } catch {
    if (Restore-Swap -Mine) {
      $KeepStage = $false
      Stop-Update "couldn't replace every file, so the old version was put back. Is the game closed?"
    }
    # Never delete the old files while any of them is still set aside: the next run puts them back.
    $script:Relaunch = $false
    Stop-Update "couldn't replace every file, and some old files are still in $Old. Run Update Winterland again to put them back."
  }
  # Done: the leftovers leave in one rename (so a cut here can't look like a half-finished swap), then go.
  try { Move-Item -LiteralPath $Stage -Destination $Done; $Stage = $Done } catch { }
  $KeepStage = $false
  try { [Console]::TreatControlCAsInput = $false } catch { }

  Say ''
  Say "Done! Winterland is now $Latest. Your save was not touched." 'Green'
  if (-not $NoLaunch) {
    Say 'Starting the game...'
    Start-Game
  }
  Pause-End
  exit 0
} finally {
  if (-not $KeepStage) { Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  if ($HaveLock) { Remove-Item -LiteralPath $Lock -Recurse -Force -ErrorAction SilentlyContinue }
}
