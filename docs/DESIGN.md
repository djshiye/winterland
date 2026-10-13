# Winterland full game: design and build contract (waves 4–5)

This turns the 5-phase playable into a full idle game:
- save and resume, with offline earnings;
- an upgrade shop;
- hired crew;
- machine levels;
- a winter village of buildable shelters that drives demand;
- a finale.

Read this together with `docs/ARCHITECTURE.md`, which covers coordinates, ownership, frame order and draw-call rules.

## Player-facing loop

1. **Phases 1–5 as before.** Chop, carry, sell, then unlock the harvester, processor, conveyors and mega sawmill on floor pads. The pads cost more now.
2. **Upgrade shop.** Standing on the doormat in front of the cabin (`LAYOUT.shop.mat`) opens a panel with two tabs.
   - **Lumberjack:** carry capacity, walk speed and axe speed.
   - **Crew:** hire, then level up, a crate runner, a cashier and a log hauler.
   - Buying spends money at once.
3. **Machine levels.** After a machine is unlocked, its own pad comes back at the same spot as a level pad, for example "HARVESTER LV 2 $400". There are levels for the harvester, the processor and the mega saw.
   - The conveyors get no levels, because belt throughput (6.5 items/s) is never the bottleneck.
4. **The village.** A gate opens in the south fence and a street leads to 8 plots.
   - Each plot grows Tent → Hut → Cabin → Lodge. Every tier costs **logs** (carried from the drop zone in your arms) **and cash**.
   - Shelters house villagers. The population sets the **village level**: Camp, Hamlet, Village, Town, Winter City.
   - Each level unlocks more plots, the next shelter tier and crew hires. It also raises **demand**: faster customers, bigger orders and better prices (`DEMAND[level]`).
5. **Finale.** At Winter City the Great Lodge pad appears at the end of the street (120 logs + $40k). Building it brings:
   - a celebration;
   - a stats card;
   - "Winterland" as the final village level, with the best demand.

   The game continues after that.
6. **Persistence.**
   - The game autosaves.
   - A refresh resumes exactly where you were.
   - Coming back after a while shows "While you were away: $X". The amount is the recent sales rate × time away (capped at 2 h) × 0.5.
   - Settings → Reset wipes everything.

Target pacing, tuned in wave 5 with the bot:

| Milestone | Time |
|---|---|
| Harvester | ~1 min |
| Shop | ~1:15 |
| Village gate | ~2 |
| Hamlet | ~3 |
| Processor | ~4 |
| Crate runner | ~5 |
| Conveyors | ~8 |
| Cashier | ~11 |
| Mega saw | ~15 |
| Town | ~22 |
| Log hauler | ~25 |
| Winter City | ~40 |
| Finale | ~45–55 |

## State is the truth (save/restore rules)

`ctx.state: GameState` (`core/types.ts`) holds **all** progress:

| Field | Contents |
|---|---|
| `phase`, `unlocked`, `padsVisible`, `expanded`, `stats` | As before |
| `upgrades` | Levels, 0-based |
| `village` | Revealed, per-plot tier + partial logs/cash, Great Lodge, population, level |
| `flags` | One-shots: `introDone`, `firstTrikeSale`, `conveyorsRevealed`, `shopRevealed`, `finale`, `reveal:<rule>`, `seen:<hint>` |
| `padPaid` | Partial payments per upgrade pad |
| `playTime` | Time played |

The save file is this object, plus money, plus pile contents (`core/Save.ts`, main).

**Loading happens before the systems are constructed.** Every system's constructor initialises itself from `ctx.state`:

- **No private one-shot fields.** If it must survive a reload, it lives in `state` (flags / padPaid / village). For example, Progression's `firstTrikeSale`, `conveyorsRevealed`, `scheduled` and `conveyorTimer` become flags or are recomputed from state.
- **Restored things appear instantly and silently.** No tween, no particle, no sound, no camera move, no `built` / `pad:shown` / `intro:done` / `village:revealed` events.
  - Every `build(instant)`, `appear(instant)`, `expand(instant)` and `show(instant)` honours this.
  - Level calls them with `instant = true` for unlocked stations.
- **Live play writes state as it happens.** A pad writes `padPaid['pad:<id>']` on every reservation and receive. A plot writes its logs and cash through the pad's `onProgress`.
- **Main fills piles and the player's arms after construction.** These are counts, including in-flight reservations (`Pile.total`), plus cash-pile values (`CashPile.restoreValue`, B5).
- `?fresh` in the URL ignores the save (tests).

## Upgrades (`core/Upgrades.ts`, main)

`ctx.upgrades` methods:

| Method | What it does |
|---|---|
| `level(id)`, `maxLevel`, `isMax` | Level queries |
| `value(id)` | Current effect, from `UPGRADES[id].values[level]` |
| `nextValue`, `nextCost` | Values for the next level |
| `requirement(id)` | "Needs Hamlet" or null |
| `canBuy` | Whether a purchase is possible now |
| `buy(id)` | Shop purchase |
| `levelUp(id, position)` | Pad path, already paid |
| `describe(id, level?)` | "16 items", "7.4 m/s", "2.9 chops/s", "×1.3 speed" |
| `group(g)`, `isHired` | Grouping and crew queries |

Every level gain emits `upgrade:bought {id, level, position|null}`. **Systems read `value(id)` live**, so a purchase or a restore applies with no plumbing.

| id | effect read by | values |
|---|---|---|
| carry | Player: `arms.setCapacity(value)` on `upgrade:bought` and at construction | 10 → 25 items |
| speed | Player: walk speed (replaces `PLAYER.speed`) | 6.4 → 9.0 m/s |
| axe | Player: swing interval (replaces `TIMING.chopInterval`) | 0.40 → 0.21 s |
| harvester | Harvester: launch interval | 0.75 → 0.37 s |
| processor | Processor: cycle time (animations scale; no 0.85 s floor) | 1.0 → 0.5 s |
| megaSaw | MegaSaw: cycle time (3 logs per cut) | 1.4 → 0.77 s |
| crateRunner / cashier / logHauler | Crew: `CREW[id]` base × value (0 = not hired) | ×1 → ×2 |

## Demand (`core/demand.ts`, main)

| Function | Returns |
|---|---|
| `demandOf(state)` | Customer gap, queue and want; trike gap and want; truck gap and want; price multiplier for the current village level |
| `salePrice(state, unitPrice, count)` | Amount × multiplier, rounded to a whole $5 bundle |
| `villagePopulation(state)` | Total villagers |
| `villageLevelFor(pop, greatLodgeBuilt)` | Village level |

**Read these at spawn and at pay time, never cache them.** Vehicle queue configs must stop snapshotting price, gap and want.

## Pads

**Every pad pays in chunks.** One flight carries about `cost / TIMING.padFlights`, a multiple of 5, capped at what is left.

- With 24 flights, any cost takes about 1–2 s.
- Bundles may carry any value. `CashStack.receive` already adds `item.value`.
- Zones get `delay: TIMING.padHoldDelay` (0.25 s), so walking across a pad pays nothing.

Pad API (B2, already stubbed):
- `TransferZoneOptions.cashAmount`, `delay`;
- `transferCash`;
- `CashStack.takeValue`.

`UpgradePad` modes:

| State | Pad shows |
|---|---|
| hidden | nothing |
| shown | unlock cost |
| unlocked, machine with levels, level pad revealed | "LV n" + `nextCost` |
| unlocked, no levels or at max | hidden |

`ConstructionPad` takes logs and chunked cash. Each kind's zone turns off when its part is complete, so there is no `stack:full` spam. JuiceDirector also ignores `stack:full` from `pad:*` holders.

## Village layout (`LAYOUT.village`)

The village area is x −0.4…9.6, z 10.8…31.8, between the customer path fence (x −1) and the trike road (x 10.8).

- **Gate:** a gap at x 3.4…5.8 in the south fence (z 10.4).
- **Street:** x 2.6…6.6.
- **Plots:** 3 × 3 m.
  - West row at x 1.1 (doors face +X); east row at x 8.1 (doors face −X).
  - Rows at z 13.4 / 17.0 / 20.6 / 24.2.
  - Unlock order is row by row, away from the gate (`VILLAGE.plotLevels`).
- **Pads:** in the street, at plot x ± 2.2 (size 1.4). The middle lane stays free.
- **Great Lodge:** at (4.6, 29.6), 6 × 3.6, with its pad at (4.6, 26.3).
- **Walking:** the player's walkable area grows by `ColliderWorld.addBounds` with `LAYOUT.village.walk`. These are centre-space rects: the gate corridor and the street. The player never walks onto plots.

## Events added

| Event | When |
|---|---|
| `upgrade:bought` | Any level gain |
| `shop:open` / `shop:close` | Player steps on or off the shop doormat |
| `construction:paid` | A construction pad receives logs or cash |
| `shelter:built` | A shelter tier finishes; plot −1 = Great Lodge |
| `village:revealed` | The gate opens |
| `village:changed` | Population or level changed |
| `village:levelUp` | A new village level |
| `helper:hired` | A crew member first walks out |
| `reveal` | Progression reveals a non-pad item: shop, village, level pad, Great Lodge |
| `finale:start` | The Great Lodge is complete |
| `offline:collected` | The welcome-back Collect was pressed |
| `game:reset` | Settings → Reset confirmed; Game wipes the save and reloads |

## Ownership, wave 4

All slices run in parallel. Stubs for every cross-slice API are already in place and wired, so the game runs and each slice can be tested in the real game.

| slice | owns | delivers |
|---|---|---|
| main | `config.ts`, `core/*`, `level/Level.ts`, `game/Game.ts`, `assets/AssetFactory.ts`, `scripts/*`, docs | contracts, `Upgrades`, `demand`, `Save` + offline + autosave + reset, restore wiring, debug API, wave 5 (bot, rebalance, perf, docs, artifact) |
| B1 engine + characters | `entities/*`, `assets/characters.ts`, `render/characters.ts`, `world/Colliders.ts`, `input/*` | 'worker' crew model (3 variants), Player upgrades (speed, axe, carry) + axe tiers |
| B2 items | `items/*`, `assets/items.ts`, `debug/*` | harden the new item APIs, readable tall carry stacks (≤ ~4.5 m at 25 items), tests of chunked pay |
| B3 world + village | `world/*`, `assets/scenery.ts`, `village/*`, `assets/shelters.ts` | shelters + Great Lodge models, village ground/fence/gate/lanterns, `Village`, decor keep-out, `expand(instant)` |
| B4 juice & HUD (new agent) | `ui/*`, `fx/*` | shop panel, settings + reset, offline card, village badge, finale celebration + stats card, juice + sounds for new events |
| B5 commerce + crew | `npc/*`, `stations/Counter.ts`, `stations/CashPile.ts`, `assets/vehicles.ts`, `assets/shop.ts` | `Crew` (3 helpers), live demand in all queues, rounded sale amounts, chunked payouts, `CashPile.restoreValue`, `planksSold`, `appear(instant)` |
| B6 machines | `stations/{DropZone,GiantLog,Harvester,Processor,Conveyor,beltPath,MegaSaw}.ts`, `assets/machines.ts` | live machine levels, level badge + level-up squash, `build(instant)` |
| B7 progression + pads | `stations/UpgradePad.ts`, `stations/ConstructionPad.ts`, `stations/ShopMat.ts`, `progression/*`, `assets/pads.ts` | chunked + delayed pads, level-pad mode, `ConstructionPad`, `ShopMat`, state-driven init, reveal timeline, guide for the new goals, finale trigger + camera |

**Working rules for builders:**
- Run `npx tsc --noEmit` after every change.
- Run `node scripts/shot.mjs` only at milestones, one run at a time. The machine is a 4-core Pi shared by 7 builders.
- Never edit another slice's files. If you need a change there or in a main file, say so in your report.
