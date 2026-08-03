# Register a wallpaper

The OS Settings wallpaper picker is registry-driven: every entry in the registry becomes a swatch users can select. Register your own via `wp.os.registerWallpaper()` from inside a `os.init` action so the public API is guaranteed available.

Two types today: **CSS** (a static `background` value) and **canvas** (a plugin-managed DOM subtree, typically a WebGL/2D canvas).

---

## Recipe 1 — A custom gradient preset

The smallest possible registration. A one-liner `value` + a matching `preview` used as the swatch.

**my-plugin.php**

```php
<?php
/** Plugin Name: My Wallpaper */
defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function () {
    wp_enqueue_script(
        'my-wallpaper',
        plugins_url( 'my-wallpaper.js', __FILE__ ),
        array( 'openstation' ),   // <- hooks into the shell
        '1.0.0',
        true
    );
} );
```

**my-wallpaper.js**

```javascript
wp.os.ready( () => {
    wp.os.registerWallpaper( {
        id: 'my-plugin/ocean',
        label: 'Ocean',
        type: 'css',
        value: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
        preview: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
        description: 'Sea-surface blues fading into deep water.',
    } );
} );
```

The swatch appears in OS Settings next time the panel opens. Clicking it writes the value to `--os-bg` and persists the user's selection to `localStorage`.

`description` (optional) is a sentence or two shown in a styled card under the picker grid while your wallpaper is the active selection — tell the user what they're looking at. Plain text only. When registering server-side, pass it to `openstation_register_wallpaper()` (translatable with `__()`); the shell overlays it onto your JS def automatically.

---

## Recipe 2 — A canvas wallpaper using PixiJS

Declare dependencies by module id — the shell ships `pixijs` pre-registered and loads it before `mount` fires the first time anyone activates a wallpaper that needs it. Concurrent activations dedupe the fetch automatically.

```javascript
wp.os.ready( () => {
    wp.os.registerWallpaper( {
        id: 'my-plugin/particles',
        label: 'Particles',
        type: 'canvas',
        preview: '#0a0a1a',
        needs: [ 'pixijs' ],           // ← that's it
        mount: async ( container, ctx ) => {
            // window.PIXI is guaranteed available at this point.
            const app = new window.PIXI.Application();
            await app.init( { resizeTo: container } );
            container.appendChild( app.canvas );

            // Reduced-motion: render a still frame and bail.
            if ( ctx.prefersReducedMotion ) {
                app.ticker.stop();
                drawStillFrame( app );
                return () => app.destroy( { removeView: true } );
            }

            // Pause on tab-hidden via the shell's visibility action.
            const onVisibility = ( detail ) => {
                if ( detail?.id !== 'my-plugin/particles' ) return;
                if ( detail.state === 'hidden' ) app.ticker.stop();
                else app.ticker.start();
            };
            wp.hooks.addAction(
                'os.wallpaper.visibility',
                'my-plugin/particles-visibility',
                onVisibility
            );

            // Teardown — MUST release GL/animation resources or
            // switching wallpapers leaks memory.
            return () => {
                wp.hooks.removeAction(
                    'os.wallpaper.visibility',
                    'my-plugin/particles-visibility'
                );
                app.destroy( { removeView: true } );
            };
        },
    } );
} );
```

> **Never call `app.destroy( true )`.** In PixiJS v8 a literal `true` as the first argument runs `releaseGlobalResources()`, which clears Pixi's *page-global* texture and object pools — corrupting every **other** live Application on the page (the OS Settings live previews, other canvas wallpapers, any plugin's Pixi window). Symptoms are crash loops in `Batcher.break()` and teardown throws in `TexturePool.returnTexture()`. Use `app.destroy( { removeView: true } )` — same canvas cleanup, no global wipe.

### Shipping your own module

If you use a library that isn't pre-registered, register it once. Other plugins can then `needs:` it by id and share your fetch.

```javascript
wp.os.ready( () => {
    wp.os.registerModule( {
        id: 'three-js',
        url: `${ wp.os.config.pluginUrl }/vendor/three.min.js`,
        isReady: () => typeof window.THREE !== 'undefined',
    } );
} );

// ...elsewhere (same plugin or another):
wp.os.registerWallpaper( {
    id: 'my-plugin/starfield',
    type: 'canvas',
    needs: [ 'three-js' ],
    mount: /* ... */,
} );
```

---

## Recipe 3 — A wallpaper with in-panel settings

Any wallpaper can ship `renderEditor`. When that wallpaper is the selected swatch in OS Settings, a collapsible panel opens below the grid and your editor is rendered into it — same animation as the built-in custom-gradient editor.

```javascript
const state = { tint: '#6366f1' };

wp.os.ready( () => {
    wp.os.registerWallpaper( {
        id: 'my-plugin/tintable',
        label: 'Tintable',
        type: 'css',
        preview: state.tint,
        resolveValue: () => state.tint,   // re-read on every apply
        renderEditor: ( container ) => {
            const input = document.createElement( 'input' );
            input.type = 'color';
            input.value = state.tint;
            input.addEventListener( 'input', () => {
                state.tint = input.value;
                // Force an apply so the layer re-reads resolveValue.
                // (A helper for this pattern may ship in a future release.)
                wp.os.registerWallpaper( {
                    id: 'my-plugin/tintable',
                    label: 'Tintable',
                    type: 'css',
                    preview: state.tint,
                    resolveValue: () => state.tint,
                    renderEditor: /* reference same function */ undefined,
                } );
            } );
            container.appendChild( input );
            return () => input.remove();
        },
    } );
} );
```

---

## Recipe 4 — A live preview in the picker tile

A canvas wallpaper's `preview` string is a static stand-in. Ship `renderPreview` and the OS Settings picker mounts the real thing (or a cheap facsimile) inside the swatch tile — lazily, only while the tile is visible, capped at 4 concurrent previews page-wide, with the CSS `preview` as the fallback for every failure mode.

`ctx.params` parametrizes what the preview depicts: it's your def's `previewParams` after the `os.wallpaper.preview-params` filter. Use it when the honest render would look wrong in a thumbnail — the built-in Living Tree previews a 540-day-old showcase site so a day-old install doesn't advertise the wallpaper as a bare sprout.

```javascript
wp.os.ready( () => {
    wp.os.registerWallpaper( {
        id: 'my-plugin/aquarium',
        label: 'Aquarium',
        type: 'canvas',
        preview: '#04263b',                 // instant paint + fallback
        needs: [ 'pixijs' ],                // loaded before renderPreview too
        previewParams: { fishCount: 12 },   // idealized for the tile
        mount: async ( container, ctx ) => { /* the real thing */ },
        renderPreview: async ( container, ctx ) => {
            const app = new window.PIXI.Application();
            await app.init( { resizeTo: container, resolution: 1 } );
            container.appendChild( app.canvas );
            swim( app, Number( ctx.params.fishCount ) || 12 );
            if ( ctx.prefersReducedMotion ) {
                app.render();               // one still frame, no ticker
                app.ticker.stop();
            }
            return () => app.destroy( { removeView: true } );
        },
    } );
} );
```

Site owners and plugins can re-parametrize any wallpaper's preview without touching its code:

```javascript
wp.hooks.addFilter(
    'os.wallpaper.preview-params',
    'my-plugin/more-fish',
    ( params, wallpaperId ) =>
        wallpaperId === 'my-plugin/aquarium'
            ? { ...params, fishCount: 40 }
            : params
);
```

---

## Recipe 5 — A settings dialog with persisted values

`renderEditor` (Recipe 3) is an inline panel and owns its own state. For a fuller settings form with **persistence for free**, ship `renderConfig` instead: OS Settings shows a "Wallpaper settings" button for your wallpaper (only when selected, only because you opted in), clicking it opens a `<os-modal>` with your form inside, and `ctx.setSettings()` saves through the user's OS Settings (localStorage + user meta — values follow the user across devices).

Every wallpaper context (`mount`, `renderPreview`, `renderEditor`, `renderConfig`) reads the persisted bag back as `ctx.settings`. Each `setSettings` call also fires the `os.wallpaper.settings-changed` action with the full post-merge bag, so a mounted wallpaper applies edits live — the dialog doubles as a tuning panel.

```javascript
window.openStationWallpapers[ 'my-plugin/aquarium' ] = {
    id: 'my-plugin/aquarium',
    label: 'Aquarium',
    type: 'canvas',
    preview: '#04263b',
    needs: [ 'pixijs' ],

    mount: async ( container, ctx ) => {
        // Untrusted read-back: clamp to your defaults.
        const scene = await swim( container, Number( ctx.settings.fishCount ) || 12 );

        const onSettings = ( detail ) => {
            if ( detail?.id !== 'my-plugin/aquarium' ) {
                return;
            }
            scene.setFishCount( Number( detail.settings.fishCount ) || 12 );
        };
        wp.hooks.addAction(
            'os.wallpaper.settings-changed',
            'my-plugin/aquarium-live',
            onSettings
        );
        return () => {
            wp.hooks.removeAction(
                'os.wallpaper.settings-changed',
                'my-plugin/aquarium-live'
            );
            scene.destroy();
        };
    },

    renderConfig: ( container, ctx ) => {
        const field = document.createElement( 'os-range-field' );
        field.setAttribute( 'label', 'Fish' );
        field.setAttribute( 'min', '1' );
        field.setAttribute( 'max', '60' );
        field.setAttribute( 'value', String( Number( ctx.settings.fishCount ) || 12 ) );
        field.addEventListener( 'os-range-change', ( e ) => {
            ctx.setSettings( { fishCount: e.detail.value } );  // persists + fires the action
        } );
        container.appendChild( field );
        return () => {};
    },
};
```

Scalar values only (`string | number | boolean`) — the server-side sanitizer drops anything else, and caps the bag at 32 keys (strings at 256 chars). The built-in Snow wallpaper (`wp-snow`, `src/plugins/snow-wallpaper/`) is the in-tree reference: wind, snowflake count, flake size, and backdrop colour, all live-applied.

---

## Removing or reordering built-ins

The `os.wallpapers` filter receives the full list — add, remove, or reorder in one shot.

```javascript
// Hide the stock 'aurora' preset.
wp.hooks.addFilter(
    'os.wallpapers',
    'my-plugin/hide-aurora',
    ( list ) => list.filter( ( w ) => w.id !== 'aurora' )
);
```

---

## A canvas wallpaper driven by REST data

A canvas wallpaper doesn't have to be self-contained — it can pull site data over REST at mount time and shape itself from it. The built-in **Living Tree** wallpaper (`wp-living-tree`) is the reference for this pattern: on mount it fetches `desktop-mode/v1/living-tree/snapshot` through `wp.os.fetch` (so the request feeds the activity bus), turns the compact site "DNA" into normalised parameters, and renders a growing tree with PixiJS. Its algorithm is fully specified in [`../living-tree-algorithm.md`](../living-tree-algorithm.md), and the source under `src/plugins/living-tree-wallpaper/` is a good skeleton to copy: `index.ts` (fetch + publish the def), `scene.ts` (PixiJS app, layers, ticker, teardown), plus a narrow `pixi-types.ts` so the bundle never imports `pixi.js` directly.

The one rule worth stealing: **fetch through the framework, never raw `fetch()`** — use `trackedFetch` (in-bundle) or `window.wp.os.fetch` (external), with `{ silent: true }` for a background pull the user didn't initiate.

---

## Reference

- [Hooks catalog](../javascript-reference.md#4-hooks--openstation) — every `os.*` hook with its payload shape.
- [Wallpaper registration API](../javascript-reference.md#5-wallpaper-registration-api) — full `WallpaperDef` type, including `renderPreview` / `previewParams` / `renderConfig`.
- [The Living Tree — algorithm definition](../living-tree-algorithm.md) — a worked canvas-wallpaper spec that consumes REST site data.
