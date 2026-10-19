#!/bin/bash
# Winterland on Ubuntu 23.10 / 24.04 and later: lets the game keep Chromium's safety sandbox on.
#
# Those Ubuntu versions stop apps from using "user namespaces", which is how Chromium's sandbox works without root,
# unless an AppArmor profile says the app may. Without one the game stops at once ("The SUID sandbox helper binary was
# found, but is not configured correctly"), and from a double-click that looks like nothing happening.
# This script checks for that case and, only with the player's OK (Ubuntu's own password window, via pkexec), adds a
# small AppArmor profile for exactly one program path that allows that and nothing else: the game is not confined
# further and gets no extra rights. The sandbox stays on; this never starts the game with --no-sandbox.
#
# It ships twice (scripts/package-desktop.mjs, scripts/package-appimage.mjs):
#   - in the Linux zip as "Set up for Ubuntu.sh", for the 'winterland' program in its own folder (profile "winterland");
#   - inside the AppImage, where AppRun runs it with --appimage before every start. An AppImage runs from a temporary
#     mount under /tmp, a path anyone can create, so a profile can't safely point there. Instead, only on a system
#     with the restriction on, the game is copied once (again after each update) into the player's own
#     ${XDG_DATA_HOME:-~/.local/share}/Winterland/app, the profile ("winterland-appimage") names that exact path, and
#     this prints that path for AppRun to start. Elsewhere it prints nothing and the game runs from the AppImage as is.
#
# Options: --appimage (as above), --ask (from AppRun: ask in a window, no terminal; when the player says no, explain
# and fail). Exit status: 0 = the game can start, 1 = it can't (nothing was changed).
# Plain bash; no network. As root it only writes /etc/apparmor.d/winterland or winterland-appimage, built from fixed
# text and the checked path inside the root step itself (nothing the player can still change is read as root).

# The step run as root (pkexec / sudo): $1 profile name, $2 program path, $3 profiles folder, $4 1 = load it.
# Fixed text; the arguments are checked again here. The profile is written to a new file root alone can open (mktemp
# in a root-owned folder), renamed into place, then loaded; if loading fails it is removed again.
# shellcheck disable=SC2016
ROOT_STEP='set -eu
umask 022
case "$1" in winterland|winterland-appimage) ;; *) exit 2 ;; esac
case "$2" in /*) ;; *) exit 2 ;; esac
case "$2" in *[\"\\*?[\]{}^]*|*"
"*) exit 2 ;; esac
dir="$3"; [ -d "$dir" ] && [ ! -L "$dir" ] || exit 2
abi=""; [ -f "$dir/abi/4.0" ] && abi="abi <abi/4.0>,"
tmp="$(mktemp "$dir/.winterland-new.XXXXXX")"
trap '\''rm -f "$tmp"'\'' EXIT
cat >"$tmp" <<EOF
# Added by Winterland (desktop/linux/sandbox-setup.sh): lets the game use Chromium'\''s sandbox on Ubuntu 23.10+.
# It does not confine Winterland or give it any other rights. Remove this file to undo it.
$abi
include <tunables/global>

profile $1 "$2" flags=(unconfined) {
  userns,

  include if exists <local/$1>
}
EOF
chmod 644 "$tmp"
mv -f "$tmp" "$dir/$1"
trap - EXIT
[ "$4" = 1 ] || exit 0
for p in /usr/sbin/apparmor_parser /sbin/apparmor_parser; do
  if [ -x "$p" ]; then "$p" -r "$dir/$1" && exit 0; rm -f "$dir/$1"; exit 1; fi
done
rm -f "$dir/$1"
exit 1'

main() {
  set -u
  local MODE=folder ASK=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --appimage) MODE=appimage ;;
      --ask) ASK=1 ;;
      *) ;;
    esac
    shift
  done

  # (tests point these at a temporary folder; on a real system they are the real paths)
  local ROOT="${WL_SANDBOX_TEST_ROOT:-}"
  local RESTRICT="$ROOT/proc/sys/kernel/apparmor_restrict_unprivileged_userns"
  local PROFILES="$ROOT/etc/apparmor.d"

  # Nothing to do unless Ubuntu's restriction is on (an AppImage then runs from its mount as usual).
  [ "$(cat "$RESTRICT" 2>/dev/null)" = 1 ] || { say_ok; return 0; }

  local NAME GAME HERE NOTE
  HERE="$(cd "$(dirname "$0")" && pwd -P)" || return 1
  if [ "$MODE" = appimage ]; then
    NAME='winterland-appimage'
    local data="${XDG_DATA_HOME:-}"
    case "$data" in /*) ;; *) data="${HOME:?}/.local/share" ;; esac
    local copy="$data/Winterland/app"
    NOTE="$data/Winterland/why-winterland-did-not-start.txt"
    GAME="$copy/winterland"
    check_path "$GAME" || return 1
    if [ "$(cat "$copy/.winterland-build" 2>/dev/null)" != "$(cat "$HERE/.winterland-build" 2>/dev/null)" ]; then
      copy_game "$HERE" "$copy" || { tell "Winterland couldn't copy itself into $copy (is the disk full?), so it can't start on this Ubuntu."; return 1; }
    fi
  else
    NAME='winterland'
    GAME="$HERE/winterland"
    NOTE="$HERE/why-winterland-did-not-start.txt"
    [ -x "$GAME" ] || { tell "Put this file in your unzipped Winterland folder, next to the 'winterland' program, and run it again."; return 1; }
    check_path "$GAME" || return 1
  fi

  if ! profile_ready; then
    local INTRO="Ubuntu blocks apps from using their own safety sandbox unless they are on its list. Winterland can add itself to that list now. Ubuntu will ask for your password once. The sandbox stays on, and Winterland gets no other extra rights."
    if ! confirm "$INTRO"; then
      tell "Winterland can't start until Ubuntu allows its sandbox. Start it again whenever you're ready, or see \"Linux\" in the README on github.com/djshiye/winterland."
      return 1
    fi
    local ok=0
    if [ -n "$ROOT" ]; then
      # tests: the same root step as the player, into the pretend system, without loading
      /bin/sh -c "$ROOT_STEP" winterland-setup "$NAME" "$GAME" "$PROFILES" 0 && ok=1
    elif command -v pkexec >/dev/null 2>&1; then
      pkexec /bin/sh -c "$ROOT_STEP" winterland-setup "$NAME" "$GAME" /etc/apparmor.d 1 && ok=1
    elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
      sudo /bin/sh -c "$ROOT_STEP" winterland-setup "$NAME" "$GAME" /etc/apparmor.d 1 && ok=1
    fi
    if [ "$ok" != 1 ]; then
      tell "Ubuntu didn't add Winterland to its list, so nothing was changed. See \"Linux\" in the README on github.com/djshiye/winterland for the steps."
      return 1
    fi
    [ "$ASK" = 1 ] || tell "Done! Winterland is on Ubuntu's list. Start the game as usual."
  else
    say_ok
  fi
  # AppRun starts what this prints
  if [ "$MODE" = appimage ]; then printf '%s\n' "$GAME"; fi
  return 0
}

# An AppArmor path can't hold quotes, backslashes, glob characters or line breaks.
check_path() {
  case "$1" in
    /*) ;;
    *) tell "Winterland couldn't work out where it is ($1)."; return 1 ;;
  esac
  case "$1" in *[\"\\\*\?\[\]\{\}\^]* | *$'\n'*)
    tell "Winterland's folder path has a character Ubuntu's AppArmor can't handle ($1). Move it somewhere simpler, like your home folder, and run it again."
    return 1 ;;
  esac
}

# True when our profile for exactly this program is installed (it is loaded at every boot), or (zip) when the game's
# chrome-sandbox was made setuid root by hand, the older fix, which works too.
profile_ready() {
  grep -Fqx "profile $NAME \"$GAME\" flags=(unconfined) {" "$PROFILES/$NAME" 2>/dev/null && return 0
  local helper
  helper="$(dirname "$GAME")/chrome-sandbox"
  [ "$MODE" = folder ] && [ -u "$helper" ] && [ "$(stat -c %u "$helper" 2>/dev/null)" = 0 ]
}

# Copy the game out of the AppImage into the player's own folder, whole or not at all: into a new folder next to it,
# then swapped in by renames. The folder above is the player's alone (0700), so no one else can change the program.
copy_game() {
  local from="$1" to="$2" parent new old status
  parent="$(dirname "$to")"
  mkdir -p "$parent" && chmod 700 "$parent" || return 1
  new="$(mktemp -d "$parent/.app-new.XXXXXX")" || return 1
  status="$new.status"
  {
    if cp -RP --preserve=mode,timestamps "$from/." "$new/" 2>/dev/null; then echo 0 >"$status"; else echo 1 >"$status"; fi
    echo 100
  } | progress "Getting Winterland ready. This happens once after each new version."
  if [ "$(cat "$status" 2>/dev/null)" != 0 ]; then rm -rf "$new" "$status"; return 1; fi
  rm -f "$status"
  old="$parent/.app-old.$$"
  if [ -e "$to" ] || [ -L "$to" ]; then mv "$to" "$old" || { rm -rf "$new"; return 1; }; fi
  if ! mv "$new" "$to"; then
    [ -e "$old" ] && mv "$old" "$to"
    rm -rf "$new"
    return 1
  fi
  rm -rf "$old"
  return 0
}

# Talking to the player: a window when there is a desktop (zenity on GNOME, kdialog on KDE), else the terminal, else
# a desktop notification, else a note in the game's folder (and the error output).
has_gui() { [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; }
say_ok() { [ "$ASK" = 1 ] || tell "Nothing to set up: Winterland can already start on this computer."; }
tell() {
  if [ "$ASK" = 0 ] && [ -t 1 ]; then printf '\n%s\n' "$1"; return; fi
  if has_gui && command -v zenity >/dev/null 2>&1; then
    zenity --info --title=Winterland --width=420 --text="$1" >/dev/null 2>&1
  elif has_gui && command -v kdialog >/dev/null 2>&1; then
    kdialog --title Winterland --msgbox "$1" >/dev/null 2>&1
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send Winterland "$1" >/dev/null 2>&1
  else
    printf '%s\n' "$1" >&2
    [ -n "${NOTE:-}" ] && [ -d "$(dirname "$NOTE")" ] && printf '%s\n' "$1" >"$NOTE" 2>/dev/null
  fi
  return 0
}
confirm() {
  if [ "$ASK" = 0 ] && [ -t 0 ] && [ -t 1 ]; then
    printf '\n%s\n\nAdd Winterland now? [Y/n] ' "$1"
    local a
    read -r a || return 1
    case "$a" in '' | [Yy]*) return 0 ;; *) return 1 ;; esac
  fi
  if has_gui && command -v zenity >/dev/null 2>&1; then
    zenity --question --title=Winterland --width=420 --ok-label='Allow Winterland' --cancel-label='Not now' --text="$1" >/dev/null 2>&1
  elif has_gui && command -v kdialog >/dev/null 2>&1; then
    kdialog --title Winterland --yes-label 'Allow Winterland' --no-label 'Not now' --yesno "$1" >/dev/null 2>&1
  else
    return 1
  fi
}
# A small "please wait" window while its input runs (zenity), else just wait.
progress() {
  if has_gui && command -v zenity >/dev/null 2>&1; then
    zenity --progress --pulsate --auto-close --no-cancel --title=Winterland --width=420 --text="$1" >/dev/null 2>&1
  else
    cat >/dev/null
  fi
}

main "$@"
