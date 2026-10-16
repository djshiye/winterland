# Era 5 item: Pig Iron

## 1. Overview & Role
* **Era:** 5 (Industrial)
* **Source:** Deep Mine, Slag Heap (hand node)
* **Consumer:** Steel Mill (1 Pig Iron + 2 Coal → 2 Steel Beams)
* **Visual Vibe:** Warm, freshly sand-cast "sow and pigs" notched bar. Sooty plum-charcoal iron with a cosy, cooling ember-orange glow in the casting notches and bubbly sand-crust undersides.

## 2. Dimensions & Transform
* **Bounding Box:** `0.44 m` (X, width) × `0.16 m` (Y, height) × `0.22 m` (Z, depth)
* **Origin:** `(0, 0, 0)` at floor centre; `+Z` = front, `+Y` = up
* **Mesh Budget:** Single merged `BufferGeometry`, vertex-coloured, toon-shaded, ~140 tris

## 3. Procedural Primitives (5 parts)
* **Lower Sand-Cast Base (`BoxGeometry`):** `0.42 × 0.08 × 0.20 m` at `(0, 0.04, 0)`. Flat bottom (`Y = 0`) for stable stacking; slight inward taper on lower edges, coloured in warm foundry rust-crust.
* **Knuckle Segment Left (`BoxGeometry`):** `0.13 × 0.08 × 0.22 m` at `(-0.145, 0.12, 0)`. Bevelled top edges (`0.02 m` chamfer), flat top face at `Y = 0.16 m`.
* **Knuckle Segment Centre (`BoxGeometry`):** `0.12 × 0.08 × 0.22 m` at `(0, 0.12, 0)`. Matches height `Y = 0.16 m` to maintain a continuous flat stacking plane across the three lobes.
* **Knuckle Segment Right (`BoxGeometry`):** `0.13 × 0.08 × 0.22 m` at `(+0.145, 0.12, 0)`. Mirrors left knuckle.
* **Pour-Spout Runner (`CylinderGeometry`, 6-sided, rotated 90° X):** `r = 0.035 m`, `l = 0.24 m` at `(0, 0.07, 0)`. Runs front-to-back (`+Z` to `-Z`), protruding `0.01 m` at each end like a snapped sand-mould sprue.

## 4. Vertex Colour Palette (Era 5 Warm Foundry)
* **Base (Sooty Cast Iron):** `#4a444b` — top and upper side faces of the three knuckles; notably darker and warmer than Era 3's `#8d949c` silver ingot.
* **Shade (Slag Plum-Black):** `#2d2830` — lower bevels and recessed faces between knuckles.
* **Rough Crust (Foundry Sand & Rust):** `#7a4b3a` — lower base block and end-grain faces, harmonising with `#8a5a3b` timber.
* **Warm Accent (Cooling Ember):** `#e87a3e` (with `#f3a833` gold vertex highlights) — baked directly onto the inner V-groove vertices (`X = ±0.072 m`) and the snapped front/back faces of the pour-spout runner.

## 5. 25 m Readability & Silhouette Key
* **The Unmistakable Detail:** The **three-lobed "Toblerone" knuckle silhouette split by two bright `#e87a3e` ember-orange V-notches** across the top and front.
* **Contrast Matrix:**
  * *vs. Era 3 Iron Ingot (`#8d949c`):* Dark plum-grey (`#4a444b`) with 2 glowing orange notch stripes vs. smooth, un-notched silver trapezoid.
  * *vs. Coal:* Structured rectangular footprint with crisp rhythmic stripes vs. irregular black organic lump.
  * *vs. Steel Beam:* Compact, chunky notched loaf (`0.44 m`) vs. long, thin grey I-profile girder.

## 6. Stacking Behaviour (3 × 2 × 4 Pile = 24 Items)
* **Footprint:** `1.32 × 0.64 × 0.44 m` (3 wide along X, 4 high along Y, 2 deep along Z).
* **Contact Planes:** Flat bottom (`Y = 0.00 m`) rests flush on the flat co-planar tops of the three knuckles (`Y = 0.16 m`).
* **Visual Rhythm:** Stacked 4-high, the dark `#4a444b` top knuckles and `#7a4b3a` rust undersides create horizontal foundry bands, while the `#e87a3e` notches align into **9 warm vertical/isometric pin-stripes** that read like a cosy glowing brazier against `#f4f7fb` snow.

## 7. 64 px Flat Icon (`viewBox="0 0 48 48"`)
* **Outline:** `3 px` rounded stroke in `#1f2b46`.
* **Composition:** 3/4 isometric chunky notched bar tilted at 30°, showing the three rounded top knuckles in `#4a444b`, a warm rusty bottom lip in `#7a4b3a`, and two bold V-cut channels filled with `#e87a3e` and a `#f3a833` inner highlight dot on the snapped front sprue.

<!-- Built in src/assets/eraItems5to7.ts (buildPigBar) and src/ui/materialIcons5to7.ts (pigIron). The Steel Mill makes 2 steel per cycle in 0.9.6, so the consumer line says 2. -->
