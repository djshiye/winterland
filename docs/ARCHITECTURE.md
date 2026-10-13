# Winterland — Architecture & Build Contract

A 3D isometric "arcade idle" lumber mill (playable-ad style). **Three.js 0.186 + TypeScript 7 (strict) + Vite 8**,
no external assets: every mesh is a procedural primitive with cel-shaded toon materials, every sound is synthesized
with WebAudio.

```
npm run dev          # http://<host>:5173  (LAN-visible)
npm run typecheck    # tsc --noEmit  (≈0.5 s)
npm run build        # typecheck + production bundle in dist/
node scripts/shot.mjs [steps]   # headless build + play-test + screenshots (see header of the script)
```

## 1. World coordinates

Y is up, the ground is the XZ plane, 1 unit ≈ 1 m. The orthographic camera sits toward **+X/+Z** of its target
(yaw 45°, pitch 48°), so the world appears as a diamond:

| world direction | on screen   | spec name | what is there |
|-----------------|-------------|-----------|---------------|
| −X              | upper-left  | NW edge   | river, giant log, river gate |
| +Z              | lower-left  | SW edge   | walk-in counter + customer queue |
| +X              | lower-right | SE edge   | SE counter + tricycle road |
| −Z              | upper-right | North     | phase-5 expansion, highway, tunnel, mountains |

Top-down map (X → right, Z ↓ down — rotate 45° clockwise in your head to get the screen view).
Every number lives in `src/config.ts` (`LAYOUT`, `PADS`) — never hard-code coordinates elsewhere.

```
        x=-16.4   -10.2                                   0                                  10   10.8   14.8
 z=-23   ~~~~~~~[bridge]════════════════════ HIGHWAY (trucks, phase 5) ═══════════════════════════════[tunnel x≈30]
 z=-20   ~~~~~~~ ┆- - - - - - - - expansion fence (phase 5), truck counter at x≈1 - - - - - - - - - ┆   ║    ║
         ~~~~~~~ ┆                 (snowy strip with trees until phase 5)                           ┆   ║    ║
 z=-10   ~~~~~~~ ┌─[megasaw base]──────────────── north fence ─────────────────────────────[cabin]──┐   ║TRIKE║
         ~~R~~~~ │[harvester]   [PAD5 mega -6.4,-8.2]                                              │   ║ROAD ║
         ~~I~~~~ │[  rail   ]   [PAD1 harvester -6.6,-4.8]      [PAD4 eastConv -0.8,-3.0]          │   ║x≈12 ║
         ~~V~LOG │[ x≈-9.2  ]    ┌DROP ZONE┐                                                       │   ║     ║
  z≈0    ~~E~~~~ │               │-5.2,-0.4│═════ east conveyor (z=-0.4) ════[hopper][PROCESSOR 4.4]│   ║     ║
         ~~R~~~~ │ [chop zone]   └────╥────┘                                     [output table]   [SE║counter 9.9,3.6]
         ~~~~~~~ │ (-9.05,3.2)        ║ west conveyor (x=-5.2)  [PAD3 westConv -2.4,4.6]         │   ║ trikes queue
  z=6.6  ═gate═  │                    ║                                  [PAD2 processor 6.4,6.6]  [SE cash 7.4,7.0]
 z=10    ~~~~~~~ └─────────[WALK-IN COUNTER -4.0,9.9]──[cash -0.9,8.6]─────────────────────────────┘
         ~~~~~~~            customers queue +Z (front -4.0,11.4), exit lane x≈-2.3
```

Water flows +Z. The giant log (radius 1.6, length 16, centre (−12.6, −2)) floats in from z=−80 and stops against
the river gate at z=6.6. The player is confined to `LAYOUT.yard` (x −10.2…10, z −10…10; north edge moves to −20 in
phase 5) by `ColliderWorld` bounds; stations register box colliders.

## 2. Modules and ownership

Builders only edit the files of their slice (create new helper files *inside your own folders* freely).
`config.ts`, `core/types.ts`, `core/EventBus.ts`, `core/Economy.ts`, `core/math.ts`, `render/materials.ts`,
`game/Game.ts`, `main.ts`, `style.css`, `index.html`, `scripts/` are **main-session** files: read-only for builders —
if you need a change there, say so in your report instead of editing.

| slice | files |
|-------|-------|
| **main** | `config.ts`, `core/types.ts`, `core/EventBus.ts`, `core/Economy.ts`, `core/math.ts`, `render/materials.ts`, `game/Game.ts`, `main.ts`, `style.css`, `index.html`, `scripts/*` |
| **B1 engine** | `core/Tween.ts`, `render/Renderer.ts`, `render/CameraRig.ts`, `render/characters.ts`, `input/*`, `world/Colliders.ts`, `entities/*` |
| **B2 items** | `items/*` (`ItemPool`, `Pile`, `CarryStack`, `CashStack`, `FlightSystem`, `transfer`, `Zones`) |
| **B3 world** | `world/Environment.ts` (+ new files under `world/env/`) |
| **B4 juice & HUD** | `fx/*` (`Particles`, `Audio`, `JuiceDirector`), `ui/*` |
| **wave 2 (NPC)** | `stations/Counter.ts`, `stations/CashPile.ts`, `npc/*` |
| **wave 2 (machines)** | `stations/*` (rest), `progression/*`, `level/*` |

Stub files contain the public API with JSDoc requirements. **Keep every public signature exactly** (you may add
members/options); other slices compile against them in parallel.

## 3. Frame order (game/Game.ts)

```
input → player → zones (proximity transfers) → level (stations / NPCs / machines / progression)
      → ctx.addUpdatable() objects → flights (arcs land) → tweens → particles → environment
      → juice director → camera → shadow focus → HUD (projects world anchors) → render
```
Variable `dt` clamped to 1/20 s. **All timing uses simulation time** (`dt`, `ctx.tweens.delay`) — never
`setTimeout`/`setInterval`/`Date.now()` for gameplay — so `__WINTERLAND__.simulate(seconds)` fast-forwards correctly.

## 4. Core contracts (`core/types.ts`)

### Items and holders
`Item { id, kind: 'log'|'crate'|'cash', object: Object3D, value }` — created/recycled only by `ctx.items` (ItemPool).
Item meshes are centred on their origin; logs lie along local X.

`ItemHolder` is implemented by everything that holds items: `Pile` (drop zone, counters, hopper, output table, cash
piles, vehicle cargo beds), `CarryStack` (player arms, customers' hands), `CashStack` (player back), conveyor belts,
upgrade pads (cash sinks), NPC buyers.

**Transfer lifecycle** — `items/transfer.ts` is the only code that moves items between holders:
1. `from.count(kind) > 0 && to.canAccept(kind)`
2. `item = from.take(kind)` → object re-parented to the scene root, same world transform
3. `slot = to.reserve(item)` → destination counts it immediately (capacity stays honest while in flight)
4. `ctx.flights.launch(item, to, slot, opts)` → parabolic arc, target re-evaluated every frame (moving holders OK)
5. arrival → `to.receive(item, slot)`; event `item:landed`

New items enter the world with `launchNew(ctx, kind, fromWorldPos, to, opts)` (chopping, processor output, NPC payments).
Consuming items (customers taking logs away, pads eating cash): the holder's `receive()` releases them to the pool.

### Holder identity
Holder ids follow `player.arms`, `player.back`, `pad:<padId>`, `pile:<name>`, `counter:<name>`, `conveyor:<name>`,
`npc:<kind>:<n>`. To react to *where* an item landed, compare identity first (`holder === ctx.player.arms` → pickup
"pop", `holder === ctx.player.back` → cash "ching"), use the `pad:paid` event for pad payments, and treat anything else
as a pile/counter/machine drop.

### Money
`ctx.economy.money` is the truth; the cash stack on the player's back visualises it
(`min(cap, floor(money / ECONOMY.cashBundleValue))` bundles). Collecting a bundle adds its value on landing; paying a
pad takes one bundle (spends `cashBundleValue`) per flight.

### Proximity
`ctx.zones.addTransfer({ area, from, to, kinds, interval })` — while the player stands in `area`, items move one by
one with accelerating cadence. `ctx.zones.add({ area, onEnter, onStay, onExit })` for custom behaviour (chopping, pads).

### Services (`GameContext`)
Construction order (a constructor may only touch services created before it):
`renderer/scene/camera → events → tweens → state → economy → colliders → input → cameraRig → particles → audio → hud
→ items → flights → zones → environment → player → JuiceDirector → level`.

### Events (`GameEvents`)
Gameplay code emits facts; `fx/JuiceDirector.ts` turns them into sound/particles/text/shake. Key events:
`money:changed`, `item:landed`, `item:launched`, `stack:full`, `player:chopHit`, `log:chopped`, `crate:made`, `sale`,
`pad:shown`, `pad:paid`, `pad:unlocked`, `built`, `phase:changed`, `intro:crash`, `intro:done`, `expansion:start`.

### State
`ctx.state: GameState` — `phase`, `unlocked[padId]`, `padsVisible[padId]`, `expanded`, `stats`. Written by progression,
read by anyone.

## 5. Rendering conventions
* Build meshes with `render/materials.ts`: `toon(color)` (cached cel material), `basic(color)` (unlit), `geo.*`
  (cached geometries — never dispose them), `mesh(geometry, material)` (shadows on), `makeCanvasTexture()` for labels.
* Colours come from `PALETTE` in `config.ts`. Vibrant, clean, toy-like; chunky proportions; no textures from files.
* Shadows: one sun with a 2048 shadow map that follows the camera target. Large flat ground pieces receive only.
* No per-frame allocations in hot paths (reuse temp vectors). Prefer InstancedMesh/merged geometry for repeated decor.

## 6. Verification
* `npx tsc --noEmit` must pass (strict, `noUnusedLocals`).
* `node scripts/shot.mjs ...` builds into a private temp dir, so parallel runs are safe. Never run `vite build` into
  `dist/` or start dev servers in shared dirs from a builder task.
* Debug API (`window.__WINTERLAND__`): `state()`, `pause()`, `resume()`, `simulate(s)`, `render()`,
  `setMove(x, y)`, `moveTo(x, z)`, `teleport(x, z)`, `addMoney(n)`, `skipIntro()`, `unlock(padId)`.

## 7. Gameplay spec (summary — phases 1–5)
1. **Intro + manual:** giant trunk floats down the river and crashes into the gate. Standing in the chop zone swings the
   axe automatically; chopped pieces arc into the grey Raw Log Drop Zone. Player picks logs up (arms stack), drops them
   on the walk-in counter; queued blue customers (speech bubble with the request) take logs, leave green cash bundles in
   a grid pile beside the counter, walk away; queue advances. Player walks over cash to collect it (HUD `$` updates).
2. **Harvester pad ($100)** near the log → blue track-mounted saw shuttles along the bank, sawing and launching logs into
   the drop zone.
3. **Processor pad ($200)** in the SE → blue processing machine (hopper → crates on an output table) + SE counter;
   cargo-tricycle NPCs load crates and leave bigger cash stacks.
4. **Conveyor pads ($150 + $150)** → west belt: drop zone → walk-in counter; east belt: drop zone → processor hopper.
5. **Mega sawmill pad ($200)** → camera zooms out, giant river saw slices the log, yard expands north, pickup trucks
   queue on the highway for bulk log orders.

Upgrade pads: floor tile with icon + remaining cost; standing on it with cash flies bundles into it, counting down to 0,
then the unlock fires with a scale-bounce.
