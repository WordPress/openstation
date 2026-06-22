# Register a widget

Widgets are passive cards in the right-side column — or floating freely on
the desktop if `movable: true`. They are for glanceable, persistent content:
a clock, a comment queue, a stats chart. Not launchers, not interactive tools.

This recipe walks through the minimum viable widget and then covers the common
patterns (polling, storage, resize-aware canvas).

---

## Minimum viable widget

**PHP** — `includes/widgets/widget-hello.php`

```php
<?php
defined( 'ABSPATH' ) || exit;

function myplugin_register_hello_widget_assets() {
    $suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
    $version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

    $js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-hello' . $suffix . '.js';
    $css_path = DESKTOP_MODE_DIR . 'assets/js/widget-hello' . $suffix . '.css';

    // Register CSS — eagerly enqueued on shell pages below so the first
    // render is not unstyled.
    wp_register_style(
        'myplugin-hello-widget',
        plugin_dir_url( __FILE__ ) . 'assets/js/widget-hello' . $suffix . '.css',
        array(),
        file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
    );

    // Register JS — the shell's server-sync loads it lazily when the widget
    // mounts. Do NOT use wp_enqueue_script() here or it loads on every page.
    wp_register_script(
        'myplugin-hello-widget',
        plugin_dir_url( __FILE__ ) . 'assets/js/widget-hello' . $suffix . '.js',
        array(),
        file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
        true
    );
}
add_action( 'init', 'myplugin_register_hello_widget_assets', 5 );

function myplugin_enqueue_hello_widget_styles() {
    if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
        return;
    }
    if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
        return;
    }
    wp_enqueue_style( 'myplugin-hello-widget' );
}
add_action( 'admin_enqueue_scripts', 'myplugin_enqueue_hello_widget_styles', 20 );

function myplugin_register_hello_widget() {
    if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
        return;
    }
    desktop_mode_register_widget( 'myplugin/hello', array(
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

Require the file in `desktop-mode.php` after the other widget requires:

```php
require_once DESKTOP_MODE_DIR . 'includes/widgets/widget-hello.php';
```

---

**TypeScript** — `src/plugins/hello-widget/index.ts`

```ts
import './styles.css';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';

const WIDGET_ID = 'myplugin/hello';  // must match PHP registration id exactly

const mount = (
    container: HTMLElement,
    _ctx: WidgetContext,
): WidgetTeardown => {
    const p = document.createElement( 'p' );
    p.className = 'my-hello__text';
    p.textContent = 'Hello from my widget!';
    container.appendChild( p );

    // Return a teardown — always required even if there is nothing to clean up.
    return () => undefined;
};

const w = window as unknown as {
    desktopModeWidgets?: Record< string, typeof mount >;
};
w.desktopModeWidgets = w.desktopModeWidgets ?? {};
w.desktopModeWidgets[ WIDGET_ID ] = mount;
```

Add a Vite target in `vite.config.js` inside the `TARGETS` object:

```js
'widget-hello': {
    entry:    'src/plugins/hello-widget/index.ts',
    fileBase: 'widget-hello',
    iifeName: 'desktopModeHelloWidget',
},
```

Add a build script in `package.json`:

```json
"build:widget-hello": "DESKTOP_MODE_TARGET=widget-hello vite build --mode development && DESKTOP_MODE_TARGET=widget-hello vite build --mode production"
```

Then build:

```bash
npm run build:widget-hello
```

---

## Making REST API calls

Use `trackedFetch` from `../../tracked-fetch` — never raw `fetch()`. The
repo's ESLint config bans raw `fetch()` calls (`no-restricted-syntax` rule).
`trackedFetch` routes requests through the framework so they feed the loading
spinner and activity bus. It also injects the REST nonce automatically via
`injectRestNonce` — no manual `X-WP-Nonce` header needed.

Pass `silent: true` for background polls the user did not initiate.
Pass `source` so the devtools activity panel can attribute requests by name.

```ts
import { trackedFetch } from '../../tracked-fetch';

const root = ( window as unknown as { wpApiSettings?: { root?: string } } )
    .wpApiSettings?.root ?? '/wp-json/';

const res = await trackedFetch(
    root.replace( /\/$/, '' ) + '/wp/v2/posts?per_page=5&_fields=id,title',
    { credentials: 'same-origin' },
    { source: 'myplugin/hello', silent: true },
);
if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
const posts = await res.json();
```

---

## Polling with setInterval

Declare `destroyed` at the very top of `mount` and check it after every
`await`. The widget may be removed while a request is in flight.

```ts
const mount = async ( container, _ctx ): Promise< WidgetTeardown > => {
    let destroyed = false;  // declare first — check after every await

    const refresh = async () => {
        if ( destroyed ) return;
        const res = await trackedFetch( '...', {}, { silent: true } );
        if ( destroyed ) return;          // check after every await
        if ( ! res.ok ) return;
        const data = await res.json();
        if ( destroyed ) return;          // check after the second await too
        // update the DOM...
    };

    await refresh();
    const intervalId = setInterval( refresh, 60_000 );

    return () => {
        destroyed = true;
        clearInterval( intervalId );
    };
};
```

---

## Persisting user preferences

`ctx.storage` is a namespaced `localStorage` wrapper. Keys are scoped to
your widget id so two widgets can both use `'preferences'` without collision.
All methods are best-effort — quota exceeded or private browsing makes `set`
a silent no-op and `get` return `null`.

```ts
// Read — returns null when the key does not exist yet.
const count = ctx.storage.get< number >( 'count' ) ?? 0;

// Write
ctx.storage.set( 'count', count + 1 );

// Remove one key
ctx.storage.remove( 'count' );

// Clear all keys for this widget
ctx.storage.clear();
```

Values round-trip through `JSON.stringify` / `JSON.parse`. Plain objects,
arrays, and primitives work. Class instances, `Date`, and `Map` do not —
convert them first (`date.toISOString()`, `Array.from( map )`).

---

## Resize-aware canvas chart

Use `ResizeObserver` to trigger the initial draw and all redraws. Check
`entry.contentRect` is non-zero — the canvas may not have layout yet when
`mount` first runs. Do not use `setTimeout` as a workaround.

```ts
let ro: ResizeObserver | null = null;

const drawChart = ( canvas: HTMLCanvasElement ) => {
    const rect = canvas.getBoundingClientRect();
    if ( rect.width === 0 || rect.height === 0 ) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round( rect.width  * dpr );
    canvas.height = Math.round( rect.height * dpr );
    const ctx = canvas.getContext( '2d' );
    if ( ! ctx ) return;
    ctx.scale( dpr, dpr );
    // ... draw
};

ro = new ResizeObserver( ( entries ) => {
    if ( destroyed ) return;
    const entry = entries[ 0 ];
    if ( entry && entry.contentRect.width > 0 ) {
        drawChart( canvas );
    }
} );
ro.observe( canvas.parentElement! );

// In teardown:
return () => {
    destroyed = true;
    ro?.disconnect();
};
```

---

## Size constraints reference

All sizes are pixels, passed to `desktop_mode_register_widget()`:

| Arg | Effect |
|---|---|
| `min_width` | Smallest width the user can drag the card to |
| `min_height` | Smallest height the user can drag the card to |
| `max_width` | Optional ceiling on user-driven width resize |
| `max_height` | Optional ceiling on user-driven height resize |
| `default_width` | Starting width when first added as a floating widget |
| `default_height` | Starting height when first added as a floating widget |

`movable: true` lets the user drag the widget off the column.
`resizable: true` adds resize handles (`movable: true` gives all 8;
column-docked widgets only get a bottom-edge handle).

---

## Full reference implementation

See `src/plugins/starter-widget/index.ts` and
`includes/widgets/widget-starter.php` — a heavily commented skeleton covering
every pattern above in a single working widget.
