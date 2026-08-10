# Native Desktop Host — *Experimental*

OpenStation is a web application, and stays one. This document
describes an **optional layer on top**: a small Electron app that loads
the same site and adds the one thing a browser tab genuinely cannot
provide — **real operating system windows**.

## The architectural principle

> Don't rebuild OpenStation as a desktop app. Build a reusable
> OpenStation core, and use Electron as a native desktop shell around
> it.

```
OpenStation core
├── Window Manager          ← untouched
├── App Registry            ← untouched
│
└── extensions
      └── Electron Adapter
            ├── IPC
            ├── Native windows
            ├── File system
            └── OS integration
```

Everything Electron-specific lives in
[`extensions/openstation-electron-adapter/`](../extensions/openstation-electron-adapter/README.md) —
a separate WordPress plugin plus the desktop app it talks to.
**Core mentions Electron nowhere.**

Two generic capabilities were added to core to make it possible, and
both stand on their own:

| Core capability | What it is | Who else can use it |
|---|---|---|
| [`wp.os.registerWindowAction()`](./javascript-reference.md#wposregisterwindowaction--experimental) | A registry for rows in every window's ⋯ menu | Any plugin with a per-window verb |
| [`?openstation_solo=<id>`](#solo-mode) | Boot the shell painting exactly one window | Embeds, kiosks, PWA shortcuts |

Deactivate the adapter and OpenStation is exactly the browser
experience it was.

## Setting a window free

With the desktop app running, every window's ⋯ menu grows one row:

- **Send to your Mac**
- **Send to your Windows PC**
- **Send to your Linux desktop**

Picking it takes the window out of the OpenStation desk and opens it as
a real window on the user's actual desktop — its own entry in the dock
or taskbar, its own Alt-Tab slot, its own place among their native
apps. Closing that native window brings it back into OpenStation.

The row toggles rather than duplicating: a window is either *here* or
*there*, never both, so a row that says what it will do right now
describes the situation honestly where two competing rows would imply
it could be both.

The OS name comes from the app, not from the user agent. A new platform
only needs the app updated.

### What "the same window" means

Two shapes, because OpenStation has two kinds of window:

| Window kind | What the native window loads |
|---|---|
| **Iframe windows** (any admin screen) | The exact chromeless URL the in-shell iframe was showing — same page, same session, same admin JS. |
| **Native windows** (Files, Games, plugin canvases) | The shell in **solo mode**, `?openstation_solo=<window-id>`. |

A native window has no URL: it is a render callback painting into the
shell's DOM. So solo mode boots the *whole shell* — every registry,
every render callback, every plugin integration — and paints exactly
one window and nothing else. It genuinely is the same window, in the
same framework, with the desk removed around it.

The decision of which shape applies lives in the adapter
(`extensions/openstation-electron-adapter/src/host.ts`), never in the
desktop app. The app takes a URL.

## Solo mode

`?openstation_solo=<window-id>` on any admin URL, for a user who has
OpenStation enabled. Adds the `os-solo` body class, loads
`assets/css/solo.css`, opens exactly that window, and suppresses
session restore.

It is a **rendering mode, not an access grant**: the flag is ignored
for a user who has not turned OpenStation on, and every capability
check on the underlying screen applies exactly as it would anywhere
else.

Core's `solo.css` hides the desk — wallpaper, dock, icon rail, widgets,
Mio, sticky notes — and fills the viewport with the one window. It
deliberately **keeps the window's title bar**, because a generic
embedder has no other chrome to offer: no frame, no close button, no
way to move the thing. An embedder that supplies its own chrome layers
a stylesheet on top and takes ours away there. That is exactly what the
Electron adapter does, gated on a body class it sets from JavaScript —
the server cannot know a solo request is being rendered inside the app,
only the page can see the injected global.

### PHP surface

```php
openstation_solo_window_id();   // '' unless this is a solo request
openstation_is_solo_request();
```

| Hook | Kind | Signature |
|---|---|---|
| `openstation_solo_window_id` | filter | `( string $id, string $raw )` — return `''` to refuse solo mode. |

Shell config gains one key: `soloWindow`, the window id or `''`.

## The adapter

Everything below ships in the **OpenStation — Electron Adapter**
plugin, not in core.

### Detection is one global

The desktop app injects, through an Electron `contextBridge` preload:

```js
window.openStationDesktopHost   // in the shell window
window.openStationDesktopFrame  // inside a freed window
```

**Presence of the object is the probe.** It is synchronous, needs no
network, and cannot go stale. Every host-dependent path is behind it,
which is what keeps the browser build unchanged.

The server deliberately does **not** answer "is a host attached right
now?" — the same user can have the site open in a browser tab at the
same moment, so a server-rendered boolean could only ever be wrong
somewhere.

### `wp.os.electron`

Published by the adapter when a host is present. Absent in a browser,
so **check before use**:

```js
if ( wp.os.electron?.isAvailable() ) {
    console.log( wp.os.electron.getSendLabel() );  // "Send to your Mac"
    await wp.os.electron.free( 'edit-php' );
}
```

| Method | Returns | Notes |
|---|---|---|
| `isAvailable()` | `boolean` | Always true when the namespace exists. |
| `getInfo()` | `HostInfo \| null` | Platform, app version, host id, currently-freed ids. |
| `getSendLabel()` | `string` | Translated, OS-adapted. |
| `getDockLabel()` | `string` | "Bring back into OpenStation". |
| `isFreedWindow()` | `boolean` | Whether *this page* is itself a freed window. |
| `free( windowId )` | `Promise<boolean>` | Set a window free. Focuses it if already free. |
| `dock( windowId )` | `Promise<boolean>` | Bring a freed window back. |
| `listFreed()` | `string[]` | Ids currently out on the desktop. |
| `isFreed( windowId )` | `boolean` | Whether one specific window is out there. |
| `getConnection()` | `ConnectionState` | Last liveness-pulse snapshot. |

### CustomEvents on `document`

| Event | `detail` | Fires when |
|---|---|---|
| `os-desktop-host-freed` | `{ windowId }` | A window went out to the real desktop. |
| `os-desktop-host-docked` | `{ windowId }` | A freed window came back. |
| `os-desktop-host-connection` | `ConnectionState` | The connection changed phase. |

Both transitions fire regardless of *who* initiated them — the ⋯ menu,
a programmatic `free()`, or the user closing the native window. "Freed"
is one fact with two writers.

### The rule that makes it feel real

Anything that would surface a freed window inside the shell — a dock
click, the window switcher, a plugin calling `openWindow()` — **raises
the native window instead**. Without that, clicking Posts in the dock
while Posts is out on the desktop would restore a second copy inside
the shell, and the user would have two Posts windows that know nothing
about each other.

It is enforced on the framework's own window lifecycle hooks
(`WINDOW_FOCUSED`, `WINDOW_RESTORED`), so plugin authors get it for
free and never need to check `isFreed()` before opening a window.

## Liveness: the app tells the site it is alive

The app registers itself over REST and beats a slow pulse. That record
is what lets *other* requests — a plugin rendering an admin screen, a
notification decision — know a desktop is attached, which one
JavaScript page cannot answer for anyone but itself.

**Every beat is a real PHP request, and OpenStation runs on cheap
shared hosting.** Four choices keep the cost near zero:

1. **The server picks the interval.** Every handshake and heartbeat
   response carries `heartbeatInterval`. A constrained host widens it
   with a PHP filter and the change takes effect within one beat — no
   app update.
2. **One user-meta row.** No custom table, no autoloaded option, no
   post type. A beat touches a row already in the object cache.
3. **Idle costs less.** The app skips beats while no window has been
   focused and nothing is freed onto the desktop.
4. **Failure backs off.** Consecutive errors widen the interval
   geometrically, so a site that went down is not hammered by every
   desktop that had it open.

Expiry is evaluated at read time. A stale record simply reads as
disconnected; nothing is scheduled to clean it up.

### REST routes

All under `openstation-electron/v1` — the adapter's own namespace, not
core's — and all gated on logged-in **and** OpenStation enabled.

| Route | Method | Purpose |
|---|---|---|
| `/host` | `GET` | Current record + the interval a host should use. |
| `/host` | `DELETE` | Detach. |
| `/host/handshake` | `POST` | Register. Body: `hostId`, `platform`, `appVersion`, `protocol`. |
| `/host/heartbeat` | `POST` | Liveness beat. Body: `hostId`. |
| `/host/disconnect` | `POST` | Same as `DELETE`; used by the app's quit path. |

A handshake declaring a **higher** protocol than the server understands
is refused with `400` rather than half-accepted. The app degrades to
"no server record" and every client-side feature keeps working.

### Adapter hooks

| Hook | Kind | Signature |
|---|---|---|
| `openstation_electron_enabled` | filter | `( bool $enabled, int $user_id )` |
| `openstation_electron_heartbeat_interval` | filter | `( int $seconds )` — default `120`, floored at `30`. |
| `openstation_electron_ttl` | filter | `( int $seconds )` — default `600`, never below two intervals. |
| `openstation_electron_config` | filter | `( array $config, int $user_id )` |
| `openstation_electron_host_connected` | action | `( array $record, int $user_id )` |
| `openstation_electron_host_heartbeat` | action | `( array $record, int $user_id )` — fires on every beat; keep listeners cheap. |
| `openstation_electron_host_disconnected` | action | `( array $record, int $user_id )` |

Restrict the native host to editors and up:

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

Halve the request cost on constrained hosting:

```php
add_filter( 'openstation_electron_heartbeat_interval', fn() => 300 );
```

### Adapter PHP helpers

```php
openstation_electron_get_host( $user_id );   // `connected` already accounts for expiry
openstation_electron_set_host( $user_id, $args );
openstation_electron_clear_host( $user_id );
openstation_electron_enabled( $user_id );
openstation_electron_interval();             // seconds
openstation_electron_ttl();                  // seconds
```

## Running it

The adapter lives inside the OpenStation plugin directory, and
WordPress does not look for plugins in nested folders — so it needs a
symlink into `wp-content/plugins/`, exactly like every other extension
in this repo:

```bash
cd /path/to/wp-content/plugins
ln -sfn desktop-mode/extensions/openstation-electron-adapter openstation-electron-adapter
wp plugin activate openstation-electron-adapter
```

Skip that and everything still *works* — the app connects, the desktop
loads — but no ⋯ menu row appears, because the shell adapter that
registers it was never enqueued. It is the first thing to check when
"Send to your Mac" is missing.

Then:

```bash
cd extensions/openstation-electron-adapter
npm install
npm start
```

First run asks for a site address; after that it opens straight into
the desktop. See the
[adapter's README](../extensions/openstation-electron-adapter/README.md)
for the IPC contract, the build layout, and packaging.

## Status

**Experimental.** The `wp.os.electron` shape, the REST routes, and the
solo-mode flag may still move. The capability-probe model — a global
whose absence means "browser, behave normally" — will not, and neither
will the rule that core stays free of Electron.
