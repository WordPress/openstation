# Progressive Web App (PWA)

Stable.

OpenStation ships a **web app manifest**, a **service worker**, and a
**local notifications API** so users can install their WordPress site as
a real OS app and plugins can surface alerts the same way native apps
do.

This page is the architectural ground-truth. For the plugin-author's
copy-paste recipes see
[`docs/examples/pwa-install.md`](./examples/pwa-install.md) and
[`docs/examples/notify.md`](./examples/notify.md).

## What ships out of the box

| Surface | Behaviour |
|---|---|
| **Web app manifest** | Served at `/openstation/manifest.webmanifest`. Site name + short name, theme color, icons (Site Icon when set, plugin logo otherwise), `start_url=/wp-admin/index.php?desktop_mode_portal=1`, `scope=/wp-admin/` (narrowed from `/` so front-end links escape the PWA window; the manifest `id` stays at `/openstation/` so existing installs aren't reset). Filterable via `openstation_pwa_manifest`. |
| **Service worker** | Served at `/openstation/sw.js` with `Service-Worker-Allowed: /`. Registered at root scope with a deliberately narrow fetch handler — it only intercepts paths under `/openstation/` and `/wp-admin/`, plus the plugin's own static assets. wp-admin HTML is **always** network-first (nonces would otherwise drift). |
| **Install hint** | A system tile on the dock (`id: 'os-pwa-install'`) registered on shell boot — except when the shell is already running standalone. It is removed live when display-mode flips to standalone or when `getInstalledRelatedApps()` reports the app installed (Chromium); on Safari / Firefox it persists as a fallback. Clicking it dispatches the browser install prompt when the site is currently installable, otherwise shows a contextual toast ("already installed", "not yet"). |
| **Local notifications** | `wp.os.notify({ title, body, icon, tag, onClick })` — uses the browser `Notification` API, falls back to a toast when permission is denied or the browser doesn't support it. |
| **Push notifications** | **Not in v1.** The SW registers a no-op `push` handler (claimed so future v2 push payloads aren't silently dropped); the `notificationclick` handler is live — it closes the notification, focuses an existing `/openstation/` window client, or opens `notification.data.url` (default `/openstation/`) when none exists. The same `wp.os.notify` shape will route through the SW's `showNotification` once push is wired. |

## Why root scope (with a narrow fetch handler)

A service worker has exactly one scope path. The only common ancestor of
`/openstation/` and `/wp-admin/` is `/`. Registering at `/openstation/`
would cut the SW off from admin-page navigations — defeating the purpose
for the typical install target (a dashboard URL inside wp-admin).

So the SW registers at root scope, but the fetch handler returns early
(no `event.respondWith` call) for any URL outside `/openstation/`,
`/wp-admin/`, or the plugin's own assets directory. Behaviorally this is
"narrow scope" without inheriting the technical limitation.

If any other service worker (any scope) is already registered on the
origin, the registration **bails** with a console warning rather than
usurping it. The "Install \<site\> as an app" tile then surfaces a
focused toast pointing at the opt-in filter (rather than the generic
"not available" fallback), so users on affected sites see the
actionable message instead of silently broken behaviour.

To opt this install in, return `true` from the
`openstation_pwa_force_replace_sw` filter:

```php
add_filter( 'openstation_pwa_force_replace_sw', '__return_true' );
```

The filter resolves at shell-config build time; effective on the next
page load. Use this when another PWA plugin's SW is shadowing
OpenStation and you want OpenStation to take over the install path.

## Caching policy

| Pattern | Strategy | Why |
|---|---|---|
| `/wp-content/plugins/desktop-mode/assets/**.{css,png,jpg,svg,…}` | Stale-while-revalidate (runtime cache) | Returning users open the shell instantly; the SW updates the cache in the background. |
| `/wp-content/plugins/desktop-mode/assets/**.js` | Network-first with `cache: 'reload'` + cache fallback | JS bundles change per deploy — a fresh deploy reaches online users on the next load, with no stale-revalidate window where a freshly-pushed fix is invisible. The cache still serves offline users. |
| Navigation requests under our scope | Network-first with offline fallback | wp-admin HTML carries nonces and per-request screen state; caching it would desynchronise the user. The fallback is a tiny inline placeholder so an offline user sees something coherent. |
| REST / AJAX / non-asset GETs | Pass-through (no SW handling) | Same reason as navigation — auth-bound dynamic content must hit the network. |
| `install`-time precache | A handful of CSS files, the three critical-path JS bundles (`desktop.min.js`, `window-system.min.js`, `shell-overlays.min.js`), and the plugin logo | Just enough to render the offline shell skeleton. Anything else is picked up at runtime by the caching paths above. |

The cache is keyed by version (`os-static-<v>`,
`os-runtime-<v>`). The `activate` step deletes any cache whose
key doesn't carry the current version, so a deploy doesn't accumulate
stale buckets.

## PHP surface

| Symbol | Role |
|---|---|
| `openstation_pwa_manifest_url()` | Absolute URL of the manifest endpoint. |
| `openstation_pwa_sw_url()` | Absolute URL of the service worker. |
| `openstation_pwa_get_user_state( $user_id = 0 )` | Read the per-user PWA UI state. |
| `openstation_pwa_update_user_state( array $patch, $user_id = 0 )` | Merge a partial update into the state. |
| `openstation_pwa_manifest` (filter) | Mutate manifest fields before encoding. |

REST routes:

- `GET /wp-json/desktop-mode/v1/pwa-state` → `{ installHintDismissed, notificationsEnabled }`
- `POST /wp-json/desktop-mode/v1/pwa-state` → merge partial state. Body: `{ installHintDismissed?: bool, notificationsEnabled?: bool }`.

Both routes require a logged-in user with OpenStation enabled for
their account (`openstation_rest_require_enabled()` — 401 when logged
out, 403 when OpenStation is off) and a valid `X-WP-Nonce`.

## JS surface

```ts
// All exposed on `window.wp.os`:

wp.os.notify( {
    title: 'Build complete',
    body: '12 files updated.',
    icon: '/favicon.png',
    tag: 'my-plugin/build',
    onClick: ( n ) => { window.focus(); n.close(); },
} );

const choice = await wp.os.pwa.promptInstall();
//   'accepted' | 'dismissed' | 'unavailable'

await wp.os.pwa.requestNotificationPermission();
//   'granted' | 'denied' | 'default' | 'unsupported'

const state = wp.os.pwa.getState();
//   { installHintDismissed: boolean, notificationsEnabled: boolean }

const off = wp.os.pwa.subscribe( ( s ) => {
    console.log( 'PWA state changed:', s );
} );
off();
```

Activity-bus channels for plugins that want to mute / amplify / audit:

- `os/notification-requested` — filterable; set
  `cancel: true` to suppress the underlying notification.
- `os/notification-shown` — fire-and-forget; carries
  `fallback: 'toast' | null` so analytics can distinguish the
  permission-denied path from the real-notification path.

## Install criteria recap

For Chromium / Edge to fire `beforeinstallprompt`, the site needs:

1. HTTPS (or `localhost`).
2. A valid manifest with a `name` (or `short_name`), an icon ≥192×192,
   and a `start_url`.
3. A registered service worker that responds to a `fetch` for
   `start_url` (we do — the SW's network-first handler covers it).
4. The user to have engaged with the page for a few seconds (browser
   heuristic).

Safari (macOS / iOS) doesn't fire `beforeinstallprompt`. Users add the
app via the "Share → Add to Home Screen" gesture, which picks up our
`apple-mobile-web-app-*` meta tags emitted from `admin_head`.

## What's coming next

- **Phase 4 — Web Push.** VAPID keypair, REST routes for subscribe /
  unsubscribe, server-side `openstation_push( $user_id, $payload )` PHP
  helper, SW `push` payload renderer wired to the existing `notify()`
  intent shape. The v1 `wp.os.notify` API is the same call site —
  only the transport changes.
- **Per-site icon override hint.** A small OpenStation Preferences tab entry that
  lets administrators upload a custom PWA icon without writing a
  filter.
