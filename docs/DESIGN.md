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
5. **Finale.** At Winter City the Great Lodge pad appears at the end of the street (100 logs + $25k). Building it brings:
   - a celebration;
   - a stats card;
   - "Winterland" as the final village level, with the best demand.

   The game continues after that.
6. **Persistence.**
   - The game autosaves.
   - A refresh resumes exactly where you were.
   - Coming back after a while shows "While you were away: $X". The amount is the recent sales rate × time away (capped at 2 h) × 0.25.
   - Settings → Reset wipes everything.

Pacing, tuned in wave 5 with the bot (`node scripts/balance.mjs`). The bot walks at the upgraded speed but plays
efficiently; a real player is somewhat slower.

| Milestone | Target | Bot (wave 5) |
|---|---|---|
| Harvester | ~1 min | 1.0 |
| Shop | ~1:15 | 1.1 |
| Village gate | ~2 | 1.3 |
| Hamlet | ~3 | 2.3 |
| Processor | ~4 | 4.1 |
| Crate runner | ~5 | 13.6 |
| Conveyors | ~8 | 7.0 |
| Cashier | ~11 | 25.8 |
| Mega saw | ~15 | 16.4 |
| Town | ~22 | 20.5 |
| Log hauler | ~25 | 40.5 |
| Winter City | ~40 | 35.1 |
| Finale | ~45–55 | 50.8 |

Crew hires come later than planned because the bot saves for unlock pads first; that is fine, since they are a boost
rather than a gate.

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

## Waves 6–7: polish, Timber Ridge, bunkhouse, automation, prestige

### Wave 6 (foundation)
- **Upgrades**: Lumberjack ladders go to 10 levels, machines to 8 and crew to 7. A new **Sales** shop tab sells price multipliers per product: `plankQuality`, `crateQuality`, `bulkDeals` (logs), and later `pineContracts`. `salePrice(state, product, unit, count)` = demand × Sales upgrade × season bonus, rounded to $5.
- **Offline earnings**: rate × time × 0.25, capped at `OFFLINE.maxShareOfEarned` of lifetime earnings.
- **Settings**: Sound, Music (a procedural loop in `fx/Music.ts` that ducks under fanfares), Graphics High/Low (Low turns off shadows and uses pixel ratio 1) and Show FPS (the `ui/PerfOverlay.ts` readout of fps · draw calls · triangles). These choices persist in localStorage `winterland:*`, outside the save.
- **Tests** (`npm test`, vitest): upgrade tables, sale prices, and save compatibility against `tests/fixtures/save-v1-town.json`. Every future state change must keep that fixture loading.
- **CI** (`.github/workflows/ci.yml`): typecheck, tests, build and a headless bot run to the processor. **Release** (`release.yml`): a `v*` tag builds the Linux x64/arm64 and Windows x64 zips and attaches them to a GitHub release.

### Wave 7 (content)
- **Timber Ridge** (`ridge/Ridge.ts`, `LAYOUT.ridge`): the 'ridge' pad opens a gate in the east fence and a crossing over the tricycle road, leading to a pine forest, a log deck and a rail platform. Pines are not saved: the forest regrows after `RIDGE.regrowSeconds`, and a reload starts with a full forest.
- **Tree feller** (pad 'treeFeller'): cuts a pine every `value('treeFeller')` s and stacks `RIDGE.logsPerTree` logs on the deck.
- **Freight trains** (`npc/TrainQueue.ts`) buy logs at the platform for `ECONOMY.pinePrice`, twice the truck price. The price pays for the long walk. Pine is the same `'log'` item kind. The **pine hauler** (crew) only moves deck → platform; the log hauler never touches the deck.
- **Crew bunkhouse** (`ridge/Quarters.ts`, `QUARTERS`): a 3-tier construction pad on the ridge (logs + cash). Each tier allows more helpers per crew role (`core/crew.ts` `crewSlots`, read live). It is required to hire the pine hauler.
- **Truck loader** (pad 'truckLoader'): a belt from the drop zone to the truck counter.
- **Cash tubes** (pad 'cashTubes'): every cash pile banks one bundle every `value('cashTubes')` s.
- **New Season** (prestige; `core/Save.ts` `newSeasonSave`): offered after the finale. It resets all progress, stats and play time (reveal rules read stats). It keeps the `introDone` and `seen:*` hints, and sets season + 1. Every sale then pays +`PRESTIGE.bonusPerSeason` per season, and the season starts with $`PRESTIGE.startMoneyPerSeason` × season.
- **Save**: the world snapshot adds `piles.deck`, `piles.platform` and `cash.platform`. Older saves get 0 for these. `SAVE.version` is unchanged; every addition is additive.
- **Draw-call ceiling**: ~950 at High quality in the late game.
- **Ownership, wave 7**:

  | Builder | Area | Files |
  |---|---|---|
  | B3 | world | `ridge/*`, `world/env/*` |
  | B6 | machines | `stations/TreeFeller`, `TruckLoader`, `CashTubes` |
  | B5 | commerce | `npc/TrainQueue`, `Crew`, `crewHelpers` |
  | B7 | progression | `progression/*`, `assets/pads.ts` |
  | B4 | UI and effects | `ui/*`, `fx/*` |
  | main | everything else | `config`, `core`, `level`, `game`, bot, docs |

## Wave 8: day and night, quests, VIPs and rush hours, the furniture workshop

### 8A: feel and depth
- **Day/night** (`core/DayNight.ts`, `DAYNIGHT`):
  - One day lasts 8 minutes. The clock is saved as `state.clock`. Darkness runs from 0 (day) to 1 (night).
  - Dusk is warm and night is a moonlit blue. Windows and lamps glow (`world/env/glow.ts`), and a screen-space aurora with stars appears (`world/env/aurora.ts`). This costs at most 4 extra draw calls.
  - Day looks exactly as before. Settings → Day/night turns it off (localStorage).
  - It is purely visual; the music gets softer at night.
- **Quests** (`core/quests.ts`):
  - 20 short goals with cash rewards, three on show at a time, in list order. Progress is read from state, so only `state.quests` (completed ids) is saved.
  - At most one completes every 1.5 s. Rewards were halved in tuning, so early pacing barely moves.
  - The UI is `ui/QuestPanel.ts`, a collapsible chip and card.
  - A New Season resets quests. This is deliberate: the rewards can be earned again each season.
- **VIP customers** (`DEMAND[].vipChance`, `VIP.tipMult`):
  - VIPs wear a top hat and gold scarf and have a crown on their order bubble.
  - They tip on top of the sale. The 'sale' event carries `vip` and `tip`, and `amount` excludes the tip. The offline sales rate includes tips.
  - There are no VIPs at Camp level.
- **Rush hours** (`core/Rush.ts`, `RUSH`):
  - Rush hours start once the village is a Hamlet: every 150–240 s comes a 35 s rush.
  - During a rush, walk-ins and tricycles arrive 2.2× as often, and the walk-in queue grows by 2. A banner shows a countdown.
  - Rushes are transient and not saved.
- **Polish:**
  - A one-time "drag to move" hand after the intro (`seen:moveHand`).
  - Vibration on phones, with a Settings switch.
  - **Auto quality:** after 8 s under 40 fps at High, the game switches to Low once, with a toast. It never switches back on its own, and never after a manual choice. It is off in automated runs (`?noauto`, `navigator.webdriver`).

### 8B: furniture workshop and dog sleds
- **Workshop** (pad 'workshop', $15,000, on Timber Ridge; it appears 60 s after the tree feller): logs go into the west hopper and chairs (`'furniture'` items) come out on the east bench, one every `value('workshop')` s. Upgrades are the workshop machine levels and the Sales upgrade "Fine Joinery" (`furnitureQuality`).
- **Dog sleds** (`npc/SledQueue.ts`):
  - A husky team arrives along `LAYOUT.ridge.sledLane` and buys chairs at the sled counter for `ECONOMY.furniturePrice` ($60 each, the best price per log in the game).
  - The money goes to the sled cash pile, which also gets a cash tube.
- **Save**:
  - The world snapshot adds `piles.workshopIn`, `workshopOut` and `sled`, `cash.sled` and `arms.furniture`, and chairs on a loading sled go back onto the counter.
  - `tests/fixtures/save-v2-ridge.json`, a v0.2.0 save, must keep loading.
- **Ownership, wave 8**:

  | Area | Owner |
  |---|---|
  | day/night visuals | B3 (`render/Renderer.ts`, `world/*`) |
  | quests UI and polish | B4 (`ui/*`, `fx/*`) |
  | VIPs, rush hours and sleds | B5 (`npc/*`) |
  | workshop and chair | B6 (`stations/Workshop.ts`, `assets/items.ts`) |
  | progression | B7 |
  | everything else | main (`config`, `core`, `level`, `game`, the bot) |

## Wave 9: bug round, eras and the Market Town

### 9-0: bug round
- **Money:** `ui/format.ts` handles NaN and a T tier. Cash piles, stacks and construction pads count money still in flight, so totals and pad progress no longer dip mid-throw.
- **Rail crossing:** trains sweep the crossing and sleds wait for it (`TrainQueue.sweeping`, `SledQueue.onCrossing`). `rail.stopZ` moved to -0.8.
- **Saves:** `sanitizeState` runs after every merge. A crash-looping save is copied to `.bak` and reset (sessionStorage guard). Offline earnings are credited at load. Fully paid tiers complete silently on load.
- **HUD:** fewer per-frame DOM writes; banners hide while the shop is open; audio re-unlocks on every gesture.

### 9A/9B: eras and the Market Town
- **Eras are the village levels** (Camp 0 → Hamlet → Village → Town → Winter City → Winterland 5). There is no separate counter. The stored level is a floor on load, so older saves never drop an era. **Winter City now needs 110 people** (was 80); town buildings add `BUSINESSES[id].people` to `villagePopulation`.
- **Era visuals** (`world/env/eras.ts`): lamps go torch → lantern → iron; streets go snow → gravel → cobbles; bunting from Town and string lights from Winter City. Each level-up shows the EraCard (`ui/EraCard.ts`, which replaced the level-up toast), and fireworks go off from Town on.
- **Town** (`LAYOUT.town`, `town/*`): revealed 8 s after the village reaches Town (reveal rule 'town', with a camera moment and an open gate). A corridor from the village street leads to a market square with a lit tree, benches, stalls and a snowman, plus eight lots. 0.9.12 Lantern Lane (`town/lane.ts`, `world/env/lantern.ts`): four more lots (8-11) south of the town fence along the south avenue, offered once the new land shows (`laneOpen`: the Great Lodge or era 2), so era 1 is unchanged. Everyone walks the lane's spine (x 28) through the south fence gap (`viaLane`, `planViaLane`); its props stay out of the 8.8 m walk and the lots' fronts (`tests/townLane.test.ts`). Migration `0.9.12-bigger-towns` pads `town.lots` to 12.
- **Building:** an empty lot's pad opens the BuildPanel (`ui/BuildPanel.ts`), listing `choicesFor(era)`. The choice arms a ConstructionPad paid in logs and cash, and it can be changed until the first payment lands. `settlePaidLots` completes fully paid lots on load.
- **Businesses** (`BUSINESSES`, one data-driven `town/Business.ts`):

  | Building | Kind | Era | Cost | People | Makes |
  |---|---|---|---|---|---|
  | Farm | producer | Town | 24 logs, $2,500 | 4 | wheat every 2.6 s |
  | Bakery | shop | Town | 30 logs, $4,000 | 6 | wheat + log → 3 loaves, $30 each |
  | Ranch | producer | Town | 30 logs, $5,000 | 4 | meat every 3.2 s |
  | Butcher | shop | Town | 36 logs, $9,000 | 6 | meat + log → 3 sausages, $55 each |
  | Townhouse | home | Town | 40 logs, $6,000 | 10 | residents |
  | Toy Factory | shop | Winter City | 50 logs, $14,000 | 10 | crate → 2 toys, $45 each |

  Shops sell at their counter to townsfolk buyers (`TOWN.buyerGap` by era, `queuePerShop` 3), and the cash lands on each shop's till.
- **Townsfolk** (`npc/Townsfolk.ts`, `Crowd.ts`, `CrowdNav.ts`): an instanced crowd (about 10 draw calls with shadows at any size, up to `TOWN.crowdMax` 48). They are wanderers who visit the tree, benches and stalls (`TOWN.wanderers` by era), plus shop buyers and shop staff.
- **Porter** (upgrade 'porter', from Town; `npc/townJobs.ts`, `townRoutes.ts`): carries producer goods and firewood to shop hoppers. Cashiers also empty the town tills.
- **Save** (additive; `SAVE.version` unchanged): `state.town = { revealed, lots[8] }`. The world snapshot adds `town[]` (per lot in/out/cash; porter and buyer loads go back to the lot) and arms wheat/meat. Unknown building ids free the lot, and paid amounts are capped. Fixture: `tests/fixtures/save-v3-market.json`.
- **Budget:** the full town at night costs about 440 draw calls at the square and about 810 at the village (cash grid layers went from 20 to 10 to stay under 950).

## Wave 10: desktop comfort

Asked for by a player on the Linux desktop build: borderless fullscreen, finer volume control, and general polish.

- **Window modes** (`desktop/main.cjs`, `desktop/preload.cjs`, `platform/desktop.ts`): Windowed or Fullscreen. Electron's fullscreen is borderless on Linux and Windows (no display-mode switch, alt-tab friendly), so there is no separate borderless mode. The mode, window bounds and maximised flag are remembered in `window.json` in the user-data folder, written atomically and debounced; bounds no longer on any display are ignored. F11 and Alt+Enter toggle in the main process, which announces the change to the renderer so Settings stays in sync. The renderer sees the bridge as `window.winterlandDesktop` (contextBridge; sandbox and contextIsolation stay on). In a browser, the F key and the Settings switch use the Fullscreen API instead.
- **Volume** (`fx/volume.ts`, `AudioFX.getVolume/setVolume`, `Music.setVolume`): three channels, master / sfx / music, 0..1, persisted in `winterland:vol:<channel>`, through a perceptual curve (gain = v²). The graph is voices → compressor → sfxGain → master; music → master. The music volume is folded into `Music.restLevel` together with the night dip, so dusk never resets the slider. The Sound and Music switches are unchanged.
- **Settings tabs** (`ui/SettingsPanel.ts`): Sound, Display, Game; the last tab is remembered. Sliders are `<input type=range>` rows with `touch-action: none` (the card pans vertically) driven by `input` events; the Effects and Master sliders play a pop on release. The confirm views (reset, season, restore) replace the tabbed body.
- **Display options:** Resolution scale 50–100 % (`Renderer.setScale`, `winterland:scale`, multiplies the pixel ratio; Low quality stays at 1 × scale), Frame rate Auto / 60 / 30 (`core/fps.ts`, `Game.fpsCap`: early frames are skipped entirely, so the simulation never slows; default Auto so the bot and CI are untouched).
- **Shortcuts** (`Input.onShortcut` → Game → events `ui:escape`, `ui:mute`, `ui:fullscreen`): Esc closes the topmost panel (settings, shop, build menu), then folds the quest card, else opens Settings. M mutes. F toggles fullscreen; F11 / Alt+Enter do too in a browser, but not under `app://`, where the main process already handles them. Shortcuts are ignored while typing in a field, on key repeat, and with Ctrl / Meta held.
- **Zoom** (`CameraRig.userZoom`, 0.8–1.3): a separate multiplier on the game's own `zoom`, so phase zooms and camera moments still work. `userZoom` is the target; `userZoomShown` is the eased value the frustum uses. The wheel over the canvas gives ±0.1 per notch, + / − keys the same, and a two-finger pinch releases the joystick and zooms by about 0.3 across the gesture (`Input.onZoom` → `camera:zoom`).
- **Save backup / restore** (`ui/saveTransfer.ts`): Back up downloads the raw save text as `winterland-save-<date>.json`. Restore validates the file (version, state, money, savedAt) behind a confirm view, then emits `save:restore`; Game stops autosaving (its pagehide save would otherwise overwrite the file on the way out), writes the text and reloads. Verified across a real reload.
- **Keys** added to localStorage: `winterland:vol:master|sfx|music`, `winterland:scale`, `winterland:fps`, `winterland:settingsTab`.
- **Ownership, wave 10:** desktop shell (`desktop/*`, README desktop section), audio (`fx/Audio|Music|volume.ts`), engine (`input/Input.ts`, `render/CameraRig|Renderer.ts`), UI (`ui/SettingsPanel|HUD|ShopPanel|BuildPanel|saveTransfer.ts`, `hud.css`); contracts, `Game.ts`, `core/fps.ts`, `platform/desktop.ts` and docs in the main session.

### 10b: hold to interact, village pad spacing
Asked for after the first desktop session: "I end up upgrading a different house than I want to".
- **Why it happened:** the village pads sat 2.6 m apart across a 4 m street with accept zones 1.2× their tile, leaving a 0.9 m lane in the middle; walking down the street clipped one side or the other.
- **Spacing** (`LAYOUT.village.padOffset` 2.15, `padSize` 1.3; `ConstructionPad` accept zone = the tile, not ×1.2): tiles now hug the plots (x 2.6–3.9 and 5.3–6.6), so the middle 1.4 m of the street pays for nothing. The Great Lodge pad keeps a 0.55 m gap to the last row. Nothing outside `config.ts` holds plot positions (the bot reads `padSpot`).
- **Hold to interact** (`core/interact.ts`, `Input.holdToInteract` / `interactHeld`, `Zones` transfer `kind`): transfer zones are tagged `take` (DropZone, processor output, workshop bench, feller deck, business output), `pay` (construction pad logs and cash, upgrade pads) or `give` (default: hoppers, counters, cash collection). With the setting on, `take` and `pay` zones only run while E, Space or a pointer press with the stick inside its dead zone is held; the gate sits before the zone timers, so nothing banks up and bursts on the key. While a gated zone could move something and the key is up, `interact:prompt` shows the InteractChip ("Hold to pick up" / "Hold to pay", with an E keycap on fine pointers) above the player, and the guide's "Pick up …" / "Pay for …" hints end with "(hold E)". The default is on with a fine pointer and off on touch and for automated runs (`navigator.webdriver`), persisted in `winterland:holdInteract`; Settings → Game has the switch. `__WINTERLAND__.setInteract(true|false|null)` overrides it for tests.
- **Deliberate:** cash collection and drop-offs stay automatic (never a mistake). Releasing the key on a pad restarts `padHoldDelay`.

## Wave 11: automation

The workshop was the one loop with no helper at either end, and the late game still needed the player to pay every pad.
- **Sled Loader** (crew 'sledLoader', `npc/SledLoader.ts`, requires the workshop; $6,000 to hire): chairs from the workshop bench to the dog-sled counter (3 at a time, or 1 when the counter is empty), and firewood for the workshop hopper when it holds fewer than `PRIORITIES.workshopLow` (6) logs, from the pine deck or else the yard drop pile. Work posts: bench (28.2, 4.8), counter (25.0, 5.0), hopper (21.9, 1.8); all ≥ 0.25 m off the bench, counter, cash and hopper zones and north of the sled lane (tested in `tests/sledLoader.test.ts`). Two loaders never take the same job.
- **Foreman** (crew 'foreman', `npc/Foreman.ts`, requires Winter City; $20,000): the auto-builder. Picks the nearest site that needs logs or cash among the village plots, the town lots with a chosen building and the crew quarters, with a 3 m preference for cash-only sites. **Never the Great Lodge**, so the finale stays the player's press. Hauls up to 8 logs from the drop pile or the pine deck and unloads them into the pad as an ItemHolder; pays cash in `PRIORITIES.payChunk` ($250) chunks every `payInterval` through `ConstructionPad.payDirect()`, which credits the pad exactly like a landed bundle (progress reported to the save, 'construction:paid', completion), while the wallet keeps `max($500, 20 %)`. Routes: village street; the corridor and square for lots (bending round the Great Lodge pad); the ridge route for the quarters. Verified across a save/reload mid-payment.
- **Crew priorities** (`state.priorities`, Shop → Crew tab, shown once anyone is hired): **Wood** Balanced / Trucks / Trains / Workshop and **Town** Balanced / Bakery / Butcher / Toys. Balanced sends the log hauler to the emptier counter; Trucks always the truck counter first. The pine hauler diverts a load to the workshop hopper when Workshop is chosen, or whenever the hopper is low and no sled loader is hired; Trains never diverts. The porter adds `PRIORITIES.weight` (1.5) to the favoured shop's score in `townJobs.pickJob` / `pickShop`. Sanitized to the enum on load.
- **Save:** carried logs of the foreman and sled loader go back to the drop pile, the sled loader's chairs back to the bench. Fixture `tests/fixtures/save-v4-automation.json` (both roles hired, priorities set, a half-built town).
- **Bot:** buys the new hires like any crew upgrade; no plan change. Finale at 66.8 min (was 63.7).
- **Budget:** 526 draw calls at the village at night with all 8 lots built and every role at its top slot count (the crowd and crew are cheap; the cash grid was the earlier 810).

## Wave 12: town life

- **Amenities** (`AMENITIES`, `LAYOUT.town.amenities`, `town/Town.ts`, `assets/townAmenities.ts`): four fixed sites on the square built like the Great Lodge (a ConstructionPad in front; `state.town.amenities[id] = {tier, logs, cash}`, tier 0 = built; `settlePaidAmenities` completes paid ones on load). Cocoa Café (20 logs, $3,000, +25 %), Snowman Park (14, $1,500, +20 %), Bandstand (28, $5,000, +25 %) from Town; Skating Pond (36, $9,000, +30 %) from Winter City. The sites were shrunk from the first draft so that every footprint and pad keeps ≥ 0.3 m from the lot pads, benches, stalls, the tree ring, the snowman, the corridor mouth, the shop queues and lamps (`tests/townAmenities.test.ts`); three of the eight tree-ring spots are now taken. Each model is two meshes (body + glow); all four cost +11 draw calls at night.
- **Happiness** (`townHappiness(state)` 0..1 = the sum of built amenities' shares; `happinessMult` = 1 + 0.3 × happiness): applied in `salePrice`, so **every buyer** pays more, village and town alike. The village badge shows a heart chip once the town is revealed; three quests (first amenity, 50 % happiness, all four).
- **Life** (`npc/Townsfolk.ts`, `CrowdNav.ts`): shop and producer staff walk home at dusk (darkness > 0.6) to the nearest built townhouse door or the corridor entrance and come back at dawn (< 0.45); shops keep working without visible staff. Carolers: from Town, three wanderers take three consecutive tree-ring spots at night with lanterns, pulse the talk channel on a 1.6 s beat and play a soft chime motif [1, 1.25, 1.5, 1.25, 1.125, 1] while the player is within 14 m. Amenity acts: café stools, a skating loop on the pond rim (≤ 3 skaters), the bandstand audience (cheering at night), the snowman park for kids. Night market: at Winter City the night crowd grows by 6 instead of thinning, the stall weight doubles, and the stalls get bulb strings and halos (`eras.ts` `nightMarket`, +1 draw call at night).
- **Ambience:** footprints (`fx/Footprints.ts`: one InstancedMesh of 64 fading prints every 0.42 m, on open snow only — not in the yard, on the road, in the village or the town; off at Low quality); a bell toll 3× at dusk and 2× at dawn from Town (`'bellToll'` sfx); café steam.
- **Crowd nav:** the four footprints are static crowd obstacles (the café's kiosk half only, so its stools stay reachable); `TREE_RING` skips angles inside an amenity (8 → 5 spots) and the snowman ring skips slots inside the park. **Skaters deliberately glide across the pond** (the pond collider blocks only the player); don't "fix" that.
- **Save:** additive; older saves get unbuilt amenities. Fixture `tests/fixtures/save-v5-town-life.json`.
- **Known flake:** `scripts/check-reveals.mjs` reported "1 check(s) failed" once in five runs during this wave (the line was not captured); three captured reruns were clean. If it recurs on CI, rerun and capture the log.

## Wave 13: events, contracts, the dog, the Grand Market

- **World events** (`EVENTS`, `core/WorldEvents.ts`, transient like rush hours): from the Village, every 240–420 s one of **Snowstorm** (60 s: walk speed × 0.6, the porter's firewood thresholds × 2, snowfall × 3 with faster, bigger flakes), **Festival day** (90 s: townsfolk buy 2× as often) or **Northern lights** (120 s, only at night: prices × 1.25 through `demand.setTransientPriceMult`, aurora strength 1.8). Random without an immediate repeat; the aurora waits for a night. `ui/EventBanner.ts` stacks under the rush banner. `__WINTERLAND__.startEvent(kind)`.
- **Contracts** (`CONTRACTS`, `core/Contracts.ts`, saved in `state.contract`): from Town, every 150–260 s the gate's notice board (`world/env/gate.ts`, paper shown while posted) offers one of planks 40 / crates 30 / loaves 20 / chairs 12 / sausages 15 / toys 10 within 180 s for a $800–3,000 bonus, only kinds the player can make (`requires`: a pad or a built business). Progress counts 'sale' events of that kind; done pays the bonus, timeout fails. `ui/ContractCard.ts` sits under the quest card (pulses red in the last 20 s). `__WINTERLAND__.offerContract(kind?)`.
- **Sled Dog** (upgrade 'dog', Lumberjack tab, from the Village; values = extra carry 2 / 3 / 4 / 6): `entities/Dog.ts` follows 1.2 m behind (lag 0.25 s, snaps after a teleport), sits after 1.5 s still, wags, woofs; a saddlebag shows while the arms hold more than the base capacity. +3 draw calls. No colliders, flat ground only.
- **Grand Market** (`VILLAGE.grandMarket` 120 logs / $60,000 / 20 toys, `LAYOUT.town.grandMarket` in the district's south-east corner, pad on its north side): offered once the village is Winterland (after the Great Lodge). `ConstructionPad` gained an optional third input `extra {kind, count}` (zone kinds ['log', kind], `extraLeft`, `onProgress(paidLogs, paidCash, paidExtra)`, three sign rows). Toys are now carryable (`CARRY_KINDS` + the save's arms record) and the toy factory's counter has a player pickup. Completing it emits `finale2:start`: fireworks, fanfare and the "Grand Market opens!" FinaleCard variant; flag `grandMarket`. `assets/grandMarket.ts` is a 3-call hall (clock gable, colonnade, lanterns, two chimneys). Winterland era dressing: denser sparkle and gold-tinted string lights. `Town.debugBuildGrandMarket()`.
- **Bot:** builds the Grand Market after the Great Lodge (goal 'grandMarket'), fetching toys from the toy factory's pickup.
- **Save:** additive; fixture `tests/fixtures/save-v6-events.json` (an active contract, the dog, a half-paid Grand Market).

## Wave 14: the Ages (0.9.0)

Survival (era 1) is everything up to 0.8.0 and plays exactly as it did until the Great Lodge is built. From the Lodge on, the game climbs through nine more eras. The full design, with the rule conflicts and their interpretations, is in `docs/EXPANSION.md`.

### Eras, regions and machines
- **Ten eras** (`src/eras/data.ts` `ERAS`): 1 Survival, 2 Frontier, 3 Iron Age, 4 Steam Age, 5 Industrial, 6 Electric Age, 7 Oil Age, 8 Computer Age, 9 Nuclear Power, 10 AI Era. `state.eras.age` is the highest era reached.
- **Regions** (`REGIONS`, `eras/layout.ts`, `eras/EraWorld.ts`, `Region.ts`): each era is bought as a land expansion south of the old map: a pad that takes cash (1.5M × 3^(n−2)) plus the previous era's refined material. It opens a fenced region with 4 to 8 machine slots, an export depot, an import dock, Jack's cart, an era shop mat and an era crew (`npc/EraCrew.ts`, `EraWorker.ts`). Partial pad payments are kept.
- **Machines** (`MACHINES`, `eras/Machine.ts`, `assets/eraMachines.ts`): 22 extractors and processors, chosen per slot in the ChoosePanel, with 18 new carried materials (`core/kinds.ts`, `assets/eraItems.ts`). Every era has Rigs and Crew upgrades (its Trade upgrade was merged into the Fine upgrades in 0.9.6, decision 9). Era prices sit ×10 above Survival's last prices (`ERA_SCALE`).
- **Region markets** (0.9.5, `eras/RegionMarket.ts`, `eras/market.ts`, `npc/EraBuyers.ts`, `npc/EraShoppers.ts`, `TRADE_POST`): every region has era 1's customers in its market zone. A **loading dock** stands against the fence west of the market gate, and buyer pickups in the era's colours drive along the road outside, stop at it, load one material (the one the dock has most of), pay and drive on. A **market stall** stands inside, and walk-in shoppers come through the market gate, line up at it, take 1–4 goods and leave the same way. Both pay into one **cash pile** south of the stall (era 1's CashPile), which the player (or a crew) walks over to bank. The export depot hands everything it receives (the player's drops, the crew's deliveries) to the dock (raw goods) or the stall (refined goods), to the other one when that is full, and sells at once only when both are full, so no new chore appears; the player can also drop goods straight on either counter. Buyers pay the export price × the material's Quality upgrade (`Market.marketPrice`). Sales upgrades per era, era 1's dock / counter / quality trio: **Loading Dock** (`${key}Dock`) and **Market Stall** (`${key}Stall`) grow their counter (14 → 40) and bring buyers ×value as often, loading up to ×4 as fast; **Fine <material>** (`${kind}Quality`, one per era material, in that material's era) ×1 → ×2.2. Saves keep both counters, goods held by unpaid buyers and the cash pile (`WorldSnapshot.eras[n].market`, absent before → empty). The era's **Clerk** banks the cash pile before any other job (one clerk at a time, money credited as each bundle leaves the pile). Each era's **cash machine** (`eras/CashMachine.ts`, `${key}Cash`: Strongbox, Mint Chute, Pneumatic Tubes, Bank Vault, Till Line, Drive-Thru Vault, ATM Network, Atomic Vault, Quantum Bank) is era 1's Cash Tubes: its level pad stands east of the cash pile from the start, Lv 1 builds it south of the pile and every level banks faster (1.2 → 5.6 bundles a second at Lv 10). Pad-only, like the machine levels; part of the next era's gate.
- **Roads and land** (`world/env/frontier.ts`): the new land, roads and FOR SALE signs appear only once the climb is open, so nothing new shows before the Great Lodge (`scripts/check-reveals.mjs`).

### Market, Jack and the city
- **Market** (`core/Market.ts`, `ui/MarketPanel.ts`): price indexes per material (random walk, reversion, supply pressure), trading with a spread (narrowed by the Broker), physical orders delivered to a region's import dock, bonds, an index fund and era ventures, and a net-worth line. An order costs at least 1.1 × the material value × Trade, so ordering and exporting never loops money.
- **Jack of all trades** (`npc/Jack.ts`, `assets/jack.ts`): a swap cart in the yard (with the shop) and in every region that buys any carried item at 30 % to 75 % of its value (`jack` upgrade, up to 90 % in the climb). It is a discard, never a profit.
- **The city** (`city/City.ts`, `District.ts`, `assets/cityBuildings.ts`, `world/env/skyline.ts`): nine districts east of the Market Town, one per era, with 12 to 18 lots each (0.9.12: 1.5-2× the 0.9.11 lots, on 44 × 34 m plots). Homes, workplaces, parks and landmarks pay rent and business income. Ranks run Town → City → Big City → Megacity → Metropolis, with an instanced skyline of up to 220 towers.
- **Demolish** (`ui/ManagePanel.ts`): Market Town lots, machine slots and city lots can be cleared for max($250, 20 % of the build price), with no refund.
- **UI:** Map (T, fast travel through `travelPoints`) and Market (B) buttons in the HUD, the EraChip with the income ticker, the AgeCard on a new era, and Industry and Finance tabs in the shop.

### The climb (0.9.5 per-era Lv 10 rule; docs/EXPANSION.md §A–C for the history)
- **Each era levels its own things 1 to 10** (`GATE.mode` 'literal', `core/ladder.ts`, `core/Upgrades.ts`): every upgrade caps at Lv 10, the top level. Era 1's authored tables are the 0.8.0 ones (`tests/era1Frozen.test.ts`); every era 2–10 upgrade (machine levels, crew roles, Rigs / Belts, Dock / Stall / Fine, the player's era gear) goes from Lv 1 to Lv 10 on its pad or its era's shop mat. Earlier eras stay at 10 forever. A level an older save stored above 10 reads as 10 (decision 2 refunds the excess in 0.9.6). The 0.9.0 offset ladder to Lv 100 and its `stored + 10·(e − 1)` display are gone from play.
- **The era gate** (`eras/gate.ts`, `ui/GateCard.ts`, `eras/GateTracker.ts`): era N + 1 needs every upgrade introduced in era N at Lv 10 (unbuilt machines and unhired crew count; their row says what comes first), settlement 5·N, then the paid expansion pad. The rule is said in words on the era card, the gate card and the map (`gateRuleText`, 0.9.6: "Raise Granite Hollow's machines, crew and upgrades to Lv 10 and grow to Settlement 10, then buy Iron Ridge."). The GateCard is a read-only checklist: a small bar per group (Machines, Crew, Industry, Sales, You, Finance), the top five open rows with **Go** (fast travel to the level pad, the cabin's shop mat or the era's shop mat where it is bought, or to what unlocks it) and "+N more · Show all" that lists every open row. A row that only waits for the settlement shows "Locked" instead of Go; the settlement line below it is the way there. The EraChip and the guide show one next goal (`nextGoal`): something to build first, then the cheapest affordable row, then the settlement step ("Build a home in Brickside"), then what to save up for.
- **Upgrades are hands-on: stand on pads.** (Owner decision.) Every level is bought in person: a machine level on its level pad, a shop or Industry level on a shop mat with one Buy press per level, the shop panel opening only while the player stands on a mat (as in 0.8.0). There is no Buy ×10, no Raise all, no buying from the checklist and no auto-buyer.
- **Settlement 6–50** (`core/demand.ts`, `SETTLEMENT`): past Winterland, the settlement level comes from the city population (district residents plus machine staff, the village excluded), five levels per era band, named Frontier Post … Winterland Prime. Since 0.9.6 (decision 7) it rises freely to 50 from era 2 on, so every home always counts; it used to stop at 5 × the era and jump five steps when the next era opened. Only homes add residents, and the district's build card says so ("+40 settlement" / "no settlement"). The best level ever reached is saved in `state.eras.settlement`, so demolishing never lowers it. Each level brings the era card, a walk-over gift cash pile and **Renown** (+2 % on sales, exports and city income per level past 5). Band perks: the era's quest trio, city happiness, one more investment position, and a Charter at the band's top.
- **Mastery** (`climbMult`): a leftover of the 0.9.0 ladder (a point per level bought past an effect's hard cap). No level passes the cap under the Lv 10 rule, so no new points are earned; decision 6 removes it in 0.9.7 and old saves keep what they earned as a one-off.
- **The ending** (decisions 3–5, 0.9.7): the 100 % completion award is the finale: every upgrade at Lv 10, every build, every quest, Settlement 50 and all ten eras, with a completion % always on screen. The Great Lodge card becomes "Survival complete, the Frontier awaits", and New Season is offered only on the 100 % card.
- **Contracts and quests follow the era** (0.9.6): from era 2 a contract asks for one of the current era's goods its built machines make and pays a couple of minutes of recent sales; quests list the current era's first and pay at least a minute of sales (`core/incomeWindow.ts`). Era 1 keeps its authored offers and rewards.
- **Founder's Scarf** (`SETTLEMENT.founder`, `assets/characters.ts`): the Settlement 20 perk. The player wears a red-and-gold knitted scarf from then on, and Renown gets ×1.05 on top. Cosmetic and small; it adds no gate row and buys nothing.
- **Pacing** (`core/pacing.ts`, `tests/pacing.test.ts`): a pure model checks that every era takes longer than the last, without running the bot. Its buyer walks: one purchase at a time, at least 8 s each (`PACING.walkPerBuy`). Model minutes per era: 99, 110, 115, 124, 134, 145, 155, 166, 177 (era 2 to the finale), 1,340 in all after the Lodge.

### Save, budget and fixes
- **Save** (additive; `SAVE.version` unchanged): `state.eras` (age, regions with slots and pad payments, settlement), `state.city`, `state.market`; the world snapshot adds per-region slot piles and docks. Fixtures: `tests/fixtures/save-v7-eras.json` (a mid-game Ages save) and `save-v8-climb.json` (the Great Lodge built, levels past the authored max, Settlement 8, a half-paid era-3 pad; it still carries the removed Steward flag, which loading drops). Every older fixture still loads.
- **Hidden pile interiors** (`items/Pile.ts`): on a single-kind pile that does not move, items whose top and camera-facing sides are covered are not drawn. A full drop zone draws 48 logs instead of 84.
- **Draw calls at High, night, late save** (every era open, 52 machines, 71 city buildings, all upgrades at shown Lv 40, settlement 50; 6 frames each): village 780–817 (0.8.0 on the same Survival setup: 729–847), town square 699–789 (0.8.0: 627–709), region 2 343–354, a full era-10 district 176–183, district 2 346–417. The yard is the heaviest view: 905–1,043 against 0.8.0's 921–967 on the same setup, driven by climb-speed crews and items in flight. See `docs/ROADMAP.md`.
- **Era palettes** (`eras/data.ts` `colors`, `docs/art/guide.md`): each era 2–10 holds its row of ARGON's table (ground, fence, machine body, accent, trim, glow, worker coat), read by the regions, crews, districts and machine glows; the machines of eras 6–10 and the era 9–10 materials and icons take their colours from it too. Era 1 keeps its 0.8.0 colours. Glows are amber, peach, soft teal or warm mint (era-10 windows glow sun-gold at night).
- **Pads** (`fx/PadRing.ts`, `fx/padJuice.ts`): a soft fill ring eases around a pad as cash lands, bundles arc in with a gentle squash, an affordable pad breathes a warm glow, and a completion bounces with a warm chord, a snow-sparkle pop and a haptic tap. Pay ticks climb a pentatonic ladder, with per-sound voice caps, through the SFX volume. With Reduce motion on (the in-game Settings switch, which follows the OS until the player picks; 0.9.6) bounces shrink to a quarter and particle bursts are skipped. Visual and audio only: drain rates and costs are unchanged.
- **Cosmetic:** the era review sheets moved to their own gallery domain (`?gallery=eraSheets` or `?gallery=era5`).
