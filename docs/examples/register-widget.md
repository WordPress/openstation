# Register a widget

Widgets are passive cards in the right-side column — or floating freely on
the desktop if `movable: true`. They are for glanceable, persistent content:
a clock, a comment queue, a stats chart. Not launchers, not interactive tools.

---

## Recipe 1 — Minimum viable widget

The smallest complete example. A PHP file registers the widget metadata and
script handle; a TypeScript file declares the mount callback.

**my-plugin.php**

```php
<?php
/** Plugin Name: My Widget Plugin */
defined( 'ABSPATH' ) || exit;

function myplugin_register_hello_widget_assets() {
    $version = '1.0.0';

    // Register CSS eagerly — the JS loads lazily but the stylesheet needs to
    // be in the DOM before the first render to avoid a flash of unstyled content.
    wp_register_style(
        'myplugin-hello-widget',
        plugin_dir_url( __FILE__ ) . 'assets/js/widget-hello.min.css',
        array(),
        $version
    );

    // Register JS — do NOT enqueue it directly. The shell's server-sync
    // loads this bundle lazily when the widget picker opens or the widget
    // mounts. Using wp_enqueue_script() here would load it on every admin page.
    wp_register_script(
        'myplugin-hello-widget',
        plugin_dir_url( __FILE__ ) . 'assets/js/widget-hello.min.js',
        array(),
        $version,
        true
    );
}
add_action( 'init', 'myplugin_register_hello_widget_assets', 5 );

// Eagerly enqueue the CSS on OpenStation shell pages only.
function myplugin_enqueue_hello_widget_styles() {
    if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
        return;
    }
    if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
        return;
    }
    wp_enqueue_style( 'myplugin-hello-widget' );
}
add_action( 'admin_enqueue_scripts', 'myplugin_enqueue_hello_widget_styles', 20 );

// Announce the widget to OpenStation so it appears in the picker.
function myplugin_register_hello_widget() {
    if ( ! function_exists( 'openstation_register_widget' ) ) {
        return;
    }
    openstation_register_widget( 'myplugin/hello', array(
        'label'          => __( 'Hello Widget', 'myplugin' ),
        'description'    => __( 'A simple greeting.', 'myplugin' ),
        'icon'           => 'dashicons-smiley',
        'script'         => 'myplugin-hello-widget',
        'movable'        => true,
        'resizable'      => true,
        'min_width'      => 200,
        'min_height'     => 100,
        'default_width'  => 260,
        'default_height' => 140,
    ) );
}
add_action( 'init', 'myplugin_register_hello_widget', 6 );
```

**src/plugins/hello-widget/index.ts**

```ts
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

// Must match the id passed to openstation_register_widget() in PHP exactly.
// Do not rename this after users have the widget enabled — it is the
// localStorage key for their preference and renaming it resets everyone.
const WIDGET_ID = 'myplugin/hello';

const mount = (
    container: HTMLElement,
    _ctx: WidgetContext,
): WidgetTeardown => {
    const p = document.createElement( 'p' );
    p.className = 'my-hello__text';
    p.textContent = 'Hello from my widget!';
    container.appendChild( p );

    // Return a teardown — always required even with nothing to clean up.
    return () => undefined;
};

const w = window as unknown as {
    openStationWidgets?: Record< string, typeof mount >;
};
w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;
```

Add a Vite target in `vite.config.js` inside the `TARGETS` object:

```js
'widget-hello': {
    entry:    'src/plugins/hello-widget/index.ts',
    fileBase: 'widget-hello',
    iifeName: 'openStationHelloWidget',
},
```

Add a build script in `package.json`:

```json
"build:widget-hello": "OPENSTATION_TARGET=widget-hello vite build --mode development && OPENSTATION_TARGET=widget-hello vite build --mode production"
```

Then build:

```bash
npm run build:widget-hello
```

The widget appears in the picker immediately after the next page load.

---

## Recipe 2 — Polling with REST data

Fetches the latest post title on mount and refreshes every minute.

Always use `trackedFetch` from `../../tracked-fetch` — never raw `fetch()`.
The repo's ESLint config bans raw `fetch()` calls. `trackedFetch` routes
requests through the framework (loading spinner, activity bus) and injects
the REST nonce automatically — no manual `X-WP-Nonce` header needed.

```ts
import { trackedFetch } from '../../tracked-fetch';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const WIDGET_ID = 'myplugin/latest-post';

const mount = async (
    container: HTMLElement,
    _ctx: WidgetContext,
): Promise< WidgetTeardown > => {
    // Declare destroyed at the very top. Check it after every await —
    // the widget may be removed while a network request is in flight.
    let destroyed = false;

    const body = document.createElement( 'p' );
    body.textContent = 'Loading\u2026';
    container.appendChild( body );

    const root = ( window as unknown as { wpApiSettings?: { root?: string } } )
        .wpApiSettings?.root ?? '/wp-json/';

    const refresh = async () => {
        if ( destroyed ) return;
        try {
            const res = await trackedFetch(
                root.replace( /\/$/, '' ) + '/wp/v2/posts?per_page=1&_fields=title',
                { credentials: 'same-origin' },
                { source: 'myplugin/latest-post', silent: true },
            );
            if ( destroyed ) return;         // check after every await
            if ( ! res.ok ) return;
            const posts = await res.json() as Array< { title: { rendered: string } } >;
            if ( destroyed ) return;         // check after the second await too
            body.textContent = posts[ 0 ]?.title.rendered ?? 'No posts found.';
        } catch {
            if ( ! destroyed ) body.textContent = 'Could not load data.';
        }
    };

    await refresh();

    // Poll — but pause while the tab is hidden. Nobody sees the
    // repaint and the requests still hit the server, so stop the
    // timer on visibilitychange → hidden and restart on reveal,
    // catching up immediately only when the data has gone stale
    // (a quick tab flip shouldn't cost a request).
    const POLL_MS = 60_000;
    let intervalId: ReturnType< typeof setInterval > | null = null;
    let lastRunMs = Date.now();
    const poll = () => {
        lastRunMs = Date.now();
        void refresh();
    };
    const startPolling = () => {
        if ( intervalId === null ) intervalId = setInterval( poll, POLL_MS );
    };
    const stopPolling = () => {
        if ( intervalId !== null ) {
            clearInterval( intervalId );
            intervalId = null;
        }
    };
    const onVisibilityChange = () => {
        if ( document.hidden ) {
            stopPolling();
            return;
        }
        if ( Date.now() - lastRunMs >= POLL_MS ) poll();
        startPolling();
    };
    document.addEventListener( 'visibilitychange', onVisibilityChange );
    if ( ! document.hidden ) startPolling();

    return () => {
        destroyed = true;
        stopPolling();
        document.removeEventListener( 'visibilitychange', onVisibilityChange );
    };
};

const w = window as unknown as {
    openStationWidgets?: Record< string, typeof mount >;
};
w.openStationWidgets = w.openStationWidgets ?? {};
w.openStationWidgets[ WIDGET_ID ] = mount;
```

---

## Recipe 3 — Persisting user preferences

`ctx.storage` is a namespaced `localStorage` wrapper. Keys are scoped to
your widget id automatically so two widgets can both use `'preferences'`
without colliding.

```ts
const mount = async ( container: HTMLElement, ctx: WidgetContext ) => {
    // get() returns null when the key does not exist yet.
    // Always provide a fallback — storage may be unavailable
    // (private browsing, quota exceeded).
    const count = ctx.storage.get< number >( 'clicks' ) ?? 0;

    const btn = document.createElement( 'button' );
    btn.textContent = `Clicked ${ count } times`;

    btn.addEventListener( 'click', () => {
        const next = ( ctx.storage.get< number >( 'clicks' ) ?? 0 ) + 1;
        ctx.storage.set( 'clicks', next );
        btn.textContent = `Clicked ${ next } times`;
    } );

    container.appendChild( btn );
    return () => undefined;
};
```

Values round-trip through `JSON.stringify` / `JSON.parse`. Plain objects,
arrays, and primitives work. Class instances, `Date`, and `Map` do not —
convert them first (`date.toISOString()`, `Array.from( map )`).

---

## Recipe 4 — Resize-aware canvas chart

Use `ResizeObserver` to trigger the initial draw and all subsequent redraws.
Check `entry.contentRect` is non-zero before drawing — the canvas may not
have layout yet when `mount` first runs. Never use `setTimeout` as a
workaround for waiting on layout.

```ts
const mount = async ( container: HTMLElement, _ctx: WidgetContext ) => {
    let destroyed = false;
    let ro: ResizeObserver | null = null;

    const wrap = document.createElement( 'div' );
    wrap.style.cssText = 'flex:1; min-height:0;';
    const canvas = document.createElement( 'canvas' );
    canvas.style.cssText = 'display:block; width:100%; height:100%;';
    wrap.appendChild( canvas );
    container.appendChild( wrap );

    const draw = () => {
        const rect = canvas.getBoundingClientRect();
        if ( rect.width === 0 || rect.height === 0 ) return;  // not laid out yet
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.round( rect.width  * dpr );
        canvas.height = Math.round( rect.height * dpr );
        const ctx = canvas.getContext( '2d' );
        if ( ! ctx ) return;
        ctx.scale( dpr, dpr );
        // ... your drawing code here
    };

    // ResizeObserver fires as soon as the element has real layout dimensions.
    // This handles both the initial draw and any subsequent resizes.
    ro = new ResizeObserver( ( entries ) => {
        if ( destroyed ) return;
        const entry = entries[ 0 ];
        if ( entry && entry.contentRect.width > 0 ) draw();
    } );
    ro.observe( wrap );

    return () => {
        destroyed = true;
        ro?.disconnect();
    };
};
```

---

## Size constraints reference

All sizes are pixels, passed to `openstation_register_widget()`:

| Arg | Effect |
|---|---|
| `min_width` | Smallest width the user can drag the card to |
| `min_height` | Smallest height the user can drag the card to |
| `max_width` | Optional ceiling on user-driven resize |
| `max_height` | Optional ceiling on user-driven resize |
| `default_width` | Starting width when first added as a floating widget |
| `default_height` | Starting height when first added as a floating widget |

`movable: true` lets the user drag the widget off the column.
`resizable: true` adds resize handles — `movable: true` gives all 8 corner
and edge handles; column-docked widgets get a bottom-edge handle only.

---

## See also

- [Hooks reference — `openstation_register_widget()`](../hooks-reference.md) — full argument reference, error codes, and lifecycle actions.
- [JavaScript reference — `wp.os.registerWidget()`](../javascript-reference.md) — the client-side equivalent.
- [Starter widget source](../../src/plugins/starter-widget/index.ts) — a heavily commented skeleton covering every pattern above in a single working widget. It only appears in the add-widget picker when the current user has "Enable developer mode" turned on (OpenStation Preferences → Features) — regular users don't see it.
