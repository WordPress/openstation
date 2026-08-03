# Window slots

The title bar is composed of named **slots** — regions plugins can replace, augment, or empty per-window. This is **Layer 3** of the four-layer window-chrome customization framework. See [Window themes](./window-theme.md) for Layer 1 and [Window controls](./window-controls.md) for Layer 2.

The slot host elements live inside the title bar with `data-slot="<name>"` attributes; CSS targets them via `.os-window__slot--<name>`.

## Available slots

```
[ before-titlebar ]   ← above the title bar (banners, status strips)

[ before-icon ][ icon ][ title ][ after-title ]
                    … screen-meta + custom buttons + menu …
[ before-controls ][ controls* ][ after-controls ]

[ after-titlebar ]    ← below the title bar (progress bars, contextual rows)
```

`controls*` is owned by Layer 2 (`registerWindowControl`); the slot painter does not touch it. Use the [Window controls](./window-controls.md) APIs for that cluster.

`before-titlebar` and `after-titlebar` render OUTSIDE the title-bar flex row — perfect for full-width banners that shouldn't compete with sibling slots for horizontal space.

---

## Recipe 1 — Replace the icon with custom HTML

```js
wp.os.applyWindowSlot( 'edit-post', 'icon', {
    html: '🎨',
} );
```

`html` is sandboxed via `textContent` — markup is rendered as text, not parsed. For rich content register a `render` callback instead.

## Recipe 2 — Add a status banner above the title bar

```js
wp.os.applyWindowSlot( 'my-plugin/sync', 'before-titlebar', {
    render: ( host ) => {
        host.style.background = 'linear-gradient(90deg, #38bdf8, #818cf8)';
        host.style.color = '#fff';
        host.style.padding = '4px 12px';
        host.textContent = '⏳ Syncing 14 items…';

        // Optional: return a teardown the framework calls on re-paint / close.
        const t = setInterval( () => host.textContent = `⏳ ${ Date.now() }`, 1000 );
        return () => clearInterval( t );
    },
} );
```

## Recipe 3 — Hide the title text

```js
wp.os.applyWindowSlot( 'my-plugin/dashboard', 'title', null );
```

`null` empties the slot AND suppresses any matching global slot renderers — explicit "render nothing".

## Recipe 4 — Cross-window slot decorator

When the same slot decoration should apply to many windows, register globally with a `match` predicate:

**plugin.php**

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-decorator',
        plugins_url( 'decorator.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0', true
    );
    wp_enqueue_script( 'my-decorator' );
} );
open_station_register_window_slot_script( 'my-decorator' );
```

**decorator.js**

```js
wp.os.whenReady( () => {
    wp.os.registerWindowSlot( {
        id:    'my-decorator/title-star',
        slot:  'title',
        replace: false, // append, don't wipe the default title
        match: ( win ) => win.config.url?.includes( 'post.php' ) ?? false,
        owner: 'my-decorator', // for live unregister on deactivation
        render: ( host ) => {
            const star = document.createElement( 'span' );
            star.textContent = ' ★';
            star.title = 'Editing a post';
            host.appendChild( star );
            return () => star.remove();
        },
    } );
} );
```

`replace: false` means "append my content after whatever's already in the slot." Plugins that want to fully replace the slot (default content + earlier renderers) leave `replace` unset (defaults to `true`) and the framework clears the host before invoking their render.

## Recipe 5 — Per-window slots at registration time

Native windows can declare slot overrides inline:

```js
wp.os.registerWindow( {
    id:     'my-plugin/dashboard',
    title:  'Dashboard',
    icon:   'dashicons-dashboard',
    width:  800, height: 500,
    minWidth: 320, minHeight: 200,
    appearance: {
        slots: {
            'before-titlebar': {
                html: 'BETA',
            },
            'after-titlebar': {
                render: ( host ) => {
                    const bar = document.createElement( 'div' );
                    bar.style.height = '2px';
                    bar.style.background = '#22c55e';
                    host.appendChild( bar );
                },
            },
        },
    },
    render: ( body ) => { body.textContent = 'Hello'; },
} );
```

---

## Hooks

### PHP

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `open_station_window_slot_script_registered` | action | `( string $handle )` | Fires after `open_station_register_window_slot_script()` succeeds. |
| `open_station_window_slot_registered` | action | `( string $id, array $entry )` | Fires after `open_station_register_window_slot()` stores metadata. |

### JavaScript

| Hook | Type | Signature | Purpose |
|------|------|-----------|---------|
| `os.window.chrome.slot` | filter | `( host, { windowId, slot, config } ) => host` | Mutate a slot's host element after content settles. Stable. |
| `os.window.chrome.applied` | action | `( { windowId, layer } )` | Fires with `layer: 'slots'` after a paint. Stable. |

---

## API surface

| Function | Purpose |
|----------|---------|
| `wp.os.registerWindowSlot( def )` | Register a global slot renderer. Throws on validation failure. |
| `wp.os.unregisterWindowSlot( id )` | Drop by id. |
| `wp.os.listWindowSlots()` | Snapshot of registered renderers. |
| `wp.os.applyWindowSlot( windowId, slot, config )` | Per-window override at runtime. Pass `undefined` for `config` to clear. |
| `WindowConfig.appearance.slots` | Per-window declaration at registration time. |
