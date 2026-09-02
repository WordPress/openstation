# Pin your app to the phone tab bar, and react to the mode

*Experimental.* The phone layer's tab bar has three pinnable slots between Home and the app switcher. A user picks their own in OpenStation Preferences → Mobile; this is how a plugin shapes the default a user who never chose gets, and how it lays its own surfaces out per mode.

## PHP — the default pins

Ids are navigation ids, the same ones `navOrder` uses: an admin menu's hook name (`menu-posts`, `toplevel_page_woocommerce`) or a native window id. Only the first three survive; an id the site does not have is skipped by the shell, so a pin for a plugin that is not installed is harmless.

```php
add_filter( 'openstation_mobile_tab_bar', function ( $ids ) {
    // Orders first on a phone: put the shop before Posts.
    array_unshift( $ids, 'toplevel_page_woocommerce' );
    return $ids;
} );
```

## PHP — keep a role on the desktop

```php
add_filter( 'openstation_mode_preference', function ( $preference, $user_id ) {
    // The kiosk account always gets the desktop, whatever the screen.
    return user_can( $user_id, 'my_plugin_kiosk' ) ? 'desktop' : $preference;
}, 10, 2 );
```

The filter runs for the head stamp too, so the first paint already honours it.

## JavaScript — lay out per mode

`data-os-mode` on `<html>` is the CSS hook; `wp.os.mode` is the JS one.

```css
html[data-os-mode="mobile"] .my-plugin-panel {
    grid-template-columns: 1fr;
}
```

```js
wp.os.ready( () => {
    const paint = ( mode ) => {
        panel.classList.toggle( 'my-plugin-panel--stacked', mode === 'mobile' );
    };
    paint( wp.os.mode.get() );
    wp.os.mode.subscribe( ( { mode } ) => paint( mode ) );
} );
```

The same transition is on the hook bus as `os.mode.changed` and on `document` as `os-mode-changed`, each with `{ mode, previous, preference }`.

## JavaScript — keep a window out of the saved session

`os.session.snapshot` runs on every save, the phone layer's own edits included. Return the envelope, edited.

```js
wp.hooks.addFilter( 'os.session.snapshot', 'my-plugin/session', ( session ) => ( {
    ...session,
    windows: session.windows.filter( ( w ) => w.id !== 'my-plugin-scratchpad' ),
} ) );
```

See [mobile.md](../mobile.md) for the whole contract.
