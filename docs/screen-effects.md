# Screen effects & the canvas stage

**Status:** Experimental · **Since:** 0.9.8

Desktop Mode can render the entire desktop — wallpaper, dock, widgets,
windows and all — inside a `<canvas>`, then run fragment shaders over
it. Three ship built in: **scanlines**, a **CRT tube**, and **pixel
art**. Plugins register their own the same way.

Users switch it on at **OS Settings → Experimental**. It is off by
default.

---

## Browser requirement

This is built on the WICG [HTML-in-Canvas
proposal](https://github.com/WICG/html-in-canvas), which is not yet a
shipped web standard. It needs **Chrome 148+** with the origin trial, or
any Chromium build with `chrome://flags/#canvas-draw-element` enabled.

**There is no fallback.** On a browser without the API the toggle in OS
Settings renders disabled under a notice explaining what is needed, and
the desktop keeps rendering as ordinary DOM. Feature-detect before
assuming anything:

```js
if ( wp.desktop.stage.isSupported() ) { /* … */ }
```

`isSupported()` gates on **one** primitive: `gl.texElementImage2D()`.
That is the only call PixiJS's HTML-in-Canvas uploader throws on when
the API is absent, and it throws on the first rendered frame — after
the shell has already been moved into the canvas. The rest of the
proposal degrades quietly and is deliberately *not* required:
`canvas.requestPaint()` is optional to PixiJS itself, and the 2D
`ctx.drawElementImage()` is never called by the stage.

`wp.desktop.stage.supportDetail()` returns the per-capability
breakdown — `{ requestPaint, texElementImage2D, texElementImage2DOn,
drawElementImage, layoutSubtree }` — for diagnosing a disabled toggle
without guessing.

---

## How it works

```
<body>
  #wpadminbar                                     ← outside; unaffected
  <canvas id="desktop-mode-stage" layoutsubtree>  ← the visible pixels
      #desktop-mode-shell                         ← the real DOM
          #desktop-mode-wallpaper
          .desktop-mode-shell__body → dock + #desktop-mode-area → windows
  </canvas>
```

The shell is **moved** into the canvas, not cloned. The `layoutsubtree`
attribute makes a canvas's direct children lay out, hit-test and appear
in the accessibility tree exactly as before — they simply paint
invisibly, and PixiJS paints their pixels instead via
`gl.texElementImage2D`.

So the canvas is a *display surface, never an input surface*. Clicks,
focus, text selection, scrolling and iframes all land on the real shell
underneath. Windows stay draggable, editors stay editable.

### What this means in practice

| | |
|---|---|
| **Interactivity** | Unaffected. The DOM is live underneath. |
| **Accessibility** | Unaffected. `layoutsubtree` keeps the subtree in the a11y tree, and the canvas carries no `aria-hidden`. |
| **Iframe windows** | Rasterize normally — they are same-origin (`?desktop_mode_chromeless=1`). Only **cross-origin** embeds are excluded by the API's privacy model. |
| **Hit-testing under curvature** | The browser hit-tests the *unwarped* element. Under heavy CRT curvature a click near the screen edge lands where the element really is, a few pixels from where it visually appears. Curvature is a slider that defaults low for this reason. |
| **Cost** | A full-viewport GPU texture upload per frame. |

### Turning it on and off

The **effect chain and every slider are live** — no reload, ever.

The **master toggle** is different: moving the shell in the DOM
re-parents every `<iframe>` inside it, which reloads them. So the shell
is wrapped at boot before any window exists. If you flip the toggle at
runtime while iframe windows are open, Desktop Mode asks whether to
reload rather than silently discarding unsaved work; with no iframe
windows open it wraps live.

---

## Registering an effect

An effect is a PixiJS `Filter` plus metadata. Register it from JS:

```js
wp.desktop.stage.registerScreenEffect( {
    id: 'my-plugin/sepia',
    label: 'Sepia',
    description: 'Drain the desktop to an old photograph.',
    order: 25,
    owner: 'my-plugin-screen-effects',
    params: [
        { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
    createFilter( ctx ) {
        const { Filter, GlProgram, UniformGroup } = ctx.pixi;
        return new Filter( {
            glProgram: GlProgram.from( {
                vertex: VERTEX,      // Pixi's stock filter vertex shader
                fragment: FRAGMENT,
                name: 'my-plugin-sepia',
            } ),
            resources: {
                sepiaUniforms: new UniformGroup( {
                    uAmount: { value: ctx.params.amount, type: 'f32' },
                } ),
            },
        } );
    },
    update( filter, ctx ) {
        filter.resources.sepiaUniforms.uniforms.uAmount = ctx.params.amount;
    },
} );
```

See [`examples/register-screen-effect.md`](examples/register-screen-effect.md)
for a complete, copy-pasteable plugin including the shader source.

### `ScreenEffectDef`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Required. `/^[a-z0-9_/-]+$/` — namespace as `vendor/sub-id`. Lower-cased on registration. |
| `label` | `string` | Required. Shown as the checkbox label. |
| `description` | `string` | Optional, shown under the checkbox. |
| `order` | `number` | Chain position; lower runs first. Default `100`. |
| `params` | `ScreenEffectParam[]` | Optional sliders. Each `{ key, label, min, max, step, default, suffix? }`. |
| `createFilter( ctx )` | `( ctx ) => Filter` | Required. Build the Pixi filter. Throwing drops only this effect. |
| `update( filter, ctx )` | `function` | Optional. Push changed params into an existing filter. Without it, param changes rebuild the filter. |
| `tick( filter, elapsed, ctx )` | `function` | Optional. Per-frame hook for time-driven effects; `elapsed` is seconds since the effect entered the chain. |
| `owner` | `string` | Your script handle. Enables live unregistration on plugin deactivation. |

`ctx` is a `ScreenEffectContext`:
`{ pixi, params, screen, resolution, reducedMotion }`. `params` always
contains every key you declared, clamped to range with defaults filled
in — you never need to validate it.

`reducedMotion` reflects `prefers-reduced-motion: reduce`. The stage
reports it rather than silently suppressing your animation, so honour it
in `tick()`. Both built-ins do: the CRT holds a steady brightness and the
scanlines stop rolling. A full-screen shader that pulses or scrolls is
precisely what that setting exists for, and at some rates brightness
flicker is a photosensitivity risk rather than a matter of taste — the
CRT's flicker speed is capped at 3 Hz for that reason (WCAG 2.3.1: no
more than three flashes in any one second).

### Chain order

The built-ins are ordered so the result looks like a real monitor:

| Effect | `order` | Why there |
|---|---|---|
| `pixel-art` | 10 | First, so everything downstream operates on the blocky image. |
| `scanlines` | 20 | After pixelation, before the tube. |
| `crt` | 30 | Last, so the tube's curvature bends the scanlines too. |

Users can stack up to **8** effects.

### Shader conventions

The stage pins the renderer to WebGL, so **GLSL only** — no WGSL twin
needed. Follow Pixi's own filter conventions:

- Use Pixi's stock filter vertex shader (reproduced in
  `src/stage/effects/shared.ts` as `FILTER_VERTEX`).
- Declare custom uniforms as plain `uniform` in the fragment and supply
  them through a named `UniformGroup` in `resources`.
- `uInputSize` (`xy` = input texture size in px, `zw` = 1/size),
  `uInputClamp` (the safe UV rectangle inside a pooled, possibly
  oversized input texture) and `uOutputFrame` (`zw` = filtered area
  size) are supplied by Pixi; declare them if you need them.
- Colours arrive **premultiplied**. Any shader scaling `rgb` must
  un-premultiply first and re-premultiply after.

---

## Registering from PHP

JS registration alone means the effect only appears after a page
reload. To have it appear the moment your plugin is activated, declare
your script handle server-side:

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-screen-effects',
        plugins_url( 'js/screen-effects.js', __FILE__ ),
        array( 'desktop-mode' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-screen-effects' );
} );
desktop_mode_register_screen_effect_script( 'my-plugin-screen-effects' );
```

The shell injects the URL from the live-refresh payload
(`serverScreenEffectScripts`), so activation surfaces the effect with no
F5. Set `owner` to the same handle in your `registerScreenEffect` call
and deactivation removes it live too.

See [`hooks-reference.md`](hooks-reference.md) for the full PHP surface.

---

## JavaScript API

```js
wp.desktop.stage.isSupported()                  // boolean
wp.desktop.stage.supportDetail()                // per-capability breakdown, for diagnosis
wp.desktop.stage.isActive()                     // boolean — rendering through the canvas right now
wp.desktop.stage.registerScreenEffect( def )    // throws RegistrationError on bad input
wp.desktop.stage.unregisterScreenEffect( id )
wp.desktop.stage.listScreenEffects()            // post-filter snapshot
wp.desktop.stage.subscribeScreenEffects( cb )   // returns an unsubscribe
```

The registry is live whether or not the stage is running, so you can
register at boot and let the user switch the renderer on later.

### Filter

```js
wp.desktop.hooks.addFilter(
    'desktop-mode.screen-effects',
    'my-plugin',
    ( effects ) => effects.filter( ( fx ) => fx.id !== 'crt' )
);
```

### Actions

| Hook | Payload | When |
|---|---|---|
| `desktop-mode.stage.started` | `{ canvas }` | The shell is wrapped and the first frame is drawn. |
| `desktop-mode.stage.stopped` | `{}` | The shell is back to plain DOM rendering. |

---

## User settings

Two per-user keys, persisted in the `desktop_mode_os_settings` user meta
and readable via `wp.desktop.getOsSettings()`:

| Key | Type | Default |
|---|---|---|
| `canvasStageEnabled` | `boolean` | `false` |
| `screenEffects` | `Array<{ id, params? }>` | `[]` |

`screenEffects` is an ordered list capped at 8. Ids belonging to effects
that are not currently registered are **kept** — a plugin may be
temporarily deactivated — and skipped at render time.

---

## Window transition effects

*Since 0.9.8.* Separate from the screen effects above: those are shaders
over the whole desktop, these animate **one window** through a lifecycle
transition — opening, closing, minimising, maximising, or being dragged.
Configured in the same tab, under *Window animations*.

The full transition list is `open`, `close`, `minimize`, `restore`,
`maximize`, `unmaximize`, `drag`.

### How a window becomes a PixiJS object

Not by reparenting it into the canvas. `HTMLSource` requires its element
to be a direct child, so moving windows there would reload every iframe
and break the window manager's layout, z-order and snapping.

Instead the stage's texture already contains every window, so the engine
**freezes the window's rectangle out of it** with
`renderer.generateTexture()`, hides the real element, and hands the
effect a sprite of those frozen pixels. PixiJS documents this exact
pattern for shatter-style effects. Nothing is animated with CSS.

That texture is a *snapshot*, recorded in the browser's `paint` event
and uploaded on the following render, so it always trails the DOM by a
frame or two. Which way that cuts depends on the transition:

- **Announced after the change** — minimise, maximise, close. The lag is
  the whole reason this works: a minimise arrives once the window is
  already minimised, and the stale frame is the only surviving record of
  what it looked like before. Repainting the capture would catch the
  aftermath, so these never do.
- **Announced before it** — drag and open. The pointerdown that precedes
  a drag raises the window to the top of the stack, so the DOM has it on
  top while the snapshot still has it underneath, and the first capture
  comes out with the overlapping window baked in. Open is starker still:
  the window is announced in the same synchronous block that created it,
  so it has never been painted and the rectangle holds the **wallpaper**
  that was behind it — which is what made an opening window look
  see-through.

Nothing waits, in either case. Delaying a drag effect until the snapshot
caught up left the real window being dragged, unaltered, for a beat
before the animation took over — a worse artefact than the bug. Instead
the stand-in goes up immediately with whatever the snapshot holds, and
`stage.recaptureRegion()` repaints **the same texture** from the next
one, at which point the real element is hidden. The stand-in covers the
window for that one frame, so nothing flashes, and effects that built a
mesh or a thousand particles around `ctx.texture` need no API to hear
about it — the object never changes, only its pixels.

The repaint reads the window's rectangle **as it is then**, not where it
was, because a drag has moved it by that point. It refreshes pixels
only: where the stand-in sits is the effect's business, and an engine
writing to it would fight whatever the effect set on its last frame.

For that one frame the stand-in is held `visible = false`. Its pixels
are known wrong, and on an open they are not merely wrong but the
wallpaper — the real window is the better thing to look at until the
correction lands. Effects run through it normally, so they simply play
their first frame or two off-screen.

### CSS animations on the real element

`Window` adds `desktop-mode-window--opening` on creation, and
`window-states.css` runs a 200 ms `opacity: 0 → 1` + `scale(0.92 → 1)`
keyframe on it. When a PixiJS open effect is playing, the engine
**removes that class** before its first frame paints. Two reasons, and
the second is the one that bites:

- The corrected capture would land on a window still at roughly zero
  opacity, so the effect would animate a ghost.
- A running CSS animation **outranks inline styles** in the cascade, so
  the engine's `opacity` hide would not apply until the animation ended
  — the real window showing through its own stand-in for 200 ms.

The same trap is waiting for any effect that restyles `ctx.element`. If
a keyframe animation is running on it, your inline styles are advisory.

The engine owns capture, positioning, timing and cleanup; a def owns
only the animation:

```js
wp.desktop.stage.registerWindowEffect( {
    id: 'my-plugin/swoosh',
    label: 'Swoosh',
    transitions: [ 'open', 'close' ],
    owner: 'my-plugin-fx',
    params: [
        { key: 'duration', label: 'Duration', min: 100, max: 800,
          step: 10, default: 300, suffix: 'ms' },
    ],
    durationMs: ( params ) => params.duration,
    run( ctx ) {
        // ctx.sprite is the window's frozen pixels, already positioned.
        return new Promise( ( resolve ) => {
            let t = 0;
            const step = ( tick ) => {
                if ( ctx.signal.aborted ) { ctx.ticker.remove( step ); resolve(); return; }
                t += tick.deltaMS / ctx.params.duration;
                ctx.sprite.x = ctx.from.x + t * 200;
                ctx.sprite.alpha = 1 - t;
                if ( t >= 1 ) { ctx.ticker.remove( step ); resolve(); }
            };
            ctx.ticker.add( step );
        } );
    },
} );
```

`ctx` carries `{ pixi, transition, params, sprite, texture, layer, from,
to?, element, ticker, signal }`. `from` is the window's rect in CSS
pixels relative to the stage; `to` is the destination where one exists
(the dock tile on minimise, the new geometry on maximise); `element` is
the real window element, still in the DOM and still being moved by the
window manager while hidden — read its box each frame to follow a live
drag, but do not restyle it, the engine owns its visibility. Throwing or
rejecting is safe — the engine cleans up and the transition completes,
so a broken effect degrades to no effect rather than a stuck window.

Add your own display objects to `ctx.layer`, not to the sprite's parent:
the layer is a container the engine created for this one effect and
destroys whole, so anything you leave in it is cleaned up in the right
order. `ctx.texture` is released about a second later — do not hold a
reference to it past `run()`.

> **If your effect creates its own textures, do not destroy their
> sources while a `Mesh` is using them.** PixiJS 8's WebGL mesh adaptor
> owns a single renderer-lifetime shader, and its bind group destroys
> *itself* the moment a bound resource reports `destroyed` — after which
> every mesh draw throws `Cannot read properties of null (reading '0')`
> for the rest of the page's life. Call
> `source.removeAllListeners( 'change' )` before `destroy()`, which is
> what the engine does for the textures it hands you
> (`src/stage/window-fx/texture-retire.ts`).

### Sustained transitions

`drag` is not momentary. It starts on drag-start and runs until
drag-end, so `durationMs` means nothing for it: the effect should loop
until `ctx.signal` aborts, and may keep animating after that to wind
itself down (Cloth swings to rest over ~700 ms).

The window stays hidden for the whole time, and **there is no time
limit** — a drag lasting minutes is perfectly ordinary, and any ceiling
would eventually fire mid-drag and re-render the real window behind its
own animation. Momentary effects do get a 4-second watchdog, because one
that never resolves would leave a window nobody can click. The sustained
failsafe is a fact instead of a clock: a `pointerup` or `pointercancel`
anywhere in the document aborts the effect, so a drag-end lost to an
alt-tab or a torn-down window cannot strand it.

An effect that keeps running past the abort must end where the real
window is, not where physics left it. The engine holds the stand-in on
screen for two frames after restoring the element — the stage draws a
snapshot of the DOM refreshed once per frame, so the window is not
actually back until the snapshot catches up, and removing the copy any
sooner leaves a gap that reads as an abrupt blink. Those two frames draw
both, so a stand-in that does not finish on the window's exact rectangle
shows as a double image.

### Hiding the window

The engine hides the real element with `opacity`, not `visibility`
(inherited, so a descendant can punch back through) or `display: none`
(collapses layout and moves every other window). The value is `0.001`
rather than `0`: a fully transparent subtree can be skipped during paint
altogether, and iframes get throttled when they are, so restoring made
every iframe repaint from scratch — indistinguishable from the whole
shell reloading.

**Both writes happen with `transition: none` pinned on inline, and that
is the half worth remembering.** Windows carry `opacity 0.2s ease` in
their base transition list (`assets/css/window-chrome.css`), so writing
the property does not hide or show a window — it *animates* it. Dragging
masks this at the start, because the window manager's `--dragging` class
already suppresses transitions, but not at the end: that class comes off
at pointer-up, hundreds of milliseconds before a sustained effect
finishes settling.

Suppression covers the write only, never the effect's whole run — a
snap-drag gives the window a deliberate 90 ms transition of its own, and
pinning transitions off wholesale would silently flatten it. **Anything
your effect does to the real element is subject to the same trap.**

### The close gate

Closing is the one transition the window manager has to *wait* for.
`Window.close()` normally finalises on the CSS `transitionend` with a
300 ms backstop, which would truncate anything richer. So it fires
`desktop-mode.window.close-animation` first; a handler returning a
duration in milliseconds claims the close, the `transitionend` shortcut
is skipped, and the backstop is stretched to fit (capped at 3 s so a
miscalculated duration cannot strand a window).

`destroy()` bypasses the filter entirely, so plugin deactivation and
tests stay synchronous.

### Built-ins

| Effect | Transitions | Notes |
|---|---|---|
| **Scale & fade** | open, close, minimise, restore, maximise, unmaximise | The safe default. |
| **Genie** | minimise, restore | Squeezes toward the dock tile. |
| **Morph** | maximise, unmaximise | Stretches between old and new geometry. |
| **Vanish** | close | The Thanos dissolve — the texture is sliced into a grid of particles that drift, spin and fade, sweeping across the window so it disintegrates from one edge. Particle count is `density²`, capped at 1600. |
| **Reconstruct** | open | Vanish run backwards. Tiles fly in from across the desktop, spinning and transparent, and decelerate onto the square they belong in, knitting the window together from one edge. Same grid and same 1600 cap. |
| **Cloth** | drag | The window hangs from its title bar like fabric. A Verlet solver drives a `MeshPlane`'s vertex grid, pinned to the live title-bar edge, so the sheet lags, swings and settles as you drag. |

Every transition defaults to *None*.

### Why there is no focus or blur transition

They were offered briefly and cannot work. An effect animates a *copy*
of the window, and focus fires **mid-click**:

- Hide the real window and animate the copy, and the window vanishes
  under the pointer, swallowing the click that caused the focus. You
  cannot press close or start a drag.
- Leave the window visible and animate a copy over it, and you see the
  window twice — every click flashes a ghost.

There is no third option. Transitions where the window is arriving,
leaving, or already captured by a drag do not have this problem, because
hiding the original is exactly right there.

Focus styling is well served by the **unfocus-effect** system (OS
Settings → Effects), which applies cheap CSS filters to the real element
and never duplicates anything. See
[`examples/custom-unfocus-effect.md`](examples/custom-unfocus-effect.md).

### Setting

`windowEffects` — a per-user map of transition → `{ id, params? }`,
alongside `screenEffects`. Unknown effect ids are kept so a deactivated
plugin's choice survives.

---

## Browser compatibility shim

`src/stage/webgl-compat.ts` patches `texElementImage2D` on the WebGL
context prototypes, and it is worth knowing why.

The proposal's WebGL entry point changed shape while it was being
finalised:

```
legacy  gl.texElementImage2D( target, level, internalformat, format, type, source )
final   gl.texElementImage2D( target, internalformat, source )
```

Chromium 150+ implements the finalised 3-argument form strictly.
PixiJS 8.19.0 still emits the legacy 6-argument call, so the browser
WebIDL-converts argument 3 — `gl.RGBA`, a number — against
`(Element or ElementImage)` and throws:

> Failed to execute 'texElementImage2D' on 'WebGL2RenderingContext':
> The provided value is not of type '(Element or ElementImage)'.

Because PixiJS uploads from inside the browser's `paint` event, that
throw happens on every frame and cannot be caught by the stage — the
symptom is a blank desktop and a flooded console. Chrome's own PixiJS
demo ships the same shim for the same reason.

Two safeguards keep it narrow: it installs **only** when
`texElementImage2D.length === 3`, and it rewrites **only** calls that
arrive with the legacy argument count, so native 3-argument callers pass
through untouched.

`wp.desktop.stage.supportDetail().needsUploadShim` reports whether this
browser has the finalised signature.

**Remove this when PixiJS ships the 3-argument call** — watch
`glUploadHTMLResource` in `pixi.js/html-source`.

---

## Limitations & known risks

- **Nested live canvases.** Canvas wallpapers, games and Pixi-based
  widgets sit *inside* the rasterized shell, so they are re-rendered
  into the stage texture every frame. Watch performance if you run an
  animated wallpaper with the stage on.
- **Curvature vs. hit-testing** — see the table above.
- **The admin bar is outside the canvas** and is not affected by
  effects in this version.
- **Origin trial.** Shipping this to a production site means either the
  Chrome origin trial or asking users to enable the flag.

---

## See also

- [`javascript-reference.md`](javascript-reference.md) — `wp.desktop.stage`, events, settings keys
- [`hooks-reference.md`](hooks-reference.md) — `desktop_mode_register_screen_effect_script()`
- [`examples/register-screen-effect.md`](examples/register-screen-effect.md) — full worked example
- [`examples/custom-unfocus-effect.md`](examples/custom-unfocus-effect.md) — the *other* effect system (per-window CSS treatments, unrelated to the canvas stage)
