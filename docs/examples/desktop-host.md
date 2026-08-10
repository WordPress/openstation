# React to a window being set free onto the real desktop

*Experimental — see [Native Desktop Host](../desktop-host.md).*

When the user is running the OpenStation Desktop app, every window's ⋯
menu offers **"Send to your Mac"**. Picking it takes the window out of
the OpenStation desk and gives it to the real one.

Your plugin might care: a window whose content polls could stand down
while the shell is not the thing showing it, an analytics integration
might want to record it, a companion widget might want to show where
things went.

## Check for the namespace, not for a host

`wp.os.electron` is published by the **Electron Adapter extension** and
is simply absent in a browser — there is no always-present stub to
branch on. So:

```js
wp.os.ready( () => {
    const electron = wp.os.electron;
    if ( ! electron?.isAvailable() ) {
        return; // Plain browser, or the adapter is not installed.
    }

    const info = electron.getInfo();
    console.log( `Hosted by OpenStation Desktop ${ info.appVersion } on ${ info.osLabel }` );
} );
```

## Listen for the transitions

```js
document.addEventListener( 'os-desktop-host-freed', ( event ) => {
    if ( 'my-plugin-dashboard' === event.detail.windowId ) {
        // It is out on the real desktop now — its content is live in a
        // native window, so anything the shell was doing on its behalf
        // (a badge poller, a preview refresh) can stand down.
        stopPolling();
    }
} );

document.addEventListener( 'os-desktop-host-docked', ( event ) => {
    if ( 'my-plugin-dashboard' === event.detail.windowId ) {
        startPolling();
    }
} );
```

Both fire regardless of *who* initiated the change — the ⋯ menu, your
own call to `free()`, or the user simply closing the native window.
That is deliberate: "freed" is one fact with two writers, and both land
on the same event.

## Free a window yourself

An "Open in its own window" button in your plugin's UI:

```js
async function popOut( windowId ) {
    const electron = wp.os.electron;
    if ( ! electron?.isAvailable() ) {
        // No native host. Fall back to the browser affordance the ⋯
        // menu already offers: open the page in a normal browser tab.
        wp.os.windowManager.getById( windowId )?.detach();
        return;
    }
    if ( electron.isFreed( windowId ) ) {
        return; // Already out there — free() would just focus it.
    }
    await electron.free( windowId );
}
```

## Label your own affordance the way the ⋯ menu does

Do not hard-code "Mac". The app reports its own OS name, and a platform
added to the app should not need your plugin republished:

```js
button.textContent = wp.os.electron.getSendLabel();  // "Send to your Windows PC"
```

## Know when you are *inside* a freed window

A freed window loads either the chromeless admin page or the shell in
solo mode. Either way, code running there can tell:

```js
if ( wp.os.electron?.isFreedWindow() ) {
    // This page IS a native window. It has an OS frame, so hide any
    // "open in new window" affordance of your own — it is already one.
    myPopOutButton.hidden = true;
}
```

## Gate the whole feature server-side

Restrict native hosts to editors and above:

```php
add_filter(
    'openstation_electron_enabled',
    function ( $enabled, $user_id ) {
        return user_can( $user_id, 'edit_others_posts' );
    },
    10,
    2
);
```

Or widen the liveness pulse on constrained hosting — the app re-reads
the interval from every response, so this lands within one beat with no
client update:

```php
add_filter( 'openstation_electron_heartbeat_interval', fn() => 300 );
```

## What you get for free

Anything that would surface a freed window inside the shell — a dock
click, the window switcher, your own `wp.os.openWindow()` call — raises
the **native window** instead. You never need to check `isFreed()`
before opening a window; the adapter enforces it on the framework's own
lifecycle hooks.
