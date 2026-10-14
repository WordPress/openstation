# Pulse Monitor

*Experimental.* A heart monitor wired to the site, as a built-in PixiJS canvas **wallpaper** (`wp-pulse`) and a **widget** (`desktop-mode/pulse`). Every HTTP request and every signal the desk can see is a labelled beat on a red ECG trace over black, failed beats say why, and the rhythm doubles as a health diagnosis.

- Source: `src/plugins/pulse-monitor/` — one bundle for both faces (`assets/js/pulse-monitor[.min].js`, handle `os-pulse-monitor`)
- Server feed, script handle, widget registration: `includes/pulse-monitor.php`
- Wallpaper registration: `includes/wallpapers.php`

## Two faces, one engine

The wallpaper and the widget ship in the same bundle. The shell's loaders de-duplicate scripts by URL, so the engine loads once whichever face is on the desk.

- **One hub per page.** `hub.ts` wires the signal taps, the Heartbeat feed and the health diagnosis once, reference-counted, however many monitors are mounted. Two faces never mean two `PerformanceObserver`s or two contributors to the Heartbeat field.
- **One monitor composition.** `monitor.ts` is what both faces mount: its own rhythm and Pixi scene, subscribed to the hub, plus the numbers, the spike labels and the beeper. The faces differ only in the scene variant. The widget's trace has taller beats, a slower sweep so labels stay readable, at most three echo lines, and the numbers in small type along its bottom edge.
- **Separate settings, one form.** The wallpaper's settings are the `wp-pulse` wallpaper settings, edited from *OS Settings → Wallpaper → Wallpaper settings*. The widget keeps its own, in its per-widget store (`ctx.storage`, this browser), edited from its gear button — so the widget can look and listen differently from the wallpaper. Both use the same form (`config.ts`); the widget's leaves out the wallpaper-only layout. Muting is applied per monitor, and the diagnosis is shared.

| File | Role |
|---|---|
| `index.ts` | bundle entry: publishes both faces |
| `wallpaper.ts` / `widget.ts` | the two faces |
| `monitor.ts` | one mounted trace |
| `hub.ts`, `signals.ts` | the page's signal taps and Heartbeat feed |
| `health.ts`, `rhythm.ts` | diagnosis, beat scheduling and waveforms |
| `scene.ts`, `readout.ts` | the Pixi trace and labels, the numbers and beeper |
| `incidents.ts`, `issues.ts` | every failure with its URL and window; the Issues window |
| `config.ts`, `settings.ts`, `sources.ts` | the settings form, sanitizing, the signal catalog |

## What makes it beat

Each beat comes from a **source**. Users switch sources on and off in *OS Settings → Wallpaper → Wallpaper settings → Listening to*. Muting a source quiets the trace; it never blinds the diagnosis.

| Source | Where it comes from | Spike |
|---|---|---|
| `requests` | `os/request-settled` (every `wp.os.fetch`), `os.iframe.network-completed` (fetch/XHR inside every window's page, the block editor embedded in the Posts app included), resource timing for window pages without the bridge (a 404, a fatal error), and `PerformanceObserver` resource timing in the shell for raw fetch/XHR | full beat |
| `pages` | `os.window.content-loaded`, plus every window iframe's `load` (in-window links, form POSTs, redirects), with the page's own HTTP status when same-origin | full beat |
| `heartbeat` | WordPress Heartbeat `heartbeat-tick` | double beat ("lub-dub") |
| `assets` | resource timing in the shell and every same-origin window iframe (scripts, styles, images, fonts) | tick |
| `windows` | window lifecycle, drags, snaps, overview, desktops, widgets, commands, desktop icons | short spike |
| `input` | clicks, key presses and wheel in the shell and same-origin windows | tick |
| `messages` | `postMessage` into the shell, `wp.os.broadcast`, connection messages | tick |
| `notices` | `os/toast-shown`, `os/notification-shown`, badge changes | short spike |
| `uploads` | file-drop uploads | full beat |
| `errors` | JS errors and rejections (shell, windows, commands), failed resources, auth loss, going offline | ectopic beat |
| `visitors`, `bots`, `comments`, `publish`, `orders`, `logins`, `api`, `cron`, `team` | the server feed (below) | full beat / short spike |

Any request that fails (status ≥ 400 or a network error) draws as an ectopic beat in the failed-beat colour. A request the page cancelled itself (an `AbortController`, `xhr.abort()`: a search-as-you-type field dropping its previous query) is neither: it does not beat and does not count towards the diagnosis.

Resting beats are deliberately small. With no activity, a pacemaker fires at the *Resting heart rate* setting. Every activity beat resets that clock and stands well above it. Bursts queue behind a 300 ms refractory gap: a page load reads as a run of tall, fast beats, and a queue that overflows makes the next beats taller instead of growing forever.

Every full beat and short spike carries a small label naming its cause ("request", "heartbeat", "visit", "comment"…). Labels travel and fade with the trace, and repeats merge into "request ×3". Ticks (clicks, assets, messages) are not labelled unless they failed.

### Amber beats

Beats in the failed-beat colour (amber by default) failed, and their label says why:

| Label | Meaning |
|---|---|
| `request · 404`, `page load · 500` | the HTTP status |
| `request · Failed to fetch`, `heartbeat · timeout` | a network-level failure: no response at all |
| `error · TypeError: x is undefined` | a JavaScript error (shell, a window, a command) |
| `error · img failed to load` | a broken resource |
| `upload · upload failed`, `error · session expired`, `error · offline` | |
| `visit · 500`, `login · failed` | a site-wide event that failed on the server |
| `PVC: slow responses (p95 3.1 s)` | a strained site: the diagnosis turned a resting beat ectopic, and names its leading cause |
| `request · VT: 42% of requests failing` | a critical site: every beat is ventricular tachycardia |

**Background tabs.** A hidden tab is throttled: the browser delays timers and callbacks. Latency samples taken while the document is hidden are therefore discarded, so a backgrounded tab does not diagnose itself "slow" and fill the trace with PVCs. While the tab is hidden (or the wallpaper is suspended) the trace is frozen: beats are dropped rather than queued, so coming back does not replay the pause as one burst, and the numbers and the flatline alarm pause with it. Failures in the background still count towards the diagnosis, so a site that broke while you were away is drawn sick when you return.

## Layout

*Wallpaper layout → Trace area* in the settings picks where the wallpaper's trace lives:

- **Whole wallpaper** (default). The trace runs across the whole wallpaper, under the desk. Windows can cover it, and the numbers sit at the bottom-right of the work area, clear of a docked pill.
- **Reserved top band**. The shell reserves a strip along the top of the desktop (*Band height*, 56–300 px, 88 by default) through [`wp.os.workArea.reserve()`](./javascript-reference.md#reserved-bands). Nothing else may be placed there: maximize, snap, new windows, icons and widgets stay below it, and dragging or resizing a window stops at its edge. The trace and its numbers draw on a layer over the band, the rest of the wallpaper is the plain background colour, and since nothing can cover the numbers, clicking them opens the [Issues window](#issues).

On a phone (the shell's mobile mode, `wp.os.mode.isMobile()`), the band is not used: apps open full-screen there, so a reserved strip would only take room from them. The wallpaper falls back to the whole-wallpaper layout and reserves nothing, and switches back when the shell leaves mobile mode (a rotation, a wider window).

The widget always fills its card.

Resizing the browser keeps the trace. In sweep mode columns stay where they were drawn (a narrower window drops what fell off the edge); in scroll mode the newest columns are kept. Switching between sweep and scroll starts the trace over.

## Health diagnosis

The rhythm reflects site health over a sliding one-minute window:

| Condition | Rhythm | Typical cause |
|---|---|---|
| healthy | regular sinus rhythm | — |
| strained | sinus with PVCs and ST elevation | a few failures, slow responses, Site Health issues |
| sick | atrial fibrillation: irregular, no P waves, quivering baseline | sustained failures or very slow responses |
| critical | ventricular tachycardia, drawn in the failed-beat colour | a large share of requests failing (≈ 30 %+), a 5xx storm |
| down | asystole (flatline), alarm tone when sound is on | offline, Heartbeat connection lost, five network failures in a row |

The score combines:

- failed requests (5xx and network failures fully, 4xx at a quarter weight)
- p95 latency above 800 ms, once the window holds at least 20 timed requests (so a single long call — an AI search, an upload, a streamed response — cannot set it on its own); each request counts for at most 10 s
- JavaScript errors per minute
- an expired session
- the server snapshot: Site Health criticals and recommendations, the 5xx share of site-wide traffic, and overdue cron

What kind of trouble it is caps how bad the rhythm can get, whatever the score. Misconfiguration alone (Site Health, overdue cron) tops out at **strained**. Adding slowness or JavaScript errors tops out at **sick**. Only failing requests (or an expired session) reach **critical**, so a slow local site never draws ventricular tachycardia.

The score is smoothed, quick to worsen and slow to recover, so one failed request is a skipped beat, not a rhythm change. Turn *Diagnose site health* off to keep a sinus rhythm regardless.

The numbers are measured values only. Hover one for what it means:

- **req/min** — requests this browser saw finish in the last minute.
- **ms** (with a clock icon) — the **median response time** over the last minute: half the requests were faster, half slower. It is the whole round trip (PHP, the database, the network), not a network ping, so 500–900 ms is normal on a heavy site. Only requests that finished with the tab visible count. The diagnosis looks at the slow end separately (p95, see above).
- **errors** — the share of those requests that failed: a 4xx or 5xx answer, or none at all.
- **visits/min** — front-end page views across the whole site, from the server feed; `--` when the feed does not reach this user.

## Issues

The Issues window explains the trace. Open it by clicking the numbers (in the widget card or the reserved band), with *Explore issues…* at the top of the settings form, or with **Pulse Monitor: issues** in the command palette (the way in when the trace is the full-screen wallpaper, under the desk). It shows:

- **The score and the rhythm**, live.
- **Why**: each item holding the score down, with the points it costs, what it means, and — for Site Health issues and overdue cron — a button that opens Site Health in a window.
- **Recent problems**: every failure this page saw, newest first, up to 200 — failed requests with method, URL, status and the window they came from; JavaScript errors with file and line; broken resources; Heartbeat errors and lost connections; uploads; session expiry; going offline; and site-wide failures from the server feed. *Clear* empties the list.

Everything listed was seen by this browser, about this browser's own traffic, and stays in the page. Site-wide events from the server feed carry a kind and a status only — the feed never relays URLs or IPs. While open, the window keeps the signal taps running, so it works with no monitor on the desk.

## Server feed

`includes/pulse-monitor.php` records requests the shell cannot see and relays them over Heartbeat.

- **Cost.** The monitor never adds anything to front-end pages, and by default it costs a page view nothing on the server either:
  - **Nobody listening.** Nothing is recorded unless a shell is listening. A mounted monitor contributes `openstation_pulse` to every Heartbeat tick, and each tick refreshes a three-minute lease in the autoloaded `openstation_pulse_listeners` option. With no live lease, a request pays one in-memory option read at `shutdown`.
  - **Page views are opt-in.** Front-end page views (`visitors`, `bots`) are only counted when an administrator turns on **Count site visitors in the Pulse Monitor** (Settings → Features → Extended options; the `pulse_visitors` extended option, filter `openstation_pulse_count_visitors`). Off by default: while it is off, a page view returns before anything is classified or written, even with a monitor open. A front-end server error (5xx) is recorded either way. REST, cron, admin traffic and explicit events (comments, logins, orders, publishing) are not page views and always beat.
  - **Nobody waits for a write.** When a request is recorded, the recorder runs last on `shutdown` and closes the response first (`fastcgi_finish_request()`, or `litespeed_finish_request()`), so the visitor's page is complete before the log is touched. mod_php has neither; there the write still happens after the page has been sent, but before the connection closes. Filter `openstation_pulse_finish_request` returns false to keep the connection open.
  - **Writes are rare and small.** At most one request a second writes the log; the ones in between are sampled out. Failures are sampled like everything else, so the site-wide failure rate the trace diagnoses from stays fair and a burst (a login attack, a crawler) never turns into a write per request. Only comments, publishing and orders always write: they are rare and already wrote to the database. With a persistent object cache, the log and its one-second gate (an atomic `wp_cache_add`) live in the cache (group `openstation_pulse`) and never touch the database. Without one, the log is the non-autoloaded `openstation_pulse_log` option (capped at 200 rows / 2 minutes), gated by the autoloaded `openstation_pulse_gate` timestamp, which costs nothing to check.
  - **Never recorded.** A listener's own requests (the shell already sees them) and WP-CLI commands. Return `''` from `openstation_pulse_request_kind` to keep any other class of traffic off the monitor.

  Measured on a test site with a monitor open: a page view took the same time (≈ 22 ms median over 100 requests) with no monitor, with the monitor and counting off, and with counting on (3–4 rows written per 100 page views).
- **Best effort.** The log and the leases are read-modify-write stores with no lock. Under concurrent traffic some rows overwrite each other and those beats are lost; a lost lease write is redone on the next tick past its half-life. Fine for a live trace; not an audit log.
- **Classification.** Cron → `cron`. REST, XML-RPC, admin-ajax and admin pages → `team` when logged in, `api` when not. Front-end → `visitors`, or `bots` when the user agent looks automated. Explicit events replace the classification: a new comment, review, pingback or trackback → `comments` (other comment types, such as WooCommerce order notes, are bookkeeping and do not beat; `wp_insert_comment` also fires for imports, so an importer beats once per comment), a post going live → `publish`, `wp_login` → `logins`, `wp_login_failed` → `logins` (failed), `woocommerce_new_order` → `orders`.
- **Privacy.** Rows carry a kind, a timestamp, an HTTP status, an error flag and a user id. The user id is used only to exclude a listener's own traffic and never leaves the server. No URLs, IPs, user agents or names are stored.
- **Delivery.** The first tick returns only the cursor, so mounting does not replay history. Later ticks return the newer events plus a health snapshot (`{ siteHealth, requests, failures, cronLate }`). A cursor ahead of the log means the log was reset; that tick relays everything the log holds and brings the cursor back down. The client replays each batch at its real spacing, one tick late. The monitor keeps the user's own Heartbeat rate (OpenStation settings, 15–60 s) instead of speeding it up, since every tick is a full request to the server; a slower rate only means site-wide beats arrive later.
- **Access.** The feed requires `manage_options` by default (filter: `openstation_pulse_capability`). Users without it still get a live trace from their own shell.

### PHP API

```php
// Add a beat from your plugin, e.g. when a form is submitted.
openstation_pulse_record( 'comments' );
openstation_pulse_record( 'my-plugin-refund', array( 'error' => true ) );
```

Kinds are slug-sanitized; unknown kinds render as a standard beat labelled with the kind.

| Hook | Type | Purpose |
|---|---|---|
| `openstation_pulse_capability` | filter | capability required to receive the site-wide feed (default `manage_options`) |
| `openstation_pulse_request_kind` | filter | rename a request's kind, or return `''` to keep it off the monitor |
| `openstation_pulse_is_bot` | filter | override bot detection for a user agent |
| `openstation_pulse_event` | filter | edit or drop (`false`) an event before it is logged |
| `openstation_pulse_health` | filter | extend the health snapshot (e.g. add failures from an uptime monitor) |

Signatures are in the [Hooks Reference](./hooks-reference.md#pulse-monitor-filters--experimental).

## JavaScript API

```js
// Beat from anywhere in the shell — a plugin's own event.
wp.os.activity.publish( 'pulse/beat', { source: 'my-plugin', amplitude: 1 } );
// A failed one, with the reason printed on the spike.
wp.os.activity.publish( 'pulse/beat', { source: 'my-plugin', error: true, detail: 'quota exceeded' } );

// React to every beat a monitor draws.
wp.hooks.addAction( 'os.pulse.beat', 'my-plugin', ( beat ) => {
	// beat = { source, shape, error, major, duration, detail, ectopic, surface }
	// surface: 'wallpaper' | 'widget' — with both on the desk, each draws (and reports) every beat.
} );
```

`source` picks the shape and label: a known source id behaves like that source, anything else is a standard beat labelled with the id. `amplitude` is clamped to 0–2; `detail` is trimmed to 48 characters. `ectopic` is `true` when the diagnosis, not the signal, made the beat abnormal (a PVC or VT).

## Settings

The wallpaper's are persisted through the wallpaper settings surface (`ctx.settings`) under `wp-pulse`; the widget's in its own store (`os.widget.desktop-mode/pulse.settings` in `localStorage`), with the same keys and defaults (`layout` and `bandHeight` do not apply to it). The shell round-trips scalars only and caps a wallpaper at 32 keys, so muted sources travel as one comma-separated `muted` string.

| Key | Default | |
|---|---|---|
| `layout` | `full` | wallpaper only: `full` (whole wallpaper) or `band` (a [reserved top band](#layout)) |
| `bandHeight` | 88 | height of the reserved band, px (56–300) |
| `style` | `sweep` | `sweep` (head crosses and wraps) or `scroll` (trace flows left) |
| `lineColor` / `background` / `errorColor` | `#ff2a2a` / `#000000` / `#ffb020` | |
| `speed` | 220 | px per second |
| `intensity` | 1 | beat height multiplier |
| `lineWidth`, `glow` | 2, 0.6 | |
| `baseline` | 58 | line height, % from the top |
| `echoes` | 10 | faint ghost traces above and below |
| `grid` | off | ECG paper grid |
| `readout` | on | the numbers |
| `labels` | on | name each spike |
| `sound` | off | beep per full beat; alarm on flatline. No audio context exists while it is off |
| `restingBpm` | 62 | 0 = flatline when quiet |
| `diagnose` | on | read site health into the rhythm |
| `muted` | `''` | comma-separated source ids |

`prefers-reduced-motion` renders one still frame.
