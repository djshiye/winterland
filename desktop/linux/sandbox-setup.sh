#!/bin/bash
# Winterland on Ubuntu 23.10 / 24.04 and later: lets the game keep Chromium's safety sandbox on.
#
# Those Ubuntu versions stop apps from using "user namespaces", which is how Chromium's sandbox works without root,
# unless an AppArmor profile says the app may. Without one the game stops at once ("The SUID sandbox helper binary was
# found, but is not configured correctly"), and from a double-click that looks like nothing happening.
# This script checks for that case and, only with the player's OK (Ubuntu's own password window, via pkexec), adds a
# small AppArmor profile that allows exactly that and nothing else: the game is not confined further and gets no extra
# rights. The sandbox stays on; this never starts the game with --no-sandbox.
#
# It ships twice (scripts/package-desktop.mjs, scripts/package-appimage.mjs):
#   - in the Linux zip as "Set up for Ubuntu.sh", for the 'winterland' program in its own folder;
#   - inside the AppImage, where AppRun runs it with --appimage before every start (it returns at once when nothing is
#     needed), for the game as the AppImage mounts it (/tmp/.mount_*/winterland).
#
# Options: --appimage (set up for the AppImage), --ask (from AppRun: ask in a window, no terminal; when the player
# says no, explain and fail). Exit status: 0 = the game can start, 1 = it can't (nothing was changed).
# Plain bash; no network; never writes outside /etc/apparmor.d/winterland*.

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

  local NAME ATTACH GAME=''
  if [ "$MODE" = appimage ]; then
    NAME='winterland-appimage'
    # The AppImage starter mounts the game at $TMPDIR (else /tmp)/.mount_<name><random>.
    ATTACH='/tmp/.mount_*/winterland'
  else
    NAME='winterland'
    local dir
    dir="$(cd "$(dirname "$0")" && pwd -P)" || return 1
    GAME="$dir/winterland"
    ATTACH="$GAME"
  fi

  # Nothing to do unless Ubuntu's restriction is on.
  [ "$(cat "$RESTRICT" 2>/dev/null)" = 1 ] || { say_ok; return 0; }
  # Already set up: our profile for this exact path is installed (it is loaded at every boot).
  if grep -Fqx "profile $NAME \"$ATTACH\" flags=(unconfined) {" "$PROFILES/$NAME" 2>/dev/null; then say_ok; return 0; fi
  # The zip's chrome-sandbox made setuid root by hand (the older fix) works too.
  if [ -n "$GAME" ] && [ -u "$(dirname "$GAME")/chrome-sandbox" ] && [ "$(stat -c %u "$(dirname "$GAME")/chrome-sandbox" 2>/dev/null)" = 0 ]; then
    say_ok
    return 0
  fi
  if [ "$MODE" = folder ]; then
    [ -x "$GAME" ] || { tell "Put this file in your unzipped Winterland folder, next to the 'winterland' program, and run it again."; return 1; }
    # An AppArmor path can't hold quotes, glob characters or line breaks: such a folder needs moving first.
    case "$ATTACH" in *[\"\*\?\[\]\{\}\^]* | *$'\n'*)
      tell "Winterland's folder name has a character Ubuntu's AppArmor can't handle ($ATTACH). Move the folder somewhere simpler, like your home folder, and run this again."
      return 1 ;;
    esac
  fi

  local INTRO="Ubuntu blocks apps from using their own safety sandbox unless they are on its list. Winterland can add itself to that list now. Ubuntu will ask for your password once. The sandbox stays on, and Winterland gets no other extra rights."
  if ! confirm "$INTRO"; then
    tell "Winterland can't start until Ubuntu allows its sandbox. Start it again whenever you're ready, or see \"Linux\" in the README on github.com/djshiye/winterland."
    return 1
  fi

  # The profile, written as the player first, then copied into place and loaded as root in one pkexec step.
  local tmp abi=''
  tmp="$(mktemp "${TMPDIR:-/tmp}/winterland-apparmor.XXXXXX")" || return 1
  [ -f "$PROFILES/abi/4.0" ] && abi='abi <abi/4.0>,'
  cat >"$tmp" <<EOF
# Added by Winterland (desktop/linux/sandbox-setup.sh): lets the game use Chromium's sandbox on Ubuntu 23.10+.
# It does not confine Winterland or give it any other rights. Remove this file to undo it.
$abi
include <tunables/global>

profile $NAME "$ATTACH" flags=(unconfined) {
  userns,

  include if exists <local/$NAME>
}
EOF
  local ok=0
  if [ -n "$ROOT" ]; then
    # tests: no root, just the copy
    mkdir -p "$PROFILES" && cp "$tmp" "$PROFILES/$NAME" && ok=1
  elif command -v pkexec >/dev/null 2>&1; then
    # (only fixed text runs as root; the profile's path and name are its two arguments)
    # shellcheck disable=SC2016
    pkexec /bin/sh -c 'set -e; install -m 0644 -o root -g root "$1" "/etc/apparmor.d/$2"; for p in /usr/sbin/apparmor_parser /sbin/apparmor_parser; do if [ -x "$p" ]; then exec "$p" -r "/etc/apparmor.d/$2"; fi; done; exit 1' \
      winterland-setup "$tmp" "$NAME" && ok=1
  elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
    # shellcheck disable=SC2016
    sudo /bin/sh -c 'set -e; install -m 0644 -o root -g root "$1" "/etc/apparmor.d/$2"; apparmor_parser -r "/etc/apparmor.d/$2"' \
      winterland-setup "$tmp" "$NAME" && ok=1
  fi
  rm -f "$tmp"
  if [ "$ok" = 1 ]; then
    [ "$ASK" = 1 ] || tell "Done! Winterland is on Ubuntu's list. Start the game as usual."
    return 0
  fi
  tell "Ubuntu didn't add Winterland to its list, so nothing was changed. See \"Linux\" in the README on github.com/djshiye/winterland for the steps."
  return 1
}

# Talking to the player: a window when there is a desktop (zenity on GNOME, kdialog on KDE), else the terminal.
has_gui() { [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; }
say_ok() { [ "$ASK" = 1 ] || tell "Nothing to set up: Winterland can already start on this computer."; }
tell() {
  if [ "$ASK" = 0 ] && [ -t 1 ]; then printf '\n%s\n' "$1"; return; fi
  if has_gui && command -v zenity >/dev/null 2>&1; then
    zenity --info --title=Winterland --width=420 --no-wrap=false --text="$1" 2>/dev/null
  elif has_gui && command -v kdialog >/dev/null 2>&1; then
    kdialog --title Winterland --msgbox "$1" 2>/dev/null
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send Winterland "$1" 2>/dev/null
  else
    printf '%s\n' "$1" >&2
  fi
}
confirm() {
  if [ "$ASK" = 0 ] && [ -t 0 ] && [ -t 1 ]; then
    printf '\n%s\n\nAdd Winterland now? [Y/n] ' "$1"
    local a
    read -r a || return 1
    case "$a" in '' | [Yy]*) return 0 ;; *) return 1 ;; esac
  fi
  if has_gui && command -v zenity >/dev/null 2>&1; then
    zenity --question --title=Winterland --width=420 --ok-label='Allow Winterland' --cancel-label='Not now' --text="$1" 2>/dev/null
  elif has_gui && command -v kdialog >/dev/null 2>&1; then
    kdialog --title Winterland --yes-label 'Allow Winterland' --no-label 'Not now' --yesno "$1" 2>/dev/null
  else
    return 1
  fi
}

main "$@"
