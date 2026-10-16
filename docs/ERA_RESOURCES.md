# Era resources: a different main resource in every era

In Survival (era 1) the player chops a giant log, and the mill turns logs into planks and crates. From era 2 onward every era swaps the log for its **own main resource**, with its own hand action, tool, machines and goods to sell. Oil is drilled, refined and sold. Uranium is cut, enriched, burned in a reactor and sold as power.

This doc fills in [EXPANSION.md section D](EXPANSION.md#d-per-era-content-template-010012). It uses section D's node, material, machine, role and upgrade ids exactly as written. The one proposed change is listed at the end.

- **Models:** `src/assets/eraNodes.ts` builds the nine hand nodes and the nine hand tools (gallery: `?gallery=eraNodes`).
- **Art:** the node shapes follow the `node` entry in `docs/art/era-NN.json`. Colours are warmed to match `docs/art/guide.md`.

## Same size as Survival, every era

Every era keeps Dino's rule of "as many workers and tools as the last era":

| Per era | Count | What |
|---|---|---|
| Hand node | 1 | The giant-log analog. The player harvests it by hand |
| Hand tool | 1 | The `${key}Tool` upgrade. The player swings it at the node |
| Machines | 6 | 2 extractors, 2 processors, 1 premium, 1 cash |
| Worker roles | 7 | Hauler, Feeder, Shipper, Porter, Clerk, Foreman, Gatherer |
| Player upgrades | 4 | Carry, Boots, Tool, Pal |
| Sales upgrades | 5 | Trade, plus one per product |

## The loop in every era

1. **Harvest.** The player works the hand node with the era's tool. Each strike yields one unit of the era's first raw material onto the node pile. The Gatherer hauls that pile to the machines.
2. **Extract.** Two extractor machines dig up raw materials on their own.
3. **Process.** Two processors refine the raw materials. The premium machine combines refined goods into the era's top product.
4. **Sell.** Shippers carry goods to the export depot. The Clerk and the cash machine bank the takings.

## Era by era

Each era's hand action looks and moves differently from chopping. **Effect** is the reaction of the node's animated part on every strike.

### 2 Frontier: stone
- **Harvest:** chip the **Great Boulder** with the **Stone Pick** to get `stone`. The boulder squashes, and a stone flake pops off toward the player.
- **Gatherer:** the Stonebreaker, with a sledgehammer.
- **Extract:** `quarry` → stone; `clayPit` → clay.
- **Process:**
  - `kiln`: 2 stone → brick
  - `tileKiln`: 2 clay → roofTile
- **Premium:** `masonYard`: brick + roofTile → hearth.
- **Cash:** `strongbox`.
- **Sell:** stone, brick, roofTile, hearth.

### 3 Iron Age: iron ore
- **Harvest:** pick at the **Ore Vein** with the **Iron Pick** to get `ore`. A fan of rust sparks sprays from the banded seam inside a little timber mine frame.
- **Gatherer:** the Prospector, with a rock hammer.
- **Extract:** `ironMine` → ore; `charcoalClamp` → charcoal.
- **Process:**
  - `smelter`: 2 ore → iron
  - `forge`: iron + charcoal → tools
- **Premium:** `railMill`: 2 iron + charcoal → rail.
- **Cash:** `mintChute`.
- **Sell:** ore, iron, tools, rail.

### 4 Steam Age: coal
- **Harvest:** shovel the **Coal Seam** with the **Coal Shovel** to get `coal`. A soft soot puff rises from the black anthracite ledge, lit by a brass miner's lamp.
- **Gatherer:** the Coal Picker.
- **Extract:** `coalPit` → coal; `scrapYard` → scrap.
- **Process:**
  - `steamWorks`: scrap + coal → gear (0.9.6: was iron from era 3, which nothing delivered)
  - `boilerShop`: scrap + coal → boiler
- **Premium:** `engineWorks`: gear + boiler → steamEngine.
- **Cash:** `pneumaticTubes`.
- **Sell:** coal, gear, boiler, steamEngine.

### 5 Industrial: pig iron and steel
- **Harvest:** break the **Slag Heap** with the **Rivet Hammer** to get `pigIron` (0.9.6: era 5's own raw material; it used to reuse era 3's ore). The snowy crust lid lifts and thumps down over glowing molten seams.
- **Gatherer:** the Slag Raker, whose rake leans on the heap.
- **Extract:** `deepMine` → 2 pigIron; `cokeOven` → 2 coal.
- **Process:**
  - `steelMill`: pigIron + 2 coal → 2 steel
  - `rollingMill`: steel → girder
- **Premium:** `plowWorks`: girder + steel → snowplow.
- **Cash:** `bankVault`.
- **Sell:** pigIron, steel, girder, snowplow.

### 6 Electric Age: copper
- **Harvest:** drill the **Copper Vein** with the **Power Drill** to get `copper`. A teal electric arc crackles across the malachite and its copper ribbon.
- **Gatherer:** the Copper Scrapper, with cable snips.
- **Extract:** `copperMine` → copper; `quartzPit` → quartz.
- **Process:**
  - `wireMill`: 2 copper → 2 wire
  - `bulbWorks`: wire + quartz → bulb
- **Premium:** `radioWorks`: wire + bulb → radio.
- **Cash:** `tillLine`.
- **Sell:** copper, wire, bulb, radio.

### 7 Oil Age: crude oil
- **Harvest:** drill the **Oil Seep** with the **Ice Auger** to get `crude`. The auger hanging from a honey-yellow tripod spins down into the pitch pool and backs out.
- **Gatherer:** the Seep Skimmer, with a skimmer paddle.
- **Extract:** `oilPump` → crude; `gasWell` → gas.
- **Process:**
  - `refinery`: 2 crude → plastic
  - `cracker`: crude + gas → fuel
- **Premium:** `snowmobileWorks`: plastic + fuel → snowmobile.
- **Cash:** `driveThruVault`.
- **Sell:** crude, plastic, fuel, snowmobile.

### 8 Computer Age: silicon
- **Harvest:** sift the **Sand Dune** with the **Laser Sieve** to get `silicon`. A ring of mint silica glints swirls fast round the dune and lifts.
- **Gatherer:** the Sand Sifter.
- **Extract:** `sandPit` → silicon; `goldPanner` → gold.
- **Process:**
  - `chipFab`: 2 silicon → 2 chips (0.9.6: was silicon + wire from era 6, which nothing delivered)
  - `boardShop`: chip + gold → board
- **Premium:** `pcAssembly`: board + chip → computer.
- **Cash:** `atmNetwork`.
- **Sell:** silicon, chip, board, computer.

### 9 Nuclear Power: uranium
- **Harvest:** cut the **Uranium Crystal** with the **Geiger Tongs** to get `uranium`. A soft mint halo breathes round the green crystal spires and swells on each cut.
- **Gatherer:** the Crystal Cutter, with an ultrasonic cutter.
- **Extract:** `uraniumMine` → uranium; `graphitePit` → graphite.
- **Process:**
  - `enricher`: 2 uranium → fuelRod
  - `reactor`: fuelRod → 3 power
- **Premium:** `batteryPlant`: power + graphite → battery.
- **Cash:** `atomicVault`.
- **Sell:** fuelRod, power, graphite, battery.

### 10 AI Era: data shards, tuned out of crystal
- **Harvest:** tune the **Data Crystal** with the **Nano Wand** to get `dataShard` (0.9.6: era 10's own raw material; it used to reuse era 9's power). A gold light ribbon spins up round the cream monolith and its lavender shard.
- **Gatherer:** the Prospector Drone, with a resonator probe.
- **Extract:** `fusionPlant` → power; `nanoFab` → dataShard.
- **Process:**
  - `dataCenter`: dataShard + power → aiCore
  - `robotWorks`: aiCore + dataShard → robot (0.9.6: was steel from era 5, which nothing delivered)
- **Premium:** `quantumLab`: aiCore + power → quantumCore.
- **Cash:** `quantumBank`.
- **Sell:** dataShard, aiCore, robot, quantumCore.

## Wiring notes for the 0.9 thread

`eraNodes.ts` only builds models. Placing them, the economy and the UI belong to the 0.9 thread.

**Exports:**
- `ERA_NODES[n]` gives the node's `name`, `yields`, `verb` and `tool`.
- `createNodeModel(n)` returns `{ root, radius, strike, hit(), animate(dt) }`.
- `createNodeTool(n, band)` builds the hand tool.

**To wire each era's node:**
1. **Place the node** in the region's front yard, with +Z facing where the player stands. Give it a harvest zone of radius `radius + 1` m.
2. **Aim the swing.** While the player is in the zone, call `player.setChopTarget(root.localToWorld(strike.clone()))`, the same pattern as `GiantLog.surfacePoint`.
3. **Handle a strike.** On `player:chopHit`, call `node.hit()` and `launchNew(ERA_NODES[n].yields, …)` into the hand-node pile. That pile is the Gatherer's source. The strike interval is `${key}Tool` (×0.96ˢ, floor 0.25·i₀).
4. **Label the action** with `ERA_NODES[n].verb` (Chip, Pick, Shovel, Break, Drill, Sift, Cut, Tune) instead of "Chop".
5. **Swap the tool.** While the player is in region n, replace the axe with `createNodeTool(n, band)`. It uses the axe's hand frame (handle along −Y, working end leading −Z), so `Player.ts` can swap it where it swaps axes today. `band` 0–5 follows the Tool upgrade level, and the head turns gold from band 4.
6. **Animate.** Call `node.animate(dt)` every frame, and cull it with the rest of the region beyond 70 m.

**Draw calls:**
- **At rest:** the node is 2 calls (body and glow) in eras 2, 3, 4 and 6, whose effect is hidden while idle.
- **Always 3:** eras 5, 7, 8, 9 and 10 keep their animated part visible (the crust, auger, glints, halo and ribbon).
- **Budget:** section D's budget says "node 2". Please allow 3.
- **Tool:** the hand tool is 1 call.

## Proposed change to section D

**Era 7 tool: Air Wrench → Ice Auger.** Dino asked for oil to be *drilled*. An auger drilling into the seep says that directly, and a wrench does not. The model and `ERA_NODES[7].tool` already use "Ice Auger". If you'd rather keep Air Wrench, it is a one-word rename. The model stays a drill.

0.9.6 (1.0 decisions 8 and 15): every era's chain now runs on its own land (no input or build material from an older
era), eras 5 and 10 mine their own raw material (`pigIron`, `dataShard`, each with its Fine upgrade), and the recipes
are balanced so one extractor feeds its processor. Era 2-4 changes: the clay pit and charcoal clamp run faster, the
smelter makes 2 iron, the rail mill takes 1 iron, the scrap yard digs 2 scrap. `ERA_PACE` in `src/eras/data.ts` keeps
each era's model length. ARGON prompts for the two new item models: `/mnt/project-files/argon/ARGON_PROMPTS_0.9.6_items.md`.
