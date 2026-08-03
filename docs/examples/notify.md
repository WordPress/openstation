# Send a notification

Stable.

`wp.os.notify( opts )` is the one call you need. v1 ships local
notifications (browser `Notification` API on the current page) with a
toast fallback when permission is denied or unsupported. The same
shape will route through Web Push in v2 — your plugin code won't
change.

## The minimum

```js
wp.os.notify( { title: 'Backup complete' } );
```

That's it. No permission dance, no prompt-then-call branching: the
first `notify()` call requests permission lazily; if the user declines,
the framework falls back to a toast.

## With body, icon, click handler

```js
wp.os.notify( {
    title: 'New comment on “Hello World”',
    body: 'Anna: I have a question…',
    icon: '/wp-content/uploads/2025/avatar-anna.png',
    tag: 'comments/47',
    requireInteraction: false,
    onClick: ( notification ) => {
        window.focus();
        notification.close();
        wp.os.openWindow( 'desktop-mode-comments' );
    },
} );
```

The `tag` collapses repeat notifications — if a second comment lands on
the same post, the new notification *replaces* the old one rather than
stacking. Use it for unread-count alerts.

## Eager permission request

For a UX where the user explicitly toggles "Enable notifications" in
settings, prompt up front rather than during a real notification:

```js
const result = await wp.os.pwa.requestNotificationPermission();
//   'granted' | 'denied' | 'default' | 'unsupported'

if ( result === 'granted' ) {
    wp.os.showToast( { message: 'Notifications enabled.' } );
} else if ( result === 'denied' ) {
    wp.os.showToast( {
        message: 'Notifications blocked. You can re-enable them in your browser settings.',
    } );
}
```

Synchronous read of the current state:

```js
const perm = wp.os.pwa.getNotificationPermission();
//   'granted' | 'denied' | 'default' | 'unsupported'
```

## Audit / mute notifications globally

A "Do not disturb" plugin can subscribe to the activity bus and either
filter the notification *intent* (cancel before render) or just observe
that one was shown:

```js
wp.hooks.addFilter(
    'os.activity.desktop-mode.notification-requested',
    'my-plugin/dnd',
    ( intent ) => {
        if ( isDoNotDisturbActive() ) {
            return { ...intent, cancel: true };
        }
        return intent;
    },
);

wp.os.activity.subscribe(
    'desktop-mode/notification-shown',
    ( payload ) => {
        // payload.fallback === 'toast' means permission was denied
        // and the user only saw the in-shell toast version.
        analytics.track( 'notification.shown', payload );
    },
);
```

Note the asymmetry: filter *registration* goes through
`wp.hooks.addFilter` on the `os.activity.<channel>` hook
name, writing the channel's separator as a period.
`wp.os.activity.filter( channel, value )` is the
publisher-side *apply* call — it runs the registered filters against
`value` and returns the result; passing it a callback registers
nothing.

## Dismiss programmatically

`notify()` returns a dismiss function. Useful when the state your
notification reflects changes before the user dismisses it:

```js
const dismiss = wp.os.notify( {
    title: 'Connecting…',
    requireInteraction: true,
} );

connection.once( 'ready', () => dismiss() );
connection.once( 'error', () => {
    dismiss();
    wp.os.notify( { title: 'Connection failed' } );
} );
```

## Caveats

- Local notifications only fire while the page is open. Phase 4 will
  route the same `notify()` call through the service worker so a
  notification can fire from a closed tab.
- Safari (macOS / iOS) requires a user gesture for the first
  `Notification` constructor call. The framework catches the gesture
  exception and falls back to a toast — so your code never has to
  branch on browser.
- `Notification.permission === 'default'` (never asked) lazy-requests
  on first `notify()`. If you don't want that, call
  `requestNotificationPermission()` first and act on the result.
