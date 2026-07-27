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
