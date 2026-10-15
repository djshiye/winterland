# ARGON art guide (chat version, 2026-10-15)

This is the authoritative art guide. It replaces the palettes in `docs/art/guide.json`, which were darker and colder. The text was pasted by Dino from the Gemini "Argon" chat, and the palette table was read from his screenshots.

## Era palettes
Every era harmonises with snow `#f4f7fb`, pine `#2d4c3b` and warm gold `#f2b644`.

| Era | Ground | Fence | Machine body | Accent | Trim | Glow | Worker coat |
|---|---|---|---|---|---|---|---|
| 1 Survival | #e8eef5 | #7a4e32 | #8a5a3b | #c84b31 | #523522 | #ffaa44 | #9e623a |
| 2 Frontier | #dce3ec | #6e5a4f | #8c857b | #b85239 | #5c4028 | #ffb347 | #8c4a32 |
| 3 Iron Age | #d0d8e2 | #4f4c49 | #a65e46 | #4a5559 | #2f3538 | #ff9233 | #5c4d42 |
| 4 Steam Age | #c5ced9 | #464b4f | #9e4737 | #d49a35 | #383d40 | #ffbe55 | #783a2d |
| 5 Industrial | #bac4d0 | #525c63 | #5a6973 | #e08a2b | #333c42 | #ffd166 | #485866 |
| 6 Electric Age | #b4c0cc | #5c6b73 | #4c6b68 | #d97f38 | #2b3b39 | #7ce8c8 | #3d606e |
| 7 Oil Age | #aebac6 | #575552 | #d99b26 | #c44536 | #36383a | #ffaa5a | #b87b28 |
| 8 Computer Age | #c2ccd6 | #7c858e | #e6dec8 | #45858c | #4a5259 | #66e0a3 | #4a7585 |
| 9 Nuclear Power | #cbd6e0 | #6f828a | #dce3e6 | #4ea885 | #3d5259 | #70f5d9 | #468275 |
| 10 AI Era | #dae3ed | #8fa1b3 | #f5f0e6 | #e8a848 | #526475 | #ffe082 | #637a91 |

Era 9 and 10 rows were confirmed by ARGON on 2026-10-15.

Material themes:
- **Era 1–2:** rough timber, fieldstone, warm hearth firelight.
- **Era 3–5:** terracotta brick, forged iron, polished brass, riveted blue steel.
- **Era 6–7:** enamel teal, copper windings, hazard honey-yellow, crimson pipes.
- **Era 8–10:** warm retro-beige plastics, brushed pewter, cream ceramic composites, gold filigree, cozy sun-gold and mint glow.

## Global rules
- **Coordinates:** origin at the floor centre; +Y is up, +Z is the front, +X is right.
- **Meshes:** at most 3 per object:
  1. `body`: static merged geometry, including snow caps.
  2. `glow`: emissive, blooms at night.
  3. `anim`: one mesh with its own pivot.
- **Shading:** vertex colours and a 3-step warm toon ramp: +10 % on the sunlit top, 0 % in the mid tones, −18 % with a cool tint in shadow. No textures.
- **Snow:** every upward face wider than 0.4 m carries a 0.12 m rounded snow cap (`#f4f7fb`, shadow `#d9e4f0`).
- **Cozy invariant:** never clinical white, razor edges or harsh neon. Metals are warm-tinted. Glows are amber, peach, soft teal or warm mint. Bevels are at least 0.08 m.

## Machines
- **Size:** footprint at most 5.2 × 5.2 m, height at most 6.0 m.
- **Plinth:** a 4.8 × 4.8 × 0.25 m bevelled plinth in the era's Trim or Ground colour.
- **Silhouette:**
  - Walls taper 3–5° inward, or step back in tiers.
  - Three-part massing: a foundation with the input/output bays, a characterful core, and a vertical crown (chimney, dome, cooling tower, antenna or halo).
  - Bevels are 0.08–0.15 m.
- **Piles:** 1.2 × 1.2 × 0.15 m pallets, input at (−1.6, 0.12, +1.8) and output at (+1.6, 0.12, +1.8). Each holds up to 6 items.
- **Worker points:** operate at (0, 0, +2.2) facing −Z; pick up and drop off at (±1.6, 0, +2.4).
- **Glow:** 5–12 % of the visible surface. It idles at 0.4 while starved of input and pulses at 0.85–1.0 (1.5 Hz) while working.
- **Animation:** exactly one moving mesh, driven by a single phase.
  - Allowed motions: Y/Z rotation, vertical oscillation, or Z rocking.
  - The amplitude is at least 0.35 m, or the rotation radius at least 0.6 m.

## Shared worker body (~180 triangles, 1.60 m including the hat)
- **Boots:** 0.22 × 0.28 × 0.30 m, spaced 0.26 m apart.
- **Coat:** an 8-sided tapered cylinder, r 0.38 → 0.28 m, h 0.78 m, from y 0.24. A 0.10 m belt band sits at y 0.48.
- **Arms:** capsules, r 0.11 m, length 0.45 m, pivoted at (±0.34, 0.94, 0). They swing forward 45° when carrying an item at (0, 0.78, +0.42).
- **Head:** a sphere 0.42 × 0.40 × 0.42 m at y 1.02–1.42, with a 0.08 m nose.
- **Hat:** socket at (0, 1.38, 0), bounds at most 0.55 × 0.35 × 0.55 m.
- **Prop:** socket in the right hand at (+0.36, 0.62, +0.28), hidden while carrying.
- **Fixed colours:** skin `#f4c29f` (nose `#e5987d`), boots and belt `#3b2d26`, scarf ring `#f4f7fb` at y 1.00.
- **Role looks:**

| Role | Hat | Coat | Prop |
|---|---|---|---|
| Gatherer | pom-pom beanie (Accent) | era coat | axe or cutter, 0.55 m |
| Miner | domed lamp helmet (Trim + Glow) | era coat −15 % | pick or drill, 0.60 m |
| Hauler | trapper cap `#8a5a3b` | Accent | none |
| Smelter | flat cap + apron `#5c3a24` | `#a64b32` | tongs, 0.65 m |
| Engineer | peaked cap or visor (Accent) | era coat | wrench, 0.50 m |
| Scientist / AI tender | glowing hood (`#f5f0e6` + Glow) | `#e8e2d5` | data pad, 0.35 m |

## Material shape kit (fits in 0.42 m³; 6 items stack 3 × 2 on a pallet)
1. **Block** (0.40 × 0.32 × 0.40 m): raw bulk.
   - Log: a bundle of 3 logs with a `#c84b31` strap.
   - Stone: a stepped corner notch and a chisel line.
   - Ore or coal: a 3-lump cluster on a tray.
2. **Ingot** (0.42 × 0.18 × 0.26 m): a trapezoid with 15° sides. The top has a stamp trough and two raised ribs at +20 % brightness.
3. **Coil** (0.38 m diameter × 0.36 m): a hollow cylinder with 0.42 m flanges and a tail tab on +Z.
4. **Barrel** (0.36 m diameter × 0.42 m): 8-sided and bulged, with hoops at 25 % and 75 % height and a bung offset to +X.
5. **Crate** (0.40 m cube): recessed faces, an X-brace, and a 0.14 m colour-coded corner badge.
6. **Orb** (0.38 m icosahedron, 1 subdivision): a 0.42 m collar tilted 20° around a glowing core.
7. **Slab** (0.42 × 0.12 × 0.42 m): four corner studs and a stepped two-layer profile.

## 64 px icons
- **Canvas:** 64 × 64 px, with art inside the central 52 × 52 px.
- **View:** a 3/4 front-top view (30° top plane), or a bold front silhouette for tools.
- **Outline:** 3 px in `#261f1b` for eras 1–5 and `#1f2933` for eras 6–10. Inner lines are 2 px, with at most 3 inner shapes.
- **Shading:** three flat values: the top at +12 % (warm), the front-left at the base colour, the front-right at −16 % (slate).
- **Rules:** no gradients or shadows. Add one snow-white highlight dot on metal, glass and glowing items.
- **Era badge:** a 16 × 16 px pill at the bottom right, in the era's Body and Accent colours.
