# Development

Three.js + TypeScript + Vite, with an Electron desktop app. No image or model files: models, textures and sound are
made in code. Tuning lives in [`src/config.ts`](../src/config.ts).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run desktop    # build and open the desktop app
```

URL flags: `?fresh` ignores the save, `?gallery` shows every model. `window.__WINTERLAND__` is a debug API in the
browser console.

## Check

```bash
npm run typecheck
npm test                        # unit tests, including old-save compatibility
npm run soak                    # long headless play: stuck, colliding or jammed characters
npm run guide-walk              # walks every guidebook step
npm run motion-check            # vehicles and walkers in motion
node scripts/traffic-check.mjs  # road traffic
node scripts/balance.mjs        # autoplay bot: milestone times
```

In the cloud, point the browser checks at an installed Chromium with `WL_CHROMIUM=/path/to/chromium`.

## Package and release

```bash
npm run package:linux   # linux-x64 and linux-arm64 zips
npm run package:win     # win32-x64 zip
npm run package:mac     # darwin-arm64 zip (signing and zipping need a Mac)
```

Releases are built by GitHub Actions (Actions, Release, Run workflow). Release notes come from
`docs/releases/<tag>.md`; the in-game *What's new* reads [CHANGELOG.md](../CHANGELOG.md).

## Design notes

- [ARCHITECTURE.md](ARCHITECTURE.md): coordinates, module ownership, frame order, draw calls.
- [DESIGN.md](DESIGN.md): era 1 systems (save, upgrades, village, demand, pads).
- [EXPANSION.md](EXPANSION.md) and [ERA_RESOURCES.md](ERA_RESOURCES.md): the ten-era climb and each era's resource.
- [art/](art/): art specs per era.
