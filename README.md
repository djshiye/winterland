# Winterland

A cozy 3D idle game. Chop wood, run a snowy lumber mill, grow a winter village into a city, and climb through ten
eras, from campfires to the AI Era.

## Download

Get the latest version from [Releases](https://github.com/djshiye/winterland/releases/latest).

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `Winterland-<version>-win32-x64.zip` |
| Mac with Apple chip (M1 or later) | `Winterland-<version>-darwin-arm64.zip` |
| Linux PC | `Winterland-<version>-x86_64.AppImage` or `linux-x64.zip` |
| Linux ARM (e.g. Raspberry Pi 5) | `Winterland-<version>-aarch64.AppImage` or `linux-arm64.zip` |

Each release lists `SHA256SUMS.txt` to check your download.

## Install

- **Windows:** unzip anywhere and run `Winterland.exe`. The app is unsigned, so SmartScreen may warn once: choose
  *More info*, then *Run anyway*.
- **Mac:** unzip and drag `Winterland.app` to Applications. The first time, right-click it and choose *Open*.
  Intel Macs are not supported.
- **Linux AppImage:** make the file executable (right-click, *Properties*, *Allow executing as program*) and open it.
- **Linux zip:** unzip and run `./winterland`.
- **Ubuntu 23.10 and later:** Ubuntu blocks the game's sandbox until AppArmor allows it. The AppImage asks for your
  password once and sets this up itself. It copies the game to `~/.local/share/Winterland/app` and adds one AppArmor
  profile for that exact path only. With the zip, run `./"Set up for Ubuntu.sh"` once. The sandbox stays on. Never
  start the game with `--no-sandbox`.

## Updates

The game tells you when a new version is out and can update itself. It downloads only from this repository over
HTTPS, checks the file against the release's `SHA256SUMS.txt`, and never touches your save. You can turn the check
off in Settings, Game. Every zip also has an *Update Winterland* file you can run by hand.

## Saves

The game saves by itself and keeps backups every 10 minutes (Settings, Game, *Earlier saves*).

- Windows: `%APPDATA%\Winterland`
- Mac: `~/Library/Application Support/Winterland`
- Linux: `~/.config/Winterland`

## Controls

| Input | Action |
|---|---|
| WASD, arrow keys, or drag | Move |
| Stand next to it | Pick up, drop off and pay |
| Mouse wheel, pinch, + / − | Zoom |
| T / B / G | Map, Market, Guidebook |
| Esc | Close a panel or open Settings |
| M / F | Mute / fullscreen |

A game controller works too. Every control is listed in Settings, Game.

## License

Copyright (c) 2026 Dino (djshiye). All rights reserved. The code and art are public to view, but may not be copied,
modified or redistributed without written permission. See [LICENSE](LICENSE). Open-source parts keep their own
licenses, listed in the game under Settings, Game, About.

Developers: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
