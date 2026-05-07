# Architecture

A high-level tour, mostly so hook reference + examples make sense.

## Architecture 1.0 layout (in progress)

The plugin is mid-way through a structural refactor that splits the
historical god-modules (`src/desktop.ts`, `includes/render.php`,
`includes/components.php`, `includes/helpers.php`) into layered
folders with explicit boundaries. Foundations have landed; the
heavy splits ship in subsequent phases. Until they do, the legacy
locations remain authoritative.

| Layer | Location | Status |
|---|---|---|
| `tsconfig` path aliases (`@core/*`, `@api/*`, `@protocol/*`, `@ui/*`, `@layout/*`, `@boot/*`, `@features/*`, `@window-system/*`) | `tsconfig.json` + `vite.config.js` + `vitest.config.ts` | Stable since 1.0.0 |
| Generic reactive registry + server-sync + REST client primitives | `src/core/{reactive-registry,server-sync,api-client}.ts` | Stable since 1.0.0 |
| PHP registry factory | `includes/core/registry-factory.php` | Stable since 1.0.0 |
| Bridge protocol (typed messages + guards + version) | `src/protocol/{window-messages,guards,version}.ts` | Stable since 1.0.0 |
| Public API barrel (1.0 home) + deprecation alias helper | `src/api/{index,deprecated}.ts` | Stable since 1.0.0 |
| Boot decomposition (`desktop.ts` → `src/boot/*`) | planned `src/boot/` | Planned |
| Window-system rename (`src/window/`, `src/window-manager/`, `src/window-chrome/` → `src/window-system/*`) | planned | Planned |
| `includes/render.php` / `components.php` / `helpers.php` slicing | planned `includes/{render,registries,core,rest}/` | Planned |
| Heavy native-window decomposition (posts-window / my-wordpress / recycle-bin into `model.ts` / `ui.ts` / `commands.ts`) | planned `src/features/<name>/` | Planned |
| `WpdBase` web-component class + tokens | planned `src/ui/core/{WpdBase,tokens}.ts` | Planned |
| Extension base library | planned `extensions/base/` | Planned |
| Layout single-source-of-truth | planned `src/layout/` | Planned |
| Published types package (`@wordpress/desktop-mode`) | planned `packages/desktop-mode-types/` | Planned |

Plugin authors should prefer the new locations when they exist;
re-exports keep old import paths working for the duration of the
1.x line. Renames that have nowhere to forward to ship with
deprecation shims (PHP via `_doing_it_wrong`, JS via
`installDeprecatedAlias` from `@api/deprecated`) — no name in the
public surface disappears silently.

## The big picture

```
Browser tab
├── Parent shell  (wp-admin, desktop class on body)
│   ├── Admin bar            — classic WP toolbar + desktop-mode toggle
│   ├── Dock                 — unified rail (core + plugin menus from $menu)
│   │                           placement (left / right / bottom) = user pref
│   └── Desktop area         — wallpaper; hosts windows + desktop icons
│       ├── Window A         — <iframe src="edit.php?desktop_mode_chromeless=1">
│       ├── Window B         — <iframe src="upload.php?desktop_mode_chromeless=1">
│       └── Window C (native)— <div> with plugin-rendered content
│
└── Each iframe renders a chromeless admin page
    — real WordPress request, stripped of wp-admin chrome
```

## PHP flow (per request)

1. `admin_init` — portal redirect logic decides whether to keep the request where it is or send the user to `/desktop-mode/`.
2. `admin_body_class` — the `desktop-mode-active` or `desktop-mode-chromeless` class is appended so CSS and JS can key off it.
3. `admin_enqueue_scripts` — CSS and JS are registered on a per-mode basis (shell assets in desktop mode, chromeless overrides in iframes).
4. `in_admin_header @ 5` — the shell markup is injected right after the admin bar (`<div id="desktop-mode-shell">`).
5. `admin_footer` — the chromeless bridge script is injected inside iframes so they can `postMessage` back to the shell.

Key server-side entry points:

| File | Purpose |
|---|---|
| `desktop-mode.php` | Plugin bootstrap — loads the `includes/` files. |
| `includes/helpers.php` | `desktop_mode_is_enabled()`, `desktop_mode_is_chromeless_request()`, dock builder, chromeless admin-bar suppression. |
| `includes/ajax.php` | `desktop_mode_ajax_save()` — the `wp_ajax_save-desktop-mode` endpoint. |
| `includes/admin-bar.php` | Toggle node + inline JS click handler. |
| `includes/assets.php` | Registers CSS/JS handles on `init`. |
| `includes/render.php` | Shell markup, chromeless bridge emission, body classes. |
| `includes/portal.php` | Portal URL (`/desktop-mode/`) and redirect rules. |
| `includes/session.php` | REST endpoints for saving/restoring the per-user window session. |

## Browser flow

1. `/wp-admin/` loads → portal redirect sends the user to `/desktop-mode/`.
2. `/desktop-mode/` serves a real admin page (Dashboard by default) with the shell wrapped around it.
3. The shell's Vite-built TypeScript bundle (`desktop.js` in dev, `desktop.min.js` in prod) initializes:
   - Creates the `WindowManager`.
   - Creates the **layout dispatcher** which owns the dock(s) for the active `desktopLayout` (see [Desktop layout modes](#desktop-layout-modes)).
   - Either restores the saved session (if one exists) **or** opens the current page in a new window.
   - Wires persistence — debounced `POST /wp-json/desktop-mode/v1/session`.
4. When a dock icon is clicked, the manager opens a window whose iframe `src` is the admin URL with `?desktop_mode_chromeless=1` appended.
5. The iframe renders WordPress normally, but the chromeless stylesheet hides the admin bar, side menu, and wp-footer.
6. The iframe `postMessage`s its title, navigation, and screen-meta state up to the parent.

## Desktop layout modes

OS Settings → Appearance lets the user pick one of three top-level layouts. The shell root reflects the choice in `data-desktop-mode-layout`; the layout dispatcher (`src/desktop-layout.ts`) owns every dock instance and the synthesized desktop-icon list, tearing down and rebuilding when the user switches.

| Mode | Default? | Bottom dock | Left side dock (`wp.desktop.sideDock`) | Wallpaper icons |
|---|---|---|---|---|
| **Classic** | ✅ since 0.18.0 | Plugin-contributed top-level menus (`isCore: false`) | Core admin menus (Dashboard, Posts, Media, Settings, …) | Plugin-registered icons only |
| **Unified** | — *(was the default in 0.17.x)* | Every menu sharing one rail | — *(no side dock)* | Plugin-registered icons only |
| **Spatial** | — | Plugin menus only | — *(no side dock)* | Plugin-registered icons + **synthesized core icons** (one per core menu, prefixed `dock-core:`) |

A user-meta value (`desktopLayout` inside the OS Settings JSON blob, REST-synced via the existing `/wp-json/desktop-mode/v1/os-settings` endpoint) is the persistence layer. The dispatcher partitions the live dock-items list by the `isCore` flag the menu builder already stamps on every entry; no PHP API additions were needed for the layout modes.

Listen for `desktop-mode-layout-changed` on `document` to react to a switch in plugin code — the event detail carries the new `layout` string plus current `primary`/`side` `Dock` references.

## Dock customization — two registries

Layered on top of the layout dispatcher: two orthogonal extensibility registries plugin authors can use to customize the dock without forking the renderer. Each registry is opt-in; the shipped baseline works unchanged when no plugins register.

| Registry | Surface | When to reach for it |
|---|---|---|
| **Decoration hooks** | Render-pipeline filters and actions fired by the default rail renderer — `tile-class`, `tile-element`, `tile-rendered`, `tile-tooltip`, `before-render`, `after-render`. | Animations, classNames, wrappers, custom tooltips. Composable across plugins; plugin authors don't have to replace the rail. |
| **Dock rail renderer** | `wp.desktop.registerDockRailRenderer( { id, label, mount } )` — owns the entire rail. | Circular ring, Stage-Manager stack, floating cluster. The default ships the icon-strip backed by the `Dock` class. |

How they plug in:

- **Default rail renderer** wraps the existing `Dock` class. The layout dispatcher calls `renderer.mount({ container, items, openItem, openSubmenuPick, openSystemItem, ... })` which constructs a `Dock` and returns a controller. The dispatcher's downstream calls (live menu refresh, system tile add/remove, badge updates) all go through the controller.
- **Custom rail renderers** receive the same `mount-deps` shape and return their own controller. The `openItem` / `openSubmenuPick` / `openSystemItem` callbacks are the routing surface — renderers SHOULD use them rather than reaching for `windowManager` directly so they stay compatible with future shell features (multi-instance, session restore, per-window theming).
- **Decoration hooks** are emitted from inside the default rail renderer. Custom rail renderers SHOULD emit equivalent hooks at equivalent points so plugins that decorate through the hook surface keep working when the user picks a different renderer. The shell can't enforce this — the hook calls are `applyFilters` / `doAction` calls a renderer chooses to make. Helpers (`wp.desktop.applyTileClasses` / `applyTileElement` / `applyTileTooltip` / `dispatchTileRendered`) make it a one-liner per phase.

Robustness guarantees:

- Every rail-renderer `mount()` runs inside try/catch. A throwing renderer logs via `HOOKS.SHELL_ERROR` and the dispatcher falls back to the built-in `'default'` for that rail.
- `apiVersion: 1` is enforced at registration so an out-of-date plugin can't stand on a load-bearing bug; an unsupported version throws.
- Owner-tagged registrations sweep on plugin deactivation: `unregisterDockRailRenderersByOwner( 'plugin-script-handle' )` removes every renderer the plugin contributed; if the user had one of them active, the dispatcher rebuilds with the shipped baseline. No reload required.
- `wp.desktop.dock` and `wp.desktop.sideDock` continue to return the underlying `Dock` instance when the default renderer is active (Symbol-keyed escape hatch). With a custom renderer active, both return `null` — plugin authors who need renderer-agnostic access reach for `windowManager` / `activity` / hooks instead.

Persistence:

- `dockRailRenderer` lives on `OsSettingsState` (REST-synced to user meta via `/wp-json/desktop-mode/v1/os-settings`). The field takes any `sanitize_key()`-clean string; the JS-side registry resolves at use time and falls back to `'default'` when the named renderer is missing (plugin deactivated, typo). No server-side allow-list — renderers register from JS at runtime.

See [`docs/dock-customization.md`](./dock-customization.md) for the plugin-author overview and [`docs/examples/`](./examples/README.md) for full walk-throughs.

## Two window types

### Iframe windows (default)

Used for **every existing admin page**. Zero plugin changes required — the chromeless request strips chrome and the iframe does the rest. Trade-off: no direct DOM access between parent and iframe (so cross-frame communication is `postMessage`-only).

### Native windows (shipped — 0.11.0)

Registered via `desktop_mode_register_window()` (PHP) or `wp.desktop.registerWindow()` (JS). Content renders **directly in the parent DOM** — no iframe, direct shell access, lower overhead. Good for lightweight tools (color picker, settings panels, quick notes) and for anything that wants to participate in cross-window interactions directly.

Additional tabs can be attached to any native window with `desktop_mode_register_window_tab()` — the first tab is the window's own template, and subsequent registrations (from any plugin) append after it. When two or more tabs exist the shell auto-wraps the render tree in `<wpd-stack>` + `<wpd-tabs>` so plugin authors don't hand-write tabstrip markup.

The shell's own **OS Settings** native window (wallpaper / accent / dock-size / AI config / default-window) is both a shipped feature and the reference implementation. Lifecycle hooks — `desktop-mode.native-window.before-render` (filter), `after-render`, `before-close` — let a plugin decorate or wrap another plugin's render output.

#### Eager vs lazy script load — and what gets injected

The script handle declared in `desktop_mode_register_window( …, [ 'script' => $handle ] )` reaches the shell page through one of two paths:

- **Eager** — `desktop_mode_enqueue_native_window_scripts()` calls `wp_enqueue_script( $handle )` on `admin_enqueue_scripts:20`, so WordPress prints the tag normally through `wp_print_scripts()` along with all `extra` data (localize, inline, translations).
- **Lazy** — when the shell receives the `nativeWindows` payload mid-session (e.g. after a `desktop-mode-plugins-changed` postMessage from the chromeless `plugins.php` iframe), it appends `<script src="…">` directly via `loadVendorScript( url, extras )`. **This path bypasses `wp_print_scripts()` entirely.**

Since 0.6.0, the payload builders harvest each registered handle's `extra['data']` (localize), `extra['before']` / `extra['after']` (inline), and `wp_set_script_translations()` snippet into the `nativeWindows[]` entry as `scriptL10n` / `scriptBefore` / `scriptAfter` / `scriptTranslations`. The shell injects them as inline `<script>` tags around the lazy `<script src>` in `wp_print_scripts` order — translations → l10n → before → src → after. So `wp_localize_script` / `wp_add_inline_script` / `wp_set_script_translations` work transparently on both paths.

The `'config'` arg on `desktop_mode_register_window()` (also 0.6.0) ships through the same delivery path and is the recommended way to pass session-bound data to a bundle. See [`docs/examples/window-with-config.md`](./examples/window-with-config.md).

## Session persistence

Every window lifecycle event — open, close, focus, move, resize, state change — is pushed into a debounced writer that `POST`s the full stack to a REST endpoint. On next load, the shell reads the session and rebuilds the stack before the user sees anything (no "flash of default layout"). Clamping logic adapts window coordinates when the viewport shrinks.

REST surface:

- `GET  /wp-json/desktop-mode/v1/session` — current user's saved session.
- `POST /wp-json/desktop-mode/v1/session` — overwrite the session. Body: `{ session: { windows: [...], focused, updated } }`.
- `DELETE /wp-json/desktop-mode/v1/session` — clear it.

All session routes require a valid `X-WP-Nonce` (the standard REST nonce) and the current user to be logged in with capability `read`.

We also extend Core's `/wp/v2/media` endpoint with two opt-in query parameters so the OS Settings wallpaper picker (and any plugin that wants the same capability) can ask the server to filter out images that are too small to look good stretched across the desktop:

- `desktop_mode_min_width=<int>`  — only return images at least this many pixels wide.
- `desktop_mode_min_height=<int>` — only return images at least this many pixels tall.

Both params are purely additive — omitting them keeps the endpoint's default behavior untouched. Implementation lives in `includes/media-query.php`: every new upload gets stamped with two flat numeric post-meta keys (`_desktop_mode_width`, `_desktop_mode_height`) via `wp_generate_attachment_metadata` / `wp_update_attachment_metadata`, and the params translate into a `WP_Meta_Query` NUMERIC `>=` clause. Pre-existing attachments are backfilled opportunistically — each filtered REST request stamps up to 50 unstamped images — so a site upgrading into this feature starts seeing real filtered results within a few picker opens rather than requiring a CLI run. Once every image has been stamped, the `desktop_mode_media_dims_backfilled` site option flips to `1` and the sweep query is skipped from then on.

## Command palette bridge (Cmd+K, hijacked)

WordPress 6.4+ ships a command palette via `@wordpress/commands` — the one that opens on Cmd+K in Gutenberg / site editor. Inside a desktop-mode iframe we **suppress it** and reroute the keystroke to the shell's own palette, then **harvest** the iframe's `core/commands` registry and re-publish every command as a slash-command in the shell. The user sees one palette; it's ours; it contains whatever the focused window contributes.

This is a deliberate hack — there is no public API on `@wordpress/commands` for a parent frame to read and invoke commands from a child iframe. The implementation lives in two places:

- **Iframe side** (`includes/render.php`, chromeless bridge script):
  1. A capture-phase `keydown` handler `preventDefault`s Cmd/Ctrl+K and posts `desktop-mode-palette-cycle` to the parent. No more "native palette flashes before ours wins the race."
  2. A React component is mounted into a hidden div (via `wp.element.createRoot`). It `useSelect`s `getCommandLoaders(true)` and `getCommands(true)` from `core/commands`; one child component per loader invokes the loader's hook under a legal render context. Results are collected into a ref-based bucket (state would setState-loop — every hook call returns a fresh array reference).
  3. Callbacks are NOT executed to classify navigation commands. `Location.prototype.href` is non-configurable so a sandbox can't intercept `location.href = X` without real navigation — an earlier attempt cascaded into infinite window spawning. We now match `Function.prototype.toString()` against a string-literal regex instead. Computed URLs fall back to `action`.
  4. React icons (`@wordpress/icons` elements) are flattened to SVG markup via `wp.element.renderToString` so they can cross `postMessage`'s structured clone.
  5. A private `__wpdCommandCallbacks` cache, rebuilt every harvest, keeps live references to the loader commands' callbacks. Loader results aren't in `getCommands()` so the invoke path needs its own lookup.

- **Parent side** (`src/commands/iframe-bridge.ts`):
  1. On `desktop-mode-window-focused`, send `desktop-mode-commands-subscribe` to that window's iframe; evict the previous window's commands tagged with owner `iframe:<windowId>`.
  2. On `desktop-mode-commands-list`, re-register everything under the new owner. Navigation-kind commands become "open a new desktop window" via `manager.open`; action-kind commands post `desktop-mode-commands-invoke` back to the iframe.
  3. On `desktop-mode-window-changed` with `state: 'minimized'` for the subscribed window, evict its commands — minimized windows shouldn't contribute to a palette that's supposed to reflect what's actionable right now. The next focus event rehydrates.
  4. On `desktop-mode-bridge-ready` (handshake posted by the iframe once its listener is attached), re-send subscribe if the iframe matches the currently focused window. Fixes the race where the parent sends subscribe before the iframe script has run.

Each harvested command is tagged `eager: true` so it surfaces in the palette without requiring the user to type `/`. The palette renders eager commands on empty input; typing `/` switches to the slash-only surface (disjoint from eager — see [JavaScript Reference](./javascript-reference.md#commands)).

**Caveats.** Gutenberg block-level loader hooks are tightly coupled to current editor state; invoking a stale closure after the editor re-renders can no-op. The harvester re-runs on every React re-render, so in practice the cache is fresh, but don't expect the bridge to work if the iframe page hasn't booted its editor yet. Non-Gutenberg admin screens generally expose no contextual commands, so the palette falls back to its AI suggestions view when the focused window's registry is empty.

## CSS layering

```
assets/css/
├── variables.css    — Custom properties, color-scheme aware.
├── desktop.css      — Shell layout; hides classic chrome via body.desktop-mode-active.
├── windows.css      — Window chrome, animations, states.
├── dock.css         — Left-edge dock.
└── chromeless.css   — Loaded INSIDE iframes; scoped to body.desktop-mode-chromeless.
```

Never edit Core's `common.css` or color scheme files. Everything we need is exposed as a CSS Custom Property in `variables.css`.

## What's shipped vs. what comes next

**Shipped** — unified dock with left / right / bottom placement (user preference in OS Settings; default bottom), multi-window orchestration + session restore, virtual desktops / Spaces (0.6), wallpaper registry (0.6), widget registry (0.7), overview + arrange + snap (0.8–0.9), native windows and tabs (0.10–0.11), AI assistant + slash commands + palette registry (0.13–0.14), cross-frame drag bridge for Media Library (0.14), OS Settings native window, accent + custom-gradient editor, toast notifications, iframe observability (`iframe-ready` / `iframe-error` / `iframe-network-completed`), letter-badge icon fallback, batch `closeAll()` with protection filter, primary-desktop filter, iframe command-palette bridge (0.16 — harvests `@wordpress/commands` from the focused window into the shell palette; see "Command palette bridge" above).

**Coming up**

- **Polish** — color-scheme-aware variables across every shell surface, View Transitions API animations, full accessibility audit (ARIA, focus traps, keyboard navigation).
- **Mobile (phone OS)** — `responsive.ts` + `mobile.ts`: home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar. `wp.desktop.mode` returns `'desktop' | 'tablet' | 'mobile'`.
- **Tablet hybrid** — split view, slide-over overlay, horizontal bottom dock, optional desktop-mode toggle for large tablets.
- **The North Star — cross-window drag & drop** — extend the existing cross-frame drag bridge beyond Media Library attachments: pluggable mime-type negotiation (`desktop_mode_drag_mime_types` / `desktop_mode_drag_payload` / `desktop_mode_drop_accepts`), Gutenberg block-insertion target, visual lift-and-drop feedback.

See [Hooks Reference](./hooks-reference.md) for the filter/action names each phase will introduce.
