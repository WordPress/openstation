# Register a custom window reveal

**Status:** Experimental

A **window reveal** is the transition that uncovers a window's content
once it has finished loading. Desktop Mode paints an opaque surface
over the window body for the duration of the load, then animates that
surface's `clip-path` away. The user picks one in **OS Settings →
Effects → "Window reveal"**, and sets a global speed next to it. The
twelve built-ins — `sweep`, `rise`, `diagonal`, `iris`, `diamond`,
`curtain`, `shutter`, `blinds`, `slats`, `mosaic`, `radar`,
`obturator` — are registered through exactly the API below.

The surface is a sibling of the window's `<iframe>` in the shell's own
DOM. Nothing is injected into the page being revealed, and the content
is never clipped itself — so a reveal cannot swallow a click, break a
plugin's layout, or interfere with whatever is loading.

## The minimum viable reveal

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerWindowReveal( {
        id:    'acme/rise',
        label: 'Rise',
        // The surface starts covering everything…
        from:  'inset( 0% 0% 0% 0% )',
        // …and ends inset 100% from the bottom: nothing left.
        to:    'inset( 0% 0% 100% 0% )',
        owner: 'my-plugin-reveals',
    } );
} );
```

Enqueue that as a normal admin script and the reveal appears in the
selector on the next load.

`owner` should be your script handle. It is what lets the shell
unregister your reveal live when your plugin is deactivated, instead of
leaving a dead entry in the user's selector until they reload.

## The one rule: `from` and `to` must interpolate

CSS animates a `clip-path` only between values that use the **same
shape function**. For `polygon()` it additionally requires the **same
vertex count** and the same fill rule.

A pair that breaks those rules is not an error the browser reports. It
simply jumps from one value to the other at the halfway mark — which,
on a window that has just finished loading, reads as a flicker rather
than as a broken animation, and is easy to ship without noticing.

`registerWindowReveal()` throws when the two endpoints use different
shape functions:

```javascript
// Throws: `inset()` and `circle()` cannot interpolate.
wp.desktop.registerWindowReveal( {
    id:    'acme/broken',
    label: 'Broken',
    from:  'inset( 0% )',
    to:    'circle( 0% )',
} );
```

Vertex counts it cannot check for you, because both values are
individually valid. **Build both endpoints from one function** so the
ring structure cannot drift:

```javascript
/**
 * Surface with a growing rectangular hole in the middle. Vertex count
 * is fixed by the shape, so any two calls interpolate.
 *
 * @param {number} h Hole half-height, 0 (covered) to 52 (uncovered).
 */
function band( h ) {
    return `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
        -2% ${ 50 - h }%, -2% ${ 50 + h }%,
        102% ${ 50 + h }%, 102% ${ 50 - h }%,
        -2% ${ 50 - h }%, 0% 0%
    )`.replace( /\s+/g, ' ' );
}

wp.desktop.registerWindowReveal( {
    id:    'acme/band',
    label: 'Band',
    from:  band( 0 ),
    to:    band( 52 ),
    owner: 'my-plugin-reveals',
} );
```

Two things about that polygon are worth copying:

- **The hole is wound backwards** relative to the outer ring, and the
  path returns to `0% 0%` before and after it. That is what punches a
  hole under the default `nonzero` fill rule — no `evenodd` keyword,
  which would otherwise have to match on both endpoints too.
- **The hole overshoots the box** (`-2%` / `102%`) on the axis it spans
  fully, so no hairline of surface survives at fractional window sizes.

The shipped reveals are built the same way — see
[`src/reveals/shapes.ts`](../../src/reveals/shapes.ts) for
`irisSurface()`, `curtainSurface()` and `blindsSurface()`, and
`tests/vitest/window-reveal-shapes.test.ts` for the invariant asserted
as a test.

## The leading edge

A reveal can be drawn as **two** layers: the surface you described, and
behind it an **edge** painted in `--desktop-mode-window-reveal-edge`.
The edge runs your *same* `from` → `to` keyframes over a slightly
longer duration, so it is permanently a little less far along and peeks
out past the surface as a band hugging the clip boundary.

You never describe an edge shape. A time lag follows any geometry, so
your reveal gets a correctly-shaped edge for free — the same mechanism
that gives `blinds` six thin lines, `iris` an opening ring, and `radar`
a rotating spoke.

**It is off unless a theme turns it on.** The colour token ships as
`transparent`, and while it computes that way the shell drops the layer
rather than animating something invisible — so an edge costs nothing
until someone asks for one. Turning it on is pure CSS:

```css
.desktop-mode-shell {
    --desktop-mode-window-reveal-edge: #7c5cff;
    /* Fraction of the reveal's travel — holds its apparent width at
       any speed. `70ms` would pin it to time instead. */
    --desktop-mode-window-reveal-edge-thickness: 12%;
}
```

Thickness declared that way **overrides** your `edgeLag`, because it
belongs to the theme's look rather than to any one reveal. Your
`edgeLag` is what applies when no theme has an opinion:

```javascript
wp.desktop.registerWindowReveal( {
    id:      'acme/edgeless',
    label:   'Edgeless',
    from:    band( 0 ),
    to:      band( 52 ),
    edgeLag: 0,        // this reveal never gets an edge, themed or not
} );
```

`edgeLag` is in ms and defaults to `70` (clamped to 0–600). A longer
lag means a wider band.

## Tuning the motion

```javascript
wp.desktop.registerWindowReveal( {
    id:          'acme/slow-iris',
    label:       'Slow iris',
    description: 'Opens out from the centre, unhurried.',
    from:        band( 0 ),
    to:          band( 52 ),
    duration:    900,                       // ms; clamped to 80–4000
    easing:      'cubic-bezier( 0.2, 0, 0, 1 )',
    owner:       'my-plugin-reveals',
} );
```

`description` shows under the selector while your reveal is the active
one — a good place for a one-line description of the motion.

### Who decides the speed

Your `duration` is the *lowest*-priority of three, because the user's
own preference has to win:

1. **The user's OS-Settings speed** — *Effects → Reveal speed*. When
   they pick anything other than "Default (per reveal)", it overrides
   every reveal, including yours.
2. **`--desktop-mode-window-reveal-duration`** — a desktop theme's
   house pace. Undeclared by default; accepts `620ms`, `0.62s`, or a
   bare `620`.
3. **Your def's `duration`.**

Whichever wins, `edgeLag` is scaled by the same ratio, so your edge
band keeps its apparent width at any speed — band width is a fraction
of the travel, not a span of time. Nothing to handle on your side.

## Colouring the layers

Three theme tokens, all overridable from a desktop theme's `tokens`
block or any stylesheet:

| Token | Role | Default |
|---|---|---|
| `--desktop-mode-window-reveal-surface` | The covering surface | white |
| `--desktop-mode-window-reveal-edge` | The trailing edge band | `transparent` — no edge |
| `--desktop-mode-window-reveal-edge-thickness` | Band width: `%`/fraction of travel, or a time | undeclared — the def's `edgeLag` |
| `--desktop-mode-window-reveal-duration` | House pace for every reveal | undeclared — the def's `duration` |

```css
.desktop-mode-shell {
    --desktop-mode-window-reveal-surface: linear-gradient(
        135deg,
        #12122a,
        #241f4d
    );
    --desktop-mode-window-reveal-edge: #7c5cff;
    --desktop-mode-window-reveal-edge-thickness: 12%;
    --desktop-mode-window-reveal-duration: 620ms;
}
```

Because the animation clips the layers rather than fading them, a
gradient or image works as well as a flat colour. Setting either to
`transparent` turns that layer off — the shell drops it instead of
animating something invisible.

## Reveals with more than one moving part

One `clip-path` is one region, so anything it leaves uncovered is
uncovered. If your effect depends on pieces **overlapping** — a
mechanism rather than a shape — supply `layers` instead of `from`/`to`.
The uncovered area then becomes whatever *all* the layers leave
uncovered:

```javascript
wp.desktop.registerWindowReveal( {
    id:      'acme/split-doors',
    label:   'Split doors',
    edgeLag: 0,
    layers:  [
        { from: 'inset( 0% 50% 0% 0% )', to: 'inset( 0% 100% 0% 0% )', color: '#3a3a47' },
        { from: 'inset( 0% 0% 0% 50% )', to: 'inset( 0% 0% 0% 100% )', color: '#4a4a59' },
    ],
} );
```

Each layer keeps the same interpolation contract and shares the
reveal's duration and easing.

**Give neighbouring layers different `color`s.** It is the only thing
that makes an overlap visible. Layers of one colour composite into a
single silhouette however you shape them — the part on top is
indistinguishable from the part beneath, so the lying-across that makes
a mechanism a mechanism never renders. With different tones, every
overlap draws itself: the upper layer's tone wins, and its boundary
across the lower one *is* the seam.

Don't reach for the trailing edge to do this. Every edge layer paints
behind every surface layer, so an edge can only ever show
`union( edges ) − union( surfaces )` — one band around the uncovered
area, never per-part seams. Set `edgeLag: 0` on a multi-layer reveal.

## When layers aren't enough: `render`

Some effects a stack of clipped boxes simply cannot express. `render`
hands you the DOM instead:

```javascript
wp.desktop.registerWindowReveal( {
    id:      'acme/iris',
    label:   'Iris',
    edgeLag: 0,             // a rendered reveal has no trailing-edge layer
    render:  () => {
        const element = buildMySvg();
        return {
            element,
            play: ( { duration, easing, delay } ) =>
                bladesOf( element ).map( ( blade ) =>
                    blade.animate(
                        [ { transform: 'rotate(0deg)' }, { transform: 'rotate(48deg)' } ],
                        { duration, easing, delay, fill: 'both' },
                    ),
                ),
        };
    },
} );
```

The shell still owns the timing — when it plays, how long it runs, the
user's speed setting, the spinner hand-off, reduced-motion, teardown.
You own the element and the animations, and return every `Animation`
so the shell can wait on them and cancel them if the window reloads
mid-reveal.

The built-in `obturator` is why this exists. A lens iris has a
**cyclic** overlap — every leaf over the next, and the last back under
the first. That is a circular dependency; paint order is a linear one,
so no stack of layers can represent it. Built from layers, the last one
has nothing drawn over it and keeps a visibly disproportionate share of
the area, which reads as one flat region exactly where a seam belongs.

As SVG it dissolves: six equilateral wedges tile a hexagon over the
window and each slides tangentially, under a `<mask>` built from the
same paths. Nothing restacks — every frame is one `translate` per wedge
plus mask compositing. See
[`src/reveals/obturator.ts`](../../src/reveals/obturator.ts).

### When the paint IS the reveal

A def can carry its own surface paint with `surfaceColor`, overriding
the token:

```javascript
wp.desktop.registerWindowReveal( {
    id:           'acme/noir',
    label:        'Noir',
    from:         band( 0 ),
    to:           band( 52 ),
    surfaceColor: '#0b0b0e',
} );
```

**Almost no reveal should.** A reveal is normally a *shape*, and the
site decides what colour that shape is; hard-coding paint takes that
away from every theme your plugin will ever run under. The one shipped
exception is `obturator` (Camera shutter), whose near-black blades are
what make it a camera shutter rather than a hexagon. Reach for it only
when the same is true of yours.

`edgeColor` works the same way, and a multi-layer reveal usually needs
it: set it **darker** than your surface, or the overlapping parts read
as a single mass with no visible seams between them.

A desktop theme can also *recommend* a reveal and a speed through its
manifest, applied once on the user's first activation — see
[`docs/desktop-themes.md`](../desktop-themes.md#recommended-os-settings).

## What the framework guarantees

- **The reveal always plays.** The loading spinner has a 120 ms entry
  delay, so fast loads never paint one — the reveal still runs, just
  without waiting for a fade-out that never happened.
- **It replays on every load edge**, matching the spinner: reload,
  in-window navigation, tab switch. Not only on first open.
- **`prefers-reduced-motion` is honoured** — the content is uncovered
  directly, with no animation.
- **A window mid-load keeps the reveal that armed it.** If the user
  switches reveals while a window is still loading, that window
  finishes with the pair it started with rather than animating between
  two unrelated shapes.
- **Teardown waits for the edge**, which by design lands after the
  surface — so the band is never yanked off screen mid-travel. With no
  edge (the default) it waits for the surface instead.

## Reading and removing

```javascript
wp.desktop.listWindowReveals();                  // every registered reveal
wp.desktop.unregisterWindowReveal( 'acme/rise' );
wp.desktop.getOsSettings().windowReveal;         // the user's pick, or 'none'
wp.desktop.getOsSettings().windowRevealDuration; // ms, or 0 for per-reveal
```

The raw `desktop-mode.window-reveals` JS filter receives the registry
array on every read — use it to reorder, remove, or conditionally swap
reveals:

```javascript
wp.hooks.addFilter(
    'desktop-mode.window-reveals',
    'my-plugin/only-calm-reveals',
    ( reveals ) => reveals.filter( ( r ) => r.id !== 'blinds' ),
);
```

## Known limitation

Registration is JS-only. There is no
`desktop_mode_register_window_reveal_script()` PHP companion yet, so a
reveal shipped by a plugin the user activates mid-session shows up in
the selector only after a page reload. Reveals from plugins that were
already active work normally. The same gap applies to palettes.

## See also

- [`docs/javascript-reference.md`](../javascript-reference.md) —
  `registerWindowReveal` reference and the full `WindowRevealDef` table
- [`docs/examples/custom-unfocus-effect.md`](./custom-unfocus-effect.md) —
  the sibling registry, for unfocused windows
- [`docs/desktop-themes.md`](../desktop-themes.md) — theming the reveal
  surface
