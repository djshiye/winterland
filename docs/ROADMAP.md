# Winterland roadmap

**Where it stands (2026-10-16): 0.9.5 is released; 0.9.6 (fixes) is in progress, then 0.9.7, 0.9.8 and 1.0.0.**
The 1.0 plan, its fifteen decisions (all answered "as recommended" on 2026-10-16) and the audits behind it are in the
"Winterland 1.0 Plan" doc and the project's `audit-1.0/` folder.

## The rules every release keeps

- **Each era levels its own things 1 to 10, then stops (0.9.5, Dino).** Every era's machines, crew, Industry
  (Rigs, Belts), sales upgrades (Dock, Stall and one Fine upgrade per material, which replaced Trade in 0.9.6) and the player's own era gear go from Lv 1 to Lv 10 on pads and shop mats and
  cap there. Earlier eras stay at Lv 10 forever; nothing is ever levelled past 10, in any era.
- **The era gate:** era N + 1 opens when every upgrade introduced in era N is at Lv 10, the settlement has reached
  5·N, and the expansion pad (cash plus some of era N's material) is paid. Unbuilt machines and unhired crew count
  (their rows say what to build or hire first). The gate card, the era card, the map and the goal line all say this
  in words (0.9.6).
- **Settlement rises freely (decision 7, 0.9.6).** City homes and era machine staff raise the settlement level from 6
  up to 50 in any era from 2 on; it never waits for the next era and never jumps five steps at once. Only homes add
  population, and the district's build card says so. Era 1 has no city, so its settlement stays the village level
  (0 to 5).
- **Upgrades are hands-on: stand on pads.** Every level is bought in person on a level pad or a shop mat, one at a
  time. No auto-buyer, no Raise all, no Buy ×10, no buying from the checklist or from afar. The gate card's Go only
  walks you there.
- **Era 1 (Survival) plays exactly as it does today:** prices, levels, reveal order and layout are locked by
  `tests/era1Frozen.test.ts`. Its look may be restyled in the overhaul (decision 10).
- **Old saves always load,** and nothing is taken away without giving it back (decision 2: levels above 10 from
  0.9.0–0.9.4 are refunded as cash).
- **Releases** ship for Windows, Mac and Linux, versioned x.y.z (the updater rejects four parts), and older releases
  stay up.
- **Cozy and ADHD-friendly:** one clear next goal, short sessions pay off, nothing punishing. The goal line always
  shows something you can do now first (an affordable pad), then the settlement step ("Build a home in Brickside"),
  then what to save up for.
- **Comfort settings reach everything:** the in-game Reduce motion switch drives every pad bounce, flight and burst
  (0.9.6), and effects follow Calm / Minimal.
- **Draw-call budget:** 950 or fewer per frame on a late save, checked every release.
- **No external asset files:** models through the AssetFactory, textures drawn on canvas, audio synthesized.

## The ending (decisions 3 to 5, built in 0.9.7)

- **The 100 % completion award is the finale.** 100 % means: every upgrade at Lv 10, every build, every quest,
  Settlement 50 and all ten eras. A completion % is always on screen with the next missing piece, and the award is a
  trophy on the Great Lodge plaza with a celebration that respects Calm mode.
- **The Great Lodge card** becomes "Survival complete, the Frontier awaits" (it no longer says the game is complete).
- **New Season** is offered only on the 100 % card; trophies survive it.
- **Mastery is removed** (decision 6): it rewarded levels past a cap, which no longer exist. Old saves keep the bonus
  they earned as a one-off.

## Next releases

1. **0.9.6, fixes (four parallel threads, then one release):**
   - Economy: both money exploits (orders resold at era markets; index fund and ventures growing per minute), Lv 10 as
     the biggest step of every upgrade, dead dog and Pal levels, one price curve per era, a shorter post-Lodge climb.
   - Era chains and crews: every era fed from its own land (eras 4, 8 and 10 no longer need older eras' materials),
     workers feed factories before selling raw goods, buyers keep up, Gatherers haul the hand node, no shove over the
     fence on build, new era 5 and 10 resources (pig iron, data shards; decision 15).
   - Save safety and security: broken saves are kept with a warning, rolling backups, one game window, the old-save
     refund, Save & quit, cheat menu and DevTools out of the release.
   - Clarity: the goal line order, settlement rising freely, era contracts and quest rewards, the map (numerals on
     regions only), era shop tabs, a grouped gate card that hides nothing, Reduce motion on pads, MANAGE signs only
     nearby, one population number, the guide following where you stand, and the Lv 10 rule explained in-game.
2. **0.9.7, systems:** the ending and 100 % (above); era plots with worker huts, a market street, more slots, era
   vehicles and cash machines; districts with residents that grow toward a metropolis; comfort and controls (UI size,
   gamepad, keyboard menus, a per-era starter guide).
3. **0.9.8, the look ("snow-globe toy diorama", decisions 11–12):** one warm palette and light, a floor per era, warm
   recolours of the near-black machines, new characters, quilted pads with hanging price tags, cream menus and icons.
4. **1.0.0, release candidate:** each era reviewed with Dino, signing if Winterland goes public (decision 13), GitHub
   plus itch.io (decision 14), README and credits, an update from 0.9.x tested on a copy of a save.

## Done so far

- **0.9.1–0.9.5 are released:** Market Town walkability, the Grand Market guide, dock upgrades, the region map,
  bigger Market Town (0.9.4), the "Update Winterland" updater (0.9.3), and 0.9.5's eras 2–10 made as complete as era 1
  (full crews, belts, customers, roads, machine level pads) with the per-era Lv 10 rule.
- **0.9.0 "Ages" is done** (Wave 14 in `docs/DESIGN.md`, design in `docs/EXPANSION.md`): ten eras with a fenced region
  each (machine slots, export depot, import dock, era crew), 22 era machines and 18 materials, Jack's swap cart, the
  market (prices, trading, orders, bonds, an index fund, ventures), pay-to-demolish, nine city districts with a
  skyline, and the first climb (later replaced by the 0.9.5 per-era Lv 10 rule above), settlement levels 6–50 with
  Renown and gifts, the Founder's Scarf and the GateCard checklist.
- **Upgrades are hands-on: stand on pads.** (Owner decision.) Every level is bought in person, on a level pad or a shop
  mat, one at a time. No auto-buyer (the Steward is gone), no Raise all, no Buy ×10 and no buying from the checklist
  or from afar; the GateCard's Go takes the player to the pad or mat. Keep it that way in every later release.
- The "make it a game" list is done, plus the village and the Great Lodge finale.
- **Waves 6–7 are done:**
  - longer upgrade ladders and the Sales tab;
  - music, graphics quality, FPS overlay;
  - tests and CI;
  - Timber Ridge, the bunkhouse, the feller, the loader, the tubes and trains;
  - New Season.
- **Wave 8 is done** (see `docs/DESIGN.md`): day/night with an aurora, 20 quests, VIP customers and rush hours, the onboarding hand, vibration, auto quality, and the furniture workshop with dog sleds.
- **Wave 9 is done** (see `docs/DESIGN.md`): a bug-fix round (money formatting, in-flight accounting, the rail crossing, crash-safe saves, offline earnings), then eras and the Market Town: eight lots, six buildable businesses, an instanced crowd of townsfolk, the Porter crew, era visuals, the era card and fireworks.
- The autoplay bot finishes in about 64 minutes. Milestones: Town 19, porter 23, farm 24, bakery 36, ranch 45, Winter City 56, finale 64. It sells about 190 town goods.
- **Wave 10 is done** (desktop comfort, see `docs/DESIGN.md`): window modes remembered across launches, three volume sliders, a tabbed Settings card, Esc / M / F shortcuts, wheel and pinch zoom, a resolution scale, a frame-rate cap, and save backup / restore as a file; then hold-to-interact (E / Space / a still press) and wider village pad spacing after a desktop playtest.
- **Wave 11 is done** (automation, see `docs/DESIGN.md`): the Sled Loader (chairs to the sleds, firewood to the workshop), the Foreman (hauls logs to and pays for the next house, lot or bunkhouse), crew priorities for wood and the town, and a workshop route for the pine hauler.
- **Wave 13 is done** (events and content, see `docs/DESIGN.md`): world events (snowstorm, festival day, northern lights), delivery contracts from the gate's notice board, the Sled Dog companion, and the Winterland era's Grand Market (logs, cash and toys) with a second finale.
- **Wave 12 is done** (town life, see `docs/DESIGN.md`): the four square amenities (cocoa café, snowman park, bandstand, skating pond) with town happiness raising every price by up to 30 %, commuting staff, carolers at the tree, amenity visitors and skaters, a night market at Winter City, footprints in the snow and bells at dawn and dusk.
- Late-game draw calls at High quality (0.9.0, every era open, night): village 780–817, town square 699–789, region 2
  about 350, a full district 176–417. The yard peaks at about 1,040 (0.8.0 already reached 967 there). The ceiling is ~950.
- Every save since v0.1 loads. Fixtures are in `tests/fixtures/` (the newest is `save-v8-climb.json`).


## 0.9.0 notes kept from the handoff

Decisions made without asking (in the 0.9.0 release notes):
- 0.8.0 had shipped when the request came in, so the Ages are **0.9.0** (the request said "0.8").
- Village levels are called **settlement** levels ("Settlement III · Town"); "Era" means the Ages.
- An order's price at the market includes the era's Trade multiplier (no order → export money loop).
- Era crews reserve only the materials still owed on expansion, machine and city pads.
- The era gate replaced the first rule (era 2 at Winter City): nothing new shows before the Great Lodge.

Debug API (`window.__WINTERLAND__`): `skipIntro, addMoney, teleport, simulate, setTimeOfDay(0.75 = night),
revealTown, buildTown, setUpgrade, save, saveData, unlockEra(n), buildMachine(n, slot, id), buildCity(n, lot, id),
travel('region:n' | 'district:n' | 'yard' | 'village' | 'town'), climb(), gate(n), setAllUpgrades(shown),
setSettlement(L)`. Galleries: `?gallery=eraMachines`, `eraSheets` (or `era2`..`era10`), `eraItems`, `eraWorkers`,
`cityBuildings`, `frontierProps`, `jack`, `padMachine`.

Draw calls (`scripts/shot.mjs` + the renderer's `info.render.calls`, High, night, six frames each, a late save with
every era open, 52 machines, 71 city buildings and all upgrades at shown Lv 40; 0.8.0 measured from the `v0.8.0` tag
on the same Survival setup):

| View | 0.9.0 | 0.8.0 |
|---|---|---|
| Village | 780–817 | 729–847 |
| Town square | 699–789 | 627–709 |
| Yard | 905–1,043 | 921–967 |
| Region 2 | 343–354 | — |
| District 10 (full) | 176–183 | — |
| District 2 (full) | 346–417 | — |

Still open from 0.9.0 (small):
- **The yard view at night** goes past 950 in the late climb (crews at climb speed carry more and more items are in
  flight; 0.8.0 already reached 967 there). Hidden pile interiors took about 36 calls off a full drop zone. The next
  lever is pile instancing (below), or instanced carried items for the Survival crews.
- The AgeCard can overlap the WASD hint on a fresh game; the phone income ticker can overlap the quests chip.
- Each region slot makes its own LotPad canvas texture (up to 72); they could share.
- The south avenue passes between the two south Market Town lots through a 1.2 m gap when both are built
  (walkable; the lots are era-1 layout, so they stay).
- The old tricycle road runs under region 2 to z 70; the region's ground covers it (era-1 layout, so it stays).
- A by-hand end-to-end pass through the debug API (fresh game → Great Lodge → gate → region 2 → machines → depot →
  Jack → market → district → demolish → map) before the release tag.

## What the playtests show

| Finding | Evidence |
|---|---|
| A refresh restarts from $0 | Nothing is persisted except the mute toggle (`fx/Audio.ts`). |
| The content stops dead | After the mega saw, the guide goes quiet and nothing is left to unlock. |
| Money has nowhere to go | The bot holds **$2,215 after 90 s of phase 5**. Total spend in the whole game is $800. |
| The player never grows | Carry capacity 10 and move speed 6.4 are fixed, with no upgrades. |
| Some loops are still manual (by design so far) | Crates go from the bench to the SE counter by hand, cash is collected by hand, and logs reach the trucks by hand. |
| Gaps | No music. No tests or CI. Never run on a real phone GPU. |

## The fork: game or playable ad

The original brief said "in the style of mobile playable ads". The two readings lead to different builds.

| | **Game** (recommended) | **Playable ad** |
|---|---|---|
| Pacing | Stretch it 10–50× with tiers of things to buy. | Already close (about 2.5 min); compress to 30–60 s. |
| Must-haves | Save and resume, offline earnings, upgrades, content after phase 5. | End card with a CTA, a single HTML file, zero network requests (inline a subset of the font), network SDK hooks. |
| Size | Not a constraint. | 778 KB today. Network limits are roughly 2–5 MB but vary; verify each network's current spec at build time. |

Recommendation: **game**. The brief asked for something to play and test. An ad build can be a cheap side target later, because it reuses almost everything.

## Done: make it a game (wave 4–5)

Kept for reference. Deviations: the shop is one doormat that opens a panel (not pads), and the conveyors have no levels (belts are never the bottleneck).


1. **Save and resume (M).**
   - What it saves: a versioned localStorage snapshot of money, unlocks, pad progress, the phase, and item counts per pile and counter.
   - When it saves: every few seconds and when the tab is hidden, after in-flight items have landed.
   - On load, it rebuilds the unlocked stations and refills the piles.
   - A reset option goes in settings.
2. **Offline earnings (S, after 1).** A "While you were away: $X" card, capped at 2 hours. The rate comes from an income-per-minute table per automation level, measured with the bot.
3. **Upgrade shop at the log cabin (M).** The red-roof cabin already in the yard gets upgrade pads, with 3–5 levels each at rising prices:
   - carry capacity: 10, 14, 18, 24;
   - move speed;
   - chop speed (axe level).
4. **Hire helpers (M).** Each helper is bought on a pad and reuses the existing pawn models:
   - crate runner: bench to SE counter;
   - cashier: empties the cash piles into your balance;
   - log hauler: drop zone to the trucks.
5. **Machine levels (S–M).** Speed levels for the harvester, processor and conveyors, bought on small pads next to each machine.
6. **Rebalance with the bot (S).**
   - Target times: harvester at about 1 min, processor about 4, conveyors about 8, mega saw about 15.
   - Upgrades and helpers should fill roughly the first 45 minutes.
   - Check income per minute at each phase.
7. **Completion moment (S).** After the mega saw: a celebration, a stats card, and a teaser for what comes next.

## Then: polish and reach

- **Pile instancing (M):** settled items in each pile render as one InstancedMesh per kind, while items in flight stay individual. This turns the 182-mesh cash pile into 1 draw call and is the biggest perf lever left.
- **Real-phone pass (S, owner):** open the artifact on a phone and report frame rate and feel.

## Later: content (pick a few)

- **Another product chain:** a firewood stand (logs into firewood bundles for snowmobile customers). The furniture workshop is done.
- **A furniture runner (S):** a crew role that carries chairs from the workshop bench to the sleds.
- **A second zone across the river.** The bridge already exists. Timber Ridge (east) is done; the river zone could bring birch and river barges.
- **Customer variety, deeper:** VIPs and rush hours exist. Timed boosts are still open.
- **Achievements across seasons (S):** quests reset with each New Season; lifetime badges could persist.
- **Prestige, deeper:** New Season exists (a permanent price bonus). It could add a new biome or perks per season.
- **Seasonal events:** for example, Christmas tree deliveries.

## Engineering track (any time)

- **More unit tests (S–M):** Pile reservations and the transfer lifecycle. Economy and save tests exist, and CI runs them.
- **Free hosting (S):** GitHub Pages or Cloudflare Pages, auto-deployed on push. That gives a public URL you control, while the artifact stays private. Add a PWA manifest for "Add to Home Screen". No recurring cost.
- **Balance report (S):** run the bot with different strategies and produce a table of unlock times and income per minute.

## Playable-ad track (only if the ad route is chosen)

- `npm run build:playable` produces one HTML file with an inlined subset of the Fredoka font and zero network requests.
- A 30–60 s flow: cheaper pads, the intro skipped, a guiding hand, and an end card with a CTA after phase 3 or at 60 s.
- Network hooks:
  - `mraid.open()` for AppLovin, Unity and ironSource;
  - `FbPlayableAd.onCTAClick()` for Meta;
  - ExitApi for Google;
  - event pings for start, phase reached and CTA.
  - Size limits and SDK hooks change, so check each network's current spec at build time.

## Constraints that carry forward

- **No external asset files.** New models go through the AssetFactory and `bake()`, textures are drawn on canvas, and audio is synthesized.
- **Draw-call budget.** 950 or fewer per frame, measured on a late save every release (`scripts/perf-breakdown.js`). Bake every new model per animated pivot.
- **Era 1's gameplay stays frozen:** prices, levels, reveal order, layout and guide
  (`tests/era1Frozen.test.ts`, `scripts/check-reveals.mjs`); its look may change in the overhaul (decision 10).
- **Saves:** `SAVE.version` unchanged, state additive and sanitized, every fixture in `tests/fixtures/` loads.
- **No bot runs** (`scripts/balance.mjs`, the full `playtest-bot.js`) unless Dino asks.
- **Cozy and ADHD-friendly:** one clear next goal, short sessions pay off, nothing punishing.
- **Upgrades are hands-on: stand on pads.** Every level is bought in person on a level pad or a shop mat, one at a time.
  No auto-buyers, no Raise all / Buy ×10, no buying from a checklist or from afar (Dino's decision, 0.9.0).
- **The plank flow is unconfirmed.** Logs turning into planks on the walk-in counter is an interpretation of the brief. Confirm it or change it.
