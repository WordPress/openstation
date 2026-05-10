# Plugins window — extras

Recipes for plugin authors that want to extend the native Plugins window. Every PHP hook listed below is documented in [`docs/hooks-reference.md`](../hooks-reference.md#native-plugins-window-since-090); JS-side surface lives in [`docs/javascript-reference.md`](../javascript-reference.md#native-plugins-window-since-090).

---

## 1. Sponsor a custom Browse filter

Add a "Curated" tab to the Browse segmented filter that calls `plugins_api( 'query_plugins' )` with a fixed wp.org tag.

```php
<?php
add_filter(
    'desktop_mode_plugins_window_browse_args',
    static function ( array $api_args, array $raw ): array {
        if ( 'curated' !== ( $raw['browse'] ?? '' ) ) {
            return $api_args;
        }
        // Override the upstream call with our pinned tag.
        unset( $api_args['browse'] );
        $api_args['tag'] = 'gutenberg-block';
        return $api_args;
    },
    10,
    2
);
```

JS side, push the new segment into the toolbar before the bundle paints:

```js
addFilter(
    'desktop_mode.pluginsWindow.browseFilters',
    'my-plugin/curated',
    ( filters ) => [
        ...filters,
        { value: 'curated', label: __( 'Curated', 'my-plugin' ) },
    ]
);
```

> Until the JS filter registry lands, you can also subclass the segmented control or layer your own segment via the `desktop_mode_plugins_window_template_html` filter.

---

## 2. Override the wp.org icon URL for premium plugins

Premium plugins aren't on the .org repo, so the default icon resolver returns `null` (the JS card paints a placeholder). If your plugin ships a known asset URL on your CDN, return it via the `desktop_mode_plugins_window_icon_url` filter:

```php
<?php
add_filter(
    'desktop_mode_plugins_window_icon_url',
    static function ( $url, string $slug, array $row ) {
        if ( 'my-premium-plugin' === $slug ) {
            return 'https://cdn.example.com/icons/my-premium-plugin@2x.png';
        }
        return $url;
    },
    10,
    3
);
```

Returning `null` suppresses the icon entirely (forces the placeholder).

---

## 3. Swap the wp.org reviews scraper

The default reviews handler hits `https://wordpress.org/plugins/{slug}/#reviews` and parses the HTML with `DOMDocument`. wp.org HTML can change, so the result is best-effort and falls back to a histogram-only view on parse failure.

If you maintain a more robust parser (or have access to a private reviews API), short-circuit the default by returning an array of items:

```php
<?php
add_filter(
    'desktop_mode_plugins_window_review_parser',
    static function ( $items, string $slug ) {
        if ( null !== $items ) {
            return $items; // Already overridden upstream.
        }
        $cached = get_transient( 'my_plugin_reviews_' . $slug );
        if ( is_array( $cached ) ) {
            return $cached;
        }

        // …call your own reviews API…
        $rows = my_plugin_fetch_reviews( $slug );

        return array_map(
            static fn( $r ) => array(
                'author'  => (string) $r->author,
                'stars'   => (int) $r->stars,        // 1–5
                'excerpt' => (string) $r->excerpt,
                'date'    => (string) $r->date,      // free-form, e.g. "August 2026"
                'url'     => (string) $r->permalink,
            ),
            $rows
        );
    },
    10,
    2
);
```

Return `null` to fall through to the default DOMDocument parser.

---

## 4. React to a successful .zip upload

Hook the `desktop_mode_plugins_window_installed` action to seed defaults when a new plugin lands via the upload route:

```php
<?php
add_action(
    'desktop_mode_plugins_window_installed',
    static function ( string $plugin_file ): void {
        // $plugin_file is e.g. "akismet/akismet.php"
        if ( 'my-plugin/my-plugin.php' === $plugin_file ) {
            update_option( 'my_plugin_first_install_at', time() );
        }
    }
);
```

This action only fires for the `wp_ajax_desktop_mode_plugins_upload` route. Installs that go through Core's `wp_ajax_install_plugin` (the slug-based path) trigger Core's own `upgrader_process_complete` action — wire to that for cross-source coverage.

---

## 5. Land on the Browse tab when opening the window from your own UI

The bundle reads an initial-tab hint from a shared store. Set it BEFORE `openById( 'desktop-mode-plugins' )`:

```ts
import { setPluginsWindowTab } from 'desktop-mode/plugins-window/tab-target';

const myButton = document.querySelector( '#explore-plugins' )!;
myButton.addEventListener( 'click', () => {
    setPluginsWindowTab( 'browse' );
    window.wp.desktop.openWindow( { id: 'desktop-mode-plugins' } );
} );
```

Backed by `wp.desktop.createSharedStore` so multiple bundles read the same value. The hint is consumed (cleared) on first read by the render callback, so a subsequent open without an explicit hint defaults back to "installed".

---

## 6. Accept dragged plugin cards as a drop target on your own canvas

Cards in the Browse gallery emit a `wporg-plugin` payload via the framework drag bridge. Register your own drop target so plugin authors can drag a card into your custom canvas:

```ts
window.wp.desktop.dragManager.registerDropTarget( {
    id: 'my-plugin/canvas',
    element: document.querySelector( '#my-canvas' )!,
    accept: ( payload ) => payload.type === 'wporg-plugin',
    onEnter: ( session ) => {
        document.querySelector( '#my-canvas' )!
            .classList.add( 'is-drop-target' );
    },
    onLeave: () => {
        document.querySelector( '#my-canvas' )!
            .classList.remove( 'is-drop-target' );
    },
    onDrop: ( session, ev ) => {
        const { slug, name, iconUrl } = session.payload.data as {
            slug:    string;
            name:    string;
            iconUrl: string | null;
        };
        // …attach the plugin to your canvas at (ev.clientX, ev.clientY)…
    },
} );
```

The framework's drag bridge handles the ghost element + hit-testing for you; the payload type is the contract — anything matching `'wporg-plugin'` is a card from this window.
