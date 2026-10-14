# Winterland ❄️🪵

A juicy 3D isometric **arcade-idle lumber mill**, in the style of mobile playable ads. Chop a giant river log,
haul stacks of wood, serve customers, and automate your way from an axe to a mega sawmill.

Everything is procedural. There is not a single `.glb` or `.png` in the repo:
- **Models:** built from compound Three.js primitives in toon shading by the `AssetFactory` (`src/assets/`).
- **UI textures:** pad faces, speech bubbles and badges are drawn on offscreen `<canvas>` elements.
- **Sound:** synthesized with WebAudio.

## Play

```bash
npm install
npm run dev        # → http://localhost:5173  (also on your LAN: http://<this-machine>:5173)
```

| Input | Action |
|-------|--------|
| WASD / arrow keys | Move (8 directions) |
| Touch or mouse: press and drag anywhere | Floating virtual joystick |
| Stand next to things | Pick up, drop off, pay. Everything happens automatically by proximity |

### The loop
1. **Chop** the giant log on the river bank. Wood flies into the grey drop zone.
2. **Carry** logs to the walk-in counter. They become plank bundles as they land, and customers buy them
   and leave cash beside the counter.
3. **Collect cash** and spend it on the glowing **floor pads**: harvester $150, processor $700 (crates for the
   cargo tricycles), two conveyors $900 each, and the mega sawmill $3,200 (the yard expands to the highway
   and trucks arrive). Unlocked machines come back as **LV n** pads that make them faster.
4. **Upgrade shop** on the red cabin's doormat: carry capacity, walk speed and axe speed, plus three hired
   helpers (crate runner, cashier, log hauler).
5. **The village** behind the south gate: carry logs and cash to the plots to raise tents, huts, cabins and
   lodges. More villagers mean a higher village level (Camp → Hamlet → Village → Town → Winter City), which
   brings more customers, bigger orders, better prices and new hires.
6. **The finale:** at Winter City, build the Great Lodge for a celebration and a stats card. Play goes on after.

The game saves itself. A refresh resumes where you were, and coming back later pays part of what your
mill earned while you were away. Settings (the gear) has sound and a reset.

A whole game takes the autoplay bot about 50 minutes (targets in [docs/DESIGN.md](docs/DESIGN.md)).

## Desktop app (Linux and Windows)

The game also ships as a standalone desktop app (Electron). It runs fully offline, and the save lives in your
user folder (`~/.config/Winterland` on Linux, `%APPDATA%\Winterland` on Windows).

```bash
npm install
npm run desktop            # build and open it in a desktop window right away
npm run package:desktop    # portable builds for linux-x64, linux-arm64 and win32-x64 → release/*.zip
npm run package:linux      # only the Linux builds
npm run package:win        # only the Windows build
```

You can package from Linux or Windows, and the build machine doesn't need Wine or an installer toolchain. The
first run downloads the Electron runtime for each target (~100 MB each) and caches it.

- **Windows:** unzip `Winterland-<version>-win32-x64.zip` anywhere and run `Winterland.exe`. The app is unsigned,
  so SmartScreen may warn the first time: choose *More info → Run anyway*.
- **Linux:** unzip the archive that matches your machine (`x64` for most PCs, `arm64` for e.g. a Raspberry Pi 5) and
  run `./winterland`. On distributions that block Chromium's sandbox (some Ubuntu 24.04+ setups report
  *"The SUID sandbox helper binary was found, but is not configured correctly"*), start it with
  `./winterland --no-sandbox`.

Keys in the desktop app: **F11** fullscreen, **Ctrl+R** reload, **F12** developer tools.

## Develop

```bash
npm run typecheck                 # tsc --noEmit (strict)
npm run build                     # production bundle → dist/
npm run preview                   # serve dist/ on the LAN
node scripts/shot.mjs sim:2 shot:shots/now.png   # headless screenshot after 2 s of play
npm run playtest -- shots/playtest              # an autoplay bot plays the whole game; screenshots each milestone
node scripts/balance.mjs                        # the same bot without screenshots: milestone times + every purchase
```

Open `http://localhost:5173/?gallery` to see every AssetFactory model and canvas texture, one row per domain.
Use `?gallery=items` or `?gallery=crate` to focus on a domain or a single asset, and add `&spin` for a turntable.

`window.__WINTERLAND__` exposes a debug/test API in the browser console: `state()`, `simulate(seconds)`,
`teleport(x, z)`, `moveTo(x, z)`, `addMoney(n)`, `unlock('harvester')`, `skipIntro()`, `buy('carry')`,
`setUpgrade(id, level)`, `revealVillage()`, `buildPlot(plot, tier)`, `save()`, `clearSave()` and more.
Add `?fresh` to the URL to ignore the save.

Architecture, coordinates and module ownership are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
the full-game systems (save, upgrades, village, demand, pads) in [docs/DESIGN.md](docs/DESIGN.md).
Tuning (prices, speeds, layout, colours) all lives in [`src/config.ts`](src/config.ts).
