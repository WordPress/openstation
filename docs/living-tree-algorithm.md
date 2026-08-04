# The Living Tree — algorithm definition

> **Status:** *Experimental.*
> This document is the normative source of truth for the `wp-living-tree`
> canvas wallpaper. The implementation under
> `src/plugins/living-tree-wallpaper/` mirrors it method-for-method — the
> spec wins on any disagreement. The topology-invariance guarantees below
> are enforced by `tests/vitest/living-tree-invariance.test.ts`.

The Living Tree is an animated desktop wallpaper (OpenStation) that renders
the site as a **living plant organism**. Its shape is the visual fingerprint
of the site's life: a tree that grows from the ground up, with **leaves**
(posts), **blossom** (comments), **meadow wildflowers** (categories),
**butterflies** (tags), **fireflies** (online users), and **wind**
(traffic). An empty WordPress should read as a *sprout*; a ten-year-old site
as a *frondose oak* standing in a flowering meadow.

It is **not interactive**: no zoom, no pan. The camera is fixed to the
desktop. Once the tree has finished growing, the only permanent animation is
the **wind** swaying branches, leaves, and wildflowers, plus the butterflies,
the fireflies, and a slow color easing.

---

## The golden rule (design invariant)

**WordPress never emits geometry. It emits hormones.**

WordPress reports scalar, biologically-flavoured signals — age, vigour,
health, diversity, bloom, foliage… — all normalised. Geometry is decided by
*the biology* (the growth simulator) inside **immutable morphological
constraints**. WordPress never positions a branch, never sets a coordinate,
never says "this post goes here."

This is what guarantees that **any topology produces tree morphology and
never a database diagram**. A site with 1 category and 5000 posts, and a site
with 2000 categories and 1 post each, at the same *age* grow the **same
skeleton**. The content difference shows up only in the **decoration**
(density and colour of leaves, LOD), never in the shape of the trunk or the
count of branches.

If you ever find yourself threading a post ID, a term ID, or a coordinate
from PHP into the growth simulator, stop — you are breaking the invariant.

---

## A.1 Two layers

The system is split into two layers with very different update cadences.

| Layer | What it is | Cadence | Owner |
|---|---|---|---|
| **Morphology** | The skeleton: trunk + branches. | Slow, structural. Grows once, bottom→top, frame by frame, then settles. | Space Colonization, seeded deterministically per site, bounded by an **age-dependent envelope**. |
| **Content** | The decoration: leaves, blossom, wildflowers, butterflies, fireflies, colour. | Fast, volatile. Repositioned / recoloured without touching the skeleton. | The hormones feed this layer directly. |

WordPress **only** feeds the CONTENT layer and **modulates** MORPHOLOGY
parameters via hormones. It never positions a branch.

A data refresh (re-poll) re-points the hormones and re-eases the decoration.
The skeleton only re-grows if **age** crosses a level threshold (see the age
table in A.4).

---

## A.2 Determinism

```
seed = hash32( siteUrl + '|' + siteName + '|' + installEpoch )
PRNG = mulberry32( seed )
```

- **Same site → same skeleton** on every page load. The skeleton is a pure
  function of the seed plus the age/vigour hormones.
- **Different sites → different trees**, even with identical metrics. Two
  installations with the same number of posts must never look identical.
  The blog NAME is part of the seed on purpose: two blogs can share a URL
  shape (two localhost installs, staging clones) and still must grow
  distinct individuals. The same identity also nudges each site's base
  canopy green (±12°), and the envelope jitter is wide (height ±12%,
  crown ±18%) so sites differ in stature, not just in branch layout.

Every stochastic choice in the morphology layer draws from this single
seeded PRNG so the whole skeleton is reproducible. The `rng.ts` module
(`hash32` + `mulberry32`) is the only randomness source the growth layer is
allowed to touch. The decoration layer may use per-index variation seeded
from the same PRNG so a reload doesn't reshuffle leaf colours.

---

## A.3 Hormones — the DNA

Hormones are the **only** crossing point from WordPress into the simulator.
`buildHormones( snapshot )` maps a `TreeSnapshot` (raw WP metrics) to a
`Hormones` object, all normalised to `0..1` (except `spark`, an integer
count).

| Hormone | Source | Drives |
|---|---|---|
| `age01` | `ageCurve( siteAgeDays )` — saturating logarithmic. | **Master clock.** Height, trunk girth, `maxDepth` (levels), envelope size. |
| `vigor01` | Energy: `f( posts, comments, traffic, users − errors − cpu )`. | Growth speed, branching density. |
| `foliage01` | Post count, saturating and LOD-capped. | Canopy fill. |
| `health01` | SEO / site health. | Leaf colour temperature and vitality. |
| `bloom01` | Comment density (comments / post). | Fraction of leaves that flower. |
| `wind01` | Traffic. | Wind amplitude / frequency. |
| `structure01` | Pages (evergreen content). | Trunk ivy — an evergreen cloak climbing the trunk + heavy boughs (coverage height + density). |
| `vitality01` | Performance. | Canopy turgor — leaf fullness + brightness. |
| `spark` | Active (online) users. | Number of fireflies (visible at night). |

Two decoration budgets sit beside the hormones, each a pure saturating
function of one aggregate count: `computeFlowerCount( totalCategories )`
(meadow wildflowers) and `computeButterflyCount( totalTags )`
(butterflies). Like the hormones they only ever touch decoration, never
the skeleton.

### `ageCurve`

The `min()` of two monotone regimes:

- **Sapling regime (linear)** — `days / 250`, which wins for roughly the
  first five months. The raw log curve alone rockets early (a day-old site
  sat at ~8% of the master clock, a month-old one at ~42% — sprout to full
  tree overnight), and a smoothstep damp tried first had the opposite
  failure — its quadratically-flat start pinned days 0–10 at the 2-node
  sprout. The linear clock advances the same small step every day: each
  early day visibly adds a node or two, day 30 reads as a small sapling
  (~12% of the clock, with the A.4 depth cap bounding its structure on top).
- **Log regime** — the saturating logarithmic curve, which wins from ~5
  months on: fast through the first years, flattening as the site ages so a
  10-year-old site and a 12-year-old site look similar in *scale* (extra age
  past ~10y buys texture, not height — see A.4).

Monotone across the whole domain — the depth-unlock table in A.4 compares
through the same curve, so level thresholds stay pinned to their configured
day counts regardless of the curve's shape.

### `vigor01`

A normalised composite of positive energy (posts, comments, traffic, users)
minus drains (error rate, CPU/perf pressure). Clamped to `0..1`. Controls how
*fast* the tree grows and how *densely* it branches — a busy, healthy site
fills its envelope quickly and thickly; a dormant one grows slowly and
sparsely within the **same** envelope.

---

## A.4 Envelope & maximum structure (depend on age + vigour only)

`buildEnvelope( age01, vigor01, rng )` returns an `Envelope` — the silhouette
the crown is allowed to fill (an ellipse / egg sitting on a trunk gap), plus:

- `heightMax` (`Hmax`) — overall tree height.
- `crownRadius` — half-width of the canopy.
- `trunkBaseGirth` — base thickness of the trunk.
- `maxDepth` — maximum branching levels, from the age table:

| Age | Levels |
|---|---|
| 0–30 days | 2 |
| 1–6 months | 4 |
| 6–24 months | 6 |
| 2–5 years | 8 |
| 5–10 years | 10 |
| 10+ years | effectively unlimited (finer bifurcations / texture, **not** more height) |

**The canonical-skeleton principle (the crux):** the envelope — and
therefore the attractor cloud and the fully-grown skeleton — is a function
of the **seed alone**. Age never touches geometry; it gates three things:

- `revealCountForAge( total, age01 )` — how many nodes of the canonical
  skeleton are *revealed*, in growth order (monotone in age);
- `maxDepthForAge( age01 )` — the branching levels unlocked (the table
  above);
- `trunkGirthForAge( age01 )` — how thick the revealed wood is.

Two invariants fall out of this, both pinned by tests:

1. **Topology invariance** — 5 posts and 50 000 posts at equal age reveal
   the *same* skeleton; content appears only in decoration (leaf density /
   colour, LOD). Categories and tags never enter the geometry.
2. **Gradual growth** — the tree at day N+1 *contains* the tree at day N,
   node for node, plus a few more. Growth is monotone accretion, never a
   reshuffle. (An earlier design derived the envelope from `age01`; every
   daily tick of `siteAgeDays` shifted the sampling boundaries and re-rolled
   the whole tree.)

`sampleAttractors( env, count, rng )` scatters the auxin sources inside the
envelope volume using the seeded PRNG. The cloud is dense on purpose —
attractors surviving near a passing branch (tight kill radius) pull out the
fine interior twigs that let foliage clothe the whole canopy.

---

## A.5 Space Colonization core (the morphology engine)

Engine: **Space Colonization** (Runions et al., 2007, *"Modeling Trees with a
Space Colonization Algorithm"*).

**State:**
- `nodes: BranchNode[]` — starts with a single root node at the base.
- `attractors: Vec2[]` — auxin sources sampled inside the envelope (A.4).

**Per growth step `step( budget )`:**

1. Each attractor finds the **closest node** within its influence radius `di`.
2. Each node that has ≥1 associated attractor averages the direction toward
   them, normalises it, and **spawns a child** at
   `pos + dir · segLen`, plus:
   - PRNG jitter (organic wobble),
   - an **upward tropism** term (this is what makes growth go bottom→top),
   - a slight gravity **droop** at the tips.
3. Attractors within the **kill radius** `dk` of any node are removed.
4. Termination: attractors exhausted **or** the age-derived node cap reached.

**Why bottom→top emerges:** root at the base + attractors above + upward
tropism. No coordinate is dictated; the direction is an emergent average.

**Incremental growth:** the number of new nodes added *per frame* is capped
at `growthRate = f( vigor01 )`, so the tree visibly grows sprout→canopy in
~3–6 s and then settles. It **never appears fully-formed** — it grows in.

### Girth (thickness)

A post-pass accumulates thickness from child→parent by **Murray's / da
Vinci's law**:

```
parentR^n = Σ childR^n     (n ≈ 2.2)
```

The trunk-base girth is scaled by `age01`. `computeGirth( nodes, trunkBase,
exponent = 2.2 )` walks the node tree from tips to root filling
`BranchNode.radius`.

---

## A.6 Skeleton → geometry (no sprites)

`buildBranchMesh( nodes, pixi )` turns the node graph into renderable ribbon
geometry — **no branch sprites**, so no two branches are ever identical:

For each parent→child chain:

1. Build a **centerline** through the node positions (Catmull-Rom).
2. Subdivide it.
3. Displace each sample with **Perlin / simplex noise** (organic undulation).
4. Emit a **tapered ribbon** (triangle strip) — or a thick PIXI stroke — with
   width = interpolated `girth` along the chain.

Per-vertex **`compliance`** is stored (0 at the root → 1 at the tips) and
drives the wind: tips sway, the trunk stays still.

---

## A.7 Leaves (posts) — placement, not mapping

`LeafGenerator.populate( nodes, hormones, palette )`:

- **Never "one leaf per post."** A hard cap `maxLeaves = f( foliage01 )`
  (e.g. 400–1600). `postsPerLeaf = ceil( totalPosts / maxLeaves )`. Because
  there is no zoom, this is a **fixed LOD cap** — no split-on-zoom.
- Leaves seek **terminal nodes** (highest `compliance` / most "light");
  distributed along branch length with jitter.
- **Hue** is the site's own canopy green (`canopyHue`, ±12° per identity)
  with small random per-tuft variation — natural foliage, never a data
  legend. (An earlier design partitioned the crown into per-category hue
  wedges; real trees don't grow in colour sectors, so categories moved to
  the meadow wildflowers — A.8.)
- **Colour value = `health01` / SEO:** green (high) → yellow → red → grey
  (dead). **Size = `log( visits )`.** A very old post → desaturated / curled
  (dry).

`LeafGenerator.update( dt, wind )` eases each leaf's colour and size toward
its target and applies the wind displacement (× per-leaf compliance).

---

## A.8 Blossom, wildflowers, butterflies, wind, fireflies

- **`BloomEngine`** — fraction of leaves that flower = `bloom01`; a leaf with
  high comment density is promoted to a flower (petals drawn with `Graphics`).
  `apply( bloom01 )` selects the set; `update( dt )` animates the bloom.
- **`FlowerField`** — categories bloom as **meadow wildflowers**: each
  category reads as a patch of one species + colour (four hand-drawn
  species — daisy, poppy, bellflower, cosmos — rasterized once per
  species+colour combo) growing in the grass around the trunk. One
  category is already a small cluster; `computeFlowerCount()` saturates
  hard (cap 80) so 2000 categories is a flowerbed, never a sprite storm.
  Every flower is ONE sprite anchored at its stem base, bending with the
  wind like a single stalk. Layout draws from its own seeded stream
  (`<seed>|flowers`). `build( opts )` then `update( dt, t, displace )`;
  `targets()` exposes the flower heads as butterfly waypoints.
- **`ButterflyLayer`** — tags do **not** create branches; they
  *cross-pollinate*. Tags render as **butterflies working the category
  wildflowers**: flying flower to flower, perching with slow wing-pumps,
  banking with their own flight. `computeButterflyCount( totalTags )`
  saturates at 8; wing-colour variety grows with the population. One
  sprite each — the flap is a `scale.x` fold along the body axis. They
  live inside the tree body, so night dims them exactly as the fireflies
  wake: butterflies by day, fireflies by night. Colours and first perches
  draw from the seeded PRNG; the wandering itself is `Math.random()`,
  like the fireflies — flight is live behaviour, not DNA.
  `populate( totalTags, targets, roam, rng )` then `update( dt, t )`.
- **`GroundLayer`** — the meadow: soil mounds (soft gradient sprites), a
  contact shadow, a full-coverage turf of thousands of individually-
  drawn grass blades (STATIC — tessellated once into a single Graphics;
  see the performance note), and a few fallen leaves near the trunk.
  Grass colour runs through the same
  `leafColor()` health ramp as the canopy — poor SEO dries the lawn too.
  Layout draws from its own seeded stream (`<seed>|ground`), stable per
  site and isolated from the skeleton's PRNG.
- **`IvyLayer`** — pages render as trunk ivy: small dark evergreen leaves
  on exactly the thick wood the canopy's leaf placer disqualifies,
  climbing bottom→up with `structure01`. Pure decoration; replaced an
  earlier pages→girth channel that read as arbitrary trunk fatness.
- **`WindField.sample( x, y, t )`** — sum of 2–3 sines (gust + breeze) scaled
  by `wind01`, applied per vertex / per leaf multiplied by `compliance` (tips
  sway, trunk still). Non-interactive. **Reduced-motion → `wind01 = 0`,
  static frame.** `setStrength( w01 )` retunes live.
- **`FireflyLayer`** — `spark` particles in a `ParticleContainer` with
  additive glow, drifting through the canopy; the count follows live
  presence. `setCount( n )` then `update( dt )`.
- **`FallingLeaves`** — every few seconds one leaf detaches from a real
  canopy position (same tint/size as the tuft it left), tumbles down
  through the wind, and fades into the grass. Sparse by design (≤5
  airborne). Ambient motion like the fireflies — `Math.random()` timing,
  no DNA involvement, nothing falls under reduced motion.

---

## A.9 Empty WordPress = a sprout

With `age01 ≈ 0`, `vigor01 ≈ 0`, `foliage ≈ 0`: the envelope is minimal, SCA
emits 2–3 nodes, a handful of leaves. Literally a sprout. This is guaranteed
because the **floor of the envelope IS a sprout**, and Space Colonization over
a tiny envelope still yields a little-tree shape — never an empty canvas,
never a stray diagram.

---

## A.10 Main loop (per frame)

```
if growing:
    sim.step( min( budget, growthRate ) )   // adds branches bottom→top until the envelope fills
    girth.update()

leaves.update( dt, wind )    // colour / size ease toward target
bloom.update( dt )
flowerField.update( dt )     // wildflower sway (30 Hz with the canopy)
butterflies.update( dt )     // full rate — the wing-flap needs it
wind.apply( t )              // displace FOLIAGE by compliance · windField (wood + turf stay static — see notes)
fireflies.update( dt )
renderer.draw()
```

Growth runs **once** (sprout → settled). After that, only wind +
butterflies + fireflies + slow colour easing animate. On a data refresh (`trackedFetch` re-poll) the
hormones re-point and the decoration re-eases; the skeleton only re-grows if
**age** crosses a level threshold (A.4).

---

## A.11 Render layers (PIXI containers, back → front)

```
ground · wildflowers · branches (ribbon mesh) · leaves (ParticleContainer) · blossom · butterflies · fireflies (additive)
```

No camera zoom / pan. Fixed fit to the desktop. A `ResizeObserver` re-fits the
envelope on resize (the *envelope* re-fits; the seed and therefore the
skeleton topology are unchanged).

---

## Data contract summary

The wallpaper fetches a `TreeSnapshot` from
`GET desktop-mode/v1/living-tree/snapshot` (see
`includes/living-tree/snapshot.php`). The snapshot is **compact DNA, not the
database**: aggregate counts and a `branches` hint — never the full post
list. The client turns the snapshot into hormones and never sees
individual rows.

Permission defaults to `current_user_can( 'read' )`, filterable via
`openstation_living_tree_user_can_use`. The response is cached in a transient
(`openstation_living_tree_*`, TTL 6h, keyed by a content signature;
invalidated on `save_post` / `deleted_post` / `comment_post`).

---

## Implementation notes (as shipped)

- **Canonical skeleton + reveal.** The mature skeleton is grown to
  completion at mount (a pure function of the seed, ~tens of ms);
  `revealSkeleton()` then exposes the age-gated prefix. The growth
  animation is a staged reveal in original growth order (bottom → top),
  paced by `growthRate = f( vigor01 )` — pacing never changes what the
  tree looks like, only how fast it appears.
- **Envelope purity.** `buildEnvelope()` accepts `age01` / `vigor01` for
  signature stability but deliberately uses NEITHER for shape. Both the
  invariance suite and the gradual-growth suite fail if this regresses.
- **Anti-dive.** Late in a run only low leftover attractors remain and
  branches would chase them downward. Two guards: a direction clamp
  (steeper than a gentle sag gets damped hard) and stall-pruning
  (unreachable low attractors are dropped rather than chain-chased).
- **Branch rendering.** Tapered rounded strokes into one `Graphics`,
  redrawn only while the skeleton changes (growth / tuner regrow) —
  NEVER per frame. The wood and the turf are static at steady state AND
  baked with `cacheAsTexture` (one textured quad each per frame instead
  of thousands of vertices); the bake is released during regrowth and
  re-applied when the tree settles. Re-tessellating the ribbon skeleton
  every frame (and rotating hundreds of grass-clump containers) was the
  wallpaper's whole CPU bill. The foliage carries the wind — leaves,
  blossom, wildflowers, butterflies, fireflies are sprite-transform
  updates the GPU batches cheaply, with the big loops (canopy, blossom,
  wildflowers) ticking at 30 Hz.
  Measured on the software rasterizer (worst case): 133 ms → 33 ms per
  frame. Colour
  lightens with compliance (dark trunk → warm extremities).
- **Decoration randomness.** The skeleton and leaf/bloom/wildflower
  placement draw from the seeded PRNG (same site → same canopy and
  meadow). Firefly wander and butterfly flight use `Math.random()` —
  live behaviour, not DNA.
- **Health sources.** `performance` reads core's own Site Health
  tallies (the weekly-cron `health-check-site-status-result` transient:
  1.0 minus 0.15 per critical and 0.04 per recommendation, clamped to
  [0.2, 1]), falling back to 0.8 until the first tally exists.
  `seoHealth` is the remaining gap: WordPress ships nothing SEO-shaped
  to read, so PHP serves a healthy 0.7 default — the planned future
  source is aggregating the per-post scores SEO plugins keep in
  post-meta. Both pass through their
  `openstation_living_tree_seo_health` /
  `openstation_living_tree_performance` filters so monitoring / SEO
  plugins can feed real telemetry in.
- **Time-of-day sky.** The backdrop tracks the viewer's LOCAL clock
  through a 24-hour cycle (`src/plugins/living-tree-wallpaper/sky.ts`):
  starry night → pre-dawn → sunrise → midday → golden afternoon → dusk.
  A sun disc arcs the day sky, a moon the night, and a star field fades
  in after dark. The same cycle yields an ambient `light01` that dims the
  whole tree at night and brightens it by day; fireflies run the opposite
  way (bright at night, invisible in daylight). `skyForTime()` is pure;
  `new Date()` is read only at the scene boundary. Debug override:
  `window.openStationLivingTreeHourOverride = <0..24>` forces a specific
  hour.
- **Hidden DNA tuner (developer mode only).** With *OpenStation Settings →
  Features → Enable developer mode* ON, clicking the trunk **20 times**
  (gaps under 2.5 s) opens a slider panel over every snapshot metric —
  age, posts, pages, terms, comments, presence, traffic, health,
  performance — regrowing the tree instantly on each drag, plus a
  **time-of-day slider** (0:00–24:00) that scrubs the sky/luminosity
  cycle live; its `live` button (and closing the panel) hands the clock
  back to local time. Client-side preview only: nothing is persisted,
  the server snapshot is untouched, and the panel never appears while
  developer mode is off. Source:
  `src/plugins/living-tree-wallpaper/debug-panel.ts`.
