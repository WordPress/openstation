# Register a wallpaper

The OS Settings wallpaper picker is registry-driven: every entry in the registry becomes a swatch users can select. Register your own via `wp.desktop.registerWallpaper()` from inside a `desktop-mode.init` action so the public API is guaranteed available.

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
        array( 'desktop-mode' ),   // <- hooks into the shell
        '1.0.0',
        true
    );
} );
```

**my-wallpaper.js**

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerWallpaper( {
        id: 'my-plugin/ocean',
        label: 'Ocean',
        type: 'css',
        value: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
        preview: 'linear-gradient(180deg, #0ea5e9, #1e3a8a)',
    } );
} );
```

The swatch appears in OS Settings next time the panel opens. Clicking it writes the value to `--desktop-mode-bg` and persists the user's selection to `localStorage`.

---

## Recipe 2 — A canvas wallpaper using PixiJS

Declare dependencies by module id — the shell ships `pixijs` pre-registered and loads it before `mount` fires the first time anyone activates a wallpaper that needs it. Concurrent activations dedupe the fetch automatically.

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerWallpaper( {
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
                return () => app.destroy( true );
            }

            // Pause on tab-hidden via the shell's visibility action.
            const onVisibility = ( detail ) => {
                if ( detail?.id !== 'my-plugin/particles' ) return;
                if ( detail.state === 'hidden' ) app.ticker.stop();
                else app.ticker.start();
            };
            wp.hooks.addAction(
                'desktop-mode.wallpaper.visibility',
                'my-plugin/particles-visibility',
                onVisibility
            );

            // Teardown — MUST release GL/animation resources or
            // switching wallpapers leaks memory.
            return () => {
                wp.hooks.removeAction(
                    'desktop-mode.wallpaper.visibility',
                    'my-plugin/particles-visibility'
                );
                app.destroy( true );
            };
        },
    } );
} );
```

### Shipping your own module

If you use a library that isn't pre-registered, register it once. Other plugins can then `needs:` it by id and share your fetch.

```javascript
wp.desktop.ready( () => {
    wp.desktop.registerModule( {
        id: 'three-js',
        url: `${ wp.desktop.config.pluginUrl }/vendor/three.min.js`,
        isReady: () => typeof window.THREE !== 'undefined',
    } );
} );

// ...elsewhere (same plugin or another):
wp.desktop.registerWallpaper( {
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

wp.desktop.ready( () => {
    wp.desktop.registerWallpaper( {
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
                wp.desktop.registerWallpaper( {
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

## Removing or reordering built-ins

The `desktop-mode.wallpapers` filter receives the full list — add, remove, or reorder in one shot.

```javascript
// Hide the stock 'aurora' preset.
wp.hooks.addFilter(
    'desktop-mode.wallpapers',
    'my-plugin/hide-aurora',
    ( list ) => list.filter( ( w ) => w.id !== 'aurora' )
);
```

---

## Reference

- [Hooks catalog](../javascript-reference.md#4-hooks--desktop-mode) — every `desktop-mode.*` hook with its payload shape.
- [Wallpaper registration API](../javascript-reference.md#5-wallpaper-registration-api) — full `WallpaperDef` type.
