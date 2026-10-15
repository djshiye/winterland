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
| Stand next to things | Drop off and collect cash automatically. Picking up and paying also happen by proximity on touch; with a mouse you **hold E, Space or a still press** (Settings → Game → Hold to interact) |
| Mouse wheel, pinch, + / − | Zoom the camera |
| Esc | Close the open panel, or open Settings |
| M, F | Mute; fullscreen (desktop: F11 or Alt+Enter) |

### The loop
1. **Chop** the giant log on the river bank. Wood flies into the grey drop zone.
2. **Carry** logs to the walk-in counter. They become plank bundles as they land, and customers buy them
   and leave cash beside the counter.
3. **Collect cash** and spend it on the glowing **floor pads**: harvester $150, processor $700 (crates for the
   cargo tricycles), two conveyors $900 each, and the mega sawmill $3,200 (the yard expands to the highway
   and trucks arrive). Unlocked machines come back as **LV n** pads that make them faster.
4. **Upgrade shop** on the red cabin's doormat: carry capacity, walk speed and axe speed, plus hired
   helpers (crate runner, cashier, log hauler, and later the pine hauler, town porter, sled loader and foreman),
   **crew priorities** for who gets the wood when it's short, and a **Sales** tab of price upgrades.
5. **The village** behind the south gate: carry logs and cash to the plots to raise tents, huts, cabins and
   lodges. More villagers mean a higher village level (the eras: Camp → Hamlet → Village → Town → Winter City), which
   brings more customers, bigger orders, better prices and new hires.
6. **Late yard:** a **truck loader** belt and **cash tubes** take over the hauling and collecting.
   **Timber Ridge** lies through the east gate. It has a pine forest that a tree feller cuts onto a log deck,
   freight trains that buy logs at the rail platform, and the crew **bunkhouse**. Each bunkhouse tier lets more
   helpers of every role work, and adds a pine hauler.
7. **The workshop:** on the ridge, a log-cabin workshop turns logs into chairs, and dog sleds pay the best price
   in the game for them.
8. **The Market Town and eras:** when the village reaches Town, a market square opens east of the village
   with a lit tree, stalls, benches and eight lots for sale. Step on a lot to choose what to build: a farm,
   bakery, ranch, butcher, townhouse or (at Winter City) a toy factory. Carry wheat, meat, firewood and crates to
   the shops, and townsfolk queue up to buy bread, sausages and toys. Every business brings workers, so the town
   pushes the village to the next era. Four **amenities** on the square (a cocoa café, a snowman park, a bandstand and
   a skating pond) raise **town happiness**, which lifts every sale price by up to 30 %; carolers sing at the tree at
   night, staff walk home at dusk, and a night market opens at Winter City. Each era upgrades the whole settlement (torches to lanterns to iron lamps,
   snow tracks to gravel to cobbles, bunting, string lights, fireworks), and a **Porter** can be hired to carry
   the town's goods.
9. **Events and contracts:** from the Village on, a **snowstorm**, a **festival day** or the **northern lights** can
   roll in for a minute or two (slow going and hungry shops, double buyers, or +25 % prices). From Town, the notice
   board by the village gate posts **delivery contracts**: sell so many loaves, chairs or toys within three minutes
   for a cash bonus. A **Sled Dog** (Lumberjack tab) follows you and carries extra.
10. **The finale:** at Winter City, build the Great Lodge for a celebration and a stats card. Play goes on after, or start a **New Season**. Everything resets, but every sale pays 25%
   more for each season played. In the **Winterland** era the **Grand Market** waits on the square: 120 logs, $60,000
   and 20 toys from the toy factory, for a second celebration.

Along the way: **quests** (three short goals at a time with cash rewards), **VIP customers** who tip, **rush
hours** when customers flood in, and a **day/night cycle** with glowing windows and northern lights.

The game saves itself. A refresh resumes where you were, and coming back later pays part of what your
mill earned while you were away. Settings (the gear) has three tabs: **Sound** (sound and music switches, Master,
Effects and Music volume), **Display** (fullscreen or window mode, graphics quality — Low turns off shadows for slower
computers, and the game switches to Low by itself once if it runs slowly — a resolution scale, a frame-rate cap, an
FPS readout and day/night) and **Game** (vibration on phones, the controls, back up and restore the save as a file,
New Season after the finale, and a reset).

A whole game takes the autoplay bot about 60–70 minutes (targets in [docs/DESIGN.md](docs/DESIGN.md)).

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

Settings → Display has a **Window mode** (Windowed / Fullscreen — borderless, so alt-tab stays friendly).
**F11** or **Alt+Enter** toggles it from anywhere. The window size, position and mode are remembered in
`window.json` next to the save, so the game opens the way you left it.

Keys in the desktop app: **F11** / **Alt+Enter** fullscreen, **Ctrl+R** reload, **F12** developer tools.

## Develop

```bash
npm run typecheck                 # tsc --noEmit (strict)
npm run build                     # production bundle → dist/
npm run preview                   # serve dist/ on the LAN
node scripts/shot.mjs sim:2 shot:shots/now.png   # headless screenshot after 2 s of play
npm run playtest -- shots/playtest              # an autoplay bot plays the whole game; screenshots each milestone
node scripts/balance.mjs                        # the same bot without screenshots: milestone times + every purchase
npm test                                        # vitest: upgrade tables, sale prices, old-save compatibility, layout
npm run soak                                    # AI soak: hours of headless play, flags stuck / colliding / jammed characters
node scripts/check-reveals.mjs                  # headless check of the pad reveal order and its save/restore
```

GitHub Actions: every push runs the typecheck, the tests, a build and a bot run to the processor
(`.github/workflows/ci.yml`). Pushing a `v*` tag builds the Linux and Windows zips and attaches them to a GitHub
release (`release.yml`).

Open `http://localhost:5173/?gallery` to see every AssetFactory model and canvas texture, one row per domain.
Use `?gallery=items` or `?gallery=crate` to focus on a domain or a single asset, and add `&spin` for a turntable.

`window.__WINTERLAND__` exposes a debug/test API in the browser console: `state()`, `simulate(seconds)`,
`teleport(x, z)`, `moveTo(x, z)`, `addMoney(n)`, `unlock('harvester')`, `skipIntro()`, `buy('carry')`,
`setUpgrade(id, level)`, `revealVillage()`, `buildPlot(plot, tier)`, `buildQuarters(tier)`, `newSeason()`, `startRush()`, `setTimeOfDay(0.75)`, `save()`, `clearSave()` and more.
Add `?fresh` to the URL to ignore the save, and `?noauto` to keep the automatic quality switch off.

Architecture, coordinates and module ownership are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md);
the full-game systems (save, upgrades, village, demand, pads) in [docs/DESIGN.md](docs/DESIGN.md).
Tuning (prices, speeds, layout, colours) all lives in [`src/config.ts`](src/config.ts).
