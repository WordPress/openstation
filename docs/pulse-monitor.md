# Pulse Monitor

*Experimental.* A heart monitor wired to the site, as a built-in PixiJS canvas **wallpaper** (`wp-pulse`) and a **widget** (`desktop-mode/pulse`). Every HTTP request and every signal the desk can see is a labelled beat on a red ECG trace over black, failed beats say why, and the rhythm doubles as a health diagnosis.

- Source: `src/plugins/pulse-monitor/` — one bundle for both faces (`assets/js/pulse-monitor[.min].js`, handle `os-pulse-monitor`)
- Server feed, script handle, widget registration: `includes/pulse-monitor.php`
- Wallpaper registration: `includes/wallpapers.php`

## Two faces, one engine

The wallpaper and the widget ship in the same bundle. The shell's loaders de-duplicate scripts by URL, so the engine loads once whichever face is on the desk.

- **One hub per page.** `hub.ts` wires the signal taps, the Heartbeat feed and the health diagnosis once, reference-counted, however many monitors are mounted. Two faces never mean two `PerformanceObserver`s or two contributors to the Heartbeat field.
- **One monitor composition.** `monitor.ts` is what both faces mount: its own rhythm and Pixi scene, subscribed to the hub, plus the numbers, the spike labels and the beeper. The faces differ only in the scene variant. The widget's trace has taller beats, a slower sweep so labels stay readable, at most three echo lines, and the numbers in small type along its bottom edge.
- **One settings bag.** Both faces read and write the `wp-pulse` wallpaper settings. The wallpaper edits them from *OS Settings → Wallpaper → Wallpaper settings*; the widget edits them from its gear button, with the same form (`config.ts`). Muting is applied per monitor, and the diagnosis is shared.

| File | Role |
|---|---|
| `index.ts` | bundle entry: publishes both faces |
| `wallpaper.ts` / `widget.ts` | the two faces |
| `monitor.ts` | one mounted trace |
| `hub.ts`, `signals.ts` | the page's signal taps and Heartbeat feed |
| `health.ts`, `rhythm.ts` | diagnosis, beat scheduling and waveforms |
| `scene.ts`, `readout.ts` | the Pixi trace and labels, the numbers and beeper |
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

Any request that fails (status ≥ 400 or a network error) draws as an ectopic beat in the failed-beat colour.

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

**Background tabs.** A hidden tab is throttled: the browser delays timers and callbacks. Latency samples taken while the document is hidden are therefore discarded, so a backgrounded tab does not diagnose itself "slow" and fill the trace with PVCs. Other failures that happen in the background (a Heartbeat `timeout`, a failed request) are real; they queue and draw, with their reason, when the tab comes back.

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
- p95 latency above 800 ms
- JavaScript errors per minute
- an expired session
- the server snapshot: Site Health criticals and recommendations, the 5xx share of site-wide traffic, and overdue cron

What kind of trouble it is caps how bad the rhythm can get, whatever the score. Misconfiguration alone (Site Health, overdue cron) tops out at **strained**. Adding slowness or JavaScript errors tops out at **sick**. Only failing requests (or an expired session) reach **critical**, so a slow local site never draws ventricular tachycardia.

The score is smoothed, quick to worsen and slow to recover, so one failed request is a skipped beat, not a rhythm change. Turn *Diagnose site health* off to keep a sinus rhythm regardless.

The numbers (bottom-right on the wallpaper, along the bottom edge of the widget) are measured values only:

- **req/min** — requests this shell saw settle in the last minute
- **ms** — median response time
- **errors** — failed share of those requests
- **visits/min** — front-end page views from the server feed; `--` when the feed does not reach this user

## Server feed

`includes/pulse-monitor.php` records requests the shell cannot see and relays them over Heartbeat.

- **Cost.** Nothing is recorded unless a shell is listening. A mounted wallpaper contributes `openstation_pulse` to every Heartbeat tick, and each tick refreshes a three-minute lease in the autoloaded `openstation_pulse_listeners` option. While any lease is live, each request does one `update_option` on the non-autoloaded `openstation_pulse_log` (capped at 200 rows / 2 minutes). A listener's own requests are never recorded.
- **Classification.** Cron → `cron`. REST, XML-RPC, admin-ajax and admin pages → `team` when logged in, `api` when not. Front-end → `visitors`, or `bots` when the user agent looks automated. Explicit events replace the classification: a new comment → `comments`, a post going live → `publish`, `wp_login` → `logins`, `wp_login_failed` → `logins` (failed), `woocommerce_new_order` → `orders`.
- **Privacy.** Rows carry a kind, a timestamp, an HTTP status, an error flag and a user id. The user id is used only to exclude a listener's own traffic and never leaves the server. No URLs, IPs, user agents or names are stored.
- **Delivery.** The first tick returns only the cursor, so mounting does not replay history. Later ticks return the newer events plus a health snapshot. The client replays each batch at its real spacing, one tick late. While mounted, the wallpaper raises a slower Heartbeat interval to 15 s and restores it on unmount.
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

Persisted through the wallpaper settings surface (`ctx.settings`) under `wp-pulse`, and shared by the widget. The shell round-trips scalars only and caps a wallpaper at 32 keys, so muted sources travel as one comma-separated `muted` string.

| Key | Default | |
|---|---|---|
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
| `sound` | off | beep per full beat; alarm on flatline |
| `restingBpm` | 62 | 0 = flatline when quiet |
| `diagnose` | on | read site health into the rhythm |
| `muted` | `''` | comma-separated source ids |

`prefers-reduced-motion` renders one still frame.
