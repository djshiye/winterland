# Winterland — Architecture & Build Contract

A 3D isometric "arcade idle" lumber mill (playable-ad style). **Three.js 0.186 + TypeScript 7 (strict) + Vite 8**,
no external assets: every model is built by the **AssetFactory** (`src/assets/`) from compound primitives with
cel-shaded toon materials, every 2D texture is drawn on an offscreen canvas, every sound is synthesized with WebAudio.
`?gallery` shows every AssetFactory model on one page.

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
 z=-20   ~~~~~~~ ┆- - - - - - - expansion fence (phase 5), truck counter (1.0,-19.9), cash (2.9,-18.6) - ┆   ║    ║
         ~~~~~~~ ┆                 (snowy strip with trees until phase 5)                           ┆   ║    ║
 z=-10   ~~~~~~~ ┌─[megasaw base]──────────────── north fence ─────────────────────────────[cabin]──┐   ║TRIKE║
  z=-8   ~~LOG~~ │[harvester]   [PAD5 mega -6.4,-8.2]                                              │   ║ROAD ║
         ~~ |~~~ │[  rail   ]   [PAD1 harvester -6.6,-4.8]      [PAD4 eastConv -0.8,-3.0]          │   ║x≈12 ║
         ~~ |~~~ │[ x≈-9.2  ]    ┌DROP ZONE┐                                                       │   ║     ║
  z≈0    ~~ |~~~ │               │-5.2,-0.4│═════ east conveyor (z=-0.4) ═══[tray][PROCESSOR][bench]│   ║     ║
  z=2    ~~cut~~ │ [chop zone]   └──╥──────┘                              3.05   4.4      5.95    [SE║counter 9.9,3.6]
  z=4    ~~end~~ │ (-9.05,2.0)       ║ west conveyor (x=-4.4)  [PAD3 westConv -2.4,4.6]          │   ║ trikes queue
 z=4.6   ═gate═  │                   ║                                  [PAD2 processor 6.4,6.6]  [SE cash 8.9,6.0]
 z=10    ~~~~~~~ └────────[WALK-IN COUNTER -4.0,9.9][cash -2.0,8.8]─────────────────────────────────┘
         ~~~~~~~            customers queue +Z (front -4.0,10.95), exit lane x≈-2.3
```

Water flows +Z. The giant log (radius 1.8, length 12, centre (−12.6, −2), so it spans z −8…4) floats in from z=−80
and stops against the river gate at z=4.6; the player chops its cut band at z≈2. The player is confined to
`LAYOUT.yard` (x −10.2…10, z −10…10; north edge moves to −20 in phase 5) by `ColliderWorld` bounds; stations
register box colliders (conveyors don't — the player may walk across them).

## 2. Modules and ownership

Builders only edit the files of their slice (create new helper files *inside your own folders* freely).
`config.ts`, `core/types.ts`, `core/EventBus.ts`, `core/Economy.ts`, `core/math.ts`, `render/materials.ts`,
`game/Game.ts`, `main.ts`, `style.css`, `index.html`, `scripts/` are **main-session** files: read-only for builders —
if you need a change there, say so in your report instead of editing.

| slice | files |
|-------|-------|
| **main** | `config.ts`, `core/types.ts`, `core/EventBus.ts`, `core/Economy.ts`, `core/Upgrades.ts`, `core/demand.ts`, `core/Save.ts`, `core/math.ts`, `render/materials.ts`, `game/Game.ts`, `main.ts`, `style.css`, `index.html`, `scripts/*`, `level/Level.ts`, `assets/AssetFactory.ts` |
| **B1 engine + characters** | `core/Tween.ts`, `render/Renderer.ts`, `render/CameraRig.ts`, `render/characters.ts`, `input/*`, `world/Colliders.ts`, `entities/*`, `assets/characters.ts` |
| **B2 items** | `items/*` (`ItemPool`, `Pile`, `CarryStack`, `CashStack`, `FlightSystem`, `transfer`, `Zones`), `assets/items.ts`, `debug/*` |
| **B3 world + village** | `world/Environment.ts`, `world/env/*`, `assets/scenery.ts`, `village/*`, `assets/shelters.ts` |
| **B4 juice & HUD** | `fx/*` (`Particles`, `Audio`, `JuiceDirector`), `ui/*` |
| **B5 commerce** | `stations/Counter.ts`, `stations/CashPile.ts`, `npc/*` (customers; tricycles + trucks share `VehicleQueue`; hired crew in `Crew` + `crewHelpers`), `assets/vehicles.ts`, `assets/shop.ts` |
| **B6 machines** | `stations/DropZone.ts`, `stations/GiantLog.ts`, `stations/Harvester.ts`, `stations/Processor.ts`, `stations/Conveyor.ts`, `stations/beltPath.ts`, `stations/MegaSaw.ts`, `assets/machines.ts` |
| **B7 progression** | `stations/UpgradePad.ts`, `stations/ConstructionPad.ts`, `stations/ShopMat.ts`, `progression/*` (reveal rules in `reveals.ts`), `assets/pads.ts` |

The full-game systems (save and restore rules, upgrades, demand, pads, village layout, events) are specified in `docs/DESIGN.md`.

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
`Item { id, kind: 'log'|'plank'|'crate'|'cash', object: Object3D, value }` — created/recycled only by `ctx.items`
(ItemPool, visuals from AssetFactory `assets/items.ts`). Item meshes are centred on their origin; logs lie along local X.
Sizes are `ITEM_SIZE` (art spec: log r 0.12 × 0.6, plank bundle 0.5 × 0.12 × 0.3, crate 0.45, cash 0.35 × 0.12 × 0.2).

**Planks:** the player and the west conveyor deliver *logs* to the walk-in counter's `input` holder; each log is
converted on landing (released, and a plank bundle pops into the slot that was reserved for it). The counter's `pile`
holds planks; customers buy planks. Other counters have `input === pile` (SE: crates, truck: raw logs).

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

A conveyor is an `ItemHolder` too, with belt semantics: `count(kind)` and `take()` only see the lead item once it has
reached the exit, and its load is the items riding plus those in flight onto it.

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
* **AssetFactory** (`src/assets/AssetFactory.ts` + one domain file per owner): every gameplay object's model is a
  factory there — characters, items, vehicles, shop furniture + speech bubbles, giant log + machines, pad tile +
  `createPadTexture`, palisade fence post. Factories return a Group or a typed handle of animatable parts; they never
  touch the scene or `GameContext`. Behaviour stays in `stations/`, `npc/`, `entities/`. Each domain exports a
  `<domain>Catalog` for the `?gallery` page. Background scenery stays in `world/env/` (merged/instanced) and uses the
  same palette.
* Build meshes with `render/materials.ts`: `toon(color)` (cached cel material), `basic(color)` (unlit), `geo.*`
  (cached geometries — never dispose them), `mesh(geometry, material)` (shadows on), `makeCanvasTexture()` for labels.
* **Draw calls are the budget.** Every mesh is a draw call, plus one more in the shadow pass when it casts. Merge the
  static parts of each model with `render/batch.ts`: `bake(group)` collapses a static toon subtree into one
  vertex-coloured mesh (shared `vcMat()`), `Batch` builds one from primitives. Bake per animated pivot (a wheel, an
  arm, a blade keeps its own node with its parts baked inside it); keep textured, emissive, transparent and flashing
  parts separate. Items are one mesh each; a character is 6, a vehicle 4–7, a machine 2–7.
* Colours come from `COLORS` (the exact art-direction master palette) / `PALETTE` (aliases + derived shades) in
  `config.ts`. Vibrant, clean, toy-like; chunky proportions; no textures from files.
* Shadows: one sun with a 2048 shadow map that follows the camera target. Large flat ground pieces receive only.
* No per-frame allocations in hot paths (reuse temp vectors). Prefer InstancedMesh/merged geometry for repeated decor.

## 6. Verification
* `npx tsc --noEmit` must pass (strict, `noUnusedLocals`).
* `node scripts/shot.mjs ...` builds into a private temp dir, so parallel runs are safe. Never run `vite build` into
  `dist/` or start dev servers in shared dirs from a builder task.
* Debug API (`window.__WINTERLAND__`): `state()`, `pause()`, `resume()`, `simulate(s)`, `render()`,
  `setMove(x, y)`, `moveTo(x, z)`, `teleport(x, z)`, `addMoney(n)`, `skipIntro()`, `unlock(padId)`, `level`
  (the Level instance: stations, queues, pads, progression), `ctx`.
* Handy spots: chop (−9, 2), drop-zone pickup (−6.6, 0), walk-in counter (−4, 9), walk-in cash (−2, 8.6), processor
  tray (2.0, −0.4), workbench (6.9, −0.4), SE counter (9, 3.6), SE cash (8.9, 6).
* Renderer budget (checked with `__bot.perf()` and `scripts/perf-breakdown.js`): normal late-game play ≤ ~800 draw
  calls (currently ~430 desktop, ~500 phone), forced worst case (everything unlocked, 150 s, no cash collected)
  ≤ ~1500 (currently ~1030).
* `npm run playtest [outDir] [--mobile]` injects `scripts/playtest-bot.js`, an in-page bot that plays the real economy
  through all five phases (teleporting between stations, stepping the sim), screenshots each milestone and prints the
  unlock timeline, action counts and renderer cost (`__bot.perf()`: draw calls, triangles, live items).

## 7. Gameplay spec (summary — phases 1–5)
1. **Intro + manual:** giant trunk floats down the river and crashes into the gate. Standing in the chop zone swings the
   axe automatically; chopped pieces arc into the grey Raw Log Drop Zone. Player picks logs up (arms stack), drops them
   on the walk-in counter (each becomes a plank bundle); queued blue customers (speech bubble with a plank icon) take
   planks, leave green cash bundles in a grid pile beside the counter, walk away; queue advances. Player walks over cash to collect it (HUD `$` updates).
2. **Harvester pad ($100)** near the log → blue track-mounted saw shuttles along the bank, sawing and launching logs into
   the drop zone.
3. **Processor pad ($200)** in the SE → blue tunnel processing machine (infeed tray → crates on a workbench) + SE counter;
   cargo-tricycle NPCs load crates and leave bigger cash stacks.
4. **Conveyor pads ($150 + $150)** → west rollers: drop zone → walk-in counter; east rollers: drop zone → processor tray.
5. **Mega sawmill pad ($200)** → camera zooms out, giant river saw slices the log, yard expands north, pickup trucks
   queue on the highway for bulk log orders.

Upgrade pads: floor tile with icon + remaining cost; standing on it with cash flies bundles into it, counting down to 0,
then the unlock fires with a scale-bounce.
