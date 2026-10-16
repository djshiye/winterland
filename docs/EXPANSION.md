# Winterland expansion design: ten-era climb (0.9 to 0.12)

This document covers the era unlock rule, upgrade ladders to level 100, settlement levels 6 to 50 and the content template for each era. It merges three candidate designs and starts from the judges' favourite (design 0). It adds:
- the in-band settlement interpolation, grandfathering, top-5 checklist and Raise-all from design 2;
- the crew and caps helper and the retained `ERA_CREW_COUNT` from design 1.

It fixes every problem the judges raised. I checked the numbers against the code (files and lines are cited). The cost and capacity numbers come from a scratch script that copies `price3`, `regionLayout`'s slot fit, `DISTRICTS` and `CITY_BUILDINGS`.

---

## 0. Rule conflicts and the interpretation used

| # | Conflict (verified) | Interpretation |
|---|---|---|
| R1 | **Rule 4 vs rule 2.** Survival ladders end at stored level 4..9 (`carry` / `speed` / `axe` / `jack` 9, `harvester` / `processor` / `megaSaw` 7, crews 6, `treeFeller` / `cashTubes` / `workshop` 5, sales 5, `dog` 4). Era 2 needs 10, so new levels have to exist somewhere in era 1. | Era 1 is identical to 0.8.0 **until the Great Lodge is built** (prices, maximum levels, reveal order, layout, guide). That is the point where 0.8.0 shows the finale. `climbOpen(s) = s.village.greatLodge.tier >= 0`. Before it: the authored maximum, authored costs, no checklist, no new land. The Grand Market (0.8.0 after the Lodge) works as before. |
| R2 | **0.9 already breaks R1.** New land, roads, the era-2 pad and guide hints are revealed at Winter City (`FIRST_EXPANSION_VILLAGE_LEVEL = 4`: `layout.ts:116`, `frontier.ts:40,46`, `Progression.ts:751`). | All four move to `climbOpen`. The constant is deleted. That restores 0.8.0 behaviour at Winter City. |
| R3 | **Jack** (`jack`, a 0.9 addition) is visible in era 1 from the shop reveal. | It stays. Dino approved Jack in 0.9. It is the 23rd era-1 upgrade, the counterpart of each later era's Rigs. |
| R4 | **"Every upgrade ≥ 10·(N−1)" read literally.** An era-9 upgrade would go 0 → 90 inside era 9 (about 2,000 purchases). | **Base offset, shown to the player.** An upgrade from intro era `e` shows `Lv = stored + base`, with `base = 10·(e−1)`. The rule then holds *as written on screen* for every owned upgrade. Each era asks for +10 levels on everything. Owner switch `GATE.mode: 'offset' \| 'literal'`; literal sets base = 0 for all ids. |
| R5 | **The offset is confusing on arrival** (judges: "an unhired crew shows Lv 80 and Not hired"). | 1) Crews show **"Not hired"** at stored 0. Hiring shows `Lv base+1`. 2) Other new upgrades show **"Lv 20 · era standard"** with a one-line tooltip: "Iron Age gear arrives at Lv 20, the level everything needs to open the Iron Age." 3) Pips are drawn per band (10 pips plus a band star), so the bar always reads "0..10 of this era". |
| R6 | **Two level conventions.** The shop shows the stored level (`ShopPanel.ts:370`, `Lv ${lvl}/${max}`). Survival machine pads count the built machine as LV 1 and offer `LV stored+2` (`UpgradePad.ts:14`). | **One internal number decides:** `shown = stored + base`. Each checklist row uses the unit of the place where it is bought: shop rows read "Lv 7/10"; pad rows read "pad LV 8 → LV 11". 0.9.1: pad badges show the shown level they buy (first pad LV 1), so pad rows read "pad LV 8 → LV 10" and the last era-1 pad is LV 10. |
| R7 | **"Owns."** If unbuilt pads or unhired crews were skipped, a player could make the gate easier by not buying things. | Every upgrade of every era reached counts. An unmet `requires` becomes the row's first step ("Build the Workshop", "Hire the Paymaster: reach Settlement 12"). `check-reveals` proves every era-1 requirement can be met before the finale. |
| R8 | **`village.level` is clamped to 0..5** (`Save.ts:226`) and indexes `DEMAND`, `VILLAGE.levels` and era dressing (64 readers). | It stays 0..5. Settlement 6..50 is a separate best-ever value `state.eras.settlement`. Era-1 demand stays frozen at the Winterland row. |
| R9 | **Settlement 6..10 is flat** if it uses total population. Era-1 population is anywhere from 110 to 176 (8 plots × 12 + 8 lots × ≤10), and an era-2 home holds 40. | Levels ≥ 6 use **city population**: district residents + region machine staff, without the village. Era 2 interpolates linearly from 0, later eras geometrically (§B). One level is about one home in every band. |
| R10 | **Regions 2..5 have 4/4/5/5 slots** (`data.ts` `REGIONS`), but every era needs 6 machine types. | Slots become 8,8,8,8,8,8,9,9,10. I checked the fit with `regionLayout`'s cell search: cells of 7 / 7.5 / 8 / 8.5 / 9 / 9 / 9 / 9 / 9 m. Old slot indices keep their machines; only the grid spacing changes. |
| R11 | **Era prices vs Survival's last prices.** Survival's last steps already total $2.74M (jack alone is $750k), while the era-2 pad is $150k and Rigs start at $4.5k. | **Era economy ×10** (`CLIMB.eraScale = 10`): `unlockCash`, `RAW`, `REF`, city cash and income. 0.9 is unreleased, so this is allowed. Survival numbers are untouched. |
| R12 | **New Season** (`PRESTIGE`) is offered at the finale and wipes everything. | While age = 1 it stays as in 0.8.0. The confirmation lists climb levels that would be lost. From age 2 it moves to the era-10 finale. |
| R13 | **`CITY_RANKS`.** Big City (5k, era 4) can't be reached until era 5 (era-4 total capacity is about 2.1k). Megacity (40k, era 7) can't be reached until era 8. | The ranks stay cosmetic (skyline, Metropolis badge). `minEra` is retuned to 5 and 8 so the ranks don't promise the impossible. Settlement names are the player-facing scale. |
| R14 | **0.10 adds upgrade ids to saves already past their intro era.** Read naively, an age-5 player would owe 40 levels on every new era-2 id. | **Catch-up grant (§F).** An id that is missing from the raw save loads at `shown = 10·(age−1)`, or `10·(age−1)+1` for a crew, which hires it. A toast says: "New Frontier upgrades arrived at Lv 40." |

**For Dino to confirm:** R4 (offset vs literal), R9 (city population drives settlement ≥ 6), R11 (×10 era economy), R12 (New Season moves to era 10).

---

## A. Upgrade ladders to level 100

**New pure module `src/core/ladder.ts`** (no THREE). Every reader goes through it.

```ts
LEVEL_CAP = 100                                   // shown level; era-10 finale = all at 100
eraCap(age) = min(LEVEL_CAP, 10 · age)            // 0.9.1: highest shown level for sale in era `age`; the next expansion lifts it
introEra(def) = def.era ?? def.requires?.era ?? 1 // Survival + jack 1; taxOffice/broker 2; era ids n
base(def)     = GATE.mode === 'literal' ? 0 : 10 * (introEra(def) - 1)
m(def)        = def.values.length - 1             // authored max (stored)
maxStored(def, climb) = climb ? LEVEL_CAP - base(def) : m(def)
valueAt(def, s), costAt(def, s), hardCapStored(def), shown(def, s)
```

- For `s ≤ m`, `valueAt` returns `values[s]` and `costAt` returns `costs[s]`, unchanged (frozen by test).
- **Readers to switch.** They are the only direct table reads in `src`:
  - `Upgrades.ts:45,60,65,125`
  - `demand.ts:18` (`productMult`)
  - `Save.ts:184`
  - the six `createLevelBadge(values.length−1)` calls in `assets/machines.ts` and `ridgeMachines.ts`, which keep the authored pips and add a band star past the maximum.
  - `Jack.ts:47` reads `values[0]` only and is unchanged.

### A1. Effects past the authored maximum

Notation: `t = s − m`, `vₘ = values[m]`, and A = the shown level.

| Display | Ids | Formula | Hard cap (then Mastery) |
|---|---|---|---|
| count | `carry` | vₘ + 1·t (40 → …) | 50 (A 19). Render cap stays 40 meshes; the extra shows as a "+N" tag (0 draw calls). |
| count | `dog`, era pals | vₘ + 1 per 2 levels (dog 6 → …) | 12 (dog A 16). Saddle render cap stays 6. |
| speed | `speed` | 14 − (14 − vₘ)·0.93ᵗ (11.0 → 11.2 → …) | 13.5 m/s (A ≈ 34) |
| rate (interval s) | `axe` | max(floor, iₘ·0.96ᵗ) | floor 0.06 s (A ≈ 28) |
| | `harvester`, `processor` | same | 0.154 s, the 6.5 items/s belt limit (A ≈ 19 / 25) |
| | `megaSaw` | same | 0.46 s = 3 logs ÷ 6.5/s (A ≈ 10) |
| | `treeFeller` | same | 2.0 s (40 s regrow) (A ≈ 11) |
| | `cashTubes` | same | 0.08 s (A ≈ 32) |
| | `workshop` | same | 0.4 s (A ≈ 34) |
| crew (multiplier v) | Survival crews | vₘ + 0.2·t (2.8 → …) | see `crewStats` below; hard cap v = 8 |
| crew | `${key}Crew` and era roles | authored, then 3.0 + 0.2·t | v = 8 |
| mult | Survival sales, `${key}Trade`, era product sales | vₘ + 0.1·t (2.0 → 2.5 at A 10 → 10.5 at A 90) | none, so it always pays |
| boost | `${key}Rigs` | vₘ + 0.1·t (3.0 → …) | 6. Effective cycle = max(0.25 s, cycle ÷ (Rigs × machine level)). |
| income | `taxOffice` | vₘ + 0.12·t | none |
| factor | `broker` | vₘ + 0.15·t | 10 (spread 0.5 %). `bondPayout` uses min(v, 3.5), so bonds stay exactly as in 0.9 (`Market.ts:258`). |
| share | `jack` | 0.75 + 0.01·t | 0.90 (A 24) |

**Jack stays safe.** Jack pays `share × unitValue` with no Trade (`Market.ts:84`). An order costs `quote(buy)·1.1·Trade ≥ 1.1·unitValue` (`Market.ts:230`). So any share below 1 can never loop money.

**`Upgrades.crewStats(id)`** (new; used by `Crew.ts`, `crewHelpers.ts:265` and `EraWorker.ts:354–358,693`):
- walk = base·min(v, 3.5)
- capacity = ⌊base·min(v, capMax)⌋, where `capMax` = 2.8 for Survival crews (no new carried meshes) and 4 for era crews (instanced)
- cadence = base / min(v, 8)

For v ≤ 2.8 this matches today's linear reads.

**Survival crew headcount stays QUARTERS-driven.** The design-0 idea of "+1 slot at A 20/40" is dropped, because it would cost about 100 village draw calls.

**Mastery.** Every level bought while its effect is at the hard cap gives 1 point.
- `masteryMult = 1 + 0.12·log2(1 + points/25)`: about 1.53 at 500 points and 1.71 at 1,500. It is bounded and logarithmic.
- It applies in `salePrice`, `Market.exportPrice` and city income.
- Before the climb it is 1, because no level can pass a cap.
- HUD chip: "Mastery 340 · +41 %".
- Every 10th level is a visible milestone: a tint for the axe or boots, a hat colour for crews, a band star on the card.

### A2. Costs

`price3` is the existing helper in `config.ts`. The tuning knobs live in `CLIMB` in `config.ts`.

```
A  = base + s                    // the level being bought is A → A+1
b  = floor(A/10) + 1, j = A mod 10
F(g, A) = W_g · U · 2.6^(b−2) · 1.08^j        U = $250k
W_g: lumberjack 0.5 · machine 0.8 · crew 0.8 · sales 0.9 · industry 0.9 · finance 1.0

era-1 id (Survival + jack):
  s < m             → costs[s]                                   (0.8.0, frozen)
  m ≤ s, A < 10     → price3(costs[m−1] · 1.05^(s−m+1))          (band 1: legacy step only)
  A ≥ 10            → price3(max(costs[m−1] · 1.05^(s−m+1), F(g, A)))
id with introEra ≥ 2 (taxOffice, broker, Rigs/Crew/Trade, all 0.10 ids):
  all s             → price3(F(g, A))
```

- The authored cost tables of the era-2+ ids are dropped. They were unreleased and badly out of scale: `taxOffice` stored 8 costs $330M today.
- Their authored `values` stay.
- Costs rise strictly at every step: the in-band step is ×1.08; at a band edge, j = 9 → 0 gives 2.0 → 2.6; the legacy branch also rises.

**Gate cost per band** (my script; full 0.10 id set):

| Band (gate opened) | Ids | Total cost | Avg income needed for the §E target |
|---|---|---|---|
| 1 (era 2) | 23 era-1 (87 steps) | **$10.4M** (legacy only; $9.2M at step 1.0) | about 1.7k/s |
| 2 (era 3) | 48 | $0.14B | about 23k/s |
| 3 (era 4) | 71 | $0.53B | about 80k/s |
| 4 (era 5) | 94 | $1.8B | about 250k/s |
| 5 (era 6) | 117 | $5.8B | about 0.74M/s |
| 6 (era 7) | 140 | $18B | about 2.1M/s |
| 7 (era 8) | 163 | $55B | about 6.1M/s |
| 8 (era 9) | 186 | $162B | about 17M/s |
| 9 (era 10) | 209 | $472B | about 46M/s |

The band cost grows ×3.8 → ×2.9 per band, while income grows ×3 per era (plus Rigs, Trade, Renown and Mastery). So eras lengthen gently, which is what §E wants.

Sample prices:
- First era-2 ids (A 10): carry $125k, crew $200k, Rigs $225k.
- Last band-9 steps (A 89): $201M (lumberjack) to $401M (finance).

**The rule: upgrades are hands-on, stand on pads.** (Owner decision, 0.9.0.) Every level is bought by the player in
person: a machine level by standing on its level pad, a shop or Industry level by stepping on a shop mat (the cabin's,
or the era region's) and pressing Buy, one level per press. There is no Buy ×10, no Buy to target, no Raise all, no
auto-buyer and no remote buying from the checklist: the GateCard only lists what is left and its **Go** brings the
player to the pad or mat where it is bought. The judges' "about 2,000 purchases" is answered by the walk itself
(cheapest-first rows sit on a few mats and pads) and by the pacing model, which charges every purchase a walk
(`PACING.walkPerBuy`, §E).

---

## B. Settlement levels 6..50

**Definitions** (pure, in `demand.ts`):

```
staff(n)          = round(10 · 2.2^(n−2)) per built machine in region n   // ¼ of an era-n home
cityPopulation(s) = cityTotals(s.city).residents + Σ_n builtMachines(n) · staff(n)
settlementLevel(s)= s.village.level < 5 ? s.village.level : max(5, s.eras.settlement)
```

- `s.eras.settlement` is a best-ever value. After any build, demolish or load it becomes `max(saved, levelFor(cityPop, age))`, so demolishing never lowers it.
- Level `L = 5(k−1)+j` (band k = 2..10, j = 1..5) needs **age ≥ k** and city population ≥ P(L). Era 1 can therefore never pass 5, and each era's band can only be filled in that era.
- Machine staff means building a machine also moves the settlement bar: two progress bars from one action.

**Thresholds.**
- Anchor A_k = 0.75 × the cumulative city capacity, where each district has (lots − 2) homes plus one work building and one landmark, and every region slot is built.
- Band 2 is linear from 0 (j·A₂/5). Bands 3+ are geometric from A_{k−1}.
- Each step is about one home of that era, so levels don't cascade. Era-1 population is excluded, so nothing fires at once when era 2 opens.
- `tests/settlement.test.ts` asserts A_k ≤ 0.8 × capacity, computed from `DISTRICTS` / `CITY_BUILDINGS` / `REGIONS`.

| Through era | Home / staff | Capacity (L−2 homes) | All-homes capacity | A_k |
|---|---|---|---|---|
| 2 | 40 / 10 | 240 | 320 | 180 |
| 3 | 88 / 22 | 768 | 1,024 | 580 |
| 4 | 194 / 48 | 1,928 | 2,572 | 1,400 |
| 5 | 426 / 106 | 5,332 | 6,828 | 4,000 |
| 6 | 937 / 234 | 12,826 | 16,196 | 9,600 |
| 7 | 2,061 / 515 | 29,312 | 36,804 | 22,000 |
| 8 | 4,535 / 1,134 | 71,263 | 87,825 | 53,000 |
| 9 | 9,977 / 2,494 | 163,548 | 200,064 | 120,000 |
| 10 | 21,950 / 5,488 | 437,928 | 518,344 | 330,000 |

| Levels (era) | Names | City population |
|---|---|---|
| 6–10 (2) | Frontier Post · Stone Village · Brick Town · Kiln Borough · Frontier Town | 36 · 72 · 108 · 144 · 180 |
| 11–15 (3) | Iron Village · Forge Town · Mining Borough · Railway Town · Iron City | 230 · 290 · 360 · 460 · 580 |
| 16–20 (4) | Coal Town · Gearworks · Steam Borough · Clockwork Town · Steam City | 690 · 830 · 980 · 1,200 · 1,400 |
| 21–25 (5) | Foundry Town · Smokestack Borough · Steel Town · Factory City · Industrial City | 1,700 · 2,100 · 2,600 · 3,200 · 4,000 |
| 26–30 (6) | Bright Town · Copperfield · Tram City · Radio Town · Electric City | 4,800 · 5,700 · 6,800 · 8,100 · 9,600 |
| 31–35 (7) | Boomtown · Derrick City · Highway City · Skyline City · Oil Capital | 11k · 13k · 16k · 19k · 22k |
| 36–40 (8) | Silicon Town · Circuit City · Byte Bay · Network City · Digital Capital | 26k · 31k · 37k · 44k · 53k |
| 41–45 (9) | Atom Town · Reactor City · Science City · Fusion Capital · Atomic Metropolis | 62k · 73k · 87k · 100k · 120k |
| 46–50 (10) | Smart City · Neural City · Robot Metropolis · Arcology · Winterland Prime | 150k · 180k · 220k · 270k · 330k |

**Every level ≥ 6 gives:**
- the `EraCard` banner (extended to L ≥ 6, which also fixes the duplicate-name bug from the 0.9.0 handoff);
- **Renown** +2 %: `renownMult = 1.02^max(0, L−5)` (×2.2 at 45), applied in `salePrice`, `exportPrice` and city income;
- a **walk-collect gift cash pile** worth 60 s of current income on the district plaza.

**Extra perk by band position j:**

| j | Perk |
|---|---|
| 1 | The era's quest trio unlocks (`quests.ts`) |
| 2 | Era roles 4–5 can be hired (`requires.settlement`) |
| 3 | District decor set: lamps, banners, trees, instanced, ≤ +2 draw calls; +0.05 city happiness |
| 4 | Era roles 6–7 can be hired; `INVEST_MAX_POSITIONS` +1 |
| 5 | **Charter**: fireworks, title, a 5-min income gift; the gate's settlement box turns green |

One-off perk: S20 brings the **Founder's Scarf**: a red-and-gold knitted scarf the player wears from then on, and
Renown ×1.05 on top of the per-level Renown (`SETTLEMENT.founder`). Cosmetic and small; nothing automatic.

| Perk | Level | Effect |
|---|---|---|
| Renown | every level ≥ 6 | ×1.02 per level on sales, exports and city income |
| Gift pile | every level ≥ 6 | 60 s of city income on the avenue (a Charter + 300 s) |
| Founder's Scarf | 20 (once) | a scarf on the player, Renown ×1.05 |

---

## C. The unlock rule in code

**New pure module `src/eras/gate.ts`:**

```ts
interface GateRow { id: UpgradeId; shown: number | null; need: number; state: 'ok' | 'low' | 'prereq';
                    prereq?: string; costToNeed: number; where: 'shop' | 'pad' | 'eraShop'; padLabel?: string }
eraGate(s, n) → { n, need: 10*(n-1), settlementNeed: 5*(n-1), rows: GateRow[], ok, total,
                  settlement: { level, need, cityPop, nextPop }, ready, padCash, padExtra }
nextGoal(s) → { text, action: { kind: 'buy' | 'go' | 'build', target } }
```

- **Rows** are every id with `introEra ≤ n−1`, so the era-2 gate has 23 rows. For n ≥ 3 the count is `23n − 21` once 0.10 content exists (209 at era 10); in 0.9 it is `23 + 2 + 3(n−2)`.
- `ready = ok === total && settlementLevel ≥ 5(n−1)`.
- `prereq` reuses `Upgrades.requirement()` plus "not built" for a machine id or "not hired" for a crew.

**Wiring:**
- `layout.ts expansionOffered(s, n)` = `!!ERAS[n] && s.eras.age === n−1 && climbOpen(s) && (eraGate(s, n).ready || padPaid(s, n) > 0)`.
  - Partial pad payments are grandfathered.
  - `travelPoints`, `materialNeeds` and `EraCrew` already call it.
- New `expansionPreview(s, n)` = `climbOpen && age === n−1 && !offered`.
  - The land, roads and FOR SALE sign show; the pad tile is greyed with "37/48 · S8/10" and refuses payment.
  - `frontier.ts:40,46` road visibility uses preview ∨ offered.
  - `Progression.ts:751` uses `climbOpen`.
- The paid expansion pad (cash + the previous era's material) stays the final step.

**Upgrades API:** `shownLevel(id)`, `maxLevel` → `maxStored`, `buy(id)` (one level, from the shop panel on a mat), `levelUp(id, position)` (a level pad), `crewStats(id)`. No multi-level or remote buy. The `setLevel` clamp uses `LEVEL_CAP − base`.

**UI (ADHD-friendly, a single next goal):**
- **EraChip** (from `climbOpen` on), one line plus a progress ring: "Next: Sharp Axe → Lv 10 ($42k) · 37/48 · S8/10". Tap opens the GateCard.
- **`ui/GateCard.ts`**:
  - Header: "Iron Age: 37/48 upgrades at Lv 20 · Settlement 8/10 · then the expansion $4.5M + 35 Bricks".
  - Only the **top 5 open rows** show (prereq first, then cheapest-to-finish), plus "+8 more"; done rows collapse to "✓ 37 done".
  - Read-only: each row has **Go** (fast-travels to where it is bought: the cabin's shop mat, the era's shop mat for an Industry row, the level pad, or what unlocks a prereq). Nothing is bought from the card.
  - The settlement row: "Build a home in Foundry Row (+88) → Settlement 9".
- **ShopPanel** (opens only on a shop mat, one level per Buy, as in 0.8.0): band pips plus a band star, a gold tick at the gate level, a dot on a tab while any row in it is below need, and "Lv 23 · need 30" badges.
- **`nextGoal` priority:** unmet prereq → cheapest affordable row → settlement action → saving for the cheapest row ("$12k to go") → the pad.
- **Rewards:**
  - a tiny "ding-ding" and chip pulse for each finished row;
  - a toast every 5 rows;
  - mini-confetti at each 10 % of the checklist;
  - when `ready`: fanfare, camera moment, the pad glows and the toast reads "Iron Ridge is for sale!".
  - `quests.ts` gets one quest per gate ("All upgrades Lv 20").
- **Event:** computed `gate:progress` on `upgrade:bought`, `settlement:changed` and `machine:built`. Nothing new is saved.

---

## D. Per-era content template (0.10–0.12)

**New data file `src/eras/template.ts`:**

```ts
ERA_CONTENT[n] = { materials: MaterialSpec[4..5], machines: [ext, ext, proc, proc, premium, cash],
                   roles: [hauler, feeder, shipper, porter, clerk, foreman, gatherer],
                   player: { carry, boots, tool, pal }, sales: [Trade, p1, p2, p3, p4], node }
```

The generators in `config.ts` (like `eraUpgrades()`) emit **23 ids per era**, mirroring Survival's 22 + jack:

| Group | Count | Ids |
|---|---|---|
| player | 4 | `${key}Carry`, `${key}Boots`, `${key}Tool`, `${key}Pal` |
| machine | 6 | one per `MachineId` |
| crew | 7 | `${key}Crew` (kept as the Hauler) + `Feeder` / `Shipper` / `Porter` / `Clerk` / `Foreman` / `Gatherer` |
| sales | 5 | `${key}Trade` (kept) + 4 × `${material}Quality` |
| industry | 1 | `${key}Rigs` (kept) |

`ProductId` gains the material kinds; `Market.tradeMult(kind)` multiplies Trade × the product upgrade.

**Effects:**
- **Machine level:** speed ×(1 + 0.06·s), cap 3.
- **Carry:** units per carried mesh 1 + 0.25·s, cap 9. No new meshes.
- **Boots:** walk speed ×(1 + 0.02·s) inside the region and on roads, cap 1.6.
- **Tool:** the interval on the era's **hand node** (a giant-log analog yielding the first raw material), ×0.96ˢ with floor 0.25·i₀.
- **Pal:** +1 carry per 2 levels, cap 12. The pal model replaces the dog while in its region; still +3 draw calls.
- **Product sales:** 1 + 0.1·s.
- **Crews:** as in A1.

**Roles.** All are one `EraWorker` class with a `role` mask in `pickJob`:

| Role | Job | Survival counterpart |
|---|---|---|
| Hauler | everything (today's worker) | — |
| Feeder | raw → processors | logHauler |
| Shipper | finished goods → depot | crateRunner |
| Porter | import dock → machines | porter |
| Clerk | banks the depot cash pile | cashier |
| Foreman | pays this era's slots and district lots, keeping a reserve | foreman |
| Gatherer | hand-node pile → machines | pineHauler |

- **Headcount:** `${key}Crew` keeps `ERA_CREW_COUNT` [0,1,1,1,2,2,2,3,3,3], then 3. That fixes the judges' save regression. New roles have 1 + ⌊s/10⌋ workers, at most 3.
- Region depots now drop sales into one **instanced cash pile**. At 60 bundles it banks itself with no loss (cozy). The Clerk and the era's cash machine (the cashTubes analog) speed up banking.

**Material grades:**
- raw = RAW(n)
- second refined = 0.8·REF(n)
- premium = 2.6·REF(n), the existing `robot` pattern.

**Content table.** \* marks new items: 32 new machines (22 → 54) and 23 new materials (18 → 41). Existing recipes are unchanged.

| Era | Materials | Machines: ext · ext · proc · proc · premium · cash | Roles (Hauler · Feeder · Shipper · Porter · Clerk · Foreman · Gatherer) | Player: carry / boots / tool / pal · node | Sales (Trade +) |
|---|---|---|---|---|---|
| 2 Frontier | stone, clay\*, brick, roofTile\*, hearth\* | quarry · clayPit\* · kiln · tileKiln\* (2 clay→tile) · masonYard\* (brick+tile→hearth) · strongbox\* | Quarryman · Kiln Feeder · Carter · Dock Hand · Tally Clerk · Master Mason · Stonebreaker | Mason's Hod / Hobnail Boots / Stone Pick / Pack Mule · Great Boulder | stone, brick, roofTile, hearth |
| 3 Iron | ore, charcoal\*, iron, tools\*, rail\* | ironMine · charcoalClamp\* · smelter · forge\* (iron+charcoal→tools) · railMill\* (2 iron+charcoal→rail) · mintChute\* | Miner · Ore Sorter · Rail Carter · Lumper · Paymaster · Pit Boss · Prospector | Ore Basket / Miner's Boots / Iron Pick / Pit Pony · Ore Vein | ore, iron, tools, rail |
| 4 Steam | coal, scrap\*, gear, boiler\*, steamEngine\* | coalPit · scrapYard\* · steamWorks · boilerShop\* (scrap+coal→boiler) · engineWorks\* (gear+boiler→engine) · pneumaticTubes\* | Stoker · Coal Heaver · Engine Driver · Navvy · Bookkeeper · Chief Engineer · Coal Picker | Coal Scuttle / Steam Skates / Coal Shovel / Brass Terrier · Coal Seam | coal, gear, boiler, steamEngine |
| 5 Industrial | ore, coal (reused), steel, girder\*, snowplow\* | deepMine · cokeOven · steelMill · rollingMill\* (2 steel→girder) · plowWorks\* (girder+steel→snowplow) · bankVault\* | Steelworker · Crane Hand · Teamster · Stevedore · Payroll Clerk · Plant Manager · Slag Raker | Steel Barrow / Work Boots / Rivet Hammer / Draft Horse · Slag Heap | coal, steel, girder, snowplow |
| 6 Electric | copper, quartz\*, wire, bulb\*, radio\* | copperMine · quartzPit\* · wireMill · bulbWorks\* (wire+quartz→bulb) · radioWorks\* (wire+bulb→radio) · tillLine\* | Lineman · Coil Winder · Tram Driver · Freight Hand · Switchboard Clerk · Electrical Foreman · Copper Scrapper | Spool Rack / E-Scooter / Power Drill / Lamp Cat · Copper Vein | copper, wire, bulb, radio |
| 7 Oil | crude, gas\*, plastic, fuel\*, snowmobile\* | oilPump · gasWell\* · refinery · cracker\* (crude+gas→fuel) · snowmobileWorks\* (plastic+fuel→snowmobile) · driveThruVault\* | Roughneck · Pipefitter · Tanker Driver · Dockworker · Accountant · Toolpusher · Seep Skimmer | Barrel Dolly / Snow Treads / Air Wrench / Snow Fox · Oil Seep | crude, plastic, fuel, snowmobile |
| 8 Computer | silicon, gold\*, chip, board\*, computer\* | sandPit · goldPanner\* · chipFab · boardShop\* (chip+gold→board) · pcAssembly\* (board+chip→computer) · atmNetwork\* | Technician · Wafer Handler · Courier · Logistics Tech · Data Clerk · Project Lead · Sand Sifter | Smart Cart / E-Bike / Laser Sieve / Rover Bot · Sand Dune | silicon, chip, board, computer |
| 9 Nuclear | uranium, graphite\*, fuelRod, power, battery\* | uraniumMine · graphitePit\* · enricher · reactor · batteryPlant\* (power+graphite→battery) · atomicVault\* | Atom Tech · Rod Handler · Hazmat Driver · Decon Porter · Auditor · Shift Supervisor · Crystal Cutter | Lead Tote / Hover Boots / Geiger Tongs / Rad Drone · Uranium Crystal | fuelRod, power, graphite, battery |
| 10 AI | power, chip (reused), aiCore, robot, quantumCore\* | fusionPlant · nanoFab · dataCenter · robotWorks · quantumLab\* (aiCore+power→quantumCore) · quantumBank\* | Robot · Feeder Bot · Courier Drone · Dock Bot · Ledger AI · Builder Bot · Prospector Drone | Exo Suit / Jet Boots / Nano Wand / Robo Pup · Data Crystal | aiCore, robot, power, quantumCore |

Existing cross-era imports through the dock (iron → steamWorks, wire → chipFab, steel → robotWorks) are kept, so older eras stay useful.

**Asset economy:**
- The 9 cash machines come from one parametric builder with the era palette.
- Hand nodes come from one rock/vein builder with 9 palettes.
- That leaves 23 truly new machine models, 23 item shapes (mostly existing `MaterialShape`s recoloured), 9 pal models and 54 role looks. A role look is a hat, coat colour and prop over the existing era bodies.
- The Gemini ARGON visual specs are in `docs/art/` (`guide.md` is authoritative; `era-02.json` … `era-10.json` per era). Extend them with this table before 0.10 asset work. Procedural build is from that spec.

**Draw calls for 70 roles (up to about 190 workers):**
- **Instanced `EraCrowd`** per region, modelled on `npc/Crowd.ts`:
  - body / head / hat / arms / boots parts with per-instance colours, plus one instanced prop per role style and one carried-item `InstancedMesh` per material kind;
  - about 8–12 calls (+ shadows at High) for any headcount, replacing today's per-worker `CharacterRig` at about 6 + 6 shadow calls each.
- **Distance culling:** a region's machines, crowd, piles and decor go `visible = false` beyond 70 m of the camera. The simulation keeps running in pure `pickJob`. Regions are far apart, so at most 2 are on screen.
- **Budget per region, worst view: ≤ 250 calls:**
  - 8–10 machines × about 8
  - crowd ≈ 12
  - cash pile 2
  - node 2
  - pal 3
  - front yard about 30
  - ground and fence about 40
- **Frame ≤ 950**, measured with `scripts/perf-breakdown.js` on a late save in every release.

---

## E. Balance targets

**Baseline.** The latest documented bot finale is **66.8 min** (DESIGN.md, wave 11). Today's eras 2–10 are fast because a $150k pad is minutes of late era-1 income. The whole current run is estimated at about 2.5 h; measure it once before tuning.

| Stretch | Target minutes | Model minutes (0.9.0) | Notes |
|---|---|---|---|
| Era 1 to Great Lodge | 67 | — | frozen 0.8.0 |
| Era-1 climb + era-2 pad | 100 | 116 | $10.4M of levels + $1.5M pad at about 1.7k/s; 87 buys → one per ~70 s |
| Era 2 | 100 | 99 |  |
| Era 3 | 110 | 110 |  |
| Era 4 | 120 | 115 |  |
| Era 5 | 130 | 124 |  |
| Era 6 | 140 | 134 |  |
| Era 7 | 150 | 145 |  |
| Era 8 | 160 | 155 |  |
| Era 9 | 170 | 166 |  |
| Era 10 to the finale ("Singularity": all Lv 100 + Settlement 50) | 180 | 177 |  |
| **Total** | **≈ 1,427 (≈ 24 h)** | **1,340 after the Lodge (≈ 22.3 h)** | about 9–10× |

Model minutes: `PACING_REPORT=1 npx vitest run tests/pacing.test.ts` with the hands-on buyer (one purchase at a time,
at least 8 s each for the walk to the pad or mat) and the Founder's Scarf. Walking barely moves the totals: a step
usually waits ~20 s for its money, and the walk happens while it comes in; it binds only after a gift or a pad.

- **Era-1 climb risk.** The judges flagged that the late-Survival income of 1.2–2k/s is unverified. At 1.2k/s the climb runs about 145 min.
- If the pacing model or a requested bot log shows the climb is over 120 min, use these levers in order:
  1. `CLIMB.legacyStep` 1.05 → 1.0 ($9.2M);
  2. a one-off Great Lodge perk of +25 % Survival sales from `climbOpen`.

  Never cut prices below the last authored level.

**Reward cadence:**
- a purchase or row tick every ≤ 45 s;
- a gate toast every 3–6 min;
- a settlement level every 20–35 min (5 per era);
- a new machine or building every ≤ 5 min in the first half of each era.

This corrects design 0's "6–15 min", which 5 levels per 100+ min era cannot meet.

**Checking it without running the bot:**
1. **`src/core/pacing.ts`** (pure). A greedy integrator over the real tables:
   - income = machines (cycle, batch, value) × Rigs × machine level × Trade × product × Renown × Mastery, + city rent and business × taxOffice × happiness, + `SURVIVAL_LATE_RATE` (one calibration constant);
   - each step it buys ONE thing, the best of: the cheapest gate row, a machine or a home by payback;
   - the buyer walks: every purchase takes at least `PACING.walkPerBuy` = 8 s (walk to the next pad or mat and stand on it), income flowing meanwhile, so a step costs max(walk, wait for the money).
2. **`tests/pacing.test.ts`** asserts:
   - each era takes 60–200 min;
   - costs never go down;
   - A_k ≤ 0.8·capacity;
   - `jack` < 1;
   - every hard cap is respected.

   With `PACING_REPORT=1`, `npx vitest run tests/pacing.test.ts` prints minutes per era and per settlement level. It is cheap and has no browser.
3. **Debug API:** `__WINTERLAND__.gate(n)`, `setAllUpgrades(shown)`, `setSettlement(L)`, `climb()` (builds the Great Lodge).
4. **Bot (only when Dino asks):**
   - `playtest-bot.js` gains goals `gate:<n>`, `era:<n>` and `st:<L>`;
   - once `climbOpen` it walks the `nextGoal` queue (pad, cabin mat or era mat, one level at a time) and drops its industry/finance skip;
   - `balance.mjs --goal era3` prints per-milestone minutes.

---

## F. Save migration and era-1 safety

`SAVE.version` and the save key are unchanged. All changes are additive.

- **Upgrade clamp.** `Save.ts:184` clamps to `LEVEL_CAP − base(def)` always, regardless of `climbOpen`, so bought levels are never lost. New ids default to 0 through the existing `UPGRADES` loop.
- **Catch-up grant (R14).** On load, if `raw.upgrades[id]` is absent, `introEra(id) < age` and the id belongs to the 0.10+ template, set stored to `10·(age − introEra)` (crews +1, which hires them). Flag `granted:<era>` and toast once. Done in `Save.ts` before `sanitizeState`, where the raw object is still visible.
- **`ErasState`** gains:
  - `settlement: number`, sanitized as int 0..50 and recomputed on load as `max(saved, levelFor(cityPop, age))`.

  (A 0.9.0 dev save's `steward` flag, from the removed auto-buyer, is dropped on load: `mergeState` keeps only known fields.)

  `village.level` stays 0..5.
- **Region slots** (R10). `REGION_SLOTS` grows; `Save.ts:410` already resizes the slot arrays and appends empty slots. Existing machines keep their slot index; only the grid spacing moves.
- **New material kinds** are added to `MATERIAL_KINDS`. The sanitizer already drops unknown kinds from `market.index` and the piles.
- **Ages already reached are kept.** The gate only decides the *next* era, and partial pad payments stay offered.
- **`ERA_CREW_COUNT` is kept** for `${key}Crew`, so 0.9 saves keep 1–3 workers.
- **New fixture** `tests/fixtures/save-v8-climb.json`: Great Lodge built, mixed levels above the authored maximum, settlement 8, a half-paid era-3 pad. All 7 existing fixtures (`save-v1-town` … `save-v7-eras`) must still load and round-trip.

**Era-1 guards:**
- **`tests/era1Frozen.test.ts`:**
  - snapshots `values` / `costs` / `maxLevel` / `describe` / `productMult` of the 22 Survival ids + `jack` with `climbOpen = false`;
  - snapshots `DEMAND`, `VILLAGE` and `QUARTERS`;
  - asserts Renown = Mastery = 1 and settlement ≤ 5 at age 1.
- **`node scripts/check-reveals.mjs`** must pass: nothing new before the Great Lodge, now that the Winter City reveals have moved (R2).
- **Draw calls**, village at night on a late post-climb save: carry 50 and dog 12 add 0 calls (render caps). Must stay within +5 of the 0.8.0 baseline (about 810 at High) and ≤ 950.

**File plan:**

| File | Change |
|---|---|
| `src/core/ladder.ts` (new) | `introEra`, `base`, `valueAt`, `costAt`, caps, Mastery points |
| `src/eras/gate.ts` (new) | `eraGate`, `nextGoal`, `climbOpen` |
| `src/eras/template.ts` (new, 0.10) | `ERA_CONTENT` |
| `src/ui/GateCard.ts` (new) | checklist |
| `src/core/Upgrades.ts` | ladder reads, `shownLevel`, `crewStats` (one level per `buy`, no batch buying) |
| `src/config.ts` | `CLIMB`, `GATE`, `SETTLEMENT`, template generators; drop authored costs of era-2+ ids |
| `src/eras/data.ts` | `eraScale` ×10, slots, `CITY_RANKS.minEra`; (0.10) materials and machines; delete `FIRST_EXPANSION_VILLAGE_LEVEL` |
| `src/eras/layout.ts` | `expansionOffered`, `expansionPreview` |
| `src/world/env/frontier.ts`, `src/progression/Progression.ts` | `climbOpen` / preview |
| `src/core/demand.ts` | `productMult` via ladder, `cityPopulation`, `settlementLevelFor`, Renown, Mastery |
| `src/core/Market.ts` | Renown/Mastery in `exportPrice`, product mult in `tradeMult`, bond `min(broker, 3.5)` |
| `src/core/types.ts`, `src/core/Save.ts` | `eras.settlement`, clamp, catch-up grant |
| `src/village/Village.ts`, `src/city/City.ts`, `src/eras/EraWorld.ts` | settlement updates on build / demolish |
| `src/ui/EraChip.ts`, `ShopPanel.ts`, `EraCard.ts`, `src/core/quests.ts`, `assets/machines.ts`, `ridgeMachines.ts` | next goal, band pips, cards for L ≥ 6, gate quests, band star |
| (0.10+) `src/npc/EraCrowd.ts` (new), `EraWorker.ts`, `EraCrew.ts`, `assets/eraMachines.ts`, `eraItems.ts`, `eraWorkers.ts`, `ui/materialIcons.ts`, `core/kinds.ts`, `assets/handNodes.ts`, `assets/pals.ts` | role mask, instancing, content |

---

## Implementation order

Each step is small and lands on its own with tests. There are no bot runs.

**0.9 (A, B, C, F):**
1. **`ladder.ts` + `era1Frozen.test.ts` + `ladder.test.ts`.** Pure code, not wired yet. Tests: frozen prefix, monotonic costs, caps, multiples of 5.
2. **Wire the ladder** into `Upgrades`, `demand.productMult`, the Save clamp, and the `crewStats` readers; add carry and dog render caps; add `climbOpen`. Tests: fixtures load; `setLevel` past the maximum; era-1 snapshot unchanged.
3. **Move the reveals to `climbOpen`.** Delete `FIRST_EXPANSION_VILLAGE_LEVEL`; add `expansionPreview`. Check: `check-reveals.mjs`, plus a reveal test at Winter City showing no new land.
4. **`gate.ts` + `expansionOffered` rewrite** with partial-pad grandfathering. `gate.test.ts`: row counts 23 / 48 / …, prereq rows, ready, the literal-mode switch.
5. **Settlement:** state field, `cityPopulation`, thresholds and names table, update hooks, `EraCard` for L ≥ 6, Renown, perks j1–j5. `settlement.test.ts`: capacity assert, monotonic, ≤ 5 at age 1.
6. **Era economy:** `eraScale = 10`; era-2+ ids on `F`; `CITY_RANKS.minEra`; `pacing.ts` + `pacing.test.ts`. Calibrate U, the 2.6 growth and the 1.05 step until every era is 60–200 min.
7. **UI:** EraChip next goal, GateCard (top 5, Go; read-only), ShopPanel bands, Progression `nextGoal`, gate quests, toasts and confetti.
8. **Mastery + the Founder's Scarf** (the S20 perk); jack, broker and bond caps. Tests: Mastery = 1 before the climb; no money loop (order → Jack, order → depot).
9. **Release prep:** fixture `save-v8-climb.json`; draw-call comparison on the late save (`perf-breakdown.js`); New Season handling (R12); docs (DESIGN Wave 14, README); then the remaining ROADMAP §4 items. Bump to 0.9.0.

**0.10 (D for eras 2–4):**
10. **`template.ts` + generators** (23 ids per era) + catch-up grant + `ProductId` / `tradeMult` extension. Tests: 23 ids per era, gate counts `23n−21`, a 0.9 fixture loads with granted levels.
11. **`EraCrowd` instanced renderer** replacing `CharacterRig` era workers (same `pickJob`), plus 70 m culling. Measure the draw calls in region 2.
12. **Role mask in `pickJob`** + the 6 new role jobs (Feeder, Shipper, Porter, Clerk with the cash pile and cash machine, Foreman, Gatherer); `requires.settlement`. Extend `eraCrew.test.ts`.
13. **Region slots 8 / 8 / 8**; hand node + `${key}Tool`; Carry / Boots / Pal (pal replaces the dog in its region).
14. **ARGON spec for eras 2–4** (ask Dino first). Then the 12 new machines, 9 materials, icons and gallery sheets for eras 2–4. Pacing model re-run.

**0.11:**
15. Eras 5–7: steps 13–14 repeated (slots 8 / 8 / 8, 11 machines, 7 materials). Draw-call check at a skyline edge.

**0.12:**
16. Eras 8–10: slots 9 / 9 / 10, 9 machines, 7 materials.
17. Settlement 46–50, the "Singularity" finale (all Lv 100 + Settlement 50), New Season moved to it.
18. Final pacing model. A full bot pass only if Dino asks.
