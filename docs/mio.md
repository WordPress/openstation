# Mio

**Status: Experimental.**

Mio is Desktop Mode's desk companion: a soft-body blob wrapped in a continuous, holographic neon ring, with two pill eyes that follow your cursor. It drifts over the wallpaper — breathing gently, never quite the same shape twice — is drawn to nearby windows like a magnet, and can be picked up and thrown anywhere on the desk.

It is a **first-class shell layer**, not a widget. Widgets are cards pinned to a rail with a fixed placement contract; Mio owns its own layer inside `#desktop-mode-shell`, paints above every window, and goes where it likes. That distinction is the whole point — a companion that had to live in the widget column wouldn't be a companion.

Off by default. Users switch it on from its **dock tile**, and can hide the tile itself from OS Settings → Apps & Icons.

---

## Contents

- [For users](#for-users)
- [Architecture](#architecture)
  - [What it costs a shell that has it switched off](#what-it-costs-a-shell-that-has-it-switched-off)
- [The simulation](#the-simulation)
  - [The rest shape](#the-rest-shape)
  - [Shuffling the silhouette](#shuffling-the-silhouette)
  - [Idle wobble](#idle-wobble)
  - [Hard limits](#hard-limits)
  - [The outline can never fold](#the-outline-can-never-fold)
  - [Squash and stretch](#squash-and-stretch)
  - [Throwing](#throwing)
- [Make it yours](#make-it-yours)
  - [What it can change, and what it can't](#what-it-can-change-and-what-it-cant)
  - [Where it is saved](#where-it-is-saved)
- [Environment awareness](#environment-awareness)
  - [Windows are magnets, not ground](#windows-are-magnets-not-ground)
  - [Chrome is inflated back into a solid](#chrome-is-inflated-back-into-a-solid)
  - [The dock is forbidden, not merely solid](#the-dock-is-forbidden-not-merely-solid)
  - [Getting out from under a window](#getting-out-from-under-a-window)
- [Looking at the pointer, across iframes](#looking-at-the-pointer-across-iframes)
- [Rendering the chroma ring](#rendering-the-chroma-ring)
  - [The ribbon](#the-ribbon)
  - [Bands, not strokes](#bands-not-strokes)
  - [Every edge is a curve](#every-edge-is-a-curve)
  - [A gradient that loops](#a-gradient-that-loops)
  - [The hologram](#the-hologram)
  - [The interior sheen](#the-interior-sheen)
- [PHP API](#php-api)
- [JavaScript API](#javascript-api)
- [Hooks](#hooks)
- [Accessibility](#accessibility)
- [Performance](#performance)
  - [Switching off parks, it does not destroy](#switching-off-parks-it-does-not-destroy)

---

## For users

| Action | How |
|---|---|
| Show / hide | Click the **Mio** tile on the bottom dock. The tile's dot lights while the companion is on screen. |
| Restyle it | Right-click Mio → **Make it yours**. See [Make it yours](#make-it-yours). |
| Get rid of the tile | OS Settings → **Apps & Icons** → Mio → **Hidden** |
| Move it | Drag it anywhere. It trails your cursor. |
| Throw it | Let go mid-flick and it keeps going, gliding to a stop. |
| Where it rests | Persisted per browser (`localStorage`); the on/off preference is per user (server-side). |

Near a window, Mio is attracted to it: it slides over from whatever direction it was in, sticks to the nearest edge — top, side, underneath — and squashes against it. Out in open space nothing pulls on it, so it floats, bobbing and slowly changing shape.

Open a window on top of it and it hops clear rather than being buried.

---

## Architecture

Two halves, split so a user who never switches Mio on never downloads it.

| Piece | Ships in | Job |
|---|---|---|
| `src/mio/controller.ts` | `desktop[.min].js` (always) | Owns the layer element and the on/off preference; script-injects the bundle below on first activation. ~2 kB. |
| `src/mio/entry.ts` → `assets/js/mio[.min].js` | Lazy | PixiJS app, soft-body simulation, renderer, drag, pointer tracking. ~25 kB min, plus the shared vendored PixiJS. |

### What it costs a shell that has it switched off

The whole of it, and it is worth being precise because the answer is "almost nothing":

- **No script and no stylesheet** are enqueued for Mio, ever. Nothing in `includes/render/assets.php` registers one.
- The shell config carries two keys: `mioBundleUrl` (a URL string) and `mio` (the appearance + physics blob — **~470 bytes gzipped**). The config ships whether or not Mio is on, because fetching it on first toggle would mean the `desktop_mode_mio_config` filter silently didn't apply until the next reload.
- In the always-on bundle: `MioController` (~2 kB) and the dock tile's definition (a few hundred bytes).
- PixiJS, the soft body, the renderer, the pointer tracker and the ~25 kB Mio bundle are **script-injected on the first toggle** and never touched otherwise.

Hiding the dock tile from Apps & Icons removes the tile, not the controller — the controller is what would restore Mio the user had left switched on, so it boots regardless.

The lazy bundle publishes `window.desktopModeMountMio`, the same publish-a-global pattern the wallpaper, widget, and about-scene bundles use. The controller `await`s the load, calls the global, and holds the returned handle.

```
#desktop-mode-shell
├── #desktop-mode-wallpaper        z-index 0
├── .desktop-mode-shell__body
│   ├── #desktop-mode-dock         z-index 200
│   └── #desktop-mode-area
│       └── .desktop-mode-window   z-index 100 + stack index
└── #desktop-mode-mio           z-index 190   ← above windows, below the dock
    ├── <canvas>                   pointer-events: none, always
    └── .desktop-mode-mio__handle   the only interactive pixel
```

**Why the canvas is never interactive.** The layer spans the whole shell. An interactive canvas would swallow every click meant for the window underneath, and toggling `pointer-events` from a per-frame hit test races the very click it is meant to route. Instead a small round handle element rides on the blob and is the only thing in the layer that takes pointer events, so a click one pixel off Mio reaches whatever is beneath it, exactly as if Mio weren't there.

Mio sits below the dock deliberately: a companion that could cover your navigation is a bug, not a feature.

---

## The simulation

A pressurised mass-spring ring — `physics.points` particles laid out around the [rest shape](#the-rest-shape), wired by four force families:

| Force | Constant | What it does |
|---|---|---|
| Edge springs | `edgeStiffness` | Surface tension between neighbouring rim points. |
| Bend springs | `bendStiffness` | Rim ↔ rim+2; resists creasing, so a hard landing dents rather than folds. |
| Shape springs | `radialStiffness` | Rim ↔ centroid; restores the rest shape. |
| Pressure | `pressure` | Gas term proportional to lost area; makes the blob pancake *outward* on impact instead of just flattening. |

Integration is semi-implicit Euler over fixed `subStep` slices (default 1/240 s), capped at `maxSubSteps` per frame. Fixed steps mean the same landing produces the same squash at 30 fps and at 144 fps.

Damping is split in two on purpose. `damping` acts on each point's velocity **relative to the body's mean velocity**, so the jiggle settles while the body keeps its momentum. `airDamping` acts on everything, so a throw glides to a stop. A single combined constant makes Mio feel like it is falling through syrup.

Note that `damping` is the wobble knob. Turn it down and every landing rings for half a second and Mio reads as "too many springs"; turn it up and it stiffens toward a solid.

### The rest shape

Mio is not a disc. `shapePreset` picks a silhouette:

| Preset | Silhouette |
|---|---|
| `circle` | A perfect disc. |
| `blob` | Nearly round, with a shallow dimple at the bottom centre and a little extra fullness at the lower left and right. The shipped default. |
| `ghost` | Dome top, straight sides, three scalloped feet. |
| `potato` | Lumpy and asymmetric. No symmetry at all. |
| `custom` | A rounded polygon built from `shapeLobes` — `3` is a triangle, `4` a square. |

Crucially this is a *rest length*, not a mask or a drawn outline. The profile multiplies the per-point rest radius that every spring family already reads, so Mio squashes, stretches, breathes, gets thrown and re-inflates exactly as a round one does; it simply settles into this shape when nothing is acting on it. Nothing downstream has to know about it — the pressure term's target area is computed from the same `restR` array, so the gas inflates toward the shape rather than fighting it.

```
r(θ) = radius · ( 1 + shapeAmount · deviation( θ − shapeAngle ) )
```

**Presets return a deviation from a circle, not a multiplier.** That is what lets `shapeAmount` mean the same thing for all of them: it scales the deviation, so `0` is always a circle and `1` is always the shape as authored. Every preset is authored **upright**, so `shapeAngle` is a rotation on top rather than part of the definition — and since the body never rotates on its own (rest angles are fixed in screen space) it is a permanent orientation, not a starting one.

For `custom`, "as authored" is the flat-sided limit: `1 + a·cos(kθ)` has exactly zero curvature at its side midpoints when `a = 1/(1 + k²)`, so `shapeAmount: 1` means "dead straight sides between rounded corners" at any lobe count. Past `1` the sides bow inward and the shape reads as a clover rather than a polygon; `mio-soft-body.test.ts` checks the angular-gap constraint still holds there. A raw amplitude would mean something different for a triangle than for a hexagon and force every caller to re-derive it.

Two of the presets are worth a note:

- The **ghost** windows both of its ideas to the underside with `max(0, sin θ)`, which is what makes it read as a ghost rather than as a gear. The superellipse exponent eases from `2` (a circle) at the top to `4.2` at the bottom, pushing the lower diagonals out into square shoulders while the head stays a clean dome; `−cos(6θ)` then peaks at `π/6`, `π/2` and `5π/6` for three feet with notches between, its own peaks at the sides falling exactly where the window is zero.
- The **potato** is four harmonics at incommensurable frequencies with unrelated phases — the cheapest honest way to get no symmetry at all, since any two of them would still read as a squashed something. Amplitudes sit just inside each harmonic's own convexity limit, so the lumps stay lumps; they can sum past it where two crests coincide, which is exactly the shallow dent a potato ought to have. There is a test that asserts no mirror axis survives.

`createSoftBody()` and `resetBody()` take the profile so the body is *born* the right shape. Without it the springs would pull a disc into shape over the first few hundred milliseconds — harmless, but visible as a morph at boot and after every escape hop.

### Shuffling the silhouette

Every `shapeShuffle` seconds (default `60`, `0` to switch it off) Mio picks a different stock silhouette and **eases into it** over about two and a half seconds. The delay is jittered ±25%, because a change exactly every sixty seconds reads as a timer, which is the opposite of alive. `custom` is never picked: it is a shape someone configured on purpose, and wandering into it at random would be indistinguishable from a bug.

The transition is a blend of two rest profiles handed to the springs, not a redraw. The body is pulled across by the same forces that handle everything else, so Mio can be poked, dragged, thrown, and landed on a window mid-morph and the shape change simply carries on underneath. That composability is the whole reason the shape lives in rest lengths — `stepSoftBody()` reads `body.profile` when the body has one, so the blend has exactly one place to live and the simulation never learns that a transition is happening.

Each change fires `desktop-mode.mio.shape-changed` with `{ shape, from }`.

Under `prefers-reduced-motion: reduce` the shuffle is switched off along with the idle bob and the hue drift — Mio that reshapes itself while you are reading is textbook unsolicited animation.

### Idle wobble

A floating Mio is never a perfect circle. Three spatial harmonics — 2, 3 and 5 lobes — drift around the rim at incommensurable temporal frequencies, continuously tensing and releasing the shape springs, so the silhouette is always softly changing and never repeats a pose.

This modulates the springs' **rest length**, not the point positions, which keeps it a real physical effect rather than an overlay: a poke, a landing, or a throw still overrides it, and the shape settles back into breathing afterwards. It fades out while a magnet has hold and while the user is dragging — in both cases the deformation should read as what's happening to Mio, not as ambient motion.

**Every spring family must read its rest length from the same wobbled shape.** This is the third failure mode worth knowing about, and unlike the other two it is a visual bug rather than a physical one: breathe the shape springs alone and the edge springs go on defending the *original* perimeter. The two families fight at their natural frequency and the outline buzzes — a fine, fast flicker — instead of breathing. So the per-point rest radius is computed once per sub-step and every consumer derives from it: shape springs directly, edge and bend springs as the chord `(rᵢ + rⱼ)·sin(stride·π/n)`, and the pressure term as `restArea × meanScale²`. `mio-soft-body.test.ts` guards this by measuring the second difference of each vertex's radius: smooth breathing has almost none, a fighting ring has plenty.

### Hard limits

Springs decide how Mio *feels*. They cannot decide what it can never *become*: a force can always be overwhelmed by a hard enough contact, a big enough drag, or an unlucky frame delta, and the failure mode is catastrophic rather than merely soft — a blob crushed to a line, or torn into a spike.

So on top of the forces, every constraint carries a hard length limit — `minStretch` to `maxStretch` of its rest length — enforced by a positional relaxation pass:

- **Radial** (rim ↔ centroid) is the one that bounds the silhouette. No point may sit closer than `0.55` or further than `1.7` of its target radius, so the outline is guaranteed to stay inside an annulus around the rest shape.
- **Edge** (rim ↔ neighbour) stops the rim bunching or tearing between two points that are each individually legal.

Both particles move half of any correction, so momentum is conserved, and the relative velocity along the axis is killed when it's feeding the violation — a limit is physically a string going taut, and leaving the velocity would just re-break it next step and buzz. There's also a **bump stop**: a point braking as it *approaches* its limit rather than only being corrected after crossing it, which keeps most violations from happening at all.

**Ordering matters, and it took three attempts to get right.**

1. *Limits, then contact.* Contact simply re-breaks the limits it was meant to respect. Dragging Mio into a window corner crushed it to a third of its radius despite the 0.55 floor.
2. *Contact, then limits.* The limits hold — and the rim pokes up to 15 px into windows on hard impacts. Worse: interpenetration is the artefact users actually notice.
3. *What ships.* Interleave both for `limitIterations` passes, then a final contact pass (so nothing is ever left inside a window), then a last limit pass **restricted to points contact didn't touch**. The points crushed by an impact are on the far side of the body from the surface and are free — nothing holds them, they were carried in by momentum — so correcting only those restores the silhouette without pushing a pinned point back through the geometry pinning it. The momentum-cancelling shift also skips pinned points: they're held by the world, and the world absorbs the reaction.

**What this buys, measured.** On a magnet drift onto a window the limits never engage at all (worst radial fraction 0.69) — they are not quietly stiffening the everyday feel. On a 4000 px/s slam, the worst squash goes from **0.08** of the rest radius (a line — visibly broken) to **0.28** (a strong but recognisable pancake), with penetration still exactly zero.

Note the guarantee is exact for a free body and best-effort under contact: a rim point pinned against a window cannot be pushed back out to satisfy a limit, because non-penetration wins. Raising `limitIterations` tightens it further.

### The outline can never fold

Distance limits bound how far each point sits from the centre. They say nothing about the **order** the points sit in — and that omission has a spectacular failure mode. Let two neighbours swap angular places and the outline folds back through itself. The folded shape satisfies every radial limit, every edge limit, and the pressure term simultaneously, so it is a perfectly stable configuration: Mio becomes a crescent and stays one for the rest of the session, because nothing in a distance-only constraint set can tell it apart from a legal blob.

`minAngularGap` closes it. Consecutive rim points must keep at least a quarter of their even angular spacing, which makes the swap unreachable. Combined with the radial limits it is a hard guarantee of a **simple** polygon: a ring whose vertex angles strictly increase around an interior point is star-shaped, and a star-shaped polygon cannot self-intersect.

The enforcement has to be **global**. Pushing individual pairs apart — the obvious local sweep — cannot work: the gaps around a ring are not independent, they must total exactly 2π, so widening one necessarily narrows another and the sweep chases its own tail. A tangled ring stays tangled. Instead the whole gap vector is projected onto the nearest valid one: clamp every gap to the minimum, then rescale the slack so the total is exactly one turn. Corrections are pure rotations about the centroid — orthogonal to the radial limits, so the two families never fight — and their mean angular drift is projected out so repairing a fold doesn't also spin Mio.

It runs last, after contact, because a fold is the one failure the body cannot recover from on its own. That ordering costs a measured **0.32 px** of window overlap in the worst case (deliberately shoving Mio into a window), and the pass is a complete no-op on a healthy body — `mio-soft-body.test.ts` proves the trajectories are bit-identical with the constraint switched off.

**Measured over 3000 frames of torture** — hard flings in every direction, direct rim mangling, drags held deep inside windows:

| | self-intersecting frames | smallest area |
|---|---|---|
| No constraints | 2332 | 0.006 |
| Stretch limits only | 1844 | 0.003 |
| Stretch limits + angular | **0** | **0.40** |

### Squash and stretch

Moving deforms Mio along its heading: the rest shape becomes an ellipse with semi-axes `k` and `1/k` (`k = 1 + speedStretch × min(1, speed / 1200)`), elongated along the direction of travel and narrowed across it. Being area-preserving, Mio yanked across the desk draws out behind the cursor without appearing to gain mass, and rounds back off as it slows.

The alignment for each rim point comes from its **rest angle**, not its current position — reading the deformed geometry would feed the stretch back into itself and the shape would run away.

Because it rides on the same rest-shape mechanism as the idle wobble, it composes with everything else for free: the edge springs, bend springs, and pressure target all follow the stretched ellipse, so it stays a coherent shape rather than a rendering trick.

### Throwing

Let go mid-flick and Mio keeps going. The drag spring alone leaves it with whatever velocity the spring happened to hold, which is always short of the hand, so flicks land dead. Instead the runtime keeps an exponential moving average of the pointer's velocity during the drag and injects it into the body on release (`addVelocity`), scaled by `physics.throwBoost` and clamped so a jittery trackpad sample can't fire Mio across the desk. `airDamping` then bleeds it off.

A single last-two-points velocity sample is far too noisy to throw with — one stationary frame at release and the flick dies. Hence the EMA.

Four design decisions are worth knowing before you touch `soft-body.ts`, because all four were bugs first. Two are here; the other two are [one rest shape shared by every spring family](#idle-wobble) and [the angular-order constraint](#the-outline-can-never-fold).

**There is no core particle.** The obvious model — a heavy centre mass with radial springs out to the rim — is bistable. Land the blob hard enough and the centre punches through the contact plane; the rim clamps on the window's top edge, the centre settles *below* it, and the springs are perfectly happy there (a hanging-bob equilibrium). Mio ends up a dome welded to the window edge and never recovers. The centre is derived from the rim instead (classic shape matching), which removes the second equilibrium entirely.

**Pressure uses edge normals, not radial ones.** "Point minus centroid" looks equivalent and silently kills Mio: squash the blob flat and every radial direction becomes horizontal, so a fully collapsed sliver is a simultaneous equilibrium of the shape springs, the edge springs, the bend springs *and* radial pressure. Gravity walks the body into it and it never comes back up. Edge normals survive the degenerate case, because the top and bottom chains of a flat sliver are traversed in opposite directions and push apart.

---

## Make it yours

Right-clicking Mio opens a one-item context menu; the item opens a panel of controls bound live to `wp.desktop.mio.setStyle()`. There is no Apply button — every control writes on input, so the companion changes under the dialog while you drag. The thing being edited is right there, so the preview *is* the product.

Right-click is bound to the **handle**, the only part of the layer that takes pointer events. A right-click one pixel off Mio still reaches the wallpaper and gets the desk's own menu, exactly as if Mio weren't there.

### What it can change, and what it can't

**Style only — the `appearance` group, minus `radius`.**

| Section | Controls |
|---|---|
| Colour | `hueStart`, `hueSpan`, `saturation`, `lightness` |
| Ring | `outlineWidth`, `glow`, `glowBlur` |
| Gradient | `hueAngle`, `hueLoop`, `hueSpin`, `hueDrift` |
| Hologram | Holographic on/off, `iridescence` |
| Body | `bodyColor`, `bodyAlpha` |
| Eyes | `eyeColor`, `eyeScale` |

**`hueSpin` vs `hueDrift`** is the distinction worth understanding before touching either. `hueSpin` turns the same magenta→violet→blue sweep around the ring — the palette is preserved exactly, only its orientation moves. `hueDrift` rewrites the hues themselves, so Mio cycles through colours that are not its own. Rotating position keeps the identity; rotating hue discards it. Both ship at `0`, and both stop under reduced motion.

The Holographic toggle is a shortcut for `iridescence` — off writes `0`, on writes the strength the effect was designed around — and it repaints the panel afterwards, because the slider beneath it would otherwise keep showing the value the toggle just replaced.

### It is a live preview, not a modal

`<wpd-modal>` dims the page, blurs it, and puts itself in front of everything. Every one of those defaults is wrong here, because the thing being edited is *on* the page and the whole point is watching it change. The panel overrides all three:

- **No scrim, no `backdrop-filter`** — otherwise the companion the sliders are driving is a blurred grey smudge behind them.
- **`pointer-events: none` on the scrim**, restored on the dialog box through the modal's `::part(dialog)`. The desk stays live: Mio can be picked up and thrown while the panel is open, and a click on the wallpaper doesn't dismiss the panel mid-adjustment.
- **Parked against the inline end** rather than centred, so it isn't sitting on top of its own subject.

Mio never treats the panel as an obstacle. The collision set comes from `getWallpaperSurfaces()`, which seeds windows, the shell floor, docks and widget cards — a dialog on `document.body` is none of those, so there is nothing to bump into.

No physics. Those belong to the site, they interact in ways a flat list of sliders hides (stiffness against damping against pressure), and a user who makes Mio unstable from a slider has no way to know which slider did it. Not `radius` either: how big the companion is on the desk is a layout decision, not a look.

`mio-style-panel.test.ts` enforces the boundary by walking every control in the panel, firing it, and asserting that the set of keys written contains no physics key and never `radius` — so a control added later can't quietly widen the scope.

### Where it is saved

`localStorage`, under `desktop-mode-mio-style`, alongside the resting position. It is a personal preference about a decorative thing on one person's machine — it does not belong in user meta, and it should not be in the `desktop_mode_mio_config` filter's way.

It merges **last**, after server config and the JS filter. Everything before it is something a site decided; this is something a person decided about their own companion. Values are clamped by `sanitizeMioConfig` like any other untrusted input, so a hand-edited or stale entry produces a plain-looking Mio rather than a broken one, and a corrupt entry is ignored entirely rather than blocking the mount.

**`setStyle` persists; `setConfig` does not.** That split is deliberate: `setConfig` is the programmatic surface, and a plugin nudging Mio for a moment shouldn't silently become the user's saved look.

**Restore Mio** clears the saved style and repaints the panel from the restored config — every control's value is stale after a reset, so the panel is rebuilt rather than just the config being reset.

---

## Environment awareness

Every frame (throttled to 20 Hz) Mio asks the shell for the live collision set via `wp.desktop.getWallpaperSurfaces()` — the same surfaces the snow wallpaper piles on — and converts them into its own coordinate space. Window rects, widget cards, the dock edge, and the shell floor all become solid obstacles the rim collides with.

### Windows are magnets, not ground

There is **no global "down"**. A window attracts Mio toward the closest point on its edge from whatever direction Mio is in, so it can just as happily stick to the underside of a window as sit on top of one. Strength smoothsteps in from `0` at `physics.magnetRange` to `1` on contact, and the idle float fades out as it takes hold, so a stuck Mio sits still rather than vibrating against the surface.

```
distance to nearest window       magnet
───────────────────────────────────────
    > magnetRange                  0.0   floating, breathing
    = magnetRange / 2              0.5   drifting over
    touching                       1.0   stuck, squashed
```

Only the **nearest** window pulls. Summing every window in range looks more physical and behaves worse: parked between two windows the forces cancel and Mio hovers in the gap twitching, instead of committing to one of them.

**The magnet is a spring with a rest position, not a constant pull** — and that distinction is the difference between Mio that settles and one that never stops moving. A constant pull has no equilibrium: it drives the body into the surface, the contact solver bounces it back, and the pair limit-cycles forever. Against a flat face that is invisible, because the bounce is purely normal and friction eats it. In a **corner** the pull is diagonal, so every cycle also slides the body along one face, and Mio visibly orbits the corner, wobbling, indefinitely.

With a rest gap the force is zero exactly where Mio should sit — `magnetGrip` of a radius pressed in, which is also what produces the resting squash — negative if it gets pushed deeper, positive if it drifts off. A real equilibrium, which `magnetDamping` can then settle into. Both `mio-soft-body.test.ts` cases (flat face and corner) assert the body comes to rest.

Note that `strength` and `magnetRange` are measured **edge-to-edge**, not from the centroid. A body resting against a window has its centroid a whole radius away, so a centroid-based falloff would top out around 0.9 and leave a permanent sliver of idle float driving Mio that is supposed to be sitting still.

The shell floor and the dock are solid but not magnetic — magnetising to either would pin Mio to the edge of the screen forever, since one of them is always nearby.

### Chrome is inflated back into a solid

The shell publishes the dock and the floor as **one-pixel strips** along the face that matters. That is exactly right for the wallpapers consuming the same feed — snow piles on a line, rain splashes off one — and useless to a soft body: a rim point already well inside the dock is not inside a 1-px sliver, so nothing pushes it back out and Mio sinks straight through the rail.

So `collectObstacles()` re-inflates chrome (`dock`, `shell`) away from its solid face, out to the edge of Mio layer. The dock becomes a volume the rim collides with along its whole depth, and there is no "behind the dock" left to reach. Windows and widget cards already arrive as full rects and are passed through untouched.

### The dock is forbidden, not merely solid

A window is something Mio rests *against*, and a pixel of overlap while the contact solver settles is nobody's problem. The dock is different: it holds the user's navigation, it is opaque, and a blob halfway behind it reads as broken rather than playful. Two extra rules hold that line — the floor is deliberately exempt from both, since resting on it is the whole point.

- **The drag target is clamped out of it.** `clampOutsideChrome()` keeps a full body radius of clearance, so the hand can sweep across the dock without Mio following it in. Contact alone would let the drag spring press the body a good way into the rail before the two balanced out, which is the overlap being forbidden.
- **Any depth inside it counts as trapped.** The window rule — buried three quarters of a body deep — can never fire inside a rail narrower than Mio, so `findEscape()` checks forbidden chrome first with a bare inside-test. Contact cannot dig Mio out on its own either: the rail's near face is the closest one for rim points on the desk side and its far face for the rest, so the solver pulls the body apart across it.

Both pushes go along the obstacle's own **face**, never the shallowest axis. Chrome runs to the edge of the layer on its other three sides, so the shallowest-axis rule that suits a window floating in open desk would happily shove Mio off screen behind the dock.

Because surfaces are read live, moving a window near Mio draws it in; moving that window away releases it.

### Getting out from under a window

Contact is fine — Mio is *supposed* to rest against windows. Being **engulfed** is not, and it happens the moment you open, move, or maximise a window over Mio's position. The contact solver cannot recover from that on its own: rim points on opposite sides of the blob get pushed toward opposite faces and the silhouette tears itself apart.

So when the body's centre lands inside a window, Mio hops out:

1. Merge every window overlapping the offender, transitively, into one **cluster** rect (an 8 px slack closes the hairline seams between snapped windows). A tiled row is one obstacle — escaping a single window in the middle of it would drop Mio straight into its neighbour and pinball across the desk.
2. Offer the **midpoint of each side** of that cluster, pushed out by the body radius. Midpoints, not corners, so it lands somewhere it can actually rest.
3. Discard sides that would leave the layer, take the nearest of what's left, and re-form the body clean at that point (`resetBody`).
4. Nothing fits — a maximised window — so take the centre of the widest leftover strip of desk. Nothing left over at all, so the layer centre.

The hop fires `desktop-mode.mio.displaced`.

---

## Looking at the pointer, across iframes

Mio watches the cursor. That is trivial until the cursor moves over a window, because a window's content is a chromeless `<iframe>` and pointer events do not cross frame boundaries. Since Mio floats *above* windows, that is most of the desk — Mio whose gaze freezes the moment you touch a window looks broken, not alive.

So the shell merges two sources:

1. `pointermove` on the shell document — wallpaper, dock, window chrome.
2. `desktop-mode-pointer-move` messages forwarded by the chromeless bridge inside each window iframe, rebased into viewport coordinates through the iframe element's rect.

The iframe-side forwarder is **opt-in and off by default**. The parent broadcasts `desktop-mode-pointer-track { enabled: true }` when a consumer starts, re-arms each frame when it announces `desktop-mode-bridge-ready` (which fires on every navigation), and broadcasts `{ enabled: false }` on teardown. A shell with no companion never turns it on and pays nothing.

Coordinates only — no target element, no event object, nothing about page content — throttled to ~25 Hz, passive listener, never `preventDefault()`. Both bridge entry points (the inline PHP bridge and `iframe-bridge-standalone.ts`) install the same forwarder behind a shared sentinel. See [`bridge-protocol.md`](./bridge-protocol.md).

This is a general facility, not Mio-private one: any shell-side feature that needs the true cursor position over window content can consume the same messages.

---

## Rendering the chroma ring

Four passes over one resampled outline, back to front:

1. **halo** — very wide, very faint, additive, optionally blurred. Light spilling onto the wallpaper.
2. **bloom** — medium width, additive. The bright fringe hugging the tube.
3. **body** — the black fill. Drawn *after* the glow passes on purpose: it masks their inner halves, which is what makes the inside read as black rather than muddy purple.
4. **sheen** — concentric shells of faint additive colour over that fill. The [interior sheen](#the-interior-sheen).
5. **core** — a thin near-white band. The over-exposed centre of the tube.

### The ribbon

Everything is built on one resampled outline. `physics.points` is a *simulation* resolution, far too coarse to draw with directly, so `buildRibbon()` runs the standard Chaikin-style smoothing — quadratic curves through edge midpoints, rim points as controls — and samples that curve to a **fixed total of 144 points** around the ring, carrying an outward unit normal with every one.

A total rather than a per-segment multiplier, because that number is a **colour resolution, not a geometric one**. Each band cell carries one flat colour, so a cell is also one step of the hue ramp — and at a couple of dozen cells the ring stops reading as a gradient and starts reading as a colour wheel, in ~5° jumps the eye picks out immediately at full saturation. At 144 a cell spans a degree or two of hue, below what anyone can separate. Fixing the total also decouples the ring from `points`: coarsening the simulation to nine mass points no longer coarsens the gradient with it.

Geometrically it is overkill, deliberately — the curved cell edges below mean the outline was already smooth at a tenth of this. The cells are correspondingly tiny, so their curves tessellate to two or three points each and the extra cost is close to linear in the count. The passes that don't carry the gradient (the halo and the sheen, both blurred past the point where anything finer survives) take a proportionally wider stride.

The outline the renderer sees has no idea how many mass points it came from. That decoupling is what lets the physics run coarse without the edge going faceted, and it is why the wobble reads as a rippling curve rather than a shivering polygon.

### Bands, not strokes

Each pass used to be stroked **segment by segment**, which was the only way to run a hue ramp around a closed, deforming path — Pixi's gradients are linear and radial, and neither can. But it had a tell: consecutive round-capped strokes *overlap* at every joint, and under the additive blending the glow passes use, double coverage is double brightness. The ring came out beaded, one visible knob per rim point, and the outline read as a chain rather than a tube.

So each pass is a **band** instead: one filled cell per pair of samples, spanning outward from the centreline, with adjacent cells sharing their edge coordinates *exactly*. Shared edges tile with neither gap nor overlap, so there is nowhere for a bright joint to form and the band is continuous by construction. `mio-render.test.ts` asserts that bit-equality directly — it is the anti-beading invariant, and anything less is either a seam of wallpaper showing through or a joint glowing twice as bright.

Per-cell colour keeps the chroma sweep and buys the room for the hologram below: per-sample normals are exactly what a viewing-angle effect needs.

### Every edge is a curve

Cells were flat-sided quads to begin with, and that was the last source of visible facets. A chord across 15° of arc is invisible at the centreline and obvious 15 px out from it, because the offset boundary of the halo has the same corner count over a much longer perimeter — and the rim only carries 12 points.

Now every cell edge is a **quadratic through three points**. A cell spans two ribbon samples and bulges through the one between them, which is exactly enough to pin the control point:

```
a quadratic is (a + 2c + b)/4 at t = 0.5,  so  c = 2m − (a + b)/2
```

Pixi tessellates adaptively from there, at a tolerance a little tighter than its default — Mio is the one thing on the desk a user looks *at*.

**This costs nothing.** Sampling doubled to four per rim segment and every stride doubled with it, so cells span the same arc and there are exactly as many as before; the extra samples buy curvature, not resolution. The curves themselves are shallow enough that the adaptive pass emits only a handful of points each.

Two shapes need care:

- The **body fill** is traced from the rim's own curve rather than from the ribbon. The rim *is* the curve the ribbon samples — segment `i` runs from `mid(i-1, i)` through the control point `rim[i]` to `mid(i, i+1)` — so handing Pixi the curve directly gives a silhouette with no facets at any rim resolution, for one `fill()` and `points` curve segments. Cheaper *and* smoother than the polygon it replaced.
- The **innermost sheen shell** reaches the centroid, where all three inner points coincide. It is emitted as a wedge — one curved arc closed by two straight radii — rather than routed through the cell builder, which would hand Pixi a zero-length curve between three identical points.

An odd stride has no halfway sample to curve through and falls back to flat quads.

Because the body fill masks the inner half of the glow anyway, the two glow bands are built almost entirely *outward* from the centreline — half the geometry, and no risk of their inner edges crossing where the outline is concave. A sliver of inward reach remains so the body fill overlaps them rather than meeting them exactly, which would leave a hairline of wallpaper along the seam.

### A gradient that loops

A hue ramp of `hueStart + hueSpan · t` does not meet itself. It ends a whole span from where it began, so the ring carries a hard colour seam at the wrap — magenta butted straight against blue.

That was invisible for as long as the ramp rotated: `hueDrift` kept the seam moving, and a moving seam reads as shimmer. Stop the rotation and it just sits there, which is exactly what the official Mio needs to do.

**`hueLoop` walks the span out and back** — a triangle wave, `0 → 1 → 0` — so both ends of the ring are the same colour by construction and there is nothing to hide:

```
ramp = hueLoop ? 1 − |1 − 2·t| : t
hue  = hueStart + hueSpan · ramp
```

The cost is symmetry: the ring mirrors about the ramp's axis. For a two-colour sweep that reads as deliberate rather than as a fault, which is why the artwork can get away with being still.

Mirroring pins the two extremes to the ends of the triangle, so **`hueAngle`** exists to aim them — without it they would always sit at 3 and 9 o'clock, and the official gradient runs on a shallow diagonal. `mio-config.test.ts` measures the worst hue step between neighbours all the way round the ring: over 60° with the loop off, under 6° with it on.

### The hologram

A real holographic surface does not have a colour, it has a colour *per viewing angle*: tilt the sticker and the rainbow slides across it. Mio has no viewer to track, so a **rake direction** stands in for one. It drifts slowly while Mio is idle and swings toward the direction of travel as it moves, so the ring's colours run when you throw the blob across the desk and settle again when it stops. Deformation feeds it for free — squash the body and its normals turn, so the colours turn with them.

Three terms, all keyed on `d = dot( outward normal, rake )`, scaled by `appearance.iridescence`:

| Term | What it does |
|---|---|
| Angle hue shift | `d` displaces the hue by up to ±62°, so opposite sides of the ring sit at opposite ends of the shift and the whole band re-sorts itself as the rake turns. |
| Diffraction grating | Two incommensurable harmonics (3 and 5 cycles) of fine hue ripple around the perimeter. This is the detail that reads as "holographic" rather than "gradient" — a single sine reads as a regular scallop once it has gone round twice. |
| Specular glint | A narrow, desaturating hotspot that slides along the rim as the rake turns. `holoSpecular()` exposes it separately so the crisp core band can be pushed hardest to white exactly where the glint sits. |

The rake's own **magnitude** is the effect strength: `0.45` at rest, up to `1` at 900 px/s. The velocity behind it is a heavily smoothed centroid delta — a single frame's delta is far too noisy to steer a colour effect with, and every contact bounce would strobe the ring — and it is reset on every teleport (escape hop, `setPosition`, resize clamp, rebuild) so a jump never lands in it as a several-thousand-px/s "throw".

The ambient half of the rake is gated on `hueDrift`, so the reduced-motion path that already zeroes the hue drift stills the shimmer too, without a second preference to read. Motion the user causes still colours the ring, in line with the rest of Mio's reduced-motion policy.

Set `appearance.iridescence` to `0` for the plain chroma ramp and nothing else.

### The interior sheen

The inside of Mio is not flat black — it catches the hologram too, the way a holographic film laid over dark card does. Five concentric shells march from the outline to the centroid, each flat-filled per sample and each fainter than the last, standing in for the radial falloff a gradient would give if Pixi could produce one without minting a texture every frame. The innermost reaches the centroid, so it is a fan of triangles rather than a band.

They are **additive**, so the sheen can only ever lift the interior toward colour, never darken or wash it out. Being adjacent rather than nested, the brightest lift anywhere inside the body is simply the largest alpha, and that is the whole budget. The body still has to read as black; the sheen is a film over it, not a paint job. `mio-render.test.ts` pins the ceiling.

**The layer is blurred**, and that is what makes the brightness affordable. A flat shell against a flat shell is a hard edge, and left alone it reads as a set of concentric contour lines drawn inside Mio — which caps how bright the sheen can get before the banding gives it away. The blur dissolves the radial steps and the angular facets both, so the shells can be few (five), coarse (every third sample), and actually visible. Its strength scales off `radius`: a kiosk-sized Mio needs a proportionally wider blur to hide the same number of shells. The outermost shell starts a little way in from the outline so the blur spends itself on the interior rather than bleeding colour out over the ring.

The sheen's rake is the ring's turned a quarter turn, and its hue ramp runs at a different rate — an inside that simply repeated the edge would read as a blurred copy of it rather than as a second surface catching the same light. It scales with `appearance.iridescence`, so `0` restores a flat black body and drops the blur pass entirely.

### The face

Eyes are white pills that inherit a fraction of the body's squash, offset toward the pointer with a saturating response (clamped inside the face), and blink on a randomised 2.6–7 s schedule.

---

## PHP API

### `desktop_mode_mio_config()`

Returns the appearance + physics configuration shipped to the shell in `desktopModeConfig.mio`. Colours accept integers (`0x05050a`) or CSS hex strings (`'#05050a'`).

Every value is re-clamped client-side, so a filter that returns nonsense produces a plain-looking Mio, never a broken shell.

```php
add_filter( 'desktop_mode_mio_config', function ( $config ) {
	// A slower, heavier, teal companion.
	$config['appearance']['hueStart'] = 170;
	$config['appearance']['hueSpan']  = 40;
	$config['physics']['magnetStrength'] = 3400;
	return $config;
} );
```

### Configuration reference

**`appearance`**

| Key | Default | Range | Meaning |
|---|---|---|---|
| `radius` | `56` | 16–220 | Rest radius in CSS pixels. |
| `bodyColor` | `#000000` | colour | Body fill. |
| `bodyAlpha` | `1` | 0–1 | Body fill opacity. |
| `hueStart` | `302` | −720–720 | Hue in degrees where the ramp starts. |
| `hueSpan` | `-79` | −360–360 | Degrees of hue the ramp traverses. The shipped pair is the official artwork's magenta → violet → blue. |
| `hueLoop` | `true` | bool | Walk the span out and back so the ring [meets itself](#a-gradient-that-loops). `false` is a straight ramp, which leaves a seam at the wrap unless `hueDrift` keeps it moving. |
| `hueAngle` | `23` | −360–360 | Where the ramp starts around the ring, degrees clockwise from 3 o'clock. With `hueLoop` on this is the only way to aim the two extremes. |
| `hueDrift` | `0` | −180–180 | Rewrites the hues, degrees per second — Mio cycles through colours that are not its own. `0`, and the official Mio should keep it there. |
| `hueSpin` | `0` | −180–180 | Turns the gradient around the ring, degrees per second. Keeps the palette exactly; the most a default Mio should ever animate. |
| `saturation` | `1` | 0–1 | Ring saturation. |
| `lightness` | `0.66` | 0.15–1 | Ring lightness at its brightest point. |
| `iridescence` | `0` | 0–2 | Strength of the [holographic response](#the-hologram) and of the [interior sheen](#the-interior-sheen). `0` — the official Mio has neither. Above `1` is deliberately over-driven. |
| `outlineWidth` | `3` | 0.5–24 | Crisp core band width; the glow passes scale off it. A thin core inside a wide glow is the whole look. |
| `glow` | `1` | 0–3 | Bloom spread multiplier. `0` disables the halo passes. The artwork's own glow is a pair of soft radial washes, not a neon bloom — `1` is the width the passes were designed around. |
| `glowBlur` | `true` | bool | Run a `BlurFilter` over the halo. Softer, one filter pass per frame. |
| `eyeColor` | `#ffffff` | colour | Eye fill. |
| `eyeScale` | `0.3` | 0.05–0.6 | Eye height as a fraction of `radius`. |

**`physics`**

| Key | Default | Range | Meaning |
|---|---|---|---|
| `points` | `12` | 12–128 | Rim resolution. A *simulation* resolution — the renderer resamples it into a smooth curve, so raising it buys a busier silhouette and per-frame cost, not a rounder one. |
| `shapePreset` | `blob` | `circle` \| `blob` \| `ghost` \| `potato` \| `custom` | Which [silhouette](#the-rest-shape) Mio settles into. Unknown names fall back to the default rather than throwing. |
| `shapeLobes` | `3` | 0–8 | Corners, for the `custom` preset only. `3` is a rounded triangle, `4` a rounded square, `0`/`1` a circle. |
| `shapeAmount` | `1` | 0–1.4 | How far the silhouette departs from a circle. `0` is a circle whatever the preset; `1` is the preset as authored. For `custom`, above `1` the sides bow inward into a clover. |
| `shapeAngle` | `0` | −360–360 | Rotation in degrees clockwise from upright. Presets are authored upright, so `0` leaves them as designed. |
| `shapeShuffle` | `60` | 0–3600 | Seconds between Mio [picking a new silhouette](#shuffling-the-silhouette) at random and morphing into it. `0` holds `shapePreset`. |
| `radialStiffness` | `460` | 0–2000 | Shape springs (rim ↔ centroid). |
| `edgeStiffness` | `540` | 0–4000 | Surface tension. |
| `bendStiffness` | `170` | 0–2000 | Crease resistance. |
| `pressure` | `2400` | 0–8000 | Internal gas. |
| `damping` | `9` | 0–30 | Internal jiggle damping, per second. |
| `airDamping` | `0.5` | 0–20 | Whole-body drag, per second. Sets how far a throw glides. |
| `magnetStrength` | `2200` | 0–8000 | px/s² of attraction toward a window at full strength. |
| `magnetRange` | `260` | 0–2000 | Edge-to-edge gap at which a window's magnet starts to bite. |
| `magnetGrip` | `0.24` | 0–0.6 | Rest position of the magnet spring, as a fraction of the radius pressed in. Also sets the resting squash. |
| `magnetDamping` | `7` | 0–40 | Contact damping while stuck, per second. |
| `floatAmplitude` | `10` | 0–200 | Idle bob amplitude in px. |
| `floatSpeed` | `1.1` | 0–20 | Idle bob speed in rad/s. |
| `idleWobble` | `0.085` | 0–0.4 | Idle shape breathing, as a fraction of `radius`. |
| `idleWobbleSpeed` | `0.55` | 0–8 | Speed of the wobble's slowest harmonic, in rad/s. |
| `speedStretch` | `0.3` | 0–0.8 | Squash-and-stretch along the direction of travel, at full speed. |
| `friction` | `0.86` | 0–1 | Tangential velocity retained on contact. |
| `restitution` | `0.2` | 0–1 | Normal velocity reflected on contact. |
| `dragStiffness` | `480` | 1–4000 | How hard the body chases your cursor. |
| `throwBoost` | `1` | 0–4 | Fraction of your hand's velocity kept on release. |
| `minStretch` | `0.55` | 0.1–1 | Hard floor on every spring's length, as a fraction of rest. |
| `maxStretch` | `1.7` | 1–4 | Hard ceiling on every spring's length. The two ranges are disjoint around `1`, so the limits can never be inverted. |
| `minAngularGap` | `0.25` | 0–0.9 | Minimum angular spacing between rim points, as a fraction of even spacing. Stops the outline folding. `0` disables. |
| `limitIterations` | `3` | 0–8 | Relaxation passes enforcing the stretch limits. `0` disables them. |
| `dragMaxAccel` | `9000` | 100–200000 | Ceiling on the drag spring's force, so a cursor held inside a window can't press Mio flat. |
| `subStep` | `1/240` | 1/1000–1/30 | Fixed simulation step, in seconds. |
| `maxSubSteps` | `8` | 1–32 | Sub-steps consumed per frame. |

**Tuning the wobble.** Spring frequency is `√k`, so `radialStiffness` / `edgeStiffness` / `bendStiffness` decide how *fast* the outline chases the shape underneath it, and `damping` decides how long it rings for. The shipped values put the rim at roughly 3.5 Hz and close to critically damped, which reads as a gel settling. Triple the stiffnesses and the same simulation becomes a 6-plus-Hz shiver.

### User preference

The on/off state is the per-user OS setting `mioEnabled` (default `false`), stored in the `desktop_mode_os_settings` user meta and sanitized by `desktop_mode_sanitize_os_settings()`. Two things are browser-local instead, both in `localStorage`: the resting position (`desktop-mode-mio-position`) and the user's own style (`desktop-mode-mio-style`, see [Make it yours](#make-it-yours)).

---

## JavaScript API

### `wp.desktop.mio`

| Member | Signature | Notes |
|---|---|---|
| `isEnabled` | `() => boolean` | |
| `enable` | `() => Promise<void>` | Persists the preference; resolves once on screen. |
| `disable` | `() => void` | Persists; stops and hides Mio. Does *not* release the WebGL context — see [Switching off parks, it does not destroy](#switching-off-parks-it-does-not-destroy). |
| `toggle` | `() => Promise<void>` | What the wallpaper menu entry calls. |
| `getPosition` | `() => { x, y } \| null` | Viewport coordinates; `null` when off. |
| `setPosition` | `( x, y ) => void` | No-op when off. |
| `getConfig` | `() => MioConfig` | The resolved config in force. |
| `setConfig` | `( partial ) => void` | Merged and clamped over the current config, applied live. Does **not** persist. |
| `setStyle` | `( partial: Partial<MioAppearance> ) => void` | Applies an appearance change live **and remembers it for this browser**. What ["Make it yours"](#make-it-yours) writes. |
| `resetStyle` | `() => void` | Forgets the saved style; back to the Mio this site ships. |

```js
wp.desktop.ready( () => {
	// A bigger, calmer Mio for a kiosk screen.
	wp.desktop.mio.setConfig( {
		appearance: { radius: 90, glow: 1.6 },
		physics: { magnetStrength: 1400, floatAmplitude: 20 },
	} );
	void wp.desktop.mio.enable();
} );
```

---

## Hooks

### PHP

| Hook | Type | Status | Payload |
|---|---|---|---|
| `desktop_mode_mio_config` | filter | Experimental | `array $config` — appearance + physics. |

### JavaScript

All fire through `wp.hooks` on the `desktop-mode.mio.*` namespace.

| Hook | Type | Status | Payload |
|---|---|---|---|
| `desktop-mode.mio.config` | filter | Experimental | `MioConfig` — last word on appearance/physics before mount. Re-sanitized after your filter runs. |
| `desktop-mode.mio.enabled` | action | Experimental | `{}` — user switched it on. |
| `desktop-mode.mio.disabled` | action | Experimental | `{}` — user switched it off. |
| `desktop-mode.mio.mounted` | action | Experimental | `{ position: { x, y } }` — on screen and simulating. |
| `desktop-mode.mio.unmounted` | action | Experimental | `{}` — genuinely destroyed, WebGL context released. **Not** the "user switched Mio off" signal — that parks the instance and fires `disabled`. |
| `desktop-mode.mio.grabbed` | action | Experimental | `{ position: { x, y } }` — drag started. |
| `desktop-mode.mio.dropped` | action | Experimental | `{ position: { x, y } }` — dropped; the position is already persisted. |
| `desktop-mode.mio.displaced` | action | Experimental | `{ position: { x, y } }` — a window opened on top of it and it hopped clear of the cluster. |
| `desktop-mode.mio.shape-changed` | action | Experimental | `{ shape, from }` — the silhouette shuffle picked a new shape. Fires when the morph *starts*; it takes about 2.6 s to complete. |

```js
wp.hooks.addAction(
	'desktop-mode.mio.dropped',
	'my-plugin/mio',
	( { position } ) => {
		// eslint-disable-next-line no-console
		console.log( 'the blob landed at', position );
	}
);
```

The dock tile is a normal system tile (`id: 'desktop-mode-mio-toggle'`), so `wp.desktop.getSystemTile()` can read it and the dock's decoration hooks can restyle it like any other.

---

## Accessibility

Mio is decorative: the layer carries `aria-hidden="true"` and exposes no controls. It conveys no information, so nothing is lost to assistive technology.

**Reduced motion** is honoured in the simulation rather than by hiding Mio. Under `prefers-reduced-motion: reduce` the idle bob (`floatAmplitude`), the ring shimmer (`hueDrift`, and with it the hologram's ambient rake) and the silhouette shuffle (`shapeShuffle`) are all zeroed, so Mio holds still until the user interacts with it. Motion the user causes — a drag, a fall onto a window they just opened — is kept: WCAG's concern is unsolicited animation, and a companion that refuses to move when you pick it up isn't accessible, it's broken. A user who wants none of it switches Mio off from the same menu they switched it on.

The preference is watched live, so toggling it at the OS level takes effect without a reload.

---

## Performance

- **Nothing downloads until Mio is switched on.** The always-on cost is the controller.
- The ticker stops on `visibilitychange`, and resumes with a drained accumulator so a tab that was hidden for a minute doesn't come back with a catch-up avalanche.
- Surfaces are re-measured at 20 Hz, not per frame.
- Per frame: six `Graphics.clear()` calls and roughly 150 curved cells — 72 each for the bloom and the core, which carry the gradient at full ribbon resolution, plus a dozen for the halo and forty across the sheen's five shells, both of which are blurred past the point where anything finer survives. Then a blur pass over the halo and one over the sheen. The body is a single filled path of `points` curve segments.
- Ribbon resolution is fixed at 144 samples rather than scaled off `points`, so raising the rim resolution costs simulation time but not render time.
- The Pixi application is destroyed with `destroy( { removeView: true }, { children: true, texture: true } )`. **Never `destroy( true )`** — that runs Pixi's `releaseGlobalResources()` and corrupts every other live Application on the page (the active wallpaper, the content graph, OS Settings previews).

### Switching off parks, it does not destroy

Releasing a WebGL context is the single most disruptive thing this module can ask the browser to do. A full-viewport GPU layer disappears, the compositor re-rasterises, and on some frames that surfaced as a **white flash across the shell** — intermittent, and much more visible on a page that already has other live Pixi applications.

So switching Mio off stops the ticker, hides the layer, and leaves the context alone. It is destroyed when the page goes away, not when the user toggles.

Two consequences worth knowing:

- The `#desktop-mode-mio` element stays in the DOM while Mio is off, `display: none`. A shell whose user has *never* switched Mio on still has no element and no context — the cost is only paid once someone has actually used it, and it is one idle context plus its canvas.
- Re-enabling is instant: no bundle fetch, no Pixi boot, no new context. `mount` runs exactly once per page load however many times the user toggles, which is what `mio-controller.test.ts` asserts.

The position is read **before** the layer is hidden. A hidden host reports zero size, and every position derived from a zero-size host is the top-left corner — which is exactly the bug that shipped when the teardown was merely deferred rather than removed. The `ResizeObserver` ignores a detached or zero-size host for the same reason.

A dark backstop on the shell (`--desktop-mode-backstop`) covers the rest of the class: the shell sits over the white classic-admin page, so *any* layer failing to paint for a frame used to show white. Now the worst case is the desk's own colour.
