# Winterland ❄️🪵

A juicy 3D isometric **arcade-idle lumber mill**, in the style of mobile playable ads. Chop a giant river log,
haul stacks of wood, serve customers, and automate your way from an axe to a mega sawmill.

Everything is procedural: models are Three.js primitives with cel shading, and the sound effects are synthesized
with WebAudio. There are no asset files to download.

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
2. **Carry** logs to the walk-in counter. Customers buy them and leave cash beside the counter.
3. **Collect cash** and spend it on the glowing **upgrade pads**:
   - $100 harvester: an automatic saw on rails
   - $200 processor: turns logs into crates for cargo tricycles
   - $150 + $150 conveyors: full automation
   - $200 mega sawmill: the yard expands to the highway and trucks arrive

## Develop

```bash
npm run typecheck                 # tsc --noEmit (strict)
npm run build                     # production bundle → dist/
npm run preview                   # serve dist/ on the LAN
node scripts/shot.mjs sim:2 shot:shots/now.png   # headless play-test + screenshot
```

`window.__WINTERLAND__` exposes a debug/test API in the browser console: `state()`, `simulate(seconds)`,
`teleport(x, z)`, `moveTo(x, z)`, `addMoney(n)`, `unlock('harvester')`, `skipIntro()` and more.

Architecture, coordinates and module ownership are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Tuning (prices, speeds, layout, colours) all lives in [`src/config.ts`](src/config.ts).
