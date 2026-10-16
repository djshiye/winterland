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
#      keeping the old ones until the new ones are in place, and puts them back if anything fails.
#   5. Starts the new version.
# It never reads, moves or deletes the save (~/.config/Winterland on Linux, ~/Library/Application Support/Winterland
# on macOS): the save is not in the game folder, so the swap cannot reach it.
#
# Options: --yes (don't ask before updating), --no-launch (don't start the game afterwards),
#          --app PATH (macOS: the Winterland.app to update, instead of looking in the usual places).
# Plain bash 3.2 (the macOS default) on purpose.

main() {
  set -u
  umask 022
  local REPO='djshiye/winterland'
  local BUILT_VERSION='__WL_VERSION__'
  local TARGET='__WL_TARGET__'
  local ASK=1 LAUNCH=1 APP_ARG=''

  while [ $# -gt 0 ]; do
    case "$1" in
      --yes) ASK=0 ;;
      --no-launch) LAUNCH=0 ;;
      --app) shift; APP_ARG="${1:-}" ;;
      *) ;;
    esac
    shift
  done

  local OS
  OS="$(uname -s)"

  # Double-clicked in a Linux file manager there is no terminal to show progress in, so open one.
  if [ "$OS" = Linux ] && [ ! -t 1 ] && [ -z "${WL_UPDATER_IN_TERMINAL:-}" ] &&
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
  pause() { if [ -t 0 ] && [ -t 1 ]; then printf '\nPress Enter to close this window. '; read -r _ || true; fi; }
  fail() {
    say ""
    say "${R}${B}Update stopped:${N} $*"
    say "Your game and your save are exactly as they were."
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
  local SCRIPT_DIR CURRENT="$BUILT_VERSION" INSTALL='' APP=''
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" || fail "couldn't find the folder this updater is in."
  if [ "$OS" = Darwin ]; then
    local candidate
    for candidate in "$APP_ARG" "/Applications/Winterland.app" "$HOME/Applications/Winterland.app" "$SCRIPT_DIR/Winterland.app"; do
      if [ -n "$candidate" ] && [ -x "$candidate/Contents/MacOS/Winterland" ]; then APP="$candidate"; break; fi
    done
    [ -n "$APP" ] || fail "couldn't find Winterland.app in Applications or next to this updater."
    case "$APP" in /*) ;; *) APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")" ;; esac
    local plist_version
    plist_version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist" 2>/dev/null || true)"
    if printf '%s' "$plist_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then CURRENT="$plist_version"; fi
    INSTALL="$(dirname "$APP")"
  else
    INSTALL="$SCRIPT_DIR"
    # A previous update that was cut off mid-swap (power loss): put back any old file that has no replacement yet.
    local leftover="$INSTALL/.winterland-update-new/old" name
    if [ -d "$leftover" ]; then
      while IFS= read -r name; do
        [ -n "$name" ] && [ ! -e "$INSTALL/$name" ] && mv "$leftover/$name" "$INSTALL/$name"
      done <<EOF
$(ls -A "$leftover")
EOF
      [ -z "$(ls -A "$leftover")" ] && rm -rf "$INSTALL/.winterland-update-new"
    fi
    [ -x "$INSTALL/winterland" ] && [ -f "$INSTALL/resources/app.asar" ] ||
      fail "run this from your unzipped Winterland folder (the one with the 'winterland' program in it)."
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
    [ -n "$STAGE" ] && [ -d "$STAGE" ] && rm -rf "$STAGE"
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

  fetch "https://github.com/$REPO/releases/latest/download/SHA256SUMS.txt" "$TMP/SHA256SUMS.txt" ||
    fail "couldn't reach GitHub. Check your internet connection and try again."

  # Exactly one line for this platform, in the strict "<64 hex>  Winterland-X.Y.Z-<target>.zip" form.
  local line count
  count="$(grep -Ec "^[0-9a-f]{64}  Winterland-[0-9]+\.[0-9]+\.[0-9]+-$TARGET\.zip\$" "$TMP/SHA256SUMS.txt")"
  [ "$count" = 1 ] || fail "the latest release has no download for this computer ($TARGET)."
  line="$(grep -E "^[0-9a-f]{64}  Winterland-[0-9]+\.[0-9]+\.[0-9]+-$TARGET\.zip\$" "$TMP/SHA256SUMS.txt")"
  local WANT_SHA="${line%%  *}"
  local ZIP_NAME="${line#*  }"
  local LATEST="${ZIP_NAME#Winterland-}"
  LATEST="${LATEST%-"$TARGET".zip}"

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
    say ""
    say "${G}${B}You already have the newest Winterland ($CURRENT).${N} Nothing to do."
    pause
    exit 0
  fi

  say ""
  say "${B}Winterland $LATEST is out!${N}"
  if [ "$OS" = Darwin ]; then say "It will replace $APP."; else say "It will replace the game files in $INSTALL."; fi
  say "Your save stays where it is and is not touched."
  if [ "$ASK" = 1 ] && [ -t 0 ]; then
    printf '\nPress Enter to update, or close this window to keep %s. ' "$CURRENT"
    read -r _ || fail "cancelled."
  fi

  # One updater at a time, and never while the game is running.
  LOCK="$INSTALL/.winterland-update-lock"
  if ! mkdir "$LOCK" 2>/dev/null; then
    local other
    other="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -d "$LOCK" ] && ! { [ -n "$other" ] && kill -0 "$other" 2>/dev/null; }; then
      rm -rf "$LOCK" # left behind by an updater that was killed
    fi
    mkdir "$LOCK" 2>/dev/null || { LOCK=''; fail "another update is already running (or $INSTALL isn't writable)."; }
  fi
  echo $$ >"$LOCK/pid"
  running() {
    if [ "$OS" = Darwin ]; then
      pgrep -f "$APP/Contents/MacOS/Winterland" >/dev/null 2>&1
    else
      local pid
      for pid in $(pgrep -x winterland 2>/dev/null); do
        [ "$(readlink "/proc/$pid/exe" 2>/dev/null)" = "$INSTALL/winterland" ] && return 0
      done
      return 1
    fi
  }
  while running; do
    if [ -t 0 ]; then
      printf '\n%sWinterland is still open.%s Close the game (your progress saves), then press Enter. ' "$Y" "$N"
      read -r _ || fail "cancelled."
    else
      fail "close Winterland first, then run the updater again."
    fi
  done

  say ""
  say "Downloading $ZIP_NAME..."
  fetch "https://github.com/$REPO/releases/download/v$LATEST/$ZIP_NAME" "$TMP/$ZIP_NAME" ||
    fail "the download didn't finish. Check your internet connection and try again."

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

  # Unpack next to the game (same disk, so the swap is a quick rename) and check it looks like Winterland.
  say "Installing..."
  STAGE="$INSTALL/.winterland-update-new"
  rm -rf "$STAGE" # anything left in it was put back above
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
      mv "$STAGE/old.app" "$APP"
      fail "couldn't put the new Winterland.app in place, so the old one was put back."
    fi
    # Keep this updater current too (a rename, so this running copy is unaffected).
    if [ -f "$top/Update Winterland.command" ] && [ "$(basename "$0")" = "Update Winterland.command" ]; then
      mv -f "$top/Update Winterland.command" "$SCRIPT_DIR/Update Winterland.command" 2>/dev/null || true
    fi
  else
    [ -x "$top/winterland" ] && [ -f "$top/resources/app.asar" ] || fail "the download isn't laid out as expected."
    # Swap only the files the new version ships; anything else in this folder stays.
    local OLD="$STAGE/old" moved=() placed=() name ok=1
    mkdir "$OLD" || fail "couldn't write to $INSTALL."
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if [ -e "$INSTALL/$name" ] || [ -L "$INSTALL/$name" ]; then
        if mv "$INSTALL/$name" "$OLD/$name"; then moved+=("$name"); else ok=0; break; fi
      fi
      if mv "$top/$name" "$INSTALL/$name"; then placed+=("$name"); else ok=0; break; fi
    done <<EOF
$(ls -A "$top")
EOF
    if [ "$ok" != 1 ]; then
      for name in ${placed[@]+"${placed[@]}"}; do rm -rf "${INSTALL:?}/$name"; done
      for name in ${moved[@]+"${moved[@]}"}; do mv "$OLD/$name" "$INSTALL/$name"; done
      fail "couldn't replace every file, so the old version was put back. Is the game closed?"
    fi
  fi

  rm -rf "$STAGE"
  STAGE=''
  trap 'exit 130' INT TERM HUP
  say ""
  say "${G}${B}Done! Winterland is now $LATEST.${N} Your save was not touched."

  if [ "$LAUNCH" = 1 ]; then
    say "Starting the game..."
    if [ "$OS" = Darwin ]; then
      open "$APP"
    else
      (cd "$INSTALL" && nohup ./winterland >/dev/null 2>&1 &)
    fi
  fi
  pause
  exit 0
}

main "$@"
# shellcheck disable=SC2317 # main always exits; this is a safety net
exit $?
