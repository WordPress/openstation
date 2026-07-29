# Architecture

A high-level tour, mostly so hook reference + examples make sense.

## Architecture 0.8.1 layout (in progress)

The plugin is mid-way through a structural refactor that splits the
historical god-modules (`src/desktop.ts`, `includes/render.php`,
`includes/components.php`, `includes/helpers.php`) into layered
folders with explicit boundaries. Foundations have landed; the
heavy splits ship in subsequent phases. Until they do, the legacy
locations remain authoritative.

| Layer | Location | Status |
|---|---|---|
| `tsconfig` path aliases (`@core/*`, `@api/*`, `@protocol/*`, `@ui/*`, `@layout/*`, `@boot/*`, `@features/*`, `@window-system/*`) | `tsconfig.json` + `vite.config.js` + `vitest.config.ts` | Stable |
| Generic reactive registry + server-sync + REST client primitives | `src/core/{reactive-registry,server-sync,api-client}.ts` | Stable |
| PHP registry factory | `includes/core/registry-factory.php` | Stable |
| Bridge protocol (typed messages + guards + version) | `src/protocol/{window-messages,guards,version}.ts` | Stable |
| Public API barrel + deprecation alias helper | `src/api/{index,deprecated}.ts` | Stable |
| Boot decomposition — `origin.ts`, `geometry.ts`, `session.ts`, `session-saver.ts`, `tracked-fetch.ts`, `link-interceptor.ts`, `menu-refresh.ts`, `shell-lifecycle.ts`, plus `src/api/facade.ts` (`buildPublicApi` + `installPublicApi`) | `src/boot/*` + `src/api/facade.ts` | Stable — desktop.ts 3,695 → 2,667 LOC; init() body still owns its own setup but the facade and 9 boot helpers are extracted |
| `src/window-system/` umbrella barrel re-exporting window/ + window-manager/ + window-chrome/ | `src/window-system/index.ts` | Stable — additive; legacy paths still resolve |
| `src/ui/core/tokens.ts` — typed `--wpd-*` design-token namespace + `readToken` / `setToken` helpers | `src/ui/core/tokens.ts` | Stable |
| Window-system rename (`src/window/`, `src/window-manager/`, `src/window-chrome/` → `src/window-system/*`) | planned | Planned |
| `helpers.php` slicing — `core/{routing,payload,registry-factory}.php` | `includes/core/*.php` | Stable — helpers.php 1,609 → 153 LOC |
| `components.php` slicing — 5 registries under `includes/registries/` (native-windows, window-tabs, icons, wallpapers, widgets) | `includes/registries/*.php` | Stable — components.php 2,101 → 376 LOC |
| `render.php` slicing — 5 files under `includes/render/` (body-classes, assets, shell, chromeless-bridge, classic-link-interceptor) | `includes/render/*.php` | Stable — render.php 2,525 → 29-LOC umbrella |
| REST-route centralization under `includes/rest/`, `ai-copilot/search.php` split | planned | Planned |
| Heavy native-window decomposition (posts-window / my-wordpress / recycle-bin into `model.ts` / `ui.ts` / `commands.ts`) | planned `src/features/<name>/` | Planned |
| Web-component base class (`Component`) + design-token catalogue | `src/ui/core/component.ts` (pre-existing) + `src/ui/core/tokens.ts` | Stable |
| Extension base library — `Desktop_Mode_Extension_Window` / `Desktop_Mode_Extension_Rest` PHP bases + `createExtensionWindow` TS helper | `extensions/base/` | Stable |
| Cross-bundle layout single-source-of-truth (`getCurrentLayout` / `subscribeLayout`) | `src/layout/` | Stable |
| Types package (`@desktop-mode/types`) for plugin authors | `packages/desktop-mode-types/` | Stable (in-tree; npm publish later) |
| REST route discoverability index | `includes/rest/README.md` | Stable |

Plugin authors should prefer the new locations when they exist;
re-exports keep old import paths working for the duration of the
0.8.x line. Renames that have nowhere to forward to ship with
deprecation shims (PHP via `_doing_it_wrong`, JS via
`installDeprecatedAlias` from `@api/deprecated`) — no name in the
public surface disappears silently.

## The big picture

```
Browser tab
├── Parent shell  (wp-admin, desktop class on body)
│   ├── Admin bar            — classic WP toolbar + desktop-mode toggle
│   ├── Dock                 — unified rail (core + plugin menus from $menu)
│   │                           placement (left / right / bottom) = desktop layout
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
| `includes/helpers.php` | `desktop_mode_is_enabled()`, the `desktop_mode_rest_require_enabled()` REST gate, misc shared helpers (default wallpaper, registration errors). |
| `includes/core/routing.php` | Chromeless / classic request detection (`desktop_mode_is_chromeless_request()`), admin-target allowlist, chromeless admin-bar suppression, redirect preservation. |
| `includes/core/payload.php` | Dock builder (`desktop_mode_build_dock_items()`) plus menu / native-window payload assembly. |
| `includes/ajax.php` | `desktop_mode_ajax_save()` — the `wp_ajax_save-desktop-mode` endpoint. |
| `includes/admin-bar.php` | Toggle node + inline JS click handler. |
| `includes/assets.php` | Registers CSS/JS handles on `init`. |
| `includes/render.php` | Umbrella loader for `includes/render/` — body classes, asset enqueueing, shell markup, chromeless bridge, classic link interceptor. |
| `includes/portal.php` | Portal URL (`/desktop-mode/`) and redirect rules. |
| `includes/session.php` | REST endpoints for saving/restoring the per-user window session. |

## Browser flow

1. `/wp-admin/...` loads → the portal redirect on `admin_init` bounces the request through `/desktop-mode/?target=<original-url>`.
2. `/desktop-mode/` (with or without `target`) forwards back into wp-admin tagged with `desktop_mode_portal=1`. When the redirect resolved from a `target` (user-supplied intent — admin-bar link, bookmark, etc.) the URL also carries `desktop_mode_portal_intent=1`. Both flags are stripped from `currentPage` before the shell sees it; the booleans `fromPortal` / `fromPortalIntent` ride along in the shell config so the boot flow can distinguish "portal stamped this URL" from "user actually asked for it."
3. The landing page renders with the shell wrapped around it (Dashboard by default; the user's saved focused window, the default-window preference, or the `target` URL otherwise).
4. The shell's Vite-built TypeScript bundle (`desktop.js` in dev, `desktop.min.js` in prod) initializes:
   - Creates the `WindowManager`.
   - Creates the **layout dispatcher** which owns the dock(s) for the active `desktopLayout` (see [Desktop layout modes](#desktop-layout-modes)).
   - Restores the saved session (if one exists). Then `shouldAutoOpenCurrentPage()` (see `src/boot/auto-open.ts`) decides whether to ALSO open `currentPage`. The decision: open when `fromPortal=false` (direct nav) **or** `fromPortalIntent=true` (portal redirected here from a user-clicked link). Suppress on bare portal entries that landed via the default-window / session-focused fallback so a restored stack isn't disturbed.
   - Wires persistence — debounced `POST /wp-json/desktop-mode/v1/session`.
5. When a dock icon is clicked, the manager opens a window whose iframe `src` is the admin URL with `?desktop_mode_chromeless=1` appended.
6. The iframe renders WordPress normally, but the chromeless stylesheet hides the admin bar, side menu, and wp-footer.
7. The iframe `postMessage`s its title, navigation, and screen-meta state up to the parent.

## Desktop layout modes

OS Settings → Appearance lets the user pick one of three top-level layouts. The shell root reflects the choice in `data-desktop-mode-layout`; the layout dispatcher (`src/desktop-layout.ts`) owns every dock instance and the synthesized desktop-icon list, tearing down and rebuilding when the user switches.

| Mode | Default? | Bottom dock | Left side dock (`wp.desktop.sideDock`) | Wallpaper icons |
|---|---|---|---|---|
| **Classic** | ✅ | Plugin-contributed top-level menus (`isCore: false`) | Core admin menus (Dashboard, Posts, Media, Settings, …) | Plugin-registered icons only |
| **Unified** | — | Every menu sharing one rail | — *(no side dock)* | Plugin-registered icons only |
| **Spatial** | — | Plugin menus only | — *(no side dock)* | Plugin-registered icons + **synthesized core icons** (one per core menu, prefixed `dock-core:`) |

A user-meta value (`desktopLayout` inside the OS Settings JSON blob, REST-synced via the existing `/wp-json/desktop-mode/v1/os-settings` endpoint) is the persistence layer. The dispatcher partitions the live dock-items list by the `isCore` flag the menu builder already stamps on every entry; no PHP API additions were needed for the layout modes.

**Where Spatial's core icons actually render (0.9.0+):** the layout dispatcher's `dock-core:*` synthesis (`src/desktop-layout.ts`) targets the legacy `.desktop-mode-icons` grid via `deps.renderIcons()`. On shells where the files layer is mounted (`config.filesUrl` set — the modern default), that grid is hidden by CSS (`assets/css/desktop-files.css`'s `#desktop-mode-area:has( > .desktop-mode-files-layer )` rule), because the files layer is the actual visible wallpaper surface. The user-visible equivalent lives in `syncShortcutsWithVisibility()` (`src/settings/desktop-shortcuts-sync.ts`): while `desktopLayout === 'spatial'`, every core dock item without an explicit `'hidden'` override gets a synthetic `dock-promoted:<id>` shortcut placement pushed into the files store — the same mechanism used for user-promoted dock items, so drag persistence, positions (`dockPromotedPositions`), and grid collision handling come for free. Leaving Spatial removes these placements but does *not* prune their saved positions, so a rearranged layout survives switching away and back. The legacy `dock-core:*` grid synthesis remains for shells without a files layer.

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
- `unfocusEffect` lives on `OsSettingsState` the same way (default `'darken'`, `'none'` disables). The value is an unfocus-effect registry id or `'none'`; it is lower-cased and stripped to `[a-z0-9_/-]` server-side (slashes preserved so `vendor/sub-id` round-trips — unlike `sanitize_key()`). The engine resolves it at use time and treats an unknown id as "no effect". Plugin effects register from JS at runtime; PHP opt-in via `desktop_mode_register_unfocus_effect_script()` adds the `serverUnfocusEffectScripts` payload entry so a plugin's effect surfaces in OS Settings → Effects without an F5.
- `windowLinkRenderer` / `windowLinkVisibility` follow the `unfocusEffect` pattern for the window-links feature — visual ties between windows showing related content (`src/window-links/`). The renderer id uses the same `[a-z0-9_/-]` charset (default `'svg-splines'`, `'none'` disables; the render host falls back to the built-in for unknown ids); visibility is the closed set `'always' | 'focus' | 'off'` (default `'always'`). Three boolean feature switches (`windowLinksEnabled`, `windowLinkRaiseOnFocus`, `windowLinkHighlight`, all default `true`) live in OS Settings → Features and gate the whole feature / the group-raise / the related-window outline respectively. PHP opt-in via `desktop_mode_register_window_link_renderer_script()` adds the `serverWindowLinkRendererScripts` payload entry. The active renderer mounts into a dedicated overlay layer (`#desktop-mode-window-links`, `z-index: var(--desktop-mode-z-window-links, 50)` — above the widget layer, behind the windows, `pointer-events: none`) that exists only while a relation group is renderable. Per-window content identity arrives from the chromeless bridge's `desktop-mode-content-identity` postMessage, built by `desktop_mode_build_content_identity()` in `includes/window-links.php` and filterable via `desktop_mode_window_content_identity`. The identity also carries `related` navigation items (the title bar's Related menu; filter `desktop_mode_window_related_entities`), and `GET /wp-json/desktop-mode/v1/content-identity?post=N` (`edit_post`-gated) recomputes a post's identity outside a page render — the bridge's block-editor save-watcher hits it after every real save and re-announces, so the menu and the window ties stay fresh without a reload.

See [`docs/dock-customization.md`](./dock-customization.md) for the plugin-author overview and [`docs/examples/`](./examples/README.md) for full walk-throughs.

## Two window types

### Iframe windows (default)

Used for **every existing admin page**. Zero plugin changes required — the chromeless request strips chrome and the iframe does the rest. Trade-off: no direct DOM access between parent and iframe (so cross-frame communication is `postMessage`-only).

### Native windows (shipped — 0.5.2)

Registered via `desktop_mode_register_window()` (PHP) or `wp.desktop.registerWindow()` (JS). Content renders **directly in the parent DOM** — no iframe, direct shell access, lower overhead. Good for lightweight tools (color picker, settings panels, quick notes) and for anything that wants to participate in cross-window interactions directly.

Additional tabs can be attached to any native window with `desktop_mode_register_window_tab()` — the first tab is the window's own template, and subsequent registrations (from any plugin) append after it. When two or more tabs exist the shell auto-wraps the render tree in `<wpd-stack>` + `<wpd-tabs>` so plugin authors don't hand-write tabstrip markup.

The shell's own **OS Settings** native window (wallpaper / accent / dock-size / AI config / default-window) is both a shipped feature and the reference implementation. Lifecycle hooks — `desktop-mode.native-window.before-render` (filter), `after-render`, `before-close` — let a plugin decorate or wrap another plugin's render output.

#### Eager vs lazy script load — and what gets injected

The script handle declared in `desktop_mode_register_window( …, [ 'script' => $handle ] )` reaches the shell page through one of two paths:

- **Eager** — `desktop_mode_enqueue_native_window_scripts()` calls `wp_enqueue_script( $handle )` on `admin_enqueue_scripts:20`, so WordPress prints the tag normally through `wp_print_scripts()` along with all `extra` data (localize, inline, translations).
- **Lazy** — when the shell receives the `nativeWindows` payload mid-session (e.g. after a `desktop-mode-plugins-changed` postMessage from the chromeless `plugins.php` iframe), it appends `<script src="…">` directly via `loadVendorScript( url, extras )`. **This path bypasses `wp_print_scripts()` entirely.**

The payload builders harvest each registered handle's `extra['data']` (localize), `extra['before']` / `extra['after']` (inline), and `wp_set_script_translations()` snippet into the `nativeWindows[]` entry as `scriptL10n` / `scriptBefore` / `scriptAfter` / `scriptTranslations`. The shell injects them as inline `<script>` tags around the lazy `<script src>` in `wp_print_scripts` order — translations → l10n → before → src → after. So `wp_localize_script` / `wp_add_inline_script` / `wp_set_script_translations` work transparently on both paths.

The `'config'` arg on `desktop_mode_register_window()` (also 0.6.0) ships through the same delivery path and is the recommended way to pass session-bound data to a bundle. See [`docs/examples/window-with-config.md`](./examples/window-with-config.md).

## Session persistence

Every window lifecycle event — open, close, focus, move, resize, state change — plus virtual-desktop create / switch / close is pushed into a debounced writer that `POST`s the full stack to a REST endpoint. On next load, the shell reads the session and rebuilds the stack before the user sees anything (no "flash of default layout"). Clamping logic adapts window coordinates when the viewport shrinks. Desktop-only state still counts: if the user has multiple Spaces but no open windows, the desktop registry and active desktop are restored.

REST surface:

- `GET  /wp-json/desktop-mode/v1/session` — current user's saved session.
- `POST /wp-json/desktop-mode/v1/session` — overwrite the session. Body: `{ session: { windows: [...], desktops: [...], activeDesktop, focused, updated } }`.
- `DELETE /wp-json/desktop-mode/v1/session` — clear it.

### What comes back, and how

Two kinds of window are persisted, restored by two different routes.

**Iframe windows** are rebuilt from their saved URL. The server only
stores URLs that resolve inside this site's own `wp-admin` — a URL that
fails `desktop_mode_url_is_same_admin()` is dropped from the session
rather than sanitized, so the restore path can never be pointed at a
foreign origin.

**Native windows** (OS Settings, Bug Report, anything registered via
`desktop_mode_register_window()` / `wp.desktop.registerWindow`) carry
`native: true` and a `#<id>` marker in place of a URL. A native
window's `render` callback is a JS closure and can't be serialized, but
it doesn't need to be: every native window is addressable by id, so the
shell reopens it by asking its owner — built-ins have their own
openers, everything else goes to `nativeWindows.openById( id )`. The
marker is rebuilt server-side from the sanitized id; the client's `url`
is never stored for a native window. Ids that nothing answers to at
restore time — a plugin deactivated since the session was saved — are
skipped silently.

Because the openers construct their own `manager.open()` config from
the registry, they have no argument to carry restore-time values.
`restoreSession` therefore stages the saved geometry, desktop
assignment, and window state through
`WindowManager.seedWindowRestoreState()` before triggering the opens;
the manager merges each entry into the first window that claims that
id, then forgets it, so a later user-initiated open is unaffected.

**Ephemeral windows** (`ephemeral: true` — editor previews, whose URLs
carry single-use nonces) are the one category that is never persisted,
and never counts as the focused window.

### Desktop themes

A **desktop theme** reskins the whole shell from a ZIP of a
`theme.json` manifest plus images — every `--desktop-mode-*` token, the
title-bar / dock / desktop textures, the window frame and corners, and
a complete iconset including the window control glyphs. (Distinct from
the per-window **window themes** in `includes/window-chrome.php`; the
`desktop_theme` / `desktopTheme` naming keeps them apart everywhere.)

The load-bearing decision is that **no author-supplied CSS or JS ever
executes**. PHP validates the manifest field by field and *compiles* a
stylesheet of custom-property declarations from it, generating every
`url()` itself from a `rawurlencode`d path. Texturing is therefore
expressed as manifest properties (`repeat`, `size`, `slice`, …) with a
closed grammar, not as CSS.

- **Storage** — `uploads/desktop-mode-themes/<slug>/` holds the
  author's `theme.json`, the compiled `theme.css`, and only the assets
  the sanitized manifest actually references. The directory drops an
  `index.php` and an **exec-off** `.htaccess` — deliberately not the
  deny-all one the stored-files module uses, because theme assets have
  to be servable. The sanitized manifest is indexed in the
  `desktop_mode_desktop_themes` site option (autoload **no** — it
  carries whole manifests).
- **Install pipeline** (`includes/desktop-themes/install.php`) —
  validate the archive entry-by-entry before writing anything → extract
  to `.staging-<uuid>/` → sanitize the manifest (resolving every asset
  reference inside the staging dir) → sanitize referenced SVGs with
  DOMDocument → delete + recreate the final dir (**re-upload = update**)
  → move only referenced assets → compile + write `theme.css` → update
  the index. Staging is cleaned on every exit path.
- **REST** — `POST /wp-json/desktop-mode/v1/desktop-themes`
  (multipart `file`) and
  `DELETE /wp-json/desktop-mode/v1/desktop-themes/<slug>`, both gated on
  `desktop_mode_rest_require_enabled()` plus the
  `desktop_mode_desktop_theme_upload_capability` capability
  (`manage_options` by default). There is no GET — the library rides
  the boot / live-refresh payload as `serverDesktopThemes`.
- **Selection** — per-user, stored as `desktopTheme` in the existing
  `desktop_mode_os_settings` user meta and synced through the existing
  `/os-settings` route. The sanitizer is a pattern check, not an
  allow-list, so a settings write never has to load the themes option;
  the enqueue path existence-checks instead, which is also what makes
  an orphaned selection degrade silently to the system default.
- **Zero cost when unused** — no active theme means no stylesheet, no
  shell attribute, no body class, and icon resolution is a single null
  check. Every core CSS rule that consumes a texture token reads it as
  `var( --name, <initial> )`.

Client side: `src/desktop-themes/` (a `createSharedStore`-backed
registry, the icon resolver, the activation module, and a synchronous
server-sync) sits in the always-on shell bundle and stays free of
`lit` / `<wpd-*>` imports; the picker UI lives in the lazy OS Settings
panel bundle. Full authoring reference:
[`desktop-themes.md`](./desktop-themes.md).

All session routes require a valid `X-WP-Nonce` (the standard REST nonce) and the current user to be logged in **with desktop mode enabled** (`desktop_mode_is_enabled()`, via the shared `desktop_mode_rest_require_enabled()` gate). The `read` capability alone is intentionally insufficient: every authenticated role (including Subscriber) carries `read`, so a `read`-only gate would admit users who never opted into the desktop. Logged-out callers get `401`; logged-in callers without desktop mode get `403`.

We also extend Core's `/wp/v2/media` endpoint with two opt-in query parameters so the OS Settings wallpaper picker (and any plugin that wants the same capability) can ask the server to filter out images that are too small to look good stretched across the desktop:

- `desktop_mode_min_width=<int>`  — only return images at least this many pixels wide.
- `desktop_mode_min_height=<int>` — only return images at least this many pixels tall.

Both params are purely additive — omitting them keeps the endpoint's default behavior untouched. Implementation lives in `includes/media-query.php`: every new upload gets stamped with two flat numeric post-meta keys (`_desktop_mode_width`, `_desktop_mode_height`) via `wp_generate_attachment_metadata` / `wp_update_attachment_metadata`, and the params translate into a `WP_Meta_Query` NUMERIC `>=` clause. Pre-existing attachments are backfilled opportunistically — each filtered REST request from a **logged-in** user stamps up to 50 unstamped images (anonymous requests can still use the dimension filters, but never trigger the backfill writes) — so a site upgrading into this feature starts seeing real filtered results within a few picker opens rather than requiring a CLI run. Once every image has been stamped, the `desktop_mode_media_dims_backfilled` site option flips to `1` and the sweep query is skipped from then on.

## Command palette bridge (Cmd+K, hijacked)

WordPress 6.4+ ships a command palette via `@wordpress/commands` — the one that opens on Cmd+K in Gutenberg / site editor. Inside a desktop-mode iframe we **suppress it** and reroute the keystroke to the shell's own palette, then **harvest** the iframe's `core/commands` registry and re-publish every command as a slash-command in the shell. The user sees one palette; it's ours; it contains whatever the focused window contributes.

This is a deliberate hack — there is no public API on `@wordpress/commands` for a parent frame to read and invoke commands from a child iframe. The implementation lives in two places:

- **Iframe side** (`includes/render/chromeless-bridge.php`):
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

### The AI assistant as the shell's ⌘K palette

WordPress 7.0 adds its own command-palette admin-bar icon (`#wp-admin-bar-command-palette`) and a global ⌘K keybinding. In the desktop shell Core's palette is never the right UI — its commands are harvested (above) and its own callbacks hard-navigate via `document.location`, unloading the shell out of the window model — so the shell **suppresses it unconditionally** (both the in-iframe keydown in the chromeless bridge and `installPaletteShortcut()` at the shell level). The shell's ⌘K surface is instead the assistant, which is **always registered** (`registerPalette('desktop-mode-ai-assistant')`), so ⌘K always opens it and Core's admin-bar icon (intercepted with a capture-phase `click` listener in `src/desktop.ts`) routes to it too.

**Two modes.** The overlay (`src/ai-assistant/impl.ts`, titled "Site Assistant") is a superset of the command palette:

- **Commands** — a command palette over the shared registry (`src/commands.ts`): typing filters live, empty input lists *every* command (contextual iframe commands pinned first), and picking one runs it. Always available — pure client, no AI, no server call.
- **Ask AI** — natural-language questions routed through `/ai/search` (read-only [Abilities](hooks-reference.md) + content search). It **suggests** (answers, entity cards, `admin_links` the user clicks) and never auto-runs a command. Offered only when a provider is configured *and* the toggle is on.

A **mode switch** in the header flips between them (replacing the `/` shortcut); it appears only when Ask AI is available. Each mode keeps its own input draft, and the last AI answer is re-shown when returning to Ask AI. The **OS Settings → Features → "AI assistant"** toggle (`ai.enabled`, off by default, provider-gated) enables Ask AI and makes it the default mode on open (off → Commands). The overlay reads provider status + the toggle live via `AiAssistantConfig.isAiAvailable()` / `isOverrideEnabled()`, so connecting a provider or flipping the toggle takes effect on the next open without a reload.

## CSS layering

Core layering only — feature windows ship their own per-feature sheets
(`os-settings.css`, `posts-window.css`, `recycle-bin.css`, `ai-assistant.css`,
`desktop-files.css`, `effects.css`, …), all registered in `includes/assets.php`.

```
assets/css/
├── variables.css    — Custom properties, color-scheme aware.
├── desktop.css      — Shell layout; hides classic chrome via body.desktop-mode-active.
├── windows.css      — Window chrome, animations, states (with the window-chrome.css,
│                      window-states.css, and window-overview.css companions).
├── dock.css         — Dock rail; keyed by data-desktop-mode-dock-placement
│                      (left / right / bottom). Placement derives from the desktop
│                      layout chosen in OS Settings (default "classic" = left side
│                      dock + bottom dock). dock-peek.css covers auto-hide peeking.
└── chromeless.css   — Loaded INSIDE iframes; scoped to body.desktop-mode-chromeless.
```

Never edit Core's `common.css` or color scheme files. Everything we need is exposed as a CSS Custom Property in `variables.css`.

## What's shipped vs. what comes next

**Shipped** — unified dock with left / right / bottom placement (derived from the desktop layout chosen in OS Settings; the default "classic" layout pairs a left side dock with a bottom dock), multi-window orchestration + session restore, virtual desktops / Spaces, wallpaper registry, widget registry, overview + arrange + snap, native windows and tabs, AI assistant + slash commands + palette registry, cross-frame drag bridge for Media Library, OS Settings native window, accent + custom-gradient editor, toast notifications, iframe observability (`iframe-ready` / `iframe-error` / `iframe-network-completed`), letter-badge icon fallback, batch `closeAll()` with protection filter, primary-desktop filter, iframe command-palette bridge (harvests `@wordpress/commands` from the focused window into the shell palette; see "Command palette bridge" above), Gutenberg `wp_guideline` sticky artifacts as draggable per-desktop sticky notes when the `wp_guideline_type` taxonomy exposes an `artifact`/`artifacts` → `sticky` term, with REST boot hydration plus Heartbeat deltas for cross-tab updates. Because sticky notes ride on Gutenberg's Guidelines experiment (opt-in, 22.7+), the shell only boots the layer when that CPT + taxonomy are registered — gated server-side by `desktop_mode_sticky_notes_is_available()` (filter `desktop_mode_sticky_notes_available`) and surfaced to the client as `desktopModeConfig.stickyNotes.available`, so a site without the experiment never fires the 404-prone REST probes.

**Pinned notes** — a second, plugin-owned notes surface, separate from the Guidelines-backed layer above. Notes are `wpd_note` posts (non-public CPT: not queryable, excluded from search, absent from core REST; `includes/notes/cpt.php`) with position (`_wpd_note_x`/`_wpd_note_y`, normalized 0–1), paper color (`_wpd_note_color`, whitelist via the `desktop_mode_notes_colors` filter), z-order (`_wpd_note_z`), and a creation-time jitter seed (`_wpd_note_seed`, hashed from the initial text and never rewritten — it drives each note's subtle paper tilt) in postmeta — the owner's placement is the canonical placement every viewer sees. The "public" checkbox maps to post status: `private` (default) ↔ `publish` (visible read-only, with author attribution, on every desktop-mode user's wallpaper). A custom REST controller at `/desktop-mode/v1/notes` (`includes/notes/rest.php`) enforces owner-only mutation (admins included) and optimistic concurrency (`updatedAtMs` token → 409 with the server copy); `includes/notes/heartbeat.php` streams cross-user deltas over the Heartbeat bus. Client-side, the **Note Pad widget** (`src/plugins/notes-widget/`, its own bundle) composes drafts that are torn off and dropped on the wallpaper as `'note-draft'` DragManager payloads; the notes layer (`src/notes/`, main bundle) renders the wall, the pushpin physics, and the trash flow. Trashed notes surface in the Trash via its filter pipeline (`includes/notes/recycle-bin.php`): owner-only view/restore/purge (replacing the bin's default `edit_post` gates, which would both expose private note text to admins and lock out subscriber owners), an owner-scoped badge count, and restore returning the note to its prior private/publish status. The bin's capture list includes every non-builtin `show_ui` post type, so third-party CPT trash appears alongside posts and pages by default. Because the drop-target registry allows one target per element, note payloads route through two seams consulted by the existing targets: `src/desktop-files/canvas-payloads.ts` (wallpaper create/reposition) and `src/desktop-files/recycle-bin-payloads.ts` (drag-to-bin soft-trash with Undo) — currently internal; promote via `wp.desktop.files.*` if third-party bundles need them.

**Games (0.9.6)** — opt-in site-wide, **off by default**: the `games` extended option (OS Settings → Features → Extended options; filter `desktop_mode_games_enabled`) gates the whole module in `includes/games/bootstrap.php` on `plugins_loaded` — while off, none of the games PHP loads (no schema check, REST routes, Heartbeat channel, window/icon) and `config.gamesEnabled: false` tells the shell to skip the challenges client; the two custom tables and play-time meta persist across disable/re-enable. A game system with a fixed **Games** hub window (Recycle-Bin-pattern native window + gamepad desktop icon; `includes/games/window.php`) laid out Steam-library style: a compact game grid across the top, and — for the selected game — a detail panel with description, **Play** / **Challenge** actions, the game's **unified scoreboard** (columns derived from its `score_columns`), and its challenges. Games register server-side via `desktop_mode_register_game( $id, $args )` (`includes/games/registry.php`) — metadata + a `script` handle + a `config` blob — shipped in the boot/live-refresh payload as the **`serverGames`** key; the shell registers metadata-only stubs and loads the game bundle **lazily on first launch** (`src/games/{registry,server-sync,launch}.ts`, exposed as `wp.desktop.games`). Two custom tables back persistence (`includes/games/schema.php`): `{$prefix}desktop_mode_game_scores` (`game`, `user_id`, `score` sort key, flexible `meta` JSON, epoch-ms timestamps) and `{$prefix}desktop_mode_game_challenges` (score-to-beat rows with a `pending → accepted|declined`, `accepted → completed` state machine and an `updated_at_ms` Heartbeat high-water mark). REST lives under `/desktop-mode/v1/games/*` (`includes/games/rest.php`): leaderboard GET/POST per game, challenge create/accept/decline/complete, and a games-scoped `/games/users/search` opponent picker gated on `read` (subscribers play too), plus **play-time tracking (0.9.7)**: the launcher measures each game window's active time client-side (the clock pauses while minimized) and flushes increments to `POST /games/{game}/playtime`; per-user lifetime totals accumulate in the `desktop_mode_game_playtime` user-meta map, with per-day buckets in `desktop_mode_game_playtime_days` (site-timezone days, rolling window) backing the hub's Steam-style "last two weeks" figure (`includes/games/playtime.php`, `src/games/playtime.ts`), readable via `GET /games/playtime` / `wp.desktop.games.getPlaytime()`. Challenge delivery rides the Heartbeat bus (`includes/games/heartbeat.php` ↔ `src/games/challenges-client.ts` in the main bundle, so notifications arrive with the hub closed); scores are client-asserted (arcade trust model) with the `desktop_mode_game_score_pre_save` veto filter as the anti-cheat extension point. Playing a game suspends the wallpaper via the refcounted `wp.desktop.wallpaper.suspend()/resume()` API (`src/wallpapers/layer.ts` — frozen-bitmap overlay + effective-visibility re-emission, so existing wallpapers pause with zero changes). The built-in **Inkfall** typing game (`src/games/inkfall/`, `includes/games/inkfall.php`) is the reference implementation: PixiJS v8 in a native window, and deliberately friendly vocabulary (musical notes, tearing words — no war terms anywhere). **Framework assets (0.9.8)**: the 20k-word dictionary is a games-framework asset (`assets/games/words.txt`, regenerated by `bin/build-game-words.mjs`, loader `src/games/dictionary.ts`) whose URL is merged into every game's payload `config` as `wordsUrl` (`includes/games/config.php`, filter `desktop_mode_games_words_url`) — one identical word list for every player. That shared list powers the second built-in game, **Alphabet Soup** (`src/games/alphabet-soup/`, `includes/games/alphabet-soup.php`): a daily word search seeded by the current date (`dd-mm-yyyy`, so the puzzle is the same worldwide), with three board sizes (8×8 / 12×12 / 16×16 — bigger pots hide more words; each (mode, size) pair is its own seeded puzzle), a three-wave Daily mode and a countdown **Time Attack** mode seeded from a different stream of the same date, a played-once-per-day ledger (replays are allowed after an upfront notice but never earn the card — word positions can be memorized), and a game-over **share card** — a generated 1200×630 PNG (canvas 2D, `src/games/share-card.ts`) shared via the native share sheet / clipboard / download, deliberately image-only (no URL: the admin is a private space).

**Real file storage (0.9.6)** — the desktop stops being reference-only: users upload arbitrary files (and whole folder trees, via `webkitGetAsEntry` traversal or the `webkitdirectory` picker) into per-user server storage, download them back unmodified, and download folders as on-demand `.zip`s. Bytes live flat under `uploads/desktop-mode-files/<user_id>/` with extensionless UUID disk names (`.htaccess` + `index.php` protection, PHP-gated serving with forced `attachment` disposition; a documented nginx `deny all` snippet covers the `.htaccess` gap); hierarchy/naming/sharing stay in the existing folders + placements + shares tables, with metadata in the new `{$prefix}desktop_mode_stored_files` table (schema v13, `includes/desktop-files/{stored-files-store,rest-uploads,downloads,file-shares}.php`). The intake is `POST /desktop-mode/v1/files/uploads` (one file per request, `relativePath` folder resolution mkdir-p style, `wp_handle_upload` + scoped `upload_dir` redirect, WP MIME policy + executable denylist, receive/register split kept as the future resumable-upload seam); downloads are `_wpnonce`-in-query GETs streamed through a `rest_pre_serve_request` short-circuit; folder zips build via ZipArchive into a swept temp file (feature-gated on `class_exists`). Uploads are owner-locked (folder write-collaborators cannot move/rename/trash them) and shareable read-only per user through the shares table's `target_type='file'` seam, invites riding the existing heartbeat `shares.pending` channel. Client-side, the OS-file-drop dialog gained a destination selector (Desktop storage default on wallpaper/folder surfaces; Media Library one click away) backed by `src/os-file-drop/{traversal,desktop-upload}.ts` and `src/desktop-files/upload-menu-items.ts`. Deletion is the documented exception to "references, not copies": purging the owner's last placement deletes the bytes, the row, the shares, and every recipient placement; a daily two-direction sweep reconciles disk/DB drift.

**Coming up**

- **Polish** — color-scheme-aware variables across every shell surface, View Transitions API animations, full accessibility audit (ARIA, focus traps, keyboard navigation).
- **Mobile (phone OS)** — `responsive.ts` + `mobile.ts`: home-screen grid, full-screen apps, app switcher, gesture nav, bottom tab bar. `wp.desktop.mode` returns `'desktop' | 'tablet' | 'mobile'`.
- **Tablet hybrid** — split view, slide-over overlay, horizontal bottom dock, optional desktop-mode toggle for large tablets.
- **The North Star — cross-window drag & drop** — extend the existing cross-frame drag bridge beyond Media Library attachments: pluggable mime-type negotiation (`desktop_mode_drag_mime_types` / `desktop_mode_drag_payload` / `desktop_mode_drop_accepts`), Gutenberg block-insertion target, visual lift-and-drop feedback.

See [Hooks Reference](./hooks-reference.md) for the filter/action names each phase will introduce.
