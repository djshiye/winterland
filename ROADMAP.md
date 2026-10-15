# Winterland 0.9.0 "Ages" — work-in-progress roadmap and pickup point

**Status (2026-10-15 evening): all ten feature builds are in the tree, the whole project type-checks, and the full
vitest suite passes (883 tests, 42 files). Nothing is released yet: `package.json` still says 0.8.0, there is no
v0.9.0 tag, the artifact is not republished, and the verification pass below is only half done.**

This file is the handoff: what 0.9.0 is, what landed, what is still open, and the exact next steps.
`docs/ROADMAP.md` is the long-term roadmap (waves 4–13); `docs/DESIGN.md` has every wave's design notes.

---

## 1. What 0.9.0 is (the user's direction, as interpreted)

1. **Jack of all trades** — a swap cart that buys ANY carried item cheaply (a discard). Upgrade `jack` (10 levels,
   30 % → 75 % of value). One cart in the yard (appears when the shop is revealed), one in every era region.
2. **Ten eras.** Era 1 = Survival = everything that existed in 0.8.0. Eras 2..10: Frontier, Iron Age, Steam Age,
   Industrial, Electric Age, Oil Age, Computer Age, Nuclear Power, AI Era. Each is bought as a land expansion
   (cash + the previous era's refined material) that opens a fenced REGION south of the old map with machine slots
   (4 → 8; bigger land for higher eras), an export depot, an import dock, Jack, an era shop mat and an era crew.
   Each era adds materials (18 new item kinds), 22 machines in total, era workers and 3 upgrades per era (Rigs,
   Crew, Trade).
3. **Investment and trading** — `core/Market.ts`: price indexes (random walk + reversion + supply pressure),
   virtual holdings, physical orders to a region's import dock, bonds / index fund / era ventures, net worth.
4. **Pay to demolish** — Market Town lots, era machine slots and city lots, all via the generic ManagePanel
   (cost = max($250, 20 % of the build price)).
5. **The town grows HUGE** — nine city districts east of the Market Town (one per era, 6 → 12 lots), 36 parametric
   buildings (home / work / park / landmark per era), rent + business income, ranks Town → City → Big City →
   Megacity → Metropolis (100k people + era 10), an instanced skyline up to 220 towers.
6. **Economy overhaul** — the market above, era price ladder ×3 per era, income events / ticker, formatMoney up to T.

Decisions made without asking (state them in the release notes):
- Era 2 is gated on the settlement reaching **Winter City (village level 4)**, not on maxing every upgrade.
- 0.8.0 had already shipped when the request came in, so this is **0.9.0** (the user said "0.8").
- Village levels are now called **settlement** levels ("Settlement III · Town"); "Era" is reserved for the Ages.
- Order price at the market includes the era Trade multiplier (closes an order → export money loop).
- Era crews reserve the materials still owed on expansion / machine / city pads (only the owed count).
- All assets are procedural; a Gemini ARGON prompt is in §7 if hand-authored visual specs are wanted later.

## 2. Architecture map (where things live)

| Area | Files | Status |
|---|---|---|
| Data / contracts | `src/eras/data.ts` (ERAS, MATERIALS, MACHINES, REGIONS, ROADS, DISTRICTS, CITY_BUILDINGS, MARKET, INVEST, JACK), `src/eras/layout.ts` (regionLayout, expansionOffered, travelPoints), `src/eras/runtime.ts`, `src/core/kinds.ts` | done |
| State / save | `src/core/types.ts` (eras / city / market state, events, ManageRequest, ChooseRequest), `src/core/Save.ts` (sanitize + WorldSnapshot.eras), fixture `tests/fixtures/save-v7-eras.json` | done; SAVE.version unchanged, old fixtures load |
| Era regions | `src/eras/EraWorld.ts`, `Region.ts`, `Machine.ts`, `ExportDepot.ts`, `rules.ts` | done (29 tests) |
| Era workers | `src/npc/EraCrew.ts`, `src/npc/EraWorker.ts` (pickJob, materialNeeds), `src/assets/eraWorkers.ts` | done (40 tests) |
| Machines / items | `src/assets/eraMachines.ts` + `eraKit.ts` (22 machines, depot/dock), `src/assets/eraItems.ts`, `src/ui/materialIcons.ts`, pads (`src/assets/pads.ts`, `ConstructionPad` logs:0) | done (77 + tests) |
| World | `src/world/env/frontier.ts` (roads, region envelopes, gates, FOR SALE signs, far scatter), `ground.ts` (640 m), `common.ts` (NEW_LAND), `src/assets/frontierProps.ts`, `ColliderWorld.carve()` | done (13 tests) |
| City | `src/city/City.ts`, `District.ts`, `rules.ts`, `src/assets/cityBuildings.ts`, `src/world/env/skyline.ts` | done (25 tests) |
| Market | `src/core/Market.ts`, `src/ui/MarketPanel.ts`, `src/ui/market.css` | done (23 tests) |
| Jack | `src/npc/Jack.ts`, `src/assets/jack.ts` | done (15 tests) |
| UI | `src/ui/HUD.ts` (Map / Market buttons, T / B keys), `ManagePanel.ts`, `ChoosePanel.ts`, `MapPanel.ts` (fast travel), `EraChip.ts` (+ income ticker), `AgeCard.ts`, `agesLogic.ts`, `sheet.ts`, `ages.css`, `ShopPanel.ts` (Industry / Finance tabs), `icons.ts` | done (18 tests) |
| Town demolish | `src/town/{Town,Business,rules}.ts`, `Village.ts`, `Townsfolk.ts`, `crewHelpers.ts` | done (13 tests; era-1 unchanged) |
| Integration | `src/progression/Progression.ts` (era guide hints, gated on village level 4 / age ≥ 2), `src/core/quests.ts` (21 era quests after the Survival ones), `scripts/playtest-bot.js` (skips industry / finance groups), `Contracts.ts` + `Save.ts` offline rate ignore Jack sales, `src/debug/Gallery.ts` (camelCase domains), `src/world/env/eras.ts` + `VillageBadge.ts` (settlement wording) | done |
| Level / Game wiring | `src/level/Level.ts` (eras, city, jack, travel:request), `src/game/Game.ts` (ctx.market, debug API `unlockEra`, `buildMachine`, `buildCity`, `travel`) | done |

Debug API (`window.__WINTERLAND__`): `skipIntro, addMoney, teleport, simulate, setTimeOfDay(0.75 = night),
revealTown, buildTown, setUpgrade, save, saveData, unlockEra(n), buildMachine(n, slot, id), buildCity(n, lot, id),
travel('region:n' | 'district:n' | 'yard' | 'village' | 'town')`. Galleries: `--query gallery=eraMachines`
(or `era2`..`era10` sheets), `eraItems`, `eraWorkers`, `cityBuildings`, `frontierProps`, `jack`, `padMachine`.

## 3. Verification done so far

- `npx tsc --noEmit -p .` — clean.
- `npx vitest run` — 883 / 883 (one known flake: crowdLife carolers under load, passes alone).
- Builder screenshots (in the gitignored `shots/`): items, machines per era, workers, region 2 live (machines
  producing, depot selling, orders landing on the dock), city districts 2 / 6 / 10 day and night, skyline at
  Metropolis, market tabs, map, shop tabs, age card, manage / choose panels, Jack in the yard, locked and unlocked
  regions, walk from the town square to region 2.
- Draw calls measured by builders: fully built district at night ≈ 140; skyline edge ≈ 300; region ≈ 115–200;
  yard with Jack +11. **Not yet measured: the 0.8.0 late-game baseline (≈ 810 village at night at High) vs the new
  build on the same save.** A v0.8.0 worktree exists at
  `/tmp/claude-1000/-home-djshiye-coding/f7309809-5e9d-5edb-88e2-f0d0b38df3f7/scratchpad/wl-base` (git worktree,
  node_modules symlinked) and a driver `scratchpad/drawcalls.py` (restores a fixture via the `save:restore` event,
  then shots village / town / yard day + night and prints `renderer.stats.calls`). It printed nothing on its first
  run — the output filter was too strict; print every line of shot.mjs output to debug it. If the worktree is gone,
  recreate it with `git worktree add --detach <dir> v0.8.0` and symlink `node_modules`.

## 4. What is still open — pick up HERE, in this order

1. **Review pass (not done).** Run a find → verify review over the 0.9.0 diff (the Workflow tool, or
   `/code-review high`). Focus: item leaks on demolish / dispose, save / restore round trips with regions, event
   ordering (`era:unlocked` is emitted even on the debug instant path; the constructor path is silent), money
   loops (order → export, Jack), and anything that could touch era-1 behaviour.
2. **Era-1 regression check:** `node scripts/check-reveals.mjs` must still pass (CI runs it). Nothing new should
   be visible before village level 4 / age 2; the world builder hides the whole new land until then.
3. **Draw-call comparison** (§3) on a late save, old vs new build: must stay ≤ 950 and close to the 0.8.0 number.
4. **One live end-to-end pass by hand via the debug API** (no bot runs): fresh game → `skipIntro`, `addMoney`,
   set village level 4 → the expansion pad for era 2 appears on the south avenue → pay it (cash + 40 crates) →
   region 2 opens with the age card → choose a quarry on a slot via the ChoosePanel → pay → it produces stone →
   kiln → bricks → depot sells → Jack buys a stone → market Trade / Invest → district 2 lot → building → income
   ticker → demolish via ManagePanel → map fast travel. Watch the console for errors.
5. **Known cosmetic / minor items** (fix if cheap):
   - AgeCard overlaps the WASD onboarding hint on a fresh game; the phone income ticker can overlap the quests chip.
   - EraCard shows the settlement name twice ("SETTLEMENT · WINTER CITY" + "Winter City").
   - southAvenue (x 26–30) leaves only a 1.2 m gap between the two south Market Town lots when both are built;
     consider nudging the avenue or the lots.
   - The old tricycle road's asphalt tail runs under region 2 (covered by lifting the region ground to y 0.03);
     `roads.ts` could end the asphalt at z 50.
   - `City.openDistricts` has an unused `_silent` parameter; the `era2..era10` gallery review sheets make the
     eraMachines gallery row very wide (drop them if unwanted).
   - Each region slot creates its own LotPad canvas texture (up to 72); fine, but could share.
   - Era 10 glass windows are bright at night; machines' own windows at night were not checked.
   - Era venture picker in the Invest tab allows era 2 although ventures unlock at era 3.
6. **Docs:** add a "Wave 14: the Ages (0.9.0)" section to `docs/DESIGN.md`, update `docs/ROADMAP.md` status and
   the README "The loop" section (eras, market, Jack, city, demolish, Map / Market buttons, T / B keys), then fold
   this file's content into `docs/ROADMAP.md` and delete this file.
7. **Release:** bump `package.json` to 0.9.0, `npm run package:desktop`, rebuild and republish the artifact
   (url https://claude.ai/artifact/7H1q4UsqZpm8AMrPCgoinF), commit, `git push origin main && git tag v0.9.0 &&
   git push origin v0.9.0`, watch CI and Release.
8. **Final report to the user** — include the decisions in §1, the untested items, the W14 "comfort" wave that is
   on hold (gamepad, rebinding, UI scale, stats, photo mode), and the ARGON prompt in §7.

## 5. Standing constraints (do not break)

- Commit as `git -c user.name="djshiye" -c user.email="115914552+djshiye@users.noreply.github.com"`; **no Co-Authored-By / Claude
  attribution** in commits or PRs; no model identifiers in files.
- Procedural assets only. Draw calls ≤ 950 per frame. SAVE.version unchanged; state additive and sanitized;
  every fixture in `tests/fixtures/` must keep loading.
- **No bot runs** (`scripts/balance.mjs`, full `playtest-bot.js`) unless the user asks.
- Era 1 (Survival) plays exactly as 0.8.0: prices, guide hints, reveal order, layout.
- No history rewrite, no force push.
- Heavy commands (tsc / vitest / shot.mjs) are fine to run directly; on the Pi run at most two at once.

## 6. Where the session's scratch files are (not in git; may be gone in a new container)

`/tmp/claude-1000/-home-djshiye-coding/f7309809-5e9d-5edb-88e2-f0d0b38df3f7/scratchpad/`: `v09-plan.md`,
`v09-brief.md` (the builder brief), `map-*.md` (code maps), `heavy.sh`, `drawcalls.py`, `wl-base/` (v0.8.0
worktree), `gemini-argon-prompt.md`, `city-setup.js`. Everything needed to continue is reproduced in this file.

## 7. Optional: Gemini ARGON prompt for a hand-authored "Ages" visual spec

> Hi ARGON. Winterland (the cosy snowy isometric arcade-idle game from your original game spec and visual design
> spec) is growing from one era into TEN in v0.9.0 "Ages". Everything is built procedurally in Three.js from
> low-poly primitives with vertex colours and toon shading, so I need a written VISUAL DESIGN SPEC, not images, in
> the same format as your original visual spec.
>
> Constraints: toy-diorama style, chunky and readable from a 45° isometric camera at ~25 m, snow on roofs, warm
> window glow at night; ≤ 3 meshes per object (merged body, glow part, one animated pivot); sizes in metres with
> the origin at the floor centre and +Z as the front; machines ≤ 5.2 × 5.2 m and up to 6 m tall; city lots 6–9 m
> square; carried items ~0.4 m; 3–5 hex colours per asset harmonised with snow #f4f7fb, pine greens, timber
> #8a5a3b and gold accents.
>
> Eras: 2 Frontier (stone, bricks) · 3 Iron Age (ore, iron) · 4 Steam Age (coal, gears) · 5 Industrial (steel) ·
> 6 Electric Age (copper, wire) · 7 Oil Age (crude, plastic) · 8 Computer Age (silicon, chips) · 9 Nuclear Power
> (uranium, fuel rods, power cells) · 10 AI Era (AI cores, robots).
>
> Specify: (1) a per-era palette (ground, fence, machine body / accent / trim, glow) progressing timber + stone →
> brick + iron → steel + concrete → glass + white panels → glowing AI tech; (2) the 22 machines (quarry, brick
> kiln, iron mine, smelter, coal pit, steam works, deep mine, coke oven, steel mill, copper mine, wire mill, oil
> pump, refinery, sand pit, chip fab, uranium mine, enricher, reactor, fusion plant, nano fab, data center, robot
> works) plus an export depot and import dock per era — silhouette, key parts, the animated part, glow parts;
> (3) nine era workers (Quarryman, Miner, Stoker, Steelworker, Lineman, Roughneck, Technician, Atom Tech, a friendly
> boxy Robot) — outfit, headgear, colours, one prop; (4) the 18 carried materials; (5) city buildings per era
> district (home, workplace, park, landmark) escalating from brick cottages and a clock tower to AI arcologies and a
> singularity spire; (6) Jack of all trades and his swap cart ("JACK'S SWAPS" sign, striped awning, bell);
> (7) 5–6 region decor props per era and the FOR SALE sign / gate for locked regions; (8) one icon concept per
> material and per era. Compact, implementation-ready bullet lists with dimensions and hex values.
