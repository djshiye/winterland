# Era 10 item: Data Shards

## 1. Overview & Role
* **Era:** 10 (AI Era)
* **Source:** Nano Fab, Data Crystal (hand node)
* **Consumer:** Data Center (1 Shard + 1 Power Cell → 1 AI Core), Robot Works (1 AI Core + 1 Shard → 1 Robot)
* **Visual Vibe:** Warm, candy-like cluster of three flat-topped magenta-violet quartz prisms cradled in a brushed-gold circuit socket. Reads like a cosy magical synth-geode rather than cold sci-fi tech.

## 2. Dimensions & Transform
* **Bounding Box:** `0.36 m` (X, width) × `0.30 m` (Y, height) × `0.30 m` (Z, depth)
* **Origin:** `(0, 0, 0)` at floor centre; `+Z` = front, `+Y` = up
* **Mesh Budget:** Single merged `BufferGeometry`, vertex-coloured, toon-shaded, ~148 tris

## 3. Procedural Primitives (5 parts)
* **Circuit Cradle Base (`BoxGeometry`):** `0.34 × 0.08 × 0.28 m` at `(0, 0.04, 0)`. Flat bottom (`Y = 0.00 m`), chamfered top rim in warm gold with stepped vertical side notches that read as chunky gold contact pins.
* **Main Centre Prism (`CylinderGeometry`, 6-sided):** `rTop = 0.09 m`, `rBottom = 0.11 m`, `h = 0.22 m` at `(0, 0.19, -0.02)`. Upright with a dead-flat horizontal top face (`Y = 0.30 m`) for stacking stability.
* **Left Leaning Shard (`CylinderGeometry`, 5-sided):** `rTop = 0.065 m`, `rBottom = 0.08 m`, `h = 0.22 m` at `(-0.10, 0.19, 0.03)`, tilted `-8° Z` with top vertices sheared flat to `Y = 0.30 m`.
* **Right Leaning Shard (`CylinderGeometry`, 5-sided):** `rTop = 0.065 m`, `rBottom = 0.08 m`, `h = 0.22 m` at `(+0.10, 0.19, 0.03)`, tilted `+8° Z` with top vertices sheared flat to `Y = 0.30 m`.
* **Front Circuit Bus (`BoxGeometry`):** `0.26 × 0.12 × 0.04 m` at `(0, 0.12, 0.13)`. Bridges the three shards on the `+Z` face, painted with vertical gold logic-trace stripes.

## 4. Vertex Colour Palette (Era 10 Warm Synth-Quartz)
* **Base (Berry Amethyst):** `#9b4dca` — mid-body crystal facets; vibrant and warm against `#f4f7fb` snow.
* **Shade (Deep Plum-Indigo):** `#4a2574` — lower crystal crevices and back-facing `-Z` facets.
* **Baked Glow Tint (Rose-Magenta Blush):** `#ff7eb6` — baked onto the flat `Y = 0.30 m` top table faces and inner shard junctions for a soft internal luminescence.
* **Warm Accent (Gold Circuitry & Socket):** `#f3a833` (shaded `#b8732a` on lower base rim) — cradle base and vertical circuit traces on the front bus.

## 5. 25 m Readability & Silhouette Key
* **The Unmistakable Detail:** The **three-pronged flat-topped berry-magenta crown (`#9b4dca` / `#ff7eb6`) sitting in a bright `#f3a833` gold circuit tray**.
* **Contrast Matrix:**
  * *vs. Era 8 Silicon (`#8ea2b8`):* Warm magenta-pink 3-prong cluster in a gold tray vs. cool grey-blue monolith without a metallic base.
  * *vs. Era 9 Power Cell:* Splayed crystal silhouette in purple/gold vs. smooth cylindrical teal battery.
  * *vs. AI Core:* Multi-point purple cluster with flat pink tops vs. single symmetrical amber hexagonal gem.

## 6. Stacking Behaviour (3 × 2 × 4 Pile = 24 Items)
* **Footprint:** `1.08 × 1.20 × 0.60 m` (3 wide along X, 4 high along Y, 2 deep along Z).
* **Contact Planes:** Flat bottom of the gold cradle (`Y = 0.00 m`) sits solidly across the three co-planar sheared crystal tops (`Y = 0.30 m`).
* **Visual Rhythm:** Stacked 4-high, the `#f3a833` gold cradles form four crisp horizontal metallic shelves separating rows of glowing `#ff7eb6` / `#9b4dca` berry crystals, looking like a miniature rack of enchanted server blades.

## 7. 64 px Flat Icon (`viewBox="0 0 48 48"`)
* **Outline:** `3 px` rounded stroke in `#1f2b46`.
* **Composition:** Front-angled trio of flat-topped `#9b4dca` crystal pillars with bright `#ff7eb6` top facets, emerging from a chunky `#f3a833` gold tray that features two vertical gold circuit trace lines stepping up the centre shard.

<!-- Built in src/assets/eraItems8to10.ts (buildShards) and src/ui/materialIcons8to10.ts (dataShard). -->
