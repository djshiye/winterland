#!/bin/bash
# Winterland updater for Linux and macOS. It ships in every release zip as "Update Winterland.sh" (Linux) or
# "Update Winterland.command" (macOS, double-click to run in Terminal); scripts/updater-files.mjs fills in the
# version and platform below when the zip is built.
#
# What it does, and nothing else:
#   1. Reads SHA256SUMS.txt from the latest GitHub release of djshiye/winterland (HTTPS only, redirects too).
#   2. If that release is newer than this copy, downloads the zip for this platform from that exact release tag.
#   3. Checks the zip's SHA-256 against SHA256SUMS.txt. On any mismatch it stops and changes nothing.
#   4. Swaps the game files (Linux: the files in this folder that the new zip ships; macOS: Winterland.app),
#      keeping the old ones until the new ones are in place, and puts them back if anything fails. A swap that is cut
#      off anyway (power cut, killed script) is put back the next time this script or the game starts: the layout of
#      .winterland-update-new is shared with desktop/swap-recover.cjs, which explains it.
#   5. Starts the new version.
# It never reads, moves or deletes the save (~/.config/Winterland on Linux, ~/Library/Application Support/Winterland
# on macOS): the save is not in the game folder, so the swap cannot reach it.
#
# Options: --yes (don't ask before updating), --no-launch (don't start the game afterwards),
#          --app PATH (macOS: the Winterland.app to update, instead of looking in the usual places).
#
# In-game updates (0.9.8, desktop/updater.cjs): when the player picks "Update now", the game downloads and checks the
# zip itself, then runs a copy of this script with:
#   --from-game      no terminal, no questions; waits (up to 10 minutes) for the game to close; if anything goes wrong
#                    it starts the old game again with --update-failed=<reason>, so the player just keeps playing.
#                    That restart also waits for the old game to be gone first: started any sooner, the new copy would
#                    hand over to the closing one and quit (one copy at a time), leaving the player with no game.
#   --zip PATH       use this already-downloaded zip instead of downloading it. It is still checked against the
#                    SHA256SUMS.txt this script fetches itself, so the game's word is never taken for it.
#   --install DIR    (Linux) the game folder to update, instead of the folder this script is in.
#   --appimage FILE  (Linux, 0.9.11, with --from-game) the game runs as this AppImage: replace that one file with the
#                    release's AppImage for this computer instead of swapping folder files. The file keeps its name
#                    and place (so a menu entry, e.g. from Gear Lever, keeps working) and is swapped in one rename.
# Plain bash 3.2 (the macOS default) on purpose.

main() {
  set -u
  umask 022
  local REPO='djshiye/winterland'
  local BUILT_VERSION='__WL_VERSION__'
  local TARGET='__WL_TARGET__'
  local ASK=1 LAUNCH=1 APP_ARG='' FROM_GAME=0 ZIP_ARG='' INSTALL_ARG='' APPIMAGE_ARG=''
  # What the step that can fail is doing (the reason an in-game update reports back): see `fail`.
  local STEP=other
  # In-game updates: how long, in half seconds, the script waits in all for the game to finish closing (10 minutes).
  local CLOSE_WAIT=1200
  # 0 when a failed in-game update must not restart the game (another update is running and will start it).
  local RELAUNCH=1

  while [ $# -gt 0 ]; do
    case "$1" in
      --yes) ASK=0 ;;
      --no-launch) LAUNCH=0 ;;
      --app) shift; APP_ARG="${1:-}" ;;
      --from-game) FROM_GAME=1; ASK=0 ;;
      --zip) shift; ZIP_ARG="${1:-}" ;;
      --install) shift; INSTALL_ARG="${1:-}" ;;
      --appimage) shift; APPIMAGE_ARG="${1:-}" ;;
      *) ;;
    esac
    shift
  done

  local OS
  OS="$(uname -s)"

  # Double-clicked in a Linux file manager there is no terminal to show progress in, so open one.
  if [ "$OS" = Linux ] && [ "$FROM_GAME" = 0 ] && [ ! -t 1 ] && [ -z "${WL_UPDATER_IN_TERMINAL:-}" ] &&
    { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
    export WL_UPDATER_IN_TERMINAL=1
    local self term
    self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    for term in x-terminal-emulator gnome-terminal konsole xfce4-terminal mate-terminal lxterminal kitty alacritty xterm; do
      command -v "$term" >/dev/null 2>&1 || continue
      case "$term" in
        gnome-terminal) exec gnome-terminal -- /bin/bash "$self" "$@" ;;
        *) exec "$term" -e /bin/bash "$self" "$@" ;;
      esac
    done
  fi

  local B='' G='' R='' Y='' N=''
  if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; N=$'\033[0m'; fi
  say() { printf '%s\n' "$*"; }
  pause() { if [ "$FROM_GAME" = 0 ] && [ -t 0 ] && [ -t 1 ]; then printf '\nPress Enter to close this window. '; read -r _ || true; fi; }
  # Start the game (the new one after an update; the old one again when an in-game update stopped, with the reason).
  start_game() {
    if [ "$OS" = Darwin ]; then
      [ -n "${APP:-}" ] && open "$APP" --args "$@"
    elif [ -n "${IMAGE:-}" ]; then
      [ -x "$IMAGE" ] && (cd "${HOME:-/}" 2>/dev/null || true; nohup "$IMAGE" "$@" >/dev/null 2>&1 &)
    elif [ -n "${INSTALL:-}" ] && [ -x "$INSTALL/winterland" ]; then
      (cd "$INSTALL" && nohup ./winterland "$@" >/dev/null 2>&1 &)
    fi
  }
  # True while this copy of the game is open (Linux: any process running this folder's 'winterland'; an AppImage:
  # any process running that file, which is the AppImage's own starter and lives until the game has closed).
  running() {
    if [ "$OS" = Darwin ]; then
      [ -n "${APP:-}" ] && pgrep -f "$APP/Contents/MacOS/Winterland" >/dev/null 2>&1
    elif [ -n "${IMAGE:-}" ]; then
      local proc
      for proc in /proc/[0-9]*; do
        [ "$(readlink "$proc/exe" 2>/dev/null)" = "$IMAGE" ] && return 0
      done
      return 1
    else
      [ -n "${INSTALL:-}" ] || return 1
      local pid
      for pid in $(pgrep -x winterland 2>/dev/null); do
        [ "$(readlink "/proc/$pid/exe" 2>/dev/null)" = "$INSTALL/winterland" ] && return 0
      done
      return 1
    fi
  }
  # True once the game has closed; false if it is still open when the in-game wait (CLOSE_WAIT, shared) runs out.
  wait_closed() {
    while running; do
      [ "$CLOSE_WAIT" -gt 0 ] || return 1
      sleep 0.5
      CLOSE_WAIT=$((CLOSE_WAIT - 1))
    done
    return 0
  }
  # Put back an update that was cut off mid-swap in folder $1 (the same steps as desktop/swap-recover.cjs, which the
  # game runs at start). $2 = 1 when this run holds the lock itself. True when the folder is whole again.
  recover_swap() {
    local dir="$1" mine="${2:-0}" stage="$1/.winterland-update-new" pid line had name bad=0
    if [ "$mine" != 1 ]; then
      pid="$(cat "$dir/.winterland-update-lock/pid" 2>/dev/null || true)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 0; fi # another updater is at work: its business
    fi
    if [ -d "$dir/.winterland-update-done" ]; then rm -rf "$dir/.winterland-update-done"; fi
    [ -d "$stage" ] || return 0
    if [ -f "$stage/swap.txt" ]; then
      while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] || continue
        had="${line%% *}"
        name="${line#* }"
        case "$name" in '' | . | .. | */*) return 1 ;; esac
        if [ "$had" = 1 ]; then
          if [ -e "$stage/old/$name" ] || [ -L "$stage/old/$name" ]; then
            if [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; then rm -rf "${dir:?}/$name" || { bad=1; continue; }; fi
            mv "$stage/old/$name" "$dir/$name" || bad=1
          fi
        elif [ "$had" = 0 ]; then
          if [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; then rm -rf "${dir:?}/$name" || bad=1; fi
        else
          return 1
        fi
      done <"$stage/swap.txt"
      [ "$bad" = 0 ] || return 1
      rm -rf "$stage"
      return 0
    fi
    # Left by a 0.9.8 / 0.9.9 updater (no swap.txt): put back each old file that has no replacement.
    if [ -d "$stage/old" ]; then
      while IFS= read -r name; do
        if [ -n "$name" ] && [ ! -e "$dir/$name" ] && [ ! -L "$dir/$name" ]; then mv "$stage/old/$name" "$dir/$name" || bad=1; fi
      done <<EOF
$(ls -A "$stage/old")
EOF
      [ -z "$(ls -A "$stage/old")" ] || return 1
    fi
    rm -rf "$stage"
    return "$bad"
  }
  # macOS: the old Winterland.app, moved aside by a swap that was cut off, comes back if no app took its place.
  recover_app() {
    local app="$1" dir stage pid
    dir="$(dirname "$app")"
    stage="$dir/.winterland-update-new"
    pid="$(cat "$dir/.winterland-update-lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 0; fi
    if [ -d "$dir/.winterland-update-done" ]; then rm -rf "$dir/.winterland-update-done"; fi
    if [ -d "$stage/old.app" ] && [ ! -e "$app" ]; then mv "$stage/old.app" "$app" && rm -rf "$stage"; fi
    return 0
  }
  fail() {
    say ""
    say "${R}${B}Update stopped:${N} $*"
    say "Your game and your save are exactly as they were."
    # Start the old game again once it has finished closing. If it never closes, it is still open: nothing to start.
    if [ "$FROM_GAME" = 1 ] && [ "$RELAUNCH" = 1 ]; then
      wait_closed && start_game "--update-failed=$STEP"
    fi
    pause
    exit 1
  }

  say ""
  say "${B}  Winterland updater${N}"
  say ""

  if [ "$(id -u)" = 0 ] && [ -z "${WL_UPDATER_ALLOW_ROOT:-}" ]; then # (the escape hatch is for tests in root containers)
    fail "please run the updater as yourself, not as root or with sudo."
  fi

  # Where the game lives, and which version it is.
  local SCRIPT_DIR CURRENT="$BUILT_VERSION" INSTALL='' APP='' IMAGE=''
  [ "$OS" = Darwin ] || [ -z "$INSTALL_ARG" ] || [ -d "$INSTALL_ARG" ] || fail "couldn't find the game folder $INSTALL_ARG."
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" || fail "couldn't find the folder this updater is in."
  if [ "$OS" = Darwin ]; then
    local candidate
    for candidate in "$APP_ARG" "/Applications/Winterland.app" "$HOME/Applications/Winterland.app" "$SCRIPT_DIR/Winterland.app"; do
      if [ -n "$candidate" ] && [ -d "$(dirname "$candidate")" ]; then recover_app "$candidate"; fi
    done
    for candidate in "$APP_ARG" "/Applications/Winterland.app" "$HOME/Applications/Winterland.app" "$SCRIPT_DIR/Winterland.app"; do
      if [ -n "$candidate" ] && [ -x "$candidate/Contents/MacOS/Winterland" ]; then APP="$candidate"; break; fi
    done
    [ -n "$APP" ] || fail "couldn't find Winterland.app in Applications or next to this updater."
    case "$APP" in /*) ;; *) APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")" ;; esac
    local plist_version
    plist_version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist" 2>/dev/null || true)"
    if printf '%s' "$plist_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then CURRENT="$plist_version"; fi
    INSTALL="$(dirname "$APP")"
  elif [ -n "$APPIMAGE_ARG" ]; then
    # Only the in-game updater hands over an AppImage, already resolved to the real file. It must be a plain file the
    # player owns that starts like an AppImage (an ELF program marked "AI" 2), so nothing else is ever replaced.
    [ "$OS" = Linux ] && [ "$FROM_GAME" = 1 ] || fail "--appimage is only for in-game updates on Linux."
    case "$APPIMAGE_ARG" in /*) ;; *) fail "the AppImage path must be absolute." ;; esac
    if [ -L "$APPIMAGE_ARG" ] || [ ! -f "$APPIMAGE_ARG" ] || [ ! -O "$APPIMAGE_ARG" ]; then
      fail "couldn't find the Winterland AppImage $APPIMAGE_ARG."
    fi
    local head
    head="$(LC_ALL=C od -An -tx1 -N11 "$APPIMAGE_ARG" 2>/dev/null | tr -d ' \n')"
    case "$head" in 7f454c46????????414902) ;; *) fail "$APPIMAGE_ARG isn't a Winterland AppImage." ;; esac
    IMAGE="$APPIMAGE_ARG"
    INSTALL="$(cd "$(dirname "$IMAGE")" && pwd)" || fail "couldn't find the folder of $IMAGE."
  else
    INSTALL="$SCRIPT_DIR"
    [ -n "$INSTALL_ARG" ] && INSTALL="$(cd "$INSTALL_ARG" && pwd)"
    # A previous update that was cut off mid-swap (power cut, killed script): put the old version back first.
    recover_swap "$INSTALL" ||
      fail "an earlier update was cut off and its files couldn't all be put back. They are kept in $INSTALL/.winterland-update-new/old."
    if ! { [ -x "$INSTALL/winterland" ] && [ -f "$INSTALL/resources/app.asar" ]; }; then
      fail "run this from your unzipped Winterland folder (the one with the 'winterland' program in it)."
    fi
  fi

  printf '%s' "$CURRENT" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || CURRENT='0.0.0'
  say "You have Winterland ${B}$CURRENT${N}. Looking for a newer version on GitHub..."

  local TMP
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/winterland-update.XXXXXX")" || fail "couldn't make a temporary folder."
  # Only ever delete what this run created.
  local STAGE='' LOCK=''
  # shellcheck disable=SC2329 # run by the EXIT trap
  cleanup() {
    [ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf "$TMP"
    [ -n "$STAGE" ] && [ -e "$STAGE" ] && rm -rf "$STAGE"
    [ -n "$LOCK" ] && rm -f "$LOCK/pid" && rmdir "$LOCK" 2>/dev/null
    return 0
  }
  trap cleanup EXIT
  trap 'exit 130' INT TERM HUP

  # HTTPS only, including every redirect; TLS 1.2 or newer.
  fetch() {
    if command -v curl >/dev/null 2>&1; then
      curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
        --connect-timeout 20 --retry 2 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
      wget --quiet --https-only --secure-protocol=TLSv1_2 --timeout=20 --tries=3 -O "$2" "$1"
    else
      say "Neither curl nor wget is installed."
      return 1
    fi
  }

  STEP=offline
  fetch "https://github.com/$REPO/releases/latest/download/SHA256SUMS.txt" "$TMP/SHA256SUMS.txt" ||
    fail "couldn't reach GitHub. Check your internet connection and try again."

  # Exactly one line for this platform, in the strict "<64 hex>  Winterland-X.Y.Z-<target>.zip" form (an AppImage:
  # "<64 hex>  Winterland-X.Y.Z-<x86_64|aarch64>.AppImage").
  STEP=nodownload
  local line count suffix="$TARGET.zip"
  if [ -n "$IMAGE" ]; then
    case "$TARGET" in
      linux-x64) suffix='x86_64.AppImage' ;;
      linux-arm64) suffix='aarch64.AppImage' ;;
      *) fail "the latest release has no AppImage for this computer ($TARGET)." ;;
    esac
  fi
  local pattern="^[0-9a-f]{64}  Winterland-[0-9]+\.[0-9]+\.[0-9]+-${suffix//./\\.}\$"
  count="$(grep -Ec "$pattern" "$TMP/SHA256SUMS.txt")"
  [ "$count" = 1 ] || fail "the latest release has no download for this computer ($suffix)."
  line="$(grep -E "$pattern" "$TMP/SHA256SUMS.txt")"
  local WANT_SHA="${line%%  *}"
  local ZIP_NAME="${line#*  }"
  local LATEST="${ZIP_NAME#Winterland-}"
  LATEST="${LATEST%-"$suffix"}"

  newer() { # newer A B: true when version A > version B
    local a b i
    IFS=. read -r -a a <<<"$1"
    IFS=. read -r -a b <<<"$2"
    for i in 0 1 2; do
      if [ "${a[$i]}" -gt "${b[$i]}" ]; then return 0; fi
      if [ "${a[$i]}" -lt "${b[$i]}" ]; then return 1; fi
    done
    return 1
  }

  if ! newer "$LATEST" "$CURRENT"; then
    STEP=current
    [ "$FROM_GAME" = 1 ] && fail "this copy is already the newest ($CURRENT)."
    say ""
    say "${G}${B}You already have the newest Winterland ($CURRENT).${N} Nothing to do."
    pause
    exit 0
  fi

  say ""
  say "${B}Winterland $LATEST is out!${N}"
  if [ "$OS" = Darwin ]; then say "It will replace $APP."; elif [ -n "$IMAGE" ]; then say "It will replace $IMAGE."; else say "It will replace the game files in $INSTALL."; fi
  say "Your save stays where it is and is not touched."
  if [ "$ASK" = 1 ] && [ -t 0 ]; then
    printf '\nPress Enter to update, or close this window to keep %s. ' "$CURRENT"
    read -r _ || fail "cancelled."
  fi

  # One updater at a time, and never while the game is running.
  STEP=running
  LOCK="$INSTALL/.winterland-update-lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    local other
    other="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -d "$LOCK" ] && ! { [ -n "$other" ] && kill -0 "$other" 2>/dev/null; }; then
      rm -rf "$LOCK" # left behind by an updater that was killed
    fi
    mkdir "$LOCK" 2>/dev/null || { LOCK=''; RELAUNCH=0; fail "another update is already running (or $INSTALL isn't writable)."; }
  fi
  echo $$ >"$LOCK/pid"
  if [ "$FROM_GAME" = 1 ]; then
    # The game is closing itself; a slow close (a big save, a busy disk) just means a longer wait.
    wait_closed || fail "Winterland didn't close in time, so nothing was changed."
  else
    while running; do
      if [ -t 0 ]; then
        printf '\n%sWinterland is still open.%s Close the game (your progress saves), then press Enter. ' "$Y" "$N"
        read -r _ || fail "cancelled."
      else
        fail "close Winterland first, then run the updater again."
      fi
    done
  fi

  say ""
  STEP=offline
  if [ -n "$ZIP_ARG" ]; then
    # The game's download: copied in first, so the file that is checked is the file that is unpacked.
    [ "$(basename "$ZIP_ARG")" = "$ZIP_NAME" ] || { STEP=checksum; fail "the game downloaded a different version than the latest release."; }
    cp "$ZIP_ARG" "$TMP/$ZIP_NAME" || fail "couldn't read the downloaded update."
  else
    say "Downloading $ZIP_NAME..."
    fetch "https://github.com/$REPO/releases/download/v$LATEST/$ZIP_NAME" "$TMP/$ZIP_NAME" ||
      fail "the download didn't finish. Check your internet connection and try again."
  fi

  STEP=checksum
  printf 'Checking the download is genuine (SHA-256)... '
  local GOT_SHA
  if command -v sha256sum >/dev/null 2>&1; then
    GOT_SHA="$(sha256sum "$TMP/$ZIP_NAME" | cut -d' ' -f1)"
  else
    GOT_SHA="$(shasum -a 256 "$TMP/$ZIP_NAME" | cut -d' ' -f1)"
  fi
  if [ "$GOT_SHA" != "$WANT_SHA" ]; then
    say "${R}no match${N}"
    fail "the downloaded file doesn't match the release's checksum, so it was thrown away."
  fi
  say "${G}OK${N}"

  if [ -n "$IMAGE" ]; then
    # An AppImage is one file: copy the checked download next to it (same disk), check the copy, then rename it over
    # the old one. A rename is all or nothing, so the old AppImage stays whole until the new one is in its place.
    say "Installing..."
    STEP=files
    STAGE="$(mktemp "$INSTALL/.winterland-appimage-XXXXXX")" || fail "couldn't write to $INSTALL."
    cp "$TMP/$ZIP_NAME" "$STAGE" || fail "couldn't write to $INSTALL."
    chmod --reference="$IMAGE" "$STAGE" 2>/dev/null || true
    chmod u+rwx,go-w "$STAGE" || fail "couldn't write to $INSTALL."
    STEP=checksum
    [ "$(sha256sum "$STAGE" | cut -d' ' -f1)" = "$WANT_SHA" ] || fail "the copied update didn't match the release's checksum."
    STEP=files
    mv -f "$STAGE" "$IMAGE" || fail "couldn't replace $IMAGE. Is the game closed?"
    STAGE=''
    say ""
    say "${G}${B}Done! Winterland is now $LATEST.${N} Your save was not touched."
    if [ "$LAUNCH" = 1 ]; then
      say "Starting the game..."
      start_game
    fi
    exit 0
  fi

  # Unpack next to the game (same disk, so the swap is a quick rename) and check it looks like Winterland.
  say "Installing..."
  STEP=files
  STAGE="$INSTALL/.winterland-update-new"
  if [ "$OS" != Darwin ] && ! recover_swap "$INSTALL" 1; then
    STAGE=''
    fail "an earlier update's files couldn't all be put back. They are kept in $INSTALL/.winterland-update-new/old."
  fi
  rm -rf "$STAGE" # anything left in it was put back above (macOS: the new app is in place)
  mkdir "$STAGE" || fail "couldn't write to $INSTALL."
  if [ "$OS" = Darwin ]; then
    /usr/bin/ditto -x -k "$TMP/$ZIP_NAME" "$STAGE/unpacked" || fail "couldn't unpack the download."
  elif command -v unzip >/dev/null 2>&1; then
    unzip -q "$TMP/$ZIP_NAME" -d "$STAGE/unpacked" || fail "couldn't unpack the download."
  elif command -v bsdtar >/dev/null 2>&1; then
    if ! { mkdir "$STAGE/unpacked" && bsdtar -xf "$TMP/$ZIP_NAME" -C "$STAGE/unpacked"; }; then
      fail "couldn't unpack the download."
    fi
  else
    STEP=unzip
    fail "please install 'unzip' (for example: sudo apt install unzip) and run the updater again."
  fi
  local tops top
  tops="$(ls -A "$STAGE/unpacked")"
  [ "$(printf '%s\n' "$tops" | wc -l | tr -d ' ')" = 1 ] || fail "the download isn't laid out as expected."
  top="$STAGE/unpacked/$tops"

  # From here until the files are swapped, closing the window or Ctrl+C can't cut the swap in half.
  trap '' INT TERM HUP
  if [ "$OS" = Darwin ]; then
    [ -x "$top/Winterland.app/Contents/MacOS/Winterland" ] || fail "the download isn't laid out as expected."
    mv "$APP" "$STAGE/old.app" || fail "couldn't move the old Winterland.app aside. Is the game closed?"
    if ! mv "$top/Winterland.app" "$APP"; then
      if mv "$STAGE/old.app" "$APP"; then fail "couldn't put the new Winterland.app in place, so the old one was put back."; fi
      # never delete the old app while it is still set aside: the next run puts it back (recover_app)
      STAGE=''
      RELAUNCH=0
      fail "couldn't put Winterland.app back. It is kept in $INSTALL/.winterland-update-new/old.app. Run Update Winterland again to put it back."
    fi
    # Keep this updater current too (a rename, so this running copy is unaffected).
    if [ -f "$top/Update Winterland.command" ] && [ "$(basename "$0")" = "Update Winterland.command" ]; then
      mv -f "$top/Update Winterland.command" "$SCRIPT_DIR/Update Winterland.command" 2>/dev/null || true
    fi
  else
    if ! { [ -x "$top/winterland" ] && [ -f "$top/resources/app.asar" ]; }; then
      fail "the download isn't laid out as expected."
    fi
    # Swap only the files the new version ships; anything else in this folder stays. swap.txt lists them first (with
    # whether the folder had each one), so a swap cut off half way can be put back exactly (recover_swap).
    local OLD="$STAGE/old" name ok=1 names
    names="$(ls -A "$top")"
    mkdir "$OLD" || fail "couldn't write to $INSTALL."
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if [ -e "$INSTALL/$name" ] || [ -L "$INSTALL/$name" ]; then echo "1 $name"; else echo "0 $name"; fi
    done >"$STAGE/swap.tmp" <<EOF
$names
EOF
    mv "$STAGE/swap.tmp" "$STAGE/swap.txt" || fail "couldn't write to $INSTALL."
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if [ -e "$INSTALL/$name" ] || [ -L "$INSTALL/$name" ]; then
        mv "$INSTALL/$name" "$OLD/$name" || { ok=0; break; }
      fi
      mv "$top/$name" "$INSTALL/$name" || { ok=0; break; }
    done <<EOF
$names
EOF
    if [ "$ok" != 1 ]; then
      if recover_swap "$INSTALL" 1; then
        STAGE=''
        fail "couldn't replace every file, so the old version was put back. Is the game closed?"
      fi
      # Never delete the old files while any of them is still set aside: the next run (or the game) puts them back.
      STAGE=''
      RELAUNCH=0
      fail "couldn't replace every file, and some old files are still in $INSTALL/.winterland-update-new/old. Run Update Winterland again to put them back."
    fi
  fi

  # Done: the leftovers leave in one rename (so a cut here can't look like a half-finished swap), then go.
  if mv "$STAGE" "$INSTALL/.winterland-update-done" 2>/dev/null; then rm -rf "$INSTALL/.winterland-update-done"; else rm -rf "$STAGE"; fi
  STAGE=''
  trap 'exit 130' INT TERM HUP
  say ""
  say "${G}${B}Done! Winterland is now $LATEST.${N} Your save was not touched."

  if [ "$LAUNCH" = 1 ]; then
    say "Starting the game..."
    start_game
  fi
  pause
  exit 0
}

main "$@"
# shellcheck disable=SC2317 # main always exits; this is a safety net
exit $?
