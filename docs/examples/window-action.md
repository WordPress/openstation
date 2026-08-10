# Add a row to a window's ⋯ menu

*Experimental — see
[`javascript-reference.md`](../javascript-reference.md#wposregisterwindowaction--experimental).*

The ⋯ menu in every window's title bar is where infrequent, wordy,
per-window verbs live — "Open in browser tab", "Open on startup",
"Reload". `wp.os.registerWindowAction()` lets your plugin put a row
there too.

Reach for a **title-bar button** (`registerTitleBarButton`) instead when
the user will want it constantly. The menu is for the things that would
be clutter as a permanent icon.

## The minimum

```js
wp.os.ready( () => {
    wp.os.registerWindowAction( {
        id: 'my-plugin/copy-link',
        label: 'Copy link to this screen',
        icon: 'dashicons-admin-links',
        onSelect: ( win ) => {
            navigator.clipboard.writeText( win.getCurrentUrl() );
            wp.os.showToast( { message: 'Link copied' } );
        },
        owner: 'my-plugin-shell',
    } );
} );
```

`owner` is the WordPress script handle. Set it and the row disappears
by itself when your plugin is deactivated, with no reload.

## One row that expresses a toggle

`label`, `icon` and `isVisible` may each be a **function of the window**,
and they are re-read every time the menu opens. That is what lets a
single row say what it will actually do right now:

```js
wp.os.registerWindowAction( {
    id: 'my-plugin/pin',
    label: ( win ) => ( isPinned( win.id ) ? 'Unpin from top' : 'Pin to top' ),
    icon: ( win ) => ( isPinned( win.id ) ? 'dashicons-unlock' : 'dashicons-sticky' ),
    onSelect: ( win ) => togglePin( win.id ),
    owner: 'my-plugin-shell',
} );
```

Two rows — "Pin" and "Unpin" — would imply a window could be both at
once. One row that answers "what does this do?" describes the situation
honestly. This is exactly how the Electron Adapter's "Send to your Mac"
row becomes "Bring back into OpenStation".

## Showing the row only where it applies

```js
wp.os.registerWindowAction( {
    id: 'my-plugin/lint-page',
    label: 'Check this page for issues',
    icon: 'dashicons-search',
    // Iframe windows only — a native window has no admin page to check.
    isVisible: ( win ) => ! win.config.native,
    onSelect: ( win ) => runLinter( win.getCurrentUrl() ),
    owner: 'my-plugin-shell',
} );
```

`isVisible` is re-read per open, so a row can appear and disappear with
whatever it depends on — a capability, a connection, the page the window
has navigated to — without your plugin re-registering anything.

## Ordering

`order` sorts your row against other plugins' rows; the built-in items
always come first. Default is `100`.

```js
order: 60,   // earlier than most
```

## What the framework guarantees

- **The menu closes before `onSelect` runs**, so a handler that opens a
  dialog or navigates is not competing with a still-painted popover.
- **A throwing resolver or handler is contained.** A row whose `label`
  or `isVisible` throws simply does not appear; a handler that throws is
  logged. The ⋯ menu is shared surface — one plugin's bug must not cost
  the user their "Reload".
- **Registration is validated loudly.** A bad `id`, a missing
  `onSelect`, a non-function `isVisible` throws a `RegistrationError`
  naming the field, at registration time, rather than silently painting
  nothing.

## Deciding when the menu opens

`isVisible` is re-read per open, but it is synchronous — it cannot go
and ask something. `HOOKS.WINDOW_MENU_OPENED` can:

```js
wp.os.hooks.addAction( wp.os.HOOKS.WINDOW_MENU_OPENED, 'my-plugin/probe', () => {
    void isCompanionAppRunning().then( ( running ) => {
        if ( running ) {
            wp.os.registerWindowAction( { /* … */ } );
        }
    } );
} );
```

**An open menu repaints when the registry changes**, so a row
registered from that callback appears under the user's pointer rather
than on their next click. This is how the Electron adapter notices an
app that started after the page loaded — no refresh needed.

## Removing it

```js
wp.os.unregisterWindowAction( 'my-plugin/pin' );
```

And to see what is registered:

```js
wp.os.listWindowActions();   // sorted by `order`
```

## Going away cleanly when your plugin is deactivated

Registering from JS is enough to get the row on screen. To have it
*leave* on deactivation — without the user reloading the page — declare
your script server-side and tag each action with the same handle:

```php
add_action( 'admin_enqueue_scripts', function () {
    wp_register_script(
        'my-plugin-window-actions',
        plugins_url( 'js/window-actions.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );
    wp_enqueue_script( 'my-plugin-window-actions' );
} );
openstation_register_window_action_script( 'my-plugin-window-actions' );
```

```js
wp.os.registerWindowAction( {
    id: 'my-plugin/pin',
    label: 'Pin to top',
    onSelect: ( win ) => pin( win.id ),
    owner: 'my-plugin-window-actions',   // same handle
} );
```

Now the handle rides in the live-refresh payload the shell diffs:
activating your plugin loads the script and the row appears in the next
menu that opens, and deactivating it sweeps out every action carrying
that `owner`.

Skip the PHP call and `owner` has nothing to match against — the row
stays until the next page reload. Harmless, and the reason a plugin
written before this existed still behaves.
