# Winterland roadmap

**Where it stands (2026-10-15): 0.9.0 "Ages" is done in the tree (version 0.9.0; the tag, the desktop packages and
the artifact republish are the owner's release steps).**
- **0.9.0 "Ages" is done** (Wave 14 in `docs/DESIGN.md`, design in `docs/EXPANSION.md`): ten eras with a fenced region
  each (machine slots, export depot, import dock, era crew), 22 era machines and 18 materials, Jack's swap cart, the
  market (prices, trading, orders, bonds, an index fund, ventures), pay-to-demolish, nine city districts with a
  skyline, and the climb: ladders to Lv 100, the era gate (every owned upgrade at Lv 10·(N−1) and settlement
  5·(N−1)), settlement levels 6–50 with Renown and gifts, Mastery, the Founder's Scarf and the GateCard checklist.
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

Effort sizes: **S** is a small slice. **M** is about one builder for a wave. **L** is several waves.

## Next: the plan after 0.9.0

In this order. Each release keeps the standing constraints below.

1. **100 % completionist award (Dino's add-on, S–M).** A trophy and a celebration for 100 % completion: every quest,
   every upgrade at Lv 100, all ten eras and Settlement 50. A completion % is shown along the way (for example on the
   stats card and the era chip's card), so the player always sees how far there is to go.
2. **0.10: era content for eras 2–4** (`docs/EXPANSION.md` §D, steps 10–14): `src/eras/template.ts` with 23 upgrade
   ids per era and the catch-up grant, the instanced `EraCrowd` with 70 m culling, the six new crew roles, 8 slots
   per region, the hand node and the era Carry / Boots / Tool / Pal, then the new machines and materials of eras 2–4
   from the ARGON specs in `docs/art/`. Re-run the pacing model.
3. **0.11: eras 5–7** (step 15): the same template, 11 machines, 7 materials; a draw-call check at a skyline edge.
4. **0.12: eras 8–10** (steps 16–18): slots 9 / 9 / 10, 9 machines, 7 materials, Settlement 46–50, the "Singularity"
   finale (everything Lv 100 + Settlement 50) with New Season moved to it, and the final pacing model.
5. **ADHD comfort pass:** one next goal everywhere, fewer simultaneous toasts, calmer banners, gamepad, key
   rebinding, UI scale, a stats page and a photo mode (the "comfort" wave held back during 0.9.0). Also the open
   0.9.0 UI nits below.
6. **Cozy graphics overhaul** using `docs/art/` (ARGON's era palettes and model specs; `docs/art/guide.md` is the
   authoritative guide): rebuild the era assets and repaint Survival to the shared palette, within the draw-call
   budget.
7. **1.0:** a full balance pass (bot runs only when Dino asks), a real-phone pass, desktop packages and release.

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
- The Invest tab's venture picker offers era 2, but ventures unlock at era 3.
- Each region slot makes its own LotPad canvas texture (up to 72); they could share.
- The south avenue passes between the two south Market Town lots through a 1.2 m gap when both are built
  (walkable; the lots are era-1 layout, so they stay).
- The old tricycle road runs under region 2 to z 70; the region's ground covers it (era-1 layout, so it stays).
- New Season while age ≥ 2 still follows the 0.8.0 rule; moving it to the era-10 finale is 0.12 work (R12).
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
- **Era 1 stays 0.8.0** until the Great Lodge is built: prices, levels, reveal order, layout and guide
  (`tests/era1Frozen.test.ts`, `scripts/check-reveals.mjs`).
- **Saves:** `SAVE.version` unchanged, state additive and sanitized, every fixture in `tests/fixtures/` loads.
- **No bot runs** (`scripts/balance.mjs`, the full `playtest-bot.js`) unless Dino asks.
- **Cozy and ADHD-friendly:** one clear next goal, short sessions pay off, nothing punishing.
- **Upgrades are hands-on: stand on pads.** Every level is bought in person on a level pad or a shop mat, one at a time.
  No auto-buyers, no Raise all / Buy ×10, no buying from a checklist or from afar (Dino's decision, 0.9.0).
- **The plank flow is unconfirmed.** Logs turning into planks on the walk-in counter is an interpretation of the brief. Confirm it or change it.
